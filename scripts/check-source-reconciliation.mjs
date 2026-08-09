/**
 * Reconciliation against the ORIGINAL workbook.
 *
 * Every other suite in this repo tests the app against itself: seed.json in,
 * model out. This one is the only test that opens the source of truth — the
 * finance workbook management actually maintains — and proves that what the app
 * shows, and what the app exports, are the SAME NUMBERS as what is in that file.
 *
 * What it locks down:
 *   1. the app carries every row of the workbook, and no extra ones
 *   2. the app's saving hours equal the workbook's column, to the cent
 *   3. the app's FTE column equals the workbook's, row by row, on row identity
 *   4. the app's FTE ratio (176) REGENERATES the workbook's column from its
 *      own formula — so the default is proven, not asserted
 *   5. the computed fteReleased agrees with the workbook's FTE column to within
 *      the workbook's own rounding, and that residual is stated exactly
 *   6. the EXPORTED workbook carries the same saving hours and FTE per project
 *
 * THE ROUNDING, because it is the one place the two can legitimately differ:
 * the workbook rounds every row to one decimal and then adds up (23.9). The app
 * divides the book total and does not round (4,227.4 / 176 = 24.0193...). Both
 * are right; they are different orders of operation. Assertion 5 does not paper
 * over that with a loose tolerance — it proves the gap IS the rounding, by
 * recomputing the per-row residuals and matching them to the difference.
 *
 * Run with: node scripts/check-source-reconciliation.mjs
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, DEFAULT_FINANCE } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
/** Every comparison prints both sides, so a failure says what to go and look at. */
const cmp = (name, a, b, tol = 0, fmt = (v) => String(v)) =>
  check(name, a != null && b != null && Math.abs(a - b) <= tol, `app ${fmt(a)} vs workbook ${fmt(b)}`)
const n2 = (v) => (v == null ? 'null' : Number(v).toFixed(2))
const n4 = (v) => (v == null ? 'null' : Number(v).toFixed(4))

/* ================= locate the source workbook ================= */
const seed = JSON.parse(readFileSync(join(REPO, 'src/data/seed.json'), 'utf8'))
// seed.meta.source records the file the seed was built from ("<name>.xlsx /
// sheet Project"), so the test follows the seed's own claim rather than a
// second hardcoded path that could drift away from it.
const SRC_NAME = String(seed.meta?.source || '').split('/')[0].trim()
      || 'finance_project___update saving_20260709 (2).xlsx'
const CANDIDATES = [resolve(REPO, '..', SRC_NAME), resolve(REPO, SRC_NAME)]
const SRC = CANDIDATES.find((p) => existsSync(p))

if (!SRC) {
  // Deliberately a failure, not a skip. This suite exists to catch the app
  // drifting away from the workbook; a silent pass when the workbook is missing
  // would be exactly the false green it is here to prevent. Set
  // SKIP_SOURCE_RECON=1 to run the rest of the suite without it.
  if (process.env.SKIP_SOURCE_RECON === '1') {
    console.log(`SKIP  source workbook not found, SKIP_SOURCE_RECON=1 set — reconciliation NOT run`)
    process.exit(0)
  }
  console.log('FAIL  source workbook not found. Looked in:')
  for (const c of CANDIDATES) console.log(`        ${c}`)
  console.log('      Put the workbook beside the repo, or set SKIP_SOURCE_RECON=1 to skip.')
  process.exit(1)
}
console.log(`source workbook: ${SRC}\n`)

/* ================= read the workbook ================= */
const src = new ExcelJS.Workbook()
await src.xlsx.readFile(SRC)
const sheet = src.getWorksheet('Project')
check('the source workbook has the Project sheet', !!sheet,
  src.worksheets.map((w) => w.name).join(' | '))
if (!sheet) process.exit(1)

/**
 * A formula cell reads back as { formula, result }. ExcelJS omits `result`
 * when the cached value is zero, so a missing result is read as 0 — and
 * assertion 4 independently recomputes every one of these from the formula, so
 * a genuinely absent cache would surface as a mismatch rather than pass as 0.
 */
const val = (c) => (c && typeof c === 'object' && 'formula' in c ? (c.result ?? 0) : c)
const text = (v) => {
  const s = v == null ? '' : String(typeof v === 'object' && v.richText ? v.richText.map((t) => t.text).join('') : v).trim()
  return s
}

// Header row, so a reshuffled column is caught before any number is compared.
const HEAD = [1, 2, 3, 4, 5, 6, 7].map((c) => text(sheet.getRow(1).getCell(c).value))
check('the workbook columns are where the importer expects them',
  HEAD[0] === 'Key' && HEAD[1] === 'Team' && HEAD[2] === 'Sub Team' && HEAD[3] === 'Project'
  && HEAD[4] === 'Saving hrs/mth' && HEAD[5] === 'HC' && HEAD[6] === 'Detail',
  HEAD.join(' | '))

/**
 * Row identity, replicated from scripts/import-source.py exactly: the Jira key
 * where there is one, otherwise ROW-<n>, with #2/#3 suffixes for keys that
 * legitimately appear on several rows (FNP-1151 is split across three sub
 * teams). Matching on this rather than on the key alone is what makes "row by
 * row" mean row by row.
 */
const seen = new Map()
const wbRows = []
for (let r = 2; r <= sheet.rowCount; r++) {
  const row = sheet.getRow(r)
  const detail = text(val(row.getCell(7).value))
  const program = text(val(row.getCell(4).value))
  if (!detail && !program) continue      // the importer's own skip rule
  const key = text(val(row.getCell(1).value))
  const rawSaving = val(row.getCell(5).value)
  const base = key || `ROW-${r}`
  const nth = (seen.get(base) || 0) + 1
  seen.set(base, nth)
  wbRows.push({
    row: r,
    uid: nth === 1 ? base : `${base}#${nth}`,
    key,
    team: text(val(row.getCell(2).value)),
    subTeam: text(val(row.getCell(3).value)),
    program,
    summary: detail || program,
    // "TBC" is the only non-numeric the sheet uses; it means the saving is not
    // quantified yet, which is not the same as a saving of zero.
    saving: typeof rawSaving === 'number' ? rawSaving : null,
    savingRaw: rawSaving,
    fte: Number(val(row.getCell(6).value)) || 0,
    formula: (row.getCell(6).value || {}).formula || '',
  })
}

const plan = computePlan({
  meta: seed.meta,
  people: seed.people,
  projects: seed.projects,
  settings: DEFAULT_SETTINGS,
  scenarioName: 'source reconciliation',
})

/* ================= 1. every row, and only those rows ================= */
console.log('--- 1. the app carries the workbook, row for row ---')
cmp('project count matches the workbook row count', plan.projects.length, wbRows.length)
// The comparison below is only meaningful if nothing is held out of plan, so
// say so rather than assume it.
const inPlan = plan.projects.filter((p) => !['nextyear', 'excluded'].includes(p.commitLevel))
check('no seed project is parked out of plan, so the totals are comparable',
  inPlan.length === plan.projects.length, `${inPlan.length} in plan of ${plan.projects.length}`)

const byUid = new Map(plan.projects.map((p) => [p.key, p]))
const missing = wbRows.filter((w) => !byUid.has(w.uid))
check('every workbook row has a project with the same row identity',
  missing.length === 0,
  missing.length ? missing.slice(0, 5).map((m) => `row ${m.row} ${m.uid}`).join(', ') : `${wbRows.length} of ${wbRows.length} matched`)
const extra = plan.projects.filter((p) => !wbRows.some((w) => w.uid === p.key))
check('and the app invents no project the workbook does not have',
  extra.length === 0, extra.length ? extra.slice(0, 5).map((p) => p.key).join(', ') : 'none')

/* ================= 2. the saving hours, to the cent ================= */
console.log('\n--- 2. saving hours ---')
const wbHours = wbRows.reduce((a, w) => a + (w.saving ?? 0), 0)
cmp('total saving hrs/month matches the workbook column, to the cent',
  plan.totals.totalHours, wbHours, 0.005, n2)

const wbTbc = wbRows.filter((w) => w.saving == null)
const appTbc = plan.projects.filter((p) => p.savingHours == null)
cmp('the same rows are unquantified (TBC), not silently zeroed',
  appTbc.length, wbTbc.length)

let hoursOff = 0
let firstHoursOff = ''
for (const w of wbRows) {
  const p = byUid.get(w.uid)
  if (!p) continue
  const a = p.savingHours
  const ok = w.saving == null ? a == null : a != null && Math.abs(a - w.saving) <= 0.005
  if (!ok) {
    hoursOff++
    if (!firstHoursOff) firstHoursOff = `row ${w.row} ${w.uid}: app ${a} vs workbook ${w.savingRaw}`
  }
}
check('and every project matches its own workbook row', hoursOff === 0,
  hoursOff === 0 ? `${wbRows.length} of ${wbRows.length} rows equal` : `${hoursOff} row(s) differ — first: ${firstHoursOff}`)

/* ================= 3. the FTE column, row by row ================= */
console.log('\n--- 3. the FTE column (stored as `hc`), row by row ---')
const wbFte = wbRows.reduce((a, w) => a + w.fte, 0)
cmp('total FTE matches the workbook FTE column sum', plan.totals.totalHC, wbFte, 0.005, n2)

let fteOff = 0
let firstFteOff = ''
for (const w of wbRows) {
  const p = byUid.get(w.uid)
  if (!p) continue
  const a = Number(p.hc) || 0
  if (Math.abs(a - w.fte) > 1e-9) {
    fteOff++
    if (!firstFteOff) firstFteOff = `row ${w.row} ${w.uid}: app ${a} vs workbook ${w.fte}`
  }
}
check('every project FTE equals its workbook row', fteOff === 0,
  fteOff === 0 ? `${wbRows.length} of ${wbRows.length} rows equal` : `${fteOff} row(s) differ — first: ${firstFteOff}`)

// 20 rows carry saving hours yet round to 0.0 FTE. Any code that read "FTE = 0"
// as "no saving" would quietly diverge from the workbook, so it is pinned here.
const zeroFteWithHours = wbRows.filter((w) => (w.saving ?? 0) > 0 && w.fte === 0)
check('rows with real saving hours but 0.0 FTE are carried, not dropped',
  zeroFteWithHours.every((w) => (byUid.get(w.uid)?.savingHours ?? 0) > 0),
  `${zeroFteWithHours.length} such rows in the workbook`)

/* ================= 4. the ratio itself ================= */
console.log('\n--- 4. the FTE ratio the app defaults to is the workbook\'s own ---')
// Not inferred: the workbook writes the divisor into every row of the column.
const formulas = new Set(wbRows.map((w) => w.formula).filter(Boolean))
check('the workbook states one FTE formula for the whole column, with no variants',
  formulas.size === 1, `${formulas.size} distinct formula(s)`)
const theFormula = [...formulas][0] || ''
check('and that formula divides by (22*8)', theFormula.includes('(22*8)'), theFormula)
cmp('DEFAULT_FINANCE.hoursPerFteMonth is that divisor', DEFAULT_FINANCE.hoursPerFteMonth, 22 * 8)

// Excel's ROUND is half AWAY FROM ZERO; no row in this book lands on a .x5
// boundary, but rounding half-up rather than to-even is what the sheet does.
const round1 = (v) => Math.sign(v) * Math.round(Math.abs(v) * 10) / 10
const RATIO = DEFAULT_FINANCE.hoursPerFteMonth
let regenOff = 0
let firstRegenOff = ''
for (const w of wbRows) {
  const expect = w.saving == null ? 0 : round1(w.saving / RATIO)
  if (Math.abs(expect - w.fte) > 1e-9) {
    regenOff++
    if (!firstRegenOff) firstRegenOff = `row ${w.row} ${w.uid}: ${w.saving}/${RATIO} -> ${expect} vs workbook ${w.fte}`
  }
}
check(`dividing by ${RATIO} and rounding to 1 dp regenerates the whole column`,
  regenOff === 0,
  regenOff === 0 ? `${wbRows.length} of ${wbRows.length} rows reproduced` : `${regenOff} row(s) differ — first: ${firstRegenOff}`)

// The divisor the app used to ship, kept as a live comparison so nobody
// "restores" it without seeing what it costs.
let oldOff = 0
for (const w of wbRows) {
  const expect = w.saving == null ? 0 : round1(w.saving / 173.3)
  if (Math.abs(expect - w.fte) > 1e-9) oldOff++
}
check('and the old 2,080/12 = 173.3 divisor demonstrably does not',
  oldOff > 0, `176 misses ${regenOff} rows, 173.3 misses ${oldOff}`)

/* ================= 5. computed FTE vs the workbook's own column ================= */
console.log('\n--- 5. computed FTE released vs the workbook column, and the rounding between them ---')
// The app divides the book total once. The workbook rounds each row then adds.
// The difference is exactly the sum of the per-row rounding residuals — proved,
// not tolerated.
const residual = wbRows.reduce((a, w) => {
  const exact = w.saving == null ? 0 : w.saving / RATIO
  return a + (exact - w.fte)
}, 0)
const diff = plan.finance.fteReleased - wbFte
console.log(`      app  fteReleased  = ${n4(plan.finance.fteReleased)} FTE  (${n2(plan.totals.totalHours)} hrs / ${RATIO}, unrounded)`)
console.log(`      workbook FTE col  = ${n4(wbFte)} FTE  (each row rounded to 1 dp, then summed)`)
console.log(`      difference        = ${n4(diff)} FTE`)
cmp('the difference IS the workbook\'s per-row rounding, to 1e-9', diff, residual, 1e-9, n4)
check(`stated explicitly: the workbook's own rounding error is ${diff.toFixed(4)} FTE (${(Math.abs(diff) / wbFte * 100).toFixed(2)}% of ${wbFte.toFixed(1)})`,
  true)
// A hard ceiling as well as the identity: 1-dp rounding cannot move any row by
// more than 0.05, so the whole-book gap cannot exceed 0.05 x the rows rounded.
const bound = 0.05 * wbRows.filter((w) => w.saving != null).length
check('and it stays inside the arithmetic ceiling for 1-dp rounding',
  Math.abs(diff) <= bound, `|${n4(diff)}| <= 0.05 x ${wbRows.filter((w) => w.saving != null).length} rows = ${n2(bound)}`)
check('so the app and the workbook agree on FTE to inside half a person',
  Math.abs(diff) < 0.5, `|${n4(diff)}| < 0.5`)

/* ================= 6. the exported workbook ================= */
console.log('\n--- 6. the workbook the app EXPORTS, back against the original ---')
const file = join(REPO, 'source-recon-export.xlsx')
if (existsSync(file)) unlinkSync(file)
const out = await buildWorkbook(plan, {
  meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS,
})
await out.xlsx.writeFile(file)
const back = new ExcelJS.Workbook()
await back.xlsx.readFile(file)
const ws = back.getWorksheet('Projects')

// Row 4 is the column header; data starts at 5; the last row is the SUM strip.
const heads = []
ws.getRow(4).eachCell((c, i) => { heads[i] = text(c.value) })
check('the exported Projects sheet heads the column FTE, not HC',
  heads.includes('FTE') && !heads.includes('HC'), heads.slice(1, 11).join(' | '))
const hCol = heads.indexOf('FTE')
const sCol = heads.findIndex((h) => /^Saving/.test(h || ''))
check('the saving and FTE columns are both present', sCol > 0 && hCol > 0, `saving col ${sCol}, FTE col ${hCol}`)

// The export sorts by saving hours, so it is matched on identity rather than
// position: Jira key + project + team + sub team, which is unique across the
// whole book (a bare Jira key is not — FNP-1151 appears three times).
const idOf = (jira, summary, team, sub) => [jira || '', summary || '', team || '', sub || ''].join(' | ')
const exported = new Map()
for (let r = 5; r < 5 + plan.projects.length; r++) {
  const row = ws.getRow(r)
  exported.set(
    idOf(text(row.getCell(1).value), text(row.getCell(2).value), text(row.getCell(4).value), text(row.getCell(5).value)),
    { saving: val(row.getCell(sCol).value), fte: val(row.getCell(hCol).value), row: r },
  )
}
cmp('the export carries one row per project', exported.size, plan.projects.length)

let expOff = 0
let firstExpOff = ''
let matched = 0
for (const w of wbRows) {
  const p = byUid.get(w.uid)
  if (!p) continue
  const e = exported.get(idOf(p.jiraKey, p.summary, p.team, p.subTeam))
  if (!e) {
    expOff++
    if (!firstExpOff) firstExpOff = `${w.uid} has no exported row`
    continue
  }
  matched++
  const savingOk = w.saving == null ? e.saving == null : Math.abs(Number(e.saving) - w.saving) <= 0.005
  const fteOk = Math.abs((Number(e.fte) || 0) - w.fte) <= 1e-9
  if (!savingOk || !fteOk) {
    expOff++
    if (!firstExpOff) {
      firstExpOff = `${w.uid}: exported ${e.saving}/${e.fte} vs workbook ${w.savingRaw}/${w.fte}`
    }
  }
}
check('every exported row carries the original saving hours and FTE', expOff === 0,
  expOff === 0 ? `${matched} of ${wbRows.length} rows equal on both columns` : `${expOff} row(s) differ — first: ${firstExpOff}`)

// And the exported totals, so the strip a reader actually looks at also ties.
let expSaving = 0
let expFte = 0
for (const e of exported.values()) {
  expSaving += Number(e.saving) || 0
  expFte += Number(e.fte) || 0
}
cmp('exported saving hours sum to the workbook column', expSaving, wbHours, 0.005, n2)
cmp('exported FTE sums to the workbook FTE column', expFte, wbFte, 0.005, n2)
unlinkSync(file)

/* ================= 7. FTE is derived, not stored ================= */
console.log('\n--- 7. the FTE column generates itself from the saving hours ---')
{
  // The workbook's column is a formula, not typed data. So is the app's now:
  // entering saving hours produces the FTE and nothing is kept in step by hand.
  // Every check below CHANGES the saving hours and demands the FTE move, so
  // none of them would pass against a stored field.
  const src = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }
  const one = seed.projects.find((p) => p.savingHours > 0)
  const at = (hours) => computePlan({
    ...src,
    projects: seed.projects.map((p) => (p.key === one.key ? { ...p, savingHours: hours } : p)),
  }).projects.find((p) => p.key === one.key)

  check('entering saving hours generates the FTE', at(352).fte === 2.0, `352 hrs -> ${at(352).fte} FTE`)
  check('and it tracks every further edit',
    at(176).fte === 1.0 && at(88).fte === 0.5 && at(0).fte === 0,
    `176 -> ${at(176).fte} | 88 -> ${at(88).fte} | 0 -> ${at(0).fte}`)
  check('clearing the hours clears the FTE, like the workbook IF branch',
    at(null).fte === 0, `TBC -> ${at(null).fte}`)
  check('a brand-new project gets an FTE without one ever being typed', (() => {
    const added = computePlan({
      ...src,
      projects: [...seed.projects, { ...one, key: 'NEW-FTE', jiraKey: null, savingHours: 528, hc: null }],
    }).projects.find((p) => p.key === 'NEW-FTE')
    return added.fte === 3.0
  })(), '528 hrs -> 3.0 FTE')

  const half = computePlan({
    ...src,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, hoursPerFteMonth: 88 } },
  })
  check('halving the ratio moves EVERY quantified row, not just the headline',
    half.projects.filter((p) => p.savingHours > 0)
      .every((p) => Math.abs(p.fte - Math.round((p.savingHours / 88) * 10) / 10) < 1e-9))
  check('and roughly doubles the book total',
    Math.abs(half.totals.totalHC - 48.1) < 0.05,
    `${plan.totals.totalHC} at 176 -> ${half.totals.totalHC} at 88`)

  const stored = plan.projects.filter((p) => p.hc != null)
  const same = stored.filter((p) => Math.abs(p.fte - p.hc) < 1e-9).length
  check('the derived column still reproduces the imported one, row for row',
    same === stored.length, `${same} of ${stored.length} rows`)
}

/* ================= the statement ================= */
console.log('\n--- reconciliation statement ---')
console.log(`  projects            app ${plan.projects.length}          workbook ${wbRows.length}`)
console.log(`  saving hrs/month    app ${n2(plan.totals.totalHours)}     workbook ${n2(wbHours)}`)
console.log(`  FTE column          app ${n2(plan.totals.totalHC)}       workbook ${n2(wbFte)}`)
console.log(`  exported hrs/FTE    app ${n2(expSaving)} / ${n2(expFte)}   workbook ${n2(wbHours)} / ${n2(wbFte)}`)
console.log(`  computed FTE        app ${n4(plan.finance.fteReleased)}     workbook ${n4(wbFte)}   (delta ${n4(diff)} = the workbook's own 1-dp rounding)`)
console.log(`  FTE ratio           app ${RATIO}            workbook (22*8) = ${22 * 8}`)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
