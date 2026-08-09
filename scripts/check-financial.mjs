/**
 * Objective 1's money model.
 *
 * What this locks down:
 *   1. the two rates are derived from the two salaries on ONE calendar
 *   2. every per-project figure is dimensionally right, and null when unknown
 *   3. cost and benefit are always summed over the SAME set of projects
 *   4. the rates are live — moving a salary moves every number that depends on it
 *   5. the app and the exported workbook carry identical figures
 *
 * Run with: node scripts/check-financial.mjs
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, DEFAULT_FINANCE, financeRates, projectFinance,
  gateAsHoursPerManday, gateAsPaybackMonths, workingDaysBetween, monthlyHours,
  fmtMoney, fmtRoi, targetKindFor, weightsValid,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'financial' }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol

const plan = computePlan(base)
const F = plan.finance
// A project that carries saving hours AND counts toward the plan, so deferring
// it genuinely moves the counts below. The first row of the seed is TBC, which
// silently made two of these checks assert nothing.
const DEFERRABLE = base.projects.find((p) => p.savingHours > 0 && p.commitLevel === 'commit')

/* ================= 1. the rates ================= */
console.log('--- the two rates come off the two salaries, on one calendar ---')
check('developer day rate = salary x load / days per month',
  near(F.devDayRate, (DEFAULT_FINANCE.devMonthlySalary * F.loadFactor) / F.daysPerFteMonth),
  fmtMoney(F.devDayRate))
check('accountant hour rate = salary x load / hours per month',
  near(F.acctHourRate, (DEFAULT_FINANCE.acctMonthlySalary * F.loadFactor) / F.hoursPerFteMonth),
  fmtMoney(F.acctHourRate))
// The defect this exists to prevent: two independently editable calendars put
// a manday of cost and an hour of benefit on different months.
check('working days per month is DERIVED, not a second free knob',
  near(F.daysPerFteMonth, F.hoursPerFteMonth / F.hoursPerManday),
  `${F.hoursPerFteMonth} / ${F.hoursPerManday} = ${F.daysPerFteMonth.toFixed(4)}`)
check('so a manday of cost is exactly hoursPerManday of accountant value at equal salaries', (() => {
  const eq = financeRates({ finance: { ...DEFAULT_FINANCE, devMonthlySalary: 30000, acctMonthlySalary: 30000 } })
  return near(eq.devDayRate, eq.acctHourRate * eq.hoursPerManday, 1e-9)
})())

console.log('\n--- the calibration against the source workbook ---')
// The workbook's own FTE column is saving hours / a full-time month, at the
// ratio the workbook itself writes into every row: (22*8) = 176. If this app
// divided differently, its FTE figure would contradict management's.
// scripts/check-source-reconciliation.mjs opens the workbook and proves the
// divisor from the formula; this check holds the app side of it.
const srcHc = seed.projects.reduce((a, p) => a + (p.hc || 0), 0)
check('the default FTE ratio is the workbook\'s own 22 days x 8 hours',
  DEFAULT_FINANCE.hoursPerFteMonth === 22 * 8,
  `${DEFAULT_FINANCE.hoursPerFteMonth} vs ${22 * 8}`)
// Now the divisor is exact, the seed's own FTE column can be REGENERATED from
// the saving hours rather than merely landing nearby. Excel's ROUND is half
// away from zero, and the sheet rounds each project to 1 dp.
const round1 = (v) => Math.sign(v) * Math.round(Math.abs(v) * 10) / 10
const regenerated = seed.projects.reduce(
  (a, p) => a + (p.savingHours == null ? 0 : round1(p.savingHours / DEFAULT_FINANCE.hoursPerFteMonth)), 0)
check('the ratio regenerates the source FTE column exactly, project by project',
  seed.projects.every((p) => Math.abs(
    (p.savingHours == null ? 0 : round1(p.savingHours / DEFAULT_FINANCE.hoursPerFteMonth)) - (p.hc || 0),
  ) < 1e-9),
  `regenerated ${regenerated.toFixed(1)} vs stored ${srcHc.toFixed(1)}`)
// fteReleased divides the book total ONCE and does not round, so it sits a
// rounding residual above the column. That residual is the sum of the
// workbook's own per-row roundings — an identity, not a tolerance.
const residual = seed.projects.reduce((a, p) => {
  const exact = p.savingHours == null ? 0 : p.savingHours / DEFAULT_FINANCE.hoursPerFteMonth
  return a + (exact - (p.hc || 0))
}, 0)
check('FTE released differs from the source FTE column by exactly its rounding',
  near(F.fteReleased - srcHc, residual, 1e-9),
  `${F.fteReleased.toFixed(4)} - ${srcHc.toFixed(1)} = ${(F.fteReleased - srcHc).toFixed(4)}, rounding residual ${residual.toFixed(4)}`)
check('so FTE released lands on the FTE column the source already carries',
  Math.abs(F.fteReleased - srcHc) < 0.2,
  `${F.fteReleased.toFixed(2)} FTE vs ${srcHc.toFixed(1)} in the sheet`)

console.log('\n--- the gate is restated, not silently changed ---')
check('the gate as a payback period is horizon / (1 + roi)',
  near(gateAsPaybackMonths(F), F.horizonMonths / (1 + F.roiGate)), `${gateAsPaybackMonths(F)} months`)
// The old gate was 4.0 saving hours per manday. The default roiGate is chosen
// to land on exactly that, so migrating to money did not relax the standard.
check('the default gate is the old 4.0 hrs/manday bar, in money',
  near(gateAsHoursPerManday(F), 4.0, 0.01), `${gateAsHoursPerManday(F).toFixed(4)} hrs/manday`)
check('a project exactly on the gate passes, a hair under fails', (() => {
  const md = 10
  const hrsAt = gateAsHoursPerManday(F) * md
  const on = computePlan({ ...base, projects: [{ ...base.projects[0], key: 'G', savingHours: hrsAt, manday: md, commitLevel: 'commit' }] })
  const under = computePlan({ ...base, projects: [{ ...base.projects[0], key: 'G', savingHours: hrsAt * 0.99, manday: md, commitLevel: 'commit' }] })
  return on.projects[0].gate === 'pass' && under.projects[0].gate === 'fail'
})())

/* ================= 2. per-project arithmetic ================= */
console.log('\n--- one project, worked through by hand ---')
{
  const p = { savingHours: 100, manday: 30, commitLevel: 'commit', objective: 'process_automation' }
  const f = projectFinance(p, DEFAULT_SETTINGS)
  const cost = 30 * F.devDayRate
  const perMonth = 100 * F.acctHourRate
  check('build cost = mandays x day rate', near(f.buildCost, cost), fmtMoney(f.buildCost))
  check('monthly benefit = saving hours x hour rate', near(f.monthlyBenefit, perMonth), fmtMoney(f.monthlyBenefit))
  check('annual benefit is twelve of those', near(f.annualBenefit, perMonth * 12), fmtMoney(f.annualBenefit))
  check('horizon benefit uses the horizon, not the year',
    near(f.horizonBenefit, perMonth * F.horizonMonths), fmtMoney(f.horizonBenefit))
  check('net = horizon benefit - cost', near(f.netBenefit, perMonth * F.horizonMonths - cost), fmtMoney(f.netBenefit))
  check('ROI = net / cost', near(f.roi, (perMonth * F.horizonMonths - cost) / cost), fmtRoi(f.roi))
  check('payback = cost / monthly benefit', near(f.paybackMonths, cost / perMonth), `${f.paybackMonths.toFixed(2)} months`)
  check('break-even mandays buy exactly the horizon benefit',
    near(f.breakEvenMandays * F.devDayRate, f.horizonBenefit, 1e-6), `${f.breakEvenMandays.toFixed(1)} md`)
  check('affordable mandays land exactly on the gate', (() => {
    const at = projectFinance({ ...p, manday: f.affordableMandays }, DEFAULT_SETTINGS)
    return near(at.roi, F.roiGate, 1e-9)
  })(), `${f.affordableMandays.toFixed(1)} md`)
}

console.log('\n--- unknown effort is unknown, never free ---')
{
  const noEffort = projectFinance({ savingHours: 100, manday: 0 }, DEFAULT_SETTINGS)
  check('no mandays -> cost is null, not zero', noEffort.buildCost === null, String(noEffort.buildCost))
  check('no mandays -> ROI, net and payback are all null',
    noEffort.roi === null && noEffort.netBenefit === null && noEffort.paybackMonths === null)
  check('but the benefit side is still known', noEffort.monthlyBenefit > 0, fmtMoney(noEffort.monthlyBenefit))
  check('and break-even mandays still answer "is it worth it"',
    noEffort.breakEvenMandays > 0 && noEffort.affordableMandays > 0,
    `${Math.round(noEffort.breakEvenMandays)} / ${Math.round(noEffort.affordableMandays)} md`)

  const noHours = projectFinance({ savingHours: null, manday: 30 }, DEFAULT_SETTINGS)
  check('TBC saving hours -> every benefit figure is null',
    noHours.monthlyBenefit === null && noHours.annualBenefit === null && noHours.roi === null)
  check('but the cost is still real', noHours.buildCost > 0, fmtMoney(noHours.buildCost))
  check('nothing anywhere returns NaN or Infinity',
    [noEffort, noHours].every((f) => Object.values(f).every((v) => v === null || Number.isFinite(v))))

  // The UI cannot produce these, but a hand-edited scenario file or a bad row
  // in the database can, and one NaN would spread through every total silently.
  console.log('\n--- junk in a saved scenario does not poison the totals ---')
  const junk = [
    ['NaN saving hours', { savingHours: NaN, manday: 10 }],
    ['a string in the saving cell', { savingHours: 'abc', manday: 10 }],
    ['NaN mandays', { savingHours: 100, manday: NaN }],
    ['Infinity mandays', { savingHours: 100, manday: Infinity }],
    ['negative mandays', { savingHours: 100, manday: -5 }],
  ]
  for (const [name, p] of junk) {
    const f = projectFinance(p, DEFAULT_SETTINGS)
    check(`${name} -> every figure is null or finite`,
      Object.values(f).every((v) => v === null || Number.isFinite(v)),
      Object.entries(f).filter(([, v]) => v != null && !Number.isFinite(v)).map(([k, v]) => `${k}=${v}`).join(', '))
  }
  check('a whole book of junk still totals to a real number', (() => {
    const t = computePlan({ ...base, projects: base.projects.map((p, i) => (i % 3 ? p : { ...p, savingHours: NaN, manday: NaN })) })
    return Number.isFinite(t.finance.monthlyBenefit) && Number.isFinite(t.totals.totalHours)
  })())

  // A negative rate is not a thing a saved hour can be worth.
  const negative = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, devMonthlySalary: -60000, acctMonthlySalary: -30000 } },
    projects: base.projects.map((p) => ({ ...p, manday: 5 })),
  })
  check('a negative salary floors at zero rather than inverting the benefit',
    negative.finance.acctHourRate === 0 && negative.finance.devDayRate === 0
    && negative.finance.monthlyBenefit === 0,
    `${negative.finance.acctHourRate} / ${negative.finance.monthlyBenefit}`)
}

console.log('\n--- the annual basis is twelve times smaller per month ---')
{
  const annual = { ...DEFAULT_SETTINGS, savingBasis: 'annual' }
  check('monthlyHours divides an annual figure by 12',
    near(monthlyHours({ savingHours: 1200 }, 'annual'), 100)
    && near(monthlyHours({ savingHours: 100 }, 'monthly'), 100))
  const a = projectFinance({ savingHours: 1200, manday: 10 }, annual)
  const m = projectFinance({ savingHours: 100, manday: 10 }, DEFAULT_SETTINGS)
  check('1,200 hrs/year and 100 hrs/month are worth the same',
    near(a.monthlyBenefit, m.monthlyBenefit) && near(a.roi, m.roi), `${fmtRoi(a.roi)} vs ${fmtRoi(m.roi)}`)
}

/* ================= 3. the rollups add up ================= */
console.log('\n--- the horizon is a real setting, not a constant ---')
{
  const at = (months) => computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, horizonMonths: months } },
    projects: base.projects.map((p) => ({ ...p, manday: 5 })),
  })
  const h12 = at(12)
  const h24 = at(24)
  check('doubling the horizon doubles the benefit inside it',
    near(h24.finance.horizonBenefit, h12.finance.horizonBenefit * 2, 1e-6),
    `${fmtMoney(h12.finance.horizonBenefit)} -> ${fmtMoney(h24.finance.horizonBenefit)}`)
  check('and leaves the build cost alone', near(h24.finance.buildCost, h12.finance.buildCost, 1e-6))
  check('every project horizon benefit follows the setting, not a hardcoded year',
    h24.projects.every((p) => p.horizonBenefit == null || near(p.horizonBenefit, p.monthlyBenefit * 24, 1e-6)))
  check('every scorecard horizon benefit follows it too',
    h24.people.every((p) => near(p.finance.horizonBenefit, p.finance.monthlyBenefit * 24, 1e-6)))
  check('"per year" still means a year, whatever the horizon',
    near(h24.finance.annualBenefit, h12.finance.annualBenefit, 1e-6))
  check('the gate payback tracks the horizon',
    near(gateAsPaybackMonths(h24.finance), gateAsPaybackMonths(h12.finance) * 2, 1e-9))
}

console.log('\n--- the annual basis does not multiply anything by twelve ---')
{
  // 1,200 hrs/YEAR and 100 hrs/MONTH describe the same team, so every derived
  // figure must match. Getting this wrong reported 12x the FTE on a
  // scorecard while the dashboard beside it reported the right one.
  const asMonthly = computePlan({ ...base, projects: base.projects.map((p) => ({ ...p, manday: 5 })) })
  const asAnnual = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, savingBasis: 'annual' },
    projects: base.projects.map((p) => ({ ...p, savingHours: p.savingHours == null ? null : p.savingHours * 12, manday: 5 })),
  })
  check('the same book stated per year gives the same monthly benefit',
    near(asAnnual.finance.monthlyBenefit, asMonthly.finance.monthlyBenefit, 1e-6),
    `${Math.round(asAnnual.finance.monthlyBenefit)} vs ${Math.round(asMonthly.finance.monthlyBenefit)}`)
  check('and the same FTE released',
    near(asAnnual.finance.fteReleased, asMonthly.finance.fteReleased, 1e-6),
    `${asAnnual.finance.fteReleased.toFixed(3)} vs ${asMonthly.finance.fteReleased.toFixed(3)}`)
  check('and the same return', near(asAnnual.finance.roi, asMonthly.finance.roi, 1e-9))
  for (const plan2 of [asMonthly, asAnnual]) {
    const b = plan2.settings.savingBasis
    const lead = plan2.people.find((p) => p.aggregatesTeam)
    check(`${b}: the lead scorecard FTE matches the portfolio FTE`,
      near(lead.finance.fteReleased, plan2.finance.fteReleased, 1e-6),
      `${lead.finance.fteReleased.toFixed(3)} vs ${plan2.finance.fteReleased.toFixed(3)}`)
    check(`${b}: the per-person benefits sum to the portfolio benefit`,
      near(plan2.people.reduce((a, p) => a + p.monthlyBenefit, 0), plan2.finance.monthlyBenefit, 1e-6))
  }
}

console.log('\n--- effort with no benefit is reported, not dropped ---')
{
  const withTbc = computePlan({ ...base, projects: base.projects.map((p) => ({ ...p, manday: 5 })) })
  const orphans = withTbc.projects.filter((p) => p.buildCost != null && p.monthlyBenefit == null)
  check('a project with mandays but TBC hours exists in the seed', orphans.length > 0, `${orphans.length} projects`)
  check('its cost stays out of the ROI denominator',
    !withTbc.projects.filter((p) => p.buildCost != null && p.monthlyBenefit != null).some((p) => orphans.includes(p)))
  check('but is reported separately rather than vanishing',
    near(withTbc.finance.unreturnedCost, orphans.reduce((a, p) => a + p.buildCost, 0), 1e-6)
    && withTbc.finance.unreturnedCount === orphans.length,
    fmtMoney(withTbc.finance.unreturnedCost))
}

console.log('\n--- the portfolio, and what it is allowed to divide ---')
check('benefit is exactly the headline hours valued at the hour rate',
  near(F.monthlyBenefit, plan.totals.totalHours * F.acctHourRate, 1e-6),
  `${fmtMoney(F.monthlyBenefit)} vs ${fmtMoney(plan.totals.totalHours * F.acctHourRate)}`)
check('annual is twelve months of it', near(F.annualBenefit, F.monthlyBenefit * 12))
check('with no effort anywhere, ROI is null rather than infinite',
  F.roi === null && F.buildCost === null && F.roiCoverage === 0,
  `roi=${F.roi} cost=${F.buildCost} coverage=${F.roiCoverage}`)
check('and every project is reported as uncosted',
  F.uncostedCount === seed.projects.filter((p) => p.savingHours != null).length,
  `${F.uncostedCount} of ${seed.projects.length}`)
check('a deferred project is NOT counted as uncosted — it is out of the plan', (() => {
  const withDeferred = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === DEFERRABLE.key ? { ...p, commitLevel: 'nextyear' } : p)),
  })
  return withDeferred.finance.uncostedCount === F.uncostedCount - 1
})(), String(F.uncostedCount))

// THE headline risk of a money model: costing one project and then dividing the
// whole book's benefit by it.
console.log('\n--- costing ONE project must not report the whole book as its return ---')
{
  const one = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === 'FNP-88' ? { ...p, manday: 20 } : p)),
  })
  const f = one.finance
  const proj = one.projects.find((p) => p.key === 'FNP-88')
  check('portfolio cost is that one project', near(f.buildCost, proj.buildCost), fmtMoney(f.buildCost))
  check('portfolio ROI equals that one project ROI, not the book over it',
    near(f.roi, proj.roi, 1e-9), `${fmtRoi(f.roi)} vs project ${fmtRoi(proj.roi)}`)
  check('portfolio net is that one project net, not the book minus one cost',
    near(f.netBenefit, proj.netBenefit, 1e-6),
    `${fmtMoney(f.netBenefit)} vs project ${fmtMoney(proj.netBenefit)}`)
  check('net and ROI are computed off the same benefit',
    near(f.netBenefit, f.roi * f.buildCost, 1e-6), fmtMoney(f.roi * f.buildCost))
  check('coverage says how little of the benefit that is',
    f.roiCoverage > 0 && f.roiCoverage < 0.25, `${(f.roiCoverage * 100).toFixed(1)}% of the benefit`)
  check('the benefit headline still covers the WHOLE book',
    near(f.monthlyBenefit, F.monthlyBenefit), fmtMoney(f.monthlyBenefit))
}

console.log('\n--- with the whole book costed, the sums reconcile ---')
{
  const all = computePlan({ ...base, projects: base.projects.map((p) => ({ ...p, manday: 10 })) })
  const f = all.finance
  const costedProjects = all.projects.filter((p) => p.buildCost != null && p.monthlyBenefit != null
    && !['excluded', 'nextyear'].includes(p.commitLevel))
  check('portfolio cost is the sum of the project costs',
    near(f.buildCost, costedProjects.reduce((a, p) => a + p.buildCost, 0), 1e-6), fmtMoney(f.buildCost))
  // Uniform costs make a mean of ratios and a ratio of sums algebraically
  // identical, so distinguishing them needs projects of DIFFERENT sizes —
  // which is also the only case where getting it wrong does any damage.
  check('portfolio ROI is the ratio of the sums, not a mean of ratios', (() => {
    const varied = computePlan({
      ...base,
      projects: base.projects.map((p, i) => ({ ...p, manday: 1 + (i % 40) })),
    })
    const cp = varied.projects.filter((p) => p.buildCost != null && p.monthlyBenefit != null
      && !['excluded', 'nextyear'].includes(p.commitLevel))
    const b = cp.reduce((a, p) => a + p.horizonBenefit, 0)
    const c = cp.reduce((a, p) => a + p.buildCost, 0)
    const meanOfRatios = cp.reduce((a, p) => a + p.roi, 0) / cp.length
    return near(varied.finance.roi, (b - c) / c, 1e-9)
      && Math.abs(varied.finance.roi - meanOfRatios) > 1
  })(), fmtRoi(f.roi))
  check('coverage is now the whole benefit', near(f.roiCoverage, 1, 1e-9), `${(f.roiCoverage * 100).toFixed(2)}%`)
  check('portfolio net is the sum of the costed project nets',
    near(f.netBenefit, costedProjects.reduce((a, p) => a + p.netBenefit, 0), 1e-6), fmtMoney(f.netBenefit))
  check('every person net is their own horizon benefit minus their own cost',
    all.people.every((p) => p.finance.netBenefit == null
      || near(p.finance.netBenefit, p.finance.horizonBenefit - p.finance.buildCost, 1e-6)))
  check('the gate count matches the projects that actually fail it', (() => {
    // Counted over commit+stretch only. Exercised with a deferred failing
    // project present, so this cannot pass merely because the seed has none.
    const withDeferred = computePlan({
      ...base,
      projects: base.projects.map((p) => ({
        ...p,
        manday: 400,
        commitLevel: p.key === DEFERRABLE.key ? 'nextyear' : p.commitLevel,
      })),
    })
    const counted = withDeferred.projects.filter(
      (p) => (p.commitLevel === 'commit' || p.commitLevel === 'stretch') && p.gate === 'fail').length
    const naive = withDeferred.projects.filter((p) => p.gate === 'fail').length
    return withDeferred.totals.failingGate === counted && counted !== naive
  })())
}

/* ================= 4. per-person money ================= */
console.log('\n--- money is credited on the same share as the hours ---')
{
  const costed = computePlan({ ...base, projects: base.projects.map((p) => ({ ...p, manday: 8 })) })
  for (const p of costed.people) {
    check(`${p.nick}: benefit is identically their credited hours x the rate`,
      near(p.monthlyBenefit, p.hours * F.acctHourRate, 1e-6),
      `${fmtMoney(p.monthlyBenefit)} vs ${fmtMoney(p.hours * F.acctHourRate)}`)
  }
  const lead = costed.people.find((p) => p.aggregatesTeam)
  check('the lead scorecard benefit is the sum of the team, like the hours',
    near(lead.finance.monthlyBenefit, costed.people.reduce((a, p) => a + p.monthlyBenefit, 0), 1e-6))
  check('the lead scorecard benefit equals the lead scorecard hours x the rate',
    near(lead.finance.monthlyBenefit, lead.scorecardHours * F.acctHourRate, 1e-6))
  // The lead aggregates the team, so summing scorecards double counts. Assert
  // the trap rather than pretending it does not exist.
  check('summing scorecard money across people deliberately does NOT equal the team',
    !near(costed.people.reduce((a, p) => a + p.finance.monthlyBenefit, 0), lead.finance.monthlyBenefit, 1),
    'the lead already carries everyone')
  check('nobody has a cost without a matching benefit in the same set',
    costed.people.every((p) => (p.buildCost == null) === (p.costedBenefit == null)))
}

console.log('\n--- objective 1 reads as money on every card ---')
check('objective 1 maps to a thb target kind', targetKindFor('financial') === 'thb')
check('the other hour objectives still map to hours',
  ['process_automation', 'efficiency', 'ai_automation'].every((o) => targetKindFor(o) === 'hours'))
check('objective 3 is still a milestone', targetKindFor('datawarehouse') === 'text')
for (const p of plan.people) {
  const l = p.kpiLines.find((x) => x.objective === 'financial')
  if (!l) continue
  check(`${p.nick}: objective 1 target is the annual benefit they carry`,
    l.targetKind === 'thb' && Math.abs(l.target - (p.benefitByObjective.financial || 0)) <= 1,
    fmtMoney(l.target))
}
check('every scorecard still totals 100% under the money model',
  plan.people.every((p) => weightsValid(p.kpiLines)) && plan.invalid.length === 0)

/* ================= 5. the rates are live ================= */
console.log('\n--- moving a salary moves everything that depends on it ---')
{
  const dbl = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, acctMonthlySalary: 60000 } },
    projects: base.projects.map((p) => ({ ...p, manday: 10 })),
  })
  const one = computePlan({ ...base, projects: base.projects.map((p) => ({ ...p, manday: 10 })) })
  check('doubling the accountant salary doubles the benefit',
    near(dbl.finance.monthlyBenefit, one.finance.monthlyBenefit * 2, 1e-6))
  check('and leaves the build cost alone', near(dbl.finance.buildCost, one.finance.buildCost, 1e-6))
  check('so the return more than doubles', dbl.finance.roi > one.finance.roi * 2)
  check('every objective-1 target doubles with it', dbl.people.every((p) => {
    const a = p.benefitByObjective.financial || 0
    const b = one.people.find((x) => x.id === p.id).benefitByObjective.financial || 0
    return near(a, b * 2, 1e-6)
  }))

  const dev = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, devMonthlySalary: 120000 } },
    projects: base.projects.map((p) => ({ ...p, manday: 10 })),
  })
  check('doubling the developer salary doubles the cost',
    near(dev.finance.buildCost, one.finance.buildCost * 2, 1e-6))
  check('and leaves the benefit alone', near(dev.finance.monthlyBenefit, one.finance.monthlyBenefit, 1e-6))
  check('the gate in hours-per-manday moves with the rates',
    gateAsHoursPerManday(dev.finance) > gateAsHoursPerManday(one.finance))

  // Applied to both sides, so it cannot move a ratio. The Settings copy says so.
  const loaded = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, loadFactor: 1.4 } },
    projects: base.projects.map((p) => ({ ...p, manday: 10 })),
  })
  check('the on-cost multiplier moves the magnitudes',
    near(loaded.finance.monthlyBenefit, one.finance.monthlyBenefit * 1.4, 1e-6))
  check('and leaves ROI exactly unchanged, as the UI claims',
    near(loaded.finance.roi, one.finance.roi, 1e-9), `${fmtRoi(loaded.finance.roi)} vs ${fmtRoi(one.finance.roi)}`)
}

console.log('\n--- a scenario saved before the money model still opens ---')
{
  const legacy = computePlan({ ...base, settings: { targetHours: 3000, savingBasis: 'monthly' } })
  check('missing finance settings fall back to the defaults',
    near(legacy.finance.acctHourRate, F.acctHourRate) && near(legacy.finance.devDayRate, F.devDayRate))
  const partial = computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, finance: { devMonthlySalary: 90000 } } })
  check('a partial finance block keeps every other rate',
    near(partial.finance.acctHourRate, F.acctHourRate)
    && near(partial.finance.devDayRate, (90000 * 1) / F.daysPerFteMonth))
  const zeroed = computePlan({
    ...base,
    settings: { ...DEFAULT_SETTINGS, finance: { ...DEFAULT_FINANCE, hoursPerFteMonth: 0, hoursPerManday: 0, horizonMonths: 0 } },
  })
  check('zeroed divisors fall back rather than producing Infinity',
    Number.isFinite(zeroed.finance.acctHourRate) && Number.isFinite(zeroed.finance.devDayRate)
    && zeroed.projects.every((p) => p.monthlyBenefit == null || Number.isFinite(p.monthlyBenefit)))
}

/* ================= 6. the effort estimator ================= */
console.log('\n--- the duration-based effort estimate ---')
check('weekdays are counted, weekends are not',
  workingDaysBetween('2026-01-05', '2026-01-09') === 5
  && workingDaysBetween('2026-01-05', '2026-01-11') === 5
  && workingDaysBetween('2026-01-05', '2026-01-12') === 6,
  `${workingDaysBetween('2026-01-05', '2026-01-09')} / ${workingDaysBetween('2026-01-05', '2026-01-11')} / ${workingDaysBetween('2026-01-05', '2026-01-12')}`)
check('a missing or reversed range is zero, not negative',
  workingDaysBetween(null, '2026-01-09') === 0
  && workingDaysBetween('2026-06-01', '2026-01-01') === 0)
// It must not be derived from saving hours, or every ROI would be identical and
// the measure would say nothing. This is the circularity trap.
check('the estimate is independent of saving hours, so ROI still varies', (() => {
  const estimated = base.projects
    .filter((p) => p.start && p.due && p.savingHours > 0)
    .map((p) => ({ ...p, manday: Math.max(1, Math.round(workingDaysBetween(p.start, p.due) * 0.5)) }))
  const rois = computePlan({ ...base, projects: estimated }).projects
    .filter((p) => p.roi != null)
    .map((p) => p.roi)
  const distinct = new Set(rois.map((r) => r.toFixed(3)))
  return rois.length > 20 && distinct.size > rois.length / 2
})())

/* ================= 7. the workbook agrees ================= */
console.log('\n--- the exported workbook carries the same figures ---')
{
  const state = { ...base, projects: base.projects.map((p) => ({ ...p, manday: 12 })) }
  const p2 = computePlan(state)
  const file = 'financial-selftest.xlsx'
  if (existsSync(file)) unlinkSync(file)
  const wb = await buildWorkbook(p2, state)
  await wb.xlsx.writeFile(file)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(file)

  // Summary
  const sum = back.getWorksheet('Summary')
  const kv = {}
  sum.eachRow((row) => {
    const k = String(row.getCell(1).value || '').trim()
    if (k) kv[k] = row.getCell(2).value
  })
  check('Summary carries the developer day rate', kv['= cost of one manday'] === Math.round(p2.finance.devDayRate),
    String(kv['= cost of one manday']))
  check('Summary carries the accountant hour rate', kv['= value of one saved hour'] === Math.round(p2.finance.acctHourRate),
    String(kv['= value of one saved hour']))
  check('Summary annual benefit matches the app',
    kv['Value of hours released (per year)'] === Math.round(p2.finance.annualBenefit),
    `${kv['Value of hours released (per year)']} vs ${Math.round(p2.finance.annualBenefit)}`)
  check('Summary ROI matches the app',
    Math.abs(kv['RETURN ON INVESTMENT'] - p2.finance.roi) < 1e-4,
    `${kv['RETURN ON INVESTMENT']} vs ${p2.finance.roi}`)
  check('Summary ROI is exported as a NUMBER, not a string',
    typeof kv['RETURN ON INVESTMENT'] === 'number', typeof kv['RETURN ON INVESTMENT'])

  // Projects sheet — the REGISTER. Effort, cost and return deliberately do not
  // appear here any more; they live on Effort_Return, so the two sheets cannot
  // state the same figure twice with different populations behind them.
  const ps = back.getWorksheet('Projects')
  const head = []
  ps.getRow(4).eachCell((c, n) => { head[n] = String(c.value || '') })
  const col = (label) => head.findIndex((h) => h && h.startsWith(label))
  const target = p2.projects.find((p) => p.key === 'FNP-88')
  check('the register carries the saving hours and the FTE',
    col('Saving') > 0 && col('FTE') > 0, head.filter(Boolean).join(' | '))
  check('and carries no cost or return column',
    ['Build cost', 'CAPEX', 'Investment', 'OPEX', 'Benefit', 'ROI', 'Payback', 'Mandays']
      .every((l) => col(l) < 0),
    head.filter(Boolean).join(' | '))

  // Effort_Return — where they went.
  const er = back.getWorksheet('Effort_Return')
  const ehead = []
  er.getRow(4).eachCell((c, n) => { ehead[n] = String(c.value || '') })
  const ecol = (label) => ehead.findIndex((h) => h && h.startsWith(label))
  let row = null
  er.eachRow((r) => {
    if (String(r.getCell(2).value || '') === target.summary && String(r.getCell(4).value || '').startsWith('TOTAL')) row = r
  })
  check('Effort_Return has a row for the project', !!row)
  check('the sheet has a build cost column', ecol('Cost') > 0, String(ecol('Cost')))
  check('project build cost matches the app', row.getCell(ecol('Cost')).value === Math.round(target.buildCost),
    `${row.getCell(ecol('Cost')).value} vs ${Math.round(target.buildCost)}`)
  check('project mandays match the app',
    Math.abs(row.getCell(ecol('Mandays')).value - target.manday) < 0.05,
    `${row.getCell(ecol('Mandays')).value} vs ${target.manday}`)
  check('project annual benefit matches the app',
    row.getCell(ecol('Benefit/yr')).value === Math.round(target.annualBenefit))
  check('project ROI matches the app',
    Math.abs(row.getCell(ecol('ROI')).value - target.roi) < 1e-4,
    `${row.getCell(ecol('ROI')).value} vs ${target.roi}`)
  check('project ROI is a number with a percent format',
    typeof row.getCell(ecol('ROI')).value === 'number' && String(row.getCell(ecol('ROI')).numFmt).includes('%'),
    String(row.getCell(ecol('ROI')).numFmt))
  check('payback matches the app',
    Math.abs(row.getCell(ecol('Payback')).value - target.paybackMonths) < 0.1)

  // per-person sheets
  for (const p of p2.people) {
    const ws = back.getWorksheet(`Obj-${p.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31))
    let annual = null
    let roi = null
    let objOneTarget = null
    ws.eachRow((r) => {
      const a = String(r.getCell(1).value || '')
      if (a.startsWith('Value of hours released')) annual = r.getCell(3).value
      if (a === 'Return on investment') roi = r.getCell(3).value
      if (String(r.getCell(2).value || '').includes('Obj 1')) objOneTarget = r.getCell(3).value
    })
    check(`${p.nick}: exported annual benefit matches the app`,
      annual === Math.round(p.finance.annualBenefit), `${annual} vs ${Math.round(p.finance.annualBenefit)}`)
    check(`${p.nick}: exported ROI matches the app`,
      p.finance.roi == null ? typeof roi === 'string' : Math.abs(roi - p.finance.roi) < 1e-4,
      `${roi} vs ${p.finance.roi}`)
    if (objOneTarget != null) {
      const line = p.kpiLines.find((l) => l.objective === 'financial')
      check(`${p.nick}: objective 1 target exports as a number in baht`,
        typeof objOneTarget === 'number' && Math.abs(objOneTarget - line.target) <= 1,
        `${objOneTarget} vs ${line.target}`)
    }
  }
  unlinkSync(file)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
