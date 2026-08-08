import ExcelJS from 'exceljs'
import { OBJECTIVES, OBJ_BY_ID } from './palette.js'
import { paybackMonths, SAVING_BASIS, fmtTarget } from './model.js'

/* ------------------------------------------------------------------ */
/* house style                                                         */
/* ------------------------------------------------------------------ */

const NAVY = 'FF051C2C'
const NAVY_MID = 'FF134A6E'
const RULE = 'FFD7E2EA'
const ZEBRA = 'FFF7F9FB'
const INK = 'FF0B0B0B'
const MUTED = 'FF52514E'
const GOOD = 'FF0CA30C'
const WARN = 'FFB57A00'
const BAD = 'FFD03B3B'

const FONT = 'Calibri'
const N0 = '#,##0'
const N1 = '#,##0.0'
const PCT = '0%'

const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
const thin = { style: 'thin', color: { argb: RULE } }

/** Big navy banner across the sheet. */
function banner(ws, title, subtitle, width) {
  ws.mergeCells(1, 1, 1, width)
  const t = ws.getCell(1, 1)
  t.value = title
  t.font = { name: FONT, size: 16, bold: true, color: { argb: 'FFFFFFFF' } }
  t.fill = fill(NAVY)
  t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(1).height = 30

  ws.mergeCells(2, 1, 2, width)
  const s = ws.getCell(2, 1)
  s.value = subtitle
  s.font = { name: FONT, size: 9, color: { argb: 'FFFFFFFF' } }
  s.fill = fill(NAVY_MID)
  s.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 }
  ws.getRow(2).height = 18
}

/** Column header strip. */
function headerRow(ws, rowIx, labels, widths) {
  const row = ws.getRow(rowIx)
  labels.forEach((label, i) => {
    const c = row.getCell(i + 1)
    c.value = label
    c.font = { name: FONT, size: 9, bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = fill(NAVY_MID)
    c.alignment = { vertical: 'middle', wrapText: true, horizontal: i === 0 ? 'left' : 'center' }
    c.border = { bottom: { style: 'thin', color: { argb: NAVY } } }
  })
  row.height = 30
  if (widths) widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
}

/** Section label inside a sheet. */
function sectionRow(ws, rowIx, text, width) {
  ws.mergeCells(rowIx, 1, rowIx, width)
  const c = ws.getCell(rowIx, 1)
  c.value = text
  c.font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } }
  c.fill = fill('FFEDF2F6')
  c.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(rowIx).height = 20
}

function styleBody(ws, firstRow, lastRow, lastCol, { zebra = true } = {}) {
  for (let r = firstRow; r <= lastRow; r++) {
    const row = ws.getRow(r)
    row.height = 16
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c)
      cell.font = cell.font?.bold
        ? { name: FONT, size: 9.5, bold: true, color: { argb: INK } }
        : { name: FONT, size: 9.5, color: { argb: INK } }
      cell.border = { top: thin, bottom: thin, left: thin, right: thin }
      if (zebra && (r - firstRow) % 2 === 1) cell.fill = fill(ZEBRA)
      if (!cell.alignment) cell.alignment = { vertical: 'middle' }
    }
  }
}

const tone = (cell, argb, bold = true) => {
  cell.font = { name: FONT, size: 9.5, bold, color: { argb } }
}

/* ------------------------------------------------------------------ */
/* workbook                                                            */
/* ------------------------------------------------------------------ */

/** Builds the workbook. Pure — no DOM — so it can be exercised from Node. */
export async function buildWorkbook(plan, state) {
  const { totals, people, projects, quality, settings, byObjective } = plan
  const stamp = new Date().toISOString().slice(0, 10)
  const basis = SAVING_BASIS[settings.savingBasis]
  const unit = settings.savingBasis === 'monthly' ? 'hrs/month' : 'hrs/year'

  const wb = new ExcelJS.Workbook()
  wb.creator = 'F&A Tech Team'
  wb.created = new Date()

  /* ============ 1. Summary ============ */
  {
    const ws = wb.addWorksheet('Summary', {
      properties: { tabColor: { argb: NAVY } },
      pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    ws.getColumn(1).width = 54
    ws.getColumn(2).width = 16
    ws.getColumn(3).width = 14
    banner(ws, 'F&A TECH TEAM — 2026 OBJECTIVE & KPI PLAN',
      `${state.scenarioName || 'Baseline'}  ·  exported ${stamp}  ·  saving hours are ${basis.label.toLowerCase()}`, 3)

    let r = 4
    const kv = (label, value, fmt, colour) => {
      const row = ws.getRow(r++)
      row.getCell(1).value = label
      const v = row.getCell(2)
      v.value = value
      if (fmt) v.numFmt = fmt
      v.alignment = { horizontal: 'right' }
      if (colour) tone(v, colour)
      return row
    }

    sectionRow(ws, r++, 'TARGET BRIDGE', 3)
    const bridgeStart = r
    kv(`Management target (${unit})`, settings.targetHours, N0)
    kv('Total book (this year)', Math.round(totals.totalHours), N0, NAVY)
    kv('Committed — bankable', Math.round(totals.committedHours), N0, GOOD)
    kv('Stretch — upside, not committed', Math.round(totals.stretchHours), N0)
    kv('Watch — at risk, excluded', Math.round(totals.watchHours), N0, WARN)
    const hl = kv('HEADLINE POSITION', Math.round(totals.headlineHours), N0)
    hl.getCell(1).font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } }
    hl.getCell(2).font = { name: FONT, size: 11, bold: true, color: { argb: NAVY } }
    kv('Coverage vs target', totals.coverage, PCT, totals.coverage >= 1 ? GOOD : BAD)
    kv('Gap (+ surplus / − shortfall)', Math.round(totals.gap), N0, totals.gap >= 0 ? GOOD : BAD)
    if (totals.nextYearHours > 0) {
      kv(`Deferred to next year (${totals.nextYearCount} projects, excluded above)`,
        Math.round(totals.nextYearHours), N0, MUTED)
    }
    kv('Already delivered (status Done)', Math.round(totals.doneHours), N0)
    kv('Headcount equivalent committed', totals.committedHC, N1)
    styleBody(ws, bridgeStart, r - 1, 3)

    r++
    sectionRow(ws, r++, 'OBJECTIVE 1 — EFFICIENCY GATE', 3)
    const gateStart = r
    kv('Gate (saving hours per manday)', settings.ratioGate, N1)
    kv('Saving-hours basis', basis.label)
    const pm = paybackMonths(settings.ratioGate, settings.savingBasis)
    kv('Implied payback on build effort', pm == null ? 'n/a' : pm < 24 ? `${pm.toFixed(1)} months` : `${(pm / 12).toFixed(1)} years`)
    kv('Team ratio achieved', totals.teamRatio == null ? 'not yet measurable' : Number(totals.teamRatio.toFixed(2)), totals.teamRatio == null ? undefined : N1)
    kv('Projects below the gate', totals.failingGate, N0, totals.failingGate ? WARN : GOOD)
    kv('Mandays committed', Math.round(totals.totalManday), N0)
    styleBody(ws, gateStart, r - 1, 3)

    r++
    sectionRow(ws, r++, 'CONCENTRATION RISK', 3)
    const cStart = r
    kv('Top 2 projects as share of headline', totals.top2Share, PCT, totals.top2Share > 0.4 ? BAD : GOOD)
    totals.topProjects.forEach((p, i) => kv(`  #${i + 1}  ${p.jiraKey || p.key} — ${p.summary}`, Math.round(p.savingHours ?? 0), N0))
    styleBody(ws, cStart, r - 1, 3)

    r++
    sectionRow(ws, r++, 'DATA QUALITY — OPEN ITEMS', 3)
    const qStart = r
    kv('Projects in plan', quality.total, N0)
    kv('Saving hours still TBC', quality.missingSaving, N0, quality.missingSaving ? WARN : GOOD)
    kv('No PIC assigned', quality.missingPic, N0, quality.missingPic ? WARN : GOOD)
    kv('Mandays not yet entered', quality.estimatedManday, N0, quality.estimatedManday ? WARN : GOOD)
    kv('Past due and not Done', quality.pastDue, N0, quality.pastDue ? BAD : GOOD)
    styleBody(ws, qStart, r - 1, 3)

    r++
    sectionRow(ws, r++, 'MANAGEMENT KPI GUIDELINE (as issued)', 3)
    const oHead = r
    headerRow(ws, r++, ['Objective', 'Objective detail', 'F&A Tech'])
    const oStart = r
    OBJECTIVES.forEach((o, i) => {
      const row = ws.getRow(r++)
      row.getCell(1).value = o.guidelineName || `(under ${OBJECTIVES[i - 1]?.guidelineName})`
      row.getCell(2).value = o.guidelineDetail
      row.getCell(3).value = o.guidelineTarget
      row.getCell(2).alignment = { vertical: 'top', wrapText: true }
      row.getCell(3).alignment = { vertical: 'top', wrapText: true }
      row.height = 30
      if (!o.guidelineName) tone(row.getCell(1), MUTED, false)
    })
    styleBody(ws, oStart, r - 1, 3)
    ws.getRow(oHead).height = 22

    r++
    sectionRow(ws, r++, 'WHAT THE TEAM IS CARRYING AGAINST EACH', 3)
    headerRow(ws, r++, ['Objective', `Hours (${unit})`, 'Feeds pool'])
    const cStart2 = r
    OBJECTIVES.forEach((o) => {
      const row = ws.getRow(r++)
      row.getCell(1).value = `${o.no}.  ${o.name}`
      row.getCell(2).value = Math.round(byObjective[o.id] || 0)
      row.getCell(2).numFmt = N0
      row.getCell(2).alignment = { horizontal: 'right' }
      row.getCell(3).value = o.countsToPool ? 'Yes' : 'Date-gated'
      row.getCell(3).alignment = { horizontal: 'center' }
      if (!o.countsToPool) tone(row.getCell(3), WARN, false)
    })
    styleBody(ws, cStart2, r - 1, 3)
  }

  /* ============ 2. Overall_Objectives ============ */
  {
    const width = 3 + people.length * 3
    const ws = wb.addWorksheet('Overall_Objectives', { properties: { tabColor: { argb: NAVY_MID } }, views: [{ state: 'frozen', xSplit: 3, ySplit: 5 }] })
    banner(ws, 'INDIVIDUAL SCORECARD — WEIGHTS AND TARGETS',
      'Every person totals 100% by construction, split across the objectives that person actually holds.', width)

    // person group headers
    const gRow = ws.getRow(4)
    people.forEach((p, i) => {
      const c0 = 4 + i * 3
      ws.mergeCells(4, c0, 4, c0 + 2)
      const c = gRow.getCell(c0)
      c.value = `${p.nick}  ·  ${p.band}`
      c.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = fill(i % 2 ? NAVY_MID : NAVY)
      c.alignment = { horizontal: 'center', vertical: 'middle' }
    })
    gRow.height = 20

    const labels = ['Block', 'No.', 'KPI line']
    people.forEach(() => labels.push('Target', '%Weight', 'Actual'))
    const widths = [14, 5, 44]
    people.forEach(() => widths.push(20, 10, 11))
    headerRow(ws, 5, labels, widths)

    // Targets come from each person's own KPI line, not from the guideline —
    // the team target is 3,000; individuals each carry their own number.
    const rowSpec = OBJECTIVES.map((o, i) => ({
      id: `obj-${o.id}`, part: 'Individual', no: 1 + i,
      kpi: `[Obj ${o.no}] ${o.name}`, objective: o.id,
    }))

    let r = 6
    const first = r
    rowSpec.forEach((spec) => {
      const row = ws.getRow(r++)
      row.getCell(1).value = spec.part
      row.getCell(2).value = spec.no
      row.getCell(2).alignment = { horizontal: 'center' }
      row.getCell(3).value = spec.kpi
      people.forEach((p, i) => {
        const c0 = 4 + i * 3
        const line = p.kpiLines.find((l) => l.id === spec.id)
        if (!line) {
          row.getCell(c0).value = '—'
          row.getCell(c0 + 1).value = 0
          tone(row.getCell(c0), MUTED, false)
        } else {
          row.getCell(c0).value = fmtTarget(line, settings.savingBasis)
          row.getCell(c0 + 1).value = line.weight
          if (spec.objective) row.getCell(c0 + 2).value = Math.round(p.byObjective[spec.objective] || 0)
          if (line.overridden) tone(row.getCell(c0), NAVY_MID, false)
        }
        row.getCell(c0).alignment = { horizontal: 'center' }
        row.getCell(c0 + 1).numFmt = PCT
        row.getCell(c0 + 1).alignment = { horizontal: 'center' }
        row.getCell(c0 + 2).numFmt = N0
        row.getCell(c0 + 2).alignment = { horizontal: 'right' }
      })
    })
    styleBody(ws, first, r - 1, width)

    r++
    const chk = ws.getRow(r)
    chk.getCell(3).value = 'WEIGHT TOTAL — must be 100%'
    chk.getCell(3).font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } }
    people.forEach((p, i) => {
      // Rounded so a card that adds to 100% writes 1, not 0.9999999999999999.
    const sum = Math.round(p.kpiLines.reduce((a, l) => a + l.weight, 0) * 1e6) / 1e6
      const c = chk.getCell(4 + i * 3 + 1)
      c.value = sum
      c.numFmt = PCT
      c.alignment = { horizontal: 'center' }
      tone(c, Math.abs(sum - 1) < 1e-9 ? GOOD : BAD)
      c.fill = fill(Math.abs(sum - 1) < 1e-9 ? 'FFEAF7EA' : 'FFFDECEC')
    })
    chk.height = 20
    for (let c = 1; c <= width; c++) chk.getCell(c).border = { top: { style: 'medium', color: { argb: NAVY } }, bottom: thin }
  }

  /* ============ 3. Projects ============ */
  {
    const cols = [
      ['Jira', 12], ['Project', 44], ['Programme', 26], ['Team', 13], ['Sub team', 18],
      ['Objective', 24], ['PIC', 12], [`Saving ${unit}`, 13], ['HC', 8], ['Mandays', 10],
      ['Ratio', 9], ['Gate', 9], ['Commit', 11], ['Status', 12], ['Start', 11], ['Due', 11], ['Remark', 40],
    ]
    const ws = wb.addWorksheet('Projects', {
      properties: { tabColor: { argb: 'FF1B6091' } },
      views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    banner(ws, 'PROJECT REGISTER',
      `${projects.length} projects · ${Math.round(totals.headlineHours).toLocaleString()} ${unit} committed · source: ${state.meta?.source || 'plan'}`,
      cols.length)
    headerRow(ws, 4, cols.map((c) => c[0]), cols.map((c) => c[1]))
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + projects.length, column: cols.length } }

    let r = 5
    const first = r
    const sorted = [...projects].sort((a, b) => (b.savingHours ?? 0) - (a.savingHours ?? 0))
    sorted.forEach((p) => {
      const person = people.find((x) => x.id === p.pic)
      const row = ws.getRow(r++)
      row.values = [
        p.jiraKey || '',
        p.summary,
        p.program || '',
        p.team || '',
        p.subTeam || '',
        OBJ_BY_ID[p.objective] ? `${OBJ_BY_ID[p.objective].no}. ${OBJ_BY_ID[p.objective].name}` : '',
        person ? person.nick : 'TBC',
        p.savingHours ?? null,
        p.hc ?? null,
        p.manday || null,
        p.ratio == null ? null : Number(p.ratio.toFixed(2)),
        p.gate === 'unknown' ? '' : p.gate === 'pass' ? 'Pass' : 'Below',
        p.commitLevel,
        p.status || '',
        p.start || '',
        p.due || '',
        p.notes || '',
      ]
      row.getCell(1).font = { name: FONT, size: 9.5, bold: true }
      ;[8, 9, 10, 11].forEach((c) => {
        row.getCell(c).numFmt = c === 9 || c === 11 ? N1 : N0
        row.getCell(c).alignment = { horizontal: 'right' }
      })
      ;[7, 12, 13, 14].forEach((c) => { row.getCell(c).alignment = { horizontal: 'center' } })
      row.getCell(17).alignment = { vertical: 'middle', wrapText: false }

      if (!person) tone(row.getCell(7), BAD)
      if (p.savingHours == null) tone(row.getCell(8), WARN)
      if (p.gate === 'fail') tone(row.getCell(12), BAD)
      if (p.gate === 'pass') tone(row.getCell(12), GOOD)
      const lvl = { commit: GOOD, stretch: NAVY_MID, watch: WARN, nextyear: 'FF7C5CD6', excluded: MUTED }[p.commitLevel]
      tone(row.getCell(13), lvl)
      if (p.pastDue) tone(row.getCell(16), BAD)
    })
    styleBody(ws, first, r - 1, cols.length)

    // totals strip
    const tr = ws.getRow(r)
    tr.getCell(2).value = `TOTAL — ${projects.length} projects`
    tr.getCell(8).value = { formula: `SUM(H${first}:H${r - 1})` }
    tr.getCell(9).value = { formula: `SUM(I${first}:I${r - 1})` }
    tr.getCell(10).value = { formula: `SUM(J${first}:J${r - 1})` }
    tr.getCell(8).numFmt = N0
    tr.getCell(9).numFmt = N1
    tr.getCell(10).numFmt = N0
    for (let c = 1; c <= cols.length; c++) {
      const cell = tr.getCell(c)
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = fill(NAVY)
      cell.alignment = { horizontal: c >= 8 && c <= 11 ? 'right' : 'left', vertical: 'middle' }
    }
    tr.height = 20
  }

  /* ============ 4. one sheet per person ============ */
  for (const p of people) {
    const cols = [
      ['Jira', 12], ['Project', 42], ['Objective', 22], ['Role', 11], ['Share', 9],
      [`Project ${unit}`, 14], ['Credited', 11], ['Mandays', 10], ['Ratio', 9], ['Commit', 11], ['Status', 13],
    ]
    const safe = `Obj-${p.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31)
    const ws = wb.addWorksheet(safe, { views: [{ state: 'frozen', ySplit: 12 }] })
    banner(ws, `${p.name.toUpperCase()}  ·  ${p.nick}`,
      `${p.role} · band ${p.band} · holds ${p.objectives.map((o) => `Obj ${OBJ_BY_ID[o]?.no}`).join(', ') || 'no objectives'}`,
      cols.length)

    let r = 4
    sectionRow(ws, r++, 'POSITION', cols.length)
    const sStart = r
    const kv = (label, value, fmt, colour) => {
      const row = ws.getRow(r++)
      row.getCell(1).value = label
      ws.mergeCells(row.number, 1, row.number, 2)
      const v = row.getCell(3)
      v.value = value
      if (fmt) v.numFmt = fmt
      v.alignment = { horizontal: 'left' }
      if (colour) tone(v, colour)
    }
    kv(p.aggregatesTeam ? `Team saving hours (${unit}) — whole team` : `Credited saving hours (${unit})`, Math.round(p.scorecardHours), N0, NAVY)
    kv('Committed only', Math.round(p.commitHours), N0)
    kv('Mandays credited', Math.round(p.scorecardManday), N0)
    kv('Efficiency ratio', p.ratio == null ? 'not yet measurable' : Number(p.ratio.toFixed(2)), p.ratio == null ? undefined : N1,
      p.ratio == null ? MUTED : p.ratio >= settings.ratioGate ? GOOD : BAD)
    kv('Projects credited / touched', p.aggregatesTeam ? `[TEAM] ${p.scorecardCount} in plan · ${p.ownCount} their own` : `[PERSONAL] ${p.countedCount} / ${p.projectCount}`)
    kv('Saving hours still TBC', p.missingSaving, N0, p.missingSaving ? WARN : GOOD)
    styleBody(ws, sStart, r - 1, 3, { zebra: false })

    r++
    sectionRow(ws, r++, 'KPI SCORECARD', cols.length)
    headerRow(ws, r++, ['Block', 'KPI line', `${p.nick}'s target`, 'Weight', '', '', '', '', '', '', ''])
    const wStart = r
    p.kpiLines.forEach((l) => {
      const o = l.objective ? OBJ_BY_ID[l.objective] : null
      const row = ws.getRow(r++)
      row.getCell(1).value = l.block
      row.getCell(2).value = o ? `Obj ${o.no} — ${o.name}` : l.label
      row.getCell(3).value = fmtTarget(l, settings.savingBasis)
      row.getCell(4).value = l.weight
      row.getCell(4).numFmt = PCT
      row.getCell(4).alignment = { horizontal: 'center' }
      if (l.overridden) tone(row.getCell(3), NAVY_MID, false)
    })
    // Rounded so a card that adds to 100% writes 1, not 0.9999999999999999.
    const sum = Math.round(p.kpiLines.reduce((a, l) => a + l.weight, 0) * 1e6) / 1e6
    const sr = ws.getRow(r++)
    sr.getCell(3).value = 'TOTAL'
    sr.getCell(4).value = sum
    sr.getCell(4).numFmt = PCT
    sr.getCell(4).alignment = { horizontal: 'center' }
    tone(sr.getCell(3), NAVY)
    tone(sr.getCell(4), Math.abs(sum - 1) < 0.0005 ? GOOD : BAD)
    styleBody(ws, wStart, r - 1, 4)

    r++
    sectionRow(ws, r++, 'PROJECT PORTFOLIO', cols.length)
    headerRow(ws, r++, cols.map((c) => c[0]), cols.map((c) => c[1]))
    const pStart = r
    const rowsSorted = [...p.scorecardRows].sort((a, b) => (b.p.savingHours ?? 0) * b.share - (a.p.savingHours ?? 0) * a.share)
    rowsSorted.forEach(({ p: pr, share }) => {
      const roles = pr.contributors?.find((c) => c.person === p.id)?.roles.join('/') || (pr.pic === p.id ? 'pic' : '—')
      // Deferred and excluded projects credit nothing — printing their share
      // would contradict the TOTAL CREDITED row below.
      const counted = pr.commitLevel === 'commit' || pr.commitLevel === 'stretch'
      const row = ws.getRow(r++)
      row.values = [
        pr.jiraKey || '',
        pr.summary,
        OBJ_BY_ID[pr.objective] ? `${OBJ_BY_ID[pr.objective].no}. ${OBJ_BY_ID[pr.objective].short}` : '',
        roles,
        share,
        pr.savingHours ?? null,
        !counted || pr.savingHours == null ? null : Number(((pr.savingHours ?? 0) * share).toFixed(1)),
        pr.manday || null,
        pr.ratio == null ? null : Number(pr.ratio.toFixed(2)),
        pr.commitLevel,
        pr.status || '',
      ]
      row.getCell(1).font = { name: FONT, size: 9.5, bold: true }
      row.getCell(5).numFmt = PCT
      ;[6, 7, 8].forEach((c) => { row.getCell(c).numFmt = N0 })
      row.getCell(9).numFmt = N1
      ;[5, 6, 7, 8, 9].forEach((c) => { row.getCell(c).alignment = { horizontal: 'right' } })
      ;[4, 10, 11].forEach((c) => { row.getCell(c).alignment = { horizontal: 'center' } })
      tone(row.getCell(10), { commit: GOOD, stretch: NAVY_MID, watch: WARN, nextyear: 'FF7C5CD6', excluded: MUTED }[pr.commitLevel])
    })
    if (r > pStart) styleBody(ws, pStart, r - 1, cols.length)

    const tr = ws.getRow(r)
    tr.getCell(2).value = 'TOTAL CREDITED'
    tr.getCell(7).value = Math.round(p.scorecardHours)
    tr.getCell(7).numFmt = N0
    for (let c = 1; c <= cols.length; c++) {
      const cell = tr.getCell(c)
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = fill(NAVY)
      cell.alignment = { horizontal: c === 7 ? 'right' : 'left', vertical: 'middle' }
    }
    tr.height = 20
  }

  return wb
}

export const exportFilename = () =>
  `F&A Tech Team Objective 2026 — ${new Date().toISOString().slice(0, 10)}.xlsx`

/** Builds and downloads. Browser only. */
export async function exportWorkbook(plan, state) {
  const wb = await buildWorkbook(plan, state)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = exportFilename()
  a.click()
  URL.revokeObjectURL(url)
}
