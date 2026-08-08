import { useState } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Grid, Chip, Tabs, Tab, Alert, Tooltip, TextField, InputAdornment, Button, IconButton,
  Select, MenuItem,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SyncIcon from '@mui/icons-material/Sync'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'
import UndoIcon from '@mui/icons-material/Undo'
import StatTile from '../components/StatTile.jsx'
import { OBJ_BY_ID, OBJECTIVES, CHART, STATUS, COMMIT_LEVELS, OUT_OF_PLAN } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtMoney, fmtMoneyShort, fmtRoi, targetUnit,
  weightSum, weightsValid, snapWeight, WEIGHT_STEP,
} from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

const COMMIT_LABEL = Object.fromEntries(COMMIT_LEVELS.map((c) => [c.id, c.label]))
const BAND_LABEL = { lead: 'Team Lead', senior: 'Senior', analyst: 'Analyst' }

/** Whole-percent input that commits on blur. Stored as a 0–1 fraction. */
function PctCell({ value, onChange, invalid }) {
  const asPct = (v) => (v == null ? '' : String(Math.round(v * 100)))
  const [draft, setDraft] = useState(asPct(value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== asPct(value)) setDraft(asPct(value))
  return (
    <TextField
      size="small"
      variant="outlined"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        // Snapped to the 5-point grid, so a card never reads 8% or 26.5%.
        const raw = Number(draft.replace(/[%\s,]/g, ''))
        const n = Number.isFinite(raw) ? snapWeight(raw) : NaN
        if (Number.isFinite(n)) {
          if (Math.abs(n / 100 - value) > 1e-9) onChange(n / 100)
          else setDraft(asPct(value))
        } else setDraft(asPct(value))
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      InputProps={{ endAdornment: <InputAdornment position="end" sx={{ ml: 0 }}>%</InputAdornment> }}
      inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, padding: '6px 4px 6px 8px' } }}
      error={invalid}
      sx={{ width: 92 }}
    />
  )
}

/** Numeric target with a fixed unit suffix. */
function HoursTargetCell({ value, onChange, unit }) {
  const asStr = (v) => (v == null ? '' : String(v))
  const [draft, setDraft] = useState(asStr(value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== asStr(value)) setDraft(asStr(value))
  return (
    <TextField
      size="small"
      variant="outlined"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const n = Number(String(draft).replace(/[,\s]/g, ''))
        // Only report a genuine change. Blurring a field you merely tabbed
        // through must not pin the target and stop it tracking the projects.
        if (Number.isFinite(n) && n >= 0) { if (n !== value) onChange(n) }
        else setDraft(asStr(value))
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end" sx={{ ml: 0.25 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{unit}</Typography>
          </InputAdornment>
        ),
      }}
      inputProps={{
        style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.8125rem', padding: '6px 2px 6px 8px' },
      }}
      sx={{ width: 158 }}
    />
  )
}

/** Free-text target, for milestones and qualitative lines. */
function TargetCell({ value, onChange, placeholder }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== (value ?? '')) setDraft(value ?? '')
  return (
    <TextField
      size="small"
      variant="outlined"
      fullWidth
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        if (draft.trim() !== (value ?? '')) onChange(draft.trim())
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputProps={{ style: { fontSize: '0.8125rem', padding: '6px 8px' } }}
    />
  )
}

/** Editable saving-hours cell inside the portfolio. */
function PortfolioNum({ value, onChange }) {
  const asStr = (v) => (v == null ? '' : String(v))
  const [draft, setDraft] = useState(asStr(value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== asStr(value)) setDraft(asStr(value))
  return (
    <TextField
      size="small"
      variant="standard"
      value={draft}
      placeholder="TBC"
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const t = draft.trim()
        if (t === '') { if (value != null) onChange(null); return }
        const n = Number(t.replace(/,/g, ''))
        if (Number.isFinite(n) && n >= 0) { if (n !== value) onChange(n) }
        else setDraft(asStr(value))
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' } }}
      sx={{ width: 68 }}
    />
  )
}

export default function People({
  plan, onPersonKpi, onResetKpi, onRemoveLine, onRestoreLine, onRebalance, onSyncTargets, onUpdate,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { people, settings, totals, finance: fin } = plan
  const sym = fin.symbol
  const [who, setWho] = useState(people[0]?.id)
  // Which KPI line is currently filtering the portfolio, by objective id.
  const [focus, setFocus] = useState(null)
  const p = people.find((x) => x.id === who) || people[0]
  if (!p) return null

  const focusObj = focus ? OBJ_BY_ID[focus] : null
  const visibleRows = focus ? p.scorecardRows.filter((r) => r.p.objective === focus) : p.scorecardRows

  const sum = weightSum(p.kpiLines)
  const weightOk = weightsValid(p.kpiLines)
  const shareOfTeam = totals.totalHours > 0 ? p.hours / totals.totalHours : 0
  const edited = p.kpiLines.some((l) => l.overridden) || (p.kpiHiddenLines || []).length > 0
  const drifted = p.kpiLines.filter((l) => l.drifted)
  const removed = p.kpiHiddenLines || []
  const unit = settings.savingBasis === 'monthly' ? 'hrs/month' : 'hrs/year'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Paper variant="outlined">
        <Tabs
          value={who}
          onChange={(_e, v) => setWho(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 56 } }}
        >
          {people.map((x) => (
            <Tab
              key={x.id}
              value={x.id}
              label={
                <Box sx={{ textAlign: 'left' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {x.nick}{x.aggregatesTeam && ' · team'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {fmtHours(x.scorecardHours)} hrs · {x.aggregatesTeam ? x.scorecardCount : x.countedCount} proj
                  </Typography>
                </Box>
              }
            />
          ))}
        </Tabs>
      </Paper>

      <Box>
        <Typography variant="h2">{p.name}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {p.nick} · {BAND_LABEL[p.band]} · holds{' '}
          {p.objectives.length
            ? p.objectives.map((o) => `Objective ${OBJ_BY_ID[o]?.no}`).join(', ')
            : 'no objectives yet'}
        </Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <StatTile
            label={p.aggregatesTeam ? 'Team saving hours' : 'Credited saving hours'}
            value={fmtHours(p.scorecardHours)}
            unit="hrs"
            context={
              p.aggregatesTeam
                ? `Whole team · ${fmtHours(p.ownHours)} hrs from ${p.nick}'s own projects, IT and unassigned`
                : `${fmtPct(shareOfTeam)} of the team commitment`
            }
            help={
              p.aggregatesTeam
                ? "As team lead, this scorecard carries the team's overall KPI: every member's credited hours added together, including the projects assigned to them, the ones owned by IT, and the unassigned ones. It is the sum of the other scorecards, so the two can never disagree. Projects set to Next year are excluded."
                : "Project hours multiplied by this person's contribution share. Shares on a project always sum to 100%, so no hour is credited twice."
            }
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Value released"
            value={fmtMoneyShort(p.finance.annualBenefit, sym)}
            unit="per year"
            tone={p.finance.roi == null ? undefined : p.finance.roi >= fin.roiGate ? 'good' : 'critical'}
            context={
              p.finance.roi == null
                ? `${p.finance.fteReleased.toFixed(1)} FTE · no effort estimated yet, so no return`
                : `ROI ${fmtRoi(p.finance.roi)} on ${fmtMoneyShort(p.finance.buildCost, sym)} to build · gate ${fmtRoi(fin.roiGate)}`
            }
            help={`Objective 1. ${fmtHours(p.scorecardHours)} saving hrs/month at ${fmtMoney(fin.acctHourRate, sym)} an hour, annualised. The return underneath compares that against ${fmtHours(p.scorecardManday)} credited mandays at ${fmtMoney(fin.devDayRate, sym)} each, over ${fin.horizonMonths} months, counting only the projects that carry an effort estimate.`}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Projects"
            value={p.aggregatesTeam ? p.scorecardCount : p.countedCount}
            unit={p.aggregatesTeam ? 'team-wide' : `of ${p.projectCount}`}
            context={
              p.aggregatesTeam
                ? `Every in-plan project · ${p.ownCount} of them ${p.nick}'s own`
                : 'Counted (commit + stretch) of all projects they touch'
            }
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Missing saving hours"
            value={p.missingSaving}
            unit="projects"
            tone={p.missingSaving > 5 ? 'critical' : p.missingSaving > 0 ? 'warning' : 'good'}
            context={p.missingSaving ? 'Cannot be committed until quantified' : 'Fully quantified'}
          />
        </Grid>
      </Grid>

      {p.hours === 0 && (
        <Alert severity="warning" variant="outlined">
          {p.nick} carries no quantified saving hours. A saving-hours KPI would be meaningless here — transfer
          quantified work to them on the Projects tab, or set their targets by hand below.
        </Alert>
      )}

      <Grid container spacing={2.5}>
        {/* ---------- weight table ---------- */}
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Box sx={{ px: 2.5, py: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography variant="h4">2026 KPI scorecard</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {p.aggregatesTeam
                      ? "Team-wide targets — as lead, this card carries the team's overall KPI. Edit any weight or target directly."
                      : `${p.nick}'s own targets — not the team's. Edit any weight or target directly.`}
                  </Typography>
                </Box>
                <Chip
                  icon={weightOk ? <CheckCircleIcon /> : <WarningAmberIcon />}
                  color={weightOk ? 'success' : 'error'}
                  variant={weightOk ? 'outlined' : 'filled'}
                  label={`Weights ${fmtPct(sum)}`}
                  sx={{ fontWeight: 700 }}
                />
              </Box>
            </Box>

            {!weightOk && (
              <Alert
                severity="error"
                square
                sx={{ borderRadius: 0 }}
                action={
                  <Button color="inherit" size="small" onClick={() => onRebalance(p.id)}>
                    Rebalance to 100%
                  </Button>
                }
              >
                Weights total <strong>{fmtPct(sum)}</strong>, not 100%. Saving is blocked until this is exactly 100% —
                adjust by <strong>{sum > 1 ? '−' : '+'}{fmtPct(Math.abs(1 - sum))}</strong>.
              </Alert>
            )}

            {drifted.length > 0 && (
              <Alert
                severity="warning"
                square
                sx={{ borderRadius: 0 }}
                icon={<SyncProblemIcon fontSize="inherit" />}
                action={
                  <Button color="inherit" size="small" startIcon={<SyncIcon />} onClick={() => onSyncTargets(p.id)}>
                    Sync all
                  </Button>
                }
              >
                {drifted.length} target{drifted.length === 1 ? '' : 's'} no longer match what {p.nick} actually carries
                — project assignments have changed since these were typed.
              </Alert>
            )}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 96 }}>Block</TableCell>
                  <TableCell>KPI line</TableCell>
                  <TableCell sx={{ minWidth: 190 }}>Target</TableCell>
                  <TableCell align="right" sx={{ width: 110 }}>Weight</TableCell>
                  <TableCell padding="checkbox" />
                </TableRow>
              </TableHead>
              <TableBody>
                {p.kpiLines.map((l) => {
                  const o = l.objective ? OBJ_BY_ID[l.objective] : null
                  const idx = o ? OBJECTIVES.findIndex((x) => x.id === o.id) : -1
                  const selectable = !!l.objective
                  const active = selectable && focus === l.objective
                  return (
                    <TableRow
                      key={l.id}
                      hover
                      selected={active}
                      onClick={selectable ? () => setFocus(active ? null : l.objective) : undefined}
                      sx={{ cursor: selectable ? 'pointer' : 'default' }}
                    >
                      <TableCell sx={{ verticalAlign: 'top', pt: 1.75 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.03em' }}>
                          {l.block}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top', pt: 1.5 }}>
                        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                          {idx >= 0 && (
                            <Box sx={{ width: 8, height: 8, borderRadius: '2px', mt: 0.7, bgcolor: CHART[mode].series[idx], flexShrink: 0 }} />
                          )}
                          <Box>
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 600, lineHeight: 1.35, textDecoration: active ? 'underline' : 'none' }}
                            >
                              {o ? `Obj ${o.no} — ${o.name}` : l.label}
                            </Typography>
                            {selectable && (
                              <Typography variant="caption" sx={{ color: active ? 'primary.main' : 'text.disabled' }}>
                                {active ? 'filtering the portfolio — click to clear' : 'click to filter the portfolio'}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      {/* the row toggles the portfolio filter, so the editable
                          cells must not pass their clicks up to it */}
                      <TableCell sx={{ verticalAlign: 'top', pt: 1.25 }} onClick={(e) => e.stopPropagation()}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {l.targetKind === 'hours' || l.targetKind === 'thb' ? (
                            <HoursTargetCell
                              value={l.target}
                              unit={targetUnit(l, settings.savingBasis, sym)}
                              onChange={(v) => onPersonKpi(p.id, l.id, { target: v })}
                            />
                          ) : (
                            <TargetCell
                              value={l.target}
                              placeholder={l.defaultTarget}
                              onChange={(v) => onPersonKpi(p.id, l.id, { target: v })}
                            />
                          )}
                          {l.drifted && (
                            <Tooltip title={
                              l.targetKind === 'thb'
                                ? `Currently carrying ${fmtMoney(l.creditedMoney, sym)} a year — click to snap the target back to it`
                                : `Currently carrying ${fmtHours(l.creditedHours)} ${unit} — click to snap the target back to it`
                            }>
                              <IconButton size="small" onClick={() => onPersonKpi(p.id, l.id, { target: null })}>
                                <SyncIcon sx={{ fontSize: 16, color: STATUS.warning }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ verticalAlign: 'top', pt: 1.25 }} onClick={(e) => e.stopPropagation()}>
                        <PctCell
                          value={l.weight}
                          invalid={!weightOk}
                          onChange={(v) => onPersonKpi(p.id, l.id, { weight: v })}
                        />
                      </TableCell>
                      <TableCell padding="checkbox" sx={{ verticalAlign: 'top', pt: 1.75 }} onClick={(e) => e.stopPropagation()}>
                        <Tooltip title={p.kpiLines.length > 1
                          ? 'Remove this line from the scorecard'
                          : 'A scorecard must keep at least one KPI line'}>
                          <span>
                            <IconButton
                              size="small"
                              disabled={p.kpiLines.length <= 1}
                              onClick={() => onRemoveLine(p.id, l.id)}
                            >
                              <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
                <TableRow>
                  <TableCell colSpan={2} sx={{ borderTop: 2, borderColor: 'divider' }} />
                  <TableCell align="right" sx={{ borderTop: 2, borderColor: 'divider', fontWeight: 700 }}>
                    TOTAL
                  </TableCell>
                  <TableCell align="right" sx={{ borderTop: 2, borderColor: 'divider' }}>
                    <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', color: weightOk ? STATUS.good : STATUS.critical, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtPct(sum)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ borderTop: 2, borderColor: 'divider' }} />
                </TableRow>
              </TableBody>
            </Table>

            {removed.length > 0 && (
              <Box sx={{ px: 2.5, py: 1.75, borderTop: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 1 }}>
                  REMOVED FROM THIS SCORECARD
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {removed.map((l) => {
                    const o = l.objective ? OBJ_BY_ID[l.objective] : null
                    return (
                      <Chip
                        key={l.id}
                        size="small"
                        variant="outlined"
                        icon={<UndoIcon />}
                        label={o ? `Obj ${o.no} — ${o.short}` : l.label?.split('—')[0].trim()}
                        onClick={() => onRestoreLine(p.id, l.id)}
                        sx={{ cursor: 'pointer' }}
                      />
                    )
                  })}
                </Box>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                  Click to restore. Removing a line does not delete the underlying projects — {p.nick}'s hours still
                  count toward the team total.
                </Typography>
              </Box>
            )}

            <Box sx={{ px: 2.5, py: 2, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', flex: '1 1 320px' }}>
                Weights are always multiples of {WEIGHT_STEP}% and total exactly 100%, split across the objectives{' '}
                {p.nick} holds. Targets track project assignments live — reassign a project and the credited figure
                here follows; typing over a target pins it until you sync it back.
              </Typography>
              {!weightOk && (
                <Button size="small" variant="outlined" onClick={() => onRebalance(p.id)}>
                  Rebalance to 100%
                </Button>
              )}
              {edited && (
                <Button size="small" startIcon={<RestartAltIcon />} onClick={() => onResetKpi(p.id)}>
                  Reset to default
                </Button>
              )}
            </Box>
          </Paper>
        </Grid>

        {/* ---------- portfolio ---------- */}
        <Grid item xs={12} md={7}>
          {/* overflow hidden on the card + scroll on the table, so a wide
              editable table scrolls inside its own panel instead of pushing
              the page sideways */}
          <Paper variant="outlined" sx={{ p: 2.5, overflow: 'hidden' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 0.5 }}>
              <Typography variant="h4">
                {p.aggregatesTeam ? 'Team project portfolio' : 'Project portfolio'}
              </Typography>
              {focusObj && (
                <Chip
                  size="small"
                  color="primary"
                  variant="outlined"
                  label={`Obj ${focusObj.no} — ${focusObj.short}`}
                  onDelete={() => setFocus(null)}
                />
              )}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
              {focusObj
                ? `Showing ${visibleRows.length} of ${p.scorecardRows.length} projects. Click the KPI line again to clear.`
                : p.aggregatesTeam
                  ? 'Every in-plan project across the team, at full value — this is what the team figure above adds up to. Edit any of it here; the numbers everywhere follow.'
                  : "Contribution % is this person's normalised share. Credited hours = project hours × share. Edit any of it here."}
            </Typography>
            <Box sx={{ overflowX: 'auto', mx: -2.5, px: 2.5 }}>
            {/* Ten columns in a half-width panel: the default 16px of cell
                padding alone was 256px, which is what pushed the money columns
                off the right edge. */}
            <Table size="small" sx={{ minWidth: 720, '& th, & td': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 66 }}>Jira</TableCell>
                  <TableCell sx={{ minWidth: 128 }}>Project</TableCell>
                  <TableCell sx={{ minWidth: 78 }}>{p.aggregatesTeam ? 'Owner' : 'Role'}</TableCell>
                  {/* On the team card every row is credited whole, so Share and
                      Credited are constants — dropping them is what leaves room
                      for the money columns. */}
                  {!p.aggregatesTeam && <TableCell align="right" sx={{ minWidth: 52 }}>Share</TableCell>}
                  <TableCell align="right" sx={{ minWidth: 76 }}>Project hrs</TableCell>
                  {!p.aggregatesTeam && <TableCell align="right" sx={{ minWidth: 62 }}>Cred.</TableCell>}
                  <TableCell align="right" sx={{ minWidth: 68 }}>Mandays</TableCell>
                  <TableCell align="right" sx={{ minWidth: 76 }}>Benefit / yr</TableCell>
                  <TableCell align="right" sx={{ minWidth: 76 }}>ROI</TableCell>
                  <TableCell sx={{ minWidth: 96 }}>Level</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleRows
                  .slice()
                  .sort((a, b) => (b.p.savingHours ?? 0) * b.share - (a.p.savingHours ?? 0) * a.share)
                  .map(({ p: pr, share }) => {
                    // On the team card the Role column names the owner instead,
                    // since every row belongs to someone.
                    const roles = p.aggregatesTeam
                      ? (people.find((x) => x.id === pr.pic)?.nick
                        || (pr.pic === 'it' ? 'IT' : plan.assignees?.find((x) => x.id === pr.pic)?.nick)
                        || '—')
                      : (pr.contributors?.find((c) => c.person === p.id)?.roles.join('/')
                        || (pr.pic === p.id ? 'pic' : '—'))
                    const counted = pr.commitLevel === 'commit' || pr.commitLevel === 'stretch'
                    // A deferred or excluded project credits nothing. Printing
                    // its share here would contradict the totals above it.
                    const credited = counted ? (pr.savingHours ?? 0) * share : 0
                    return (
                      <TableRow key={pr.key} hover sx={{ opacity: counted ? 1 : 0.5 }}>
                        <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{pr.key}</TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ lineHeight: 1.3 }}>{pr.summary}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Obj {OBJ_BY_ID[pr.objective]?.no} · {pr.srcStatus || pr.status}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          {p.aggregatesTeam ? (
                            <Select
                              size="small"
                              variant="standard"
                              displayEmpty
                              value={pr.pic ?? ''}
                              onChange={(e) => onUpdate(pr.key, { pic: e.target.value || null })}
                              sx={{ fontSize: '0.75rem', width: 72, maxWidth: 72 }}
                              renderValue={(v) => (v ? (plan.assignees || people).find((x) => x.id === v)?.nick : 'TBC')}
                            >
                              <MenuItem value=""><em>TBC</em></MenuItem>
                              {(plan.assignees || people).map((x) => (
                                <MenuItem key={x.id} value={x.id}>{x.nick}</MenuItem>
                              ))}
                            </Select>
                          ) : (
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>{roles}</Typography>
                          )}
                        </TableCell>
                        {!p.aggregatesTeam && <TableCell align="right">{fmtPct(share)}</TableCell>}
                        <TableCell align="right">
                          <PortfolioNum
                            value={pr.savingHours}
                            onChange={(v) => onUpdate(pr.key, { savingHours: v, savingEstimated: v == null })}
                          />
                        </TableCell>
                        {!p.aggregatesTeam && (
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {!counted ? (
                              <Tooltip title={`${COMMIT_LABEL[pr.commitLevel] || pr.commitLevel} — credits nothing this year`}>
                                <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>
                              </Tooltip>
                            ) : pr.savingHours == null ? '—' : fmtHours(credited)}
                          </TableCell>
                        )}
                        {/* Effort is editable here too, so a scorecard can be
                            costed without leaving the page — the ROI beside it
                            fills in as soon as a manday lands. */}
                        <TableCell align="right">
                          <PortfolioNum
                            value={pr.manday || null}
                            onChange={(v) => onUpdate(pr.key, { manday: v ?? 0, mandayEstimated: false })}
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                          {!counted || pr.annualBenefit == null
                            ? <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>
                            : fmtMoneyShort(pr.annualBenefit * share, sym)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                          {!counted || pr.roi == null ? (
                            <Tooltip title={
                              pr.savingHours == null
                                ? 'Saving hours are still TBC'
                                : !counted
                                  ? 'Out of plan — credits nothing this year'
                                  : `No effort estimate. This project can absorb ${Math.round(pr.affordableMandays).toLocaleString()} mandays and still clear the gate.`
                            }>
                              <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                            </Tooltip>
                          ) : (
                            <Tooltip title={`${fmtMoney(pr.horizonBenefit, sym)} back over ${fin.horizonMonths} months against ${fmtMoney(pr.buildCost, sym)} to build. Gate ${fmtRoi(fin.roiGate)}.`}>
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, fontSize: '0.75rem', cursor: 'help', color: pr.gate === 'pass' ? STATUS.good : STATUS.critical }}
                              >
                                {fmtRoi(pr.roi)}
                              </Typography>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell>
                          <Select
                            size="small"
                            variant="standard"
                            value={pr.commitLevel}
                            onChange={(e) => onUpdate(pr.key, { commitLevel: e.target.value })}
                            sx={{ fontSize: '0.75rem', width: 78, maxWidth: 78 }}
                            renderValue={(v) => (
                              <Typography
                                variant="caption"
                                sx={{ color: OUT_OF_PLAN.has(v) ? STATUS.warning : 'text.secondary', fontWeight: OUT_OF_PLAN.has(v) ? 600 : 400 }}
                              >
                                {COMMIT_LABEL[v] || v}
                              </Typography>
                            )}
                          >
                            {COMMIT_LEVELS.map((c) => (
                              <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
                            ))}
                          </Select>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
            </Box>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}
