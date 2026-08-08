/**
 * Covers three things and how they interact:
 *   1. every weight is a multiple of 5% and the card totals exactly 100%
 *   2. a KPI line filters the portfolio to that objective
 *   3. editing the portfolio moves every number in the app AND in the workbook
 *
 * Run with: node scripts/check-portfolio.mjs
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, weightsValid,
  toWholePercents, snapWeight, WEIGHT_STEP, rebalanceWeights,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'
import { OBJ_BY_ID } from '../src/lib/palette.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'portfolio' }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const isStep = (w) => Math.abs((w * 100) % WEIGHT_STEP) < 1e-6 || Math.abs(((w * 100) % WEIGHT_STEP) - WEIGHT_STEP) < 1e-6

/* ================= 1. weights on the 5-point grid ================= */
console.log('--- weights are multiples of 5 ---')
const plan = computePlan(base)
for (const p of plan.people) {
  const pcts = p.kpiLines.map((l) => Math.round(l.weight * 100))
  const ok = p.kpiLines.every((l) => isStep(l.weight)) && weightsValid(p.kpiLines)
  check(`${p.nick}: ${pcts.join(' / ')} = ${pcts.reduce((a, b) => a + b, 0)}%`, ok)
}

console.log('\n--- and stay on the grid under every shape ---')
// hide each subset of lines and confirm the survivors still land on 5s
let offGrid = 0
let cases = 0
for (const p of plan.people) {
  for (const l of p.kpiLines) {
    cases++
    const trimmed = computePlan({
      ...base,
      people: base.people.map((x) => (x.id === p.id ? { ...x, kpiHidden: [l.id] } : x)),
    }).people.find((x) => x.id === p.id)
    if (!trimmed.kpiLines.every((k) => isStep(k.weight)) || !weightsValid(trimmed.kpiLines)) offGrid++
  }
}
check('removing any single line keeps every weight on the grid', offGrid === 0, `${cases} shapes tried`)

// reassignment changes the line set too
let offGrid2 = 0
for (const proj of seed.projects.filter((p) => p.savingHours).slice(0, 30)) {
  for (const who of plan.people.map((p) => p.id)) {
    const moved = computePlan({
      ...base,
      projects: base.projects.map((p) => (p.key === proj.key ? { ...p, pic: who, contributors: [{ person: who, roles: ['dev'] }] } : p)),
    })
    if (!moved.people.every((p) => p.kpiLines.every((l) => isStep(l.weight)) && weightsValid(p.kpiLines))) offGrid2++
  }
}
check('reassignment keeps every weight on the grid', offGrid2 === 0)

console.log('\n--- the apportionment itself ---')
check('toWholePercents lands on 5s and totals 100%', (() => {
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12, 20]) {
    for (let t = 0; t < 40; t++) {
      const w = Array.from({ length: n }, (_, i) => ((i * 7 + t * 13) % 97) + 1)
      const out = toWholePercents(w)
      const sum = Math.round(out.reduce((a, b) => a + b, 0) * 100)
      if (sum !== 100) return false
      if (!out.every(isStep)) return false
    }
  }
  return true
})())
check('a held line never rounds down to 0%', (() => {
  const out = toWholePercents([1000, 1000, 1000, 1000, 1])
  return out.every((w) => w > 0) && Math.round(out.reduce((a, b) => a + b, 0) * 100) === 100
})(), toWholePercents([1000, 1000, 1000, 1000, 1]).map((w) => `${w * 100}%`).join(' '))
check('typed values snap to the grid',
  snapWeight(23) === 25 && snapWeight(22) === 20 && snapWeight(8) === 10 && snapWeight(2) === 0,
  `23->${snapWeight(23)} 22->${snapWeight(22)} 8->${snapWeight(8)}`)
check('rebalance also lands on the grid', (() => {
  const reb = rebalanceWeights(plan.people[0].kpiLines)
  const vals = Object.values(reb)
  return vals.every(isStep) && Math.round(vals.reduce((a, b) => a + b, 0) * 100) === 100
})())

/* ================= 2. KPI line filters the portfolio ================= */
console.log('\n--- clicking a KPI line filters the portfolio ---')
const lead = plan.people.find((p) => p.aggregatesTeam)
for (const line of lead.kpiLines.filter((l) => l.objective)) {
  const shown = lead.scorecardRows.filter((r) => r.p.objective === line.objective)
  const o = OBJ_BY_ID[line.objective]
  check(`Obj ${o.no} filters to ${shown.length} of ${lead.scorecardRows.length}`,
    shown.length > 0 && shown.every((r) => r.p.objective === line.objective))
}
check('the filtered subsets partition the portfolio',
  lead.kpiLines.filter((l) => l.objective)
    .reduce((a, l) => a + lead.scorecardRows.filter((r) => r.p.objective === l.objective).length, 0)
  === lead.scorecardRows.length)
check('every line on the 2026 card is filterable',
  lead.kpiLines.length > 0 && lead.kpiLines.every((l) => l.objective))

/* ================= 3. portfolio edits propagate ================= */
console.log('\n--- editing the portfolio moves everything ---')
const target = seed.projects.find((p) => p.pic === 'kade' && p.savingHours > 100)
console.log(`  editing ${target.key} "${target.summary}" ${target.savingHours}h (Kade)`)

const bump = (state, key, hours) => ({
  ...state,
  projects: state.projects.map((p) => (p.key === key ? { ...p, savingHours: hours } : p)),
})
const edited = computePlan(bump(base, target.key, target.savingHours + 50))
const kadeB = plan.people.find((p) => p.id === 'kade')
const kadeA = edited.people.find((p) => p.id === 'kade')
const leadA = edited.people.find((p) => p.aggregatesTeam)

check('the owner gains the hours', Math.abs(kadeA.ownHours - kadeB.ownHours - 50) < 0.01,
  `${Math.round(kadeB.ownHours)} -> ${Math.round(kadeA.ownHours)}`)
check('the headline gains them', Math.abs(edited.totals.totalHours - plan.totals.totalHours - 50) < 0.01,
  `${plan.totals.totalHours} -> ${edited.totals.totalHours}`)
check('the lead figure gains them', Math.abs(leadA.scorecardHours - lead.scorecardHours - 50) < 0.01)
check('lead still equals the headline', Math.abs(leadA.scorecardHours - edited.totals.totalHours) < 0.01)
check('the objective total gains them',
  Math.abs((edited.byObjective[target.objective] || 0) - (plan.byObjective[target.objective] || 0) - 50) < 0.01)
check('the owner KPI target follows',
  kadeA.kpiLines.find((l) => l.objective === target.objective).target
  === kadeB.kpiLines.find((l) => l.objective === target.objective).target + 50)
check('weights stay on the grid after the edit',
  edited.people.every((p) => p.kpiLines.every((l) => isStep(l.weight)) && weightsValid(p.kpiLines)))
check('nothing is blocked', edited.invalid.length === 0)

// changing owner from the portfolio
const moved = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === target.key ? { ...p, pic: 'pol', contributors: [{ person: 'pol', roles: ['dev'] }] } : p)),
})
check('changing the owner moves the hours between members',
  moved.people.find((p) => p.id === 'pol').ownHours > plan.people.find((p) => p.id === 'pol').ownHours &&
  moved.people.find((p) => p.id === 'kade').ownHours < kadeB.ownHours)
check('but the team figure is unchanged',
  Math.abs(moved.people.find((p) => p.aggregatesTeam).scorecardHours - lead.scorecardHours) < 0.01)

// deferring from the portfolio
const deferred = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === target.key ? { ...p, commitLevel: 'nextyear' } : p)),
})
check('deferring from the portfolio drops it everywhere',
  Math.abs(plan.totals.totalHours - deferred.totals.totalHours - target.savingHours) < 0.01 &&
  Math.abs(lead.scorecardHours - deferred.people.find((p) => p.aggregatesTeam).scorecardHours - target.savingHours) < 0.01)

/* ================= 4. the workbook agrees ================= */
console.log('\n--- the exported workbook matches the app ---')
{
  const state = { ...base, projects: bump(base, target.key, target.savingHours + 50).projects }
  const file = 'portfolio-selftest.xlsx'
  if (existsSync(file)) unlinkSync(file)
  const wb = await buildWorkbook(edited, state)
  await wb.xlsx.writeFile(file)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(file)

  // per-person headline + weights
  for (const p of edited.people) {
    const ws = back.getWorksheet(`Obj-${p.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31))
    let headline = null
    let total = null
    const weights = []
    ws.eachRow((row) => {
      const a = String(row.getCell(1).value || '')
      if (a.startsWith('Credited saving hours') || a.startsWith('Team saving hours')) headline = row.getCell(3).value
      if (String(row.getCell(3).value || '') === 'TOTAL') total = row.getCell(4).value
      if (a === 'Delivery') weights.push(row.getCell(4).value)
    })
    check(`${p.nick}: exported headline matches the app`,
      Math.abs(headline - Math.round(p.scorecardHours)) < 1, `${headline} vs ${Math.round(p.scorecardHours)}`)
    check(`${p.nick}: exported weights total 100%`, Math.abs(total - 1) < 1e-9, `${(total * 100).toFixed(2)}%`)
    check(`${p.nick}: exported weights are on the 5-point grid`, weights.every(isStep),
      weights.map((w) => `${Math.round(w * 100)}%`).join(' '))
  }

  // the edited project's hours in the Projects sheet
  const ps = back.getWorksheet('Projects')
  let exportedHours = null
  ps.eachRow((row) => { if (String(row.getCell(2).value || '') === target.summary) exportedHours = row.getCell(8).value })
  check('the edited project exports its new hours',
    exportedHours === target.savingHours + 50, `${exportedHours} vs ${target.savingHours + 50}`)

  // Summary headline
  const sum = back.getWorksheet('Summary')
  let book = null
  sum.eachRow((row) => { if (String(row.getCell(1).value || '').startsWith('Total book')) book = row.getCell(2).value })
  check('the Summary book total matches the app',
    Math.abs(book - Math.round(edited.totals.totalHours)) < 1, `${book} vs ${Math.round(edited.totals.totalHours)}`)
  unlinkSync(file)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
