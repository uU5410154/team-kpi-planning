/*
 * THE DECK'S LOOK, measured from the IT governance deck (IT_Gov_13-Nov-2026):
 * a 10 × 5.625 inch slide, Arial throughout, CP Axtra blue and yellow on a
 * near-white page, navy titles with a short yellow bar under them.
 *
 * Slides are laid out on a 960 × 540 canvas — 96 to the inch, so a position
 * here divided by 96 is the inch PowerPoint wants. Text sizes are in POINTS,
 * as PowerPoint shows them; on the canvas a point is 4/3 of a pixel.
 */

export const W = 960
export const H = 540
export const PX_PER_IN = 96
export const ptToPx = (pt) => (pt * 4) / 3

export const FONT = 'Arial, Helvetica, sans-serif'

export const C = {
  blue: '#0071CD',
  navy: '#073B77',
  navy2: '#0B2F78',
  ink: '#17324D',
  inkSoft: '#2A4D88',
  yellow: '#FFC01F',
  white: '#FFFFFF',
  page: '#F6F9FD',
  cardBlue: '#F1F8FE',
  cardYellow: '#FFF9E9',
  line: '#D6E2F0',
  grid: '#E3EAF3',
  band: '#C9DAF5',
  red: '#E5484D',
  thanks: '#1D6FD3',
  muted: '#6B7A90',
}

/* The palette offered in the text colour picker: the deck's own colours. */
export const SWATCHES = ['#073B77', '#0071CD', '#17324D', '#2A4D88', '#FFC01F', '#247A37', '#B42318', '#6B7A90', '#000000', '#FFFFFF']
export const FILL_SWATCHES = ['#FFFFFF', '#F6F9FD', '#F1F8FE', '#FFF9E9', '#0071CD', '#FFC01F', '#073B77', '#E3F6EA', '#FDECEC', '#EEF1F5']

/*
 * THE STATUS PILL, as on the deck's cards and roadmap. "Delayed" and "On
 * hold" are not on the 13 Nov deck but are what the app knows about a
 * project; they keep the same shape in a muted red and grey.
 */
export const STATUS = {
  'GO LIVE': { fill: '#3DDC84', text: '#064E3B', border: '#FFFFFF' },
  'On Track': { fill: '#E9F8EF', text: '#247A37', border: '#7FD3A0' },
  Planning: { fill: '#E6F0FC', text: '#2A4D88', border: '#9DBDEA' },
  Delayed: { fill: '#FDECEC', text: '#B42318', border: '#F0A9A9' },
  'On Hold': { fill: '#EEF1F5', text: '#5B6B80', border: '#C3CCD8' },
  Done: { fill: '#3DDC84', text: '#064E3B', border: '#FFFFFF' },
}
export const STATUS_NAMES = ['GO LIVE', 'On Track', 'Planning', 'Delayed', 'On Hold']
export const statusStyle = (s) => STATUS[s] || STATUS[Object.keys(STATUS).find((k) => k.toLowerCase() === String(s || '').toLowerCase())] || STATUS['On Track']

/* Roadmap bars: the deck uses blue, yellow and (for live work) green. */
export const BAR = { blue: '#1580DA', yellow: '#FFC01F', green: '#3DDC84' }
export const BAR_TEXT = { blue: '#FFFFFF', yellow: '#073B77', green: '#064E3B' }

/* The background of each kind of slide. Pictures come from the brand. */
export const BACKGROUNDS = {
  light: { color: C.page, label: 'Light' },
  white: { color: C.white, label: 'White' },
  cover: { color: C.white, brand: 'cover', label: 'Cover picture' },
  finance: { color: C.white, brand: 'finance', label: 'Finance divider' },
  accounting: { color: C.white, brand: 'accounting', label: 'Accounting divider' },
  blue: { color: C.thanks, label: 'Blue' },
}

export const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/* 31-Aug-2026, as the deck writes a date. */
export function deckDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(iso || ''))) return iso ? String(iso) : 'TBC'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${String(d).padStart(2, '0')}-${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}-${y}`
}
