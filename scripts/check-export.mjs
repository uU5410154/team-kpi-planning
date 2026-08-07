/**
 * Exercises the real export path end to end and reads the workbook back.
 * Run with: node scripts/check-export.mjs
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const state = {
  meta: seed.meta,
  people: seed.people,
  projects: seed.projects,
  settings: DEFAULT_SETTINGS,
  scenarioName: 'Export self-test',
}
const plan = computePlan(state)

const file = 'export-selftest.xlsx'
if (existsSync(file)) unlinkSync(file)

const wb = await buildWorkbook(plan, state)
await wb.xlsx.writeFile(file)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

check('workbook written', existsSync(file))

const back = new ExcelJS.Workbook()
await back.xlsx.readFile(file)
const names = back.worksheets.map((w) => w.name)
const expected = ['Summary', 'Overall_Objectives', 'Projects', ...seed.people.map((p) => `Obj-${p.nick}`)]
check('all sheets present', expected.every((n) => names.includes(n)), names.join(' | '))

const projSheet = back.getWorksheet('Projects')
// header banner rows 1-3, column header row 4, data from row 5, then a totals row
const dataRows = projSheet.rowCount - 5
check('every project exported', dataRows === seed.projects.length,
  `${dataRows} data rows vs ${seed.projects.length} projects`)

// styling actually applied
const bannerCell = projSheet.getCell(1, 1)
check('banner is styled', bannerCell.fill?.fgColor?.argb === 'FF051C2C' && bannerCell.font?.bold === true)
const headCell = projSheet.getCell(4, 1)
check('header strip is styled', headCell.fill?.fgColor?.argb === 'FF134A6E')
check('autofilter set', !!projSheet.autoFilter)
check('panes frozen', projSheet.views?.[0]?.state === 'frozen')
check('column widths set', projSheet.getColumn(2).width > 20)

// totals formula
const totalRow = projSheet.getRow(projSheet.rowCount)
check('totals row carries a SUM formula', typeof totalRow.getCell(8).value === 'object' && !!totalRow.getCell(8).value?.formula)

// weights
const ov = back.getWorksheet('Overall_Objectives')
let weightRow = null
ov.eachRow((row) => { if (String(row.getCell(3).value || '').startsWith('WEIGHT TOTAL')) weightRow = row })
check('weight-total row present', !!weightRow)
if (weightRow) {
  const sums = []
  for (let i = 0; i < seed.people.length; i++) sums.push(weightRow.getCell(4 + i * 3 + 1).value)
  check('every person totals 100%', sums.every((s) => Math.abs(s - 1) < 1e-9),
    sums.map((s) => `${Math.round(s * 100)}%`).join(', '))
}

for (const p of seed.people) {
  const ws = back.getWorksheet(`Obj-${p.nick}`)
  let hasPortfolio = false
  ws.eachRow((row) => { if (row.getCell(1).value === 'Jira') hasPortfolio = true })
  check(`Obj-${p.nick} has a portfolio table`, hasPortfolio)
}

console.log(`\nsheets (${names.length}): ${names.join(', ')}`)
console.log(`file size: ${(readFileSync(file).length / 1024).toFixed(1)} KB`)
unlinkSync(file)
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
