/**
 * WHAT THE MANAGER DASHBOARD SAYS, worked out in one place.
 *
 * Pure: the cards and the test suite call the same functions on the same
 * inputs — the plan, and the weeks as GET /api/weekly/:week answers an
 * administrator — so a figure on a card can be checked by hand.
 *
 * "Active" is automatic: a project is active in a week when its timeline
 * covers that week, or Jira work under it does, or somebody sent an update on
 * it that week, or a decision on it is still open (see activeSource). An
 * administrator can override it either way on the Timeline or the project
 * page (`active: true` / `active: false`); with no override (`active` unset)
 * the dates and the work decide.
 */
import { weekOf, addWeeks } from './weekly.js'
import { projectOnHold } from './hold.js'

export const isLive = (p) => !!p && !p.deleted

const DAY = /^\d{4}-\d{2}-\d{2}$/
const d = (v) => (typeof v === 'string' && DAY.test(v.slice(0, 10)) ? v.slice(0, 10) : null)
const OUT = new Set(['nextyear', 'excluded'])

/**
 * The stretch of calendar a project's timeline covers, or null without dates.
 *
 * From the planned start (or the actual start, if earlier or the only one)
 * to the planned end — or later, where the work now lands after it — and no
 * further than the day it actually finished. A project with a single date
 * covers that day only. A project marked Done with no finish date recorded
 * covers nothing: it is over, and when is unknown.
 */
export function activeSpan(p) {
  if (!p) return null
  const start0 = [d(p.start), d(p.actualStart)].filter(Boolean).sort()[0] || null
  const planned = [d(p.due), d(p.adjustedDue)].filter(Boolean).sort().pop() || null
  const finished = d(p.actualEnd)
  if (!finished && p.status === 'Done') return null
  let end = finished || planned
  const start = start0 || end
  if (!start) return null
  if (!end) end = start
  if (finished && finished < end) end = finished
  return end < start ? { from: start, to: start } : { from: start, to: end }
}

/*
 * WHAT ELSE SAYS A PROJECT IS BEING WORKED ON IN A WEEK, beside its dates.
 *
 * The register's dates are often a quarter out of step with the work: a
 * project whose due date passed in September can have three people updating
 * it this week. So "Automatic" listens to the work as well as the dates — a
 * project is active in a week when
 *
 *   'dates'     its own start-to-due dates cover the week, or
 *   'jira'      an epic or task under it in Jira has a timeline covering it, or
 *   'update'    somebody sent an update on it that week, or
 *   'decision'  a decision asked for on one of its tasks is still open.
 *
 * `signals` carries the last three as Sets of register keys (see
 * activitySignals). An administrator's Always / Never sits on top of all four.
 */
export const ACTIVE_WHY = {
  'forced-on': 'switched on by an administrator',
  'forced-off': 'switched off by an administrator',
  dates: 'by dates',
  jira: 'has Jira work this week',
  update: 'has an update',
  decision: 'has an open decision',
  none: 'nothing this week',
}

/**
 * WHY a project is or is not active in a week (Monday, YYYY-MM-DD):
 *   'forced-on' / 'forced-off'  an administrator overrode it
 *   'dates' | 'jira' | 'update' | 'decision'  automatic, and which said so first
 *   'none'       nothing says it is — not active
 * A project deferred to next year or excluded is never active.
 */
export function activeSource(p, weekMonday = weekOf(), signals = null) {
  if (!isLive(p) || OUT.has(p.commitLevel)) return 'none'
  if (p.active === true) return 'forced-on'
  if (p.active === false) return 'forced-off'
  const span = activeSpan(p)
  const sunday = addWeeks(weekMonday, 1) // the next Monday: the week is [Monday, next Monday)
  if (span && span.from < sunday && span.to >= weekMonday) return 'dates'
  if (signals?.jira?.has(p.key)) return 'jira'
  if (signals?.updated?.has(p.key)) return 'update'
  if (signals?.decisions?.has(p.key)) return 'decision'
  return 'none'
}

const ON = new Set(['forced-on', 'dates', 'jira', 'update', 'decision'])

/** Whether a project is active in a week: an override first, then its dates and its work. */
export const activeInWeek = (p, weekMonday = weekOf(), signals = null) => ON.has(activeSource(p, weekMonday, signals))

/** Active in the given week; this week when none is given. */
export const isActive = (p, weekMonday, signals = null) => activeInWeek(p, weekMonday || weekOf(), signals)

/** Every register line on the same Jira epic as each key: one piece of work. */
function linesByEpic(projects = []) {
  const byEpic = {}
  for (const p of projects.filter(isLive)) {
    const k = String(p.jiraKey || '').trim().toUpperCase()
    if (k) (byEpic[k] = byEpic[k] || []).push(p.key)
  }
  const out = {}
  for (const p of projects.filter(isLive)) {
    const k = String(p.jiraKey || '').trim().toUpperCase()
    out[p.key] = k ? byEpic[k] : [p.key]
  }
  return out
}

/**
 * THE WORK THAT MAKES A PROJECT ACTIVE IN A WEEK, as Sets of register keys:
 *   jira       Jira work under it whose timeline covers the week — the
 *              GET /api/jira/coverage/:week `byProject` answer
 *   updated    a task linked to it in that week's check-ins (GET /api/weekly/:week)
 *   decisions  an open decision on one of its tasks (GET /api/decisions)
 * Each spreads to every register line on the same epic, as the Timeline draws
 * them. Anything not given (still loading, or unreadable) adds nothing.
 */
export function activitySignals({
  projects = [], week = null, jira = null, decisions = null, history = null, weekMonday = null,
}) {
  const lines = linesByEpic(projects)
  const spread = (keys) => {
    const out = new Set()
    for (const k of keys) for (const x of lines[k] || [k]) out.add(x)
    return out
  }
  const updated = Object.keys(tasksByProject(week))
  // Or, on a page without the week's answer, from the projects' weekly story.
  if (history && weekMonday) {
    for (const [k, w] of Object.entries(history)) if ((w.history || []).some((t) => t.week === weekMonday)) updated.push(k)
  }
  return {
    jira: spread(Object.entries(jira || {}).filter(([, v]) => v?.length).map(([k]) => k)),
    updated: spread(updated),
    decisions: spread((decisions || []).map((d) => d.projectKey).filter(Boolean)),
  }
}

/*
 * ONE PIECE OF WORK PER EPIC. The register may carry an epic on several lines
 * (FNP-1151 is three: it serves three objectives); the dashboard counts and
 * lists it once, as the Timeline draws it as one bar. A line with no Jira key
 * is a piece of work of its own. `p` is the first line, in register order.
 */
export function workUnits(projects = []) {
  const out = []
  const at = {}
  for (const p of projects.filter(isLive)) {
    const k = String(p.jiraKey || '').trim().toUpperCase()
    if (k && at[k]) { at[k].lines.push(p); at[k].keys.push(p.key); continue }
    const u = { key: p.key, p, lines: [p], keys: [p.key] }
    if (k) at[k] = u
    out.push(u)
  }
  return out
}

// Which reason is said first when the lines behind one bar disagree.
const ORDER = ['forced-on', 'dates', 'jira', 'update', 'decision', 'forced-off', 'none']

/**
 * Whether the work behind one bar (its register lines) is active in a week,
 * and why: active when any line is. One answer for the dashboard's tiles, its
 * "Who holds what", the Timeline and the project page.
 */
export function unitSource(lines = [], weekMonday = weekOf(), signals = null) {
  const all = lines.filter(Boolean).map((p) => activeSource(p, weekMonday, signals))
  const on = all.filter((s) => ON.has(s))
  const pick = (list) => [...list].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0]
  if (on.length) return pick(on)
  return all.length && all.every((s) => s === 'forced-off') ? 'forced-off' : 'none'
}
export const unitActive = (lines, weekMonday, signals) => ON.has(unitSource(lines, weekMonday, signals))

/** The active pieces of work in a week. */
export const activeUnits = (projects, weekMonday = weekOf(), signals = null) => workUnits(projects)
  .map((u) => ({ ...u, source: unitSource(u.lines, weekMonday, signals) }))
  .filter((u) => ON.has(u.source))

/** Active this week, and everything on the register including the inactive — and why. */
export function projectCounts(projects = [], weekMonday = weekOf(), signals = null) {
  const units = workUnits(projects)
  const why = {}
  for (const u of units) {
    const s = unitSource(u.lines, weekMonday, signals)
    if (ON.has(s)) why[s] = (why[s] || 0) + 1
  }
  const active = Object.values(why).reduce((a, n) => a + n, 0)
  return {
    total: units.length,
    lines: projects.filter(isLive).length,
    active,
    forced: why['forced-on'] || 0,
    byDates: why.dates || 0,
    byJira: why.jira || 0,
    byUpdate: why.update || 0,
    byDecision: why.decision || 0,
  }
}

/** "4 by dates · 1 has Jira work this week · 1 switched on": the reasons, worded. */
export function activeWords(c, when = 'this week') {
  return [
    c.byDates ? `${c.byDates} by dates` : null,
    c.byJira ? `${c.byJira} ${c.byJira === 1 ? 'has' : 'have'} Jira work ${when}` : null,
    c.byUpdate ? `${c.byUpdate} ${c.byUpdate === 1 ? 'has' : 'have'} an update` : null,
    c.byDecision ? `${c.byDecision} ${c.byDecision === 1 ? 'has' : 'have'} an open decision` : null,
    c.forced ? `${c.forced} switched on` : null,
  ].filter(Boolean).join(' · ')
}

/** Each person's saved week in a week's answer. A member's own comes as `mine`. */
export function entriesOf(week) {
  if (!week) return []
  return (week.team || []).map((row) => {
    const e = row.entry || (row.person === week.person && week.mine && !week.mine.draft ? week.mine : null)
    return e ? { ...e, person: row.person, nick: row.nick, standing: row.standing || null } : null
  }).filter(Boolean)
}

/** Every task in a week, by the project it is linked to. */
export function tasksByProject(week) {
  const out = {}
  for (const e of entriesOf(week)) {
    for (const t of e.tasks || []) {
      if (!t.projectKey) continue
      ;(out[t.projectKey] = out[t.projectKey] || []).push({
        ...t, person: e.person, nick: e.nick, updatedAt: e.updatedAt || null, planIn: !!e.planSubmittedAt, reportIn: !!e.reportSubmittedAt,
      })
    }
  }
  return out
}

/** How many ACTIVE projects (pieces of work) have a task on them in this week's check-ins. */
export function updatedCount(projects, week, signals = null) {
  const by = tasksByProject(week)
  const active = activeUnits(projects, week?.week, signals)
  return { updated: active.filter((u) => u.keys.some((k) => by[k]?.length)).length, active: active.length }
}

/**
 * LAST WEEK, FROM JIRA: every epic and task under each project whose timeline
 * covered last week, whoever holds it — with what its holder said about it, if
 * they said anything. Work typed in by hand that week (no Jira key) still shows.
 */
export function lastWeekFromJira(byProject = {}, prev = null) {
  const out = {}
  for (const [pk, items] of Object.entries(byProject)) {
    out[pk] = items.map((t) => ({
      id: t.key,
      jiraKey: t.key,
      title: `${t.key} ${t.summary}`.trim(),
      person: t.assignee || '',
      nick: t.update?.nick || t.holder || t.assignee || 'Nobody assigned',
      // What they said THAT week first; failing that, Jira — whose status is
      // today's, not that week's, and is marked so (`statusToday`).
      done: t.update ? t.update.done === true : t.done ? true : null,
      hold: t.update ? !!t.update.hold : (!t.done && /hold/i.test(t.status || '')),
      statusToday: !t.update && (!!t.done || /hold/i.test(t.status || '')),
      blocker: t.update?.blocker || t.update?.reason || '',
      progress: t.update?.progress || '',
      reason: t.update?.reason || '',
      reportedAt: t.update?.submittedAt || null,
      status: t.status,
      updatedAt: t.update?.submittedAt || null,
    }))
  }
  const typed = tasksByProject(prev)
  for (const [pk, list] of Object.entries(typed)) {
    const extra = list.filter((t) => !t.jiraKey)
    if (extra.length) out[pk] = [...(out[pk] || []), ...extra]
  }
  return out
}

const latestOf = (tasks) => tasks.map((t) => t.updatedAt).filter(Boolean).sort().pop() || null

/**
 * WHO HOLDS WHICH ACTIVE PROJECT, and where each one stands: last week's
 * tasks and whether they finished, this week's, the latest update, and the
 * newest follow-up sent about it.
 */
export function ownerRows({
  projects = [], people = [], now = null, prev = null, followups = [], prevJira = null, signals = null,
}) {
  const nick = Object.fromEntries(people.map((p) => [p.id, p.nick || p.name || p.id]))
  const thisWeek = tasksByProject(now)
  const lastWeek = prevJira ? lastWeekFromJira(prevJira, prev) : tasksByProject(prev)
  const asked = {}
  for (const f of followups) if (!asked[f.projectKey] || f.sentAt > asked[f.projectKey].sentAt) asked[f.projectKey] = f
  // Every register line behind one epic, read together: one row, its tasks once.
  const gather = (by, keys) => {
    const seen = new Set()
    const out = []
    for (const k of keys) {
      for (const t of by[k] || []) {
        const id = `${t.person}.${t.jiraKey || t.id}`
        if (!seen.has(id)) { seen.add(id); out.push(t) }
      }
    }
    return out
  }
  const groups = {}
  for (const u of activeUnits(projects, now?.week, signals)) {
    const { p } = u
    const owner = p.pic || null
    const g = groups[owner || ''] = groups[owner || ''] || {
      person: owner, nick: owner ? (nick[owner] || owner) : 'No owner', projects: [],
    }
    const tw = gather(thisWeek, u.keys)
    const lw = gather(lastWeek, u.keys)
    const fu = u.keys.map((k) => asked[k]).filter(Boolean).sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0] || null
    g.projects.push({
      key: p.key,
      keys: u.keys,
      lines: u.keys.length,
      jiraKey: p.jiraKey || null,
      summary: p.summary || '',
      due: u.lines.map((x) => x.due).filter(Boolean).sort().pop() || null,
      status: p.status || null,
      // Why it is on the list: by its dates, its Jira work, an update, a decision.
      why: u.source,
      onHold: u.lines.some(projectOnHold),
      thisWeek: tw,
      lastWeek: lw,
      latest: latestOf([...tw, ...lw]),
      followup: fu,
    })
  }
  return Object.values(groups)
    .map((g) => ({ ...g, projects: g.projects.sort((a, b) => String(a.summary).localeCompare(String(b.summary))) }))
    .sort((a, b) => (a.person ? 0 : 1) - (b.person ? 0 : 1) || String(a.nick).localeCompare(String(b.nick)))
}

/**
 * The week whose report is the latest one in: this week once Friday 15:00 has
 * passed, otherwise last week.
 */
export const reportedWeek = (now, prev) => (now && now.now >= now.deadlines?.reportDue ? now : prev || now)

/** What the team is waiting on, by kind, from a reported week. */
export function blockersByType(week) {
  const out = {}
  for (const e of entriesOf(week)) {
    for (const t of e.tasks || []) {
      if (t.done !== false || !String(t.blocker || '').trim()) continue
      const k = t.blockerCategory || 'other'
      ;(out[k] = out[k] || []).push({ ...t, person: e.person, nick: e.nick })
    }
  }
  return out
}

/**
 * ACTIVE PROJECTS THAT ARE SLIPPING, and why: past due and not done; a task
 * that now lands after the project's due; a date change waiting.
 */
export function slipping({
  projects = [], asOf, weeks = [], pending = [], signals = null,
}) {
  const out = []
  const late = {}
  for (const w of weeks) {
    for (const [key, tasks] of Object.entries(tasksByProject(w))) {
      for (const t of tasks) if (t.done === false && t.newDate) late[key] = [...(late[key] || []), t]
    }
  }
  const waiting = {}
  for (const p of pending) (waiting[p.projectKey] = waiting[p.projectKey] || []).push(p)
  const thisWeek = asOf ? weekOf(Date.parse(`${asOf}T12:00:00Z`)) : weekOf()
  for (const p of projects.filter((x) => isActive(x, thisWeek, signals))) {
    const why = []
    const done = /^done$/i.test(String(p.status || ''))
    if (!done && p.due && asOf && p.due < asOf) why.push({ kind: 'pastDue', text: `past due ${p.due}` })
    const lands = (late[p.key] || []).map((t) => t.newDate).filter((d) => p.due && d > p.due).sort().pop()
    if (lands) why.push({ kind: 'lands', text: `a task now lands ${lands}` })
    if (waiting[p.key]?.length) why.push({ kind: 'waiting', text: 'date change waiting' })
    if (why.length) out.push({ key: p.key, jiraKey: p.jiraKey || null, summary: p.summary || '', pic: p.pic || null, due: p.due || null, why })
  }
  return out.sort((a, b) => b.why.length - a.why.length || String(a.due || '').localeCompare(String(b.due || '')))
}

/** Days of effort each person planned this week, and the active projects they hold. */
export function workload({
  projects = [], people = [], week = null, submitters = null, signals = null,
}) {
  const active = activeUnits(projects, week?.week, signals)
  const by = Object.fromEntries(entriesOf(week).map((e) => [e.person, e]))
  const ids = submitters || week?.submitters || people.filter((p) => p.scorecard !== false).map((p) => p.id)
  return ids.map((id) => {
    const person = people.find((p) => p.id === id)
    const e = by[id]
    const tasks = e?.tasks || []
    return {
      person: id,
      nick: person?.nick || id,
      days: tasks.reduce((a, t) => a + (Number(t.effort) || 0), 0),
      tasks: tasks.length,
      active: active.filter((u) => u.p.pic === id).length,
    }
  })
}

/** On time / late / missing, per person, over several weeks (oldest first). */
export function submissionTrend(weeks = []) {
  const order = [...weeks].filter(Boolean).sort((a, b) => a.week.localeCompare(b.week))
  const people = {}
  for (const w of order) {
    for (const row of w.team || []) {
      if (!row.required) continue
      const p = people[row.person] = people[row.person] || { person: row.person, nick: row.nick, weeks: {} }
      p.weeks[w.week] = row.standing || null
    }
  }
  const tally = (stage) => order.map((w) => {
    const rows = (w.team || []).filter((r) => r.required)
    const n = (s) => rows.filter((r) => r.standing?.[stage] === s).length
    return { week: w.week, ontime: n('ontime'), late: n('late'), missing: n('missing'), open: n('open') }
  })
  return { weeks: order.map((w) => w.week), people: Object.values(people), plan: tally('plan'), report: tally('report') }
}
