/**
 * Data-visualisation tokens.
 *
 * The categorical slots below are the validated reference palette. Both modes
 * were checked with the palette validator (5 slots, adjacent pairlist):
 *   light — worst adjacent CVD dE 9.1, normal-vision dE 19.6, PASS
 *   dark  — worst adjacent CVD dE 8.4, normal-vision dE 19.3, PASS
 * Light mode raises a contrast WARN on aqua/yellow/magenta (sub-3:1 on the
 * light surface). The relief is shipped: every chart carries direct value
 * labels and every chart has a table view. Do not add a 6th slot without
 * re-running the validator.
 *
 * Chrome colours (navy) are UI, not data ink, and are defined in theme.js.
 */

export const CHART = {
  light: {
    surface: '#fcfcfb',
    plane: '#f9f9f7',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    muted: '#898781',
    gridline: '#e1e0d9',
    baseline: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
    // categorical slots 1..5 — fixed order, never cycled
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
    // single-hue sequential ramp (blue), light -> dark
    seq: ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#256abf', '#184f95'],
    deemphasis: '#c3c2b7',
  },
  dark: {
    surface: '#1a1a19',
    plane: '#0d0d0d',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    muted: '#898781',
    gridline: '#2c2c2a',
    baseline: '#383835',
    border: 'rgba(255,255,255,0.10)',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
    seq: ['#0d366b', '#104281', '#184f95', '#256abf', '#2a78d6', '#3987e5', '#6da7ec'],
    deemphasis: '#52514e',
  },
}

/** Status palette — fixed, never themed, never reused as a series colour. */
export const STATUS = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
}

/**
 * The five management guideline objectives, in fixed slot order.
 *
 * `guideline*` fields are the management document reproduced verbatim, including
 * its Thai text and the asterisk on Data warehouse. They are for labelling and
 * must not be paraphrased — the app is read alongside that document, and any
 * drift between the two invites an argument about which one is authoritative.
 * `guidelineName` is empty on objective 5 because the source groups it under
 * "Efficiency and integration".
 */
/**
 * The order people appear in, left to right.
 *
 * A presentation choice, so it lives here rather than in the stored roster —
 * a plan already saved should not have to be rewritten to change the order of
 * two columns. Anyone not named keeps their place after those who are.
 */
export const PEOPLE_ORDER = ['gun', 'pphen', 'kade', 'james', 'tha', 'pol', 'it', 'user']

/**
 * Assignable, but not ours.
 *
 * IT and the business users own real projects in the register and have to be
 * selectable as PIC, but they hold no scorecard — and what they own is not
 * this team's commitment, so its hours do not enter the team's total.
 *
 * Kept here rather than only in seed.json because a plan saved before one of
 * these existed still has to be able to grow the entry: the roster is stored
 * with the plan, and nobody should have to retype it.
 */
export const ASSIGNEE_ONLY = [
  {
    id: 'it', name: 'IT', nick: 'IT', role: 'Partner team', band: 'senior', scorecard: false,
  },
  {
    id: 'user', name: 'Business user', nick: 'User', role: 'Business owner', band: 'analyst', scorecard: false,
  },
]

export const OBJECTIVES = [
  {
    id: 'delivery',
    no: 1,
    name: 'Project management',
    short: 'Delivery',
    detail: 'Deliver what was committed, on the timeline that was committed',
    target: 'Projects delivered within the agreed timeline',
    /*
     * A SHARE, and not money.
     *
     * This replaced a financial return, which measured a Tech team on how
     * profitable the work it was handed happened to be — something the team
     * does not choose. What a delivery team does control is whether it lands
     * what it said it would, when it said it would, so that is what this asks.
     *
     * Measured as the share of a person's projects that finished within the
     * agreed tolerance of their planned date. A share, because it cannot be met
     * by carrying fewer projects: dropping work leaves the ratio where it was,
     * while a count would flatter whoever holds least.
     *
     * The tolerance is one sprint, set on the Model tab. A plan that may not
     * move at all is not a plan, and a team punished for a two-day slip learns
     * to pad every estimate, which makes every plan less true.
     */
    measure: 'ratio',
    countsToPool: true,
    guidelineName: 'Project management',
    guidelineDetail: 'Commit a timeline and deliver against it',
    guidelineTarget:
      'Commit timeline ของตนเอง: ปรับ timeline ได้ไม่เกิน 1 sprint '
      + 'และไม่เกินสัดส่วนที่ตกลงไว้ ของจำนวน report + project ที่ถืออยู่',
  },
  {
    id: 'process_automation',
    no: 2,
    name: 'F&A process automation',
    short: 'Process automation',
    detail: 'Transform all manual work to automation',
    target: '3,000 hrs',
    /*
     * THE hours objective. Every saving hour in the plan lands here, whatever
     * else the project is tagged to — a dashboard that saves eight hours a
     * month is still eight hours of manual work removed.
     *
     * It is the only objective measured in hours, which is what makes tagging a
     * project to several of them safe: the others count deliverables, state a
     * date, or price the same hours in money, so nothing is counted twice.
     */
    measure: 'hours',
    accrues: 'allHours',
    countsToPool: true,
    guidelineName: 'F&A process automation',
    guidelineDetail: 'to transform all manual work to automation',
    guidelineTarget: '3,000 hrs.',
  },
  {
    id: 'datawarehouse',
    no: 3,
    name: 'F&A Data warehouse',
    short: 'Data warehouse',
    detail: 'Reporting for own division by linking F&A datawarehouse (Acct data cube)',
    target: 'by Nov 2026',
    // Measured by a date, not by hours — but the projects underneath it DO
    // carry saving hours in the source workbook, so those hours still count
    // toward the team total. Excluding them made the scorecards disagree with
    // the headline by exactly 352 hrs.
    measure: 'milestone',
    countsToPool: true,
    guidelineName: 'F&A Data warehouse*',
    guidelineDetail:
      'To create reporting for own division operation by link F&A datawarehouse (Acct data cube)',
    guidelineTarget: 'by Nov 2026',
  },
  {
    id: 'efficiency',
    no: 4,
    name: 'Efficiency and integration',
    short: 'Efficiency',
    detail: 'Developing reporting to enhance efficiency and productivity',
    target: 'Dashboards, reports and portals delivered',
    // Counted, not weighed in hours. The work is dashboards delivered; the
    // hours they save are real but they belong to objective 2, and reporting
    // them here as well would state the same saving twice.
    measure: 'count',
    countUnit: 'dashboards/reports/portals',
    countsToPool: true,
    guidelineName: 'Efficiency and integration',
    guidelineDetail: 'Developing reporting to enhance efficiency and productivity',
    guidelineTarget: 'propose',
  },
  {
    id: 'ai_automation',
    no: 5,
    name: 'Automation E2E, AI development',
    short: 'E2E / AI',
    detail: 'RPA and AI-included project delivery',
    target: 'E2E / AI solutions delivered',
    // Same rule as objective 4: the deliverable is the automation, the hours
    // it saves belong to objective 2.
    measure: 'count',
    countUnit: 'solutions',
    countsToPool: true,
    // blank in the source — grouped under "Efficiency and integration"
    guidelineName: '',
    guidelineDetail: 'Automation E2E, AI development',
    guidelineTarget: 'propose',
  },
]

export const OBJ_BY_ID = Object.fromEntries(OBJECTIVES.map((o) => [o.id, o]))

/** Objective -> categorical slot index. Fixed by objective number, never by rank. */
export const objColor = (mode, objectiveId) => {
  const i = OBJECTIVES.findIndex((o) => o.id === objectiveId)
  return CHART[mode].series[i < 0 ? 0 : i]
}

export const COMMIT_LEVELS = [
  { id: 'commit', label: 'Commit', help: 'Bankable — counts toward the committed target' },
  { id: 'stretch', label: 'Stretch', help: 'Upside — counted separately above the commitment' },
  { id: 'watch', label: 'Watch', help: 'At risk — excluded from the commitment' },
  { id: 'nextyear', label: 'Next year', help: 'Deferred to 2027 — kept in the register but out of this year\'s total' },
  { id: 'excluded', label: 'Excluded', help: 'Out of scope / deleted — never counted' },
]

/**
 * Commit levels that sit outside this year's plan entirely: their saving hours
 * are kept on the record but contribute nothing to the team total, the
 * objective mix or anyone's scorecard.
 */
export const OUT_OF_PLAN = new Set(['excluded', 'nextyear'])
