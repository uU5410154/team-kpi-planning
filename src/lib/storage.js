import seed from '../data/seed.json'
import { DEFAULT_SETTINGS } from './model.js'

const KEY = 'fa-tech-kpi-2026'
const VERSION = 1

export const freshState = () => ({
  version: VERSION,
  meta: seed.meta,
  people: seed.people.map((p) => ({ ...p })),
  projects: seed.projects.map((p) => ({ ...p })),
  settings: { ...DEFAULT_SETTINGS },
  scenarioName: 'Baseline (from Jira)',
})

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return freshState()
    const parsed = JSON.parse(raw)
    if (parsed.version !== VERSION || !Array.isArray(parsed.projects)) return freshState()
    // Merge forward so a settings key added in a later build is never undefined.
    return { ...freshState(), ...parsed, settings: { ...DEFAULT_SETTINGS, ...parsed.settings } }
  } catch {
    return freshState()
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
