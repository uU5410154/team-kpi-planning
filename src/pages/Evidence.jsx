import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Button, TextField, MenuItem, Alert, Table, TableHead, TableBody, TableRow, TableCell,
  Dialog, DialogTitle, DialogContent, DialogActions, LinearProgress, Tooltip,
} from '@mui/material'
import * as api from '../lib/api.js'
import { evidenceOf, reviewSnapshot, DIMENSIONS, fmtDim } from '../lib/evidence.js'
import { useGov } from '../components/GovConflict.jsx'
import { Section, Stat, PageHead, TONE } from '../components/GovUi.jsx'
import { Pill } from '../components/Brand.jsx'
import Loading from '../components/Loading.jsx'

/*
 * PERFORMANCE EVIDENCE (management design summary, Priority 2).
 *
 * The evidence behind a review, per member, on the brief's seven dimensions —
 * each with its source, the gap when there is no data, and the median of the
 * members who share the same role AND level. Team outcomes are shown apart
 * from anybody's own contribution. No ranking and no overall score.
 *
 * "Freeze this review period" keeps the figures exactly as they are, so a
 * review is argued from what was on the page that day.
 */

const conf = (c) => (c >= 0.7 ? TONE.good : c >= 0.4 ? TONE.warn : TONE.bad)

function PersonCard({ p }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 1.75 }, minWidth: 0 }} data-evidence-person={p.id}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="h4" sx={{ mr: 0.5 }}>{p.nick}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.groupLabel}</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Share of the seven dimensions that have data behind them">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 140 }} data-confidence-of={p.id}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Evidence</Typography>
            <LinearProgress variant="determinate" value={p.confidence * 100} sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { bgcolor: conf(p.confidence) } }} />
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{Math.round(p.confidence * 100)}%</Typography>
          </Box>
        </Tooltip>
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              <TableCell>Dimension</TableCell>
              <TableCell>Evidence</TableCell>
              <TableCell align="right">Peer median</TableCell>
              <TableCell>Source</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {DIMENSIONS.map((d) => {
              const x = p.dims[d.id]
              return (
                <TableRow key={d.id} data-dim={d.id}>
                  <TableCell sx={{ fontWeight: 600, width: 130 }}>{d.label}</TableCell>
                  <TableCell>
                    {x.value == null
                      ? <Typography variant="body2" sx={{ color: TONE.warn }}>{x.gap}</Typography>
                      : <Typography variant="body2" sx={{ fontWeight: 600 }}>{x.display}</Typography>}
                    {x.detail.map((t) => (
                      <Typography key={t.label} variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{t.display}</Typography>
                    ))}
                  </TableCell>
                  <TableCell align="right">
                    {x.peerMedian != null
                      ? <Tooltip title={`Median of ${x.peerN} members with the same role and level`}><span>{fmtDim(d.id, x.peerMedian)}</span></Tooltip>
                      : <Typography variant="caption" sx={{ color: 'text.disabled' }}>{p.group ? 'no peers with data' : 'set role and level'}</Typography>}
                  </TableCell>
                  <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{x.source}</Typography></TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </Paper>
  )
}

function FrozenView({ id, onClose }) {
  const [snap, setSnap] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let live = true
    api.snapshotGet(id).then((r) => { if (live) setSnap(r.snapshot) }).catch((e) => { if (live) setErr(e.message) })
    return () => { live = false }
  }, [id])
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth data-frozen-review>
      <DialogTitle>{snap ? `${snap.label || 'Review'} · frozen ${new Date(snap.at).toLocaleString()} by ${snap.by}` : 'Frozen review'}</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error">{err}</Alert>}
        {!snap && !err && <Loading label="Reading the frozen review…" />}
        {snap && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Member</TableCell>
                  {DIMENSIONS.map((d) => <TableCell key={d.id}>{d.label}</TableCell>)}
                  <TableCell align="right">Evidence</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(snap.data?.people || []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell sx={{ fontWeight: 600 }}>{p.nick}<Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{p.groupLabel}</Typography></TableCell>
                    {DIMENSIONS.map((d) => (
                      <TableCell key={d.id}>
                        <Typography variant="caption" sx={{ color: p.dims[d.id]?.value == null ? 'text.disabled' : 'text.primary' }}>
                          {p.dims[d.id]?.value == null ? '—' : p.dims[d.id].display}
                        </Typography>
                      </TableCell>
                    ))}
                    <TableCell align="right">{Math.round((p.confidence || 0) * 100)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Close</Button></DialogActions>
    </Dialog>
  )
}

export default function Evidence({ plan }) {
  const { gov, error } = useGov()
  const [activity, setActivity] = useState(null)
  const [actErr, setActErr] = useState(null)
  const [group, setGroup] = useState('all')
  const [frozen, setFrozen] = useState([])
  const [viewing, setViewing] = useState(null)
  const [freezing, setFreezing] = useState(false)
  const [label, setLabel] = useState('')
  const [period, setPeriod] = useState('')
  const [note, setNote] = useState(null)

  useEffect(() => {
    let live = true
    const ask = api.govActivity?.()
    if (ask) ask.then((r) => { if (live) setActivity(r?.activity || r || {}) }).catch((e) => { if (live) { setActErr(e.message); setActivity({}) } })
    else setActivity({})
    api.snapshotList('review').then((r) => { if (live) setFrozen(r.snapshots || []) }).catch(() => {})
    return () => { live = false }
  }, [])

  const ev = useMemo(() => (gov && activity ? evidenceOf(plan, gov, activity) : null), [plan, gov, activity])
  if (error) return <Alert severity="error">{error}</Alert>
  if (!ev) return <Loading variant="block" label="Gathering the evidence…" />

  const shown = ev.people.filter((p) => group === 'all' || (p.group || '__unset') === group)
  const byGroup = ev.groups.filter((g) => group === 'all' || g.key === group)
  const freeze = async () => {
    setFreezing(true)
    setNote(null)
    try {
      const r = await api.snapshotSave('review', { label: label || `Review ${ev.asOf}`, period: period || ev.asOf, data: reviewSnapshot(ev) })
      setFrozen((f) => [r.snapshot, ...f])
      setLabel('')
      setPeriod('')
      setNote({ tone: 'success', text: `Frozen as "${r.snapshot.label}". It will not change when the data does.` })
    } catch (e) {
      setNote({ tone: 'error', text: e.message })
    } finally {
      setFreezing(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="evidence">
      <PageHead title="Performance evidence">
        The evidence behind a review, on seven dimensions, each with its source and what is missing. Compared like for
        like: only with members of the same role and level, as their median. Team outcomes are shown apart from anybody&rsquo;s
        own contribution. There is no ranking and no overall score — hours and project counts alone say little about performance.
      </PageHead>

      {actErr && <Alert severity="warning" variant="outlined">The weekly check-in could not be read ({actErr}); ownership shows as a gap.</Alert>}

      <Section title="Team outcomes" subtitle="What the team delivered together — not credited to anybody in particular." data-section="team-outcomes">
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
          <Stat label="Delivery" value={ev.team.delivery.display} note={ev.team.delivery.detail[0]?.display} gap={ev.team.delivery.gap} />
          <Stat label="Forecasting" value={ev.team.forecasting.display} note={ev.team.forecasting.detail.map((x) => x.display).join(' · ')} gap={ev.team.forecasting.gap} />
          <Stat label="Validated outcome" value={ev.team.outcome.display} note={ev.team.outcome.detail.map((x) => x.display).join(' · ')} gap={ev.team.outcome.gap} />
        </Box>
      </Section>

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField select size="small" label="Compare within" value={group} onChange={(e) => setGroup(e.target.value)} sx={{ minWidth: 240 }} data-group-filter>
          <MenuItem value="all">Every role and level</MenuItem>
          {ev.groups.map((g) => <MenuItem key={g.key} value={g.key}>{g.label} ({g.members.length})</MenuItem>)}
        </TextField>
        {ev.groups.some((g) => g.key === '__unset') && (
          <Typography variant="caption" sx={{ color: TONE.warn }}>
            Members without a role and level on Costs &amp; rates have no peer group to be compared with.
          </Typography>
        )}
      </Box>

      {byGroup.map((g) => (
        <Box key={g.key} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }} data-evidence-group={g.key}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{g.label}</Typography>
          {shown.filter((p) => (p.group || '__unset') === g.key).map((p) => <PersonCard key={p.id} p={p} />)}
        </Box>
      ))}

      <Section
        title="Frozen review periods"
        subtitle="A review is argued from the evidence as it stood. Freezing keeps these figures as they are now, for good."
        data-section="frozen"
      >
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1.5 }}>
          <TextField size="small" label="Name" placeholder="e.g. H2 2026 review" value={label} onChange={(e) => setLabel(e.target.value)} sx={{ minWidth: 220 }} />
          <TextField size="small" label="Period" placeholder="e.g. Jul–Dec 2026" value={period} onChange={(e) => setPeriod(e.target.value)} sx={{ minWidth: 180 }} />
          <Button variant="contained" onClick={freeze} disabled={freezing} data-freeze-review>{freezing ? 'Freezing…' : 'Freeze this review period'}</Button>
        </Box>
        {note && <Alert severity={note.tone} sx={{ mb: 1 }} onClose={() => setNote(null)}>{note.text}</Alert>}
        {frozen.length ? (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Period</TableCell><TableCell>Frozen</TableCell><TableCell>By</TableCell><TableCell /></TableRow></TableHead>
              <TableBody>
                {frozen.map((f) => (
                  <TableRow key={f.id} data-frozen={f.id}>
                    <TableCell>{f.label}</TableCell>
                    <TableCell>{f.period}</TableCell>
                    <TableCell>{new Date(f.at).toLocaleString()}</TableCell>
                    <TableCell>{f.by}</TableCell>
                    <TableCell><Button size="small" onClick={() => setViewing(f.id)}>View</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing frozen yet.</Typography>
        )}
      </Section>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Pill label="Quality has no source yet" tone="warn" />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Defects, rework and support incidents are not read from Jira yet, so quality is always a gap rather than a guess.
        </Typography>
      </Box>
      {viewing && <FrozenView id={viewing} onClose={() => setViewing(null)} />}
    </Box>
  )
}
