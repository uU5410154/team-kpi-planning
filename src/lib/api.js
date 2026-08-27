/**
 * Shared-scenario API. Every call degrades gracefully: if the store is not
 * configured or the cluster is unreachable the app keeps working against
 * browser-local storage, so a Mongo outage can never block planning work.
 */

const j = async (res) => {
  const body = await res.json().catch(() => ({}))
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
