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
import { OBJ_BY_ID } from '../src/lib/palette.js'

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

// Whole percentages everywhere, not just after a manual rebalance.
const fractional = plan0.people.filter((p) =>
  p.kpiLines.some((l) => Math.abs(l.weight * 100 - Math.round(l.weight * 100)) > 1e-9))
check('every default weight is a whole percentage', fractional.length === 0,
  fractional.map((p) => `${p.nick}: ${p.kpiLines.map((l) => (l.weight * 100).toFixed(2)).join('/')}`).join(' | '))
console.log('\ndefault weights:')
for (const p of plan0.people) {
  console.log(`  ${p.nick.padEnd(10)} ${p.kpiLines.map((l) => `${Math.round(l.weight * 100)}%`).join(' ')}` +
    `  = ${Math.round(weightSum(p.kpiLines) * 100)}%`)
}
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

// --- the 2026 card has no corporate or capability line ---
check('no CP AXTRA / capability lines remain',
  plan0.people.every((p) => p.kpiLines.every((l) => l.objective && l.block === 'Delivery')),
  plan0.people.flatMap((p) => p.kpiLines.filter((l) => !l.objective).map((l) => l.id)).join(', ') || 'none')
check('every card is nothing but the objectives that person holds',
  plan0.people.every((p) => p.kpiLines.length === (p.objectives.length || 1)))

// --- editing ---
// Weights are typed on the objective lines now, so pick two live ids.
const gunLines = plan0.people.find((p) => p.id === 'gun').kpiLines
const [lineA, lineB] = gunLines.map((l) => l.id)
const defaultA = gunLines[0].defaultWeight

const edited = {
  ...base,
  people: base.people.map((p) =>
    p.id === 'gun'
      ? { ...p, kpi: { [lineA]: { weight: 0.2, target: 5 }, [lineB]: { weight: 0.1 } } }
      : p),
}
const plan1 = computePlan(edited)
const gun = plan1.people.find((p) => p.id === 'gun')
const pinnedA = gun.kpiLines.find((l) => l.id === lineA)
check('weight override applies exactly as typed', pinnedA.weight === 0.2, `${pinnedA.weight}`)
check('target override applies', pinnedA.target === 5, String(pinnedA.target))
check('override is flagged', pinnedA.overridden === true)
check('default is retained for reset', Math.abs(pinnedA.defaultWeight - defaultA) < 1e-9,
  `${pinnedA.defaultWeight} vs ${defaultA}`)
check('the untouched lines absorb the rest', weightsValid(gun.kpiLines),
  `${(weightSum(gun.kpiLines) * 100).toFixed(1)}%`)

// --- the save gate ---
// One raised weight is absorbed by the lines the user has not touched, so the
// card stays at 100%. Typing more than 100% across every line leaves nothing to
// absorb it, and that is a genuine user error worth gating.
const kadeLines = plan0.people.find((p) => p.id === 'kade').kpiLines.map((l) => l.id)
const absorbed = computePlan({
  ...base,
  people: base.people.map((p) => (p.id === 'kade' ? { ...p, kpi: { [kadeLines[0]]: { weight: 0.5 } } } : p)),
})
check('a raised weight is absorbed, not left invalid', absorbed.invalid.length === 0,
  `${(weightSum(absorbed.people.find((p) => p.id === 'kade').kpiLines) * 100).toFixed(2)}%`)
check('the raised weight is honoured',
  absorbed.people.find((p) => p.id === 'kade').kpiLines.find((l) => l.id === kadeLines[0]).weight === 0.5)

const broken = {
  ...base,
  people: base.people.map((p) => (p.id === 'kade'
    ? { ...p, kpi: Object.fromEntries(kadeLines.map((id) => [id, { weight: 0.8 }])) } : p)),
}
const plan2 = computePlan(broken)
check('typed weights over 100% ARE reported invalid', plan2.invalid.length === 1 && plan2.invalid[0].id === 'kade',
  plan2.invalid.map((x) => `${x.nick} ${(x.sum * 100).toFixed(1)}%`).join(', '))
check('the invalid sum is reported accurately', plan2.invalid[0].sum > 1.5, `${plan2.invalid[0].sum.toFixed(2)}`)
check('others stay valid', plan2.people.filter((p) => p.id !== 'kade').every((p) => weightsValid(p.kpiLines)))

// pinning every line SHORT of 100% has nothing left to absorb either
const short = computePlan({
  ...base,
  people: base.people.map((p) => (p.id === 'kade'
    ? { ...p, kpi: Object.fromEntries(kadeLines.map((id) => [id, { weight: 0.05 }])) } : p)),
})
check('typed weights short of 100% are reported invalid too',
  short.invalid.some((x) => x.id === 'kade'),
  `${(weightSum(short.people.find((p) => p.id === 'kade').kpiLines) * 100).toFixed(0)}%`)

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
const jamesLines = plan0.people.find((p) => p.id === 'james').kpiLines.map((l) => l.id)
const dropped = jamesLines[jamesLines.length - 1]
const trimmed = {
  ...base,
  people: base.people.map((p) => (p.id === 'james' ? { ...p, kpiHidden: [dropped] } : p)),
}
const planT = computePlan(trimmed)
const james = planT.people.find((p) => p.id === 'james')
check('removed line is gone from the scorecard', !james.kpiLines.some((l) => l.id === dropped))
check('removed line is listed for restore',
  james.kpiHiddenLines.some((l) => l.id === dropped), String(james.kpiHiddenLines.length))
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
  computePlan(base).people.find((p) => p.id === 'james').kpiLines.some((l) => l.id === dropped))
check('the last remaining line cannot be removed', (() => {
  const solo = computePlan({
    ...base,
    people: base.people.map((p) => (p.id === 'james' ? { ...p, kpiHidden: jamesLines } : p)),
  }).people.find((p) => p.id === 'james')
  return solo.kpiLines.length === 1 && weightsValid(solo.kpiLines)
})())

// --- export consistency ---
const file = 'scorecard-selftest.xlsx'
if (existsSync(file)) unlinkSync(file)
const wb = await buildWorkbook(plan1, edited)
await wb.xlsx.writeFile(file)
const back = new ExcelJS.Workbook()
await back.xlsx.readFile(file)

const ov = back.getWorksheet('Overall_Objectives')
check('the overall sheet has dropped the corporate and capability rows', (() => {
  const labels = []
  ov.eachRow((row) => labels.push(String(row.getCell(3).value || '')))
  return !labels.some((t) => /CP AXTRA|Capability/i.test(t))
})())

const objOfA = OBJ_BY_ID[lineA.replace(/^obj-/, '')]
let editedRow = null
ov.eachRow((row) => { if (String(row.getCell(3).value || '').includes(`[Obj ${objOfA.no}]`)) editedRow = row })
const gunIx = plan1.people.findIndex((p) => p.id === 'gun')
// Targets export as NUMBERS with the unit in the number format, so the column
// stays sortable and summable.
// A NUMBER with the unit in the format, so the column stays sortable and
// summable. A percentage line writes a real percentage — 5% is 0.05 — which is
// the same discipline applied to a different unit.
const editedCell = editedRow?.getCell(4 + gunIx * 3)
const editedIsPct = pinnedA.targetKind === 'percent'
check('export carries the edited target as a number',
  typeof editedCell?.value === 'number'
  && Math.abs((editedIsPct ? editedCell.value * 100 : editedCell.value) - 5) < 1e-9,
  `${editedCell?.value} (${typeof editedCell?.value}, ${pinnedA.targetKind})`)
check('and carries its unit in the number format',
  /hrs|THB|%/.test(String(editedCell?.numFmt || '')),
  String(editedCell?.numFmt))
check('export carries the edited weight', Math.abs(editedRow?.getCell(4 + gunIx * 3 + 1).value - 0.2) < 1e-9,
  String(editedRow?.getCell(4 + gunIx * 3 + 1).value))

const sheet = back.getWorksheet('Obj-Gun')
let hasTargetCol = false
sheet.eachRow((row) => { if (String(row.getCell(3).value || '').includes("Gun's target")) hasTargetCol = true })
check('per-person sheet has a Target column', hasTargetCol)

unlinkSync(file)

/* ================= objectives added by hand ================= */
console.log('\n--- an objective can be added to a scorecard by hand ---')
{
  const withExtra = (id, extras) => computePlan({
    ...base,
    people: base.people.map((p) => (p.id === id ? { ...p, extraObjectives: extras } : p)),
  }).people.find((p) => p.id === id)

  const before = computePlan(base).people.find((p) => p.id === 'james')
  check('James does not hold the data warehouse to begin with',
    !before.objectives.includes('datawarehouse'), before.objectives.join(', '))
  check('and it is offered as addable', before.addableObjectives.includes('datawarehouse'))

  const after = withExtra('james', ['datawarehouse'])
  check('adding it puts it on the card', after.objectives.includes('datawarehouse'),
    after.objectives.join(', '))
  check('it arrives as a KPI line', !!after.kpiLines.find((l) => l.objective === 'datawarehouse'))
  check('flagged as added by hand, and the derived ones are not',
    after.kpiLines.find((l) => l.objective === 'datawarehouse').manual === true
    && after.kpiLines.filter((l) => l.objective !== 'datawarehouse').every((l) => l.manual === false))
  check('the card still totals exactly 100%', weightsValid(after.kpiLines),
    `${(weightSum(after.kpiLines) * 100).toFixed(1)}%`)
  check('and every weight is still on the 5-point grid',
    after.kpiLines.every((l) => Math.abs((l.weight * 100) % 5) < 1e-9),
    after.kpiLines.map((l) => `${Math.round(l.weight * 100)}%`).join(' '))
  check('the other lines gave up the weight',
    after.kpiLines.filter((l) => l.objective !== 'datawarehouse').length === before.kpiLines.length)
  check('nothing is blocked from saving',
    computePlan({
      ...base,
      people: base.people.map((p) => (p.id === 'james' ? { ...p, extraObjectives: ['datawarehouse'] } : p)),
    }).invalid.length === 0)

  // It carries no projects, so it starts at nothing — that is the point of it.
  const line = after.kpiLines.find((l) => l.objective === 'datawarehouse')
  check('its target starts at zero, because no project carries it',
    line.targetKind === 'text' || Number(line.target) === 0, String(line.target))
  check('and it is no longer offered as addable', !after.addableObjectives.includes('datawarehouse'))

  // Removing it takes the card back exactly.
  const removed = withExtra('james', [])
  check('removing it restores the original card',
    removed.objectives.join(',') === before.objectives.join(',')
    && removed.kpiLines.map((l) => Math.round(l.weight * 100)).join(',')
      === before.kpiLines.map((l) => Math.round(l.weight * 100)).join(','))

  // An objective already held is not doubled by adding it.
  const dup = withExtra('james', [before.objectives[0]])
  check('adding one already held changes nothing',
    dup.objectives.join(',') === before.objectives.join(',')
    && dup.kpiLines.length === before.kpiLines.length)
  check('and it is not marked as added by hand',
    dup.kpiLines.every((l) => l.manual === false))

  check('an unknown objective id is ignored', (() => {
    const junk = withExtra('james', ['not-an-objective', null, 42])
    return junk.objectives.join(',') === before.objectives.join(',')
  })())

  // Everyone can be given one, and every card stays valid.
  const all = computePlan({
    ...base,
    people: base.people.map((p) => ({ ...p, extraObjectives: ['datawarehouse', 'ai_automation'] })),
  })
  check('every scorecard survives objectives being added to all of them',
    all.people.every((p) => weightsValid(p.kpiLines)) && all.invalid.length === 0)
  check('and everyone now holds the added ones',
    all.people.every((p) => p.objectives.includes('datawarehouse') && p.objectives.includes('ai_automation')))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

