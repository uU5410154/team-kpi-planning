/**
 * Bring the register's committed finish dates into line with the board, ONCE.
 *
 * From here on the sync keeps them aligned and records every move as a re-plan.
 * This first alignment must not be: twenty-nine rows had simply never been
 * updated, and charging each of them somebody's one free re-plan would spend
 * the whole team's allowance on a data correction nobody made.
 *
 * So the date is taken from Jira AND the baseline is reset to it, leaving the
 * re-plan count exactly where it was. What was promised is now what the board
 * says was promised, and the next move — a real one — is the one that counts.
 *
 *   node scripts/align-due.mjs          # what it would change
 *   node scripts/align-due.mjs --write  # do it
 */
import { computePlan, repairState, driftOf, isDate } from '../src/lib/model.js'
import { JIRA_KEY } from '../src/lib/jiraMerge.js'

const BASE = process.env.KPI_BASE || 'https://team-kpi-planning.onrender.com'
const SCENARIO = process.env.KPI_SCENARIO || 'Baseline'
const WRITE = process.argv.includes('--write')

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

const doc = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const state = doc.payload?.state || doc.payload
console.log(`plan "${doc.name}" saved ${doc.updatedAt} by ${doc.updatedBy}: ${state.projects.length} projects\n`)

const keys = state.projects.map((p) => String(p.jiraKey || '').trim()).filter((k) => JIRA_KEY.test(k))
const [{ issues }, rolled] = await Promise.all([
  post('/api/jira/issues', { keys }),
  // The sprints the work under each epic is booked into, for the epics that
  // carry neither a due date nor a sprint of their own.
  post('/api/jira/rollup', { keys }),
])
const jira = new Map(issues.map((i) => [i.key, i]))
const tasks = rolled.byParent || {}
console.log(`${issues.length} of ${keys.length} keys found on the board`)

/*
 * The date this project is committed to, by the same rule the sync uses: the
 * epic's own due date, then the sprint the epic is in, then the last sprint
 * the work under it is booked into. Never the latest DEADLINE typed on a task
 * — a deadline on a task is not a commitment made for the project.
 */
const dueFor = (raw, j) => (j && (j.due || j.sprintEnd || tasks[raw.jiraKey]?.latestSprintEnd)) || null

const before = computePlan(repairState({ ...state }))
const rowOf = new Map(before.projects.map((p) => [p.key, p]))

const moves = state.projects
  .map((raw) => ({ raw, j: jira.get(raw.jiraKey), row: rowOf.get(raw.key) }))
  // Only where Jira HAS a date and it differs. A blank on the board is an
  // absence of information, never an instruction to drop a commitment.
  .map((m) => ({ ...m, want: dueFor(m.raw, m.j) }))
  .filter(({ raw, want }) => isDate(want) && want !== (raw.due || null))
  .sort((a, b) => String(a.want).localeCompare(String(b.want)))

console.log(`\n${moves.length} commitment(s) to bring into line:\n`)
console.log(`  ${'KEY'.padEnd(10)} ${'PIC'.padEnd(9)} ${'REGISTER'.padEnd(11)} ${'JIRA'.padEnd(11)} `
  + `${'MOVE'.padStart(6)}  PROJECT`)
for (const { raw, j, row, want } of moves) {
  const days = Math.round((Date.parse(want) - Date.parse(raw.due || want)) / 86400000)
  console.log(`  ${String(raw.jiraKey).padEnd(10)} ${String(row?.pic || '—').padEnd(9)} `
    + `${String(raw.due || '—').padEnd(11)} ${String(want).padEnd(11)} `
    + `${(days > 0 ? `+${days}` : String(days)).padStart(6)}  ${String(raw.summary).slice(0, 40)}`
  )
}

const next = repairState({
  ...state,
  projects: state.projects.map((raw) => {
    const hit = moves.find((m) => m.raw.key === raw.key)
    if (!hit) return raw
    /*
     * The baseline moves WITH the date and the re-plan count does not. That is
     * the whole difference between a correction and a re-plan: after this, the
     * register says this project was always due on the day the board says it
     * was, and nobody has spent anything.
     */
    return { ...raw, due: hit.want, baselineDue: hit.want }
  }),
})
const after = computePlan(next)

/* Nobody's free re-plan may be spent by this. */
const spent = state.projects.filter((raw) => {
  const now = next.projects.find((x) => x.key === raw.key)
  return (now?.replanCount || 0) !== (raw.replanCount || 0)
})
console.log(`\nre-plans charged by this correction: ${spent.length} (must be 0)`)

const backwards = (plan) => plan.projects.filter((p) => p.timeline.plannedDays != null && p.timeline.plannedDays < 0).length
console.log('\nwhat it fixes:')
console.log(`  plans running backwards      ${String(backwards(before)).padStart(4)} -> ${backwards(after)}`)
console.log(`  past due, unfinished         ${String(before.totals.timeliness.overdue).padStart(4)} -> ${after.totals.timeliness.overdue}`)
console.log(`  committed hrs                ${String(Math.round(before.totals.committedHours)).padStart(4)} -> ${Math.round(after.totals.committedHours)}  (must not move)`)
console.log(`  projects                     ${String(before.projects.length).padStart(4)} -> ${after.projects.length}  (must not move)`)

console.log('\nobjective 1, before and after:')
for (const p of after.people) {
  const la = p.kpiLines.find((l) => l.objective === 'delivery')
  const lb = before.people.find((x) => x.id === p.id).kpiLines.find((l) => l.objective === 'delivery')
  if (!la?.held) continue
  console.log(`  ${p.nick.padEnd(9)} ${`${lb.driftedCount} -> ${la.driftedCount}`.padStart(8)} of ${String(la.held).padEnd(3)}`
    + ` limit ${String(la.allowedCount).padEnd(2)} ${lb.meetsTarget ? 'within' : 'OVER'} -> ${la.meetsTarget ? 'within' : 'OVER'}`)
}

/* And the one the question was asked about. */
const check = after.projects.find((p) => p.jiraKey === 'FNP-1065')
if (check) {
  const d = driftOf(check)
  console.log(`\nFNP-1065 "${check.summary.slice(0, 40)}": due ${check.due},`
    + ` plan ${check.timeline.plannedDays} days, allowance ${Math.round(d.allowance ?? 0)} days`)
}

if (!WRITE) { console.log('\nDRY RUN — pass --write to save it'); process.exit(0) }
if (spent.length) throw new Error('this would charge a re-plan — refusing')
const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: next, updatedBy: 'align committed finish dates with Jira (one-off, re-baselined)' }),
})
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
console.log('\nSAVED')
