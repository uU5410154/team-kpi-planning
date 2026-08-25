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
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import AddIcon from '@mui/icons-material/Add'
import SyncIcon from '@mui/icons-material/Sync'
import SyncProblemIcon from '@mui/icons-material/SyncProblem'
import UndoIcon from '@mui/icons-material/Undo'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import StatTile from '../components/StatTile.jsx'
import ProjectCostDialog from '../components/ProjectCostDialog.jsx'
import KpiLineDialog from '../components/KpiLineDialog.jsx'
import { OBJ_BY_ID, OBJECTIVES, CHART, STATUS, COMMIT_LEVELS, OUT_OF_PLAN } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths, targetUnit,
  weightSum, weightsValid, snapWeight, WEIGHT_STEP,
  fmtMonthsShort, gateAsPaybackMonths, isNumericKind, servesObjective as serves,
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
      sx={{ width: 80 }}
    />
  )
}

/** A milestone date. Stored as YYYY-MM-DD, the same as every date in the plan. */
function DateTargetCell({ value, onChange }) {
  return (
    <TextField
      size="small"
      type="date"
      variant="outlined"
      value={value || ''}
      onChange={(e) => onChange(e.target.value)}
      inputProps={{ style: { fontSize: '0.8125rem', padding: '6px 8px' } }}
      sx={{ width: 116 }}
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
          // The unit gives way, never the number. "dashboards/reports/portals"
          // is wider than the whole field, and left to size itself it pushed
          // the figure out of sight — the one thing on the row that has to be
          // readable. It truncates and carries the full text as a tooltip.
          <InputAdornment position="end" sx={{ ml: 0.25, flexShrink: 1, minWidth: 0 }}>
            <Typography
              variant="caption"
              title={unit}
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 62,
                cursor: unit && unit.length > 10 ? 'help' : 'inherit',
              }}
            >
              {unit}
            </Typography>
          </InputAdornment>
        ),
      }}
      inputProps={{
        style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.8125rem', padding: '6px 2px 6px 8px' },
      }}
      // The figure keeps its room whatever the unit is called.
      sx={{ width: 116, '& .MuiInputBase-input': { minWidth: 34, flexShrink: 0 } }}
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
  onAddObjective, onRemoveObjective, onSaveLine, onOverride,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { people, settings, totals, finance: fin } = plan
  const sym = fin.symbol
  const [who, setWho] = useState(people[0]?.id)
  // Which KPI line is currently filtering the portfolio, by objective id.
  const [focus, setFocus] = useState(null)
  // The project KEY whose cost dialog is open, re-looked-up every render so an
  // edit inside the dialog is visible in the dialog itself.
  const [costKey, setCostKey] = useState(null)
  // { personId, line } — line null when adding
  const [editLine, setEditLine] = useState(null)
  const costProject = costKey == null ? null : plan.projects.find((x) => x.key === costKey) || null
  const p = people.find((x) => x.id === who) || people[0]
  if (!p) return null

  const focusObj = focus ? OBJ_BY_ID[focus] : null
  /*
   * What a KPI line shows when you click it, which follows how that objective
   * accrues rather than which projects happen to carry its tag.
   *
   * Objective 1 is a return calculated over EVERY project, and objective 2
   * collects every saving hour in the plan, so both show the whole portfolio.
   * Showing five tagged projects under a figure derived from eighty-six would
   * invite anyone checking it to conclude the number was wrong.
   *
   * A counted objective and the milestone show what is tagged to them, which
   * IS what they measure — and by servesObjective, so a project tagged to
   * several appears under each.
   */
  const wholeBook = !!focusObj && (focusObj.measure === 'ratio' || focusObj.measure === 'hours')
  const visibleRows = !focus
    ? p.scorecardRows
    : wholeBook
      ? p.scorecardRows
      : p.scorecardRows.filter((r) => serves(r.p, focus))

  const sum = weightSum(p.kpiLines)
  const weightOk = weightsValid(p.kpiLines)

  // The soft benefits on the projects this person is credited on. Counted rows
  // only: a deferred or excluded project delivers nothing this year, and
  // listing its benefits on a scorecard would claim work that is not happening.
  const softBenefits = p.scorecardRows
    .filter(({ p: pr }) => (pr.commitLevel === 'commit' || pr.commitLevel === 'stretch')
      && (pr.softBenefits || []).length > 0)
    .map(({ p: pr }) => ({ key: pr.jiraKey || pr.key, summary: pr.summary, list: pr.softBenefits }))
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
            override={{
              on: p.hoursOverridden,
              current: p.scorecardHours,
              calc: p.calcScorecardHours,
              calcLabel: `${fmtHours(p.calcScorecardHours)} hrs`,
              editHelp: 'Type the figure this scorecard should be appraised on. The project register is not changed.',
              onChange: (v) => onOverride(p.id, { hours: v }),
            }}
            context={
              Math.abs(p.scorecardHours - p.registerHours) > 0.5
                ? `Targets on the card add to this. The project register credits ${fmtHours(p.registerHours)} hrs.`
                : p.aggregatesTeam
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
            override={{
              on: p.moneyOverridden,
              current: Math.round(p.finance.annualBenefit),
              calc: Math.round(p.calcAnnualBenefit),
              calcLabel: `${fmtMoneyShort(p.calcAnnualBenefit, sym)} a year`,
              editHelp: 'Type the annual value this scorecard should be appraised on. Leave it and it follows the hours.',
              onChange: (v) => onOverride(p.id, { money: v }),
            }}
            tone={p.finance.roi == null ? undefined : p.finance.roi >= fin.roiGate ? 'good' : 'critical'}
            context={
              p.finance.roi == null
                ? `${p.finance.fteReleased.toFixed(1)} FTE · no cost estimated yet, so no return`
                : `ROI ${fmtRoi(p.finance.roi)} on ${fmtMoneyShort(p.finance.investment, sym)} invested · gate ${fmtRoi(fin.roiGate)}`
            }
            help={`Objective 1. ${fmtHours(p.scorecardHours)} saving hrs/month at ${fmtMoney(fin.acctHourRate, sym)} an hour, annualised${p.finance.monetaryAnnualBenefit ? `, plus ${fmtMoney(p.finance.monetaryAnnualBenefit, sym)} a year of cash benefit stated directly on the projects` : ''}. The return underneath compares that — net of ${fmtMoney(p.finance.opexRunRate, sym)} a month of credited OPEX — against ${fmtMoney(p.finance.buildCost ?? 0, sym)} of build (${fmtHours(p.scorecardManday)} credited mandays at ${fmtMoney(fin.devDayRate, sym)} each) plus ${fmtMoney(p.finance.capex ?? 0, sym)} of CAPEX, over ${fin.horizonMonths} months. Cost and benefit are credited on the same share and over the same projects, counting only the ones that carry a cost estimate.`}
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
        {/* Five twelfths below lg, not four: at 1100px a third of the row was
            337px against a table that cannot shrink below 391, and the delete
            button went back outside the frame. */}
        <Grid item xs={12} md={5} lg={4}>
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

            {/*
              * The card clips what overflows it, so this table has to fit
              * inside a third-width column: at the default cell padding it ran
              * 483px wide in a 451px card and the delete button — last column,
              * hard against the right edge — was cut off and unclickable.
              * The scroller is the guarantee rather than the arithmetic: at
              * any width the button can still be reached.
              */}
            <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ '& th, & td': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell>KPI line</TableCell>
                  <TableCell sx={{ minWidth: 116 }}>Target</TableCell>
                  <TableCell align="right" sx={{ width: 84 }}>Weight</TableCell>
                  <TableCell padding="none" sx={{ width: 34 }} />
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
                              {l.custom ? l.label : (o ? `Obj ${o.no} — ${o.name}` : l.label)}
                              {l.custom && (
                                <Tooltip title="Edit this KPI line">
                                  <IconButton
                                    size="small"
                                    sx={{ ml: 0.25, p: 0.25 }}
                                    onClick={(e) => { e.stopPropagation(); setEditLine({ personId: p.id, line: l }) }}
                                  >
                                    <EditOutlinedIcon sx={{ fontSize: 14 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                              {(l.manual || l.custom) && (
                                <Typography component="span" variant="caption" sx={{ ml: 0.75, color: 'primary.main', fontWeight: 700 }}>
                                  added
                                </Typography>
                              )}
                            </Typography>
                            {l.custom && o && (
                              <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                                under Obj {o.no} — {o.name}
                              </Typography>
                            )}
                            {selectable && (
                              <Typography variant="caption" sx={{ color: active ? 'primary.main' : 'text.disabled' }}>
                                {active
                                  ? 'filtering the portfolio — click to clear'
                                  : (o && (o.measure === 'ratio' || o.measure === 'hours')
                                    ? 'click to see every project behind it'
                                    : 'click to filter the portfolio')}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      {/* the row toggles the portfolio filter, so the editable
                          cells must not pass their clicks up to it */}
                      <TableCell sx={{ verticalAlign: 'top', pt: 1.25 }} onClick={(e) => e.stopPropagation()}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {/* The line states how it is measured, so the editor
                              follows it rather than inferring from the objective. */}
                          {isNumericKind(l.targetKind) ? (
                            <HoursTargetCell
                              value={l.target}
                              unit={targetUnit(l, settings.savingBasis, sym)}
                              onChange={(v) => onPersonKpi(p.id, l.id, { target: v })}
                            />
                          ) : l.targetKind === 'date' ? (
                            <DateTargetCell
                              value={l.target}
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
                        {/* Under the field, not beside it: beside it this
                            widened the column and pushed the delete button
                            back outside the card. */}
                        {/* A floor needs its current reading beside it, or
                            nobody can tell whether it is being met. */}
                        {l.targetKind === 'percent' && (
                          <Typography variant="caption" sx={{
                            display: 'block', mt: 0.25, fontWeight: 700,
                            color: l.creditedRatio == null ? 'text.disabled'
                              : l.meetsTarget ? STATUS.good : STATUS.critical,
                          }}>
                            {l.creditedRatio == null
                              ? 'nothing finished yet that had a date to meet'
                              : `${l.driftedCount} of ${l.held} drifted — ${fmtPct(l.creditedRatio)}`
                                + `${l.meetsTarget ? ', within the limit' : ` — OVER the ${l.target}% allowed`}`}
                          </Typography>
                        )}
                        {/*
                          * OBJECTIVE 1 IS A LIST OF DATES.
                          *
                          * The percentage above is only the roll-up. What a
                          * person actually commits to — and what a review
                          * actually discusses — is every project they run and
                          * the date they said it would land, so that is what
                          * the card shows.
                          */}
                        {l.targetKind === 'percent' && (p.commitments || []).length > 0 && (
                          <Box sx={{
                            mt: 0.75,
                            mb: 0.5,
                            /*
                             * The list must not widen the card.
                             *
                             * A table sizes itself to its content, and thirty
                             * project names pushed this one to 740px inside a
                             * 451px card — which shoved the delete button back
                             * outside the frame, the exact fault this card had
                             * once before. Fixed layout and a hard maximum
                             * keep the names inside their column instead.
                             */
                            maxWidth: '100%',
                            overflow: 'hidden',
                          }}
                          >
                            {/*
                              * The commitment itself, in words, above the list
                              * it applies to. A KPI somebody cannot recite is a
                              * KPI somebody is not managing to.
                              */}
                            <Box sx={{
                              p: 1,
                              mb: 0.75,
                              borderRadius: 1,
                              bgcolor: 'action.hover',
                              borderLeft: 3,
                              borderColor: l.meetsTarget === false ? STATUS.critical : STATUS.good,
                            }}
                            >
                              <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.5 }}>
                                <strong>My commitment.</strong> Each project below lands on the date beside it. A date
                                may move by up to <strong>{Math.round((l.perProjectLimit ?? 0.2) * 100)}%</strong> of
                                that project&rsquo;s own planned length — about a sprint on a quarter-long piece of
                                work — and across the <strong>{l.held}</strong> project{l.held === 1 ? '' : 's'} I hold,
                                no more than <strong>{l.target}%</strong> may drift beyond that. Each project may be
                                re-planned <strong>once</strong> after requirement gathering — a date set before anybody
                                has seen the requirement is a guess, and the re-plan resets the commitment at no cost.
                                A second move counts.
                              </Typography>
                              <Typography variant="caption" sx={{
                                display: 'block',
                                mt: 0.5,
                                fontWeight: 700,
                                color: l.meetsTarget === false ? STATUS.critical : STATUS.good,
                              }}
                              >
                                {l.driftedCount} of {l.held} have drifted beyond their allowance
                                {' '}({fmtPct(l.creditedRatio ?? 0)}) · limit {l.target}%
                              </Typography>
                              {(p.drift?.replanned > 0 || p.drift?.backwards > 0) && (
                                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.25 }}>
                                  {p.drift.replanned > 0 && (
                                    <>
                                      {p.drift.replanned} re-planned once (allowed)
                                      {p.drift.overReplanned > 0 && `, ${p.drift.overReplanned} more than once`}
                                    </>
                                  )}
                                  {p.drift.backwards > 0 && (
                                    <Box component="span" sx={{ color: STATUS.warning }}>
                                      {p.drift.replanned > 0 ? ' · ' : ''}
                                      {p.drift.backwards} plan{p.drift.backwards === 1 ? '' : 's'} start after their own
                                      due date — data to fix, not scored
                                    </Box>
                                  )}
                                </Typography>
                              )}
                            </Box>
                            <Table size="small" sx={{
                              tableLayout: 'fixed',
                              width: '100%',
                              '& td': {
                                border: 0,
                                px: 0.75,
                                py: 0.15,
                                fontSize: '0.68rem',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                            }}
                            >
                              <TableBody>
                                {p.commitments.map((c) => (
                                  <TableRow key={c.key}>
                                    <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                                      {c.jiraKey || '—'}
                                    </TableCell>
                                    <TableCell sx={{ width: '46%' }}>
                                      <Tooltip title={c.summary}>
                                        <Box component="span">{c.summary}</Box>
                                      </Tooltip>
                                    </TableCell>
                                    <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                                      {c.due ? `by ${c.due}` : (
                                        <Box component="span" sx={{ color: STATUS.warning, fontWeight: 700 }}>
                                          no date committed
                                        </Box>
                                      )}
                                      {c.replans > 0 && (
                                        <Tooltip title={c.baselineDue
                                          ? `First committed to ${c.baselineDue}, re-planned ${c.replans} time${c.replans === 1 ? '' : 's'}`
                                          : `Re-planned ${c.replans} times`}
                                        >
                                          <Box
                                            component="span"
                                            sx={{
                                              ml: 0.5,
                                              fontSize: '0.6rem',
                                              cursor: 'help',
                                              color: c.overReplanned ? STATUS.critical : 'text.disabled',
                                            }}
                                          >
                                            {c.overReplanned ? `re-planned ×${c.replans}` : 're-planned'}
                                          </Box>
                                        </Tooltip>
                                      )}
                                    </TableCell>
                                    <TableCell align="right" sx={{
                                      whiteSpace: 'nowrap',
                                      fontWeight: 700,
                                      color: c.drifted === null ? 'text.disabled'
                                        : c.drifted ? STATUS.critical : STATUS.good,
                                    }}
                                    >
                                      {c.drifted === null
                                        ? (c.running ? 'running' : 'not due yet')
                                        : c.driftDays === 0
                                          ? `on the day${c.actualEnd ? ` ${c.actualEnd}` : ''}`
                                          : `+${c.driftDays}d${c.driftShare != null ? ` · ${fmtPct(c.driftShare)}` : ''}`}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                            {p.undatedCount > 0 && (
                              <Typography variant="caption" sx={{ color: STATUS.warning, display: 'block', mt: 0.25 }}>
                                {p.undatedCount} project{p.undatedCount === 1 ? '' : 's'} with no committed date —
                                objective 1 is not complete until every one has one.
                              </Typography>
                            )}
                          </Box>
                        )}
                        {l.creditedHours > 0 && l.targetKind !== 'hours' && (
                          <Tooltip title="The saving hours behind this line. Its target is stated in another unit, but the hours still count toward the total below.">
                            <Typography variant="caption" sx={{ color: 'text.secondary', cursor: 'help', display: 'block', mt: 0.25 }}>
                              carries {fmtHours(l.creditedHours)} {unit}
                            </Typography>
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell align="right" sx={{ verticalAlign: 'top', pt: 1.25 }} onClick={(e) => e.stopPropagation()}>
                        <PctCell
                          value={l.weight}
                          invalid={!weightOk}
                          onChange={(v) => onPersonKpi(p.id, l.id, { weight: v })}
                        />
                      </TableCell>
                      <TableCell padding="none" sx={{ verticalAlign: 'top', pt: 1.75, pr: 0.5, width: 34 }} onClick={(e) => e.stopPropagation()}>
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
                  <TableCell sx={{ borderTop: 2, borderColor: 'divider', fontWeight: 700 }}>
                    TOTAL
                  </TableCell>
                  {/* The saving hours the card carries. Objective 1 states its
                      target in baht and objective 3 states a date, so adding
                      the hours-typed targets alone would report well short of
                      what this person actually holds. */}
                  <TableCell align="right" sx={{ borderTop: 2, borderColor: 'divider' }}>
                    <Tooltip title={`What this card STATES, added up${p.aggregatesTeam ? ' — the whole team' : ''}: a target typed in hours counts as typed, and a line stated in baht or as a date contributes the hours behind it. Untouched, it equals the project register exactly; edit a target and this and the figure above both follow.`}>
                      <Box>
                        <Typography sx={{ fontWeight: 800, fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums', cursor: 'help' }}>
                          {fmtHours(p.kpiTotals.savingHours)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2 }}>
                          {unit}{p.hoursOverridden ? ' · manual' : ''}
                        </Typography>
                        {Math.abs(p.kpiTotals.savingHours - p.registerHours) > 0.5 && (
                          <Typography variant="caption" sx={{ color: STATUS.warning, display: 'block', lineHeight: 1.2, fontWeight: 600 }}>
                            register: {fmtHours(p.registerHours)}
                          </Typography>
                        )}
                      </Box>
                    </Tooltip>
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
            </Box>

            {/* ---------- what the register cannot count ---------- */}
            {softBenefits.length > 0 && (
              <Box sx={{ px: 2.5, py: 1.75, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, display: 'block', mb: 1 }}>
                  SOFT BENEFITS DELIVERED
                </Typography>
                {softBenefits.map((g) => (
                  <Box key={g.key} sx={{ mb: 1.25 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                      {g.key} · {g.summary}
                    </Typography>
                    {g.list.map((b, i) => (
                      <Typography key={i} variant="caption" sx={{ display: 'block', color: 'text.secondary', pl: 1 }}>
                        &bull; {b}
                      </Typography>
                    ))}
                  </Box>
                ))}
                <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
                  From the projects credited to {p.nick}. They carry no hours and no weight — they are the part
                  of the case the saving hours do not capture.
                </Typography>
              </Box>
            )}

            {/* ---------- a KPI line written by hand ---------- */}
            <Box sx={{ px: 2.5, py: 1.5, borderTop: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  ADD A KPI LINE
                </Typography>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => setEditLine({ personId: p.id, line: null })}
                >
                  New KPI
                </Button>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  anything the project register cannot count — measured in hours, money, a number, a date or a
                  sentence, and tied to an objective if it belongs to one
                </Typography>
              </Box>
            </Box>

            {/* ---------- objectives added by hand ---------- */}
            <Box sx={{ px: 2.5, py: 1.75, borderTop: 1, borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  ADD AN OBJECTIVE
                </Typography>
                {p.addableObjectives.length ? (
                  <Select
                    size="small"
                    value=""
                    displayEmpty
                    onChange={(e) => { if (e.target.value) onAddObjective(p.id, e.target.value) }}
                    sx={{ fontSize: '0.8125rem', minWidth: 230 }}
                    renderValue={() => <em>choose an objective…</em>}
                  >
                    {p.addableObjectives.map((id) => {
                      const o = OBJ_BY_ID[id]
                      return <MenuItem key={id} value={id}>Obj {o.no} — {o.name}</MenuItem>
                    })}
                  </Select>
                ) : (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {p.nick} already holds all five.
                  </Typography>
                )}
                {p.addedObjectives.map((id) => {
                  const o = OBJ_BY_ID[id]
                  return (
                    <Chip
                      key={id}
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={`Obj ${o.no} — ${o.short} (added)`}
                      onDelete={() => onRemoveObjective(p.id, id)}
                    />
                  )
                })}
              </Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                An objective normally appears here because {p.nick} owns a project carrying it. One added by hand
                has no projects behind it yet, so its target starts at zero and the other lines give up weight to
                it — which is the point, if the work is committed but not scoped. Give {p.nick} a project on that
                objective and the line becomes a normal one; removing the chip then leaves it in place.
              </Typography>
            </Box>

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
        <Grid item xs={12} md={7} lg={8}>
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
                  label={`Obj ${focusObj.no} — ${focusObj.short}${wholeBook ? ' · every project' : ''}`}
                  onDelete={() => setFocus(null)}
                />
              )}
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
              {focusObj
                ? (wholeBook
                  ? `All ${visibleRows.length} projects — Obj ${focusObj.no} is calculated over every one of them. Click the KPI line again to clear.`
                  : `Showing ${visibleRows.length} of ${p.scorecardRows.length} projects. Click the KPI line again to clear.`)
                : p.aggregatesTeam
                  ? 'Every in-plan project across the team, at full value — this is what the team figure above adds up to. Edit any of it here; the numbers everywhere follow. Click a row for its CAPEX, monthly OPEX and cost grid.'
                  : "Contribution % is this person's normalised share. Credited hours = project hours × share. Edit any of it here, and click a row for its CAPEX, monthly OPEX and cost grid."}
            </Typography>
            <Box sx={{ overflowX: 'auto', mx: -2.5, px: 2.5 }}>
            {/* Ten columns in a half-width panel: the default 16px of cell
                padding alone was 256px, which is what pushed the money columns
                off the right edge. */}
            <Table size="small" sx={{ minWidth: 720, '& th, & td': { px: 1 } }}>
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell sx={{ minWidth: 66 }}>Jira</TableCell>
                  <TableCell sx={{ minWidth: 118 }}>Project</TableCell>
                  <TableCell sx={{ minWidth: 78 }}>{p.aggregatesTeam ? 'Owner' : 'Role'}</TableCell>
                  {/* On the team card every row is credited whole, so Share and
                      Credited are constants — dropping them is what leaves room
                      for the money columns. */}
                  {!p.aggregatesTeam && <TableCell align="right" sx={{ minWidth: 52 }}>Share</TableCell>}
                  <TableCell align="right" sx={{ minWidth: 76 }}>Project hrs</TableCell>
                  {!p.aggregatesTeam && <TableCell align="right" sx={{ minWidth: 62 }}>Cred.</TableCell>}
                  <TableCell align="right" sx={{ minWidth: 68 }}>Mandays</TableCell>
                  <TableCell align="right" sx={{ minWidth: 62 }}>Cash / yr</TableCell>
                  <TableCell align="right" sx={{ minWidth: 68 }}>Benefit / yr</TableCell>
                  <TableCell align="right" sx={{ minWidth: 76 }}>ROI</TableCell>
                  <TableCell align="right" sx={{ minWidth: 62 }}>Payback</TableCell>
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
                      // The cost dialog opens from an explicit button in the
                      // first cell, not from a click anywhere on the row.
                      <TableRow
                        key={pr.key}
                        hover
                        sx={{ opacity: counted ? 1 : 0.5 }}
                      >
                        <TableCell padding="checkbox">
                          <Tooltip title={`Effort, CAPEX, monthly cost and notes for ${pr.jiraKey || pr.key}`}>
                            <IconButton size="small" onClick={() => setCostKey(pr.key)} aria-label="open cost breakdown">
                              <ReceiptLongIcon sx={{ fontSize: 16, color: pr.comment ? STATUS.good : undefined }} />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
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
                          {pr.tasks && pr.tasks.length ? (
                            <Tooltip title={`${pr.tasks.length} task${pr.tasks.length === 1 ? '' : 's'} totalling ${fmtHours(pr.manday)} mandays — click to see the breakdown`}>
                              <Box
                                component="button"
                                type="button"
                                onClick={() => setCostKey(pr.key)}
                                sx={{
                                  border: 0, background: 'none', p: 0, cursor: 'pointer', font: 'inherit',
                                  fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums',
                                  color: 'primary.main', textDecoration: 'underline dotted',
                                }}
                              >
                                {fmtHours(pr.manday)}
                              </Box>
                            </Tooltip>
                          ) : (
                            <PortfolioNum
                              value={pr.manday || null}
                              onChange={(v) => onUpdate(pr.key, { manday: v ?? 0, mandayEstimated: false })}
                            />
                          )}
                        </TableCell>
                        {/* The cash half on its own, so a benefit that is not
                            time can be seen rather than inferred from a total. */}
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                          {!counted || !pr.monetaryAnnualBenefit
                            ? <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>
                            : (
                              <Tooltip title={`${fmtMoney(pr.monetaryAnnualBenefit, sym)} a year on the project, credited at ${Math.round(share * 100)}%. Counted in the Benefit and the ROI beside it.`}>
                                <span>{fmtMoneyShort(pr.monetaryAnnualBenefit * share, sym)}</span>
                              </Tooltip>
                            )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                          {!counted || pr.annualBenefit == null
                            ? <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>
                            : (
                              <Tooltip title={pr.monetaryAnnualBenefit
                                ? `${fmtMoney((pr.hoursMonthlyBenefit || 0) * 12 * share, sym)} from the hours + ${fmtMoney(pr.monetaryAnnualBenefit * share, sym)} cash`
                                : `${fmtMoney(pr.annualBenefit * share, sym)} a year, all of it from the hours released`}>
                                <span>{fmtMoneyShort(pr.annualBenefit * share, sym)}</span>
                              </Tooltip>
                            )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                          {!counted || pr.roi == null ? (
                            <Tooltip title={
                              pr.savingHours == null
                                ? 'Saving hours are still TBC'
                                : !counted
                                  ? 'Out of plan — credits nothing this year'
                                  : `No cost entered. This project can absorb ${Math.round(pr.affordableMandays).toLocaleString()} mandays and still clear the gate — click the row to add CAPEX or a monthly cost instead.`
                            }>
                              <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                            </Tooltip>
                          ) : (
                            <Tooltip title={`${fmtMoney(pr.netHorizonBenefit, sym)} back over ${fin.horizonMonths} months, after ${fmtMoney(pr.opexRunRate, sym)} a month of OPEX, against ${fmtMoney(pr.investment, sym)} invested (build ${fmtMoney(pr.buildCost ?? 0, sym)} + CAPEX ${fmtMoney(pr.capex ?? 0, sym)}). ${pr.paybackMonths == null ? 'It never pays back.' : `Pays back in ${fmtMonths(pr.paybackMonths)}.`} Gate ${fmtRoi(fin.roiGate)}. Click the row for the month-by-month costs.`}>
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, fontSize: '0.75rem', cursor: 'help', color: pr.gate === 'pass' ? STATUS.good : STATUS.critical }}
                              >
                                {fmtRoi(pr.roi)}
                              </Typography>
                            </Tooltip>
                          )}
                        </TableCell>
                        <TableCell align="right" sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums' }}>
                          {!counted || pr.investment == null ? (
                            <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>
                          ) : pr.paybackMonths == null ? (
                            <Tooltip title={`The ${fmtMoney(pr.opexRunRate, sym)} a month of OPEX is at or above the ${fmtMoney(pr.monthlyBenefit ?? 0, sym)} a month this returns, so it never pays back.`}>
                              <Typography variant="caption" sx={{ color: STATUS.critical, fontWeight: 600, cursor: 'help' }}>never</Typography>
                            </Tooltip>
                          ) : (
                            <Tooltip title={`${fmtMoney(pr.investment, sym)} invested against ${fmtMoney(pr.netMonthly, sym)} a month net of OPEX — repaid in ${fmtMonths(pr.paybackMonths)}. The gate is ${fmtMonths(gateAsPaybackMonths(fin))}.`}>
                              <Typography
                                variant="body2"
                                sx={{ fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', cursor: 'help', color: pr.gate === 'pass' ? 'text.primary' : STATUS.critical }}
                              >
                                {fmtMonthsShort(pr.paybackMonths)}
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

      <KpiLineDialog
        open={!!editLine}
        key={editLine?.line?.id || 'new'}
        line={editLine?.line || null}
        symbol={sym}
        onClose={() => setEditLine(null)}
        onSave={(line) => { onSaveLine(editLine.personId, line); setEditLine(null) }}
      />

      {/* The same component the Projects tab opens, on the same update path. */}
      <ProjectCostDialog
        project={costProject}
        plan={plan}
        onUpdate={onUpdate}
        onClose={() => setCostKey(null)}
      />
    </Box>
  )
}
