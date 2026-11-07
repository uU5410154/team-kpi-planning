import { connect, UNAVAILABLE } from './db.js'
import * as store from './db.js'
import * as jira from './jira.js'
import * as weekly from './weekly.js'
import * as auth from './auth.js'
import * as mail from './mail.js'
import * as manager from './manager.js'
import { weekTitle, canWriteWeek, isWeek } from '../src/lib/weekly.js'
import { projectFromEpic } from '../src/lib/jiraMerge.js'
import { isHoldStatus } from '../src/lib/hold.js'

/**
 * A MEMBER'S WEEK, RUN FROM JIRA.
 *
 * Their week is the Jira tasks assigned to them whose dates cover it. Each
 * task has its own update and its own Submit; submitting posts the update to
 * the task in Jira (a comment, the screenshot, Done when finished) and keeps
 * it here, where the dashboard, the reminders and the summary read it.
 *
 *   updates    one document per person, week and Jira task: the last update
 *              submitted, and what happened when it went to Jira
 *   decisions  "a decision is needed" raised on a task, open until an
 *              administrator marks it decided
 */

const cfg = () => ({
  updates: process.env.MONGODB_TASK_UPDATES_COLLECTION || 'kpi_task_updates',
  decisions: process.env.MONGODB_DECISIONS_COLLECTION || 'kpi_decisions',
  scenario: process.env.JIRA_SYNC_SCENARIO || 'Baseline',
})

let colls = null
async function c() {
  const db = await connect()
  if (!db) return null
  if (!colls) {
    const d = db.s.db
    colls = { updates: d.collection(cfg().updates), decisions: d.collection(cfg().decisions) }
    await colls.updates.createIndex({ week: 1, person: 1 })
    await colls.decisions.createIndex({ status: 1, createdAt: -1 })
  }
  return colls
}

const fail = (status, error) => ({ status, error })

/** The roster entry, and their Jira account. */
async function whoInJira(person, email) {
  const r = await weekly.roster()
  if (r === UNAVAILABLE) return UNAVAILABLE
  const p = r.people.find((x) => x.id === person)
  if (!p) return { roster: r, person: null, account: null }
  const account = await jira.accountFor({ names: [...(p.jiraNames || []), p.name], email })
  return { roster: r, person: p, account: account === UNAVAILABLE ? null : account }
}

/** The register project a Jira task belongs to, through its epic. */
const projectFor = (roster, parentKey) => (parentKey
  ? roster.projects.find((p) => p.jiraKey && p.jiraKey.toUpperCase() === parentKey.toUpperCase()) || null
  : null)

/** A project or epic someone has marked "[DELETED]" in its name: not shown. */
export const markedDeleted = (name) => /\[\s*deleted\s*\]/i.test(name || '')

/*
 * WHAT A PERSON MUST UPDATE FOR A WEEK — the owner's rule (2026-11-06): the
 * Jira epics and tasks with their name as PIC (the assignee) whose timeline
 * covers that week. Nothing past due outside it, and nothing marked [DELETED]
 * — the item itself, its epic, or its row in the register. Tasks with no dates
 * yet are offered for planning, only under epics they are PIC of. The page,
 * the plan and the "report is in" count all use this one list.
 *
 * Nothing ON HOLD either (2026-11-07): an item in a Hold status in Jira, a task
 * whose epic is, or a project put on hold in the register. Work stopped on
 * purpose needs no weekly update. An item they already updated this week
 * (`keep`) stays, so the update they just sent does not vanish from the page.
 */
async function myTasks(who, person, week, keep = new Set()) {
  const list = await jira.tasksForWeek(who.account.accountId, week, { withEpics: true })
  if (list === UNAVAILABLE) return UNAVAILABLE
  const live = (t) => {
    const row = projectFor(who.roster, t.epic ? t.key : t.parent?.key)
    if (markedDeleted(t.summary) || markedDeleted(t.parent?.summary) || markedDeleted(row?.summary)) return false
    if (keep.has(t.key) || t.done) return true
    // The live Jira status first; the register's copy of it can be a day old.
    const held = isHoldStatus(t.status) || isHoldStatus(t.parent?.status)
      || (!!row && (!!row.onHold || isHoldStatus(row.status) || isHoldStatus(row.srcStatus)))
    return !held
  }
  const picOf = new Set(who.roster.projects.filter((p) => p.pic === person && p.jiraKey).map((p) => p.jiraKey.toUpperCase()))
  return {
    week: list.week.filter(live),
    overdue: [],
    undated: list.undated.filter((t) => !t.epic && live(t) && picOf.has(String(t.parent?.key || '').toUpperCase())),
  }
}

/*
 * THE WEEK, AS THE MEMBER SEES IT.
 *
 * Their tasks for the week (and the overdue and undated ones), each with the
 * register project it is under and the last update they submitted on it.
 */
export async function weekFor(person, email, week) {
  if (!jira.status().configured) return { jira: 'off' }
  const k = await c()
  if (!k) return UNAVAILABLE
  const who = await whoInJira(person, email)
  if (who === UNAVAILABLE) return UNAVAILABLE
  if (!who.person) return { jira: 'unlinked' }
  if (!who.account) return { jira: 'unmatched', names: who.person.jiraNames || [] }
  const updates = await k.updates.find({ week, person }).toArray()
  const list = await myTasks(who, person, week, new Set(updates.map((u) => u.jiraKey)))
  if (list === UNAVAILABLE) return { jira: 'off' }
  const upd = Object.fromEntries(updates.map((u) => [u.jiraKey, u]))
  const decorate = (t) => {
    // An epic is its own project; a task is under its epic's.
    const p = projectFor(who.roster, t.epic ? t.key : t.parent?.key)
      || (t.epic ? { key: t.key, summary: t.summary, jiraKey: t.key } : null)
    const u = upd[t.key]
    return {
      key: t.key,
      summary: t.summary,
      status: t.status,
      done: t.done,
      start: t.start,
      due: t.due,
      sprintStart: t.sprintStart,
      sprintEnd: t.sprintEnd,
      sprintName: t.sprintName,
      type: t.type,
      epic: !!t.epic,
      url: t.url,
      parent: t.parent,
      project: p ? { key: p.key, summary: p.summary, jiraKey: p.jiraKey } : null,
      update: u ? {
        progress: u.progress,
        done: u.done,
        hold: !!u.hold,
        reason: u.reason,
        blocker: u.blocker,
        decision: u.decision,
        decisionText: u.decisionText,
        attachments: u.attachments || [],
        submittedAt: u.submittedAt,
        jira: u.jira || null,
      } : null,
    }
  }
  return {
    jira: 'on',
    writable: jira.writable(),
    account: who.account.displayName,
    week,
    tasks: list.week.map(decorate),
    overdue: list.overdue.map(decorate),
    undated: list.undated.map(decorate),
  }
}

/* --------------------------------------------------------- the update */

const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
const MAX_IMAGES = 3
const MAX_IMAGE_BYTES = 4 * 1024 * 1024

/** Pasted screenshots, from data: URLs, checked. */
function imagesOf(list) {
  const out = []
  for (const [i, im] of (Array.isArray(list) ? list : []).slice(0, MAX_IMAGES).entries()) {
    const m = String(im?.data || '').match(/^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/)
    if (!m || !IMAGE_TYPES[m[1]]) return { error: 'A screenshot must be a PNG, JPEG, GIF or WebP image.' }
    const buffer = Buffer.from(m[2], 'base64')
    if (buffer.length > MAX_IMAGE_BYTES) return { error: 'Each screenshot must be under 4 MB.' }
    const base = String(im?.name || '').replace(/[^\w.-]+/g, '-').replace(/\.[a-z]+$/i, '').slice(0, 60) || `screenshot-${i + 1}`
    out.push({ name: `${base}.${IMAGE_TYPES[m[1]]}`, type: m[1], buffer })
  }
  return { files: out }
}

const clip = (v, n) => String(v ?? '').slice(0, n).trim()

/** The comment that goes onto the Jira task. */
/**
 * The update as it is added to the issue's description: the date first, as
 * dd-mm-yyyy, then the same lines as the comment.
 */
export function descriptionText({ nick, week, u, attachments, at }) {
  const lines = commentText({ nick, week, u, attachments }).split('\n').slice(1)
  return [`**${jira.ddmmyyyy(at)}** — ${weekTitle(week)} update from ${nick}`, ...lines].join('\n')
}

export function commentText({ nick, week, u, attachments }) {
  return [
    `**Weekly update — ${weekTitle(week)}, from ${nick}** (posted by the F&A KPI app)`,
    `**Status:** ${u.done ? 'Finished' : u.hold ? 'On hold' : 'Not finished'}`,
    u.progress ? `**This week:** ${u.progress}` : null,
    !u.done && u.reason ? `**${u.hold ? 'Why on hold' : 'Why not finished'}:** ${u.reason}` : null,
    u.blocker ? `**Blocker:** ${u.blocker}` : null,
    u.decision ? `**Decision needed:** ${u.decisionText}` : null,
    attachments.length ? `**Attached:** ${attachments.join(', ')}` : null,
  ].filter(Boolean).join('\n')
}

/*
 * SUBMIT ONE TASK'S UPDATE.
 *
 * Only a task assigned to this member in Jira, in a week they may still
 * write. Kept here first — so nothing typed is lost if Jira is down — then
 * posted to Jira, and what Jira said is kept beside it.
 */
export async function submit(week, me, body, now = Date.now()) {
  if (!isWeek(week)) return fail(400, 'A week is named by its Monday, as YYYY-MM-DD.')
  if (!me.person) return fail(409, 'This account is not linked to anybody on the team yet. Ask an administrator to link it on the Access tab.')
  if (!canWriteWeek(week, now)) return fail(409, 'That week is closed: it locked at 08:00 on the following Monday.')
  if (!jira.status().configured) return fail(409, 'Jira is not connected on the server.')
  const k = await c()
  if (!k) return UNAVAILABLE

  const key = clip(body?.jiraKey, 40).toUpperCase()
  const u = {
    progress: clip(body?.progress, 4000),
    done: body?.done === true ? true : body?.done === false || body?.hold === true ? false : null,
    // On hold is a kind of not finished: the work has stopped on purpose.
    hold: body?.hold === true && body?.done !== true,
    reason: clip(body?.reason, 2000),
    blocker: clip(body?.blocker, 2000),
    decision: body?.decision === true,
    decisionText: clip(body?.decisionText, 2000),
  }
  const problems = []
  if (!u.progress) problems.push('Write what happened on it this week.')
  if (u.done === null) problems.push('Say whether it is finished.')
  if (u.done === false && !u.hold && !u.reason) problems.push('Say why it is not finished.')
  if (u.decision && !u.decisionText) problems.push('Say what decision is needed.')
  const imgs = imagesOf(body?.images)
  if (imgs.error) problems.push(imgs.error)
  if (problems.length) return { status: 400, error: 'The update is not complete yet.', problems }

  const who = await whoInJira(me.person, me.email)
  if (who === UNAVAILABLE) return UNAVAILABLE
  if (!who.account) return fail(409, 'Your Jira account could not be found from your name on the team. Ask an administrator to check the Jira names on the Model tab.')
  const issue = await jira.issueOwner(key)
  if (!issue) return fail(404, 'There is no such Jira task.')
  if (issue.accountId !== who.account.accountId) return fail(403, `${key} is not assigned to you in Jira.`)

  const project = projectFor(who.roster, issue.parent?.key) || projectFor(who.roster, key)
  const nick = who.person.nick
  const id = `${week}.${me.person}.${key}`
  const at = new Date(now).toISOString()
  const doc = {
    _id: id,
    week,
    person: me.person,
    nick,
    jiraKey: key,
    summary: issue.summary,
    epicKey: issue.parent?.key || null,
    projectKey: project?.key || null,
    ...u,
    attachments: imgs.files.map((f) => f.name),
    submittedAt: at,
    by: me.email,
    jira: { state: 'pending' },
  }
  await k.updates.updateOne({ _id: id }, { $set: doc }, { upsert: true })

  // To Jira: the screenshot, then the comment naming it, then Done.
  const result = { state: 'posted', at }
  try {
    const names = await jira.attach(key, imgs.files)
    result.attachments = names
    const cm = await jira.addComment(key, commentText({ nick, week, u, attachments: names }))
    result.commentId = cm?.id || null
    // And added to the description, so the issue itself says where it stands. A field
    // Jira will not let the app edit is reported, and does not stop the rest.
    try {
      await jira.addToDescription(key, descriptionText({
        nick, week, u, attachments: names, at: now,
      }))
      result.description = 'updated'
    } catch (e) {
      if (e.writesOff) throw e
      result.description = `not updated: ${e.message}`
    }
    if (u.done && !issue.done) {
      const d = await jira.markDone(key)
      result.done = d.moved ? d.status : `not moved: ${d.reason}`
    }
    if (u.hold && !issue.done && !isHoldStatus(issue.status)) {
      const h = await jira.markHold(key)
      result.hold = h.moved ? h.status : `not moved: ${h.reason}`
    } else if (u.hold) {
      result.hold = issue.status || 'On hold'
    }
  } catch (e) {
    result.state = e.writesOff ? 'off' : 'failed'
    result.error = e.message
  }
  // A project epic put on hold: the register says so at once, for the project page.
  const ownRow = projectFor(who.roster, key)
  if (u.hold && ownRow) {
    const moved = result.hold && !String(result.hold).startsWith('not moved')
    result.register = await holdInRegister(ownRow.key, moved ? { jiraStatus: result.hold } : { onHold: { at, by: me.email } }, me.email)
  }
  await k.updates.updateOne({ _id: id }, { $set: { jira: result } })

  // Into the week, so the dashboard and the reminders count it.
  const list = await myTasks(who, me.person, week).catch(() => null)
  const due = list && list !== UNAVAILABLE ? [...list.week, ...list.overdue].map((t) => t.key) : [key]
  const reported = new Set((await k.updates.find({ week, person: me.person }).toArray()).map((x) => x.jiraKey))
  const allIn = due.every((x) => reported.has(x))
  const entry = await weekly.mirrorTasks(week, me.person, [{
    id: weekly.jiraTaskId(key),
    title: `${key} ${issue.summary}`.trim(),
    projectKey: project?.key || null,
    jiraKey: key,
    expected: issue.due || null,
    done: u.done,
    pct: u.done ? 100 : null,
    blocker: u.blocker || (u.done ? '' : u.reason || (u.hold ? 'On hold' : '')),
    progress: u.progress,
    reason: u.reason,
    decision: u.decision,
    decisionText: u.decisionText,
    reportedAt: at,
    attachments: doc.attachments,
  }], { by: me.email, plan: true, report: allIn })
  if (entry && entry !== UNAVAILABLE) manager.answered(week, me.person, entry).catch((e) => console.warn(`[followup] ${e.message}`))

  if (u.decision) await raiseDecision(k, { ...doc, jira: result }, now)
  return { update: { ...doc, jira: result }, reportIn: allIn }
}

/**
 * Mark a register project as on hold: with its Jira status when Jira moved the
 * epic, or with `onHold` when Jira had no Hold status (the project page offers
 * Resume to clear it). Returns 'updated', or why not.
 */
async function holdInRegister(projectKey, patch, by) {
  try {
    const name = cfg().scenario
    const doc = await store.getScenario(name)
    if (doc === store.UNAVAILABLE || !doc?.payload?.projects) return 'not updated: no register'
    const projects = doc.payload.projects.map((p) => (p.key === projectKey ? { ...p, ...patch } : p))
    const saved = await store.saveScenario(name, { ...doc.payload, projects }, `${by} (on hold)`)
    return saved === store.UNAVAILABLE ? 'not updated: the database is unavailable' : 'updated'
  } catch (e) {
    return `not updated: ${e.message}`
  }
}

/*
 * EACH PROJECT'S JIRA WORK IN A WEEK, for the manager's "Who holds what": the
 * epic and the tasks under it whose timeline covers the week, whoever holds
 * them, each with the update its holder submitted for that week, if any.
 */
export async function coverage(week) {
  if (!jira.status().configured) return { jira: 'off', week, byProject: {} }
  const k = await c()
  if (!k) return UNAVAILABLE
  const roster = await weekly.roster()
  if (roster === UNAVAILABLE) return UNAVAILABLE
  const rows = roster.projects.filter((p) => p.jiraKey && !markedDeleted(p.summary))
  let list
  try {
    list = await jira.coveringWeek(rows.map((p) => p.jiraKey), week)
  } catch (e) {
    console.warn(`[coverage] ${week}: ${e.message}`)
    return { jira: 'error', week, byProject: {}, error: e.message }
  }
  if (list === UNAVAILABLE) return { jira: 'off', week, byProject: {} }
  const updates = await k.updates.find({ week }).toArray()
  const upd = Object.fromEntries(updates.map((u) => [u.jiraKey, u]))
  const linesOf = {}
  for (const p of rows) (linesOf[p.jiraKey.toUpperCase()] = linesOf[p.jiraKey.toUpperCase()] || []).push(p.key)
  const nickOf = (name) => (name ? roster.people.find((p) => p.name === name || (p.jiraNames || []).includes(name))?.nick || name : null)
  const byProject = {}
  for (const t of list) {
    if (markedDeleted(t.summary) || markedDeleted(t.parent?.summary)) continue
    const epicKey = (t.epic ? t.key : t.parent?.key || '').toUpperCase()
    const u = upd[t.key]
    const item = {
      key: t.key,
      summary: t.summary,
      epic: !!t.epic,
      assignee: t.assignee || null,
      holder: nickOf(t.assignee),
      status: t.status,
      done: t.done,
      start: t.start,
      due: t.due,
      update: u ? {
        nick: u.nick, done: u.done, hold: !!u.hold, reason: u.reason || '', blocker: u.blocker || '', submittedAt: u.submittedAt,
      } : null,
    }
    for (const pk of linesOf[epicKey] || []) (byProject[pk] = byProject[pk] || []).push(item)
  }
  for (const v of Object.values(byProject)) v.sort((a, b) => Number(b.epic) - Number(a.epic))
  return { jira: 'on', week, byProject, skipped: list.skipped || [] }
}

/* ---------------------------------------------------------- decisions */

async function raiseDecision(k, d, now) {
  const id = `${d.week}.${d.person}.${d.jiraKey}`
  const prior = await k.decisions.findOne({ _id: id })
  // The same question again is not news; a new question reopens it.
  if (prior && prior.text === d.decisionText && prior.status === 'open') return
  const doc = {
    _id: id,
    week: d.week,
    person: d.person,
    nick: d.nick,
    jiraKey: d.jiraKey,
    summary: d.summary,
    projectKey: d.projectKey,
    text: d.decisionText,
    status: 'open',
    createdAt: new Date(now).toISOString(),
  }
  await k.decisions.updateOne({ _id: id }, { $set: doc }, { upsert: true })
  if (!mail.status().configured) return
  const users = await auth.listUsers().catch(() => [])
  const to = (Array.isArray(users) ? users : []).filter((a) => a.role === 'admin' && a.status === 'active').map((a) => a.email)
  if (!to.length) return
  const { html, text } = mail.layout({
    heading: `${d.nick} needs a decision on ${d.jiraKey}`,
    lines: [
      `${d.jiraKey}${d.summary ? ` — ${d.summary}` : ''}${d.projectKey ? ` (project ${d.projectKey})` : ''}.`,
      `“${d.decisionText}”`,
    ],
    button: { label: 'Open the Dashboard', href: `${mail.appUrl()}/#dashboard` },
    foot: `Raised in the weekly update for ${weekTitle(d.week)}.`,
  })
  await mail.sendOnce(`decision:${id}:${Date.parse(doc.createdAt)}`, {
    to, kind: 'decision', subject: `Decision needed: ${d.jiraKey}${d.summary ? ` — ${d.summary}` : ''}`, html, text, meta: { decision: id },
  })
}

/** Decisions: everybody's open ones for an administrator, one's own for a member. */
export async function listDecisions({ status = 'open', person } = {}) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const q = {}
  if (status !== 'all') q.status = status
  if (person) q.person = person
  return (await k.decisions.find(q).sort({ createdAt: -1 }).limit(200).toArray())
    .map(({ _id, ...d }) => ({ id: _id, ...d }))
}

export async function resolveDecision(id, note, by, now = Date.now()) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const at = new Date(now).toISOString()
  const r = await k.decisions.findOneAndUpdate(
    { _id: String(id), status: 'open' },
    { $set: { status: 'decided', decidedBy: by, decidedAt: at, note: clip(note, 2000) } },
    { returnDocument: 'after' },
  )
  const doc = r?.value !== undefined ? r.value : r
  if (!doc) return fail(404, 'That decision is not open.')
  if (jira.writable() && doc.note) {
    jira.addComment(doc.jiraKey, `**Decision (${by}):** ${doc.note}`).catch((e) => console.warn(`[decision] ${e.message}`))
  }
  const { _id, ...rest } = doc
  return { decision: { id: _id, ...rest } }
}

/* ------------------------------------------------- new tasks and dates */

/** Is this Jira task the member's to change? */
async function ownTask(me, key) {
  const who = await whoInJira(me.person, me.email)
  if (who === UNAVAILABLE) return UNAVAILABLE
  if (!who.account) return fail(409, 'Your Jira account could not be found from your name on the team.')
  const issue = await jira.issueOwner(key)
  if (!issue) return fail(404, 'There is no such Jira task.')
  if (issue.accountId !== who.account.accountId) return fail(403, `${key} is not assigned to you in Jira.`)
  return { who, issue }
}

/** A new task under a project's epic, assigned to the member. */
export async function newTask(me, body) {
  if (!me.person) return fail(409, 'This account is not linked to anybody on the team yet.')
  const who = await whoInJira(me.person, me.email)
  if (who === UNAVAILABLE) return UNAVAILABLE
  if (!who.account) return fail(409, 'Your Jira account could not be found from your name on the team.')
  const project = who.roster.projects.find((p) => p.key === body?.projectKey)
  if (!project?.jiraKey) return fail(400, 'Pick a project that has a Jira epic.')
  try {
    const r = await jira.createTask({
      epicKey: project.jiraKey, summary: body?.summary, start: body?.start, due: body?.due, accountId: who.account.accountId,
    })
    return { task: { ...r, projectKey: project.key } }
  } catch (e) {
    return fail(e.statusCode && e.statusCode < 500 ? (e.writesOff ? 409 : 400) : 502, e.message)
  }
}

/** Plan a task: its start and due dates, written to Jira. */
export async function planTask(me, key, body) {
  if (!me.person) return fail(409, 'This account is not linked to anybody on the team yet.')
  if (!jira.writable()) return fail(409, 'Writing to Jira is switched off. Set JIRA_ALLOW_WRITES=true in the Render dashboard.')
  const k = String(key || '').toUpperCase()
  const own = await ownTask(me, k)
  if (own === UNAVAILABLE || own.error) return own
  const { start, due } = body || {}
  if (start && due && start > due) return fail(400, 'The start date is after the due date.')
  const patch = {}
  if (start !== undefined) patch.start = start || null
  if (due !== undefined) patch.due = due || null
  try {
    return await jira.updateIssue(k, patch)
  } catch (e) {
    return fail(e.statusCode && e.statusCode < 500 ? 400 : 502, e.message)
  }
}

/*
 * A NEW PROJECT: a Jira epic of the kind asked for, assigned to the member,
 * and a row in the register with them as PIC — written to the shared plan on
 * the server, the way an approved date is, so no browser has to be open. An
 * administrator sizes it later; until then it carries no saving hours.
 */
export async function newProject(me, body) {
  if (!me.person) return fail(409, 'This account is not linked to anybody on the team yet.')
  const who = await whoInJira(me.person, me.email)
  if (who === UNAVAILABLE) return UNAVAILABLE
  if (!who.account) return fail(409, 'Your Jira account could not be found from your name on the team.')
  let epic
  try {
    epic = await jira.createEpic({
      summary: body?.summary, kind: body?.kind, start: body?.start, due: body?.due, description: clip(body?.description, 4000), accountId: who.account.accountId,
    })
  } catch (e) {
    return fail(e.statusCode && e.statusCode < 500 ? (e.writesOff ? 409 : 400) : 502, e.message)
  }
  const name = cfg().scenario
  const doc = await store.getScenario(name)
  if (doc === store.UNAVAILABLE || !doc?.payload) return { project: null, epic, warning: 'The Jira epic was created, but the register could not be updated. An administrator can add it with "Find new epics" on the Timeline.' }
  const kind = jira.PROJECT_KINDS[body.kind]
  const have = doc.payload.projects || []
  const taken = new Set(have.map((p) => p.key))
  let seq = have.filter((p) => String(p.key).startsWith('NEW-')).length
  const make = () => ({
    ...projectFromEpic({
      key: epic.key, summary: clip(body.summary, 250), start: body.start, due: body.due, status: 'To Do',
    }, ++seq, doc.payload.people || []),
    pic: me.person,
    program: kind.name,
    kind: body.kind,
    comment: `${kind.name}, added by ${who.person.nick} from their weekly page as ${epic.key}.`,
  })
  let row = make()
  while (taken.has(row.key)) row = make()
  if (have.some((p) => p.jiraKey === epic.key)) return { project: null, epic }
  const projects = [...have, row]
  const saved = await store.saveScenario(name, { ...doc.payload, projects }, `${me.email} (new project)`)
  if (saved === store.UNAVAILABLE) return { project: null, epic, warning: 'The Jira epic was created, but the register could not be updated.' }
  return { project: row, epic, savedAt: saved.updatedAt || null }
}

/*
 * "MY PLAN FOR THIS WEEK IS SET."
 *
 * Planning happens in Jira, by the dates on the tasks. Confirming takes the
 * tasks that cover the week as they stand and records them as the week's plan,
 * which is what the Monday reminder and the dashboard look for.
 */
export async function confirmPlan(week, me, now = Date.now()) {
  if (!isWeek(week)) return fail(400, 'A week is named by its Monday, as YYYY-MM-DD.')
  if (!me.person) return fail(409, 'This account is not linked to anybody on the team yet.')
  if (!canWriteWeek(week, now)) return fail(409, 'That week is closed.')
  const who = await whoInJira(me.person, me.email)
  if (who === UNAVAILABLE) return UNAVAILABLE
  if (!who.account) return fail(409, 'Your Jira account could not be found from your name on the team.')
  const list = await myTasks(who, me.person, week)
  if (list === UNAVAILABLE) return fail(409, 'Jira is not connected on the server.')
  const tasks = [...list.week, ...list.overdue].filter((t) => !t.done || list.week.includes(t))
  if (!tasks.length) return fail(400, 'No Jira task of yours covers this week yet. Add one, or set dates on one, first.')
  const entry = await weekly.mirrorTasks(week, me.person, tasks.map((t) => {
    const p = projectFor(who.roster, t.epic ? t.key : t.parent?.key)
    return {
      id: weekly.jiraTaskId(t.key),
      title: `${t.key} ${t.summary}`.trim(),
      projectKey: p?.key || null,
      jiraKey: t.key,
      start: t.start || null,
      expected: t.due || t.sprintEnd || null,
    }
  }), { by: me.email, plan: true })
  return { planned: tasks.length, planSubmittedAt: entry?.planSubmittedAt || null }
}
