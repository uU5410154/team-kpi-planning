/**
 * Exercises the real export path end to end and reads the workbook back.
 * Run with: node scripts/check-export.mjs
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, reassignPatch } from '../src/lib/model.js'
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
// Partner teams such as IT are assignable as PIC but hold no scorecard, so
// they get no per-person sheet.
const scorecardPeople = seed.people.filter((p) => p.scorecard !== false)

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
const expected = ['Summary', 'Overall_Objectives', 'Projects', ...scorecardPeople.map((p) => `Obj-${p.nick}`)]
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
// By header name, not by position — a column inserted into the register must
// not be able to make this check pass against the wrong cell.
const savingCol = projSheet.getRow(4).values.findIndex((v) => /^Saving/.test(String(v || '')))
check('the saving column is found by name', savingCol > 0, String(savingCol))
check('totals row carries a SUM formula',
  typeof totalRow.getCell(savingCol).value === 'object' && !!totalRow.getCell(savingCol).value?.formula)

// weights
const ov = back.getWorksheet('Overall_Objectives')
let weightRow = null
ov.eachRow((row) => { if (String(row.getCell(3).value || '').startsWith('WEIGHT TOTAL')) weightRow = row })
check('weight-total row present', !!weightRow)
if (weightRow) {
  const sums = []
  for (let i = 0; i < scorecardPeople.length; i++) sums.push(weightRow.getCell(4 + i * 3 + 1).value)
  check('every person totals 100%', sums.every((s) => Math.abs(s - 1) < 1e-9),
    sums.map((s) => `${Math.round(s * 100)}%`).join(', '))
}

for (const p of scorecardPeople) {
  const ws = back.getWorksheet(`Obj-${p.nick}`)
  let hasPortfolio = false
  ws.eachRow((row) => { if (row.getCell(1).value === 'Jira') hasPortfolio = true })
  check(`Obj-${p.nick} has a portfolio table`, hasPortfolio)
}

console.log(`\nsheets (${names.length}): ${names.join(', ')}`)
console.log(`file size: ${(readFileSync(file).length / 1024).toFixed(1)} KB`)
unlinkSync(file)
/* ====== a reassigned project moves in the workbook too ====== */
console.log('\n--- reassigning moves the project in the exported workbook ---')
{
  const KEY = 'FNP-379'
  const target = state.projects.find((p) => p.key === KEY)
  const patch = reassignPatch(target, 'gun')
  const moved = {
    ...state,
    projects: state.projects.map((p) => (p.key === KEY ? { ...p, ...patch } : p)),
  }
  const plan2 = computePlan(moved)
  const wb2 = await buildWorkbook(plan2, moved)
  const buf2 = await wb2.xlsx.writeBuffer()
  const back2 = new ExcelJS.Workbook()
  await back2.xlsx.load(buf2)

  const sheetFor = (book, nick) => book.getWorksheet(`Obj-${nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31))
  const rowsOn = (ws) => {
    const out = []
    ws.eachRow((r) => out.push(String(r.getCell(1).value || '')))
    return out
  }
  const jamesWas = rowsOn(sheetFor(back, 'James'))
  const jamesNow = rowsOn(sheetFor(back2, 'James'))
  check('the old owner sheet listed it before', jamesWas.includes(KEY))
  check('THE OLD OWNER SHEET NO LONGER LISTS IT', !jamesNow.includes(KEY))
  check('and it lost exactly that one row',
    jamesWas.length - jamesNow.length === 1, `${jamesWas.length} -> ${jamesNow.length}`)
  check('the new owner sheet lists it', rowsOn(sheetFor(back2, 'Gun')).includes(KEY))

  // Find the header by name, not by row number — the register carries a title
  // and a source note above it, and both have moved before.
  const picOnProjects = (book) => {
    const ws = book.getWorksheet('Projects')
    let col = -1
    let val = null
    ws.eachRow((r) => {
      const cells = r.values.map((v) => String(v || '').trim().toLowerCase())
      if (col < 0 && cells.indexOf('pic') > 0) col = cells.indexOf('pic')
      if (col > 0 && String(r.getCell(1).value || '') === KEY) val = String(r.getCell(col).value || '')
    })
    return val
  }
  check('the Projects sheet shows the new owner', /gun/i.test(picOnProjects(back2) || ''), picOnProjects(back2))

  // Nothing may leak: it is the same book of work either way.
  const totalOf = (book) => {
    const ws = book.getWorksheet('Summary')
    let v = null
    ws.eachRow((r) => { if (/^Committed . bankable/i.test(String(r.getCell(1).value || ''))) v = r.getCell(2).value })
    return v
  }
  check('the committed team hours do not move', totalOf(back) === totalOf(back2),
    `${totalOf(back)} vs ${totalOf(back2)}`)
  check('the app and the workbook agree on the new total',
    Math.abs(plan2.totals.committedHours - totalOf(back2)) < 0.51,
    `${plan2.totals.committedHours} vs ${totalOf(back2)}`)
}

/* ====== no cell may be too narrow to read ====== */
console.log(String.fromCharCode(10) + '--- every number fits the column it is in ---')
{
  // Excel does not shrink a number to fit: it prints ###### and leaves the
  // reader to drag the column, which on a forwarded report means the figure is
  // simply not there. A unit inside a number format costs real width.
  const tooNarrow = []
  for (const sheet of back.worksheets) {
    const merged = new Set()
    for (const range of sheet.model.merges || []) {
      const mm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range)
      if (!mm) continue
      const toNum = (a) => [...a].reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0)
      for (let rr = Number(mm[2]); rr <= Number(mm[4]); rr++) {
        for (let cc = toNum(mm[1]); cc <= toNum(mm[3]); cc++) merged.add(`${rr}:${cc}`)
      }
    }
    sheet.eachRow({ includeEmpty: false }, (row, rr) => {
      row.eachCell({ includeEmpty: false }, (cell, cc) => {
        if (merged.has(`${rr}:${cc}`)) return
        const v = cell.value
        const num = typeof v === 'number' ? v
          : (v && typeof v === 'object' && typeof v.result === 'number' ? v.result : null)
        if (num == null) return
        const fmt = String(cell.numFmt || '')
        const literals = (fmt.match(/"[^"]*"/g) || []).join('').replace(/"/g, '').length
        const decimals = (fmt.split('.')[1] || '').replace(/[^0#]/g, '').length
        const pct = /%/.test(fmt) ? 3 : 0
        const need = Math.abs(Math.trunc(num)).toLocaleString('en-US').length
          + (decimals ? decimals + 1 : 0) + literals + pct
        const width = sheet.getColumn(cc).width || 0
        if (need > width) tooNarrow.push(`${sheet.name} r${rr}c${cc} needs ${need} has ${width}`)
      })
    })
  }
  check('NO NUMBER IS WIDER THAN ITS COLUMN', tooNarrow.length === 0,
    tooNarrow.slice(0, 5).join(' | ') || 'every numeric cell fits')

  // and a whole number reads as a whole number
  const fmts = []
  for (const sheet of back.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (typeof cell.value === 'number' && cell.numFmt) fmts.push(String(cell.numFmt))
      })
    })
  }
  check('no format prints a bare decimal point after a whole number',
    !fmts.some((f) => f.includes('0.##')),
    [...new Set(fmts)].slice(0, 8).join(' | '))
}

/* ====== the workbook opens where the work is ====== */
console.log(String.fromCharCode(10) + '--- it opens on the register, with the working hidden ---')
{
  const active = back.views && back.views[0] && back.views[0].activeTab
  const opensOn = typeof active === 'number' ? back.worksheets[active] : null
  check('IT OPENS ON THE PROJECT REGISTER', opensOn && opensOn.name === 'Projects',
    opensOn ? opensOn.name : String(active))
  // Excel will not open on a hidden sheet, so the one it lands on has to be visible.
  check('and that sheet is visible', opensOn && opensOn.state !== 'hidden', String(opensOn && opensOn.state))
  const hidden = back.worksheets.filter((w) => w.state === 'hidden').map((w) => w.name)
  check('the working sheets are hidden, not deleted',
    hidden.includes('Summary') && hidden.includes('Effort_Return'), hidden.join(', '))
  check('and everything a reader needs is still visible',
    ['Overall_Objectives', 'Projects', 'Costs'].every((n) => !hidden.includes(n)),
    back.worksheets.filter((w) => w.state !== 'hidden').map((w) => w.name).join(', '))
  check('a hidden sheet still holds its figures',
    back.getWorksheet('Summary').rowCount > 10, String(back.getWorksheet('Summary').rowCount))
}

/* ====== the register carries the description ====== */
console.log(String.fromCharCode(10) + '--- the register sheet carries Notes and links ---')
{
  const ws = back.getWorksheet('Projects')
  let hdr = null
  ws.eachRow((row, r) => {
    if (hdr) return
    const vals = row.values.map((v) => String(v ?? '').trim())
    if (vals.includes('Project') && vals.includes('PIC')) hdr = { r, vals }
  })
  const col = hdr ? hdr.vals.indexOf('Notes and links') : -1
  check('THE REGISTER SHEET HAS A NOTES AND LINKS COLUMN', col > 0,
    hdr ? hdr.vals.filter(Boolean).join(' | ') : 'no header row')
  // It is the longest text on the sheet; a column too narrow to read it is the
  // same as not exporting it.
  check('wide enough to be read without dragging it', (ws.getColumn(col).width || 0) >= 40,
    String(ws.getColumn(col).width))
}

/* ====== every project is on the register, under its real owner ====== */
console.log(String.fromCharCode(10) + '--- the register lists everyone, including who is not us ---')
{
  const ws = back.getWorksheet('Projects')
  let hdr = null
  ws.eachRow((row, r) => {
    if (hdr) return
    const vals = row.values.map((v) => String(v ?? '').trim())
    if (vals.includes('Project') && vals.includes('PIC')) hdr = { r, vals }
  })
  const pc = hdr.vals.indexOf('PIC')
  const rows = []
  ws.eachRow((row, r) => {
    if (r <= hdr.r) return
    const name = String(row.getCell(2).value ?? '').trim()
    if (!name || name.startsWith('TOTAL')) return
    rows.push(String(row.getCell(pc).value ?? '').trim())
  })
  check('EVERY PROJECT IS ON THE REGISTER SHEET', rows.length === plan.projects.length,
    `${rows.length} rows vs ${plan.projects.length} projects`)

  // The bug this replaces: a PIC was looked up among the six who hold a
  // scorecard, so every project owned by IT or a business user printed TBC and
  // was painted red as unassigned. They are assigned — just not to us.
  const outside = plan.projects.filter((p) => p.outsideTeam)
  const named = new Set(rows)
  check('AND UNDER THE NAME OF WHOEVER OWNS IT',
    outside.every((p) => named.has(plan.assignees.find((x) => x.id === p.pic)?.nick)),
    `${outside.length} owned outside the team; PIC column holds: ${[...named].join(', ')}`)
  check('nothing reads TBC that has an owner',
    rows.filter((v) => v === 'TBC').length === plan.projects.filter((p) => !p.pic).length,
    `${rows.filter((v) => v === 'TBC').length} TBC vs ${plan.projects.filter((p) => !p.pic).length} unassigned`)
}

/* ====== the Costs sheet shows its working ====== */
console.log(String.fromCharCode(10) + '--- the Costs sheet explains where the money comes from ---')
{
  const ws = back.getWorksheet('Costs')
  const txt = (c) => {
    const v = c && c.value
    if (v == null) return ''
    if (typeof v === 'object') return String(v.richText ? v.richText.map((t) => t.text).join('') : (v.text ?? v.result ?? ''))
    return String(v)
  }
  const all = []
  for (let r = 1; r <= ws.rowCount; r++) {
    all.push([1, 5, 6].map((c) => txt(ws.getRow(r).getCell(c))).join(' | '))
  }
  const sheet = all.join(String.fromCharCode(10))
  check('THE COSTS SHEET SAYS HOW THE NUMBERS ARE BUILT', /HOW THESE NUMBERS ARE BUILT/.test(sheet))
  check('  the developer salary is stated', /Developer salary/.test(sheet))
  check('  and the user salary with its blend',
    /User salary/.test(sheet) && /20% Manager and 80% Staff/.test(sheet),
    (sheet.match(/[^\n]*20% Manager[^\n]*/) || [''])[0].slice(0, 100))
  check('  both day and hour rates show their arithmetic',
    /Developer day rate/.test(sheet) && /Value of one user hour released/.test(sheet))
  check('  investment is defined', /build \+ CAPEX/.test(sheet))
  check('  benefit is defined', /From hours released/.test(sheet) && /Stated in cash/.test(sheet))
  check('  and the return, with the subset it is measured over',
    /Return on investment/.test(sheet) && /Investment behind the return/.test(sheet))
  // The figures in that block must be the plan's, not a retelling of them.
  const money = (label) => {
    const row = all.find((l) => l.startsWith(label))
    return row ? Number(row.split(' | ')[1]) : null
  }
  check('the stated developer salary IS the model\u2019s',
    money('Developer salary, per month') === Math.round(plan.finance.devMonthlySalary),
    `${money('Developer salary, per month')} vs ${Math.round(plan.finance.devMonthlySalary)}`)
  check('the stated user salary IS the model\u2019s',
    money('User salary, per month') === Math.round(plan.finance.acctMonthlySalary),
    `${money('User salary, per month')} vs ${Math.round(plan.finance.acctMonthlySalary)}`)
  check('and the day rate is the salary through the stated arithmetic',
    Math.abs(money('Developer day rate')
      - Math.round((plan.finance.devMonthlySalary * plan.finance.loadFactor) / plan.finance.daysPerFteMonth)) <= 1,
    String(money('Developer day rate')))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
