/**
 * Sanity check for the calculation engine. Run with: node scripts/check-model.mjs
 * Catches the failure modes that matter: weights that do not total 100%,
 * contribution shares that exceed a project's hours, and per-person hours that
 * do not re-add to the team total.
 */
import { readFileSync } from 'node:fs'
import { computePlan, projectShares, DEFAULT_SETTINGS, scorecardWeights } from '../src/lib/model.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const state = { people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }
const plan = computePlan(state)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// 1. shares + partner share always account for exactly 100% of a project
const badShares = []
for (const cp of [false, true]) {
  for (const p of seed.projects) {
    const { shares, partnerShare } = projectShares(p, DEFAULT_SETTINGS.roleWeights, cp)
    const sum = Object.values(shares).reduce((a, b) => a + b, 0) + partnerShare
    if ((Object.keys(shares).length || partnerShare) && Math.abs(sum - 1) > 1e-9) {
      badShares.push(`${cp ? 'net' : 'gross'} ${p.key}=${sum.toFixed(4)}`)
    }
  }
}
check('core + partner shares account for 100% of every project', badShares.length === 0, badShares.slice(0, 5).join(', '))

// 2. no project credits a person who is not on the roster
const ids = new Set(seed.people.map((p) => p.id))
const strays = []
for (const cp of [false, true]) {
  for (const p of seed.projects) {
    for (const k of Object.keys(projectShares(p, DEFAULT_SETTINGS.roleWeights, cp).shares)) {
      if (!ids.has(k)) strays.push(`${p.key}:${k}`)
    }
  }
}
check('no credit assigned to a non-roster person', strays.length === 0, strays.slice(0, 5).join(', '))

// 3. crediting partners can only ever reduce a person's hours, never raise them
const gross = computePlan({ ...state, settings: { ...DEFAULT_SETTINGS, creditPartners: false } })
const net = computePlan({ ...state, settings: { ...DEFAULT_SETTINGS, creditPartners: true } })
const rose = gross.people.filter((g) => {
  const n = net.people.find((x) => x.id === g.id)
  return n.hours > g.hours + 1e-9
})
check('net crediting never increases anyone\'s hours', rose.length === 0, rose.map((p) => p.nick).join(', '))

// 3. every scorecard totals exactly 100%
const badWeights = plan.people
  .map((p) => [p.nick, p.kpiLines.reduce((a, l) => a + l.weight, 0)])
  .filter(([, s]) => Math.abs(s - 1) > 1e-9)
check('every scorecard totals 100%', badWeights.length === 0,
  badWeights.map(([n, s]) => `${n}=${(s * 100).toFixed(2)}%`).join(', '))

// 4. per-person credited hours re-add to the team pool (no double banking)
const personSum = plan.people.reduce((a, p) => a + p.hours, 0)
const poolSum = plan.projects
  .filter((p) => (p.commitLevel === 'commit' || p.commitLevel === 'stretch'))
  .filter((p) => Object.keys(p.shares).length > 0)
  .reduce((a, p) => {
    const o = plan.settings
    return a + (p.poolHours || 0)
  }, 0)
check('per-person hours re-add to the pool', Math.abs(personSum - poolSum) < 1,
  `people=${personSum.toFixed(1)} pool=${poolSum.toFixed(1)} (difference is unassigned projects)`)

// 4b. THE headline number must equal the raw source column sum.
// This is the check that matters most: the dashboard total has to reconcile to
// the "Saving hrs/mth" column in the source workbook, with no filtering.
const rawSum = seed.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)
check('dashboard total equals the source column sum', Math.abs(plan.totals.totalHours - rawSum) < 0.01,
  `dashboard=${plan.totals.totalHours.toFixed(1)} source=${rawSum.toFixed(1)}`)

// and the status split must re-add to it
const statusSum = Object.values(plan.totals.byStatus).reduce((a, b) => a + b, 0)
check('status breakdown re-adds to the total', Math.abs(statusSum - plan.totals.totalHours) < 0.01,
  Object.entries(plan.totals.byStatus).map(([k, v]) => `${k}=${Math.round(v)}`).join(' '))

// 5. headline maths
const t = plan.totals
check('headline = committed when stretch excluded', Math.abs(t.headlineHours - t.committedHours) < 1e-9)
check('coverage matches headline / target', Math.abs(t.coverage - t.headlineHours / t.target) < 1e-9)

// 6. gate classification is consistent
const badGate = plan.projects.filter(
  (p) => p.ratio != null && ((p.ratio >= DEFAULT_SETTINGS.ratioGate) !== (p.gate === 'pass')),
)
check('gate flag matches the ratio', badGate.length === 0, badGate.map((p) => p.key).join(', '))

console.log('\n--- summary ---')
console.log(`projects            ${plan.quality.total}`)
console.log(`TOTAL saving hours  ${t.totalHours.toFixed(1)}  (${(t.totalCoverage * 100).toFixed(1)}% of ${t.target})`)
Object.entries(t.byStatus).forEach(([k, v]) => console.log(`  ${k.padEnd(16)} ${Math.round(v).toLocaleString()}`))
console.log(`headcount released  ${t.totalHC.toFixed(1)} HC`)
console.log(`team ratio          ${t.teamRatio?.toFixed(2)} hrs/manday`)
console.log(`top-2 concentration ${(t.top2Share * 100).toFixed(1)}%`)
console.log(`failing the gate    ${t.failingGate}`)
console.log('\nper person:')
for (const p of [...plan.people].sort((a, b) => b.hours - a.hours)) {
  console.log(
    `  ${p.nick.padEnd(10)} ${String(Math.round(p.hours)).padStart(6)} hrs  ` +
    `${String(p.countedCount).padStart(3)} proj  ratio ${(p.ratio ?? 0).toFixed(1).padStart(6)}  ` +
    `weights ${(p.kpiLines.reduce((a, l) => a + l.weight, 0) * 100).toFixed(0)}%  ` +
    `obj[${p.objectives.length}]`,
  )
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
