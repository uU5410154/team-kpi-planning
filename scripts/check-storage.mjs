/**
 * Guards the cache-invalidation rule: a browser holding state from an older
 * seed must discard it. Without this, changing the source workbook leaves
 * returning users looking at the previous totals indefinitely.
 */
import { readFileSync } from 'node:fs'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const src = readFileSync(new URL('../src/lib/storage.js', import.meta.url), 'utf8')

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// Recreate the module's stamp rule against the current seed.
const stamp = `${seed.meta?.source || '?'}|${seed.projects.length}`
const version = Number(src.match(/const VERSION = (\d+)/)?.[1])

check('storage declares a VERSION', Number.isFinite(version), `v${version}`)
check('storage fingerprints the seed', src.includes('seedStamp'))
check('loadState drops stale state', src.includes('isStale(parsed)'))
check('seed carries a source in meta', !!seed.meta?.source, seed.meta?.source)

// Simulate: state saved by an older build must be rejected.
const cases = [
  ['older version', { version: version - 1, seedStamp: stamp, projects: [] }],
  ['older seed (Jira export)', { version, seedStamp: 'JIRA-F&A-Tech-team.xlsx / sheet JIRA-F&A-Tech-team|101', projects: [] }],
  ['different project count', { version, seedStamp: `${seed.meta.source}|999`, projects: [] }],
  ['missing stamp', { version, projects: [] }],
]
for (const [label, parsed] of cases) {
  const stale =
    !parsed || parsed.version !== version || !Array.isArray(parsed.projects) || parsed.seedStamp !== stamp
  check(`rejects cached state: ${label}`, stale)
}

// Current state must be accepted.
const good = { version, seedStamp: stamp, projects: seed.projects }
const staleGood =
  good.version !== version || !Array.isArray(good.projects) || good.seedStamp !== stamp
check('accepts state from the current seed', !staleGood)

console.log(`\nseed stamp: ${stamp}`)
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
