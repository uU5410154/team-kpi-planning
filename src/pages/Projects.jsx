import { useState, useMemo, useRef } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel,
  TextField, Select, MenuItem, InputAdornment, Checkbox, Button, Stack, Tooltip,
  FormControl, InputLabel, TableContainer, Menu, Alert, IconButton, CircularProgress, Link, Popover, Chip,
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
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong'
import { OBJECTIVES, OBJ_BY_ID, COMMIT_LEVELS, STATUS, CHART, OUT_OF_PLAN } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths, fmtMonthsShort, gateAsPaybackMonths, workingDaysBetween,
  normalizeSoftBenefits, softBenefitsText, impliedObjectives,
} from '../lib/model.js'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import ProjectCostDialog from '../components/ProjectCostDialog.jsx'
import ImportDialog from '../components/ImportDialog.jsx'
import { exportFiltered, readProjectsFile, planImport } from '../lib/projectIO.js'
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


/**
 * The soft benefits on a project: a short list, edited as one bullet a line.
 *
 * A popover rather than a cell-sized text box. The register is already wide,
 * and a column big enough to write three sentences in would push the columns
 * that carry numbers off the screen.
 */
function SoftBenefitCell({ value, onChange }) {
  const [anchor, setAnchor] = useState(null)
  const [draft, setDraft] = useState('')
  const list = normalizeSoftBenefits(value)

  const open = (e) => { setDraft(softBenefitsText(value)); setAnchor(e.currentTarget) }
  const close = () => {
    setAnchor(null)
    const next = normalizeSoftBenefits(draft)
    if (JSON.stringify(next) !== JSON.stringify(list)) onChange(next)
  }

  return (
    <>
      <Box
        role="button"
        aria-label="edit soft benefits"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => { if (e.key === 'Enter') open(e) }}
        sx={{
          cursor: 'pointer', minHeight: 28, borderRadius: 1, px: 0.75, py: 0.25,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {list.length ? (
          <>
            {list.slice(0, 2).map((b, i) => (
              <Typography key={i} variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>
                &bull; {b.length > 34 ? `${b.slice(0, 34)}…` : b}
              </Typography>
            ))}
            {list.length > 2 && (
              <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
                +{list.length - 2} more
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>add…</Typography>
        )}
      </Box>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Box sx={{ p: 2, width: 380 }}>
          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Soft benefits</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
            What this delivers that the saving hours do not capture — control, an audit trail, risk removed.
            One per line; they show on the scorecard of everyone credited on it, and in the export.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={4}
            size="small"
            value={draft}
            placeholder={'Removes a manual reconciliation at month end\nFull audit trail on every posting'}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
            <Button size="small" onClick={close}>Done</Button>
          </Box>
        </Box>
      </Popover>
    </>
  )
}


/**
 * The other objectives a project answers to.
 *
 * One piece of work can serve several: a dashboard removes manual work AND is
 * a dashboard delivered. Only the hours objective counts hours, so tagging a
 * project to more of them adds what it delivers without adding its saving
 * hours a second time.
 *
 * The primary tag above stays what the register reports in one column; these
 * are the rest.
 */
function AlsoServes({ project, onChange }) {
  const [anchor, setAnchor] = useState(null)
  const extra = (Array.isArray(project.objectives) ? project.objectives : [])
    .filter((id) => OBJ_BY_ID[id] && id !== project.objective)
  // Every project answers to these two: the return is worked out over all of
  // them and the hours objective collects every saving hour. Shown, not
  // implied — a row naming one objective reads as if the others do not apply.
  const implied = impliedObjectives().filter((id) => id !== project.objective && !extra.includes(id))
  const spare = OBJECTIVES.filter((o) => o.id !== project.objective
    && !extra.includes(o.id) && !implied.includes(o.id))

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap', mt: 0.25 }}>
      {implied.map((id) => (
        <Chip
          key={id}
          size="small"
          variant="outlined"
          label={`+${OBJ_BY_ID[id].no}`}
          title={`Every project serves ${OBJ_BY_ID[id].no}. ${OBJ_BY_ID[id].name} — ${
            OBJ_BY_ID[id].measure === 'ratio'
              ? 'its return is worked out over the whole register'
              : 'its saving hours all count here'}. It cannot be removed.`}
          sx={{ height: 17, fontSize: '0.625rem', fontWeight: 700, opacity: 0.62 }}
        />
      ))}
      {extra.map((id) => (
        <Chip
          key={id}
          size="small"
          label={`+${OBJ_BY_ID[id].no}`}
          title={`Also serves ${OBJ_BY_ID[id].no}. ${OBJ_BY_ID[id].name}`}
          onDelete={() => onChange(extra.filter((x) => x !== id))}
          sx={{ height: 17, fontSize: '0.625rem', fontWeight: 700, '& .MuiChip-deleteIcon': { fontSize: 12 } }}
        />
      ))}
      {spare.length > 0 && (
        <Tooltip title="Also counts toward another objective">
          <IconButton
            size="small"
            aria-label="add objective tag"
            sx={{ p: 0.1 }}
            onClick={(e) => setAnchor(e.currentTarget)}
          >
            <AddIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
      )}
      <Menu open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)}>
        {spare.map((o) => (
          <MenuItem
            key={o.id}
            onClick={() => { onChange([...extra, o.id]); setAnchor(null) }}
          >
            {o.no}. {o.name}
            <Typography variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
              {o.measure === 'count' ? `counts ${o.countUnit}` : o.measure === 'hours' ? 'counts the hours' : o.measure}
            </Typography>
          </MenuItem>
        ))}
      </Menu>
    </Box>
  )
}

/*
 * When this window opened.
 *
 * A row added in this sitting stays at the top of the register however the
 * table is sorted, until the page is reloaded. Pinning by "has no Jira key
 * yet" instead would make the row jump away the moment the key was typed,
 * which is the first thing anyone does to it.
 */
const SESSION_START = Date.now()

export default function Projects({
  plan, onUpdate, onBulk, onAdd, onDelete, onImport,
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
  // A LIST, and empty means everyone. Cutting the register by one person at a
  // time made "these three between them" impossible to look at, which is the
  // question anyone asks before moving work around.
  const [fPic, setFPic] = useState([])
  const [fCommit, setFCommit] = useState('all')
  const [fGap, setFGap] = useState('all')
  const [fTeam, setFTeam] = useState('all')
  const [fHc, setFHc] = useState('all')
  const [sort, setSort] = useState({ by: 'savingHours', dir: 'desc' })
  const [sel, setSel] = useState(() => new Set())
  const [bulkEl, setBulkEl] = useState(null)
  // The KEY, never the project object: the dialog's ROI has to move the instant
  // a CAPEX is typed, and a stored object would still be the pre-edit one.
  const [costKey, setCostKey] = useState(null)
  const [importing, setImporting] = useState(null)   // { result, fileName }
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const costProject = costKey == null ? null : projects.find((x) => x.key === costKey) || null

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = projects.filter((p) => {
      const hay = `${p.key} ${p.jiraKey ?? ''} ${p.summary} ${p.program ?? ''} ${p.team ?? ''} ${p.subTeam ?? ''} ${p.assignee ?? ''}`
      if (needle && !hay.toLowerCase().includes(needle)) return false
      if (fObj !== 'all' && p.objective !== fObj) return false
      if (fPic.length && !fPic.includes(p.pic ?? 'none')) return false
      if (fCommit !== 'all' && p.commitLevel !== fCommit) return false
      if (fGap === 'saving' && p.savingHours != null) return false
      if (fGap === 'pic' && !!p.pic) return false
      if (fGap === 'manday' && p.manday > 0) return false
      if (fGap === 'gate' && p.gate !== 'fail') return false
      if (fGap === 'pastdue' && !p.pastDue) return false
      if (fGap === 'nokey' && p.jiraKey) return false
      if (fTeam !== 'all' && (p.team || '') !== fTeam) return false
      if (fHc !== 'all') {
        const fte = p.fte || 0
        if (fHc === 'some' && fte <= 0) return false
        if (fHc === 'none' && fte > 0) return false
        if (fHc.startsWith('gte') && fte < Number(fHc.slice(3))) return false
      }
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const added = (p) => (Number(p.addedAt) >= SESSION_START ? Number(p.addedAt) : 0)
    out = [...out].sort((a, b) => {
      // Anything added in this sitting comes first, newest at the very top,
      // whatever the column sort says.
      if (added(a) || added(b)) return added(b) - added(a)
      const va = a[sort.by], vb = b[sort.by]
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      if (typeof va === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb)) * dir
    })
    return out
  }, [projects, q, fObj, fPic, fCommit, fGap, fTeam, fHc, sort])

  // What the exported file says it is. A working file with no idea which
  // slice of the register it holds is one nobody can check.
  /*
   * The filters in force, PIC first.
   *
   * The same list names the file and describes it inside, so a file and its
   * banner can never disagree about which slice it holds. PIC leads because
   * these are usually cut one per person, and a folder of them then sorts by
   * owner.
   */
  const filterParts = useMemo(() => {
    const bits = []
    if (fPic.length) {
      bits.push(fPic.map((id) => (id === 'none' ? 'unassigned' : (assignees.find((x) => x.id === id)?.nick || id))).join('+'))
    }
    if (fObj !== 'all') bits.push(`Obj ${OBJ_BY_ID[fObj]?.no} ${OBJ_BY_ID[fObj]?.short || fObj}`)
    if (fTeam !== 'all') bits.push(fTeam)
    if (fCommit !== 'all') bits.push(fCommit)
    if (fGap !== 'all') bits.push(`gap ${fGap}`)
    if (fHc !== 'all') bits.push(`FTE ${fHc}`)
    if (q.trim()) bits.push(`"${q.trim()}"`)
    return bits
  }, [q, fObj, fPic, fCommit, fTeam, fGap, fHc, assignees])

  const describeFilter = useMemo(
    () => (filterParts.length ? filterParts.join(', ') : 'the whole register'),
    [filterParts],
  )

  const teams = useMemo(
    () => [...new Set(projects.map((p) => p.team).filter(Boolean))].sort(),
    [projects],
  )
  const filtersOn =
    q.trim() !== '' || fPic.length > 0 || [fObj, fCommit, fGap, fTeam, fHc].some((f) => f !== 'all')

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
    const hc = Math.round(rows.reduce((a, p) => a + (p.fte || 0), 0) * 10) / 10
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
    // Same set rule as computePlan: a row enters the return only when its whole
    // investment AND its benefit are known, and it enters BOTH sides.
    const costedRows = inPlanRows.filter((p) => p.investment != null && p.horizonBenefit != null)
    const investment = costedRows.reduce((a, p) => a + p.investment, 0)
    // Plan-wide, like opexYear on the next line and like every other tile in
    // this strip. Summing the run-rate over the costed subset put two different
    // populations on the two lines of one card.
    const opexRunRate = inPlanRows.reduce((a, p) => a + (p.opexRunRate || 0), 0)
    const costedNetHorizon = costedRows.reduce((a, p) => a + p.netHorizonBenefit, 0)

    return {
      count: rows.length,
      hours,
      hc,
      manday,
      annualBenefit,
      // The budget view, across every in-plan row on screen — these are known
      // costs whether or not the row can carry a return.
      buildCost: inPlanRows.some((p) => p.buildCost != null)
        ? inPlanRows.reduce((a, p) => a + (p.buildCost || 0), 0) : null,
      capex: inPlanRows.some((p) => p.capex != null)
        ? inPlanRows.reduce((a, p) => a + (p.capex || 0), 0) : null,
      opexYear: inPlanRows.reduce((a, p) => a + (p.opexYear || 0), 0),
      opexRunRate,
      investment: costedRows.length ? investment : null,
      roi: investment > 0 ? (costedNetHorizon - investment) / investment : null,
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
        <strong>mandays</strong>, <strong>objective</strong> and <strong>commit level</strong> — and each edit
        recalculates the dashboard, the scorecards and the export live. <strong>FTE</strong> is the exception: it is
        computed from the saving hours at the ratio on the Model tab, exactly as the source workbook computes its own
        column. Use <strong>Add project</strong> for anything not yet in the source file, and the bin icon to remove a
        row. Saving hours are <strong>per month</strong>, matching the source workbook's <em>Saving hrs/mth</em> column.{' '}
        <strong>Click any row</strong> (away from its editable cells) to open its cost sheet — infrastructure{' '}
        <strong>CAPEX</strong>, monthly <strong>OPEX</strong> and the Jan–Dec grid behind the Investment column.
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
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>PIC</InputLabel>
            <Select
              multiple
              label="PIC"
              value={fPic}
              onChange={(e) => setFPic(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
              displayEmpty
              renderValue={(sel) => (sel.length === 0
                ? 'All PICs'
                : sel.map((id) => (id === 'none' ? 'Unassigned' : (assignees.find((x) => x.id === id)?.nick || id))).join(', '))}
            >
              <MenuItem value="none">Unassigned</MenuItem>
              {/* assignees, not people: IT and any other partner team own
                  delivery on real projects and have to be filterable, even
                  though they carry no scorecard. */}
              {assignees.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.nick}
                  {p.scorecard === false && (
                    <Typography component="span" variant="caption" sx={{ ml: 0.75, color: 'text.secondary' }}>
                      no scorecard
                    </Typography>
                  )}
                </MenuItem>
              ))}
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
            <InputLabel>FTE</InputLabel>
            <Select label="FTE" value={fHc} onChange={(e) => setFHc(e.target.value)}>
              <MenuItem value="all">Any FTE</MenuItem>
              <MenuItem value="some">Has FTE (&gt; 0)</MenuItem>
              <MenuItem value="none">No FTE</MenuItem>
              <MenuItem value="gte0.5">0.5 FTE or more</MenuItem>
              <MenuItem value="gte1">1 FTE or more</MenuItem>
              <MenuItem value="gte3">3 FTE or more</MenuItem>
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
                setQ(''); setFObj('all'); setFPic([]); setFCommit('all')
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
            {
              label: 'FTE',
              value: agg.hc ? agg.hc.toFixed(1) : '—',
              sub: 'FTE released',
              help: `The source workbook's own FTE column, editable per row: saving hours ÷ ${fin.hoursPerFteMonth} hours per FTE month, rounded to one decimal on each project. Change the ratio on the Model tab — it drives this column's arithmetic and the accountant hourly rate together. Capacity released, not people removed from the payroll.`,
            },
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
              help: 'Mandays x the developer rate, across the in-plan rows in view that carry an effort estimate.',
            },
            {
              label: 'CAPEX',
              value: fmtMoneyShort(agg.capex, sym),
              sub: agg.capex == null ? 'none entered' : 'one-off, not depreciated',
              help: 'Infrastructure, licences and hardware bought once, across the in-plan rows in view. Click any project row to enter or edit it. No depreciation is applied — the whole amount is charged against the project.',
            },
            {
              label: 'OPEX / year',
              value: agg.opexYear > 0 ? fmtMoneyShort(agg.opexYear, sym) : '—',
              sub: agg.opexRunRate > 0 ? `${fmtMoneyShort(agg.opexRunRate, sym)}/month run-rate` : 'none entered',
              help: 'The 2026 monthly-cost grid added up: each running-cost line counted only in the months it is live. The run-rate underneath ignores start and end months — that is the steady-state monthly cost the ROI is measured against.',
            },
            {
              label: 'Investment',
              value: fmtMoneyShort(agg.investment, sym),
              sub: agg.investment == null ? 'nothing costed in view' : 'build + CAPEX, returnable rows',
              help: 'Build cost plus CAPEX, across only the rows in view that carry BOTH a known cost and a known benefit — the same set the ROI beside it divides. It is deliberately not the same as Build cost + CAPEX above, which cover every in-plan row on screen.',
            },
            {
              label: 'ROI',
              value: fmtRoi(agg.roi),
              sub: agg.roi == null
                ? 'needs mandays or CAPEX'
                : `${agg.roiRows} of ${agg.inPlanCount} in-plan rows · gate ${fmtRoi(fin.roiGate)}`,
              tone: agg.roi == null ? undefined : agg.roi >= fin.roiGate ? STATUS.good : STATUS.critical,
              help: `Return over ${horizon} months on the whole investment — build cost plus CAPEX — against the benefit net of the monthly OPEX. Only rows carrying both a known cost and a known benefit are in EITHER side, so this is never a whole-book benefit divided by a partial cost.`,
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


      {/*
        * Export what is on screen, and import it back.
        *
        * The whole-plan export in the header is a different thing: it is the
        * eleven-sheet book of record. This one is the working file — the rows
        * you have filtered to, in a shape that can be edited and imported.
        */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<FileDownloadOutlinedIcon />}
          disabled={!rows.length || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await exportFiltered(rows, assignees, describeFilter, filterParts)
            } finally { setBusy(false) }
          }}
        >
          Export {rows.length === projects.length ? 'all' : 'filtered'} ({rows.length})
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<FileUploadOutlinedIcon />}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          Import
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          aria-label="import projects"
          style={{ display: 'none' }}
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''            // so the same file can be picked twice
            if (!file) return
            setBusy(true)
            try {
              const parsed = await readProjectsFile(await file.arrayBuffer())
              setImporting({
                fileName: file.name,
                result: parsed.error
                  ? { error: parsed.error, changes: [] }
                  : planImport(parsed, { projects, people: assignees }, plan),
              })
            } catch (err) {
              setImporting({ fileName: file.name, result: { error: `Could not read the file: ${err.message}`, changes: [] } })
            } finally { setBusy(false) }
          }}
        />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {rows.length === projects.length
            ? 'exports every project; filter the table first to export a subset'
            : `exports the ${rows.length} row${rows.length === 1 ? '' : 's'} shown, not all ${projects.length}`}
          {' · an import only touches the rows named in the file'}
        </Typography>
      </Box>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '72vh' }}>
        <Table size="small" stickyHeader sx={{ '& th, & td': { px: 1.25 } }}>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ bgcolor: 'background.paper' }}>
                <Checkbox size="small" checked={allSelected} indeterminate={sel.size > 0 && !allSelected} onChange={toggleAll} />
              </TableCell>
              {/* Opening the cost panel is an explicit button, not a click
                  anywhere on the row — a row full of editable cells is a bad
                  click target, and an accidental popup mid-edit is worse. */}
              <TableCell padding="checkbox" sx={{ bgcolor: 'background.paper' }} />
              {head('jiraKey', 'Jira', 'left', 88)}
              {head('summary', 'Project')}
              <TableCell sx={{ minWidth: 118, maxWidth: 140, width: 140 }}>Objective</TableCell>
              <TableCell sx={{ minWidth: 84 }}>PIC</TableCell>
              {head('savingHours', 'Saving hrs/mth', 'right')}
              {/* The other half of the QUANTIFIED benefit: money that is money
                  rather than time, so it sits next to the hours it adds to. */}
              {head('monetaryAnnualBenefit', 'Cash benefit/yr', 'right', 96)}
              {/* And beside them the part no number carries: a case made only
                  of figures is half a case. */}
              <TableCell sx={{ minWidth: 150, maxWidth: 170, width: 160 }}>Soft benefits</TableCell>
              {head('fte', 'FTE', 'right')}
              {head('manday', 'Mandays', 'right')}
              {/* One column, not three: the table already runs to the edge of
                  its container, so the build/CAPEX/OPEX split lives in the
                  tooltip and in the dialog a row-click opens. */}
              {head('investment', 'Investment', 'right', 84)}
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
                  sx={{ opacity: OUT_OF_PLAN.has(p.commitLevel) || p.outsideTeam ? 0.55 : 1 }}
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
                  <TableCell padding="checkbox">
                    <Tooltip title={`Effort, CAPEX, monthly cost and notes for ${p.jiraKey || p.key}`}>
                      <IconButton size="small" onClick={() => setCostKey(p.key)} aria-label="open cost breakdown">
                        <ReceiptLongIcon sx={{ fontSize: 17, color: p.comment ? STATUS.good : undefined }} />
                      </IconButton>
                    </Tooltip>
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
                    <AlsoServes
                      project={p}
                      onChange={(ids) => onUpdate(p.key, { objectives: ids })}
                    />
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
                    {/* Still editable — it is a real figure and worth keeping
                        on the record. Struck through because it is not ours:
                        the PIC is IT or the business, so the hours are outside
                        the team's commitment and outside every scorecard. */}
                    <Tooltip title={p.outsideTeam
                      ? `Delivered by ${assignees.find((x) => x.id === p.pic)?.nick || 'a partner'} — kept on the register, but NOT counted in the team's committed saving hours and not on anyone's scorecard.`
                      : ''}>
                      <Box sx={{ textDecoration: p.outsideTeam ? 'line-through' : 'none' }}>
                        <NumCell
                          value={p.savingHours}
                          estimated={false}
                          onChange={(v) => onUpdate(p.key, { savingHours: v, savingEstimated: v == null })}
                        />
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title={p.monetaryAnnualBenefit
                      ? `${fmtMoney(p.monetaryAnnualBenefit, sym)} a year of cash benefit, on top of ${fmtMoney((p.hoursMonthlyBenefit || 0) * 12, sym)} from the hours. Both count toward the ROI.`
                      : 'Cash this delivers that the saving hours do not already capture — a licence dropped, a penalty avoided. Stated per year. Leave empty where the hours ARE the saving, or it is counted twice.'}>
                      <Box>
                        <NumCell
                          value={p.monetaryAnnualBenefit ?? null}
                          estimated={false}
                          width={92}
                          onChange={(v) => onUpdate(p.key, { monetaryBenefit: v })}
                        />
                      </Box>
                    </Tooltip>
                  </TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <SoftBenefitCell
                      value={p.softBenefits}
                      onChange={(v) => onUpdate(p.key, { softBenefits: v })}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {/* Derived, not typed. The source workbook computes its
                        own column the same way — ROUND(saving/(22*8), 1) — so
                        this reads as a formula result, not an input. */}
                    <Tooltip title={
                      p.savingHours == null
                        ? 'Saving hours are still TBC, so there is no FTE to release yet.'
                        : `${fmtHours(p.savingHours)} hrs/month ÷ ${fin.hoursPerFteMonth} = ${(p.fte ?? 0).toFixed(1)} FTE. Enter saving hours and this follows; change the FTE ratio on the Model tab and every row moves at once.`
                    }>
                      <Typography
                        variant="body2"
                        sx={{
                          fontSize: '0.8125rem',
                          fontVariantNumeric: 'tabular-nums',
                          cursor: 'help',
                          color: p.fte > 0 ? 'text.primary' : 'text.disabled',
                        }}
                      >
                        {p.savingHours == null ? '—' : (p.fte ?? 0).toFixed(1)}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    {p.tasks && p.tasks.length ? (
                      // Derived from the tasks, so it is a result, not an input.
                      // Clicking it opens the breakdown it is the sum of.
                      <Tooltip title={`${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'} totalling ${fmtHours(p.manday)} mandays — click to see the breakdown`}>
                        <Box
                          component="button"
                          type="button"
                          onClick={() => setCostKey(p.key)}
                          sx={{
                            border: 0, background: 'none', p: 0, cursor: 'pointer', font: 'inherit',
                            fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums',
                            color: 'primary.main', textDecoration: 'underline dotted',
                          }}
                        >
                          {fmtHours(p.manday)}
                        </Box>
                      </Tooltip>
                    ) : (
                      <NumCell
                        value={p.manday}
                        width={56}
                        estimated={p.mandayEstimated}
                        onChange={(v) => onUpdate(p.key, { manday: v ?? 0, mandayEstimated: false })}
                      />
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
                    {p.investment == null ? (
                      <Tooltip title={`No mandays and no CAPEX yet. This project can afford ${p.affordableMandays == null ? '—' : Math.round(p.affordableMandays).toLocaleString()} mandays and still clear the gate. Click the row to add CAPEX or a monthly operating cost.`}>
                        <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    ) : (
                      <Tooltip title={`Build ${fmtMoney(p.buildCost ?? 0, sym)} + CAPEX ${fmtMoney(p.capex ?? 0, sym)} = ${fmtMoney(p.investment, sym)} one-off${p.opexRunRate > 0 ? `, plus ${fmtMoney(p.opexRunRate, sym)} a month of OPEX (${fmtMoney(p.opexYear, sym)} in 2026)` : ', with no monthly operating cost'}. Click the row for the month-by-month table.`}>
                        <Typography variant="body2" sx={{ fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums', cursor: 'help' }}>
                          {fmtMoneyShort(p.investment, sym)}
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {p.roi == null ? (
                      <Tooltip title={
                        p.savingHours == null
                          ? 'Saving hours are still TBC, so there is no benefit to return.'
                          : `Worth ${fmtMoneyShort(p.annualBenefit, sym)} a year. Enter mandays or a CAPEX to get a return — break-even is ${Math.round(p.breakEvenMandays).toLocaleString()} mandays, and ${Math.round(p.affordableMandays).toLocaleString()} clears the gate.`
                      }>
                        <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    ) : (
                      <Tooltip title={`${fmtMoney(p.monthlyBenefit, sym)} a month less ${fmtMoney(p.opexRunRate, sym)} of OPEX = ${fmtMoney(p.netMonthly, sym)} net; ${fmtMoney(p.netHorizonBenefit, sym)} over ${horizon} months against ${fmtMoney(p.investment, sym)} invested — net ${fmtMoney(p.netBenefit, sym)}, ${p.paybackMonths == null ? 'and it never pays back' : `paying back in ${fmtMonths(p.paybackMonths)}`}. Gate is ${fmtRoi(fin.roiGate)}.`}>
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
                          ? 'Saving hours are still TBC, so there is nothing to pay the investment back.'
                          : p.netMonthly != null && p.netMonthly <= 0
                            ? `The ${fmtMoney(p.opexRunRate, sym)} a month of OPEX is at or above the ${fmtMoney(p.monthlyBenefit, sym)} a month this returns, so it never pays back. Blank, deliberately — not a fast payback and not a negative one.`
                            : 'Enter mandays or a CAPEX to get a payback period.'
                      }>
                        <Typography variant="caption" sx={{ color: p.netMonthly != null && p.netMonthly <= 0 ? STATUS.critical : 'text.disabled', cursor: 'help' }}>
                          {p.netMonthly != null && p.netMonthly <= 0 && p.investment != null ? 'never' : '—'}
                        </Typography>
                      </Tooltip>
                    ) : (
                      <Tooltip title={`${fmtMoney(p.investment, sym)} invested, returning ${fmtMoney(p.netMonthly, sym)} a month after OPEX — repaid in ${fmtMonths(p.paybackMonths)}. The gate is a payback of ${fmtMonths(gateAsPaybackMonths(fin))}.`}>
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
                <TableCell colSpan={16} align="center" sx={{ py: 6, color: 'text.secondary' }}>
                  No projects match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Looked up by key on every render, so a CAPEX typed inside it moves the
          ROI in the header of the very same dialog. */}
      <ImportDialog
        result={importing?.result}
        fileName={importing?.fileName}
        onClose={() => setImporting(null)}
        onApply={() => { onImport(importing.result); setImporting(null) }}
      />

      <ProjectCostDialog
        project={costProject}
        plan={plan}
        onUpdate={onUpdate}
        onClose={() => setCostKey(null)}
      />
    </Box>
  )
}
