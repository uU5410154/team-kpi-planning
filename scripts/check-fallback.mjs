/**
 * Locks two rules:
 *   - IT is assignable as a PIC but holds no scorecard of its own.
 *   - Saving hours that land on no scorecard owner (IT-owned, or unassigned)
 *     are credited to the team lead, who carries the team's overall KPI.
 *
 * Run with: node scripts/check-fallback.mjs
 */
import { readFileSync } from 'node:fs'
import { computePlan, DEFAULT_SETTINGS, projectShares } from '../src/lib/model.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const plan = computePlan(base)

/* ---------------- IT as an assignable owner ---------------- */
console.log('--- IT as a PIC ---')
const it = seed.people.find((p) => p.id === 'it')
check('IT exists in the roster', !!it, it && `${it.nick} / ${it.role}`)
check('IT is flagged as holding no scorecard', it?.scorecard === false)
check('IT is offered as an assignee', plan.assignees.some((p) => p.id === 'it'))
check('IT has no scorecard tab', !plan.people.some((p) => p.id === 'it'),
  plan.people.map((p) => p.nick).join(', '))
check('IT owns projects in the register', seed.projects.filter((p) => p.pic === 'it').length > 0,
  `${seed.projects.filter((p) => p.pic === 'it').length} projects`)
check('IT is never credited any hours',
  plan.projects.every((p) => !('it' in p.shares)))

/* ---------------- the fallback rule ---------------- */
console.log('\n--- unowned hours fall to the team lead ---')
const lead = plan.people.find((p) => p.id === DEFAULT_SETTINGS.fallbackPic)
check('the fallback is the team lead', lead?.band === 'lead', `${lead?.nick} (${lead?.role})`)

const itProjects = plan.projects.filter((p) => p.pic === 'it')
check('every IT-owned project is credited to the lead',
  itProjects.every((p) => Math.abs((p.shares[lead.id] || 0) - 1) < 1e-9),
  `${itProjects.length} projects`)
check('every IT-owned project is flagged as a fallback', itProjects.every((p) => p.fellBack === true))

const unassigned = plan.projects.filter((p) => !p.pic)
check('every unassigned project is credited to the lead',
  unassigned.every((p) => Math.abs((p.shares[lead.id] || 0) - 1) < 1e-9),
  `${unassigned.length} projects`)

check('nothing is left credited to nobody', plan.totals.orphanHours === 0,
  String(plan.totals.orphanHours))
console.log(`  fallback: ${Math.round(plan.totals.fallbackHours)} hrs across ${plan.totals.fallbackCount} projects`)

/* ---------------- it is additive, not a rewrite ---------------- */
console.log('\n--- the rule only adds, never moves owned work ---')
const noFallback = computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, fallbackPic: null } })
for (const p of noFallback.people) {
  const withF = plan.people.find((x) => x.id === p.id)
  if (p.id === lead.id) {
    check(`${p.nick} gains the unowned hours`, withF.hours > p.hours,
      `${Math.round(p.hours)} -> ${Math.round(withF.hours)}`)
  } else {
    check(`${p.nick} is unchanged`, Math.abs(withF.hours - p.hours) < 1e-9,
      `${Math.round(p.hours)}`)
  }
}
check('the gain equals what was previously orphaned',
  Math.abs((plan.people.find((x) => x.id === lead.id).hours - noFallback.people.find((x) => x.id === lead.id).hours)
    - noFallback.totals.orphanHours) < 0.01,
  `gain ${Math.round(plan.people.find((x) => x.id === lead.id).hours - noFallback.people.find((x) => x.id === lead.id).hours)} vs orphaned ${Math.round(noFallback.totals.orphanHours)}`)

/* ---------------- totals stay sound ---------------- */
console.log('\n--- totals and shares stay sound ---')
const rawSum = seed.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)
check('the book total is unaffected', Math.abs(plan.totals.totalHours - rawSum) < 0.01,
  `${plan.totals.totalHours.toFixed(1)} vs ${rawSum.toFixed(1)}`)

const owners = new Set(plan.people.map((p) => p.id))
let bad = []
for (const p of seed.projects) {
  const { shares, partnerShare } = projectShares(p, DEFAULT_SETTINGS.roleWeights, false,
    { owners, fallbackPic: 'gun' })
  const sum = Object.values(shares).reduce((a, b) => a + b, 0) + partnerShare
  if (Math.abs(sum - 1) > 1e-9) bad.push(`${p.key}=${sum.toFixed(4)}`)
}
check('every project still totals 100% of its hours', bad.length === 0, bad.slice(0, 5).join(', '))
check('no credit ever lands on a non-scorecard id',
  plan.projects.every((p) => Object.keys(p.shares).every((k) => owners.has(k))))

/* ---------------- reassignment away from IT ---------------- */
console.log('\n--- reassigning off IT moves the credit ---')
// pick one with real hours — a TBC project would move nothing measurable
const first = itProjects.find((p) => (p.savingHours || 0) > 0)
const moved = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === first.key ? { ...p, pic: 'kade', contributors: [{ person: 'kade', roles: ['dev'] }] } : p)),
})
check('the lead loses it', moved.people.find((p) => p.id === lead.id).hours < plan.people.find((p) => p.id === lead.id).hours)
check('the new owner gains it', moved.people.find((p) => p.id === 'kade').hours > plan.people.find((p) => p.id === 'kade').hours,
  `${first.key} ${first.savingHours}h`)

/* ---------------- a configurable fallback ---------------- */
const toJames = computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, fallbackPic: 'james' } })
check('the fallback owner is configurable',
  toJames.people.find((p) => p.id === 'james').hours > plan.people.find((p) => p.id === 'james').hours &&
  toJames.people.find((p) => p.id === 'gun').hours < plan.people.find((p) => p.id === 'gun').hours)
check('an unknown fallback id is ignored rather than crashing',
  computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, fallbackPic: 'nope' } }).totals.orphanHours > 0)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
