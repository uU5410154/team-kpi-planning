import { ASSIGNEE_ONLY, OBJ_BY_ID, OBJECTIVES, OUT_OF_PLAN, PEOPLE_ORDER } from './palette.js'

const OBJECTIVE_ORDER = OBJECTIVES.map((o) => o.id)

/**
 * Default contribution weights by Jira role label.
 *
 * These are RAW weights, not final shares. For each project the raw weights of
 * everyone credited are normalised so the project's total credited contribution
 * is exactly 1.0 — which is what stops the same saving hour being banked twice
 * across two people's scorecards (the flaw that made the 2025 sheet's totals
 * un-addable).
 */
/**
 * The role-point model recommended in the 2026 KPI plan (decision 9),
 * expressed on a 0-1 scale: dev 10 / lead 6 / pm 3 / assignee 3 / qa 2 /
 * support 2. Keep these in step with the plan document — the app and the
 * paper have to produce the same numbers or neither is trusted.
 */
export const DEFAULT_ROLE_WEIGHTS = {
  dev: 1.0,
  lead: 0.6,
  pm: 0.3,
  assignee: 0.3, // a bare assignee with no explicit role label
  qa: 0.2,
  support: 0.2,
}

/** Relative emphasis inside the delivery block, normalised over objectives held. */
export const DEFAULT_OBJECTIVE_PRIORITY = {
  delivery: 1,
  process_automation: 3,
  datawarehouse: 1.5,
  efficiency: 1.5,
  ai_automation: 1.5,
}

/**
 * Are the "Saving Hours" in Jira an annual figure or a per-month figure?
 * Jira does not say, and it changes the economics by 12x — the 2025 workbook
 * counted hours per MONTH, while the 2026 target of 3,000 hrs is unlabelled.
 * The app carries the assumption explicitly rather than burying it.
 */
export const SAVING_BASIS = {
  annual: { id: 'annual', label: 'Per year', monthsPerUnit: 12 },
  monthly: { id: 'monthly', label: 'Per month', monthsPerUnit: 1 },
}

/**
 * Objective 1 is a money question, not an hours question: what does the build
 * effort cost, what are the hours it gives back worth, and is the return worth
 * having? The management guideline says as much — "man-hours the team invests
 * vs. the benefits gained, whether it is worth it".
 *
 * Two rates drive everything, and both are meant to be argued about:
 *   - the DEVELOPER rate turns mandays of build into a cost
 *   - the ACCOUNTANT rate turns saved hours into a benefit
 *
 * Both are entered as a monthly salary, because that is the number anyone in
 * the business can sanity-check, and converted to a day/hour rate here.
 *
 * `hoursPerFteMonth` is the FTE ratio, and it is neither a guess nor a
 * textbook constant — the source workbook states it literally. Every one of
 * the 86 rows of the Project sheet computes its FTE column as
 *
 *   =IF([Saving hrs/mth]="TBC", 0, ROUND([Saving hrs/mth]/(22*8), 1))
 *
 * 22 working days x 8 hours = 176 hours per FTE per month, written as an
 * expression rather than a literal, with no row-level variants. The FA and
 * FA (rev) sheets divide the same way (=E/(22*8)), so 176 is the workbook's
 * constant wherever it appears. Reproducing it makes this app divide exactly
 * as management already does — see scripts/check-source-reconciliation.mjs,
 * which reads the workbook itself and proves it row by row.
 */
export const DEFAULT_FINANCE = {
  currency: 'THB',
  symbol: '฿',
  // Monthly salary of someone who BUILDS the automation.
  devMonthlySalary: 60000,
  // Monthly salary of the accountant whose manual hours are handed back.
  acctMonthlySalary: 30000,
  // Employer on-cost applied to both: social security, bonus, benefits, desk.
  // 1.0 keeps the arithmetic literally the salaries above; finance would
  // typically argue for 1.3-1.5. Because it multiplies BOTH rates it moves
  // every magnitude and leaves every ROI exactly unchanged — the Settings card
  // has to say so, or it reads as a broken knob.
  loadFactor: 1.0,
  // The FTE ratio: hours in one full-time month. 176 = 22 working days x 8
  // hours, which is the divisor the source workbook writes into every row of
  // its own FTE column. Reproducing it reproduces that column exactly — 84 of
  // 84 quantified rows match to the sheet's 1-decimal rounding, where the
  // 2,080/12 = 173.3 this used to carry matches only 82.
  //
  // Adjustable on the Model tab, and it is load-bearing in two directions: it
  // converts saving hours into FTE released AND it divides the accountant's
  // monthly salary into an hourly rate. Changing it therefore moves every THB
  // figure in the app, not just the FTE column.
  hoursPerFteMonth: 176,
  // Hours in a manday. The ONLY bridge between a day of build and an hour of
  // saving, so working days per month is derived from it rather than being a
  // second, independently editable calendar — two calendars silently put the
  // cost side and the benefit side on different months.
  hoursPerManday: 8,
  // How long a delivered automation is credited with paying back. ROI and net
  // benefit are both stated over this window, so it must be shown wherever
  // they are.
  horizonMonths: 12,
  // Objective 1's gate: the minimum return on build cost across the horizon.
  // 2.0 = the build cost comes back three times over inside the horizon, which
  // is a payback of 12/3 = 4 months.
  //
  // This default is chosen to hold the old bar rather than quietly relax it.
  // The gate it replaces was 4.0 saving hours per manday; at the default rates
  // ROI >= g is the same as hrs/manday >= (1+g) x devDayRate / (horizon x
  // acctHourRate), and g = 2.0 lands that on 4.0. Change the salaries and the
  // equivalent hours-per-manday moves with them — which is the point.
  roiGate: 2.0,
  /*
   * What the counted objectives are aiming at for the year.
   *
   * A target has to be a decision, not a readout: defaulted to the count in
   * the 2026 register so it starts honest, and adjustable from there. Left
   * equal to the live count it would always read "met", which tells nobody
   * anything.
   */
  objectiveTargets: { efficiency: 45, ai_automation: 9 },
  // How the accountant rate was arrived at. Stated rather than derived: the
  // blend behind it is a management assumption, not something the register
  // knows, and it belongs beside the number it produced.
  acctRateNote: 'Based on a blended user mix of 20% Manager and 80% Staff: '
    + '(20% x THB 6,500 x 22 days) + (80% x THB 1,700 x 22 days)',
}

/**
 * The two derived rates. Everything financial in the app comes through here,
 * so changing a salary in Settings moves every number at once.
 */
export function financeRates(settings) {
  const f = { ...DEFAULT_FINANCE, ...(settings?.finance || {}) }
  // Every divisor falls back rather than producing Infinity, and every salary
  // floors at zero — a negative rate would report a negative benefit, which is
  // not a thing a saved hour can be worth.
  const pos = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback)
  const nonNeg = (v) => (Number.isFinite(v) && v > 0 ? v : 0)
  const devMonthlySalary = nonNeg(f.devMonthlySalary)
  const acctMonthlySalary = nonNeg(f.acctMonthlySalary)
  const load = pos(f.loadFactor, 1)
  const hoursPerFteMonth = pos(f.hoursPerFteMonth, DEFAULT_FINANCE.hoursPerFteMonth)
  const hoursPerManday = pos(f.hoursPerManday, DEFAULT_FINANCE.hoursPerManday)
  const horizonMonths = pos(f.horizonMonths, DEFAULT_FINANCE.horizonMonths)
  // One calendar: a month is hoursPerFteMonth long and a day is hoursPerManday
  // of it, so cost and benefit are always quoted against the same month.
  const daysPerFteMonth = hoursPerFteMonth / hoursPerManday
  const acctHourRate = (acctMonthlySalary * load) / hoursPerFteMonth
  const devDayRate = (devMonthlySalary * load) / daysPerFteMonth
  return {
    ...f,
    devMonthlySalary,
    acctMonthlySalary,
    loadFactor: load,
    hoursPerFteMonth,
    hoursPerManday,
    horizonMonths,
    roiGate: Number.isFinite(f.roiGate) && f.roiGate >= 0 ? f.roiGate : DEFAULT_FINANCE.roiGate,
    acctRateNote: String(f.acctRateNote ?? DEFAULT_FINANCE.acctRateNote ?? ''),
    objectiveTargets: { ...DEFAULT_FINANCE.objectiveTargets, ...(f.objectiveTargets || {}) },
    daysPerFteMonth,
    /** Cost of one manday of build. */
    devDayRate,
    /** Value of one accountant hour handed back. */
    acctHourRate,
    /** Value of one whole accountant freed for a month. */
    acctMonthRate: acctMonthlySalary * load,
  }
}

/**
 * The gate restated in the units the team used before it was a money gate:
 * the saving hours per manday a project needs to clear `roiGate`.
 *
 * ROI >= g  <=>  hrs x acctHourRate x horizon >= (1+g) x mandays x devDayRate
 *           <=>  hrs/manday >= (1+g) x devDayRate / (horizon x acctHourRate)
 *
 * Shown beside the gate so moving it is never a silent change of standard.
 */
export function gateAsHoursPerManday(rates) {
  const denom = rates.horizonMonths * rates.acctHourRate
  if (!(denom > 0)) return null
  return ((1 + rates.roiGate) * rates.devDayRate) / denom
}

/** The gate restated as a payback period: ROI >= g <=> payback <= H/(1+g). */
export const gateAsPaybackMonths = (rates) =>
  rates.roiGate + 1 > 0 ? rates.horizonMonths / (1 + rates.roiGate) : null

/**
 * Months for a project's NET monthly benefit to repay what was invested in it.
 *
 * Both arguments moved when operating cost entered the model: the numerator is
 * the whole investment (build + CAPEX) and the denominator is the benefit NET
 * of the monthly OPEX run-rate.
 *
 * Null when either side is unknown — an unknown payback is not a fast one — and
 * null when the net monthly figure is zero or negative, because OPEX at or
 * above the benefit means the project never pays back at all. Rendering that as
 * a fast payback, or as a negative number of months, would be a lie.
 */
export function paybackMonths(investment, netMonthly) {
  // `investment <= 0` matches the ROI guard. A known-zero investment returned a
  // payback of 0.0 months beside a null ROI, so the two cells disagreed about
  // whether the project had a cost at all.
  if (investment == null || investment <= 0 || netMonthly == null || netMonthly <= 0) return null
  return investment / netMonthly
}

/* ------------------------------------------------------------------ */
/* capital and operating cost                                          */
/* ------------------------------------------------------------------ */

/**
 * The twelve columns of the plan year, in the order the source budget sheet
 * (BG 2026, columns G..R) writes them. Used by the cost grid, the cost dialog
 * and the exported Costs sheet, so all three are laid out identically.
 */
export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_IN_YEAR = MONTH_LABELS.length

/** A blank OPEX line, for the "add line" action in the cost dialog. */
export const newOpexLine = (seq = 1) => ({
  id: `opex-${Date.now().toString(36)}-${seq}`,
  label: '',
  monthly: null,
  startMonth: 1,
  endMonth: 12,
})

/**
 * Sanitise the stored OPEX lines.
 *
 * Same discipline as the saving hours and the mandays: a line whose monthly
 * amount is not a finite positive number carries no cost, and a start or end
 * month that is missing or out of range falls back to the whole year rather
 * than silently dropping the line out of the grid. A hand-edited scenario file
 * or a bad row in the database can hold anything at all, and one NaN here would
 * poison every monthly total, every ROI and the exported workbook.
 *
 * An end month before the start month is pulled UP to the start month rather
 * than swapped, so a half-typed range shows one month instead of a row of zeros
 * whose FY total disagrees with the run-rate.
 */
/**
 * Clean a project's task list. Each task is a slice of the build effort with
 * its own manday figure; the money beside it in the UI is DERIVED at the
 * developer day rate and never stored, so moving the salary re-prices the plan
 * instead of silently changing how much work a task is.
 */
/**
 * The benefits a project delivers that no number captures.
 *
 * Saving hours are only part of the case: control, an audit trail, risk
 * removed, a manual reconciliation nobody has to do at month end. They are
 * recorded as a list of short statements rather than a paragraph, so a
 * scorecard and a workbook can both show them as bullets instead of prose.
 *
 * Accepts either a real list or the newline-separated text a person types, and
 * always returns a clean list — the editor, the register, the scorecard and the
 * workbook then cannot disagree about what counts as one bullet.
 */
export function normalizeSoftBenefits(v) {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(/\r?\n/)
  return raw
    .map((x) => String(x ?? '').replace(/^\s*[-*\u2022\u00b7]\s*/, '').trim())
    .filter(Boolean)
    .map((x) => x.slice(0, 300))
    .slice(0, 20)
}

/** The same list as the text a person edits: one per line, no bullet glyphs. */
export const softBenefitsText = (v) => normalizeSoftBenefits(v).join('\n')

export function normalizeTasks(tasks) {
  if (!Array.isArray(tasks)) return []
  return tasks.map((raw, i) => {
    const n = Number(raw && raw.manday)
    return {
      id: (raw && raw.id) || `t${i + 1}`,
      label: String((raw && raw.label) || '').slice(0, 200),
      // Non-finite or negative is missing data, not effort.
      manday: Number.isFinite(n) && n > 0 ? n : 0,
      note: String((raw && raw.note) || '').slice(0, 500),
    }
  })
}

/**
 * The mandays a project actually carries.
 *
 * Tasks win when there are any: the total is then the sum of its parts and
 * cannot drift from them. With no tasks the stored figure stands, which is what
 * every project imported from the workbook has and what the bulk effort
 * estimator writes.
 */
export function resolveManday(p) {
  const tasks = normalizeTasks(p && p.tasks)
  if (tasks.length) return tasks.reduce((a, t) => a + t.manday, 0)
  const n = Number(p && p.manday)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Mandays <-> money, at the developer day rate. Both directions, one place. */
export const mandayToMoney = (manday, rates) =>
  (Number.isFinite(manday) && rates && rates.devDayRate > 0 ? manday * rates.devDayRate : null)
export const moneyToManday = (money, rates) =>
  (Number.isFinite(money) && rates && rates.devDayRate > 0 ? money / rates.devDayRate : null)

export function normalizeOpex(lines) {
  if (!Array.isArray(lines)) return []
  return lines.map((raw, i) => {
    const num = (v) => {
      const x = Number(v)
      return v == null || v === '' || !Number.isFinite(x) ? null : x
    }
    const month = (v, fallback) => {
      const x = num(v)
      return x == null ? fallback : Math.min(MONTHS_IN_YEAR, Math.max(1, Math.round(x)))
    }
    const monthly = num(raw?.monthly)
    const startMonth = month(raw?.startMonth, 1)
    return {
      id: typeof raw?.id === 'string' && raw.id ? raw.id : `opex-${i + 1}`,
      label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.trim() : `OPEX line ${i + 1}`,
      monthly: monthly != null && monthly > 0 ? monthly : 0,
      startMonth,
      endMonth: Math.max(startMonth, month(raw?.endMonth, MONTHS_IN_YEAR)),
    }
  })
}

/**
 * A project's capital and operating cost, sanitised and spread over the year.
 *
 *   capex        one-off investment, NULL when none is entered — unknown and
 *                zero are different things everywhere else in this file too
 *   opexByMonth  each line's monthly amount in the months it is actually live,
 *                twelve numbers, exactly the shape of BG 2026's G..R
 *   opexYear     the sum of that grid — the 2026 budget figure
 *   opexRunRate  every line's monthly amount with start/end IGNORED, i.e. the
 *                steady-state monthly cost. This is what the forward-looking
 *                ROI uses: a line that starts in October still costs that much
 *                a month for as long as the automation runs, and charging the
 *                horizon only three months of it would flatter the return.
 *
 * No depreciation anywhere: CAPEX is a one-off row, never spread across the
 * months. That is a deliberate decision of the team, not an omission.
 */
export function projectCosts(p) {
  const capexRaw = Number(p?.capex)
  const capex = p?.capex != null && Number.isFinite(capexRaw) && capexRaw > 0 ? capexRaw : null
  const opex = normalizeOpex(p?.opex)
  const opexByMonth = new Array(MONTHS_IN_YEAR).fill(0)
  for (const l of opex) {
    for (let m = l.startMonth; m <= l.endMonth; m++) opexByMonth[m - 1] += l.monthly
  }
  return {
    capex,
    capexNote: typeof p?.capexNote === 'string' ? p.capexNote : '',
    opex,
    opexByMonth,
    opexYear: opexByMonth.reduce((a, b) => a + b, 0),
    opexRunRate: opex.reduce((a, l) => a + l.monthly, 0),
  }
}

/**
 * Build cost and CAPEX added, where either side may be unknown.
 *
 * Both null -> null, because a project with neither an effort estimate nor a
 * capital figure has an UNKNOWN cost, not a cost of nothing. Either one present
 * -> the sum of what is actually known, so a project that carries a CAPEX but
 * no mandays does have a cost and therefore does get a return.
 */
export const totalInvestment = (buildCost, capex) =>
  buildCost == null && capex == null ? null : (buildCost ?? 0) + (capex ?? 0)

/**
 * How far a timeline may move before it counts against anybody.
 *
 * One sprint. A plan that may not move at all is not a plan, and a team
 * punished for a two-day slip learns to pad every estimate — which makes every
 * plan less true, which is the opposite of what measuring this is for.
 */
/** Today, every time it is asked — never captured into a constant. */
export const todayISO = () => new Date().toISOString().slice(0, 10)

/**
 * The date a plan is being read AS OF.
 *
 * Today, unless somebody has deliberately pinned one. Derived rather than
 * stored, because a stored "today" is wrong tomorrow — and a long-running
 * server that captured it at boot would serve the day it started for as long
 * as it stayed up.
 */
export function asOfOf(settings) {
  const pinned = settings && settings.asOfPinned && isDate(settings.asOfDate)
  return pinned ? settings.asOfDate : todayISO()
}

export const DEFAULT_SPRINT_DAYS = 14

/**
 * How far ONE project's timeline may drift: 20% of its own planned length.
 *
 * A share of the project rather than a flat number of days, because a fortnight
 * lost on a three-week job is a different failure from a fortnight lost on a
 * nine-month one. On a typical quarter-long project 20% is about a sprint,
 * which is where the rule came from.
 */
export const DEFAULT_MAX_PROJECT_DRIFT = 0.2

/**
 * And how much of somebody's book may drift at all: 15% of what they hold.
 *
 * The first limit alone would let every project slip by a fifth. This one caps
 * how many are allowed to slip at all, so the commitment is about the book and
 * not about each row in isolation.
 */
export const DEFAULT_MAX_DRIFTED_SHARE = 0.15

/** The share of a person's judged projects that must land inside it. */
export const DEFAULT_ONTIME_GATE = 0.8

export const DEFAULT_SETTINGS = {
  targetHours: 3000,
  // The source workbook's column is "Saving hrs/mth", and the 2025 plan was
  // also stated per month (1,823 hrs/month), so monthly is the right basis.
  savingBasis: 'monthly',
  finance: { ...DEFAULT_FINANCE },
  roleWeights: { ...DEFAULT_ROLE_WEIGHTS },
  // Whether "stretch" projects are shown inside the headline number.
  includeStretchInHeadline: false,
  objectivePriority: { ...DEFAULT_OBJECTIVE_PRIORITY },
  // Whoever absorbs saving hours that land on no scorecard owner — projects
  // owned by IT, or with no PIC at all. The team lead carries the team KPI.
  fallbackPic: 'gun',
  // false = GROSS: the six owners are credited the whole project.
  // true  = NET: partner/outsource devs dilute the core shares.
  creditPartners: false,
  // Anything due before this and not Done is flagged past due.
  /*
   * NOT STORED. "As of today" is a question asked at the moment somebody
   * looks, so it is answered then — see asOfOf below.
   *
   * A stored one went stale twice over: the plan held the 7th of August while
   * the calendar said the 25th, so anything running was measured to a date
   * eighteen days in the past and nothing became overdue for a fortnight after
   * it should have. Writing today's date into the plan instead only moves the
   * problem to tomorrow.
   *
   * A date here is honoured ONLY with asOfPinned, which is how somebody
   * reproduces a figure they reported last month.
   */
  asOfDate: null,
  asOfPinned: false,
  /*
   * Objective 1, which is about delivering on the timeline that was committed.
   * Both are decisions, so both are settings: how far a date may move, and how
   * much of somebody's work has to land inside that.
   */
  sprintDays: DEFAULT_SPRINT_DAYS,
  onTimeGate: DEFAULT_ONTIME_GATE,
  // Objective 1's two limits: how far one project may drift, and how much of
  // somebody's book may drift at all.
  maxProjectDrift: DEFAULT_MAX_PROJECT_DRIFT,
  maxDriftedShare: DEFAULT_MAX_DRIFTED_SHARE,
}

/**
 * Build the KPI lines for one person: a computed default weight and target,
 * with any manual override applied on top.
 *
 * Overrides live on `person.kpi = { [lineId]: { weight, target } }` so they
 * travel with the scenario into Mongo and out to Excel — the dashboard, the
 * scorecard and the export all read these same lines, so they cannot disagree.
 *
 * The DEFAULTS always total 1.0. Overrides can break that on purpose while
 * someone is mid-edit; `weightsValid` is what gates saving.
 */
/**
 * How an objective's KPI target is expressed. A POSITIVE switch on the
 * objective's own `measure`, deliberately: this used to be `measure !==
 * 'milestone' ? hours : text`, so changing objective 1 to a money measure
 * would have left it silently rendering baht under an "hrs/month" label.
 */
export const targetKindFor = (objectiveId) => {
  switch (OBJ_BY_ID[objectiveId]?.measure) {
    case 'milestone': return 'text'
    case 'money': return 'thb'
    case 'ratio': return 'percent'
    case 'count': return 'number'
    default: return 'hours'
  }
}

/**
 * Every objective a project answers to.
 *
 * One project can serve several: a PBI dashboard removes manual work AND is a
 * dashboard delivered. `objective` stays the primary one — it is what the
 * register shows in a single column and what every saved plan already holds —
 * and `objectives` carries the rest.
 */
export function projectObjectives(p) {
  const extra = Array.isArray(p && p.objectives) ? p.objectives : []
  const all = [p && p.objective, ...extra].filter((id) => OBJ_BY_ID[id])
  return OBJECTIVE_ORDER.filter((id) => all.includes(id))
}

/**
 * The one objective measured in hours, and the one measured in money.
 *
 * Found from the definitions rather than hardcoded, so changing which
 * objective carries the hours is a change to the guideline table and not a
 * hunt through the engine.
 */
export const HOURS_OBJECTIVE = (OBJECTIVES.find((o) => o.accrues === 'allHours')
  || OBJECTIVES.find((o) => o.measure === 'hours') || {}).id || null
export const MONEY_OBJECTIVE = (OBJECTIVES.find((o) => o.measure === 'money'
  || o.measure === 'ratio') || {}).id || null
export const RATIO_OBJECTIVE = (OBJECTIVES.find((o) => o.measure === 'ratio') || {}).id || null
export const COUNT_OBJECTIVES = OBJECTIVES.filter((o) => o.measure === 'count').map((o) => o.id)

/**
 * The objectives EVERY project serves, tag or no tag.
 *
 * The return is worked out over every project and the hours objective collects
 * every saving hour, so both are true of everything in the register. They are
 * shown on each row rather than left implicit — a register that only names one
 * of the objectives a project answers to is a register that reads as if the
 * others do not apply to it.
 */
export const impliedObjectives = () => [RATIO_OBJECTIVE, HOURS_OBJECTIVE].filter(Boolean)

/** Does this project's work count toward that objective? */
export const servesObjective = (p, id) => impliedObjectives().includes(id)
  || projectObjectives(p).includes(id)

/**
 * How a KPI target is expressed.
 *
 * The four objectives measure themselves in hours, baht or a milestone date,
 * but a scorecard also has to carry the things the register cannot count — a
 * number of somethings, a percentage, a date, a sentence. A line states its own
 * kind, so the editor, the unit label and the workbook cell all agree without
 * anyone inferring it from the objective.
 */
export const TARGET_KINDS = [
  { id: 'hours', label: 'Saving hours', numeric: true, help: 'A number of hours a month, the same measure the register uses' },
  { id: 'thb', label: 'Money', numeric: true, help: 'A figure in baht a year' },
  { id: 'number', label: 'A number', numeric: true, help: 'A count, a score — anything with a unit you name' },
  { id: 'percent', label: 'A percentage', numeric: true, help: 'A rate or a floor, stated in per cent' },
  { id: 'date', label: 'A date', numeric: false, help: 'Delivered by a date' },
  { id: 'text', label: 'Anything else', numeric: false, help: 'A milestone or a sentence a number cannot express' },
]

export const isNumericKind = (kind) => !!TARGET_KINDS.find((k) => k.id === kind)?.numeric

/** A blank line for the "add a KPI" action. */
export const newCustomLine = (seq = 1) => ({
  id: `custom-${Date.now().toString(36)}-${seq}`,
  label: '',
  objective: null,
  targetKind: 'text',
  target: '',
  unit: '',
})

/**
 * Sanitise the hand-added KPI lines.
 *
 * Same discipline as the tasks and the OPEX lines: anything that arrives
 * malformed — from an old scenario file, a hand-edited export, a half-finished
 * form — is normalised here rather than guarded at twenty call sites.
 */
export function normalizeCustomLines(lines) {
  if (!Array.isArray(lines)) return []
  return lines
    .filter((l) => l && typeof l === 'object')
    .map((l, i) => {
      const kind = TARGET_KINDS.find((k) => k.id === l.targetKind) ? l.targetKind : 'text'
      const numeric = isNumericKind(kind)
      const raw = l.target
      const n = Number(raw)
      return {
        id: String(l.id || `custom-${i}`),
        label: String(l.label || '').trim() || 'Untitled KPI',
        // A line may hang off an objective or stand on its own. Tied, it
        // filters the portfolio to that objective like any other line.
        objective: OBJ_BY_ID[l.objective] ? l.objective : null,
        targetKind: kind,
        target: numeric ? (Number.isFinite(n) ? n : 0) : String(raw ?? ''),
        unit: String(l.unit || '').trim(),
      }
    })
}

/**
 * A figure somebody has typed over the calculated one.
 *
 * The scorecard is normally a reflection of the project register: credited
 * hours are the sum of a person's share of their projects, and the money is
 * those hours priced. Sometimes that is not the number to appraise against —
 * work outside the register, an agreed carve-out, a figure already committed
 * upstairs — and the plan has to be able to say so.
 *
 * Two rules keep an override honest:
 *   - it never edits the register. The project book, the committed team total
 *     and every ROI stay exactly what the projects say. An override changes
 *     what a SCORECARD claims, and the app states everywhere that it is manual;
 *   - it is always reversible, and the calculated figure is kept beside it, so
 *     "revert" is a fact rather than a re-derivation that might not match.
 */
export function personOverrides(person) {
  const o = (person && person.overrides) || {}
  // Absence has to be tested BEFORE coercion: Number(null) and Number('') are
  // both 0, so an absent override read as a deliberate override of zero and
  // wiped the figure it was supposed to leave alone.
  const num = (v) => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return { hours: num(o.hours), money: num(o.money) }
}

export const hasOverride = (person) => {
  const o = personOverrides(person)
  return o.hours != null || o.money != null
}

/** Scale a per-objective map so its parts still add to the whole. */
function scaleByObjective(map, k) {
  if (!(k >= 0) || k === 1) return map
  const out = {}
  for (const [id, v] of Object.entries(map || {})) out[id] = v * k
  return out
}

/**
 * Apply a person's overrides to one set of scorecard figures.
 *
 * The per-objective maps are scaled by the same factor as the headline, so the
 * KPI targets underneath still add up to the number above them. Money follows
 * hours unless money is itself overridden — they are the same hours at the same
 * rate, and letting them drift apart would put two answers on one card.
 *
 * `calcHours` and `calcMonthlyBenefit` come back untouched whatever happens, so
 * the UI can show what the register says beside what the author typed.
 */
export function applyPersonOverride(person, figures) {
  const ov = personOverrides(person)
  const calcHours = figures.hours
  const calcMonthlyBenefit = figures.monthlyBenefit

  const hours = ov.hours != null ? ov.hours : calcHours
  const hoursK = ov.hours != null && calcHours > 0 ? ov.hours / calcHours : 1
  const monthlyBenefit = ov.money != null
    ? ov.money / 12
    : calcMonthlyBenefit * hoursK
  const moneyK = calcMonthlyBenefit > 0 ? monthlyBenefit / calcMonthlyBenefit : 1

  return {
    ...figures,
    hours,
    monthlyBenefit,
    byObjective: scaleByObjective(figures.byObjective, hoursK),
    benefitByObjective: scaleByObjective(figures.benefitByObjective, moneyK),
    calcHours,
    calcMonthlyBenefit,
    calcAnnualBenefit: calcMonthlyBenefit * 12,
    hoursOverridden: ov.hours != null,
    moneyOverridden: ov.money != null,
    overridden: ov.hours != null || ov.money != null,
  }
}

/**
 * What the saving-hours targets on a scorecard add up to.
 *
 * Not the same question as "what does this person carry": the headline above
 * the card is the credited figure, while this is the sum of the targets
 * actually written on it. They agree until somebody types a target over, and
 * the point of showing both is that the difference becomes visible instead of
 * being carried into an appraisal unnoticed.
 *
 * Only the hours lines are added. A money target, a date and a sentence are
 * not hours, and a total that quietly mixed them would be worse than no total.
 */
/**
 * The saving hours a card STATES.
 *
 * Not the hours behind it: the hours written on it. A target typed over is a
 * commitment, and a card whose total ignored what its own rows say is a card
 * nobody can add up — you type 2,100 into a line and the total underneath does
 * not move.
 *
 * A line stated in hours contributes what it says. A line stated in baht or as
 * a date still carries hours, so it contributes those — otherwise objective 1
 * and objective 3 would silently drop out of the total. Both are shown on the
 * line itself, so the column adds up on screen.
 *
 * With nothing typed, every hours target defaults to the credited figure, so
 * this equals the register exactly. It only diverges once somebody edits, and
 * then it diverges because they meant it to.
 */
export function lineStatedHours(l) {
  const asTyped = () => {
    const n = Number(l.target)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  // A hand-written line has no register figure behind it; what it says is all
  // there is.
  if (l.custom) return l.targetKind === 'hours' ? asTyped() : 0
  // A typed hours target is a commitment and counts as typed. An untouched one
  // is the credited figure ROUNDED for display, so the exact figure is used
  // instead — otherwise an untouched card drifts from the register by the
  // rounding on each line.
  if (l.targetKind === 'hours' && l.targetPinned) return asTyped()
  return l.creditedHours ?? (l.targetKind === 'hours' ? asTyped() : 0)
}

export function statedHours(lines) {
  return (Array.isArray(lines) ? lines : []).reduce((a, l) => a + lineStatedHours(l), 0)
}

/** The same, split by objective, so a team figure can be built out of them. */
export function statedByObjective(lines) {
  const out = {}
  for (const l of Array.isArray(lines) ? lines : []) {
    if (!l.objective) continue
    out[l.objective] = (out[l.objective] || 0) + lineStatedHours(l)
  }
  return out
}

export function kpiTargetTotals(lines) {
  const list = Array.isArray(lines) ? lines : []
  const sumOf = (kind) => list
    .filter((l) => l.targetKind === kind)
    .reduce((a, l) => a + (Number(l.target) || 0), 0)

  /*
   * The saving hours BEHIND the card, which is not the same as the sum of the
   * hours written in the Target column.
   *
   * Objective 1 states its target in baht and objective 3 states a date, but
   * both still carry saving hours. Adding only the hours-typed targets left
   * those out and reported a total well short of what the person actually
   * carries — a number that looks like the headline, is not, and would be
   * taken for it.
   */
  const savingHours = statedHours(list)

  return {
    // What the card STATES across its lines — the number the rows add up to.
    savingHours,
    // And what the register puts behind them, for comparison.
    creditedHours: list.reduce((a, l) => a + (l.creditedHours ?? 0), 0),
    // What is literally typed in the Target column, by unit.
    hours: sumOf('hours'),
    money: sumOf('thb'),
    hoursLines: list.filter((l) => l.targetKind === 'hours').length,
    moneyLines: list.filter((l) => l.targetKind === 'thb').length,
  }
}

export function scorecardWeights(person, settings, credited = {}, creditedMoney = {}, counted = {}, ratio = null) {
  const held = person.objectives || []
  const prio = settings.objectivePriority
  const totalPrio = held.reduce((a, id) => a + (prio[id] ?? 1), 0)

  // 2026 carries no corporate (CP AXTRA Sales / EAT) or capability line, so the
  // delivery objectives are the whole card and split 100% between them.
  // targetKind 'hours' -> a number the UI renders as hrs/month.
  // 'thb'   -> a number the UI renders as annual baht (objective 1).
  // 'text'  -> a milestone or qualitative target a number cannot express.
  const lines = []

  if (totalPrio > 0) {
    held.forEach((id) => {
      // How the TARGET is expressed, which is separate from whether the hours
      // count: objective 3 is measured by a date but still contributes hours.
      const kind = targetKindFor(id)
      const live = kind === 'percent'
        /*
         * What this person is actually returning — the same discipline as
         * every other line on the card, which starts at what the register
         * says rather than at somebody's round number.
         *
         * It used to start at the plan's gate, which made objective 1 the one
         * line whose target had nothing to do with the person in front of it:
         * a card carrying +145% opened stating 30%, and a target already met
         * three times over is not a target.
         *
         * The gate has not gone anywhere. It is the plan-level floor on the
         * Model tab, it still colours whether a line is met, and it is what
         * this falls back to for somebody with no return yet — a new joiner
         * has to aim at the standard, having nothing of their own to aim at.
         */
        ? (() => {
          /*
           * The GATE, for everybody.
           *
           * A target defaulted to what somebody is already doing is not a
           * target — and unlike the return this replaced, on-time delivery is
           * a standard the whole team is held to alike, which is the point of
           * the boss asking each person to commit to one.
           */
          const gate = settings?.maxDriftedShare ?? DEFAULT_MAX_DRIFTED_SHARE
          /*
           * Never below the gate. The objective reads "the return must not be
           * less than X", so a person returning −4% cannot have a target of
           * −4% — that is not a standard, it is a description. They aim at the
           * gate, and the card shows them short of it, which is the point.
           *
           * FLOORED, not rounded: a card has to open MEETING its own default.
           * Rounding 144.6 up to 145 left somebody failing a target the app
           * had just written for them.
           */
          return Math.round(gate * 100)
        })()
        : kind === 'thb'
          ? Math.round(creditedMoney[id] || 0)
        : kind === 'hours'
          ? Math.round(credited[id] || 0)
          // A counted objective starts at what the person is actually
          // delivering, the same discipline as the hours: the target begins
          // realistic instead of at somebody's round number.
          : kind === 'number'
            ? Math.round(counted[id] || 0)
            : (OBJ_BY_ID[id]?.target || '—')
      lines.push({
        id: `obj-${id}`,
        block: 'Delivery',
        objective: id,
        weight: (prio[id] ?? 1) / totalPrio,
        targetKind: kind,
        unit: kind === 'number' ? (OBJ_BY_ID[id]?.countUnit || '') : '',
        // Default = what this person actually carries, so the number starts
        // realistic rather than at the team's 3,000.
        target: live,
      })
    })
  } else {
    // Nobody should hold zero objectives; if it happens, park the delivery
    // block on the pool objective rather than silently losing the weight.
    lines.push({ id: 'obj-none', block: 'Delivery', objective: 'process_automation', weight: 1, targetKind: 'hours', target: 0 })
  }

  /*
   * Lines added by hand.
   *
   * They join the same pool as the derived ones and are weighted the same way:
   * one hand-added KPI is worth one objective before anybody types a weight,
   * and from then on a typed weight is honoured exactly and the rest flex —
   * exactly as they do for a derived line. They are NOT a separate block with
   * its own share, because a card that splits 100% two different ways is a card
   * nobody can check.
   */
  const custom = normalizeCustomLines(person.customLines)
  const each = 1 / Math.max(1, lines.length)
  for (const c of custom) {
    lines.push({
      id: c.id,
      block: 'Delivery',
      objective: c.objective,
      weight: each,
      targetKind: c.targetKind,
      target: c.target,
      unit: c.unit,
      label: c.label,
      custom: true,
    })
  }

  const ov = person.kpi || {}
  const hidden = new Set(person.kpiHidden || [])

  // A card has to keep at least one line: with the corporate and capability
  // lines gone, the objectives are all there is, and hiding the last one would
  // leave a 0% scorecard that nothing could rescale back to 100%.
  const kept = lines.filter((l) => !hidden.has(l.id))
  const resolved = (kept.length ? kept : lines.slice(0, 1))
    .map((l) => {
      const o = ov[l.id] || {}
      const numeric = isNumericKind(l.targetKind)
      const hasTargetOverride = numeric
        ? typeof o.target === 'number'
        : o.target != null && o.target !== ''
      const target = hasTargetOverride ? o.target : l.target
      return {
        ...l,
        // A typed weight is held at exactly what was typed; the rest flex.
        // Snapped on read so a weight saved before the 5-point grid — or edited
        // by hand in a scenario file — cannot leave the card off the grid.
        weight: typeof o.weight === 'number' ? snapWeight(o.weight * 100) / 100 : l.weight,
        weightPinned: typeof o.weight === 'number',
        // Specifically the target, not "something on this line was edited":
        // the total below the card uses the typed figure where there is one
        // and the exact credited figure where there is not, so an untouched
        // card still totals what the register says to the last decimal.
        targetPinned: hasTargetOverride,
        target,
        defaultWeight: l.weight,
        // The live figure straight from current project assignments. Reassign a
        // project on the Projects tab and this moves immediately.
        defaultTarget: l.target,
        // Hours only where the objective is measured in hours. A money line
        // prices the SAME hours and a counted line counts deliverables, so
        // neither carries hours of its own — reporting them here as well would
        // add the plan's saving hours to the card two and three times over.
        creditedHours: l.objective && !l.custom && l.targetKind === 'hours'
          ? (credited[l.objective] || 0) : null,
        creditedMoney: l.objective && !l.custom && l.targetKind === 'thb'
          ? (creditedMoney[l.objective] || 0) : null,
        creditedCount: l.objective && !l.custom && l.targetKind === 'number'
          ? (counted[l.objective] || 0) : null,
        // A manual target that no longer matches what the person actually
        // carries — surfaced so it can be re-synced rather than silently drift.
        // Compared numerically where the target is a number: baht figures are
        // large enough that a strict !== would flag a rounding difference of
        // one satang as a drifted target.
        // A hand-added line has nothing to drift FROM: its target is
        // whatever the user set, not a figure derived from the register, so
        // offering to "re-sync" it would overwrite the very thing they typed.
        drifted: !l.custom && !!l.objective && (numeric
          ? Math.abs(Number(target) - Number(l.target)) > 0.5
          : target !== l.target),
        overridden: typeof o.weight === 'number' || hasTargetOverride,
      }
    })

  /*
   * Reassigning a project changes which objectives someone holds, which adds or
   * removes lines. Left alone that lands new weight on top of the existing ones
   * and knocks the card off 100% — the app breaking its own scorecard and then
   * blocking the save for it.
   *
   * So a weight the user typed is honoured exactly, and the lines they have NOT
   * touched share out whatever is left. Setting a PIC therefore moves the target
   * and nothing else, while typing 40% really does show 40%. Only typed weights
   * can push a card off 100% — either past it, or short of it with no free line
   * left to absorb the rest — and that is a real error worth gating.
   */
  const pinned = resolved.filter((l) => l.weightPinned)
  const flex = resolved.filter((l) => !l.weightPinned)
  const fixed = pinned.reduce((a, l) => a + l.weight, 0)
  const pool = Math.max(0, 1 - fixed)
  const rel = flex.reduce((a, l) => a + l.weight, 0)
  for (const l of flex) {
    l.weight = rel > 0 ? (l.weight / rel) * pool : pool / flex.length
  }

  // Whole percentages only — a scorecard put in front of someone should read
  // 25%, not 26.5%. Skipped when the typed weights already fill or overflow the
  // card, so that genuinely invalid state stays visible to the save gate instead
  // of being rounded into looking fine.
  if (flex.length > 0 && fixed <= 1) {
    const pct = toWholePercents(flex.map((l) => l.weight), WEIGHT_STEP, pool)
    flex.forEach((l, i) => { l.weight = pct[i] })
  }

  return resolved
}

/** Weights are quantised to this many percentage points. */
export const WEIGHT_STEP = 5

/**
 * Largest-remainder apportionment onto a fixed grid: turn fractional shares
 * into percentages that are multiples of WEIGHT_STEP and still total exactly
 * 100%. Rounding each one independently would land on 95% or 105% and trip the
 * save gate.
 *
 * Every line that carries any weight is given at least one step, so a KPI
 * someone actually holds never shows as 0% and counts for nothing.
 *
 * `share` is how much of the card these lines are between them — 1 for a whole
 * card, or the remainder when some lines are pinned at a weight the user typed.
 *
 * Returns decimals (0.25 for 25%).
 */
export function toWholePercents(weights, step = WEIGHT_STEP, share = 1) {
  const n = weights.length
  if (!n) return []
  const units = Math.max(0, Math.round((100 * share) / step)) // 20 slots of 5 points for a whole card
  const total = weights.reduce((a, b) => a + b, 0)
  const exact = total > 0
    ? weights.map((w) => (w / total) * units)
    : weights.map(() => units / n)

  const slots = exact.map((v) => Math.floor(v))
  let leftover = units - slots.reduce((a, b) => a + b, 0)

  // Biggest fractional part first; ties to the earlier line so the result is
  // deterministic rather than dependent on sort stability.
  const byRemainder = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; k < leftover; k++) slots[byRemainder[k % n].i] += 1

  // Lift any held line off zero, taking from the largest. Only possible while
  // there are at least as many slots as lines.
  if (n <= units) {
    for (let guard = 0; guard < n * 2; guard++) {
      const zero = slots.findIndex((s, i) => s === 0 && weights[i] > 0)
      if (zero < 0) break
      let biggest = 0
      for (let i = 1; i < n; i++) if (slots[i] > slots[biggest]) biggest = i
      if (slots[biggest] < 2) break
      slots[biggest] -= 1
      slots[zero] += 1
    }
  }

  return slots.map((s) => (s * step) / 100)
}

/** Snap a hand-typed percentage onto the same grid. */
export const snapWeight = (pct, step = WEIGHT_STEP) =>
  Math.min(100, Math.max(0, Math.round(pct / step) * step))

/** The unit a numeric KPI target is quoted in. */
export const targetUnit = (line, basis = 'monthly', symbol = '฿') => {
  if (line.targetKind === 'thb') return `${symbol}/year`
  if (line.targetKind === 'percent') return '%'
  // A hand-added number is quoted in whatever the user called it.
  if (line.targetKind === 'number') return line.unit || ''
  return basis === 'monthly' ? 'hrs/month' : 'hrs/year'
}

/**
 * Render a KPI target for display or export. Objective 1 is money, everything
 * else that carries a number is hours; a milestone stays free text.
 */
export const fmtTarget = (line, basis = 'monthly', symbol = '฿') => {
  if (line.targetKind === 'thb') {
    return `${symbol}${Math.round(Number(line.target || 0)).toLocaleString()}/year`
  }
  if (line.targetKind === 'hours') {
    return `${Number(line.target || 0).toLocaleString()} ${basis === 'monthly' ? 'hrs/month' : 'hrs/year'}`
  }
  if (line.targetKind === 'percent') {
    // A floor: the ROI has to be AT LEAST this, so it reads as one.
    return `${Math.round(Number(line.target) || 0).toLocaleString()}% or better`
  }
  if (line.targetKind === 'number') {
    const n = Number(line.target || 0).toLocaleString()
    return line.unit ? `${n} ${line.unit}` : n
  }
  return String(line.target ?? '—') || '—'
}

/** Lines removed from a scorecard, so they can be listed and restored. */
export function hiddenLines(person, settings, credited = {}, creditedMoney = {}, counted = {}, ratio = null) {
  const hidden = new Set(person.kpiHidden || [])
  if (!hidden.size) return []
  const all = scorecardWeights({ ...person, kpiHidden: [] }, settings, credited, creditedMoney, counted, ratio)
  return all.filter((l) => hidden.has(l.id))
}

/* ------------------------------------------------------------------ */
/* money formatting                                                    */
/* ------------------------------------------------------------------ */

/** Full baht, for tables and anywhere a figure has to be checkable by hand. */
export const fmtMoney = (n, symbol = '฿') =>
  n == null ? '—' : `${n < 0 ? '-' : ''}${symbol}${Math.round(Math.abs(n)).toLocaleString()}`

/** Compact baht, for hero tiles where the magnitude matters more than the digits. */
export const fmtMoneyShort = (n, symbol = '฿') => {
  if (n == null) return '—'
  const a = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (a >= 1e6) return `${sign}${symbol}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`
  if (a >= 1e4) return `${sign}${symbol}${Math.round(a / 1e3)}k`
  return `${sign}${symbol}${Math.round(a).toLocaleString()}`
}

/** ROI as a percentage. Negative is a loss, so the sign is always shown. */
export const fmtRoi = (n) => (n == null ? '—' : `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`)

/**
 * A payback period narrow enough for a table column. The long form below reads
 * better in a sentence; this one has to fit beside eleven other columns.
 */
export const fmtMonthsShort = (n) => {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 24) return `${n.toFixed(1)} mo`
  return `${(n / 12).toFixed(1)} yr`
}

/** A payback period in the unit that reads best at its own magnitude. */
export const fmtMonths = (n) => {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n < 1) return `${(n * 30).toFixed(0)} days`
  if (n < 24) return `${n.toFixed(1)} months`
  return `${(n / 12).toFixed(1)} years`
}

/**
 * Rescale weights to total exactly 100%, keeping their existing ratios and
 * landing on whole percentages — a scorecard shown to someone should read
 * 16%, not 15.88%.
 *
 * Uses largest-remainder apportionment: floor everything, then hand the leftover
 * points to the lines that lost the most in rounding. Naively rounding each line
 * would miss 100% by a point or two, which the save gate would then block.
 */
export function rebalanceWeights(lines) {
  if (!lines.length) return {}
  const pct = toWholePercents(lines.map((l) => l.weight || 0))
  return Object.fromEntries(lines.map((l, i) => [l.id, pct[i]]))
}

export const weightSum = (lines) => lines.reduce((a, l) => a + (l.weight || 0), 0)

/** A scorecard is only saveable when its weights total exactly 100%. */
export const weightsValid = (lines) => Math.abs(weightSum(lines) - 1) < 0.0005

/** Everyone whose weights do not total 100% — the save gate reads this. */
export const invalidScorecards = (people) =>
  people.filter((p) => !weightsValid(p.kpiLines)).map((p) => ({
    id: p.id,
    nick: p.nick,
    sum: weightSum(p.kpiLines),
  }))

/**
 * Move a project to a new owner.
 *
 * Setting `pic` alone is not a reassignment. Credit is worked out from
 * `contributors` — a role-weighted list — and the PIC only counts as a bare
 * assignee when nobody is listed. So changing the PIC on its own left the
 * previous owner in the contributor list at dev weight (1.0) against the new
 * owner's assignee weight (0.3), and the project stayed 77% with the person it
 * had just been taken off.
 *
 * The previous owner's entry MOVES to the new one, carrying its roles. Anyone
 * else listed is a genuine collaborator and is left exactly as they are.
 *
 * Returns the patch to apply, so the UI and the tests reassign the same way.
 */
export function reassignPatch(project, nextPic) {
  const prev = project.pic ?? null
  const next = nextPic || null
  if (prev === next) return { pic: next }

  const list = Array.isArray(project.contributors) ? project.contributors : []
  const moving = list.find((c) => c.person === prev)
  const rest = list.filter((c) => c.person !== prev && c.person !== next)

  if (!next) {
    // Unassigned. The hours fall to whoever absorbs unowned work.
    return { pic: null, contributors: rest }
  }
  const already = list.find((c) => c.person === next)
  const roles = (already && already.roles) || (moving && moving.roles) || ['dev']
  return { pic: next, contributors: [...rest, { person: next, roles }] }
}

export const ROLE_ORDER = ['pm', 'lead', 'dev', 'support', 'qa', 'assignee']

/** What each role is called on screen and in the workbook. */
export const ROLE_LABEL = {
  pm: 'PM',
  lead: 'Lead',
  dev: 'Developer',
  support: 'Support',
  qa: 'QA',
  assignee: 'Assignee',
}

/**
 * Set one person's roles on a project, by hand.
 *
 * Credit is role-weighted, so this is the dial that decides how a shared
 * project splits. Rules:
 *   - unknown role names are dropped, duplicates collapse, and the order is
 *     always ROLE_ORDER, so two people holding the same roles read the same;
 *   - clearing every role removes the person from the contributor list. If
 *     they are the PIC they keep the project at the bare `assignee` weight,
 *     which is exactly what an unlabelled owner has always been worth;
 *   - the row keeps its position, so editing a role does not reshuffle the
 *     table under the user's cursor.
 *
 * Returns the patch to apply, so the UI, the tests and any bulk edit all
 * reassign roles the same way.
 */
/**
 * Repair state written before a PIC change moved the project.
 *
 * Changing the PIC used to write only the `pic` field. Credit comes from the
 * contributor list, so the previous owner stayed on it at dev weight (1.0)
 * against the new owner's bare assignee weight (0.3) — the project kept 77% of
 * its hours on the scorecard it had just been taken off. reassignPatch fixed
 * the write; it cannot fix what was already saved, and dropping the cache to
 * clear it would throw away the user's whole plan.
 *
 * The damage has a signature: the PIC holds a scorecard, is NOT in the
 * contributor list, and somebody else who holds a scorecard IS. Before roles
 * could be set by hand there was no way to reach that state deliberately, so
 * it is repaired by moving the stranded owner's entry — and their roles — to
 * the PIC.
 *
 * It runs ONCE, stamped, never on every load. With the role editor that state
 * is now reachable on purpose: clearing the PIC's roles leaves them the bare
 * assignee while a colleague does the work. Repairing that on every render
 * would make it impossible to set.
 *
 * Anything owned by IT or another partner team is left alone — a partner
 * owning delivery while a team member develops is a real arrangement, not
 * damage.
 */
export function repairOwnership(projects, people, roleWeights = DEFAULT_ROLE_WEIGHTS) {
  // The SAME definition of an owner computePlan uses. Taking the whole roster
  // would move hours onto IT, who is assignable as PIC but carries no KPI —
  // the hours would leave the team's numbers without appearing anywhere else.
  const owners = new Set((people || []).filter((p) => p.scorecard !== false).map((p) => p.id))
  const weightOf = (c) => Math.max(...(c.roles || []).map((r) => roleWeights[r] ?? 0), 0)
  let repaired = 0

  const out = (projects || []).map((p) => {
    const list = Array.isArray(p.contributors) ? p.contributors : []
    if (!p.pic || !owners.has(p.pic) || !list.length) return p
    if (list.some((c) => c.person === p.pic)) return p

    const stranded = list
      .filter((c) => owners.has(c.person))
      .sort((a, b) => weightOf(b) - weightOf(a))[0]
    if (!stranded) return p

    repaired++
    return {
      ...p,
      contributors: list.map((c) => (c === stranded ? { ...c, person: p.pic } : c)),
    }
  })
  return { projects: out, repaired }
}

/**
 * One-off data repairs, stamped so each runs exactly once.
 *
 * Deliberately NOT the storage VERSION: bumping that DISCARDS the cache, which
 * would cost the user every edit they have made. A repair fixes the damage in
 * place and leaves the rest of the plan alone.
 *
 * 1: a PIC change used to write only `pic`, leaving the project on the old
 *    owner's scorecard at 77%.
 */
export const REPAIR_VERSION = 6

/**
 * The as-of date that nobody chose.
 *
 * '2026-08-07' was the hard-coded default for months, so a plan holding
 * exactly that value is holding a default rather than a decision, and it is
 * safe to move to today. Any OTHER date was typed by a person and is left
 * alone — a deliberately pinned as-of date is how somebody reproduces a
 * figure they reported last month.
 */
export const STALE_AS_OF = '2026-08-07'

/**
 * Stop an old stored date being treated as a decision.
 *
 * Nothing is written in its place — writing today's date would be stale by
 * tomorrow, which is the bug this exists to end. The date is simply left
 * un-pinned, and asOfOf then answers with today, every time it is asked.
 */
export function repairAsOfDate(settings) {
  if (!settings || settings.asOfPinned === true) return { settings, moved: false }
  if (settings.asOfDate == null) return { settings, moved: false }
  return { settings: { ...settings, asOfDate: null, asOfPinned: false }, moved: true }
}

/**
 * Give every already-committed project a baseline date.
 *
 * The register keeps no history, so the date it holds today is the earliest
 * one that can honestly be called the commitment. Everybody therefore starts
 * with their free re-plan unspent, which is the fair reading: nobody should
 * lose an allowance for moves made before the allowance existed.
 */
/**
 * A finish date held against the sync, with no date to hold.
 *
 * The flag says "do not let the sync write this field". On a project with no
 * finish date that is not a correction — it is a project waiting for a sync
 * that will never come, and it would sit unfinished for the rest of the year
 * however many times its tasks were closed. Only a real date can be held.
 */
export function repairHeldFinish(projects) {
  let cleared = 0
  const out = (projects || []).map((p) => {
    if (!p || p.actualEndPinned !== true || isDate(p.actualEnd)) return p
    cleared += 1
    return { ...p, actualEndPinned: false }
  })
  return { projects: out, cleared }
}

export function repairBaselineDates(projects) {
  let stamped = 0
  const out = (projects || []).map((p) => {
    if (!p || p.baselineDue || !isDate(p.due)) return p
    stamped += 1
    return { ...p, baselineDue: p.due, replanCount: Number(p.replanCount) || 0 }
  })
  return { projects: out, stamped }
}

/**
 * Objective 1 stopped being Financial and became Project management, and an
 * id changed with it.
 *
 * Five projects in the seed and four in the live plan name `financial` as
 * their primary objective. An id nothing answers to is not a tag, it is a
 * hole: countsToPool reads the objective to decide whether a project's hours
 * enter the pool, so those rows would have silently dropped out of the team
 * total — the sort of change that shows up as a KPI moving for no reason
 * anybody can explain.
 */
export const RENAMED_OBJECTIVES = { financial: 'delivery' }

export function repairObjectiveIds(projects) {
  let moved = 0
  const out = (projects || []).map((p) => {
    const from = RENAMED_OBJECTIVES[p.objective]
    const tags = Array.isArray(p.objectives) ? p.objectives : null
    const retagged = tags && tags.some((id) => RENAMED_OBJECTIVES[id])
      ? [...new Set(tags.map((id) => RENAMED_OBJECTIVES[id] || id))]
      : null
    if (!from && !retagged) return p
    moved += 1
    return { ...p, ...(from ? { objective: from } : {}), ...(retagged ? { objectives: retagged } : {}) }
  })
  return { projects: out, moved }
}

/** The same rename, on the KPI lines people have typed targets into. */
export function repairKpiIds(people) {
  let moved = 0
  const out = (people || []).map((person) => {
    const kpi = person && person.kpi
    const extra = Array.isArray(person?.extraObjectives) ? person.extraObjectives : null
    const nextExtra = extra && extra.some((id) => RENAMED_OBJECTIVES[id])
      ? [...new Set(extra.map((id) => RENAMED_OBJECTIVES[id] || id))]
      : null
    let nextKpi = null
    if (kpi) {
      for (const [oldId, newId] of Object.entries(RENAMED_OBJECTIVES)) {
        if (kpi[`obj-${oldId}`]) {
          nextKpi = nextKpi || { ...kpi }
          /*
           * The WEIGHT travels, the target does not. A weight is a share of a
           * card and means the same thing whatever the line measures; a target
           * of "150" meant 150% return and would read as 150% of projects
           * delivered on time, which is not a number that exists.
           */
          const { target, ...rest } = nextKpi[`obj-${oldId}`]
          void target
          delete nextKpi[`obj-${oldId}`]
          if (Object.keys(rest).length) nextKpi[`obj-${newId}`] = { ...(nextKpi[`obj-${newId}`] || {}), ...rest }
        }
      }
    }
    if (!nextKpi && !nextExtra) return person
    moved += 1
    return {
      ...person,
      ...(nextKpi ? { kpi: nextKpi } : {}),
      ...(nextExtra ? { extraObjectives: nextExtra } : {}),
    }
  })
  return { people: out, moved }
}

/**
 * Add any assignable-but-unmeasured entry the stored roster is missing.
 *
 * The roster travels with the plan, so a plan saved before "User" existed has
 * six people and IT in it and no way to reach the new entry — the seed only
 * applies to a plan that starts empty. Appending is safe: an id that is
 * already there is left exactly as the user has it.
 */
export function repairRoster(people) {
  const have = new Set((people || []).map((p) => p && p.id))
  const missing = ASSIGNEE_ONLY.filter((p) => !have.has(p.id))
  return { people: [...(people || []), ...missing], added: missing.length }
}

/**
 * Objectives whose unit changed, and the repair that follows from it.
 *
 * A target typed against one unit is meaningless in another. When objectives 4
 * and 5 stopped being weighed in hours and started counting deliverables, a
 * stored "400" stopped meaning 400 hours and started reading as 400 dashboards
 * — a number nobody chose, on a card somebody will be appraised against.
 *
 * The stored value cannot be converted, because there is no conversion: hours
 * are not dashboards. So it is dropped and the line goes back to stating what
 * the register actually shows, which is the only figure that is true.
 *
 * WEIGHTS are kept. A weight is a share of the card and means the same thing
 * whatever the line is measured in.
 */
export const REUNITED_OBJECTIVES = ['efficiency', 'ai_automation', 'financial', 'delivery']

export function repairTargetUnits(people) {
  const lineIds = new Set(REUNITED_OBJECTIVES.map((id) => `obj-${id}`))
  let cleared = 0
  const out = (people || []).map((p) => {
    const kpi = p && p.kpi
    if (!kpi) return p
    let touched = false
    const next = {}
    for (const [lineId, entry] of Object.entries(kpi)) {
      if (lineIds.has(lineId) && entry && entry.target != null) {
        const { target, ...rest } = entry
        void target
        touched = true
        cleared++
        // Keep the weight if there is one; drop the entry entirely if the
        // target was all it held.
        if (Object.keys(rest).length) next[lineId] = rest
      } else {
        next[lineId] = entry
      }
    }
    return touched ? { ...p, kpi: next } : p
  })
  return { people: out, cleared }
}

/**
 * Apply any repair this state has not had yet, and stamp it.
 *
 * Lives here rather than in storage so it can be tested directly — and so the
 * browser cache, a scenario file and a scenario read back out of the database
 * all go through the one path.
 */
export function repairState(s) {
  if (!s || !Array.isArray(s.projects) || s.repair === REPAIR_VERSION) {
    return { ...s, repair: REPAIR_VERSION }
  }
  const { projects: owned } = repairOwnership(s.projects, s.people)
  const { projects: renamed } = repairObjectiveIds(owned)
  const { projects: based } = repairBaselineDates(renamed)
  const { projects } = repairHeldFinish(based)
  const { people: retargeted } = repairTargetUnits(s.people)
  const { people: rostered } = repairRoster(retargeted)
  const { people } = repairKpiIds(rostered)
  const { settings } = repairAsOfDate(s.settings)
  return {
    ...s, projects, people, settings, repair: REPAIR_VERSION,
  }
}

export function setRolesPatch(project, person, roles) {
  const list = Array.isArray(project.contributors) ? project.contributors : []
  const clean = ROLE_ORDER.filter((r) => (roles || []).includes(r))
  const at = list.findIndex((c) => c.person === person)

  if (!clean.length) return { contributors: list.filter((c) => c.person !== person) }
  const next = { ...(at >= 0 ? list[at] : {}), person, roles: clean }
  if (at < 0) return { contributors: [...list, next] }
  const out = [...list]
  out[at] = next
  return { contributors: out }
}

/**
 * Everyone who can be credited on a project, with the roles behind their share.
 *
 * A PIC who is not in the contributor list is shown holding `assignee`,
 * because that is the weight projectShares gives them — the panel would
 * otherwise show an owner with no role and a share out of nowhere.
 *
 * One source for the split, so the dialog, the scorecard and the workbook
 * cannot describe the same project differently.
 */
export function creditRows(project, shares) {
  const list = Array.isArray(project.contributors) ? project.contributors : []
  const rows = list.map((c) => ({
    person: c.person,
    roles: ROLE_ORDER.filter((r) => (c.roles || []).includes(r)),
    implied: false,
  }))
  if (project.pic && !rows.some((r) => r.person === project.pic)) {
    rows.push({ person: project.pic, roles: ['assignee'], implied: true })
  }
  return rows
    .map((r) => ({ ...r, share: (shares && shares[r.person]) || 0 }))
    .sort((a, b) => b.share - a.share || a.person.localeCompare(b.person))
}

/** "Gun dev 77% · Kade qa 23%" — the same line on screen and in the workbook. */
export function creditSummary(project, shares, nameOf = (id) => id) {
  return creditRows(project, shares)
    .map((r) => `${nameOf(r.person)} ${r.roles.join('/') || '—'} ${Math.round(r.share * 100)}%`)
    .join(' · ')
}

/** Blank row for the "add project" action. */
export function newProject(seq) {
  return {
    key: `NEW-${seq}`,
    // When it was added, so the register can keep it in front of the person
    // filling it in. A blank row has no saving hours, and the table sorts by
    // saving hours — so without this it appears at the bottom of eighty-six
    // rows, which reads as nothing having happened.
    addedAt: Date.now(),
    jiraKey: null,
    summary: 'New project',
    program: '',
    team: 'Accounting',
    subTeam: '',
    objective: 'process_automation',
    savingHours: null,
    hc: null,
    savingEstimated: true,
    manday: 0,
    mandayEstimated: true,
    // Capital and operating cost. Null, not zero: nothing has been entered yet.
    // Present on every new row so a project added in the app carries the same
    // shape as one loaded from a scenario file.
    capex: null,
    capexNote: '',
    opex: [],
    tasks: [],
    comment: '',
    status: 'Not Start',
    srcStatus: null,
    start: null,
    due: null,
    /*
     * What actually happened, kept apart from what was planned.
     *
     * `start` and `due` are the plan and must not be edited to match reality —
     * overwriting them is how a portfolio comes to look as though everything
     * landed on time. These two are filled from Jira, or by hand where there
     * is no ticket.
     */
    actualStart: null,
    actualEnd: null,
    /*
     * THE FINISH DATE, HELD BY HAND.
     *
     * Jira's resolution date is the moment somebody dragged the last card, and
     * that is not always the day the work landed: a project delivered in March
     * and closed off in June reads as three months late through no fault of
     * anybody's. Jira will not let that date be corrected, so the register has
     * to be able to hold its own — and say that it is doing so.
     *
     * Held means the sync leaves this ONE field alone. Everything else about
     * the project still follows Jira, and nothing is held unless somebody has
     * deliberately said so, project by project.
     */
    actualEndPinned: false,
    /*
     * The date first committed to, and how many times it has been moved since.
     *
     * Everybody gets ONE re-plan per project, after requirement gathering:
     * a date set before anybody has seen the requirement is a guess, and
     * holding somebody to a guess teaches them to pad the next one. The
     * re-plan resets the commitment and costs nothing. A second move is drift.
     */
    baselineDue: null,
    replanCount: 0,
    replanNote: '',
    /*
     * When the work underneath runs past the committed date — usually because
     * another team held it up — this is where it now lands. Kept BESIDE the
     * commitment, never instead of it: the plan is what was agreed, and an
     * adjustment that quietly overwrote it would erase the fact of the delay.
     */
    adjustedDue: null,
    // The task that claimed the delay, so the bar can name its cause.
    adjustedCause: null,
    tasksTotal: 0,
    tasksDone: 0,
    assignee: null,
    pic: null,
    contributors: [],
    partners: [],
    deleted: false,
    commitLevel: 'watch',
    notes: '',
  }
}

/* ------------------------------------------------------------------ */
/* contribution                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve each contributor's share of one project.
 *
 * GROSS (creditPartners = false, the default): only the six scorecard owners
 * enter the denominator, so their shares sum to 1.0 and the team is credited
 * with the whole project. This is the right reading if the 3,000 hr target
 * holds the team accountable for delivered hours regardless of who writes the
 * code — partner devs are then a resource, not a claimant.
 *
 * NET (creditPartners = true): partner-team and outsource devs
 * (tao, buzz, fah, luem, fia, central-it, finance-it) enter the denominator
 * too, diluting the core shares. Core shares then sum to LESS than 1.0 and the
 * difference is hours the team cannot personally bank.
 *
 * The two readings differ by roughly 1,900 gross hours across 35 projects, so
 * which one management intends has to be settled explicitly rather than
 * assumed. Returns { shares, partnerShare }.
 */
export function projectShares(project, roleWeights = DEFAULT_ROLE_WEIGHTS, creditPartners = false, opts = {}) {
  // Only people who hold a scorecard can be credited. IT and other partner
  // teams can own delivery of a project without carrying its KPI.
  const owners = opts.owners
  const isOwner = (id) => !owners || owners.has(id)

  const raw = {}
  for (const c of project.contributors || []) {
    if (!c.person || !isOwner(c.person)) continue
    // A person's raw weight is their single strongest role on the project,
    // not the sum — holding both pm and dev does not double the claim.
    const best = Math.max(...c.roles.map((r) => roleWeights[r] ?? 0), 0)
    if (best > 0) raw[c.person] = Math.max(raw[c.person] ?? 0, best)
  }
  // A PIC with no contributor record still owns the project outright.
  if (project.pic && isOwner(project.pic) && raw[project.pic] === undefined) {
    raw[project.pic] = roleWeights.assignee ?? 0.6
  }

  /*
   * Nothing landed on a scorecard owner. Two different situations, and they
   * must not be treated alike:
   *
   * UNASSIGNED — the team lead absorbs it. They are accountable for the team's
   * overall KPI and these hours must not vanish.
   *
   * OWNED BY A PARTNER (IT, or the business user who built it themselves) —
   * nobody absorbs it. The team did not deliver it, so claiming its hours on
   * the lead's card would be claiming somebody else's work.
   */
  const outsourced = !!project.pic && !!opts.outside && opts.outside.has(project.pic)
  let fellBack = false
  if (!outsourced && Object.keys(raw).length === 0 && opts.fallbackPic && isOwner(opts.fallbackPic)) {
    raw[opts.fallbackPic] = roleWeights.assignee ?? 0.6
    fellBack = true
  }

  let partnerRaw = 0
  if (creditPartners) {
    for (const p of project.partners || []) {
      const roles = Array.isArray(p) ? [] : p.roles || []
      partnerRaw += Math.max(...roles.map((r) => roleWeights[r] ?? 0), 0)
    }
  }

  const coreTotal = Object.values(raw).reduce((a, b) => a + b, 0)
  const total = coreTotal + partnerRaw
  if (total <= 0) return { shares: {}, partnerShare: 0, fellBack: false }
  return {
    shares: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total])),
    partnerShare: partnerRaw / total,
    fellBack,
  }
}

/* ------------------------------------------------------------------ */
/* per-project derived values                                          */
/* ------------------------------------------------------------------ */

/**
 * A calendar date the app understands: YYYY-MM-DD, and a day that exists.
 *
 * The round trip is the point. Date.parse accepts "2026-02-31" and quietly
 * hands back the 3rd of March, so a typo in a spreadsheet would have become a
 * real date three days later and drawn a bar nobody planned.
 */
export const isDate = (v) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false
  const ms = Date.parse(`${v}T00:00:00Z`)
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === v
}

/** Whole days from a to b, positive when b is later. Null if either is absent. */
export function daysBetween(a, b) {
  if (!isDate(a) || !isDate(b)) return null
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)
}

/**
 * How a project ran against its plan.
 *
 * Deliberately says "unknown" rather than "on time" wherever a date is
 * missing: two thirds of the register has no actual dates yet, and defaulting
 * those to on-time would report a portfolio delivering perfectly.
 */
export function timelineOf(p, asOf) {
  const plannedStart = isDate(p.start) ? p.start : null
  const plannedEnd = isDate(p.due) ? p.due : null
  const actualStart = isDate(p.actualStart) ? p.actualStart : null
  // A finished project with no end date recorded ends at nothing; an
  // unfinished one is still running, which the bar draws up to today.
  const actualEnd = isDate(p.actualEnd) ? p.actualEnd : null
  const done = p.status === 'Done'
  const running = !!actualStart && !actualEnd && !done

  const startVariance = daysBetween(plannedStart, actualStart)
  const endVariance = daysBetween(plannedEnd, actualEnd)
  // Not finished and already past its due date is late NOW, whatever the
  // finish variance says — which is null, because there is no finish.
  const overdue = !!plannedEnd && !actualEnd && p.status !== 'Done' && plannedEnd < asOf
  const lateBy = endVariance != null ? endVariance : (overdue ? daysBetween(plannedEnd, asOf) : null)

  const state = actualEnd || done ? 'finished'
    : running ? 'running'
      : actualStart ? 'started'
        : 'not started'

  /*
   * Where the work now lands, when the tasks underneath run past the date that
   * was agreed. Only an adjustment if it is actually later — a task due before
   * the project's own date moves nothing.
   */
  const adjustedEnd = isDate(p.adjustedDue) && plannedEnd && p.adjustedDue > plannedEnd
    ? p.adjustedDue
    : null
  const adjustedBy = adjustedEnd ? daysBetween(plannedEnd, adjustedEnd) : null

  return {
    plannedStart,
    plannedEnd,
    adjustedEnd,
    adjustedBy,
    adjustedCause: adjustedEnd ? (p.adjustedCause || null) : null,
    tasksTotal: Number(p.tasksTotal) || 0,
    tasksDone: Number(p.tasksDone) || 0,
    actualStart,
    actualEnd,
    running,
    overdue,
    startVariance,
    endVariance,
    lateBy,
    state,
    plannedDays: daysBetween(plannedStart, plannedEnd),
    /*
     * Never negative. Work cannot have taken minus nine days — that only ever
     * meant the start lay after the date it was being measured to, which is a
     * date problem, not a duration. Reported as unknown rather than as a
     * number nobody can act on.
     */
    actualDays: (() => {
      const n = daysBetween(actualStart, actualEnd || (running ? asOf : null))
      return n == null || n < 0 ? null : n
    })(),
    // Only a project with both a plan and an outcome can be judged against it.
    comparable: !!plannedEnd && (!!actualEnd || overdue),
  }
}


/**
 * Did this project land within the tolerance?
 *
 * Null — not false — while there is nothing to judge. A project with no due
 * date, or one still running with time left, has not failed to be on time: it
 * has not been asked yet.
 */
export function onTimeOf(p, sprintDays = DEFAULT_SPRINT_DAYS) {
  const tl = p && p.timeline
  if (!tl || !tl.comparable || tl.lateBy == null) return null
  return tl.lateBy <= sprintDays
}

/**
 * The share of somebody's judged projects that landed on time.
 *
 * Null when none of their work can be judged yet, so somebody who has finished
 * nothing reads as "nothing to say" rather than as a zero — the same rule the
 * Timeline follows, and for the same reason.
 */
/**
 * What a person has committed to deliver, and by when.
 *
 * Objective 1 is a DATE KPI: every project somebody is PIC of, each with the
 * date they said it would land. Not a percentage handed down from above — the
 * percentage is only the roll-up. The substance is the list, because that is
 * what a person actually commits to and what a review actually discusses.
 *
 * By PIC, not by credited share. Somebody can hold a slice of a project they
 * do not run, and being asked for a delivery date on work you do not own is
 * how a KPI stops being taken seriously. Whoever the register names as PIC
 * owns the date.
 */
export function deliveryCommitments(
  personId,
  projects,
  sprintDays = DEFAULT_SPRINT_DAYS,
  maxDrift = DEFAULT_MAX_PROJECT_DRIFT,
) {
  return (projects || [])
    .filter((p) => p.pic === personId && isInPlan(p))
    .map((p) => {
      const tl = p.timeline || {}
      const met = onTimeOf(p, sprintDays)
      const drift = driftOf(p, maxDrift)
      return {
        driftDays: drift.days,
        driftShare: drift.share,
        driftAllowance: drift.allowance,
        plannedBackwards: drift.backwards,
        replans: drift.replans,
        replanned: drift.replanned,
        overReplanned: drift.overReplanned,
        baselineDue: drift.baselineDue,
        // Beyond what this project was allowed to move.
        drifted: drift.drifted,
        plannedDays: tl.plannedDays ?? null,
        key: p.key,
        jiraKey: p.jiraKey || null,
        summary: p.summary,
        // The date committed to, and the date it actually landed.
        due: tl.plannedEnd || null,
        actualEnd: tl.actualEnd || null,
        // Whether that date is the register's own, held against the sync.
        actualEndPinned: p.actualEndPinned === true,
        lateBy: tl.lateBy ?? null,
        running: !!tl.running,
        overdue: !!tl.overdue,
        status: p.status || '',
        savingHours: p.savingHours ?? null,
        /*
         * met === null is not a failure. A project with no committed date has
         * not been promised yet, and one still running with time left has not
         * been asked yet. Both are listed — a missing date is the thing this
         * objective most wants somebody to notice — and neither is scored.
         */
        met,
        judged: met !== null,
      }
    })
    .sort((a, b) => String(a.due || '9999').localeCompare(String(b.due || '9999')))
}

/**
 * How far one project drifted, as a share of the time it was given.
 *
 * Null while there is nothing to measure: no committed date, no planned
 * duration, or still running with time left. Null is not zero — a project
 * nobody has judged has not drifted, it has not been asked.
 */
/**
 * Move a project's committed finish date, and record what that cost.
 *
 * The FIRST move after a date exists is the free re-plan everybody gets once
 * the requirement is actually known — it re-baselines the commitment and is
 * not drift. Every move after that is counted, because a commitment that can
 * be rewritten indefinitely is not a commitment.
 *
 * Returns the patch to apply, so the register, the Timeline editor and any
 * future caller all record a date change the same way.
 */
export function replanPatch(project, nextDue) {
  const current = isDate(project?.due) ? project.due : null
  const next = isDate(nextDue) ? nextDue : null
  if (current === next) return { due: next }
  // No date before: this is the first commitment, not a re-plan.
  if (!current) return { due: next, baselineDue: project?.baselineDue || next, replanCount: project?.replanCount || 0 }
  return {
    due: next,
    baselineDue: project?.baselineDue || current,
    replanCount: (Number(project?.replanCount) || 0) + 1,
  }
}

/**
 * Hold a project's finish date against the sync, or let go of it.
 *
 * One door for the dialog, the timeline editor, the importer and any script,
 * so a held date always means the same thing and can always be found by the
 * same flag. Holding a blank is refused: there is nothing to protect, and a
 * project with no finish and no sync to give it one would simply stop.
 */
export function pinFinishPatch(project, date) {
  const next = isDate(date) ? date : (isDate(project?.actualEnd) ? project.actualEnd : null)
  if (!next) return { actualEndPinned: false }
  return { actualEnd: next, actualEndPinned: true }
}

/**
 * Let the sync have it back.
 *
 * The date itself is left as it stands rather than blanked: the next sync
 * overwrites it from Jira, and until then the register should show the last
 * thing somebody actually knew rather than a hole.
 */
export function unpinFinishPatch() {
  return { actualEndPinned: false }
}

export function driftOf(p, maxDrift = DEFAULT_MAX_PROJECT_DRIFT) {
  const tl = (p && p.timeline) || {}
  /*
   * Against the planned duration where there is one. A project with a due date
   * and no start has no length to measure against, so its drift is judged in
   * days against the allowance a whole sprint would give — the only honest
   * fallback that does not silently pass everything.
   */
  const span = tl.plannedDays && tl.plannedDays > 0 ? tl.plannedDays : null
  /*
   * The allowance is 20% of the planned length, but never less than a day.
   * A project planned to take one day has an allowance of 0.2 days, which no
   * calendar can express, and it reported a 210-day overrun as 21,000% — a
   * number that is arithmetically true and tells a reader nothing.
   */
  const allowance = span ? Math.max(1, span * maxDrift) : null
  /*
   * The allowance is known from the PLAN, so it is returned whether or not
   * there is yet anything to judge. It was computed after this guard once, and
   * every project still running therefore showed a blank where its allowance
   * should be — which is the number somebody most needs BEFORE the date slips,
   * not after. What cannot be known yet is what was spent against it, and that
   * stays null.
   */
  if (!tl.comparable || tl.lateBy == null) {
    const replansOnly = Number(p?.replanCount) || 0
    return {
      days: null,
      share: null,
      drifted: null,
      span,
      allowance,
      backwards: tl.plannedDays != null && tl.plannedDays < 0,
      replans: replansOnly,
      replanned: replansOnly > 0,
      overReplanned: replansOnly > 1,
      baselineDue: isDate(p?.baselineDue) ? p.baselineDue : null,
    }
  }
  const days = Math.max(0, tl.lateBy)
  const share = span ? days / span : null
  /*
   * A backwards plan is NOT scored. The comment beside it says it is data to
   * fix rather than performance to judge, and it has to actually behave that
   * way: counting it as drift would mark somebody down for a typo in a date.
   */
  const backwards = tl.plannedDays != null && tl.plannedDays < 0
  /*
   * One re-plan is free. Two is drift, whatever the dates then say: the
   * allowance exists so a guess made before requirement gathering can be
   * corrected once, not so a date can be walked forward all year.
   */
  const replans = Number(p?.replanCount) || 0
  const overReplanned = replans > 1
  const drifted = backwards
    ? null
    : (overReplanned
      || (allowance != null ? days > allowance + 1e-9 : days > DEFAULT_SPRINT_DAYS))
  return {
    days,
    share,
    drifted,
    span,
    allowance,
    // A start after its own due date: a plan nobody can deliver against.
    backwards,
    replans,
    // The free one, used. Worth showing: it is not a fault, but it is spent.
    replanned: replans > 0,
    overReplanned,
    baselineDue: isDate(p?.baselineDue) ? p.baselineDue : null,
  }
}

export function onTimeShare(rows, sprintDays = DEFAULT_SPRINT_DAYS) {
  const projects = (rows || []).map((r) => (r && r.p ? r.p : r))
  const judged = projects.filter((p) => onTimeOf(p, sprintDays) !== null)
  if (!judged.length) return { share: null, onTime: 0, judged: 0, late: 0 }
  const onTime = judged.filter((p) => onTimeOf(p, sprintDays)).length
  return { share: onTime / judged.length, onTime, judged: judged.length, late: judged.length - onTime }
}

export const isCounted = (p) => p.commitLevel === 'commit' || p.commitLevel === 'stretch'

/**
 * Is this project part of THIS year's plan at all? "Next year" and "Excluded"
 * stay in the register but contribute nothing to the team total, the objective
 * mix, the FTE column or any scorecard.
 */
export const isInPlan = (p) => !OUT_OF_PLAN.has(p.commitLevel)

/**
 * Does this project's objective contribute hours to the 3,000 pool?
 *
 * `outsideTeam` is stamped in computePlan and answers a prior question: is this
 * the team's project at all. A row whose PIC is IT or a business user stays in
 * the register — it is real work and worth tracking — but its hours are not
 * this team's commitment and cannot be counted toward its target.
 */
export const countsToPool = (p) => {
  if (p.outsideTeam) return false
  const o = OBJ_BY_ID[p.objective]
  return !!o?.countsToPool
}


export function projectRatio(p) {
  if (!p.manday || p.savingHours == null) return null
  return p.savingHours / p.manday
}

/**
 * Whole weekdays from start to due, inclusive. Used only to offer a first
 * effort estimate where none exists — public holidays are not modelled, which
 * is well inside the error of the estimate itself.
 */
export function workingDaysBetween(start, due) {
  if (!start || !due) return 0
  const a = new Date(`${start}T00:00:00Z`)
  const b = new Date(`${due}T00:00:00Z`)
  if (Number.isNaN(+a) || Number.isNaN(+b) || b < a) return 0
  const days = Math.round((b - a) / 86400000) + 1
  const weeks = Math.floor(days / 7)
  let out = weeks * 5
  for (let i = weeks * 7; i < days; i++) {
    const d = new Date(+a + i * 86400000).getUTCDay()
    if (d !== 0 && d !== 6) out++
  }
  return out
}

/**
 * FTE released by a project, DERIVED from its saving hours exactly the way the
 * source workbook derives its own column:
 *
 *   =IF([Saving hrs/mth]="TBC", 0, ROUND([Saving hrs/mth] / (22*8), 1))
 *
 * So this is not a second opinion about the workbook's number — it is the same
 * formula, with (22*8) exposed as the adjustable `hoursPerFteMonth`. Entering
 * saving hours produces the FTE, and moving the ratio moves every FTE at once.
 *
 * Rounded to one decimal per row, like the workbook. That rounding is why the
 * per-row figures sum to 23.9 while dividing the book total once gives 24.02 —
 * the app reports the first, because that is the number in the source.
 *
 * Unquantified saving hours give 0, not null: the workbook's IF does the same,
 * and a blank would not add up.
 */
export function fteFor(p, settings) {
  const rates = financeRates(settings)
  const hrs = monthlyHours(p, settings?.savingBasis)
  if (hrs == null || !(rates.hoursPerFteMonth > 0)) return 0
  // Excel ROUND is half-away-from-zero; JS Math.round is half-up, which differs
  // only on negatives. Saving hours are never negative, but be explicit.
  const v = hrs / rates.hoursPerFteMonth
  return Math.sign(v) * Math.round(Math.abs(v) * 10) / 10
}

/** Saving hours expressed per month, whatever basis the column is stated in. */
export const monthlyHours = (p, basis = 'monthly') => {
  // Anything that is not a finite number is "not quantified" rather than
  // propagated. The Projects tab cannot produce a NaN, but a hand-edited
  // scenario file or a bad row in the database can, and one NaN would otherwise
  // spread silently through every benefit, cost and total in the app.
  const h = Number(p.savingHours)
  if (p.savingHours == null || !Number.isFinite(h)) return null
  return h / (SAVING_BASIS[basis]?.monthsPerUnit ?? 1)
}

/**
 * The business case for one project, in money.
 *
 *   build cost      = mandays x the developer day rate             (one-off)
 *   CAPEX           = infrastructure, licences, hardware           (one-off)
 *   investment      = build cost + CAPEX                           (one-off)
 *   monthly benefit = saved hours/month x the accountant hour rate  (recurring)
 *   OPEX run-rate   = every operating cost line, per month          (recurring)
 *   net monthly     = monthly benefit - OPEX run-rate     (may be NEGATIVE)
 *   net benefit     = net monthly x horizon - investment  (over the horizon)
 *   ROI             = net benefit / investment
 *
 * Cost is NULL, never zero, when neither mandays nor CAPEX have been entered. A
 * project whose effort is unknown does not have a cost of nothing — it has an
 * unknown cost, and everything downstream of it must stay blank rather than
 * report an infinite return. That distinction is the whole reason this file has
 * so many null checks: the source workbook carries no effort data at all.
 *
 * A project that carries a CAPEX but no mandays DOES have a known cost, so it
 * does get a return.
 *
 * `breakEvenMandays` is the one figure that survives a missing effort estimate.
 * It needs only the saving hours and whatever cost IS known, so it can be shown
 * for every quantified project on day one: spend more than this many mandays
 * and the project loses money over the horizon. It is net of OPEX and of any
 * CAPEX already committed, so it can never claim room a running cost has
 * already eaten. `affordableMandays` is the same thing at the gate rather than
 * at zero return — the effort budget a project has to stay inside to be worth
 * committing.
 */
export function projectFinance(p, settings) {
  const r = financeRates(settings)
  const horizon = r.horizonMonths > 0 ? r.horizonMonths : DEFAULT_FINANCE.horizonMonths
  const gate = r.roiGate ?? DEFAULT_FINANCE.roiGate

  const hrs = monthlyHours(p, settings?.savingBasis)
  // The benefit that comes from the hours: time released, priced.
  const hoursMonthlyBenefit = hrs == null ? null : hrs * r.acctHourRate

  /*
   * The benefit stated directly in money.
   *
   * Not every return is time. A licence dropped, a penalty avoided, an interest
   * charge that stops — that is cash, and pricing it as hours would be a
   * fiction. Stated PER YEAR, because a saving of this kind is always quoted
   * that way, and divided down to the month here so both halves of the benefit
   * meet in the same unit.
   *
   * Additive, not an alternative: a project may release hours AND save cash,
   * and they are different money. Where the hours already ARE the saving this
   * must be left empty — nothing can tell a second benefit apart from the same
   * benefit counted twice.
   */
  const monetaryRaw = Number(p.monetaryBenefit)
  const monetaryBenefit = Number.isFinite(monetaryRaw) && monetaryRaw > 0 ? monetaryRaw : null
  const monetaryMonthlyBenefit = monetaryBenefit == null ? null : monetaryBenefit / 12

  const monthlyBenefit = hoursMonthlyBenefit == null && monetaryMonthlyBenefit == null
    ? null
    : (hoursMonthlyBenefit ?? 0) + (monetaryMonthlyBenefit ?? 0)
  const horizonBenefit = monthlyBenefit == null ? null : monthlyBenefit * horizon
  const annualBenefit = monthlyBenefit == null ? null : monthlyBenefit * 12
  // The saving expressed the way management already states it: whole people.
  // Hours ONLY — cash releases no capacity, and folding it in here would report
  // people freed up who are not.
  const fteReleased = hrs == null ? null : hrs / r.hoursPerFteMonth

  // Same discipline as the saving hours: only a finite positive number is an
  // effort estimate. Infinity or NaN is missing data, not an infinite cost.
  const mdRaw = Number(p.manday)
  const md = Number.isFinite(mdRaw) && mdRaw > 0 ? mdRaw : null
  const buildCost = md == null ? null : md * r.devDayRate

  const { capex, opexYear, opexRunRate } = projectCosts(p)
  const investment = totalInvestment(buildCost, capex)

  // The recurring side, net of the recurring cost. Deliberately allowed to go
  // negative: an automation whose licence costs more per month than the hours
  // it hands back is a real outcome and must read as one.
  const netMonthly = monthlyBenefit == null ? null : monthlyBenefit - opexRunRate
  const netHorizonBenefit = netMonthly == null ? null : netMonthly * horizon

  const netBenefit = netHorizonBenefit == null || investment == null
    ? null
    : netHorizonBenefit - investment
  const roi = investment == null || investment <= 0 || netHorizonBenefit == null
    ? null
    : (netHorizonBenefit - investment) / investment
  const payback = paybackMonths(investment, netMonthly)

  // Floored at zero: when the CAPEX alone already exceeds what the project ever
  // gives back, the honest answer is "no mandays at all clear it", not a
  // negative effort budget.
  const roomFor = (money) => (netHorizonBenefit == null || r.devDayRate <= 0
    ? null
    : Math.max(0, (money - (capex ?? 0)) / r.devDayRate))
  const breakEvenMandays = roomFor(netHorizonBenefit)
  const affordableMandays = netHorizonBenefit == null ? null : roomFor(netHorizonBenefit / (1 + gate))

  return {
    monthlyBenefit,
    annualBenefit,
    horizonBenefit,
    // The two halves, kept apart so every screen and every sheet can say which
    // part of the return is time and which is cash.
    hoursMonthlyBenefit,
    monetaryAnnualBenefit: monetaryBenefit,
    monetaryMonthlyBenefit,
    fteReleased,
    buildCost,
    capex,
    investment,
    opexYear,
    opexRunRate,
    netMonthly,
    netHorizonBenefit,
    netBenefit,
    roi,
    paybackMonths: payback,
    breakEvenMandays,
    affordableMandays,
  }
}

/**
 * Does this project clear Objective 1's return gate?
 *
 * The tolerance is not decoration. A project sized to hit the gate exactly
 * computes an ROI of 1.9999999999999998 against a gate of 2, and a bare `>=`
 * marks work that precisely meets the standard as failing it.
 */
export function gateStatus(roi, gate) {
  if (roi == null) return 'unknown'
  return roi >= gate - 1e-9 ? 'pass' : 'fail'
}

/* ------------------------------------------------------------------ */
/* rollups                                                             */
/* ------------------------------------------------------------------ */

/**
 * Full derived state for the whole plan. Everything the UI renders is computed
 * here so the dashboard, the people view and the export can never disagree.
 */
export function computePlan(state) {
  const s = {
    ...DEFAULT_SETTINGS,
    ...(state.settings || {}),
    // Nested, so a scenario saved before the financial model still gets every
    // rate rather than a half-populated object that divides by undefined.
    finance: { ...DEFAULT_FINANCE, ...(state.settings?.finance || {}) },
  }
  const rates = financeRates(s)
  /*
   * Asked once per computation, not read from the plan: "as of today" is a
   * question answered when somebody looks, and a stored answer is wrong the
   * next morning.
   */
  const asOf = asOfOf(s)
  const projects = state.projects || []
  /*
   * Sorted for display before anything else reads them, so the scorecards, the
   * grid on screen and every sheet in the workbook present the team in one
   * order rather than three. The order itself is a presentation choice and
   * lives in palette.js — a plan already saved should not have to be rewritten
   * to move two columns.
   */
  const byDisplayOrder = (a, b) => {
    const ia = PEOPLE_ORDER.indexOf(a.id)
    const ib = PEOPLE_ORDER.indexOf(b.id)
    return (ia < 0 ? PEOPLE_ORDER.length : ia) - (ib < 0 ? PEOPLE_ORDER.length : ib)
  }
  const allPeople = [...(state.people || [])].sort(byDisplayOrder)
  // Only scorecard holders can be credited; IT and other partner teams are
  // assignable as PIC but carry no KPI of their own.
  const people = allPeople.filter((p) => p.scorecard !== false)
  const ownerIds = new Set(people.map((p) => p.id))
  // IT and the business users: assignable as PIC, measured by nobody here.
  const outsideIds = new Set(allPeople.filter((p) => p.scorecard === false).map((p) => p.id))
  const shareOpts = {
    owners: ownerIds,
    outside: outsideIds,
    fallbackPic: ownerIds.has(s.fallbackPic) ? s.fallbackPic : null,
  }

  const perProject = projects.map((raw) => {
    /*
     * Sanitise once, here, so nothing downstream has to. A saving-hours or
     * manday cell that is not a finite number — from a hand-edited scenario
     * file or a bad row in the database — is MISSING data, not a quantity.
     * Left alone a single NaN propagates through the headline, every scorecard,
     * every money figure and the exported workbook, and it does so silently,
     * because every comparison against NaN is false.
     */
    const num = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))
    // Tasks are resolved HERE, at the one read boundary, so buildCost, the
    // tables, the scorecards, every rollup and the workbook all see the same
    // number and nothing downstream has to know tasks exist.
    const tasks = normalizeTasks(raw.tasks)
    const p = {
      ...raw,
      tasks,
      // Cleaned once, here, so nothing downstream has to guess whether it is
      // holding a list, a paragraph, or a paragraph with bullet glyphs in it.
      softBenefits: normalizeSoftBenefits(raw.softBenefits),
      savingHours: num(raw.savingHours),
      manday: resolveManday(raw),
      capex: num(raw.capex),
      comment: typeof raw.comment === 'string' ? raw.comment : '',
      /*
       * An objective that was renamed answers to its new name here, whether or
       * not this plan has been through the repair yet.
       *
       * Normalised at the read boundary rather than only in the migration,
       * because countsToPool decides from this id whether a project's hours
       * enter the team total: a row still naming `financial` would silently
       * drop out, and a KPI moving for no reason anybody can explain is the
       * worst kind of bug this model can have.
       */
      objective: RENAMED_OBJECTIVES[raw.objective] || raw.objective,
      objectives: Array.isArray(raw.objectives)
        ? [...new Set(raw.objectives.map((id) => RENAMED_OBJECTIVES[id] || id))]
        : raw.objectives,
      // A date is a YYYY-MM-DD string or nothing. Anything else — a stray
      // number from a spreadsheet, an empty string — is missing, not a date.
      actualStart: isDate(raw.actualStart) ? raw.actualStart : null,
      actualEnd: isDate(raw.actualEnd) ? raw.actualEnd : null,
      // Only ever true where there is a date to hold. A held blank is not a
      // correction, it is a project waiting for a sync that will never come.
      actualEndPinned: raw.actualEndPinned === true && isDate(raw.actualEnd),
      adjustedDue: isDate(raw.adjustedDue) ? raw.adjustedDue : null,
    }
    // Whose book is this on. Decided by the PIC and by the PIC alone, so the
    // answer is the same one a reader gets from the register's own column.
    p.outsideTeam = !!p.pic && outsideIds.has(p.pic)
    const { shares, partnerShare, fellBack } = projectShares(p, s.roleWeights, s.creditPartners, shareOpts)
    const fin = projectFinance(p, s)
    // The month grid lives here rather than in projectFinance so that every
    // value that function returns stays a scalar — the suites assert that each
    // one is null or finite, and an array would sail through that check.
    const costs = projectCosts(p)
    return {
      ...p,
      // Sanitised on the way out too, so the dialog, the export and the tables
      // all read the same normalised lines rather than whatever was stored.
      capexNote: costs.capexNote,
      opex: costs.opex,
      opexByMonth: costs.opexByMonth,
      shares,
      partnerShare,
      fellBack,
      ...fin,
      // Derived from the saving hours, not stored. `hc` below is the value the
      // import read out of the workbook and is kept only so the reconciliation
      // suite can prove the derivation reproduces it row for row.
      fte: fteFor(p, s),
      // Kept as a secondary diagnostic. The gate is now financial, but hours
      // per manday is still the quickest read on whether an estimate is sane.
      ratio: projectRatio(p),
      gate: gateStatus(fin.roi, rates.roiGate),
      poolHours: countsToPool(p) && isCounted(p) ? (p.savingHours ?? 0) : 0,
      pastDue: !!p.due && p.due < asOf && p.status !== 'Done',
      timeline: timelineOf(p, asOf),
    }
  })

  // ---- team totals -------------------------------------------------
  const commit = perProject.filter((p) => p.commitLevel === 'commit')
  const stretch = perProject.filter((p) => p.commitLevel === 'stretch')
  const watch = perProject.filter((p) => p.commitLevel === 'watch')

  const sumHours = (arr, poolOnly = true) =>
    arr.reduce((a, p) => a + ((poolOnly ? countsToPool(p) : true) ? (p.savingHours ?? 0) : 0), 0)

  const committedHours = sumHours(commit)
  const stretchHours = sumHours(stretch)
  const watchHours = sumHours(watch)
  const headlineHours = committedHours + (s.includeStretchInHeadline ? stretchHours : 0)

  // NAMING, deliberately: everything the user reads calls this column FTE,
  // because that is what it is — the workbook derives it as saving hours / 176
  // and it measures capacity released, not people employed. The STORED field
  // stays `hc`, here and in seed.json, and so do these totals keys. Renaming
  // the persisted field would invalidate every scenario already saved in
  // MongoDB — documents are stored as-is, with no migration step — and buy
  // nothing visible, since no user ever sees the field name.
  // Round per row, THEN add — the order the workbook uses. Dividing the book
  // total once instead gives 24.02 against the workbook's 23.9, and the whole
  // point of this column is that it ties out to the source.
  const sumFte = (arr) => Math.round(arr.reduce((a, p) => a + (p.fte || 0), 0) * 10) / 10
  const committedHC = sumFte(commit)
  const totalHC = sumFte(perProject.filter(isInPlan))

  // The book total — every project's saving hours, with no objective or
  // commit-level filtering applied. This must always reconcile to the source
  // workbook's own column sum, so it is what the dashboard leads with.
  const active = perProject.filter(isInPlan)
  const totalHours = active.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  const byStatus = {}
  for (const p of active) {
    const k = p.status || 'Unknown'
    byStatus[k] = (byStatus[k] || 0) + (p.savingHours ?? 0)
  }
  const doneHours = byStatus.Done || 0

  // Deferred to next year: kept on the record, deliberately outside the total.
  const nextYear = perProject.filter((p) => p.commitLevel === 'nextyear')
  const nextYearHours = nextYear.reduce((a, p) => a + (p.savingHours ?? 0), 0)

  /* ---- delivery against the plan ------------------------------------
   * Counted over rows that are IN PLAN and OURS. A schedule kept by IT or the
   * business is not this team's to answer for, and a deferred project has no
   * date this year to miss.
   */
  const timed = perProject.filter((p) => isInPlan(p) && !p.outsideTeam)
  const judged = timed.filter((p) => p.timeline.comparable)
  const lateRows = judged.filter((p) => (p.timeline.lateBy ?? 0) > 0)
  const timeliness = {
    planned: timed.filter((p) => p.timeline.plannedStart || p.timeline.plannedEnd).length,
    noDates: timed.filter((p) => !p.timeline.plannedStart && !p.timeline.plannedEnd).length,
    started: timed.filter((p) => p.timeline.actualStart).length,
    finished: timed.filter((p) => p.timeline.state === 'finished').length,
    running: timed.filter((p) => p.timeline.running).length,
    // Judged: has a due date and either finished or is already past it.
    judged: judged.length,
    onTime: judged.length - lateRows.length,
    late: lateRows.length,
    overdue: timed.filter((p) => p.timeline.overdue).length,
    // The average slip, over the rows that actually slipped — an average that
    // included the on-time ones would report a fortnight's delay as three days.
    avgSlip: lateRows.length
      ? Math.round(lateRows.reduce((a, p) => a + p.timeline.lateBy, 0) / lateRows.length)
      : null,
    worst: [...lateRows].sort((a, b) => b.timeline.lateBy - a.timeline.lateBy).slice(0, 5),
  }

  // Delivered by IT or by the business itself: on the register, off our book.
  // Reported so the difference between the two totals has a name.
  const outside = perProject.filter((p) => p.outsideTeam && isInPlan(p))
  const outsideHours = outside.reduce((a, p) => a + (p.savingHours ?? 0), 0)

  // Effort and the hours it bought, measured over the SAME projects. This used
  // to divide a commit-only numerator by a commit-plus-stretch denominator,
  // which understated the ratio by however much stretch effort existed.
  const ratioBase = perProject.filter((p) => isCounted(p) && countsToPool(p))
  const totalManday = ratioBase.reduce((a, p) => a + (p.manday || 0), 0)
  const ratioHours = ratioBase.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  const teamRatio = totalManday > 0 ? ratioHours / totalManday : null

  /* ---- the money view ------------------------------------------------
   * Benefit is summed over everything in plan, so it reconciles to the same
   * book the hours headline reports. Cost and ROI are summed ONLY over the
   * projects that actually carry an effort estimate — averaging a project with
   * a known cost against one with no cost at all would report a return the
   * team has not earned. `roiCoverage` says how much of the benefit that
   * subset represents, so a flattering ROI over 3% of the book cannot be
   * mistaken for the portfolio's.
   */
  /*
   * The BOOK's money, over every in-plan row including the ones IT or the
   * business owns. Deliberately: this block reconciles line for line to the
   * source workbook's own columns, and the workbook counts those rows. The
   * team's commitment is a narrower thing and is measured in hours above.
   *
   * Objective 1 at PERSON level is already narrower without any filtering here
   * — a project owned outside the team lands on no scorecard, so it enters
   * nobody's average return.
   */
  const inPlan = perProject.filter(isInPlan)
  const monthlyBenefit = inPlan.reduce((a, p) => a + (p.monthlyBenefit || 0), 0)
  // The same total, split by where it comes from.
  const hoursMonthlyBenefit = inPlan.reduce((a, p) => a + (p.hoursMonthlyBenefit || 0), 0)
  const monetaryAnnualBenefit = inPlan.reduce((a, p) => a + (p.monetaryAnnualBenefit || 0), 0)
  const annualBenefit = monthlyBenefit * 12
  const horizonBenefit = monthlyBenefit * rates.horizonMonths
  const fteReleased = inPlan.reduce((a, p) => a + (p.fteReleased || 0), 0)

  /*
   * `costed` is THE set that decides what enters the return, and it now keys on
   * the whole INVESTMENT rather than on mandays alone — a project bought
   * outright with CAPEX and no build effort has a perfectly well-known cost and
   * must earn a return like any other.
   *
   * Every figure below that feeds the ROI is summed over exactly this set, on
   * both sides. The `plan*` figures underneath it are the 2026 budget view —
   * every in-plan project's money whether or not it can be returned — and are
   * deliberately named apart so the two can never be confused for each other.
   */
  const costed = inPlan.filter((p) => p.investment != null && p.monthlyBenefit != null)
  const buildCost = costed.reduce((a, p) => a + (p.buildCost ?? 0), 0)
  const capex = costed.reduce((a, p) => a + (p.capex ?? 0), 0)
  const investment = costed.reduce((a, p) => a + p.investment, 0)
  const opexRunRate = costed.reduce((a, p) => a + p.opexRunRate, 0)
  const opexYear = costed.reduce((a, p) => a + p.opexYear, 0)
  const costedMonthlyBenefit = costed.reduce((a, p) => a + p.monthlyBenefit, 0)
  const costedNetMonthly = costedMonthlyBenefit - opexRunRate
  const costedNetHorizon = costedNetMonthly * rates.horizonMonths
  const netBenefit = costed.length ? costedNetHorizon - investment : null
  const portfolioRoi = investment > 0 ? (costedNetHorizon - investment) / investment : null
  const portfolioPayback = paybackMonths(costed.length ? investment : null, costedNetMonthly)

  // The budget view: what the plan spends, over everything in it. Summed with
  // an unknown treated as nothing rather than as null, because "the plan's
  // known CAPEX" is a meaningful figure while "the plan's CAPEX including the
  // ones nobody has entered" is not.
  const planMonthGrid = new Array(MONTHS_IN_YEAR).fill(0)
  for (const p of inPlan) {
    for (let m = 0; m < MONTHS_IN_YEAR; m++) planMonthGrid[m] += p.opexByMonth?.[m] || 0
  }
  const finance = {
    ...rates,
    monthlyBenefit,
    annualBenefit,
    horizonBenefit,
    // How the annual benefit divides: time released, and cash stated outright.
    hoursAnnualBenefit: hoursMonthlyBenefit * 12,
    monetaryAnnualBenefit,
    fteReleased,
    buildCost: costed.length ? buildCost : null,
    capex: costed.length ? capex : null,
    investment: costed.length ? investment : null,
    opexRunRate,
    opexYear,
    netMonthly: costed.length ? costedNetMonthly : null,
    netBenefit,
    roi: portfolioRoi,
    paybackMonths: portfolioPayback,
    costedCount: costed.length,
    // Whole-plan money, for the budget tables rather than for the return.
    planMandays: inPlan.reduce((a, p) => a + (p.manday || 0), 0),
    planBuildCost: inPlan.reduce((a, p) => a + (p.buildCost ?? 0), 0),
    planCapex: inPlan.reduce((a, p) => a + (p.capex ?? 0), 0),
    planInvestment: inPlan.reduce((a, p) => a + (p.investment ?? 0), 0),
    planOpexYear: inPlan.reduce((a, p) => a + (p.opexYear || 0), 0),
    planOpexRunRate: inPlan.reduce((a, p) => a + (p.opexRunRate || 0), 0),
    planOpexByMonth: planMonthGrid,
    // Share of the book's benefit that has a cost estimate behind it.
    roiCoverage: monthlyBenefit > 0 ? costedMonthlyBenefit / monthlyBenefit : 0,
    uncostedCount: inPlan.filter((p) => p.investment == null && p.savingHours != null).length,
    // Money that IS committed on projects whose benefit is still TBC. It cannot
    // enter a return — there is no benefit to divide — but it is real money and
    // silently dropping it would make the Summary disagree with the Projects
    // sheet, which prints the cost of every row.
    unreturnedCost: inPlan
      .filter((p) => p.investment != null && p.monthlyBenefit == null)
      .reduce((a, p) => a + p.investment, 0),
    unreturnedCount: inPlan.filter((p) => p.investment != null && p.monthlyBenefit == null).length,
  }

  // ---- per-person --------------------------------------------------
  const byPerson = people.map((person) => {
    const rows = perProject
      .map((p) => ({ p, share: p.shares[person.id] || 0 }))
      .filter((r) => r.share > 0)

    const counted = rows.filter((r) => isCounted(r.p))
    const hours = counted.reduce(
      (a, r) => a + (countsToPool(r.p) ? (r.p.savingHours ?? 0) * r.share : 0),
      0,
    )
    const commitHours = counted
      .filter((r) => r.p.commitLevel === 'commit')
      .reduce((a, r) => a + (countsToPool(r.p) ? (r.p.savingHours ?? 0) * r.share : 0), 0)
    const manday = counted.reduce((a, r) => a + (r.p.manday || 0) * r.share, 0)

    // Money, credited on exactly the same share AND the same filter as the
    // hours, so a person's benefit is identically their credited hours valued
    // at the accountant rate. check-financial asserts that identity.
    // Split the same way, so the FTE released stays a measure of TIME.
    const hoursMonthlyBenefit = counted.reduce(
      (a, r) => a + (countsToPool(r.p) ? (r.p.hoursMonthlyBenefit || 0) * r.share : 0), 0)
    const monetaryAnnualBenefit = counted.reduce(
      (a, r) => a + (countsToPool(r.p) ? (r.p.monetaryAnnualBenefit || 0) * r.share : 0), 0)
    const monthlyBenefit = counted.reduce(
      (a, r) => a + (countsToPool(r.p) ? (r.p.monthlyBenefit || 0) * r.share : 0),
      0,
    )
    // Cost is only ever summed over rows that carry BOTH a cost and a benefit.
    // Coercing an unknown cost to zero would divide a full portfolio benefit by
    // a partial cost and report a return nobody earned.
    //
    // Every one of these is credited on the SAME `r.share` and over the SAME
    // rows as the hours above, so a person's investment is their share of the
    // projects their hours were credited from — never a whole project's CAPEX
    // landing on one of five contributors.
    const costedRows = counted.filter((r) => countsToPool(r.p) && r.p.investment != null && r.p.monthlyBenefit != null)
    /*
     * The plain mean of the returns on the projects credited to this person.
     *
     * Every project counts once, whatever its size, which is what makes it a
     * reading on how well the work is chosen rather than on how big it is. The
     * portfolio return — total net benefit over total investment — is reported
     * beside it, because the two answer different questions and a small
     * project with a spectacular ratio moves this one a long way.
     */
    /*
     * Objective 1: the dates this person has committed to.
     *
     * Built from what they are PIC of rather than from their credited share —
     * a delivery date belongs to whoever runs the project.
     */
    const commitments = deliveryCommitments(person.id, perProject, s.sprintDays, s.maxProjectDrift)
    /*
     * The commitment, in two parts, as agreed:
     *
     *   - no single project may drift by more than its share of its own length;
     *   - and no more than a set share of what somebody HOLDS may drift at all.
     *
     * The denominator is everything they hold, not just what has been judged.
     * Measuring drift against only the finished work would let somebody with
     * one delivered project and nine unstarted ones read as 0%.
     */
    const held = commitments.length
    const driftedRows = commitments.filter((c) => c.drifted === true)
    const drift = {
      held,
      drifted: driftedRows.length,
      share: held ? driftedRows.length / held : null,
      limit: s.maxDriftedShare,
      perProjectLimit: s.maxProjectDrift,
      within: held ? driftedRows.length / held <= s.maxDriftedShare + 1e-9 : null,
      /*
       * The same limit said in projects rather than in percent.
       *
       * "No more than 15%" is not something anybody can hold themselves to
       * while they work; "no more than 3 of your 22" is. Floored, because a
       * limit rounded up is a limit that lets one more project through than
       * the rule allows: 4 of 22 is 18%, and the rule says 15%.
       */
      allowedCount: held ? Math.floor(held * s.maxDriftedShare + 1e-9) : 0,
      headroom: held ? Math.floor(held * s.maxDriftedShare + 1e-9) - driftedRows.length : null,
      // How many are actually measurable yet — the rest have no date, or are
      // not due. The share is still taken over everything held.
      judged: commitments.filter((c) => c.drifted !== null).length,
      undated: commitments.filter((c) => !c.due).length,
      worst: [...driftedRows].sort((a, b) => (b.driftShare ?? 0) - (a.driftShare ?? 0)).slice(0, 5),
      // Plans that end before they start. Data to fix, not performance to
      // judge, so it is counted separately and never scored.
      backwards: commitments.filter((c) => c.plannedBackwards).length,
      // The free re-plan: how many have used theirs, and how many went past it.
      replanned: commitments.filter((c) => c.replanned).length,
      overReplanned: commitments.filter((c) => c.overReplanned).length,
    }
    const delivery = onTimeShare(commitments.filter((c) => c.judged).map((c) => ({ timeline: { comparable: true, lateBy: c.lateBy } })), s.sprintDays)
    const roiRows = costedRows.filter((r) => r.p.roi != null)
    const avgProjectRoi = roiRows.length
      ? roiRows.reduce((a, r) => a + r.p.roi, 0) / roiRows.length
      : null
    const buildCost = costedRows.reduce((a, r) => a + (r.p.buildCost ?? 0) * r.share, 0)
    const capex = costedRows.reduce((a, r) => a + (r.p.capex ?? 0) * r.share, 0)
    const investment = costedRows.reduce((a, r) => a + r.p.investment * r.share, 0)
    const opexRunRate = costedRows.reduce((a, r) => a + r.p.opexRunRate * r.share, 0)
    const opexYear = costedRows.reduce((a, r) => a + r.p.opexYear * r.share, 0)
    const costedBenefit = costedRows.reduce((a, r) => a + r.p.horizonBenefit * r.share, 0)

    /*
     * How a project's work lands on the objectives it serves.
     *
     * One project can answer to several, so the ONLY thing that keeps it from
     * being counted twice is that each objective is measured in a different
     * unit:
     *   - hours go to the hours objective, and to that one alone. Every saving
     *     hour in the plan lands there whatever else the project is tagged to,
     *     because a dashboard that removes eight hours of manual work has
     *     removed eight hours of manual work;
     *   - money is those same hours priced, plus any cash stated outright, and
     *     it is the money OBJECTIVE's figure — not a second helping of hours;
     *   - a counted objective accrues one per project, not its hours;
     *   - a milestone objective accrues neither. Its projects still give their
     *     hours to the hours objective.
     */
    const byObjective = {}
    const benefitByObjective = {}
    const countByObjective = {}
    for (const r of counted) {
      const hrs = (r.p.savingHours ?? 0) * r.share
      const money = (r.p.monthlyBenefit || 0) * r.share * 12
      if (HOURS_OBJECTIVE) byObjective[HOURS_OBJECTIVE] = (byObjective[HOURS_OBJECTIVE] || 0) + hrs
      // Annualised, because a yearly benefit is the number a business case is
      // argued in. The scorecard's Objective 1 target reads this map.
      if (MONEY_OBJECTIVE) {
        benefitByObjective[MONEY_OBJECTIVE] = (benefitByObjective[MONEY_OBJECTIVE] || 0) + money
      }
      for (const id of projectObjectives(r.p)) {
        if (OBJ_BY_ID[id]?.measure !== 'count') continue
        // A deliverable is not divisible: two people credited on one dashboard
        // have each delivered a dashboard, not half of one.
        countByObjective[id] = (countByObjective[id] || 0) + 1
      }
    }

    // keep objective order stable (by guideline number), not by discovery order
    return {
      ...person,
      projectCount: rows.length,
      countedCount: counted.length,
      missingSaving: rows.filter((r) => r.p.savingHours == null).length,
      // Personal credit — this person's own share of their own projects.
      hours,
      commitHours,
      manday,
      byObjective,
      benefitByObjective,
      countByObjective,
      avgProjectRoi,
      roiRowCount: roiRows.length,
      onTimeShare: delivery.share,
      onTimeCount: delivery.onTime,
      onTimeJudged: delivery.judged,
      onTimeLate: delivery.late,
      commitments,
      drift,
      // Worth its own figure: a project somebody owns with no date on it is
      // the gap this objective exists to close.
      undatedCount: commitments.filter((c) => !c.due).length,
      monthlyBenefit,
      hoursMonthlyBenefit,
      monetaryAnnualBenefit,
      buildCost: costedRows.length ? buildCost : null,
      capex: costedRows.length ? capex : null,
      investment: costedRows.length ? investment : null,
      opexRunRate,
      opexYear,
      costedBenefit: costedRows.length ? costedBenefit : null,
      // The benefit those rows actually give back, after their running cost.
      costedNetBenefit: costedRows.length ? costedBenefit - opexRunRate * rates.horizonMonths : null,
      costedCount: costedRows.length,
      rows,
    }
  })

  /*
   * A figure typed over the calculated one, applied BEFORE the team is summed.
   *
   * The lead's card is the sum of the others, and that has to keep being true
   * of what those cards actually say — otherwise overriding somebody would
   * leave the lead quietly disagreeing with the people it aggregates. The
   * lead's own override is applied later, to the aggregate.
   */
  const byPersonShown = byPerson.map((p) => (p.aggregatesTeam === true
    ? { ...p, calcHours: p.hours, calcMonthlyBenefit: p.monthlyBenefit, overridden: false, hoursOverridden: false, moneyOverridden: false }
    : applyPersonOverride(p, p)))

  /* ---- the team lead's scorecard is the TEAM's scorecard ------------- */
  // A lead flagged aggregatesTeam is measured on everything the team delivers,
  // not just their own slice. Their figures are built by summing the others'
  // rather than re-deriving from projects, so the lead's number is provably
  // the sum of the team's and the two can never disagree.
  /*
   * Every member's card is built BEFORE the team is summed.
   *
   * The lead's figure is the sum of the cards it aggregates, and those cards
   * state whatever their targets say. Summing the register instead would leave
   * the lead disagreeing with the people underneath it the moment one of them
   * typed a target.
   */
  const cardOf = (person, byObj, benefitByObj, rows, countByObj = {}, ratio = null) => {
    // An objective is held when it carries a figure OR when a project serves
    // it — a counted objective has no hours behind it, so presence in the
    // portfolio is what puts it on the card.
    const derived = OBJECTIVE_ORDER.filter((id) => (byObj[id] || 0) > 0
      || (countByObj[id] || 0) > 0
      // The return is worked out over EVERY project, so anyone carrying any
      // project is measured on it — it is the one objective nothing has to be
      // tagged to, because every project is already in it.
      || id === RATIO_OBJECTIVE
      || rows.some((r) => servesObjective(r.p, id)))
    const added = (Array.isArray(person.extraObjectives) ? person.extraObjectives : [])
      .filter((id) => OBJ_BY_ID[id] && !derived.includes(id))
    const objectives = OBJECTIVE_ORDER.filter((id) => derived.includes(id) || added.includes(id))
    const withObjectives = { ...person, objectives }
    const lines = scorecardWeights(withObjectives, s, byObj, benefitByObj, countByObj, ratio)
      .map((l) => ({ ...l, manual: !!l.objective && added.includes(l.objective) }))
    return {
      derived, added, objectives, withObjectives, lines,
      stated: statedHours(lines),
      statedByObjective: statedByObjective(lines),
    }
  }

  const memberCards = new Map()
  for (const p of byPersonShown) {
    if (p.aggregatesTeam === true) continue
    // Their own average return, so objective 1 opens at what they are carrying.
    memberCards.set(p.id, cardOf(p, p.byObjective, p.benefitByObjective, p.rows, p.countByObjective,
      p.avgProjectRoi ?? null))
  }

  // The lead's own personal share has no card of its own, so it enters the
  // team figure as the register states it.
  const teamHours = byPersonShown.reduce(
    (a, p) => a + (p.aggregatesTeam === true ? p.hours : memberCards.get(p.id).stated), 0)
  const teamManday = byPersonShown.reduce((a, p) => a + p.manday, 0)
  const teamMonthlyBenefit = byPersonShown.reduce((a, p) => a + p.monthlyBenefit, 0)
  const teamHoursMonthlyBenefit = byPersonShown.reduce((a, p) => a + (p.hoursMonthlyBenefit || 0), 0)
  const teamMonetaryAnnualBenefit = byPersonShown.reduce((a, p) => a + (p.monetaryAnnualBenefit || 0), 0)
  const teamBuildCost = byPersonShown.reduce((a, p) => a + (p.buildCost || 0), 0)
  const teamCapex = byPersonShown.reduce((a, p) => a + (p.capex || 0), 0)
  const teamInvestment = byPersonShown.reduce((a, p) => a + (p.investment || 0), 0)
  const teamOpexRunRate = byPersonShown.reduce((a, p) => a + (p.opexRunRate || 0), 0)
  const teamOpexYear = byPersonShown.reduce((a, p) => a + (p.opexYear || 0), 0)
  const teamCostedBenefit = byPersonShown.reduce((a, p) => a + (p.costedBenefit || 0), 0)
  const teamCostedCount = byPersonShown.reduce((a, p) => a + p.costedCount, 0)
  const teamByObjective = {}
  const teamBenefitByObjective = {}
  const teamCountByObjective = {}
  for (const p of byPersonShown) {
    // A member contributes what their CARD states; the lead's own personal
    // share has no card of its own, so it contributes what the register says.
    // Without this the lead's card ignored a target a member had typed and the
    // two disagreed by exactly that edit.
    const contributes = p.aggregatesTeam === true
      ? p.byObjective
      : memberCards.get(p.id).statedByObjective
    for (const [k, v] of Object.entries(contributes)) teamByObjective[k] = (teamByObjective[k] || 0) + v
    for (const [k, v] of Object.entries(p.benefitByObjective)) {
      teamBenefitByObjective[k] = (teamBenefitByObjective[k] || 0) + v
    }
    for (const [k, v] of Object.entries(p.countByObjective || {})) {
      teamCountByObjective[k] = (teamCountByObjective[k] || 0) + v
    }
  }
  const teamCounted = perProject.filter((p) => isCounted(p) && Object.keys(p.shares).length > 0)

  // The lead's average is over the whole book, each project once.
  const teamDelivery = onTimeShare(teamCounted, s.sprintDays)
  /*
   * The team's drift is the sum of its members' books, not a re-derivation
   * from the register: the lead's card has to be the cards it aggregates, or
   * the two disagree the moment somebody's PIC changes.
   */
  const teamDrift = (() => {
    const held = byPersonShown.filter((x) => !x.aggregatesTeam)
      .reduce((a, x) => a + (x.drift?.held || 0), 0)
    const drifted = byPersonShown.filter((x) => !x.aggregatesTeam)
      .reduce((a, x) => a + (x.drift?.drifted || 0), 0)
    return {
      held,
      drifted,
      share: held ? drifted / held : null,
      limit: s.maxDriftedShare,
      perProjectLimit: s.maxProjectDrift,
      within: held ? drifted / held <= s.maxDriftedShare + 1e-9 : null,
      // The limit said in projects, exactly as a person's own book says it.
      // The lead's card showed the TEAM's 39 held beside one person's allowance
      // of 2 for a moment, which is two different books in one sentence.
      allowedCount: held ? Math.floor(held * s.maxDriftedShare + 1e-9) : 0,
      headroom: held ? Math.floor(held * s.maxDriftedShare + 1e-9) - drifted : null,
      judged: byPersonShown.filter((x) => !x.aggregatesTeam)
        .reduce((a, x) => a + (x.drift?.judged || 0), 0),
      undated: byPersonShown.filter((x) => !x.aggregatesTeam)
        .reduce((a, x) => a + (x.drift?.undated || 0), 0),
      worst: byPersonShown.filter((x) => !x.aggregatesTeam)
        .flatMap((x) => x.drift?.worst || [])
        .sort((a, b) => (b.driftShare ?? 0) - (a.driftShare ?? 0))
        .slice(0, 5),
    }
  })()
  const teamRoiRows = teamCounted.filter((pr) => pr.roi != null && countsToPool(pr))
  const teamAvgRoi = teamRoiRows.length
    ? teamRoiRows.reduce((a, pr) => a + pr.roi, 0) / teamRoiRows.length
    : null

  const withScorecards = byPersonShown.map((p) => {
    const aggregates = p.aggregatesTeam === true
    // The lead's override lands on the AGGREGATE, which is what their card
    // shows; everyone else's has already been applied above.
    const led = aggregates
      ? applyPersonOverride(p, {
        hours: teamHours,
        monthlyBenefit: teamMonthlyBenefit,
        byObjective: teamByObjective,
        benefitByObjective: teamBenefitByObjective,
      })
      : null
    const scHours = aggregates ? led.hours : p.hours
    const scManday = aggregates ? teamManday : p.manday
    const scByObjective = aggregates ? led.byObjective : p.byObjective
    const scBenefitByObjective = aggregates ? led.benefitByObjective : p.benefitByObjective
    // The lead's portfolio is the whole in-plan book, so it re-adds to the
    // headline above it.
    const scRows = aggregates ? teamCounted.map((pr) => ({ p: pr, share: 1, owner: pr.pic })) : p.rows

    /*
     * Objectives are normally DERIVED — you hold one because you own a project
     * tagged with it, which is why the weights re-split by themselves when work
     * is reassigned. `extraObjectives` lets one be added by hand on top, for
     * committing someone to work that is not scoped yet.
     *
     * A hand-added objective has no projects behind it, so its target starts at
     * zero and it takes weight from the rest. That is the point of it, but it
     * does mean the card stops being purely a reflection of the project book —
     * so the two kinds are kept apart and every line says which it is.
     */
    const card = aggregates
      // The team's, for the card that IS the team's.
      ? cardOf(p, scByObjective, scBenefitByObjective, scRows, teamCountByObjective, teamAvgRoi)
      : memberCards.get(p.id)
    const derivedObjectives = card.derived
    const addedObjectives = card.added
    const objectives = card.objectives
    const withObjectives = { ...card.withObjectives, aggregatesTeam: aggregates }

    // Money on the same aggregation rule as the hours: the lead carries the
    // team's, everyone else carries their own.
    const scMonthlyBenefit = aggregates ? led.monthlyBenefit : p.monthlyBenefit
    const scHoursMonthlyBenefit = aggregates ? teamHoursMonthlyBenefit : (p.hoursMonthlyBenefit || 0)
    const scMonetaryAnnualBenefit = aggregates ? teamMonetaryAnnualBenefit : (p.monetaryAnnualBenefit || 0)
    const scCostedCount = aggregates ? teamCostedCount : p.costedCount
    const scBuildCost = scCostedCount > 0 ? (aggregates ? teamBuildCost : p.buildCost) : null
    const scCapex = scCostedCount > 0 ? (aggregates ? teamCapex : p.capex) : null
    const scInvestment = scCostedCount > 0 ? (aggregates ? teamInvestment : p.investment) : null
    const scOpexRunRate = aggregates ? teamOpexRunRate : p.opexRunRate
    const scOpexYear = aggregates ? teamOpexYear : p.opexYear
    const scCostedBenefit = scCostedCount > 0 ? (aggregates ? teamCostedBenefit : p.costedBenefit) : null
    // The monthly benefit of the costed rows alone, so netMonthly can subtract
    // OPEX from a benefit measured over the same projects.
    const scCostedMonthlyBenefit = scCostedBenefit == null ? null : scCostedBenefit / rates.horizonMonths
    // The credited benefit net of the credited running cost — the same shape as
    // the portfolio figure, over this person's share of the same rows.
    const scCostedNet = scCostedBenefit == null ? null : scCostedBenefit - scOpexRunRate * rates.horizonMonths
    const scFinance = {
      monthlyBenefit: scMonthlyBenefit,
      annualBenefit: scMonthlyBenefit * 12,
      horizonBenefit: scMonthlyBenefit * rates.horizonMonths,
      // Derived from the HOURS half of the benefit, not from scHours: scHours is
      // in whatever unit savingBasis names, and dividing a per-YEAR figure by a
      // per-MONTH divisor reported twelve times the FTE on the annual basis.
      // Cash is excluded on purpose — a licence saved frees nobody's time.
      fteReleased: rates.acctMonthRate > 0 ? (scHoursMonthlyBenefit / rates.acctMonthRate) : null,
      // The two halves of what this person is credited with.
      hoursAnnualBenefit: scHoursMonthlyBenefit * 12,
      monetaryAnnualBenefit: scMonetaryAnnualBenefit,
      buildCost: scBuildCost,
      capex: scCapex,
      investment: scInvestment,
      opexRunRate: scOpexRunRate,
      opexYear: scOpexYear,
      // Both sides over the SAME rows. scMonthlyBenefit spans every counted
      // pool row while scOpexRunRate spans the costed subset, so subtracting
      // one from the other mixed populations — the exact hazard the portfolio
      // figure avoids. Reported over the costed rows, or null when there are
      // none, rather than quietly blending the two.
      netMonthly: scCostedCount > 0 && scCostedMonthlyBenefit != null
        ? scCostedMonthlyBenefit - scOpexRunRate
        : null,
      netBenefit: scCostedNet == null ? null : scCostedNet - scInvestment,
      roi: scInvestment > 0 ? (scCostedNet - scInvestment) / scInvestment : null,
      paybackMonths: paybackMonths(scInvestment, scCostedCount > 0 && scCostedMonthlyBenefit != null ? scCostedMonthlyBenefit - scOpexRunRate : null),
      costedCount: scCostedCount,
    }

    /*
     * The ROI line's ACTUAL is the return this person is carrying right now.
     *
     * It is attached here rather than inside scorecardWeights because the
     * return is not known until the costs and benefits have been rolled up —
     * and being attached from the rolled-up figure is exactly what makes it
     * recalculate the moment a manday, a CAPEX or a saving hour changes.
     */
    /*
     * OBJECTIVE 1 IS DELIVERY, NOT RETURN.
     *
     * It used to be the average return on this person's projects, which
     * measured a Tech team on how profitable the work it was handed happened
     * to be. The return is still computed and still reported — on the Costs
     * sheet and on Effort_Return, where a cost question belongs — but what
     * this line asks is whether the work landed when it was said it would.
     */
    const driftFigure = aggregates ? teamDrift : (p.drift || {
      held: 0,
      drifted: 0,
      share: null,
      limit: s.maxDriftedShare,
      perProjectLimit: s.maxProjectDrift,
      allowedCount: 0,
      headroom: null,
      judged: 0,
      undated: 0,
      worst: [],
    })
    const delivered = aggregates ? teamDelivery : {
      share: p.onTimeShare ?? null,
      onTime: p.onTimeCount || 0,
      judged: p.onTimeJudged || 0,
      late: p.onTimeLate || 0,
    }
    const avgRoi = aggregates ? teamAvgRoi : (p.avgProjectRoi ?? null)
    const lines = card.lines.map((l) => (l.targetKind === 'percent' && !l.custom
      ? {
        ...l,
        // The average of the project returns, as asked for: every project
        // counts once. The portfolio return is kept beside it, because a
        // ฿5k project at 900% moves an average a long way and moves the
        // portfolio hardly at all.
        /*
         * A LIMIT, not a floor: this is the share of somebody's book that
         * drifted, and it is met by staying UNDER the number rather than over
         * it. Every other percentage line on a card reads the other way, so
         * the direction travels with the line rather than being assumed by
         * whatever renders it.
         */
        creditedRatio: driftFigure.share,
        lowerIsBetter: true,
        held: driftFigure.held,
        driftedCount: driftFigure.drifted,
        perProjectLimit: driftFigure.perProjectLimit,
        /*
         * The overall limit as a NUMBER OF PROJECTS, taken from the same book
         * as the held count beside it. A card that states a team's 39 and a
         * person's allowance of 2 in one sentence is not a rule anybody can
         * act on, and the two are different books.
         */
        allowedCount: driftFigure.allowedCount ?? 0,
        headroom: driftFigure.headroom ?? null,
        judgedDrift: driftFigure.judged ?? 0,
        // Whose book this line states: the person's own, or the team's.
        aggregatesTeam: aggregates,
        worstDrift: driftFigure.worst,
        // Kept beside it: how much actually landed on the day, which is the
        // question the drift limit exists to protect.
        onTime: delivered.onTime,
        judged: delivered.judged,
        lateCount: delivered.late,
        sprintDays: s.sprintDays,
        // The return, kept beside it: no longer the target, still worth seeing.
        portfolioRatio: scFinance.roi,
        avgRoi,
        roiRowCount: aggregates ? teamRoiRows.length : (p.roiRowCount || 0),
        creditedMoney: scFinance.annualBenefit,
        meetsTarget: driftFigure.share == null
          ? null
          : driftFigure.share * 100 <= Number(l.target) + 1e-9,
      }
      : l))

    return {
      ...withObjectives,
      /*
       * The headline is what the card states, so editing a target moves both
       * the total under the rows and the figure above them. With nothing typed
       * the two are identical, because every hours target starts at the
       * credited figure — this only diverges once somebody edits it.
       *
       * An explicit override still wins: that is a figure typed over the whole
       * card, not over one line of it.
       */
      scorecardHours: (aggregates ? led.hoursOverridden : p.hoursOverridden) ? scHours : card.stated,
      registerHours: scHours,
      // The average the CARD reads. For the lead that is the whole book, not
      // their personal slice — the sheet under it lists the whole book too.
      avgProjectRoi: avgRoi,
      ownAvgProjectRoi: p.avgProjectRoi ?? null,
      roiRowCount: aggregates ? teamRoiRows.length : (p.roiRowCount || 0),
      // What the register says, kept beside what the card claims: "revert" is
      // then a stored fact rather than a re-derivation that might not match.
      calcScorecardHours: aggregates ? led.calcHours : p.calcHours,
      calcAnnualBenefit: (aggregates ? led.calcMonthlyBenefit : p.calcMonthlyBenefit) * 12,
      hoursOverridden: aggregates ? led.hoursOverridden : p.hoursOverridden,
      moneyOverridden: aggregates ? led.moneyOverridden : p.moneyOverridden,
      overridden: aggregates ? led.overridden : p.overridden,
      scorecardManday: scManday,
      scorecardRows: scRows,
      scorecardCount: scRows.length,
      byObjective: scByObjective,
      benefitByObjective: scBenefitByObjective,
      finance: scFinance,
      // Kept so a chart can show "your own projects" beside the team figure.
      // `byObjective` above is the SCORECARD map, which for the lead is the
      // whole team — anything that stacks per-person bars must use this one or
      // the lead's bar repeats everybody else's.
      ownByObjective: p.byObjective,
      // What this person's own projects actually credit them. Their own share
      // of the real book, never the typed-over figure — the context line beside
      // the headline exists precisely to say what the register says.
      ownHours: p.calcHours ?? p.hours,
      ownCount: p.countedCount,
      ratio: scManday > 0 ? scHours / scManday : null,
      derivedObjectives,
      addedObjectives,
      // Which objectives are still available to add by hand.
      addableObjectives: OBJECTIVE_ORDER.filter((id) => !objectives.includes(id)),
      kpiLines: lines,
      // What the targets on the card add up to, so the card can state its own
      // sum rather than leaving it to be read off four separate rows.
      kpiTotals: kpiTargetTotals(lines),
      kpiHiddenLines: hiddenLines(withObjectives, s, scByObjective, scBenefitByObjective,
        aggregates ? teamCountByObjective : (p.countByObjective || {})),
      countByObjective: aggregates ? teamCountByObjective : (p.countByObjective || {}),
    }
  })

  // ---- partner leakage ---------------------------------------------
  // Hours inside the committed pool that the six owners cannot personally
  // bank because a partner/outsource dev builds them.
  const partnerHours = perProject
    .filter((p) => isCounted(p) && countsToPool(p))
    .reduce((a, p) => a + (p.savingHours ?? 0) * (p.partnerShare || 0), 0)
  const bankableHours = byPerson.reduce((a, p) => a + p.hours, 0)
  // Hours on counted, pool-eligible projects with nobody credited at all.
  const orphanHours = perProject
    .filter((p) => isCounted(p) && countsToPool(p) && Object.keys(p.shares).length === 0)
    .reduce((a, p) => a + (p.savingHours ?? 0), 0)
  // Hours that reached the team lead only because no scorecard owner held them.
  const fallbackHours = perProject
    .filter((p) => isCounted(p) && countsToPool(p) && p.fellBack)
    .reduce((a, p) => a + (p.savingHours ?? 0), 0)
  const fallbackCount = perProject.filter((p) => p.fellBack).length

  // ---- data-quality ------------------------------------------------
  const quality = {
    total: projects.length,
    missingSaving: projects.filter((p) => p.savingHours == null).length,
    missingPic: projects.filter((p) => !p.pic).length,
    estimatedManday: projects.filter((p) => p.mandayEstimated).length,
    // What actually blocks the money view: a project can be marked "not an
    // estimate" and still carry no cost at all, which the flag alone misses.
    // Keyed on the whole investment, so a project bought with CAPEX and no
    // build effort counts as costed — it is, and it gets a return.
    uncosted: perProject.filter((p) => isInPlan(p) && p.savingHours != null && p.investment == null).length,
    deleted: projects.filter((p) => p.deleted).length,
    pastDue: perProject.filter((p) => p.pastDue).length,
    pastDueHours: perProject
      .filter((p) => p.pastDue && isCounted(p) && countsToPool(p))
      .reduce((a, p) => a + (p.savingHours ?? 0), 0),
  }

  /* ---- objective mix -------------------------------------------------
   *
   * Two different questions, so two different maps.
   *
   * `byObjective` answers the KPI question and follows the same rule as every
   * scorecard: all the hours sit on the hours objective, because that is the
   * one measured in hours. It is what a target is checked against.
   *
   * `mixByObjective` answers "where does the work sit", splitting the hours by
   * the objective each project is primarily tagged to. It is for the chart,
   * and it is NOT a set of targets — the two would otherwise be read as the
   * same thing and one of them would be wrong.
   */
  const byObjective = {}
  const mixByObjective = {}
  const countByObjective = {}
  /*
   * Both maps are the TEAM's, so both drop what the team does not own. An
   * objective is a KPI: a dashboard IT built is not our objective-4 delivery,
   * and hours the business released for itself are not our objective 2. The
   * book that includes them is `totals.totalHours`, with the difference named
   * in `totals.outsideHours`.
   */
  for (const p of perProject.filter((x) => isCounted(x) && !x.outsideTeam)) {
    const hrs = p.savingHours ?? 0
    if (HOURS_OBJECTIVE) byObjective[HOURS_OBJECTIVE] = (byObjective[HOURS_OBJECTIVE] || 0) + hrs
    mixByObjective[p.objective] = (mixByObjective[p.objective] || 0) + hrs
    for (const id of projectObjectives(p)) {
      if (OBJ_BY_ID[id]?.measure === 'count') countByObjective[id] = (countByObjective[id] || 0) + 1
    }
  }

  // ---- concentration ------------------------------------------------
  const ranked = [...perProject]
    .filter((p) => isCounted(p) && countsToPool(p))
    .sort((a, b) => (b.savingHours ?? 0) - (a.savingHours ?? 0))
  const top2 = ranked.slice(0, 2).reduce((a, p) => a + (p.savingHours ?? 0), 0)

  return {
    // The effective as-of date travels with the plan, so every screen and the
    // workbook say the same day rather than each asking the clock again.
    settings: { ...s, asOfDate: asOf },
    projects: perProject,
    people: withScorecards,
    // Objective 1's money view: the two rates, and the portfolio's cost,
    // benefit and return computed from them.
    finance,
    totals: {
      committedHours,
      stretchHours,
      watchHours,
      headlineHours,
      target: s.targetHours,
      coverage: s.targetHours > 0 ? headlineHours / s.targetHours : 0,
      gap: headlineHours - s.targetHours,
      totalManday,
      teamRatio,
      failingGate: perProject.filter((p) => isCounted(p) && p.gate === 'fail').length,
      top2Share: headlineHours > 0 ? top2 / headlineHours : 0,
      top2,
      topProjects: ranked.slice(0, 5),
      // The gross-to-bankable bridge — the gap between what the team is
      // targeted on and what its six scorecards can actually add up to.
      partnerHours,
      orphanHours,
      fallbackHours,
      fallbackCount,
      fallbackPic: shareOpts.fallbackPic,
      bankableHours,
      bankableCoverage: s.targetHours > 0 ? bankableHours / s.targetHours : 0,
      committedHC,
      totalHC,
      teamHours,
      totalHours,
      totalCoverage: s.targetHours > 0 ? totalHours / s.targetHours : 0,
      byStatus,
      nextYearHours,
      nextYearCount: nextYear.length,
      timeliness,
      outsideHours,
      outsideCount: outside.length,
      doneHours,
      doneCoverage: s.targetHours > 0 ? doneHours / s.targetHours : 0,
    },
    byObjective,
    mixByObjective,
    countByObjective,
    quality,
    // Everyone assignable as PIC, including partner teams like IT that hold no
    // scorecard. Dropdowns read this; scorecards read `people`.
    assignees: allPeople,
    // Blocks saving while any scorecard is off 100%.
    invalid: invalidScorecards(withScorecards),
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export const fmtHours = (n) =>
  n == null ? '—' : Math.abs(n) >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1)

export const fmtRatio = (n) => (n == null ? '—' : n.toFixed(1))

export const fmtPct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`)

export const personById = (people, id) => people.find((p) => p.id === id)
