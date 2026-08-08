/**
 * Reassigning a project must move the target and nothing else.
 *
 * It must never knock a scorecard off 100% and block saving: a PIC change is
 * the app changing its own line set, not the user typing a bad number.
 *
 * Run with: node scripts/check-reassign.mjs
 */
import { readFileSync } from 'node:fs'
import { computePlan, DEFAULT_SETTINGS, weightSum, weightsValid, rebalanceWeights } from '../src/lib/model.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const reassign = (state, key, pic) => ({
  ...state,
  projects: state.projects.map((p) => (p.key === key ? { ...p, pic, contributors: [{ person: pic, roles: ['dev'] }] } : p)),
})

/* ---- 1. the reported case: Datacube -> James ---- */
console.log('--- the reported case ---')
const DATACUBE = seed.projects.find((p) => /datacube/i.test(p.summary) && p.savingHours)
console.log(`  ${DATACUBE.key} "${DATACUBE.summary}" ${DATACUBE.savingHours}h, objective ${DATACUBE.objective}`)

const before = computePlan(base)
const jamesBefore = before.people.find((p) => p.id === 'james')
check('James starts valid', weightsValid(jamesBefore.kpiLines), `${(weightSum(jamesBefore.kpiLines) * 100).toFixed(1)}%`)

const after = computePlan(reassign(base, DATACUBE.key, 'james'))
const jamesAfter = after.people.find((p) => p.id === 'james')
check('James is STILL at exactly 100% after the reassignment',
  weightsValid(jamesAfter.kpiLines), `${(weightSum(jamesAfter.kpiLines) * 100).toFixed(2)}%`)
check('saving is not blocked', after.invalid.length === 0,
  after.invalid.map((x) => `${x.nick} ${(x.sum * 100).toFixed(1)}%`).join(', '))
check('he gains the objective', jamesAfter.objectives.length > jamesBefore.objectives.length,
  `${jamesBefore.objectives.length} -> ${jamesAfter.objectives.length}`)
check('and the target reflects it',
  (jamesAfter.byObjective[DATACUBE.objective] || 0) > (jamesBefore.byObjective[DATACUBE.objective] || 0),
  `${Math.round(jamesBefore.byObjective[DATACUBE.objective] || 0)} -> ${Math.round(jamesAfter.byObjective[DATACUBE.objective] || 0)}`)

/* ---- 2. the same, on a card that has been hand-edited ---- */
console.log('\n--- with weights already customised ---')
const edited = {
  ...base,
  people: base.people.map((p) => {
    if (p.id !== 'james') return p
    const lines = before.people.find((x) => x.id === 'james').kpiLines
    const reb = rebalanceWeights(lines)
    return { ...p, kpi: Object.fromEntries(Object.entries(reb).map(([k, w]) => [k, { weight: w }])) }
  }),
}
check('the customised card starts valid',
  weightsValid(computePlan(edited).people.find((p) => p.id === 'james').kpiLines))
const editedAfter = computePlan(reassign(edited, DATACUBE.key, 'james'))
check('still 100% after reassignment',
  weightsValid(editedAfter.people.find((p) => p.id === 'james').kpiLines),
  `${(weightSum(editedAfter.people.find((p) => p.id === 'james').kpiLines) * 100).toFixed(2)}%`)
check('and nothing is blocked', editedAfter.invalid.length === 0)

/* ---- 3. exhaustive: every project onto every person ---- */
console.log('\n--- every project moved to every person ---')
let broke = 0
let tried = 0
const owners = before.people.map((p) => p.id)
for (const proj of seed.projects.filter((p) => p.savingHours)) {
  for (const who of owners) {
    if (proj.pic === who) continue
    tried++
    const plan = computePlan(reassign(base, proj.key, who))
    if (plan.invalid.length) {
      broke++
      if (broke <= 3) console.log(`     ${proj.key} -> ${who}: ${plan.invalid.map((x) => `${x.nick} ${(x.sum * 100).toFixed(1)}%`).join(', ')}`)
    }
  }
}
check('no reassignment anywhere blocks saving', broke === 0, `${tried} reassignments exercised, ${broke} broke`)

/* ---- 4. removing a project too ---- */
console.log('\n--- unassigning, and removing a project ---')
const unassigned = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === DATACUBE.key ? { ...p, pic: null, contributors: [] } : p)),
})
check('unassigning keeps every card at 100%', unassigned.invalid.length === 0)
const deleted = computePlan({ ...base, projects: base.projects.filter((p) => p.key !== DATACUBE.key) })
check('deleting a project keeps every card at 100%', deleted.invalid.length === 0)

/* ---- 5. a typed weight is still honoured exactly ---- */
console.log('\n--- typed weights still land where you put them ---')
const p0 = computePlan(base)
const kade = p0.people.find((x) => x.id === 'kade')
const dline = kade.kpiLines.find((l) => l.block === 'Delivery')
// mirrors App.updatePersonKpi: only the edited line is written; the untouched
// siblings share out whatever is left.
const kpi = { [dline.id]: { weight: 0.2 } }
const typed = computePlan({ ...base, people: base.people.map((p) => (p.id === 'kade' ? { ...p, kpi } : p)) })
const kadeTyped = typed.people.find((x) => x.id === 'kade')
check('the typed 20% comes back as 20%',
  Math.abs(kadeTyped.kpiLines.find((l) => l.id === dline.id).weight - 0.2) < 1e-9,
  `${(kadeTyped.kpiLines.find((l) => l.id === dline.id).weight * 100).toFixed(2)}%`)
check('and the card still totals 100%', weightsValid(kadeTyped.kpiLines))

/* ---- 6. a genuinely bad hand-typed weight IS still gated ---- */
const polLines = p0.people.find((x) => x.id === 'pol').kpiLines.map((l) => l.id)
const bad = computePlan({
  ...base,
  people: base.people.map((p) => (p.id === 'pol'
    ? { ...p, kpi: Object.fromEntries(polLines.map((lid) => [lid, { weight: 0.8 }])) } : p)),
})
check('typing every weight over 100% is still blocked',
  bad.invalid.some((x) => x.id === 'pol'),
  bad.invalid.map((x) => `${x.nick} ${(x.sum * 100).toFixed(0)}%`).join(', '))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
