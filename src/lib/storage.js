import seed from '../data/seed.json'
import { DEFAULT_SETTINGS } from './model.js'

const KEY = 'fa-tech-kpi-2026'
// 5: the corporate and capability KPI lines were dropped, and typed weights are
// now held rather than rescaled — cached state pinned by the old rescale would
// come back off the grid and block the save.
const VERSION = 5

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

export const freshState = () => ({
  version: VERSION,
  seedStamp: seedStamp(),
  meta: seed.meta,
  people: seed.people.map((p) => ({ ...p })),
  projects: seed.projects.map((p) => ({ ...p })),
  settings: { ...DEFAULT_SETTINGS },
  scenarioName: 'Baseline',
})

/** True when cached state predates the current seed and has to be dropped. */
export function isStale(parsed) {
  return (
    !parsed ||
    parsed.version !== VERSION ||
    !Array.isArray(parsed.projects) ||
    parsed.seedStamp !== seedStamp()
  )
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return freshState()
    const parsed = JSON.parse(raw)
    if (isStale(parsed)) return freshState()
    // Merge forward so a settings key added in a later build is never undefined.
    return { ...freshState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } }
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
        resolve({ ...freshState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } })
      } catch (e) {
        reject(new Error(`Could not parse the file: ${e.message}`))
      }
    }
    r.onerror = () => reject(new Error('Could not read the file.'))
    r.readAsText(file)
  })
}
