/**
 * Export the projects you are looking at; import them back.
 *
 * The rule the whole module is built around: an import touches ONLY the rows
 * named in the file, and within them ONLY the fields whose column is present
 * and whose cell actually says something different. Everything else — other
 * projects, other fields, tasks, OPEX schedules, contributors, comments — is
 * left exactly as it was.
 *
 * Nothing is written until the user has seen the list of changes. planImport
 * works out what WOULD change and says so; applyImport carries it out.
 */
import ExcelJS from 'exceljs'
import {
  PROJECT_COLUMNS, EDITABLE_COLUMNS, SHEET_NAME, HEADER_ROW, columnFor,
  null_hours, null_pic,
} from './projectSheet.js'
import { reassignPatch, normalizeTasks, MONTHS_IN_YEAR } from './model.js'

const FONT = 'Calibri'
const NAVY = 'FF051C2C'
const HEAD = 'FF134A6E'
const RULE = 'FFD7E2EA'
const ZEBRA = 'FFF7F9FB'
const LOCKED = 'FFEFF3F6'
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const thin = { style: 'thin', color: { argb: RULE } }

/* ------------------------------------------------------------------ */
/* export                                                              */
/* ------------------------------------------------------------------ */

/**
 * One sheet, the rows given, in the order given.
 *
 * `rows` are COMPUTED projects — the same objects the table renders — so a
 * cell in the file is the cell on screen by construction rather than by a
 * second calculation that could disagree with it.
 */
export async function buildFilteredWorkbook(rows, people, describe = '') {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'F&A Tech — 2026 Objective & KPI Planning'
  wb.created = new Date()

  const ws = wb.addWorksheet(SHEET_NAME, {
    properties: { tabColor: { argb: HEAD } },
    views: [{ state: 'frozen', xSplit: 2, ySplit: HEADER_ROW }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const ctx = { nickOf: (id) => people.find((x) => x.id === id)?.nick ?? null, people }
  const cols = PROJECT_COLUMNS
  const last = cols.length

  ws.mergeCells(1, 1, 1, last)
  const title = ws.getCell(1, 1)
  title.value = 'PROJECT REGISTER — EDIT AND IMPORT BACK'
  title.font = { name: FONT, size: 14, bold: true, color: { argb: 'FFFFFFFF' } }
  title.fill = fill(NAVY)
  title.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(1).height = 26

  ws.mergeCells(2, 1, 2, last)
  const note = ws.getCell(2, 1)
  note.value = `${rows.length} project${rows.length === 1 ? '' : 's'}${describe ? ` · ${describe}` : ''}`
    + ' · edit any white column and import this file back'
    + ` · the shaded columns (${PROJECT_COLUMNS.filter((c) => c.derived).map((c) => c.label).join(', ')}) are calculated and are ignored on import`
    + ' · Jira identifies the row — do not change it · leave a cell blank to keep what is already there, write TBC to make it unknown'
  note.font = { name: FONT, size: 9, italic: true, color: { argb: 'FF52514E' } }
  note.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: false }
  ws.getRow(2).height = 16

  const head = ws.getRow(HEADER_ROW)
  head.values = cols.map((c) => c.label)
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1)
    cell.font = { name: FONT, size: 9.5, bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = fill(HEAD)
    cell.alignment = { vertical: 'middle', horizontal: c.numFmt ? 'right' : 'left', wrapText: true }
    cell.border = { top: thin, left: thin, bottom: thin, right: thin }
    ws.getColumn(i + 1).width = c.width
  })
  head.height = 24

  let r = HEADER_ROW + 1
  const first = r
  rows.forEach((p, n) => {
    const row = ws.getRow(r++)
    row.values = cols.map((c) => c.read(p, ctx))
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1)
      cell.font = { name: FONT, size: 9.5, bold: i === 0 }
      cell.border = { top: thin, left: thin, bottom: thin, right: thin }
      if (c.numFmt) { cell.numFmt = c.numFmt; cell.alignment = { horizontal: 'right' } }
      // Calculated columns are shaded, so it is obvious which cells an import
      // will read and which it will ignore.
      if (c.derived) cell.fill = fill(LOCKED)
      else if (n % 2) cell.fill = fill(ZEBRA)
    })
  })

  if (rows.length) {
    const tr = ws.getRow(r)
    tr.getCell(1).value = 'TOTAL'
    tr.getCell(2).value = `${rows.length} project${rows.length === 1 ? '' : 's'} as filtered`
    const colLetter = (n) => {
      let s = ''
      for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
      return s
    }
    // Real SUM formulas over the rows written, so the total in the file is the
    // total of the file — filtering cannot leave it stating the whole book.
    for (const key of ['savingHours', 'fte', 'manday', 'capex', 'opex', 'investment', 'benefit']) {
      const i = cols.findIndex((c) => c.key === key)
      if (i < 0) continue
      const L = colLetter(i + 1)
      const cell = tr.getCell(i + 1)
      cell.value = { formula: `SUM(${L}${first}:${L}${r - 1})` }
      cell.numFmt = cols[i].numFmt
      cell.alignment = { horizontal: 'right' }
    }
    tr.eachCell((cell) => {
      cell.font = { name: FONT, size: 9.5, bold: true }
      cell.fill = fill(LOCKED)
      cell.border = { top: { style: 'medium', color: { argb: HEAD } }, bottom: thin, left: thin, right: thin }
    })
  }

  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + rows.length, column: last } }
  return wb
}

/**
 * The filename says which slice of the register is inside it.
 *
 * A folder of files all called "F&A Tech projects (4)" is a folder nobody can
 * tell apart a week later. The PIC comes first because that is what these are
 * usually cut by — one file per person — so they sort together by owner.
 *
 * Anything a file system will not take is stripped rather than escaped: a name
 * that fails to save is worse than a name that reads a little shorter.
 */
export const filteredFilename = (n, parts = []) => {
  const clean = (parts || [])
    .map((x) => String(x || '').replace(/[\\:*?"<>|/]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const day = new Date().toISOString().slice(0, 10)
  // The filter comes FIRST, before the product name: a folder of these is
  // read down the left edge, and the owner is what anyone is looking for.
  const name = clean.length
    ? `${clean.join(' · ')} — F&A Tech projects (${n}) — ${day}.xlsx`
    : `F&A Tech projects — all (${n}) — ${day}.xlsx`
  // Windows gives up around 255; leave room for the folder it lands in.
  return name.length <= 150 ? name : `${clean[0]} — F&A Tech projects (${n}) — ${day}.xlsx`
}

/** Builds and downloads. Browser only. */
export async function exportFiltered(rows, people, describe, parts = []) {
  const wb = await buildFilteredWorkbook(rows, people, describe)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filteredFilename(rows.length, parts)
  a.click()
  URL.revokeObjectURL(url)
}

/* ------------------------------------------------------------------ */
/* import                                                              */
/* ------------------------------------------------------------------ */

/** ExcelJS hands back rich text, formula results and dates. Flatten to a value. */
function cellValue(cell) {
  const v = cell?.value
  if (v == null) return null
  if (typeof v === 'object') {
    if (v instanceof Date) return v
    if ('result' in v) return v.result
    if ('text' in v) return v.text
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    if ('hyperlink' in v) return v.text ?? null
  }
  return v
}

/**
 * Read a workbook into { key -> raw cells }.
 *
 * The header row is found by looking for the Jira column rather than assumed,
 * so a file that has been re-saved, re-sorted or had its banner edited still
 * imports. Columns are matched by NAME, so a moved or deleted column cannot
 * shift the values into the wrong field.
 */
export async function readProjectsFile(data) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(data)
  const ws = wb.getWorksheet(SHEET_NAME) || wb.worksheets[0]
  if (!ws) return { error: 'The file has no sheets.' }

  let headerAt = -1
  let map = null
  ws.eachRow((row, n) => {
    if (headerAt > 0) return
    const found = new Map()
    row.eachCell((cell, ix) => {
      const col = columnFor(cellValue(cell))
      if (col && !found.has(col.key)) found.set(col.key, ix)
    })
    if (found.has('jira') && [...found.keys()].some((k) => k !== 'jira')) { headerAt = n; map = found }
  })
  if (headerAt < 0) {
    return { error: 'No header row found. The sheet needs a "Jira" column and at least one other column from the export.' }
  }

  const rows = []
  const dupes = []
  const seen = new Set()
  ws.eachRow((row, n) => {
    if (n <= headerAt) return
    const key = String(cellValue(row.getCell(map.get('jira'))) ?? '').trim()
    if (!key || /^total$/i.test(key)) return
    if (seen.has(key)) { dupes.push(key); return }
    seen.add(key)
    const values = {}
    for (const [colKey, ix] of map) {
      if (colKey === 'jira') continue
      values[colKey] = cellValue(row.getCell(ix))
    }
    rows.push({ key, values })
  })

  return {
    sheet: ws.name,
    columns: [...map.keys()].filter((k) => k !== 'jira'),
    ignored: [...map.keys()].filter((k) => PROJECT_COLUMNS.find((c) => c.key === k)?.derived),
    rows,
    dupes,
  }
}

const same = (a, b) => {
  if (a == null && b == null) return true
  // An empty cell and a field nobody ever filled in are the same absence. Left
  // alone, every text column proposed "— to —" on a clean round trip, which
  // buries the changes that are real in a list of eighty that are not.
  if ((a === '' || a == null) && (b === '' || b == null)) return true
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9
  // A list has to be compared by value: two identical soft-benefit lists are
  // different objects, and === would report a change on every single import.
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(Array.isArray(a) ? a : []) === JSON.stringify(Array.isArray(b) ? b : [])
  }
  return a === b
}

const showValue = (v) => {
  if (Array.isArray(v)) return v.length ? `${v.length} bullet${v.length === 1 ? '' : 's'}` : '—'
  if (v == null || v === '') return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return String(v)
}

/**
 * Work out what an import WOULD do, without doing any of it.
 *
 * Returns the per-project list of field changes, the rows the plan does not
 * have, and every cell that had to be refused — so the user approves a change
 * they can see rather than a file they hope is right.
 */
export function planImport(parsed, state, plan) {
  const byKey = new Map(state.projects.map((p) => [p.key, p]))
  const computed = new Map((plan?.projects || []).map((p) => [p.key, p]))
  const people = plan?.assignees || state.people || []
  const ctx = { people, nickOf: (id) => people.find((x) => x.id === id)?.nick ?? null }
  const nameOf = (id) => (id ? (ctx.nickOf(id) || id) : 'TBC')

  const changes = []
  const unknown = []
  const rejected = []

  for (const row of parsed.rows || []) {
    const stored = byKey.get(row.key)
    if (!stored) { unknown.push(row.key); continue }
    const shown = computed.get(row.key) || stored
    const fields = []
    let patch = {}

    for (const col of EDITABLE_COLUMNS) {
      if (!(col.key in row.values)) continue
      const parsedValue = col.parse(row.values[col.key], ctx)
      if (parsedValue === undefined) continue            // blank: keep what is there
      if (parsedValue === null) {
        rejected.push({ key: row.key, label: col.label, raw: showValue(row.values[col.key]) })
        continue
      }

      // ---- the fields that are not simple writes ----
      if (col.key === 'pic') {
        const next = parsedValue === null_pic ? null : parsedValue
        if (same(stored.pic ?? null, next)) continue
        fields.push({ label: col.label, from: nameOf(stored.pic), to: nameOf(next) })
        // Credit comes from the contributor list, so the owner has to be moved,
        // not just named.
        patch = { ...patch, ...reassignPatch({ ...stored, ...patch }, next) }
        continue
      }
      if (col.key === 'manday') {
        const next = parsedValue === null_hours ? null : parsedValue
        const tasks = normalizeTasks(stored.tasks)
        if (tasks.length > 1) {
          rejected.push({
            key: row.key, label: col.label, raw: showValue(row.values[col.key]),
            why: `broken into ${tasks.length} tasks — change it in the project panel so the breakdown stays true`,
          })
          continue
        }
        const current = tasks.length === 1 ? tasks[0].manday : (stored.manday ?? null)
        if (same(current ?? null, next)) continue
        fields.push({ label: col.label, from: showValue(current), to: showValue(next) })
        // A single line is the total restated, so replacing it loses nothing.
        patch = { ...patch, manday: next, tasks: [], mandayEstimated: false }
        continue
      }
      if (col.key === 'opex') {
        const next = parsedValue === null_hours ? null : parsedValue
        const lines = Array.isArray(stored.opex) ? stored.opex : []
        if (lines.length > 1) {
          rejected.push({
            key: row.key, label: col.label, raw: showValue(row.values[col.key]),
            why: `made of ${lines.length} cost lines — change it in the project panel so the schedule stays true`,
          })
          continue
        }
        const current = lines.length === 1 ? (lines[0].monthly ?? 0) : 0
        if (same(current, next ?? 0)) continue
        fields.push({ label: col.label, from: showValue(current || null), to: showValue(next) })
        patch = {
          ...patch,
          opex: next
            ? [{ ...(lines[0] || {}), id: lines[0]?.id || 'opex-import', label: lines[0]?.label || 'Operational cost', monthly: next, startMonth: lines[0]?.startMonth || 1, endMonth: lines[0]?.endMonth || MONTHS_IN_YEAR }]
            : [],
        }
        continue
      }

      // ---- everything else is a plain field ----
      const next = parsedValue === null_hours ? null : parsedValue
      const current = stored[col.field] ?? null
      if (same(current, next)) continue
      const from = col.key === 'objective' ? col.read(shown, ctx) : showValue(current)
      const to = col.key === 'objective'
        ? col.read({ ...shown, objective: next }, ctx)
        : showValue(next)
      fields.push({ label: col.label, from, to })
      patch = { ...patch, [col.field]: next }
    }

    if (fields.length) changes.push({ key: row.key, summary: stored.summary, fields, patch })
  }

  const matched = (parsed.rows || []).length - unknown.length
  return {
    changes,
    unknown,
    rejected,
    dupes: parsed.dupes || [],
    matched,
    unchanged: matched - changes.length,
    ignoredColumns: (parsed.ignored || []).map((k) => PROJECT_COLUMNS.find((c) => c.key === k)?.label).filter(Boolean),
  }
}

/**
 * Carry out an approved import.
 *
 * Every project not named in the plan comes back as the SAME object, so a row
 * the file never mentioned cannot be re-created, re-ordered or subtly rebuilt.
 */
export function applyImport(projects, result) {
  const patches = new Map((result?.changes || []).map((c) => [c.key, c.patch]))
  if (!patches.size) return projects
  return projects.map((p) => (patches.has(p.key) ? { ...p, ...patches.get(p.key) } : p))
}
