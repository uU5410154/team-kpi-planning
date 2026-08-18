/**
 * Fill in the actual dates from Jira, for every keyed project in the shared
 * plan.
 *
 * Exactly what the Sync button on the Timeline does, run from here against the
 * shared plan rather than against one browser's copy — a sync that only ever
 * happened in somebody's tab is a sync nobody else can see.
 *
 * It writes actualStart and actualEnd and nothing else. The plan, the saving
 * hours, the effort and the objective are the register's and are not Jira's to
 * restate.
 *
 *   node scripts/sync-jira-actuals.mjs          # show what would change
 *   node scripts/sync-jira-actuals.mjs --write  # save it
 */
import { computePlan, repairState } from '../src/lib/model.js'

const BASE = process.env.KPI_BASE || 'https://team-kpi-planning.onrender.com'
const SCENARIO = process.env.KPI_SCENARIO || 'Baseline'
const WRITE = process.argv.includes('--write')
const KEY = /^[A-Za-z][A-Za-z0-9_]+-\d+$/

const doc = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const state = doc.payload?.state || doc.payload
console.log(`plan "${doc.name}" saved ${doc.updatedAt} by ${doc.updatedBy}: ${state.projects.length} projects`)

const keyed = state.projects.filter((p) => KEY.test(String(p.jiraKey || '').trim()))
console.log(`${keyed.length} carry a Jira key`)

const r = await (await fetch(`${BASE}/api/jira/issues`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: keyed.map((p) => p.jiraKey.trim()) }),
})).json()
if (r.error) throw new Error(r.error)
console.log(`Jira returned ${r.issues.length}${r.missing.length ? `, ${r.missing.length} missing: ${r.missing.join(', ')}` : ''}`)

const byKey = new Map(r.issues.map((i) => [i.key.toUpperCase(), i]))
let touched = 0
let fromCreated = 0
const projects = state.projects.map((p) => {
  const issue = byKey.get(String(p.jiraKey || '').trim().toUpperCase())
  if (!issue) return p
  const actualStart = issue.start || issue.created || null
  const actualEnd = issue.done ? (issue.resolved || null) : null
  if (issue.startSource === 'created') fromCreated += 1
  if (actualStart === (p.actualStart || null) && actualEnd === (p.actualEnd || null)) return p
  touched += 1
  return { ...p, actualStart, actualEnd }
})
console.log(`${touched} projects would change · ${fromCreated} starts taken from when the ticket was raised`)

const next = repairState({ ...state, projects })
const before = computePlan(repairState({ ...state }))
const after = computePlan(next)

const t = after.totals.timeliness
console.log('\nafter the sync:')
console.log(`  finished              ${before.totals.timeliness.finished} -> ${t.finished}`)
console.log(`  judged against a date ${before.totals.timeliness.judged} -> ${t.judged}`)
console.log(`  on time or better     ${before.totals.timeliness.onTime} -> ${t.onTime}`)
console.log(`  behind schedule       ${before.totals.timeliness.late} -> ${t.late}`)
console.log(`  average slip          ${before.totals.timeliness.avgSlip ?? '—'} -> ${t.avgSlip ?? '—'} days`)

const drawable = after.projects.filter((p) => p.timeline.actualStart || p.timeline.actualEnd)
console.log(`  rows with an ACTUAL bar to draw: ${drawable.length}`)
const split = { ahead: 0, on: 0, late: 0 }
for (const p of drawable) {
  if (p.timeline.lateBy == null) continue
  if (p.timeline.lateBy > 0) split.late += 1
  else if (p.timeline.lateBy < 0) split.ahead += 1
  else split.on += 1
}
console.log(`  of those: ${split.ahead} ahead · ${split.on} on the day · ${split.late} behind`)

// Nothing but the two dates may move.
const drift = []
state.projects.forEach((was, i) => {
  const now = projects[i]
  for (const f of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (f === 'actualStart' || f === 'actualEnd') continue
    if (JSON.stringify(was[f]) !== JSON.stringify(now[f])) drift.push(`${was.key}.${f}`)
  }
})
console.log(`  fields touched other than the two actual dates: ${drift.length ? drift.join(', ') : 'none'}`)
if (drift.length) throw new Error('refusing to write: something other than the actual dates changed')

if (!WRITE) { console.log('\nDRY RUN — pass --write to save it'); process.exit(0) }

const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: next, updatedBy: 'Jira actuals sync' }),
})
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
const back = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const rb = back.payload?.state || back.payload
console.log(`\nSAVED — ${rb.projects.filter((p) => p.actualStart || p.actualEnd).length} projects now carry actual dates`)
