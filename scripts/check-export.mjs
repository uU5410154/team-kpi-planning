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

/* ====== objective 1: the commitment rule, and the arithmetic behind it ======
 *
 * The two limits are the whole of this objective, so the sheet has to state
 * them AND survive being checked against them. Every allowance is recomputed
 * here from the planned length rather than read from the model, so a change to
 * one and not the other cannot pass.
 */
console.log('\n--- objective 1: the 20% per project and 15% overall, on the sheet ---')
for (const person of scorecardPeople) {
  const pp = plan.people.find((x) => x.id === person.id)
  if (!pp || !(pp.commitments || []).length) continue
  const ws = back.getWorksheet(`Obj-${person.nick}`)
  const text = []
  ws.eachRow((row) => row.eachCell((c) => text.push(String(c.value?.richText ? c.value.richText.map((t) => t.text).join('') : c.value || ''))))
  const all = text.join(' \n ')
  const dr = pp.drift || {}
  const perPct = Math.round((dr.perProjectLimit ?? 0.2) * 100)
  const overallPct = Math.round((dr.limit ?? 0.15) * 100)
  /*
   * The book the OBJECTIVE states, which on the lead's card is the whole
   * team's. The sheet has to quote the same one the app does, or the two
   * answer the same question with different numbers.
   */
  const dline = pp.kpiLines.find((l) => l.objective === 'delivery') || {}

  check(`${person.nick}: the per-project rule is stated with its percentage`,
    all.includes(`1. PER PROJECT — ${perPct}%`))
  check(`${person.nick}: the overall rule is stated in PROJECTS, not just percent`,
    dline.allowedCount === 0
      ? all.includes('NOT ONE to go past')
      : all.includes(`at most ${dline.allowedCount} may go past their own allowance`),
    `held ${dline.held}, ${overallPct}% allows ${dline.allowedCount}`)
  check(`${person.nick}: THE SHEET QUOTES THE SAME BOOK AS THE CARD`,
    all.includes(`Of the ${dline.held} project`),
    `line says ${dline.held}, own book is ${dr.held}`)
  if (dline.aggregatesTeam) {
    check(`${person.nick}: and says the dates listed are their own, not the team's`,
      all.includes('AS TEAM LEAD') && all.includes(`own ${pp.commitments.length}`),
      `${dline.held} team vs ${pp.commitments.length} own`)
  }
  check(`${person.nick}: the free re-plan is stated`, all.includes('3. ONE FREE RE-PLAN'))
  check(`${person.nick}: what is not scored is stated`, all.includes('NOT SCORED'))

  // The table: find its header, then check every row against the model.
  let hr = null
  ws.eachRow((row) => { if (String(row.getCell(7).value || '').startsWith('Allowed (')) hr = row.number })
  check(`${person.nick}: the commitments table has an Allowed column`, !!hr, String(hr))
  if (!hr) continue
  check(`${person.nick}: the Allowed header carries the per-project limit`,
    String(ws.getRow(hr).getCell(7).value) === `Allowed (${perPct}%)`, String(ws.getRow(hr).getCell(7).value))

  let checkedRows = 0
  let allowanceOk = true
  let verdictOk = true
  let daysOk = true
  const byKey = new Map(pp.commitments.map((c) => [c.jiraKey || c.summary, c]))
  for (let n = hr + 1; n <= hr + pp.commitments.length; n++) {
    const row = ws.getRow(n)
    const c = byKey.get(String(row.getCell(1).value || '')) || byKey.get(String(row.getCell(2).value || ''))
    if (!c) continue
    checkedRows++
    const planned = row.getCell(6).value
    const allowed = row.getCell(7).value
    // Recomputed from what is ON THE SHEET: 20% of the planned length, never
    // less than one whole day. This is the rule, not a reading of the model.
    const want = planned && planned > 0 ? Math.round(Math.max(1, planned * (dr.perProjectLimit ?? 0.2))) : null
    if ((allowed ?? null) !== want) {
      allowanceOk = false
      console.log(`      ${c.jiraKey}: planned ${planned}, sheet allows ${allowed}, ${perPct}% is ${want}`)
    }
    if ((row.getCell(8).value ?? null) !== (c.driftDays ?? null)) daysOk = false
    const verdict = String(row.getCell(10).value || '')
    const wantVerdict = c.drifted === null
      ? (c.running ? 'running' : 'not due yet')
      : (c.drifted ? 'OVER' : 'within')
    if (!verdict.startsWith(wantVerdict)) {
      verdictOk = false
      console.log(`      ${c.jiraKey}: sheet says "${verdict}", model says "${wantVerdict}"`)
    }
  }
  check(`${person.nick}: every commitment is on the sheet`,
    checkedRows === pp.commitments.length, `${checkedRows} of ${pp.commitments.length}`)
  check(`${person.nick}: EVERY allowance IS ${perPct}% of that project's own planned length`, allowanceOk)
  check(`${person.nick}: every days-out matches the register`, daysOk)
  check(`${person.nick}: every verdict matches the register`, verdictOk)

  // And the roll-up under the table says the same thing as the card.
  check(`${person.nick}: the count line matches the register`,
    all.includes(`${dline.driftedCount} of ${dline.held} drifted beyond their own allowance`),
    `${dline.driftedCount} of ${dline.held}`)
  check(`${person.nick}: the count line states the limit in projects`,
    all.includes(`the ${overallPct}% limit allows ${dline.allowedCount}`))
  check(`${person.nick}: the allowed count is that book's own ${overallPct}%`,
    dline.allowedCount === Math.floor(dline.held * (dline.target / 100) + 1e-9),
    `${dline.allowedCount} vs floor(${dline.held} × ${dline.target}%)`)
  const overCount = pp.commitments.filter((c) => c.drifted === true).length
  check(`${person.nick}: the drifted count IS the number of OVER rows`,
    overCount === dr.drifted, `${overCount} rows vs ${dr.drifted} counted`)
  // The arithmetic of the limit itself, done a second way.
  check(`${person.nick}: the allowed count is the limit floored`,
    dr.allowedCount === Math.floor(dr.held * dr.limit + 1e-9)
    && (dr.allowedCount / dr.held <= dr.limit + 1e-9)
    && ((dr.allowedCount + 1) / dr.held > dr.limit),
    `${dr.allowedCount}/${dr.held} = ${(dr.allowedCount / dr.held * 100).toFixed(1)}% <= ${overallPct}%`)
  check(`${person.nick}: within-the-limit agrees with the counts`,
    dr.within === (dr.drifted <= dr.allowedCount), `${dr.drifted} <= ${dr.allowedCount} vs within=${dr.within}`)
}

/* ====== every row on a person's sheet says why it is there ======
 *
 * Credit follows the CONTRIBUTOR RECORD, not only the PIC — that is what makes
 * a shared project shareable, and it is also why a project whose PIC column
 * reads TBC can appear on somebody's scorecard. The sheet used to say nothing
 * about it, and the two sheets then gave different answers to "whose is this?"
 * with no way to reconcile them.
 */
console.log('\n--- every credited row says what the claim rests on ---')
for (const person of scorecardPeople) {
  const pp = plan.people.find((x) => x.id === person.id)
  if (!pp || !pp.scorecardRows.length) continue
  const ws = back.getWorksheet(`Obj-${person.nick}`)
  let hr = null
  ws.eachRow((row) => { if (String(row.getCell(4).value || '') === 'Why it is here') hr = row.number })
  check(`${person.nick}: the portfolio says why each row is there`, !!hr, String(hr))
  if (!hr) continue

  const rows = []
  for (let n = hr + 1; n <= hr + pp.scorecardRows.length; n++) {
    const row = ws.getRow(n)
    if (!row.getCell(2).value) break
    rows.push({ key: String(row.getCell(1).value || ''), why: String(row.getCell(4).value || ''), name: String(row.getCell(2).value || '') })
  }
  check(`${person.nick}: EVERY ROW HAS A REASON`,
    rows.length > 0 && rows.every((r) => r.why.trim().length > 0),
    rows.filter((r) => !r.why.trim()).map((r) => r.name).slice(0, 3).join(' | ') || `${rows.length} rows`)

  // And the reason has to be the true one, checked against the register.
  const byName = new Map(pp.scorecardRows.map(({ p: pr }) => [pr.summary, pr]))
  const wrong = rows.filter((r) => {
    const pr = byName.get(r.name)
    if (!pr) return false
    if (pr.fellBack) return !/Nobody is PIC/.test(r.why)
    if (pr.pic === person.id) return !/\bPIC\b/.test(r.why)
    const mine = (pr.contributors || []).find((c) => c.person === person.id)
    // Not the PIC and not a contributor: the only honest answer left is that
    // it is a credited share, and it must not claim to be either of those.
    return mine ? /Nobody is PIC/.test(r.why) : /^PIC$/.test(r.why)
  })
  check(`${person.nick}: and the reason is the true one`, wrong.length === 0,
    wrong.slice(0, 2).map((r) => `${r.key}: "${r.why}"`).join(' | '))

  /*
   * The case that started this: a project with NO PIC on somebody's sheet. It
   * is allowed — a developer is credited on work nobody has been named to own
   * — but it may never appear without saying which of the two it is.
   */
  const picless = rows.filter((r) => {
    const pr = byName.get(r.name)
    return pr && !pr.pic
  })
  check(`${person.nick}: a row with NO PIC still explains itself`,
    picless.every((r) => /Nobody is PIC|PM|Developer|Lead|Support|QA|Assignee|credited share/i.test(r.why)),
    picless.slice(0, 2).map((r) => `${r.key}: "${r.why}"`).join(' | ') || 'none on this sheet')
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
  /*
   * A person's sheet names a project TWICE now — once under objective 1 as a
   * date they committed to, once in the portfolio as hours they carry — so
   * reassigning it takes both away. Counted rather than assumed to be one:
   * what matters is that every mention goes, and none linger.
   */
  const mentions = (rows) => rows.filter((k) => k === KEY).length
  check('and every mention of it went, not just the first',
    mentions(jamesNow) === 0 && jamesWas.length - jamesNow.length === mentions(jamesWas),
    `${mentions(jamesWas)} mention(s) before, ${mentions(jamesNow)} after; ${jamesWas.length} -> ${jamesNow.length} rows`)
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
  check('THE COSTS SHEET EXPLAINS HOW COST AND BENEFIT ARE CALCULATED',
    /HOW COST AND BENEFIT ARE CALCULATED/.test(sheet))
  // One section of prose, not a column repeated against every row.
  // Counted by ROW: reading a merged cell back gives the same text in every
  // column of its range, so counting matches would count the merge, not the
  // section.
  check('  it is one section, not a column on every row',
    all.filter((l) => l.includes('HOW COST AND BENEFIT ARE CALCULATED')).length === 1,
    `${all.filter((l) => l.includes('HOW COST AND BENEFIT ARE CALCULATED')).length} rows carry the heading`)
  const says = (what, re) => check(`  it explains ${what}`, re.test(sheet),
    (sheet.match(new RegExp(`[^
]*${re.source}[^
]*`)) || [''])[0].slice(0, 110))
  says('what a developer costs', /Developer — THB/)
  says('what a user costs', /User — THB/)
  says('the 20 / 80 blend behind the user rate', /20% Manager and 80% Staff/)
  says('the loading on both', /loading of/)
  says('the working month', /A month is .* working hours/)
  says('the developer day rate arithmetic', /Developer day rate {2}= {2}/)
  says('the user hour rate arithmetic', /Value of one user hour released {2}= {2}/)
  says('what build cost is', /BUILD COST {2}= {2}mandays/)
  says('what CAPEX is, and that it is not depreciated', /CAPEX {2}= {2}.*NOT depreciated/s)
  says('what OPEX is', /OPEX {2}= {2}what it costs to KEEP/)
  says('what investment is, and that OPEX is not in it', /INVESTMENT {2}= {2}build cost \+ CAPEX/)
  says('the benefit from hours', /FROM HOURS {2}= {2}saving hours/)
  says('the benefit stated in cash', /IN CASH {2}= {2}/)
  says('the net benefit', /NET BENEFIT {2}= {2}benefit/)
  says('FTE released', /FTE RELEASED {2}= {2}/)
  says('the return, with its arithmetic', /RETURN ON INVESTMENT {2}= {2}\(net benefit/)
  says('which projects the return covers', /costed projects only/)
  says('payback', /PAYBACK {2}= {2}investment/)
  says('what is excluded', /WHAT IS DELIBERATELY NOT IN ANY OF THE ABOVE/)
  says('that IT and business rows are excluded but listed', /owned by IT or by the business itself/i)

  // The prose must quote the model, not a retelling of it.
  const has = (n) => sheet.includes(Math.round(n).toLocaleString('en-US'))
  check('the salaries it states are the model’s',
    has(plan.finance.devMonthlySalary) && has(plan.finance.acctMonthlySalary),
    `${Math.round(plan.finance.devMonthlySalary)} / ${Math.round(plan.finance.acctMonthlySalary)}`)
  check('so are the two rates it derives',
    has(plan.finance.devDayRate) && has(plan.finance.acctHourRate),
    `${Math.round(plan.finance.devDayRate)} / ${Math.round(plan.finance.acctHourRate)}`)
  check('and the return it quotes',
    sheet.includes(`${(plan.finance.roi * 100).toFixed(0)}%`),
    `${(plan.finance.roi * 100).toFixed(0)}%`)
}


/* ====== a return is written as a return, everywhere ====== */
console.log(String.fromCharCode(10) + '--- every ROI cell is a percentage ---')
{
  /*
   * A ratio in a cell formatted "#,##0" prints as a whole number: 1.4544
   * becomes "1", which reads as one baht, or as 5.7 months where the column
   * beside it is a payback. Both happened — one from a blanket format applied
   * after the specific one, the other from a hard-coded column index that a
   * later column pushed sideways.
   */
  /*
   * Over a COSTED copy of the plan as well as the plain one. The bundled seed
   * carries no mandays, so every return in it is null and no ROI cell has a
   * value to be formatted wrongly — a scan of that workbook alone passed
   * happily while the real export printed 1.4544 as "1".
   */
  const costed = computePlan({
    ...state,
    projects: state.projects.map((p, i) => ({ ...p, manday: 4 + (i % 7) })),
  })
  const wbc = await buildWorkbook(costed, state)
  const bufc = await wbc.xlsx.writeBuffer()
  const backc = new ExcelJS.Workbook()
  await backc.xlsx.load(bufc)

  const offenders = []
  for (const ws of [...back.worksheets, ...backc.worksheets]) {
    const head = new Map()
    for (let rr = 1; rr <= ws.rowCount; rr++) {
      for (let cc = 1; cc <= ws.columnCount; cc++) {
        const v = ws.getRow(rr).getCell(cc).value
        const t = typeof v === 'object' && v ? String(v.richText ? v.richText.map((x) => x.text).join('') : (v.text ?? '')) : String(v ?? '')
        if (/^(ROI|Actual|Return)$/i.test(t.trim()) && !head.has(cc)) head.set(cc, { label: t.trim(), row: rr })
      }
    }
    for (const [cc, info] of head) {
      for (let rr = info.row + 1; rr <= ws.rowCount; rr++) {
        const cell = ws.getRow(rr).getCell(cc)
        if (typeof cell.value !== 'number') continue
        // Only cells that ARE a ratio: an hours or count actual is a plain
        // number and belongs as one.
        const label = [1, 2, 3].map((k) => String(ws.getRow(rr).getCell(k).value ?? '')).join(' ')
        const isRatio = info.label.toUpperCase() === 'ROI' || /financial/i.test(label)
        if (!isRatio) continue
        if (!/%/.test(String(cell.numFmt || ''))) {
          offenders.push(`${ws.name} r${rr}c${cc} ${info.label} = ${cell.value} fmt=${cell.numFmt || 'none'}`)
        }
      }
    }
  }
  check('NO RETURN IS WRITTEN AS A PLAIN NUMBER', offenders.length === 0,
    offenders.slice(0, 4).join(' | ') || 'every ROI cell carries a percentage format')

  const ws = backc.getWorksheet('Overall_Objectives')
  let fr = null
  let hr = null
  for (let rr = 1; rr <= ws.rowCount; rr++) {
    const line = [1, 2, 3].map((k) => String(ws.getRow(rr).getCell(k).value ?? '')).join(' ')
    if (/Project management|Financial/i.test(line)) fr = fr ?? rr
    if (/Target/.test(String(ws.getRow(rr).getCell(4).value ?? ''))) hr = hr ?? rr
  }
  const wrong = costed.people.map((p, i) => {
    const cell = ws.getRow(fr).getCell(4 + i * 3 + 2)
    // Objective 1 is the share delivered on time now, not the return.
    const want = p.kpiLines.find((l) => l.targetKind === 'percent' && !l.custom)?.creditedRatio
    if (want == null) return null
    return Math.abs(Number(cell.value) - want) < 5e-4 ? null : `${p.nick}: sheet ${cell.value} vs ${want.toFixed(4)}`
  }).filter(Boolean)
  // A check that compares nothing passes for the wrong reason, so the ratios
  // have to be real before the comparison means anything.
  const real = costed.people.filter((p) => p.avgProjectRoi != null && Math.abs(p.avgProjectRoi) > 1e-6)
  check('the sheet has real returns to check', real.length >= 2,
    costed.people.map((p) => `${p.nick} ${p.avgProjectRoi == null ? 'null' : `${(p.avgProjectRoi * 100).toFixed(0)}%`}`).join(' · '))
  check('AND IT IS THE PERSON’S OWN AVERAGE RETURN', wrong.length === 0 && real.length >= 2,
    wrong.join(' | ') || costed.people.map((p) => `${p.nick} ${((p.avgProjectRoi || 0) * 100).toFixed(0)}%`).join(' · '))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
