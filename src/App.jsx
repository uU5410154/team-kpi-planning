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
import { computePlan, newProject } from './lib/model.js'
import { loadState, saveState, freshState, downloadScenario, readScenarioFile } from './lib/storage.js'
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
  const [state, setState] = useState(loadState)
  const [toast, setToast] = useState(null)
  const [menuEl, setMenuEl] = useState(null)
  const [scenario, setScenario] = useState(null) // 'save' | 'open' | null
  const fileRef = useRef(null)

  const theme = useMemo(() => buildTheme(mode), [mode])
  const plan = useMemo(() => computePlan(state), [state])

  useEffect(() => { saveState(state) }, [state])
  useEffect(() => { localStorage.setItem('fa-kpi-mode', mode) }, [mode])

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
    if (!confirm('Discard all your edits and reload the original Jira baseline?')) return
    setState(freshState())
    setToast({ severity: 'info', msg: 'Reset to the Jira baseline.' })
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
                <RestartAltIcon fontSize="small" sx={{ mr: 1.5 }} /> Reset to Jira baseline
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
            />
          )}
          {tab === 'people' && <People plan={plan} />}
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
          onLoad={(payload, name) =>
            setState((s) => ({
              ...s,
              people: payload.people,
              projects: payload.projects,
              settings: { ...s.settings, ...payload.settings },
              scenarioName: name,
            }))
          }
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
