/**
 * Exercises the real export path end to end and reads the result back.
 * Run with: node scripts/check-export.mjs
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'
import { exportWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const state = {
  people: seed.people,
  projects: seed.projects,
  settings: DEFAULT_SETTINGS,
  scenarioName: 'Export self-test',
}
const plan = computePlan(state)

const stamp = new Date().toISOString().slice(0, 10)
const file = `F&A Tech Team Objective 2026 — ${stamp}.xlsx`
if (existsSync(file)) unlinkSync(file)

exportWorkbook(plan, state)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

check('workbook file written', existsSync(file), file)
if (!existsSync(file)) process.exit(1)

// XLSX.readFile needs fs wired up in ESM; reading the buffer avoids that.
const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
const expected = ['Summary', 'Overall_Objectives', 'Breakdown Objectives', ...seed.people.map((p) => `Obj-${p.nick}`)]
check('all sheets present', expected.every((s) => wb.SheetNames.includes(s)), wb.SheetNames.join(' | '))

const bd = XLSX.utils.sheet_to_json(wb.Sheets['Breakdown Objectives'])
check('breakdown has every project', bd.length === seed.projects.length, `${bd.length} rows vs ${seed.projects.length} projects`)
check('breakdown carries PICs', bd.filter((r) => r['Main PIC (Tech team)'] && r['Main PIC (Tech team)'] !== 'TBC').length > 50)

const sum = XLSX.utils.sheet_to_json(wb.Sheets.Summary, { header: 1 })
const flat = sum.map((r) => (r || []).join('|')).join('\n')
check('summary carries the target bridge', flat.includes('HEADLINE POSITION'))
check('summary flags the basis assumption', flat.includes('ASSUMPTION'))
check('summary lists data-quality gaps', flat.includes('Missing saving hours'))

const ov = XLSX.utils.sheet_to_json(wb.Sheets.Overall_Objectives, { header: 1 })
const checkRow = ov.find((r) => (r || []).some((c) => String(c).includes('WEIGHT TOTAL')))
check('overall sheet has the weight-total check row', !!checkRow)
if (checkRow) {
  const weights = checkRow.filter((c) => typeof c === 'number')
  check('every person totals 100% in the export', weights.every((w) => Math.abs(w - 1) < 1e-9),
    weights.map((w) => `${(w * 100).toFixed(0)}%`).join(', '))
}

for (const p of seed.people) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[`Obj-${p.nick}`], { header: 1 })
  const hasHeader = rows.some((r) => (r || [])[0] === 'Jira key')
  check(`Obj-${p.nick} has a portfolio table`, hasHeader)
}

console.log(`\nsheets: ${wb.SheetNames.length} — ${wb.SheetNames.join(', ')}`)
console.log(`file size: ${(readFileSync(file).length / 1024).toFixed(1)} KB`)
unlinkSync(file)
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
