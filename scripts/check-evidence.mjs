/**
 * Performance evidence: the seven dimensions per member, each from its
 * source or a gap, compared only within the same role and level, with team
 * outcomes kept apart and no ranking.
 *
 *   node scripts/check-evidence.mjs
 */
import { evidenceOf, reviewSnapshot, median, fmtDim } from '../src/lib/evidence.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b, tol = 1e-9) => a != null && b != null && Math.abs(a - b) <= tol

const people = [
  { id: 'james', nick: 'James', jiraNames: ['Pipat Singhasiri'] },
  { id: 'kade', nick: 'Kade', jiraNames: ['Jarinya Phosri'] },
  { id: 'gun', nick: 'Gun' },
  { id: 'it', nick: 'IT', scorecard: false },
  { id: 'gone', nick: 'Gone', deleted: true },
]
const P = (key, f) => ({ key, summary: key, commitLevel: 'commit', status: 'In Progress', manday: 0, ...f })
const projects = [
  // James: one on time, one slipped then delivered on its re-plan, one slipped and kept slipping.
  P('J-1', { pic: 'james', jiraKey: 'FNP-1', status: 'Done', due: '2026-06-30', baselineDue: '2026-06-30', actualEnd: '2026-07-05', manday: 10, savingHours: 40, partners: [{ person: 'Nipawan', roles: ['dev'] }] }),
  P('J-2', { pic: 'james', status: 'Done', due: '2026-03-31', baselineDue: '2026-03-31', adjustedDue: '2026-05-31', actualEnd: '2026-06-03', manday: 5 }),
  P('J-3', { pic: 'james', status: 'Done', due: '2026-02-28', baselineDue: '2026-02-28', adjustedDue: '2026-04-30', actualEnd: '2026-08-30' }),
  // Kade: one in progress, logged hours against a plan; James helps on it.
  P('K-1', { pic: 'kade', jiraKey: 'FNP-2', due: '2026-12-31', manday: 10, savingHours: 20, contributors: [{ person: 'kade', roles: ['dev'] }, { person: 'james', roles: ['qa'] }], shares: { kade: 1 } }),
  // Not on the team's book: excluded commitment.
  P('X-1', { pic: 'gun', commitLevel: 'excluded' }),
]
const plan = {
  projects,
  people,
  finance: { horizonMonths: 12, hoursPerManday: 8, hoursPerFteMonth: 176, acctHourRate: 100, devDayRate: 4000 },
  settings: { asOfDate: '2026-11-22', sprintDays: 14, savingBasis: 'monthly' },
}
const gov = {
  rates: {
    roles: [{ id: 'dev', name: 'Developer', hourlyRate: 500, status: 'approved' }],
    people: { james: { role: 'dev', level: 'Senior' }, kade: { role: 'dev', level: 'Senior' }, gun: { role: 'dev' } },
  },
  projects: { 'J-1': { benefit: { state: 'validated', actualHours: 35, expectedHours: 40 } }, 'K-1': { benefit: { state: 'approved', expectedHours: 18 } } },
  worklogs: {
    at: '2026-11-20T00:00:00Z',
    ok: true,
    byProject: {
      'FNP-1': { hours: 100, remainingHours: 0, byWeek: { '2026-06-01': { 'Pipat Singhasiri': 100 } } },
      'FNP-2': { hours: 40, remainingHours: 50, byWeek: { '2026-11-09': { 'Jarinya Phosri': 40 } } },
    },
  },
  blocked: { 'K-1': { weeks: 2, days: 10 } },
}
const activity = {
  james: { weeks: 10, weeksReported: 8, weeksPlanned: 9, updates: 30, blockers: 3, decisions: 1 },
  kade: { weeks: 10, weeksReported: 5, weeksPlanned: 10, updates: 12, blockers: 0, decisions: 0 },
}

const ev = evidenceOf(plan, gov, activity)
const byId = Object.fromEntries(ev.people.map((p) => [p.id, p]))
const j = byId.james
const k = byId.kade

check('THE TEAM ONLY: no IT, nobody deleted', ev.people.map((p) => p.id).join() === 'james,kade,gun')
check('DELIVERY: on time within tolerance over scored projects', near(j.dims.delivery.value, 1 / 3), j.dims.delivery.display)
check('  RECOVERY: a slip delivered on its re-planned date counts, one that kept slipping does not',
  j.dims.delivery.detail.find((d) => d.label === 'Recovery')?.value === 0.5, j.dims.delivery.detail.map((d) => d.display).join(' | '))
// James: FNP-1 planned 80 h, logged 100 + 0 left → error 0.25 → 75%.
check('FORECASTING: 1 − mean |actual + remaining − planned| ÷ planned', near(j.dims.forecasting.value, 0.75), j.dims.forecasting.display)
check('  date accuracy: median |finish − baseline| in days', j.dims.forecasting.detail.find((d) => d.label === 'Date accuracy')?.value === 64, j.dims.forecasting.detail[1]?.display)
// Kade: planned 80, logged 40 + 50 left = 90 → error 0.125.
check('  Kade’s from logged + remaining', near(k.dims.forecasting.value, 0.875))
check('QUALITY IS ALWAYS A GAP, NEVER A SCORE', ev.people.every((p) => p.dims.quality.value === null && /not read/.test(p.dims.quality.gap)))
check('COMPLEXITY IS A PROFILE: projects, planned man-days, outside dependencies',
  j.dims.complexity.value === 3 && j.dims.complexity.detail[0].value === 15 && j.dims.complexity.detail[1].value === 1 && k.dims.complexity.detail[1].value === 1)
check('OUTCOME: validated hours, with estimated and approved beside them',
  j.dims.outcome.value === 35 && j.dims.outcome.detail[0].value === 40 && j.dims.outcome.detail[1].value === 40)
check('  approved but not validated: a gap, never a zero', k.dims.outcome.value === null && /validated/.test(k.dims.outcome.gap) && k.dims.outcome.detail[1].value === 18)
check('OWNERSHIP: weeks reported, blockers raised, decisions asked', j.dims.ownership.value === 0.8 && j.dims.ownership.detail[1].value === 3 && j.dims.ownership.detail[2].value === 1)
check('  no check-in at all: a gap', byId.gun.dims.ownership.value === null && !!byId.gun.dims.ownership.gap)
check('COLLABORATION: projects owned by somebody else', j.dims.collaboration.value === 1 && k.dims.collaboration.value === 0)
check('  a real zero is a zero, not a gap', k.dims.collaboration.gap === null)
check('LIKE FOR LIKE: peers share role AND level', j.peers.join() === 'kade' && k.peers.join() === 'james' && byId.gun.peers.length === 0 && byId.gun.group === null)
check('  the peer median is of that group only', near(j.dims.forecasting.peerMedian, 0.8125) && j.dims.forecasting.peerN === 2, String(j.dims.forecasting.peerMedian))
check('  no role and level: no comparison at all', Object.values(byId.gun.dims).every((d) => d.peerMedian === null))
check('CONFIDENCE: the share of dimensions with data', near(j.confidence, 6 / 7) && near(k.confidence, 4 / 7) && near(byId.gun.confidence, 1 / 7), `${j.confidence} ${k.confidence} ${byId.gun.confidence}`)
check('NO RANKING AND NO OVERALL SCORE', ev.people.every((p) => !('score' in p) && !('rank' in p)))
check('GROUPS: like-for-like first, the unset last', ev.groups.map((g) => g.key).join() === 'dev|Senior,__unset')
check('TEAM OUTCOMES, KEPT APART', ev.team.outcome.value === 35 && ev.team.delivery.value != null)
const snap = reviewSnapshot(ev)
check('A FROZEN REVIEW KEEPS FIGURES, NOT FUNCTIONS', JSON.parse(JSON.stringify(snap)).people.length === 3 && snap.people[0].dims.delivery.display === j.dims.delivery.display)
check('median and formatting', median([3, null, 1, 2]) === 2 && median([]) === null && fmtDim('delivery', 0.5) === '50%' && fmtDim('outcome', 35) === '35 h/mo' && fmtDim('x', null) === '—')
const empty = evidenceOf({ ...plan, projects: [] }, { rates: {}, projects: {}, worklogs: null }, {})
check('NOTHING RECORDED: every dimension a gap except the descriptive ones', empty.people.every((p) => p.dims.delivery.value === null && p.dims.outcome.value === null && p.dims.complexity.value === null))

console.log(failures ? `\n${failures} evidence check(s) failed` : '\nall evidence checks passed')
process.exit(failures ? 1 : 0)
