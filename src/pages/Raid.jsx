import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Alert, Link, TextField, MenuItem, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import * as api from '../lib/api.js'
import { inBook } from '../lib/governance.js'
import { ConflictDialog } from '../components/GovConflict.jsx'
import { Section, Stat, PageHead, money, TONE } from '../components/GovUi.jsx'
import { Pill } from '../components/Brand.jsx'
import Loading from '../components/Loading.jsx'

/*
 * DECISIONS AND RAID (management design summary, Priority 1).
 *
 * Risks, assumptions, issues, dependencies and decisions, each with an
 * owner, a due date, a severity, the action management must take, and what
 * is exposed: cost, schedule days, benefit and resources. The queue is
 * ordered by value at risk and urgency, not by count. Decisions members ask
 * for in the weekly check-in are listed too, and decided from here.
 */

export const RAID_TYPE_LABEL = { risk: 'Risk', assumption: 'Assumption', issue: 'Issue', dependency: 'Dependency', decision: 'Decision' }
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', decided: 'Decided', closed: 'Closed' }
const SEV_TONE = { low: 'neutral', medium: 'warn', high: 'bad', critical: 'bad' }
const SEV_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 }

const blank = () => ({
  type: 'risk', title: '', detail: '', projectKey: null, owner: '', due: null, severity: 'medium', likelihood: null, status: 'open',
  action: '', recommendation: '', approver: '', decision: '', decidedAt: null, exposure: { cost: null, days: null, benefit: null, resource: '' },
})

const today = () => new Date().toISOString().slice(0, 10)
const daysTo = (d) => (d ? Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${today()}T00:00:00Z`)) / 86400000) : null)

/**
 * Where an item sits in the management queue: money at risk first (cost +
 * benefit exposure, and schedule days at the day rate), then urgency (overdue
 * and due within a week), then severity. Closed and decided items drop out.
 */
export function priorityOf(item, dayRate = 0) {
  const e = item.exposure || {}
  const valueAtRisk = (e.cost || 0) + (e.benefit || 0) + (e.days || 0) * dayRate
  const d = daysTo(item.due)
  const urgency = d == null ? 0 : d < 0 ? 3 : d <= 7 ? 2 : d <= 30 ? 1 : 0
  return { valueAtRisk, urgency, score: valueAtRisk * (1 + urgency) + SEV_WEIGHT[item.severity || 'medium'] * 1000 }
}

function ItemDialog({ item, onClose, onSaved, projects }) {
  const [x, setX] = useState(item.id ? item : blank())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [conflict, setConflict] = useState(null)
  const set = (patch) => setX((v) => ({ ...v, ...patch }))
  const setE = (patch) => setX((v) => ({ ...v, exposure: { ...v.exposure, ...patch } }))
  const n = (v) => (v === '' ? null : Number(String(v).replace(/[,\s]/g, '')))
  const submit = async (force = [], obj = x) => {
    if (!obj.title.trim()) { setErr('Give it a title.'); return }
    setBusy(true)
    setErr(null)
    try {
      const r = await api.raidSave(item.id || null, obj, item.id ? item : null, force)
      if (r.conflicts) { setConflict({ r }); return }
      onSaved(r.item)
      onClose()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-raid-dialog>
      <DialogTitle>{item.id ? 'Edit' : 'Add'} {RAID_TYPE_LABEL[x.type].toLowerCase()}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, pt: '12px !important' }}>
        <ToggleButtonGroup exclusive size="small" value={x.type} onChange={(_e, v) => v && set({ type: v })} sx={{ flexWrap: 'wrap' }}>
          {Object.entries(RAID_TYPE_LABEL).map(([k, v]) => <ToggleButton key={k} value={k} sx={{ textTransform: 'none' }}>{v}</ToggleButton>)}
        </ToggleButtonGroup>
        <TextField size="small" label="Title" value={x.title} onChange={(e) => set({ title: e.target.value })} inputProps={{ 'aria-label': 'title' }} autoFocus />
        <TextField size="small" label="Detail" value={x.detail} onChange={(e) => set({ detail: e.target.value })} multiline minRows={2} />
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' } }}>
          <TextField select size="small" label="Project" value={x.projectKey || ''} onChange={(e) => set({ projectKey: e.target.value || null })}>
            <MenuItem value="">Whole portfolio</MenuItem>
            {projects.map((p) => <MenuItem key={p.key} value={p.key}>{p.key} · {p.summary}</MenuItem>)}
          </TextField>
          <TextField size="small" label="Owner" value={x.owner} onChange={(e) => set({ owner: e.target.value })} />
          <TextField size="small" type="date" label="Due" InputLabelProps={{ shrink: true }} value={x.due || ''} onChange={(e) => set({ due: e.target.value || null })} />
          <TextField select size="small" label="Severity" value={x.severity} onChange={(e) => set({ severity: e.target.value })}>
            {['low', 'medium', 'high', 'critical'].map((s) => <MenuItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Likelihood" value={x.likelihood || ''} onChange={(e) => set({ likelihood: e.target.value || null })}>
            <MenuItem value="">—</MenuItem>{['low', 'medium', 'high'].map((s) => <MenuItem key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="Status" value={x.status} onChange={(e) => set({ status: e.target.value })}>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        </Box>
        <Typography variant="subtitle2" sx={{ mt: 0.5 }}>Exposure</Typography>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' } }}>
          <TextField size="small" label="Cost (฿)" value={x.exposure.cost ?? ''} onChange={(e) => setE({ cost: n(e.target.value) })} />
          <TextField size="small" label="Schedule (days)" value={x.exposure.days ?? ''} onChange={(e) => setE({ days: n(e.target.value) })} />
          <TextField size="small" label="Benefit (฿)" value={x.exposure.benefit ?? ''} onChange={(e) => setE({ benefit: n(e.target.value) })} />
          <TextField size="small" label="Resources" value={x.exposure.resource} onChange={(e) => setE({ resource: e.target.value })} />
        </Box>
        <TextField size="small" label="Management action required" value={x.action} onChange={(e) => set({ action: e.target.value })} multiline minRows={2} />
        {x.type === 'decision' && (
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField size="small" label="Recommendation" value={x.recommendation} onChange={(e) => set({ recommendation: e.target.value })} multiline minRows={2} />
            <TextField size="small" label="Approver" value={x.approver} onChange={(e) => set({ approver: e.target.value })} />
            <TextField size="small" label="Decision taken" value={x.decision} onChange={(e) => set({ decision: e.target.value })} multiline minRows={2} />
            <TextField size="small" type="date" label="Decided on" InputLabelProps={{ shrink: true }} value={x.decidedAt || ''} onChange={(e) => set({ decidedAt: e.target.value || null })} />
          </Box>
        )}
        {err && <Alert severity="error">{err}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => submit()} disabled={busy} data-save-raid>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
      <ConflictDialog
        conflict={conflict}
        onDone={async (choice) => {
          const c = conflict
          setConflict(null)
          if (!choice || !c) { onClose(); return }
          const mine = c.r.conflicts.filter((k) => choice[k.path] === 'mine').map((k) => k.path)
          const merged = { ...x }
          for (const k of c.r.conflicts) if (choice[k.path] !== 'mine') merged[k.path] = k.theirs
          setX(merged)
          await submit(mine, merged)
        }}
      />
    </Dialog>
  )
}

export default function Raid({ plan, onOpenProject }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [edit, setEdit] = useState(null)
  const [type, setType] = useState('all')
  const [state, setState] = useState('open')
  const [decideNote, setDecideNote] = useState({})
  const load = () => api.raidList().then((r) => { setData(r); setError(null) }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])
  const projects = useMemo(() => (plan.projects || []).filter(inBook).sort((a, b) => String(a.key).localeCompare(String(b.key))), [plan.projects])
  const name = useMemo(() => Object.fromEntries((plan.projects || []).map((p) => [p.key, p.summary])), [plan.projects])
  const dayRate = plan.finance?.devDayRate || 0
  const sym = plan.finance?.symbol || '฿'
  if (error) return <Alert severity="error">{error}</Alert>
  if (!data) return <Loading variant="block" label="Reading decisions and RAID…" />
  const live = (x) => x.status === 'open' || x.status === 'in_progress'
  const items = data.items
    .filter((x) => (type === 'all' || x.type === type) && (state === 'all' || (state === 'open' ? live(x) : !live(x))))
    .map((x) => ({ ...x, pr: priorityOf(x, dayRate) }))
    .sort((a, b) => (state === 'open' ? b.pr.score - a.pr.score : String(b.updatedAt).localeCompare(String(a.updatedAt))))
  const open = data.items.filter(live)
  const atRisk = open.reduce((a, x) => a + priorityOf(x, dayRate).valueAtRisk, 0)
  const overdue = open.filter((x) => daysTo(x.due) < 0).length
  const weeklyOpen = data.weekly.filter((d) => d.status === 'open')
  const decide = async (id) => {
    try { await api.decide(id, decideNote[id] || ''); await load() } catch (e) { setError(e.message) }
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="raid">
      <PageHead title="Decisions & RAID">
        Risks, assumptions, issues, dependencies and decisions — each with an owner, a due date, the action management must
        take, and what is exposed. The queue is ordered by value at risk and urgency, not by count.
      </PageHead>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' } }}>
        <Stat label="Open items" value={open.length} note={`${open.filter((x) => x.type === 'decision').length} decisions`} />
        <Stat label="Value at risk" value={money(atRisk, sym)} tone={atRisk ? TONE.bad : undefined} help="Cost + benefit exposure, plus schedule days at the developer day rate, over open items." data-stat="atRisk" />
        <Stat label="Overdue" value={overdue} tone={overdue ? TONE.bad : undefined} />
        <Stat label="Critical or high" value={open.filter((x) => ['critical', 'high'].includes(x.severity)).length} />
        <Stat label="Asked in the weekly check-in" value={weeklyOpen.length} note="Decisions waiting" tone={weeklyOpen.length ? TONE.warn : undefined} />
      </Box>

      {weeklyOpen.length > 0 && (
        <Section title="Decisions asked for in the weekly check-in" subtitle="Members raise these on a task. Deciding here tells them, and adds the decision to the task in Jira." data-section="weekly-decisions">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {weeklyOpen.map((d) => (
              <Box key={d.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider', pb: 1.25 }} data-weekly-decision={d.id}>
                <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{d.text}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {d.nick} · {d.jiraKey}{d.summary ? ` ${d.summary}` : ''}{d.projectKey ? ` · ${name[d.projectKey] || d.projectKey}` : ''} · week of {d.week}
                  </Typography>
                </Box>
                <TextField size="small" placeholder="The decision" value={decideNote[d.id] || ''} onChange={(e) => setDecideNote((m) => ({ ...m, [d.id]: e.target.value }))} sx={{ flex: '1 1 240px' }} />
                <Button variant="outlined" size="small" onClick={() => decide(d.id)}>Mark decided</Button>
              </Box>
            ))}
          </Box>
        </Section>
      )}

      <Section
        title="The register"
        action={(
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <ToggleButtonGroup size="small" exclusive value={state} onChange={(_e, v) => v && setState(v)}>
              <ToggleButton value="open">Open</ToggleButton><ToggleButton value="done">Decided / closed</ToggleButton><ToggleButton value="all">All</ToggleButton>
            </ToggleButtonGroup>
            <TextField select size="small" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 150 }}>
              <MenuItem value="all">Every type</MenuItem>
              {Object.entries(RAID_TYPE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEdit({})} data-add-raid>Add</Button>
          </Box>
        )}
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell><TableCell>Item</TableCell><TableCell>Project</TableCell><TableCell>Owner</TableCell>
                <TableCell>Due</TableCell><TableCell>Severity</TableCell><TableCell align="right">Value at risk</TableCell>
                <TableCell>Action required</TableCell><TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((x) => {
                const d = daysTo(x.due)
                return (
                  <TableRow key={x.id} hover onClick={() => setEdit(x)} sx={{ cursor: 'pointer' }} data-raid-row={x.id}>
                    <TableCell>{RAID_TYPE_LABEL[x.type]}</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{x.title}</Typography>
                      {x.detail && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{x.detail.slice(0, 140)}</Typography>}
                    </TableCell>
                    <TableCell>
                      {x.projectKey
                        ? <Link component="button" onClick={(e) => { e.stopPropagation(); onOpenProject?.(x.projectKey) }}>{x.projectKey}</Link>
                        : 'Portfolio'}
                    </TableCell>
                    <TableCell>{x.owner || '—'}</TableCell>
                    <TableCell sx={{ color: d != null && d < 0 && live(x) ? TONE.bad : undefined, whiteSpace: 'nowrap' }}>{x.due || '—'}{d != null && d < 0 && live(x) ? ' · overdue' : ''}</TableCell>
                    <TableCell><Pill label={x.severity} tone={SEV_TONE[x.severity]} /></TableCell>
                    <TableCell align="right">{x.pr.valueAtRisk ? money(x.pr.valueAtRisk, sym) : '—'}</TableCell>
                    <TableCell sx={{ maxWidth: 260 }}><Typography variant="caption">{x.action || x.recommendation || '—'}</Typography></TableCell>
                    <TableCell>{STATUS_LABEL[x.status]}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Box>
        {!items.length && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>Nothing here yet.</Typography>}
      </Section>
      {edit && <ItemDialog item={edit} projects={projects} onClose={() => setEdit(null)} onSaved={() => load()} />}
    </Box>
  )
}
