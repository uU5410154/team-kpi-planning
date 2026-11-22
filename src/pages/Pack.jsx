import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Alert, Button, TextField, MenuItem,
  ToggleButton, ToggleButtonGroup, GlobalStyles, CircularProgress, Collapse,
} from '@mui/material'
import PrintIcon from '@mui/icons-material/PrintOutlined'
import SendIcon from '@mui/icons-material/TaskAltOutlined'
import * as api from '../lib/api.js'
import { dataQuality, METRIC_BY_ID } from '../lib/governance.js'
import { BENEFIT_STATE_LABEL } from '../lib/costs.js'
import { packOf, boardSummary, HEADLINE_IDS, HEADLINE_KIND } from '../lib/pack.js'
import { weekOf, weekNo } from '../lib/weekly.js'
import { useGov } from '../components/GovConflict.jsx'
import {
  Section, Stat, PageHead, money, pctOf, signedMoney, TONE,
} from '../components/GovUi.jsx'
import { Pill } from '../components/Brand.jsx'
import Loading from '../components/Loading.jsx'

/*
 * THE MANAGEMENT PACK (management design summary, Priority 2): the report a
 * steering meeting is run from, built from the same figures as every other
 * page. "Issue this pack" keeps it exactly as it stood; the next one reports
 * only what changed materially since. The Board summary keeps material
 * changes, strategic outcomes, the big financial movements, the decisions,
 * the roadmap and the watchlist. Prints to A4 (or saves as PDF) with nothing
 * of the app around it, carrying its period, refresh times and definitions.
 */

const PRINT = (
  <GlobalStyles styles={{
    '@media print': {
      '@page': { size: 'A4', margin: '12mm' },
      'body *': { visibility: 'hidden' },
      '[data-pack], [data-pack] *': { visibility: 'visible' },
      '[data-pack]': { position: 'absolute', left: 0, top: 0, width: '100%', padding: 0 },
      '[data-no-print]': { display: 'none !important' },
      '[data-pack-section]': { breakInside: 'avoid', pageBreakInside: 'avoid', boxShadow: 'none !important' },
      '[data-pack-break]': { breakBefore: 'page', pageBreakBefore: 'always' },
      '[data-pack] .MuiTableContainer-root, [data-pack] [data-scroll]': { overflow: 'visible !important' },
    },
  }}
  />
)

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const md = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()} md`)
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

function fmtHeadline(id, v, sym) {
  if (v == null) return '—'
  const k = HEADLINE_KIND[id]
  if (k === 'count') return v.toLocaleString()
  if (k === 'ratio') return pct(v)
  if (k === 'roi') return pctOf(v)
  if (k === 'md') return md(v)
  return id === 'budget' ? signedMoney(v, sym) : money(v, sym)
}

const Scroll = ({ children }) => <Box data-scroll sx={{ overflowX: 'auto' }}>{children}</Box>
const Empty = ({ children }) => <Typography variant="body2" sx={{ color: 'text.secondary' }}>{children}</Typography>

const CHANGE_TONE = {
  added: 'info', removed: 'neutral', status: 'info', slipped: 'bad', 'over budget': 'bad', benefit: 'good', blocked: 'warn',
}

function Changes({ changes, sym }) {
  if (!changes) return <Empty>No previous pack — this is the first. The next pack issued will report what changed since this one.</Empty>
  if (!changes.count) return <Empty>Nothing changed materially since the pack of {changes.since?.period || day(changes.since?.generatedAt)}.</Empty>
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {changes.headline.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {changes.headline.map((c) => (
            <Box key={c.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, px: 1.25, py: 0.75 }} data-change-headline={c.id}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{METRIC_BY_ID[c.id]?.label || c.id}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{fmtHeadline(c.id, c.from, sym)} → {fmtHeadline(c.id, c.to, sym)}</Typography>
            </Box>
          ))}
        </Box>
      )}
      {changes.financial.length > 0 && (
        <Typography variant="body2">
          <b>Financial: </b>
          {changes.financial.map((f) => `${{ budget: 'approved budget', actualTotal: 'actual spend', eac: 'EAC', variance: 'budget variance' }[f.id]} ${money(f.from, sym)} → ${money(f.to, sym)}`).join(' · ')}
        </Typography>
      )}
      {changes.projects.length > 0 && (
        <Scroll>
          <Table size="small">
            <TableHead><TableRow><TableCell>Project</TableCell><TableCell>Change</TableCell><TableCell>Was</TableCell><TableCell>Now</TableCell></TableRow></TableHead>
            <TableBody>
              {changes.projects.map((c, i) => (
                <TableRow key={`${c.key}-${c.what}-${i}`} data-change={c.what}>
                  <TableCell><b>{c.key}</b> <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{c.name}</Typography></TableCell>
                  <TableCell><Pill label={c.what} tone={CHANGE_TONE[c.what] || 'neutral'} /></TableCell>
                  <TableCell>{show(c.what, c.from, sym)}</TableCell>
                  <TableCell>{show(c.what, c.to, sym)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Scroll>
      )}
    </Box>
  )
}
function show(what, v, sym) {
  if (v == null) return '—'
  if (what === 'slipped') return `${v} days late`
  if (what === 'over budget') return signedMoney(v, sym)
  if (what === 'benefit') return BENEFIT_STATE_LABEL[v] || v
  if (what === 'blocked') return `${v} blocked days`
  return String(v)
}

function Strategic({ s }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
      <Stat label="Saving hours in the plan" value={s.totalHours == null ? '—' : `${Math.round(s.totalHours).toLocaleString()} h`} note={s.target ? `against a target of ${s.target.toLocaleString()} h` : null} />
      <Stat label="Of the target" value={pct(s.coverage)} tone={s.coverage == null ? undefined : s.coverage >= 1 ? TONE.good : TONE.warn} />
      <Stat label="Committed / stretch" value={s.committedHours == null ? '—' : `${Math.round(s.committedHours).toLocaleString()} h`} note={s.stretchHours != null ? `+ ${Math.round(s.stretchHours).toLocaleString()} h stretch` : null} />
      <Stat label="Projects delivered" value={`${s.delivered} of ${s.projects}`} note={`${s.inProgress} in progress`} />
    </Box>
  )
}

function Roadmap({ rows, nick }) {
  if (!rows.length) return <Empty>Nothing is forecast to land in the next 90 days.</Empty>
  return (
    <Scroll>
      <Table size="small">
        <TableHead><TableRow><TableCell>Project</TableCell><TableCell>PIC</TableCell><TableCell>Baseline</TableCell><TableCell>Forecast</TableCell><TableCell align="right">Slip</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} data-roadmap={r.key}>
              <TableCell><b>{r.key}</b> <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{r.name}</Typography></TableCell>
              <TableCell>{nick(r.pic)}</TableCell>
              <TableCell>{day(r.baseline)}</TableCell>
              <TableCell>{day(r.forecast)}</TableCell>
              <TableCell align="right" sx={{ color: r.slip > 0 ? TONE.bad : undefined }}>{r.slip ? `${r.slip > 0 ? '+' : ''}${r.slip} d` : '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Scroll>
  )
}

function Watchlist({ rows, nick }) {
  if (!rows.length) return <Empty>Nothing on the watchlist: no open project is over budget, below the return gate, late or blocked.</Empty>
  return (
    <Scroll>
      <Table size="small">
        <TableHead><TableRow><TableCell>Project</TableCell><TableCell>PIC</TableCell><TableCell>Why</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.key} data-watch={r.key}>
              <TableCell><b>{r.key}</b> <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{r.name}</Typography></TableCell>
              <TableCell>{nick(r.pic)}</TableCell>
              <TableCell><Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>{r.reasons.map((x) => <Pill key={x} label={x} tone={/budget|late/.test(x) ? 'bad' : 'warn'} />)}</Box></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Scroll>
  )
}

function Decisions({ rows, sym }) {
  if (!rows.length) return <Empty>No decision is waiting for management.</Empty>
  return (
    <Scroll>
      <Table size="small">
        <TableHead><TableRow><TableCell>Decision</TableCell><TableCell>Project</TableCell><TableCell>Owner</TableCell><TableCell>Due</TableCell><TableCell>Exposure</TableCell><TableCell>Recommendation</TableCell><TableCell>Approver</TableCell></TableRow></TableHead>
        <TableBody>
          {rows.map((d) => (
            <TableRow key={`${d.source}-${d.id}`} data-decision={d.id}>
              <TableCell sx={{ minWidth: 200 }}>{d.title}{d.source === 'weekly' && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Asked in the weekly check-in{d.jiraKey ? ` · ${d.jiraKey}` : ''}</Typography>}</TableCell>
              <TableCell>{d.projectKey || '—'}</TableCell>
              <TableCell>{d.owner || '—'}</TableCell>
              <TableCell>{day(d.due)}</TableCell>
              <TableCell>
                {[d.exposure?.cost != null && money(d.exposure.cost, sym), d.exposure?.days != null && `${d.exposure.days} days`, d.exposure?.benefit != null && `${money(d.exposure.benefit, sym)} benefit`].filter(Boolean).join(' · ') || '—'}
              </TableCell>
              <TableCell sx={{ minWidth: 160 }}>{d.recommendation || '—'}</TableCell>
              <TableCell>{d.approver || '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Scroll>
  )
}

function FinanceTotals({ t, sym, horizon, gate }) {
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)', lg: 'repeat(7, 1fr)' } }}>
      <Stat label="Approved budget" value={money(t.budget, sym)} />
      <Stat label="Actual spend" value={money(t.actualTotal, sym)} />
      <Stat label="Estimate at completion" value={money(t.eac, sym)} />
      <Stat label="Budget variance" value={signedMoney(t.variance, sym)} tone={t.variance > 0 ? TONE.bad : t.variance != null ? TONE.good : undefined} />
      <Stat label="Forecast ROI" value={pctOf(t.forecastRoi)} note={`${horizon} months`} />
      <Stat label="Projected ROI" value={pctOf(t.projectedRoi)} note={`gate ${pctOf(gate)}`} tone={t.projectedRoi != null ? (t.projectedRoi >= gate ? TONE.good : TONE.warn) : undefined} />
      <Stat label="Validated actual ROI" value={pctOf(t.actualRoi)} />
    </Box>
  )
}

function MoneyList({ title, rows, render, empty }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{title}</Typography>
      {rows.length ? (
        <Scroll>
          <Table size="small"><TableBody>{rows.slice(0, 10).map(render)}</TableBody></Table>
        </Scroll>
      ) : <Empty>{empty}</Empty>}
    </Box>
  )
}

function Board({ b, sym, nick }) {
  return (
    <>
      <Section title="Material changes since the previous pack" data-pack-section><Changes changes={b.changes} sym={sym} /></Section>
      <Section title="Strategic outcomes" data-pack-section><Strategic s={b.strategic} /></Section>
      <Section title="Major financial movements" subtitle={`Over a ${b.financial.horizon}-month benefit horizon.`} data-pack-section>
        <FinanceTotals t={b.financial.totals} sym={sym} horizon={b.financial.horizon} gate={b.financial.gate} />
      </Section>
      <Section title="Steering decisions" data-pack-section data-pack-break><Decisions rows={b.decisions} sym={sym} /></Section>
      <Section title="Roadmap — the next 90 days" data-pack-section><Roadmap rows={b.roadmap} nick={nick} /></Section>
      <Section title="Management watchlist" data-pack-section><Watchlist rows={b.watchlist} nick={nick} /></Section>
    </>
  )
}

function Full({ p, sym, nick }) {
  const f = p.finance
  return (
    <>
      <Section title="Executive summary" subtitle="The Management overview's eight headline figures." data-pack-section>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
          {HEADLINE_IDS.map((id) => (
            <Stat key={id} label={METRIC_BY_ID[id]?.label || id} value={fmtHeadline(id, p.headline[id].value, sym)} gap={p.headline[id].gap} note={p.headline[id].note} data-pack-headline={id} />
          ))}
        </Box>
      </Section>
      <Section title="Material changes since the previous pack" data-pack-section><Changes changes={p.changes} sym={sym} /></Section>
      <Section title="Strategic outcomes" data-pack-section><Strategic s={p.strategic} /></Section>
      <Section title="Forward roadmap — the next 90 days" data-pack-section data-pack-break><Roadmap rows={p.roadmap} nick={nick} /></Section>
      <Section
        title="Portfolio delivery"
        subtitle={`${p.delivery.onTime} of ${p.delivery.scored} scored projects on time (within ${p.delivery.tolerance} days of baseline); ${p.delivery.slipping} slipping past tolerance${p.delivery.medianSlip != null ? `; median slip ${p.delivery.medianSlip} days` : ''}.`}
        data-pack-section
      >
        {p.delivery.delays.length ? (
          <Scroll>
            <Table size="small">
              <TableHead><TableRow><TableCell>Project</TableCell><TableCell>PIC</TableCell><TableCell>Baseline</TableCell><TableCell>Forecast / actual</TableCell><TableCell align="right">Slip</TableCell><TableCell>Recovery / blocker</TableCell></TableRow></TableHead>
              <TableBody>
                {p.delivery.delays.map((d) => (
                  <TableRow key={d.key} data-delay={d.key}>
                    <TableCell><b>{d.key}</b> <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{d.name}</Typography></TableCell>
                    <TableCell>{nick(d.pic)}</TableCell>
                    <TableCell>{day(d.baseline)}</TableCell>
                    <TableCell>{day(d.actual || d.forecast)}{d.done ? ' (done)' : ''}</TableCell>
                    <TableCell align="right" sx={{ color: TONE.bad }}>+{d.slip} d</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>
                      {d.recovery.length ? d.recovery.join('; ') : d.blocker ? `Blocked: ${d.blocker}` : <span style={{ color: TONE.warn }}>No recovery action recorded</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Scroll>
        ) : <Empty>No project has slipped against its baseline.</Empty>}
        {p.delivery.repeatReplans.length > 0 && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            <b>Replanned twice or more:</b> {p.delivery.repeatReplans.map((r) => `${r.key} (${r.replans})`).join(', ')}.
          </Typography>
        )}
      </Section>
      <Section title="Budget, actual spend, EAC and ROI" subtitle={`ROI over a ${f.horizon}-month benefit horizon. ${f.coverage.budgeted} of ${f.coverage.projects} projects have an approved budget.`} data-pack-section data-pack-break>
        <FinanceTotals t={f.totals} sym={sym} horizon={f.horizon} gate={f.gate} />
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, mt: 2 }}>
          <MoneyList
            title="Over budget"
            rows={f.overBudget}
            empty="No project is over its approved budget."
            render={(r) => (
              <TableRow key={r.key}><TableCell><b>{r.key}</b> {r.name}</TableCell><TableCell align="right">{money(r.eac, sym)} vs {money(r.budget, sym)}</TableCell><TableCell align="right" sx={{ color: TONE.bad }}>{signedMoney(r.variance, sym)}</TableCell></TableRow>
            )}
          />
          <MoneyList
            title={`Below the return gate (${pctOf(f.gate)})`}
            rows={f.belowGate}
            empty="Every costed project clears the return gate."
            render={(r) => (
              <TableRow key={r.key}><TableCell><b>{r.key}</b> {r.name}</TableCell><TableCell align="right" sx={{ color: TONE.warn }}>{pctOf(r.projectedRoi)}</TableCell></TableRow>
            )}
          />
        </Box>
      </Section>
      <Section title="Validated benefits and capacity constraints" data-pack-section>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Benefits by stage</Typography>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
              {Object.entries(BENEFIT_STATE_LABEL).map(([k, label]) => <Pill key={k} label={`${label}: ${p.benefits.byState[k] || 0}`} tone={k === 'validated' || k === 'realized' ? 'good' : 'neutral'} />)}
            </Box>
            {p.benefits.validated.length ? (
              <Typography variant="body2">
                <b>Validated:</b> {p.benefits.validated.map((v) => `${v.key} ${money(v.validatedBenefit, sym)}`).join(', ')} — {money(p.benefits.validatedTotal, sym)} in all.
              </Typography>
            ) : <Empty>No benefit has been validated after go-live yet.</Empty>}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Capacity, next 12 weeks</Typography>
            {p.capacity.over.length
              ? p.capacity.over.map((x) => <Typography key={x.id} variant="body2"><Pill label="Over capacity" tone="bad" /> {x.nick}: peak {pct(x.peak)} of their project hours, {x.remaining} h left on {x.projects} projects</Typography>)
              : <Empty>Nobody is over capacity in the next 12 weeks.</Empty>}
            {p.capacity.high.length > 0 && <Typography variant="body2" sx={{ mt: 0.5 }}>Near the limit: {p.capacity.high.map((x) => `${x.nick} (${pct(x.peak)})`).join(', ')}.</Typography>}
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
              {p.capacity.totals.blockedDays} blocked days reported in the weekly check-in.
            </Typography>
          </Box>
        </Box>
      </Section>
      <Section title="Management decisions required" data-pack-section data-pack-break><Decisions rows={p.decisions} sym={sym} /></Section>
      <Section title="Management watchlist" data-pack-section><Watchlist rows={p.watchlist} nick={nick} /></Section>
      <Section title="Data confidence and limitations" data-pack-section>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Reporting confidence <b>{pct(p.confidence.score)}</b> — {p.confidence.verdict}.
        </Typography>
        {p.confidence.sources.map((g) => <Typography key={g.id} variant="body2"><b>{g.label}.</b> {g.text}</Typography>)}
        {p.confidence.failing.length > 0 && (
          <Typography variant="body2" sx={{ mt: 0.75 }}>
            <b>Data gaps:</b> {p.confidence.failing.map((c) => `${c.label} (${c.count})`).join(', ')}.
          </Typography>
        )}
      </Section>
    </>
  )
}

export default function Pack({ plan, lastSaved }) {
  const { gov, error } = useGov()
  const [jira, setJira] = useState(null)
  const [raid, setRaid] = useState(null)
  const [list, setList] = useState(null)
  const [compareId, setCompareId] = useState(null)
  const [previous, setPrevious] = useState(null)
  const [mode, setMode] = useState('full')
  const [period, setPeriod] = useState(() => {
    const w = weekOf()
    return `Week ${weekNo(w)}, ${w.slice(0, 4)}`
  })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const [defsOpen, setDefsOpen] = useState(false)

  const loadList = useCallback(async () => {
    const r = await api.snapshotList('pack').catch(() => ({ snapshots: [] }))
    setList(r.snapshots || [])
    return r.snapshots || []
  }, [])
  useEffect(() => {
    let live = true
    api.jiraLastRun().then((r) => { if (live) setJira(r) }).catch(() => {})
    api.raidList().then((r) => { if (live) setRaid(r) }).catch(() => { if (live) setRaid({ items: [], weekly: [] }) })
    loadList().then((s) => { if (live && s.length) setCompareId(s[0].id) })
    return () => { live = false }
  }, [loadList])
  useEffect(() => {
    let live = true
    if (!compareId) { setPrevious(null); return undefined }
    api.snapshotGet(compareId).then((r) => { if (live) setPrevious(r.snapshot?.data || null) }).catch(() => { if (live) setPrevious(null) })
    return () => { live = false }
  }, [compareId])

  const quality = useMemo(() => (gov ? dataQuality(plan, { jira, gov }) : null), [plan, jira, gov])
  const pack = useMemo(() => (gov && quality && raid ? packOf(plan, gov, {
    quality, raid, previous, period, refreshed: { plan: lastSaved || null, jira: jira?.at || null, worklogs: gov.worklogs?.at || null },
  }) : null), [plan, gov, quality, raid, previous, period, lastSaved, jira])

  const nick = useMemo(() => {
    const m = Object.fromEntries((plan.people || []).map((p) => [p.id, p.nick || p.name || p.id]))
    return (id) => (id ? m[id] || id : '—')
  }, [plan.people])

  if (error) return <Alert severity="error">{error}</Alert>
  if (!pack) return <Loading variant="block" label="Putting the pack together…" />
  const sym = plan.finance?.symbol || '฿'

  const issue = async () => {
    setBusy(true)
    setNote(null)
    try {
      await api.snapshotSave('pack', { label: `Management Pack — ${period}`, period, data: pack })
      await loadList()
      setNote({ tone: 'success', text: `Issued "${period}". It is kept as it stands now; the next pack can be compared with it.` })
    } catch (e) {
      setNote({ tone: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  const m = pack.meta
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="pack">
      {PRINT}
      <Box data-no-print sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        <PageHead title="Management Pack">
          The report a steering meeting runs from, built from the same figures as every other page. Issue it to keep it as
          it stands; the next pack reports only what changed materially since. Print it, or save it as PDF.
        </PageHead>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField size="small" label="Reporting period" value={period} onChange={(e) => setPeriod(e.target.value)} sx={{ width: 200 }} inputProps={{ 'data-pack-period': true }} />
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_e, v) => v && setMode(v)} aria-label="which pack">
            <ToggleButton value="full" data-pack-mode="full">Full pack</ToggleButton>
            <ToggleButton value="board" data-pack-mode="board">Board summary</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            select
            size="small"
            label="Compare with"
            value={compareId || ''}
            onChange={(e) => setCompareId(e.target.value || null)}
            sx={{ minWidth: 240 }}
            disabled={!list?.length}
            data-pack-compare
          >
            <MenuItem value="">Nothing (first pack)</MenuItem>
            {(list || []).map((s) => <MenuItem key={s.id} value={s.id}>{s.period || s.label} · issued {stamp(s.at)}</MenuItem>)}
          </TextField>
          <Box sx={{ flex: 1 }} />
          <Button variant="outlined" startIcon={busy ? <CircularProgress size={14} /> : <SendIcon />} onClick={issue} disabled={busy} data-pack-issue>Issue this pack</Button>
          <Button variant="contained" startIcon={<PrintIcon />} onClick={() => window.print()} data-pack-print>Print / save as PDF</Button>
        </Box>
        {note && <Alert severity={note.tone} variant="outlined" onClose={() => setNote(null)}>{note.text}</Alert>}
      </Box>

      <Box data-pack={mode} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box data-pack-section>
          <Typography variant="overline" sx={{ color: TONE.blue, letterSpacing: 1 }}>F&amp;A Tech · {mode === 'board' ? 'Board summary' : 'Management Pack'}</Typography>
          <Typography variant="h2" sx={{ mt: 0.25 }}>{m.period || 'Management Pack'}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }} data-pack-meta>
            As of {day(m.asOf)} · generated {stamp(m.generatedAt)} · plan saved {stamp(m.refreshed.plan)} · Jira synced {stamp(m.refreshed.jira)} · worklogs read {stamp(m.refreshed.worklogs)}
            {m.previous ? ` · compared with ${m.previous.period || stamp(m.previous.generatedAt)}` : ' · no previous pack'}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            Scope: {m.filters.scope} Material change: ±{Math.round(m.material.ratio * 100)} points on a share, ±{Math.round(m.material.roi * 100)} points of ROI,
            ±{Math.round(m.material.money * 100)}% and at least {money(m.material.moneyFloor, sym)} on money, a slip growing by more than {m.material.slipDays} days.
          </Typography>
        </Box>

        {mode === 'board' ? <Board b={boardSummary(pack)} sym={sym} nick={nick} /> : <Full p={pack} sym={sym} nick={nick} />}

        <Section
          title="Metric definitions"
          subtitle="What each headline figure means, what it includes, and where it comes from."
          data-pack-section
          data-pack-break
          action={<Button size="small" data-no-print onClick={() => setDefsOpen((o) => !o)}>{defsOpen ? 'Hide' : 'Show'}</Button>}
        >
          <Collapse in={defsOpen}>
            <Scroll>
              <Table size="small">
                <TableHead><TableRow><TableCell>Metric</TableCell><TableCell>Definition</TableCell><TableCell>How</TableCell><TableCell>Source</TableCell></TableRow></TableHead>
                <TableBody>
                  {m.definitions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell sx={{ fontWeight: 600, minWidth: 140 }}>{d.label}</TableCell>
                      <TableCell sx={{ minWidth: 200 }}>{d.definition}</TableCell>
                      <TableCell sx={{ minWidth: 240 }}>{d.formula}</TableCell>
                      <TableCell sx={{ minWidth: 200 }}>{d.source}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Scroll>
          </Collapse>
          {/* Printed whether or not it is open on screen: an exported pack keeps its definitions. */}
          {!defsOpen && <Box sx={{ display: 'none', '@media print': { display: 'block' } }}>
            <Scroll>
              <Table size="small">
                <TableHead><TableRow><TableCell>Metric</TableCell><TableCell>Definition</TableCell><TableCell>How</TableCell><TableCell>Source</TableCell></TableRow></TableHead>
                <TableBody>
                  {m.definitions.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell sx={{ fontWeight: 600, minWidth: 140 }}>{d.label}</TableCell>
                      <TableCell sx={{ minWidth: 200 }}>{d.definition}</TableCell>
                      <TableCell sx={{ minWidth: 240 }}>{d.formula}</TableCell>
                      <TableCell sx={{ minWidth: 200 }}>{d.source}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Scroll>
          </Box>}
        </Section>
      </Box>
    </Box>
  )
}
