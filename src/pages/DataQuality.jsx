import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Table, TableHead, TableBody, TableRow, TableCell, Link, Collapse, Chip,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import * as api from '../lib/api.js'
import { dataQuality } from '../lib/governance.js'
import { fmtPct } from '../lib/model.js'
import { TONE, MetricInfo } from './Overview.jsx'

const SEVERITY = { high: { label: 'High', c: TONE.bad }, medium: { label: 'Medium', c: TONE.warn }, low: { label: 'Low', c: '#7b8aa0' } }

/**
 * DATA QUALITY AND GOVERNANCE. Every check the register must pass before it
 * is reported from, each with the rows that fail it, so a record can be fixed
 * rather than a total argued with.
 */
export default function DataQuality({ plan, onOpenProject }) {
  const [jira, setJira] = useState(null)
  const [open, setOpen] = useState(() => new Set())
  useEffect(() => {
    let live = true
    api.jiraLastRun().then((r) => { if (live) setJira(r) }).catch(() => {})
    return () => { live = false }
  }, [])
  const q = useMemo(() => dataQuality(plan, { jira }), [plan, jira])
  const people = useMemo(() => Object.fromEntries((plan.assignees || plan.people || []).map((p) => [p.id, p.nick])), [plan])
  const toggle = (id) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const conf = q.confidence

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="quality">
      <Box>
        <Typography variant="h2">Data quality</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 820 }}>
          What has to be right before the figures are used for management reporting or performance review. Fix a row
          on the Projects page or in Jira; the checks rerun as soon as the register changes.
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' } }}>
        <Paper variant="outlined" sx={{ p: 2 }} data-confidence>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>Reporting confidence</Typography>
            <MetricInfo id="confidence" />
          </Box>
          <Typography sx={{ fontSize: '1.6rem', fontWeight: 700 }}>{conf.score == null ? '—' : fmtPct(conf.score)}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{conf.verdict}</Typography>
        </Paper>
        {[['Completeness', conf.parts.completeness], ['Validity', conf.parts.validity], ['Freshness', conf.parts.freshness], ['Assumptions', conf.parts.assumptions]].map(([k, v]) => (
          <Paper key={k} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>{k}</Typography>
            <Typography sx={{ fontSize: '1.6rem', fontWeight: 700, color: v == null ? 'text.disabled' : v >= 0.85 ? TONE.good : v >= 0.65 ? TONE.warn : TONE.bad }}>
              {v == null ? '—' : fmtPct(v)}
            </Typography>
            {v == null && <Typography variant="caption" sx={{ color: 'text.secondary' }}>unknown</Typography>}
          </Paper>
        ))}
      </Box>

      <Paper variant="outlined" sx={{ p: 2.25 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>Sources and assumptions</Typography>
        {q.global.map((g) => (
          <Box key={g.id} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', mb: 0.5 }} data-global={g.id}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: g.ok ? TONE.good : g.unknown ? '#9aa7b8' : TONE.warn }} />
            <Typography variant="body2"><b>{g.label}.</b> {g.text}</Typography>
          </Box>
        ))}
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          Source of truth: Jira for sprint tasks, status and dates; this application for portfolio classification
          and commitment; the Model page for rates and assumptions.
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ p: 0 }}>
        {q.checks.map((c, i) => {
          const sev = SEVERITY[c.severity]
          const isOpen = open.has(c.id)
          return (
            <Box key={c.id} sx={{ borderTop: i ? 1 : 0, borderColor: 'divider' }} data-check={c.id} data-count={c.rows.length}>
              <Box
                onClick={() => c.rows.length && toggle(c.id)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.25, py: 1.5, cursor: c.rows.length ? 'pointer' : 'default' }}
              >
                {c.rows.length
                  ? <Chip size="small" label={sev.label} sx={{ bgcolor: 'transparent', border: `1px solid ${sev.c}`, color: sev.c, minWidth: 64 }} />
                  : <CheckCircleOutlineIcon sx={{ color: TONE.good, fontSize: 20, mx: 2.5 }} />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 650 }}>{c.label}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.why}</Typography>
                </Box>
                <Typography sx={{ fontWeight: 700, fontSize: '1.1rem', fontVariantNumeric: 'tabular-nums', color: c.rows.length ? 'text.primary' : 'text.disabled' }}>
                  {c.rows.length}
                </Typography>
                <ExpandMoreIcon sx={{ visibility: c.rows.length ? 'visible' : 'hidden', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </Box>
              <Collapse in={isOpen} unmountOnExit>
                <Box sx={{ px: 2.25, pb: 1.5, overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Jira</TableCell>
                        <TableCell>Project</TableCell>
                        <TableCell>PIC</TableCell>
                        <TableCell>Status</TableCell>
                        {c.detail && <TableCell>Problem</TableCell>}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {c.rows.slice(0, 200).map((p) => (
                        <TableRow key={`${c.id}-${p.key}`} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{p.jiraKey || '—'}</TableCell>
                          <TableCell>
                            <Link component="button" underline="hover" onClick={() => onOpenProject(p.key)} sx={{ textAlign: 'left', fontSize: '0.82rem' }}>
                              {p.summary || p.key}
                            </Link>
                          </TableCell>
                          <TableCell>{p.pic ? (people[p.pic] || p.pic) : '—'}</TableCell>
                          <TableCell>{p.status || '—'}</TableCell>
                          {c.detail && <TableCell sx={{ color: 'text.secondary' }}>{c.detail[p.key]}</TableCell>}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {c.rows.length > 200 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>First 200 of {c.rows.length}.</Typography>}
                </Box>
              </Collapse>
            </Box>
          )
        })}
      </Paper>
    </Box>
  )
}
