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

console.log('\n— an epic with no date of its own —')
const undated = { ...base, due: null, baselineDue: null }
const sprint = { sprintEnd: '2026-10-31', sprintName: 'FNP Sprint 21' }
const filled = mergeJira(state([undated]), feed({ due: null, ...sprint }), {}).projects[0]
check('THE SPRINT IT IS IN STANDS IN FOR THE DUE DATE',
  filled.due === '2026-10-31', String(filled.due))
check('...and the sync says the date came from a sprint',
  mergeJira(state([undated]), feed({ due: null, ...sprint }), {}).replans[0].fromSprint === true)
check('...and a first commitment spends no re-plan',
  (filled.replanCount || 0) === 0 && filled.baselineDue === '2026-10-31',
  `baseline ${filled.baselineDue}, moves ${filled.replanCount || 0}`)
check('a DATED epic is not overruled by a sprint it sits in',
  mergeJira(state([undated]), feed({ due: '2026-09-01', ...sprint }), {}).projects[0].due === '2026-09-01')
check('no due date and no sprint leaves it undated',
  mergeJira(state([undated]), feed({ due: null }), {}).projects[0].due === null)

/*
 * And where the epic is in no sprint either, the sprints the work UNDER it is
 * booked into answer for it. FNP-1691 carries no due date and no sprint, and
 * its last task sits in Sprint 11 Week 1 ending 13 September — a date somebody
 * scheduled, not one inferred from a deadline typed on a task.
 */
const taskSprints = { 'FNP-1065': { total: 4, done: 1, latestSprintEnd: '2026-09-13', latestDue: '2026-08-28' } }
const fromTasks = mergeJira(state([undated]), feed({ due: null }, taskSprints), {}).projects[0]
check('THE LAST SPRINT THE WORK IS BOOKED INTO ANSWERS FOR AN UNDATED EPIC',
  fromTasks.due === '2026-09-13', String(fromTasks.due))
check('...and NOT the latest deadline typed on a task',
  fromTasks.due !== '2026-08-28')
check('...and the sync says which sprint answered for it',
  mergeJira(state([undated]), feed({ due: null }, taskSprints), {}).replans[0].fromTaskSprint === true)
check('the epic\'s own sprint still beats the tasks\'',
  mergeJira(state([undated]), feed({ due: null, ...sprint }, taskSprints), {}).projects[0].due === '2026-10-31')
check('and its own due date beats both',
  mergeJira(state([undated]), feed({ due: '2026-09-01', ...sprint }, taskSprints), {}).projects[0].due === '2026-09-01')
check('tasks in no sprint fill nothing',
  mergeJira(state([undated]), feed({ due: null }, { 'FNP-1065': { total: 3, done: 0, latestDue: '2026-12-31' } }), {})
    .projects[0].due === null)
/*
 * And NOT from the tasks underneath. That was built, applied to the live plan
 * and taken back within the hour: an epic nobody has dated is a commitment
 * nobody has made, and six live commitments moved on the strength of undated
 * tickets — one of them five months earlier than what had been agreed.
 */
const roll = { 'FNP-1065': { total: 4, done: 1, latestDue: '2027-06-30', anyStarted: true } }
check('THE TASKS UNDERNEATH DO NOT SET THE PROJECT\'S DATE',
  mergeJira(state([undated]), feed({ due: null }, roll), {}).projects[0].due === null,
  String(mergeJira(state([undated]), feed({ due: null }, roll), {}).projects[0].due))
check('...not even where the register already holds one',
  mergeJira(state([base]), feed({ due: null }, roll), {}).projects[0].due === '2026-07-31')

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

console.log('\n— and a row somebody took out of the plan —')
/*
 * EXCLUDED MEANS EXCLUDED.
 *
 * A person has decided this row is not part of the year — a duplicate, a
 * ticket raised by mistake, work that was dropped. A sync that keeps
 * rewriting its dates, its name, its owner and its task counts is arguing
 * with that decision every morning.
 */
const dropped = {
  ...base,
  commitLevel: 'excluded',
  summary: 'The name somebody gave it here',
  start: '2026-01-01',
  due: '2026-02-01',
  pic: null,
  actualEnd: null,
  tasksTotal: 0,
  tasksDone: 0,
}
const loud = {
  issues: [issue({
    summary: 'Renamed in Jira',
    start: '2026-07-07',
    due: '2026-12-31',
    assignee: 'Nakittapon Imjaijaroenying',
    resolved: '2026-11-30',
    done: true,
    started: true,
  })],
  epics: [],
  rollups: { 'FNP-1065': { total: 9, done: 9, allDone: true, anyStarted: true, started: true, latestResolved: '2026-11-30', latestDue: '2026-12-31', latestSprintEnd: '2027-01-09', latestDelayDue: '2027-02-02', delayKey: 'FNP-9' } },
}
const untouched = mergeJira(state([dropped]), loud, { addNew: false })
const still = untouched.projects[0]
check('AN EXCLUDED ROW IS NOT TOUCHED AT ALL',
  JSON.stringify(still) === JSON.stringify(dropped),
  Object.keys(dropped).concat(Object.keys(still))
    .filter((k, i, a) => a.indexOf(k) === i)
    .filter((k) => JSON.stringify(dropped[k]) !== JSON.stringify(still[k]))
    .map((k) => `${k}: ${JSON.stringify(dropped[k])} -> ${JSON.stringify(still[k])}`).join(' | ') || 'identical')
check('  its commitment does not move', still.due === '2026-02-01')
check('  nor its start', still.start === '2026-01-01')
check('  nor its name', still.summary === 'The name somebody gave it here')
check('  nor its owner — not even into a blank one', still.pic === null)
check('  nor its finish', still.actualEnd === null)
check('  nor its task counts', still.tasksTotal === 0 && still.tasksDone === 0)
check('  and no adjusted date is drawn on it', !still.adjustedDue)
check('  it spends no re-plan', (still.replanCount || 0) === 0)
check('  the sync reports having left it alone',
  untouched.skippedExcluded === 1, String(untouched.skippedExcluded))
check('  and reports nothing else about it',
  untouched.updated === 0 && untouched.reassigned === 0
  && untouched.replanned === 0 && untouched.picDisagreements === 0,
  JSON.stringify({ updated: untouched.updated, reassigned: untouched.reassigned }))
check('  running it twice still changes nothing',
  JSON.stringify(mergeJira(state([still]), loud, { addNew: false }).projects[0]) === JSON.stringify(dropped))
/*
 * AND NO COMMIT LEVEL IS EVER WRITTEN ON AN EXISTING ROW.
 *
 * Excluded is the one somebody notices when it flips, but the guarantee is
 * wider and cheaper to state: whether a project counts this year is a decision
 * a person makes, and a sync has no opinion about it. Checked for every level
 * there is, so a new one cannot arrive without this rule applying to it.
 */
for (const level of ['commit', 'stretch', 'watch', 'nextyear', 'excluded']) {
  const row = { ...dropped, commitLevel: level }
  const out = mergeJira(state([row]), loud, { addNew: false }).projects[0]
  check(`  a ${level} row keeps its commit level through a sync`,
    out.commitLevel === level, `${level} -> ${out.commitLevel}`)
}

check('AND THE SAME ROW, NOT EXCLUDED, DOES CHANGE — so this is the flag doing it',
  mergeJira(state([{ ...dropped, commitLevel: 'commit' }]), loud, { addNew: false }).updated === 1)
check('  putting it back in the plan lets the sync have it again',
  mergeJira(state([{ ...dropped, commitLevel: 'commit' }]), loud, { addNew: false })
    .projects[0].summary === 'Renamed in Jira')

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
