/**
 * The Management Pack: built from the same figures as every other page,
 * compared with the previous issued pack so only material changes are
 * reported, the board's version cut down to its sections, and every pack
 * carrying its period, refresh times and metric definitions.
 *
 *   node scripts/check-pack.mjs
 */
import { packOf, boardSummary, materialMove, MATERIAL, HEADLINE_IDS } from '../src/lib/pack.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const people = [
  { id: 'james', nick: 'James', jiraNames: ['Pipat Singhasiri'], scorecard: true },
  { id: 'kade', nick: 'Kade', jiraNames: ['Jarinya Phosri'], scorecard: true },
]
const fin = { horizonMonths: 12, hoursPerManday: 8, hoursPerFteMonth: 176, acctHourRate: 100, devDayRate: 4000, roiGate: 2, symbol: '฿' }
const proj = (key, f) => ({
  key, jiraKey: key, summary: `Project ${key}`, pic: 'james', status: 'In Progress', manday: 10, commitLevel: 'commit',
  horizonBenefit: 120000, savingHours: 100, due: '2026-12-15', baselineDue: '2026-12-15', ...f,
})
const plan = (projects, asOf = '2026-11-22') => ({
  projects,
  people,
  finance: fin,
  settings: { asOfDate: asOf, sprintDays: 14, savingBasis: 'monthly' },
  totals: { target: 3000, committedHours: 2000, stretchHours: 500, totalHours: 2400, totalCoverage: 0.8 },
})
const gov = (extra = {}) => ({
  rates: { roles: [{ id: 'dev', name: 'Developer', hourlyRate: 500, status: 'approved' }], people: { james: { role: 'dev' } }, overrides: [] },
  projects: {
    'P-1': { budget: { approved: 60000 }, costs: [], labour: [], benefit: { state: 'estimated' } },
    'P-2': { budget: { approved: 50000 }, costs: [], labour: [], benefit: { state: 'implemented' } },
    ...extra,
  },
  worklogs: { at: '2026-11-21T00:00:00Z', ok: true, byProject: { 'P-1': { hours: 20, remainingHours: 0, byWeek: { '2026-11-09': { 'Pipat Singhasiri': 20 } }, carried: 0, inProgress: 1, issues: 2 } } },
  blocked: {},
})
const raid = {
  items: [
    { id: 'r1', type: 'decision', title: 'Rescope P-2?', projectKey: 'P-2', owner: 'Gun', status: 'open', recommendation: 'Drop phase 2', exposure: { cost: 50000 } },
    { id: 'r2', type: 'decision', title: 'Old question', status: 'decided' },
    { id: 'r3', type: 'risk', title: 'Vendor late', projectKey: 'P-1', status: 'open', action: 'Second vendor on standby' },
  ],
  weekly: [
    { id: 'w1', text: 'Keep region B?', projectKey: 'P-1', nick: 'James', status: 'open', jiraKey: 'FNP-2001' },
    { id: 'w2', text: 'Answered already', status: 'decided' },
  ],
}

console.log('\n--- what counts as material ---')
check('A RATIO MOVING 5 POINTS IS MATERIAL, 4 IS NOT', materialMove('ratio', 0.70, 0.75) && !materialMove('ratio', 0.70, 0.74))
check('  money needs both the share and the floor', !materialMove('money', 1000, 2000) && materialMove('money', 1_000_000, 1_150_000) && !materialMove('money', 10_000_000, 10_200_000))
check('  a figure that appears or can no longer be stated is material', materialMove('money', null, 5) && materialMove('roi', 0.5, null) && !materialMove('roi', null, null))
check('  one more active project is material', materialMove('count', 6, 7) && !materialMove('count', 6, 6))

console.log('\n--- the pack ---')
const before = packOf(plan([proj('P-1'), proj('P-2', { pic: 'kade', due: '2026-12-01', baselineDue: '2026-12-01' })]), gov(), {
  raid, period: 'Week 46, 2026', refreshed: { plan: '2026-11-15T08:00:00Z', jira: '2026-11-15T07:00:00Z' }, now: '2026-11-15T09:00:00Z',
})
check('EVERY PACK CARRIES ITS PERIOD, REFRESH TIMES, FILTERS AND METRIC DEFINITIONS',
  before.meta.period === 'Week 46, 2026' && before.meta.refreshed.plan === '2026-11-15T08:00:00Z' && before.meta.refreshed.jira === '2026-11-15T07:00:00Z'
  && before.meta.refreshed.worklogs === '2026-11-21T00:00:00Z' && /team's own projects/.test(before.meta.filters.scope)
  && before.meta.definitions.length === 8 && before.meta.definitions.every((d) => d.definition && d.source))
check('  and the thresholds it judged "material" by', before.meta.material.slipDays === 14 && before.meta.material.ratio === MATERIAL.ratio)
check('THE EXECUTIVE SUMMARY IS THE EIGHT OVERVIEW HEADLINES', HEADLINE_IDS.every((id) => id in before.headline) && before.headline.active.value === 2, JSON.stringify(before.headline.active))
check('THE FIRST PACK HAS NOTHING TO COMPARE WITH', before.changes === null)
check('IT IS PLAIN DATA: it survives being kept as a snapshot', JSON.stringify(JSON.parse(JSON.stringify(before))) === JSON.stringify(before))
check('STRATEGIC OUTCOMES: SAVING HOURS AGAINST THE TARGET', before.strategic.target === 3000 && before.strategic.totalHours === 2400 && before.strategic.coverage === 0.8)
check('THE ROADMAP: WHAT IS FORECAST TO LAND IN THE NEXT 90 DAYS, in date order', before.roadmap.map((r) => r.key).join() === 'P-2,P-1', before.roadmap.map((r) => r.key).join())
check('DECISIONS: OPEN RAID DECISIONS AND OPEN WEEKLY ASKS, NOT ANSWERED ONES',
  before.decisions.map((d) => d.id).join() === 'r1,w1' && before.decisions[0].recommendation === 'Drop phase 2' && before.decisions[1].source === 'weekly')
check('DATA CONFIDENCE IS STATED, WITH THE FAILING CHECKS', before.confidence.score != null && Array.isArray(before.confidence.failing))

console.log('\n--- a week later ---')
const after = packOf(plan([
  proj('P-1', { status: 'Done', actualEnd: '2026-11-20' }), // status moved
  proj('P-2', { pic: 'kade', due: '2026-12-31', adjustedDue: '2026-12-31', baselineDue: '2026-12-01' }), // slipped 30 days
  proj('P-3'), // new
]), gov({ 'P-2': { budget: { approved: 30000 }, costs: [{ category: 'vendor', label: 'SOW', forecast: 200000, actual: 0 }], labour: [], benefit: { state: 'validated', actualHours: 50 } } }), {
  raid, period: 'Week 47, 2026', previous: before, now: '2026-11-22T09:00:00Z',
})
const what = (key) => (after.changes.projects.filter((c) => c.key === key).map((c) => c.what))
check('A STATUS CHANGE IS A MATERIAL CHANGE', what('P-1').includes('status'), JSON.stringify(what('P-1')))
check('A SLIP GROWING PAST THE TOLERANCE IS ONE', what('P-2').includes('slipped'), JSON.stringify(after.changes.projects))
check('  NEWLY OVER BUDGET IS ONE', what('P-2').includes('over budget'))
check('  a benefit moving state is one', what('P-2').includes('benefit'))
check('  a new project is one', what('P-3').join() === 'added')
const quiet = packOf(plan([proj('P-1'), proj('P-2', { pic: 'kade', due: '2026-12-05', adjustedDue: '2026-12-05', baselineDue: '2026-12-01' })]), gov(), { raid, previous: before, now: '2026-11-15T10:00:00Z' })
check('NOTHING MATERIAL MOVED: NO CHANGES REPORTED (a 4-day slip is within tolerance)', quiet.changes.count === 0, JSON.stringify(quiet.changes))
check('THE PACK SAYS WHICH PACK IT WAS COMPARED WITH', after.meta.previous?.period === 'Week 46, 2026')
check('THE WATCHLIST: OVER BUDGET AND LATE, NOT THE FINISHED ONE',
  after.watchlist.some((w) => w.key === 'P-2' && w.reasons.includes('over budget') && w.reasons.some((r) => /late/.test(r))) && !after.watchlist.some((w) => w.key === 'P-1'),
  JSON.stringify(after.watchlist))
check('MAJOR FINANCIAL MOVES are compared too', Array.isArray(after.changes.financial))
check('VALIDATED BENEFITS ARE LISTED', after.benefits.validated.some((b) => b.key === 'P-2' && b.validatedBenefit > 0))

console.log('\n--- the board summary ---')
const b = boardSummary(after)
check('THE BOARD SUMMARY KEEPS ONLY ITS SECTIONS', Object.keys(b).sort().join() === ['changes', 'decisions', 'financial', 'meta', 'roadmap', 'strategic', 'watchlist'].sort().join(), Object.keys(b).join())
check('  with the period and definitions still on it', b.meta.period === 'Week 47, 2026' && b.meta.definitions.length === 8)
check('  and the financial movements, over budget and below the gate', Array.isArray(b.financial.moves) && b.financial.overBudget.some((r) => r.key === 'P-2'))

console.log(failures ? `\n${failures} pack check(s) failed` : '\nall pack checks passed')
process.exit(failures ? 1 : 0)
