import { useState } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Grid, Chip, Tabs, Tab, Alert, Divider, Tooltip, TextField, InputAdornment, Button,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import StatTile from '../components/StatTile.jsx'
import { OBJ_BY_ID, OBJECTIVES, CHART, STATUS } from '../lib/palette.js'
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
        if (Number.isFinite(n) && n >= 0 && n <= 100) onChange(n / 100)
        else setDraft(asPct(value))
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      InputProps={{ endAdornment: <InputAdornment position="end" sx={{ ml: 0 }}>%</InputAdornment> }}
      inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, padding: '6px 4px 6px 8px' } }}
      error={invalid}
      sx={{ width: 92 }}
    />
  )
}

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
      onBlur={() => { setFocused(false); onChange(draft.trim()) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputProps={{ style: { fontSize: '0.8125rem', padding: '6px 8px' } }}
    />
  )
}

export default function People({ plan, onPersonKpi, onResetKpi }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { people, settings, totals } = plan
  const [who, setWho] = useState(people[0]?.id)
  const p = people.find((x) => x.id === who) || people[0]
  if (!p) return null

  const sum = weightSum(p.kpiLines)
  const weightOk = weightsValid(p.kpiLines)
  const shareOfTeam = totals.totalHours > 0 ? p.hours / totals.totalHours : 0
  const edited = p.kpiLines.some((l) => l.overridden)

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
              <Alert severity="error" square sx={{ borderRadius: 0 }}>
                Weights total <strong>{fmtPct(sum)}</strong>, not 100%. Saving is blocked until this is exactly 100% —
                adjust by <strong>{sum > 1 ? '−' : '+'}{fmtPct(Math.abs(1 - sum))}</strong>.
              </Alert>
            )}

            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 96 }}>Block</TableCell>
                  <TableCell>KPI line</TableCell>
                  <TableCell sx={{ minWidth: 190 }}>Target</TableCell>
                  <TableCell align="right" sx={{ width: 110 }}>Weight</TableCell>
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
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
                              {o ? `Obj ${o.no} — ${o.name}` : l.label}
                            </Typography>
                            {o && (
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {fmtHours(p.byObjective[o.id] || 0)} {settings.savingBasis === 'monthly' ? 'hrs/month' : 'hrs/year'} currently credited
                                {l.overridden && ' · edited'}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ verticalAlign: 'top', pt: 1.25 }}>
                        <TargetCell
                          value={l.target}
                          placeholder={l.defaultTarget}
                          onChange={(v) => onPersonKpi(p.id, l.id, { target: v })}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ verticalAlign: 'top', pt: 1.25 }}>
                        <PctCell
                          value={l.weight}
                          invalid={!weightOk}
                          onChange={(v) => onPersonKpi(p.id, l.id, { weight: v })}
                        />
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
                </TableRow>
              </TableBody>
            </Table>

            <Box sx={{ px: 2.5, py: 2, borderTop: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1 }}>
                Defaults come from the <strong>{BAND_LABEL[p.band]}</strong> band
                ({fmtPct(settings.bands[p.band].corporate)} corporate / {fmtPct(settings.bands[p.band].delivery)} delivery /{' '}
                {fmtPct(settings.bands[p.band].people)} capability). Your edits override them and are saved with the
                scenario.
              </Typography>
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
                    const credited = (pr.savingHours ?? 0) * share
                    const counted = pr.commitLevel === 'commit' || pr.commitLevel === 'stretch'
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
                          {pr.savingHours == null ? '—' : fmtHours(credited)}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ textTransform: 'capitalize', color: 'text.secondary' }}>
                            {pr.commitLevel}
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
