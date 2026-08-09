/**
 * The contract for the round-trip sheet: export the projects you are looking
 * at, edit them in Excel, import them back.
 *
 * Export and import read this ONE list. Written twice they would drift — a
 * renamed header or a moved column would export fine and import into the wrong
 * field, silently, and the first sign of it would be a wrong number on
 * somebody's scorecard.
 *
 * Two kinds of column:
 *   - `field` columns are the stored plan. They are what an import may write.
 *   - `derived` columns are computed by computePlan (FTE, investment, ROI,
 *     payback). They are exported so the sheet is readable on its own, and
 *     IGNORED on the way back in. Writing them would let a stale copy of a
 *     number overwrite the number it was copied from.
 */
import { OBJECTIVES, OBJ_BY_ID, COMMIT_LEVELS } from './palette.js'
import { resolveManday, projectCosts } from './model.js'

export const SHEET_NAME = 'Projects'

/** Header row of the round-trip sheet. Kept out of row 1 for the banner. */
export const HEADER_ROW = 4

const objectiveLabel = (id) => (OBJ_BY_ID[id] ? `${OBJ_BY_ID[id].no}. ${OBJ_BY_ID[id].name}` : '')

/**
 * The one place a written objective name is turned back into an id.
 * Accepts "2", "2.", "2. F&A process automation", or the name on its own.
 */
export function parseObjective(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return undefined
  const no = t.match(/^(\d+)\s*[.)]?/)
  if (no) {
    const hit = OBJECTIVES.find((o) => String(o.no) === no[1])
    if (hit) return hit.id
  }
  const lower = t.toLowerCase()
  const byName = OBJECTIVES.find((o) => lower.includes(o.name.toLowerCase()) || o.id === lower)
  return byName ? byName.id : null // null = present but not recognised
}

/** "1,234.5" and 1234.5 both mean the same thing in a spreadsheet. */
export function parseNumber(raw) {
  if (raw == null || raw === '') return undefined
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const t = String(raw).trim()
  if (!t) return undefined
  if (/^tbc$|^n\/?a$|^-+$|^—$/i.test(t)) return 'TBC'
  const n = Number(t.replace(/[,\s฿]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Excel hands dates back as Date objects; the plan stores YYYY-MM-DD. */
export function parseDate(raw) {
  if (raw == null || raw === '') return undefined
  if (raw instanceof Date) return raw.toISOString().slice(0, 10)
  const t = String(raw).trim()
  if (!t) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/**
 * The columns, in order.
 *
 * `read(p, ctx)` takes a COMPUTED project — the same object the table renders
 * from — so an exported cell is by construction the cell on screen.
 * `parse(raw, ctx)` returns the stored value, `undefined` to leave the field
 * alone, or null when the cell held something the plan cannot accept.
 */
export const PROJECT_COLUMNS = [
  {
    key: 'jira', label: 'Jira', width: 13, match: /^jira/i, identity: true,
    read: (p) => p.key,
  },
  {
    key: 'summary', label: 'Project', width: 42, match: /^project$/i, field: 'summary',
    read: (p) => p.summary || '',
    parse: (raw) => {
      const t = String(raw ?? '').trim()
      return t ? t : undefined
    },
  },
  {
    key: 'program', label: 'Programme', width: 26, match: /^programme?$/i, field: 'program',
    read: (p) => p.program || '',
    parse: (raw) => (raw == null || String(raw).trim() === '' ? undefined : String(raw).trim()),
  },
  {
    key: 'team', label: 'Team', width: 16, match: /^team$/i, field: 'team',
    read: (p) => p.team || '',
    parse: (raw) => (raw == null || String(raw).trim() === '' ? undefined : String(raw).trim()),
  },
  {
    key: 'subTeam', label: 'Sub team', width: 18, match: /^sub.?team$/i, field: 'subTeam',
    read: (p) => p.subTeam || '',
    parse: (raw) => (raw == null || String(raw).trim() === '' ? undefined : String(raw).trim()),
  },
  {
    key: 'objective', label: 'Objective', width: 26, match: /^objective$/i, field: 'objective',
    read: (p) => objectiveLabel(p.objective),
    parse: (raw) => parseObjective(raw),
  },
  {
    key: 'pic', label: 'PIC', width: 12, match: /^pic$/i, field: 'pic',
    read: (p, ctx) => (ctx.nickOf(p.pic) ?? 'TBC'),
    // A PIC change is not a field write — it moves the project's credit — so
    // the importer routes it through reassignPatch. Here we only resolve the
    // name to an id.
    parse: (raw, ctx) => {
      const t = String(raw ?? '').trim()
      if (!t) return undefined
      if (/^tbc$|^—$|^-+$/i.test(t)) return null_pic
      const hit = ctx.people.find((x) => x.id === t.toLowerCase()
        || (x.nick || '').toLowerCase() === t.toLowerCase()
        || (x.name || '').toLowerCase() === t.toLowerCase())
      return hit ? hit.id : null
    },
  },
  {
    key: 'savingHours', label: 'Saving hrs/month', width: 16, match: /^saving/i, field: 'savingHours',
    numFmt: '#,##0.0',
    read: (p) => p.savingHours ?? null,
    parse: (raw) => {
      const n = parseNumber(raw)
      if (n === undefined) return undefined
      if (n === 'TBC') return null_hours
      return n == null || n < 0 ? null : n
    },
  },
  {
    key: 'fte', label: 'FTE', width: 8, match: /^fte$/i, derived: true, numFmt: '#,##0.0',
    read: (p) => p.fte ?? null,
  },
  {
    key: 'manday', label: 'Mandays', width: 11, match: /^manday/i, field: 'manday', numFmt: '#,##0.0',
    read: (p) => (resolveManday(p) > 0 ? resolveManday(p) : null),
    parse: (raw) => {
      const n = parseNumber(raw)
      if (n === undefined) return undefined
      if (n === 'TBC') return null_hours
      return n == null || n < 0 ? null : n
    },
  },
  {
    key: 'capex', label: 'CAPEX', width: 14, match: /^capex/i, field: 'capex', numFmt: '#,##0',
    read: (p) => (p.capex ?? null),
    parse: (raw) => {
      const n = parseNumber(raw)
      if (n === undefined) return undefined
      if (n === 'TBC') return null_hours
      return n == null || n < 0 ? null : n
    },
  },
  {
    key: 'opex', label: 'OPEX/month', width: 14, match: /^opex/i, field: 'opex', numFmt: '#,##0',
    read: (p) => {
      const { opexRunRate } = projectCosts(p)
      return opexRunRate > 0 ? opexRunRate : null
    },
    parse: (raw) => {
      const n = parseNumber(raw)
      if (n === undefined) return undefined
      if (n === 'TBC') return null_hours
      return n == null || n < 0 ? null : n
    },
  },
  { key: 'investment', label: 'Investment', width: 14, match: /^investment/i, derived: true, numFmt: '#,##0', read: (p) => p.investment ?? null },
  { key: 'benefit', label: 'Benefit/yr', width: 14, match: /^benefit/i, derived: true, numFmt: '#,##0', read: (p) => p.annualBenefit ?? null },
  { key: 'roi', label: 'ROI', width: 10, match: /^roi$/i, derived: true, numFmt: '+0%;-0%;0%', read: (p) => p.roi ?? null },
  { key: 'payback', label: 'Payback (mth)', width: 13, match: /^payback/i, derived: true, numFmt: '#,##0.0', read: (p) => p.paybackMonths ?? null },
  {
    key: 'commitLevel', label: 'Commit', width: 11, match: /^commit$/i, field: 'commitLevel',
    read: (p) => p.commitLevel || '',
    parse: (raw) => {
      const t = String(raw ?? '').trim().toLowerCase()
      if (!t) return undefined
      return COMMIT_LEVELS.some((c) => c.id === t) ? t : null
    },
  },
  {
    key: 'status', label: 'Status', width: 14, match: /^status$/i, field: 'status',
    read: (p) => p.status || '',
    parse: (raw) => (raw == null || String(raw).trim() === '' ? undefined : String(raw).trim()),
  },
  { key: 'start', label: 'Start', width: 12, match: /^start$/i, field: 'start', read: (p) => p.start || '', parse: (raw) => parseDate(raw) },
  { key: 'due', label: 'Due', width: 12, match: /^due$/i, field: 'due', read: (p) => p.due || '', parse: (raw) => parseDate(raw) },
  {
    key: 'notes', label: 'Remark', width: 40, match: /^remark$/i, field: 'notes',
    read: (p) => p.notes || '',
    parse: (raw) => (raw == null ? undefined : String(raw).trim()),
  },
]

/*
 * Sentinels. A spreadsheet has no way to say "make this unknown again" other
 * than a word, so TBC does it. They are distinct objects rather than null so a
 * cell that simply failed to parse can never be mistaken for a deliberate
 * clear.
 */
export const null_hours = Symbol('clear')
export const null_pic = Symbol('unassign')

export const EDITABLE_COLUMNS = PROJECT_COLUMNS.filter((c) => c.field)
export const DERIVED_COLUMNS = PROJECT_COLUMNS.filter((c) => c.derived)

/** Find the column a written header means, or undefined. */
export const columnFor = (header) => {
  const t = String(header ?? '').trim()
  if (!t) return undefined
  return PROJECT_COLUMNS.find((c) => c.match.test(t) || c.label.toLowerCase() === t.toLowerCase())
}
