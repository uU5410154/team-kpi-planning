import { useState } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Grid, Chip, Tabs, Tab, Alert, Divider, Tooltip, TextField, InputAdornment, Button, IconButton,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import SyncIcon from '@mui/icons-material/Sync'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'
import UndoIcon from '@mui/icons-material/Undo'
import StatTile from '../components/StatTile.jsx'
import { OBJ_BY_ID, OBJECTIVES, CHART, STATUS, COMMIT_LEVELS } from '../lib/palette.js'

const COMMIT_LABEL = Object.fromEntries(COMMIT_LEVELS.map((c) => [c.id, c.label]))
import { fmtHours, fmtPct, fmtRatio, weightSum, weightsValid } from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

const BAND_LABEL = { lead: 'Team Lead', senior: 'Senior', analyst: 'Analyst' }

/** Percent input that commits on blur. Stored as a 0–1 fraction. */
function PctCell({ value, onChange, invalid }) {
  const asPct = (v) => (v == null ? '' : String(Math.round(v * 1000) / 10))
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
        const n = Number(draft.replace(/[%\s,]/g, ''))
        if (Number.isFinite(n) && n >= 0 && n <= 100) {
          if (Math.abs(n / 100 - value) > 1e-9) onChange(n / 100)
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

export default function People({
  plan, onPersonKpi, onResetKpi, onRemoveLine, onRestoreLine, onRebalance, onSyncTargets,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { people, settings, totals } = plan
  const [who, setWho] = useState(people[0]?.id)
  const p = people.find((x) => x.id === who) || people[0]
  if (!p) return null

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
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{x.nick}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {fmtHours(x.hours)} hrs · {x.countedCount} proj
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
            label="Credited saving hours"
            value={fmtHours(p.hours)}
            unit="hrs"
            context={`${fmtPct(shareOfTeam)} of the team commitment`}
            help="Project hours multiplied by this person's contribution share. Shares on a project always sum to 100%, so no hour is credited twice."
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Efficiency ratio"
            value={fmtRatio(p.ratio)}
            unit="hrs / manday"
            tone={p.ratio == null ? undefined : p.ratio >= settings.ratioGate ? 'good' : 'critical'}
            context={`Gate ${settings.ratioGate.toFixed(1)} · ${fmtHours(p.manday)} mandays credited`}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Projects"
            value={p.countedCount}
            unit={`of ${p.projectCount}`}
            context="Counted (commit + stretch) of all projects they touch"
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
          {p.nick} carries no quantified saving hours. A saving-hours KPI would be meaningless here — either transfer
          quantified work to them on the Projects tab, or lean their scorecard on the capability and milestone lines below.
        </Alert>
      )}

      <Grid container spacing={2.5}>
        {/* ---------- weight table ---------- */}
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Box sx={{ px: 2.5, py: 2, bgcolor: 'action.hover', borderBottom: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box>
                  <Typography variant="h4">2026 KPI scorecard</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {p.nick}'s own targets — not the team's. Edit any weight or target directly.
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
                  return (
                    <TableRow key={l.id} hover>
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
                          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
                            {o ? `Obj ${o.no} — ${o.name}` : l.label}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top', pt: 1.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {l.targetKind === 'hours' ? (
                            <HoursTargetCell
                              value={l.target}
                              unit={unit}
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
                            <Tooltip title={`Currently carrying ${fmtHours(l.creditedHours)} ${unit} — click to snap the target back to it`}>
                              <IconButton size="small" onClick={() => onPersonKpi(p.id, l.id, { target: null })}>
                                <SyncIcon sx={{ fontSize: 16, color: STATUS.warning }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ verticalAlign: 'top', pt: 1.25 }}>
                        <PctCell
                          value={l.weight}
                          invalid={!weightOk}
                          onChange={(v) => onPersonKpi(p.id, l.id, { weight: v })}
                        />
                      </TableCell>
                      <TableCell padding="checkbox" sx={{ verticalAlign: 'top', pt: 1.75 }}>
                        <Tooltip title="Remove this line from the scorecard">
                          <IconButton size="small" onClick={() => onRemoveLine(p.id, l.id)}>
                            <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {p.kpiLines.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      Every line has been removed. Restore one below, or reset to the band defaults.
                    </TableCell>
                  </TableRow>
                )}
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
                Targets track project assignments live — reassign a project on the Projects tab and the credited figure
                here follows. Typing over a target pins it until you sync it back. Defaults come from the{' '}
                <strong>{BAND_LABEL[p.band]}</strong> band ({fmtPct(settings.bands[p.band].corporate)} corporate /{' '}
                {fmtPct(settings.bands[p.band].delivery)} delivery / {fmtPct(settings.bands[p.band].people)} capability).
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
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h4" sx={{ mb: 0.5 }}>Project portfolio</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
              Contribution % is this person's normalised share of the project. Credited hours = project hours × share.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Jira</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell align="right">Share</TableCell>
                  <TableCell align="right">Project hrs</TableCell>
                  <TableCell align="right">Credited</TableCell>
                  <TableCell>Level</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {p.rows
                  .slice()
                  .sort((a, b) => (b.p.savingHours ?? 0) * b.share - (a.p.savingHours ?? 0) * a.share)
                  .map(({ p: pr, share }) => {
                    const roles =
                      pr.contributors?.find((c) => c.person === p.id)?.roles.join('/') ||
                      (pr.pic === p.id ? 'pic' : '—')
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
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{roles}</Typography>
                        </TableCell>
                        <TableCell align="right">{fmtPct(share)}</TableCell>
                        <TableCell align="right">
                          {pr.savingHours == null ? (
                            <Tooltip title="Not quantified in Jira">
                              <WarningAmberIcon sx={{ fontSize: 15, color: STATUS.warning }} />
                            </Tooltip>
                          ) : fmtHours(pr.savingHours)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {!counted ? (
                            <Tooltip title={`${COMMIT_LABEL[pr.commitLevel] || pr.commitLevel} — credits nothing this year`}>
                              <Typography variant="body2" sx={{ color: 'text.disabled' }}>—</Typography>
                            </Tooltip>
                          ) : pr.savingHours == null ? '—' : fmtHours(credited)}
                        </TableCell>
                        <TableCell>
                          <Typography
                            variant="caption"
                            sx={{ color: counted ? 'text.secondary' : STATUS.warning, fontWeight: counted ? 400 : 600 }}
                          >
                            {COMMIT_LABEL[pr.commitLevel] || pr.commitLevel}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}
