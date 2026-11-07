import { useState, useEffect, Fragment } from 'react'
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Chip, Tabs, Tab, Alert, Tooltip, TextField, InputAdornment, Button, IconButton,
  Select, MenuItem, FormControl, InputLabel, Collapse, ButtonBase, useMediaQuery,
} from '@mui/material'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import AddIcon from '@mui/icons-material/Add'
import SyncIcon from '@mui/icons-material/Sync'
import UndoIcon from '@mui/icons-material/Undo'
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import StatTile from '../components/StatTile.jsx'
import ProjectCostDialog from '../components/ProjectCostDialog.jsx'
import KpiLineDialog from '../components/KpiLineDialog.jsx'
import {
  PageHeader, Section, StatusPill, SectionSkeleton,
} from '../components/ui.jsx'
import { ScrollX } from './Team.jsx'
import {
  OBJ_BY_ID, OBJECTIVES, CHART, COMMIT_LEVELS, OUT_OF_PLAN,
} from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths, targetUnit,
  weightSum, weightsValid, snapWeight, WEIGHT_STEP,
  fmtMonthsShort, gateAsPaybackMonths, isNumericKind, servesObjective as serves,
} from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

const COMMIT_LABEL = Object.fromEntries(COMMIT_LEVELS.map((c) => [c.id, c.label]))
const BAND_LABEL = { lead: 'Team lead', senior: 'Senior', analyst: 'Analyst' }
/* The dated list under objective 1 shows this many until somebody asks for all. */
const COMMIT_PREVIEW = 5

/** A missing value: an en dash in the quietest text colour (docs/DESIGN.md §5). */
const Dash = ({ title }) => (
  <Box component="span" title={title} sx={{ color: 'text.tertiary' }}>–</Box>
)

/**
 * Objectives held, said the way a person would: "objectives 1–5",
 * "objectives 2 and 4", "objective 2".
 */
function heldObjectives(ids) {
  const nos = ids.map((o) => OBJ_BY_ID[o]?.no).filter(Boolean).sort((a, b) => a - b)
  if (!nos.length) return 'No objectives yet'
  if (nos.length === 1) return `Holds objective ${nos[0]}`
  const runs = []
  for (const n of nos) {
    const last = runs[runs.length - 1]
    if (last && n === last[1] + 1) last[1] = n
    else runs.push([n, n])
  }
  const parts = runs.flatMap(([a, b]) => (b - a >= 2 ? [`${a}–${b}`] : a === b ? [String(a)] : [String(a), String(b)]))
  const said = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `Holds objectives ${said}`
}

/**
 * Inline-editable cells look like plain text at rest (docs/DESIGN.md §5): the
 * edge appears on row hover, the primary outline on focus, and an error keeps
 * its edge. On a touch screen there is no hover, so a faint edge stays.
 */
const INLINE = (t) => ({
  '& .MuiOutlinedInput-root': { bgcolor: 'transparent' },
  '& .MuiOutlinedInput-root:not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
    borderColor: 'transparent',
  },
  'tr:hover & .MuiOutlinedInput-root:not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
    borderColor: t.palette.border.strong,
  },
  '@media (hover: none)': {
    '& .MuiOutlinedInput-root:not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
      borderColor: t.palette.border.subtle,
    },
  },
})

/**
 * One project's drift, spelled out as the sum it actually is.
 *
 * The cell has room for "+24d of 18d" and no more, and a reader who cannot see
 * where 18 came from cannot check the verdict beside it. This is that working:
 * the planned length, the share it allows, what was spent, and what remains.
 */
function driftNote(c, perProjectLimit) {
  const pct = Math.round(perProjectLimit * 100)
  const bits = []
  if (!c.due) return 'No date committed yet, so there is nothing to measure against.'
  bits.push(`Committed to ${c.due}.`)
  if (c.plannedDays != null && c.plannedDays > 0) {
    bits.push(`Planned to take ${c.plannedDays} days, so ${pct}% allows`
      + ` ${Math.round(c.driftAllowance ?? 0)} days of movement`
      + `${(c.driftAllowance ?? 0) <= 1 ? ' (the floor of one whole day)' : ''}.`)
  } else if (c.driftAllowance == null) {
    bits.push('No planned length to measure against, so it is judged against a whole sprint instead.')
  }
  if (c.drifted === null) {
    bits.push(c.running ? 'Still running, and not yet past its date, so nothing is spent.' : 'Not due yet, so nothing is spent.')
  } else if (c.driftDays === 0) {
    bits.push(`Landed on the day${c.actualEnd ? ` (${c.actualEnd})` : ''}. None of the allowance used.`)
  } else {
    const left = (c.driftAllowance ?? 0) - c.driftDays
    bits.push(`It ran ${c.driftDays} days past that date`
      + `${c.driftShare != null ? `, which is ${Math.round(c.driftShare * 100)}% of its planned length` : ''}.`)
    bits.push(left >= 0
      ? `Within the allowance, with ${Math.round(left)} day${Math.round(left) === 1 ? '' : 's'} to spare.`
      : `That is ${Math.abs(Math.round(left))} day${Math.abs(Math.round(left)) === 1 ? '' : 's'} beyond the allowance, so it counts against the overall limit.`)
  }
  if (c.overReplanned) {
    bits.push(`Re-planned ${c.replans} times. The first was free; the rest count as drift whatever the dates say.`)
  } else if (c.replanned) {
    bits.push(`Re-planned once${c.baselineDue ? ` from ${c.baselineDue}` : ''}. That was the free re-plan.`)
  }
  if (c.plannedBackwards) bits.push('This plan ends before it starts: data to fix, and never scored.')
  return bits.join(' ')
}

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
      InputProps={{ endAdornment: <InputAdornment position="end" sx={{ ml: 0.25, color: 'text.secondary' }}>%</InputAdornment> }}
      inputProps={{
        'aria-label': 'Weight',
        inputMode: 'numeric',
        style: {
          textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, padding: '8px 0 8px 8px',
        },
      }}
      error={invalid}
      sx={[INLINE, { width: 84 }]}
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
      inputProps={{ 'aria-label': 'Target date', style: { padding: '8px 8px' } }}
      sx={[INLINE, { width: 156 }]}
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
          <InputAdornment position="end" sx={{ ml: 1, flex: '0 1 auto', minWidth: 0 }}>
            <Typography
              variant="body2"
              component="span"
              title={unit}
              sx={{
                color: 'text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 96,
                cursor: unit && unit.length > 12 ? 'help' : 'inherit',
              }}
            >
              {unit}
            </Typography>
          </InputAdornment>
        ),
      }}
      inputProps={{
        'aria-label': 'Target',
        inputMode: 'decimal',
        style: {
          textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500, padding: '8px 0 8px 8px',
        },
      }}
      // The figure keeps its room whatever the unit is called.
      sx={[INLINE, { width: { xs: 164, lg: 140, xl: 164 }, '& .MuiInputBase-input': { flex: '1 1 0', width: 'auto', minWidth: 44 } }]}
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
      inputProps={{ 'aria-label': 'Target', style: { padding: '8px 8px' } }}
      sx={[INLINE, { maxWidth: 260 }]}
    />
  )
}

/** Editable number cell inside the portfolio. Empty means "to be confirmed". */
function PortfolioNum({ value, onChange, label }) {
  const asStr = (v) => (v == null ? '' : String(v))
  const [draft, setDraft] = useState(asStr(value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== asStr(value)) setDraft(asStr(value))
  return (
    <TextField
      size="small"
      variant="outlined"
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
      inputProps={{
        'aria-label': label,
        inputMode: 'decimal',
        style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', padding: '6px 8px' },
      }}
      sx={[INLINE, { width: 84 }]}
    />
  )
}

/** A select inside a table: the value and a caret at rest, an edge on hover. */
const inlineSelectSx = (t) => ({
  ...INLINE(t),
  fontSize: '0.875rem',
  bgcolor: 'transparent',
  '& .MuiSelect-select': { py: '6px', pl: 2, pr: '28px !important' },
  '&:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
  'tr:hover &:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: t.palette.border.strong },
})

export default function People({
  plan, onPersonKpi, onResetKpi, onRemoveLine, onRestoreLine, onRebalance, onSyncTargets, onUpdate,
  onAddObjective, onRemoveObjective, onSaveLine, onOverride, jump = null, loading = false,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  // A phone: the portfolio becomes a list, the scorecard folds to three columns.
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  // Below a wide laptop the scorecard folds; side by side, its columns need the room.
  const compact = useMediaQuery(theme.breakpoints.down('lg'))
  const { people, settings, totals, finance: fin } = plan
  const sym = fin.symbol
  const [who, setWho] = useState(people[0]?.id)
  // Sent here by the header search: open that person's card.
  useEffect(() => { if (jump?.person) setWho(jump.person) }, [jump?.n])
  // Which KPI line is currently filtering the portfolio, by objective id.
  const [focus, setFocus] = useState(null)
  // Objective 1's rules and its full list of dated projects.
  const [rulesOpen, setRulesOpen] = useState(false)
  // The project KEY whose cost dialog is open, re-looked-up every render so an
  // edit inside the dialog is visible in the dialog itself.
  const [costKey, setCostKey] = useState(null)
  // { personId, line } — line null when adding
  const [editLine, setEditLine] = useState(null)
  const costProject = costKey == null ? null : plan.projects.find((x) => x.key === costKey) || null

  const description = 'What each person is measured on in 2026.'
  const help = (
    <>
      <p>
        Each card splits 100% of weight across the objectives that person holds, in steps of {WEIGHT_STEP}%.
        Saving is blocked until a card totals exactly 100%.
      </p>
      <p>
        Targets follow project assignments live: reassign a project and the figures here follow. Typing over a
        target pins it until you sync it back.
      </p>
      <p>Click a KPI line to filter the project portfolio to the work behind it.</p>
      <p>
        An objective normally appears because the person owns a project carrying it. One added by hand has no
        projects behind it yet, so its target starts at zero and the other lines give up weight to it. Give the
        person a project on that objective and the line becomes a normal one.
      </p>
      <p>Removing a line does not delete its projects: their hours still count toward the team total.</p>
    </>
  )

  if (loading) {
    return (
      <Box>
        <PageHeader title="Scorecards" description={description} />
        <SectionSkeleton figures={4} rows={6} />
      </Box>
    )
  }

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
  const unitShort = settings.savingBasis === 'monthly' ? 'hrs/mth' : 'hrs/yr'
  const pad = { xs: 3, sm: 4 }
  const toggleFocus = (id) => setFocus((f) => (f === id ? null : id))

  /* ---------------------------------------------------------------- */
  /* Figures                                                           */
  /* ---------------------------------------------------------------- */
  const missingNote = p.missingSaving
    ? 'Cannot be committed until quantified'
    : <Box component="span" sx={(t) => ({ color: t.palette.tone.success.fg })}>Fully quantified</Box>

  const figures = (
    <Box
      sx={(t) => ({
        display: 'grid',
        bgcolor: 'bg.surface',
        border: 1,
        borderColor: 'border.subtle',
        borderRadius: '8px',
        overflow: 'hidden',
        // One strip, split by hairlines: the tiles lose their own frames.
        '& > .MuiPaper-root': {
          border: 0, borderRadius: 0, bgcolor: 'transparent', p: { xs: 3, sm: 4 },
        },
        // Every label row the height of the edit button, so the figures line up.
        [t.breakpoints.down('sm')]: { '& .MuiTypography-subtitle2': { whiteSpace: 'normal', overflow: 'visible' } },
        '& > .MuiPaper-root > div:first-of-type': { minHeight: 28 },
        [t.breakpoints.up('md')]: {
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          '& > .MuiPaper-root + .MuiPaper-root': { borderLeft: `1px solid ${t.palette.border.subtle}` },
        },
        [t.breakpoints.down('md')]: {
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          '& > .MuiPaper-root:nth-of-type(2n)': { borderLeft: `1px solid ${t.palette.border.subtle}` },
          '& > .MuiPaper-root:nth-of-type(n+3)': { borderTop: `1px solid ${t.palette.border.subtle}` },
        },
        // The edit and revert controls: 28px targets, 40 on a phone.
        '& [aria-label^="override "], & [aria-label^="revert "]': {
          width: 28, height: 28, p: 0, [t.breakpoints.down('sm')]: { width: 40, height: 40 },
        },
      })}
    >
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
              ? `Whole team, ${fmtHours(p.ownHours)} hrs from ${p.nick}'s own projects, IT and unassigned`
              : `${fmtPct(shareOfTeam)} of the team commitment`
        }
        help={
          p.aggregatesTeam
            ? "As team lead, this scorecard carries the team's overall KPI: every member's credited hours added together, including the projects assigned to them, the ones owned by IT, and the unassigned ones. It is the sum of the other scorecards, so the two can never disagree. Projects set to Next year are excluded."
            : "Project hours multiplied by this person's contribution share. Shares on a project always sum to 100%, so no hour is credited twice."
        }
      />
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
            ? `${p.finance.fteReleased.toFixed(1)} FTE released, no cost estimated yet`
            : `Return ${fmtRoi(p.finance.roi)} on ${fmtMoneyShort(p.finance.investment, sym)} invested, gate ${fmtRoi(fin.roiGate)}`
        }
        help={`Objective 1. ${fmtHours(p.scorecardHours)} saving hrs/month at ${fmtMoney(fin.acctHourRate, sym)} an hour, annualised${p.finance.monetaryAnnualBenefit ? `, plus ${fmtMoney(p.finance.monetaryAnnualBenefit, sym)} a year of cash benefit stated directly on the projects` : ''}. The return underneath compares that, net of ${fmtMoney(p.finance.opexRunRate, sym)} a month of credited OPEX, against ${fmtMoney(p.finance.buildCost ?? 0, sym)} of build (${fmtHours(p.scorecardManday)} credited mandays at ${fmtMoney(fin.devDayRate, sym)} each) plus ${fmtMoney(p.finance.capex ?? 0, sym)} of CAPEX, over ${fin.horizonMonths} months. Cost and benefit are credited on the same share and over the same projects, counting only the ones that carry a cost estimate.`}
      />
      <StatTile
        label="Projects"
        value={p.aggregatesTeam ? p.scorecardCount : p.countedCount}
        unit={p.aggregatesTeam ? 'team-wide' : `of ${p.projectCount}`}
        context={
          p.aggregatesTeam
            ? `Every in-plan project, ${p.ownCount} of them ${p.nick}'s own`
            : 'Counted (commit and stretch) of all the projects they touch'
        }
      />
      <StatTile
        label="Missing saving hours"
        value={p.missingSaving}
        unit={p.missingSaving === 1 ? 'project' : 'projects'}
        tone={p.missingSaving > 5 ? 'critical' : p.missingSaving > 0 ? 'warning' : undefined}
        context={missingNote}
      />
    </Box>
  )

  /* ---------------------------------------------------------------- */
  /* The scorecard                                                      */
  /* ---------------------------------------------------------------- */

  /** Where a line stands now, in the unit it is measured in. */
  const nowOf = (l) => {
    if (l.targetKind === 'percent') {
      const state = l.creditedRatio == null ? (
        <Tooltip title="Nothing has finished yet that had a date to meet">
          <Box component="span" sx={{ color: 'text.tertiary', whiteSpace: 'nowrap' }}>Nothing due yet</Box>
        </Tooltip>
      ) : (
        <StatusPill tone={l.meetsTarget ? 'success' : 'danger'} title={`${l.driftedCount} of ${l.held} projects drifted`}>
          {fmtPct(l.creditedRatio)} drifted (limit {l.target}%)
        </StatusPill>
      )
      if (!(p.commitments || []).length) return state
      // The rule and the full list sit behind Details, beside the verdict.
      return (
        <Box sx={{
          display: 'inline-flex', flexDirection: compact ? 'row' : 'column', alignItems: compact ? 'center' : 'flex-end', gap: compact ? 2 : 0.5, flexWrap: 'wrap',
        }}
        >
          {state}
          <Button
            variant="text"
            size="small"
            aria-expanded={rulesOpen}
            aria-controls={`commit-rules-${p.id}`}
            onClick={() => setRulesOpen((v) => !v)}
            sx={{ minHeight: 28, py: 0.25, mr: compact ? 0 : -2, ml: compact ? -1 : 0 }}
          >
            {rulesOpen ? 'Hide details' : 'Details'}
          </Button>
        </Box>
      )
    }
    const fig = (n, u) => (
      <Box component="span" sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
        <Box component="span" sx={{ fontWeight: 500 }}>{n}</Box>
        {u && (
          <Box
            component="span"
            title={u}
            sx={{
              color: 'text.secondary', ml: 1, display: 'inline-block', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom',
            }}
          >
            {u}
          </Box>
        )}
      </Box>
    )
    if (l.creditedHours != null && l.targetKind === 'hours') return fig(fmtHours(l.creditedHours), unitShort)
    if (l.creditedMoney != null) return fig(fmtMoneyShort(l.creditedMoney, sym), 'a year')
    if (l.creditedCount != null) return fig(String(l.creditedCount), l.unit || targetUnit(l, settings.savingBasis, sym))
    if (l.creditedHours > 0) return fig(fmtHours(l.creditedHours), unitShort)
    return <Dash title="Not measured from the register" />
  }

  /** Objective 1's commitment: the rule in a sentence, then the dated projects. */
  const commitBlockFor = (l) => {
    if (l.targetKind !== 'percent' || !(p.commitments || []).length) return null
    const per = Math.round((l.perProjectLimit ?? 0.2) * 100)
    const all = p.commitments
    const shown = rulesOpen ? all : all.slice(0, COMMIT_PREVIEW)
    const linesId = `commit-rules-${p.id}`
    return (
      <Box
        // The row toggles the portfolio filter; reading the list must not.
        onClick={(e) => e.stopPropagation()}
        sx={{ mt: 2, maxWidth: '100%', overflow: 'hidden', cursor: 'auto' }}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '72ch' }}>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>My commitment.</Box>
          {' '}Each project below lands on the date beside it. A date may move up to {per}% of that
          project&rsquo;s planned length, and {l.allowedCount === 0
            ? <>at {l.target}% not one of the {l.held} may drift beyond that.</>
            : <>at most {l.allowedCount} of the {l.held} may drift beyond that.</>}
        </Typography>

        <Collapse in={rulesOpen} timeout={180} id={linesId}>
          <Box sx={{ pt: 2, typography: 'body2', color: 'text.secondary', maxWidth: '72ch' }}>
            {/*
              * The two limits, numbered, each with what it comes to for THIS
              * person. "No more than 15%" is not something anybody can hold
              * themselves to while they work; "no more than 2 of your 15" is,
              * and it is the same rule.
              */}
            <Box component="ol" sx={{ m: 0, pl: 5, '& li + li': { mt: 1 } }}>
              <li>
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>Per project — {per}%.</Box>{' '}
                A date may move by up to {per}% of that project&rsquo;s own planned length: a 90-day project may
                move {Math.round(90 * (l.perProjectLimit ?? 0.2))} days, a 30-day one{' '}
                {Math.round(30 * (l.perProjectLimit ?? 0.2))}, and never less than a whole day. What each project
                is allowed is beside it below.
              </li>
              <li>
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>
                  Across everything {l.aggregatesTeam ? 'the team holds' : 'I hold'} — {l.target}%.
                </Box>{' '}
                Of the {l.held} project{l.held === 1 ? '' : 's'} {l.aggregatesTeam ? 'the team is' : 'I am'} PIC of,{' '}
                {l.allowedCount === 0
                  ? <>at {l.target}% not one may drift beyond its own allowance</>
                  : <>at most {l.allowedCount} may drift beyond their own allowance</>}
                . Counted over everything {l.aggregatesTeam ? 'held' : 'I hold'}, not only what has finished, so
                one delivered project and nine untouched ones cannot read as nothing drifted.
              </li>
              <li>
                <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>One free re-plan.</Box>{' '}
                Each project may be re-planned once after requirement gathering, which resets the commitment at no
                cost. A second move counts as drift whatever the dates then say.
              </li>
            </Box>
            <Box
              sx={(t) => ({
                mt: 2, fontWeight: 500, color: l.meetsTarget === false ? t.palette.tone.danger.fg : t.palette.tone.success.fg,
              })}
            >
              {l.driftedCount} of {l.held} drifted ({fmtPct(l.creditedRatio ?? 0)}).{' '}
              {l.headroom != null && (
                l.headroom > 0
                  ? `${l.headroom} more may drift before the ${l.target}% limit is broken.`
                  : l.headroom === 0
                    ? `At the ${l.target}% limit: one more breaks it.`
                    : `${Math.abs(l.headroom)} over the ${l.allowedCount} allowed by the ${l.target}% limit.`
              )}
            </Box>
            {l.judgedDrift != null && l.judgedDrift < l.held && (
              <Box sx={{ mt: 0.5 }}>
                {l.judgedDrift} of {l.held} can be judged so far. The rest are not due yet and have spent none of
                their allowance.
              </Box>
            )}
            {/*
              * The lead's line states the team's book while the list below is
              * the lead's own. Saying so is the difference between a card that
              * aggregates and a card that contradicts itself.
              */}
            {l.aggregatesTeam && (
              <Box sx={{ mt: 0.5 }}>
                Those figures are the whole team&rsquo;s. The dates listed below are {p.nick}&rsquo;s own{' '}
                {all.length} project{all.length === 1 ? '' : 's'}.
              </Box>
            )}
            {(p.drift?.replanned > 0 || p.drift?.backwards > 0) && (
              <Box sx={{ mt: 0.5 }}>
                {p.drift.replanned > 0 && (
                  <>
                    {p.drift.replanned} re-planned once (allowed)
                    {p.drift.overReplanned > 0 && `, ${p.drift.overReplanned} more than once`}.
                  </>
                )}
                {p.drift.backwards > 0 && (
                  <Box component="span" sx={(t) => ({ color: t.palette.tone.warning.fg })}>
                    {p.drift.replanned > 0 ? ' ' : ''}
                    {p.drift.backwards} plan{p.drift.backwards === 1 ? '' : 's'} start after their own due date:
                    data to fix, not scored.
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Collapse>

        <Table
          size="small"
          aria-label="Committed dates"
          sx={{
            mt: 2,
            tableLayout: 'fixed',
            width: '100%',
            '& td': {
              px: 0,
              py: 1,
              height: 32,
              fontSize: '0.8125rem',
              lineHeight: '18px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              borderBottom: 1,
              borderColor: 'border.subtle',
            },
            '& td + td': { pl: 2 },
            '& tr:last-of-type td': { borderBottom: 0 },
          }}
        >
          <TableBody>
            {shown.map((c) => (phone ? (
              // A phone: the name on one line, its key and date under it, the verdict at the right.
              <TableRow key={c.key}>
                <TableCell sx={{ whiteSpace: 'normal !important' }}>
                  <Box sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.summary}</Box>
                  <Box sx={{
                    color: 'text.secondary', fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  >
                    {[c.jiraKey, c.due || null].filter(Boolean).join(', ')}
                    {!c.due && (
                      <Box component="span" sx={(t) => ({ color: t.palette.tone.warning.fg })}>
                        {c.jiraKey ? ', ' : ''}no date committed
                      </Box>
                    )}
                  </Box>
                </TableCell>
                <TableCell
                  align="right"
                  sx={(t) => ({
                    width: 104,
                    verticalAlign: 'top',
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 500,
                    color: c.drifted === null ? t.palette.text.tertiary
                      : c.drifted ? t.palette.tone.danger.fg : t.palette.tone.success.fg,
                  })}
                >
                  {c.drifted === null
                    ? (c.running ? 'running' : 'not due yet')
                    : c.driftDays === 0
                      ? 'on the day'
                      : `+${c.driftDays}d${c.driftAllowance != null ? ` of ${Math.round(c.driftAllowance)}d` : ''}`}
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={c.key}>
                <TableCell sx={{ color: 'text.secondary', width: { xs: '24%', lg: 80 } }}>
                  {c.jiraKey || <Dash />}
                </TableCell>
                <TableCell>
                  <Tooltip title={c.summary} placement="top-start">
                    <Box
                      component="span"
                      sx={{
                        display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {c.summary}
                    </Box>
                  </Tooltip>
                </TableCell>
                <TableCell sx={{ fontVariantNumeric: 'tabular-nums', width: { xs: '30%', lg: 128 } }}>
                  {c.due ? (compact ? c.due : `by ${c.due}`) : (
                    <Box component="span" sx={(t) => ({ color: t.palette.tone.warning.fg })}>no date committed</Box>
                  )}
                  {c.replans > 0 && (
                    <Tooltip title={c.baselineDue
                      ? `First committed to ${c.baselineDue}, re-planned ${c.replans} time${c.replans === 1 ? '' : 's'}`
                      : `Re-planned ${c.replans} times`}
                    >
                      <Box
                        component="span"
                        sx={(t) => ({
                          ml: 1,
                          fontSize: '0.75rem',
                          cursor: 'help',
                          color: c.overReplanned ? t.palette.tone.danger.fg : t.palette.text.tertiary,
                        })}
                      >
                        {c.overReplanned ? `re-planned ×${c.replans}` : 're-planned'}
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell
                  align="right"
                  sx={(t) => ({
                    width: { xs: '22%', lg: 100 },
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 500,
                    color: c.drifted === null ? t.palette.text.tertiary
                      : c.drifted ? t.palette.tone.danger.fg : t.palette.tone.success.fg,
                  })}
                >
                  {/*
                    * Used against allowed, not the overrun on its own. "+24d"
                    * is not something a reader can check; "+24d of 18d" says
                    * what happened and what was permitted, which is the whole
                    * of the rule.
                    */}
                  <Tooltip title={driftNote(c, l.perProjectLimit ?? 0.2)}>
                    <Box component="span" sx={{ cursor: 'help' }}>
                      {c.drifted === null
                        ? (c.running ? 'running' : 'not due yet')
                        : c.driftDays === 0
                          ? `on the day${c.actualEnd ? ` ${c.actualEnd}` : ''}`
                          : `+${c.driftDays}d${c.driftAllowance != null ? ` of ${Math.round(c.driftAllowance)}d` : ''}`}
                    </Box>
                  </Tooltip>
                </TableCell>
              </TableRow>
            )))}
          </TableBody>
        </Table>
        <Button
          variant="text"
          size="small"
          aria-expanded={rulesOpen}
          aria-controls={linesId}
          onClick={() => setRulesOpen((v) => !v)}
          sx={{ mt: 1, ml: -2 }}
        >
          {rulesOpen
            ? (all.length > COMMIT_PREVIEW ? 'Show fewer' : 'Hide the rules')
            : (all.length > COMMIT_PREVIEW ? `Show all ${all.length} projects and the rules` : 'Show the rules')}
        </Button>
        {p.undatedCount > 0 && (
          <Typography variant="body2" sx={(t) => ({ color: t.palette.tone.warning.fg, mt: 1 })}>
            {p.undatedCount} project{p.undatedCount === 1 ? '' : 's'} with no committed date. Objective 1 is not
            complete until every one has one.
          </Typography>
        )}
      </Box>
    )
  }

  const targetField = (l) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: compact ? 'flex-start' : 'flex-end' }}>
      {/* The line states how it is measured, so the editor follows it
          rather than inferring from the objective. */}
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
            ? `Carrying ${fmtMoney(l.creditedMoney, sym)} a year now. Sync the target back to it.`
            : `Carrying ${fmtHours(l.creditedHours)} ${unit} now. Sync the target back to it.`
        }
        >
          <IconButton
            size="small"
            aria-label="Sync target to the register"
            onClick={() => onPersonKpi(p.id, l.id, { target: null })}
            sx={(t) => ({ width: 28, height: 28, color: t.palette.tone.warning.fg })}
          >
            <SyncIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )

  const cols = compact ? 3 : 5
  const kpiTable = (
    <Table
      size="small"
      aria-label={`${p.nick}'s KPI lines`}
      sx={{
        tableLayout: compact ? 'fixed' : 'auto',
        width: '100%',
        '& > thead th, & > tbody > tr > td': { px: { xs: 2, sm: 3 } },
        '& > thead th:first-of-type, & > tbody > tr > td:first-of-type': { pl: { xs: 3, sm: 4 } },
        '& > tbody > tr > td': { verticalAlign: 'top', py: 2 },
      }}
    >
      <TableHead>
        <TableRow>
          <TableCell>Objective</TableCell>
          {!compact && <TableCell align="right" sx={{ width: { lg: 168, xl: 200 } }}>Target</TableCell>}
          <TableCell align="right" sx={{ width: 96 }}>Weight</TableCell>
          {!compact && <TableCell align="right" sx={{ width: { lg: 184, xl: 200 } }}>Now</TableCell>}
          <TableCell padding="none" aria-label="Actions" sx={{ width: compact ? 48 : 56 }} />
        </TableRow>
      </TableHead>
      <TableBody>
        {p.kpiLines.map((l) => {
          const o = l.objective ? OBJ_BY_ID[l.objective] : null
          const idx = o ? OBJECTIVES.findIndex((x) => x.id === o.id) : -1
          const selectable = !!l.objective
          const active = selectable && focus === l.objective
          const commitBlock = commitBlockFor(l)
          const linkLabel = active
            ? 'Clear the portfolio filter'
            : (o && (o.measure === 'ratio' || o.measure === 'hours')
              ? 'See every project behind it'
              : 'Filter the portfolio')
          return (
            <Fragment key={l.id}>
              <TableRow
                hover
                selected={active}
                onClick={selectable ? () => toggleFocus(l.objective) : undefined}
                sx={{ cursor: selectable ? 'pointer' : 'default' }}
              >
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                    {idx >= 0 && (
                      <Box
                        aria-hidden
                        sx={{
                          width: 8, height: 8, borderRadius: '2px', mt: '6px', bgcolor: CHART[mode].series[idx], flexShrink: 0,
                        }}
                      />
                    )}
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body1" sx={{ fontWeight: 500 }}>
                        {l.custom ? l.label : (o ? `Obj ${o.no} — ${o.name}` : l.label)}
                        {l.custom && (
                          <Tooltip title="Edit this KPI line">
                            <IconButton
                              size="small"
                              aria-label="Edit KPI line"
                              sx={{
                                ml: 0.5, width: 28, height: 28, my: -1, color: 'text.secondary',
                              }}
                              onClick={(e) => { e.stopPropagation(); setEditLine({ personId: p.id, line: l }) }}
                            >
                              <EditOutlinedIcon sx={{ fontSize: 16 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                        {(l.manual || l.custom) && (
                          <StatusPill tone="neutral" sx={{ ml: 1 }}>Added</StatusPill>
                        )}
                      </Typography>
                      {l.custom && o && (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          under Obj {o.no} — {o.name}
                        </Typography>
                      )}
                      {selectable && (
                        <Button
                          variant="text"
                          size="small"
                          endIcon={active ? null : <ChevronRightIcon />}
                          aria-pressed={active}
                          onClick={(e) => { e.stopPropagation(); toggleFocus(l.objective) }}
                          sx={{
                            ml: -2, mt: 0.5, minHeight: 28, py: 0.5, textAlign: 'left', justifyContent: 'flex-start', '& .MuiButton-endIcon': { ml: 0.25 },
                          }}
                        >
                          {linkLabel}
                        </Button>
                      )}
                      {compact && (
                        <Box
                          onClick={(e) => e.stopPropagation()}
                          sx={(t) => ({
                            mt: 2,
                            cursor: 'auto',
                            // Stacked under the name, the target reads as a form field: its edge stays.
                            '& .MuiInputBase-root.MuiOutlinedInput-root:not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
                              borderColor: t.palette.border.strong,
                            },
                          })}
                        >
                          <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mb: 1 }}>Target</Typography>
                          {targetField(l)}
                          <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mt: 2, mb: 1 }}>Now</Typography>
                          {nowOf(l)}
                        </Box>
                      )}
                      {!compact && commitBlock}
                    </Box>
                  </Box>
                </TableCell>
                {/* the row toggles the portfolio filter, so the editable
                    cells must not pass their clicks up to it */}
                {!compact && (
                  <TableCell onClick={(e) => e.stopPropagation()} sx={{ cursor: 'auto' }}>
                    {targetField(l)}
                  </TableCell>
                )}
                <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ cursor: 'auto' }}>
                  <PctCell
                    value={l.weight}
                    invalid={!weightOk}
                    onChange={(v) => onPersonKpi(p.id, l.id, { weight: v })}
                  />
                </TableCell>
                {!compact && (
                  <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ cursor: 'auto', pt: '18px !important' }}>
                    {nowOf(l)}
                  </TableCell>
                )}
                <TableCell padding="none" onClick={(e) => e.stopPropagation()} sx={{ cursor: 'auto', pt: '12px !important', pr: 2 }}>
                  <Tooltip title={p.kpiLines.length > 1
                    ? 'Remove this line from the scorecard'
                    : 'A scorecard must keep at least one KPI line'}
                  >
                    <span>
                      <IconButton
                        size="small"
                        aria-label="Remove KPI line"
                        disabled={p.kpiLines.length <= 1}
                        onClick={() => onRemoveLine(p.id, l.id)}
                        sx={(t) => ({
                          width: 32, height: 32, color: 'text.secondary', [t.breakpoints.down('sm')]: { width: 40, height: 40 },
                        })}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
              {compact && commitBlock && (
                <TableRow>
                  <TableCell colSpan={cols} sx={{ pt: '0 !important' }}>{commitBlock}</TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
        <TableRow sx={{ '& > td': { borderTop: 1, borderTopColor: 'border.strong', borderBottom: 0 } }}>
          <TableCell sx={{ fontWeight: 500 }}>
            Total
          </TableCell>
          {/* The saving hours the card carries. Objective 1 states its target
              as a share and objective 3 as a date, so adding the hours-typed
              targets alone would report well short of what this person holds. */}
          <TableCell align="right" sx={compact ? { display: 'none' } : { pr: '32px !important' }}>
            <Tooltip title={`What this card states, added up${p.aggregatesTeam ? ' for the whole team' : ''}: a target typed in hours counts as typed, and a line stated another way contributes the hours behind it. Untouched, it equals the project register exactly; edit a target and this and the figure above both follow.`}>
              <Box sx={{ cursor: 'help', whiteSpace: 'nowrap' }}>
                <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtHours(p.kpiTotals.savingHours)}
                </Box>
                <Box component="span" sx={{ color: 'text.secondary', ml: 1 }}>{unit}</Box>
                {p.hoursOverridden && <StatusPill tone="warning" sx={{ ml: 1 }}>Manual</StatusPill>}
                {Math.abs(p.kpiTotals.savingHours - p.registerHours) > 0.5 && (
                  <Typography variant="body2" sx={(t) => ({ color: t.palette.tone.warning.fg })}>
                    Register says {fmtHours(p.registerHours)}
                  </Typography>
                )}
              </Box>
            </Tooltip>
          </TableCell>
          <TableCell align="right" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', pr: '28px !important' }}>
            {fmtPct(sum)}
          </TableCell>
          {!compact && <TableCell />}
          <TableCell />
        </TableRow>
      </TableBody>
    </Table>
  )

  /* The hours total on a fold: under the table, since the Target column is gone. */
  const compactTotal = compact && (
    <Box sx={{ px: pad, pb: 3, mt: -1, typography: 'body2', color: 'text.secondary' }}>
      Saving hours on this card:{' '}
      <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {fmtHours(p.kpiTotals.savingHours)}
      </Box>{' '}{unit}
      {Math.abs(p.kpiTotals.savingHours - p.registerHours) > 0.5 && `, register says ${fmtHours(p.registerHours)}`}
    </Box>
  )

  const scorecard = (
    <Section
      title="2026 KPI scorecard"
      meta={p.aggregatesTeam
        ? "Team-wide targets: as lead, this card carries the team's overall KPI. Edit any target or weight in place."
        : `${p.nick}'s own targets, not the team's. Edit any target or weight in place.`}
      actions={(
        <>
          <StatusPill tone={weightOk ? 'success' : 'danger'} dot>Weights {fmtPct(sum)}</StatusPill>
          {edited && (
            <Button variant="text" startIcon={<RestartAltIcon />} onClick={() => onResetKpi(p.id)}>
              Reset to default
            </Button>
          )}
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setEditLine({ personId: p.id, line: null })}>
            Add KPI line
          </Button>
        </>
      )}
      padded={false}
    >
      {(!weightOk || drifted.length > 0) && (
        <Box sx={{
          px: pad, pt: 3, pb: 1, display: 'flex', flexDirection: 'column', gap: 2,
        }}
        >
          {!weightOk && (
            <Alert
              severity="error"
              action={(
                <Button color="inherit" variant="text" onClick={() => onRebalance(p.id)}>
                  Rebalance to 100%
                </Button>
              )}
            >
              Weights total {fmtPct(sum)}, not 100%. Saving is blocked until this is exactly 100%: adjust by{' '}
              {sum > 1 ? '−' : '+'}{fmtPct(Math.abs(1 - sum))}.
            </Alert>
          )}
          {drifted.length > 0 && (
            <Alert
              severity="warning"
              icon={<SyncIcon fontSize="inherit" />}
              action={(
                <Button color="inherit" variant="text" startIcon={<SyncIcon />} onClick={() => onSyncTargets(p.id)}>
                  Sync all
                </Button>
              )}
            >
              {drifted.length} target{drifted.length === 1 ? '' : 's'} no longer match what {p.nick} carries.
              Project assignments changed after they were typed.
            </Alert>
          )}
        </Box>
      )}

      <Box sx={{ overflowX: 'auto' }}>{kpiTable}</Box>
      {compactTotal}

      {/* ---------- what the register cannot count ---------- */}
      {softBenefits.length > 0 && (
        <Box sx={{
          px: pad, py: 3, borderTop: 1, borderColor: 'border.subtle',
        }}
        >
          <Typography variant="h3">Soft benefits delivered</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: '72ch' }}>
            From the projects credited to {p.nick}. They carry no hours and no weight.
          </Typography>
          <Box component="ul" sx={{ listStyle: 'none', m: 0, mt: 2, p: 0 }}>
            {softBenefits.map((g) => (
              <Box component="li" key={g.key} sx={{ '& + &': { mt: 2 } }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {g.key}, {g.summary}
                </Typography>
                <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 5, color: 'text.secondary' }}>
                  {g.list.map((b, i) => (
                    <Typography component="li" key={i} variant="body2" sx={{ lineHeight: 1.5 }}>{b}</Typography>
                  ))}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* ---------- objectives added by hand, and lines taken off ---------- */}
      <Box sx={{
        px: pad, py: 3, borderTop: 1, borderColor: 'border.subtle', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
      }}
      >
        {p.addableObjectives.length ? (
          <FormControl size="small" sx={{ minWidth: 260, maxWidth: '100%' }}>
            <InputLabel id={`add-objective-${p.id}`}>Add an objective</InputLabel>
            <Select
              labelId={`add-objective-${p.id}`}
              label="Add an objective"
              value=""
              onChange={(e) => { if (e.target.value) onAddObjective(p.id, e.target.value) }}
            >
              {p.addableObjectives.map((id) => {
                const o = OBJ_BY_ID[id]
                return <MenuItem key={id} value={id}>Obj {o.no} — {o.name}</MenuItem>
              })}
            </Select>
          </FormControl>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {p.nick} already holds all five objectives.
          </Typography>
        )}
        {p.addedObjectives.map((id) => {
          const o = OBJ_BY_ID[id]
          return (
            <Chip
              key={id}
              size="small"
              variant="outlined"
              label={`Obj ${o.no} — ${o.short} (added)`}
              onDelete={() => onRemoveObjective(p.id, id)}
            />
          )
        })}
        {removed.length > 0 && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', ml: { md: 'auto' },
          }}
          >
            <Typography variant="body2" sx={{ color: 'text.secondary', mr: 0.5 }}>Removed from this card:</Typography>
            {removed.map((l) => {
              const o = l.objective ? OBJ_BY_ID[l.objective] : null
              return (
                <Tooltip key={l.id} title="Put this line back on the card">
                  <Chip
                    size="small"
                    variant="outlined"
                    icon={<UndoIcon />}
                    label={o ? `Obj ${o.no} — ${o.short}` : l.label?.split('—')[0].trim()}
                    onClick={() => onRestoreLine(p.id, l.id)}
                  />
                </Tooltip>
              )
            })}
          </Box>
        )}
      </Box>
    </Section>
  )

  /* ---------------------------------------------------------------- */
  /* Portfolio                                                          */
  /* ---------------------------------------------------------------- */
  const rows = visibleRows
    .slice()
    .sort((a, b) => (b.p.savingHours ?? 0) * b.share - (a.p.savingHours ?? 0) * a.share)
  const ownerOf = (pr) => (p.aggregatesTeam
    ? (people.find((x) => x.id === pr.pic)?.nick
      || (pr.pic === 'it' ? 'IT' : plan.assignees?.find((x) => x.id === pr.pic)?.nick)
      || null)
    : (pr.contributors?.find((c) => c.person === p.id)?.roles.join('/')
      || (pr.pic === p.id ? 'pic' : null)))

  const portfolioMeta = focusObj
    ? (wholeBook
      ? `Showing every project: objective ${focusObj.no} is calculated over all ${visibleRows.length} of them.`
      : `Showing ${visibleRows.length} of ${p.scorecardRows.length} projects that serve objective ${focusObj.no}.`)
    : p.aggregatesTeam
      ? 'Every in-plan project across the team, at full value. Edits here change the register.'
      : 'Credited hours are project hours times this person’s share. Edits here change the register.'

  const stickyKey = {
    position: 'sticky',
    left: 0,
    zIndex: 1,
    bgcolor: 'bg.surface',
    boxShadow: (t) => `inset -1px 0 0 ${t.palette.border.subtle}`,
    '.is-scrolled &': { boxShadow: (t) => `inset -1px 0 0 ${t.palette.border.strong}, 4px 0 8px -4px ${t.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(16,24,40,0.12)'}` },
    '.MuiTableRow-hover:hover > &': { bgcolor: 'bg.subtle' },
  }
  const money = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  const portfolioTable = (
    <ScrollX label={`${p.nick}'s project portfolio, scroll sideways for more columns`}>
      {/* Thirteen columns: the card scrolls them, the page never does. */}
      <Table size="small" sx={{ minWidth: 1080, '& td, & th': { px: 2 }, '& td:first-of-type, & th:first-of-type': { pl: 4 } }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ ...stickyKey, bgcolor: 'bg.subtle', zIndex: 2, minWidth: 104 }}>Jira</TableCell>
            <TableCell sx={{ minWidth: 220 }}>Project</TableCell>
            <TableCell sx={{ minWidth: 104 }}>{p.aggregatesTeam ? 'Owner' : 'Role'}</TableCell>
            {/* On the team card every row is credited whole, so Share and
                Credited are constants — dropping them is what leaves room
                for the money columns. */}
            {!p.aggregatesTeam && <TableCell align="right" sx={{ minWidth: 64 }}>Share</TableCell>}
            <TableCell align="right" sx={{ minWidth: 104 }}>Saving {unitShort}</TableCell>
            {!p.aggregatesTeam && <TableCell align="right" sx={{ minWidth: 88 }}>Credited</TableCell>}
            <TableCell align="right" sx={{ minWidth: 96 }}>Mandays</TableCell>
            <TableCell align="right" sx={{ minWidth: 80 }}>Cash/yr</TableCell>
            <TableCell align="right" sx={{ minWidth: 92 }}>Benefit/yr</TableCell>
            <TableCell align="right" sx={{ minWidth: 72 }}>ROI</TableCell>
            <TableCell align="right" sx={{ minWidth: 80 }}>Payback</TableCell>
            <TableCell sx={{ minWidth: 120 }}>Level</TableCell>
            <TableCell padding="none" aria-label="Costs" sx={{ width: 48, pr: 2 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(({ p: pr, share }) => {
            // On the team card the Role column names the owner instead,
            // since every row belongs to someone.
            const roles = ownerOf(pr)
            const counted = pr.commitLevel === 'commit' || pr.commitLevel === 'stretch'
            // A deferred or excluded project credits nothing. Printing
            // its share here would contradict the totals above it.
            const credited = counted ? (pr.savingHours ?? 0) * share : 0
            const dim = counted ? 'text.primary' : 'text.tertiary'
            return (
              <TableRow key={pr.key} hover sx={{ '& > td': { color: dim } }}>
                <TableCell sx={{ ...stickyKey, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 500 }}>{pr.key}</TableCell>
                <TableCell>
                  <Tooltip title={pr.summary} placement="top-start" enterDelay={500}>
                    <Typography
                      variant="body2"
                      sx={{
                        color: 'inherit',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                        fontSize: '0.875rem',
                        lineHeight: '20px',
                      }}
                    >
                      {pr.summary}
                    </Typography>
                  </Tooltip>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Obj {OBJ_BY_ID[pr.objective]?.no}, {pr.srcStatus || pr.status}
                  </Typography>
                </TableCell>
                <TableCell>
                  {p.aggregatesTeam ? (
                    <Select
                      size="small"
                      displayEmpty
                      value={pr.pic ?? ''}
                      onChange={(e) => onUpdate(pr.key, { pic: e.target.value || null })}
                      inputProps={{ 'aria-label': `Owner of ${pr.key}` }}
                      sx={[inlineSelectSx, { width: 104 }]}
                      renderValue={(v) => (v
                        ? (plan.assignees || people).find((x) => x.id === v)?.nick
                        : <Box component="span" sx={{ color: 'text.tertiary' }}>TBC</Box>)}
                    >
                      <MenuItem value=""><em>TBC</em></MenuItem>
                      {(plan.assignees || people).map((x) => (
                        <MenuItem key={x.id} value={x.id}>{x.nick}</MenuItem>
                      ))}
                    </Select>
                  ) : (roles || <Dash />)}
                </TableCell>
                {!p.aggregatesTeam && <TableCell align="right" sx={money}>{fmtPct(share)}</TableCell>}
                <TableCell align="right">
                  <PortfolioNum
                    value={pr.savingHours}
                    label={`Saving hours for ${pr.key}`}
                    onChange={(v) => onUpdate(pr.key, { savingHours: v, savingEstimated: v == null })}
                  />
                </TableCell>
                {!p.aggregatesTeam && (
                  <TableCell align="right" sx={{ ...money, fontWeight: 500 }}>
                    {!counted ? (
                      <Tooltip title={`${COMMIT_LABEL[pr.commitLevel] || pr.commitLevel}: credits nothing this year`}>
                        <span><Dash /></span>
                      </Tooltip>
                    ) : pr.savingHours == null ? <Dash /> : fmtHours(credited)}
                  </TableCell>
                )}
                {/* Effort is editable here too, so a scorecard can be
                    costed without leaving the page — the ROI beside it
                    fills in as soon as a manday lands. */}
                <TableCell align="right">
                  {pr.tasks && pr.tasks.length ? (
                    <Tooltip title={`${pr.tasks.length} task${pr.tasks.length === 1 ? '' : 's'} totalling ${fmtHours(pr.manday)} mandays. Open the breakdown.`}>
                      <Box
                        component="button"
                        type="button"
                        onClick={() => setCostKey(pr.key)}
                        sx={{
                          border: 0,
                          background: 'none',
                          p: 0,
                          pr: 2,
                          cursor: 'pointer',
                          font: 'inherit',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'primary.text',
                          textDecoration: 'underline dotted',
                          textUnderlineOffset: 3,
                        }}
                      >
                        {fmtHours(pr.manday)}
                      </Box>
                    </Tooltip>
                  ) : (
                    <PortfolioNum
                      value={pr.manday || null}
                      label={`Mandays for ${pr.key}`}
                      onChange={(v) => onUpdate(pr.key, { manday: v ?? 0, mandayEstimated: false })}
                    />
                  )}
                </TableCell>
                {/* The cash half on its own, so a benefit that is not
                    time can be seen rather than inferred from a total. */}
                <TableCell align="right" sx={money}>
                  {!counted || !pr.monetaryAnnualBenefit
                    ? <Dash />
                    : (
                      <Tooltip title={`${fmtMoney(pr.monetaryAnnualBenefit, sym)} a year on the project, credited at ${Math.round(share * 100)}%. Counted in the benefit and the ROI beside it.`}>
                        <span>{fmtMoneyShort(pr.monetaryAnnualBenefit * share, sym)}</span>
                      </Tooltip>
                    )}
                </TableCell>
                <TableCell align="right" sx={money}>
                  {!counted || pr.annualBenefit == null
                    ? <Dash />
                    : (
                      <Tooltip title={pr.monetaryAnnualBenefit
                        ? `${fmtMoney((pr.hoursMonthlyBenefit || 0) * 12 * share, sym)} from the hours plus ${fmtMoney(pr.monetaryAnnualBenefit * share, sym)} cash`
                        : `${fmtMoney(pr.annualBenefit * share, sym)} a year, all of it from the hours released`}
                      >
                        <span>{fmtMoneyShort(pr.annualBenefit * share, sym)}</span>
                      </Tooltip>
                    )}
                </TableCell>
                <TableCell align="right" sx={money}>
                  {!counted || pr.roi == null ? (
                    <Tooltip title={
                      pr.savingHours == null
                        ? 'Saving hours are still TBC'
                        : !counted
                          ? 'Out of plan: credits nothing this year'
                          : `No cost entered. This project can absorb ${Math.round(pr.affordableMandays).toLocaleString()} mandays and still clear the gate. Open its costs to add CAPEX or a monthly cost.`
                    }
                    >
                      <Box component="span" sx={{ cursor: 'help' }}><Dash /></Box>
                    </Tooltip>
                  ) : (
                    <Tooltip title={`${fmtMoney(pr.netHorizonBenefit, sym)} back over ${fin.horizonMonths} months, after ${fmtMoney(pr.opexRunRate, sym)} a month of OPEX, against ${fmtMoney(pr.investment, sym)} invested (build ${fmtMoney(pr.buildCost ?? 0, sym)} plus CAPEX ${fmtMoney(pr.capex ?? 0, sym)}). ${pr.paybackMonths == null ? 'It never pays back.' : `Pays back in ${fmtMonths(pr.paybackMonths)}.`} Gate ${fmtRoi(fin.roiGate)}.`}>
                      <Box
                        component="span"
                        sx={(t) => ({ cursor: 'help', color: pr.gate === 'pass' ? 'inherit' : t.palette.tone.danger.fg })}
                      >
                        {fmtRoi(pr.roi)}
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="right" sx={money}>
                  {!counted || pr.investment == null ? (
                    <Dash />
                  ) : pr.paybackMonths == null ? (
                    <Tooltip title={`The ${fmtMoney(pr.opexRunRate, sym)} a month of OPEX is at or above the ${fmtMoney(pr.monthlyBenefit ?? 0, sym)} a month this returns, so it never pays back.`}>
                      <Box component="span" sx={(t) => ({ color: t.palette.tone.danger.fg, cursor: 'help' })}>Never</Box>
                    </Tooltip>
                  ) : (
                    <Tooltip title={`${fmtMoney(pr.investment, sym)} invested against ${fmtMoney(pr.netMonthly, sym)} a month net of OPEX, repaid in ${fmtMonths(pr.paybackMonths)}. The gate is ${fmtMonths(gateAsPaybackMonths(fin))}.`}>
                      <Box
                        component="span"
                        sx={(t) => ({ cursor: 'help', color: pr.gate === 'pass' ? 'inherit' : t.palette.tone.danger.fg })}
                      >
                        {fmtMonthsShort(pr.paybackMonths)}
                      </Box>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    size="small"
                    value={pr.commitLevel}
                    onChange={(e) => onUpdate(pr.key, { commitLevel: e.target.value })}
                    inputProps={{ 'aria-label': `Commit level of ${pr.key}` }}
                    sx={[inlineSelectSx, { width: 120 }]}
                    renderValue={(v) => (
                      <Box
                        component="span"
                        sx={(t) => ({ color: OUT_OF_PLAN.has(v) ? t.palette.tone.warning.fg : 'inherit' })}
                      >
                        {COMMIT_LABEL[v] || v}
                      </Box>
                    )}
                  >
                    {COMMIT_LEVELS.map((c) => (
                      <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell padding="none" sx={{ pr: 2 }}>
                  <Tooltip title={`Costs and notes for ${pr.jiraKey || pr.key}${pr.comment ? ' (has notes)' : ''}`}>
                    <IconButton
                      size="small"
                      onClick={() => setCostKey(pr.key)}
                      aria-label="open cost breakdown"
                      sx={(t) => ({ width: 32, height: 32, color: pr.comment ? t.palette.primary.text : t.palette.text.secondary })}
                    >
                      <ReceiptLongOutlinedIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </ScrollX>
  )

  /* A phone: one row per project, its name, a meta line and the figure. Tap for its costs. */
  const portfolioList = (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {rows.map(({ p: pr, share }) => {
        const counted = pr.commitLevel === 'commit' || pr.commitLevel === 'stretch'
        const roles = ownerOf(pr)
        const figure = p.aggregatesTeam
          ? pr.savingHours
          : (counted && pr.savingHours != null ? (pr.savingHours ?? 0) * share : null)
        return (
          <Box component="li" key={pr.key} sx={{ '& + &': { borderTop: 1, borderColor: 'border.subtle' } }}>
            <ButtonBase
              onClick={() => setCostKey(pr.key)}
              aria-label={`${pr.summary}: open costs`}
              sx={{
                width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 3, px: 3, py: 2.5, minHeight: 56,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: 500,
                    color: counted ? 'text.primary' : 'text.secondary',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {pr.summary}
                </Typography>
                <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                  {[pr.key, roles, `Obj ${OBJ_BY_ID[pr.objective]?.no ?? '–'}`].filter(Boolean).join(', ')}
                </Typography>
              </Box>
              <Box sx={{
                flexShrink: 0, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5,
              }}
              >
                <Typography variant="body1" sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {figure == null ? <Dash /> : fmtHours(figure)}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.tertiary' }}>{unitShort}</Typography>
                {!counted && <StatusPill tone="neutral">{COMMIT_LABEL[pr.commitLevel] || pr.commitLevel}</StatusPill>}
              </Box>
            </ButtonBase>
          </Box>
        )
      })}
    </Box>
  )

  const portfolio = (
    <Section
      title={p.aggregatesTeam ? 'Team project portfolio' : 'Project portfolio'}
      meta={portfolioMeta}
      actions={focusObj ? (
        <Chip
          size="small"
          variant="outlined"
          label={`Obj ${focusObj.no} — ${focusObj.short}`}
          onDelete={() => setFocus(null)}
          sx={{ height: 28 }}
        />
      ) : null}
      padded={false}
    >
      {phone ? portfolioList : portfolioTable}
    </Section>
  )

  /* ---------------------------------------------------------------- */
  return (
    <Box>
      <PageHeader title="Scorecards" description={description} help={help}>
        <Box
          sx={(t) => ({
            position: 'relative',
            borderBottom: 1,
            borderColor: 'border.subtle',
            // A phone scrolls the names sideways; the fade says there are more.
            [t.breakpoints.down('sm')]: {
              '&::after': {
                content: '""',
                position: 'absolute',
                top: 0,
                right: 0,
                bottom: 0,
                width: 24,
                pointerEvents: 'none',
                background: `linear-gradient(to left, ${t.palette.bg.page}, transparent)`,
              },
            },
          })}
        >
          <Tabs
            value={p.id}
            onChange={(_e, v) => { setWho(v); setRulesOpen(false) }}
            variant="scrollable"
            scrollButtons={false}
            aria-label="People"
            sx={{ minHeight: 56, mb: '-1px', '& .MuiTab-root': { minHeight: 56, alignItems: 'flex-start', px: 3 } }}
          >
            {people.map((x) => {
              const n = x.aggregatesTeam ? x.scorecardCount : x.countedCount
              return (
                <Tab
                  key={x.id}
                  value={x.id}
                  label={(
                    <Box component="span" sx={{ display: 'block', textAlign: 'left' }}>
                      <Box component="span" sx={{ display: 'block', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {x.nick}{x.aggregatesTeam && ' (team)'}
                      </Box>
                      <Box
                        component="span"
                        sx={{
                          display: 'block', typography: 'caption', color: 'text.tertiary', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {fmtHours(x.scorecardHours)} hrs, {n} project{n === 1 ? '' : 's'}
                      </Box>
                    </Box>
                  )}
                />
              )
            })}
          </Tabs>
        </Box>
      </PageHeader>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }}>
        <Box>
          <Typography variant="h2">{p.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {BAND_LABEL[p.band] || 'Team member'}, {heldObjectives(p.objectives).replace(/^H/, 'h').replace(/^N/, 'n')}
          </Typography>
        </Box>

        {figures}

        {p.hours === 0 && (
          <Alert severity="warning" variant="outlined">
            {p.nick} carries no quantified saving hours, so a saving-hours target would mean nothing. Move
            quantified work to them on the Projects page, or set their targets by hand below.
          </Alert>
        )}

        {scorecard}
        {portfolio}
      </Box>

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
