/**
 * Locks the scorecard contract:
 *   - weights and targets are editable per person and survive a round trip
 *   - each member carries their OWN target, never the team's 3,000
 *   - anything off 100% is reported as invalid so saving can be blocked
 *   - the export reads the same lines, so app and workbook cannot disagree
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, weightSum, weightsValid } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'test' }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// --- defaults ---
const plan0 = computePlan(base)
check('defaults total 100% for everyone', plan0.people.every((p) => weightsValid(p.kpiLines)),
  plan0.people.map((p) => `${p.nick} ${(weightSum(p.kpiLines) * 100).toFixed(1)}%`).join(', '))
check('no invalid scorecards by default', plan0.invalid.length === 0)

// every member's delivery target is their own, not the team's 3,000
const teamTarget = String(DEFAULT_SETTINGS.targetHours)
const carriesTeamTarget = plan0.people.filter((p) =>
  p.kpiLines.some((l) => l.objective && String(l.target).replace(/,/g, '').includes(teamTarget)))
check('no member inherits the team target', carriesTeamTarget.length === 0,
  carriesTeamTarget.map((p) => p.nick).join(', '))

console.log('\ndefault per-member delivery targets:')
for (const p of plan0.people) {
  const t = p.kpiLines.filter((l) => l.objective).map((l) => l.target).join(' | ')
  console.log(`  ${p.nick.padEnd(10)} ${t || '(none)'}`)
}

// --- editing ---
const edited = {
  ...base,
  people: base.people.map((p) =>
    p.id === 'gun'
      ? { ...p, kpi: { 'corp-sales': { weight: 0.2, target: '5% growth' }, 'corp-eat': { weight: 0.1 } } }
      : p),
}
const plan1 = computePlan(edited)
const gun = plan1.people.find((p) => p.id === 'gun')
const sales = gun.kpiLines.find((l) => l.id === 'corp-sales')
check('weight override applies', sales.weight === 0.2, `${sales.weight}`)
check('target override applies', sales.target === '5% growth', sales.target)
check('override is flagged', sales.overridden === true)
check('default is retained for reset', Math.abs(sales.defaultWeight - 0.15) < 1e-9, `${sales.defaultWeight}`)

// gun moved 0.15->0.20 and 0.15->0.10, so the sum is unchanged at 100%
check('balanced edits keep the total at 100%', weightsValid(gun.kpiLines), `${(weightSum(gun.kpiLines) * 100).toFixed(1)}%`)

// --- the save gate ---
const broken = {
  ...base,
  people: base.people.map((p) => (p.id === 'kade' ? { ...p, kpi: { 'corp-sales': { weight: 0.5 } } } : p)),
}
const plan2 = computePlan(broken)
check('unbalanced edit is reported invalid', plan2.invalid.length === 1 && plan2.invalid[0].id === 'kade',
  plan2.invalid.map((x) => `${x.nick} ${(x.sum * 100).toFixed(1)}%`).join(', '))
check('the invalid sum is reported accurately', Math.abs(plan2.invalid[0].sum - 1.35) < 1e-9,
  `${plan2.invalid[0].sum}`)
check('others stay valid', plan2.people.filter((p) => p.id !== 'kade').every((p) => weightsValid(p.kpiLines)))

// --- export consistency ---
const file = 'scorecard-selftest.xlsx'
if (existsSync(file)) unlinkSync(file)
const wb = await buildWorkbook(plan1, edited)
await wb.xlsx.writeFile(file)
const back = new ExcelJS.Workbook()
await back.xlsx.readFile(file)

const ov = back.getWorksheet('Overall_Objectives')
let salesRow = null
ov.eachRow((row) => { if (String(row.getCell(3).value || '').includes('CP AXTRA Sales')) salesRow = row })
const gunIx = plan1.people.findIndex((p) => p.id === 'gun')
check('export carries the edited target', salesRow?.getCell(4 + gunIx * 3).value === '5% growth',
  String(salesRow?.getCell(4 + gunIx * 3).value))
check('export carries the edited weight', Math.abs(salesRow?.getCell(4 + gunIx * 3 + 1).value - 0.2) < 1e-9,
  String(salesRow?.getCell(4 + gunIx * 3 + 1).value))

const sheet = back.getWorksheet('Obj-Gun')
let hasTargetCol = false
sheet.eachRow((row) => { if (String(row.getCell(3).value || '').includes("Gun's target")) hasTargetCol = true })
check('per-person sheet has a Target column', hasTargetCol)

unlinkSync(file)
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
