import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  ThemeProvider, CssBaseline, Box, AppBar, Toolbar, Typography, Tabs, Tab,
  Button, IconButton, Tooltip, Snackbar, Alert, Chip, Divider, Menu, MenuItem,
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
import { computePlan, newProject, rebalanceWeights } from './lib/model.js'
import * as api from './lib/api.js'
import { loadState, saveState, freshState, downloadScenario, readScenarioFile, loadWasReset } from './lib/storage.js'
import { exportWorkbook } from './lib/exportXlsx.js'

import Dashboard from './pages/Dashboard.jsx'
import Projects from './pages/Projects.jsx'
import People from './pages/People.jsx'
import Settings from './pages/Settings.jsx'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projects', label: 'Projects' },
  { id: 'people', label: 'Scorecards' },
  { id: 'settings', label: 'Model' },
]

const tabFromHash = () => {
  const h = window.location.hash.replace('#', '')
  return TABS.some((t) => t.id === h) ? h : 'dashboard'
}

export default function App() {
  const [mode, setMode] = useState(() => localStorage.getItem('fa-kpi-mode') || 'light')
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

  useEffect(() => { saveState(state) }, [state])
  useEffect(() => { localStorage.setItem('fa-kpi-mode', mode) }, [mode])

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
    setSaving(true)
    try {
      const r = await api.saveScenario(
        name,
        { people: state.people, projects: state.projects, settings: state.settings },
        localStorage.getItem('fa-kpi-author') || '',
      )
      setDirty(false)
      setLastSaved(r.updatedAt)
      setToast({ severity: 'success', msg: `Saved "${name}" to the database.` })
    } catch (e) {
      setToast({ severity: 'error', msg: `${e.message} Your work is still safe in this browser.` })
    } finally {
      setSaving(false)
    }
  }, [state, plan.invalid])

  // Keep the tab in the URL hash so a view can be linked or bookmarked.
  useEffect(() => {
    if (tabFromHash() !== tab) window.location.hash = tab
  }, [tab])
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /** Patch one project by Jira key. */
  const updateProject = useCallback((key, patch) => {
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) => (p.key === key ? { ...p, ...patch } : p)),
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

        if (Object.keys(entry).length) kpi[lineId] = entry
        else delete kpi[lineId]

        // Delivery weights are rescaled to fill whatever the fixed blocks
        // leave, so writing one alone would come back changed. Write the
        // siblings too — absorbing the difference proportionally — and the
        // number the user typed is the number they get.
        const all = plan.people.find((x) => x.id === id)?.kpiLines || []
        const edited = all.find((l) => l.id === lineId)
        if ('weight' in patch && edited?.block === 'Delivery') {
          const fixed = all.filter((l) => l.block !== 'Delivery').reduce((a, l) => a + l.weight, 0)
          const pool = Math.max(0, 1 - fixed)
          const others = all.filter((l) => l.block === 'Delivery' && l.id !== lineId)
          const rest = Math.max(0, pool - patch.weight)
          const restNow = others.reduce((a, l) => a + l.weight, 0)
          for (const o of others) {
            const w = restNow > 0 ? (o.weight / restNow) * rest : rest / (others.length || 1)
            kpi[o.id] = { ...(kpi[o.id] || {}), weight: w }
          }
        }
        return { ...p, kpi }
      }),
    }))
  }, [plan.people])

  const resetPersonKpi = useCallback((id) => {
    setState((s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, kpi: {}, kpiHidden: [] } : p)) }))
    setToast({ severity: 'info', msg: 'Weights, targets and removed lines all reset to the band defaults.' })
  }, [])

  /** Remove a KPI line from someone's scorecard (restorable). */
  const removePersonKpiLine = useCallback((id, lineId) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) =>
        p.id === id ? { ...p, kpiHidden: [...new Set([...(p.kpiHidden || []), lineId])] } : p,
      ),
    }))
    setToast({ severity: 'info', msg: 'Line removed. Weights no longer total 100% — rebalance before saving.' })
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

  const deleteProjects = useCallback((keys) => {
    const set = new Set(keys)
    setState((s) => ({ ...s, projects: s.projects.filter((p) => !set.has(p.key)) }))
    setToast({ severity: 'info', msg: `Deleted ${keys.length} project${keys.length === 1 ? '' : 's'}.` })
  }, [])

  const bulkUpdate = useCallback((keys, patch) => {
    const set = new Set(keys)
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) => (set.has(p.key) ? { ...p, ...patch } : p)),
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
          {tab === 'people' && (
            <People
              plan={plan}
              onPersonKpi={updatePersonKpi}
              onResetKpi={resetPersonKpi}
              onRemoveLine={removePersonKpiLine}
              onRestoreLine={restorePersonKpiLine}
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
            setState((s) => ({
              ...s,
              people: payload.people,
              projects: payload.projects,
              settings: { ...s.settings, ...payload.settings },
              scenarioName: name,
            }))
            // a freshly loaded scenario matches the database
            setTimeout(() => setDirty(false), 0)
          }}
        />

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
