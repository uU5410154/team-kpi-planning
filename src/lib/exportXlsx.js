import ExcelJS from 'exceljs'
import { OBJECTIVES, OBJ_BY_ID, OUT_OF_PLAN } from './palette.js'
import {
  SAVING_BASIS, targetUnit, gateAsHoursPerManday, gateAsPaybackMonths, fmtMonths,
  MONTH_LABELS, MONTHS_IN_YEAR, countsToPool, creditSummary,
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
  } else if (line.targetKind === 'number') {
    // A hand-written KPI in its own unit. Still a NUMBER in the cell, with the
    // unit in the format, so it can be summed, sorted and charted like the
    // rest — a pre-formatted string could not.
    cell.value = Number(line.target || 0)
    cell.numFmt = line.unit ? `#,##0.##" ${String(line.unit).replace(/"/g, '')}"` : '#,##0.##'
  } else {
    cell.value = String(line.target ?? '—') || '—'
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
    // Where the two rates come from, beside the rates themselves. A number
    // this much depends on should not need a conversation to explain it.
    const note = (row, text) => {
      const c = row.getCell(3)
      c.value = text
      c.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } }
      c.alignment = { horizontal: 'left', vertical: 'top', wrapText: true }
      row.height = Math.min(64, 14 * (1 + Math.floor(text.length / 60)))
    }
    note(kv('Developer salary (per month)', fin.devMonthlySalary, MONEY),
      `${cur} ${Math.round(fin.devMonthlySalary).toLocaleString()}/month = ${cur} ${Math.round(fin.devDayRate).toLocaleString()}`
      + ` per manday x ${fin.daysPerFteMonth} working days`)
    kv('  = cost of one manday', Math.round(fin.devDayRate), MONEY)
    note(kv('Accountant salary (per month)', fin.acctMonthlySalary, MONEY),
      `${cur} ${Math.round(fin.acctMonthlySalary).toLocaleString()}/month`
      + (fin.acctRateNote ? ` — ${fin.acctRateNote} = ${cur} ${Math.round(fin.acctMonthlySalary).toLocaleString()}` : ''))
    kv('  = value of one saved hour', Math.round(fin.acctHourRate), MONEY)
    kv('On-cost multiplier applied to both', fin.loadFactor, N1)
    kv('Hours per FTE / month (the FTE ratio)', fin.hoursPerFteMonth, N1)
    kv('Hours per manday', fin.hoursPerManday, N1)
    kv('Saving-hours basis', basis.label)
    r++
    kv('FTE released (saving hours ÷ the ratio)', Number(fin.fteReleased.toFixed(2)), N1, NAVY)
    kv('Value of hours released (per month)', Math.round(fin.monthlyBenefit), MONEY)
    kv('Value of hours released (per year)', Math.round(fin.hoursAnnualBenefit), MONEY, NAVY)
    // Stated on its own line rather than folded in silently: a reader has to be
    // able to see how much of the return is time and how much is cash.
    kv('Cash benefit stated on projects (per year)', Math.round(fin.monetaryAnnualBenefit || 0), MONEY, NAVY)
    kv('Total annual benefit', Math.round(fin.annualBenefit), MONEY, NAVY)
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
      c.value = `${p.nick}  ·  ${p.band}${p.overridden ? '  ·  MANUAL' : ''}`
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

    // The saving hours each person's card states, under their own columns —
    // the same figure their scorecard totals to, so the two can be checked
    // against each other without leaving the sheet.
    const tot = ws.getRow(r++)
    tot.getCell(3).value = `TOTAL SAVING ${unit.toUpperCase()}`
    tot.getCell(3).font = { name: FONT, size: 10, bold: true, color: { argb: NAVY } }
    people.forEach((p, i) => {
      const c = tot.getCell(4 + i * 3)
      c.value = Number((p.kpiTotals.savingHours || 0).toFixed(1))
      c.numFmt = N1
      c.alignment = { horizontal: 'center' }
      tone(c, NAVY)
      // What the register credits, beside it, where the card states something
      // different — so a typed target is never silent on this sheet either.
      const actual = tot.getCell(4 + i * 3 + 2)
      actual.value = Number((p.registerHours || 0).toFixed(1))
      actual.numFmt = N1
      actual.alignment = { horizontal: 'right' }
      if (Math.abs((p.kpiTotals.savingHours || 0) - (p.registerHours || 0)) > 0.5) tone(actual, WARN, false)
    })
    tot.height = 18
    for (let c = 1; c <= width; c++) tot.getCell(c).border = { top: { style: 'medium', color: { argb: NAVY } }, bottom: thin }

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

  /* ============ 3. Effort & Return — mandays, ROI and payback ============
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
      [`OPEX/mth (${cur})`, 13], [`OPEX 2026 (${cur})`, 14],
      [`Cash/yr (${cur})`, 14], [`Benefit/yr (${cur})`, 15], [`Net ${fin.horizonMonths}mo (${cur})`, 16],
      ['ROI', 10], ['Payback (mo)', 12], ['Break-even mandays', 15],
      ['Gate', 9], ['Commit', 11],
    ]
    // 1-based column index by header label, so every format and every colour
    // below asks for a column by name.
    const ec = (label) => cols.findIndex((c) => String(c[0]).startsWith(label)) + 1

    const ws = wb.addWorksheet('Effort_Return', {
      // Hidden, not removed: the register and the per-person sheets quote
      // figures that are worked out here, and deleting the working would leave
      // nothing to check them against. Right-click any tab and Unhide to read
      // it.
      state: 'hidden',
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
        p.opexYear > 0 ? Math.round(p.opexYear) : null,
        p.monetaryAnnualBenefit == null ? null : Math.round(p.monetaryAnnualBenefit),
        p.annualBenefit == null ? null : Math.round(p.annualBenefit),
        p.netBenefit == null ? null : Math.round(p.netBenefit),
        p.roi == null ? null : Number(p.roi.toFixed(4)),
        p.paybackMonths == null ? null : Number(p.paybackMonths.toFixed(1)),
        p.breakEvenMandays == null ? null : Math.round(p.breakEvenMandays),
        p.gate === 'unknown' ? '' : p.gate === 'pass' ? 'Pass' : 'Below',
        p.commitLevel,
      ]
      // By NAME, not by position. Written as bare indices, inserting one
      // column silently gave the ROI cell a decimal format and the gate colour
      // to its neighbour — the numbers stayed right and the sheet stopped
      // saying what they were.
      tr.getCell(ec('Mandays')).numFmt = N1
      for (const label of ['Cost', 'CAPEX', 'Investment', 'OPEX/mth', 'OPEX 2026', 'Cash/yr', 'Benefit/yr', 'Net ']) {
        tr.getCell(ec(label)).numFmt = MONEY
      }
      tr.getCell(ec('ROI')).numFmt = ROI
      tr.getCell(ec('Payback')).numFmt = N1
      tr.getCell(ec('Break-even')).numFmt = N0
      for (let c = ec('Mandays'); c <= ec('Break-even'); c++) tr.getCell(c).alignment = { horizontal: 'right' }
      for (const label of ['PIC', 'Gate', 'Commit']) tr.getCell(ec(label)).alignment = { horizontal: 'center' }
      for (let c = 1; c <= cols.length; c++) tr.getCell(c).font = { name: FONT, size: 9.5, bold: true }
      if (p.netBenefit != null) tone(tr.getCell(ec('Net ')), p.netBenefit >= 0 ? GOOD : BAD, false)
      if (p.opexRunRate > 0) tone(tr.getCell(ec('OPEX/mth')), WARN, false)
      if (p.gate === 'fail') { tone(tr.getCell(ec('ROI')), BAD); tone(tr.getCell(ec('Gate')), BAD) }
      if (p.gate === 'pass') { tone(tr.getCell(ec('ROI')), GOOD); tone(tr.getCell(ec('Gate')), GOOD) }
      // Payback is blank when OPEX is at or above the benefit — say why here
      // too, since this sheet is read on its own.
      // "never" means the running cost eats the benefit — NOT that the benefit
      // is merely unknown, which is a blank.
      if (p.investment != null && p.paybackMonths == null && p.netMonthly != null && p.netMonthly <= 0) {
        tr.getCell(ec('Payback')).value = 'never'
        tone(tr.getCell(ec('Payback')), BAD)
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
    gr.getCell(10).value = Math.round(fin.planOpexYear)
    gr.getCell(11).value = Math.round(fin.annualBenefit)
    gr.getCell(12).value = fin.netBenefit == null ? null : Math.round(fin.netBenefit)
    for (const c of [6, 7, 8, 9, 10, 11, 12]) gr.getCell(c).numFmt = MONEY
    gr.getCell(13).value = fin.roi == null ? null : Number(fin.roi.toFixed(4))
    gr.getCell(13).numFmt = ROI
    gr.getCell(14).value = fin.paybackMonths == null ? null : Number(fin.paybackMonths.toFixed(1))
    gr.getCell(14).numFmt = N1
    for (let c = 1; c <= cols.length; c++) {
      const cell = gr.getCell(c)
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = fill(NAVY)
      cell.alignment = { horizontal: c >= 5 && c <= 15 ? 'right' : 'left', vertical: 'middle' }
    }
    gr.height = 20
  }

  /* ============ 4. one sheet per person ============ */
  for (const p of people) {
    /*
     * A scorecard, not a cost model. The effort and return figures were asked to
     * come off these sheets — they live on Effort_Return, in one place, where
     * they are stated once and cannot disagree with a share-weighted copy here.
     * What is left is what this sheet is for: which projects the person carries,
     * how many hours those are worth, and how much of that is credited to them.
     */
    const cols = [
      ['Jira', 12], ['Project', 42], ['Objective', 22],
      [`Project ${unit}`, 14], ['Credited', 11],
      ['Mandays', 11], [`Build cost (${cur})`, 14], [`Investment (${cur})`, 14],
      [`Cash benefit/yr (${cur})`, 16], ['ROI', 10], ['Status', 13],
      // What each project delivers beyond the hours. On the person's own sheet
      // because a scorecard read on its own has to carry the whole case.
      ['Soft benefits', 46],
    ]
    // 1-based index by header label, so inserting a column cannot silently
    // re-format its neighbours.
    const px = (label) => cols.findIndex((c) => String(c[0]).startsWith(label)) + 1
    const MONEY_COLS = [px('Build cost'), px('Investment'), px('Cash benefit')]
    const NUM_FIRST = px(`Project ${unit}`)
    const NUM_LAST = px('Investment')
    const safe = `Obj-${p.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31)
    const ws = wb.addWorksheet(safe, { views: [{ state: 'frozen', ySplit: 6 }] })
    banner(ws, `${p.name.toUpperCase()}  ·  ${p.nick}`,
      `${p.role} · band ${p.band} · holds ${p.objectives.map((o) => `Obj ${OBJ_BY_ID[o]?.no}`).join(', ') || 'no objectives'}`
      // A figure typed over the calculated one is stated on the face of the
      // sheet. A manual number that reads like a derived one is the way a
      // workbook ends up trusted for something it never said.
      + (p.overridden
        ? ` · MANUAL FIGURE: appraised on ${Math.round(p.scorecardHours).toLocaleString()} ${unit}`
          + `${p.hoursOverridden ? ` (the register calculates ${Math.round(p.calcScorecardHours).toLocaleString()})` : ''}`
          + `${p.moneyOverridden ? ` and ${Math.round(p.finance.annualBenefit).toLocaleString()} ${cur}/yr (calculated ${Math.round(p.calcAnnualBenefit).toLocaleString()})` : ''}`
        : ''),
      cols.length)

    // No POSITION block: the headline figures it carried are on the Summary and
    // on Effort_Return, and repeating them here is how two sheets end up
    // disagreeing. This sheet opens straight on the scorecard.
    let r = 4
    sectionRow(ws, r++, 'KPI SCORECARD', cols.length)
    headerRow(ws, r++, ['Block', 'KPI line', `${p.nick}'s target`, 'Weight', 'Unit', `Saving ${unit}`,
      ...new Array(Math.max(0, cols.length - 6)).fill('')])
    const wStart = r
    p.kpiLines.forEach((l) => {
      const o = l.objective ? OBJ_BY_ID[l.objective] : null
      const row = ws.getRow(r++)
      row.getCell(1).value = l.block
      // A hand-written line keeps ITS OWN name even when it is tied to an
      // objective. Naming it after the objective threw away the only thing
      // that said what the KPI actually was.
      row.getCell(2).value = l.custom
        ? (o ? `${l.label} (Obj ${o.no})` : l.label)
        : (o ? `Obj ${o.no} — ${o.name}` : l.label)
      writeTarget(row.getCell(3), l, settings.savingBasis, cur)
      // Spelled out beside the number as well as inside its format, so the unit
      // survives a copy-paste into a deck.
      row.getCell(5).value = l.targetKind === 'text' ? '' : targetUnit(l, settings.savingBasis, cur)
      row.getCell(5).font = { name: FONT, size: 9, color: { argb: MUTED } }
      // The saving hours behind the line, whatever unit its target is stated
      // in. Objective 1 is quoted in baht and objective 3 as a date, so without
      // this column the hours total below could not be checked by adding up.
      if (l.creditedHours != null && l.creditedHours > 0) {
        row.getCell(6).value = Number(l.creditedHours.toFixed(1))
        row.getCell(6).numFmt = N1
        row.getCell(6).alignment = { horizontal: 'right' }
      }
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
    // The saving hours this card carries, the same figure the app shows under
    // the scorecard and the same one in the headline above it.
    sr.getCell(6).value = Number(p.kpiTotals.savingHours.toFixed(1))
    sr.getCell(6).numFmt = N1
    sr.getCell(6).alignment = { horizontal: 'right' }
    tone(sr.getCell(3), NAVY)
    tone(sr.getCell(4), Math.abs(sum - 1) < 0.0005 ? GOOD : BAD)
    tone(sr.getCell(6), NAVY)
    styleBody(ws, wStart, r - 1, 6)

    r++
    sectionRow(ws, r++, 'PROJECT PORTFOLIO', cols.length)
    headerRow(ws, r++, cols.map((c) => c[0]), cols.map((c) => c[1]))
    const pStart = r
    const rowsSorted = [...p.scorecardRows].sort((a, b) => (b.p.savingHours ?? 0) * b.share - (a.p.savingHours ?? 0) * a.share)
    rowsSorted.forEach(({ p: pr, share }) => {
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
        pr.savingHours ?? null,
        !counted || pr.savingHours == null ? null : Number(((pr.savingHours ?? 0) * share).toFixed(1)),
        // `inTotal` is the SAME predicate model.js uses to build p.finance —
        // counted, pool-eligible, and carrying both a cost and a benefit. The
        // rows printed here therefore add up to the TOTAL CREDITED row below.
        // Effort and return, on the person's own sheet: the same figures the
        // Projects tab shows, credited on this person's share where the money
        // is theirs and stated whole where it belongs to the project.
        pr.manday || null,
        !inTotal || pr.buildCost == null ? null : Math.round(pr.buildCost * share),
        !inTotal || pr.investment == null ? null : Math.round(pr.investment * share),
        // Credited on the same share as the hours: it is the same project.
        !counted || !pr.monetaryAnnualBenefit ? null : Math.round(pr.monetaryAnnualBenefit * share),
        // A ratio, so it is NOT shared out: the project returns what it
        // returns whoever is credited on it.
        !inTotal || pr.roi == null ? null : Number(pr.roi.toFixed(4)),
        pr.status || '',
        // Not shared out: a soft benefit is not divisible. Two people credited
        // on a project both deliver the whole of it.
        counted ? (pr.softBenefits || []).map((b) => `• ${b}`).join('\n') : '',
      ]
      row.getCell(1).font = { name: FONT, size: 9.5, bold: true }
      row.getCell(px('Mandays')).numFmt = N1
      row.getCell(px('ROI')).numFmt = ROI
      if (inTotal && pr.roi != null) tone(row.getCell(px('ROI')), pr.gate === 'pass' ? GOOD : BAD, false)
      if (counted && (pr.softBenefits || []).length) {
        row.getCell(px('Soft benefits')).alignment = { vertical: 'top', wrapText: true }
        row.height = Math.min(90, 12 + pr.softBenefits.length * 12)
      }
      ;[NUM_FIRST, px('Credited')].forEach((c) => { row.getCell(c).numFmt = N0 })
      MONEY_COLS.forEach((c) => { row.getCell(c).numFmt = MONEY })
      for (let c = NUM_FIRST; c <= NUM_LAST; c++) row.getCell(c).alignment = { horizontal: 'right' }
      row.getCell(px('Status')).alignment = { horizontal: 'center' }
    })
    if (r > pStart) styleBody(ws, pStart, r - 1, cols.length)

    const tr = ws.getRow(r)
    // The label is also how the column is found, so a manual figure is marked
    // on the ROW rather than by renaming the header out from under px().
    tr.getCell(2).value = p.hoursOverridden
      ? `TOTAL CREDITED — MANUAL (register: ${Math.round(p.calcScorecardHours).toLocaleString()})`
      : 'TOTAL CREDITED'
    const total = (label, value, fmt) => {
      const c = tr.getCell(px(label))
      c.value = value
      c.numFmt = fmt
    }
    total('Credited', Math.round(p.scorecardHours), N0)
    total('Mandays', Number((p.scorecardManday || 0).toFixed(1)), N1)
    total('ROI', p.finance.roi == null ? null : Number(p.finance.roi.toFixed(4)), ROI)
    if (p.hoursOverridden) tone(tr.getCell(px('Credited')), WARN)
    total('Build cost', p.finance.buildCost == null ? null : Math.round(p.finance.buildCost), MONEY)
    total('Investment', p.finance.investment == null ? null : Math.round(p.finance.investment), MONEY)
    for (let c = 1; c <= cols.length; c++) {
      const cell = tr.getCell(c)
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = fill(NAVY)
      cell.alignment = { horizontal: c >= px('Credited') && c <= NUM_LAST ? 'right' : 'left', vertical: 'middle' }
    }
    tr.height = 20
  }

  /*
   * The two reference tables come LAST on purpose: the workbook reads Summary,
   * then the objectives, then effort and return, then a card per person, and
   * the register and the monthly cost grid are looked up rather than read
   * through. ExcelJS writes sheets in creation order, so this order is the
   * order they are built in — there is no reordering step to get out of step.
   */
  /* ============ 5. Projects ============ */
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
      // The split behind every credited figure on the per-person sheets. It is
      // written here, once, so a reader can check a scorecard against it
      // instead of taking the hours on trust.
      { label: 'Team (roles, share)', width: 42, align: 'left' },
      { label: `Saving ${unit}`, width: 13, fmt: N0 },
      // The other half of the QUANTIFIED benefit. A number, not a note: it
      // counts toward the return exactly as the hours do.
      { label: `Cash benefit/yr (${cur})`, width: 16, fmt: MONEY },
      // Beside the hours, as on screen: the other half of the benefit. One
      // bullet a line inside the cell, so it reads as a list rather than a
      // paragraph with semicolons in it.
      { label: 'Soft benefits', width: 46, align: 'left', wrap: true },
      // Headed FTE to match the app and the source workbook's own meaning; the
      // value behind it is still the stored `hc` field.
      { label: 'FTE', width: 8, fmt: N1 },
      // Effort, cost and return are NOT here. They live on Effort_Return, on
      // their own, so this sheet stays the register it says it is and the two
      // cannot state the same figure twice with different filters behind them.
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
      `${projects.length} projects · ${Math.round(totals.headlineHours).toLocaleString()} ${unit} committed · effort, cost and return are on Effort_Return · source: ${state.meta?.source || 'plan'}`,
      cols.length)
    headerRow(ws, 4, cols.map((c) => c.label), cols.map((c) => c.width))
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
        creditSummary(p, p.shares, (id) => people.find((x) => x.id === id)?.nick || id),
        p.savingHours ?? null,
        p.monetaryAnnualBenefit ?? null,
        (p.softBenefits || []).map((b) => `• ${b}`).join('\n'),
        p.fte ?? null,
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
      if ((p.softBenefits || []).length) {
        row.getCell(ix('Soft benefits')).alignment = { vertical: 'top', wrapText: true }
        row.height = Math.min(90, 12 + p.softBenefits.length * 12)
      }

      if (!person) tone(row.getCell(ix('PIC')), BAD)
      if (p.savingHours == null) tone(row.getCell(ix('Saving')), WARN)
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
    const summed = ['Saving', 'FTE']
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

  /* ============ 6. Costs — the monthly cost grid ============
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
