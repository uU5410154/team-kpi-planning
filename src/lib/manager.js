/**
 * WHAT THE MANAGER DASHBOARD SAYS, worked out in one place.
 *
 * Pure: the cards and the test suite call the same functions on the same
 * inputs — the plan, and the weeks as GET /api/weekly/:week answers an
 * administrator — so a figure on a card can be checked by hand.
 *
 * "Active" is worked out from the dates: a project is active in a week when
 * its timeline covers that week. An administrator can override it either way
 * on the Timeline or the project page (`active: true` / `active: false`);
 * with no override (`active` unset) the dates decide.
 */
import { weekOf, addWeeks } from './weekly.js'

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

/**
 * WHY a project is or is not active in a week (Monday, YYYY-MM-DD):
 *   'forced-on'  an administrator switched it on
 *   'forced-off' an administrator switched it off
 *   'dates'      its timeline covers the week
 *   'none'       neither — not active
 * A project deferred to next year or excluded is never active.
 */
export function activeSource(p, weekMonday = weekOf()) {
  if (!isLive(p) || OUT.has(p.commitLevel)) return 'none'
  if (p.active === true) return 'forced-on'
  if (p.active === false) return 'forced-off'
  const span = activeSpan(p)
  if (!span) return 'none'
  const sunday = addWeeks(weekMonday, 1) // the next Monday: the week is [Monday, next Monday)
  return span.from < sunday && span.to >= weekMonday ? 'dates' : 'none'
}

/** Whether a project is active in a week (Monday, YYYY-MM-DD): override first, then dates. */
export const activeInWeek = (p, weekMonday = weekOf()) => {
  const s = activeSource(p, weekMonday)
  return s === 'forced-on' || s === 'dates'
}

/** Active in the given week; this week when none is given. */
export const isActive = (p, weekMonday) => activeInWeek(p, weekMonday || weekOf())

/** Active this week, and everything on the register including the inactive. */
export function projectCounts(projects = [], weekMonday = weekOf()) {
  const live = projects.filter(isLive)
  const on = live.filter((p) => isActive(p, weekMonday))
  return {
    total: live.length,
    active: on.length,
    forced: on.filter((p) => p.active === true).length,
    byDates: on.filter((p) => p.active !== true).length,
  }
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

/** How many ACTIVE projects have a task on them in this week's check-ins. */
export function updatedCount(projects, week) {
  const by = tasksByProject(week)
  const active = projects.filter((p) => isActive(p, week?.week))
  return { updated: active.filter((p) => by[p.key]?.length).length, active: active.length }
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
      // Done in Jira, or what they said; nothing said reads as no answer.
      done: t.done ? true : t.update ? t.update.done === true : null,
      hold: !t.done && (!!t.update?.hold || /hold/i.test(t.status || '')),
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
  projects = [], people = [], now = null, prev = null, followups = [], prevJira = null,
}) {
  const nick = Object.fromEntries(people.map((p) => [p.id, p.nick || p.name || p.id]))
  const thisWeek = tasksByProject(now)
  const lastWeek = prevJira ? lastWeekFromJira(prevJira, prev) : tasksByProject(prev)
  const asked = {}
  for (const f of followups) if (!asked[f.projectKey] || f.sentAt > asked[f.projectKey].sentAt) asked[f.projectKey] = f
  const groups = {}
  for (const p of projects.filter((x) => isActive(x, now?.week))) {
    const owner = p.pic || null
    const g = groups[owner || ''] = groups[owner || ''] || {
      person: owner, nick: owner ? (nick[owner] || owner) : 'No owner', projects: [],
    }
    const tw = thisWeek[p.key] || []
    const lw = lastWeek[p.key] || []
    g.projects.push({
      key: p.key,
      jiraKey: p.jiraKey || null,
      summary: p.summary || '',
      due: p.due || null,
      status: p.status || null,
      thisWeek: tw,
      lastWeek: lw,
      latest: latestOf([...tw, ...lw]),
      followup: asked[p.key] || null,
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
  projects = [], asOf, weeks = [], pending = [],
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
  for (const p of projects.filter((x) => isActive(x, thisWeek))) {
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
export function workload({ projects = [], people = [], week = null, submitters = null }) {
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
      active: projects.filter((p) => isActive(p, week?.week) && p.pic === id).length,
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
