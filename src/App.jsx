import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  ThemeProvider, CssBaseline, Box, AppBar, Toolbar, Typography, Tabs, Tab,
  Button, IconButton, Tooltip, Snackbar, Alert, Chip, Divider, Menu, MenuItem,
  CircularProgress,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeIcon from '@mui/icons-material/LightModeOutlined'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DataObjectIcon from '@mui/icons-material/DataObject'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import ScenarioDialog from './components/ScenarioDialog.jsx'

import { buildTheme } from './theme.js'
import { computePlan, newProject, rebalanceWeights, reassignPatch } from './lib/model.js'
import { applyImport } from './lib/projectIO.js'
import * as api from './lib/api.js'
import {
  loadState, saveState, freshState, downloadScenario, readScenarioFile, loadWasReset, repairState,
  markSynced, syncStatus,
  hasNothingOfItsOwn,
} from './lib/storage.js'
import { exportWorkbook } from './lib/exportXlsx.js'

import Dashboard from './pages/Dashboard.jsx'
import Projects from './pages/Projects.jsx'
import People from './pages/People.jsx'
import Team from './pages/Team.jsx'
import Timeline from './pages/Timeline.jsx'
import Settings from './pages/Settings.jsx'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projects', label: 'Projects' },
  { id: 'people', label: 'Scorecards' },
  // Beside the individual cards, not instead of them: one answers what a
  // person is measured on, the other whether the team adds up.
  { id: 'team', label: 'Overall team' },
  // Beside the register rather than inside it: the register answers what a
  // project is worth, this answers when it was supposed to land.
  { id: 'timeline', label: 'Timeline' },
  { id: 'settings', label: 'Model' },
]

/*
 * Where the app opens: the register.
 *
 * The dashboard summarises what the register says, and nobody arrives wanting
 * a summary of work they have not entered yet. A link that names a tab still
 * wins — the hash is what a bookmark carries.
 */
const DEFAULT_TAB = 'projects'

const tabFromHash = () => {
  const h = window.location.hash.replace('#', '')
  return TABS.some((t) => t.id === h) ? h : DEFAULT_TAB
}

export default function App() {
  // Dark unless this browser has been told otherwise. A choice already made
  // here is still honoured — the toggle would be pointless if a reload undid it.
  const [mode, setMode] = useState(() => localStorage.getItem('fa-kpi-mode') || 'dark')
  const [tab, setTab] = useState(tabFromHash)
  // Evaluate before the first save effect overwrites the cached copy.
  const [wasReset] = useState(loadWasReset)
  const [state, setState] = useState(loadState)
  const [toast, setToast] = useState(null)
  const [menuEl, setMenuEl] = useState(null)
  const [scenario, setScenario] = useState(null) // 'save' | 'open' | null
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const fileRef = useRef(null)
  const firstRender = useRef(true)

  const theme = useMemo(() => buildTheme(mode), [mode])
  const plan = useMemo(() => computePlan(state), [state])

  /*
   * One write, one mark. The mark has to describe the bytes that just landed
   * in local storage, so it is taken here rather than wherever the sync
   * happened — anything else races the very write it is trying to describe.
   */
  const pendingSync = useRef(null)
  useEffect(() => {
    saveState(state)
    if (pendingSync.current !== null) {
      markSynced(pendingSync.current)
      pendingSync.current = null
    }
  }, [state])
  useEffect(() => { localStorage.setItem('fa-kpi-mode', mode) }, [mode])

  /*
   * A browser that has never held a plan takes the shared one.
   *
   * The app boots from this browser, which is right for work in progress and
   * wrong on a second machine: with nothing in local storage it fell back to
   * the bundled seed and every manday, cost and return read empty, as though
   * the database were not connected at all.
   *
   * It only ever fills a BLANK browser. Work already here is never replaced —
   * that would throw away edits nobody had finished — so an existing plan gets
   * told the database has a newer one and is left alone.
   */
  const [dbNotice, setDbNotice] = useState(null)
  const [loadingShared, setLoadingShared] = useState(false)
  /*
   * Read during the FIRST RENDER, not inside the effect.
   *
   * The effect that mirrors state into local storage runs first, so by the
   * time this one asked, every browser looked like it already held a plan —
   * the seed it had just written a millisecond earlier — and none of them ever
   * took the shared one.
   */
  const startedBlank = useRef(hasNothingOfItsOwn())
  /*
   * Nothing is shown until the shared plan has been asked for.
   *
   * The app painted the bundled seed first and swapped the real plan in when
   * the fetch returned. On a cold instance that took fifteen seconds, and for
   * fifteen seconds every manday, cost and return on screen read zero — which
   * is exactly what somebody opening it in a new window reports as "all the
   * data is missing".
   *
   * Only a browser that has nothing of its own waits. One that already holds a
   * plan has something true to show immediately.
   */
  const [bootstrapping, setBootstrapping] = useState(startedBlank.current)
  /*
   * Take the shared plan. One path, so the automatic case and the button can
   * never end up doing subtly different things.
   */
  const takeShared = useCallback(async (entry, how) => {
    const doc = await api.loadScenario(entry.name)
    if (!doc?.payload?.projects) throw new Error('That scenario has no projects in it.')
    let taken = null
    setState((s) => {
      const next = repairState({
        ...s,
        people: doc.payload.people,
        projects: doc.payload.projects,
        settings: { ...s.settings, ...doc.payload.settings },
        repair: doc.payload.repair,
        scenarioName: entry.name,
      })
      // Stamped as agreeing with the database, so the next visit can tell
      // "untouched since the last sync" from "somebody has been working".
      taken = next
      return taken
    })
    pendingSync.current = entry.updatedAt
    setLastSaved(entry.updatedAt)
    linkedToDb.current = true
    setDbNotice(null)
    setTimeout(() => setDirty(false), 0)
    setToast({
      severity: 'success',
      msg: `${how} "${entry.name}" from the shared database — ${doc.payload.projects.length} projects.`,
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const blank = startedBlank.current
    // Never stuck on the spinner. Whatever happens to the request — a slow
    // instance, a proxy that swallows it, no database at all — the app shows
    // what it has after this, and the shared plan still lands when it arrives.
    const cap = setTimeout(() => { if (!cancelled) setBootstrapping(false) }, 2500)
    ;(async () => {
      try {
        // Ask whether there IS a database before waiting on one. Without this
        // the app sat on the loading screen for its whole timeout on any
        // deployment that has no store configured, which is every local run.
        const store = await api.storeStatus()
        if (cancelled) return
        if (!store.connected) { setBootstrapping(false); return }

        const list = await api.listScenarios()
        if (cancelled || !Array.isArray(list) || !list.length) return
        const latest = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
        if (!blank) {
          /*
           * This browser holds a plan — but holding one is not the same as
           * having work in it. If its content still matches the fingerprint
           * taken when it last agreed with the database, nobody has typed
           * anything since, and refusing the newer plan just leaves somebody
           * reading last week's register and reporting the app as broken.
           *
           * Only genuinely unsaved work stops it, and then it asks.
           */
          const sync = syncStatus()
          const isNewer = String(latest.updatedAt || '') !== String(sync.syncedAt || '')
          /*
           * Nothing to say. This browser is already holding what the database
           * holds — it took it, or it saved it. Warning here is how the notice
           * came back on every refresh after somebody had already answered it,
           * which teaches people to click past the one that matters.
           */
          if (!isNewer) return
          if (sync.untouched) {
            await takeShared(latest, 'Updated to')
            return
          }
          /*
           * Two different situations, and telling them apart matters: a
           * browser with real edits stands to lose them, while one that simply
           * has no fingerprint yet — every browser, the first time it opens a
           * build that has this — stands to lose nothing at all. Saying "your
           * unsaved edits" to the second is a warning about a danger that is
           * not there, and a warning nobody can verify is one people learn to
           * click through.
           */
          setDbNotice({ ...latest, knowsOfEdits: sync.marked })
          return
        }
        await takeShared(latest, 'Loaded')
      } catch {
        // No database reachable. The browser copy stands, which is the point of
        // keeping one.
      } finally {
        clearTimeout(cap)
        if (!cancelled) setBootstrapping(false)
      }
    })()
    return () => { cancelled = true; clearTimeout(cap) }
  }, [takeShared])

  useEffect(() => {
    if (wasReset) {
      setToast({
        severity: 'info',
        msg: 'Loaded the latest source data — your browser was holding an older version of the project register.',
      })
    }
  }, [wasReset])

  // Anything that changes the plan marks it unsaved. Skip the first render so
  // simply opening the app does not look like a pending edit.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    setDirty(true)
  }, [state.projects, state.people, state.settings, state.scenarioName])

  // Don't let a closing tab silently drop unsaved edits.
  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Save the plan to the shared database under the current scenario name. */
  const saveToDb = useCallback(async () => {
    // Hard gate: a scorecard that does not total 100% must never reach the
    // database, or the export and the appraisal built from it are wrong.
    if (plan.invalid.length) {
      setTab('people')
      setToast({
        severity: 'error',
        msg: `Cannot save — ${plan.invalid.map((x) => `${x.nick} is at ${Math.round(x.sum * 100)}%`).join(', ')}. Every scorecard must total exactly 100%.`,
      })
      return
    }
    const name = (state.scenarioName || '').trim()
    if (!name) { setScenario('save'); return }
    /*
     * The other direction, and the one that actually destroys work: this
     * browser is showing an older plan it never took, and Save would put it
     * over the newer one — deleting whatever somebody else added in between,
     * with no copy of it anywhere. Nothing warned about that at all.
     */
    if (dbNotice && !window.confirm(
      `The shared "${name}" was saved ${new Date(dbNotice.updatedAt).toLocaleString()}, after this browser last had it, `
      + 'and this browser never loaded it. Saving now REPLACES that newer plan with what is on this screen, '
      + 'and whatever was added in between is gone.\n\nSave anyway?',
    )) return
    setSaving(true)
    try {
      const r = await api.saveScenario(
        name,
        { people: state.people, projects: state.projects, settings: state.settings, repair: state.repair },
        localStorage.getItem('fa-kpi-author') || '',
      )
      setDirty(false)
      setLastSaved(r.updatedAt)
      linkedToDb.current = true
      // The browser and the database now hold the same thing; mark it so the
      // next visit can take a newer plan without asking.
      pendingSync.current = r.updatedAt
      setState((s) => ({ ...s }))
      setToast({ severity: 'success', msg: `Saved "${name}" to the database.` })
    } catch (e) {
      setToast({ severity: 'error', msg: `${e.message} Your work is still safe in this browser.` })
    } finally {
      setSaving(false)
    }
  }, [state, plan.invalid, dbNotice])

  /*
   * Work reaches the database on its own.
   *
   * It only ever reached it when somebody pressed Save, and nobody presses
   * Save every time they type a manday: a browser ended up holding 1,907
   * mandays against the 1,189 in the database, and the second machine showed
   * the old figure and looked broken.
   *
   * Three conditions, all of them about not making things worse:
   *   - this browser must already be working ON the shared plan, having loaded
   *     it or saved it. A browser that has only ever seen the bundled seed must
   *     never push that over the team's work;
   *   - the plan must be valid. The same gate the Save button applies: a
   *     scorecard that does not total 100% must not reach the database, or the
   *     appraisal built from it is wrong;
   *   - it waits for the typing to stop. Saving on every keystroke would write
   *     a document a second and store a half-typed number as though it were a
   *     decision.
   */
  const linkedToDb = useRef(false)
  const autoSaveTimer = useRef(null)
  useEffect(() => {
    if (!dirty || !linkedToDb.current) return undefined
    if (plan.invalid.length) return undefined
    const name = (state.scenarioName || '').trim()
    if (!name) return undefined

    autoSaveTimer.current = setTimeout(async () => {
      try {
        const r = await api.saveScenario(
          name,
          {
            people: state.people,
            projects: state.projects,
            settings: state.settings,
            repair: state.repair,
          },
          localStorage.getItem('fa-kpi-author') || '',
        )
        setDirty(false)
        setLastSaved(r.updatedAt)
        // The browser and the database agree again — mark it, exactly as the
        // Save button does. Without this the automatic save moved the
        // database on and left the browser's mark behind, so the next visit
        // read its own work as somebody else's and asked about it.
        pendingSync.current = r.updatedAt
        setState((cur) => ({ ...cur }))
      } catch {
        // Offline, or the database is down. The browser copy stands and the
        // Save button still says there is something to send.
      }
    }, 4000)
    return () => clearTimeout(autoSaveTimer.current)
  }, [dirty, state, plan.invalid.length])

  // Keep the tab in the URL hash so a view can be linked or bookmarked.
  useEffect(() => {
    if (tabFromHash() !== tab) window.location.hash = tab
  }, [tab])
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /**
    * Apply an approved import: many projects, each with its own patch.
    *
    * Projects the import did not name come back as the SAME object, so a row
    * the file never mentioned cannot be re-created or quietly rebuilt.
    */
  const applyProjectImport = useCallback((result) => {
    setState((s) => ({ ...s, projects: applyImport(s.projects, result) }))
  }, [])

  /**
    * Patch one project by Jira key.
    *
    * A PIC change is special: credit comes from the contributor list, not from
    * the `pic` field, so writing `pic` alone leaves the previous owner holding
    * the project. reassignPatch moves their entry across.
    */
  const updateProject = useCallback((key, patch) => {
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.key !== key) return p
        const full = 'pic' in patch ? { ...patch, ...reassignPatch(p, patch.pic) } : patch
        return { ...p, ...full }
      }),
    }))
  }, [])

  const updateSettings = useCallback((patch) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  }, [])

  const updatePerson = useCallback((id, patch) => {
    setState((s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  }, [])

  /**
   * Override one KPI line's weight and/or target for one person.
   *
   * An override that equals the live computed value is discarded rather than
   * stored, so the line keeps tracking project assignments. Without this,
   * setting a target to the number it already shows would pin it, and later
   * edits to the project's saving hours would never reach the scorecard.
   */
  const updatePersonKpi = useCallback((id, lineId, patch) => {
    const line = plan.people.find((x) => x.id === id)?.kpiLines.find((l) => l.id === lineId)
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const kpi = { ...(p.kpi || {}) }
        const entry = { ...(kpi[lineId] || {}), ...patch }

        if ('target' in patch) {
          const cleared = patch.target == null || patch.target === ''
          if (cleared || (line && patch.target === line.defaultTarget)) delete entry.target
        }
        if ('weight' in patch && line && Math.abs(patch.weight - line.defaultWeight) < 1e-9) {
          delete entry.weight
        }

        // Only the edited line is written. scorecardWeights holds a typed weight
        // at exactly what was typed and shares the remainder across the lines
        // that have not been touched, so the siblings must NOT be pinned here —
        // pinning them all would leave nothing free to absorb the difference.
        if (Object.keys(entry).length) kpi[lineId] = entry
        else delete kpi[lineId]

        return { ...p, kpi }
      }),
    }))
  }, [plan.people])

  const resetPersonKpi = useCallback((id) => {
    setState((s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, kpi: {}, kpiHidden: [] } : p)) }))
    setToast({ severity: 'info', msg: 'Weights, targets and removed lines all reset to the defaults.' })
  }, [])

  /**
    * Remove a KPI line from someone's scorecard.
    *
    * A derived line is HIDDEN, so it can be restored — it still exists, it is
    * just off the card. A hand-added one is DELETED: there is nothing behind it
    * to come back to, and leaving it in a restore strip only invites somebody
    * to resurrect a line the author had finished with.
    */
  const removePersonKpiLine = useCallback((id, lineId) => {
    const custom = String(lineId).startsWith('custom-')
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        return custom
          ? { ...p, customLines: (p.customLines || []).filter((l) => l.id !== lineId) }
          : { ...p, kpiHidden: [...new Set([...(p.kpiHidden || []), lineId])] }
      }),
    }))
    setToast({
      severity: 'info',
      msg: custom
        ? 'KPI line deleted. Weights no longer total 100% — rebalance before saving.'
        : 'Line removed. Weights no longer total 100% — rebalance before saving.',
    })
  }, [])

  /**
    * Type a figure over the calculated one on somebody's scorecard, or take it
    * back off. Passing null for a key reverts THAT figure and leaves the other.
    */
  const setPersonOverride = useCallback((id, patch) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const next = { ...(p.overrides || {}), ...patch }
        for (const k of Object.keys(next)) if (next[k] == null) delete next[k]
        return { ...p, overrides: next }
      }),
    }))
    const reverting = Object.values(patch).every((v) => v == null)
    setToast({
      severity: reverting ? 'success' : 'warning',
      msg: reverting
        ? 'Back to the figure the project register calculates.'
        : 'Manual figure set. It shows on the scorecard and in the export; the project register is unchanged.',
    })
  }, [])

  /** Add or update a KPI line somebody writes by hand. */
  const savePersonKpiLine = useCallback((id, line) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const lines = p.customLines || []
        const at = lines.findIndex((l) => l.id === line.id)
        return {
          ...p,
          customLines: at < 0 ? [...lines, line] : lines.map((l) => (l.id === line.id ? line : l)),
          // Adding a line to a card that had one hidden must not bring the
          // hidden one back; nothing else about the card changes.
          kpiHidden: p.kpiHidden || [],
        }
      }),
    }))
  }, [])

  /*
   * Add an objective to someone's scorecard by hand. It carries no projects, so
   * its target starts at zero and the other lines give up weight to it — which
   * is the point: it commits the person to work that is not scoped yet.
   */
  const addPersonObjective = useCallback((id, objective) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => (p.id === id
        ? { ...p, extraObjectives: [...new Set([...(p.extraObjectives || []), objective])] }
        : p)),
    }))
  }, [])

  /*
   * Removing it only takes back the manual addition. If the person has since
   * been given a project on that objective, the line stays — it is derived at
   * that point, and hiding a derived line is what the bin icon is for.
   */
  const removePersonObjective = useCallback((id, objective) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => (p.id === id
        ? { ...p, extraObjectives: (p.extraObjectives || []).filter((o) => o !== objective) }
        : p)),
    }))
  }, [])

  const restorePersonKpiLine = useCallback((id, lineId) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) =>
        p.id === id ? { ...p, kpiHidden: (p.kpiHidden || []).filter((x) => x !== lineId) } : p,
      ),
    }))
  }, [])

  /** Scale the remaining weights proportionally back to exactly 100%. */
  const rebalancePersonKpi = useCallback((id) => {
    const person = plan.people.find((p) => p.id === id)
    if (!person) return
    const next = rebalanceWeights(person.kpiLines)
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const kpi = { ...(p.kpi || {}) }
        for (const [lineId, w] of Object.entries(next)) kpi[lineId] = { ...(kpi[lineId] || {}), weight: w }
        return { ...p, kpi }
      }),
    }))
    setToast({ severity: 'success', msg: 'Weights rebalanced to 100%.' })
  }, [plan.people])

  /** Snap targets back to what the person actually carries right now. */
  const syncPersonTargets = useCallback((id) => {
    const person = plan.people.find((p) => p.id === id)
    if (!person) return
    const drifted = person.kpiLines.filter((l) => l.drifted)
    if (!drifted.length) return
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const kpi = { ...(p.kpi || {}) }
        for (const l of drifted) {
          const { target, ...rest } = kpi[l.id] || {}
          if (Object.keys(rest).length) kpi[l.id] = rest
          else delete kpi[l.id]
        }
        return { ...p, kpi }
      }),
    }))
    setToast({ severity: 'success', msg: `${drifted.length} target${drifted.length === 1 ? '' : 's'} synced to current assignments.` })
  }, [plan.people])

  const addProject = useCallback(() => {
    let created
    setState((s) => {
      // keep NEW-n unique even after deletes
      const n = s.projects.filter((p) => p.key.startsWith('NEW-')).length + 1
      let p = newProject(n)
      let i = n
      while (s.projects.some((x) => x.key === p.key)) p = newProject(++i)
      created = p
      return { ...s, projects: [p, ...s.projects] }
    })
    setToast({ severity: 'success', msg: 'Project added at the top of the list — fill in its details.' })
    return created
  }, [])

  /**
   * Add several projects at once, from a source that already knows what they
   * are — the Jira epic import.
   *
   * Separate from addProject because that one exists to give somebody a blank
   * row to type into, and says so in a toast. This one is silent and returns
   * what it made, so the caller can report on its own terms.
   */
  const addProjects = useCallback((rows) => {
    if (!rows || !rows.length) return []
    let made = []
    setState((s) => {
      let i = s.projects.filter((p) => p.key.startsWith('NEW-')).length
      const taken = new Set(s.projects.map((p) => p.key))
      made = rows.map((row) => {
        let p = newProject(++i)
        while (taken.has(p.key)) p = newProject(++i)
        taken.add(p.key)
        return { ...p, ...row }
      })
      return { ...s, projects: [...made, ...s.projects] }
    })
    return made
  }, [])

  /**
   * Swap the whole register for one somebody has already computed.
   *
   * Used by the Jira sync, which works out the new list in one pass — dates
   * refreshed and new epics folded in — rather than through a hundred separate
   * edits that would each mark the plan dirty and each fire a save.
   */
  const replaceProjects = useCallback((projects) => {
    if (!Array.isArray(projects)) return
    setState((s) => ({ ...s, projects }))
  }, [])

  const deleteProjects = useCallback((keys) => {
    const set = new Set(keys)
    setState((s) => ({ ...s, projects: s.projects.filter((p) => !set.has(p.key)) }))
    setToast({ severity: 'info', msg: `Deleted ${keys.length} project${keys.length === 1 ? '' : 's'}.` })
  }, [])

  const bulkUpdate = useCallback((keys, patch) => {
    const set = new Set(keys)
    setState((s) => ({
      ...s,
      // Same rule as a single edit: assigning a PIC in bulk has to move the
      // contributor record too, or every project stays with its old owner.
      projects: s.projects.map((p) => {
        if (!set.has(p.key)) return p
        const full = 'pic' in patch ? { ...patch, ...reassignPatch(p, patch.pic) } : patch
        return { ...p, ...full }
      }),
    }))
    setToast({ severity: 'success', msg: `Updated ${keys.length} project${keys.length === 1 ? '' : 's'}.` })
  }, [])

  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    setExporting(true)
    try {
      await exportWorkbook(plan, state)
      setToast({ severity: 'success', msg: 'Excel workbook exported.' })
    } catch (e) {
      setToast({ severity: 'error', msg: `Export failed: ${e.message}` })
    } finally {
      setExporting(false)
    }
  }

  const handleReset = () => {
    if (!confirm('Discard all your edits and reload the original source workbook?')) return
    setState(freshState())
    setToast({ severity: 'info', msg: 'Reset to the source workbook.' })
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setState(await readScenarioFile(file))
      setToast({ severity: 'success', msg: 'Scenario loaded.' })
    } catch (err) {
      setToast({ severity: 'error', msg: err.message })
    }
  }

  const cov = plan.totals.totalCoverage
  const covTone = cov >= 1 ? 'success' : cov >= 0.9 ? 'warning' : 'error'

  if (bootstrapping) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}>
          <CircularProgress size={28} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Loading the shared plan…
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>
            first open of the day can take a moment while the server wakes
          </Typography>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Toolbar sx={{ gap: 2, minHeight: { xs: 56, sm: 60 } }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25, minWidth: 0 }}>
              <Typography variant="h4" noWrap sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
                F&amp;A Tech
              </Typography>
              <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                2026 Objective &amp; KPI Planning
              </Typography>
            </Box>

            <Chip
              size="small"
              color={covTone}
              variant="outlined"
              label={`${Math.round(plan.totals.totalHours).toLocaleString()} / ${plan.totals.target.toLocaleString()} hrs`}
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            />
            {plan.invalid.length > 0 && (
              <Tooltip title={`${plan.invalid.map((x) => `${x.nick} ${Math.round(x.sum * 100)}%`).join(', ')} — saving is blocked until every scorecard totals 100%`}>
                <Chip
                  size="small"
                  color="error"
                  label={`${plan.invalid.length} scorecard${plan.invalid.length === 1 ? '' : 's'} ≠ 100%`}
                  onClick={() => setTab('people')}
                  sx={{ cursor: 'pointer' }}
                />
              </Tooltip>
            )}

            <Box sx={{ flex: 1 }} />

            <Button
              variant="contained"
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Building…' : 'Export Excel'}
            </Button>

            <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
              <IconButton size="small" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>
                {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
              </IconButton>
            </Tooltip>

            <IconButton size="small" onClick={(e) => setMenuEl(e.currentTarget)}>
              <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)}>
              <MenuItem onClick={() => { setScenario('save'); setMenuEl(null) }}>
                <CloudUploadIcon fontSize="small" sx={{ mr: 1.5 }} /> Publish to shared store
              </MenuItem>
              <MenuItem onClick={() => { setScenario('open'); setMenuEl(null) }}>
                <CloudDownloadIcon fontSize="small" sx={{ mr: 1.5 }} /> Open shared scenario
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => { downloadScenario(state); setMenuEl(null) }}>
                <DataObjectIcon fontSize="small" sx={{ mr: 1.5 }} /> Save scenario file (.json)
              </MenuItem>
              <MenuItem onClick={() => { fileRef.current?.click(); setMenuEl(null) }}>
                <UploadFileIcon fontSize="small" sx={{ mr: 1.5 }} /> Load scenario file (.json)
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => { handleReset(); setMenuEl(null) }}>
                <RestartAltIcon fontSize="small" sx={{ mr: 1.5 }} /> Reset to source workbook
              </MenuItem>
            </Menu>
            <input ref={fileRef} type="file" accept="application/json" hidden onChange={handleImport} />
          </Toolbar>

          <Tabs
            value={tab}
            onChange={(_e, v) => setTab(v)}
            sx={{ px: 2, minHeight: 40, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 600 } }}
          >
            {TABS.map((t) => <Tab key={t.id} value={t.id} label={t.label} />)}
          </Tabs>
        </AppBar>

        <Box sx={{ maxWidth: 1440, mx: 'auto', px: { xs: 2, md: 3 }, py: 3 }}>
          {tab === 'dashboard' && <Dashboard plan={plan} onGoTo={setTab} />}
          {tab === 'projects' && (
            <Projects
              plan={plan}
              onUpdate={updateProject}
              onBulk={bulkUpdate}
              onImport={applyProjectImport}
            onAdd={addProject}
              onDelete={deleteProjects}
              onSave={saveToDb}
              dirty={dirty}
              saving={saving}
              lastSaved={lastSaved}
              scenarioName={state.scenarioName}
              blocked={plan.invalid}
              onGoTo={setTab}
            />
          )}
          {tab === 'team' && <Team plan={plan} />}
          {tab === 'timeline' && (
            <Timeline
              plan={plan}
              settings={plan.settings}
              onUpdate={updateProject}
              onAddProjects={addProjects}
              onReplaceProjects={replaceProjects}
              rawProjects={state.projects}
            />
          )}

          {tab === 'people' && (
            <People
              plan={plan}
              onPersonKpi={updatePersonKpi}
              onResetKpi={resetPersonKpi}
              onRemoveLine={removePersonKpiLine}
              onSaveLine={savePersonKpiLine}
              onOverride={setPersonOverride}
              onRestoreLine={restorePersonKpiLine}
              onAddObjective={addPersonObjective}
              onRemoveObjective={removePersonObjective}
              onRebalance={rebalancePersonKpi}
              onSyncTargets={syncPersonTargets}
              onUpdate={updateProject}
            />
          )}
          {tab === 'settings' && (
            <Settings
              plan={plan}
              state={state}
              onSettings={updateSettings}
              onPerson={updatePerson}
              scenarioName={state.scenarioName}
              onScenarioName={(v) => setState((s) => ({ ...s, scenarioName: v }))}
            />
          )}
        </Box>

        <ScenarioDialog
          open={!!scenario}
          mode={scenario}
          onClose={() => setScenario(null)}
          state={state}
          onToast={setToast}
          onLoad={(payload, name) => {
            // A scenario saved before the reassignment fix carries the same
            // damage as a stale browser, so it gets the same repair.
            setState((s) => repairState({
              ...s,
              people: payload.people,
              projects: payload.projects,
              settings: { ...s.settings, ...payload.settings },
              repair: payload.repair,
              scenarioName: name,
            }))
            // a freshly loaded scenario matches the database
            linkedToDb.current = true
            setTimeout(() => setDirty(false), 0)
          }}
        />

        {/* Only reached when this browser holds UNSAVED work, so it is a
            question, not an announcement: it stays until it is answered.
            As a twelve-second toast it was simply missed, and the browser
            then showed a stale register indefinitely with no sign of it. */}
        <Snackbar
          open={!!dbNotice}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity="warning"
            onClose={() => setDbNotice(null)}
            action={(
              <>
                {/* The whole plan as a file, before anything replaces it. A
                    safety net nobody has to think about is worth more than a
                    warning telling them to think. */}
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    downloadScenario(state)
                    setToast({ severity: 'success', msg: 'Copy downloaded — open it again from the menu if you need it.' })
                  }}
                >
                  Keep a copy
                </Button>
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1 }}
                  disabled={loadingShared}
                  onClick={async () => {
                    setLoadingShared(true)
                    try { await takeShared(dbNotice, 'Loaded') } catch (e) {
                      setToast({ severity: 'error', msg: e.message })
                    } finally { setLoadingShared(false) }
                  }}
                >
                  {loadingShared ? 'Loading…' : 'Load it'}
                </Button>
              </>
            )}
          >
            &ldquo;{dbNotice?.name}&rdquo; in the shared database was saved{' '}
            {dbNotice?.updatedAt ? new Date(dbNotice.updatedAt).toLocaleString() : ''}, and is newer than
            what this browser is showing.{' '}
            {dbNotice?.knowsOfEdits
              ? 'This browser holds edits that never reached the database; loading replaces them.'
              : 'This browser cannot tell whether it holds anything of its own, so it is asking rather than guessing. Keep a copy first if you are unsure — it downloads in a second and can be opened again from the menu.'}
          </Alert>
        </Snackbar>

        <Snackbar
          open={!!toast}
          autoHideDuration={4000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          {toast ? (
            <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)}>
              {toast.msg}
            </Alert>
          ) : undefined}
        </Snackbar>
      </Box>
    </ThemeProvider>
  )
}
