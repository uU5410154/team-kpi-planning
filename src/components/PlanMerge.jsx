import { useEffect, useMemo, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, Typography, Box, ToggleButton, ToggleButtonGroup, Alert, TextField,
} from '@mui/material'
import * as api from '../lib/api.js'
import { planDiff, mergePlan, diffId, showValue } from '../lib/planMerge.js'
import Loading from './Loading.jsx'

/*
 * THIS BROWSER'S PLAN AGAINST THE NEWER SHARED ONE, FIELD BY FIELD.
 *
 * Every field the two disagree on, grouped by project, person or setting.
 * Each starts on the shared (newer) value; whoever is resolving it switches
 * the ones that should be theirs. Saving writes the shared plan with those
 * fields changed and nothing else, and names the version it was merged onto,
 * so a third save in between is caught too.
 */

const AREA = { projects: 'Project', people: 'Person', settings: 'Setting' }

export default function PlanMerge({ open, name, mine, author, onClose, onMerged }) {
  const [doc, setDoc] = useState(null)
  const [error, setError] = useState(null)
  const [choices, setChoices] = useState({})
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (!open) return
    setDoc(null)
    setChoices({})
    setError(null)
    api.loadScenario(name).then(setDoc).catch((e) => setError(e.message))
  }, [open, name])
  const diffs = useMemo(() => (doc?.payload ? planDiff(mine, doc.payload) : []), [doc, mine])
  const shown = diffs.filter((d) => !q || `${d.id} ${d.label} ${d.field}`.toLowerCase().includes(q.toLowerCase()))
  const groups = useMemo(() => {
    const m = new Map()
    for (const d of shown) {
      const k = `${d.area}|${d.id ?? ''}`
      if (!m.has(k)) m.set(k, { area: d.area, id: d.id, label: d.label, rows: [] })
      m.get(k).rows.push(d)
    }
    return [...m.values()]
  }, [shown])
  const mineCount = Object.values(choices).filter((v) => v === 'mine').length
  const all = (v) => setChoices(Object.fromEntries(diffs.map((d) => [diffId(d), v])))
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const merged = mergePlan(doc.payload, diffs, choices)
      const r = await api.saveScenario(name, merged, author, { baseUpdatedAt: doc.updatedAt })
      onMerged({ name, updatedAt: r.updatedAt })
    } catch (e) {
      setError(e.conflict ? 'Somebody saved the shared plan again while you were choosing. Close this and compare again.' : e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={() => !busy && onClose()} maxWidth="md" fullWidth data-plan-merge>
      <DialogTitle>Compare with the shared plan, field by field</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {!doc && !error && <Loading label="Reading the shared plan…" />}
        {doc && (
          <>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The shared plan was saved by {doc.updatedBy || 'somebody'} at {new Date(doc.updatedAt).toLocaleString()}. These
              {' '}{diffs.length} field{diffs.length === 1 ? '' : 's'} differ from this browser. Each starts on the shared value;
              switch to &ldquo;Mine&rdquo; only the ones that should be yours.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              <TextField size="small" placeholder="Find a project or field" value={q} onChange={(e) => setQ(e.target.value)} sx={{ flex: '1 1 220px' }} />
              <Button size="small" onClick={() => all('theirs')}>All shared</Button>
              <Button size="small" onClick={() => all('mine')}>All mine</Button>
            </Box>
            {!diffs.length && <Alert severity="success">No differences: this browser already matches the shared plan.</Alert>}
            {groups.slice(0, 200).map((g) => (
              <Box key={`${g.area}|${g.id}`} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 1.25 }} data-merge-group={g.id || g.area}>
                <Typography variant="subtitle2">{AREA[g.area] || g.area}{g.id ? ` ${g.id}` : ''}{g.label && g.label !== g.id ? ` · ${g.label}` : ''}</Typography>
                {g.rows.map((d) => (
                  <Box key={diffId(d)} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '140px 1fr' }, gap: 1, alignItems: 'center', mt: 0.75 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>{d.field}</Typography>
                    <ToggleButtonGroup
                      exclusive
                      size="small"
                      value={choices[diffId(d)] || 'theirs'}
                      onChange={(_e, v) => v && setChoices((c) => ({ ...c, [diffId(d)]: v }))}
                      sx={{ display: 'flex', '& > *': { flex: 1, justifyContent: 'flex-start', textAlign: 'left', textTransform: 'none' } }}
                    >
                      <ToggleButton value="theirs" data-merge-theirs={diffId(d)}>
                        <Box sx={{ minWidth: 0 }}><Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>Shared</Typography><Typography variant="caption" sx={{ wordBreak: 'break-word' }}>{showValue(d.theirs)}</Typography></Box>
                      </ToggleButton>
                      <ToggleButton value="mine" data-merge-mine={diffId(d)}>
                        <Box sx={{ minWidth: 0 }}><Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>Mine</Typography><Typography variant="caption" sx={{ wordBreak: 'break-word' }}>{showValue(d.mine)}</Typography></Box>
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </Box>
                ))}
              </Box>
            ))}
            {groups.length > 200 && <Typography variant="caption">Showing the first 200; search to find the rest.</Typography>}
          </>
        )}
        {error && <Alert severity="error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || !doc} data-merge-save>
          {busy ? 'Saving…' : mineCount ? `Save, keeping ${mineCount} of mine` : 'Take the shared plan'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
