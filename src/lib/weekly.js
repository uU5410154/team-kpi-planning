/**
 * THE WEEKLY CHECK-IN: its calendar, and the rules every page and the server
 * agree on.
 *
 * Pure, and shared: the server imports this to decide what is late and what is
 * locked, and the browser imports it to say so. Written once so the two can
 * never disagree about whether 15:01 on a Friday is late.
 *
 * THE CALENDAR, all in Bangkok time (UTC+7, no daylight saving — which is why
 * a fixed offset is right here and a timezone library would be dead weight):
 *
 *   Mon 08:00  the week's plan is due: focus, tasks, dates, effort, priority
 *   Fri 15:00  the week's progress report is due
 *   Sun 15:00  the second chance for anybody who missed Friday
 *   next Mon 08:00  the week locks and becomes the record
 *
 * A week is named by its Monday, as YYYY-MM-DD. That is the key everywhere:
 * in the database, in the URL, in the page.
 */

const BKK = 7 * 3600_000
const DAY = 86400_000

/** Today's Bangkok calendar date, as YYYY-MM-DD. */
export const bangkokDay = (at = Date.now()) => new Date(Number(at) + BKK).toISOString().slice(0, 10)

/** The Monday of the week holding `at`, Bangkok time. */
export function weekOf(at = Date.now()) {
  const local = new Date(Number(at) + BKK)
  // getUTCDay on a shifted date is the Bangkok weekday. Sunday is 0 and
  // belongs to the week that started six days earlier.
  const back = (local.getUTCDay() + 6) % 7
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - back * DAY)
    .toISOString().slice(0, 10)
}

export const isWeek = (w) => /^\d{4}-\d{2}-\d{2}$/.test(String(w || ''))
  && !Number.isNaN(Date.parse(`${w}T00:00:00Z`))
  && new Date(`${w}T00:00:00Z`).getUTCDay() === 1

export const addWeeks = (week, n) =>
  new Date(Date.parse(`${week}T00:00:00Z`) + n * 7 * DAY).toISOString().slice(0, 10)

/** A Bangkok wall-clock time on a day of `week`, as epoch ms. dayOffset 0 is Monday. */
const at = (week, dayOffset, hour) => Date.parse(`${week}T00:00:00Z`) + dayOffset * DAY + hour * 3600_000 - BKK

/** Every moment that matters for one week, as epoch ms. */
export const deadlines = (week) => ({
  planDue: at(week, 0, 8),
  reportDue: at(week, 4, 15),
  secondChance: at(week, 6, 15),
  locksAt: at(week, 7, 8),
})

/** Editable until the next Monday 08:00; read-only after, for the record. */
export const isLocked = (week, now = Date.now()) => now >= deadlines(week).locksAt

/*
 * WHICH WEEKS SOMEBODY MAY WRITE.
 *
 * This week and next, and never a locked one. Next week so a plan can be
 * written on Friday afternoon while the week is fresh; no further, because a
 * plan for a month away is a wish rather than a plan, and nothing is chasing it.
 */
export function canWriteWeek(week, now = Date.now()) {
  if (!isWeek(week) || isLocked(week, now)) return false
  return week <= addWeeks(weekOf(now), 1)
}

/**
 * Where somebody stands on one half of the week.
 *
 *   open     not in yet, and not due yet
 *   missing  not in, and the deadline has passed
 *   ontime   submitted by the deadline
 *   late     submitted after it
 */
export function stageStatus(submittedAt, due, now = Date.now()) {
  if (submittedAt) return Date.parse(submittedAt) <= due ? 'ontime' : 'late'
  return now >= due ? 'missing' : 'open'
}

export const STATUS_LABEL = {
  open: 'Not due yet', missing: 'Missing', ontime: 'On time', late: 'Late',
}

/* --------------------------------------------------------------- the form */

// Must / should / nice-to-have, as agreed for the Monday plan.
export const PRIORITIES = [
  { id: 'must', label: 'Must' },
  { id: 'should', label: 'Should' },
  { id: 'nice', label: 'Nice to have' },
]

// What a blocker is waiting on, as agreed for the Friday report.
export const BLOCKER_CATEGORIES = [
  { id: 'business', label: 'Waiting on business user' },
  { id: 'it', label: 'Waiting on IT' },
  { id: 'data', label: 'Data' },
  { id: 'other', label: 'Other' },
]

const PRIORITY_IDS = PRIORITIES.map((p) => p.id)
const CATEGORY_IDS = BLOCKER_CATEGORIES.map((c) => c.id)
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`))
const text = (v, max) => String(v ?? '').replace(/\r\n/g, '\n').slice(0, max)
const keyOrNull = (v) => {
  const k = String(v || '').trim().toUpperCase()
  return /^[A-Z][A-Z0-9_]+-\d+$/.test(k) ? k : null
}
const numOrNull = (v, lo, hi) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
}
const boolOrNull = (v) => (v === true || v === false ? v : null)

export const newTaskId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/*
 * One task, cleaned. Whatever the browser sends is cut down to these fields
 * and these shapes, so a bad client cannot store something the pages, the
 * emails or the summary later choke on.
 *
 * Null is never zero: an effort nobody typed is null, not 0 days, and a task
 * nobody has reported on has `done: null`, not false.
 */
export function cleanTask(t = {}) {
  const projectKey = String(t.projectKey || '').trim().slice(0, 40) || null
  return {
    id: /^[a-z0-9]{4,40}$/i.test(String(t.id || '')) ? String(t.id) : newTaskId(),
    title: text(t.title, 300).trim(),
    // The register row it belongs to, and optionally one Jira ticket under it.
    projectKey,
    jiraKey: keyOrNull(t.jiraKey),
    expected: isDay(t.expected) ? t.expected : null,
    // Days, in halves: the unit the register's mandays are kept in.
    effort: numOrNull(t.effort, 0, 99),
    priority: PRIORITY_IDS.includes(t.priority) ? t.priority : null,
    carriedFrom: isWeek(t.carriedFrom) ? t.carriedFrom : null,
    // ---- Friday
    done: boolOrNull(t.done),
    pct: numOrNull(t.pct, 0, 100),
    blocker: text(t.blocker, 2000),
    blockerCategory: CATEGORY_IDS.includes(t.blockerCategory) ? t.blockerCategory : null,
    newDate: isDay(t.newDate) ? t.newDate : null,
    // The member's own answer to "does this push the project's deadline?".
    affects: boolOrNull(t.affects),
    /*
     * A task that came from Jira and was reported on card by card: what was
     * done this week, why it is not finished, and whether a decision is
     * needed. Kept through an ordinary save, so saving the week's adhoc work
     * does not wipe them.
     */
    source: t.source === 'jira' ? 'jira' : null,
    progress: text(t.progress, 4000),
    reason: text(t.reason, 2000),
    // Stopped on purpose: a kind of not finished.
    hold: t.hold === true,
    decision: t.decision === true,
    decisionText: text(t.decisionText, 2000),
    start: isDay(t.start) ? t.start : null,
    reportedAt: typeof t.reportedAt === 'string' && !Number.isNaN(Date.parse(t.reportedAt)) ? t.reportedAt : null,
    attachments: (Array.isArray(t.attachments) ? t.attachments : []).slice(0, 10).map((x) => text(x, 200)).filter(Boolean),
  }
}

/** Work done this week that was not in Monday's plan. */
export function cleanUnplanned(u = {}) {
  return {
    id: /^[a-z0-9]{4,40}$/i.test(String(u.id || '')) ? String(u.id) : newTaskId(),
    title: text(u.title, 300).trim(),
    projectKey: String(u.projectKey || '').trim().slice(0, 40) || null,
    effort: numOrNull(u.effort, 0, 99),
  }
}

export function cleanEntry(body = {}) {
  return {
    focus: text(body.focus, 2000),
    tasks: (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 40).map(cleanTask)
      // A row with no title is a row somebody added and never filled in.
      .filter((t) => t.title),
    unplanned: (Array.isArray(body.unplanned) ? body.unplanned : []).slice(0, 40).map(cleanUnplanned)
      .filter((u) => u.title),
  }
}

/*
 * WHAT HAS TO BE THERE BEFORE SOMETHING COUNTS AS SUBMITTED.
 *
 * Saving a draft asks for nothing — half a plan saved is better than a whole
 * one lost to a closed tab. Submitting is the promise, so it is checked.
 * Returns a list of problems in plain words; empty means it may go in.
 */
export function planProblems(entry) {
  const out = []
  if (!entry.focus.trim()) out.push('Write a line or two on what this week is focused on.')
  if (!entry.tasks.length) out.push('Add at least one task.')
  entry.tasks.forEach((t, i) => {
    const n = `Task ${i + 1}${t.title ? ` (“${t.title.slice(0, 40)}”)` : ''}`
    if (!t.expected) out.push(`${n}: when do you expect to finish it?`)
    if (t.effort === null) out.push(`${n}: how many days of effort this week?`)
    if (!t.priority) out.push(`${n}: pick a priority.`)
  })
  return out
}

export function reportProblems(entry) {
  const out = []
  entry.tasks.forEach((t, i) => {
    const n = `Task ${i + 1}${t.title ? ` (“${t.title.slice(0, 40)}”)` : ''}`
    if (t.done === null) { out.push(`${n}: finished or not?`); return }
    if (t.done) return
    if (t.pct === null) out.push(`${n}: roughly how far along is it?`)
    if (!t.blocker.trim()) out.push(`${n}: what is blocking it?`)
    if (!t.blockerCategory) out.push(`${n}: what is the blocker waiting on?`)
    if (!t.newDate) out.push(`${n}: what is the new expected date?`)
    if (t.affects === null) out.push(`${n}: does it push the project's deadline?`)
  })
  return out
}

/*
 * DOES A SLIP REACH THE PROJECT?
 *
 * Both ways, as agreed: the dates are compared, and the member is asked, and
 * where the two disagree the manager is told rather than either being trusted
 * over the other.
 *
 *   byDate    days the new date lands after the project's committed due, or
 *             null when it does not (or there is no project or no date)
 *   says      the member's answer, true / false / null
 *   disagree  the dates and the member point different ways
 */
export function slipImpact(task, projectDue) {
  if (!task || task.done !== false || !task.newDate) return { byDate: null, says: task?.affects ?? null, disagree: false }
  let byDate = null
  if (projectDue && isDay(projectDue) && task.newDate > projectDue) {
    byDate = Math.round((Date.parse(`${task.newDate}T00:00:00Z`) - Date.parse(`${projectDue}T00:00:00Z`)) / DAY)
  }
  const says = task.affects
  const disagree = says !== null && !!projectDue && (byDate !== null) !== says
  return { byDate, says, disagree }
}

/*
 * WHEN A SLIP BECOMES A PROPOSAL.
 *
 * A task reported not finished, on a project, with a new date — and EITHER
 * that date lands after the project's committed due date, OR the member says
 * it pushes the deadline. Both ways in, as agreed: the dates are not trusted
 * over the member, nor the member over the dates.
 *
 * The date proposed for the PROJECT is the task's new date when that is past
 * the project's due. When the member says it pushes the deadline but their
 * date still falls inside it, there is no honest date to propose — moving the
 * project to the task's date would move it EARLIER — so `proposedDue` is null
 * and the administrator who approves it picks the date.
 *
 * Returns null when the task does not make a proposal.
 */
export function proposalFor(task, project) {
  if (!task || task.done !== false || !task.projectKey || !task.newDate || !project) return null
  const due = isDay(project.due) ? project.due : null
  const late = !due || task.newDate > due
  if (!(due && task.newDate > due) && task.affects !== true) return null
  const impact = slipImpact(task, due)
  return {
    proposedDue: late ? task.newDate : null,
    currentDue: due,
    byDate: impact.byDate,
    says: task.affects,
    disagree: impact.disagree,
  }
}

/** One proposal per task per week: the same task re-saved updates it. */
export const proposalId = (week, person, taskId) => `${week}.${person}.${taskId}`

export const PROPOSAL_LABEL = {
  pending: 'Waiting for approval', approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn',
}

/*
 * MONDAY OPENS WITH LAST WEEK'S UNFINISHED WORK.
 *
 * Carried, not copied: the report fields are wiped, the expected date becomes
 * the new date the member gave on Friday, and the task remembers which week
 * it came from so a thing carried four weeks running is visible as exactly
 * that. A task last week never got a report on is carried too — nobody said
 * it was done.
 */
export function carryOver(previous, fromWeek) {
  return (previous?.tasks || [])
    .filter((t) => t.done !== true)
    .map((t) => cleanTask({
      id: newTaskId(),
      title: t.title,
      projectKey: t.projectKey,
      jiraKey: t.jiraKey,
      expected: t.newDate || t.expected,
      effort: null,
      priority: t.priority,
      carriedFrom: t.carriedFrom || fromWeek,
    }))
}

/*
 * WHO HAS TO SUBMIT, when nobody has said.
 *
 * Everybody who holds a scorecard — the six of the team, Gun included, as
 * agreed. The partner team and the business users are assignable in the
 * register but are not this team, and are never chased.
 */
export const defaultSubmitters = (people) => (people || [])
  .filter((p) => p && p.id && p.scorecard !== false && !['it', 'user'].includes(p.id))
  .map((p) => p.id)

/** Monday's date, readably: "3 Nov 2026". */
export const weekLabel = (week) => new Date(`${week}T00:00:00Z`)
  .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/*
 * The ISO week number of a week named by its Monday: week 1 is the week that
 * holds the year's first Thursday, so 2 Nov 2026 is week 45. Worked out from
 * the Thursday of the same week, which is always in the year the week counts for.
 */
export const weekNo = (week) => {
  const thu = new Date(`${week}T00:00:00Z`)
  thu.setUTCDate(thu.getUTCDate() + 3)
  const jan1 = Date.UTC(thu.getUTCFullYear(), 0, 1)
  return Math.floor((thu - jan1) / 86400_000 / 7) + 1
}

/** "Week 45 · 2 Nov 2026". */
export const weekTitle = (week) => `Week ${weekNo(week)} · ${weekLabel(week)}`

/** An epoch ms as Bangkok wall-clock, e.g. "Fri 7 Nov, 15:00". */
export const bangkokTime = (ms) => new Date(ms).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
})
