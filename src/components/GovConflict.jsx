import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import * as api from '../lib/api.js'

/*
 * THE ADMINISTRATOR'S GOVERNANCE RECORDS, LOADED ONCE PER PAGE, AND SAVED
 * FIELD BY FIELD.
 *
 * `save(id, changes)` sends [{ path, from, to }]. When somebody else changed
 * one of those fields in between, the server refuses and hands back both
 * values; the dialog below shows them side by side and the administrator
 * picks, per field, which to keep. Nothing newer is ever replaced without
 * somebody choosing to.
 */

export function useGov() {
  const [gov, setGov] = useState(null)
  const [error, setError] = useState(null)
  const [conflict, setConflict] = useState(null)
  const live = useRef(true)
  const reload = useCallback(async () => {
    try {
      const g = await api.govAll()
      if (live.current) { setGov(g); setError(null) }
      return g
    } catch (e) {
      if (live.current) setError(e.message)
      return null
    }
  }, [])
  useEffect(() => {
    live.current = true
    reload()
    return () => { live.current = false }
  }, [reload])

  const put = useCallback((id, rec) => setGov((g) => {
    if (!g) return g
    if (id === 'rates') return { ...g, rates: rec }
    return { ...g, projects: { ...g.projects, [id.slice(8)]: rec } }
  }), [])

  /** Resolves to true once saved, false when it was not (and why is shown). */
  const save = useCallback(async (id, changes, opts = {}) => {
    const r = await api.govSave(id, changes, opts)
    if (r.conflicts) {
      return new Promise((resolve) => setConflict({ id, changes, r, resolve }))
    }
    put(id, r.record)
    return true
  }, [put])

  const resolve = async (choice) => {
    const c = conflict
    setConflict(null)
    if (!c) return
    if (!choice) { await reload(); c.resolve(false); return }
    // Mine: send it again, forced. Theirs: drop my change to that field.
    const mine = c.r.conflicts.filter((x) => choice[x.path] === 'mine').map((x) => x.path)
    const theirs = new Set(c.r.conflicts.filter((x) => choice[x.path] !== 'mine').map((x) => x.path))
    const changes = c.changes.filter((ch) => !theirs.has(ch.path))
    if (!changes.length) { await reload(); c.resolve(false); return }
    const r = await api.govSave(c.id, changes, { force: mine })
    if (r.conflicts) { setConflict({ ...c, changes, r }); return }
    put(c.id, r.record)
    await reload()
    c.resolve(true)
  }

  const dialog = <ConflictDialog conflict={conflict} onDone={resolve} />
  return { gov, error, reload, save, dialog, setGov }
}

const show = (v) => {
  if (v == null || v === '') return '(empty)'
  if (typeof v === 'object') return Array.isArray(v) ? `${v.length} item${v.length === 1 ? '' : 's'}` : JSON.stringify(v)
  return String(v)
}

export function ConflictDialog({ conflict, onDone }) {
  const [choice, setChoice] = useState({})
  useEffect(() => { setChoice({}) }, [conflict])
  const list = conflict?.r?.conflicts || []
  return (
    <Dialog open={!!conflict} onClose={() => onDone(null)} maxWidth="sm" fullWidth data-conflict>
      <DialogTitle>Somebody else changed this</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {conflict?.r?.updatedBy || 'Another administrator'} saved it
          {conflict?.r?.updatedAt ? ` at ${new Date(conflict.r.updatedAt).toLocaleString()}` : ''}, after you opened it.
          For each field, choose which value to keep.
        </Typography>
        {list.map((x) => (
          <Box key={x.path} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.25 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{x.path}</Typography>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={choice[x.path] || 'theirs'}
              onChange={(_e, v) => v && setChoice((cc) => ({ ...cc, [x.path]: v }))}
              sx={{ display: 'flex', '& > *': { flex: 1, justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none' } }}
            >
              <ToggleButton value="theirs" data-keep-theirs={x.path}>
                <Box><Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>Keep theirs</Typography>{show(x.theirs)}</Box>
              </ToggleButton>
              <ToggleButton value="mine" data-keep-mine={x.path}>
                <Box><Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>Keep mine</Typography>{show(x.yours)}</Box>
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onDone(null)}>Cancel my changes</Button>
        <Button variant="contained" onClick={() => onDone(choice)} data-conflict-apply>Save my choices</Button>
      </DialogActions>
    </Dialog>
  )
}
