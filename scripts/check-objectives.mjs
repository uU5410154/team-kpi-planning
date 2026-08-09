/**
 * One project, several objectives — counted once.
 *
 * A dashboard removes manual work AND is a dashboard delivered. An OCR job
 * removes manual work AND is an end-to-end automation. The plan has to be able
 * to say both without stating the same saving twice.
 *
 * The rule that makes it safe: each objective is measured in a DIFFERENT unit.
 *   Obj 1  money      — every released hour priced, plus cash stated outright
 *   Obj 2  hours      — every saving hour in the plan, whatever else it serves
 *   Obj 3  milestone  — a date; its projects give their hours to Obj 2
 *   Obj 4  count      — dashboards delivered
 *   Obj 5  count      — end-to-end / AI solutions delivered
 *
 * So hours land on exactly one objective, money is those same hours priced
 * rather than a second helping, and a counted objective counts deliverables.
 *
 * Run with: node scripts/check-objectives.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, targetKindFor, projectObjectives, servesObjective,
  HOURS_OBJECTIVE, MONEY_OBJECTIVE, COUNT_OBJECTIVES, weightsValid, fmtTarget,
} from '../src/lib/model.js'
import { OBJECTIVES, OBJ_BY_ID } from '../src/lib/palette.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }
const plain = computePlan(base)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const tag = (key, ids) => ({
  ...base,
  projects: base.projects.map((p) => (p.key === key ? { ...p, objectives: ids } : p)),
})
const who = (plan, id) => plan.people.find((p) => p.id === id)

/* ---------------- 1. the units ---------------- */
console.log('--- each objective is measured in its own unit ---')
{
  check('EXACTLY ONE OBJECTIVE IS MEASURED IN HOURS',
    OBJECTIVES.filter((o) => targetKindFor(o.id) === 'hours').length === 1,
    OBJECTIVES.map((o) => `${o.no}:${targetKindFor(o.id)}`).join(' '))
  check('and it is the one the engine uses', HOURS_OBJECTIVE === 'process_automation', String(HOURS_OBJECTIVE))
  check('exactly one is a ratio — a floor the plan has to clear',
    OBJECTIVES.filter((o) => targetKindFor(o.id) === 'percent').length === 1
    && MONEY_OBJECTIVE === 'financial',
    OBJECTIVES.map((o) => `${o.no}:${targetKindFor(o.id)}`).join(' '))
  check('and no objective states a bare money amount as its target',
    OBJECTIVES.every((o) => targetKindFor(o.id) !== 'thb'))
  check('two are counted', COUNT_OBJECTIVES.join(',') === 'efficiency,ai_automation', COUNT_OBJECTIVES.join(','))
  check('and each counted one says what it counts',
    COUNT_OBJECTIVES.every((id) => !!OBJ_BY_ID[id].countUnit),
    COUNT_OBJECTIVES.map((id) => `${id}:${OBJ_BY_ID[id].countUnit}`).join(' '))
  check('one is a milestone', targetKindFor('datawarehouse') === 'text')
  check('so no two objectives share a unit that could double-count hours',
    OBJECTIVES.filter((o) => targetKindFor(o.id) === 'hours').length === 1)
}

/* ---------------- 2. tags ---------------- */
console.log('\n--- a project can answer to several ---')
{
  const p = { objective: 'process_automation', objectives: ['efficiency', 'ai_automation'] }
  check('the primary tag is included', projectObjectives(p).includes('process_automation'))
  check('and so are the others', projectObjectives(p).length === 3, projectObjectives(p).join(','))
  check('they come back in guideline order',
    projectObjectives(p).join(',') === 'process_automation,efficiency,ai_automation')
  check('a repeat of the primary is not listed twice',
    projectObjectives({ objective: 'efficiency', objectives: ['efficiency'] }).length === 1)
  check('an unknown id is dropped',
    projectObjectives({ objective: 'efficiency', objectives: ['wizardry'] }).join(',') === 'efficiency')
  check('no tags at all still gives the primary',
    projectObjectives({ objective: 'financial' }).join(',') === 'financial')
  check('servesObjective answers for any of them',
    servesObjective(p, 'ai_automation') && !servesObjective(p, 'datawarehouse'))
}

/* ---------------- 3. every hour lands on objective 2 ---------------- */
console.log('\n--- every saving hour lands on the hours objective ---')
{
  const lead = who(plain, 'gun')
  check('THE HOURS OBJECTIVE CARRIES THE WHOLE BOOK',
    Math.abs((lead.byObjective[HOURS_OBJECTIVE] || 0) - lead.scorecardHours) < 1e-6,
    `${Math.round(lead.byObjective[HOURS_OBJECTIVE] || 0)} vs ${Math.round(lead.scorecardHours)}`)
  check('and no other objective carries any hours at all',
    OBJECTIVES.filter((o) => o.id !== HOURS_OBJECTIVE)
      .every((o) => !(lead.byObjective[o.id] > 0)),
    Object.entries(lead.byObjective).map(([k, v]) => `${k}:${Math.round(v)}`).join(' '))
  check('including the projects tagged to a counted objective',
    (() => {
      const dash = base.projects.filter((p) => p.objective === 'efficiency' && p.savingHours > 0)
      const hrs = dash.reduce((a, p) => a + p.savingHours, 0)
      return hrs > 0 && (lead.byObjective[HOURS_OBJECTIVE] || 0) >= hrs
    })(), 'dashboard hours are inside the hours objective')
  for (const p of plain.people) {
    check(`${p.nick}: their hours objective equals their credited hours`,
      Math.abs((p.byObjective[HOURS_OBJECTIVE] || 0) - p.registerHours) < 1e-6,
      `${Math.round(p.byObjective[HOURS_OBJECTIVE] || 0)} vs ${Math.round(p.registerHours)}`)
  }
}

/* ---------------- 4. objective 1 prices those same hours ---------------- */
console.log('\n--- objective 1 prices the same hours, it does not repeat them ---')
{
  const lead = who(plain, 'gun')
  const money = lead.benefitByObjective[MONEY_OBJECTIVE] || 0
  check('the money objective carries the whole annual benefit',
    Math.abs(money - lead.finance.annualBenefit) < 1,
    `${Math.round(money)} vs ${Math.round(lead.finance.annualBenefit)}`)
  check('and it is the hours priced, at the rate the model states',
    Math.abs(money - (lead.scorecardHours * plain.finance.acctHourRate * 12)) < 1,
    `${Math.round(money)} vs ${Math.round(lead.scorecardHours * plain.finance.acctHourRate * 12)}`)
  const roiLine = lead.kpiLines.find((l) => l.objective === MONEY_OBJECTIVE)
  check('THE RETURN LINE CARRIES NO HOURS', roiLine?.creditedHours == null)
  check('its target is the gate, stated as a percentage',
    roiLine.targetKind === 'percent'
    && Math.abs(roiLine.target - plain.finance.roiGate * 100) < 1e-9,
    `${roiLine.target}% vs gate ${plain.finance.roiGate * 100}%`)
  check('and its ACTUAL is the return the plan is carrying',
    roiLine.creditedRatio === lead.finance.roi,
    `${roiLine.creditedRatio} vs ${lead.finance.roi}`)
  check('with the money it is built from stated beside it',
    Math.abs(roiLine.creditedMoney - lead.finance.annualBenefit) < 1e-6)
  check('AND IT RECALCULATES WHEN A COST CHANGES', (() => {
    const heavier = computePlan({
      ...base,
      projects: base.projects.map((p) => (p.savingHours > 0 ? { ...p, manday: 200 } : p)),
    }).people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    return heavier.creditedRatio !== roiLine.creditedRatio && heavier.meetsTarget === false
  })())
  check('and the target follows the gate when the gate is changed', (() => {
    const strict = computePlan({
      ...base,
      settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_SETTINGS.finance, roiGate: 5 } },
    }).people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    return strict.target === 500
  })())
  check('so the card total is the hours ONCE, not twice',
    Math.abs(lead.kpiTotals.savingHours - lead.registerHours) < 1e-6,
    `${Math.round(lead.kpiTotals.savingHours)} vs ${Math.round(lead.registerHours)}`)
}

/* ---------------- 5. counted objectives count ---------------- */
console.log('\n--- a counted objective counts deliverables ---')
{
  const lead = who(plain, 'gun')
  for (const id of COUNT_OBJECTIVES) {
    const line = lead.kpiLines.find((l) => l.objective === id && !l.custom)
    const counted = plain.projects.filter((p) => servesObjective(p, id)
      && (p.commitLevel === 'commit' || p.commitLevel === 'stretch')).length
    check(`${OBJ_BY_ID[id].no}: the target is a number of ${OBJ_BY_ID[id].countUnit}`,
      line?.targetKind === 'number' && line.unit === OBJ_BY_ID[id].countUnit,
      `${line?.targetKind} / ${line?.unit}`)
    check(`${OBJ_BY_ID[id].no}: and it is what the team is delivering`,
      line.target === counted, `${line.target} vs ${counted} counted projects`)
    check(`${OBJ_BY_ID[id].no}: it carries no hours`, line.creditedHours == null)
    check(`${OBJ_BY_ID[id].no}: and it reads with its unit`,
      new RegExp(OBJ_BY_ID[id].countUnit).test(fmtTarget(line)), fmtTarget(line))
  }
}

/* ---------------- 6. tagging adds a count, never an hour ---------------- */
console.log('\n--- tagging a project to more objectives adds no hours ---')
{
  const big = base.projects.find((p) => p.objective === 'process_automation' && p.savingHours > 0)
  const before = who(plain, 'gun')
  const after = who(computePlan(tag(big.key, ['efficiency', 'ai_automation'])), 'gun')

  check('the two counts each go up by one',
    (after.countByObjective.efficiency || 0) === (before.countByObjective.efficiency || 0) + 1
    && (after.countByObjective.ai_automation || 0) === (before.countByObjective.ai_automation || 0) + 1,
    `${before.countByObjective.efficiency}->${after.countByObjective.efficiency}, `
    + `${before.countByObjective.ai_automation}->${after.countByObjective.ai_automation}`)
  check('AND NOT ONE HOUR MOVES',
    Math.abs(after.byObjective[HOURS_OBJECTIVE] - before.byObjective[HOURS_OBJECTIVE]) < 1e-9,
    `${Math.round(before.byObjective[HOURS_OBJECTIVE])} vs ${Math.round(after.byObjective[HOURS_OBJECTIVE])}`)
  check('the card total is unchanged',
    Math.abs(after.kpiTotals.savingHours - before.kpiTotals.savingHours) < 1e-9)
  check('the money is unchanged',
    Math.abs(after.finance.annualBenefit - before.finance.annualBenefit) < 1e-6)

  const plan = computePlan(tag(big.key, ['efficiency', 'ai_automation']))
  check('THE COMMITTED BOOK DOES NOT MOVE',
    Math.abs(plan.totals.committedHours - plain.totals.committedHours) < 1e-9,
    `${plain.totals.committedHours.toFixed(2)} vs ${plan.totals.committedHours.toFixed(2)}`)
  check('every card still totals 100%',
    plan.people.every((p) => weightsValid(p.kpiLines)) && plan.invalid.length === 0)
  check('and the project still reports one primary objective',
    plan.projects.find((p) => p.key === big.key).objective === 'process_automation')

  // every project tagged to everything: still exactly one set of hours
  const all = computePlan({
    ...base,
    projects: base.projects.map((p) => ({ ...p, objectives: OBJECTIVES.map((o) => o.id) })),
  })
  check('TAGGING EVERY PROJECT TO EVERY OBJECTIVE STILL COUNTS THE HOURS ONCE',
    Math.abs(all.totals.totalHours - plain.totals.totalHours) < 1e-9,
    `${plain.totals.totalHours.toFixed(2)} vs ${all.totals.totalHours.toFixed(2)}`)
  check('and the lead\'s card still states its own hours once',
    Math.abs(who(all, 'gun').kpiTotals.savingHours - who(plain, 'gun').kpiTotals.savingHours) < 1e-6,
    `${Math.round(who(all, 'gun').kpiTotals.savingHours)}`)
  check('while every counted objective now counts the whole book',
    COUNT_OBJECTIVES.every((id) => who(all, 'gun').countByObjective[id]
      === plain.projects.filter((p) => p.commitLevel === 'commit' || p.commitLevel === 'stretch').length),
    COUNT_OBJECTIVES.map((id) => `${id}:${who(all, 'gun').countByObjective[id]}`).join(' '))
  check('and nothing is blocked from saving', all.invalid.length === 0)
}

/* ---------------- 7. the workbook ---------------- */
console.log('\n--- the workbook states each objective in its own unit ---')
{
  const wb = await buildWorkbook(plain, base)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())
  const ws = back.getWorksheet('Overall_Objectives')

  // Gun is the first person block: target / weight / actual at columns 4,5,6
  const rows = {}
  ws.eachRow((r) => {
    const label = String(r.getCell(3).value || '')
    if (/^\[Obj \d\]/.test(label)) rows[label.match(/^\[Obj (\d)\]/)[1]] = r
  })
  const lead = who(plain, 'gun')
  for (const o of OBJECTIVES) {
    const r = rows[String(o.no)]
    check(`Obj ${o.no} is on the grid`, !!r, o.name)
    if (!r) continue
    const actual = r.getCell(6).value
    const want = o.measure === 'money' ? (lead.benefitByObjective[o.id] || 0)
      : o.measure === 'count' ? (lead.countByObjective[o.id] || 0)
        : (lead.byObjective[o.id] || 0)
    check(`  and its Actual is stated in its own unit`,
      Math.abs(actual - Math.round(want)) <= 1, `${actual} vs ${Math.round(want)}`)
  }
  check('THE HOURS APPEAR ON EXACTLY ONE ROW OF THE GRID',
    OBJECTIVES.filter((o) => (rows[String(o.no)]?.getCell(6).value || 0) === Math.round(lead.registerHours)).length === 1,
    OBJECTIVES.map((o) => `${o.no}:${rows[String(o.no)]?.getCell(6).value}`).join(' '))

  let totalRow = null
  ws.eachRow((r) => { if (/TOTAL SAVING/.test(String(r.getCell(3).value || ''))) totalRow = r })
  check('and the saving-hours total row still states the person\'s own hours',
    Math.abs(totalRow.getCell(4).value - lead.kpiTotals.savingHours) < 0.06,
    `${totalRow.getCell(4).value} vs ${lead.kpiTotals.savingHours.toFixed(1)}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
