import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Tooltip, Button, Alert, Table, TableHead, TableBody, TableRow, TableCell,
  LinearProgress, Collapse, Link, Chip,
} from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import * as api from '../lib/api.js'
import { METRICS, METRIC_BY_ID, COST_COVERAGE_GATE, dataQuality, overviewOf } from '../lib/governance.js'
import { fmtMoneyShort, fmtRoi, fmtPct, SAVING_BASIS } from '../lib/model.js'

/* CP AXTRA colours for the few marks that carry meaning. */
export const TONE = { good: '#43938f', warn: '#c8961f', bad: '#da3832', blue: '#306fc7' }

/** The definition, inclusion rule and source behind a figure. */
export function MetricInfo({ id, refreshed }) {
  const m = METRIC_BY_ID[id]
  if (!m) return null
  return (
    <Tooltip
      placement="bottom-start"
      title={(
        <Box sx={{ py: 0.5 }}>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>{m.label}</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>{m.definition}</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}><b>How:</b> {m.formula}</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}><b>Includes:</b> {m.includes}</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}><b>Source:</b> {m.source}</Typography>
          {refreshed && <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.85 }}><b>Refreshed:</b> {refreshed}</Typography>}
        </Box>
      )}
    >
      <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled', cursor: 'help', ml: 0.5 }} aria-label={`how ${m.label} is worked out`} />
    </Tooltip>
  )
}

function Tile({ id, value, tone, note, gap, refreshed }) {
  const m = METRIC_BY_ID[id]
  return (
    <Paper variant="outlined" sx={{ p: 2, minHeight: 128, display: 'flex', flexDirection: 'column' }} data-metric={id}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>{m.label}</Typography>
        <MetricInfo id={id} refreshed={refreshed} />
      </Box>
      <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, mt: 0.75, color: tone || 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </Typography>
      {gap && <Typography variant="caption" sx={{ color: TONE.warn, fontWeight: 600 }}>{gap}</Typography>}
      {note && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{note}</Typography>}
      <Typography variant="caption" sx={{ color: 'text.disabled', mt: 'auto', pt: 0.75 }}>{m.decision}</Typography>
    </Paper>
  )
}

function Section({ title, info, children, action }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.25, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1 }}>
        <Typography variant="h4">{title}</Typography>
        {info}
        <Box sx={{ flex: 1 }} />
        {action}
      </Box>
      {children}
    </Paper>
  )
}

const stamp = (iso) => (iso ? new Date(iso).toLocaleString() : null)

/**
 * THE MANAGEMENT OVERVIEW: four questions on one screen. Are we delivering
 * the agreed portfolio, using capacity responsibly, within approved cost, and
 * realising the expected value — with the data's limits shown first.
 */
export default function Overview({ plan, lastSaved, canWrite, me, onSettings, onOpenProject, onGoTo }) {
  const [jira, setJira] = useState(null)
  const [dictOpen, setDictOpen] = useState(false)
  useEffect(() => {
    let live = true
    api.jiraLastRun().then((r) => { if (live) setJira(r) }).catch(() => { if (live) setJira(null) })
    return () => { live = false }
  }, [])
  const quality = useMemo(() => dataQuality(plan, { jira }), [plan, jira])
  const o = useMemo(() => overviewOf(plan, quality), [plan, quality])
  const sym = plan.finance?.symbol || '฿'
  const h = o.headline
  const s = plan.settings || {}
  const refreshed = [lastSaved && `plan saved ${stamp(lastSaved)}`, jira?.at && `Jira ${stamp(jira.at)}`].filter(Boolean).join(' · ') || null
  const failing = quality.checks.filter((c) => c.rows.length && c.id !== 'deleted').sort((a, b) => b.rows.length - a.rows.length)
  const conf = quality.confidence
  const confTone = conf.score == null ? null : conf.score >= 0.85 ? TONE.good : conf.score >= 0.65 ? TONE.warn : TONE.bad
  const basis = SAVING_BASIS[s.savingBasis]?.label || 'Per month'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="overview">
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 280 }}>
          <Typography variant="h2">Management overview</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 820 }}>
            Are we delivering the agreed portfolio, using capacity responsibly, within approved cost, and realising
            the expected value? Every figure names its definition and source (hover the <InfoOutlinedIcon sx={{ fontSize: 13, verticalAlign: '-2px' }} />);
            a figure the data cannot support is shown as a gap, not a zero.
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
            As of {o.asOf || 'today'}{refreshed ? ` · ${refreshed}` : ''} · {o.book.length} projects in the team&apos;s plan
          </Typography>
        </Box>
        <Paper variant="outlined" sx={{ px: 2, py: 1.25, minWidth: 220 }} data-confidence>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>Reporting confidence</Typography>
            <MetricInfo id="confidence" refreshed={refreshed} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, color: confTone }}>{conf.score == null ? '—' : fmtPct(conf.score)}</Typography>
            <Typography variant="body2" sx={{ color: confTone, fontWeight: 650 }}>{conf.verdict}</Typography>
          </Box>
        </Paper>
      </Box>

      {!s.savingBasisApproval && (
        <Alert
          severity="warning"
          variant="outlined"
          action={canWrite ? (
            <Button size="small" color="inherit" onClick={() => onSettings({ savingBasisApproval: { by: me?.email || null, at: new Date().toISOString() } })} data-confirm-basis>
              Confirm as approved
            </Button>
          ) : null}
        >
          Saving hours are counted <b>{basis.toLowerCase()}</b>, but management has not confirmed that basis. ROI and every
          benefit figure depend on it (monthly vs annual is a 12× difference). Confirm it once it is approved.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' } }}>
        <Tile id="active" value={h.active.value} note={h.active.note} refreshed={refreshed} />
        <Tile id="reliability" value={h.reliability.value == null ? null : fmtPct(h.reliability.value)} note={h.reliability.note} gap={h.reliability.gap} refreshed={refreshed}
          tone={h.reliability.value == null ? null : h.reliability.value >= (s.onTimeGate ?? 0.8) ? TONE.good : TONE.bad} />
        <Tile id="capacity" value={null} gap={h.capacity.gap} note={h.capacity.note} refreshed={refreshed} />
        <Tile id="eac" value={h.eac.value == null ? null : fmtMoneyShort(h.eac.value, sym)} note={h.eac.note} gap={h.eac.gap} refreshed={refreshed} />
        <Tile id="budget" value={null} gap={h.budget.gap} refreshed={refreshed} />
        <Tile id="projectedRoi" value={h.projectedRoi.value == null ? null : fmtRoi(h.projectedRoi.value)} note={h.projectedRoi.note} gap={h.projectedRoi.gap} refreshed={refreshed}
          tone={h.projectedRoi.value == null || !h.projectedRoi.scored ? 'text.disabled' : h.projectedRoi.value >= 0 ? TONE.good : TONE.bad} />
        <Tile id="actualRoi" value={null} gap={h.actualRoi.gap} refreshed={refreshed} />
        <Tile id="confidence" value={conf.score == null ? null : fmtPct(conf.score)} note={conf.verdict} tone={confTone} refreshed={refreshed} />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' } }}>
        <Section title="Portfolio delivery" info={<MetricInfo id="reliability" refreshed={refreshed} />}>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1.5 }}>
            {[
              ['Scored', o.delivery.scored],
              ['On time', o.delivery.onTime, TONE.good],
              ['Late', o.delivery.late, o.delivery.late ? TONE.bad : null],
              [`Forecast > ${o.tolerance} days past baseline`, o.delivery.slipping, o.delivery.slipping ? TONE.warn : null],
              ['Median slip (open work)', o.delivery.medianSlip == null ? '—' : `${Math.round(o.delivery.medianSlip)} days`],
              ['Re-planned twice or more', o.delivery.repeatReplans.length, o.delivery.repeatReplans.length ? TONE.warn : null],
            ].map(([k, v, c]) => (
              <Box key={k}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{k}</Typography>
                <Typography sx={{ fontWeight: 700, fontSize: '1.15rem', color: c || 'text.primary' }}>{v}</Typography>
              </Box>
            ))}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>Biggest slips against the approved baseline (open work that is overdue counts to today)</Typography>
          {o.delivery.delays.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>No project has moved past its baseline.</Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" data-delays>
                <TableHead>
                  <TableRow>
                    <TableCell>Project</TableCell>
                    <TableCell>Baseline</TableCell>
                    <TableCell>Forecast</TableCell>
                    <TableCell>Actual</TableCell>
                    <TableCell align="right">Slip</TableCell>
                    <TableCell align="right">Re-plans</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {o.delivery.delays.map(({ p, d }) => (
                    <TableRow key={p.key} hover>
                      <TableCell sx={{ maxWidth: 280 }}>
                        <Link component="button" underline="hover" onClick={() => onOpenProject(p.key)} sx={{ textAlign: 'left', fontWeight: 600, fontSize: '0.8rem' }}>
                          {p.summary}
                        </Link>
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{p.jiraKey || p.key}</Typography>
                      </TableCell>
                      <TableCell>{d.baseline || '—'}</TableCell>
                      <TableCell>
                        {d.done ? '—' : (d.forecast || '—')}
                        {d.overdue && <Typography component="span" variant="caption" sx={{ display: 'block', color: TONE.bad }}>overdue</Typography>}
                      </TableCell>
                      <TableCell>{d.actual || '—'}</TableCell>
                      <TableCell align="right" sx={{ color: d.slip > o.tolerance ? TONE.bad : TONE.warn, fontWeight: 650 }}>+{d.slip} d</TableCell>
                      <TableCell align="right">{d.replans || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Section>

        <Section
          title="Data quality"
          info={<MetricInfo id="confidence" refreshed={refreshed} />}
          action={<Button size="small" onClick={() => onGoTo('quality')} data-open-quality>Open data quality</Button>}
        >
          {[
            ['Completeness', conf.parts.completeness],
            ['Validity', conf.parts.validity],
            ['Freshness (Jira sync)', conf.parts.freshness],
            ['Assumptions confirmed', conf.parts.assumptions],
          ].map(([k, v]) => (
            <Box key={k} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption">{k}</Typography>
                <Typography variant="caption" sx={{ fontWeight: 650 }}>{v == null ? 'unknown' : fmtPct(v)}</Typography>
              </Box>
              <LinearProgress variant="determinate" value={v == null ? 0 : v * 100}
                sx={{ height: 6, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: v == null ? 'transparent' : v >= 0.85 ? TONE.good : v >= 0.65 ? TONE.warn : TONE.bad } }} />
            </Box>
          ))}
          <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {failing.slice(0, 6).map((c) => (
              <Box key={c.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: c.severity === 'high' ? TONE.bad : TONE.warn, flexShrink: 0 }} />
                <Typography variant="body2" sx={{ flex: 1, fontSize: '0.82rem' }}>{c.label}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.rows.length}</Typography>
              </Box>
            ))}
            {quality.global.filter((g) => !g.ok).map((g) => (
              <Typography key={g.id} variant="caption" sx={{ color: g.unknown ? 'text.secondary' : TONE.warn }}>{g.label}: {g.text}</Typography>
            ))}
          </Box>
        </Section>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        <Section title="Capacity" info={<MetricInfo id="capacity" refreshed={refreshed} />}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            Planned <b>{Math.round(o.capacity.planned).toLocaleString()}</b> man-days against about{' '}
            <b>{o.capacity.capacity.toLocaleString()}</b> available in a year ({o.capacity.people} people).
          </Typography>
          <LinearProgress variant="determinate" value={Math.min(100, o.capacity.capacity ? (o.capacity.planned / o.capacity.capacity) * 100 : 0)}
            sx={{ height: 8, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: o.capacity.planned > o.capacity.capacity ? TONE.bad : TONE.blue } }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            {o.capacity.noEffort} projects have no effort estimate. Actual effort is not recorded yet, so capacity
            variance, carry-over and blocked days need actual man-days (Jira worklogs) before they can be shown.
          </Typography>
        </Section>
        <Section title="Cost and ROI" info={<MetricInfo id="projectedRoi" refreshed={refreshed} />}>
          <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1 }}>
            <Box><Typography variant="caption" sx={{ color: 'text.secondary' }}>Forecast cost (EAC)</Typography><Typography sx={{ fontWeight: 700 }}>{o.cost.eac == null ? '—' : fmtMoneyShort(o.cost.eac, sym)}</Typography></Box>
            <Box><Typography variant="caption" sx={{ color: 'text.secondary' }}>Expected net benefit, {o.cost.horizon} months</Typography><Typography sx={{ fontWeight: 700 }}>{fmtMoneyShort(o.cost.benefit, sym)}</Typography></Box>
            <Box><Typography variant="caption" sx={{ color: 'text.secondary' }}>Projects costed</Typography><Typography sx={{ fontWeight: 700 }}>{o.cost.costed} of {o.cost.withBenefit}</Typography></Box>
            <Box><Typography variant="caption" sx={{ color: 'text.secondary' }}>Below the return gate</Typography><Typography sx={{ fontWeight: 700, color: o.cost.belowGate.length ? TONE.bad : 'text.primary' }}>{o.cost.belowGate.length}</Typography></Box>
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            Saving hours are capacity released, not cash saved, and are estimates until validated. {o.cost.roiScored
              ? 'Enough projects are costed for ROI to be scored.'
              : `ROI is not scored until ${Math.round(COST_COVERAGE_GATE * 100)}% of projects with a benefit have a cost; add man-days or CAPEX on the Projects page.`}
          </Typography>
        </Section>
      </Box>

      <Paper variant="outlined" sx={{ p: 2.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }} onClick={() => setDictOpen((v) => !v)} data-dictionary-toggle>
          <Typography variant="h4" sx={{ flex: 1 }}>Metric dictionary</Typography>
          <Chip size="small" label={`${METRICS.length} metrics`} sx={{ mr: 1 }} />
          <ExpandMoreIcon sx={{ transform: dictOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        </Box>
        <Collapse in={dictOpen}>
          <Box sx={{ overflowX: 'auto', mt: 1.5 }}>
            <Table size="small" data-dictionary>
              <TableHead>
                <TableRow>
                  <TableCell>Metric</TableCell>
                  <TableCell>Definition and calculation</TableCell>
                  <TableCell>Included</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Decision supported</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {METRICS.map((m) => (
                  <TableRow key={m.id} sx={{ verticalAlign: 'top' }}>
                    <TableCell sx={{ fontWeight: 650, whiteSpace: 'nowrap' }}>{m.label}</TableCell>
                    <TableCell sx={{ minWidth: 260 }}>{m.definition}<Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{m.formula}</Typography></TableCell>
                    <TableCell sx={{ minWidth: 200 }}>{m.includes}</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>{m.source}</TableCell>
                    <TableCell sx={{ minWidth: 160 }}>{m.decision}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Collapse>
      </Paper>
    </Box>
  )
}
