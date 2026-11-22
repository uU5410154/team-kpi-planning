import { useMemo, useState } from 'react'
import {
  Box, Button, Typography, Table, TableHead, TableBody, TableRow, TableCell, TextField, MenuItem, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, Alert, Chip, CircularProgress, Checkbox, Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SyncIcon from '@mui/icons-material/Sync'
import * as api from '../lib/api.js'
import { inBook } from '../lib/governance.js'
import {
  COST_CATEGORY_LABEL, RATE_TYPE_LABEL, RATE_STATUS_LABEL, portfolioCosts, roleName,
} from '../lib/costs.js'
import { useGov } from '../components/GovConflict.jsx'
import {
  Section, NumField, TextCommit, PageHead, money, TONE,
} from '../components/GovUi.jsx'
import Loading from '../components/Loading.jsx'

/*
 * COSTS & RATES: what Finance and management approve, typed in by an
 * administrator, for the Cost & ROI and Capacity pages to work from.
 *
 *   role rates     one standard blended hourly rate per delivery role, never
 *                  an individual's salary; with its type, effective period,
 *                  what it includes and whether it is approved
 *   the team       each member's role, level and how their month divides
 *                  between projects, BAU, support and unplanned work
 *   overrides      a different rate on one project, with the reason and who
 *                  approved it
 *   project costs  approved budget, vendor, software, infrastructure and
 *                  other cost lines (forecast and actual), labour forecast
 *                  by role, and the remaining estimate
 *   worklogs       when Jira's time logs were last read, and whose names
 *                  could not be matched to the team
 *
 * Kept on the server, readable by administrators only: team members never
 * see rates or budgets.
 */

const newRole = (i) => ({ id: `role${Date.now().toString(36)}${i}`, name: '', rateType: 'internal', hourlyRate: null, effectiveFrom: null, effectiveTo: null, inclusions: '', status: 'draft' })
const SUGGESTED = ['Project Manager', 'Business Analyst', 'Developer', 'Data Engineer', 'QA', 'Vendor Developer']
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

function RatesSection({ gov, save }) {
  const saved = gov.rates.roles
  const [rows, setRows] = useState(null)
  const [dflt, setDflt] = useState(null)
  const [busy, setBusy] = useState(false)
  const list = rows ?? saved
  const defaultRole = dflt ?? gov.rates.defaultRole ?? ''
  const dirty = (rows && !same(rows, saved)) || (dflt != null && dflt !== (gov.rates.defaultRole ?? ''))
  const set = (i, patch) => setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const submit = async () => {
    setBusy(true)
    const changes = []
    if (rows && !same(rows, saved)) changes.push({ path: 'roles', from: saved, to: rows })
    if (dflt != null && dflt !== (gov.rates.defaultRole ?? '')) changes.push({ path: 'defaultRole', from: gov.rates.defaultRole ?? null, to: dflt || null })
    const ok = await save('rates', changes)
    setBusy(false)
    if (ok) { setRows(null); setDflt(null) }
  }
  return (
    <Section
      title="Role rates"
      subtitle="One standard blended rate per delivery role, per productive hour. Never an individual's salary. Labour cost is hours × the rate of the role that logged them."
      data-section="rates"
      action={(
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {dirty && <Button onClick={() => { setRows(null); setDflt(null) }}>Undo</Button>}
          <Button variant="contained" disabled={!dirty || busy} onClick={submit} data-save-rates>{busy ? 'Saving…' : 'Save rates'}</Button>
        </Box>
      )}
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Role</TableCell>
              <TableCell>Rate type</TableCell>
              <TableCell align="right">Hourly rate (฿)</TableCell>
              <TableCell>Effective from</TableCell>
              <TableCell>to</TableCell>
              <TableCell>Includes</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {list.map((r, i) => (
              <TableRow key={r.id} data-rate-row={r.id}>
                <TableCell sx={{ minWidth: 180 }}>
                  <TextField size="small" value={r.name} placeholder="e.g. Developer" onChange={(e) => set(i, { name: e.target.value })} inputProps={{ 'aria-label': 'role name' }} fullWidth />
                </TableCell>
                <TableCell>
                  <TextField select size="small" value={r.rateType} onChange={(e) => set(i, { rateType: e.target.value })} sx={{ minWidth: 110 }}>
                    {Object.entries(RATE_TYPE_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell align="right">
                  <TextField
                    size="small"
                    value={r.hourlyRate ?? ''}
                    onChange={(e) => { const n = Number(e.target.value.replace(/[,\s]/g, '')); set(i, { hourlyRate: e.target.value === '' ? null : Number.isFinite(n) ? n : r.hourlyRate }) }}
                    inputProps={{ style: { textAlign: 'right' }, 'aria-label': 'hourly rate' }}
                    sx={{ width: 110 }}
                  />
                </TableCell>
                <TableCell><TextField size="small" type="date" value={r.effectiveFrom || ''} onChange={(e) => set(i, { effectiveFrom: e.target.value || null })} /></TableCell>
                <TableCell><TextField size="small" type="date" value={r.effectiveTo || ''} onChange={(e) => set(i, { effectiveTo: e.target.value || null })} /></TableCell>
                <TableCell sx={{ minWidth: 200 }}>
                  <TextField size="small" value={r.inclusions} placeholder="Salary, benefits, overhead…" onChange={(e) => set(i, { inclusions: e.target.value })} fullWidth />
                </TableCell>
                <TableCell>
                  <TextField select size="small" value={r.status} onChange={(e) => set(i, { status: e.target.value })} sx={{ minWidth: 120 }}>
                    {Object.entries(RATE_STATUS_LABEL).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
                  </TextField>
                </TableCell>
                <TableCell>
                  <IconButton size="small" aria-label="remove role" onClick={() => setRows(list.filter((_, j) => j !== i))}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button startIcon={<AddIcon />} onClick={() => setRows([...list, newRole(list.length)])} data-add-role>Add a role</Button>
        {!list.length && (
          <Button onClick={() => setRows(SUGGESTED.map((name, i) => ({ ...newRole(i), name, rateType: /Vendor/.test(name) ? 'external' : 'internal' })))}>
            Start from the six standard roles
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <TextField
          select
          size="small"
          label="Rate for anybody with no role"
          value={defaultRole}
          onChange={(e) => setDflt(e.target.value)}
          sx={{ minWidth: 260 }}
          helperText="Otherwise the Model page's developer salary is used, and flagged."
        >
          <MenuItem value="">None</MenuItem>
          {list.map((r) => <MenuItem key={r.id} value={r.id}>{r.name || '(unnamed)'}</MenuItem>)}
        </TextField>
      </Box>
    </Section>
  )
}

function TeamSection({ gov, save, people }) {
  const saved = gov.rates.people
  const [map, setMap] = useState(null)
  const [busy, setBusy] = useState(false)
  const cur = map ?? saved
  const dirty = map && !same(map, saved)
  const set = (id, patch) => setMap({ ...cur, [id]: { ...(cur[id] || {}), ...patch } })
  const roles = gov.rates.roles
  const submit = async () => {
    setBusy(true)
    const ok = await save('rates', [{ path: 'people', from: saved, to: cur }])
    setBusy(false)
    if (ok) setMap(null)
  }
  const pctCell = (p, f) => (
    <TextField
      size="small"
      value={cur[p.id]?.[f] ?? ''}
      placeholder={f === 'project' ? '100' : '0'}
      onChange={(e) => { const n = Number(e.target.value); set(p.id, { [f]: e.target.value === '' ? null : Number.isFinite(n) ? n : null }) }}
      inputProps={{ style: { textAlign: 'right' }, 'aria-label': `${p.nick} ${f} percent` }}
      sx={{ width: 70 }}
    />
  )
  return (
    <Section
      title="The team: role, level and how their month divides"
      subtitle="Role decides the rate their logged hours are costed at. The project share is what the Capacity page counts as available for projects; left empty it is taken as 100%."
      data-section="team"
      action={(
        <Box sx={{ display: 'flex', gap: 1 }}>
          {dirty && <Button onClick={() => setMap(null)}>Undo</Button>}
          <Button variant="contained" disabled={!dirty || busy} onClick={submit} data-save-team>{busy ? 'Saving…' : 'Save team'}</Button>
        </Box>
      )}
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Member</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Level</TableCell>
              <TableCell align="right">Projects %</TableCell>
              <TableCell align="right">BAU %</TableCell>
              <TableCell align="right">Support %</TableCell>
              <TableCell align="right">Unplanned %</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {people.map((p) => {
              const a = cur[p.id] || {}
              const total = ['project', 'bau', 'support', 'unplanned'].reduce((s, f) => s + (a[f] || 0), 0)
              return (
                <TableRow key={p.id} data-team-row={p.id}>
                  <TableCell>{p.nick || p.name}</TableCell>
                  <TableCell>
                    <TextField select size="small" value={a.role || ''} onChange={(e) => set(p.id, { role: e.target.value || null })} sx={{ minWidth: 170 }} inputProps={{ 'aria-label': `${p.nick} role` }}>
                      <MenuItem value="">No role</MenuItem>
                      {roles.map((r) => <MenuItem key={r.id} value={r.id}>{r.name || '(unnamed)'}</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField size="small" value={a.level || ''} placeholder="e.g. Senior" onChange={(e) => set(p.id, { level: e.target.value })} sx={{ width: 120 }} />
                  </TableCell>
                  <TableCell align="right">{pctCell(p, 'project')}</TableCell>
                  <TableCell align="right">{pctCell(p, 'bau')}</TableCell>
                  <TableCell align="right">{pctCell(p, 'support')}</TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'flex-end' }}>
                      {pctCell(p, 'unplanned')}
                      {total > 100 && <Typography variant="caption" sx={{ color: TONE.bad }}>{total}%</Typography>}
                    </Box>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
      {!roles.length && <Typography variant="caption" sx={{ color: TONE.warn }}>Add the role rates above first; then give each member a role here.</Typography>}
    </Section>
  )
}

function OverridesSection({ gov, save, projects }) {
  const saved = gov.rates.overrides
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(false)
  const list = rows ?? saved
  const dirty = rows && !same(rows, saved)
  const set = (i, patch) => setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const submit = async () => {
    setBusy(true)
    const ok = await save('rates', [{ path: 'overrides', from: saved, to: rows }])
    setBusy(false)
    if (ok) setRows(null)
  }
  return (
    <Section
      title="Project rate exceptions"
      subtitle="A different rate for one role on one project, with the reason and who approved it. Only an approved exception is used."
      data-section="overrides"
      action={(
        <Box sx={{ display: 'flex', gap: 1 }}>
          {dirty && <Button onClick={() => setRows(null)}>Undo</Button>}
          <Button variant="outlined" disabled={!dirty || busy} onClick={submit}>{busy ? 'Saving…' : 'Save exceptions'}</Button>
        </Box>
      )}
    >
      {list.length > 0 && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow><TableCell>Project</TableCell><TableCell>Role</TableCell><TableCell align="right">Hourly rate</TableCell><TableCell>Reason</TableCell><TableCell>Approved by</TableCell><TableCell>Status</TableCell><TableCell /></TableRow>
            </TableHead>
            <TableBody>
              {list.map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <TextField select size="small" value={r.projectKey} onChange={(e) => set(i, { projectKey: e.target.value })} sx={{ minWidth: 200 }}>
                      {projects.map((p) => <MenuItem key={p.key} value={p.key}>{p.key} · {p.summary}</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell>
                    <TextField select size="small" value={r.role} onChange={(e) => set(i, { role: e.target.value })} sx={{ minWidth: 150 }}>
                      {gov.rates.roles.map((x) => <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>)}
                    </TextField>
                  </TableCell>
                  <TableCell align="right"><TextField size="small" value={r.hourlyRate ?? ''} onChange={(e) => set(i, { hourlyRate: e.target.value === '' ? null : Number(e.target.value) })} sx={{ width: 100 }} /></TableCell>
                  <TableCell><TextField size="small" value={r.reason} onChange={(e) => set(i, { reason: e.target.value })} sx={{ minWidth: 200 }} /></TableCell>
                  <TableCell><TextField size="small" value={r.approvedBy} onChange={(e) => set(i, { approvedBy: e.target.value })} sx={{ width: 140 }} /></TableCell>
                  <TableCell>
                    <TextField select size="small" value={r.status} onChange={(e) => set(i, { status: e.target.value })} sx={{ width: 120 }}>
                      <MenuItem value="pending">Pending</MenuItem><MenuItem value="approved">Approved</MenuItem><MenuItem value="rejected">Rejected</MenuItem>
                    </TextField>
                  </TableCell>
                  <TableCell><IconButton size="small" aria-label="remove exception" onClick={() => setRows(list.filter((_, j) => j !== i))}><DeleteOutlineIcon fontSize="small" /></IconButton></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      <Button startIcon={<AddIcon />} sx={{ mt: 1 }} disabled={!gov.rates.roles.length || !projects.length} onClick={() => setRows([...list, { id: `ov${Date.now().toString(36)}`, projectKey: projects[0]?.key || '', role: gov.rates.roles[0]?.id || '', hourlyRate: null, reason: '', approvedBy: '', status: 'pending' }])}>
        Add an exception
      </Button>
    </Section>
  )
}

const blankCost = () => ({ id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, category: 'vendor', label: '', supplier: '', ref: '', kind: 'opex', recurring: false, forecast: null, actual: null, monthly: null })

function CostDialog({ project, rec, roles, onClose, save, horizon, row }) {
  const [costs, setCosts] = useState(rec?.costs || [])
  const [labour, setLabour] = useState(rec?.labour || [])
  const [remaining, setRemaining] = useState(rec?.remainingHours ?? null)
  const [busy, setBusy] = useState(false)
  const n = (v) => (v === '' ? null : Number(String(v).replace(/[,\s]/g, '')))
  const setC = (i, patch) => setCosts(costs.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const setL = (i, patch) => setLabour(labour.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const submit = async () => {
    setBusy(true)
    const changes = []
    if (!same(costs, rec?.costs || [])) changes.push({ path: 'costs', from: rec?.costs || [], to: costs })
    if (!same(labour, rec?.labour || [])) changes.push({ path: 'labour', from: rec?.labour || [], to: labour })
    if ((remaining ?? null) !== (rec?.remainingHours ?? null)) changes.push({ path: 'remainingHours', from: rec?.remainingHours ?? null, to: remaining })
    const ok = changes.length ? await save(`project:${project.key}`, changes) : true
    setBusy(false)
    if (ok) onClose()
  }
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth data-cost-dialog={project.key}>
      <DialogTitle>{project.key} · {project.summary} — costs</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Vendor, software and cloud, infrastructure, other</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Forecast and actual for each line. A recurring line with a monthly amount is forecast as that × {horizon} months.
            The register&rsquo;s own CAPEX and OPEX are counted already and are not repeated here.
          </Typography>
          <Box sx={{ overflowX: 'auto', mt: 1 }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Category</TableCell><TableCell>What</TableCell><TableCell>Supplier</TableCell><TableCell>Contract / SOW</TableCell>
                  <TableCell>CAPEX / OPEX</TableCell><TableCell>Recurring</TableCell><TableCell align="right">Monthly</TableCell>
                  <TableCell align="right">Forecast</TableCell><TableCell align="right">Actual</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {costs.map((c, i) => (
                  <TableRow key={c.id} data-cost-line>
                    <TableCell>
                      <TextField select size="small" value={c.category} onChange={(e) => setC(i, { category: e.target.value })} sx={{ minWidth: 150 }}>
                        {['vendor', 'software', 'infrastructure', 'other'].map((k) => <MenuItem key={k} value={k}>{COST_CATEGORY_LABEL[k]}</MenuItem>)}
                      </TextField>
                    </TableCell>
                    <TableCell><TextField size="small" value={c.label} onChange={(e) => setC(i, { label: e.target.value })} sx={{ minWidth: 160 }} inputProps={{ 'aria-label': 'cost line' }} /></TableCell>
                    <TableCell><TextField size="small" value={c.supplier} onChange={(e) => setC(i, { supplier: e.target.value })} sx={{ width: 130 }} /></TableCell>
                    <TableCell><TextField size="small" value={c.ref} onChange={(e) => setC(i, { ref: e.target.value })} sx={{ width: 120 }} /></TableCell>
                    <TableCell>
                      <TextField select size="small" value={c.kind} onChange={(e) => setC(i, { kind: e.target.value })} sx={{ width: 100 }}>
                        <MenuItem value="capex">CAPEX</MenuItem><MenuItem value="opex">OPEX</MenuItem>
                      </TextField>
                    </TableCell>
                    <TableCell><Checkbox size="small" checked={!!c.recurring} onChange={(e) => setC(i, { recurring: e.target.checked })} inputProps={{ 'aria-label': 'recurring' }} /></TableCell>
                    <TableCell align="right"><TextField size="small" value={c.monthly ?? ''} disabled={!c.recurring} onChange={(e) => setC(i, { monthly: n(e.target.value) })} sx={{ width: 100 }} inputProps={{ style: { textAlign: 'right' } }} /></TableCell>
                    <TableCell align="right"><TextField size="small" value={c.recurring && c.monthly != null ? c.monthly * horizon : c.forecast ?? ''} disabled={c.recurring && c.monthly != null} onChange={(e) => setC(i, { forecast: n(e.target.value) })} sx={{ width: 110 }} inputProps={{ style: { textAlign: 'right' }, 'aria-label': 'forecast' }} /></TableCell>
                    <TableCell align="right"><TextField size="small" value={c.actual ?? ''} onChange={(e) => setC(i, { actual: n(e.target.value) })} sx={{ width: 110 }} inputProps={{ style: { textAlign: 'right' }, 'aria-label': 'actual' }} /></TableCell>
                    <TableCell><IconButton size="small" aria-label="remove line" onClick={() => setCosts(costs.filter((_, j) => j !== i))}><DeleteOutlineIcon fontSize="small" /></IconButton></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
          <Button startIcon={<AddIcon />} onClick={() => setCosts([...costs, blankCost()])} sx={{ mt: 1 }} data-add-cost>Add a cost line</Button>
        </Box>

        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Labour forecast by role</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Hours each role is expected to put in. Left empty, the register&rsquo;s mandays ({project.manday || 0} md) are costed at the PIC&rsquo;s role rate.
          </Typography>
          {labour.map((l, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
              <TextField select size="small" value={l.role} onChange={(e) => setL(i, { role: e.target.value })} sx={{ minWidth: 200 }}>
                {roles.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
              </TextField>
              <TextField size="small" label="Hours" value={l.forecastHours ?? ''} onChange={(e) => setL(i, { forecastHours: n(e.target.value) })} sx={{ width: 110 }} />
              <IconButton size="small" aria-label="remove role hours" onClick={() => setLabour(labour.filter((_, j) => j !== i))}><DeleteOutlineIcon fontSize="small" /></IconButton>
            </Box>
          ))}
          <Button startIcon={<AddIcon />} onClick={() => setLabour([...labour, { role: roles[0]?.id || '', forecastHours: null }])} disabled={!roles.length} sx={{ mt: 1 }}>
            Add role hours
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            label="Remaining estimate (hours)"
            value={remaining ?? ''}
            onChange={(e) => setRemaining(n(e.target.value))}
            helperText={`Empty: Jira's remaining estimate${row?.remainingHours != null ? `, else forecast − logged (now ${Math.round(row.remainingHours)} h)` : ', else forecast − logged'}.`}
            sx={{ width: 300 }}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy} data-save-costs>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  )
}

function BudgetSection({ gov, save, plan }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const costs = useMemo(() => portfolioCosts(plan, gov), [plan, gov])
  const byKey = useMemo(() => Object.fromEntries(costs.rows.map((r) => [r.key, r])), [costs])
  const projects = (plan.projects || []).filter(inBook)
    .filter((p) => !q || `${p.key} ${p.summary} ${p.jiraKey || ''}`.toLowerCase().includes(q.toLowerCase()))
  const sym = plan.finance?.symbol || '฿'
  const rec = (key) => gov.projects[key] || null
  const put = (key, path, from, to) => save(`project:${key}`, [{ path, from, to }])
  return (
    <Section
      title="Project budgets and costs"
      subtitle="The approved budget for each project, typed in from Finance's approval. The first approved figure is kept as the baseline budget and never changes; later approvals are the current budget. Open Costs for vendor, software, infrastructure and other lines."
      data-section="budgets"
      action={<TextField size="small" placeholder="Find a project" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 220 }} />}
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Project</TableCell>
              <TableCell align="right">Approved budget</TableCell>
              <TableCell>Approved by</TableCell>
              <TableCell>Approved on</TableCell>
              <TableCell align="right">Baseline budget</TableCell>
              <TableCell align="right">Forecast cost</TableCell>
              <TableCell align="right">EAC</TableCell>
              <TableCell>Other cost lines</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {projects.map((p) => {
              const r = rec(p.key)
              const b = r?.budget || {}
              const row = byKey[p.key]
              return (
                <TableRow key={p.key} data-budget-row={p.key} hover>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.key}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.summary}</Typography>
                  </TableCell>
                  <TableCell align="right">
                    <NumField value={b.approved ?? null} width={130} aria-label={`${p.key} approved budget`} onCommit={(to, from) => put(p.key, 'budget.approved', from, to)} />
                  </TableCell>
                  <TableCell><TextCommit value={b.approvedBy} placeholder="Name" sx={{ width: 140 }} onCommit={(to, from) => put(p.key, 'budget.approvedBy', from, to)} /></TableCell>
                  <TableCell>
                    <TextField size="small" type="date" value={b.approvedAt || ''} onChange={(e) => put(p.key, 'budget.approvedAt', b.approvedAt || null, e.target.value || null)} sx={{ width: 150 }} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="The first approved budget. Kept for good.">
                      <span>{b.original != null ? money(b.original, sym) : '—'}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">{money(row?.forecastTotal, sym)}</TableCell>
                  <TableCell align="right" sx={{ color: row?.variance > 0 ? TONE.bad : undefined }}>{money(row?.eac, sym)}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => setOpen(p)} data-open-costs={p.key}>
                      Costs{r?.costs?.length ? ` (${r.costs.length})` : ''}
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
      {open && (
        <CostDialog
          project={open}
          rec={rec(open.key)}
          row={byKey[open.key]}
          roles={gov.rates.roles}
          horizon={plan.finance?.horizonMonths || 12}
          save={save}
          onClose={() => setOpen(null)}
        />
      )}
    </Section>
  )
}

function WorklogSection({ gov, reload, plan }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const w = gov.worklogs
  const costs = useMemo(() => portfolioCosts(plan, gov), [plan, gov])
  const run = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await api.govSyncWorklogs()
      if (r?.worklogs?.ok === false) setErr(r.worklogs.error)
      await reload()
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section
      title="Actual effort from Jira worklogs"
      subtitle="Time logged in Jira on each project's epic and the issues under it, read every day and on demand. Nobody types effort twice."
      data-section="worklogs"
      action={(
        <Button variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <SyncIcon />} onClick={run} disabled={busy} data-sync-worklogs>
          {busy ? 'Reading Jira…' : 'Read worklogs now'}
        </Button>
      )}
    >
      {err && <Alert severity="error" sx={{ mb: 1 }}>{err}</Alert>}
      {!w ? (
        <Typography variant="body2" sx={{ color: TONE.warn }}>Not read yet. Press &ldquo;Read worklogs now&rdquo;; it then runs every day by itself.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography variant="body2" data-worklog-status>
            {w.ok === false
              ? <span style={{ color: TONE.bad }}>The last read failed{w.failedAt ? ` (${new Date(w.failedAt).toLocaleString()})` : ''}: {w.error}</span>
              : <>Last read {new Date(w.at).toLocaleString()}: <b>{(w.entries || 0).toLocaleString()}</b> worklog entries across {w.projects ?? Object.keys(w.byProject || {}).length} projects, {Math.round(costs.totals.actualHours || 0).toLocaleString()} hours on the team&rsquo;s own projects.</>}
          </Typography>
          {costs.coverage.unmapped.length > 0 && (
            <Typography variant="body2" data-unmapped>
              <span style={{ color: TONE.warn, fontWeight: 600 }}>Not matched to anybody on the team: </span>
              {costs.coverage.unmapped.map((n) => <Chip key={n} label={n} size="small" sx={{ mr: 0.5, mb: 0.5 }} />)}
              <Typography component="span" variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                Their hours are costed at the default rate. Add the name to the member&rsquo;s Jira names on the Model page.
              </Typography>
            </Typography>
          )}
        </Box>
      )}
    </Section>
  )
}

export default function CostsSetup({ plan }) {
  const { gov, error, reload, save, dialog } = useGov()
  const people = useMemo(() => (plan.people || []).filter((p) => p && p.id && !p.deleted && p.scorecard !== false && !['it', 'user'].includes(p.id)), [plan.people])
  const projects = useMemo(() => (plan.projects || []).filter(inBook), [plan.projects])
  if (error) return <Alert severity="error">{error}</Alert>
  if (!gov) return <Loading variant="block" label="Reading the cost records…" />
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="rates">
      <PageHead title="Costs & rates">
        What Finance and management approve, typed in here: role rates, each member&rsquo;s role, and every project&rsquo;s
        approved budget and costs. The Cost &amp; ROI and Capacity pages work from it. Administrators only — team members
        never see rates or budgets. Every change is kept in the change history.
      </PageHead>
      <RatesSection gov={gov} save={save} />
      <TeamSection gov={gov} save={save} people={people} />
      <BudgetSection gov={gov} save={save} plan={plan} />
      <OverridesSection gov={gov} save={save} projects={projects} />
      <WorklogSection gov={gov} reload={reload} plan={plan} />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Roles in use: {gov.rates.roles.map((r) => r.name).filter(Boolean).join(', ') || 'none yet'}.
        {' '}Default rate: {gov.rates.defaultRole ? roleName(gov.rates, gov.rates.defaultRole) : 'the Model page developer salary'}.
      </Typography>
      {dialog}
    </Box>
  )
}

