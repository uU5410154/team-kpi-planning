/**
 * Benefit stated in cash rather than in time.
 *
 * A licence dropped, a penalty avoided, an interest charge that stops: real
 * money, and pricing it as hours would be a fiction. It is a NUMBER, not a
 * note — unlike a soft benefit it counts toward the return.
 *
 * What must hold:
 *   1. it is additive: the annual benefit is the hours priced PLUS the cash,
 *      and both halves are always reported separately so nobody has to guess
 *      which is which;
 *   2. it moves the ROI and the payback, because it is a real return;
 *   3. it moves NO hours. Not the committed total, not a person's credited
 *      hours, and above all not the FTE released — cash frees nobody's time;
 *   4. it is credited on the same share as the project it sits on;
 *   5. the app, the register, the economics sheet, each person's sheet and the
 *      round-trip file all state the same figure.
 *
 * Run with: node scripts/check-monetary.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, weightsValid } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'
import { buildFilteredWorkbook, readProjectsFile, planImport, applyImport } from '../src/lib/projectIO.js'
import { columnFor } from '../src/lib/projectSheet.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }
const plain = computePlan(base)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const CASH = 600000
const TARGET = base.projects.find((p) => p.savingHours > 0 && p.pic === 'james')
const priced = (extra = {}) => ({
  ...base,
  projects: base.projects.map((p) => (p.key === TARGET.key
    ? { ...p, savingHours: 100, manday: 20, capex: null, opex: [], ...extra } : p)),
})

/* ---------------- 1. what counts as a figure ---------------- */
console.log('--- what counts as a cash benefit ---')
{
  const of = (v) => computePlan(priced({ monetaryBenefit: v })).projects.find((p) => p.key === TARGET.key)
  check('a number is taken', of(CASH).monetaryAnnualBenefit === CASH)
  check('zero is nothing, not a benefit of zero', of(0).monetaryAnnualBenefit === null)
  check('a negative figure is refused', of(-100).monetaryAnnualBenefit === null)
  check('text is refused', of('lots').monetaryAnnualBenefit === null)
  check('NaN and Infinity are refused',
    of(NaN).monetaryAnnualBenefit === null && of(Infinity).monetaryAnnualBenefit === null)
  check('absent is absent', of(undefined).monetaryAnnualBenefit === null)
  check('IT IS READ AS A PER-YEAR FIGURE',
    Math.abs(of(CASH).monetaryMonthlyBenefit - CASH / 12) < 1e-9,
    `${of(CASH).monetaryMonthlyBenefit} vs ${CASH / 12}`)
}

/* ---------------- 2. it is additive, and stated apart ---------------- */
console.log('\n--- the annual benefit is hours plus cash ---')
{
  const without = computePlan(priced()).projects.find((p) => p.key === TARGET.key)
  const with_ = computePlan(priced({ monetaryBenefit: CASH })).projects.find((p) => p.key === TARGET.key)

  check('the hours half is unchanged by it',
    Math.abs(with_.hoursMonthlyBenefit - without.hoursMonthlyBenefit) < 1e-9,
    `${Math.round(with_.hoursMonthlyBenefit)} vs ${Math.round(without.hoursMonthlyBenefit)}`)
  check('THE TOTAL IS THE TWO HALVES ADDED',
    Math.abs(with_.annualBenefit - (with_.hoursMonthlyBenefit * 12 + CASH)) < 1e-6,
    `${Math.round(with_.annualBenefit)} vs ${Math.round(with_.hoursMonthlyBenefit * 12)} + ${CASH}`)
  check('and it is exactly the cash more than before',
    Math.abs(with_.annualBenefit - without.annualBenefit - CASH) < 1e-6,
    `${Math.round(without.annualBenefit)} -> ${Math.round(with_.annualBenefit)}`)
  check('both halves are reported, so neither has to be inferred',
    with_.hoursMonthlyBenefit != null && with_.monetaryAnnualBenefit != null)

  // cash with no hours at all is still a benefit
  const cashOnly = computePlan(priced({ savingHours: null, monetaryBenefit: 240000 }))
    .projects.find((p) => p.key === TARGET.key)
  check('A PROJECT THAT SAVES ONLY CASH STILL HAS A BENEFIT',
    Math.abs(cashOnly.annualBenefit - 240000) < 1e-6, String(Math.round(cashOnly.annualBenefit)))
  check('and a return', cashOnly.roi != null, String(cashOnly.roi))
  check('but no FTE released, because it frees nobody', cashOnly.fteReleased == null,
    String(cashOnly.fteReleased))
  const neither = computePlan(priced({ savingHours: null, monetaryBenefit: null }))
    .projects.find((p) => p.key === TARGET.key)
  check('neither one leaves the benefit unknown, not zero', neither.annualBenefit === null)
}

/* ---------------- 3. it moves the return ---------------- */
console.log('\n--- it moves the return, because it is one ---')
{
  const without = computePlan(priced()).projects.find((p) => p.key === TARGET.key)
  const with_ = computePlan(priced({ monetaryBenefit: CASH })).projects.find((p) => p.key === TARGET.key)
  check('THE ROI RISES', with_.roi > without.roi,
    `${(without.roi * 100).toFixed(0)}% -> ${(with_.roi * 100).toFixed(0)}%`)
  check('the payback shortens', with_.paybackMonths < without.paybackMonths,
    `${without.paybackMonths.toFixed(1)} -> ${with_.paybackMonths.toFixed(1)} months`)
  check('the ROI is exactly what the arithmetic says',
    Math.abs(with_.roi - ((with_.annualBenefit - 0) - with_.investment) / with_.investment) < 1e-9,
    `${with_.roi.toFixed(4)}`)
  check('the investment is untouched by it', with_.investment === without.investment)
  // Enough effort to fail the gate on hours alone, then enough cash to clear
  // it — worked out from the model's own numbers rather than guessed.
  const heavy = computePlan(priced({ manday: 400, monetaryBenefit: null })).projects.find((p) => p.key === TARGET.key)
  const needed = heavy.investment * (1 + plain.finance.roiGate) - heavy.annualBenefit
  const rescued = computePlan(priced({ manday: 400, monetaryBenefit: Math.ceil(needed) + 1000 }))
    .projects.find((p) => p.key === TARGET.key)
  check('a project that fails the gate on hours alone really does fail it',
    heavy.gate === 'fail', `ROI ${(heavy.roi * 100).toFixed(0)}%`)
  check('AND CASH ALONE CAN CARRY IT OVER THE GATE',
    rescued.gate === 'pass', `ROI ${(rescued.roi * 100).toFixed(0)}% on ${Math.ceil(needed)} of cash`)
}

/* ---------------- 4. it moves no hours ---------------- */
console.log('\n--- it moves no hours, and frees nobody ---')
{
  const plan = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === TARGET.key ? { ...p, monetaryBenefit: 5000000 } : p)),
  })
  check('THE COMMITTED TOTAL DOES NOT MOVE',
    Math.abs(plain.totals.committedHours - plan.totals.committedHours) < 1e-9,
    `${plain.totals.committedHours.toFixed(2)} vs ${plan.totals.committedHours.toFixed(2)}`)
  check('the book total does not move',
    Math.abs(plain.totals.totalHours - plan.totals.totalHours) < 1e-9)
  check('no person\'s credited hours move',
    plain.people.every((p, i) => Math.abs(p.scorecardHours - plan.people[i].scorecardHours) < 1e-9))
  check('THE FTE RELEASED DOES NOT MOVE — CASH FREES NOBODY',
    plain.people.every((p, i) => Math.abs((p.finance.fteReleased || 0) - (plan.people[i].finance.fteReleased || 0)) < 1e-9),
    plain.people.map((p, i) => `${p.nick} ${(p.finance.fteReleased || 0).toFixed(2)}->${(plan.people[i].finance.fteReleased || 0).toFixed(2)}`).join(' '))
  check('nor does the plan-level FTE released',
    Math.abs(plain.finance.fteReleased - plan.finance.fteReleased) < 1e-9,
    `${plain.finance.fteReleased.toFixed(2)} vs ${plan.finance.fteReleased.toFixed(2)}`)
  check('every scorecard still totals 100%',
    plan.people.every((p) => weightsValid(p.kpiLines)) && plan.invalid.length === 0)
  check('but the money DID move', plan.finance.annualBenefit > plain.finance.annualBenefit,
    `${Math.round(plain.finance.annualBenefit)} -> ${Math.round(plan.finance.annualBenefit)}`)
  check('by exactly the cash added',
    Math.abs(plan.finance.annualBenefit - plain.finance.annualBenefit - 5000000) < 0.01)
  check('and the plan reports the split',
    Math.abs(plan.finance.hoursAnnualBenefit + plan.finance.monetaryAnnualBenefit - plan.finance.annualBenefit) < 0.01,
    `${Math.round(plan.finance.hoursAnnualBenefit)} + ${Math.round(plan.finance.monetaryAnnualBenefit)}`)
}

/* ---------------- 5. credited on the same share ---------------- */
console.log('\n--- credited on the same share as the project ---')
{
  const state = {
    ...base,
    projects: base.projects.map((p) => (p.key === TARGET.key
      ? {
        ...p,
        monetaryBenefit: CASH,
        contributors: [{ person: 'james', roles: ['dev'] }, { person: 'kade', roles: ['qa'] }],
      } : p)),
  }
  const plan = computePlan(state)
  const pr = plan.projects.find((p) => p.key === TARGET.key)
  const jamesShare = pr.shares.james
  const kadeShare = pr.shares.kade
  const james = plan.people.find((p) => p.id === 'james')
  const kade = plan.people.find((p) => p.id === 'kade')
  // The control has the same two contributors and no cash: adding Kade moves
  // the hours share too, so comparing against the untouched plan would credit
  // the cash with a change it did not cause.
  const control = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === TARGET.key
      ? { ...p, contributors: [{ person: 'james', roles: ['dev'] }, { person: 'kade', roles: ['qa'] }] } : p)),
  })
  const kadeBefore = control.people.find((p) => p.id === 'kade')
  const jamesBefore = control.people.find((p) => p.id === 'james')

  /*
   * The cash follows the same rule the hours do: it goes to the PIC, whole.
   * It used to be split across the contributor record by role weight, so a QA
   * recorded on a project carried a share of its cash benefit — the same fault
   * that put projects on scorecards their owner did not run.
   */
  check('the project is not split at all', jamesShare === 1 && !kadeShare,
    JSON.stringify(pr.shares))
  check('THE CASH IS CREDITED WHOLLY TO THE PIC',
    Math.abs(james.finance.monetaryAnnualBenefit - CASH) < 0.01
    && !(kade.finance.monetaryAnnualBenefit > 0),
    `${Math.round(james.finance.monetaryAnnualBenefit)} + ${Math.round(kade.finance.monetaryAnnualBenefit)} of ${CASH}`)
  check('and a contributor who is not the PIC gets none of it',
    Math.abs(kade.finance.monetaryAnnualBenefit - kadeBefore.finance.monetaryAnnualBenefit) < 0.01)
  check("the PIC's value released rose by the whole of it",
    Math.abs((james.finance.annualBenefit - jamesBefore.finance.annualBenefit) - CASH) < 1,
    `${Math.round(jamesBefore.finance.annualBenefit)} -> ${Math.round(james.finance.annualBenefit)}`)
  check('and their FTE released did not', Math.abs(kade.finance.fteReleased - kadeBefore.finance.fteReleased) < 1e-9)
  check('the lead carries the whole of it',
    Math.abs(plan.people.find((p) => p.id === 'gun').finance.monetaryAnnualBenefit - CASH) < 0.01,
    String(Math.round(plan.people.find((p) => p.id === 'gun').finance.monetaryAnnualBenefit)))
}

/* ---------------- 6. the workbook ---------------- */
console.log('\n--- the workbook says the same everywhere ---')
{
  const state = {
    ...base,
    projects: base.projects.map((p) => (p.key === TARGET.key ? { ...p, monetaryBenefit: CASH } : p)),
  }
  const plan = computePlan(state)
  const wb = await buildWorkbook(plan, state)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())
  const pr = plan.projects.find((p) => p.key === TARGET.key)
  const jira = TARGET.jiraKey || TARGET.key

  const cellIn = (sheet, header, key, keyCol = 1) => {
    let col = -1
    let value = null
    sheet.eachRow((r) => {
      const vals = r.values.map((v) => String(v || '').trim())
      if (col < 0) {
        // r.values is 1-based with a hole at 0, so the entries can be undefined.
        const at = vals.findIndex((v) => typeof v === 'string' && v.startsWith(header))
        if (at > 0) col = at
      }
      if (col > 0 && String(r.getCell(keyCol).value || '') === key) value = r.getCell(col).value
    })
    return { col, value }
  }

  const reg = cellIn(back.getWorksheet('Projects'), 'Cash benefit/yr', TARGET.key)
  check('THE REGISTER CARRIES IT', reg.col > 0 && reg.value === CASH, `col ${reg.col}, ${reg.value}`)

  const er = back.getWorksheet('Effort_Return')
  let erCash = null
  let erBenefit = null
  let erCol = -1
  let benCol = -1
  er.eachRow((r) => {
    const vals = r.values.map((v) => String(v || '').trim())
    if (erCol < 0) {
      const at = vals.findIndex((v) => typeof v === 'string' && v.startsWith('Cash/yr'))
      if (at > 0) { erCol = at; benCol = vals.findIndex((v) => typeof v === 'string' && v.startsWith('Benefit/yr')) }
    }
    if (erCol > 0 && String(r.getCell(1).value || '') === jira && String(r.getCell(4).value || '').startsWith('TOTAL')) {
      erCash = r.getCell(erCol).value
      erBenefit = r.getCell(benCol).value
    }
  })
  check('THE ECONOMICS SHEET CARRIES IT', erCash === CASH, String(erCash))
  check('and its total benefit column includes it',
    erBenefit === Math.round(pr.annualBenefit), `${erBenefit} vs ${Math.round(pr.annualBenefit)}`)

  const person = cellIn(back.getWorksheet('Obj-James'), 'Cash benefit/yr', jira)
  const share = pr.shares.james ?? 1
  check('THE PERSON\'S SHEET CARRIES THEIR SHARE OF IT',
    person.col > 0 && Math.abs(person.value - CASH * share) < 1,
    `${person.value} vs ${Math.round(CASH * share)}`)

  const summary = back.getWorksheet('Summary')
  const rows = {}
  summary.eachRow((r) => { rows[String(r.getCell(1).value || '')] = r.getCell(2).value })
  const hoursLine = rows['Value of hours released (per year)']
  const cashLine = rows['Cash benefit stated on projects (per year)']
  const totalLine = rows['Total annual benefit']
  check('THE SUMMARY STATES BOTH HALVES SEPARATELY',
    cashLine === Math.round(plan.finance.monetaryAnnualBenefit)
    && hoursLine === Math.round(plan.finance.hoursAnnualBenefit),
    `hours ${hoursLine} + cash ${cashLine}`)
  check('and they add to the total it states',
    Math.abs(hoursLine + cashLine - totalLine) <= 1, `${hoursLine} + ${cashLine} vs ${totalLine}`)
  check('which is the app\'s own annual benefit',
    Math.abs(totalLine - plan.finance.annualBenefit) < 1,
    `${totalLine} vs ${Math.round(plan.finance.annualBenefit)}`)
}

/* ---------------- 7. the round trip ---------------- */
console.log('\n--- it survives the export-and-import round trip ---')
{
  const state = {
    ...base,
    projects: base.projects.map((p) => (p.key === TARGET.key ? { ...p, monetaryBenefit: CASH } : p)),
  }
  const plan = computePlan(state)
  const rows = plan.projects.filter((p) => p.key === TARGET.key)
  const wb = await buildFilteredWorkbook(rows, plan.assignees, '')
  const ws = wb.getWorksheet('Projects')
  const ix = {}
  ws.getRow(4).eachCell((c, i) => { const col = columnFor(c.value); if (col) ix[col.key] = i })

  check('the round-trip sheet has the column', ix.monetaryBenefit > 0, String(ix.monetaryBenefit))
  check('and writes the figure as a number', ws.getRow(5).getCell(ix.monetaryBenefit).value === CASH,
    String(ws.getRow(5).getCell(ix.monetaryBenefit).value))
  check('EXPORTING AND IMPORTING BACK CHANGES NOTHING',
    planImport(await readProjectsFile(await wb.xlsx.writeBuffer()), state, plan).changes.length === 0)

  ws.getRow(5).getCell(ix.monetaryBenefit).value = 750000
  const res = planImport(await readProjectsFile(await wb.xlsx.writeBuffer()), state, plan)
  check('editing it is one change', res.changes.length === 1 && res.changes[0].fields.length === 1,
    JSON.stringify(res.changes.map((c) => c.fields)))
  const after = applyImport(state.projects, res).find((p) => p.key === TARGET.key)
  check('and the figure is stored', after.monetaryBenefit === 750000, String(after.monetaryBenefit))
  const re = computePlan({ ...state, projects: applyImport(state.projects, res) })
  check('the app picks it straight up',
    re.projects.find((p) => p.key === TARGET.key).monetaryAnnualBenefit === 750000)
  check('and the hours are still untouched',
    Math.abs(re.totals.committedHours - plain.totals.committedHours) < 1e-9)

  ws.getRow(5).getCell(ix.monetaryBenefit).value = 'TBC'
  const cleared = planImport(await readProjectsFile(await wb.xlsx.writeBuffer()), state, plan)
  const gone = applyImport(state.projects, cleared).find((p) => p.key === TARGET.key)
  check('TBC clears it back to none', gone.monetaryBenefit === null, String(gone.monetaryBenefit))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
