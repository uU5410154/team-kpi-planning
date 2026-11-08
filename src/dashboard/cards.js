import {
  WelcomeCard, BiggestCard, TeamCard, HeadlineCard, BridgeCard, ByPersonCard, GateCard, GuidelineCard, ConcentrationCard,
} from './planCards.jsx'
import {
  ActiveCard, UpdatedCard, OwnersCard, TeamWeekCard, DecisionsCard, SummaryCard, AskCard,
  BlockersCard, SlippingCard, WorkloadCard, TrendCard,
} from './weekCards.jsx'

export { DEFAULT_LAYOUT } from './layout.js'

/*
 * EVERY CARD THE DASHBOARD CAN SHOW.
 *
 * `w`/`h` are the size a card is added at, in grid units: twelve columns
 * across, rows of 30px with 16px between. `group` is where it is listed under
 * "Add card". A saved layout names cards by these keys; a key that is no
 * longer here is skipped, so removing a card from the code never breaks a
 * saved layout.
 */
export const CARDS = {
  welcome: { title: 'This year', C: WelcomeCard, w: 6, h: 8, minW: 3, minH: 5, group: 'The year' },
  active: { title: 'Active projects', C: ActiveCard, w: 3, h: 4, minW: 2, minH: 3, group: 'Projects' },
  updated: { title: 'Updated this week', C: UpdatedCard, w: 3, h: 4, minW: 2, minH: 3, group: 'Projects' },
  decisions: { title: 'Waiting for your decision', C: DecisionsCard, w: 6, h: 6, minW: 3, minH: 3, group: 'Weekly check-in' },
  owners: { title: 'Who holds what', C: OwnersCard, w: 12, h: 14, minW: 6, minH: 6, group: 'Projects' },
  teamWeek: { title: 'This week', C: TeamWeekCard, w: 7, h: 12, minW: 4, minH: 5, group: 'Weekly check-in' },
  summary: { title: 'The week, summarised', C: SummaryCard, w: 5, h: 7, minW: 3, minH: 4, group: 'Weekly check-in' },
  ask: { title: 'Ask about the plan', C: AskCard, w: 5, h: 5, minW: 3, minH: 4, group: 'Weekly check-in' },
  headline: { title: 'Headline figures', C: HeadlineCard, w: 12, h: 5, minW: 4, minH: 4, group: 'The year' },
  biggest: { title: 'Biggest projects', C: BiggestCard, w: 6, h: 8, minW: 3, minH: 5, group: 'The year' },
  team: { title: 'The team', C: TeamCard, w: 6, h: 8, minW: 3, minH: 5, group: 'The year' },
  bridge: { title: 'Target bridge', C: BridgeCard, w: 5, h: 17, minW: 4, minH: 8, group: 'The year' },
  byPerson: { title: 'Credited saving hours by person', C: ByPersonCard, w: 7, h: 17, minW: 4, minH: 8, group: 'The year' },
  gate: { title: 'Objective 1: is the build worth it', C: GateCard, w: 12, h: 12, minW: 5, minH: 8, group: 'The year' },
  guideline: { title: '2026 management KPI guideline', C: GuidelineCard, w: 12, h: 12, minW: 6, minH: 6, group: 'The year' },
  concentration: { title: 'Concentration risk', C: ConcentrationCard, w: 12, h: 9, minW: 6, minH: 5, group: 'The year' },
  // Not on the default dashboard; added from "Add card".
  blockers: { title: 'Blockers by type', C: BlockersCard, w: 6, h: 9, minW: 3, minH: 5, group: 'Extra' },
  slipping: { title: 'Slipping projects', C: SlippingCard, w: 6, h: 9, minW: 3, minH: 5, group: 'Extra' },
  trend: { title: 'Submission trend', C: TrendCard, w: 12, h: 9, minW: 6, minH: 5, group: 'Extra' },
  workload: { title: 'Workload this week', C: WorkloadCard, w: 6, h: 9, minW: 3, minH: 5, group: 'Extra' },
}

export const GROUPS = ['Projects', 'Weekly check-in', 'The year', 'Extra']
