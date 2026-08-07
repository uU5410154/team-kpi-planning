import * as XLSX from 'xlsx'
import { OBJECTIVES, OBJ_BY_ID } from './palette.js'
import { fmtPct, paybackMonths, SAVING_BASIS } from './model.js'

const aoa = (rows) => XLSX.utils.aoa_to_sheet(rows)
const widths = (...w) => w.map((wch) => ({ wch }))

/**
 * Export the current plan as a workbook laid out like the 2025
 * "F&A Tech Team Objective" file, so it drops into the existing review flow:
 *   Summary  |  Overall_Objectives  |  Breakdown Objectives  |  Obj-<Name> KPI
 */
export function exportWorkbook(plan, state) {
  const wb = XLSX.utils.book_new()
  const { totals, people, projects, quality, settings } = plan
  const stamp = new Date().toISOString().slice(0, 10)

  /* ---------------- Summary ---------------- */
  const objRows = OBJECTIVES.map((o) => {
    const hrs = projects
      .filter((p) => p.objective === o.id && (p.commitLevel === 'commit' || p.commitLevel === 'stretch'))
      .reduce((a, p) => a + (p.savingHours ?? 0), 0)
    const n = projects.filter((p) => p.objective === o.id).length
    return [o.no, o.name, o.detail, o.target, o.countsToPool ? 'Yes' : 'No (date-gated)', n, Math.round(hrs)]
  })

  const summary = [
    ['F&A TECH TEAM — 2026 OBJECTIVE & KPI PLAN'],
    [`Scenario: ${state.scenarioName || 'Baseline'}`, '', `Exported: ${stamp}`],
    [],
    ['TARGET BRIDGE', 'Hours'],
    ['Management target (F&A process automation)', settings.targetHours],
    ['Committed (commit-level projects, pool-eligible)', Math.round(totals.committedHours)],
    ['Stretch (upside, not in the commitment)', Math.round(totals.stretchHours)],
    ['Watch (at risk — excluded)', Math.round(totals.watchHours)],
    ['HEADLINE POSITION', Math.round(totals.headlineHours)],
    ['Coverage vs target', fmtPct(totals.coverage)],
    ['Gap (+ = surplus)', Math.round(totals.gap)],
    [],
    ['OBJECTIVE 1 — EFFICIENCY GATE', ''],
    ['Gate threshold (saving hours per manday)', settings.ratioGate],
    ['Saving-hours basis (ASSUMPTION — confirm with management)', SAVING_BASIS[settings.savingBasis].label],
    ['Implied payback on build effort', (() => {
      const m = paybackMonths(settings.ratioGate, settings.savingBasis)
      return m == null ? 'n/a' : m < 24 ? `${m.toFixed(1)} months` : `${(m / 12).toFixed(1)} years`
    })()],
    ['Team ratio achieved', totals.teamRatio == null ? 'n/a' : Number(totals.teamRatio.toFixed(2))],
    ['Projects failing the gate', totals.failingGate],
    ['Total mandays committed', Math.round(totals.totalManday)],
    [],
    ['CONCENTRATION RISK', ''],
    ['Top 2 projects as share of headline', fmtPct(totals.top2Share)],
    ['Top 2 projects (hours)', Math.round(totals.top2)],
    ...totals.topProjects.map((p, i) => [`  #${i + 1} ${p.key} ${p.summary}`, Math.round(p.savingHours ?? 0)]),
    [],
    ['DATA QUALITY — OPEN ITEMS', 'Count'],
    ['Projects total', quality.total],
    ['Missing saving hours', quality.missingSaving],
    ['Missing PIC', quality.missingPic],
    ['Manday still a seed estimate', quality.estimatedManday],
    ['Marked deleted in Jira', quality.deleted],
    [],
    ['GUIDELINE OBJECTIVES', '', '', '', '', '', ''],
    ['No.', 'Objective', 'Detail', 'Management target', 'Counts to hour pool', 'Projects', 'Hours'],
    ...objRows,
  ]
  const wsSum = aoa(summary)
  wsSum['!cols'] = widths(52, 42, 46, 26, 20, 10, 10)
  XLSX.utils.book_append_sheet(wb, wsSum, 'Summary')

  /* ---------------- Overall_Objectives ---------------- */
  // Person column blocks, mirroring the 2025 layout.
  const head1 = ['', '', '']
  const head2 = ['Obj. Part', 'No.', 'KPI']
  people.forEach((p) => {
    head1.push(p.nick, '', '', '')
    head2.push('Target', '%Weight', 'Actual', 'Note')
  })

  const corp = settings.corporateWeight
  const indiv = 1 - corp
  const lines = [
    { part: 'Corporate', no: 1, kpi: 'CP AXTRA Sales', weight: corp / 2, target: 'Per corporate scorecard' },
    { part: 'Corporate', no: 2, kpi: 'CP AXTRA EAT', weight: corp / 2, target: 'Per corporate scorecard' },
  ]
  OBJECTIVES.forEach((o, i) => {
    lines.push({
      part: 'Individual',
      no: 3 + i,
      kpi: `[Obj ${o.no}] ${o.name}`,
      weight: indiv / OBJECTIVES.length,
      objective: o.id,
    })
  })

  const overall = [head1, head2]
  lines.forEach((l) => {
    const row = [l.part, l.no, l.kpi]
    people.forEach((p) => {
      if (l.objective) {
        const h = p.byObjective[l.objective] || 0
        const holds = p.objectives.includes(l.objective)
        row.push(holds ? Math.round(h) : '—', holds ? l.weight : 0, '', holds ? '' : 'not held')
      } else {
        row.push(l.target, l.weight, '', '')
      }
    })
    overall.push(row)
  })
  // weight check row — the 2025 file failed to total 100% for two people
  const checkRow = ['', '', 'WEIGHT TOTAL (must be 100%)']
  people.forEach((p) => {
    const held = OBJECTIVES.filter((o) => p.objectives.includes(o.id)).length
    const w = corp + (held / OBJECTIVES.length) * indiv
    checkRow.push('', w, '', held === 0 ? 'NO OBJECTIVES HELD' : '')
  })
  overall.push([], checkRow)

  const wsOv = aoa(overall)
  wsOv['!cols'] = widths(14, 6, 42, ...people.flatMap(() => [16, 10, 10, 14]))
  wsOv['!merges'] = people.map((_, i) => ({
    s: { r: 0, c: 3 + i * 4 },
    e: { r: 0, c: 6 + i * 4 },
  }))
  XLSX.utils.book_append_sheet(wb, wsOv, 'Overall_Objectives')

  /* ---------------- Breakdown Objectives ---------------- */
  const bd = [
    [
      'Jira key', 'Project', 'Objective no.', 'Objective', 'Team', 'Department',
      'Main PIC (Tech team)', 'Contributors', 'Partner devs', 'Saving hrs',
      'Saving is estimate', 'Manday', 'Manday is estimate', 'Ratio (hrs/manday)',
      'Gate', 'Commit level', 'Counts to pool', 'Jira status', 'Detail status',
      'Start', 'Finish', 'Notes',
    ],
  ]
  projects.forEach((p) => {
    const person = people.find((x) => x.id === p.pic)
    bd.push([
      p.key,
      p.summary,
      OBJ_BY_ID[p.objective]?.no ?? '',
      OBJ_BY_ID[p.objective]?.name ?? '',
      p.team ?? '',
      p.department ?? '',
      person ? `${person.name} (${person.nick})` : 'TBC',
      (p.contributors || [])
        .map((c) => {
          const who = people.find((x) => x.id === c.person)
          return `${who ? who.nick : c.person}:${c.roles.join('/')}`
        })
        .join(', '),
      (p.partners || []).join(', '),
      p.savingHours ?? '',
      p.savingEstimated ? 'Y' : '',
      p.manday ?? '',
      p.mandayEstimated ? 'Y' : '',
      p.ratio == null ? '' : Number(p.ratio.toFixed(2)),
      p.gate === 'unknown' ? '' : p.gate,
      p.commitLevel,
      OBJ_BY_ID[p.objective]?.countsToPool ? 'Y' : 'N',
      p.status ?? '',
      p.srcStatus ?? '',
      p.start ?? '',
      p.due ?? '',
      p.notes ?? '',
    ])
  })
  const wsBd = aoa(bd)
  wsBd['!cols'] = widths(10, 46, 8, 26, 18, 14, 26, 30, 18, 10, 10, 9, 10, 12, 8, 12, 10, 12, 20, 12, 12, 30)
  wsBd['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: bd.length - 1, c: 21 } }) }
  wsBd['!freeze'] = { xSplit: 2, ySplit: 1 }
  XLSX.utils.book_append_sheet(wb, wsBd, 'Breakdown Objectives')

  /* ---------------- per-person KPI sheets ---------------- */
  people.forEach((p) => {
    const rows = [
      [`${p.name} (${p.nick})`, p.role, `Band: ${p.band}`],
      [],
      ['Objectives held', p.objectives.map((o) => `Obj ${OBJ_BY_ID[o]?.no}`).join(', ') || 'none'],
      ['Credited saving hours (commit + stretch)', Math.round(p.hours)],
      ['Committed only', Math.round(p.commitHours)],
      ['Credited mandays', Math.round(p.manday)],
      ['Efficiency ratio (hrs/manday)', p.ratio == null ? 'n/a' : Number(p.ratio.toFixed(2))],
      ['Gate threshold', settings.ratioGate],
      ['Projects (credited / total)', `${p.countedCount} / ${p.projectCount}`],
      ['Projects missing saving hours', p.missingSaving],
      [],
      ['BY OBJECTIVE', 'Hours'],
      ...OBJECTIVES.filter((o) => p.byObjective[o.id]).map((o) => [
        `Obj ${o.no} — ${o.name}`,
        Math.round(p.byObjective[o.id]),
      ]),
      [],
      [
        'Jira key', 'Project', 'Obj', 'Role', 'Contribution %', 'Project saving hrs',
        'Credited hrs', 'Project manday', 'Credited manday', 'Ratio', 'Gate',
        'Commit level', 'Status',
      ],
    ]
    p.rows
      .slice()
      .sort((a, b) => (b.p.savingHours ?? 0) * b.share - (a.p.savingHours ?? 0) * a.share)
      .forEach(({ p: pr, share }) => {
        const roles =
          (pr.contributors || []).find((c) => c.person === p.id)?.roles.join('/') ||
          (pr.pic === p.id ? 'pic' : '')
        rows.push([
          pr.key,
          pr.summary,
          OBJ_BY_ID[pr.objective]?.no ?? '',
          roles,
          Number((share * 100).toFixed(1)),
          pr.savingHours ?? '',
          pr.savingHours == null ? '' : Number(((pr.savingHours ?? 0) * share).toFixed(1)),
          pr.manday ?? '',
          Number(((pr.manday ?? 0) * share).toFixed(1)),
          pr.ratio == null ? '' : Number(pr.ratio.toFixed(2)),
          pr.gate === 'unknown' ? '' : pr.gate,
          pr.commitLevel,
          pr.srcStatus || pr.status || '',
        ])
      })
    const ws = aoa(rows)
    ws['!cols'] = widths(38, 44, 6, 12, 14, 16, 12, 13, 14, 8, 8, 12, 20)
    // Sheet names cap at 31 chars and cannot contain : \ / ? * [ ]
    const safe = `Obj-${p.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safe)
  })

  XLSX.writeFile(wb, `F&A Tech Team Objective 2026 — ${stamp}.xlsx`, { compression: true })
}
