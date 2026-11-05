/**
 * Shared-scenario API. Every call degrades gracefully: if the store is not
 * configured or the cluster is unreachable the app keeps working against
 * browser-local storage, so a Mongo outage can never block planning work.
 */

/*
 * A 401 here means the session ended under the page — it expired, the account
 * was switched off, or the server's secret changed. The app listens for this
 * and puts the sign-in page back, rather than every later save failing with a
 * message nobody can act on. (Not in authApi: a wrong password is a 401 too,
 * and that is the sign-in page's own business.)
 */
export const SIGNED_OUT = 'kpi:signed-out'

const j = async (res) => {
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function storeStatus() {
  try {
    const h = await j(await fetch('/api/health'))
    return h.store || { configured: false, connected: false }
  } catch {
    return { configured: false, connected: false, reason: 'server unreachable' }
  }
}

export const listScenarios = async () => j(await fetch('/api/scenarios'))

export const loadScenario = async (name) =>
  j(await fetch(`/api/scenarios/${encodeURIComponent(name)}`))

export const saveScenario = async (name, payload, updatedBy) =>
  j(
    await fetch(`/api/scenarios/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, updatedBy }),
    }),
  )

export const deleteScenario = async (name) =>
  j(await fetch(`/api/scenarios/${encodeURIComponent(name)}`, { method: 'DELETE' }))

/* ---------------------------- jira ---------------------------- */

/** Is the server able to reach Jira at all, and as whom. */
export const jiraStatus = async () => j(await fetch('/api/jira/status'))

/**
 * Live issues for the keys the register holds.
 *
 * The keys go up, the token never comes down: the browser has no credential
 * of its own and cannot query Jira directly even if it wanted to.
 */
export const jiraIssues = async (keys) =>
  j(await fetch('/api/jira/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  }))

/**
 * Run the sync ON THE SERVER, against the SHARED plan.
 *
 * The difference from reading issues and merging in the browser is who ends up
 * with the result: this writes the scenario everybody loads, which is what the
 * 07:00 job does every morning. A merge done in one browser stays in that
 * browser until somebody saves it, and a colleague who synced on their own
 * machine has not changed anything anybody else can see.
 */
export const jiraSyncShared = async () =>
  j(await fetch('/api/jira/sync', { method: 'POST' }))

/**
 * The shared home screen, read and written on its own.
 *
 * Deliberately not part of the plan payload: the Apps page is not the register
 * and must not wait on the rules that protect it. One field, read-modify-write
 * on the server, so it can never touch a project.
 */
export const loadApps = async (name) =>
  j(await fetch(`/api/scenarios/${encodeURIComponent(name)}/apps`))

export const saveApps = async (name, apps) =>
  j(await fetch(`/api/scenarios/${encodeURIComponent(name)}/apps`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apps }),
  }))

/* --------------------------- weekly --------------------------- */

/*
 * The weekly check-in. Kept out of the plan payload on purpose — see
 * server/weekly.js — so it has calls of its own.
 */

/*
 * An administrator previewing the app as a team member: every weekly READ
 * asks the server for what a member would be sent. Writes are untouched — the
 * account is still what it is, and the server still decides what it may do.
 */
let viewAs = null
export const setViewAs = (v) => { viewAs = v === 'member' ? 'member' : null }
const vq = (url) => (viewAs ? `${url}${url.includes('?') ? '&' : '?'}view=member` : url)

export const weeklySettings = async () => j(await fetch(vq('/api/weekly/settings')))

export const saveWeeklySettings = async (submitters) =>
  j(await fetch('/api/weekly/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ submitters }),
  }))

/** Any of: escalation (a list of addresses, or null for the administrators), remindersOn. */
export const saveWeeklyOptions = async (patch) =>
  j(await fetch('/api/weekly/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))

/** Whether email can go out, and what went out lately. Administrators only. */
export const mailStatus = async () => j(await fetch('/api/weekly/mail'))

/** A test email to the person asking. */
export const sendTestMail = async () => j(await fetch('/api/weekly/mail/test', { method: 'POST' }))

/** One week as this person may see it. `week` is a Monday, or 'current'. */
export const loadWeek = async (week) => j(await fetch(vq(`/api/weekly/${encodeURIComponent(week)}`)))

/*
 * Save one's own week. A refusal comes back with `problems` — the list of
 * what is missing — so the page can show every one rather than just the first.
 */
export async function saveMyWeek(week, body) {
  const res = await fetch(`/api/weekly/${encodeURIComponent(week)}/mine`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const out = await res.json().catch(() => ({}))
  if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT))
  if (!res.ok) {
    const err = new Error(out.error || `Request failed (${res.status})`)
    err.problems = out.problems || []
    throw err
  }
  return out
}

/*
 * The last few weeks, for the Excel "Weekly" sheet: newest first, each as this
 * person is sent it. `full` says whether that includes everybody's tasks (an
 * administrator) or only everybody's focus and one's own (a member). Null when
 * the weekly store is not there — the workbook then simply has no such sheet.
 */
export async function weeklyForExport(count = 4, load = loadWeek) {
  try {
    const now = await load('current')
    const weeks = [now]
    let w = now.week
    for (let i = 1; i < count; i++) {
      w = new Date(Date.parse(`${w}T00:00:00Z`) - 7 * 86400_000).toISOString().slice(0, 10)
      weeks.push(await load(w))
    }
    return { weeks, full: weeks[0].team.some((t) => 'standing' in t) }
  } catch {
    return null
  }
}

/* Date proposals: a slipped task asking to move its project's due date. */
export const proposals = async (status = 'pending') =>
  j(await fetch(vq(`/api/weekly/proposals?status=${encodeURIComponent(status)}`)))

export const approveProposal = async (id, due) =>
  j(await fetch(`/api/weekly/proposals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due: due || null }),
  }))

export const rejectProposal = async (id, reason) =>
  j(await fetch(`/api/weekly/proposals/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  }))

/** Each project's last eight weeks, its blockers and its proposals — for the Timeline. */
export const weeklyByProject = async () => j(await fetch(vq('/api/weekly/projects')))

/* ---------------------------- AI ---------------------------- */

const post = async (url, body) => j(await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body || {}),
}))

/** Whether the AI is available here (and, for an administrator, why not). */
export const aiStatus = async () => j(await fetch('/api/ai/status'))

/** Help with one field: kind 'notes' | 'polish' | 'blocker'. */
export const aiWrite = async (body) => post('/api/ai/write', body)

/** The week's AI summaries, newest first. Administrators only. */
export const aiSummary = async (week) => j(await fetch(`/api/ai/summary?week=${encodeURIComponent(week)}`))

export const aiTest = async () => post('/api/ai/test')

/* The chatbot: this administrator's own conversations. */
export const aiChats = async () => j(await fetch('/api/ai/chats'))
export const aiChat = async (id) => j(await fetch(`/api/ai/chats/${encodeURIComponent(id)}`))
export const aiAsk = async (chatId, message) => post('/api/ai/chats', { chatId: chatId || null, message })
export const aiDeleteChat = async (id) => j(await fetch(`/api/ai/chats/${encodeURIComponent(id)}`, { method: 'DELETE' }))

/** The tasks under an epic, or the epics under an initiative. */
export const jiraChildren = async (keys) =>
  j(await fetch('/api/jira/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  }))

/**
 * Push the plan back to a ticket: the start date, the due date, or both.
 *
 * Not the resolution date. Jira stamps that itself when an issue transitions
 * into a resolved status and refuses to accept it as a field, so outcomes flow
 * one way — out of Jira — and only the plan flows both.
 */
export const jiraUpdate = async (key, patch) =>
  j(await fetch(`/api/jira/issue/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))

/** Every epic in the Jira project — the app works out which are new. */
export const jiraEpics = async (sinceDays) =>
  j(await fetch(`/api/jira/epics${sinceDays ? `?since=${encodeURIComponent(sinceDays)}` : ''}`))

/** What the tasks under each epic add up to — latest dates, and whether all are done. */
export const jiraRollup = async (keys) =>
  j(await fetch('/api/jira/rollup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  }))
