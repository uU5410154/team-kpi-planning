import { connect, UNAVAILABLE } from './db.js'
import * as store from './db.js'
import * as jira from './jira.js'
import {
  cleanEntry, planProblems, reportProblems, carryOver, addWeeks, deadlines, stageStatus,
  defaultSubmitters, proposalFor, proposalId, weekOf,
} from '../src/lib/weekly.js'
import { replanPatch, repairState, DEFAULT_JIRA_NAMES } from '../src/lib/model.js'
import { JIRA_KEY } from '../src/lib/jiraMerge.js'

/**
 * The weekly check-in's own storage.
 *
 * NOT IN THE SHARED PLAN. The plan is one document, saved whole, last writer
 * wins — fine for one administrator editing the register, and exactly wrong
 * for six people submitting on the same Monday morning: each save would carry
 * that browser's copy of everybody else's week and quietly undo theirs.
 *
 * So one document per person per week, in a collection of its own, written
 * only by the person it belongs to. Nobody's submission can overwrite
 * anybody else's, whatever their browser is holding.
 */

const cfg = () => ({
  entries: process.env.MONGODB_WEEKLY_COLLECTION || 'kpi_weekly',
  settings: process.env.MONGODB_WEEKLY_SETTINGS_COLLECTION || 'kpi_weekly_settings',
  proposals: process.env.MONGODB_WEEKLY_PROPOSALS_COLLECTION || 'kpi_weekly_proposals',
  // The plan whose roster says who the team is. The same one the Jira sync
  // writes to, for the same reason: there is one shared plan.
  scenario: process.env.JIRA_SYNC_SCENARIO || 'Baseline',
})

let entries = null
let settings = null
let proposals = null
async function colls() {
  const c = await connect()
  if (!c) return null
  if (!entries) {
    const db = c.s.db
    entries = db.collection(cfg().entries)
    settings = db.collection(cfg().settings)
    proposals = db.collection(cfg().proposals)
    await entries.createIndex({ week: 1, person: 1 }, { unique: true })
    await proposals.createIndex({ status: 1, createdAt: -1 })
    await proposals.createIndex({ projectKey: 1 })
  }
  return { entries, settings, proposals, plans: c }
}

/** The team roster, from the shared plan. Empty when there is no plan yet. */
export async function roster() {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const doc = await c.plans.findOne({ name: cfg().scenario }, { projection: { 'payload.people': 1, 'payload.projects': 1 } })
  return {
    people: (doc?.payload?.people || []).map((p) => ({
      id: p.id, nick: p.nick || p.name || p.id, name: p.name || p.nick || p.id, scorecard: p.scorecard, role: p.role,
      // The names this person goes by in Jira, for finding their account there.
      jiraNames: Array.isArray(p.jiraNames) && p.jiraNames.length ? p.jiraNames : (DEFAULT_JIRA_NAMES[p.id] || []),
    })),
    projects: (doc?.payload?.projects || []).filter((p) => !p.deleted).map((p) => ({
      key: p.key, jiraKey: p.jiraKey || null, summary: p.summary || '', due: p.due || null, pic: p.pic || null,
      active: p.active === true, status: p.status || null,
      srcStatus: p.srcStatus || null, jiraStatus: p.jiraStatus || null, onHold: p.onHold || null,
    })),
  }
}

/*
 * Who has to submit.
 *
 * Stored once an administrator has said; until then, everybody with a
 * scorecard — worked out from the roster each time, so a person added to the
 * plan is on the list without anybody remembering to tick them.
 */
export async function getSettings() {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const doc = await c.settings.findOne({ _id: 'settings' })
  const r = await roster()
  const people = r === UNAVAILABLE ? [] : r.people
  const known = new Set(people.map((p) => p.id))
  const chosen = Array.isArray(doc?.submitters)
  return {
    submitters: chosen ? doc.submitters.filter((id) => known.has(id)) : defaultSubmitters(people),
    isDefault: !chosen,
    /*
     * Who gets the 23:00 list of who is still missing. Null until somebody
     * sets it, which means the administrators. May hold any address, not only
     * accounts here — a manager who never opens the app can still be told.
     */
    escalation: Array.isArray(doc?.escalation) ? doc.escalation : null,
    // The reminders can be paused without touching anything else.
    remindersOn: doc?.remindersOn !== false,
    // Off: each reminder goes once, at its deadline, instead of every hour.
    hourlyOn: doc?.hourlyOn !== false,
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || null,
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Change any of: who submits, who gets the 23:00 list, whether reminders go out, whether they repeat hourly. */
export async function saveSettings({ submitters, escalation, remindersOn, hourlyOn }, by) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const set = { updatedAt: new Date().toISOString(), updatedBy: by || 'admin' }
  if (submitters !== undefined) {
    if (!Array.isArray(submitters)) return { error: 'submitters must be a list of people.' }
    const r = await roster()
    const known = new Set((r === UNAVAILABLE ? [] : r.people).map((p) => p.id))
    const bad = submitters.filter((id) => !known.has(id))
    if (bad.length) return { error: `Not on the team: ${bad.join(', ')}.` }
    set.submitters = [...new Set(submitters)]
  }
  if (escalation !== undefined) {
    if (escalation !== null && !Array.isArray(escalation)) return { error: 'escalation must be a list of addresses.' }
    if (escalation) {
      const list = [...new Set(escalation.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))]
      const bad = list.filter((e) => !EMAIL.test(e))
      if (bad.length) return { error: `Not an email address: ${bad.join(', ')}.` }
      if (list.length > 20) return { error: 'Twenty addresses at most.' }
      set.escalation = list
    } else set.escalation = null
  }
  if (remindersOn !== undefined) set.remindersOn = remindersOn !== false
  if (hourlyOn !== undefined) set.hourlyOn = hourlyOn !== false
  await c.settings.updateOne({ _id: 'settings' }, { $set: set }, { upsert: true })
  return getSettings()
}

const strip = ({ _id, ...rest }) => rest

/** Every entry for one week, keyed by person. */
export async function entriesFor(week) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const rows = await c.entries.find({ week }).toArray()
  return Object.fromEntries(rows.map((r) => [r.person, strip(r)]))
}

export async function entry(week, person) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const doc = await c.entries.findOne({ week, person })
  return doc ? strip(doc) : null
}

/*
 * Somebody's week as they should first see it: what they saved, or — for a
 * week they have not touched — a draft holding last week's unfinished work.
 * The draft is not stored until they save it, so opening the page writes
 * nothing.
 */
export async function entryOrDraft(week, person) {
  const saved = await entry(week, person)
  if (saved === UNAVAILABLE || saved) return saved
  const prevWeek = addWeeks(week, -1)
  const prev = await entry(prevWeek, person)
  if (prev === UNAVAILABLE) return UNAVAILABLE
  return {
    week,
    person,
    draft: true,
    focus: '',
    tasks: carryOver(prev, prevWeek),
    unplanned: [],
    planSubmittedAt: null,
    reportSubmittedAt: null,
  }
}

/**
 * Save somebody's week, and optionally submit one half of it.
 *
 * `submit` is 'plan', 'report' or nothing. The FIRST submission time is the
 * one kept: editing afterwards — allowed until the week locks — must not turn
 * an on-time plan into a late one, and must not let a late one be re-dated
 * either.
 */
export async function save(week, person, body, by) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const clean = cleanEntry(body)
  const submit = body?.submit
  if (submit && !['plan', 'report'].includes(submit)) return { error: 'Unknown submission.' }

  const prior = await c.entries.findOne({ week, person })
  // A week run from Jira is planned and reported task by task, in Jira; the
  // Monday form's rules do not apply to it.
  const fromJira = prior?.mode === 'jira'
  // A plan being submitted, or one already in — once it is in it stays a
  // complete plan, so later edits cannot hollow it out. A report sent before
  // any plan was submitted needs a complete plan too: it reports on one.
  if (!fromJira && (submit || prior?.planSubmittedAt)) {
    const problems = planProblems(clean)
    if (problems.length) return { error: 'The plan is not complete yet.', problems }
  }
  if (!fromJira && (submit === 'report' || prior?.reportSubmittedAt)) {
    const problems = reportProblems(clean)
    if (problems.length) return { error: 'The report is not complete yet.', problems }
  }

  const now = new Date().toISOString()
  const set = {
    ...clean,
    week,
    person,
    updatedAt: now,
    updatedBy: by,
  }
  if (!prior?.planSubmittedAt && (submit === 'plan' || submit === 'report')) {
    // A report sent without a separate plan submission still means the plan
    // was in by then — it was, it is on the same page.
    set.planSubmittedAt = now
    set.planSubmittedBy = by
  }
  if (submit === 'report' && !prior?.reportSubmittedAt) {
    set.reportSubmittedAt = now
    set.reportSubmittedBy = by
  }
  await c.entries.updateOne({ week, person }, { $set: set, $setOnInsert: { createdAt: now } }, { upsert: true })
  const saved = strip(await c.entries.findOne({ week, person }))
  // A report that is in raises, updates or withdraws its date proposals. A
  // draft raises nothing: nobody is asked to approve a half-written report.
  const raised = saved.reportSubmittedAt ? await syncProposals(week, person, saved) : []
  // `raised`: proposals that are newly waiting, so the caller can tell the
  // administrators. Not sent from here — this module only keeps the record.
  return { entry: saved, raised: Array.isArray(raised) ? raised : [] }
}

/*
 * ONE JIRA TASK INTO SOMEBODY'S WEEK.
 *
 * A week run from Jira is still a week here: the dashboard, the reminders, the
 * summary and the Excel sheet all read this collection. So each Jira task the
 * member plans or reports on is kept as a task of their week, by a stable id
 * from its key, and replaced whole each time.
 *
 * `plan`: the week's plan counts as in (first time only). `report`: the
 * report counts as in (first time only) — the caller decides when every task
 * of the week has been reported on.
 */
export async function mirrorTasks(week, person, tasks, { by, plan = false, report = false } = {}) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const prior = await c.entries.findOne({ week, person })
  const byId = new Map((prior?.tasks || []).map((t) => [t.id, t]))
  for (const t of tasks) {
    const clean = cleanEntry({ tasks: [{ ...byId.get(t.id), ...t, source: 'jira' }] }).tasks[0]
    if (clean) byId.set(clean.id, clean)
  }
  const now = new Date().toISOString()
  const set = {
    week, person, mode: 'jira', tasks: [...byId.values()], updatedAt: now, updatedBy: by,
  }
  if (plan && !prior?.planSubmittedAt) { set.planSubmittedAt = now; set.planSubmittedBy = by }
  if (report && !prior?.reportSubmittedAt) { set.reportSubmittedAt = now; set.reportSubmittedBy = by }
  await c.entries.updateOne(
    { week, person },
    { $set: set, $setOnInsert: { createdAt: now, focus: '', unplanned: [] } },
    { upsert: true },
  )
  return strip(await c.entries.findOne({ week, person }))
}

/** The id a Jira task is kept under in a week: its key, letters and digits only. */
export const jiraTaskId = (key) => `j${String(key || '').replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 40)

/** Where one person stands on one week, for the team list and (later) the reminders. */
export function standing(week, e, now = Date.now()) {
  const d = deadlines(week)
  return {
    plan: stageStatus(e?.planSubmittedAt, d.planDue, now),
    report: stageStatus(e?.reportSubmittedAt, d.reportDue, now),
  }
}

/* ------------------------------------------------------------ proposals */

/*
 * A SLIPPED TASK ASKS TO MOVE ITS PROJECT.
 *
 * Kept in a collection of its own, one document per task per week, so the
 * list of what is waiting for a decision is a query rather than a walk through
 * every week anybody ever submitted.
 *
 *   pending    waiting for an administrator
 *   approved   the project's due date was moved (and written to Jira)
 *   rejected   left where it was, with the reason
 *   withdrawn  the member changed the report so it no longer asks
 *
 * A decided proposal is the record and is not rewritten by later edits —
 * unless the member then gives a DIFFERENT date, which is a new question and
 * goes back to pending, keeping the earlier decision in `earlier`.
 */
const projectsOf = async () => {
  const r = await roster()
  return r === UNAVAILABLE ? [] : r.projects
}

export async function syncProposals(week, person, entry) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const byKey = Object.fromEntries((await projectsOf()).map((p) => [p.key, p]))
  const now = new Date().toISOString()
  const live = new Set()
  const raised = []
  for (const t of entry.tasks || []) {
    const q = proposalFor(t, byKey[t.projectKey])
    const _id = proposalId(week, person, t.id)
    const prior = await c.proposals.findOne({ _id })
    if (!q) {
      if (prior?.status === 'pending') {
        await c.proposals.updateOne({ _id }, { $set: { status: 'withdrawn', updatedAt: now } })
      }
      continue
    }
    live.add(_id)
    const p = byKey[t.projectKey]
    const fields = {
      week,
      person,
      taskId: t.id,
      taskTitle: t.title,
      projectKey: t.projectKey,
      epicKey: p.jiraKey ? String(p.jiraKey).trim().toUpperCase() : null,
      jiraTaskKey: t.jiraKey || null,
      newDate: t.newDate,
      ...q,
      blocker: t.blocker,
      blockerCategory: t.blockerCategory,
      pct: t.pct,
      updatedAt: now,
    }
    if (!prior || prior.status === 'withdrawn') {
      await c.proposals.replaceOne({ _id }, { _id, ...fields, status: 'pending', createdAt: now }, { upsert: true })
      raised.push(_id)
    } else if (prior.status === 'pending') {
      await c.proposals.updateOne({ _id }, { $set: fields })
    } else if (prior.newDate !== t.newDate && ['approved', 'rejected'].includes(prior.status)) {
      const earlier = {
        status: prior.status, newDate: prior.newDate, decidedAt: prior.decidedAt, decidedBy: prior.decidedBy,
        decidedDue: prior.decidedDue || null, fromDue: prior.fromDue || null, reason: prior.reason || null,
      }
      await c.proposals.updateOne({ _id }, {
        $set: { ...fields, status: 'pending', createdAt: now },
        $unset: { decidedAt: '', decidedBy: '', decidedDue: '', reason: '', fromDue: '', jira: '' },
        $push: { earlier },
      })
      raised.push(_id)
    }
  }
  // A task taken out of the report takes its pending proposal with it.
  await c.proposals.updateMany(
    { week, person, status: 'pending', _id: { $nin: [...live] } },
    { $set: { status: 'withdrawn', updatedAt: now } },
  )
  return raised.length ? c.proposals.find({ _id: { $in: raised } }).toArray() : []
}

/** Proposals, newest first. `person` limits them to one member's own. */
export async function listProposals({ status, person, week, projectKeys } = {}) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const q = {}
  if (status && status !== 'all') q.status = status
  else q.status = { $ne: 'withdrawn' }
  if (person) q.person = person
  if (week) q.week = week
  if (projectKeys) q.projectKey = { $in: projectKeys }
  return c.proposals.find(q).sort({ createdAt: -1 }).limit(300).toArray()
}

const jiraWritable = () => String(process.env.JIRA_ALLOW_WRITES || '').toLowerCase() === 'true'
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))

/*
 * APPROVE: MOVE THE PROJECT, AND JIRA WITH IT.
 *
 * In this order, and stopping at the first thing that fails:
 *
 *   1. claim the proposal, so two administrators clicking at once cannot
 *      both move the project;
 *   2. write the new due date to the project's Jira epic. FIRST, because the
 *      07:00 sync copies the epic's due date into the plan every morning — a
 *      date approved here and not in Jira would be quietly undone tomorrow.
 *      So if Jira is connected but this server may not write to it, or Jira
 *      refuses, nothing is changed and the administrator is told why;
 *   3. move the project in the shared plan through replanPatch, the same door
 *      every other date change uses: the first re-plan is free, later ones
 *      count as drift. Every register line on the same epic moves together,
 *      as they do on the Timeline.
 *
 * A project with no epic, or a server with no Jira at all, has nothing for a
 * sync to undo, so step 2 is skipped.
 */
export async function approve(id, { due } = {}, by) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const p = await c.proposals.findOne({ _id: id })
  if (!p) return { status: 404, error: 'No such proposal.' }
  if (p.status !== 'pending') return { status: 409, error: `That proposal is already ${p.status}.` }
  const date = due || p.proposedDue
  if (!isDay(date)) return { status: 400, error: 'Pick the new due date for the project.' }

  const name = cfg().scenario
  const doc = await store.getScenario(name)
  if (doc === store.UNAVAILABLE) return UNAVAILABLE
  const projects = doc?.payload?.projects || []
  const target = projects.find((x) => x.key === p.projectKey && !x.deleted)
  if (!target) return { status: 409, error: `${p.projectKey} is no longer in the register.` }
  const epic = String(target.jiraKey || '').trim().toUpperCase()
  const keys = new Set(projects
    .filter((x) => !x.deleted && (x.key === target.key || (epic && String(x.jiraKey || '').trim().toUpperCase() === epic)))
    .map((x) => x.key))

  const claim = await c.proposals.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'deciding' } })
  if (!claim.modifiedCount) return { status: 409, error: 'Somebody else is deciding on that proposal right now.' }
  const release = () => c.proposals.updateOne({ _id: id, status: 'deciding' }, { $set: { status: 'pending' } })

  let jiraResult = null
  try {
    if (JIRA_KEY.test(epic) && jira.status().configured) {
      if (!jiraWritable()) {
        await release()
        return {
          status: 409,
          error: `Not approved: ${epic} is in Jira, and this server is not allowed to write to Jira, so the 07:00 sync `
            + 'would put the old date back tomorrow. Set JIRA_ALLOW_WRITES=true in the Render dashboard, then approve again.',
        }
      }
      try {
        const r = await jira.updateIssue(epic, { due: date })
        if (r === jira.UNAVAILABLE) throw new Error('Jira is not configured.')
        jiraResult = { key: epic, written: true }
      } catch (e) {
        await release()
        return { status: 502, error: `Not approved: Jira refused the new date for ${epic} — ${e.message}. Nothing was changed.` }
      }
    } else if (JIRA_KEY.test(epic)) {
      jiraResult = { key: epic, written: false, why: 'Jira is not connected to this server.' }
    }

    const next = repairState({
      ...doc.payload,
      projects: projects.map((x) => (keys.has(x.key) ? { ...x, ...replanPatch(x, date) } : x)),
    })
    const saved = await store.saveScenario(name, next, `Weekly approval (${by})`)
    if (saved === store.UNAVAILABLE) { await release(); return UNAVAILABLE }

    const changed = next.projects.filter((x) => keys.has(x.key))
      .map((x) => ({ key: x.key, due: x.due ?? null, baselineDue: x.baselineDue ?? null, replanCount: x.replanCount ?? 0 }))
    const now = new Date().toISOString()
    await c.proposals.updateOne({ _id: id }, {
      $set: {
        status: 'approved', decidedAt: now, decidedBy: by, decidedDue: date, fromDue: target.due || null, jira: jiraResult,
        replanCount: changed.find((x) => x.key === target.key)?.replanCount ?? null,
      },
    })
    return { proposal: await c.proposals.findOne({ _id: id }), projects: changed, savedAt: saved.updatedAt }
  } catch (e) {
    await release()
    throw e
  }
}

/** Reject: the project stays where it is, and the member is told why. */
export async function reject(id, { reason } = {}, by) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const why = String(reason || '').trim().slice(0, 1000)
  if (why.length < 3) return { status: 400, error: 'Say why, so the member knows what to do instead.' }
  const r = await c.proposals.updateOne(
    { _id: id, status: 'pending' },
    { $set: { status: 'rejected', reason: why, decidedAt: new Date().toISOString(), decidedBy: by } },
  )
  if (!r.matchedCount) {
    const p = await c.proposals.findOne({ _id: id })
    return p ? { status: 409, error: `That proposal is already ${p.status}.` } : { status: 404, error: 'No such proposal.' }
  }
  return { proposal: await c.proposals.findOne({ _id: id }) }
}

/*
 * THE WEEKLY STORY OF EACH PROJECT, for the Timeline.
 *
 * The last eight weeks of tasks linked to a project, the proposals on it, and
 * its open blockers — a task not finished in the latest report that mentions
 * it. `person` limits everything to one member's own weeks: a team member sees
 * their own work on the Timeline, never a colleague's blockers.
 */
export async function byProject({ person } = {}) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const since = addWeeks(weekOf(), -8)
  const q = { week: { $gte: since } }
  if (person) q.person = person
  const rows = await c.entries.find(q).sort({ week: -1 }).toArray()
  const props = await listProposals({ person, status: 'all' })
  if (props === UNAVAILABLE) return UNAVAILABLE
  const out = {}
  const slot = (k) => { out[k] = out[k] || { history: [], blockers: [], proposals: [] }; return out[k] }
  const latestReport = {}
  const latestTask = new Set()
  for (const e of rows) {
    for (const t of e.tasks || []) {
      if (!t.projectKey) continue
      // An update sent on a Jira task (the weekly update), rather than a form row.
      // A task only planned into a week ("My plan is set") has no answer yet:
      // it is not an update, and must not hide the task's last real one.
      const sent = !!t.reportedAt || (t.source === 'jira' && t.done != null)
      slot(t.projectKey).history.push({
        week: e.week, person: e.person, title: t.title, done: t.done, pct: t.pct, expected: t.expected,
        newDate: t.newDate, blocker: t.blocker || '', blockerCategory: t.blockerCategory, priority: t.priority,
        affects: t.affects, carriedFrom: t.carriedFrom || null,
        // What the member wrote, and whether they put it on hold.
        progress: t.progress || '', reason: t.reason || '', hold: !!t.hold, jiraKey: t.jiraKey || null,
        reportedAt: t.reportedAt || null,
        updatedAt: t.reportedAt || e.updatedAt || null,
        planIn: !!e.planSubmittedAt, reportIn: !!e.reportSubmittedAt || sent,
      })
      /*
       * WHAT IS IN THE WAY NOW. A task updated from Jira: its latest update,
       * whether or not the whole week's report is in (in the Jira flow that
       * waits for every task) — an older week's blocker on it is history, not
       * news. A form row: the latest REPORTED week per person and project, as
       * before. Work put on hold is not "in the way".
       */
      if (sent && t.jiraKey) {
        const k = `${t.jiraKey}|${e.person}`
        if (latestTask.has(k)) continue
        latestTask.add(k)
        const why = t.blocker && !/^on hold$/i.test(String(t.blocker).trim()) ? t.blocker : (t.reason || '')
        if (t.done === false && !t.hold && why) {
          slot(t.projectKey).blockers.push({
            week: e.week, person: e.person, title: t.title, blocker: why, blockerCategory: t.blockerCategory, newDate: t.newDate,
          })
        }
        continue
      }
      if (e.reportSubmittedAt) {
        const k = `${t.projectKey}|${e.person}`
        if (!(k in latestReport) || latestReport[k] === e.week) {
          latestReport[k] = e.week
          if (t.done === false && !t.hold && t.blocker) {
            slot(t.projectKey).blockers.push({
              week: e.week, person: e.person, title: t.title, blocker: t.blocker, blockerCategory: t.blockerCategory, newDate: t.newDate,
            })
          }
        }
      }
    }
  }
  for (const p of props) {
    if (p.week < since && p.status !== 'pending') continue
    slot(p.projectKey).proposals.push(p)
  }
  return out
}
