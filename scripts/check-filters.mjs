/**
 * Confirms the Projects-tab totals track the active filter rather than the
 * whole book. Mirrors the aggregation the page performs over its filtered rows.
 */
import { readFileSync } from 'node:fs'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const plan = computePlan({ people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS })

const agg = (rows) => {
  const withSaving = rows.filter((p) => p.savingHours != null)
  const hours = withSaving.reduce((a, p) => a + p.savingHours, 0)
  const manday = rows.reduce((a, p) => a + (p.manday || 0), 0)
  return {
    count: rows.length,
    hours,
    hc: rows.reduce((a, p) => a + (p.hc || 0), 0),
    ratio: manday > 0 ? hours / manday : null,
  }
}

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const all = agg(plan.projects)
check('unfiltered total matches the dashboard', Math.abs(all.hours - plan.totals.totalHours) < 0.01,
  `${all.hours.toFixed(1)} vs ${plan.totals.totalHours.toFixed(1)}`)

console.log('\nfilter slices:')
const slices = [
  ['PIC = Kade', plan.projects.filter((p) => p.pic === 'kade')],
  ['PIC = Gun', plan.projects.filter((p) => p.pic === 'gun')],
  ['PIC unassigned', plan.projects.filter((p) => !p.pic)],
  ['Team = Accounting', plan.projects.filter((p) => p.team === 'Accounting')],
  ['Team = Finance', plan.projects.filter((p) => p.team === 'Finance')],
  ['Status = Done', plan.projects.filter((p) => p.status === 'Done')],
  ['Objective 2', plan.projects.filter((p) => p.objective === 'process_automation')],
]
for (const [label, rows] of slices) {
  const a = agg(rows)
  console.log(`  ${label.padEnd(20)} n=${String(a.count).padStart(3)}  hrs=${a.hours.toFixed(1).padStart(8)}  hc=${a.hc.toFixed(1).padStart(5)}  ratio=${a.ratio == null ? '  n/a' : a.ratio.toFixed(2)}`)
}

// the team slices must re-add to the whole book
const acc = agg(plan.projects.filter((p) => p.team === 'Accounting'))
const fin = agg(plan.projects.filter((p) => p.team === 'Finance'))
check('team slices re-add to the book', Math.abs(acc.hours + fin.hours - all.hours) < 0.01,
  `${acc.hours.toFixed(1)} + ${fin.hours.toFixed(1)} = ${(acc.hours + fin.hours).toFixed(1)} vs ${all.hours.toFixed(1)}`)

// every slice must be a strict subset of the book
check('no slice exceeds the book', slices.every(([, r]) => agg(r).hours <= all.hours + 0.01))

// ratio is null while no mandays exist anywhere
check('ratio is null until mandays are entered', all.ratio === null)

// and becomes real once they are
const withMd = plan.projects.map((p) => ({ ...p, manday: 5 }))
const a2 = agg(withMd)
check('ratio computes once mandays exist', a2.ratio != null && Math.abs(a2.ratio - all.hours / (5 * withMd.length)) < 1e-9,
  a2.ratio?.toFixed(2))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
