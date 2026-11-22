import { useCallback, useEffect, useState } from 'react'
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Alert, TextField, MenuItem, Button, Link,
} from '@mui/material'
import * as api from '../lib/api.js'
import { Section, PageHead } from '../components/GovUi.jsx'
import Loading from '../components/Loading.jsx'

/*
 * CHANGE HISTORY (management design summary: "preserve history for
 * forecasts, approvals, rate changes and management decisions").
 *
 * Every field anybody changed — in the shared plan, the role rates, a
 * project's budget and costs, a benefit, the RAID register — with who, when,
 * and from what to what. Newest first.
 */

const KINDS = {
  '': 'Everything',
  'plan.project': 'Projects (the register)',
  'plan.person': 'People and scorecards',
  'plan.settings': 'Model settings',
  rates: 'Role rates and the team',
  project: 'Budgets, costs and benefits',
  raid: 'Decisions and RAID',
  snapshot: 'Issued packs and frozen reviews',
}
const KIND_SHORT = {
  'plan.project': 'Register', 'plan.person': 'People', 'plan.settings': 'Model', rates: 'Rates', project: 'Costs / benefit', raid: 'RAID', snapshot: 'Snapshot',
}

const show = (v) => {
  if (v == null || v === 'null') return '—'
  try {
    const x = JSON.parse(v)
    if (x == null || x === '') return '—'
    if (typeof x === 'object') return Array.isArray(x) ? `${x.length} item${x.length === 1 ? '' : 's'}` : Object.entries(x).map(([k, y]) => `${k}: ${typeof y === 'object' ? '…' : y}`).join(', ').slice(0, 140)
    return String(x)
  } catch {
    return String(v).slice(0, 140)
  }
}

export default function History({ onOpenProject }) {
  const [kind, setKind] = useState('')
  const [key, setKey] = useState('')
  const [rows, setRows] = useState(null)
  const [more, setMore] = useState(true)
  const [error, setError] = useState(null)
  const load = useCallback(async (before = '') => {
    try {
      const r = await api.auditLog({ kind, key: key.trim(), limit: 200, before })
      setRows((cur) => (before ? [...(cur || []), ...r.rows] : r.rows))
      setMore(r.rows.length === 200)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [kind, key])
  useEffect(() => { setRows(null); load() }, [load])
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="history">
      <PageHead title="Change history">
        Every field changed in the register, the model, the role rates, budgets and costs, benefits and the RAID register —
        who changed it, when, and from what to what. Nothing is overwritten without leaving a trace here.
      </PageHead>
      <Section
        title="Changes"
        action={(
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <TextField select size="small" label="What" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 220 }}>
              {Object.entries(KINDS).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
            <TextField size="small" label="Project or item key" value={key} onChange={(e) => setKey(e.target.value)} sx={{ width: 180 }} />
          </Box>
        )}
      >
        {error && <Alert severity="error">{error}</Alert>}
        {!rows && !error && <Loading label="Reading the history…" />}
        {rows && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow><TableCell>When</TableCell><TableCell>Who</TableCell><TableCell>What</TableCell><TableCell>Item</TableCell><TableCell>Field</TableCell><TableCell>From</TableCell><TableCell>To</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={`${r.at}-${i}`} data-audit-row>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString()}</TableCell>
                    <TableCell>{r.by}</TableCell>
                    <TableCell>{KIND_SHORT[r.kind] || r.kind}</TableCell>
                    <TableCell>
                      {(r.kind === 'plan.project' || r.kind === 'project') && onOpenProject
                        ? <Link component="button" onClick={() => onOpenProject(r.key)}>{r.key}</Link>
                        : r.key}
                    </TableCell>
                    <TableCell>{r.field}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', maxWidth: 260 }}>{show(r.from)}</TableCell>
                    <TableCell sx={{ maxWidth: 260, fontWeight: 600 }}>{show(r.to)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!rows.length && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>No changes recorded yet.</Typography>}
            {more && rows.length > 0 && <Button sx={{ mt: 1 }} onClick={() => load(rows[rows.length - 1].at)}>Older changes</Button>}
          </Box>
        )}
      </Section>
    </Box>
  )
}
