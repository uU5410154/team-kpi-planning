/**
 * Add P'Pla and Fia's rows (94-156) to the shared plan.
 *
 * The file is one of this app's own register exports with sixty-three rows
 * appended below it. Only the appended block is read — the rows above it are
 * already in the plan and re-importing them would be a round trip, not an add.
 *
 * PIC is `user`: the business owns these, so they sit on the register and
 * outside the team's committed hours. Mandays are left empty, as asked — an
 * effort figure nobody has given is not zero.
 *
 *   node scripts/add-fia.mjs          # show what would be written
 *   node scripts/add-fia.mjs --write  # write it
 */
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'node:url'
import { newProject, computePlan, repairState, fmtHours } from '../src/lib/model.js'
import { OBJECTIVES } from '../src/lib/palette.js'

const BASE = process.env.KPI_BASE || 'https://team-kpi-planning.onrender.com'
const SCENARIO = process.env.KPI_SCENARIO || 'Baseline'
const WRITE = process.argv.includes('--write')
const FIRST = 94
const LAST = 156

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(fileURLToPath(new URL("../P'Pla_Fia_added.xlsx", import.meta.url)))
const ws = wb.getWorksheet('Projects')
const txt = (c) => {
  const v = c && c.value
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10)
    return String(v.richText ? v.richText.map((t) => t.text).join('') : (v.text ?? v.result ?? ''))
  }
  return String(v)
}
const H = {}
for (let c = 1; c <= ws.columnCount; c++) H[txt(ws.getRow(4).getCell(c)).trim()] = c
const cell = (r, label) => txt(ws.getRow(r).getCell(H[label])).trim()

/* Objective by the name the sheet writes, not by position. */
const objByLabel = (label) => {
  const t = label.toLowerCase()
  const hit = OBJECTIVES.find((o) => t.startsWith(`${o.no}.`) || t.includes(o.name.toLowerCase()))
  return hit ? hit.id : 'process_automation'
}
const num = (s) => {
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const statusOf = (s) => {
  const t = s.toLowerCase().replace(/\s+/g, '')
  if (t.startsWith('done')) return 'Done'
  if (t.startsWith('inprogress')) return 'In Progress'
  if (t.startsWith('notstart')) return 'Not Start'
  return s || 'Not Start'
}

const rows = []
for (let r = FIRST; r <= Math.min(LAST, ws.rowCount); r++) {
  const summary = cell(r, 'Project')
  if (!summary) continue
  rows.push({
    r,
    summary,
    program: cell(r, 'Programme'),
    team: cell(r, 'Team'),
    subTeam: cell(r, 'Sub team'),
    objective: objByLabel(cell(r, 'Objective')),
    requestedBy: cell(r, 'PIC'),
    hours: num(cell(r, 'Saving hrs/month')),
    status: statusOf(cell(r, 'Status')),
    remark: cell(r, 'Remark'),
    commit: cell(r, 'Commit'),
  })
}
console.log(`read rows ${FIRST}-${LAST}: ${rows.length} projects, ${fmtHours(rows.reduce((a, x) => a + (x.hours || 0), 0))} hrs/month`)

const built = rows.map((x, i) => ({
  ...newProject(i + 1),
  key: `FIA-${x.r}`,
  jiraKey: '',
  summary: x.summary,
  program: x.program,
  team: x.team,
  subTeam: x.subTeam,
  objective: x.objective,
  pic: 'user',
  savingHours: x.hours,
  savingEstimated: false,
  // Left empty on purpose. Effort nobody has estimated is unknown, and zero
  // would report a project that cost nothing to build.
  manday: null,
  mandayEstimated: true,
  commitLevel: x.commit || 'commit',
  status: x.status,
  notes: x.remark,
  // Whose row it is, kept where it can be read. The PIC column is the app's
  // ownership field and these are all the business's.
  comment: [
    x.requestedBy ? `Owner: ${x.requestedBy}` : '',
    x.remark ? `Tool: ${x.remark}` : '',
    `Source: P'Pla_Fia_added.xlsx row ${x.r}`,
  ].filter(Boolean).join('\n'),
}))

const doc = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const state = doc.payload?.state || doc.payload
console.log(`shared plan saved ${doc.updatedAt} by ${doc.updatedBy}: ${state.projects.length} projects`)
const have = new Set(state.projects.map((p) => p.key))
const fresh = built.filter((p) => !have.has(p.key))
console.log(`${fresh.length} new, ${built.length - fresh.length} already present`)

const next = repairState({ ...state, projects: [...fresh, ...state.projects] })
const before = computePlan(repairState({ ...state }))
const after = computePlan(next)
const line = (l, get) => console.log(`  ${l.padEnd(24)} ${fmtHours(get(before)).padStart(9)} -> ${fmtHours(get(after)).padStart(9)}`)
line('projects', (p) => p.projects.length)
line('committed hrs (ours)', (p) => p.totals.committedHours)
line('book total', (p) => p.totals.totalHours)
line('owned outside the team', (p) => p.totals.outsideHours)
// Stored as null. computePlan reads an unrecorded effort as 0, exactly as it
// does for every other project nobody has estimated yet.
console.log(`  ${'mandays left empty'.padEnd(24)} ${next.projects.filter((p) => p.key.startsWith('FIA-')).every((p) => p.manday === null && !(p.tasks || []).length)}`)
console.log(`  ${'all on User'.padEnd(24)} ${after.projects.filter((p) => p.key.startsWith('FIA-')).every((p) => p.pic === 'user' && p.outsideTeam)}`)
console.log(`  ${'cards unchanged'.padEnd(24)} ${JSON.stringify(before.people.map((p) => Math.round(p.kpiTotals.savingHours))) === JSON.stringify(after.people.map((p) => Math.round(p.kpiTotals.savingHours)))}`)
console.log(`  ${'scorecards valid'.padEnd(24)} ${after.invalid.length === 0}`)

if (!WRITE) { console.log('\nDRY RUN — pass --write to save it'); process.exit(0) }
const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: next, updatedBy: "P'Pla/Fia import" }),
})
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
const back = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const rb = back.payload?.state || back.payload
console.log(`\nSAVED — read back ${rb.projects.length} projects, ${built.filter((p) => rb.projects.some((x) => x.key === p.key)).length} of ${built.length} new rows present`)
