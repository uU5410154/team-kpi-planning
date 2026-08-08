/**
 * Locks the scorecard contract:
 *   - weights and targets are editable per person and survive a round trip
 *   - each member carries their OWN target, never the team's 3,000
 *   - anything off 100% is reported as invalid so saving can be blocked
 *   - the export reads the same lines, so app and workbook cannot disagree
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, weightSum, weightsValid, rebalanceWeights, fmtTarget } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'test' }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` โ€” ${detail}` : ''}`)
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
  const t = p.kpiLines.filter((l) => l.objective).map((l) => fmtTarget(l)).join(' | ')
  console.log(`  ${p.nick.padEnd(10)} ${t || '(none)'}`)
}

// hour targets must be plain numbers; the unit is fixed by the UI, not typed
const hourLines = plan0.people.flatMap((p) => p.kpiLines.filter((l) => l.targetKind === 'hours'))
check('hour targets are stored as numbers', hourLines.every((l) => typeof l.target === 'number'),
  `${hourLines.length} lines`)
check('hour targets render with a fixed unit', fmtTarget(hourLines[0]).endsWith(' hrs/month'),
  fmtTarget(hourLines[0]))
check('date-gated objective 3 stays free text',
  plan0.people.flatMap((p) => p.kpiLines).filter((l) => l.objective === 'datawarehouse')
    .every((l) => l.targetKind === 'text'))

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
// A single raised weight is absorbed by the delivery block, so the card stays
// at 100%. Only pushing the FIXED blocks (corporate + capability) past 100%
// leaves nothing to absorb it, and that is a genuine user error worth gating.
const absorbed = computePlan({
  ...base,
  people: base.people.map((p) => (p.id === 'kade' ? { ...p, kpi: { 'corp-sales': { weight: 0.5 } } } : p)),
})
check('a raised weight is absorbed, not left invalid', absorbed.invalid.length === 0,
  `${(weightSum(absorbed.people.find((p) => p.id === 'kade').kpiLines) * 100).toFixed(2)}%`)
check('the raised weight is honoured',
  absorbed.people.find((p) => p.id === 'kade').kpiLines.find((l) => l.id === 'corp-sales').weight === 0.5)

const broken = {
  ...base,
  people: base.people.map((p) => (p.id === 'kade'
    ? { ...p, kpi: { 'corp-sales': { weight: 0.8 }, 'corp-eat': { weight: 0.8 } } } : p)),
}
const plan2 = computePlan(broken)
check('fixed blocks over 100% ARE reported invalid', plan2.invalid.length === 1 && plan2.invalid[0].id === 'kade',
  plan2.invalid.map((x) => `${x.nick} ${(x.sum * 100).toFixed(1)}%`).join(', '))
check('the invalid sum is reported accurately', plan2.invalid[0].sum > 1.5, `${plan2.invalid[0].sum.toFixed(2)}`)
check('others stay valid', plan2.people.filter((p) => p.id !== 'kade').every((p) => weightsValid(p.kpiLines)))

// --- targets follow project assignments ---
console.log('\nreassignment sync:')
const kadeBefore = plan0.people.find((p) => p.id === 'kade')
const kadeObj2Before = kadeBefore.kpiLines.find((l) => l.objective === 'process_automation')

// move Kade's 1,238-hour epic to Pol and both scorecards must move with it
const moved = {
  ...base,
  projects: base.projects.map((p) =>
    p.key === 'FNP-1151#3'
      ? { ...p, pic: 'pol', contributors: [{ person: 'pol', roles: ['dev'] }] }
      : p),
}
const planM = computePlan(moved)
const kadeAfter = planM.people.find((p) => p.id === 'kade')
const polAfter = planM.people.find((p) => p.id === 'pol')
const kadeObj2After = kadeAfter.kpiLines.find((l) => l.objective === 'process_automation')
const polObj2After = polAfter.kpiLines.find((l) => l.objective === 'process_automation')

console.log(`  Kade obj2 target: ${fmtTarget(kadeObj2Before)} -> ${kadeObj2After ? fmtTarget(kadeObj2After) : '(line gone)'}`)
console.log(`  Pol  obj2 target: (none) -> ${polObj2After ? fmtTarget(polObj2After) : '(none)'}`)

check('reassigning a project moves the hours off the old owner',
  (kadeObj2After?.creditedHours ?? 0) === (kadeObj2Before.creditedHours - 1238),
  `${kadeObj2Before.creditedHours} -> ${kadeObj2After?.creditedHours ?? 0}`)
check('reassigning a project moves the hours onto the new owner',
  polObj2After?.creditedHours === 1238, String(polObj2After?.creditedHours))
check('the target number follows the credited figure',
  polObj2After?.target === 1238, String(polObj2After?.target))
check('un-overridden targets never drift', planM.people.every((x) => x.kpiLines.every((l) => !l.drifted)))
check('both scorecards still total 100% after the move',
  weightsValid(kadeAfter.kpiLines) && weightsValid(polAfter.kpiLines))

// a pinned target is reported as drifted once assignments move under it
const pinned = {
  ...moved,
  people: moved.people.map((p) => (p.id === 'pol' ? { ...p, kpi: { 'obj-process_automation': { target: 999 } } } : p)),
}
const polPinned = computePlan(pinned).people.find((p) => p.id === 'pol')
const pinnedLine = polPinned.kpiLines.find((l) => l.objective === 'process_automation')
check('a manually pinned target is flagged as drifted', pinnedLine.drifted === true)
check('the pinned number is what is shown', pinnedLine.target === 999, String(pinnedLine.target))
check('the live figure is still exposed for syncing', pinnedLine.creditedHours === 1238)
check('clearing the override restores the live target',
  pinnedLine.defaultTarget === 1238, String(pinnedLine.defaultTarget))

// --- deleting lines ---
console.log('\nline removal:')
const trimmed = {
  ...base,
  people: base.people.map((p) => (p.id === 'james' ? { ...p, kpiHidden: ['corp-eat'] } : p)),
}
const planT = computePlan(trimmed)
const james = planT.people.find((p) => p.id === 'james')
check('removed line is gone from the scorecard', !james.kpiLines.some((l) => l.id === 'corp-eat'))
check('removed line is listed for restore',
  james.kpiHiddenLines.some((l) => l.id === 'corp-eat'), String(james.kpiHiddenLines.length))
// Removing a line is the app changing its own line set, so the delivery block
// absorbs the freed weight and the card stays signable.
check('removal keeps the card at 100% and does not block saving',
  weightsValid(james.kpiLines) && planT.invalid.length === 0,
  `${(weightSum(james.kpiLines) * 100).toFixed(2)}%`)

const rebalanced = rebalanceWeights(james.kpiLines)
const rebSum = Object.values(rebalanced).reduce((a, b) => a + b, 0)
check('rebalance restores exactly 100%', Math.abs(rebSum - 1) < 1e-9, `${(rebSum * 100).toFixed(4)}%`)
check('rebalance lands on whole percentages',
  Object.values(rebalanced).every((w) => Math.abs(w * 100 - Math.round(w * 100)) < 1e-9),
  Object.values(rebalanced).map((w) => `${(w * 100).toFixed(2)}%`).join(' '))
check('rebalance keeps the original ordering of weights', (() => {
  const before = james.kpiLines.map((l) => l.weight)
  const after = james.kpiLines.map((l) => rebalanced[l.id])
  for (let i = 0; i < before.length; i++) {
    for (let j = 0; j < before.length; j++) {
      // a line that was strictly larger must not end up smaller
      if (before[i] - before[j] > 1e-9 && after[i] < after[j] - 1e-9) return false
    }
  }
  return true
})())

const afterReb = computePlan({
  ...trimmed,
  people: trimmed.people.map((p) =>
    p.id === 'james'
      ? { ...p, kpi: Object.fromEntries(Object.entries(rebalanced).map(([k, w]) => [k, { weight: w }])) }
      : p),
}).people.find((p) => p.id === 'james')
check('rebalanced scorecard passes the save gate', weightsValid(afterReb.kpiLines),
  `${(weightSum(afterReb.kpiLines) * 100).toFixed(2)}%`)
check('restoring the line brings it back',
  computePlan(base).people.find((p) => p.id === 'james').kpiLines.some((l) => l.id === 'corp-eat'))

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

