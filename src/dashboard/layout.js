/*
 * THE DEFAULT ARRANGEMENT, in grid units (twelve columns, 30px rows).
 * Kept apart from the cards themselves so it can be read without a browser.
 */
/** What every administrator sees until one of them saves a different arrangement. */
export const DEFAULT_LAYOUT = [
  { type: 'welcome', x: 0, y: 0, w: 6, h: 6 },
  { type: 'active', x: 0, y: 6, w: 3, h: 4 },
  { type: 'updated', x: 3, y: 6, w: 3, h: 4 },
  { type: 'decisions', x: 6, y: 0, w: 6, h: 10 },
  { type: 'owners', x: 0, y: 10, w: 12, h: 14 },
  { type: 'teamWeek', x: 0, y: 24, w: 7, h: 12 },
  { type: 'summary', x: 7, y: 24, w: 5, h: 7 },
  { type: 'ask', x: 7, y: 31, w: 5, h: 5 },
  { type: 'headline', x: 0, y: 36, w: 12, h: 5 },
  { type: 'biggest', x: 0, y: 41, w: 6, h: 8 },
  { type: 'team', x: 6, y: 41, w: 6, h: 8 },
  { type: 'bridge', x: 0, y: 49, w: 5, h: 17 },
  { type: 'byPerson', x: 5, y: 49, w: 7, h: 17 },
  { type: 'gate', x: 0, y: 66, w: 12, h: 12 },
  { type: 'guideline', x: 0, y: 78, w: 12, h: 12 },
  { type: 'concentration', x: 0, y: 90, w: 12, h: 9 },
]

/** Cards that are offered under "Add card" but not on the board to begin with. */
export const EXTRA_CARDS = ['blockers', 'slipping', 'trend', 'workload']
