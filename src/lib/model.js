import { OBJ_BY_ID, OBJECTIVES, OUT_OF_PLAN } from './palette.js'

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
  financial: 1,
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
 * `hoursPerFteMonth` is not a guess. The source workbook carries its own HC
 * column beside the saving hours, and across the book 4,146.4 saving hrs/month
 * sit against 23.9 HC — 173.5 hours per HC per month. That is 2,080/12, the
 * standard full-time month, and it means this app divides the same way
 * management already does.
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
  // Hours in a full-time month (2,080/12). Not a guess: the source workbook's
  // own HC column implies 173.5 (4,146.4 saving hrs against 23.9 HC), so this
  // is management's own divisor.
  hoursPerFteMonth: 173.3,
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
 * Months for a project's monthly benefit to repay its build cost.
 * Null when either side is unknown — an unknown payback is not a fast one.
 */
export function paybackMonths(buildCost, monthlyBenefit) {
  if (buildCost == null || monthlyBenefit == null || monthlyBenefit <= 0) return null
  return buildCost / monthlyBenefit
}

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
  asOfDate: '2026-08-07',
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
    default: return 'hours'
  }
}

export function scorecardWeights(person, settings, credited = {}, creditedMoney = {}) {
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
      const live = kind === 'thb'
        ? Math.round(creditedMoney[id] || 0)
        : kind === 'hours'
          ? Math.round(credited[id] || 0)
          : (OBJ_BY_ID[id]?.target || '—')
      lines.push({
        id: `obj-${id}`,
        block: 'Delivery',
        objective: id,
        weight: (prio[id] ?? 1) / totalPrio,
        targetKind: kind,
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

  const ov = person.kpi || {}
  const hidden = new Set(person.kpiHidden || [])

  // A card has to keep at least one line: with the corporate and capability
  // lines gone, the objectives are all there is, and hiding the last one would
  // leave a 0% scorecard that nothing could rescale back to 100%.
  const kept = lines.filter((l) => !hidden.has(l.id))
  const resolved = (kept.length ? kept : lines.slice(0, 1))
    .map((l) => {
      const o = ov[l.id] || {}
      const numeric = l.targetKind === 'hours' || l.targetKind === 'thb'
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
        target,
        defaultWeight: l.weight,
        // The live figure straight from current project assignments. Reassign a
        // project on the Projects tab and this moves immediately.
        defaultTarget: l.target,
        creditedHours: l.objective ? (credited[l.objective] || 0) : null,
        creditedMoney: l.objective ? (creditedMoney[l.objective] || 0) : null,
        // A manual target that no longer matches what the person actually
        // carries — surfaced so it can be re-synced rather than silently drift.
        // Compared numerically where the target is a number: baht figures are
        // large enough that a strict !== would flag a rounding difference of
        // one satang as a drifted target.
        drifted: !!l.objective && (numeric
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
export const targetUnit = (line, basis = 'monthly', symbol = '฿') =>
  line.targetKind === 'thb'
    ? `${symbol}/year`
    : basis === 'monthly' ? 'hrs/month' : 'hrs/year'

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
  return String(line.target ?? '—')
}

/** Lines removed from a scorecard, so they can be listed and restored. */
export function hiddenLines(person, settings, credited = {}, creditedMoney = {}) {
  const hidden = new Set(person.kpiHidden || [])
  if (!hidden.size) return []
  const all = scorecardWeights({ ...person, kpiHidden: [] }, settings, credited, creditedMoney)
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

export const ROLE_ORDER = ['pm', 'lead', 'dev', 'support', 'qa', 'assignee']

/** Blank row for the "add project" action. */
export function newProject(seq) {
  return {
    key: `NEW-${seq}`,
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
    status: 'Not Start',
    srcStatus: null,
    start: null,
    due: null,
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

  // Nothing landed on a scorecard owner — the project is unassigned, or owned
  // by IT or another partner team. The team lead absorbs it, because they are
  // accountable for the team's overall KPI and these hours must not vanish.
  let fellBack = false
  if (Object.keys(raw).length === 0 && opts.fallbackPic && isOwner(opts.fallbackPic)) {
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

export const isCounted = (p) => p.commitLevel === 'commit' || p.commitLevel === 'stretch'

/**
 * Is this project part of THIS year's plan at all? "Next year" and "Excluded"
 * stay in the register but contribute nothing to the team total, the objective
 * mix, headcount or any scorecard.
 */
export const isInPlan = (p) => !OUT_OF_PLAN.has(p.commitLevel)

/** Does this project's objective contribute hours to the 3,000 pool? */
export const countsToPool = (p) => {
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
 *   build cost      = mandays x the developer day rate            (one-off)
 *   monthly benefit = saved hours/month x the accountant hour rate (recurring)
 *   net benefit     = monthly benefit x horizon - build cost      (over the horizon)
 *   ROI             = net benefit / build cost
 *
 * Cost is NULL, never zero, when no mandays have been estimated. A project
 * whose effort is unknown does not have a cost of nothing — it has an unknown
 * cost, and everything downstream of it must stay blank rather than report an
 * infinite return. That distinction is the whole reason this file has so many
 * null checks: the source workbook carries no effort data at all.
 *
 * `breakEvenMandays` is the one figure that survives that gap. It needs only
 * the saving hours, so it can be shown for every quantified project on day one:
 * spend more than this many mandays and the project loses money over the
 * horizon. `affordableMandays` is the same thing at the gate rather than at
 * zero return — the effort budget a project has to stay inside to be worth
 * committing.
 */
export function projectFinance(p, settings) {
  const r = financeRates(settings)
  const horizon = r.horizonMonths > 0 ? r.horizonMonths : DEFAULT_FINANCE.horizonMonths
  const gate = r.roiGate ?? DEFAULT_FINANCE.roiGate

  const hrs = monthlyHours(p, settings?.savingBasis)
  const monthlyBenefit = hrs == null ? null : hrs * r.acctHourRate
  const horizonBenefit = monthlyBenefit == null ? null : monthlyBenefit * horizon
  const annualBenefit = monthlyBenefit == null ? null : monthlyBenefit * 12
  // The saving expressed the way management already states it: whole people.
  const fteReleased = hrs == null ? null : hrs / r.hoursPerFteMonth

  // Same discipline as the saving hours: only a finite positive number is an
  // effort estimate. Infinity or NaN is missing data, not an infinite cost.
  const mdRaw = Number(p.manday)
  const md = Number.isFinite(mdRaw) && mdRaw > 0 ? mdRaw : null
  const buildCost = md == null ? null : md * r.devDayRate

  const netBenefit = horizonBenefit == null || buildCost == null ? null : horizonBenefit - buildCost
  const roi = buildCost == null || buildCost <= 0 || horizonBenefit == null
    ? null
    : (horizonBenefit - buildCost) / buildCost
  const payback = paybackMonths(buildCost, monthlyBenefit)

  const breakEvenMandays = horizonBenefit == null || r.devDayRate <= 0
    ? null
    : horizonBenefit / r.devDayRate
  const affordableMandays = breakEvenMandays == null ? null : breakEvenMandays / (1 + gate)

  return {
    monthlyBenefit,
    annualBenefit,
    horizonBenefit,
    fteReleased,
    buildCost,
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
  const projects = state.projects || []
  const allPeople = state.people || []
  // Only scorecard holders can be credited; IT and other partner teams are
  // assignable as PIC but carry no KPI of their own.
  const people = allPeople.filter((p) => p.scorecard !== false)
  const ownerIds = new Set(people.map((p) => p.id))
  const shareOpts = {
    owners: ownerIds,
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
    const p = { ...raw, savingHours: num(raw.savingHours), manday: num(raw.manday) ?? 0 }
    const { shares, partnerShare, fellBack } = projectShares(p, s.roleWeights, s.creditPartners, shareOpts)
    const fin = projectFinance(p, s)
    return {
      ...p,
      shares,
      partnerShare,
      fellBack,
      ...fin,
      // Kept as a secondary diagnostic. The gate is now financial, but hours
      // per manday is still the quickest read on whether an estimate is sane.
      ratio: projectRatio(p),
      gate: gateStatus(fin.roi, rates.roiGate),
      poolHours: countsToPool(p) && isCounted(p) ? (p.savingHours ?? 0) : 0,
      pastDue: !!p.due && p.due < s.asOfDate && p.status !== 'Done',
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

  const sumHC = (arr) => arr.reduce((a, p) => a + (p.hc || 0), 0)
  const committedHC = sumHC(commit)
  const totalHC = sumHC(perProject.filter(isInPlan))

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
  const inPlan = perProject.filter(isInPlan)
  const monthlyBenefit = inPlan.reduce((a, p) => a + (p.monthlyBenefit || 0), 0)
  const annualBenefit = monthlyBenefit * 12
  const horizonBenefit = monthlyBenefit * rates.horizonMonths
  const fteReleased = inPlan.reduce((a, p) => a + (p.fteReleased || 0), 0)

  const costed = inPlan.filter((p) => p.buildCost != null && p.monthlyBenefit != null)
  const buildCost = costed.reduce((a, p) => a + p.buildCost, 0)
  const costedHorizonBenefit = costed.reduce((a, p) => a + p.horizonBenefit, 0)
  const costedMonthlyBenefit = costed.reduce((a, p) => a + p.monthlyBenefit, 0)
  const netBenefit = costed.length ? costedHorizonBenefit - buildCost : null
  const portfolioRoi = buildCost > 0 ? (costedHorizonBenefit - buildCost) / buildCost : null
  const portfolioPayback = paybackMonths(costed.length ? buildCost : null, costedMonthlyBenefit)
  const finance = {
    ...rates,
    monthlyBenefit,
    annualBenefit,
    horizonBenefit,
    fteReleased,
    buildCost: costed.length ? buildCost : null,
    netBenefit,
    roi: portfolioRoi,
    paybackMonths: portfolioPayback,
    costedCount: costed.length,
    // Share of the book's benefit that has an effort estimate behind it.
    roiCoverage: monthlyBenefit > 0 ? costedMonthlyBenefit / monthlyBenefit : 0,
    uncostedCount: inPlan.filter((p) => p.buildCost == null && p.savingHours != null).length,
    // Effort that IS estimated on projects whose benefit is still TBC. It
    // cannot enter a return — there is no benefit to divide — but it is real
    // money and silently dropping it would make the Summary disagree with the
    // Projects sheet, which prints the cost of every row.
    unreturnedCost: inPlan
      .filter((p) => p.buildCost != null && p.monthlyBenefit == null)
      .reduce((a, p) => a + p.buildCost, 0),
    unreturnedCount: inPlan.filter((p) => p.buildCost != null && p.monthlyBenefit == null).length,
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
    const monthlyBenefit = counted.reduce(
      (a, r) => a + (countsToPool(r.p) ? (r.p.monthlyBenefit || 0) * r.share : 0),
      0,
    )
    // Cost is only ever summed over rows that carry BOTH a cost and a benefit.
    // Coercing an unknown cost to zero would divide a full portfolio benefit by
    // a partial cost and report a return nobody earned.
    const costedRows = counted.filter((r) => countsToPool(r.p) && r.p.buildCost != null && r.p.monthlyBenefit != null)
    const buildCost = costedRows.reduce((a, r) => a + r.p.buildCost * r.share, 0)
    const costedBenefit = costedRows.reduce((a, r) => a + r.p.horizonBenefit * r.share, 0)

    const byObjective = {}
    const benefitByObjective = {}
    for (const r of counted) {
      const id = r.p.objective
      byObjective[id] = (byObjective[id] || 0) + (r.p.savingHours ?? 0) * r.share
      // Annualised, because a yearly benefit is the number a business case is
      // argued in. The scorecard's Objective 1 target reads this map.
      benefitByObjective[id] = (benefitByObjective[id] || 0) + (r.p.monthlyBenefit || 0) * r.share * 12
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
      monthlyBenefit,
      buildCost: costedRows.length ? buildCost : null,
      costedBenefit: costedRows.length ? costedBenefit : null,
      costedCount: costedRows.length,
      rows,
    }
  })

  /* ---- the team lead's scorecard is the TEAM's scorecard ------------- */
  // A lead flagged aggregatesTeam is measured on everything the team delivers,
  // not just their own slice. Their figures are built by summing the others'
  // rather than re-deriving from projects, so the lead's number is provably
  // the sum of the team's and the two can never disagree.
  const teamHours = byPerson.reduce((a, p) => a + p.hours, 0)
  const teamManday = byPerson.reduce((a, p) => a + p.manday, 0)
  const teamMonthlyBenefit = byPerson.reduce((a, p) => a + p.monthlyBenefit, 0)
  const teamBuildCost = byPerson.reduce((a, p) => a + (p.buildCost || 0), 0)
  const teamCostedBenefit = byPerson.reduce((a, p) => a + (p.costedBenefit || 0), 0)
  const teamCostedCount = byPerson.reduce((a, p) => a + p.costedCount, 0)
  const teamByObjective = {}
  const teamBenefitByObjective = {}
  for (const p of byPerson) {
    for (const [k, v] of Object.entries(p.byObjective)) teamByObjective[k] = (teamByObjective[k] || 0) + v
    for (const [k, v] of Object.entries(p.benefitByObjective)) {
      teamBenefitByObjective[k] = (teamBenefitByObjective[k] || 0) + v
    }
  }
  const teamCounted = perProject.filter((p) => isCounted(p) && Object.keys(p.shares).length > 0)

  const withScorecards = byPerson.map((p) => {
    const aggregates = p.aggregatesTeam === true
    const scHours = aggregates ? teamHours : p.hours
    const scManday = aggregates ? teamManday : p.manday
    const scByObjective = aggregates ? teamByObjective : p.byObjective
    const scBenefitByObjective = aggregates ? teamBenefitByObjective : p.benefitByObjective
    // The lead's portfolio is the whole in-plan book, so it re-adds to the
    // headline above it.
    const scRows = aggregates ? teamCounted.map((pr) => ({ p: pr, share: 1, owner: pr.pic })) : p.rows

    const objectives = OBJECTIVE_ORDER.filter((id) => (scByObjective[id] || 0) > 0
      || scRows.some((r) => r.p.objective === id))
    const withObjectives = { ...p, objectives, aggregatesTeam: aggregates }

    // Money on the same aggregation rule as the hours: the lead carries the
    // team's, everyone else carries their own.
    const scMonthlyBenefit = aggregates ? teamMonthlyBenefit : p.monthlyBenefit
    const scCostedCount = aggregates ? teamCostedCount : p.costedCount
    const scBuildCost = scCostedCount > 0 ? (aggregates ? teamBuildCost : p.buildCost) : null
    const scCostedBenefit = scCostedCount > 0 ? (aggregates ? teamCostedBenefit : p.costedBenefit) : null
    const scFinance = {
      monthlyBenefit: scMonthlyBenefit,
      annualBenefit: scMonthlyBenefit * 12,
      horizonBenefit: scMonthlyBenefit * rates.horizonMonths,
      // Derived from the benefit, not from scHours: scHours is in whatever
      // unit savingBasis names, and dividing a per-YEAR figure by a per-MONTH
      // divisor reported twelve times the headcount on the annual basis.
      fteReleased: rates.acctMonthRate > 0 ? (scMonthlyBenefit / rates.acctMonthRate) : null,
      buildCost: scBuildCost,
      netBenefit: scCostedBenefit == null ? null : scCostedBenefit - scBuildCost,
      roi: scBuildCost > 0 ? (scCostedBenefit - scBuildCost) / scBuildCost : null,
      costedCount: scCostedCount,
    }

    return {
      ...withObjectives,
      scorecardHours: scHours,
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
      ownHours: p.hours,
      ownCount: p.countedCount,
      ratio: scManday > 0 ? scHours / scManday : null,
      kpiLines: scorecardWeights(withObjectives, s, scByObjective, scBenefitByObjective),
      kpiHiddenLines: hiddenLines(withObjectives, s, scByObjective, scBenefitByObjective),
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
    // estimate" and still carry no effort at all, which the flag alone misses.
    uncosted: perProject.filter((p) => isInPlan(p) && p.savingHours != null && !(p.manday > 0)).length,
    deleted: projects.filter((p) => p.deleted).length,
    pastDue: perProject.filter((p) => p.pastDue).length,
    pastDueHours: perProject
      .filter((p) => p.pastDue && isCounted(p) && countsToPool(p))
      .reduce((a, p) => a + (p.savingHours ?? 0), 0),
  }

  // ---- objective mix ------------------------------------------------
  const byObjective = {}
  for (const p of perProject.filter(isCounted)) {
    byObjective[p.objective] = (byObjective[p.objective] || 0) + (p.savingHours ?? 0)
  }

  // ---- concentration ------------------------------------------------
  const ranked = [...perProject]
    .filter((p) => isCounted(p) && countsToPool(p))
    .sort((a, b) => (b.savingHours ?? 0) - (a.savingHours ?? 0))
  const top2 = ranked.slice(0, 2).reduce((a, p) => a + (p.savingHours ?? 0), 0)

  return {
    settings: s,
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
      doneHours,
      doneCoverage: s.targetHours > 0 ? doneHours / s.targetHours : 0,
    },
    byObjective,
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
