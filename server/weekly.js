import { connect, UNAVAILABLE } from './db.js'
import {
  cleanEntry, planProblems, reportProblems, carryOver, addWeeks, deadlines, stageStatus,
  defaultSubmitters,
} from '../src/lib/weekly.js'

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
  // The plan whose roster says who the team is. The same one the Jira sync
  // writes to, for the same reason: there is one shared plan.
  scenario: process.env.JIRA_SYNC_SCENARIO || 'Baseline',
})

let entries = null
let settings = null
async function colls() {
  const c = await connect()
  if (!c) return null
  if (!entries) {
    const db = c.s.db
    entries = db.collection(cfg().entries)
    settings = db.collection(cfg().settings)
    await entries.createIndex({ week: 1, person: 1 }, { unique: true })
  }
  return { entries, settings, plans: c }
}

/** The team roster, from the shared plan. Empty when there is no plan yet. */
export async function roster() {
  const c = await colls()
  if (!c) return UNAVAILABLE
  const doc = await c.plans.findOne({ name: cfg().scenario }, { projection: { 'payload.people': 1, 'payload.projects': 1 } })
  return {
    people: (doc?.payload?.people || []).map((p) => ({
      id: p.id, nick: p.nick || p.name || p.id, name: p.name || p.nick || p.id, scorecard: p.scorecard, role: p.role,
    })),
    projects: (doc?.payload?.projects || []).filter((p) => !p.deleted).map((p) => ({
      key: p.key, jiraKey: p.jiraKey || null, summary: p.summary || '', due: p.due || null, pic: p.pic || null,
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
    updatedAt: doc?.updatedAt || null,
    updatedBy: doc?.updatedBy || null,
  }
}

export async function saveSettings({ submitters }, by) {
  const c = await colls()
  if (!c) return UNAVAILABLE
  if (!Array.isArray(submitters)) return { error: 'submitters must be a list of people.' }
  const r = await roster()
  const known = new Set((r === UNAVAILABLE ? [] : r.people).map((p) => p.id))
  const bad = submitters.filter((id) => !known.has(id))
  if (bad.length) return { error: `Not on the team: ${bad.join(', ')}.` }
  const set = { submitters: [...new Set(submitters)], updatedAt: new Date().toISOString(), updatedBy: by || 'admin' }
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
  // A plan being submitted, or one already in — once it is in it stays a
  // complete plan, so later edits cannot hollow it out. A report sent before
  // any plan was submitted needs a complete plan too: it reports on one.
  if (submit || prior?.planSubmittedAt) {
    const problems = planProblems(clean)
    if (problems.length) return { error: 'The plan is not complete yet.', problems }
  }
  if (submit === 'report' || prior?.reportSubmittedAt) {
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
  return { entry: strip(await c.entries.findOne({ week, person })) }
}

/** Where one person stands on one week, for the team list and (later) the reminders. */
export function standing(week, e, now = Date.now()) {
  const d = deadlines(week)
  return {
    plan: stageStatus(e?.planSubmittedAt, d.planDue, now),
    report: stageStatus(e?.reportSubmittedAt, d.reportDue, now),
  }
}
