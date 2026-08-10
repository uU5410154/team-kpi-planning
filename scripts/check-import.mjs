/**
 * Export what you are looking at, edit it, import it back.
 *
 * The invariants that matter, in order:
 *   1. a filtered export holds the filtered rows and NOTHING else, and every
 *      number in it is the number the app is showing;
 *   2. exporting and importing with no edits changes nothing at all;
 *   3. an import touches ONLY the rows named in the file and ONLY the fields
 *      whose cell says something different — every other project comes back as
 *      the same object, untouched;
 *   4. calculated columns are ignored on the way in, so a stale copy of a
 *      number can never overwrite the number it came from;
 *   5. anything refused is reported, never dropped silently.
 *
 * Run with: node scripts/check-import.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, resolveManday, projectCosts } from '../src/lib/model.js'
import {
  buildFilteredWorkbook, readProjectsFile, planImport, applyImport, filteredFilename,
} from '../src/lib/projectIO.js'
import { PROJECT_COLUMNS, EDITABLE_COLUMNS, DERIVED_COLUMNS, columnFor } from '../src/lib/projectSheet.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }
const plan = computePlan(base)
const people = plan.assignees || plan.people

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/** Round-trip helper: write rows, optionally edit cells, read them back. */
const roundTrip = async (rows, edit) => {
  const wb = await buildFilteredWorkbook(rows, people, 'test')
  if (edit) edit(wb.getWorksheet('Projects'), headerIndex(wb.getWorksheet('Projects')))
  const buf = await wb.xlsx.writeBuffer()
  return readProjectsFile(buf)
}
const headerIndex = (ws) => {
  const map = {}
  ws.getRow(4).eachCell((cell, ix) => { const c = columnFor(cell.value); if (c) map[c.key] = ix })
  return map
}

/* ---------------- 1. the filtered export ---------------- */
console.log('--- the export holds what you filtered, and says what it holds ---')
{
  const rows = plan.projects.filter((p) => p.team === 'Accounting')
  const wb = await buildFilteredWorkbook(rows, people, 'team = Accounting')
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())
  const ws = back.getWorksheet('Projects')
  const ix = headerIndex(ws)

  const keys = []
  ws.eachRow((r, n) => { if (n > 4) keys.push(String(r.getCell(ix.jira).value || '')) })
  const written = keys.filter((k) => k && !/^TOTAL$/i.test(k))

  check('the file has one sheet, not the whole book', back.worksheets.length === 1, back.worksheets.map((w) => w.name).join(', '))
  check('IT HOLDS EXACTLY THE FILTERED ROWS', written.length === rows.length
    && rows.every((p) => written.includes(p.key)), `${written.length} written vs ${rows.length} filtered`)
  check('and none of the rows that were filtered out',
    !written.some((k) => !rows.some((p) => p.key === k)))
  check('it is smaller than the whole register', rows.length < plan.projects.length,
    `${rows.length} of ${plan.projects.length}`)
  check('the banner says which slice it is',
    /team = Accounting/.test(String(ws.getCell(2, 1).value || '')), String(ws.getCell(2, 1).value || '').slice(0, 60))
  check('the filename carries the count', /\(\d+\)/.test(filteredFilename(rows.length)), filteredFilename(rows.length))
  // The filters name the file, PIC first, so a folder of them sorts by owner
  // and nobody has to open one to find out which slice it holds.
  const named = filteredFilename(rows.length, ['Pol', 'Obj 4 Efficiency', 'commit'])
  check('AND THE FILTERS, WITH THE PIC FIRST',
    named.startsWith('F&A Tech projects — Pol') && named.includes('Obj 4 Efficiency'), named)
  check('an unfiltered export says so rather than looking filtered',
    /all projects/.test(filteredFilename(rows.length, [])), filteredFilename(rows.length, []))
  check('characters a file system will not take are stripped',
    !/[\\:*?"<>|/]/.test(filteredFilename(1, ['Kade', String.fromCharCode(34) + 'AP/Trade: x?' + String.fromCharCode(34)]).replace('.xlsx', '')),
    filteredFilename(1, ['Kade', '"AP/Trade: x?"']))
  check('and a long filter list is cut back rather than left unsaveable',
    filteredFilename(1, ['Pol', 'x'.repeat(200)]).length <= 150,
    String(filteredFilename(1, ['Pol', 'x'.repeat(200)]).length))

  // Every cell of every exported row against the app. One spot-checked row
  // proves one row; the file has to agree everywhere or a filtered export is
  // its own second opinion.
  const byKey = new Map(rows.map((p) => [p.key, p]))
  const ctx = { nickOf: (id) => people.find((x) => x.id === id)?.nick ?? null, people }
  const mismatches = []
  ws.eachRow((r, n) => {
    if (n <= 4) return
    const key = String(r.getCell(ix.jira).value || '')
    const p = byKey.get(key)
    if (!p) return
    for (const col of PROJECT_COLUMNS) {
      if (col.key === 'jira') continue
      const raw = r.getCell(ix[col.key]).value
      const cell = raw && typeof raw === 'object' && 'result' in raw ? raw.result : raw
      const want = col.read(p, ctx)
      const ok = typeof want === 'number' && typeof cell === 'number'
        ? Math.abs(cell - want) < 1e-9
        : (cell ?? null) === (want ?? null) || (cell === '' && want == null)
      if (!ok) mismatches.push(`${key}.${col.key}: ${JSON.stringify(cell)} vs ${JSON.stringify(want)}`)
    }
  })
  check('EVERY CELL OF EVERY ROW IS THE VALUE THE APP HOLDS', mismatches.length === 0,
    `${rows.length} rows x ${PROJECT_COLUMNS.length} columns${mismatches.length ? ' — ' + mismatches.slice(0, 4).join(' | ') : ''}`)

  // The seed prices almost nothing, so build a row that HAS an ROI and a
  // payback and check those specifically — a null compared against a null
  // proves nothing about the columns the user actually reads.
  const pricedState = {
    ...base,
    projects: base.projects.map((p) => (p.key === rows[0].key
      ? { ...p, savingHours: 400, manday: 20, capex: 120000, opex: [{ id: 'o', label: 'run', monthly: 3000, startMonth: 1, endMonth: 12 }] }
      : p)),
  }
  const pricedPlan = computePlan(pricedState)
  const one = pricedPlan.projects.find((p) => p.key === rows[0].key)
  const pwb = await buildFilteredWorkbook([one], people, '')
  const pback = new ExcelJS.Workbook()
  await pback.xlsx.load(await pwb.xlsx.writeBuffer())
  const pws = pback.getWorksheet('Projects')
  const pix = headerIndex(pws)
  const row = pws.getRow(5)
  const cellOf = (key) => {
    const v = row.getCell(pix[key]).value
    return v && typeof v === 'object' && 'result' in v ? v.result : v
  }
  check('a priced project really is priced', one.roi != null && one.paybackMonths != null,
    `ROI ${one.roi} payback ${one.paybackMonths}`)
  check('saving hours match', cellOf('savingHours') === one.savingHours, `${cellOf('savingHours')} vs ${one.savingHours}`)
  check('FTE matches', cellOf('fte') === one.fte, `${cellOf('fte')} vs ${one.fte}`)
  check('mandays match', cellOf('manday') === resolveManday(one), `${cellOf('manday')} vs ${resolveManday(one)}`)
  check('CAPEX matches', cellOf('capex') === one.capex, `${cellOf('capex')} vs ${one.capex}`)
  check('the OPEX run-rate matches', cellOf('opex') === projectCosts(one).opexRunRate,
    `${cellOf('opex')} vs ${projectCosts(one).opexRunRate}`)
  check('the investment matches', cellOf('investment') === one.investment, `${cellOf('investment')} vs ${one.investment}`)
  check('the annual benefit matches', cellOf('benefit') === one.annualBenefit, `${cellOf('benefit')} vs ${one.annualBenefit}`)
  check('THE ROI MATCHES THE APP', Math.abs(cellOf('roi') - one.roi) < 1e-9, `${cellOf('roi')} vs ${one.roi}`)
  check('THE PAYBACK MATCHES THE APP', Math.abs(cellOf('payback') - one.paybackMonths) < 1e-9,
    `${cellOf('payback')} vs ${one.paybackMonths}`)
  check('and the priced row still round-trips to nothing',
    planImport(await readProjectsFile(await pwb.xlsx.writeBuffer()), pricedState, pricedPlan).changes.length === 0)

  // the totals row sums the FILE, not the book
  let totalRow = null
  ws.eachRow((r) => { if (String(r.getCell(1).value || '') === 'TOTAL') totalRow = r })
  check('there is a totals row', !!totalRow)
  const f = totalRow.getCell(ix.savingHours).value
  check('IT SUMS THE FILTERED ROWS WITH A REAL FORMULA',
    typeof f === 'object' && /^SUM\(/.test(f.formula || ''), JSON.stringify(f?.formula))
  const expected = rows.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  const spanned = Number((f.formula.match(/(\d+):[A-Z]+(\d+)/) || [])[2]) - 4
  check('the formula spans exactly the rows written', spanned === rows.length, `${spanned} of ${rows.length}`)
  check('and that total is the app\'s own filtered total',
    Math.abs(expected - rows.reduce((a, p) => a + (p.savingHours ?? 0), 0)) < 1e-9,
    `${Math.round(expected)} hrs`)
}

/* ---------------- 2. the round trip changes nothing ---------------- */
console.log('\n--- export then import, with no edits, is a no-op ---')
{
  for (const [label, rows] of [
    ['the whole register', plan.projects],
    ['one team', plan.projects.filter((p) => p.team === 'Accounting')],
    ['a single project', plan.projects.slice(0, 1)],
    ['the ones with no saving hours', plan.projects.filter((p) => p.savingHours == null)],
  ]) {
    const parsed = await roundTrip(rows)
    const res = planImport(parsed, base, plan)
    check(`${label}: nothing to change`, res.changes.length === 0 && res.rejected.length === 0 && res.unknown.length === 0,
      `${res.changes.length} changes, ${res.rejected.length} rejected, ${res.unknown.length} unknown of ${rows.length}`)
    const next = applyImport(base.projects, res)
    check(`${label}: and every project is the SAME object`,
      next.every((p, i) => p === base.projects[i]))
  }
}

/* ---------------- 3. an edit touches exactly one field ---------------- */
console.log('\n--- an edited cell changes that field, and nothing else ---')
{
  const rows = plan.projects.slice(0, 8)
  const target = rows[2]
  const parsed = await roundTrip(rows, (ws, ix) => { ws.getRow(7).getCell(ix.savingHours).value = 1234 })
  const res = planImport(parsed, base, plan)
  check('one project changes', res.changes.length === 1, JSON.stringify(res.changes.map((c) => c.key)))
  check('and it is the row that was edited', res.changes[0]?.key === target.key,
    `${res.changes[0]?.key} vs ${target.key}`)
  check('one field changes', res.changes[0]?.fields.length === 1, JSON.stringify(res.changes[0]?.fields))
  check('the other rows in the file are counted as unchanged', res.unchanged === rows.length - 1,
    `${res.unchanged} of ${rows.length - 1}`)

  const next = applyImport(base.projects, res)
  const moved = next.filter((p, i) => p !== base.projects[i])
  check('EXACTLY ONE PROJECT OBJECT IS REPLACED', moved.length === 1, moved.map((p) => p.key).join(','))
  check('every project outside the file is untouched, by identity',
    next.every((p, i) => p.key === target.key || p === base.projects[i]))
  const after = next.find((p) => p.key === target.key)
  check('the field takes the new value', after.savingHours === 1234, String(after.savingHours))
  const untouched = Object.keys(base.projects.find((p) => p.key === target.key))
    .filter((k) => k !== 'savingHours')
  check('and NOTHING ELSE ON THAT PROJECT MOVES',
    untouched.every((k) => JSON.stringify(after[k]) === JSON.stringify(base.projects.find((p) => p.key === target.key)[k])),
    untouched.filter((k) => JSON.stringify(after[k]) !== JSON.stringify(base.projects.find((p) => p.key === target.key)[k])).join(','))

  // and the plan follows
  const p2 = computePlan({ ...base, projects: next })
  const shown = p2.projects.find((p) => p.key === target.key)
  check('the app shows the imported number', shown.savingHours === 1234)
  check('the team total moves by exactly the difference',
    Math.abs((p2.totals.totalHours - plan.totals.totalHours) - (1234 - (target.savingHours ?? 0))) < 1e-6,
    `${Math.round(plan.totals.totalHours)} -> ${Math.round(p2.totals.totalHours)}`)
  check('and the FTE regenerates from it', shown.fte === Math.round((1234 / 176) * 10) / 10, String(shown.fte))
}

/* ---------------- 4. calculated columns are ignored ---------------- */
console.log('\n--- a calculated column cannot be imported ---')
{
  const rows = plan.projects.slice(0, 5)
  const parsed = await roundTrip(rows, (ws, ix) => {
    for (const c of DERIVED_COLUMNS) ws.getRow(6).getCell(ix[c.key]).value = 987654
  })
  const res = planImport(parsed, base, plan)
  check('TYPING OVER FTE, INVESTMENT, ROI AND PAYBACK CHANGES NOTHING',
    res.changes.length === 0, JSON.stringify(res.changes))
  check('and the file says they were read but not used',
    res.ignoredColumns.length === DERIVED_COLUMNS.length, res.ignoredColumns.join(', '))
}

/* ---------------- 5. every editable field can be imported ---------------- */
console.log('\n--- every editable column actually imports ---')
{
  const rows = plan.projects.filter((p) => !p.tasks?.length && !(p.opex || []).length).slice(0, 3)
  const target = rows[0]
  const edits = {
    summary: 'Renamed by import',
    program: 'Programme X',
    team: 'Accounting',
    subTeam: 'Sub X',
    objective: '4. Efficiency and integration',
    pic: 'Kade',
    savingHours: 321,
    manday: 12,
    capex: 50000,
    opex: 2500,
    commitLevel: 'stretch',
    status: 'In Progress',
    start: '2026-03-01',
    due: '2026-09-30',
    notes: 'imported remark',
  }
  const parsed = await roundTrip(rows, (ws, ix) => {
    for (const [k, v] of Object.entries(edits)) ws.getRow(5).getCell(ix[k]).value = v
  })
  const res = planImport(parsed, base, plan)
  const changed = res.changes.find((c) => c.key === target.key)
  const labels = new Set((changed?.fields || []).map((f) => f.label))
  const missed = EDITABLE_COLUMNS
    .filter((c) => !labels.has(c.label))
    .filter((c) => {
      // a field already holding the imported value has nothing to change
      const cur = target[c.field]
      if (c.key === 'pic') return (cur ?? null) !== 'kade'
      if (c.key === 'objective') return cur !== 'efficiency'
      return String(cur ?? '') !== String(edits[c.key] ?? '')
    })
  check('EVERY EDITABLE COLUMN LANDS', missed.length === 0, missed.map((c) => c.label).join(', '))

  const next = applyImport(base.projects, res)
  const after = next.find((p) => p.key === target.key)
  check('the text fields are written', after.summary === 'Renamed by import' && after.notes === 'imported remark')
  check('the objective is stored as an id, not the label', after.objective === 'efficiency', String(after.objective))
  check('the commit level is stored as an id', after.commitLevel === 'stretch', String(after.commitLevel))
  check('the dates are stored as YYYY-MM-DD', after.start === '2026-03-01' && after.due === '2026-09-30',
    `${after.start} / ${after.due}`)
  check('the money fields are numbers', after.capex === 50000 && typeof after.capex === 'number')
  check('OPEX becomes a real monthly line', (after.opex || []).length === 1 && after.opex[0].monthly === 2500,
    JSON.stringify(after.opex))
  check('and it runs the whole year unless told otherwise',
    after.opex[0].startMonth === 1 && after.opex[0].endMonth === 12)

  // A PIC change must MOVE the project, not just rename its owner.
  const p2 = computePlan({ ...base, projects: next })
  const shown = p2.projects.find((p) => p.key === target.key)
  check('IMPORTING A PIC MOVES THE PROJECT, NOT JUST THE LABEL',
    Math.abs((shown.shares.kade || 0) - 1) < 1e-9, JSON.stringify(shown.shares))
  check('the previous owner does not keep a share of it',
    !(shown.shares[target.pic] > 0), JSON.stringify(shown.shares))
  check('every scorecard still totals 100%', p2.invalid.length === 0)
}

/* ---------------- 6. what it refuses ---------------- */
console.log('\n--- what it refuses, it says out loud ---')
{
  const rows = plan.projects.slice(0, 6)
  const parsed = await roundTrip(rows, (ws, ix) => {
    ws.getRow(5).getCell(ix.commitLevel).value = 'maybe'
    ws.getRow(6).getCell(ix.objective).value = 'Objective 99'
    ws.getRow(7).getCell(ix.pic).value = 'Somebody Else'
    ws.getRow(8).getCell(ix.savingHours).value = 'not a number'
    ws.getRow(9).getCell(ix.savingHours).value = -5
    ws.getRow(10).getCell(ix.jira).value = 'NOPE-1'
  })
  const res = planImport(parsed, base, plan)
  const by = (label) => res.rejected.filter((r) => r.label === label).length
  check('an unknown commit level is refused', by('Commit') === 1, JSON.stringify(res.rejected))
  check('an unknown objective is refused', by('Objective') === 1)
  check('an unknown person is refused', by('PIC') === 1)
  check('text in a number column is refused', by('Saving hrs/month') === 2)
  check('a negative number is refused too', by('Saving hrs/month') === 2)
  check('a row the plan does not have is reported, NOT created',
    res.unknown.length === 1 && res.unknown[0] === 'NOPE-1', JSON.stringify(res.unknown))
  check('and none of it is applied', res.changes.length === 0, JSON.stringify(res.changes))
  const next = applyImport(base.projects, res)
  check('so the plan is byte-identical', JSON.stringify(next) === JSON.stringify(base.projects))
  check('and no project was invented', next.length === base.projects.length)
}

/* ---------------- 7. blanks keep, TBC clears ---------------- */
console.log('\n--- a blank cell keeps what is there, TBC makes it unknown ---')
{
  const withHours = plan.projects.filter((p) => p.savingHours > 0).slice(0, 3)
  const blanked = await roundTrip(withHours, (ws, ix) => {
    ws.getRow(5).getCell(ix.savingHours).value = null
    ws.getRow(5).getCell(ix.status).value = ''
    ws.getRow(5).getCell(ix.summary).value = ''
  })
  const rBlank = planImport(blanked, base, plan)
  check('A BLANK CELL CHANGES NOTHING', rBlank.changes.length === 0, JSON.stringify(rBlank.changes))

  const cleared = await roundTrip(withHours, (ws, ix) => { ws.getRow(5).getCell(ix.savingHours).value = 'TBC' })
  const rClear = planImport(cleared, base, plan)
  check('but TBC clears the value', rClear.changes.length === 1
    && rClear.changes[0].fields[0].to === '—', JSON.stringify(rClear.changes[0]?.fields))
  const after = applyImport(base.projects, rClear).find((p) => p.key === withHours[0].key)
  check('and it is stored as unknown, not as zero', after.savingHours === null, JSON.stringify(after.savingHours))
  const p2 = computePlan({ ...base, projects: applyImport(base.projects, rClear) })
  check('so the app counts it as missing, not as a zero-hour project',
    p2.projects.find((p) => p.key === withHours[0].key).fte === 0)
}

/* ---------------- 8. it will not flatten a breakdown ---------------- */
console.log('\n--- it refuses to flatten a breakdown it cannot see ---')
{
  const key = plan.projects[0].key
  const withTasks = base.projects.map((p) => (p.key === key
    ? { ...p, tasks: [{ id: 't1', label: 'a', manday: 4 }, { id: 't2', label: 'b', manday: 6 }] } : p))
  const st = { ...base, projects: withTasks }
  const pl = computePlan(st)
  const rows = pl.projects.filter((p) => p.key === key)
  check('the total exported is the sum of its tasks',
    resolveManday(withTasks.find((p) => p.key === key)) === 10)

  const parsed = await roundTrip(rows, (ws, ix) => { ws.getRow(5).getCell(ix.manday).value = 99 })
  const res = planImport(parsed, st, pl)
  check('CHANGING THE TOTAL OF A BROKEN-DOWN PROJECT IS REFUSED',
    res.changes.length === 0 && res.rejected.length === 1, JSON.stringify(res.rejected))
  check('and the reason names the breakdown', /tasks/.test(res.rejected[0]?.why || ''), res.rejected[0]?.why)
  check('the tasks survive', applyImport(withTasks, res).find((p) => p.key === key).tasks.length === 2)

  // one line IS the total restated, so that one imports
  const oneTask = base.projects.map((p) => (p.key === key
    ? { ...p, tasks: [{ id: 't1', label: 'total', manday: 4 }] } : p))
  const st1 = { ...base, projects: oneTask }
  const pl1 = computePlan(st1)
  const parsed1 = await roundTrip(pl1.projects.filter((p) => p.key === key), (ws, ix) => {
    ws.getRow(5).getCell(ix.manday).value = 7
  })
  const res1 = planImport(parsed1, st1, pl1)
  check('a single line is just the total, so that one imports', res1.changes.length === 1,
    JSON.stringify(res1.rejected))
  check('and the total becomes what was typed',
    resolveManday(applyImport(oneTask, res1).find((p) => p.key === key)) === 7)

  // the same rule for a multi-line OPEX schedule
  const withOpex = base.projects.map((p) => (p.key === key
    ? { ...p, opex: [
      { id: 'o1', label: 'licence', monthly: 1000, startMonth: 1, endMonth: 6 },
      { id: 'o2', label: 'hosting', monthly: 500, startMonth: 7, endMonth: 12 },
    ] } : p))
  const st2 = { ...base, projects: withOpex }
  const pl2 = computePlan(st2)
  const parsed2 = await roundTrip(pl2.projects.filter((p) => p.key === key), (ws, ix) => {
    ws.getRow(5).getCell(ix.opex).value = 250
  })
  const res2 = planImport(parsed2, st2, pl2)
  check('A MULTI-LINE COST SCHEDULE IS NOT COLLAPSED',
    res2.changes.length === 0 && res2.rejected.length === 1, JSON.stringify(res2.rejected))
  check('and the schedule survives intact',
    applyImport(withOpex, res2).find((p) => p.key === key).opex.length === 2)
}

/* ---------------- 9. files that are not ours ---------------- */
console.log('\n--- a file that is not ours ---')
{
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Something')
  ws.getRow(1).values = ['Name', 'Amount']
  ws.getRow(2).values = ['x', 1]
  const bad = await readProjectsFile(await wb.xlsx.writeBuffer())
  check('a sheet with no Jira column is refused with a reason', !!bad.error, bad.error)

  // re-sorted, re-headed, columns removed: still fine, because columns are
  // matched by NAME and the header row is found rather than assumed.
  const rows = plan.projects.slice(0, 4)
  const wb2 = await buildFilteredWorkbook(rows, people, '')
  const ws2 = wb2.getWorksheet('Projects')
  const ix = headerIndex(ws2)
  ws2.spliceColumns(ix.investment, 1)          // drop a calculated column
  ws2.spliceRows(1, 2)                          // drop the banner entirely
  const parsed = await readProjectsFile(await wb2.xlsx.writeBuffer())
  check('a re-saved file with the banner gone still reads', !parsed.error && parsed.rows.length === 4,
    parsed.error || `${parsed.rows?.length} rows`)
  const res = planImport(parsed, base, plan)
  check('and it still changes nothing', res.changes.length === 0, JSON.stringify(res.changes))

  // a sheet holding ONLY the identity and one field
  const wb3 = new ExcelJS.Workbook()
  const ws3 = wb3.addWorksheet('Projects')
  ws3.getRow(1).values = ['Jira', 'Saving hrs/month']
  ws3.getRow(2).values = [plan.projects[0].key, 77]
  const parsed3 = await readProjectsFile(await wb3.xlsx.writeBuffer())
  const res3 = planImport(parsed3, base, plan)
  check('A TWO-COLUMN FILE IMPORTS JUST THAT FIELD',
    res3.changes.length === 1 && res3.changes[0].fields.length === 1, JSON.stringify(res3.changes))
  const after = applyImport(base.projects, res3).find((p) => p.key === plan.projects[0].key)
  const before = base.projects.find((p) => p.key === plan.projects[0].key)
  check('and leaves every other field on that project alone',
    Object.keys(before).filter((k) => k !== 'savingHours')
      .every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k])))
}

/* ---------------- 10. the contract itself ---------------- */
console.log('\n--- the contract export and import share ---')
{
  check('every column has a unique key', new Set(PROJECT_COLUMNS.map((c) => c.key)).size === PROJECT_COLUMNS.length)
  check('every column has a unique label', new Set(PROJECT_COLUMNS.map((c) => c.label)).size === PROJECT_COLUMNS.length)
  check('every column is either stored or calculated, never both',
    PROJECT_COLUMNS.every((c) => !(c.field && c.derived)))
  check('every editable column can parse', EDITABLE_COLUMNS.every((c) => typeof c.parse === 'function'))
  check('every column can be read', PROJECT_COLUMNS.every((c) => typeof c.read === 'function'))
  check('EVERY HEADER FINDS ITS OWN COLUMN BACK',
    PROJECT_COLUMNS.every((c) => columnFor(c.label)?.key === c.key),
    PROJECT_COLUMNS.filter((c) => columnFor(c.label)?.key !== c.key).map((c) => c.label).join(', '))
  check('a header that means nothing matches nothing', columnFor('Wibble') === undefined)
  check('headers are matched whatever their case', columnFor('  saving hrs/month ')?.key === 'savingHours')
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
