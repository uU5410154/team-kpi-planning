/**
 * Hold the finish date on projects that were delivered on time and closed late.
 *
 * Jira stamps its resolution date when somebody drags the last card. On work
 * that was delivered months before anybody got round to closing it, that date
 * is not when the work landed — and Jira will not let it be corrected. So the
 * register takes its own copy: the finish is set to the date committed to, the
 * project stops reading as late, and the flag stops the next sync putting the
 * wrong date back.
 *
 * Nothing else about these projects changes, and nothing is chosen for anybody:
 * it prints what it would do and only writes when told to.
 *
 *   node scripts/hold-finish.mjs               # what it would hold
 *   node scripts/hold-finish.mjs --all         # include the ones inside their allowance
 *   node scripts/hold-finish.mjs --keys A,B    # only these Jira keys
 *   node scripts/hold-finish.mjs --write       # do it
 *   node scripts/hold-finish.mjs --release --keys A   # hand one back to the sync
 */
import { computePlan, repairState, driftOf, pinFinishPatch, unpinFinishPatch } from '../src/lib/model.js'

const BASE = process.env.KPI_BASE || 'https://team-kpi-planning.onrender.com'
const SCENARIO = process.env.KPI_SCENARIO || 'Baseline'
const WRITE = process.argv.includes('--write')
const ALL = process.argv.includes('--all')
const RELEASE = process.argv.includes('--release')
const keyArg = process.argv.find((a) => a.startsWith('--keys'))
const ONLY = keyArg
  ? new Set((keyArg.includes('=') ? keyArg.split('=')[1] : process.argv[process.argv.indexOf(keyArg) + 1] || '')
    .split(/[,\s]+/).map((k) => k.trim().toUpperCase()).filter(Boolean))
  : null

const doc = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const state = doc.payload?.state || doc.payload
console.log(`plan "${doc.name}" saved ${doc.updatedAt} by ${doc.updatedBy}: ${state.projects.length} projects\n`)

const before = computePlan(repairState({ ...state }))
const byKey = new Map(before.projects.map((p) => [p.key, p]))

/*
 * The candidates: FINISHED, and finished after the date committed to. A
 * project still running is not one of these — its date has not been recorded
 * late, it has not been recorded at all — and nothing here touches one.
 */
const rows = state.projects
  .map((raw) => ({ raw, p: byKey.get(raw.key) }))
  .filter(({ p }) => p && p.timeline.actualEnd && p.due && p.timeline.actualEnd > p.due)
  .map(({ raw, p }) => ({ raw, p, drift: driftOf(p) }))
  .filter(({ drift }) => ALL || drift.drifted === true)
  .filter(({ raw, p }) => !ONLY || ONLY.has(String(p.jiraKey || raw.key).toUpperCase()))
  .sort((a, b) => (b.drift.days ?? 0) - (a.drift.days ?? 0))

if (RELEASE) {
  const held = state.projects.filter((raw) => raw.actualEndPinned
    && (!ONLY || ONLY.has(String(raw.jiraKey || raw.key).toUpperCase())))
  console.log(`releasing ${held.length} project(s) back to the sync:`)
  for (const raw of held) console.log(`  ${String(raw.jiraKey || raw.key).padEnd(10)} ${raw.summary}`)
  if (!WRITE) { console.log('\nDRY RUN — pass --write to save it'); process.exit(0) }
  const next = repairState({
    ...state,
    projects: state.projects.map((raw) => (held.some((h) => h.key === raw.key)
      ? { ...raw, ...unpinFinishPatch() }
      : raw)),
  })
  const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: next, updatedBy: 'release held finish dates' }),
  })
  if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
  console.log('\nSAVED')
  process.exit(0)
}

console.log(`${rows.length} finished project(s) whose recorded finish is after the date committed to`
  + `${ALL ? '' : ' AND past their allowance'}:\n`)
console.log(`  ${'KEY'.padEnd(10)} ${'PIC'.padEnd(9)} ${'COMMITTED'.padEnd(11)} ${'RECORDED'.padEnd(11)} `
  + `${'LATE'.padStart(5)} ${'ALLOWED'.padStart(8)}  PROJECT`)
for (const { raw, p, drift } of rows) {
  console.log(`  ${String(p.jiraKey || raw.key).padEnd(10)} ${String(p.pic || '—').padEnd(9)} `
    + `${String(p.due).padEnd(11)} ${String(p.timeline.actualEnd).padEnd(11)} `
    + `${String(drift.days ?? '—').padStart(5)} ${String(drift.allowance == null ? '—' : Math.round(drift.allowance)).padStart(8)}`
    + `  ${String(p.summary).slice(0, 52)}`)
}

/* What holding them does to the objective, person by person. */
const next = repairState({
  ...state,
  projects: state.projects.map((raw) => {
    const hit = rows.find((r) => r.raw.key === raw.key)
    return hit ? { ...raw, ...pinFinishPatch(raw, hit.p.due) } : raw
  }),
})
const after = computePlan(next)

console.log('\nobjective 1, before and after:')
console.log(`  ${'PERSON'.padEnd(9)} ${'DRIFTED'.padStart(9)}  ${'LIMIT'.padStart(6)}  VERDICT`)
for (const p of after.people) {
  const was = before.people.find((x) => x.id === p.id)
  const lb = was.kpiLines.find((l) => l.objective === 'delivery')
  const la = p.kpiLines.find((l) => l.objective === 'delivery')
  if (!la || !la.held) continue
  console.log(`  ${p.nick.padEnd(9)} ${`${lb.driftedCount} → ${la.driftedCount} of ${la.held}`.padStart(9)}`
    + `  ${`${la.allowedCount}`.padStart(6)}  `
    + `${lb.meetsTarget ? 'within' : 'OVER'} → ${la.meetsTarget ? 'within' : 'OVER'}`)
}

const sum = (plan) => Math.round(plan.totals.committedHours)
console.log(`\ncommitted hrs ${sum(before)} → ${sum(after)} (must not move)`)
console.log(`projects ${before.projects.length} → ${after.projects.length} (must not move)`)
console.log(`held after this: ${next.projects.filter((p) => p.actualEndPinned).length}`)

if (!WRITE) { console.log('\nDRY RUN — pass --write to save it'); process.exit(0) }
const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: next, updatedBy: 'hold finish dates on late-closed projects' }),
})
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
console.log('\nSAVED')
