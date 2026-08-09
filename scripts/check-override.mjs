/**
 * A figure typed over the calculated one, and the way back.
 *
 * What must hold:
 *   1. an override replaces what the SCORECARD claims — the tile, the KPI
 *      targets under it, the person's sheet — and the workbook says the same
 *      number the app does;
 *   2. it NEVER edits the project register. The book of record, the committed
 *      team total and every project ROI stay exactly what the projects say;
 *   3. the lead's card is still the sum of the cards it aggregates, so
 *      overriding somebody does not leave the lead disagreeing with them;
 *   4. the lead can be overridden too;
 *   5. reverting restores the calculated figure exactly, from the figure kept
 *      beside it rather than by re-deriving something that might not match;
 *   6. it is never silent — the app and the workbook both say it is manual.
 *
 * Run with: node scripts/check-override.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, personOverrides, hasOverride, weightsValid, weightSum,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }
const plain = computePlan(base)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const withOverride = (id, overrides) => ({
  ...base,
  people: base.people.map((p) => (p.id === id ? { ...p, overrides } : p)),
})
const who = (plan, id) => plan.people.find((p) => p.id === id)

/* ---------------- 1. reading an override ---------------- */
console.log('--- what counts as an override ---')
{
  check('a number is taken', personOverrides({ overrides: { hours: 200 } }).hours === 200)
  check('zero is a real figure, not an absence',
    personOverrides({ overrides: { hours: 0 } }).hours === 0)
  check('a negative one is refused', personOverrides({ overrides: { hours: -5 } }).hours === null)
  check('so is text', personOverrides({ overrides: { hours: 'lots' } }).hours === null)
  check('so is NaN and Infinity',
    personOverrides({ overrides: { hours: NaN } }).hours === null
    && personOverrides({ overrides: { hours: Infinity } }).hours === null)
  check('no overrides at all reads as none',
    personOverrides({}).hours === null && personOverrides(null).money === null)
  check('hasOverride says so plainly',
    hasOverride({ overrides: { money: 1 } }) && !hasOverride({ overrides: {} }))
}

/* ---------------- 2. it lands on the scorecard ---------------- */
console.log('\n--- it lands on the scorecard ---')
{
  const before = who(plain, 'james')
  const plan = computePlan(withOverride('james', { hours: 200 }))
  const after = who(plan, 'james')

  check('the headline becomes the typed figure', after.scorecardHours === 200, String(after.scorecardHours))
  check('THE CALCULATED FIGURE IS KEPT BESIDE IT',
    Math.abs(after.calcScorecardHours - before.scorecardHours) < 1e-9,
    `${after.calcScorecardHours} vs ${before.scorecardHours}`)
  check('and the card says it is manual', after.hoursOverridden === true && after.overridden === true)
  check('the money follows the hours at the same rate',
    Math.abs(after.finance.annualBenefit - before.finance.annualBenefit * (200 / before.scorecardHours)) < 0.01,
    `${Math.round(before.finance.annualBenefit)} -> ${Math.round(after.finance.annualBenefit)}`)
  check('but the money is not itself marked manual', after.moneyOverridden === false)
  check('THE KPI TARGETS UNDER IT STILL ADD TO THE HEADLINE',
    Math.abs(Object.values(after.byObjective).reduce((a, b) => a + b, 0) - 200) < 1e-6,
    `${Object.values(after.byObjective).reduce((a, b) => a + b, 0)} vs 200`)
  check('the card still totals 100%', weightsValid(after.kpiLines),
    `${(weightSum(after.kpiLines) * 100).toFixed(2)}%`)
  check('and nothing is blocked from saving', plan.invalid.length === 0)

  // an hours override with no calculated hours behind it
  const zero = computePlan(withOverride('pol', { hours: 500 }))
  check('someone with no credited hours can still be given a figure',
    who(zero, 'pol').scorecardHours === 500, String(who(zero, 'pol').scorecardHours))
  check('and it does not produce NaN anywhere',
    Number.isFinite(who(zero, 'pol').finance.annualBenefit), String(who(zero, 'pol').finance.annualBenefit))
}

/* ---------------- 3. money on its own ---------------- */
console.log('\n--- money can be typed over on its own ---')
{
  const before = who(plain, 'james')
  const after = who(computePlan(withOverride('james', { money: 1000000 })), 'james')
  check('the annual value becomes the typed figure',
    Math.abs(after.finance.annualBenefit - 1000000) < 1e-6, String(Math.round(after.finance.annualBenefit)))
  check('it is marked manual', after.moneyOverridden === true)
  check('THE HOURS ARE LEFT ALONE',
    Math.abs(after.scorecardHours - before.scorecardHours) < 1e-9,
    `${before.scorecardHours} vs ${after.scorecardHours}`)
  check('and the hours are not marked manual', after.hoursOverridden === false)
  check('the money KPI targets add to the new figure',
    Math.abs(Object.values(after.benefitByObjective).reduce((a, b) => a + b, 0) - 1000000) < 1,
    `${Math.round(Object.values(after.benefitByObjective).reduce((a, b) => a + b, 0))}`)

  const both = who(computePlan(withOverride('james', { hours: 300, money: 750000 })), 'james')
  check('both together each take their own value',
    both.scorecardHours === 300 && Math.abs(both.finance.annualBenefit - 750000) < 1e-6,
    `${both.scorecardHours} hrs / ${Math.round(both.finance.annualBenefit)}`)
  check('and a typed money figure wins over the one the hours imply',
    both.moneyOverridden && both.hoursOverridden)
}

/* ---------------- 4. the register is untouched ---------------- */
console.log('\n--- the project register is never edited ---')
{
  const plan = computePlan(withOverride('james', { hours: 9999, money: 99000000 }))
  check('THE COMMITTED TEAM TOTAL DOES NOT MOVE',
    Math.abs(plain.totals.committedHours - plan.totals.committedHours) < 1e-9,
    `${plain.totals.committedHours.toFixed(2)} vs ${plan.totals.committedHours.toFixed(2)}`)
  check('the book total does not move',
    Math.abs(plain.totals.totalHours - plan.totals.totalHours) < 1e-9)
  check('EVERY PROJECT IS BYTE-IDENTICAL',
    JSON.stringify(plain.projects) === JSON.stringify(plan.projects))
  check('so no project ROI, payback or investment moves',
    plain.projects.every((p, i) => p.roi === plan.projects[i].roi
      && p.paybackMonths === plan.projects[i].paybackMonths))
  check('and the person\'s own portfolio is the same rows',
    who(plain, 'james').rows.length === who(plan, 'james').rows.length)
  check('their OWN hours — their real share — are untouched',
    Math.abs(who(plain, 'james').ownHours - who(plan, 'james').ownHours) < 1e-9,
    `${who(plain, 'james').ownHours} vs ${who(plan, 'james').ownHours}`)
}

/* ---------------- 5. the lead ---------------- */
console.log('\n--- the lead still equals the cards it adds up ---')
{
  // The lead aggregates every card INCLUDING their own personal share — they
  // own projects too.
  const sumOfOthers = (plan) => plan.people
    .filter((p) => !p.aggregatesTeam)
    .reduce((a, p) => a + p.scorecardHours, 0) + (who(plan, 'gun').ownHours || 0)

  check('with nothing overridden the lead is the sum of the others',
    Math.abs(who(plain, 'gun').scorecardHours - sumOfOthers(plain)) < 1e-6,
    `${who(plain, 'gun').scorecardHours.toFixed(2)} vs ${sumOfOthers(plain).toFixed(2)}`)

  const plan = computePlan(withOverride('james', { hours: 200 }))
  check('AND STILL IS AFTER SOMEBODY IS OVERRIDDEN',
    Math.abs(who(plan, 'gun').scorecardHours - sumOfOthers(plan)) < 1e-6,
    `${who(plan, 'gun').scorecardHours.toFixed(2)} vs ${sumOfOthers(plan).toFixed(2)}`)
  check('the lead moved by exactly the amount the member did',
    Math.abs((who(plan, 'gun').scorecardHours - who(plain, 'gun').scorecardHours)
      - (200 - who(plain, 'james').scorecardHours)) < 1e-6,
    `${who(plain, 'gun').scorecardHours.toFixed(1)} -> ${who(plan, 'gun').scorecardHours.toFixed(1)}`)
  check('the lead is not itself marked manual for somebody else\'s figure',
    who(plan, 'gun').hoursOverridden === false)

  // the lead's own override
  const led = computePlan(withOverride('gun', { hours: 5000 }))
  check('THE LEAD CAN BE OVERRIDDEN TOO', who(led, 'gun').scorecardHours === 5000,
    String(who(led, 'gun').scorecardHours))
  check('and is marked manual', who(led, 'gun').hoursOverridden === true)
  check('with the calculated team figure kept beside it',
    Math.abs(who(led, 'gun').calcScorecardHours - who(plain, 'gun').scorecardHours) < 1e-6,
    `${who(led, 'gun').calcScorecardHours.toFixed(2)} vs ${who(plain, 'gun').scorecardHours.toFixed(2)}`)
  check('the members are untouched by the lead\'s override',
    Math.abs(who(led, 'james').scorecardHours - who(plain, 'james').scorecardHours) < 1e-9)
  check('every card still totals 100%', led.invalid.length === 0
    && led.people.every((p) => weightsValid(p.kpiLines)))
}

/* ---------------- 6. reverting ---------------- */
console.log('\n--- reverting puts back exactly what was there ---')
{
  for (const [id, ov] of [
    ['james', { hours: 200 }],
    ['james', { money: 1000000 }],
    ['james', { hours: 200, money: 1000000 }],
    ['gun', { hours: 5000 }],
    ['kade', { hours: 0 }],
  ]) {
    const on = computePlan(withOverride(id, ov))
    const off = computePlan(withOverride(id, {}))
    const label = `${id} ${JSON.stringify(ov)}`
    check(`${label}: the override took`, on.people.some((p) => p.overridden))
    check(`${label}: REVERTING RESTORES THE EXACT FIGURE`,
      Math.abs(who(off, id).scorecardHours - who(plain, id).scorecardHours) < 1e-9
      && Math.abs(who(off, id).finance.annualBenefit - who(plain, id).finance.annualBenefit) < 1e-6,
      `${who(off, id).scorecardHours} vs ${who(plain, id).scorecardHours}`)
    check(`${label}: and every card is back where it was`,
      off.people.every((p) => Math.abs(p.scorecardHours - who(plain, p.id).scorecardHours) < 1e-9))
    check(`${label}: with nothing left marked manual`, off.people.every((p) => !p.overridden))
  }
  check('the reverted plan is identical to the untouched one',
    JSON.stringify(computePlan(withOverride('james', {})).people.map((p) => p.scorecardHours))
    === JSON.stringify(plain.people.map((p) => p.scorecardHours)))
}

/* ---------------- 7. every person, every figure ---------------- */
console.log('\n--- every person, every figure ---')
{
  let broke = 0
  let leaked = 0
  let unmarked = 0
  for (const person of base.people.filter((p) => p.scorecard !== false)) {
    for (const ov of [{ hours: 123 }, { money: 456000 }, { hours: 0 }, { hours: 7, money: 8 }]) {
      const plan = computePlan(withOverride(person.id, ov))
      if (plan.invalid.length) broke++
      if (Math.abs(plan.totals.committedHours - plain.totals.committedHours) > 1e-9) leaked++
      if (!who(plan, person.id).overridden) unmarked++
    }
  }
  check('no override anywhere blocks saving', broke === 0, `${broke} broke`)
  check('NO OVERRIDE ANYWHERE MOVES THE COMMITTED TOTAL', leaked === 0, `${leaked} leaked`)
  check('and every one of them is marked manual', unmarked === 0, `${unmarked} unmarked`)
}

/* ---------------- 8. the workbook ---------------- */
console.log('\n--- the workbook says the same, and says it is manual ---')
{
  const state = withOverride('james', { hours: 200 })
  const plan = computePlan(state)
  const wb = await buildWorkbook(plan, state)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())

  const ws = back.getWorksheet('Obj-James')
  const banner = String(ws.getCell(2, 1).value || '')
  // By header name: the credited column has moved before.
  const creditedIn = (sheet) => {
    let col = -1
    let value = null
    let label = null
    sheet.eachRow((r) => {
      const vals = r.values.map((v) => String(v || '').trim())
      if (col < 0 && vals.indexOf('Credited') > 0) col = vals.indexOf('Credited')
      if (col > 0 && /^TOTAL CREDITED/.test(String(r.getCell(2).value || ''))) {
        label = String(r.getCell(2).value)
        value = r.getCell(col).value
      }
    })
    return { value, label, col }
  }
  const jamesTotal = creditedIn(ws)
  const totalRow = jamesTotal.label
  const credited = jamesTotal.value
  check('THE SHEET CARRIES THE MANUAL FIGURE', credited === 200, String(credited))
  check('and it is the number the app shows',
    credited === Math.round(who(plan, 'james').scorecardHours), `${credited} vs ${who(plan, 'james').scorecardHours}`)
  check('THE SHEET SAYS IT IS MANUAL', /MANUAL/.test(banner), banner.slice(0, 150))
  check('and states what the register calculates',
    /register calculates 80/.test(banner), banner.slice(-80))
  check('the totals row is marked too', /MANUAL/.test(totalRow || ''), String(totalRow))

  // the scorecard grid marks the person
  const grid = back.getWorksheet('Overall_Objectives')
  const heads = grid.getRow(4).values.map((v) => String(v || ''))
  check('the all-person grid marks them as well',
    heads.some((h) => /James/.test(h) && /MANUAL/.test(h)), heads.filter(Boolean).join(' | '))

  // the team-wide sheets are untouched
  const summary = back.getWorksheet('Summary')
  let committed = null
  summary.eachRow((r) => {
    if (/^Committed . bankable/i.test(String(r.getCell(1).value || ''))) committed = r.getCell(2).value
  })
  check('THE COMMITTED HEADLINE IS UNTOUCHED BY IT',
    Math.abs(committed - plain.totals.committedHours) < 0.51,
    `${committed} vs ${plain.totals.committedHours.toFixed(1)}`)

  // and with nothing overridden nothing is marked
  const cleanWb = await buildWorkbook(plain, base)
  const cleanBack = new ExcelJS.Workbook()
  await cleanBack.xlsx.load(await cleanWb.xlsx.writeBuffer())
  const cleanBanner = String(cleanBack.getWorksheet('Obj-James').getCell(2, 1).value || '')
  check('an untouched sheet says nothing about manual figures', !/MANUAL/.test(cleanBanner),
    cleanBanner.slice(0, 90))
  const cleanCredited = creditedIn(cleanBack.getWorksheet('Obj-James')).value
  check('and it carries the calculated figure',
    cleanCredited === Math.round(who(plain, 'james').scorecardHours),
    `${cleanCredited} vs ${Math.round(who(plain, 'james').scorecardHours)}`)

  // the lead's sheet follows the member
  const leadCredited = creditedIn(back.getWorksheet('Obj-Gun')).value
  check('THE LEAD\'S SHEET FOLLOWS THE MEMBER\'S MANUAL FIGURE',
    leadCredited === Math.round(who(plan, 'gun').scorecardHours),
    `${leadCredited} vs ${Math.round(who(plan, 'gun').scorecardHours)}`)
  check('and it is bigger than it was by exactly the difference',
    Math.abs((leadCredited - Math.round(who(plain, 'gun').scorecardHours)) - (200 - 79.5)) < 1.01,
    `${Math.round(who(plain, 'gun').scorecardHours)} -> ${leadCredited}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
