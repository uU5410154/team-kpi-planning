/**
 * Everything in the plan reaches the database, and comes back.
 *
 * The Apps page was added to the state and to none of the three hand-written
 * field lists that decide what gets saved and loaded — so a home screen meant
 * to be shared by six people never left the machine it was arranged on. The
 * lists were allowlists, and an allowlist forgets.
 *
 * This is the guarantee that replaces them: every field a fresh plan has is
 * either SHARED or NAMED as local-only, with nothing in between, and a round
 * trip through the payload brings all of it back unchanged. Add a field to the
 * state tomorrow and it is shared without anybody remembering to do anything;
 * decide it should not be and this file makes you say so out loud.
 *
 *   node scripts/check-sharedfields.mjs
 */
import { readFileSync } from 'node:fs'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/*
 * storage.js imports the seed as JSON, which Vite allows and Node does not, so
 * the module is exercised through its source rather than imported. The three
 * functions under test are pure and small enough to evaluate directly.
 */
const src = readFileSync(new URL('../src/lib/storage.js', import.meta.url), 'utf8')
const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))

const grab = (name) => {
  const at = src.indexOf(`export function ${name}(`)
  if (at < 0) throw new Error(`${name} is not exported from storage.js`)
  let depth = 0
  let i = src.indexOf('{', at)
  const start = at + 'export '.length
  for (let n = i; n < src.length; n++) {
    if (src[n] === '{') depth++
    if (src[n] === '}') { depth--; if (depth === 0) { i = n; break } }
  }
  return src.slice(start, i + 1)
}
const keysAt = src.indexOf('export const LOCAL_ONLY_KEYS = [')
const localOnly = JSON.parse(
  src.slice(src.indexOf('[', keysAt), src.indexOf(']', keysAt) + 1)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'/g, '"')
    .replace(/,(\s*])/g, '$1'),
)
// eslint-disable-next-line no-new-func
const { sharedPayload, applyShared } = new Function(
  `const LOCAL_ONLY_KEYS = ${JSON.stringify(localOnly)};
   ${grab('sharedPayload')}
   ${grab('applyShared')}
   return { sharedPayload, applyShared }`,
)()

/* The shape a fresh plan has, read from the source of freshState itself. */
const freshSrc = src.slice(src.indexOf('export const freshState = () => ({'))
const fields = [...freshSrc.slice(0, freshSrc.indexOf('\n})')).matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*):/gm)]
  .map((m) => m[1])

console.log('— every field is decided, one way or the other —')
check('the fresh plan has fields to check', fields.length >= 6, fields.join(', '))
check('LOCAL_ONLY_KEYS is a real list', Array.isArray(localOnly) && localOnly.length > 0, localOnly.join(', '))
const shared = fields.filter((f) => !localOnly.includes(f))
console.log(`  shared: ${shared.join(', ')}`)
console.log(`  local : ${localOnly.join(', ')}`)
check('THE APPS PAGE IS SHARED', shared.includes('apps'),
  'a home screen six people arrange together cannot live in one browser')
check('the register and the roster are shared',
  shared.includes('projects') && shared.includes('people') && shared.includes('settings'))
check('the cache stamps are NOT shared',
  localOnly.includes('version') && localOnly.includes('seedStamp'),
  'they say what this browser read from the bundled seed')
check('every field is either shared or named local-only',
  fields.every((f) => shared.includes(f) || localOnly.includes(f)),
  fields.filter((f) => !shared.includes(f) && !localOnly.includes(f)).join(', ') || 'all accounted for')

console.log('\n— and a round trip brings all of it back —')
const state = {
  version: 9,
  seedStamp: 'abc',
  scenarioName: 'Baseline',
  syncedAt: '2026-01-01T00:00:00.000Z',
  syncHash: 'deadbeef',
  repair: 6,
  meta: seed.meta,
  people: seed.people,
  projects: seed.projects.slice(0, 3),
  settings: { sprintDays: 14, currency: 'THB' },
  apps: [
    { id: 'app-1', type: 'app', name: 'Jira', url: 'https://jira.test', icon: null },
    { id: 'folder-1', type: 'folder', name: 'Power BI', items: [{ id: 'app-2', type: 'app', name: 'Sales', url: 'https://bi.test', icon: null }] },
  ],
}

const payload = sharedPayload(state)
check('the payload carries the apps', JSON.stringify(payload.apps) === JSON.stringify(state.apps))
check('  including what is inside a folder',
  payload.apps[1].items.length === 1 && payload.apps[1].items[0].name === 'Sales')
check('the payload carries the register and roster',
  payload.projects.length === 3 && payload.people.length === seed.people.length)
check('the payload does NOT carry this browser\'s bookkeeping',
  localOnly.every((k) => !(k in payload)),
  localOnly.filter((k) => k in payload).join(', ') || 'none of it')

/* And back again, into a different browser holding different local marks. */
const other = {
  version: 9,
  seedStamp: 'abc',
  scenarioName: 'Something Else',
  repair: 1,
  meta: {},
  people: [],
  projects: [],
  settings: { currency: 'THB', savingBasis: 'monthly' },
  apps: [],
}
const back = applyShared(other, payload)
check('THE OTHER BROWSER GETS THE APPS', JSON.stringify(back.apps) === JSON.stringify(state.apps),
  `${back.apps.length} items`)
check('  and the register with them', back.projects.length === 3)
check('  and its own scenario name is left alone', back.scenarioName === 'Something Else')
check('  and its own cache stamps are left alone',
  back.version === 9 && back.seedStamp === 'abc')
check('settings MERGE rather than replace — a plan saved before a setting existed cannot blank it',
  back.settings.savingBasis === 'monthly' && back.settings.sprintDays === 14,
  JSON.stringify(back.settings))

/* Every shared field survives the trip, whatever it is. */
const lost = shared.filter((f) => f in state && JSON.stringify(back[f]) !== JSON.stringify(state[f]))
  .filter((f) => f !== 'settings')
check('NOT ONE SHARED FIELD IS LOST ON THE WAY', lost.length === 0, lost.join(', ') || 'all of them survived')

console.log('\n— and nothing writes its own field list any more —')
/*
 * The bug was three hand-written lists that drifted apart. If one comes back,
 * this catches it: no call to saveScenario may build its payload inline, and
 * the load path must go through applyShared.
 */
const inlinePayload = /saveScenario\(\s*name,\s*\{/.test(appSrc)
check('no save builds its payload by hand', !inlinePayload,
  'saveScenario must be handed sharedPayload(state)')
check('both saves go through sharedPayload',
  (appSrc.match(/sharedPayload\(state\)/g) || []).length >= 2,
  `${(appSrc.match(/sharedPayload\(state\)/g) || []).length} call sites`)
check('the load goes through applyShared', /applyShared\(s, doc\.payload\)/.test(appSrc))

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
