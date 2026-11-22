import { isDate, daysBetween, isInPlan, isCounted, SAVING_BASIS } from './model.js'
import { projectOnHold } from './hold.js'

/*
 * MANAGEMENT INFORMATION THAT CAN BE TRUSTED (management design summary,
 * November 2026, Priority 0).
 *
 * Three things live here, shared by the Management overview and the Data
 * quality page so the two can never disagree:
 *
 *   METRICS      the metric dictionary: every headline figure with its
 *                definition, inclusion rule, source and the decision it serves
 *   dataQuality  the checks a register must pass before it is reported from
 *   overviewOf   the headline figures themselves, each with the gap that stops
 *                it being stated when the data is not there
 *
 * A figure the data cannot support is returned as null with a reason, never
 * as a zero or a guess: "no actual effort recorded" is a fact management can
 * act on, a 0 man-day variance would be a false one.
 */

/** Below this share of projects with a recorded cost, ROI is not scored. */
export const COST_COVERAGE_GATE = 0.8

/** On the register, not deleted. */
const live = (p) => !p.deleted
/** The team's portfolio: in the plan, not deleted, not delivered by IT or the business. */
export const inBook = (p) => live(p) && isInPlan(p) && !p.outsideTeam

/*
 * THE METRIC DICTIONARY. One entry per headline figure. The overview shows
 * the definition beside the number, and lists the whole dictionary below.
 */
export const METRICS = [
  {
    id: 'active',
    label: 'Active portfolio',
    definition: 'Approved projects currently running.',
    formula: 'Count of projects with commitment Commit or Stretch, status In Progress, not on hold.',
    includes: 'The team\'s own projects. Excludes deleted, Excluded, Next year, and projects delivered by IT or the business (PIC User or IT).',
    source: 'Project register; status from Jira.',
    decision: 'Understand workload and portfolio size.',
  },
  {
    id: 'reliability',
    label: 'Delivery reliability',
    definition: 'Projects delivered within the approved tolerance, divided by the projects that can be scored.',
    formula: 'On time = finished no later than the baseline finish + tolerance. Scored = finished with a finish date, or not finished and already past baseline + tolerance.',
    includes: 'The team\'s own projects with a baseline finish date. Tolerance is the "sprint days" setting on the Model page.',
    source: 'Baseline finish: the first due date the register held. Actual finish: Jira resolution date or the date recorded.',
    decision: 'Assess schedule performance.',
  },
  {
    id: 'capacity',
    label: 'Capacity variance',
    definition: 'Actual man-days minus planned man-days.',
    formula: 'Σ actual man-days − Σ planned man-days.',
    includes: 'The team\'s own projects.',
    source: 'Planned: the register\'s Mandays column. Actual: not recorded yet (needs Jira worklogs or a time entry).',
    decision: 'Identify overload or inaccurate planning.',
  },
  {
    id: 'eac',
    label: 'Estimate at completion',
    definition: 'Actual cost plus estimated remaining cost.',
    formula: 'Today, with no actual spend recorded: Σ forecast build cost (man-days × developer day rate) + Σ CAPEX. OPEX is netted from the benefit, not added here.',
    includes: 'The team\'s own projects that have a cost recorded.',
    source: 'Register man-days and the project cost sheet; rates from the Model page.',
    decision: 'Forecast total spending.',
  },
  {
    id: 'budget',
    label: 'Budget variance',
    definition: 'Estimate at completion minus approved budget.',
    formula: 'EAC − approved budget.',
    includes: 'Projects with an approved budget.',
    source: 'Approved budgets: not recorded yet (Finance or approved project cost records).',
    decision: 'Identify financial exposure.',
  },
  {
    id: 'projectedRoi',
    label: 'Projected ROI',
    definition: 'Expected benefit relative to estimate at completion.',
    formula: '(Σ expected net benefit over the horizon − EAC) ÷ EAC. Net benefit = saved hours × accountant rate + monetary benefit − OPEX.',
    includes: `Costed team projects. Not scored while fewer than ${Math.round(COST_COVERAGE_GATE * 100)}% of the projects with a benefit have a cost recorded.`,
    source: 'Register saving hours (estimates, not validated); rates and horizon from the Model page.',
    decision: 'Decide whether to continue or rescope.',
  },
  {
    id: 'actualRoi',
    label: 'Validated actual ROI',
    definition: 'Validated benefit relative to actual cost.',
    formula: '(Validated realised benefit − actual total cost) ÷ actual total cost.',
    includes: 'Projects whose benefit has been validated after go-live.',
    source: 'Benefit validation: not recorded yet.',
    decision: 'Confirm realised value.',
  },
  {
    id: 'confidence',
    label: 'Reporting confidence',
    definition: 'Completeness, validity and freshness of the data the figures rest on.',
    formula: 'Average of: completeness (owner, due date, saving hours, effort and cost filled in), validity (no invalid dates or duplicate keys), freshness (Jira sync succeeded in the last 24 hours, and the share of active projects fully reported in the latest weekly check-in) and assumptions (saving-hours basis confirmed).',
    includes: 'The team\'s own projects.',
    source: 'The checks on the Data quality page.',
    decision: 'Judge whether the dashboard is decision-ready.',
  },
]
export const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m]))

/**
 * A project's dates, kept apart: the BASELINE it was approved with, the
 * current FORECAST, and the ACTUAL finish. Slip is forecast (or actual)
 * against baseline, in calendar days.
 */
export function deliveryOf(p, asOf, toleranceDays = 14) {
  const due = isDate(p.due) ? p.due : null
  const baseline = isDate(p.baselineDue) ? p.baselineDue : due
  const forecast = isDate(p.adjustedDue) && (!due || p.adjustedDue > due) ? p.adjustedDue : due
  const actual = isDate(p.actualEnd) ? p.actualEnd : null
  const done = p.status === 'Done'
  // Open work already past its forecast lands no earlier than today.
  const overdue = !done && !actual && !!forecast && !!asOf && forecast < asOf
  const lands = actual || (done ? null : (overdue ? asOf : forecast))
  const slip = baseline && lands ? daysBetween(baseline, lands) : null
  let onTime = null
  if (baseline && actual) onTime = daysBetween(baseline, actual) <= toleranceDays
  else if (baseline && !done && asOf && daysBetween(baseline, asOf) > toleranceDays) onTime = false
  return { baseline, forecast, actual, done, overdue, slip, onTime, replans: Number(p.replanCount) || 0 }
}

const DATE_FIELDS = ['start', 'due', 'actualStart', 'actualEnd', 'baselineDue']

/** Why a project's dates cannot be right, or null. */
export function dateProblem(p, asOf) {
  for (const f of DATE_FIELDS) {
    if (p[f] != null && p[f] !== '' && !isDate(p[f])) return `${f} is not a date ("${String(p[f]).slice(0, 20)}")`
  }
  if (isDate(p.start) && isDate(p.due) && p.start > p.due) return `starts ${p.start}, after it is due ${p.due}`
  if (isDate(p.actualStart) && isDate(p.actualEnd) && p.actualStart > p.actualEnd) return `finished ${p.actualEnd}, before it started ${p.actualStart}`
  if (asOf && isDate(p.actualEnd) && p.actualEnd > asOf) return `finish date ${p.actualEnd} is in the future`
  return null
}

/**
 * THE DATA-QUALITY CHECKS. Each names the rows that fail it and why it
 * matters, so a reader can fix the record rather than argue with the total.
 *
 * `jira` is the last Jira sync ({ at, ok, error }) or null when unknown.
 * `weekly` is the latest reported week's check-in (lib/manager weeklyPulse),
 * or null when it has not been read.
 */
export function dataQuality(plan, { jira = null, now = Date.now(), weekly = null } = {}) {
  const asOf = plan.settings?.asOfDate
  const all = (plan.projects || []).filter(live)
  const book = all.filter(inBook)
  const checks = []
  const add = (id, label, severity, why, rows, detail) => checks.push({ id, label, severity, why, rows, detail })

  add('owner', 'Missing owner (PIC)', 'high', 'Nobody is accountable, and the saving hours fall to the team lead by default.',
    book.filter((p) => !p.pic))
  const badDates = all.map((p) => ({ p, why: dateProblem(p, asOf) })).filter((x) => x.why)
  add('dates', 'Invalid dates', 'high', 'An impossible date makes every timeline and reliability figure that uses it wrong.',
    badDates.map((x) => x.p), Object.fromEntries(badDates.map((x) => [x.p.key, x.why])))
  add('doneNoFinish', 'Done, with no finish date', 'medium', 'It cannot be scored for on-time delivery.',
    book.filter((p) => p.status === 'Done' && !isDate(p.actualEnd)))
  add('undated', 'Undated work', 'medium', 'Not finished and no due date: it is on no timeline and can never be late.',
    book.filter((p) => p.status !== 'Done' && !isDate(p.due)))
  const byKey = {}
  for (const p of all) if (p.jiraKey) (byKey[p.jiraKey] ||= []).push(p)
  const dupes = Object.values(byKey).filter((list) => list.length > 1).flat()
  add('duplicates', 'Duplicate Jira keys', 'high', 'The same Jira item counted twice inflates hours and project counts.',
    dupes, Object.fromEntries(dupes.map((p) => [p.key, `${p.jiraKey} is on ${byKey[p.jiraKey].length} rows`])))
  add('deleted', 'Deleted, still on the register', 'low', 'Kept for the record; excluded from every figure.',
    (plan.projects || []).filter((p) => p.deleted))
  add('effort', 'Missing effort (man-days)', 'medium', 'No planned effort: no capacity view and no build cost.',
    book.filter((p) => !(p.manday > 0)))
  add('cost', 'Missing cost', 'high', 'A benefit with no cost has no ROI, and cannot pass or fail the return gate.',
    book.filter((p) => p.savingHours != null && p.investment == null))
  add('saving', 'Missing saving hours', 'medium', 'No benefit: it adds nothing to the target or the ROI.',
    book.filter((p) => p.savingHours == null))

  // The two that are about the whole register, not a row.
  const jiraAge = jira?.at ? (now - Date.parse(jira.at)) / 3600000 : null
  const syncFailed = jira && jira.ok === false
  const syncStale = !syncFailed && jiraAge != null && jiraAge > 24
  const basis = plan.settings?.savingBasisApproval
  const global = [
    {
      id: 'sync',
      label: syncFailed ? 'Last Jira sync failed' : syncStale ? 'Jira sync is out of date' : 'Jira sync',
      ok: !!jira && !syncFailed && !syncStale && jiraAge != null,
      unknown: !jira || jira.at == null,
      text: !jira || jira.at == null ? 'No sync result recorded since the server started.'
        : syncFailed ? `Failed ${new Date(jira.at).toLocaleString()}${jira.error ? `: ${jira.error}` : ''}.`
          : `Last ran ${new Date(jira.at).toLocaleString()} (${Math.round(jiraAge)} h ago).`,
    },
    {
      id: 'basis',
      label: 'Saving-hours basis',
      ok: !!basis,
      text: basis
        ? `${SAVING_BASIS[plan.settings.savingBasis]?.label || plan.settings.savingBasis}, confirmed by ${basis.by || 'an administrator'} on ${String(basis.at).slice(0, 10)}.`
        : `Counted ${(SAVING_BASIS[plan.settings?.savingBasis]?.label || 'per month').toLowerCase()}, but not yet confirmed by management. ROI depends on it (12× between monthly and annual).`,
    },
  ]
  if (weekly && weekly.active) {
    global.push({
      id: 'weekly',
      label: 'Weekly check-in',
      ok: weekly.rate >= 0.9,
      text: `${weekly.updated} of ${weekly.active} active projects fully reported for the week of ${weekly.week}`
        + `${weekly.partly ? ` (${weekly.partly} partly)` : ''}; reports in from ${weekly.reportsIn} of ${weekly.required} people`
        + `${weekly.missing?.length ? ` — still missing: ${weekly.missing.join(', ')}` : ''}.`,
    })
  }

  // Reporting confidence, out of 1.
  const fields = [
    (p) => !!p.pic, (p) => isDate(p.due) || p.status === 'Done', (p) => p.savingHours != null,
    (p) => p.manday > 0, (p) => p.investment != null || p.savingHours == null,
  ]
  const completeness = book.length ? book.reduce((a, p) => a + fields.filter((f) => f(p)).length, 0) / (book.length * fields.length) : null
  const invalid = new Set([...badDates.map((x) => x.p.key), ...dupes.map((p) => p.key)])
  const validity = all.length ? 1 - all.filter((p) => invalid.has(p.key)).length / all.length : null
  // Jira sync and the weekly check-in, each where it is known.
  const fresh = [
    global[0].unknown ? null : (global[0].ok ? 1 : syncFailed ? 0 : 0.5),
    weekly && weekly.active ? weekly.rate : null,
  ].filter((v) => v != null)
  const freshness = fresh.length ? fresh.reduce((a, v) => a + v, 0) / fresh.length : null
  const assumptions = basis ? 1 : 0
  const parts = { completeness, validity, freshness, assumptions }
  const known = Object.values(parts).filter((v) => v != null)
  const score = known.length ? known.reduce((a, v) => a + v, 0) / known.length : null

  return { checks, global, confidence: { score, parts, verdict: verdictOf(score) }, book: book.length, total: all.length }
}

export const verdictOf = (score) => (score == null ? 'Unknown'
  : score >= 0.85 ? 'Decision-ready'
    : score >= 0.65 ? 'Use with care'
      : 'Not decision-ready')

const sum = (rows, f) => rows.reduce((a, p) => a + (f(p) || 0), 0)
const median = (xs) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The Management overview's figures. Each headline is { value, gap?, ... }:
 * a null value always carries the gap that explains it.
 */
export function overviewOf(plan, quality) {
  const s = plan.settings || {}
  const asOf = s.asOfDate
  const tolerance = s.sprintDays ?? 14
  const book = (plan.projects || []).filter(inBook)

  const active = book.filter((p) => isCounted(p) && /progress/i.test(p.status || '') && !projectOnHold(p))

  const deliveries = book.map((p) => ({ p, d: deliveryOf(p, asOf, tolerance) }))
  const scored = deliveries.filter((x) => x.d.onTime != null)
  const onTime = scored.filter((x) => x.d.onTime).length
  const slips = deliveries.filter((x) => x.d.slip != null && !x.d.done)
  const delays = deliveries
    .filter((x) => x.d.slip != null && x.d.slip > 0)
    .sort((a, b) => b.d.slip - a.d.slip)

  const people = (plan.people || []).length
  const fin = plan.finance || {}
  const capacity = Math.round(people * (fin.daysPerFteMonth || 22) * 12)
  const planned = sum(book, (p) => p.manday)

  const withBenefit = book.filter((p) => p.savingHours != null || p.investment != null)
  const costed = withBenefit.filter((p) => p.investment != null)
  const costCoverage = withBenefit.length ? costed.length / withBenefit.length : null
  const eac = costed.length ? sum(costed, (p) => p.investment) : null
  const benefit = sum(costed, (p) => p.netHorizonBenefit)
  const projectedRoi = eac > 0 ? (benefit - eac) / eac : null
  const roiScored = costCoverage != null && costCoverage >= COST_COVERAGE_GATE
  const belowGate = book.filter((p) => isCounted(p) && p.gate === 'fail')

  return {
    asOf,
    tolerance,
    book,
    headline: {
      active: { value: active.length, note: `of ${book.length} projects in the team's plan` },
      reliability: scored.length
        ? { value: onTime / scored.length, note: `${onTime} of ${scored.length} scored projects within ${tolerance} days of baseline` }
        : { value: null, gap: 'No project can be scored yet: none finished, and none past its baseline.' },
      capacity: { value: null, gap: 'No actual effort recorded yet.', note: `Planned ${Math.round(planned).toLocaleString()} man-days against about ${capacity.toLocaleString()} available in a year (${people} people).` },
      eac: eac == null
        ? { value: null, gap: 'No project has a cost recorded.' }
        : { value: eac, note: `Forecast only: no actual spend recorded. ${costed.length} of ${withBenefit.length} projects costed.` },
      budget: { value: null, gap: 'No approved budgets recorded yet.' },
      projectedRoi: projectedRoi == null
        ? { value: null, gap: 'No project has a cost recorded.' }
        : { value: projectedRoi, scored: roiScored, note: roiScored
          ? `${costed.length} of ${withBenefit.length} projects costed; benefit not yet validated.`
          : `Not scored: only ${Math.round((costCoverage || 0) * 100)}% of projects have a cost (needs ${Math.round(COST_COVERAGE_GATE * 100)}%).` },
      actualRoi: { value: null, gap: 'No benefit has been validated after go-live yet.' },
      confidence: { value: quality.confidence.score, note: quality.confidence.verdict },
    },
    delivery: {
      scored: scored.length,
      onTime,
      late: scored.length - onTime,
      slipping: slips.filter((x) => x.d.slip > tolerance).length,
      medianSlip: median(slips.map((x) => x.d.slip)),
      delays: delays.slice(0, 8),
      replanned: book.filter((p) => (Number(p.replanCount) || 0) > 0).length,
      repeatReplans: book.filter((p) => (Number(p.replanCount) || 0) >= 2),
    },
    capacity: { planned, capacity, people, noEffort: book.filter((p) => !(p.manday > 0)).length },
    cost: { eac, benefit, costed: costed.length, withBenefit: withBenefit.length, costCoverage, belowGate, roiScored, horizon: fin.horizonMonths || 12 },
  }
}
