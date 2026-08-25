/**
 * Run the CURRENT merge against the shared plan, from here.
 *
 * The same rule the app and the 07:00 job use — imported, not reimplemented —
 * but runnable before the change has finished deploying, which is what makes
 * it useful for a correction somebody is waiting on.
 *
 *   node scripts/sync-jira-now.mjs          # show what would change
 *   node scripts/sync-jira-now.mjs --write  # save it
 *   node scripts/sync-jira-now.mjs --add    # also pull in epics the register lacks
 */
import { computePlan, repairState } from '../src/lib/model.js'
import { mergeJira, JIRA_KEY } from '../src/lib/jiraMerge.js'

const BASE = process.env.KPI_BASE || 'https://team-kpi-planning.onrender.com'
const SCENARIO = process.env.KPI_SCENARIO || 'Baseline'
const WRITE = process.argv.includes('--write')
const ADD = process.argv.includes('--add')

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data
}

const doc = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const state = doc.payload?.state || doc.payload
console.log(`plan "${doc.name}" saved ${doc.updatedAt} by ${doc.updatedBy}: ${state.projects.length} projects`)

const keys = state.projects.map((p) => String(p.jiraKey || '').trim()).filter((k) => JIRA_KEY.test(k))
const [issues, rollup, board] = await Promise.all([
  post('/api/jira/issues', { keys }),
  post('/api/jira/rollup', { keys }),
  ADD ? (await fetch(`${BASE}/api/jira/epics`)).json() : Promise.resolve({ epics: [] }),
])
console.log(`Jira: ${issues.issues.length} issues, ${rollup.tasks} tasks under them`
  + `${ADD ? `, ${board.epics.length} epics on the board` : ''}`)

const r = mergeJira(
  state,
  { issues: issues.issues, epics: board.epics || [], rollups: rollup.byParent || {} },
  { addNew: ADD },
)

/*
 * Field by field, so the report says what actually moved rather than how many
 * rows were touched — "46 changed" is not something anybody can check.
 */
const moved = {}
state.projects.forEach((was, i) => {
  const now = r.projects[i]
  if (!now) return
  for (const f of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (JSON.stringify(was[f]) !== JSON.stringify(now[f])) moved[f] = (moved[f] || 0) + 1
  }
})
console.log('\nfields that move:')
for (const [f, n] of Object.entries(moved).sort((a, b) => b[1] - a[1])) console.log(`  ${f.padEnd(14)} ${n}`)
if (r.added) console.log(`  ${'added rows'.padEnd(14)} ${r.added}`)

const before = computePlan(repairState({ ...state }))
const after = computePlan(repairState({ ...state, projects: r.projects }))
const line = (label, get) => console.log(`  ${label.padEnd(30)} ${String(get(before)).padStart(6)} -> ${String(get(after)).padStart(6)}`)
console.log('\nwhat it moves:')
line('projects starting Jan 2026', (p) => p.projects.filter((x) => String(x.start || '').startsWith('2026-01')).length)
line('plans running backwards', (p) => p.projects.filter((x) => x.timeline.plannedDays < 0).length)
line('past due, unfinished', (p) => p.totals.timeliness.overdue)
line('committed hrs', (p) => Math.round(p.totals.committedHours))
console.log(`  ${'due dates changed'.padEnd(30)} ${moved.due || 0} (each one recorded as a re-plan)`)

if (!WRITE) { console.log('\nDRY RUN — pass --write to save it'); process.exit(0) }
const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    payload: repairState({ ...state, projects: r.projects }),
    updatedBy: 'align start dates with Jira',
  }),
})
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
console.log('\nSAVED')
