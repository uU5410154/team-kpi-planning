import ExcelJS from 'exceljs'
import { OBJECTIVES, OBJ_BY_ID, OUT_OF_PLAN } from './palette.js'
import {
  SAVING_BASIS, targetUnit, gateAsHoursPerManday, gateAsPaybackMonths, fmtMonths,
  MONTH_LABELS, MONTHS_IN_YEAR, countsToPool,
} from './model.js'

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
// Money and returns stay NUMERIC in the workbook — a target written as the
// string "฿132,949/year" is unsortable and unsummable, which defeats the point
// of exporting to Excel at all. The unit lives in the column header and in the
// number format, never in the value.
const MONEY = '#,##0'
const ROI = '+0%;-0%;0%'

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

/**
 * Write a KPI target into a cell.
 *
 * Numeric targets go in as NUMBERS with the unit carried by the number format,
 * never as pre-formatted strings: a target written as "฿132,949/year" cannot be
 * sorted, summed or charted, which is most of the reason to export to Excel.
 * Only a milestone target, which has no number in it, goes in as text.
 */
function writeTarget(cell, line, basis, currency) {
  if (line.targetKind === 'thb') {
    cell.value = Math.round(Number(line.target || 0))
    cell.numFmt = `#,##0" ${currency}/yr"`
  } else if (line.targetKind === 'hours') {
    cell.value = Number(line.target || 0)
    cell.numFmt = basis === 'monthly' ? '#,##0" hrs/mth"' : '#,##0" hrs/yr"'
  } else {
    cell.value = String(line.target ?? '—')
  }
  cell.alignment = { horizontal: 'center' }
}

/* ------------------------------------------------------------------ */
/* workbook                                                            */
/* ------------------------------------------------------------------ */

/** Builds the workbook. Pure — no DOM — so it can be exercised from Node. */
export async function buildWorkbook(plan, state) {
  const { totals, people, projects, quality, settings, byObjective, finance: fin } = plan
  const stamp = new Date().toISOString().slice(0, 10)
  const basis = SAVING_BASIS[settings.savingBasis]
  const unit = settings.savingBasis === 'monthly' ? 'hrs/month' : 'hrs/year'
  const cur = fin.currency

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
    kv('FTE committed (from the FTE column)', totals.committedHC, N1)
    styleBody(ws, bridgeStart, r - 1, 3)

    r++
    sectionRow(ws, r++, `OBJECTIVE 1 — IS THE BUILD WORTH IT (${cur})`, 3)
    const gateStart = r
    kv('Developer salary (per month)', fin.devMonthlySalary, MONEY)
    kv('  = cost of one manday', Math.round(fin.devDayRate), MONEY)
    kv('Accountant salary (per month)', fin.acctMonthlySalary, MONEY)
    kv('  = value of one saved hour', Math.round(fin.acctHourRate), MONEY)
    kv('On-cost multiplier applied to both', fin.loadFactor, N1)
    kv('Hours per FTE / month (the FTE ratio)', fin.hoursPerFteMonth, N1)
    kv('Hours per manday', fin.hoursPerManday, N1)
    kv('Saving-hours basis', basis.label)
    r++
    kv('FTE released (saving hours ÷ the ratio)', Number(fin.fteReleased.toFixed(2)), N1, NAVY)
    kv('Value of hours released (per month)', Math.round(fin.monthlyBenefit), MONEY)
    kv('Value of hours released (per year)', Math.round(fin.annualBenefit), MONEY, NAVY)
    kv(`Benefit over the ${fin.horizonMonths}-month horizon`, Math.round(fin.horizonBenefit), MONEY)
    r++
    // The whole-plan spend, whether or not it can carry a return — this is the
    // budget view, and it must reconcile to the Costs sheet and the Projects
    // sheet's own totals strip.
    kv('Build cost across the plan (mandays x the day rate)', Math.round(fin.planBuildCost), MONEY)
    kv('CAPEX across the plan (one-off, not depreciated)', Math.round(fin.planCapex), MONEY)
    kv('  = total one-off investment across the plan', Math.round(fin.planInvestment), MONEY, NAVY)
    kv('OPEX across the plan (2026 monthly grid, summed)', Math.round(fin.planOpexYear), MONEY)
    kv('  = OPEX run-rate, per month', Math.round(fin.planOpexRunRate), MONEY)
    r++
    kv('Investment in projects with BOTH a cost and a benefit',
      fin.investment == null ? 'not estimated yet' : Math.round(fin.investment), fin.investment == null ? undefined : MONEY)
    kv('  of which build cost',
      fin.buildCost == null ? 'not estimated yet' : Math.round(fin.buildCost), fin.buildCost == null ? undefined : MONEY)
    kv('  of which CAPEX',
      fin.capex == null ? 'not estimated yet' : Math.round(fin.capex), fin.capex == null ? undefined : MONEY)
    kv('  OPEX charged against those, per month', Math.round(fin.opexRunRate), MONEY, fin.opexRunRate > 0 ? WARN : undefined)
    if (fin.unreturnedCost > 0) {
      kv(`  investment in ${fin.unreturnedCount} project(s) whose benefit is still TBC`,
        Math.round(fin.unreturnedCost), MONEY, WARN)
      kv('  = total investment committed across the plan',
        Math.round(fin.investment + fin.unreturnedCost), MONEY)
    }
    kv('Net benefit over the horizon (after OPEX, after investment)',
      fin.netBenefit == null ? 'not measurable without a cost' : Math.round(fin.netBenefit),
      fin.netBenefit == null ? undefined : MONEY,
      fin.netBenefit == null ? MUTED : fin.netBenefit >= 0 ? GOOD : BAD)
    kv('RETURN ON INVESTMENT',
      fin.roi == null ? 'not measurable without a cost' : Number(fin.roi.toFixed(4)),
      fin.roi == null ? undefined : ROI,
      fin.roi == null ? MUTED : fin.roi >= fin.roiGate ? GOOD : BAD)
    kv('  covering this share of the benefit', fin.roiCoverage, PCT, fin.roiCoverage >= 1 ? GOOD : WARN)
    kv('  projects still without any cost estimate', fin.uncostedCount, N0, fin.uncostedCount ? WARN : GOOD)
    r++
    kv('Gate — minimum return', fin.roiGate, ROI)
    kv('  as a payback period', fmtMonths(gateAsPaybackMonths(fin)))
    kv('  as saving hours per manday', Number((gateAsHoursPerManday(fin) ?? 0).toFixed(2)), N1)
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
    kv('No cost at all — no mandays and no CAPEX (blocks ROI)', quality.uncosted, N0, quality.uncosted ? WARN : GOOD)
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
          writeTarget(row.getCell(c0), line, settings.savingBasis, cur)
          row.getCell(c0 + 1).value = line.weight
          // The "Actual" column matches the target's own unit: baht a year for
          // objective 1, saving hours for the rest.
          if (spec.objective) {
            const money = line.targetKind === 'thb'
            row.getCell(c0 + 2).value = Math.round(
              money ? (p.benefitByObjective[spec.objective] || 0) : (p.byObjective[spec.objective] || 0),
            )
            row.getCell(c0 + 2).numFmt = money ? MONEY : N0
          }
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
    /*
     * Every column carries its own width, number format, alignment and — where
     * it is a number — the value to read out of a project. Indices are then
     * DERIVED from this list rather than hardcoded further down: adding CAPEX,
     * OPEX and Investment to a sheet that had twenty-three hand-numbered cells
     * would otherwise have silently shifted the format of every column after
     * them.
     */
    const cols = [
      { label: 'Jira', width: 12, align: 'left' },
      { label: 'Project', width: 44, align: 'left' },
      { label: 'Programme', width: 26, align: 'left' },
      { label: 'Team', width: 13, align: 'left' },
      { label: 'Sub team', width: 18, align: 'left' },
      { label: 'Objective', width: 24, align: 'left' },
      { label: 'PIC', width: 12, align: 'center' },
      { label: `Saving ${unit}`, width: 13, fmt: N0 },
      // Headed FTE to match the app and the source workbook's own meaning; the
      // value behind it is still the stored `hc` field.
      { label: 'FTE', width: 8, fmt: N1 },
      { label: 'Mandays', width: 10, fmt: N0 },
      { label: `Build cost (${cur})`, width: 14, fmt: MONEY },
      { label: `CAPEX (${cur})`, width: 13, fmt: MONEY },
      { label: `Investment (${cur})`, width: 14, fmt: MONEY },
      { label: `OPEX/mth (${cur})`, width: 13, fmt: MONEY },
      { label: `OPEX 2026 (${cur})`, width: 14, fmt: MONEY },
      { label: `Benefit/yr (${cur})`, width: 15, fmt: MONEY },
      { label: `Benefit ${fin.horizonMonths}mo (${cur})`, width: 16, fmt: MONEY },
      { label: `Net of OPEX ${fin.horizonMonths}mo (${cur})`, width: 18, fmt: MONEY },
      { label: `Net (${cur})`, width: 14, fmt: MONEY },
      { label: 'ROI', width: 10, fmt: ROI },
      { label: 'Payback (mo)', width: 12, fmt: N1 },
      { label: 'Break-even mandays', width: 15, fmt: N0 },
      { label: 'Gate', width: 9, align: 'center' },
      { label: 'Commit', width: 11, align: 'center' },
      { label: 'Status', width: 12, align: 'center' },
      { label: 'Start', width: 11, align: 'left' },
      { label: 'Due', width: 11, align: 'left' },
      { label: 'Remark', width: 40, align: 'left' },
    ]
    // 1-based column index by header label. Everything below asks for a column
    // by name, so inserting one can never mis-format its neighbours.
    const ix = (label) => cols.findIndex((c) => c.label.startsWith(label)) + 1
    const colLetter = (n) => {
      let s = ''
      for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
      return s
    }

    const ws = wb.addWorksheet('Projects', {
      properties: { tabColor: { argb: 'FF1B6091' } },
      views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    banner(ws, 'PROJECT REGISTER',
      `${projects.length} projects · ${Math.round(totals.headlineHours).toLocaleString()} ${unit} committed · source: ${state.meta?.source || 'plan'}`,
      cols.length)
    headerRow(ws, 4, cols.map((c) => c.label), cols.map((c) => c.width))
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + projects.length, column: cols.length } }

    const money = (v) => (v == null ? null : Math.round(v))
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
        p.fte ?? null,
        p.manday || null,
        money(p.buildCost),
        money(p.capex),
        money(p.investment),
        // A zero run-rate means "no operating cost entered", which reads better
        // as an empty cell than as a nought in a column of baht.
        p.opexRunRate > 0 ? Math.round(p.opexRunRate) : null,
        p.opexYear > 0 ? Math.round(p.opexYear) : null,
        money(p.annualBenefit),
        money(p.horizonBenefit),
        money(p.netHorizonBenefit),
        money(p.netBenefit),
        p.roi == null ? null : Number(p.roi.toFixed(4)),
        p.paybackMonths == null ? null : Number(p.paybackMonths.toFixed(1)),
        p.breakEvenMandays == null ? null : Math.round(p.breakEvenMandays),
        p.gate === 'unknown' ? '' : p.gate === 'pass' ? 'Pass' : 'Below',
        p.commitLevel,
        p.status || '',
        p.start || '',
        p.due || '',
        p.notes || '',
      ]
      row.getCell(1).font = { name: FONT, size: 9.5, bold: true }
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 1)
        if (c.fmt) { cell.numFmt = c.fmt; cell.alignment = { horizontal: 'right' } }
        else if (c.align === 'center') cell.alignment = { horizontal: 'center' }
      })
      row.getCell(ix('Remark')).alignment = { vertical: 'middle', wrapText: false }

      if (!person) tone(row.getCell(ix('PIC')), BAD)
      if (p.savingHours == null) tone(row.getCell(ix('Saving')), WARN)
      if (p.netBenefit != null) tone(row.getCell(ix('Net (')), p.netBenefit >= 0 ? GOOD : BAD, false)
      if (p.opexRunRate > 0) tone(row.getCell(ix('OPEX/mth')), WARN, false)
      if (p.gate === 'fail') { tone(row.getCell(ix('ROI')), BAD); tone(row.getCell(ix('Gate')), BAD) }
      if (p.gate === 'pass') { tone(row.getCell(ix('ROI')), GOOD); tone(row.getCell(ix('Gate')), GOOD) }
      const lvl = { commit: GOOD, stretch: NAVY_MID, watch: WARN, nextyear: 'FF7C5CD6', excluded: MUTED }[p.commitLevel]
      tone(row.getCell(ix('Commit')), lvl)
      if (p.pastDue) tone(row.getCell(ix('Due')), BAD)
    })
    styleBody(ws, first, r - 1, cols.length)

    // totals strip
    const tr = ws.getRow(r)
    tr.getCell(2).value = `TOTAL — ${projects.filter((p) => !OUT_OF_PLAN.has(p.commitLevel)).length} in-plan of ${projects.length} projects`
    // Live SUM()s, so the workbook still adds up after someone edits a cell.
    // ROI, payback and break-even are deliberately NOT summed — an average of
    // ratios is not a portfolio return. The Summary sheet carries that figure.
    // IN-PLAN ONLY, via SUMIFS on the Commit column. A plain SUM() spanned every
    // exported row including Excluded and Next year, so this strip disagreed
    // with both the Summary and the Costs sheet on every money line the moment
    // a project was deferred. The sheet still LISTS those rows — it is the
    // register — but they contribute nothing, exactly as in the app.
    const cl = colLetter(ix('Commit'))
    const range = (n) => `${colLetter(n)}${first}:${colLetter(n)}${r - 1}`
    const summed = ['Saving', 'FTE', 'Mandays', 'Build cost', 'CAPEX', 'Investment',
      'OPEX/mth', 'OPEX 2026', 'Benefit/yr', `Benefit ${fin.horizonMonths}mo`, 'Net of OPEX', 'Net (']
    summed.forEach((label) => {
      const n = ix(label)
      if (n <= 0) return
      tr.getCell(n).value = {
        formula: `SUMIFS(${range(n)},${cl}${first}:${cl}${r - 1},"<>nextyear",${cl}${first}:${cl}${r - 1},"<>excluded")`,
      }
      tr.getCell(n).numFmt = cols[n - 1].fmt
    })
    tr.getCell(ix('Commit')).value = 'in plan only'
    for (let c = 1; c <= cols.length; c++) {
      const cell = tr.getCell(c)
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = fill(NAVY)
      cell.alignment = { horizontal: cols[c - 1].fmt ? 'right' : 'left', vertical: 'middle' }
    }
    tr.height = 20
  }

  /* ============ 4. Costs — the monthly cost grid ============
   * Laid out like the source budget sheet (BG 2026): identifying columns, a
   * yearly amount, a note, then twelve monthly columns in G..R and an FY total
   * in S — the same cells, so the two can be read side by side.
   *
   * Deliberately NOT like BG 2026 in one respect: no depreciation. CAPEX sits
   * on its own one-off row and is never spread across the months, which is the
   * decision the team took.
   */
  {
    const cols = [
      ['Jira', 12], ['Project', 40], ['Cost type', 12], ['Item', 30],
      [`Yearly (${cur})`, 14], ['Note', 30],
      ...MONTH_LABELS.map((m) => [`${m}-26`, 11]),
      [`FY2026 (${cur})`, 15],
    ]
    const MONTH_1 = 7          // column G, exactly as in BG 2026
    const FY_COL = MONTH_1 + MONTHS_IN_YEAR  // column S
    const ws = wb.addWorksheet('Costs', {
      properties: { tabColor: { argb: 'FF7C5CD6' } },
      views: [{ state: 'frozen', xSplit: 4, ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    banner(ws, 'PROJECT COSTS — CAPEX AND OPEX',
      `Monthly operating cost across 2026 in G..R with the FY total in S, as in BG 2026 · one-off investment on its own rows · ${cur} · no depreciation applied`,
      cols.length)
    headerRow(ws, 4, cols.map((c) => c[0]), cols.map((c) => c[1]))

    let r = 5
    const first = r
    /** One row of the grid. `months` is a 12-array or null for a one-off row. */
    // The FY cell is the sum of the ROUNDED month cells, not a separately
    // rounded product: this grid is sold as summable, so selecting G:R in Excel
    // has to give the same number the S column prints.
    const fySum = (months) => (months || []).reduce((a, m) => a + Math.round(m || 0), 0)
    const costRow = (p, type, item, yearly, note, months, fy, opts = {}) => {
      const row = ws.getRow(r++)
      row.getCell(1).value = p ? (p.jiraKey || p.key) : ''
      row.getCell(2).value = p ? p.summary : ''
      row.getCell(3).value = type
      row.getCell(4).value = item
      row.getCell(5).value = yearly == null ? null : Math.round(yearly)
      row.getCell(5).numFmt = MONEY
      row.getCell(6).value = note || ''
      for (let m = 0; m < MONTHS_IN_YEAR; m++) {
        const cell = row.getCell(MONTH_1 + m)
        // Numbers, never pre-formatted strings — the whole point of a monthly
        // grid is that it can be summed, charted and compared in Excel.
        cell.value = months && months[m] > 0 ? Math.round(months[m]) : null
        cell.numFmt = MONEY
        cell.alignment = { horizontal: 'right' }
      }
      const fyCell = row.getCell(FY_COL)
      // When the row HAS a month grid, the FY total is the sum of the cells
      // actually written. Rounding the annual product separately made a grid
      // that Excel's own status bar disagreed with.
      fyCell.value = months ? fySum(months) : (fy == null ? null : Math.round(fy))
      fyCell.numFmt = MONEY
      fyCell.alignment = { horizontal: 'right' }
      row.getCell(3).alignment = { horizontal: 'center' }
      if (opts.bold) {
        for (let c = 1; c <= cols.length; c++) row.getCell(c).font = { name: FONT, size: 9.5, bold: true }
      }
      return row
    }

    const withCost = projects.filter((p) => !OUT_OF_PLAN.has(p.commitLevel)
      && (p.buildCost != null || p.capex != null || (p.opex || []).length > 0))

    if (!withCost.length) {
      const row = ws.getRow(r++)
      row.getCell(1).value = 'No CAPEX, OPEX or build effort has been entered on any in-plan project yet.'
      row.getCell(2).value = 'Click a project row on the Projects tab or on any scorecard to add its costs.'
      tone(row.getCell(1), MUTED, false)
    }

    for (const p of withCost) {
      for (const l of p.opex) {
        const active = new Array(MONTHS_IN_YEAR).fill(0)
        for (let m = l.startMonth; m <= l.endMonth; m++) active[m - 1] = l.monthly
        const months = l.endMonth - l.startMonth + 1
        costRow(p, 'OPEX', l.label, l.monthly * months,
          `${MONTH_LABELS[l.startMonth - 1]}–${MONTH_LABELS[l.endMonth - 1]} · ${Math.round(l.monthly).toLocaleString()}/month`,
          active, l.monthly * months)
      }
      if (p.opex.length) {
        costRow(p, 'OPEX', 'OPEX total', p.opexYear, 'sum of the lines above', p.opexByMonth, p.opexYear, { bold: true })
      }
      if (p.capex != null) {
        costRow(p, 'CAPEX', p.capexNote || 'Capital investment', p.capex,
          'one-off — charged whole, not depreciated', null, p.capex)
      }
      if (p.buildCost != null) {
        costRow(p, 'BUILD', `${Math.round(p.manday).toLocaleString()} mandays`, p.buildCost,
          `mandays x ${Math.round(fin.devDayRate).toLocaleString()} a day`, null, p.buildCost)
      }
      costRow(p, 'TOTAL', 'Project total 2026', (p.investment ?? 0) + p.opexYear,
        'one-off investment + the year of OPEX', null, (p.investment ?? 0) + p.opexYear, { bold: true })
    }
    styleBody(ws, first, r - 1, cols.length, { zebra: false })

    // grand totals, matching the Summary sheet's plan-wide figures
    r++
    sectionRow(ws, r++, 'ACROSS THE WHOLE PLAN', cols.length)
    const gStart = r
    // Everything on this sheet is IN-PLAN ONLY, matching the Summary and the
    // Projects totals strip. Deferred and excluded projects are listed on the
    // Projects sheet but cost the plan nothing, so they carry no grid here.
    costRow(null, 'OPEX', 'OPEX — every in-plan project', fin.planOpexYear,
      `run-rate ${Math.round(fin.planOpexRunRate).toLocaleString()} a month`, fin.planOpexByMonth, fin.planOpexYear, { bold: true })
    costRow(null, 'CAPEX', 'CAPEX — every in-plan project', fin.planCapex,
      'one-off — not depreciated', null, fin.planCapex, { bold: true })
    costRow(null, 'BUILD', 'Build cost — every in-plan project', fin.planBuildCost,
      'mandays x the developer day rate', null, fin.planBuildCost, { bold: true })
    const grand = costRow(null, 'TOTAL', 'PLAN TOTAL 2026', fin.planInvestment + fin.planOpexYear,
      'investment + the year of OPEX', null, fin.planInvestment + fin.planOpexYear, { bold: true })
    for (let c = 1; c <= cols.length; c++) {
      grand.getCell(c).fill = fill(NAVY)
      grand.getCell(c).font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
    }
    styleBody(ws, gStart, r - 2, cols.length, { zebra: false })
    grand.height = 20
  }

  /* ============ 5. Effort & Return — mandays, ROI and payback ============
   *
   * Asked for as its own sheet. One block per project: the task lines that make
   * up its effort, then the project total, then what that effort costs and what
   * it returns. Every figure here is the same one computePlan produced — the
   * suite reconciles this sheet against the Projects sheet row for row, so the
   * two can never drift.
   */
  {
    const cols = [
      ['Jira', 12], ['Project', 40], ['PIC', 12], ['Line', 30],
      ['Mandays', 11], [`Cost (${cur})`, 14],
      [`CAPEX (${cur})`, 13], [`Investment (${cur})`, 15],
      [`OPEX/mth (${cur})`, 13], [`Benefit/yr (${cur})`, 15],
      ['ROI', 10], ['Payback (mo)', 12], ['Gate', 9], ['Commit', 11],
    ]
    const ws = wb.addWorksheet('Effort_Return', {
      properties: { tabColor: { argb: 'FF7C5CD6' } },
      views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    banner(ws, 'EFFORT AND RETURN',
      `mandays at ${Math.round(fin.devDayRate).toLocaleString()} ${cur} each · return over ${fin.horizonMonths} months · gate ${Math.round(fin.roiGate * 100)}%`,
      cols.length)
    headerRow(ws, 4, cols.map((c) => c[0]), cols.map((c) => c[1]))

    let r = 5
    const first = r
    const inPlan = projects.filter((p) => !OUT_OF_PLAN.has(p.commitLevel))
    const sorted = [...inPlan].sort((a, b) => (b.manday || 0) - (a.manday || 0))

    for (const p of sorted) {
      const person = people.find((x) => x.id === p.pic)
      const tasks = p.tasks || []

      // The task lines, where there are any. A project imported with a bare
      // total gets ONE line saying so, which is exactly what the app shows when
      // its breakdown is opened.
      const lines = tasks.length
        ? tasks.map((t) => [t.label || '(unnamed task)', t.manday])
        : (p.manday > 0 ? [['Total as entered', p.manday]] : [])

      for (const [label, md] of lines) {
        const row = ws.getRow(r++)
        row.getCell(1).value = p.jiraKey || ''
        row.getCell(2).value = p.summary
        row.getCell(4).value = label
        row.getCell(5).value = md
        row.getCell(5).numFmt = N1
        row.getCell(6).value = Math.round(md * fin.devDayRate)
        row.getCell(6).numFmt = MONEY
        for (const c of [5, 6]) row.getCell(c).alignment = { horizontal: 'right' }
        tone(row.getCell(4), MUTED, false)
      }

      // The project line: its total effort and everything that follows from it.
      const tr = ws.getRow(r++)
      tr.values = [
        p.jiraKey || '',
        p.summary,
        person ? person.nick : 'TBC',
        lines.length > 1 ? `TOTAL — ${lines.length} tasks` : 'TOTAL',
        p.manday || null,
        p.buildCost == null ? null : Math.round(p.buildCost),
        p.capex == null ? null : Math.round(p.capex),
        p.investment == null ? null : Math.round(p.investment),
        p.opexRunRate > 0 ? Math.round(p.opexRunRate) : null,
        p.annualBenefit == null ? null : Math.round(p.annualBenefit),
        p.roi == null ? null : Number(p.roi.toFixed(4)),
        p.paybackMonths == null ? null : Number(p.paybackMonths.toFixed(1)),
        p.gate === 'unknown' ? '' : p.gate === 'pass' ? 'Pass' : 'Below',
        p.commitLevel,
      ]
      tr.getCell(5).numFmt = N1
      for (const c of [6, 7, 8, 9, 10]) tr.getCell(c).numFmt = MONEY
      tr.getCell(11).numFmt = ROI
      tr.getCell(12).numFmt = N1
      for (let c = 5; c <= 12; c++) tr.getCell(c).alignment = { horizontal: 'right' }
      for (const c of [3, 13, 14]) tr.getCell(c).alignment = { horizontal: 'center' }
      for (let c = 1; c <= cols.length; c++) tr.getCell(c).font = { name: FONT, size: 9.5, bold: true }
      if (p.gate === 'fail') { tone(tr.getCell(11), BAD); tone(tr.getCell(13), BAD) }
      if (p.gate === 'pass') { tone(tr.getCell(11), GOOD); tone(tr.getCell(13), GOOD) }
      // Payback is blank when OPEX is at or above the benefit — say why here
      // too, since this sheet is read on its own.
      // "never" means the running cost eats the benefit — NOT that the benefit
      // is merely unknown, which is a blank.
      if (p.investment != null && p.paybackMonths == null && p.netMonthly != null && p.netMonthly <= 0) {
        tr.getCell(12).value = 'never'
        tone(tr.getCell(12), BAD)
      }
    }
    styleBody(ws, first, r - 1, cols.length)

    const gr = ws.getRow(r)
    gr.getCell(2).value = `PLAN TOTAL — ${inPlan.length} in-plan projects`
    gr.getCell(5).value = Math.round(fin.planMandays * 10) / 10
    gr.getCell(5).numFmt = N1
    gr.getCell(6).value = fin.planBuildCost == null ? null : Math.round(fin.planBuildCost)
    gr.getCell(7).value = Math.round(fin.planCapex)
    gr.getCell(8).value = Math.round(fin.planInvestment)
    gr.getCell(9).value = Math.round(fin.planOpexRunRate)
    gr.getCell(10).value = Math.round(fin.annualBenefit)
    for (const c of [6, 7, 8, 9, 10]) gr.getCell(c).numFmt = MONEY
    gr.getCell(11).value = fin.roi == null ? null : Number(fin.roi.toFixed(4))
    gr.getCell(11).numFmt = ROI
    gr.getCell(12).value = fin.paybackMonths == null ? null : Number(fin.paybackMonths.toFixed(1))
    gr.getCell(12).numFmt = N1
    for (let c = 1; c <= cols.length; c++) {
      const cell = gr.getCell(c)
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = fill(NAVY)
      cell.alignment = { horizontal: c >= 5 && c <= 12 ? 'right' : 'left', vertical: 'middle' }
    }
    gr.height = 20
  }

  /* ============ 6. one sheet per person ============ */
  for (const p of people) {
    // Money columns carry this person's SHARE of each project, so the column
    // adds up to the figure in their POSITION block rather than to the whole
    // project. ROI is share-invariant — both sides scale together.
    const cols = [
      ['Jira', 12], ['Project', 42], ['Objective', 22], ['Role', 11], ['Share', 9],
      [`Project ${unit}`, 14], ['Credited', 11], ['Mandays', 10],
      [`Build cost (${cur})`, 14], [`CAPEX (${cur})`, 13], [`Investment (${cur})`, 14],
      [`OPEX/mth (${cur})`, 13], [`Benefit/yr (${cur})`, 15], ['ROI', 10], ['Payback (mo)', 12],
      ['Commit', 11], ['Status', 13],
    ]
    // 1-based index by header label, so inserting a column cannot silently
    // re-format its neighbours.
    const px = (label) => cols.findIndex((c) => String(c[0]).startsWith(label)) + 1
    const MONEY_COLS = [px('Build cost'), px('CAPEX'), px('Investment'), px('OPEX/mth'), px('Benefit/yr')]
    const NUM_FIRST = px(`Project ${unit}`)
    const NUM_LAST = px('ROI')
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
    kv(`FTE released`, Number(p.finance.fteReleased.toFixed(2)), N1)
    kv(`Value of hours released (${cur}/year)`, Math.round(p.finance.annualBenefit), MONEY, NAVY)
    // Every one of these is this person's SHARE of the projects their hours
    // were credited from — the same share, over the same rows.
    kv(`Build cost (${cur})`,
      p.finance.buildCost == null ? 'no cost estimated' : Math.round(p.finance.buildCost),
      p.finance.buildCost == null ? undefined : MONEY)
    kv(`CAPEX credited (${cur})`,
      p.finance.capex == null ? 'no cost estimated' : Math.round(p.finance.capex),
      p.finance.capex == null ? undefined : MONEY)
    kv(`Investment credited (${cur}) — build + CAPEX`,
      p.finance.investment == null ? 'no cost estimated' : Math.round(p.finance.investment),
      p.finance.investment == null ? undefined : MONEY, NAVY)
    kv(`OPEX credited (${cur}/month)`, Math.round(p.finance.opexRunRate), MONEY,
      p.finance.opexRunRate > 0 ? WARN : undefined)
    kv(`Net benefit over ${fin.horizonMonths} months (${cur})`,
      p.finance.netBenefit == null ? 'not measurable without a cost' : Math.round(p.finance.netBenefit),
      p.finance.netBenefit == null ? undefined : MONEY,
      p.finance.netBenefit == null ? MUTED : p.finance.netBenefit >= 0 ? GOOD : BAD)
    kv('Return on investment',
      p.finance.roi == null ? 'not measurable without a cost' : Number(p.finance.roi.toFixed(4)),
      p.finance.roi == null ? undefined : ROI,
      p.finance.roi == null ? MUTED : p.finance.roi >= fin.roiGate ? GOOD : BAD)
    kv('Projects credited / touched', p.aggregatesTeam ? `[TEAM] ${p.scorecardCount} in plan · ${p.ownCount} their own` : `[PERSONAL] ${p.countedCount} / ${p.projectCount}`)
    kv('Saving hours still TBC', p.missingSaving, N0, p.missingSaving ? WARN : GOOD)
    styleBody(ws, sStart, r - 1, 3, { zebra: false })

    r++
    sectionRow(ws, r++, 'KPI SCORECARD', cols.length)
    headerRow(ws, r++, ['Block', 'KPI line', `${p.nick}'s target`, 'Weight', 'Unit',
      ...new Array(Math.max(0, cols.length - 5)).fill('')])
    const wStart = r
    p.kpiLines.forEach((l) => {
      const o = l.objective ? OBJ_BY_ID[l.objective] : null
      const row = ws.getRow(r++)
      row.getCell(1).value = l.block
      row.getCell(2).value = o ? `Obj ${o.no} — ${o.name}` : l.label
      writeTarget(row.getCell(3), l, settings.savingBasis, cur)
      // Spelled out beside the number as well as inside its format, so the unit
      // survives a copy-paste into a deck.
      row.getCell(5).value = l.targetKind === 'text' ? '' : targetUnit(l, settings.savingBasis, cur)
      row.getCell(5).font = { name: FONT, size: 9, color: { argb: MUTED } }
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
      // Mirrors model.js `costedRows`, which is what p.finance sums over.
      const inTotal = counted && countsToPool(pr) && pr.investment != null && pr.monthlyBenefit != null
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
        // `inTotal` is the SAME predicate model.js uses to build p.finance —
        // counted, pool-eligible, and carrying both a cost and a benefit. The
        // rows printed here therefore add up to the TOTAL CREDITED row below.
        // Printing a cost on a row the total excludes made the column disagree
        // with its own footer.
        !inTotal || pr.buildCost == null ? null : Math.round(pr.buildCost * share),
        !inTotal || pr.capex == null ? null : Math.round(pr.capex * share),
        !inTotal || pr.investment == null ? null : Math.round(pr.investment * share),
        !inTotal || !(pr.opexRunRate > 0) ? null : Math.round(pr.opexRunRate * share),
        !inTotal || pr.annualBenefit == null ? null : Math.round(pr.annualBenefit * share),
        !inTotal || pr.roi == null ? null : Number(pr.roi.toFixed(4)),
        // Blank when it never pays back — OPEX at or above the benefit. A
        // blank is honest; a zero or a negative month count would not be.
        !inTotal || pr.paybackMonths == null ? null : Number(pr.paybackMonths.toFixed(1)),
        pr.commitLevel,
        pr.status || '',
      ]
      row.getCell(1).font = { name: FONT, size: 9.5, bold: true }
      row.getCell(px('Share')).numFmt = PCT
      ;[NUM_FIRST, px('Credited'), px('Mandays')].forEach((c) => { row.getCell(c).numFmt = N0 })
      MONEY_COLS.forEach((c) => { row.getCell(c).numFmt = MONEY })
      row.getCell(px('ROI')).numFmt = ROI
      for (let c = px('Share'); c <= NUM_LAST; c++) row.getCell(c).alignment = { horizontal: 'right' }
      ;[px('Role'), px('Commit'), px('Status')].forEach((c) => { row.getCell(c).alignment = { horizontal: 'center' } })
      tone(row.getCell(px('Commit')), { commit: GOOD, stretch: NAVY_MID, watch: WARN, nextyear: 'FF7C5CD6', excluded: MUTED }[pr.commitLevel])
    })
    if (r > pStart) styleBody(ws, pStart, r - 1, cols.length)

    const tr = ws.getRow(r)
    tr.getCell(2).value = 'TOTAL CREDITED'
    const total = (label, value, fmt) => {
      const c = tr.getCell(px(label))
      c.value = value
      c.numFmt = fmt
    }
    total('Credited', Math.round(p.scorecardHours), N0)
    total('Build cost', p.finance.buildCost == null ? null : Math.round(p.finance.buildCost), MONEY)
    total('CAPEX', p.finance.capex == null ? null : Math.round(p.finance.capex), MONEY)
    total('Investment', p.finance.investment == null ? null : Math.round(p.finance.investment), MONEY)
    total('OPEX/mth', p.finance.opexRunRate > 0 ? Math.round(p.finance.opexRunRate) : null, MONEY)
    total('Benefit/yr', Math.round(p.finance.annualBenefit), MONEY)
    total('ROI', p.finance.roi == null ? null : Number(p.finance.roi.toFixed(4)), ROI)
    total('Payback', p.finance.paybackMonths == null ? null : Number(p.finance.paybackMonths.toFixed(1)), N1)
    for (let c = 1; c <= cols.length; c++) {
      const cell = tr.getCell(c)
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = fill(NAVY)
      cell.alignment = { horizontal: c >= px('Credited') && c <= NUM_LAST ? 'right' : 'left', vertical: 'middle' }
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
