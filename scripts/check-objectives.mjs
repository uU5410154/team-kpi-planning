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
  // Objective 1 is a SHARE now — how much of somebody's work landed on the
  // timeline they committed to — rather than a return on money.
  check('exactly one is a ratio — a share of the work that landed on time',
    OBJECTIVES.filter((o) => targetKindFor(o.id) === 'percent').length === 1
    && MONEY_OBJECTIVE === 'delivery',
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
    projectObjectives({ objective: 'delivery' }).join(',') === 'delivery')
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
  const line1 = lead.kpiLines.find((l) => l.objective === MONEY_OBJECTIVE)
  check('OBJECTIVE 1 CARRIES NO HOURS', line1?.creditedHours == null)
  /*
   * It is on-time delivery now, at the request of the boss: a Tech team was
   * being measured on how profitable the work it was handed happened to be,
   * which it does not choose. What it does choose is whether it lands what it
   * said it would, when it said it would.
   */
  check('its target is the drift limit, stated as a percentage',
    line1.targetKind === 'percent'
    && Math.abs(line1.target - plain.settings.maxDriftedShare * 100) < 1e-9,
    `${line1.target}% vs the limit ${plain.settings.maxDriftedShare * 100}%`)
  check('ITS ACTUAL IS THE SHARE OF THE BOOK THAT DRIFTED, NOT A RETURN',
    line1.creditedRatio === (line1.held ? line1.driftedCount / line1.held : null),
    `${line1.driftedCount} of ${line1.held} held`)
  check('and it is not the return, which measures something else entirely',
    line1.creditedRatio !== lead.avgProjectRoi || lead.avgProjectRoi == null,
    `delivery ${line1.creditedRatio} vs return ${lead.avgProjectRoi}`)
  check('with the return kept beside it, since it is still worth seeing',
    line1.portfolioRatio === lead.finance.roi,
    `${line1.portfolioRatio} vs ${lead.finance.roi}`)
  check('and it says how much work it judged',
    typeof line1.judged === 'number' && typeof line1.sprintDays === 'number',
    `${line1.judged} judged, tolerance ${line1.sprintDays} days`)
  check('EVERY SCORECARD CARRIES OBJECTIVE 1, TAGGED OR NOT',
    plain.people.every((x) => x.kpiLines.some((l) => l.targetKind === 'percent' && !l.custom)),
    plain.people.filter((x) => !x.kpiLines.some((l) => l.targetKind === 'percent')).map((x) => x.nick).join(','))
  check('the average counts each project once, whatever its size', (() => {
    const priced = computePlan({
      ...base,
      projects: base.projects.map((p, i) => (p.savingHours > 0 ? { ...p, manday: 5 + (i % 40) } : p)),
    }).people.find((x) => x.id === 'kade')
    const rows = priced.rows.filter((r) => r.p.roi != null
      && (r.p.commitLevel === 'commit' || r.p.commitLevel === 'stretch'))
    const mean = rows.reduce((a, r) => a + r.p.roi, 0) / rows.length
    return Math.abs(priced.avgProjectRoi - mean) < 1e-9
  })())
  check('with the money it is built from stated beside it',
    Math.abs(line1.creditedMoney - lead.finance.annualBenefit) < 1e-6)
  /*
   * It recalculates when a DATE changes, not when a cost does. That is the
   * whole point of the change: a cost estimate moving no longer moves anybody's
   * objective 1, and a project landing late does.
   */
  check('AND IT RECALCULATES WHEN A DELIVERY DATE CHANGES', (() => {
    // Everything lands on its date, then everything lands a year late. The
    // first is no drift at all, the second is drift on everything dated.
    const onTime = computePlan({
      ...base,
      projects: base.projects.map((p) => (p.due ? { ...p, actualEnd: p.due, status: 'Done' } : p)),
    }).people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    const slipped = computePlan({
      ...base,
      projects: base.projects.map((p) => (p.due
        ? { ...p, actualEnd: '2027-12-31', status: 'Done' }
        : p)),
    }).people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    return onTime.creditedRatio === 0 && onTime.meetsTarget === true
      && slipped.creditedRatio > onTime.creditedRatio && slipped.meetsTarget === false
  })())
  check('  while a cost estimate changing leaves it exactly where it was', (() => {
    const heavier = computePlan({
      ...base,
      projects: base.projects.map((p) => (p.savingHours > 0 ? { ...p, manday: 200 } : p)),
    }).people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    return heavier.creditedRatio === line1.creditedRatio
  })(), 'a Tech team is not measured on how profitable its handed work happens to be')
  check('and the target follows the limit when the limit is changed', (() => {
    const strict = computePlan({
      ...base,
      settings: { ...DEFAULT_SETTINGS, maxDriftedShare: 0.05 },
    }).people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    return strict.target === 5
  })())
  check('and the tolerance moves what counts as on time', (() => {
    const tight = computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, sprintDays: 0 } })
      .people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    const loose = computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, sprintDays: 365 } })
      .people.find((x) => x.id === 'gun').kpiLines.find((l) => l.targetKind === 'percent')
    return (loose.creditedRatio ?? 0) >= (tight.creditedRatio ?? 0)
  })(), 'a longer tolerance can only ever forgive more, never less')
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
    /*
     * Not `outsideTeam`: a dashboard IT built is a dashboard, but it is not
     * one of OUR deliverables, so it cannot sit on our card.
     *
     * And not one with no PIC either. The lead's card is the sum of the
     * members' cards, and a project nobody is named to reaches none of them —
     * it is counted in the book and named in totals.unownedHours instead.
     */
    const counted = plain.projects.filter((p) => servesObjective(p, id) && !p.outsideTeam && p.pic
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
  check('while every counted objective now counts the whole of the team\'s book',
    COUNT_OBJECTIVES.every((id) => who(all, 'gun').countByObjective[id]
      === plain.projects.filter((p) => !p.outsideTeam && p.pic
        && (p.commitLevel === 'commit' || p.commitLevel === 'stretch')).length),
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

/* ---------------- 8. the workbook reads the same average ---------------- */
console.log(String.fromCharCode(10) + '--- the exported total row is the same average the card shows ---')
{
  const priced = {
    ...base,
    projects: base.projects.map((p, i) => (p.savingHours > 0 ? { ...p, manday: 5 + (i % 40) } : p)),
  }
  const plan = computePlan(priced)
  const wb = await buildWorkbook(plan, priced)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())

  for (const p of plan.people) {
    const ws = back.getWorksheet(`Obj-${p.nick}`.replace(/[:\\?*[\]/]/g, '').slice(0, 31))
    let col = -1
    let totalRoi = null
    ws.eachRow((r) => {
      const vals = r.values.map((v) => String(v || '').trim())
      if (col < 0 && vals.indexOf('ROI') > 0) col = vals.indexOf('ROI')
      if (col > 0 && /^TOTAL CREDITED/.test(String(r.getCell(2).value || ''))) totalRoi = r.getCell(col).value
    })
    check(`${p.nick}: THE SHEET'S ROI IS THE AVERAGE THE CARD READS`,
      p.avgProjectRoi == null
        ? totalRoi == null
        : Math.abs(totalRoi - p.avgProjectRoi) < 1e-4,
      `${totalRoi} vs ${p.avgProjectRoi == null ? null : p.avgProjectRoi.toFixed(4)}`)
    const line = p.kpiLines.find((l) => l.targetKind === 'percent')
    check(`${p.nick}: AND IT IS NO LONGER WHAT OBJECTIVE 1 MEASURES`,
      line.creditedRatio == null || p.avgProjectRoi == null
      || line.creditedRatio !== p.avgProjectRoi,
      `delivery ${line.creditedRatio} vs return ${p.avgProjectRoi}`)
    check(`${p.nick}: and the sheet still states the return beside it`,
      (line?.portfolioRatio ?? null) === (p.finance?.roi ?? null),
      'the return did not stop existing, it stopped being the KPI')
  }
}

/* ====== objective 1 is a list of dates ====== */
console.log(String.fromCharCode(10) + '--- objective 1 names every project a person runs, and its date ---')
{
  const dated = computePlan({
    ...base,
    projects: base.projects.map((p, i) => ({
      ...p,
      pic: i % 2 === 0 ? 'kade' : p.pic,
      due: i % 5 === 0 ? null : (p.due || '2026-06-30'),
      actualEnd: i % 3 === 0 ? '2026-07-05' : p.actualEnd,
      status: i % 3 === 0 ? 'Done' : p.status,
    })),
  })
  const kade = dated.people.find((x) => x.id === 'kade')
  const owned = dated.projects.filter((x) => x.pic === 'kade'
    && x.commitLevel !== 'nextyear' && x.commitLevel !== 'excluded')

  check('EVERY PROJECT A PERSON IS PIC OF IS ON THEIR OBJECTIVE 1',
    kade.commitments.length === owned.length,
    `${kade.commitments.length} listed vs ${owned.length} they run`)
  check('  and nothing they merely contribute to is',
    kade.commitments.every((c) => owned.some((o) => o.key === c.key)))
  check('  each one carries the date it must land by',
    kade.commitments.every((c) => 'due' in c && 'actualEnd' in c && 'met' in c))
  check('  in date order, so the next thing due reads first',
    kade.commitments.every((c, i, a) => i === 0
      || String(a[i - 1].due || '9999') <= String(c.due || '9999')),
    kade.commitments.slice(0, 4).map((c) => c.due || 'none').join(' -> '))

  // A project with no date is listed and counted as a gap, not as a pass.
  const undated = kade.commitments.filter((c) => !c.due)
  check('A PROJECT WITH NO COMMITTED DATE IS SHOWN AS A GAP',
    undated.length === kade.undatedCount && undated.every((c) => c.met === null),
    `${kade.undatedCount} with no date, none of them scored`)

  // The share is the roll-up of the list, not a separate calculation.
  const line = kade.kpiLines.find((l) => l.targetKind === 'percent' && !l.custom)
  const judged = kade.commitments.filter((c) => c.judged)
  check('THE PERCENTAGE IS THE LIST ROLLED UP, NOT A SECOND OPINION',
    line.judged === judged.length
    && line.onTime === judged.filter((c) => c.met).length,
    `${line.onTime}/${line.judged} vs ${judged.filter((c) => c.met).length}/${judged.length}`)
  check('  and only what has an answer is counted',
    judged.every((c) => c.met !== null) && line.judged <= kade.commitments.length)

  // Reassigning the PIC moves the commitment with it.
  const moved = computePlan({
    ...base,
    projects: base.projects.map((p, i) => (i === 0 ? { ...p, pic: 'pol', due: '2026-05-05' } : p)),
  })
  const polHas = moved.people.find((x) => x.id === 'pol').commitments.some((c) => c.due === '2026-05-05')
  check('A DATE FOLLOWS THE PIC WHEN THE PIC CHANGES', polHas,
    'whoever runs the project owns the date')
}

/* ====== the two drift limits ====== */
console.log(String.fromCharCode(10) + '--- a project may drift 20% of its own length; a person 15% of their book ---')
{
  const at = (d) => d
  const proj = (key, pic, start, due, end, extra = {}) => ({
    key, jiraKey: key, summary: key, pic, start: at(start), due: at(due), actualEnd: end,
    status: end ? 'Done' : 'In Progress', commitLevel: 'commit', objective: 'process_automation',
    savingHours: 10, contributors: [{ person: pic, roles: ['dev'] }], ...extra,
  })

  // A hundred-day project: 20% is twenty days.
  const plan = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, maxProjectDrift: 0.2, maxDriftedShare: 0.15 },
    projects: [
      proj('A-1', 'kade', '2026-01-01', '2026-04-11', '2026-04-11'),      // on the day
      proj('A-2', 'kade', '2026-01-01', '2026-04-11', '2026-04-30'),      // 19 days, inside 20%
      proj('A-3', 'kade', '2026-01-01', '2026-04-11', '2026-05-05'),      // 24 days, over
      proj('A-4', 'kade', '2026-04-11', '2026-01-01', '2026-05-05'),      // plan runs backwards
    ],
  })
  const kade = plan.people.find((x) => x.id === 'kade')
  const by = (k) => kade.commitments.find((c) => c.key === k)

  check('a project that lands on the day has not drifted', by('A-1').drifted === false,
    `${by('A-1').driftDays} days out`)
  check('NINETEEN DAYS ON A HUNDRED-DAY PLAN IS WITHIN 20%', by('A-2').drifted === false,
    `${by('A-2').driftDays}d of ${by('A-2').plannedDays}d = ${Math.round(by('A-2').driftShare * 100)}%`)
  check('TWENTY-FOUR IS NOT', by('A-3').drifted === true,
    `${by('A-3').driftDays}d of ${by('A-3').plannedDays}d = ${Math.round(by('A-3').driftShare * 100)}%`)
  check('  so the limit is a share of the project, not a flat number of days',
    by('A-2').driftAllowance === by('A-3').driftAllowance && by('A-2').driftAllowance === 20,
    `allowance ${by('A-2').driftAllowance} days on a ${by('A-2').plannedDays}-day plan`)

  check('A PLAN THAT ENDS BEFORE IT STARTS IS FLAGGED, NOT DIVIDED BY',
    by('A-4').plannedBackwards === true && by('A-4').driftShare === null,
    'data to fix, not performance to judge')

  // The book: 1 of 4 over is 25%, above the 15% allowed.
  const line = kade.kpiLines.find((l) => l.targetKind === 'percent' && !l.custom)
  check('THE CARD COUNTS DRIFTED PROJECTS AGAINST EVERYTHING HELD',
    line.held === 4 && line.driftedCount === kade.commitments.filter((c) => c.drifted).length,
    `${line.driftedCount} of ${line.held}`)
  check('  and it is met by staying UNDER the limit, not over it',
    line.lowerIsBetter === true
    && line.meetsTarget === (line.creditedRatio * 100 <= line.target + 1e-9),
    `${Math.round(line.creditedRatio * 100)}% against a limit of ${line.target}%`)
  check('  the limit defaults to the share the settings name', line.target === 15)

  // Held, not judged: unfinished work still counts in the denominator.
  const withPending = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, maxProjectDrift: 0.2, maxDriftedShare: 0.15 },
    projects: [
      proj('B-1', 'kade', '2026-01-01', '2026-04-11', '2026-06-30'),
      ...Array.from({ length: 9 }, (_, i) => proj(`B-${i + 2}`, 'kade', '2026-01-01', '2026-12-31', null)),
    ],
  }).people.find((x) => x.id === 'kade')
  const l2 = withPending.kpiLines.find((l) => l.targetKind === 'percent' && !l.custom)
  check('ONE DRIFT IN TEN HELD IS 10%, NOT 100%',
    l2.held === 10 && Math.abs(l2.creditedRatio - 0.1) < 1e-9,
    `${l2.driftedCount} of ${l2.held} = ${Math.round(l2.creditedRatio * 100)}%`)
  check('  because measuring only finished work would flatter a full pipeline',
    l2.meetsTarget === true, 'within 15%')

  // Both limits move from the Model tab.
  const strict = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, maxProjectDrift: 0.05, maxDriftedShare: 0.5 },
    projects: [proj('C-1', 'kade', '2026-01-01', '2026-04-11', '2026-04-30')],
  }).people.find((x) => x.id === 'kade')
  check('TIGHTENING THE PER-PROJECT LIMIT CATCHES MORE',
    strict.commitments[0].drifted === true,
    '19 days is inside 20% and outside 5%')
  check('  and the book limit is what the card is judged against',
    strict.kpiLines.find((l) => l.targetKind === 'percent' && !l.custom).target === 50)
}

/* ====== one free re-plan, after requirement gathering ====== */
console.log(String.fromCharCode(10) + '--- everybody may re-plan a project once ---')
{
  const { replanPatch, driftOf } = await import('../src/lib/model.js')

  let p = { key: 'R-1', due: null, replanCount: 0 }
  p = { ...p, ...replanPatch(p, '2026-06-30') }
  check('SETTING THE FIRST DATE IS NOT A RE-PLAN',
    p.replanCount === 0 && p.baselineDue === '2026-06-30',
    'a commitment made is not a commitment moved')

  p = { ...p, ...replanPatch(p, '2026-08-31') }
  check('MOVING IT ONCE AFTER REQUIREMENTS IS THE FREE ONE',
    p.replanCount === 1 && p.baselineDue === '2026-06-30' && p.due === '2026-08-31',
    'the baseline remembers where it started')

  p = { ...p, ...replanPatch(p, '2026-10-31') }
  check('  and a second move is counted', p.replanCount === 2)
  const same = { ...p, ...replanPatch(p, '2026-10-31') }
  check('  while setting the same date again is not a move', same.replanCount === 2)

  // Delivered exactly on the re-planned date: the free re-plan costs nothing.
  const clean = driftOf({
    replanCount: 1,
    timeline: { comparable: true, lateBy: 0, plannedDays: 100 },
  })
  check('A PROJECT DELIVERED ON ITS RE-PLANNED DATE HAS NOT DRIFTED',
    clean.drifted === false && clean.replanned === true,
    'the allowance exists to be used')

  const twice = driftOf({
    replanCount: 2,
    timeline: { comparable: true, lateBy: 0, plannedDays: 100 },
  })
  check('BUT RE-PLANNING TWICE IS DRIFT, EVEN IF IT THEN LANDS ON THE DAY',
    twice.drifted === true && twice.overReplanned === true,
    'a commitment that can be rewritten indefinitely is not a commitment')

  // And it flows through a real plan, on both edit paths.
  const plan = computePlan({
    ...base,
    projects: base.projects.map((x, i) => (i === 0
      ? { ...x, pic: 'kade', start: '2026-01-01', due: '2026-04-11', baselineDue: '2026-02-01', replanCount: 2, actualEnd: '2026-04-11', status: 'Done' }
      : x)),
  })
  const row = plan.people.find((x) => x.id === 'kade').commitments.find((c) => c.replans === 2)
  check('the card shows a twice-moved project as drifted',
    !!row && row.drifted === true && row.overReplanned === true,
    row ? `${row.jiraKey || row.key}: baseline ${row.baselineDue}, now ${row.due}` : 'not found')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
