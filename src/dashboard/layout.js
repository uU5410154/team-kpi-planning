/*
 * THE DEFAULT ARRANGEMENT, in grid units (twelve columns, 30px rows).
 * Kept apart from the cards themselves so it can be read without a browser.
 */
/** What every administrator sees until one of them saves a different arrangement. */
export const DEFAULT_LAYOUT = [
  { type: 'welcome', x: 0, y: 0, w: 6, h: 8 },
  { type: 'active', x: 6, y: 0, w: 3, h: 4 },
  { type: 'updated', x: 9, y: 0, w: 3, h: 4 },
  { type: 'decisions', x: 6, y: 4, w: 6, h: 4 },
  { type: 'owners', x: 0, y: 8, w: 12, h: 14 },
  { type: 'teamWeek', x: 0, y: 22, w: 7, h: 12 },
  { type: 'summary', x: 7, y: 22, w: 5, h: 7 },
  { type: 'ask', x: 7, y: 29, w: 5, h: 5 },
  { type: 'headline', x: 0, y: 34, w: 12, h: 5 },
  { type: 'biggest', x: 0, y: 39, w: 6, h: 8 },
  { type: 'team', x: 6, y: 39, w: 6, h: 8 },
  { type: 'bridge', x: 0, y: 47, w: 5, h: 17 },
  { type: 'byPerson', x: 5, y: 47, w: 7, h: 17 },
  { type: 'gate', x: 0, y: 64, w: 12, h: 12 },
  { type: 'guideline', x: 0, y: 76, w: 12, h: 12 },
  { type: 'concentration', x: 0, y: 88, w: 12, h: 9 },
]

/** Cards that are offered under "Add card" but not on the board to begin with. */
export const EXTRA_CARDS = ['blockers', 'slipping', 'trend', 'workload']
