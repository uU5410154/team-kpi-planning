/**
 * Locks the "Next year" commit level: a project marked next-year stays in the
 * register but contributes nothing to this year's team total, objective mix,
 * headcount or anyone's scorecard.
 *
 * Run with: node scripts/check-nextyear.mjs
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, isInPlan, isCounted } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'
import { COMMIT_LEVELS, OUT_OF_PLAN } from '../src/lib/palette.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---------------- the level exists ---------------- */
console.log('--- the level ---')
const lvl = COMMIT_LEVELS.find((c) => c.id === 'nextyear')
check('"Next year" is a selectable commit level', !!lvl, lvl && `${lvl.label} — ${lvl.help}`)
check('it is classed as out of plan', OUT_OF_PLAN.has('nextyear'))
check('it is not counted toward anyone', !isCounted({ commitLevel: 'nextyear' }))
check('it is not in plan', !isInPlan({ commitLevel: 'nextyear' }))
check('commit and stretch remain in plan',
  isInPlan({ commitLevel: 'commit' }) && isInPlan({ commitLevel: 'stretch' }) && isInPlan({ commitLevel: 'watch' }))

/* ---------------- moving a project out ---------------- */
console.log('\n--- deferring a project removes it from the total ---')
const before = computePlan(base)
// pick the biggest project so the effect is unmistakable
const biggest = [...base.projects].sort((a, b) => (b.savingHours ?? 0) - (a.savingHours ?? 0))[0]
console.log(`  deferring ${biggest.key} — ${biggest.summary} (${biggest.savingHours} hrs, ${biggest.hc} HC)`)

const after = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === biggest.key ? { ...p, commitLevel: 'nextyear' } : p)),
})

check('the team total drops by exactly its hours',
  Math.abs(before.totals.totalHours - after.totals.totalHours - biggest.savingHours) < 1e-9,
  `${before.totals.totalHours.toFixed(1)} -> ${after.totals.totalHours.toFixed(1)}`)
check('coverage drops with it',
  after.totals.totalCoverage < before.totals.totalCoverage,
  `${(before.totals.totalCoverage * 100).toFixed(1)}% -> ${(after.totals.totalCoverage * 100).toFixed(1)}%`)
check('headcount drops by its HC',
  Math.abs(before.totals.totalHC - after.totals.totalHC - (biggest.hc || 0)) < 1e-9,
  `${before.totals.totalHC.toFixed(1)} -> ${after.totals.totalHC.toFixed(1)}`)
check('it is reported as deferred, not lost',
  Math.abs(after.totals.nextYearHours - biggest.savingHours) < 1e-9 && after.totals.nextYearCount === 1,
  `${after.totals.nextYearHours} hrs / ${after.totals.nextYearCount} project`)
check('the status breakdown no longer includes it',
  Math.abs(Object.values(after.totals.byStatus).reduce((a, b) => a + b, 0) - after.totals.totalHours) < 1e-9)
check('it drops out of its objective mix',
  Math.abs((before.byObjective[biggest.objective] || 0) - (after.byObjective[biggest.objective] || 0) - biggest.savingHours) < 1e-9,
  `${Math.round(before.byObjective[biggest.objective] || 0)} -> ${Math.round(after.byObjective[biggest.objective] || 0)}`)

/* ---------------- it leaves the owner's scorecard ---------------- */
console.log('\n--- and leaves the owner\'s scorecard ---')
const owner = biggest.pic || DEFAULT_SETTINGS.fallbackPic
const b4 = before.people.find((p) => p.id === owner)
const af = after.people.find((p) => p.id === owner)
check(`${b4.nick} loses the credited hours`, af.hours < b4.hours,
  `${Math.round(b4.hours)} -> ${Math.round(af.hours)}`)
check('nobody else changes',
  before.people.filter((p) => p.id !== owner).every((p) =>
    Math.abs(after.people.find((x) => x.id === p.id).hours - p.hours) < 1e-9))
check('every scorecard still totals 100%',
  after.people.every((p) => Math.abs(p.kpiLines.reduce((a, l) => a + l.weight, 0) - 1) < 0.0005))
check('the project stays in the register', after.projects.some((p) => p.key === biggest.key))
check('it drops out of the counted project count', af.countedCount === b4.countedCount - 1,
  `${b4.countedCount} -> ${af.countedCount}`)

// It still appears in the portfolio list — deliberately, so the owner can see
// what is parked — but it must credit nothing there.
const parked = af.rows.find((r) => r.p.key === biggest.key)
check('it is still listed in the portfolio', !!parked)
check('the portfolio row credits nothing',
  parked && !isCounted(parked.p),
  parked && `level ${parked.p.commitLevel}`)
// the sum of counted rows must equal the person's headline hours
const rowSum = af.rows
  .filter((r) => isCounted(r.p))
  .reduce((a, r) => a + (OUT_OF_PLAN.has(r.p.commitLevel) ? 0 : (r.p.savingHours ?? 0) * r.share), 0)
check('the counted rows re-add to the headline hours',
  Math.abs(rowSum - af.hours) < 0.01, `${rowSum.toFixed(1)} vs ${af.hours.toFixed(1)}`)

/* ---------------- it behaves like excluded, and is reversible ---------------- */
console.log('\n--- consistency with excluded, and reversibility ---')
const asExcluded = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === biggest.key ? { ...p, commitLevel: 'excluded' } : p)),
})
check('next-year and excluded remove the same hours',
  Math.abs(after.totals.totalHours - asExcluded.totals.totalHours) < 1e-9,
  `${after.totals.totalHours.toFixed(1)} vs ${asExcluded.totals.totalHours.toFixed(1)}`)
check('but only next-year is reported as deferred',
  after.totals.nextYearHours > 0 && asExcluded.totals.nextYearHours === 0)

const restored = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === biggest.key ? { ...p, commitLevel: 'commit' } : p)),
})
check('restoring it brings the hours back',
  Math.abs(restored.totals.totalHours - before.totals.totalHours) < 1e-9,
  `${restored.totals.totalHours.toFixed(1)}`)

/* ---------------- deferring everything ---------------- */
const allDeferred = computePlan({
  ...base,
  projects: base.projects.map((p) => ({ ...p, commitLevel: 'nextyear' })),
})
check('deferring everything zeroes the total, without crashing',
  allDeferred.totals.totalHours === 0 && allDeferred.totals.totalCoverage === 0)
check('and all the hours are reported as deferred',
  Math.abs(allDeferred.totals.nextYearHours - before.totals.totalHours) < 0.01,
  `${allDeferred.totals.nextYearHours.toFixed(1)}`)
check('scorecards survive an empty year',
  allDeferred.people.every((p) => Math.abs(p.kpiLines.reduce((a, l) => a + l.weight, 0) - 1) < 0.0005))

/* ---------------- the Excel export agrees ---------------- */
console.log('\n--- the export credits nothing for it either ---')
{
  const state = {
    meta: seed.meta,
    people: seed.people,
    projects: base.projects.map((p) => (p.key === biggest.key ? { ...p, commitLevel: 'nextyear' } : p)),
    settings: DEFAULT_SETTINGS,
    scenarioName: 'nextyear',
  }
  const file = 'nextyear-selftest.xlsx'
  if (existsSync(file)) unlinkSync(file)
  const wb = await buildWorkbook(after, state)
  await wb.xlsx.writeFile(file)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(file)

  const ws = back.getWorksheet(`Obj-${b4.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31))
  let projectHrs = null
  let creditedHrs = 'unset'
  let level = null
  let totalCredited = null
  ws.eachRow((row) => {
    if (String(row.getCell(2).value || '') === biggest.summary) {
      projectHrs = row.getCell(6).value
      creditedHrs = row.getCell(7).value
      level = row.getCell(10).value
    }
    if (String(row.getCell(2).value || '') === 'TOTAL CREDITED') totalCredited = row.getCell(7).value
  })
  check('the deferred project is still listed in the export', projectHrs === biggest.savingHours,
    String(projectHrs))
  check('its level is printed as nextyear', level === 'nextyear', String(level))
  check('but it credits nothing in the export', creditedHrs === null, String(creditedHrs))
  check('the export TOTAL CREDITED matches the app', Math.abs(totalCredited - Math.round(af.hours)) < 1,
    `${totalCredited} vs ${Math.round(af.hours)}`)
  unlinkSync(file)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
