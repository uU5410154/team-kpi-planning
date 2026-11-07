import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { Pill, statusTone } from '../components/Brand.jsx'
import { projectOnHold } from '../lib/hold.js'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel,
  TextField, Select, MenuItem, InputAdornment, Checkbox, Button, Stack, Tooltip,
  FormControl, InputLabel, TableContainer, Menu, Alert, IconButton, CircularProgress, Link, Popover, Chip,
  Collapse, ListItemIcon, ListItemText, Divider, useMediaQuery,
} from '@mui/material'
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListIcon from '@mui/icons-material/FilterList'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ProjectDetailDialog from '../components/ProjectDetailDialog.jsx'
import * as api from '../lib/api.js'
import { PROJECT_COLUMNS } from '../lib/projectColumns.js'
import {
  PROJECT_SECTIONS, DEFAULT_PROJECT_LAYOUT, cleanProjectLayout, moveId, toggleId,
} from '../lib/projectLayout.js'
import LayoutIcon from '@mui/icons-material/DashboardCustomizeOutlined'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import WidthWideOutlinedIcon from '@mui/icons-material/WidthWideOutlined'
import WidthNormalOutlinedIcon from '@mui/icons-material/WidthNormalOutlined'
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
import Loading from '../components/Loading.jsx'
import { exportFiltered, readProjectsFile, planImport } from '../lib/projectIO.js'
import { useTheme, alpha } from '@mui/material/styles'

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
function TextCell({ value, onChange, placeholder, width, bold, autoFocus = false }) {
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
      autoFocus={autoFocus}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const next = draft.trim() || null
        if (next !== (value ?? null)) onChange(next)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
      inputProps={{ style: { fontSize: '0.8125rem', fontWeight: bold ? 500 : 400 } }}
      sx={{ width }}
    />
  )
}

/**
 * ONE BLOCK OF THE PAGE, where the layout puts it. In Edit layout it carries a
 * bar to move it up or down and to hide or show it; a hidden block shows only
 * that bar while editing, and nothing otherwise.
 */
function LayoutBlock({
  id, label, order, hidden, editing, locked, first, last, onMove, onToggle, children,
}) {
  if (hidden && !editing) return null
  return (
    <Box
      data-layout-block={id}
      sx={{
        order,
        minWidth: 0,
        ...(editing && {
          outline: '1px dashed', outlineColor: 'divider', outlineOffset: 6, borderRadius: 2,
        }),
      }}
    >
      {editing && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, mb: hidden ? 0 : 1, opacity: hidden ? 0.55 : 1,
        }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>
            {label}{hidden ? ' · hidden' : ''}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Move up"><span><IconButton size="small" disabled={first} onClick={() => onMove(-1)} aria-label={`move ${label} up`}><ArrowUpwardIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
          <Tooltip title="Move down"><span><IconButton size="small" disabled={last} onClick={() => onMove(1)} aria-label={`move ${label} down`}><ArrowDownwardIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
          {!locked && (
            <Tooltip title={hidden ? 'Show' : 'Hide'}>
              <IconButton size="small" onClick={onToggle} aria-label={`${hidden ? 'show' : 'hide'} ${label}`} data-toggle-block={id}>
                {hidden ? <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} /> : <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
          )}
        </Box>
      )}
      {!hidden && children}
    </Box>
  )
}

/**
 * THE PROJECT'S NAME: a link that opens its detail popup. The pencil beside it
 * turns it into an editable box for renaming; leaving the box turns it back.
 */
function NameCell({ p, onOpen, onRename }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <Box sx={{ flex: 1, minWidth: 0 }} onBlur={() => setEditing(false)} data-name-editing>
        <TextCell value={p.summary} placeholder="Project name" onChange={onRename} bold autoFocus />
      </Box>
    )
  }
  return (
    <>
      <Link
        component="button"
        type="button"
        onClick={() => onOpen(p.key)}
        data-open-project={p.key}
        underline="hover"
        title={`Open ${p.jiraKey || p.key}: owner, dates, weekly check-ins`}
        sx={{
          flex: 1, minWidth: 0, textAlign: 'left', fontSize: '0.8125rem', fontWeight: 600, color: 'text.primary',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', py: 0.5,
        }}
      >
        {p.summary || 'Untitled'}
      </Link>
      <Tooltip title="Rename">
        <IconButton size="small" onClick={() => setEditing(true)} aria-label={`rename ${p.summary}`} data-rename-project={p.key} sx={{ flexShrink: 0, color: 'text.disabled', p: 0.4 }}>
          <EditOutlinedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </>
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
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
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

/*
 * A click on a row opens the project — unless it landed on something that
 * does its own thing: an input, a dropdown, a button, a chip, a link.
 */
const OWN_CLICK = 'input, textarea, button, a, label, [role="button"], [role="combobox"], [role="option"], .MuiInputBase-root, .MuiSelect-select, .MuiChip-root, .MuiCheckbox-root'

/**
 * THE REGISTER ON A PHONE: one card a project, the few facts that tell them
 * apart, and a tap opens the project. Editing is for a wider screen; on a
 * phone this is for looking something up.
 */
function PhoneList({ rows, assignees, onOpen }) {
  if (!rows.length) {
    return (
      <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', color: 'text.secondary' }}>
        No projects match these filters.
      </Paper>
    )
  }
  return (
    <Paper variant="outlined" component="ul" aria-label="projects" sx={{ listStyle: 'none', m: 0, p: 0, overflow: 'hidden' }}>
      {rows.map((p, i) => {
        const owner = assignees.find((x) => x.id === p.pic)
        const muted = OUT_OF_PLAN.has(p.commitLevel) || p.outsideTeam
        return (
          <Box component="li" key={p.key} sx={{ borderTop: i === 0 ? 0 : 1, borderColor: 'divider' }}>
            <Box
              component="button"
              type="button"
              onClick={() => onOpen(p.key)}
              data-project-card={p.key}
              sx={{
                all: 'unset',
                boxSizing: 'border-box',
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.75,
                py: 1.25,
                minHeight: 56,
                cursor: 'pointer',
                color: 'text.primary',
                opacity: muted ? 0.6 : 1,
                '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
                '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineOffset: -2 },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 600,
                    lineHeight: 1.35,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {p.summary || p.key}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }} noWrap>
                  {p.jiraKey || 'no key'} · {owner?.nick || <Box component="span" sx={{ color: STATUS.critical }}>no PIC</Box>}
                  {' · '}
                  <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}>
                    {p.savingHours == null ? 'TBC' : fmtHours(p.savingHours)}
                  </Box>
                  {' hrs/mth'}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25, flexShrink: 0 }}>
                {projectOnHold(p)
                  ? <Pill label="On Hold" tone="warn" />
                  : (p.srcStatus || p.status) && <Pill label={p.srcStatus || p.status} tone={statusTone(p.status || p.srcStatus)} />}
                {p.pastDue && <Typography variant="caption" sx={{ color: STATUS.critical, fontWeight: 600 }}>past due</Typography>}
              </Box>
              <ChevronRightIcon sx={{ color: 'text.disabled', flexShrink: 0 }} />
            </Box>
          </Box>
        )
      })}
    </Paper>
  )
}

export default function Projects({
  plan, onUpdate, onBulk, onAdd, onDelete, onImport,
  onSave, dirty, saving, lastSaved, scenarioName, blocked = [], onGoTo, jump = null,
  canWrite = true, onShowTimeline,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  // A phone gets a list of cards rather than the wide table; between a phone
  // and a wide screen the table scrolls sideways with its first columns held.
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
  const wide = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true })
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
  /*
   * A LIST, like the PIC filter and for the same reason: the question anyone
   * asks of a register this size is "what do these two sub teams hold between
   * them", and one at a time cannot answer it. Empty means all.
   */
  const [fSub, setFSub] = useState([])
  const [fHc, setFHc] = useState('all')
  /*
   * Sent here by the header search: show that project, and only that. Every
   * other filter is cleared too — a project hidden by a filter somebody set an
   * hour ago would read as the search having found nothing.
   */
  useEffect(() => {
    if (!jump?.q) return
    setQ(jump.q); setFObj('all'); setFPic([]); setFCommit('all'); setFGap('all'); setFTeam('all'); setFSub([]); setFHc('all')
  }, [jump?.n])
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
  // The project open in the detail popup, by key for the same reason.
  const [detailKey, setDetailKey] = useState(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [allTiles, setAllTiles] = useState(false)

  /*
   * THE COLUMNS AN ADMINISTRATOR HAS HIDDEN, for everybody. Read from the
   * server; with no database there is nothing shared to read, so every column
   * shows and the Columns menu says why it cannot save.
   */
  const [hidden, setHidden] = useState(() => new Set())
  const [colsNote, setColsNote] = useState(null)
  const [colsEl, setColsEl] = useState(null)
  const [colsRead, setColsRead] = useState(false)
  useEffect(() => {
    let stop = false
    api.projectColumns()
      .then((r) => { if (!stop) { setHidden(new Set(r.hidden || [])); setColsNote(null) } })
      .catch(() => { if (!stop) setColsNote('Column choices are kept in the shared database, which is not reachable — every column is shown.') })
      .finally(() => { if (!stop) setColsRead(true) })
    return () => { stop = true }
  }, [])
  const show = (id) => !hidden.has(id)
  const notSaved = (e) => (/unavailable/i.test(e.message)
    ? 'Not saved — the shared database is not reachable, so every column stays shown.'
    : `Not saved — ${e.message}`)
  const toggleColumn = async (id) => {
    const before = hidden
    const next = new Set(hidden)
    next.has(id) ? next.delete(id) : next.add(id)
    setHidden(next)
    try {
      const r = await api.saveProjectColumns(PROJECT_COLUMNS.map((c) => c.id).filter((c) => next.has(c)))
      setHidden(new Set(r.hidden || []))
      setColsNote(null)
    } catch (e) {
      setHidden(before)
      setColsNote(notSaved(e))
    }
  }
  const showAllColumns = async () => {
    const before = hidden
    setHidden(new Set())
    try { await api.saveProjectColumns([]); setColsNote(null) } catch (e) { setHidden(before); setColsNote(notSaved(e)) }
  }

  /*
   * THE PAGE'S LAYOUT: which blocks and figure tiles show, in what order, as an
   * administrator arranged it for everybody. undefined while loading, null
   * when the shared database cannot be read (the default layout shows).
   */
  const [layoutSaved, setLayoutSaved] = useState(undefined)
  const [layoutDraft, setLayoutDraft] = useState(null)
  const [layoutBusy, setLayoutBusy] = useState(false)
  const [layoutError, setLayoutError] = useState(null)
  /*
   * A spinner until the shared columns and layout are read, rather than every
   * column and block drawn and then half of them hidden a moment later. Never
   * longer than a few seconds: a slow database still gets the default view.
   */
  const [layoutWait, setLayoutWait] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLayoutWait(false), 3000)
    return () => clearTimeout(t)
  }, [])
  useEffect(() => {
    let stop = false
    api.projectLayout()
      .then((r) => { if (!stop) setLayoutSaved({ ...r, layout: r.layout ? cleanProjectLayout(r.layout) : null }) })
      .catch(() => { if (!stop) setLayoutSaved(null) })
    return () => { stop = true }
  }, [])
  const editingLayout = !!layoutDraft
  const lay = layoutDraft || layoutSaved?.layout || DEFAULT_PROJECT_LAYOUT
  const editLayout = (fn) => setLayoutDraft((d) => fn(d || lay))
  const saveLayout = async () => {
    setLayoutBusy(true)
    setLayoutError(null)
    try {
      const r = await api.saveProjectLayout(layoutDraft)
      setLayoutSaved({ ...r, layout: cleanProjectLayout(r.layout) })
      setLayoutDraft(null)
    } catch (e) {
      setLayoutError(/unavailable/i.test(e.message) ? 'Not saved — the shared database is not reachable.' : `Not saved — ${e.message}`)
    } finally {
      setLayoutBusy(false)
    }
  }
  const block = (id) => {
    const s = PROJECT_SECTIONS.find((x) => x.id === id)
    const i = lay.sections.indexOf(id)
    return {
      id,
      label: s.label,
      locked: !!s.locked,
      order: i + 1,
      hidden: lay.hiddenSections.includes(id),
      editing: editingLayout,
      first: i === 0,
      last: i === lay.sections.length - 1,
      onMove: (by) => editLayout((d) => ({ ...d, sections: moveId(d.sections, id, by) })),
      onToggle: () => editLayout((d) => ({ ...d, hiddenSections: toggleId(d.hiddenSections, id) })),
    }
  }

  /*
   * THE HELD COLUMNS. The select box, the cost-sheet button, the Jira key and
   * — on a screen wide enough to spare it — the project's name stay put while
   * the rest of the table scrolls under them, so a row is never a line of
   * numbers with no name. Their offsets are measured, not guessed: the cells
   * are as wide as their content and padding make them.
   */
  // The shared columns and layout are in (or the wait for them is over).
  const ready = !layoutWait || (colsRead && layoutSaved !== undefined)
  const stickyIds = ['select', 'cost', ...(show('jiraKey') ? ['jiraKey'] : []), ...(wide ? ['summary'] : [])]
  const headRefs = useRef({})
  const [lefts, setLefts] = useState({})
  const stickyKey = stickyIds.join()
  useLayoutEffect(() => {
    if (phone) return undefined
    const ids = stickyKey.split(',')
    const measure = () => {
      const out = {}
      let x = 0
      for (const id of ids) {
        out[id] = x
        x += headRefs.current[id]?.getBoundingClientRect().width || 0
      }
      setLefts((prev) => (JSON.stringify(prev) === JSON.stringify(out) ? prev : out))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ids.forEach((id) => headRefs.current[id] && ro.observe(headRefs.current[id]))
    return () => ro.disconnect()
  }, [stickyKey, phone, ready])
  const lastSticky = stickyIds[stickyIds.length - 1]
  const stick = (id, head = false) => (stickyIds.includes(id) ? {
    className: 'held',
    ref: head ? (el) => { headRefs.current[id] = el } : undefined,
    style: {
      position: 'sticky',
      left: lefts[id] ?? 0,
      zIndex: head ? 4 : 2,
      ...(id === lastSticky ? { boxShadow: `inset -1px 0 0 ${theme.palette.divider}` } : {}),
    },
  } : {})

  // The cue that there is more to the right: a soft fade at the edge.
  const scrollRef = useRef(null)
  const [moreRight, setMoreRight] = useState(false)
  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setMoreRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    checkScroll()
    const ro = new ResizeObserver(checkScroll)
    ro.observe(el)
    return () => ro.disconnect()
  }, [checkScroll, phone, hidden, ready])

  // Mid-edit, a click elsewhere on the row is how the edit is finished — it
  // must not also throw a popup over the page.
  const editing = useRef(false)
  const openFromRow = (e, key) => {
    if (editing.current) return
    if (!e.currentTarget.contains(e.target)) return   // a menu, rendered in a portal
    if (e.target.closest(OWN_CLICK)) return
    if (window.getSelection?.()?.toString()) return
    setDetailKey(key)
  }

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
      // Blank sub team is a real answer, not a missing one — it is how most of
      // the register reads, so it has to be selectable rather than unfindable.
      if (fSub.length && !fSub.includes(p.subTeam || 'none')) return false
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
  }, [projects, q, fObj, fPic, fCommit, fGap, fTeam, fSub, fHc, sort])

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
    if (fSub.length) bits.push(fSub.map((t) => (t === 'none' ? 'no sub team' : t)).join('+'))
    if (fCommit !== 'all') bits.push(fCommit)
    if (fGap !== 'all') bits.push(`gap ${fGap}`)
    if (fHc !== 'all') bits.push(`FTE ${fHc}`)
    if (q.trim()) bits.push(`"${q.trim()}"`)
    return bits
  }, [q, fObj, fPic, fCommit, fTeam, fSub, fGap, fHc, assignees])

  const describeFilter = useMemo(
    () => (filterParts.length ? filterParts.join(', ') : 'the whole register'),
    [filterParts],
  )
  // How many of the dropdown filters are set — the count on a phone's
  // Filters button, where the dropdowns themselves are folded away.
  const dropdownsOn = (fPic.length > 0) + (fSub.length > 0)
    + [fObj, fCommit, fGap, fTeam, fHc].filter((f) => f !== 'all').length

  const teams = useMemo(
    () => [...new Set(projects.map((p) => p.team).filter(Boolean))].sort(),
    [projects],
  )
  /*
   * Narrowed by the team already chosen. Offering every sub team in the book
   * against a team that holds four of them is a list of dead ends.
   */
  const subTeams = useMemo(
    () => [...new Set(projects
      .filter((p) => fTeam === 'all' || (p.team || '') === fTeam)
      .map((p) => p.subTeam)
      .filter(Boolean))].sort(),
    [projects, fTeam],
  )
  const filtersOn =
    q.trim() !== '' || fPic.length > 0 || fSub.length > 0
    || [fObj, fCommit, fGap, fTeam, fHc].some((f) => f !== 'all')

  const head = (id, label, align = 'left', minWidth) => (
    <TableCell align={align} sortDirection={sort.by === id ? sort.dir : false} sx={minWidth ? { minWidth } : undefined} {...stick(id, true)}>
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

  // The figures over the table, by id, for the layout to order and hide.
  const tileById = Object.fromEntries([
      { id: 'count', label: 'Projects in view', value: agg.count.toLocaleString(), sub: agg.tbc ? `${agg.tbc} still TBC` : 'all quantified' },
      {
        id: 'hours',
        label: 'Saving hrs / month',
        value: fmtHours(agg.hours),
        sub: agg.deferred > 0
          ? `${fmtHours(agg.deferred)} of it out of plan`
          : `${fmtPct(agg.pctOfBook)} of the register`,
        strong: true,
        tone: agg.deferred > 0 ? STATUS.warning : undefined,
      },
      { id: 'done', label: 'Of which delivered', value: fmtHours(agg.done), sub: 'status Done' },
      {
        id: 'fte',
        label: 'FTE',
        value: agg.hc ? agg.hc.toFixed(1) : '—',
        sub: 'FTE released',
        help: `The source workbook's own FTE column, editable per row: saving hours ÷ ${fin.hoursPerFteMonth} hours per FTE month, rounded to one decimal on each project. Change the ratio on the Model tab — it drives this column's arithmetic and the accountant hourly rate together. Capacity released, not people removed from the payroll.`,
      },
      { id: 'manday', label: 'Mandays', value: agg.manday ? fmtHours(agg.manday) : '—', sub: agg.manday ? 'invested' : 'not entered yet' },
      {
        id: 'benefit',
        label: 'Benefit / year',
        value: fmtMoneyShort(agg.annualBenefit, sym),
        sub: `${fmtMoney(fin.acctHourRate, sym)} per saved hour`,
        help: `Saving hours x the accountant rate, annualised. Covers every quantified row in view, whether or not it has an effort estimate.`,
      },
      {
        id: 'build',
        label: 'Build cost',
        value: fmtMoneyShort(agg.buildCost, sym),
        sub: agg.buildCost == null ? 'no mandays in view' : `${fmtMoney(fin.devDayRate, sym)} per manday`,
        help: 'Mandays x the developer rate, across the in-plan rows in view that carry an effort estimate.',
      },
      {
        id: 'capex',
        label: 'CAPEX',
        value: fmtMoneyShort(agg.capex, sym),
        sub: agg.capex == null ? 'none entered' : 'one-off, not depreciated',
        help: 'Infrastructure, licences and hardware bought once, across the in-plan rows in view. Open a project\'s cost sheet (the receipt icon on its row) to enter or edit it. No depreciation is applied — the whole amount is charged against the project.',
      },
      {
        id: 'opex',
        label: 'OPEX / year',
        value: agg.opexYear > 0 ? fmtMoneyShort(agg.opexYear, sym) : '—',
        sub: agg.opexRunRate > 0 ? `${fmtMoneyShort(agg.opexRunRate, sym)}/month run-rate` : 'none entered',
        help: 'The 2026 monthly-cost grid added up: each running-cost line counted only in the months it is live. The run-rate underneath ignores start and end months — that is the steady-state monthly cost the ROI is measured against.',
      },
      {
        id: 'investment',
        label: 'Investment',
        value: fmtMoneyShort(agg.investment, sym),
        sub: agg.investment == null ? 'nothing costed in view' : 'build + CAPEX, returnable rows',
        help: 'Build cost plus CAPEX, across only the rows in view that carry BOTH a known cost and a known benefit — the same set the ROI beside it divides. It is deliberately not the same as Build cost + CAPEX above, which cover every in-plan row on screen.',
      },
      {
        id: 'roi',
        label: 'ROI',
        value: fmtRoi(agg.roi),
        sub: agg.roi == null
          ? 'needs mandays or CAPEX'
          : `${agg.roiRows} of ${agg.inPlanCount} in-plan rows · gate ${fmtRoi(fin.roiGate)}`,
        tone: agg.roi == null ? undefined : agg.roi >= fin.roiGate ? STATUS.good : STATUS.critical,
        help: `Return over ${horizon} months on the whole investment — build cost plus CAPEX — against the benefit net of the monthly OPEX. Only rows carrying both a known cost and a known benefit are in EITHER side, so this is never a whole-book benefit divided by a partial cost.`,
      },
  ].map((t) => [t.id, t]))

  if (!ready) {
    return <Loading variant="block" label="Loading the register…" />
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Edit layout: an administrator arranges the page for everybody. */}
      {canWrite && !phone && layoutSaved !== undefined && (
        <Box sx={{ order: 0, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end' }} data-layout-toolbar>
          {!editingLayout ? (
            <>
              <Typography variant="caption" sx={{ color: 'text.secondary', mr: 'auto' }}>
                {layoutSaved === null
                  ? 'The layout cannot be changed while the shared database is unavailable.'
                  : layoutSaved.updatedBy ? `Layout arranged by ${layoutSaved.updatedBy} — the same for everybody.` : ''}
              </Typography>
              {layoutSaved !== null && (
                <Button size="small" variant="outlined" startIcon={<LayoutIcon />} onClick={() => { setLayoutDraft(lay); setLayoutError(null) }} sx={{ color: 'text.primary', borderColor: 'divider' }} data-edit-layout>
                  Edit layout
                </Button>
              )}
            </>
          ) : (
            <>
              <Typography variant="caption" sx={{ color: 'text.secondary', mr: 'auto' }}>
                Move blocks up or down, hide what nobody needs, and arrange the figures with the arrows under each one. Saved for everybody.
              </Typography>
              <Button size="small" onClick={() => setLayoutDraft(DEFAULT_PROJECT_LAYOUT)}>Reset to default</Button>
              <Button size="small" onClick={() => { setLayoutDraft(null); setLayoutError(null) }}>Cancel</Button>
              <Button size="small" variant="contained" onClick={saveLayout} disabled={layoutBusy} startIcon={layoutBusy ? <CircularProgress size={14} /> : null} data-save-layout>
                Save layout
              </Button>
            </>
          )}
          {layoutError && <Alert severity="error" sx={{ width: '100%', py: 0 }} onClose={() => setLayoutError(null)}>{layoutError}</Alert>}
        </Box>
      )}

      <LayoutBlock {...block('about')}>
      {/* The how-to, folded to one line: on a phone the whole of it filled
          the first screen before a single project showed. */}
      <Alert
        severity="info"
        variant="outlined"
        sx={{ '& .MuiAlert-message': { width: '100%' } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          <Box component="span" sx={{ flex: '1 1 260px' }}>
            {phone
              ? <>Tap a project to open its detail.</>
              : <>Every cell is editable and recalculates the dashboard, scorecards and export live. <strong>Click a project&rsquo;s name</strong> (or its row, away from the editable cells) to open its detail; the pencil renames it; the <ReceiptLongIcon sx={{ fontSize: 14, verticalAlign: '-2px' }} /> icon opens its cost sheet.</>}
          </Box>
          <Link
            component="button"
            onClick={() => setAboutOpen((o) => !o)}
            aria-expanded={aboutOpen}
            sx={{ fontWeight: 600, fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center' }}
          >
            {aboutOpen ? 'Less' : 'About this page'}
            <ExpandMoreIcon sx={{ fontSize: 16, transform: aboutOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
          </Link>
        </Box>
        <Collapse in={aboutOpen} unmountOnExit>
          <Box sx={{ mt: 1 }}>
            Every cell is editable — name, team, programme, <strong>PIC</strong>, <strong>saving hrs/month</strong>,{' '}
            <strong>mandays</strong>, <strong>objective</strong> and <strong>commit level</strong> — and each edit
            recalculates the dashboard, the scorecards and the export live. <strong>FTE</strong> is the exception: it is
            computed from the saving hours at the ratio on the Model tab, exactly as the source workbook computes its own
            column. Use <strong>Add project</strong> for anything not yet in the source file, and the bin icon to remove a
            row. Saving hours are <strong>per month</strong>, matching the source workbook's <em>Saving hrs/mth</em> column.{' '}
            <strong>Click a project</strong> — the expand icon beside its name, or the row away from its editable cells —
            to open its detail: owner, dates, the weekly check-ins and the active switch. The receipt icon at the start of
            each row (or <strong>Cost sheet</strong> in the detail) opens its cost sheet — infrastructure{' '}
            <strong>CAPEX</strong>, monthly <strong>OPEX</strong> and the Jan–Dec grid behind the Investment column.
          </Box>
        </Collapse>
      </Alert>
      </LayoutBlock>

      <LayoutBlock {...block('filters')}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {/* Wraps: beside the side menu a 1500px screen leaves about 1,200px,
            which is less than the search box and six filters need in one row. */}
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search key, project, team, assignee…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: { xs: 0, sm: 280 }, flex: { xs: '1 1 0', sm: '1 1 280px' } }}
          />
          {phone && (
            <Button
              variant="outlined"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="project-filters"
              startIcon={<FilterListIcon />}
              sx={{ flexShrink: 0, color: 'text.primary', borderColor: 'divider' }}
            >
              Filters{dropdownsOn ? ` (${dropdownsOn})` : ''}
            </Button>
          )}
          {/* The dropdowns. On a phone, folded behind the Filters button and
              two to a line when open. Wider, they sit in the row with the
              search box (display: contents) — stretched to fill each line on
              a tablet, at their own widths on a wide screen. */}
          <Box
            id="project-filters"
            sx={phone ? {
              display: filtersOpen ? 'grid' : 'none',
              width: '100%',
              gap: 1.5,
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              '& .MuiFormControl-root': { minWidth: 0 },
            } : {
              display: 'contents',
              '& .MuiFormControl-root': { flex: { xs: '1 1 140px', lg: '0 0 auto' } },
            }}
          >
          <FormControl size="small" sx={{ minWidth: 170 }}>
            <InputLabel>Objective</InputLabel>
            <Select label="Objective" value={fObj} onChange={(e) => setFObj(e.target.value)}>
              <MenuItem value="all">All objectives</MenuItem>
              {OBJECTIVES.map((o) => <MenuItem key={o.id} value={o.id}>{o.no}. {o.short}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            {/* shrink + notched: with displayEmpty the box is never empty to
                the reader, but MUI reads the VALUE, so the label stayed put
                and printed itself over "All PICs". */}
            <InputLabel shrink id="pic-filter-label">PIC</InputLabel>
            <Select
              multiple
              notched
              labelId="pic-filter-label"
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
            <Select
              label="Team"
              value={fTeam}
              onChange={(e) => {
                setFTeam(e.target.value)
                // A sub team belongs to a team. Keeping a selection that the
                // new team does not contain leaves an empty table and no
                // visible reason for it.
                setFSub([])
              }}
            >
              <MenuItem value="all">All teams</MenuItem>
              {teams.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel shrink id="subteam-filter-label">Sub team</InputLabel>
            <Select
              multiple
              notched
              labelId="subteam-filter-label"
              label="Sub team"
              value={fSub}
              onChange={(e) => setFSub(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
              displayEmpty
              renderValue={(sel) => (sel.length === 0
                ? 'All sub teams'
                : sel.map((t) => (t === 'none' ? 'None' : t)).join(', '))}
            >
              <MenuItem value="none"><em>No sub team</em></MenuItem>
              {subTeams.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
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
          </Box>
        </Box>

        <Stack direction="row" spacing={{ xs: 1, sm: 2 }} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mt: 1.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Showing {rows.length} of {projects.length} projects
          </Typography>
          {filtersOn && (
            <Button
              size="small"
              onClick={() => {
                setQ(''); setFObj('all'); setFPic([]); setFCommit('all')
                setFGap('all'); setFTeam('all'); setFSub([]); setFHc('all')
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
      </LayoutBlock>

      <LayoutBlock {...block('figures')}>
      {/* Filter-aware totals — always reflects exactly what the table shows */}
      <Paper variant="outlined" sx={{ p: 0, overflow: 'hidden' }}>
        {/* Two to a line on a phone, as many as fit wider. Each tile draws its
            own right and bottom rule, and the strip runs a pixel past the
            frame on those sides so the outer ones are clipped away. */}
        <Box sx={{
          display: 'flex',
          flexWrap: 'wrap',
          bgcolor: 'action.hover',
          mr: '-1px',
          mb: '-1px',
        }}
        >
          {/* In the layout's order, without the hidden ones (shown faded while
              the layout is being edited); on a phone, four until asked. */}
          {lay.tiles
            .map((id) => tileById[id])
            .filter((t) => t && (editingLayout || !lay.hiddenTiles.includes(t.id)))
            .filter((_, i) => editingLayout || !phone || allTiles || i < 4)
            .map((t, i, list) => {
              const off = lay.hiddenTiles.includes(t.id)
              const wide = lay.wideTiles.includes(t.id)
              return (
            <Box
              key={t.id}
              data-tile={t.id}
              sx={{
                flex: { xs: wide ? '1 1 100%' : '1 1 40%', sm: wide ? '2 1 300px' : '1 1 150px' },
                opacity: off ? 0.4 : 1,
                px: { xs: 1.5, sm: 2 },
                py: { xs: 1.25, sm: 1.5 },
                borderRight: 1,
                borderBottom: 1,
                borderColor: 'divider',
                minWidth: 0,
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
              {editingLayout && (
                <Box sx={{ display: 'flex', gap: 0.25, mt: 0.5, opacity: 1 }} data-tile-controls={t.id}>
                  <Tooltip title="Move left"><span><IconButton size="small" disabled={i === 0} onClick={() => editLayout((d) => ({ ...d, tiles: moveId(d.tiles, t.id, -1) }))} aria-label={`move ${t.label} left`}><ChevronLeftIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                  <Tooltip title="Move right"><span><IconButton size="small" disabled={i === list.length - 1} onClick={() => editLayout((d) => ({ ...d, tiles: moveId(d.tiles, t.id, 1) }))} aria-label={`move ${t.label} right`}><ChevronRightIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                  <Tooltip title={wide ? 'Narrower' : 'Wider'}><IconButton size="small" onClick={() => editLayout((d) => ({ ...d, wideTiles: toggleId(d.wideTiles, t.id) }))} aria-label={`${wide ? 'narrower' : 'wider'} ${t.label}`}>{wide ? <WidthNormalOutlinedIcon sx={{ fontSize: 16 }} /> : <WidthWideOutlinedIcon sx={{ fontSize: 16 }} />}</IconButton></Tooltip>
                  <Tooltip title={off ? 'Show' : 'Hide'}><IconButton size="small" onClick={() => editLayout((d) => ({ ...d, hiddenTiles: toggleId(d.hiddenTiles, t.id) }))} aria-label={`${off ? 'show' : 'hide'} ${t.label}`} data-toggle-tile={t.id}>{off ? <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} /> : <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />}</IconButton></Tooltip>
                </Box>
              )}
            </Box>
              )
            })}
        </Box>
        {/* On a phone the money figures wait behind a tap: eleven tiles were
            six screens' worth of rows before the first project. */}
        {phone && (
          <Button
            fullWidth
            size="small"
            onClick={() => setAllTiles((o) => !o)}
            aria-expanded={allTiles}
            endIcon={<ExpandMoreIcon sx={{ transform: allTiles ? 'rotate(180deg)' : 'none' }} />}
            sx={{ borderRadius: 0, color: 'text.secondary', py: 0.75 }}
          >
            {allTiles ? 'Fewer figures' : 'All figures — cost, CAPEX, OPEX, ROI'}
          </Button>
        )}
      </Paper>
      </LayoutBlock>

      <LayoutBlock {...block('tools')}>
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
        <Typography variant="caption" sx={{ color: 'text.secondary', flex: '1 1 260px', display: { xs: 'none', sm: 'block' } }}>
          {rows.length === projects.length
            ? 'exports every project; filter the table first to export a subset'
            : `exports the ${rows.length} row${rows.length === 1 ? '' : 's'} shown, not all ${projects.length}`}
          {' · an import only touches the rows named in the file'}
        </Typography>
        {/* Which columns the register shows: an administrator's choice, made
            once for everybody. A phone shows cards, not columns. */}
        {canWrite && !phone && (
          <>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ViewColumnOutlinedIcon />}
              onClick={(e) => setColsEl(e.currentTarget)}
              aria-haspopup="menu"
              data-columns-button
              sx={{ ml: 'auto' }}
            >
              Columns{hidden.size ? ` (${PROJECT_COLUMNS.length - hidden.size}/${PROJECT_COLUMNS.length})` : ''}
            </Button>
            <Menu
              anchorEl={colsEl}
              open={!!colsEl}
              onClose={() => setColsEl(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              MenuListProps={{ dense: true, 'aria-label': 'columns' }}
            >
              <Box sx={{ px: 2, pt: 0.5, pb: 1, maxWidth: 280 }}>
                <Typography variant="subtitle2">Columns</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                  Shown to everyone who opens the register. The project name, the select box and the cost-sheet button always show.
                </Typography>
                {colsNote && (
                  <Typography variant="caption" sx={{ color: STATUS.warning, display: 'block', mt: 0.5 }} data-columns-note>
                    {colsNote}
                  </Typography>
                )}
              </Box>
              <Divider />
              {PROJECT_COLUMNS.map((c) => (
                <MenuItem key={c.id} onClick={() => toggleColumn(c.id)} data-column={c.id}>
                  <ListItemIcon>
                    <Checkbox size="small" edge="start" checked={show(c.id)} tabIndex={-1} disableRipple sx={{ p: 0.25 }} />
                  </ListItemIcon>
                  <ListItemText primary={c.label} />
                </MenuItem>
              ))}
              <Divider />
              <MenuItem onClick={showAllColumns} disabled={!hidden.size}>
                <ListItemText primary="Show every column" sx={{ pl: 0.5 }} />
              </MenuItem>
            </Menu>
          </>
        )}
      </Box>
      </LayoutBlock>

      <LayoutBlock {...block('table')}>
      {phone ? (
        <PhoneList rows={rows} assignees={assignees} onOpen={setDetailKey} />
      ) : (
      <Box sx={{ position: 'relative' }}>
      <TableContainer
        component={Paper}
        variant="outlined"
        ref={scrollRef}
        onScroll={checkScroll}
        sx={{ maxHeight: '72vh' }}
        data-register-table
      >
        <Table
          size="small"
          stickyHeader
          sx={{
            '& th, & td': { px: 1.25 },
            // The held columns are opaque, so what scrolls under them is
            // hidden, and take the row's hover and selected tint on top.
            '& td.held': { bgcolor: 'background.paper' },
            '& th.held': { bgcolor: 'background.paper' },
            '& tr.MuiTableRow-hover:hover td.held': {
              backgroundImage: `linear-gradient(${theme.palette.action.hover}, ${theme.palette.action.hover})`,
            },
            '& tr.Mui-selected td.held': {
              backgroundImage: `linear-gradient(${theme.palette.action.selected}, ${theme.palette.action.selected})`,
            },
            '& tbody tr': { cursor: 'pointer' },
          }}
        >
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" {...stick('select', true)}>
                <Checkbox size="small" checked={allSelected} indeterminate={sel.size > 0 && !allSelected} onChange={toggleAll} />
              </TableCell>
              {/* The cost sheet has a button of its own; a click on the rest
                  of the row opens the project's detail instead. */}
              <TableCell padding="checkbox" {...stick('cost', true)} />
              {show('jiraKey') && head('jiraKey', 'Jira', 'left', 88)}
              {/* A floor on a phone only: there the table squeezed this column
                  to the width of its smallest input, and the team / programme
                  fields under each name were a few letters wide. Wider
                  screens keep the column-width balance tuned below. */}
              {head('summary', 'Project', 'left', { xs: 220, md: 0 })}
              {show('objective') && <TableCell sx={{ minWidth: 118, maxWidth: 140, width: 140 }}>Objective</TableCell>}
              {show('pic') && <TableCell sx={{ minWidth: 84 }}>PIC</TableCell>}
              {show('savingHours') && head('savingHours', 'Saving hrs/mth', 'right')}
              {/* The other half of the QUANTIFIED benefit: money that is money
                  rather than time, so it sits next to the hours it adds to. */}
              {show('cashBenefit') && head('monetaryAnnualBenefit', 'Cash benefit/yr', 'right', 96)}
              {/* And beside them the part no number carries: a case made only
                  of figures is half a case. */}
              {show('softBenefits') && <TableCell sx={{ minWidth: 150, maxWidth: 170, width: 160 }}>Soft benefits</TableCell>}
              {show('fte') && head('fte', 'FTE', 'right')}
              {show('manday') && head('manday', 'Mandays', 'right')}
              {/* One column, not three: the build/CAPEX/OPEX split lives in
                  the tooltip and in the cost sheet. */}
              {show('investment') && head('investment', 'Investment', 'right', 84)}
              {show('roi') && head('roi', 'ROI', 'right', 78)}
              {show('payback') && head('paybackMonths', 'Payback', 'right', 74)}
              {show('commit') && <TableCell sx={{ minWidth: 104 }}>Commit</TableCell>}
              {show('status') && <TableCell sx={{ minWidth: 92, maxWidth: 104, width: 104 }}>Status</TableCell>}
              {show('delete') && <TableCell padding="checkbox" />}
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
                  onMouseDown={() => { editing.current = !!document.activeElement?.matches?.('input, textarea') }}
                  onClick={(e) => openFromRow(e, p.key)}
                  // Faded cell by cell, not as a row: a see-through row would
                  // let the scrolled columns show through the held ones.
                  sx={OUT_OF_PLAN.has(p.commitLevel) || p.outsideTeam ? { '& > td > *': { opacity: 0.55 } } : undefined}
                >
                  <TableCell padding="checkbox" {...stick('select')}>
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
                  <TableCell padding="checkbox" {...stick('cost')}>
                    <Tooltip title={`Cost sheet: effort, CAPEX, monthly cost and notes for ${p.jiraKey || p.key}`}>
                      <IconButton size="small" onClick={() => setCostKey(p.key)} aria-label="open cost breakdown">
                        <ReceiptLongIcon sx={{ fontSize: 17, color: p.comment ? STATUS.good : undefined }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                  {show('jiraKey') && (
                  <TableCell sx={{ whiteSpace: 'nowrap', fontSize: '0.75rem' }} {...stick('jiraKey')}>
                    <TextCell
                      value={p.jiraKey}
                      placeholder="no key"
                      width={78}
                      onChange={(v) => onUpdate(p.key, { jiraKey: v })}
                      bold
                    />
                  </TableCell>
                  )}
                  <TableCell sx={{ maxWidth: 320, minWidth: 240 }} {...stick('summary')}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                      {/* The way into the project: its name opens its detail, in a popup. */}
                      <NameCell p={p} onOpen={setDetailKey} onRename={(v) => onUpdate(p.key, { summary: v || 'Untitled' })} />
                    </Box>
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
                  {show('objective') && (
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
                  )}
                  {show('pic') && (
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
                  )}
                  {show('savingHours') && (
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
                  )}
                  {show('cashBenefit') && (
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
                  )}
                  {show('softBenefits') && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <SoftBenefitCell
                      value={p.softBenefits}
                      onChange={(v) => onUpdate(p.key, { softBenefits: v })}
                    />
                  </TableCell>
                  )}
                  {show('fte') && (
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
                  )}
                  {show('manday') && (
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
                  )}
                  {show('investment') && (
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem' }}>
                    {p.investment == null ? (
                      <Tooltip title={`No mandays and no CAPEX yet. This project can afford ${p.affordableMandays == null ? '—' : Math.round(p.affordableMandays).toLocaleString()} mandays and still clear the gate. Open the cost sheet (the receipt icon) to add CAPEX or a monthly operating cost.`}>
                        <Typography variant="caption" sx={{ color: 'text.disabled', cursor: 'help' }}>—</Typography>
                      </Tooltip>
                    ) : (
                      <Tooltip title={`Build ${fmtMoney(p.buildCost ?? 0, sym)} + CAPEX ${fmtMoney(p.capex ?? 0, sym)} = ${fmtMoney(p.investment, sym)} one-off${p.opexRunRate > 0 ? `, plus ${fmtMoney(p.opexRunRate, sym)} a month of OPEX (${fmtMoney(p.opexYear, sym)} in 2026)` : ', with no monthly operating cost'}. The cost sheet (the receipt icon) has the month-by-month table.`}>
                        <Typography variant="body2" sx={{ fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums', cursor: 'help' }}>
                          {fmtMoneyShort(p.investment, sym)}
                        </Typography>
                      </Tooltip>
                    )}
                  </TableCell>
                  )}
                  {show('roi') && (
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
                  )}
                  {show('payback') && (
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
                  )}
                  {show('commit') && (
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
                  )}
                  {show('status') && (
                  <TableCell>
                    {/* A pill, coloured by where the work is; the word is on it
                        too. Whatever Jira calls it is shown as it is. */}
                    {projectOnHold(p)
                      ? <Pill label="On Hold" tone="warn" />
                      : (p.srcStatus || p.status)
                      ? <Pill label={p.srcStatus || p.status} tone={statusTone(p.status || p.srcStatus)} />
                      : <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>}
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
                  )}
                  {show('delete') && (
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
                  )}
                </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={3 + PROJECT_COLUMNS.length} align="center" sx={{ py: 6, color: 'text.secondary', cursor: 'default' }}>
                  No projects match these filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {/* More to the right: a soft fade at the edge says so. */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: 1,
          right: 1,
          bottom: 1,
          width: 28,
          pointerEvents: 'none',
          borderTopRightRadius: 14,
          borderBottomRightRadius: 14,
          background: `linear-gradient(to right, transparent, ${alpha(theme.palette.background.paper, 0.92)})`,
          opacity: moreRight ? 1 : 0,
          transition: 'opacity .2s',
        }}
        data-scroll-cue={moreRight ? 'on' : 'off'}
      />
      </Box>
      )}
      </LayoutBlock>

      {/* Looked up by key on every render, so a CAPEX typed inside it moves the
          ROI in the header of the very same dialog. */}
      <ImportDialog
        result={importing?.result}
        fileName={importing?.fileName}
        onClose={() => setImporting(null)}
        onApply={() => { onImport(importing.result); setImporting(null) }}
      />

      <ProjectDetailDialog
        projectKey={detailKey}
        plan={plan}
        canWrite={canWrite}
        phone={phone}
        onUpdate={onUpdate}
        onClose={() => setDetailKey(null)}
        onCostSheet={(k) => setCostKey(k)}
        onShowTimeline={onShowTimeline}
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
