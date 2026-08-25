/**
 * The committed finish date, and the board it now follows.
 *
 * This one field was deliberately left out of the sync for months, because it
 * is what objective 1 is measured against. What changed is that this server
 * cannot write to Jira: the board is where these dates are actually moved, and
 * twenty-nine of them had drifted away from the register — a project due in
 * November there and July here is not a commitment anybody is managing to.
 *
 * So it syncs, and the whole question is how it is ACCOUNTED FOR: a moved
 * commitment has to arrive as a re-plan, first one free and the rest counted,
 * exactly as if somebody had typed it in the app. That is what this checks,
 * along with the two things a date sync must never do — invent one, or delete
 * one.
 *
 *   node scripts/check-duesync.mjs
 */
import { mergeJira } from '../src/lib/jiraMerge.js'
import { computePlan, repairState, driftOf, replanPatch } from '../src/lib/model.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const base = {
  key: 'P1',
  jiraKey: 'FNP-1065',
  summary: 'Net margin / Gross margin / RTC / Stock Provision',
  pic: 'gun',
  objective: 'efficiency',
  commitLevel: 'commit',
  start: '2026-07-01',
  due: '2026-07-31',
  baselineDue: '2026-07-31',
  savingHours: 8,
}
const issue = (over = {}) => ({
  key: 'FNP-1065',
  summary: base.summary,
  start: '2026-07-01',
  due: '2026-11-13',
  created: '2026-06-01',
  ...over,
})
const state = (projects) => ({ projects, people: [], settings: {} })
const feed = (over = {}, rollups = {}) => ({ issues: [issue(over)], epics: [], rollups })

console.log('— the date itself —')
const r1 = mergeJira(state([base]), feed(), {})
const p1 = r1.projects[0]
check('THE COMMITTED FINISH FOLLOWS THE BOARD', p1.due === '2026-11-13', p1.due)
check('and the sync says whose commitment moved', r1.replanned === 1
  && r1.replans[0].key === 'FNP-1065' && r1.replans[0].from === '2026-07-31' && r1.replans[0].to === '2026-11-13',
JSON.stringify(r1.replans))
check('a date Jira does not have is not a date to copy',
  mergeJira(state([base]), feed({ due: null }), {}).projects[0].due === '2026-07-31')
check('...and never deletes the commitment the register holds',
  mergeJira(state([base]), feed({ due: undefined }), {}).projects[0].due === '2026-07-31')
check('the same date twice changes nothing',
  mergeJira(state([p1]), feed(), {}).updated === 0)
check('a project with no Jira key is not touched',
  mergeJira(state([{ ...base, jiraKey: null }]), feed(), {}).projects[0].due === '2026-07-31')

console.log('\n— how it is accounted for —')
/*
 * The count is of MOVES, and the first one is the free re-plan: one move is
 * spent-but-allowed, two is drift. So the boundary is asserted on what it
 * MEANS — does this project now drift — rather than on the number, which is
 * the thing that is easy to be off by one about.
 */
const finished = (p, on) => driftOf(computePlan(repairState(state([{ ...p, actualEnd: on }]))).projects[0])
check('the FIRST move re-baselines and is free',
  p1.baselineDue === '2026-07-31' && (p1.replanCount || 0) === 1
  && finished(p1, '2026-11-13').overReplanned === false
  && finished(p1, '2026-11-13').drifted === false,
  `baseline ${p1.baselineDue}, moves ${p1.replanCount || 0}`)
const r2 = mergeJira(state([p1]), feed({ due: '2026-12-24' }), {})
const p2 = r2.projects[0]
check('a SECOND move is drift even if it then lands on the day',
  (p2.replanCount || 0) === 2
  && finished(p2, '2026-12-24').overReplanned === true
  && finished(p2, '2026-12-24').drifted === true,
  `moves ${p2.replanCount}`)
check('...and the baseline still says what was first promised',
  p2.baselineDue === '2026-07-31', p2.baselineDue)
const p3 = mergeJira(state([p2]), feed({ due: '2027-01-30' }), {}).projects[0]
check('a THIRD move counts again', (p3.replanCount || 0) === 3, String(p3.replanCount))
check('...and that is still drift whatever the dates then say',
  finished(p3, '2027-01-30').drifted === true)
check('a project the board never moved has spent nothing',
  (mergeJira(state([base]), feed({ due: base.due }), {}).projects[0].replanCount || 0) === 0)
check('the sync accounts for a move exactly as the app does',
  JSON.stringify(mergeJira(state([base]), feed(), {}).projects[0].baselineDue)
  === JSON.stringify({ ...base, ...replanPatch(base, '2026-11-13') }.baselineDue))

console.log('\n— what moves with it —')
const plan = computePlan(repairState(state([p1])))
const row = plan.projects[0]
check('the timeline draws the new date', row.timeline.plannedEnd === '2026-11-13', row.timeline.plannedEnd)
check('and the plan is that much longer',
  row.timeline.plannedDays === 135, String(row.timeline.plannedDays))
check('the allowance grows with the plan it is 20% of',
  Math.round(driftOf(row).allowance) === 27, String(Math.round(driftOf(row).allowance ?? 0)))
check('a project not yet due is not overdue',
  row.timeline.overdue === false)
check('the saving hours do not move with the date',
  plan.totals.committedHours === computePlan(repairState(state([base]))).totals.committedHours)

console.log('\n— and the fields it must not touch —')
const held = { ...p1, actualEnd: '2026-08-01', actualEndPinned: true }
const after = mergeJira(state([held]), feed({ resolved: '2026-11-20', done: true }), {})
check('a held finish is still held while the commitment moves',
  after.projects[0].actualEnd === '2026-08-01' && after.projects[0].actualEndPinned === true)
const rich = { ...base, savingHours: 8, manday: 12, pic: 'gun', objective: 'efficiency', commitLevel: 'commit' }
const kept = mergeJira(state([rich]), feed(), {}).projects[0]
check('the hours, the effort, the owner and the objective are the register\'s',
  kept.savingHours === 8 && kept.manday === 12 && kept.pic === 'gun'
  && kept.objective === 'efficiency' && kept.commitLevel === 'commit')

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
