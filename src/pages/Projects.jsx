import { useState, useMemo } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel,
  TextField, Select, MenuItem, InputAdornment, Checkbox, Button, Stack, Tooltip,
  FormControl, InputLabel, TableContainer, Menu, Alert, IconButton, CircularProgress, Link,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import SearchIcon from '@mui/icons-material/Search'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import { OBJECTIVES, OBJ_BY_ID, COMMIT_LEVELS, STATUS, CHART, OUT_OF_PLAN } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths, fmtMonthsShort, gateAsPaybackMonths, workingDaysBetween,
} from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

const COMMIT_COLOR = {
  commit: STATUS.good,
  stretch: '#2a78d6',
  watch: STATUS.warning,
  // Deferred — a distinct hue from commit/stretch/watch so the dot reads at a
  // glance, though the label beside it always carries the meaning too.
  nextyear: '#7c5cd6',
  excluded: '#898781',
}

/** Free-text cell that only commits on blur. */
function TextCell({ value, onChange, placeholder, width, bold }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== (value ?? '')) setDraft(value ?? '')
  return (
    <TextField
      size="small"
      variant="standard"
      fullWidth={!width}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const next = draft.trim() || null
        if (next !== (value ?? null)) onChange(next)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputProps={{ style: { fontSize: '0.8125rem', fontWeight: bold ? 500 : 400 } }}
      sx={{ width }}
    />
  )
}

/** Number cell that only commits on blur, so typing never fights React state. */
function NumCell({ value, onChange, placeholder = '—', width = 76, estimated }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== (value == null ? '' : String(value))) {
    setDraft(value == null ? '' : String(value))
  }
  return (
    <TextField
      size="small"
      variant="standard"
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const t = draft.trim()
        if (t === '') { if (value != null) onChange(null); return }
        const n = Number(t.replace(/,/g, ''))
        if (Number.isFinite(n) && n >= 0) { if (n !== value) onChange(n) }
        else setDraft(value == null ? '' : String(value))
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputProps={{
        style: {
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontSize: '0.8125rem',
          fontStyle: estimated && value != null ? 'italic' : 'normal',
        },
      }}
      sx={{ width }}
    />
  )
}

export default function Projects({
  plan, onUpdate, onBulk, onAdd, onDelete,
  onSave, dirty, saving, lastSaved, scenarioName, blocked = [], onGoTo,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { projects, people, finance: fin } = plan
  const sym = fin.symbol
  const horizon = fin.horizonMonths
  // Includes partner teams like IT, which can own delivery without holding a
  // scorecard. Their hours fall to the team lead.
  const assignees = plan.assignees || people

  const [q, setQ] = useState('')
  const [fObj, setFObj] = useState('all')
  const [fPic, setFPic] = useState('all')
  const [fCommit, setFCommit] = useState('all')
  const [fGap, setFGap] = useState('all')
  const [fTeam, setFTeam] = useState('all')
  const [fHc, setFHc] = useState('all')
  const [sort, setSort] = useState({ by: 'savingHours', dir: 'desc' })
  const [sel, setSel] = useState(() => new Set())
  const [bulkEl, setBulkEl] = useState(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = projects.filter((p) => {
      const hay = `${p.key} ${p.jiraKey ?? ''} ${p.summary} ${p.program ?? ''} ${p.team ?? ''} ${p.subTeam ?? ''} ${p.assignee ?? ''}`
      if (needle && !hay.toLowerCase().includes(needle)) return false
      if (fObj !== 'all' && p.objective !== fObj) return false
      if (fPic !== 'all' && (fPic === 'none' ? !!p.pic : p.pic !== fPic)) return false
      if (fCommit !== 'all' && p.commitLevel !== fCommit) return false
      if (fGap === 'saving' && p.savingHours != null) return false
      if (fGap === 'pic' && !!p.pic) return false
      if (fGap === 'manday' && p.manday > 0) return false
      if (fGap === 'gate' && p.gate !== 'fail') return false
      if (fGap === 'pastdue' && !p.pastDue) return false
      if (fGap === 'nokey' && p.jiraKey) return false
      if (fTeam !== 'all' && (p.team || '') !== fTeam) return false
      if (fHc !== 'all') {
        const hc = p.hc || 0
        if (fHc === 'some' && hc <= 0) return false
        if (fHc === 'none' && hc > 0) return false
        if (fHc.startsWith('gte') && hc < Number(fHc.slice(3))) return false
      }
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    out = [...out].sort((a, b) => {
      const va = a[sort.by], vb = b[sort.by]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
    return out
  }, [projects, q, fObj, fPic, fCommit, fGap, fTeam, fHc, sort])

  const teams = useMemo(
    () => [...new Set(projects.map((p) => p.team).filter(Boolean))].sort(),
    [projects],
  )
  const filtersOn =
    q.trim() !== '' || [fObj, fPic, fCommit, fGap, fTeam, fHc].some((f) => f !== 'all')

  const head = (id, label, align = 'left', minWidth) => (
    <TableCell align={align} sortDirection={sort.by === id ? sort.dir : false} sx={minWidth ? { minWidth } : undefined}>
      <TableSortLabel
        active={sort.by === id}
        direction={sort.by === id ? sort.dir : 'asc'}
        onClick={() => setSort((s) => ({ by: id, dir: s.by === id && s.dir === 'desc' ? 'asc' : 'desc' }))}
      >
        {label}
      </TableSortLabel>
    </TableCell>
  )

  const allSelected = rows.length > 0 && rows.every((r) => sel.has(r.key))
  const toggleAll = () => {
    setSel(allSelected ? new Set() : new Set(rows.map((r) => r.key)))
  }
  const applyBulk = (patch) => {
    onBulk([...sel], patch)
    setSel(new Set())
    setBulkEl(null)
  }

  const registerHours = useMemo(
    () => projects.reduce((a, p) => a + (p.savingHours ?? 0), 0),
    [projects],
  )

  /*
   * The source workbook carries no build effort at all, so every ROI starts
   * blank. Rather than invent a number and present it as data, this offers one
   * anchored to what the team actually has: a year of its own capacity, spread
   * across the uncosted projects in proportion to how long each one runs.
   *
   * Anchoring on capacity matters. A naive "half a developer per project" over
   * 86 projects produced 4,162 mandays — sixteen person-years out of a
   * six-person team — and turned the portfolio return negative on an assumption
   * nobody had made deliberately. Capacity cannot exceed what exists, so the
   * total is defensible by construction and the split is the only judgement.
   *
   * Duration, not saving hours. Deriving effort from the benefit would make
   * every ROI identical and the whole measure circular.
   *
   * Everything it writes stays flagged `mandayEstimated`, so the table shows it
   * in the estimate style and the data-quality count keeps calling it a guess
   * until someone types a real number over it.
   */
  const teamSize = people.length
  const capacityMandays = Math.round(teamSize * fin.daysPerFteMonth * 12)
  const uncosted = useMemo(
    () => rows.filter((p) => !(p.manday > 0) && p.savingHours != null && p.start && p.due),
    [rows],
  )
  const estimateEffort = () => {
    const spans = uncosted.map((p) => ({ key: p.key, days: Math.max(1, workingDaysBetween(p.start, p.due)) }))
    const totalDays = spans.reduce((a, s) => a + s.days, 0)
    if (!spans.length || totalDays <= 0) return
    // Whatever capacity the already-costed rows have not claimed.
    const spent = rows.reduce((a, p) => a + (p.manday || 0), 0)
    const pool = Math.max(spans.length, capacityMandays - spent)
    const patch = {}
    for (const s of spans) patch[s.key] = Math.max(1, Math.round((s.days / totalDays) * pool))
    if (!confirm(
      `Spread ${pool.toLocaleString()} mandays across ${spans.length} project${spans.length === 1 ? '' : 's'}, `
      + `in proportion to how long each one runs?\n\n`
      + `That is one year of your team's capacity — ${teamSize} people x ${Math.round(fin.daysPerFteMonth * 12)} working days`
      + `${spent > 0 ? `, less the ${Math.round(spent).toLocaleString()} already entered` : ''}.\n\n`
      + `A starting point for the ROI column, not a measurement. Every value stays marked as an estimate and you can type over any of them.`,
    )) return
    for (const k of Object.keys(patch)) onUpdate(k, { manday: patch[k], mandayEstimated: true })
  }

  /** Totals for whatever the filters currently show — recomputed on every change. */
  const agg = useMemo(() => {
    const savingRows = rows.filter((p) => p.savingHours != null)
    const hours = savingRows.reduce((a, p) => a + p.savingHours, 0)
    const hc = rows.reduce((a, p) => a + (p.hc || 0), 0)
    const manday = rows.reduce((a, p) => a + (p.manday || 0), 0)

    // Money for whatever is on screen. Benefit covers every quantified row;
    // cost and ROI cover only the rows that carry an effort estimate, because
    // dividing the whole view's benefit by a partial cost reports a return
    // nobody earned. `roiRows` says how many rows the ROI actually spans.
    // Out-of-plan rows contribute no money anywhere else in the app, so they
    // must not contribute here either — otherwise filtering to "Next year"
    // shows a cost and a return the Dashboard says do not exist.
    const inPlanRows = rows.filter((p) => !OUT_OF_PLAN.has(p.commitLevel))
    const annualBenefit = inPlanRows.reduce((a, p) => a + (p.annualBenefit || 0), 0)
    const costedRows = inPlanRows.filter((p) => p.buildCost != null && p.horizonBenefit != null)
    const buildCost = costedRows.reduce((a, p) => a + p.buildCost, 0)
    const costedBenefit = costedRows.reduce((a, p) => a + p.horizonBenefit, 0)

    return {
      count: rows.length,
      hours,
      hc,
      manday,
      annualBenefit,
      buildCost: costedRows.length ? buildCost : null,
      roi: buildCost > 0 ? (costedBenefit - buildCost) / buildCost : null,
      roiRows: costedRows.length,
      inPlanCount: inPlanRows.length,
      done: rows.filter((p) => p.status === 'Done').reduce((a, p) => a + (p.savingHours ?? 0), 0),
      tbc: rows.filter((p) => p.savingHours == null).length,
      // Denominator is the whole register, so a view filtered to deferred or
      // excluded rows can never read over 100%.
      pctOfBook: registerHours > 0 ? hours / registerHours : 0,
      deferred: rows
        .filter((p) => OUT_OF_PLAN.has(p.commitLevel))
        .reduce((a, p) => a + (p.savingHours ?? 0), 0),
    }
  }, [rows, registerHours])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info" variant="outlined">
        Every cell is editable — name, team, programme, <strong>PIC</strong>, <strong>saving hrs/month</strong>,{' '}
        <strong>HC</strong>, <strong>mandays</strong>, <strong>objective</strong> and <strong>commit level</strong> —
        and each edit recalculates the dashboard, the scorecards and the export live. Use <strong>Add project</strong>{' '}
        for anything not yet in the source file, and the bin icon to remove a row. Saving hours are{' '}
        <strong>per month</strong>, matching the source workbook's <em>Saving hrs/mth</em> column.
      </Alert>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ lg: 'center' }}>
          <TextField
            size="small"
            placeholder="Search key, project, team, assignee…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 280, flex: 1 }}
          />
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>Objective</InputLabel>
            <Select label="Objective" value={fObj} onChange={(e) => setFObj(e.target.value)}>
              <MenuItem value="all">All objectives</MenuItem>
              {OBJECTIVES.map((o) => <MenuItem key={o.id} value={o.id}>{o.no}. {o.short}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>PIC</InputLabel>
            <Select label="PIC" value={fPic} onChange={(e) => setFPic(e.target.value)}>
              <MenuItem value="all">All PICs</MenuItem>
              <MenuItem value="none">Unassigned</MenuItem>
              {people.map((p) => <MenuItem key={p.id} value={p.id}>{p.nick}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 128 }}>
            <InputLabel>Team</InputLabel>
            <Select label="Team" value={fTeam} onChange={(e) => setFTeam(e.target.value)}>
              <MenuItem value="all">All teams</MenuItem>
              {teams.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 158 }}>
            <InputLabel>Headcount</InputLabel>
            <Select label="Headcount" value={fHc} onChange={(e) => setFHc(e.target.value)}>
              <MenuItem value="all">Any headcount</MenuItem>
              <MenuItem value="some">Has headcount (&gt; 0)</MenuItem>
              <MenuItem value="none">No headcount</MenuItem>
              <MenuItem value="gte0.5">0.5 HC or more</MenuItem>
              <MenuItem value="gte1">1 HC or more</MenuItem>
              <MenuItem value="gte3">3 HC or more</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 130 }}>
            <InputLabel>Commit</InputLabel>
            <Select label="Commit" value={fCommit} onChange={(e) => setFCommit(e.target.value)}>
              <MenuItem value="all">All levels</MenuItem>
              {COMMIT_LEVELS.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 165 }}>
            <InputLabel>Data gap</InputLabel>
            <Select label="Data gap" value={fGap} onChange={(e) => setFGap(e.target.value)}>
              <MenuItem value="all">Everything</MenuItem>
              <MenuItem value="saving">Missing saving hrs</MenuItem>
              <MenuItem value="nokey">Missing Jira key</MenuItem>
              <MenuItem value="pic">Missing PIC</MenuItem>
              <MenuItem value="manday">No effort estimate</MenuItem>
              <MenuItem value="gate">Below the ROI gate</MenuItem>
              <MenuItem value="pastdue">Past due, not done</MenuItem>
            </Select>
          </FormControl>
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Showing {rows.length} of {projects.length} projects
          </Typography>
          {filtersOn && (
            <Button
              size="small"
              onClick={() => {
                setQ(''); setFObj('all'); setFPic('all'); setFCommit('all')
                setFGap('all'); setFTeam('all'); setFHc('all')
              }}
            >
              Clear filters
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          {uncosted.length > 0 && (
            <Tooltip title={`Spreads a year of the team's capacity — ${teamSize} people, about ${capacityMandays.toLocaleString()} mandays — across the ${uncosted.length} project${uncosted.length === 1 ? '' : 's'} in view that carry no effort, in proportion to how long each runs. A starting point to edit, not a measurement; every value stays marked as an estimate.`}>
              <Button size="small" variant="outlined" startIcon={<AutoFixHighIcon />} onClick={estimateEffort}>
                Estimate effort ({uncosted.length})
              </Button>
            </Tooltip>
          )}
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={onAdd}>
            Add project
          </Button>
          {sel.size > 0 && (
            <>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{sel.size} selected</Typography>
              <Button
                size="small"
                color="error"
                variant="outlined"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => {
                  if (confirm(`Delete ${sel.size} project${sel.size === 1 ? '' : 's'}? This cannot be undone (reload the baseline from the ⋮ menu to restore).`)) {
                    onDelete([...sel]); setSel(new Set())
                  }
                }}
              >
                Delete
              </Button>
              <Button size="small" variant="outlined" onClick={(e) => setBulkEl(e.currentTarget)}>
                Bulk edit
              </Button>
              <Menu anchorEl={bulkEl} open={!!bulkEl} onClose={() => setBulkEl(null)}>
                <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}>
                  Set commit level
                </Typography>
                {COMMIT_LEVELS.map((c) => (
                  <MenuItem key={c.id} onClick={() => applyBulk({ commitLevel: c.id })}>{c.label}</MenuItem>
                ))}
                <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary', borderTop: 1, borderColor: 'divider', mt: 1 }}>
                  Assign PIC
                </Typography>
                {people.map((p) => (
                  <MenuItem key={p.id} onClick={() => applyBulk({ pic: p.id })}>{p.nick}</MenuItem>
                ))}
              </Menu>
              <Button size="small" onClick={() => setSel(new Set())}>Clear</Button>
            </>
          )}
          <Tooltip
            title={
              blocked.length
                ? `Blocked: ${blocked.map((x) => `${x.nick} ${Math.round(x.sum * 100)}%`).join(', ')}`
                : dirty ? 'You have unsaved changes' : 'Everything is saved'
            }
          >
            <span>
              <Button
                size="small"
                variant="contained"
                color={blocked.length ? 'error' : dirty ? 'primary' : 'inherit'}
                startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon />}
                onClick={onSave}
                disabled={saving || (!dirty && !blocked.length)}
              >
                {saving ? 'Saving…' : blocked.length ? 'Fix weights to save' : dirty ? 'Save to database' : 'Saved'}
              </Button>
            </span>
          </Tooltip>
        </Stack>
        {blocked.length > 0 ? (
          <Alert severity="error" variant="outlined" sx={{ mt: 1.5, py: 0.25 }}>
            Saving is blocked — {blocked.map((x) => `${x.nick} is at ${Math.round(x.sum * 100)}%`).join(', ')}. Every
            scorecard must total exactly 100%.{' '}
            <Link component="button" onClick={() => onGoTo?.('people')} sx={{ fontWeight: 600 }}>
              Fix on the Scorecards tab →
            </Link>
          </Alert>
        ) : (dirty || lastSaved) && (
          <Typography variant="caption" sx={{ color: dirty ? STATUS.warning : 'text.secondary', display: 'block', mt: 1 }}>
            {dirty
              ? `Unsaved changes to "${scenarioName || 'this scenario'}" — they are held in this browser until you save.`
              : `Saved to the database${lastSaved ? ` at ${new Date(lastSaved).toLocaleTimeString()}` : ''} as "${scenarioName}".`}
          </Typography>
        )}
      </Paper>

      {/* Filter-aware totals — always reflects exactly what the table shows */}
      <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', bgcolor: 'action.hover' }}>
          {[
            { label: 'Projects in view', value: agg.count.toLocaleString(), sub: agg.tbc ? `${agg.tbc} still TBC` : 'all quantified' },
            {
              label: 'Saving hrs / month',
              value: fmtHours(agg.hours),
              sub: agg.deferred > 0
                ? `${fmtHours(agg.deferred)} of it out of plan`
                : `${fmtPct(agg.pctOfBook)} of the register`,
              strong: true,
              tone: agg.deferred > 0 ? STATUS.warning : undefined,
            },
            { label: 'Of which delivered', value: fmtHours(agg.done), sub: 'status Done' },
            { label: 'Headcount', value: agg.hc ? agg.hc.toFixed(1) : '—', sub: 'HC released' },
            { label: 'Mandays', value: agg.manday ? fmtHours(agg.manday) : '—', sub: agg.manday ? 'invested' : 'not entered yet' },
            {
              label: 'Benefit / year',
              value: fmtMoneyShort(agg.annualBenefit, sym),
              sub: `${fmtMoney(fin.acctHourRate, sym)} per saved hour`,
              help: `Saving hours x the accountant rate, annualised. Covers every quantified row in view, whether or not it has an effort estimate.`,
            },
            {
              label: 'Build cost',
              value: fmtMoneyShort(agg.buildCost, sym),
              sub: agg.buildCost == null ? 'no mandays in view' : `${fmtMoney(fin.devDayRate, sym)} per manday`,
              help: 'Mandays x the developer rate, across the rows in view that carry an effort estimate.',
            },
            {
              label: 'ROI',
              value: fmtRoi(agg.roi),
              sub: agg.roi == null
                ? 'needs mandays'
                : `${agg.roiRows} of ${agg.inPlanCount} in-plan rows · gate ${fmtRoi(fin.roiGate)}`,
              tone: agg.roi == null ? undefined : agg.roi >= fin.roiGate ? STATUS.good : STATUS.critical,
              help: `Return over ${horizon} months on what it cost to build, across only the rows in view that carry an effort estimate. Rows without mandays are excluded from BOTH sides, so this is never a whole-book benefit divided by a partial cost.`,
            },
          ].map((t, i) => (
            <Box
              key={t.label}
              sx={{
                flex: '1 1 150px',
                px: 2,
                py: 1.5,
                borderLeft: i === 0 ? 'none' : 1,
                borderColor: 'divider',
                minWidth: 130,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.6875rem' }}>
                  {t.label}
                </Typography>
                {t.help && (
                  <Tooltip title={t.help} arrow>
                    <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', cursor: 'help' }} />
                  </Tooltip>
                )}
              </Box>
              <Typography
                sx={{
                  fontSize: t.strong ? '1.35rem' : '1.15rem',
                  fontWeight: t.strong ? 700 : 600,
                  lineHeight: 1.2,
                  mt: 0.25,
                  fontVariantNumeric: 'tabular-nums',
                  color: t.tone || 'text.primary',
                }}
              >
                {t.value}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t.sub}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '72vh' }}>
        <Table size="small" stickyHeader sx={{ '& th, & td': { px: 1.25 } }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ bgcolor: 'background.paper' }}>
                <Checkbox size="small" checked={allSelected} indeterminate={sel.size > 0 && !allSelected} onChange={toggleAll} />
              </TableCell>
              {head('jiraKey', 'Jira', 'left', 88)}
              {head('summary', 'Project')}
              <TableCell sx={{ minWidth: 118, maxWidth: 140, width: 140 }}>Objective</TableCell>
              <TableCell sx={{ minWidth: 84 }}>PIC</TableCell>
              {head('savingHours', 'Saving hrs/mth', 'right')}
              {head('hc', 'HC', 'right')}
              {head('manday', 'Mandays', 'right')}
              {head('buildCost', 'Build cost', 'right', 78)}
              {head('roi', 'ROI', 'right', 78)}
              {head('paybackMonths', 'Payback', 'right', 74)}
              <TableCell sx={{ minWidth: 104 }}>Commit</TableCell>
              <TableCell sx={{ minWidth: 92, maxWidth: 104, width: 104 }}>Status</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((p) => {
              const objIdx = OBJECTIVES.findIndex((o) => o.id === p.objective)
              return (
                <TableRow
                  key={p.key}
                  hover
                  selected={sel.has(p.key)}
                  sx={{ opacity: OUT_OF_PLAN.has(p.commitLevel) ? 0.55 : 1 }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={sel.has(p.key)}
                      onChange={() => setSel((s) => {
                        const n = new Set(s)
                        n.has(p.key) ? n.delete(p.key) : n.add(p.key)
                        return n
                      })}
                    />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
                    <TextCell
                      value={p.jiraKey}
                      placeholder="no key"
                      width={78}
                      onChange={(v) => onUpdate(p.key, { jiraKey: v })}
                      bold
                    />
                  </TableCell>
                  <TableCell sx={{ maxWidth: 320, minWidth: 240 }}>
                    <TextCell
                      value={p.summary}
                      placeholder="Project name"
                      onChange={(v) => onUpdate(p.key, { summary: v || 'Untitled' })}
                      bold
                    />
                    <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 0.25 }}>
                      <TextCell
                        value={p.team}
                        placeholder="Team"
                        width={58}
                        onChange={(v) => onUpdate(p.key, { team: v })}
                      />
                      <TextCell
                        value={p.subTeam}
                        placeholder="Sub team"
                        width={66}
                        onChange={(v) => onUpdate(p.key, { subTeam: v })}
                      />
                      <TextCell
                        value={p.program}
                        placeholder="Programme"
                        width={76}
                        onChange={(v) => onUpdate(p.key, { program: v })}
                      />
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      variant="standard"
                      value={p.objective}
                      onChange={(e) => onUpdate(p.key, { objective: e.target.value })}
                      // A hard width, not 100%: under table-layout auto the
                      // intrinsic width of "2. Process automation" sets the
                      // column, and maxWidth on the cell is ignored.
                      sx={{ fontSize: '0.8125rem', width: 132, maxWidth: 132 }}
                      renderValue={(v) => {
                        const o = OBJ_BY_ID[v]
                        // Ellipsised rather than allowed to set the column width:
                        // "2. Process automation" alone was pushing the money
                        // columns off the right edge of the table.
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: CHART[mode].series[objIdx], flexShrink: 0 }} />
                            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {o?.no}. {o?.short}
                            </Box>
                          </Box>
                        )
                      }}
                    >
                      {OBJECTIVES.map((o) => <MenuItem key={o.id} value={o.id}>{o.no}. {o.short}</MenuItem>)}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      variant="standard"
                      displayEmpty
                      value={p.pic ?? ''}
                      onChange={(e) => onUpdate(p.key, { pic: e.target.value || null })}
                      sx={{ fontSize: '0.8125rem', width: 76, maxWidth: 76, color: p.pic ? 'text.primary' : STATUS.critical }}
                      renderValue={(v) => (v ? assignees.find((x) => x.id === v)?.nick : 'TBC')}
                    >
                      <MenuItem value=""><em>TBC — unassigned</em></MenuItem>
                      {assignees.map((x) => (
                        <MenuItem key={x.id} value={x.id}>
                          {x.nick} — {x.name}
                          {x.scorecard === false && ' (no scorecard)'}
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell align="right">
                    <NumCell
                      value={p.savingHours}
                      estimated={false}
                      onChange={(v) => onUpdate(p.key, { savingHours: v, savingEstimated: v == null })}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <NumCell
                      value={p.hc}
                      width={48}
                      onChange={(v) => onUpdate(p.key, { hc: v })}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <NumCell
                      value={p.manday}
                      width={56}
                      estimated={p.mandayEstimated}
                      onChange={(v) => onUpdate(p.key, { manday: v ?? 0, mandayEstimated: false })}
                    />
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
                    {p.buildCost == null ? (
                      <Tooltip title={`No effort estimate yet. This project can afford ${p.affordableMandays == null ? '—' : Math.round(p.affordableMandays).toLocaleString()} mandays and still clear the gate.`}>
                        <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    ) : fmtMoneyShort(p.buildCost, sym)}
                  </TableCell>
                  <TableCell align="right">
                    {p.roi == null ? (
                      <Tooltip title={
                        p.savingHours == null
                          ? 'Saving hours are still TBC, so there is no benefit to return.'
                          : `Worth ${fmtMoneyShort(p.annualBenefit, sym)} a year. Enter mandays to get a return — break-even is ${Math.round(p.breakEvenMandays).toLocaleString()} mandays, and ${Math.round(p.affordableMandays).toLocaleString()} clears the gate.`
                      }>
                        <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    ) : (
                      <Tooltip title={`${fmtMoney(p.horizonBenefit, sym)} over ${horizon} months against ${fmtMoney(p.buildCost, sym)} to build — net ${fmtMoney(p.netBenefit, sym)}, paying back in ${fmtMonths(p.paybackMonths)}. Gate is ${fmtRoi(fin.roiGate)}.`}>
                        {/* Benefit per project lives in this tooltip, the totals
                            strip, the scorecard portfolio and the workbook — a
                            column for it as well pushed Commit off the table. */}
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, justifyContent: 'flex-end', cursor: 'help' }}>
                          {p.gate === 'pass'
                            ? <CheckCircleOutlineIcon sx={{ fontSize: 13, color: STATUS.good }} />
                            : <ErrorOutlineIcon sx={{ fontSize: 13, color: STATUS.critical }} />}
                          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.8125rem', color: p.gate === 'pass' ? STATUS.good : STATUS.critical }}>
                            {fmtRoi(p.roi)}
                          </Typography>
                        </Box>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
                    {p.paybackMonths == null ? (
                      <Tooltip title={
                        p.savingHours == null
                          ? 'Saving hours are still TBC, so there is nothing to pay the build back.'
                          : 'Enter mandays to get a payback period.'
                      }>
                        <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    ) : (
                      <Tooltip title={`${fmtMoney(p.buildCost, sym)} to build, returning ${fmtMoney(p.monthlyBenefit, sym)} a month — repaid in ${fmtMonths(p.paybackMonths)}. The gate is a payback of ${fmtMonths(gateAsPaybackMonths(fin))}.`}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontSize: '0.8125rem',
                            fontVariantNumeric: 'tabular-nums',
                            cursor: 'help',
                            color: p.gate === 'pass' ? 'text.primary' : STATUS.critical,
                          }}
                        >
                          {fmtMonthsShort(p.paybackMonths)}
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      variant="standard"
                      value={p.commitLevel}
                      onChange={(e) => onUpdate(p.key, { commitLevel: e.target.value })}
                      sx={{ fontSize: '0.8125rem', width: '100%' }}
                      renderValue={(v) => (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: COMMIT_COLOR[v], flexShrink: 0 }} />
                          {COMMIT_LEVELS.find((c) => c.id === v)?.label}
                        </Box>
                      )}
                    >
                      {COMMIT_LEVELS.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>{c.label}</Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{c.help}</Typography>
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      {p.srcStatus || p.status || '—'}
                    </Typography>
                    {p.pastDue && (
                      // The date lives in the tooltip: spelled out here it was
                      // the widest thing in the column and pushed ROI off-screen.
                      <Tooltip title={`Due ${p.due} and not Done — already past due`}>
                        <Typography
                          variant="caption"
                          sx={{ display: 'block', color: STATUS.critical, fontWeight: 600, whiteSpace: 'nowrap', cursor: 'help' }}
                        >
                          past due
                        </Typography>
                      </Tooltip>
                    )}
                    {p.savingHours == null && (
                      <Tooltip title="Saving hours are TBC in the source — this project cannot be committed until it is quantified">
                        <WarningAmberIcon sx={{ fontSize: 14, color: STATUS.warning, ml: 0.5, verticalAlign: 'middle' }} />
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell padding="checkbox">
                    <Tooltip title="Delete this project">
                      <IconButton
                        size="small"
                        onClick={() => {
                          if (confirm(`Delete "${p.summary}"? This cannot be undone.`)) onDelete([p.key])
                        }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={12} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  No projects match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
