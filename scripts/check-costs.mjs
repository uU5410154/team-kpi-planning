/**
 * CAPEX and OPEX — the cost side of Objective 1.
 *
 * What this locks down:
 *   1. the month grid respects each line's start and end month
 *   2. opexYear is the grid; opexRunRate deliberately IGNORES start/end
 *   3. investment combines build cost and CAPEX, with either side unknown
 *   4. a project with a CAPEX and no mandays gets a return
 *   5. OPEX above the benefit gives a negative net, a NULL payback, a loss
 *   6. the portfolio and per-person sums equal the per-project sums, over the
 *      same set of rows and on the same share as the hours
 *   7. junk — NaN, Infinity, negative, missing, hand-edited — never propagates
 *   8. the exported workbook carries exactly the same numbers
 *
 * Run with: node scripts/check-costs.mjs
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, projectFinance, projectCosts, normalizeOpex, totalInvestment, paybackMonths,
  financeRates, gateStatus, isInPlan, countsToPool, isCounted,
  DEFAULT_SETTINGS, DEFAULT_FINANCE, MONTHS_IN_YEAR, MONTH_LABELS, newProject, newOpexLine,
  fmtMoney, fmtRoi,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = {
  meta: seed.meta,
  people: seed.people,
  projects: seed.projects,
  settings: DEFAULT_SETTINGS,
  scenarioName: 'costs',
}
const R = financeRates(DEFAULT_SETTINGS)
const H = R.horizonMonths

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol
const line = (o) => ({ id: o.id || 'l1', label: o.label || 'line', monthly: o.monthly, startMonth: o.startMonth ?? 1, endMonth: o.endMonth ?? 12 })

/* ================= 1. the month grid ================= */
console.log('--- the month grid respects start and end months ---')
{
  const c = projectCosts({ opex: [line({ monthly: 1000, startMonth: 3, endMonth: 6 })] })
  check('twelve columns, always', c.opexByMonth.length === MONTHS_IN_YEAR, String(c.opexByMonth.length))
  check('nothing before the start month',
    c.opexByMonth.slice(0, 2).every((v) => v === 0), c.opexByMonth.join(','))
  check('the amount in every month from start to end inclusive',
    c.opexByMonth.slice(2, 6).every((v) => v === 1000), c.opexByMonth.slice(2, 6).join(','))
  check('nothing after the end month',
    c.opexByMonth.slice(6).every((v) => v === 0), c.opexByMonth.slice(6).join(','))
  check('so a Mar-Jun line is four months of it, not twelve',
    c.opexYear === 4000, String(c.opexYear))

  const full = projectCosts({ opex: [line({ monthly: 500 })] })
  check('a line with no dates runs the whole year', full.opexYear === 6000 && full.opexByMonth.every((v) => v === 500),
    String(full.opexYear))

  const single = projectCosts({ opex: [line({ monthly: 800, startMonth: 12, endMonth: 12 })] })
  check('a one-month line is exactly one month', single.opexYear === 800 && single.opexByMonth[11] === 800,
    single.opexByMonth.join(','))

  const two = projectCosts({
    opex: [
      line({ id: 'a', monthly: 100, startMonth: 1, endMonth: 6 }),
      line({ id: 'b', monthly: 250, startMonth: 4, endMonth: 12 }),
    ],
  })
  check('overlapping lines add inside the months they share',
    two.opexByMonth[0] === 100 && two.opexByMonth[3] === 350 && two.opexByMonth[11] === 250,
    two.opexByMonth.join(','))
  check('opexYear is exactly the grid summed',
    two.opexYear === two.opexByMonth.reduce((a, b) => a + b, 0), String(two.opexYear))
  check('and it is 6x100 + 9x250, worked out by hand', two.opexYear === 600 + 2250, String(two.opexYear))

  console.log('\n--- the run-rate ignores start and end, on purpose ---')
  check('a line that only runs in December still costs its full monthly run-rate',
    single.opexRunRate === 800 && single.opexYear === 800,
    `run-rate ${single.opexRunRate} vs 2026 total ${single.opexYear}`)
  check('the run-rate is the sum of every line, whatever their months',
    two.opexRunRate === 350, String(two.opexRunRate))
  check('a whole-year line has run-rate x 12 = the year',
    full.opexRunRate * 12 === full.opexYear, `${full.opexRunRate} x 12 = ${full.opexYear}`)
  check('a part-year line deliberately does NOT', c.opexRunRate * 12 !== c.opexYear,
    `${c.opexRunRate} x 12 = ${c.opexRunRate * 12} vs ${c.opexYear}`)
}

console.log('\n--- an unusable line is neutralised, never propagated ---')
{
  const junk = [
    ['NaN monthly', { monthly: NaN }, 0],
    ['a string monthly', { monthly: 'abc' }, 0],
    ['Infinity monthly', { monthly: Infinity }, 0],
    ['negative monthly', { monthly: -500 }, 0],
    ['missing monthly', {}, 0],
    ['a numeric string', { monthly: '1200' }, 1200],
  ]
  for (const [name, raw, expect] of junk) {
    const c = projectCosts({ opex: [{ ...raw }] })
    check(`${name} -> ${expect} a month, and every figure finite`,
      c.opexRunRate === expect && c.opexByMonth.every(Number.isFinite) && Number.isFinite(c.opexYear),
      `${c.opexRunRate} / ${c.opexYear}`)
  }
  const months = [
    ['month 0', { monthly: 100, startMonth: 0, endMonth: 12 }, 1, 12],
    ['month 99', { monthly: 100, startMonth: 1, endMonth: 99 }, 1, 12],
    ['NaN months', { monthly: 100, startMonth: NaN, endMonth: NaN }, 1, 12],
    ['a fractional month', { monthly: 100, startMonth: 2.4, endMonth: 5.6 }, 2, 6],
    ['end before start', { monthly: 100, startMonth: 8, endMonth: 2 }, 8, 8],
  ]
  for (const [name, raw, s, e] of months) {
    const [l] = normalizeOpex([raw])
    check(`${name} -> ${MONTH_LABELS[s - 1]}..${MONTH_LABELS[e - 1]}`,
      l.startMonth === s && l.endMonth === e, `${l.startMonth}..${l.endMonth}`)
  }
  check('a non-array opex field is simply no lines',
    normalizeOpex(null).length === 0 && normalizeOpex('nope').length === 0 && normalizeOpex(undefined).length === 0)
  check('a line always gets an id and a label',
    normalizeOpex([{ monthly: 1 }]).every((l) => !!l.id && !!l.label))
  check('a blank new line carries the whole year and no cost', (() => {
    const [l] = normalizeOpex([newOpexLine(1)])
    return l.startMonth === 1 && l.endMonth === 12 && l.monthly === 0
  })())
  check('a new project starts with the cost fields present, not undefined', (() => {
    const p = newProject(1)
    return p.capex === null && p.capexNote === '' && Array.isArray(p.opex) && p.opex.length === 0
  })())
}

console.log('\n--- CAPEX is a known number or an unknown, never a zero ---')
{
  const cases = [
    ['missing', {}, null],
    ['null', { capex: null }, null],
    ['zero', { capex: 0 }, null],
    ['negative', { capex: -1000 }, null],
    ['NaN', { capex: NaN }, null],
    ['Infinity', { capex: Infinity }, null],
    ['a string', { capex: 'lots' }, null],
    ['a numeric string', { capex: '25000' }, 25000],
    ['a real figure', { capex: 25000 }, 25000],
  ]
  for (const [name, raw, expect] of cases) {
    check(`CAPEX ${name} -> ${expect}`, projectCosts(raw).capex === expect, String(projectCosts(raw).capex))
  }
}

/* ================= 2. investment ================= */
console.log('\n--- investment combines the two sides, and each may be missing ---')
{
  check('both unknown -> unknown, not zero', totalInvestment(null, null) === null)
  check('build only -> the build cost', totalInvestment(1000, null) === 1000)
  check('CAPEX only -> the CAPEX', totalInvestment(null, 400) === 400)
  check('both -> the sum', totalInvestment(1000, 400) === 1400)

  const md = projectFinance({ savingHours: 100, manday: 10 }, DEFAULT_SETTINGS)
  const cap = projectFinance({ savingHours: 100, manday: 0, capex: 50000 }, DEFAULT_SETTINGS)
  const both = projectFinance({ savingHours: 100, manday: 10, capex: 50000 }, DEFAULT_SETTINGS)
  check('mandays only: investment is the build cost', near(md.investment, 10 * R.devDayRate), fmtMoney(md.investment))
  check('CAPEX only: build cost stays null but investment is real',
    cap.buildCost === null && cap.investment === 50000, `${cap.buildCost} / ${cap.investment}`)
  check('both: investment is build + CAPEX',
    near(both.investment, 10 * R.devDayRate + 50000), fmtMoney(both.investment))
  check('neither: investment is null and so is the return', (() => {
    const none = projectFinance({ savingHours: 100, manday: 0 }, DEFAULT_SETTINGS)
    return none.investment === null && none.roi === null && none.netBenefit === null && none.paybackMonths === null
  })())
}

console.log('\n--- A CAPEX-ONLY PROJECT GETS A RETURN ---')
{
  const p = { key: 'CAP-1', savingHours: 100, manday: 0, capex: 50000, commitLevel: 'commit', objective: 'process_automation' }
  const f = projectFinance(p, DEFAULT_SETTINGS)
  const benefit = 100 * R.acctHourRate
  check('it has a benefit', near(f.monthlyBenefit, benefit), fmtMoney(f.monthlyBenefit))
  check('it has an ROI, where before it had none',
    near(f.roi, (benefit * H - 50000) / 50000), fmtRoi(f.roi))
  check('and a payback, off the CAPEX alone', near(f.paybackMonths, 50000 / benefit),
    `${f.paybackMonths?.toFixed(2)} months`)
  check('net benefit is the horizon benefit less the CAPEX',
    near(f.netBenefit, benefit * H - 50000), fmtMoney(f.netBenefit))

  const plan = computePlan({ ...base, projects: [p] })
  const only = plan.projects[0]
  check('the portfolio counts it as costed', plan.finance.costedCount === 1, String(plan.finance.costedCount))
  check('the portfolio investment is that CAPEX', plan.finance.investment === 50000, String(plan.finance.investment))
  check('the portfolio build cost is zero, not null, once something IS costed',
    plan.finance.buildCost === 0, String(plan.finance.buildCost))
  check('the portfolio ROI is that project ROI', near(plan.finance.roi, only.roi, 1e-9), fmtRoi(plan.finance.roi))
  check('and it is NOT reported as uncosted',
    plan.finance.uncostedCount === 0 && plan.quality.uncosted === 0,
    `${plan.finance.uncostedCount} / ${plan.quality.uncosted}`)
  check('the gate is evaluated on it like any other project',
    only.gate === gateStatus(only.roi, R.roiGate) && only.gate !== 'unknown', only.gate)
}

/* ================= 3. OPEX against the benefit ================= */
console.log('\n--- OPEX at or above the benefit never pays back ---')
{
  const benefit = 100 * R.acctHourRate
  const over = {
    key: 'OPX-1', savingHours: 100, manday: 10, commitLevel: 'commit', objective: 'process_automation',
    opex: [line({ monthly: benefit * 1.5 })],
  }
  const f = projectFinance(over, DEFAULT_SETTINGS)
  check('net monthly goes NEGATIVE rather than flooring at zero',
    f.netMonthly < 0 && near(f.netMonthly, benefit - benefit * 1.5), fmtMoney(f.netMonthly))
  check('PAYBACK IS NULL — not fast, not negative', f.paybackMonths === null, String(f.paybackMonths))
  check('ROI is negative', f.roi < 0, fmtRoi(f.roi))
  check('net benefit is a loss', f.netBenefit < 0, fmtMoney(f.netBenefit))
  check('and the gate fails', gateStatus(f.roi, R.roiGate) === 'fail')

  const exact = projectFinance({ ...over, opex: [line({ monthly: benefit })] }, DEFAULT_SETTINGS)
  check('OPEX exactly equal to the benefit is still never a payback',
    exact.netMonthly === 0 && exact.paybackMonths === null, `${exact.netMonthly} / ${exact.paybackMonths}`)
  check('and its ROI is exactly -100% — the whole investment lost',
    near(exact.roi, -1), fmtRoi(exact.roi))
  check('paybackMonths() itself refuses a null investment with a positive net',
    paybackMonths(null, 500) === null)
  check('and refuses a zero or negative net', paybackMonths(1000, 0) === null && paybackMonths(1000, -5) === null)

  const under = projectFinance({ ...over, opex: [line({ monthly: benefit * 0.25 })] }, DEFAULT_SETTINGS)
  check('OPEX below the benefit lengthens the payback rather than killing it',
    under.paybackMonths > projectFinance({ ...over, opex: [] }, DEFAULT_SETTINGS).paybackMonths,
    `${under.paybackMonths.toFixed(2)} months`)
  check('the ROI is measured on the run-rate, not on the 2026 grid', (() => {
    // Same run-rate, different months: the return must be identical, the
    // budget figure must not be.
    const q1 = projectFinance({ ...over, opex: [line({ monthly: 5000, startMonth: 1, endMonth: 3 })] }, DEFAULT_SETTINGS)
    const all = projectFinance({ ...over, opex: [line({ monthly: 5000, startMonth: 1, endMonth: 12 })] }, DEFAULT_SETTINGS)
    return near(q1.roi, all.roi, 1e-12) && q1.opexYear !== all.opexYear
  })())
}

console.log('\n--- break-even and affordable mandays account for both ---')
{
  const p = { savingHours: 200, manday: 5 }
  const plain = projectFinance(p, DEFAULT_SETTINGS)
  const withCapex = projectFinance({ ...p, capex: 100000 }, DEFAULT_SETTINGS)
  const withOpex = projectFinance({ ...p, opex: [line({ monthly: 3000 })] }, DEFAULT_SETTINGS)
  check('a CAPEX eats into the mandays a project can still afford',
    withCapex.breakEvenMandays < plain.breakEvenMandays,
    `${plain.breakEvenMandays.toFixed(1)} -> ${withCapex.breakEvenMandays.toFixed(1)} md`)
  check('so does an OPEX line',
    withOpex.breakEvenMandays < plain.breakEvenMandays,
    `${plain.breakEvenMandays.toFixed(1)} -> ${withOpex.breakEvenMandays.toFixed(1)} md`)
  check('spending exactly the break-even mandays lands on a zero return', (() => {
    const at = projectFinance({ ...p, capex: 100000, manday: withCapex.breakEvenMandays }, DEFAULT_SETTINGS)
    return near(at.roi, 0, 1e-9)
  })())
  check('spending exactly the affordable mandays lands on the gate', (() => {
    const at = projectFinance({ ...p, capex: 100000, manday: withCapex.affordableMandays }, DEFAULT_SETTINGS)
    return near(at.roi, R.roiGate, 1e-9)
  })(), `${withCapex.affordableMandays.toFixed(1)} md`)
  check('a CAPEX that already exceeds the benefit affords zero mandays, not minus some', (() => {
    const drowned = projectFinance({ ...p, capex: 100000000 }, DEFAULT_SETTINGS)
    return drowned.breakEvenMandays === 0 && drowned.affordableMandays === 0
  })())
}

console.log('\n--- junk in a saved scenario cannot poison a total ---')
{
  const junk = [
    ['NaN capex', { savingHours: 100, manday: 5, capex: NaN }],
    ['Infinity capex', { savingHours: 100, manday: 5, capex: Infinity }],
    ['negative capex', { savingHours: 100, manday: 5, capex: -9000 }],
    ['a string capex', { savingHours: 100, manday: 5, capex: 'free' }],
    ['NaN inside an opex line', { savingHours: 100, manday: 5, opex: [{ monthly: NaN }] }],
    ['Infinity inside an opex line', { savingHours: 100, manday: 5, opex: [{ monthly: Infinity }] }],
    ['a negative opex line', { savingHours: 100, manday: 5, opex: [{ monthly: -400 }] }],
    ['opex as an object, not an array', { savingHours: 100, manday: 5, opex: { monthly: 400 } }],
    ['opex holding a null', { savingHours: 100, manday: 5, opex: [null] }],
    ['every cost field missing', { savingHours: 100, manday: 5 }],
  ]
  for (const [name, p] of junk) {
    const f = projectFinance(p, DEFAULT_SETTINGS)
    const bad = Object.entries(f).filter(([, v]) => v != null && !Number.isFinite(v))
    check(`${name} -> every figure is null or finite`, bad.length === 0,
      bad.map(([k, v]) => `${k}=${v}`).join(', '))
  }
  check('a whole book of cost junk still totals to real numbers', (() => {
    const t = computePlan({
      ...base,
      projects: base.projects.map((p, i) => (i % 3 ? p : {
        ...p, manday: NaN, capex: 'oops', opex: [{ monthly: Infinity, startMonth: -4, endMonth: 'x' }],
      })),
    })
    return Number.isFinite(t.finance.monthlyBenefit) && Number.isFinite(t.finance.planOpexYear)
      && Number.isFinite(t.finance.planCapex) && t.finance.planOpexByMonth.every(Number.isFinite)
      && t.projects.every((p) => p.opexByMonth.every(Number.isFinite))
  })())
  check('a scenario saved before CAPEX existed still opens', (() => {
    const t = computePlan(base)
    return t.projects.every((p) => p.capex === null && p.opex.length === 0 && p.opexYear === 0
      && p.opexByMonth.length === MONTHS_IN_YEAR)
  })())
}

/* ================= 4. the rollups ================= */
console.log('\n--- the portfolio sums equal the per-project sums ---')
{
  // Varied on purpose: uniform costs make a mean of ratios and a ratio of sums
  // algebraically identical, which is exactly the case that hides a bug.
  const projects = base.projects.map((p, i) => ({
    ...p,
    manday: 1 + (i % 17),
    capex: i % 4 === 0 ? 10000 * (1 + (i % 5)) : null,
    opex: i % 3 === 0 ? [line({ id: `o${i}`, monthly: 500 * (1 + (i % 4)), startMonth: 1 + (i % 6), endMonth: 12 })] : [],
  }))
  const plan = computePlan({ ...base, projects })
  const f = plan.finance
  const inPlan = plan.projects.filter(isInPlan)
  const costed = inPlan.filter((p) => p.investment != null && p.monthlyBenefit != null)

  check('the costed set is keyed on investment, not on mandays',
    costed.some((p) => p.buildCost == null || p.capex != null), `${costed.length} costed rows`)
  check('portfolio investment is the sum of the costed investments',
    near(f.investment, costed.reduce((a, p) => a + p.investment, 0), 1e-6), fmtMoney(f.investment))
  check('portfolio build cost + CAPEX = portfolio investment',
    near(f.buildCost + f.capex, f.investment, 1e-6), `${fmtMoney(f.buildCost)} + ${fmtMoney(f.capex)}`)
  check('portfolio OPEX run-rate is the sum of the costed run-rates',
    near(f.opexRunRate, costed.reduce((a, p) => a + p.opexRunRate, 0), 1e-6), fmtMoney(f.opexRunRate))
  check('portfolio net benefit is the sum of the project net benefits',
    near(f.netBenefit, costed.reduce((a, p) => a + p.netBenefit, 0), 1e-6), fmtMoney(f.netBenefit))
  check('portfolio ROI is the ratio of the sums, not a mean of ratios', (() => {
    const meanOfRatios = costed.reduce((a, p) => a + p.roi, 0) / costed.length
    return near(f.roi, (costed.reduce((a, p) => a + p.netHorizonBenefit, 0) - f.investment) / f.investment, 1e-9)
      && Math.abs(f.roi - meanOfRatios) > 0.01
  })(), fmtRoi(f.roi))
  check('net and ROI are computed off the same investment',
    near(f.netBenefit, f.roi * f.investment, 1e-6), fmtMoney(f.roi * f.investment))
  check('portfolio payback is the investment over the NET monthly',
    near(f.paybackMonths, f.investment / f.netMonthly, 1e-9), `${f.paybackMonths.toFixed(2)} months`)

  check('the plan-wide CAPEX covers every in-plan row, not only the costed ones',
    near(f.planCapex, inPlan.reduce((a, p) => a + (p.capex ?? 0), 0), 1e-6), fmtMoney(f.planCapex))
  check('the plan-wide OPEX year is the sum of every in-plan grid',
    near(f.planOpexYear, inPlan.reduce((a, p) => a + p.opexYear, 0), 1e-6), fmtMoney(f.planOpexYear))
  check('the plan-wide month grid adds up column by column',
    f.planOpexByMonth.every((v, m) => near(v, inPlan.reduce((a, p) => a + p.opexByMonth[m], 0), 1e-6)),
    f.planOpexByMonth.map(Math.round).join(' '))
  check('and that grid sums to the plan-wide OPEX year',
    near(f.planOpexByMonth.reduce((a, b) => a + b, 0), f.planOpexYear, 1e-6))
  check('the budget view is at least as big as the returnable view',
    f.planInvestment >= f.investment && f.planOpexYear >= f.opexYear,
    `${fmtMoney(f.planInvestment)} vs ${fmtMoney(f.investment)}`)
  check('an out-of-plan project contributes nothing to either', (() => {
    const deferred = computePlan({
      ...base,
      projects: projects.map((p, i) => (i === 0 ? { ...p, commitLevel: 'nextyear', capex: 999999 } : p)),
    })
    return near(deferred.finance.planCapex, f.planCapex - (projects[0].capex ?? 0), 1e-6)
  })())

  console.log('\n--- per person, on the same share as the hours ---')
  for (const p of plan.people) {
    const rows = plan.projects
      .map((pr) => ({ p: pr, share: pr.shares[p.id] || 0 }))
      .filter((r) => r.share > 0 && isCounted(r.p) && countsToPool(r.p)
        && r.p.investment != null && r.p.monthlyBenefit != null)
    check(`${p.nick}: investment is their share of the same rows their hours come from`,
      near(p.investment ?? 0, rows.reduce((a, r) => a + r.p.investment * r.share, 0), 1e-6),
      fmtMoney(p.investment))
    check(`${p.nick}: CAPEX is credited on that same share`,
      near(p.capex ?? 0, rows.reduce((a, r) => a + (r.p.capex ?? 0) * r.share, 0), 1e-6), fmtMoney(p.capex))
    check(`${p.nick}: OPEX is credited on that same share`,
      near(p.opexRunRate, rows.reduce((a, r) => a + r.p.opexRunRate * r.share, 0), 1e-6), fmtMoney(p.opexRunRate))
    check(`${p.nick}: build + CAPEX = investment`,
      p.investment == null || near((p.buildCost ?? 0) + (p.capex ?? 0), p.investment, 1e-6))
    check(`${p.nick}: net credited benefit is the credited benefit less the credited OPEX`,
      p.costedNetBenefit == null
        || near(p.costedNetBenefit, p.costedBenefit - p.opexRunRate * H, 1e-6), fmtMoney(p.costedNetBenefit))
  }
  const lead = plan.people.find((x) => x.aggregatesTeam)
  check('the lead scorecard investment is the sum of the team, like the hours',
    near(lead.finance.investment, plan.people.reduce((a, x) => a + (x.investment || 0), 0), 1e-6),
    fmtMoney(lead.finance.investment))
  check('the lead scorecard OPEX is the sum of the team too',
    near(lead.finance.opexRunRate, plan.people.reduce((a, x) => a + (x.opexRunRate || 0), 0), 1e-6))
  check('every scorecard net = its credited net benefit minus its credited investment',
    plan.people.every((x) => x.finance.netBenefit == null
      || near(x.finance.netBenefit, x.finance.roi * x.finance.investment, 1e-6)))
  check('nobody has an investment without a matching benefit in the same set',
    plan.people.every((x) => (x.investment == null) === (x.costedBenefit == null)))
}

console.log('\n--- one CAPEX must not report the whole book as its return ---')
{
  const one = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === 'FNP-88' ? { ...p, capex: 250000 } : p)),
  })
  const f = one.finance
  const proj = one.projects.find((p) => p.key === 'FNP-88')
  check('the portfolio investment is that one CAPEX', near(f.investment, 250000), fmtMoney(f.investment))
  check('the portfolio ROI equals that one project ROI', near(f.roi, proj.roi, 1e-9), fmtRoi(f.roi))
  check('coverage says how little of the benefit that is', f.roiCoverage > 0 && f.roiCoverage < 0.25,
    `${(f.roiCoverage * 100).toFixed(1)}%`)
  check('the benefit headline still covers the whole book',
    near(f.monthlyBenefit, computePlan(base).finance.monthlyBenefit))
}

console.log('\n--- costs with no benefit are reported, not dropped ---')
{
  const withTbc = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.savingHours == null ? { ...p, capex: 30000 } : p)),
  })
  const orphans = withTbc.projects.filter((p) => isInPlan(p) && p.investment != null && p.monthlyBenefit == null)
  check('a project with a CAPEX but TBC hours exists', orphans.length > 0, `${orphans.length} projects`)
  check('its cost stays out of the ROI denominator', withTbc.finance.investment === null,
    String(withTbc.finance.investment))
  check('but is reported separately rather than vanishing',
    near(withTbc.finance.unreturnedCost, orphans.reduce((a, p) => a + p.investment, 0), 1e-6)
    && withTbc.finance.unreturnedCount === orphans.length, fmtMoney(withTbc.finance.unreturnedCost))
}

console.log('\n--- the horizon and the rates still drive everything ---')
{
  const projects = base.projects.map((p, i) => ({
    ...p, manday: 5, capex: i % 2 ? 20000 : null, opex: [line({ id: `x${i}`, monthly: 1000 })],
  }))
  const at = (months) => computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, horizonMonths: months } },
    projects,
  })
  const h12 = at(12)
  const h24 = at(24)
  check('doubling the horizon leaves the investment alone',
    near(h24.finance.investment, h12.finance.investment, 1e-6))
  check('and doubles the benefit NET of OPEX inside it',
    near(h24.finance.netMonthly * 24, h12.finance.netMonthly * 12 * 2, 1e-6))
  check('every project net benefit follows the horizon setting',
    h24.projects.every((p) => p.netBenefit == null || near(p.netBenefit, p.netMonthly * 24 - p.investment, 1e-6)))
  check('the OPEX year is a YEAR, whatever the horizon',
    near(h24.finance.planOpexYear, h12.finance.planOpexYear, 1e-6))
  check('the on-cost multiplier still leaves a no-OPEX, no-CAPEX ROI unchanged', (() => {
    const mk = (load) => computePlan({
      ...base,
      settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, loadFactor: load } },
      projects: base.projects.map((p) => ({ ...p, manday: 10 })),
    })
    return near(mk(1.4).finance.roi, mk(1).finance.roi, 1e-9)
  })())
}

console.log('\n--- the costs are stored fields, so they travel with a scenario ---')
{
  const p0 = {
    ...base.projects[0],
    key: 'ST-1',
    savingHours: 100,
    manday: 4,
    capex: 80000,
    capexNote: 'two servers',
    opex: [line({ id: 'o1', monthly: 3000, startMonth: 5, endMonth: 11 })],
    commitLevel: 'commit',
  }
  const before = computePlan({ ...base, projects: [p0] })
  // Exactly what downloadScenario / saveScenario put on the wire.
  const after = computePlan(JSON.parse(JSON.stringify({ ...base, projects: [p0] })))
  const a = before.projects[0]
  const b = after.projects[0]
  check('a scenario written and read back computes identically',
    a.capex === b.capex && a.opexYear === b.opexYear && a.opexRunRate === b.opexRunRate
    && near(a.roi, b.roi, 1e-12) && a.opexByMonth.join() === b.opexByMonth.join(),
    `${a.roi} vs ${b.roi}`)
  check('the note travels with it', b.capexNote === 'two servers', String(b.capexNote))
  check('the computed project exposes the sanitised lines back to the editor',
    b.opex.length === 1 && b.opex[0].startMonth === 5 && b.opex[0].endMonth === 11,
    JSON.stringify(b.opex))
}

/* ================= 5. the workbook ================= */
console.log('\n--- the exported workbook carries the same numbers ---')
{
  const projects = base.projects.map((p, i) => ({
    ...p,
    manday: i % 5 === 0 ? 0 : 4 + (i % 9),
    capex: i % 4 === 0 ? 15000 * (1 + (i % 3)) : null,
    opex: i % 3 === 0
      ? [line({ id: `a${i}`, monthly: 2000, startMonth: 3, endMonth: 9 }), line({ id: `b${i}`, monthly: 700 })]
      : [],
  }))
  const state = { ...base, projects, scenarioName: 'cost self-test' }
  const plan = computePlan(state)
  const file = 'costs-selftest.xlsx'
  if (existsSync(file)) unlinkSync(file)
  const wb = await buildWorkbook(plan, state)
  await wb.xlsx.writeFile(file)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(file)

  /* ---- Projects sheet ---- */
  const ps = back.getWorksheet('Projects')
  const head = []
  ps.getRow(4).eachCell((c, n) => { head[n] = String(c.value || '') })
  const col = (label) => head.findIndex((h) => h && h.startsWith(label))
  check('the Projects sheet has CAPEX, OPEX and Investment columns',
    col('CAPEX') > 0 && col('OPEX/mth') > 0 && col('OPEX 2026') > 0 && col('Investment') > 0,
    head.filter(Boolean).join(' | '))
  check('and still has Build cost, ROI and Payback',
    col('Build cost') > 0 && col('ROI') > 0 && col('Payback') > 0)

  const target = plan.projects.find((p) => p.capex != null && p.opexRunRate > 0 && p.monthlyBenefit != null)
  check('the self-test produced a project with both a CAPEX and an OPEX', !!target,
    target ? target.key : 'none')
  let row = null
  ps.eachRow((r) => { if (String(r.getCell(2).value || '') === target.summary) row = r })
  const cell = (label) => row.getCell(col(label)).value
  check('exported CAPEX matches the app', cell('CAPEX') === Math.round(target.capex),
    `${cell('CAPEX')} vs ${Math.round(target.capex)}`)
  check('exported investment matches the app', cell('Investment') === Math.round(target.investment),
    `${cell('Investment')} vs ${Math.round(target.investment)}`)
  check('exported OPEX run-rate matches the app', cell('OPEX/mth') === Math.round(target.opexRunRate),
    `${cell('OPEX/mth')} vs ${Math.round(target.opexRunRate)}`)
  check('exported OPEX 2026 matches the app grid', cell('OPEX 2026') === Math.round(target.opexYear),
    `${cell('OPEX 2026')} vs ${Math.round(target.opexYear)}`)
  check('exported ROI matches the app', Math.abs(cell('ROI') - target.roi) < 1e-4,
    `${cell('ROI')} vs ${target.roi}`)
  check('every cost cell is a NUMBER with a number format, not a formatted string',
    ['CAPEX', 'Investment', 'OPEX/mth', 'OPEX 2026'].every((l) => {
      const c = row.getCell(col(l))
      return typeof c.value === 'number' && /#,##0/.test(String(c.numFmt))
    }))
  check('a project with no CAPEX exports an empty cell, not a zero', (() => {
    const none = plan.projects.find((p) => p.capex == null)
    let r2 = null
    ps.eachRow((r) => { if (String(r.getCell(2).value || '') === none.summary) r2 = r })
    return r2.getCell(col('CAPEX')).value == null
  })())

  /* ---- Costs sheet ---- */
  const cs = back.getWorksheet('Costs')
  check('the workbook has a Costs sheet', !!cs)
  const ch = []
  cs.getRow(4).eachCell((c, n) => { ch[n] = String(c.value || '') })
  check('its months sit in G..R and the FY total in S, exactly like BG 2026',
    ch[7] === 'Jan-26' && ch[18] === 'Dec-26' && String(ch[19]).startsWith('FY2026'),
    `${ch[7]} .. ${ch[18]} | ${ch[19]}`)

  // Read the grid back for the target project's OPEX total row.
  let opexTotalRow = null
  let capexRow = null
  let projTotalRow = null
  cs.eachRow((r) => {
    if (String(r.getCell(2).value || '') !== target.summary) return
    const type = String(r.getCell(3).value || '')
    const item = String(r.getCell(4).value || '')
    if (type === 'OPEX' && item === 'OPEX total') opexTotalRow = r
    if (type === 'CAPEX') capexRow = r
    if (type === 'TOTAL') projTotalRow = r
  })
  check('the Costs sheet carries an OPEX total row for it', !!opexTotalRow)
  const grid = []
  for (let m = 0; m < MONTHS_IN_YEAR; m++) grid.push(opexTotalRow.getCell(7 + m).value || 0)
  check('every month in the sheet equals the app grid, month by month',
    grid.every((v, m) => Math.abs(v - Math.round(target.opexByMonth[m])) <= 1), grid.join(' '))
  check('the FY total equals the app opexYear',
    Math.abs(opexTotalRow.getCell(19).value - Math.round(target.opexYear)) <= 1,
    `${opexTotalRow.getCell(19).value} vs ${Math.round(target.opexYear)}`)
  check('the months are numbers, so Excel can sum them',
    grid.filter((v) => v !== 0).every((v) => typeof v === 'number'))
  check('CAPEX sits on its own row with NO month spread — no depreciation',
    !!capexRow && capexRow.getCell(19).value === Math.round(target.capex)
    && Array.from({ length: MONTHS_IN_YEAR }, (_, m) => capexRow.getCell(7 + m).value).every((v) => v == null),
    String(capexRow?.getCell(19).value))
  check('the project total is its investment plus its year of OPEX',
    Math.abs(projTotalRow.getCell(19).value - Math.round(target.investment + target.opexYear)) <= 1,
    `${projTotalRow.getCell(19).value} vs ${Math.round(target.investment + target.opexYear)}`)

  let planRow = null
  cs.eachRow((r) => { if (String(r.getCell(4).value || '') === 'PLAN TOTAL 2026') planRow = r })
  check('the plan total row matches the portfolio budget figures',
    Math.abs(planRow.getCell(19).value - Math.round(plan.finance.planInvestment + plan.finance.planOpexYear)) <= 1,
    `${planRow.getCell(19).value} vs ${Math.round(plan.finance.planInvestment + plan.finance.planOpexYear)}`)
  let planOpexRow = null
  cs.eachRow((r) => { if (String(r.getCell(4).value || '').startsWith('OPEX — every')) planOpexRow = r })
  check('and its OPEX month grid matches the portfolio month grid',
    plan.finance.planOpexByMonth.every((v, m) => Math.abs((planOpexRow.getCell(7 + m).value || 0) - Math.round(v)) <= 1))

  /* ---- Summary ---- */
  const sum = back.getWorksheet('Summary')
  const kv = {}
  sum.eachRow((r) => {
    const k = String(r.getCell(1).value || '').trim()
    if (k) kv[k] = r.getCell(2).value
  })
  check('Summary carries the plan-wide CAPEX',
    kv['CAPEX across the plan (one-off, not depreciated)'] === Math.round(plan.finance.planCapex),
    `${kv['CAPEX across the plan (one-off, not depreciated)']} vs ${Math.round(plan.finance.planCapex)}`)
  check('Summary carries the plan-wide OPEX',
    kv['OPEX across the plan (2026 monthly grid, summed)'] === Math.round(plan.finance.planOpexYear))
  check('Summary carries the returnable investment',
    kv['Investment in projects with BOTH a cost and a benefit'] === Math.round(plan.finance.investment))
  check('Summary ROI is the app ROI, as a number',
    typeof kv['RETURN ON INVESTMENT'] === 'number'
    && Math.abs(kv['RETURN ON INVESTMENT'] - plan.finance.roi) < 1e-4,
    `${kv['RETURN ON INVESTMENT']} vs ${plan.finance.roi}`)

  /* ---- per-person ---- */
  for (const p of plan.people) {
    const ws = back.getWorksheet(`Obj-${p.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31))
    let investment = null
    let capex = null
    ws.eachRow((r) => {
      const a = String(r.getCell(1).value || '')
      if (a.startsWith('Investment credited')) investment = r.getCell(3).value
      if (a.startsWith('CAPEX credited')) capex = r.getCell(3).value
    })
    check(`${p.nick}: exported credited investment matches the app`,
      p.finance.investment == null ? typeof investment === 'string' : investment === Math.round(p.finance.investment),
      `${investment} vs ${p.finance.investment == null ? 'null' : Math.round(p.finance.investment)}`)
    check(`${p.nick}: exported credited CAPEX matches the app`,
      p.finance.capex == null ? typeof capex === 'string' : capex === Math.round(p.finance.capex),
      `${capex} vs ${p.finance.capex == null ? 'null' : Math.round(p.finance.capex)}`)
  }

  unlinkSync(file)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
