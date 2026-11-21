/**
 * MANAGEMENT INFORMATION (design summary, November 2026, Priority 0): the
 * metric dictionary, the data-quality checks and the Management overview's
 * figures.
 *
 *   node scripts/check-governance.mjs
 */
import { readFileSync } from 'node:fs'
import { computePlan, repairState } from '../src/lib/model.js'
import { METRICS, deliveryOf, dateProblem, dataQuality, overviewOf, verdictOf, COST_COVERAGE_GATE } from '../src/lib/governance.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('\n--- the metric dictionary ---')
const want = ['active', 'reliability', 'capacity', 'eac', 'budget', 'projectedRoi', 'actualRoi', 'confidence']
check('THE EIGHT HEADLINE METRICS MANAGEMENT ASKED FOR', want.every((id) => METRICS.some((m) => m.id === id)), METRICS.map((m) => m.id).join(','))
check('  each with a definition, calculation, inclusion rule, source and decision',
  METRICS.every((m) => m.definition && m.formula && m.includes && m.source && m.decision))

console.log('\n--- baseline, forecast and actual are kept apart ---')
const asOf = '2026-11-21'
const a = deliveryOf({ baselineDue: '2026-06-30', due: '2026-08-31', status: 'In Progress' }, asOf, 14)
check('A RE-PLANNED, OVERDUE PROJECT: baseline and forecast both kept', a.baseline === '2026-06-30' && a.forecast === '2026-08-31')
check('  its slip runs to today, not to the forecast it already missed', a.slip === 144 && a.overdue, `${a.slip}`)
check('  and it is scored late', a.onTime === false)
const b = deliveryOf({ baselineDue: '2026-06-30', due: '2026-07-31', actualEnd: '2026-07-10', status: 'Done' }, asOf, 14)
check('FINISHED 10 DAYS AFTER BASELINE, TOLERANCE 14: ON TIME, judged on the baseline not the moved date', b.onTime === true && b.slip === 10)
const c = deliveryOf({ baselineDue: '2026-12-31', due: '2026-12-31', status: 'In Progress' }, asOf, 14)
check('NOT DUE YET: not scored', c.onTime === null && c.slip === 0)
const d = deliveryOf({ baselineDue: '2026-06-30', due: '2026-06-30', status: 'Done' }, asOf, 14)
check('DONE WITH NO FINISH DATE: not scored, rather than assumed on time', d.onTime === null && d.slip === null)

console.log('\n--- invalid dates ---')
check('start after due', /after it is due/.test(dateProblem({ start: '2026-05-01', due: '2026-04-01' }, asOf)))
check('finish before start', /before it started/.test(dateProblem({ actualStart: '2026-05-01', actualEnd: '2026-04-01' }, asOf)))
check('a finish in the future', /future/.test(dateProblem({ actualEnd: '2027-01-01' }, asOf)))
check('a date field that is not a date', /not a date/.test(dateProblem({ due: '31/12/2026' }, asOf)))
check('good dates pass', dateProblem({ start: '2026-01-01', due: '2026-02-01', actualStart: '2026-01-02', actualEnd: '2026-02-03' }, asOf) === null)

console.log('\n--- on the real register ---')
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const state = repairState(seed)
state.projects = state.projects.map((p, i) => (i === 0 ? { ...p, jiraKey: state.projects[1].jiraKey || 'FNP-1' } : p))
if (!state.projects[1].jiraKey) state.projects[1] = { ...state.projects[1], jiraKey: 'FNP-1' }
const plan = computePlan(state)
const q = dataQuality(plan, { jira: null })
const byId = Object.fromEntries(q.checks.map((x) => [x.id, x]))
check('EVERY CHECK MANAGEMENT LISTED IS RUN',
  ['owner', 'dates', 'doneNoFinish', 'undated', 'duplicates', 'deleted', 'effort', 'cost', 'saving'].every((id) => byId[id]))
check('A DUPLICATED JIRA KEY IS CAUGHT, both rows named', byId.duplicates.rows.length >= 2, `${byId.duplicates.rows.length}`)
check('missing owners counted from the team\'s plan', byId.owner.rows.every((p) => !p.pic && !p.deleted))
check('NOTHING DELIVERED BY IT OR THE BUSINESS IS IN THE TEAM\'S CHECKS', byId.effort.rows.every((p) => !p.outsideTeam))
check('an unknown Jira sync leaves freshness unknown, not zero', q.confidence.parts.freshness === null)
check('AN UNCONFIRMED SAVING-HOURS BASIS COUNTS AGAINST CONFIDENCE', q.confidence.parts.assumptions === 0)
check('confidence is between 0 and 1, with a verdict', q.confidence.score > 0 && q.confidence.score < 1 && !!q.confidence.verdict)
const failed = dataQuality(plan, { jira: { at: new Date().toISOString(), ok: false, error: 'boom' } })
check('A FAILED JIRA SYNC IS REPORTED, and freshness drops to 0', failed.global[0].label === 'Last Jira sync failed' && failed.confidence.parts.freshness === 0)
const fresh = dataQuality(computePlan({ ...state, settings: { ...state.settings, savingBasisApproval: { by: 'boss@lotuss.com', at: '2026-11-21T00:00:00Z' } } }),
  { jira: { at: new Date().toISOString(), ok: true } })
check('A CONFIRMED BASIS AND A FRESH SYNC RAISE CONFIDENCE', fresh.confidence.score > q.confidence.score && fresh.confidence.parts.freshness === 1 && fresh.global[1].ok)
check('the verdicts', verdictOf(0.9) === 'Decision-ready' && verdictOf(0.7) === 'Use with care' && verdictOf(0.3) === 'Not decision-ready')

console.log('\n--- the overview ---')
const o = overviewOf(plan, q)
check('ACTIVE PORTFOLIO is the team\'s running, approved projects', o.headline.active.value > 0 && o.headline.active.value <= o.book.length, `${o.headline.active.value} of ${o.book.length}`)
check('NO ACTUAL EFFORT, NO BUDGETS, NO VALIDATED BENEFIT: each a gap, not a zero',
  o.headline.capacity.value === null && !!o.headline.capacity.gap
  && o.headline.budget.value === null && !!o.headline.budget.gap
  && o.headline.actualRoi.value === null && !!o.headline.actualRoi.gap)
check('with no project costed, EAC and ROI are gaps too', o.headline.eac.value === null && o.headline.projectedRoi.value === null)
check('the slips are sorted, biggest first', o.delivery.delays.every((x, i, arr) => !i || arr[i - 1].d.slip >= x.d.slip))

// Cost two projects: EAC appears, but ROI is not scored below the coverage gate.
const costed = { ...state, projects: state.projects.map((p, i) => (i < 2 ? { ...p, manday: 20 } : p)) }
const plan2 = computePlan(costed)
const o2 = overviewOf(plan2, dataQuality(plan2))
check('TWO PROJECTS COSTED: an EAC, marked forecast only', o2.headline.eac.value > 0 && /Forecast only/.test(o2.headline.eac.note))
check(`  ROI shown but NOT SCORED while under ${Math.round(COST_COVERAGE_GATE * 100)}% are costed`, o2.headline.projectedRoi.value != null && o2.headline.projectedRoi.scored === false)
const all = { ...state, projects: state.projects.map((p) => ({ ...p, manday: 20 })) }
const plan3 = computePlan(all)
const o3 = overviewOf(plan3, dataQuality(plan3))
check('  and scored once they are', o3.headline.projectedRoi.scored === true)

console.log(failures ? `\n${failures} FAILED` : '\nall governance checks passed')
process.exit(failures ? 1 : 0)
