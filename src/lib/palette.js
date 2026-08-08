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
export const OBJECTIVES = [
  {
    id: 'financial',
    no: 1,
    name: 'Financial',
    short: 'Financial',
    detail: 'Activities which improve PL, BS, Cash flow',
    target: 'Manday : saving-hours ratio',
    measure: 'ratio',
    countsToPool: true,
    guidelineName: 'Financial',
    guidelineDetail: 'Activities which improve PL, BS, Cash flow',
    guidelineTarget:
      'FTEs management เช่น การนำเสนอ project sprint vs. man-hour ที่ทีม invest vs. benefits ที่ได้ ว่าคุ้มค่าหรือไม่',
  },
  {
    id: 'process_automation',
    no: 2,
    name: 'F&A process automation',
    short: 'Process automation',
    detail: 'Transform all manual work to automation',
    target: '3,000 hrs',
    measure: 'hours',
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
    measure: 'milestone',
    countsToPool: false,
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
    target: 'propose',
    measure: 'hours_part',
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
    target: 'propose',
    measure: 'hours',
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
