/**
 * Guards cache invalidation: a browser holding state from an older seed must
 * discard it. Counting rows is not enough — adding a flag to a person changes
 * no count, and every existing browser then kept its old roster while the app
 * quietly behaved as if the flag were absent.
 *
 * Run with: node scripts/check-storage.mjs
 */
import { readFileSync } from 'node:fs'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const src = readFileSync(new URL('../src/lib/storage.js', import.meta.url), 'utf8')

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// mirror of the module's hash + stamp
const hash = (str) => {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
const stampFor = (s) =>
  `${s.meta?.source || '?'}|${s.projects.length}|${s.people.length}|` +
  `${hash(JSON.stringify(s.people))}|${hash(JSON.stringify(s.projects))}`

const stamp = stampFor(seed)
const version = Number(src.match(/const VERSION = (\d+)/)?.[1])

console.log('--- the mechanism ---')
check('storage declares a VERSION', Number.isFinite(version), `v${version}`)
check('storage fingerprints the seed', src.includes('seedStamp'))
check('the fingerprint covers content, not just counts', src.includes('hash(JSON.stringify(seed.people))'))
check('loadState drops stale state', src.includes('isStale(parsed)'))

const isStale = (parsed) =>
  !parsed || parsed.version !== version || !Array.isArray(parsed.projects) || parsed.seedStamp !== stamp

console.log('\n--- what must be rejected ---')
const cases = [
  ['older version', { version: version - 1, seedStamp: stamp, projects: [] }],
  ['the Jira-era seed', { version, seedStamp: 'JIRA-F&A-Tech-team.xlsx / sheet JIRA-F&A-Tech-team|101|6|a|b', projects: [] }],
  ['a count-only stamp from an older build', { version, seedStamp: `${seed.meta.source}|86|7`, projects: [] }],
  ['missing stamp', { version, projects: [] }],
]
for (const [label, parsed] of cases) check(`rejects: ${label}`, isStale(parsed))

// THE case that slipped through: same counts, different person content.
const withoutFlag = {
  ...seed,
  people: seed.people.map(({ aggregatesTeam, ...rest }) => rest),
}
check('rejects a roster whose counts match but content differs',
  isStale({ version, seedStamp: stampFor(withoutFlag), projects: [] }),
  'same source, same 86 projects, same 7 people — only a flag changed')

const repriced = {
  ...seed,
  projects: seed.projects.map((p, i) => (i === 0 ? { ...p, savingHours: (p.savingHours ?? 0) + 1 } : p)),
}
check('rejects a repriced project with the same counts',
  isStale({ version, seedStamp: stampFor(repriced), projects: [] }))

console.log('\n--- what must be accepted ---')
check('accepts state from the current seed',
  !isStale({ version, seedStamp: stamp, projects: seed.projects }))

console.log(`\nstamp: ${stamp}`)
/* ---------------- the one-off ownership repair ---------------- */
console.log('\n--- repairing state the old PIC write already saved ---')
{
  const { repairState, REPAIR_VERSION, computePlan, DEFAULT_SETTINGS } = await import('../src/lib/model.js')

  check('a repair is stamped separately from the cache VERSION',
    Number.isFinite(REPAIR_VERSION), `r${REPAIR_VERSION}`)
  check('BUMPING A REPAIR DOES NOT DISCARD THE PLAN',
    !src.includes('parsed.repair !== REPAIR') && !src.includes('repair !== REPAIR ||'),
    'a repair must fix state in place, not throw the user\'s edits away')
  check('a fresh state carries the stamp', src.includes('repair: REPAIR'))
  check('the cache runs it on load', /return repairState\(/.test(src))
  check('and a scenario file goes through the same path', /resolve\(repairState\(/.test(src))
  // The stamp must come from what was STORED. freshState carries the current
  // one, so merging first handed old state a stamp it never earned and the
  // repair skipped the very state it exists for.
  check('THE STAMP IS READ FROM THE STORED STATE, NOT THE MERGE',
    (src.match(/repair: parsed\.repair/g) || []).length === 2,
    `${(src.match(/repair: parsed\.repair/g) || []).length} of 2 entry points`)

  // Damaged exactly as the old build left it: the PIC was moved, the
  // contributor list was not. Version and seed stamp are current, so this
  // state is NOT stale — it loads, and it is wrong.
  const damaged = {
    version, seedStamp: stamp, meta: seed.meta, people: seed.people,
    projects: seed.projects.map((p) => (p.key === 'FNP-379' ? { ...p, pic: 'gun' } : p)),
    settings: DEFAULT_SETTINGS,
  }
  const asLoaded = computePlan(damaged)
  check('the damaged state is not stale, so it really would load',
    !(damaged.version !== version || damaged.seedStamp !== stamp))
  /*
   * This state used to load WRONG: the PIC had been moved and the contributor
   * list had not, and credit was read off the contributor list. Credit now
   * follows the PIC alone, so the same state loads correctly with or without
   * the repair — the class of damage the repair exists for cannot happen any
   * more. The repair still runs, because a plan saved back then can still
   * carry a stale contributor list, and it should be tidied.
   */
  check('THE DAMAGE THIS REPAIR EXISTS FOR CANNOT HAPPEN ANY MORE',
    Math.abs((asLoaded.projects.find((p) => p.key === 'FNP-379').shares.gun || 0) - 1) < 1e-9
    && !asLoaded.projects.find((p) => p.key === 'FNP-379').shares.james,
    JSON.stringify(asLoaded.projects.find((p) => p.key === 'FNP-379').shares))

  const fixed = repairState(damaged)
  const after = computePlan(fixed)
  const one = after.projects.find((p) => p.key === 'FNP-379')
  check('and the repair leaves it right too', Math.abs((one.shares.gun || 0) - 1) < 1e-9, JSON.stringify(one.shares))
  check('the old owner no longer carries it',
    !after.people.find((p) => p.id === 'james').rows.some((r) => r.p.key === 'FNP-379'))
  check('and it stamps the state so it never runs twice', fixed.repair === REPAIR_VERSION)
  check('the rest of the plan survives untouched',
    fixed.projects.length === damaged.projects.length)
  /*
   * The roster may GROW — an assignable-but-unmeasured entry added after this
   * plan was saved has to be reachable, or the person filling in the register
   * cannot pick it. It may never shrink, and nobody already on it may be
   * rewritten: a scorecard is what somebody is appraised against.
   */
  check('and the roster only gains, never loses or rewrites',
    damaged.people.every((p) => JSON.stringify(fixed.people.find((x) => x.id === p.id)) === JSON.stringify(p))
    && fixed.people.length >= damaged.people.length,
    `${damaged.people.length} -> ${fixed.people.length}: ${fixed.people.map((p) => p.id).join(',')}`)
  check('what it gains carries no scorecard',
    fixed.people.filter((p) => !damaged.people.some((x) => x.id === p.id)).every((p) => p.scorecard === false),
    fixed.people.filter((p) => !damaged.people.some((x) => x.id === p.id)).map((p) => p.nick).join(',') || 'nothing added')
  check('the team total does not move',
    Math.abs(asLoaded.totals.totalHours - after.totals.totalHours) < 1e-9)

  // Already stamped: a deliberate hand-set arrangement must survive. This is
  // the same SHAPE the repair looks for, which is why it is stamped and runs
  // once rather than on every load.
  const deliberate = repairState({
    ...damaged,
    repair: REPAIR_VERSION,
    projects: seed.projects.map((p) => (p.key === 'FNP-379'
      ? { ...p, pic: 'gun', contributors: [{ person: 'kade', roles: ['dev'] }] } : p)),
  })
  const kept = deliberate.projects.find((p) => p.key === 'FNP-379')
  check('A STAMPED STATE IS LEFT EXACTLY AS THE USER SET IT',
    kept.contributors.length === 1 && kept.contributors[0].person === 'kade',
    JSON.stringify(kept.contributors))
  check('repairing an already-repaired state is a no-op',
    JSON.stringify(repairState(fixed)) === JSON.stringify(fixed))
}

/* ---------------- a target typed in a unit that no longer exists ---------------- */
console.log(String.fromCharCode(10) + '--- a target typed against a unit the objective no longer uses ---')
{
  const { repairTargetUnits, repairState, REPAIR_VERSION, computePlan, DEFAULT_SETTINGS, fmtTarget }
    = await import('../src/lib/model.js')

  // Objectives 4 and 5 were weighed in hours and now count deliverables, so a
  // stored 400 stopped meaning 400 hours and started reading as 400 dashboards.
  const damaged = {
    version, seedStamp: stamp, repair: 1, meta: seed.meta, projects: seed.projects,
    settings: DEFAULT_SETTINGS,
    people: seed.people.map((p) => (p.id === 'gun'
      ? { ...p, kpi: { 'obj-efficiency': { target: 400, weight: 0.2 }, 'obj-ai_automation': { target: 700 } } }
      : p)),
  }
  const before = computePlan(damaged).people.find((p) => p.id === 'gun')
  check('the damaged state really does read as the wrong unit',
    /400 dashboards/.test(fmtTarget(before.kpiLines.find((l) => l.id === 'obj-efficiency'))),
    fmtTarget(before.kpiLines.find((l) => l.id === 'obj-efficiency')))

  const { cleared } = repairTargetUnits(damaged.people)
  check('the repair reports what it cleared', cleared === 2, String(cleared))

  const fixed = repairState(damaged)
  const after = computePlan(fixed).people.find((p) => p.id === 'gun')
  const eff = after.kpiLines.find((l) => l.id === 'obj-efficiency')
  check('THE STALE TARGET IS GONE, AND THE LINE STATES WHAT IS REAL',
    eff.target === (after.countByObjective.efficiency || 0) && eff.target !== 400,
    fmtTarget(eff))
  check('and so is the other one',
    after.kpiLines.find((l) => l.id === 'obj-ai_automation').target !== 700)
  check('A TYPED WEIGHT SURVIVES — a share means the same in any unit',
    Math.abs(eff.weight - 0.2) < 1e-9, `${Math.round(eff.weight * 100)}%`)
  check('the card still totals 100%', computePlan(fixed).invalid.length === 0)
  check('it is stamped so it runs once', fixed.repair === REPAIR_VERSION)
  check('and a state already stamped is left alone',
    repairTargetUnits(repairState(fixed).people).cleared === 0)

  // A target typed against an objective whose unit did NOT change must stay.
  const kept = repairState({
    ...damaged,
    repair: 1,
    people: seed.people.map((p) => (p.id === 'gun'
      ? { ...p, kpi: { 'obj-process_automation': { target: 3500 } } } : p)),
  })
  check('a target on an objective that did not change is untouched',
    kept.people.find((p) => p.id === 'gun').kpi['obj-process_automation'].target === 3500)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
