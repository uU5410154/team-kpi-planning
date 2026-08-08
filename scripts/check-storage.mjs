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
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
