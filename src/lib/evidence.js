import { isDate, daysBetween, monthlyHours } from './model.js'
import { deliveryOf, inBook } from './governance.js'
import { costContext, projectCostOf, VALIDATED } from './costs.js'

/*
 * PERFORMANCE EVIDENCE (management design summary, Priority 2).
 *
 * The seven dimensions of the brief, per team member, each from a named
 * source and each with the gap that stops it being stated:
 *
 *   delivery       on time within the approved tolerance, and recovery
 *   forecasting    how close effort and dates came to what was planned
 *   quality        no source yet: always a gap, never a made-up score
 *   complexity     a descriptive profile of what they carry, not a score
 *   outcome        estimated, approved and validated benefit
 *   ownership      the weekly check-in: weeks reported, blockers raised,
 *                  decisions asked for
 *   collaboration  projects they work on that somebody else owns
 *
 * LIKE FOR LIKE. Each person is compared only with the members who share
 * their role AND level (Costs & rates), as the median of that group. There
 * is no ranking and no overall score, on purpose: the brief forbids a league
 * table built on hours or project counts.
 *
 * A dimension with no data has value null and a gap; zero is only ever a
 * real zero.
 */

export const DIMENSIONS = [
  { id: 'delivery', label: 'Delivery' },
  { id: 'forecasting', label: 'Forecasting' },
  { id: 'quality', label: 'Quality' },
  { id: 'complexity', label: 'Complexity' },
  { id: 'outcome', label: 'Outcome' },
  { id: 'ownership', label: 'Ownership' },
  { id: 'collaboration', label: 'Collaboration' },
]

const APPROVED_STATES = new Set(['approved', 'implemented', 'validated', 'realized'])
const pct = (x) => `${Math.round(x * 100)}%`
const r1 = (x) => Math.round(x * 10) / 10
export const median = (xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const dim = (value, display, source, gap = null, detail = []) => ({ value, display: value == null ? '—' : display, source, gap: value == null ? gap : null, detail })

/** The members evidence is kept for: the same team the Capacity page counts. */
export const teamOf = (plan) => (plan?.people || [])
  .filter((x) => x && x.id && !x.deleted && x.scorecard !== false && !['it', 'user'].includes(x.id))

/* ------------------------------------------------------- the dimensions */

/**
 * DELIVERY. On time: finished no later than baseline + tolerance (or, not
 * finished, not yet past it) — deliveryOf, as the Management overview uses.
 *
 * RECOVERY: of the projects that slipped past baseline + tolerance and have
 * since finished, the share that finished within tolerance of their
 * re-planned (adjusted) date. A slip that was re-planned and then delivered
 * as re-planned is a recovery; one that kept slipping is not.
 */
function deliveryDim(mine, asOf, tol) {
  const ds = mine.map((p) => ({ p, d: deliveryOf(p, asOf, tol) }))
  const scored = ds.filter((x) => x.d.onTime != null)
  const onTime = scored.filter((x) => x.d.onTime).length
  const slippedDone = ds.filter((x) => x.d.actual && x.d.slip != null && x.d.slip > tol)
  const recovered = slippedDone.filter((x) => {
    const re = isDate(x.p.adjustedDue) ? x.p.adjustedDue : null
    return re && daysBetween(re, x.d.actual) <= tol
  }).length
  const detail = [
    slippedDone.length
      ? { label: 'Recovery', value: recovered / slippedDone.length, display: `${recovered} of ${slippedDone.length} slipped projects finished on their re-planned date` }
      : { label: 'Recovery', value: null, display: 'No slipped project has finished yet' },
  ]
  return scored.length
    ? dim(onTime / scored.length, `${pct(onTime / scored.length)} on time`, `Baseline vs actual finish, ${tol}-day tolerance`, null, [{ label: 'Scored', value: scored.length, display: `${onTime} of ${scored.length} scored projects` }, ...detail])
    : dim(null, '', `Baseline vs actual finish, ${tol}-day tolerance`, 'None of their projects can be scored yet: none finished, none past baseline.', detail)
}

/**
 * FORECASTING. Effort: 1 − the mean of |(logged + remaining) − planned| ÷
 * planned, over their projects with both a plan and logged hours, floored at
 * zero. Dates: the median of |actual finish − baseline| in days, over their
 * finished projects.
 */
function forecastingDim(mine, ctx, asOf, tol) {
  const errs = []
  for (const p of mine) {
    const c = projectCostOf(p, ctx)
    if (c.forecastHours > 0 && c.actualHours > 0) errs.push(Math.abs(c.actualHours + (c.remainingHours || 0) - c.forecastHours) / c.forecastHours)
  }
  const slips = mine.map((p) => deliveryOf(p, asOf, tol)).filter((d) => d.actual && d.baseline).map((d) => Math.abs(daysBetween(d.baseline, d.actual)))
  const dateMedian = median(slips)
  const detail = [{ label: 'Date accuracy', value: dateMedian, display: dateMedian == null ? 'No finished project with a baseline' : `Median ${Math.round(dateMedian)} days from baseline (${slips.length} finished)` }]
  if (!errs.length) return dim(null, '', 'Planned effort vs Jira worklogs', 'No project of theirs has both planned effort and logged hours.', detail)
  const acc = Math.max(0, 1 - errs.reduce((a, x) => a + x, 0) / errs.length)
  return dim(acc, `${pct(acc)} effort accuracy`, 'Planned effort vs Jira worklogs + remaining', null, [{ label: 'Projects', value: errs.length, display: `${errs.length} project${errs.length === 1 ? '' : 's'} with plan and actuals` }, ...detail])
}

const qualityDim = () => dim(null, '', 'Defects, rework, incidents, acceptance', 'No defect or rework source yet (Jira bugs are not read).')

/** COMPLEXITY: what they carry, described rather than scored. */
function complexityDim(mine, ctx) {
  if (!mine.length) return dim(null, '', 'Project register', 'No projects of their own in the plan.')
  const planned = mine.reduce((a, p) => a + (p.manday > 0 ? p.manday : 0), 0)
  const outside = mine.filter((p) => (p.partners || []).length > 0 || (ctx.blocked[p.key]?.weeks || 0) > 0
    || (p.jiraKey && (ctx.blocked[String(p.jiraKey).toUpperCase()]?.weeks || 0) > 0)).length
  return dim(mine.length, `${mine.length} project${mine.length === 1 ? '' : 's'}`, 'Project register; blocked weeks from the weekly check-in', null, [
    { label: 'Planned effort', value: planned, display: `${r1(planned).toLocaleString()} man-days planned` },
    { label: 'Outside dependency', value: outside, display: `${outside} with a partner team or a reported blocker` },
  ])
}

/** OUTCOME: hours a month, estimated → approved → validated after go-live. */
function outcomeDim(mine, ctx, basis) {
  let estimated = 0
  let approved = 0
  let validated = 0
  let nValidated = 0
  let any = false
  for (const p of mine) {
    const est = monthlyHours(p, basis)
    const b = ctx.records[p.key]?.benefit || {}
    if (est != null) { estimated += est; any = true }
    if (APPROVED_STATES.has(b.state)) approved += b.expectedHours ?? est ?? 0
    if (VALIDATED.has(b.state) && b.actualHours != null) { validated += b.actualHours; nValidated += 1 }
  }
  const detail = [
    { label: 'Estimated', value: any ? estimated : null, display: any ? `${Math.round(estimated).toLocaleString()} h/month estimated` : 'No estimate' },
    { label: 'Approved', value: approved, display: `${Math.round(approved).toLocaleString()} h/month in an approved business case` },
  ]
  return nValidated
    ? dim(validated, `${Math.round(validated).toLocaleString()} h/month validated`, 'Benefit validation (Benefits page)', null, [...detail, { label: 'Validated projects', value: nValidated, display: `${nValidated} project${nValidated === 1 ? '' : 's'} validated` }])
    : dim(null, '', 'Benefit validation (Benefits page)', 'No benefit of theirs validated after go-live yet.', detail)
}

/** OWNERSHIP: the weekly check-in — reporting, escalation, decisions. */
function ownershipDim(a) {
  if (!a || !(a.weeks > 0)) return dim(null, '', 'Weekly check-in', 'No weekly check-in recorded for them yet.')
  const rate = Math.min(1, (a.weeksReported || 0) / a.weeks)
  return dim(rate, `${pct(rate)} of weeks reported`, 'Weekly check-in', null, [
    { label: 'Weeks', value: a.weeksReported || 0, display: `${a.weeksReported || 0} of ${a.weeks} weeks reported, ${a.weeksPlanned || 0} planned` },
    { label: 'Blockers raised', value: a.blockers || 0, display: `${a.blockers || 0} blocker${a.blockers === 1 ? '' : 's'} escalated` },
    { label: 'Decisions asked', value: a.decisions || 0, display: `${a.decisions || 0} decision${a.decisions === 1 ? '' : 's'} prepared for management` },
  ])
}

/** COLLABORATION: work on projects somebody else owns, and partner teams. */
function collaborationDim(id, book) {
  const helps = book.filter((p) => p.pic !== id && (p.contributors || []).some((c) => c.person === id))
  const credit = book.reduce((a, p) => a + (p.shares?.[id] || 0), 0)
  const partners = new Set(book.filter((p) => p.pic === id).flatMap((p) => (p.partners || []).map((x) => (Array.isArray(x) ? x[0] : x?.person)).filter(Boolean)))
  return dim(helps.length, `${helps.length} project${helps.length === 1 ? '' : 's'} owned by others`, 'Project roles in the register', null, [
    { label: 'Credit held', value: credit, display: `${r1(credit)} projects' worth of credit` },
    { label: 'Partners', value: partners.size, display: `${partners.size} partner${partners.size === 1 ? '' : 's'} on their projects` },
  ])
}

/* -------------------------------------------------------------- people */

export function evidenceOf(plan, gov, activity = {}) {
  const ctx = costContext(plan, gov)
  const asOf = ctx.asOf
  const tol = plan?.settings?.sprintDays ?? 14
  const basis = plan?.settings?.savingBasis
  const book = (plan?.projects || []).filter(inBook)
  const rates = gov?.rates || {}
  const roleName = (r) => (rates.roles || []).find((x) => x.id === r)?.name || r

  const people = teamOf(plan).map((person) => {
    const mine = book.filter((p) => p.pic === person.id)
    const a = rates.people?.[person.id] || {}
    const dims = {
      delivery: deliveryDim(mine, asOf, tol),
      forecasting: forecastingDim(mine, ctx, asOf, tol),
      quality: qualityDim(),
      complexity: complexityDim(mine, ctx),
      outcome: outcomeDim(mine, ctx, basis),
      ownership: ownershipDim(activity?.[person.id]),
      collaboration: collaborationDim(person.id, book),
    }
    const withData = Object.values(dims).filter((d) => d.value != null).length
    const role = a.role || null
    const level = a.level || null
    return {
      id: person.id,
      nick: person.nick || person.name || person.id,
      role,
      roleName: role ? roleName(role) : null,
      level,
      // Only a full role AND level makes a like-for-like group.
      group: role && level ? `${role}|${level}` : null,
      groupLabel: role && level ? `${roleName(role)} · ${level}` : 'Role or level not set',
      projects: mine.length,
      dims,
      confidence: withData / DIMENSIONS.length,
    }
  })

  // Peers and their medians, within each role + level group only.
  for (const p of people) {
    const group = p.group ? people.filter((x) => x.group === p.group) : [p]
    p.peers = group.filter((x) => x.id !== p.id).map((x) => x.id)
    for (const d of DIMENSIONS) {
      const vals = group.map((x) => x.dims[d.id].value)
      const n = vals.filter((v) => v != null).length
      p.dims[d.id].peerMedian = p.group && n >= 2 ? median(vals) : null
      p.dims[d.id].peerN = p.group ? n : 0
    }
  }

  const groups = []
  for (const p of people) {
    const key = p.group || '__unset'
    let g = groups.find((x) => x.key === key)
    if (!g) { g = { key, label: p.groupLabel, members: [] }; groups.push(g) }
    g.members.push(p.id)
  }
  groups.sort((x, y) => (x.key === '__unset') - (y.key === '__unset') || x.label.localeCompare(y.label))

  // TEAM OUTCOMES, kept apart from anybody's individual contribution.
  const team = {
    delivery: deliveryDim(book, asOf, tol),
    outcome: outcomeDim(book, ctx, basis),
    forecasting: forecastingDim(book, ctx, asOf, tol),
  }

  return { asOf, tolerance: tol, people, groups, team }
}

/** What a frozen review keeps: the figures, not the functions. */
export function reviewSnapshot(ev) {
  return {
    asOf: ev.asOf,
    tolerance: ev.tolerance,
    team: Object.fromEntries(Object.entries(ev.team).map(([k, d]) => [k, { value: d.value, display: d.display, gap: d.gap }])),
    people: ev.people.map((p) => ({
      id: p.id, nick: p.nick, groupLabel: p.groupLabel, confidence: p.confidence,
      dims: Object.fromEntries(Object.entries(p.dims).map(([k, d]) => [k, {
        value: d.value, display: d.display, gap: d.gap, source: d.source, peerMedian: d.peerMedian, detail: d.detail.map((x) => x.display),
      }])),
    })),
  }
}

/** A dimension's value as the page writes it (and its peer median the same way). */
export function fmtDim(id, v) {
  if (v == null) return '—'
  if (['delivery', 'forecasting', 'ownership'].includes(id)) return pct(v)
  if (id === 'outcome') return `${Math.round(v).toLocaleString()} h/mo`
  return String(r1(v))
}
