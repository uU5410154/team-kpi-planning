/**
 * Shows the gross-vs-net crediting gap: how many of the committed pool hours
 * the six scorecard owners can personally bank once partner/outsource devs are
 * counted. Run with: node scripts/check-partners.mjs
 */
import { readFileSync } from 'node:fs'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))

for (const cp of [false, true]) {
  const plan = computePlan({
    people: seed.people,
    projects: seed.projects,
    settings: { ...DEFAULT_SETTINGS, creditPartners: cp },
  })
  const t = plan.totals
  console.log(`\n--- creditPartners = ${cp}  (${cp ? 'NET' : 'GROSS'}) ---`)
  console.log(`committed pool        ${Math.round(t.committedHours)}`)
  console.log(`bankable by the six   ${Math.round(t.bankableHours)}  = ${(t.bankableCoverage * 100).toFixed(1)}% of target`)
  console.log(`lost to partner devs  ${Math.round(t.partnerHours)}`)
  console.log(`orphaned (no owner)   ${Math.round(t.orphanHours)}`)
  console.log('  ' + plan.people.map((p) => `${p.nick}=${Math.round(p.hours)}`).join('  '))
}

const p0 = computePlan({ people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS })
console.log(`\npast due and not Done: ${p0.quality.pastDue} of ${p0.quality.total} epics, carrying ${Math.round(p0.quality.pastDueHours)} committed hrs`)
