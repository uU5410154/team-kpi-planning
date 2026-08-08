import seed from '../data/seed.json'
import { DEFAULT_SETTINGS } from './model.js'

const KEY = 'fa-tech-kpi-2026'
const VERSION = 3

/**
 * Fingerprint of the bundled seed. Cached state built from a different source
 * workbook is stale and must be discarded — otherwise a browser that used an
 * earlier build keeps showing the old totals forever, which is exactly what
 * happened when the register moved off the Jira export.
 */
const seedStamp = () =>
  `${seed.meta?.source || '?'}|${seed.projects.length}|${seed.people.length}`

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
