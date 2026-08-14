/**
 * Add the AR B2B automation initiatives to the shared plan.
 *
 * Source: "AR B2B_Automation Project 2026_send P'Ann.xlsx" — nine initiatives,
 * 230 saving hours a month, owned by the business rather than by this team.
 *
 * PIC is `user` deliberately: these are on the register because they are real
 * and worth tracking, and out of the team's committed hours because the team
 * is not delivering them.
 *
 *   node scripts/add-arb2b.mjs          # show what would be written
 *   node scripts/add-arb2b.mjs --write  # write it
 */
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'node:url'
import { newProject, computePlan, repairState, fmtHours } from '../src/lib/model.js'

const BASE = process.env.KPI_BASE || 'https://team-kpi-planning.onrender.com'
const SCENARIO = process.env.KPI_SCENARIO || 'Baseline'
const WRITE = process.argv.includes('--write')
const SRC = new URL('../AR B2B_Automation Project 2026_send P\'Ann.xlsx', import.meta.url)

/* ---------- read the source ---------- */
const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(fileURLToPath(SRC))
const ws = wb.getWorksheet('Project')
const txt = (c) => {
  const v = c && c.value
  if (v == null) return ''
  if (typeof v === 'object') {
    return String(v.richText ? v.richText.map((t) => t.text).join('') : (v.text ?? v.result ?? ''))
  }
  return String(v)
}

const rows = []
for (let r = 4; r <= ws.rowCount; r++) {
  const no = txt(ws.getRow(r).getCell(1)).trim()
  const initiative = txt(ws.getRow(r).getCell(2)).trim()
  if (!no || !initiative) continue
  rows.push({
    no: Number(no),
    initiative,
    group: txt(ws.getRow(r).getCell(3)).trim(),
    tech: txt(ws.getRow(r).getCell(4)).trim(),
    frequency: txt(ws.getRow(r).getCell(5)).trim(),
    description: txt(ws.getRow(r).getCell(6)).trim(),
    hours: Number(txt(ws.getRow(r).getCell(7)).replace(/,/g, '')) || 0,
  })
}
console.log(`read ${rows.length} initiatives, ${rows.reduce((a, x) => a + x.hours, 0)} hrs/month`)

/*
 * A report is a report and an automation is an automation — the objective is
 * read off the tech solution rather than guessed, so the tag says the same
 * thing the source sheet does.
 */
const objectiveFor = (x) => (/^bi report/i.test(x.tech) ? 'efficiency' : 'process_automation')
// One project can answer to more than one. "BI Report/RPA" is a report built
// with a robot and is honestly both, so it is tagged both rather than filed
// under whichever word came first.
const tagsFor = (x) => [
  ...(/bi report/i.test(x.tech) ? ['efficiency'] : []),
  ...(/rpa|e-?form/i.test(x.tech) ? ['process_automation'] : []),
]

const built = rows.map((x) => ({
  ...newProject(x.no),
  key: `ARB2B-${x.no}`,
  jiraKey: '',
  summary: x.initiative,
  program: 'AR B2B Automation 2026',
  team: 'Account',
  subTeam: 'AR B2B',
  pic: 'user',
  objective: objectiveFor(x),
  objectives: tagsFor(x),
  savingHours: x.hours,
  savingEstimated: false,
  manday: null,
  commitLevel: 'commit',
  status: 'Not Start',
  // The description as written, with the three facts the sheet carries beside
  // it. This is what the cost dialog shows under "Notes and links".
  comment: [
    x.description,
    '',
    `Tech solution: ${x.tech} · Frequency: ${x.frequency} · Group: ${x.group}`,
    'Source: AR B2B_Automation Project 2026_send P\'Ann.xlsx',
  ].join('\n'),
  notes: `${x.group} · ${x.tech} · ${x.frequency}`,
}))

console.log('\nto add:')
for (const p of built) {
  console.log(`  ${p.key.padEnd(9)} ${String(p.savingHours).padStart(4)}h  ${p.objective.padEnd(19)} ${(p.objectives.join('+') || '-').padEnd(32)} ${p.summary.slice(0, 58)}`)
}

/* ---------- merge into the shared plan ---------- */
const doc = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const state = doc.payload?.state || doc.payload
if (!state || !Array.isArray(state.projects)) throw new Error('no shared plan to merge into')
console.log(`\nshared plan "${doc.name}" saved ${doc.updatedAt} by ${doc.updatedBy}: ${state.projects.length} projects`)

const have = new Set(state.projects.map((p) => p.key))
const fresh = built.filter((p) => !have.has(p.key))
console.log(`${fresh.length} new, ${built.length - fresh.length} already present`)

// Newest first, as the register shows them.
const next = repairState({ ...state, projects: [...fresh, ...state.projects] })

const before = computePlan(repairState({ ...state }))
const after = computePlan(next)
const line = (label, get) => console.log(`  ${label.padEnd(26)} ${fmtHours(get(before)).padStart(9)} -> ${fmtHours(get(after)).padStart(9)}`)
console.log('\nwhat it moves:')
line('projects', (p) => p.projects.length)
line('committed hrs (ours)', (p) => p.totals.committedHours)
line('book total', (p) => p.totals.totalHours)
line('owned outside the team', (p) => p.totals.outsideHours)
console.log(`  ${'cards'.padEnd(26)} ${after.people.map((p) => `${p.nick} ${fmtHours(p.kpiTotals.savingHours)}`).join(' | ')}`)
console.log(`  ${'scorecards valid'.padEnd(26)} ${after.invalid.length === 0}`)

if (!WRITE) {
  console.log('\nDRY RUN — pass --write to save it')
  process.exit(0)
}

const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: next, updatedBy: 'AR B2B import' }),
})
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
console.log('\nSAVED to the shared database')

const back = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const readBack = back.payload?.state || back.payload
const found = built.filter((p) => readBack.projects.some((x) => x.key === p.key))
console.log(`read back: ${readBack.projects.length} projects, ${found.length} of ${built.length} AR B2B rows present`)
console.log(`comments intact: ${found.every((p) => (readBack.projects.find((x) => x.key === p.key).comment || '').length > 20)}`)
