import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box,
  Typography, List, ListItem, ListItemButton, ListItemText, IconButton, Alert,
  CircularProgress, Chip, Divider, Tooltip,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import * as api from '../lib/api.js'

const when = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

/**
 * Shared scenarios, stored in Mongo. Saving publishes the current plan under a
 * name; anyone opening the app can load it. Falls back to a clear message if
 * the store is down — local work is never at risk.
 */
export default function ScenarioDialog({ open, mode, onClose, state, onLoad, onToast }) {
  const [rows, setRows] = useState([])
  const [name, setName] = useState(state?.scenarioName || '')
  const [by, setBy] = useState(() => localStorage.getItem('fa-kpi-author') || '')
  const [store, setStore] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    setName(state?.scenarioName || '')
    let cancelled = false
    ;(async () => {
      setBusy(true)
      const s = await api.storeStatus()
      if (cancelled) return
      setStore(s)
      if (s.connected) {
        try {
          setRows(await api.listScenarios())
        } catch (e) {
          setErr(e.message)
        }
      }
      setBusy(false)
    })()
    return () => { cancelled = true }
  }, [open, state?.scenarioName])

  const refresh = async () => {
    try { setRows(await api.listScenarios()) } catch (e) { setErr(e.message) }
  }

  const doSave = async () => {
    const n = name.trim()
    if (!n) { setErr('Give the scenario a name.'); return }
    setBusy(true); setErr(null)
    try {
      localStorage.setItem('fa-kpi-author', by)
      await api.saveScenario(n, { people: state.people, projects: state.projects, settings: state.settings }, by)
      onToast({ severity: 'success', msg: `Published "${n}" — anyone with the link can load it.` })
      await refresh()
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const doLoad = async (n) => {
    setBusy(true); setErr(null)
    try {
      const doc = await api.loadScenario(n)
      onLoad(doc.payload, n)
      onToast({ severity: 'success', msg: `Loaded "${n}"${doc.updatedBy ? ` (saved by ${doc.updatedBy})` : ''}.` })
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async (n) => {
    if (!confirm(`Delete the shared scenario "${n}"? This removes it for everyone.`)) return
    try {
      await api.deleteScenario(n)
      await refresh()
      onToast({ severity: 'info', msg: `Deleted "${n}".` })
    } catch (e) {
      setErr(e.message)
    }
  }

  const offline = store && !store.connected

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {mode === 'save' ? 'Publish scenario' : 'Open shared scenario'}
          {store && (
            <Chip
              size="small"
              variant="outlined"
              color={store.connected ? 'success' : 'default'}
              icon={store.connected ? <CloudDoneIcon /> : <CloudOffIcon />}
              label={store.connected ? 'Shared store online' : 'Offline'}
            />
          )}
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {mode === 'save'
            ? 'Saves to the shared database so colleagues can open the same numbers.'
            : 'Scenarios published by you or your team.'}
        </Typography>
      </DialogTitle>

      <DialogContent dividers>
        {offline && (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            The shared store is unavailable{store.reason ? ` (${store.reason})` : ''}. Your work is still saved in this
            browser, and <em>Save scenario file</em> in the ⋮ menu always works.
          </Alert>
        )}
        {err && <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>{err}</Alert>}

        {mode === 'save' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
            <TextField
              autoFocus fullWidth size="small" label="Scenario name" value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Commit case for Aug review"
              disabled={offline}
              helperText="Saving under an existing name overwrites it."
            />
            <TextField
              fullWidth size="small" label="Your name (optional)" value={by}
              onChange={(e) => setBy(e.target.value)} placeholder="so the team knows who changed what"
              disabled={offline}
            />
          </Box>
        )}

        {busy && !rows.length ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={24} /></Box>
        ) : rows.length ? (
          <>
            {mode === 'save' && <Divider sx={{ mb: 1 }} />}
            <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
              {mode === 'save' ? 'Existing scenarios' : `${rows.length} saved`}
            </Typography>
            <List dense disablePadding>
              {rows.map((r) => (
                <ListItem
                  key={r.name}
                  disablePadding
                  secondaryAction={
                    <Tooltip title="Delete for everyone">
                      <IconButton edge="end" size="small" onClick={() => doDelete(r.name)}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                >
                  <ListItemButton
                    onClick={() => (mode === 'save' ? setName(r.name) : doLoad(r.name))}
                    disabled={busy}
                  >
                    <ListItemText
                      primary={r.name}
                      secondary={`${when(r.updatedAt)}${r.updatedBy && r.updatedBy !== 'unknown' ? ` · ${r.updatedBy}` : ''}`}
                      primaryTypographyProps={{ fontWeight: 600, variant: 'body2' }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </>
        ) : (
          !offline && (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
              No shared scenarios yet.
            </Typography>
          )
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        {mode === 'save' && (
          <Button variant="contained" onClick={doSave} disabled={busy || offline}>
            {busy ? 'Publishing…' : 'Publish'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
