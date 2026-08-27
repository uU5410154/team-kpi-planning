import seed from '../data/seed.json'
import { DEFAULT_SETTINGS, repairState, repairRoster, REPAIR_VERSION } from './model.js'

const KEY = 'fa-tech-kpi-2026'
// 5: the corporate and capability KPI lines were dropped, and typed weights are
// now held rather than rescaled — cached state pinned by the old rescale would
// come back off the grid and block the save.
const VERSION = 5

// The repair stamp and the repairs themselves live in the model, so they can
// be tested without a bundler and so every way state arrives — this cache, a
// scenario file, a scenario read out of the database — goes through one path.
const REPAIR = REPAIR_VERSION
export { repairState }

/** FNV-1a. Cheap, stable, and enough to tell two seed files apart. */
function hash(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Fingerprint of the bundled seed, over its CONTENT rather than its shape.
 *
 * Counting rows was not enough: adding aggregatesTeam to the team lead changed
 * no count, so every existing browser kept its old roster and the lead's card
 * silently stayed personal. Any change to the bundled baseline — a new
 * workbook, a repriced project, a new person flag — now invalidates the cache.
 */
const seedStamp = () =>
  `${seed.meta?.source || '?'}|${seed.projects.length}|${seed.people.length}|` +
  `${hash(JSON.stringify(seed.people))}|${hash(JSON.stringify(seed.projects))}`

/**
 * Fingerprint of the plan's CONTENT — what it holds, not when it was written.
 *
 * Stamped whenever the browser and the database agree (a load or a save). If
 * it still matches later, nobody has typed anything since, and a newer plan in
 * the database can be taken without asking: there is nothing here to lose.
 * If it differs, this browser holds work of its own and must never be
 * overwritten without being asked.
 */
/*
 * Stable across key ORDER, which JSON.stringify is not.
 *
 * The same settings object reaches the hash built two ways — `{...defaults,
 * ...stored}` on load and `{...current, ...incoming}` after a fetch — and the
 * keys come out in different orders. Identical content, different string,
 * different hash: the browser then reported edits nobody had made, on every
 * single refresh, and the only way out was a warning that would not go away.
 */
const stable = (v) => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export const planHash = (s) => hash(stable([
  s?.projects || [], s?.people || [], s?.settings || {}, s?.scenarioName || '',
]))

export const freshState = () => ({
  version: VERSION,
  repair: REPAIR,
  seedStamp: seedStamp(),
  meta: seed.meta,
  /*
   * The roster the app actually holds, not the one the file ships.
   *
   * freshState stamps the CURRENT repair version, so repairState treats it as
   * already migrated and never runs on it — the seed's roster stayed as
   * written while every loaded plan gained the assignable-but-unmeasured
   * entries. The two could then never compare equal, so a browser holding
   * nothing but the mirrored seed looked like somebody's work in progress and
   * the shared plan was refused indefinitely.
   */
  people: repairRoster(seed.people.map((p) => ({ ...p }))).people,
  projects: seed.projects.map((p) => ({ ...p })),
  settings: { ...DEFAULT_SETTINGS },
  /*
   * The home screen: shortcuts the team keeps together, in folders they
   * arrange themselves. Part of the plan rather than of one browser, because
   * a link somebody found is worth more to the six of them than to one.
   */
  apps: [],
  scenarioName: 'Baseline',
})

/*
 * WHAT BELONGS TO THE PLAN, AND WHAT BELONGS TO THIS BROWSER.
 *
 * Everything in the state is shared EXCEPT the few things below, which are
 * this browser's own bookkeeping. Stated as a denylist on purpose: it used to
 * be an allowlist, written out by hand in three separate places, and the Apps
 * page was added to the state and to none of them — so a home screen everybody
 * was meant to share never left the machine it was arranged on.
 *
 * An allowlist forgets. A denylist cannot: a new field is shared the moment it
 * exists, and anything that genuinely should not be has to be named here,
 * deliberately, where the reason is written next to it.
 */
export const LOCAL_ONLY_KEYS = [
  // Cache-invalidation stamps. They say what THIS browser last read from the
  // bundled seed, and sharing them would tell everybody else's cache it was
  // fresh when it is not.
  'version',
  'seedStamp',
  // Which scenario this browser is looking at. The plan is the document; the
  // name is where you happen to have it open.
  'scenarioName',
  // Marks left by the sharing machinery itself, never part of a plan.
  'syncedAt',
  'syncHash',
]

/** The plan, as it should be stored and shared. */
export function sharedPayload(state) {
  const out = {}
  for (const [k, v] of Object.entries(state || {})) {
    if (!LOCAL_ONLY_KEYS.includes(k)) out[k] = v
  }
  return out
}

/**
 * A shared plan, folded into this browser's state.
 *
 * The mirror of sharedPayload, and it has to stay the mirror: whatever is
 * saved is taken back. Settings merge over the defaults rather than replacing
 * them, so a plan saved before a setting existed does not blank it.
 */
export function applyShared(state, payload) {
  const next = { ...state }
  for (const [k, v] of Object.entries(payload || {})) {
    if (LOCAL_ONLY_KEYS.includes(k)) continue
    if (v === undefined) continue
    next[k] = k === 'settings' ? { ...state.settings, ...v } : v
  }
  return next
}

/** True when cached state predates the current seed and has to be dropped. */
export function isStale(parsed) {
  return (
    !parsed ||
    parsed.version !== VERSION ||
    !Array.isArray(parsed.projects) ||
    parsed.seedStamp !== seedStamp()
  )
}

/**
 * Has this browser ever held a plan?
 *
 * The app boots from this browser, not from the database — which is right for
 * unsaved work and wrong on a machine that has never opened it, where the
 * fallback is the bundled seed and every manday reads empty. This is how the
 * startup path tells "nothing here yet" from "someone's work in progress".
 */
export function hasStoredState() {
  try {
    return !!localStorage.getItem(KEY)
  } catch {
    return false
  }
}

/**
 * Is what this browser holds just the bundled seed, untouched?
 *
 * hasStoredState is not enough on its own. The app mirrors state into local
 * storage on mount, so a window that has merely OPENED the app is holding a
 * copy of the seed — and it then looked like somebody's work in progress and
 * was told a newer plan existed rather than being given it. An incognito
 * window reported exactly that on its second load.
 *
 * Compared against the seed by content: if the register, the roster and the
 * settings are all still the bundled ones, there is nothing here to protect.
 */
export function isUntouchedSeed(parsed) {
  if (!parsed || !Array.isArray(parsed.projects)) return true
  /*
   * Compared against the seed AS THE APP HOLDS IT, not as the file ships.
   *
   * The repair runs on the way in, so a browser that has only opened the app
   * is holding the REPAIRED seed — and comparing that to the raw file made it
   * look like somebody's work in progress the moment a new repair landed. The
   * app then refused the shared plan and showed the bundled baseline instead,
   * which reads on screen as "the database is not connected".
   *
   * Both sides go through the same repair, so the comparison asks the only
   * question that matters: is there anything here that did not come from the
   * seed.
   */
  const fresh = repairState(freshState())
  const mine = repairState({ ...parsed })
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  return same(mine.projects, fresh.projects)
    && same(mine.people, fresh.people)
    && same(parsed.settings, fresh.settings)
}

/** Nothing worth keeping: no stored plan, or the bundled seed as it came. */
export function hasNothingOfItsOwn() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return true
    return isUntouchedSeed(JSON.parse(raw))
  } catch {
    return true
  }
}

/**
 * Record that this browser and the database now hold the same plan.
 *
 * The fingerprint is taken from what is IN LOCAL STORAGE, not from the state
 * in memory, and `syncStatus` below reads it back from the same place. That
 * is the whole point: the in-memory state is merged with defaults and run
 * through the repairs on its way in and out, so hashing one and comparing the
 * other reported edits nobody had made — and the warning came back on every
 * refresh, which is how a warning stops being read.
 */
export function markSynced(updatedAt) {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return false
    const next = { ...JSON.parse(raw), syncedAt: updatedAt || null }
    next.syncHash = planHash(next)
    localStorage.setItem(KEY, JSON.stringify(next))
    return true
  } catch {
    return false
  }
}

/**
 * What this browser knows about its relationship with the database.
 *
 * `untouched` is only ever true when there is a mark AND the plan still
 * matches it — never a guess. A browser that has never been marked says so,
 * so the caller can ask rather than assume either way.
 */
export function syncStatus() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { marked: false, untouched: false, syncedAt: null }
    const parsed = JSON.parse(raw)
    if (!parsed.syncHash) return { marked: false, untouched: false, syncedAt: parsed.syncedAt || null }
    return {
      marked: true,
      untouched: planHash(parsed) === parsed.syncHash,
      syncedAt: parsed.syncedAt || null,
    }
  } catch {
    return { marked: false, untouched: false, syncedAt: null }
  }
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return freshState()
    const parsed = JSON.parse(raw)
    if (isStale(parsed)) return freshState()
    // Merge forward so a settings key added in a later build is never undefined,
    // then apply any repair this state predates.
    //
    // The stamp is taken from what was STORED, not from the merge: freshState
    // carries the current stamp, so merging first handed old state a stamp it
    // never earned and the repair skipped the very state it exists for.
    return repairState({
      ...freshState(),
      ...parsed,
      repair: parsed.repair,
      settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
    })
  } catch {
    return freshState()
  }
}

/** Did this session start by discarding stale cached state? */
export function loadWasReset() {
  try {
    const raw = localStorage.getItem(KEY)
    return !!raw && isStale(JSON.parse(raw))
  } catch {
    return false
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function downloadScenario(state) {
  const blob = new Blob([JSON.stringify(state, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fa-tech-kpi-2026-${(state.scenarioName || 'scenario').replace(/\W+/g, '-').toLowerCase()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function readScenarioFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      try {
        const parsed = JSON.parse(String(r.result))
        if (!Array.isArray(parsed.projects) || !Array.isArray(parsed.people)) {
          reject(new Error('Not a valid scenario file — missing projects or people.'))
          return
        }
        resolve(repairState({
          ...freshState(),
          ...parsed,
          repair: parsed.repair,
          settings: { ...DEFAULT_SETTINGS, ...parsed.settings },
        }))
      } catch (e) {
        reject(new Error(`Could not parse the file: ${e.message}`))
      }
    }
    r.onerror = () => reject(new Error('Could not read the file.'))
    r.readAsText(file)
  })
}
