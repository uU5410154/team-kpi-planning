import { useMemo, useState } from 'react'
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Alert, Link, TextField, MenuItem, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import { inBook } from '../lib/governance.js'
import { BENEFIT_STATES, BENEFIT_STATE_LABEL, VALIDATED } from '../lib/costs.js'
import { useGov } from '../components/GovConflict.jsx'
import {
  Section, Stat, PageHead, money, TONE,
} from '../components/GovUi.jsx'
import { Pill } from '../components/Brand.jsx'
import Loading from '../components/Loading.jsx'

/*
 * BENEFIT VALIDATION (management design summary, Priority 2).
 *
 * A benefit moves through five states — estimated, business case approved,
 * implementation confirmed, post-stabilisation validated, realised — and
 * carries the evidence each needs: the baseline process, expected and actual
 * saving hours, who owns the benefit and who validated it, when, when it
 * starts, its recurring operating cost and the confidence in it.
 *
 * Only a validated or realised benefit counts in the validated actual ROI.
 * Soft benefits stay visible but are not turned into money without an
 * approved method. Saved hours are capacity released, not a cash saving.
 */

const STATE_TONE = { estimated: 'neutral', approved: 'violet', implemented: 'violet', validated: 'good', realized: 'good' }

/** What a state needs before a benefit may be put in it. */
export function benefitProblems(b) {
  const out = []
  if (['approved', 'implemented', 'validated', 'realized'].includes(b.state) && !b.owner) out.push('Name the benefit owner.')
  if (['approved', 'implemented', 'validated', 'realized'].includes(b.state) && b.expectedHours == null && b.monetary == null) out.push('Give the expected saving hours (or a monetary benefit).')
  if (['approved', 'implemented', 'validated', 'realized'].includes(b.state) && !b.baselineProcess) out.push('Describe the baseline process the saving is measured against.')
  if (VALIDATED.has(b.state)) {
    if (b.actualHours == null && b.monetary == null) out.push('Give the actual saving hours measured after go-live.')
    if (!b.validator) out.push('Name who validated it.')
    if (!b.validatedAt) out.push('Give the validation date.')
    if (b.validator && b.owner && b.validator.trim().toLowerCase() === b.owner.trim().toLowerCase()) out.push('The validator must be somebody other than the benefit owner.')
  }
  if (b.state === 'realized' && !b.startDate) out.push('Give the date the benefit started.')
  return out
}

function BenefitDialog({ project, rec, onClose, save, defaults }) {
  const start = { ...(rec?.benefit || {}), expectedHours: rec?.benefit?.expectedHours ?? defaults.expectedHours ?? null }
  const [b, setB] = useState(start)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const set = (patch) => setB((x) => ({ ...x, ...patch }))
  const n = (v) => (v === '' ? null : Number(String(v).replace(/[,\s]/g, '')))
  const problems = benefitProblems(b)
  const submit = async () => {
    setTried(true)
    if (problems.length) return
    setBusy(true)
    const before = rec?.benefit || {}
    const changes = Object.keys(b)
      .filter((k) => JSON.stringify(b[k] ?? null) !== JSON.stringify(before[k] ?? null))
      .map((k) => ({ path: `benefit.${k}`, from: before[k] ?? null, to: b[k] ?? null }))
    const ok = changes.length ? await save(`project:${project.key}`, changes) : true
    setBusy(false)
    if (ok) onClose()
  }
  const tf = (k, label, props = {}) => (
    <TextField size="small" label={label} value={b[k] ?? ''} onChange={(e) => set({ [k]: props.num ? n(e.target.value) : e.target.value })} {...props.field} />
  )
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-benefit-dialog={project.key}>
      <DialogTitle>{project.key} · {project.summary} — benefit</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '12px !important' }}>
        <ToggleButtonGroup exclusive size="small" value={b.state || 'estimated'} onChange={(_e, v) => v && set({ state: v })} sx={{ flexWrap: 'wrap' }}>
          {BENEFIT_STATES.map((s) => <ToggleButton key={s} value={s} data-state={s} sx={{ textTransform: 'none' }}>{BENEFIT_STATE_LABEL[s]}</ToggleButton>)}
        </ToggleButtonGroup>
        <TextField size="small" label="Baseline process — how it is done today, and how long it takes" value={b.baselineProcess || ''} onChange={(e) => set({ baselineProcess: e.target.value })} multiline minRows={2} />
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' } }}>
          {tf('expectedHours', 'Expected saving, hours / month', { num: true, field: { helperText: defaults.expectedHours != null ? `Register estimate: ${defaults.expectedHours} h` : undefined } })}
          {tf('actualHours', 'Actual saving, hours / month', { num: true, field: { helperText: 'Measured after go-live' } })}
          {tf('monetary', 'Monetary benefit, ฿ / year', { num: true })}
          {tf('owner', 'Benefit owner')}
          {tf('validator', 'Validated by')}
          <TextField size="small" type="date" label="Validated on" InputLabelProps={{ shrink: true }} value={b.validatedAt || ''} onChange={(e) => set({ validatedAt: e.target.value || null })} />
          <TextField size="small" type="date" label="Benefit starts" InputLabelProps={{ shrink: true }} value={b.startDate || ''} onChange={(e) => set({ startDate: e.target.value || null })} />
          {tf('recurringCost', 'Recurring operating cost, ฿ / month', { num: true })}
          <TextField select size="small" label="Confidence" value={b.confidence || ''} onChange={(e) => set({ confidence: e.target.value || null })}>
            <MenuItem value="">Not stated</MenuItem><MenuItem value="low">Low</MenuItem><MenuItem value="medium">Medium</MenuItem><MenuItem value="high">High</MenuItem>
          </TextField>
        </Box>
        <TextField size="small" label="Evidence — what the validation rests on (reports, measurements, links)" value={b.evidence || ''} onChange={(e) => set({ evidence: e.target.value })} multiline minRows={2} />
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
          <TextField size="small" label="Soft benefits (not monetised)" value={b.soft || ''} onChange={(e) => set({ soft: e.target.value })} multiline minRows={2} />
          <TextField size="small" label="Approved method for valuing them, if any" value={b.softMethod || ''} onChange={(e) => set({ softMethod: e.target.value })} multiline minRows={2} />
        </Box>
        {tried && problems.length > 0 && (
          <Alert severity="warning" data-benefit-problems>
            {BENEFIT_STATE_LABEL[b.state]} needs: {problems.join(' ')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy} data-save-benefit>{busy ? 'Saving…' : 'Save'}</Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Benefits({ plan, onOpenProject }) {
  const { gov, error, save, dialog } = useGov()
  const [open, setOpen] = useState(null)
  const [show, setShow] = useState('all')
  const fin = plan.finance || {}
  const H = fin.horizonMonths || 12
  const rate = fin.acctHourRate || 0
  const hpm = fin.hoursPerFteMonth || 176
  const sym = fin.symbol || '฿'
  const rows = useMemo(() => {
    if (!gov) return []
    return (plan.projects || []).filter(inBook)
      .filter((p) => p.savingHours != null || gov.projects[p.key]?.benefit)
      .map((p) => {
        const b = gov.projects[p.key]?.benefit || {}
        const state = b.state || 'estimated'
        return { p, b, state, expected: b.expectedHours ?? null, register: p.savingHours ?? null, problems: benefitProblems({ ...b, state }) }
      })
  }, [plan.projects, gov])
  if (error) return <Alert severity="error">{error}</Alert>
  if (!gov) return <Loading variant="block" label="Reading the benefit records…" />
  const by = Object.fromEntries(BENEFIT_STATES.map((s) => [s, rows.filter((r) => r.state === s)]))
  const hoursOf = (r, which) => (which === 'actual' ? r.b.actualHours : r.b.expectedHours ?? r.register) || 0
  const estHours = rows.reduce((a, r) => a + hoursOf(r, 'expected'), 0)
  const apprHours = rows.filter((r) => r.state !== 'estimated').reduce((a, r) => a + hoursOf(r, 'expected'), 0)
  const valRows = rows.filter((r) => VALIDATED.has(r.state))
  const valHours = valRows.reduce((a, r) => a + hoursOf(r, 'actual'), 0)
  const list = rows.filter((r) => show === 'all' || (show === 'incomplete' ? r.problems.length > 0 : r.state === show))
    .sort((a, b) => BENEFIT_STATES.indexOf(b.state) - BENEFIT_STATES.indexOf(a.state) || (b.register || 0) - (a.register || 0))
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="benefits">
      <PageHead title="Benefits">
        Every benefit moves through five states, from an estimate to a realised saving, with the evidence each state needs.
        Only a validated or realised benefit counts in the validated actual ROI. Saved hours are capacity released, not a
        cash saving; soft benefits stay visible but are not turned into money without an approved method.
      </PageHead>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(5, 1fr)' } }}>
        {BENEFIT_STATES.map((s) => (
          <Stat key={s} label={BENEFIT_STATE_LABEL[s]} value={by[s].length} note={`${Math.round(by[s].reduce((a, r) => a + hoursOf(r, VALIDATED.has(s) ? 'actual' : 'expected'), 0)).toLocaleString()} h / month`} data-benefit-count={s} />
        ))}
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
        <Stat label="Estimated" value={`${Math.round(estHours).toLocaleString()} h / mo`} note={`≈ ${money(estHours * rate * H, sym)} over ${H} months, at the accountant rate`} help="Every benefit, at its expected (or register) hours. An estimate, not value released." />
        <Stat label="Approved or later" value={`${Math.round(apprHours).toLocaleString()} h / mo`} note={`≈ ${money(apprHours * rate * H, sym)} over ${H} months`} />
        <Stat label="Validated" value={`${Math.round(valHours).toLocaleString()} h / mo`} tone={valHours ? TONE.good : undefined} note={`${(valHours / hpm).toFixed(1)} FTE of capacity released · ${money(valHours * rate * H, sym)} over ${H} months`} data-stat="validated" />
      </Box>
      <Section
        title="Projects"
        subtitle="Open one to move its benefit on, with the evidence the next state needs."
        action={(
          <ToggleButtonGroup size="small" exclusive value={show} onChange={(_e, v) => v && setShow(v)} sx={{ flexWrap: 'wrap' }}>
            <ToggleButton value="all">All ({rows.length})</ToggleButton>
            <ToggleButton value="incomplete">Missing evidence ({rows.filter((r) => r.problems.length).length})</ToggleButton>
            {BENEFIT_STATES.map((s) => <ToggleButton key={s} value={s} sx={{ textTransform: 'none' }}>{BENEFIT_STATE_LABEL[s].split(' ')[0]}</ToggleButton>)}
          </ToggleButtonGroup>
        )}
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Project</TableCell><TableCell>State</TableCell><TableCell align="right">Register hours</TableCell>
                <TableCell align="right">Expected h / mo</TableCell><TableCell align="right">Actual h / mo</TableCell>
                <TableCell>Owner</TableCell><TableCell>Validated by</TableCell><TableCell>Confidence</TableCell><TableCell>Soft</TableCell><TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.p.key} hover data-benefit-row={r.p.key}>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Link component="button" onClick={() => onOpenProject?.(r.p.key)} sx={{ fontWeight: 600, textAlign: 'left' }}>{r.p.key}</Link>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{r.p.summary}</Typography>
                  </TableCell>
                  <TableCell><Pill label={BENEFIT_STATE_LABEL[r.state]} tone={STATE_TONE[r.state]} /></TableCell>
                  <TableCell align="right">{r.register ?? '—'}</TableCell>
                  <TableCell align="right">{r.b.expectedHours ?? '—'}</TableCell>
                  <TableCell align="right" sx={{ color: VALIDATED.has(r.state) ? TONE.good : undefined, fontWeight: VALIDATED.has(r.state) ? 700 : 400 }}>{r.b.actualHours ?? '—'}</TableCell>
                  <TableCell>{r.b.owner || '—'}</TableCell>
                  <TableCell>{r.b.validator ? `${r.b.validator}${r.b.validatedAt ? ` · ${r.b.validatedAt}` : ''}` : '—'}</TableCell>
                  <TableCell>{r.b.confidence || '—'}</TableCell>
                  <TableCell sx={{ maxWidth: 200 }}><Typography variant="caption" sx={{ color: 'text.secondary' }}>{r.b.soft || (r.p.softBenefits?.length ? `${r.p.softBenefits.length} in register` : '—')}</Typography></TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => setOpen(r.p)} data-open-benefit={r.p.key}>{r.problems.length ? 'Complete' : 'Open'}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Section>
      {open && (
        <BenefitDialog
          project={open}
          rec={gov.projects[open.key]}
          defaults={{ expectedHours: open.savingHours ?? null }}
          save={save}
          onClose={() => setOpen(null)}
        />
      )}
      {dialog}
    </Box>
  )
}
