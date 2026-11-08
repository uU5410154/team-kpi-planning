/**
 * THE PROJECTS PAGE'S LAYOUT, as an administrator arranges it for everybody:
 * which blocks show and in what order, and which figure tiles show, in what
 * order and how wide.
 *
 * One list for the page and the server, the same way as the register's
 * columns: the server keeps only ids named here, so a bad client cannot store
 * something the page then chokes on. The project table cannot be hidden.
 */
export const PROJECT_SECTIONS = [
  { id: 'about', label: 'How-to note' },
  { id: 'filters', label: 'Search and filters' },
  { id: 'figures', label: 'Figures' },
  { id: 'tools', label: 'Table toolbar' },
  { id: 'table', label: 'Project table', locked: true },
]

/*
 * The figures, in the order they show by default: the six a manager reads
 * first make the top row, the costing figures — blank until somebody enters
 * effort or CAPEX — follow on a second row.
 */
export const PROJECT_TILES = [
  { id: 'count', label: 'Projects' },
  { id: 'hours', label: 'Saving hrs/mth' },
  { id: 'done', label: 'Delivered' },
  { id: 'fte', label: 'FTE released' },
  { id: 'benefit', label: 'Benefit/yr' },
  { id: 'build', label: 'Build cost' },
  { id: 'manday', label: 'Mandays' },
  { id: 'capex', label: 'CAPEX' },
  { id: 'opex', label: 'OPEX/yr' },
  { id: 'investment', label: 'Investment' },
  { id: 'roi', label: 'ROI' },
]

/*
 * The how-to note starts hidden: the page explains itself from "About this
 * page" in its header. An administrator can still show the note for everybody.
 */
export const DEFAULT_PROJECT_LAYOUT = {
  sections: PROJECT_SECTIONS.map((s) => s.id),
  hiddenSections: ['about'],
  tiles: PROJECT_TILES.map((t) => t.id),
  hiddenTiles: [],
  wideTiles: [],
}

const SECTION_IDS = PROJECT_SECTIONS.map((s) => s.id)
const TILE_IDS = PROJECT_TILES.map((t) => t.id)

/** Known ids, each once, in the order given; anything known but left out goes at the end. */
const ordered = (list, known) => {
  const out = []
  for (const id of Array.isArray(list) ? list.slice(0, 50) : []) {
    const s = String(id ?? '')
    if (known.includes(s) && !out.includes(s)) out.push(s)
  }
  for (const id of known) if (!out.includes(id)) out.push(id)
  return out
}
const subset = (list, known) => ordered(list, known).filter((id) => (Array.isArray(list) ? list.map(String) : []).includes(id))

/**
 * A layout as a client sent it, cut down to what the page knows. null when it
 * is not an object at all. The table always shows.
 */
export function cleanProjectLayout(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null
  return {
    sections: ordered(l.sections, SECTION_IDS),
    hiddenSections: subset(l.hiddenSections, SECTION_IDS).filter((id) => id !== 'table'),
    tiles: ordered(l.tiles, TILE_IDS),
    hiddenTiles: subset(l.hiddenTiles, TILE_IDS),
    wideTiles: subset(l.wideTiles, TILE_IDS),
  }
}

/** Move an id one place up (-1) or down (+1) in a list. */
export function moveId(list, id, by) {
  const i = list.indexOf(id)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length) return list
  const out = [...list]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}

/** Add or remove an id from a list. */
export const toggleId = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
