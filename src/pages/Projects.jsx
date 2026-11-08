import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import { statusTone } from '../components/Brand.jsx'
import { projectOnHold } from '../lib/hold.js'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel,
  TextField, Select, MenuItem, InputAdornment, InputBase, Checkbox, Button, Tooltip,
  FormControl, InputLabel, TableContainer, Menu, Alert, IconButton, Link, Popover,
  ListItemIcon, ListItemText, Divider, Dialog, DialogTitle, DialogContent, DialogActions, useMediaQuery,
} from '@mui/material'
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import FilterListIcon from '@mui/icons-material/FilterList'
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
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import SearchIcon from '@mui/icons-material/Search'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import ReceiptLongIcon from '@mui/icons-material/ReceiptLongOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import CloseIcon from '@mui/icons-material/Close'
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined'
import { OBJECTIVES, OBJ_BY_ID, COMMIT_LEVELS, CHART, OUT_OF_PLAN } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths, fmtMonthsShort, gateAsPaybackMonths, workingDaysBetween,
  normalizeSoftBenefits, softBenefitsText, impliedObjectives,
} from '../lib/model.js'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined'
import ProjectCostDialog from '../components/ProjectCostDialog.jsx'
import ImportDialog from '../components/ImportDialog.jsx'
import {
  PageHeader, StatusPill, EmptyState, SectionSkeleton, Toolbar,
} from '../components/ui.jsx'
import { Spinner } from '../components/Loading.jsx'
import { exportFiltered, readProjectsFile, planImport } from '../lib/projectIO.js'
import { useTheme, alpha } from '@mui/material/styles'

const PHONE = '@media (max-width:599.95px)'

/*
 * Commit levels as a small dot in the status tones, the word always beside it.
 * Deferred and excluded are both "not this year": a filled grey dot and an
 * empty one, so they still read apart.
 */
const COMMIT_DOT = {
  commit: 'success', stretch: 'info', watch: 'warning', nextyear: 'neutral', excluded: 'hollow',
}

/** Jira's own words in sentence case: "In Progress" reads "In progress"; "UAT" stays "UAT". */
const sentence = (s) => String(s || '').split(' ')
  .map((w, i) => (i > 0 && /^[A-Z][a-z]+$/.test(w) ? w.toLowerCase() : w))
  .join(' ')

/**
 * AN EDITABLE CELL THAT READS AS TEXT. At rest it is the value and nothing
 * else; hovering its row draws a quiet box round every cell that can change,
 * and focus turns the box into the input, edged in the primary colour.
 */
const cellBox = (t) => ({
  fontSize: '0.8125rem',
  lineHeight: '18px',
  color: t.palette.text.primary,
  borderRadius: '6px',
  border: '1px solid transparent',
  backgroundColor: 'transparent',
  transition: 'border-color 120ms, box-shadow 120ms, background-color 120ms',
  '& .MuiInputBase-input': { padding: '5px 7px', height: 18 },
  '& .MuiInputBase-input::placeholder': { color: t.palette.text.tertiary, opacity: 1 },
  'tr:hover &, &:hover': { borderColor: t.palette.border.strong },
  '&.Mui-focused': {
    borderColor: t.palette.primary.main,
    boxShadow: `0 0 0 1px ${t.palette.primary.main}`,
    backgroundColor: t.palette.bg.surface,
  },
  // A select at rest: its value, and a caret in the tertiary colour.
  '& .MuiSelect-select': {
    padding: '5px 24px 5px 7px', minHeight: 0, height: 18, display: 'flex', alignItems: 'center',
  },
  '& .MuiSelect-icon': { right: 2, fontSize: 18, color: t.palette.text.tertiary },
})

/** Free-text cell that only commits on blur. */
function TextCell({
  value, onChange, placeholder, width, bold, autoFocus = false, label,
}) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== (value ?? '')) setDraft(value ?? '')
  return (
    <InputBase
      size="small"
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
      inputProps={{ 'aria-label': label, style: { fontWeight: bold ? 500 : 400 } }}
      sx={[cellBox, { width }]}
    />
  )
}

/** Number cell that only commits on blur, so typing never fights React state. */
function NumCell({
  value, onChange, placeholder = '—', width = 76, estimated, label,
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== (value == null ? '' : String(value))) {
    setDraft(value == null ? '' : String(value))
  }
  return (
    <InputBase
      size="small"
      value={focused ? draft : (value == null ? '' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }))}
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
        'aria-label': label,
        inputMode: 'decimal',
        style: {
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          fontStyle: estimated && value != null ? 'italic' : 'normal',
        },
      }}
      sx={[cellBox, { width }]}
    />
  )
}

/** A select inside a table cell: plain text at rest, like the inputs. */
function CellSelect({
  value, onChange, renderValue, children, width, displayEmpty, label, sx,
}) {
  return (
    <Select
      size="small"
      value={value}
      onChange={onChange}
      renderValue={renderValue}
      displayEmpty={displayEmpty}
      input={<InputBase />}
      inputProps={{ 'aria-label': label }}
      MenuProps={{ slotProps: { paper: { sx: { maxHeight: 420 } } } }}
      sx={[cellBox, { width, maxWidth: width }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {children}
    </Select>
  )
}

/** A 6px mark, for a colour that carries a meaning the word beside it repeats. */
const Dot = ({ color, hollow = false }) => (
  <Box
    component="span"
    aria-hidden
    sx={{
      width: 6,
      height: 6,
      borderRadius: '50%',
      flexShrink: 0,
      bgcolor: hollow ? 'transparent' : color,
      border: hollow ? '1px solid' : 0,
      borderColor: 'text.tertiary',
    }}
  />
)

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
          outline: '1px dashed', outlineColor: 'border.strong', outlineOffset: 6, borderRadius: '8px',
        }),
      }}
    >
      {editing && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 2, mb: hidden ? 0 : 2, minHeight: 28,
        }}
        >
          <Typography variant="subtitle2" component="div" sx={{ color: hidden ? 'text.tertiary' : 'text.secondary' }}>
            {label}
          </Typography>
          {hidden && <StatusPill tone="neutral">Hidden</StatusPill>}
          <Box sx={{ flex: 1 }} />
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="Move up"><span><IconButton size="small" disabled={first} onClick={() => onMove(-1)} aria-label={`move ${label} up`} sx={tool}><ArrowUpwardIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
            <Tooltip title="Move down"><span><IconButton size="small" disabled={last} onClick={() => onMove(1)} aria-label={`move ${label} down`} sx={tool}><ArrowDownwardIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
            {!locked && (
              <Tooltip title={hidden ? 'Show' : 'Hide'}>
                <IconButton size="small" onClick={onToggle} aria-label={`${hidden ? 'show' : 'hide'} ${label}`} data-toggle-block={id} sx={tool}>
                  {hidden ? <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} /> : <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />}
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
      )}
      {!hidden && children}
    </Box>
  )
}

/* The 28px icon button of the layout controls. */
const tool = {
  width: 28, height: 28, color: 'text.secondary', '&:hover': { color: 'text.primary' },
}

/**
 * THE PROJECT'S NAME: a link that opens its detail popup. The pencil beside it
 * turns it into an editable box for renaming; leaving the box turns it back.
 */
function NameCell({ p, onOpen, onRename }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <Box sx={{ minWidth: 0 }} onBlur={() => setEditing(false)} data-name-editing>
        <TextCell value={p.summary} placeholder="Project name" onChange={onRename} bold autoFocus label="project name" />
      </Box>
    )
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Tooltip title={p.summary || 'Untitled'} enterDelay={700} placement="top-start">
        <Link
          component="button"
          type="button"
          onClick={() => onOpen(p.key)}
          data-open-project={p.key}
          underline="hover"
          sx={{
            minWidth: 0,
            textAlign: 'left',
            fontSize: '0.8125rem',
            lineHeight: '18px',
            fontWeight: 500,
            color: 'text.primary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            py: 0.25,
          }}
        >
          {p.summary || 'Untitled'}
        </Link>
      </Tooltip>
      <Tooltip title="Rename">
        <IconButton
          size="small"
          className="row-tool"
          onClick={() => setEditing(true)}
          aria-label={`rename ${p.summary}`}
          data-rename-project={p.key}
          sx={{
            flexShrink: 0, width: 24, height: 24, color: 'text.tertiary', '&:hover': { color: 'text.primary' },
          }}
        >
          <EditOutlinedIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}

/**
 * The line under a project's name: its team, sub team and programme, written
 * out in full and never clipped mid-word inside a box. A click opens the three
 * as labelled fields; closing the popover saves whatever changed.
 */
function MetaCell({ p, onUpdate }) {
  const [at, setAt] = useState(null)
  const [draft, setDraft] = useState({})
  const parts = [p.team, p.subTeam, p.program].filter(Boolean)
  const text = parts.join(', ')
  const open = (e) => {
    setDraft({ team: p.team || '', subTeam: p.subTeam || '', program: p.program || '' })
    setAt(e.currentTarget)
  }
  const close = () => {
    setAt(null)
    const patch = {}
    for (const k of ['team', 'subTeam', 'program']) {
      const v = (draft[k] || '').trim() || null
      if (v !== (p[k] ?? null)) patch[k] = v
    }
    if (Object.keys(patch).length) onUpdate(patch)
  }
  const field = (k, label) => (
    <TextField
      size="small"
      label={label}
      value={draft[k] ?? ''}
      onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
      onKeyDown={(e) => { if (e.key === 'Enter') close() }}
      fullWidth
    />
  )
  return (
    <>
      <Tooltip title={text} enterDelay={600} placement="bottom-start" disableHoverListener={!text}>
        <Box
          component="button"
          type="button"
          onClick={open}
          aria-label={`team and programme of ${p.summary || p.key}`}
          sx={{
            all: 'unset',
            boxSizing: 'border-box',
            display: 'block',
            maxWidth: '100%',
            mt: 0.25,
            px: 1,
            mx: -1,
            borderRadius: '4px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            fontSize: '0.75rem',
            lineHeight: '18px',
            color: text ? 'text.secondary' : 'text.tertiary',
            transition: 'background-color 120ms, color 120ms',
            '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
            '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: 0 },
          }}
        >
          {text || 'Add team'}
        </Box>
      </Tooltip>
      <Popover
        open={!!at}
        anchorEl={at}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1 } } }}
      >
        <Box sx={{
          p: 4, width: 300, display: 'grid', gap: 3,
        }}
        >
          <Typography variant="h3">Team and programme</Typography>
          {field('team', 'Team')}
          {field('subTeam', 'Sub team')}
          {field('program', 'Programme')}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" onClick={close}>Done</Button>
          </Box>
        </Box>
      </Popover>
    </>
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
        sx={(t) => ({
          ...cellBox(t),
          cursor: 'pointer',
          minHeight: 30,
          px: '7px',
          py: '5px',
          maxWidth: 200,
          '&:focus-visible': { outline: 'none', borderColor: t.palette.primary.main, boxShadow: `0 0 0 1px ${t.palette.primary.main}` },
        })}
      >
        {list.length ? (
          <>
            {list.slice(0, 2).map((b, i) => (
              <Typography key={i} variant="caption" component="div" noWrap sx={{ lineHeight: '18px', color: 'text.primary' }}>
                {b}
              </Typography>
            ))}
            {list.length > 2 && (
              <Typography variant="caption" component="div" sx={{ color: 'text.secondary', lineHeight: '18px' }}>
                {list.length - 2} more
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="caption" component="div" sx={{ color: 'text.tertiary', lineHeight: '18px' }}>—</Typography>
        )}
      </Box>
      <Popover
        open={!!anchor}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1 } } }}
      >
        <Box sx={{ p: 4, width: 380, maxWidth: 'calc(100vw - 32px)' }}>
          <Typography variant="h3">Soft benefits</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 3 }}>
            What this delivers that the saving hours do not capture: control, an audit trail, a risk removed.
            One per line. They show on the scorecard of everyone credited on it, and in the export.
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
            inputProps={{ 'aria-label': 'soft benefits, one per line' }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
            <Button variant="contained" onClick={close}>Done</Button>
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
 * The primary tag in the select stays what the register reports in one
 * column; these are the rest, as one quiet count beside it ("+2"). A click
 * lists them all: the ones every project serves (fixed), the ones added here
 * (a tick to take off), and the rest (a tick to add).
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
  const n = implied.length + extra.length
  const names = [...implied, ...extra].map((id) => `${OBJ_BY_ID[id].no}. ${OBJ_BY_ID[id].short}`).join(', ')

  return (
    <>
      <Tooltip title={n ? `Also counts toward ${names}` : 'Count it toward another objective'}>
        <Box
          component="button"
          type="button"
          aria-label={n ? `also counts toward ${n} more objectives` : 'add objective tag'}
          aria-haspopup="menu"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            all: 'unset',
            boxSizing: 'border-box',
            flexShrink: 0,
            cursor: 'pointer',
            px: 1,
            height: 24,
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: '4px',
            fontSize: '0.75rem',
            fontWeight: 500,
            color: 'text.secondary',
            fontVariantNumeric: 'tabular-nums',
            '&:hover': { color: 'text.primary', bgcolor: 'action.hover' },
            '&:focus-visible': { outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main' },
          }}
        >
          {n ? `+${n}` : <AddIcon sx={{ fontSize: 14 }} />}
        </Box>
      </Tooltip>
      <Menu
        open={!!anchor}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        MenuListProps={{ dense: true, 'aria-label': 'other objectives' }}
      >
        <Box sx={{ px: 3, pt: 1, pb: 2, maxWidth: 300 }}>
          <Typography variant="h3">Also counts toward</Typography>
          <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Only the hours objective counts hours, so a tag adds what it delivers, never its hours twice.
          </Typography>
        </Box>
        <Divider />
        {implied.map((id) => (
          <MenuItem key={id} disabled sx={{ '&.Mui-disabled': { opacity: 1 } }}>
            <ListItemIcon><Checkbox size="small" edge="start" checked disabled tabIndex={-1} disableRipple sx={{ p: 0.5 }} /></ListItemIcon>
            <ListItemText
              primary={`${OBJ_BY_ID[id].no}. ${OBJ_BY_ID[id].short}`}
              secondary={OBJ_BY_ID[id].measure === 'ratio' ? 'Every project: its return is worked out over all of them' : 'Every project: its hours all count here'}
            />
          </MenuItem>
        ))}
        {extra.map((id) => (
          <MenuItem key={id} onClick={() => onChange(extra.filter((x) => x !== id))}>
            <ListItemIcon><Checkbox size="small" edge="start" checked tabIndex={-1} disableRipple sx={{ p: 0.5 }} /></ListItemIcon>
            <ListItemText primary={`${OBJ_BY_ID[id].no}. ${OBJ_BY_ID[id].short}`} secondary="Added here" />
          </MenuItem>
        ))}
        {spare.map((o) => (
          <MenuItem key={o.id} onClick={() => onChange([...extra, o.id])}>
            <ListItemIcon><Checkbox size="small" edge="start" checked={false} tabIndex={-1} disableRipple sx={{ p: 0.5 }} /></ListItemIcon>
            <ListItemText
              primary={`${o.no}. ${o.short}`}
              secondary={o.measure === 'count' ? `Counts ${o.countUnit}` : o.measure === 'hours' ? 'Counts the hours' : `Counts by ${o.measure}`}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
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

/** A project's state as pills: on hold or where the work is, and past due beside it. */
function StatePills({ p, column = false }) {
  const status = projectOnHold(p)
    ? <StatusPill tone="warning">On hold</StatusPill>
    : (p.srcStatus || p.status)
      ? <StatusPill tone={statusTone(p.status || p.srcStatus)}>{sentence(p.srcStatus || p.status)}</StatusPill>
      : null
  return (
    <Box sx={{
      display: 'flex', flexDirection: column ? 'column' : 'row', alignItems: column ? 'flex-start' : 'center', gap: 1, flexWrap: 'wrap',
    }}
    >
      {status || <Typography variant="body2" component="span" sx={{ color: 'text.tertiary' }}>—</Typography>}
      {p.pastDue && (
        // The date lives in the tooltip: spelled out here it was the widest
        // thing in the column and pushed ROI off-screen.
        <Tooltip title={`Due ${p.due} and not done`}>
          <span><StatusPill tone="danger">Past due</StatusPill></span>
        </Tooltip>
      )}
    </Box>
  )
}

/**
 * THE REGISTER ON A PHONE: one row a project, the few facts that tell them
 * apart, and a tap opens the project. Editing is for a wider screen; on a
 * phone this is for looking something up.
 */
function PhoneList({ rows, assignees, onOpen, onClear, filtered }) {
  if (!rows.length) {
    return (
      <Paper variant="outlined">
        <EmptyState
          icon={FolderOpenOutlinedIcon}
          title="No projects match these filters"
          body="Clear a filter or search for something else."
          action={filtered ? <Button variant="outlined" onClick={onClear}>Clear filters</Button> : null}
        />
      </Paper>
    )
  }
  return (
    <Paper variant="outlined" component="ul" aria-label="projects" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {rows.map((p, i) => {
        const owner = assignees.find((x) => x.id === p.pic)
        const muted = OUT_OF_PLAN.has(p.commitLevel) || p.outsideTeam
        const meta = [
          p.jiraKey || 'No Jira key',
          owner?.nick || 'No PIC',
          p.savingHours == null ? 'hours TBC' : `${fmtHours(p.savingHours)} hrs/mth`,
        ].join(', ')
        return (
          <Box component="li" key={p.key} sx={{ borderTop: i === 0 ? 0 : 1, borderColor: 'border.subtle' }}>
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
                gap: 2,
                px: 3,
                py: 3,
                minHeight: 64,
                cursor: 'pointer',
                color: 'text.primary',
                '&:hover, &:active': { bgcolor: 'bg.subtle' },
                '&:focus-visible': {
                  outline: 2, outlineStyle: 'solid', outlineColor: 'primary.main', outlineOffset: -2,
                },
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0, opacity: muted ? 0.6 : 1 }}>
                <Typography
                  variant="body1"
                  sx={{
                    fontWeight: 500,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {p.summary || p.key}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }} noWrap>
                  {meta}
                </Typography>
              </Box>
              <Box sx={{ flexShrink: 0, maxWidth: 118 }}>
                <StatePills p={p} column />
              </Box>
              <ChevronRightIcon sx={{ color: 'text.tertiary', flexShrink: 0, fontSize: 20 }} />
            </Box>
          </Box>
        )
      })}
    </Paper>
  )
}

export default function Projects({
  plan, onUpdate, onBulk, onAdd, onDelete, onImport,
  onSave, dirty, saving, blocked = [], onGoTo, jump = null,
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
  // A phone's filters open in a sheet; the rarer filters wait behind "More filters".
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [moreEl, setMoreEl] = useState(null)
  const [menuEl, setMenuEl] = useState(null)
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
  // A tablet holds the name rather than the key: a row of numbers with only
  // "FNP-1151" beside it says less than one with the project's name.
  const stickyIds = ['select', 'cost', ...(wide && show('jiraKey') ? ['jiraKey'] : []), 'summary']
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
        // The arrow on the inside edge, so a right-aligned header still lines
        // up with the numbers under it.
        sx={align === 'right' ? { flexDirection: 'row-reverse', '& .MuiTableSortLabel-icon': { ml: 0, mr: 0.5 } } : undefined}
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

  /*
   * "Save changes" appears only when an edit is still waiting after the
   * automatic save has had its chance (four seconds): when this browser is
   * not on the shared plan yet, or is behind it. Shown on every keystroke it
   * would blink in and out of the header all day.
   */
  const [waiting, setWaiting] = useState(false)
  useEffect(() => {
    if (!dirty) { setWaiting(false); return undefined }
    const t = setTimeout(() => setWaiting(true), 6500)
    return () => clearTimeout(t)
  }, [dirty, projects])
  const showSave = canWrite && !blocked.length && (saving || (dirty && waiting))

  const clearFilters = () => {
    setQ(''); setFObj('all'); setFPic([]); setFCommit('all')
    setFGap('all'); setFTeam('all'); setFSub([]); setFHc('all')
  }
  const moreOn = [fCommit, fGap, fHc].filter((f) => f !== 'all').length

  const tone = theme.palette.tone

  // The figures over the table, by id, for the layout to order and hide.
  const tileById = Object.fromEntries([
    {
      id: 'count', label: 'Projects', value: agg.count.toLocaleString(), note: agg.tbc ? `${agg.tbc} still TBC` : 'All quantified',
    },
    {
      id: 'hours',
      label: 'Saving hrs/mth',
      value: fmtHours(agg.hours),
      note: agg.deferred > 0
        ? `${fmtHours(agg.deferred)} of it out of plan`
        : `${fmtPct(agg.pctOfBook)} of the register`,
      tone: agg.deferred > 0 ? 'warning' : undefined,
    },
    {
      id: 'done', label: 'Delivered', value: fmtHours(agg.done), note: 'Marked Done',
    },
    {
      id: 'fte',
      label: 'FTE released',
      value: agg.hc ? agg.hc.toFixed(1) : '—',
      note: `At ${fin.hoursPerFteMonth} hrs/mth each`,
      help: `The source workbook's own FTE column: saving hours ÷ ${fin.hoursPerFteMonth} hours per FTE month, rounded to one decimal on each project. Change the ratio on the Model page; it drives this figure and the accountant hourly rate together. Capacity released, not people removed from the payroll.`,
    },
    {
      id: 'benefit',
      label: 'Benefit/yr',
      value: fmtMoneyShort(agg.annualBenefit, sym),
      note: `${fmtMoney(fin.acctHourRate, sym)} per saved hour`,
      help: 'Saving hours x the accountant rate, for a year. Covers every quantified row in view, whether or not it has an effort estimate.',
    },
    {
      id: 'build',
      label: 'Build cost',
      value: agg.buildCost == null ? '—' : fmtMoneyShort(agg.buildCost, sym),
      note: agg.buildCost == null ? 'No mandays in view' : `${fmtMoney(fin.devDayRate, sym)} per manday`,
      help: 'Mandays x the developer rate, across the in-plan rows in view that carry an effort estimate.',
    },
    {
      id: 'manday', label: 'Mandays', value: agg.manday ? fmtHours(agg.manday) : '—', note: agg.manday ? 'Invested' : 'Not entered yet',
    },
    {
      id: 'capex',
      label: 'CAPEX',
      value: agg.capex == null ? '—' : fmtMoneyShort(agg.capex, sym),
      note: agg.capex == null ? 'None entered' : 'One-off, not depreciated',
      help: "Infrastructure, licences and hardware bought once, across the in-plan rows in view. Enter it on a project's cost sheet (the receipt icon on its row). No depreciation is applied: the whole amount is charged against the project.",
    },
    {
      id: 'opex',
      label: 'OPEX/yr',
      value: agg.opexYear > 0 ? fmtMoneyShort(agg.opexYear, sym) : '—',
      note: agg.opexRunRate > 0 ? `${fmtMoneyShort(agg.opexRunRate, sym)} a month run-rate` : 'None entered',
      help: 'The 2026 monthly-cost grid added up: each running-cost line counted only in the months it is live. The run-rate ignores start and end months; it is the steady monthly cost the ROI is measured against.',
    },
    {
      id: 'investment',
      label: 'Investment',
      value: agg.investment == null ? '—' : fmtMoneyShort(agg.investment, sym),
      note: agg.investment == null ? 'Nothing costed in view' : 'Build and CAPEX, costed rows',
      help: 'Build cost plus CAPEX, across only the rows in view that carry both a known cost and a known benefit: the same set the ROI divides. It is deliberately not Build cost plus CAPEX above, which cover every in-plan row on screen.',
    },
    {
      id: 'roi',
      label: 'ROI',
      value: agg.roi == null ? '—' : fmtRoi(agg.roi),
      note: agg.roi == null
        ? 'Needs mandays or CAPEX'
        : `${agg.roi >= fin.roiGate ? 'Clears' : 'Below'} the ${fmtRoi(fin.roiGate)} gate, ${agg.roiRows} of ${agg.inPlanCount} rows`,
      tone: agg.roi == null ? undefined : agg.roi >= fin.roiGate ? 'success' : 'danger',
      help: `Return over ${horizon} months on the whole investment (build cost plus CAPEX) against the benefit net of the monthly OPEX. Only rows carrying both a known cost and a known benefit are on either side, so this is never a whole-book benefit divided by a partial cost.`,
    },
  ].map((t) => [t.id, { ...t, empty: t.value === '—' }]))

  const description = editingLayout
    ? 'Move or hide the blocks and figures. The layout is saved for everybody.'
    : `${projects.length} projects in the 2026 register.`

  const help = phone ? (
    <>
      <p>Tap a project to open it. Editing the register is for a wider screen.</p>
      <p>The figures follow the search and filters.</p>
    </>
  ) : (
    <>
      <p>Every cell edits in place and updates the dashboard, the scorecards and the export as you type. Hover a row to see which cells can change.</p>
      <p>Click a project&rsquo;s name, or its row away from the editable cells, to open it: owner, dates, weekly check-ins and the active switch. The pencil renames it; the receipt icon opens its cost sheet with CAPEX, monthly OPEX and the 2026 cost grid.</p>
      <p>Saving hours are per month, as in the source workbook. FTE is worked out from them at the ratio on the Model page. The figures above the table follow the search and filters.</p>
      <p>
        {layoutSaved === null
          ? 'Columns and layout cannot be changed while the shared database is unavailable.'
          : layoutSaved?.updatedBy
            ? `Columns and layout are the same for everybody; the layout was arranged by ${layoutSaved.updatedBy}.`
            : 'Columns and layout are set by an administrator and are the same for everybody.'}
      </p>
    </>
  )

  /*
   * One file picked or dropped: read it, plan the import, show the preview.
   * Nothing is written until the preview's own button says so.
   */
  const takeFile = async (file) => {
    if (!file) return
    setBusy(true)
    try {
      const parsed = await readProjectsFile(await file.arrayBuffer())
      setImporting({
        fileName: file.name,
        choosing: true,
        result: parsed.error
          ? { error: parsed.error, changes: [] }
          : planImport(parsed, { projects, people: assignees }, plan),
      })
    } catch (err) {
      setImporting({ fileName: file.name, choosing: true, result: { error: `Could not read the file: ${err.message}.`, changes: [] } })
    } finally { setBusy(false) }
  }
  const doExport = async () => {
    setBusy(true)
    try {
      await exportFiltered(rows, assignees, describeFilter, filterParts)
    } finally { setBusy(false) }
  }
  const exportLabel = `Export ${rows.length === projects.length ? 'all' : 'filtered'} (${rows.length})`
  const exportHint = rows.length === projects.length
    ? 'Exports every project as an Excel working file. Filter the table first to export a subset.'
    : `Exports the ${rows.length} row${rows.length === 1 ? '' : 's'} shown, not all ${projects.length}.`
  const estimateHint = `Spreads a year of the team's capacity (${teamSize} people, about ${capacityMandays.toLocaleString()} mandays) across the ${uncosted.length} project${uncosted.length === 1 ? '' : 's'} in view with no effort, in proportion to how long each runs. A starting point to edit; every value stays marked as an estimate.`

  /* ---------------------------------------------------------------- */
  /* The header's actions                                              */
  /* ---------------------------------------------------------------- */
  let actions
  if (editingLayout) {
    actions = (
      <Box data-layout-toolbar sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Button onClick={() => setLayoutDraft(DEFAULT_PROJECT_LAYOUT)}>Reset to default</Button>
        <Button onClick={() => { setLayoutDraft(null); setLayoutError(null) }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={saveLayout}
          disabled={layoutBusy}
          startIcon={layoutBusy ? <Spinner size={14} /> : null}
          data-save-layout
        >
          {layoutBusy ? 'Saving…' : 'Save layout'}
        </Button>
      </Box>
    )
  } else if (phone) {
    actions = canWrite ? (
      <>
        <Button variant="contained" startIcon={<AddIcon />} onClick={onAdd}>Add project</Button>
        <Tooltip title="More actions">
          <IconButton aria-label="more actions" aria-haspopup="menu" onClick={(e) => setMenuEl(e.currentTarget)} sx={{ width: 40, height: 40, color: 'text.secondary' }}>
            <MoreVertIcon />
          </IconButton>
        </Tooltip>
        <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
          {uncosted.length > 0 && (
            <MenuItem onClick={() => { setMenuEl(null); estimateEffort() }}>
              <ListItemIcon><AutoFixHighIcon fontSize="small" /></ListItemIcon>
              <ListItemText primary={`Estimate effort (${uncosted.length})`} />
            </MenuItem>
          )}
          <MenuItem disabled={!rows.length || busy} onClick={() => { setMenuEl(null); doExport() }}>
            <ListItemIcon><FileDownloadOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary={exportLabel} />
          </MenuItem>
          <MenuItem disabled={busy} onClick={() => { setMenuEl(null); setImporting({ choosing: true }) }}>
            <ListItemIcon><FileUploadOutlinedIcon fontSize="small" /></ListItemIcon>
            <ListItemText primary="Import" />
          </MenuItem>
        </Menu>
      </>
    ) : null
  } else if (canWrite) {
    actions = (
      <Box data-layout-toolbar sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {layoutSaved !== undefined && layoutSaved !== null && (
          <Button
            startIcon={<LayoutIcon />}
            onClick={() => { setLayoutDraft(lay); setLayoutError(null) }}
            sx={{ color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
            data-edit-layout
          >
            Edit layout
          </Button>
        )}
        {uncosted.length > 0 && (
          <Tooltip title={estimateHint}>
            <Button variant="outlined" startIcon={<AutoFixHighIcon />} onClick={estimateEffort}>
              Estimate effort ({uncosted.length})
            </Button>
          </Tooltip>
        )}
        {showSave && (
          <Button
            variant="contained"
            onClick={onSave}
            disabled={saving}
            startIcon={saving ? <Spinner size={14} /> : null}
            data-save-changes
          >
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        )}
        <Button variant={showSave ? 'outlined' : 'contained'} startIcon={<AddIcon />} onClick={onAdd}>
          Add project
        </Button>
      </Box>
    )
  }

  /* ---------------------------------------------------------------- */
  /* The filters: one row of the four everybody uses, the rest behind  */
  /* "More filters"; on a phone, all of them in a sheet.               */
  /* ---------------------------------------------------------------- */
  const fObjective = (
    <FormControl key="obj" size="small" sx={{ minWidth: 168 }}>
      <InputLabel id="obj-filter-label">Objective</InputLabel>
      <Select labelId="obj-filter-label" label="Objective" value={fObj} onChange={(e) => setFObj(e.target.value)}>
        <MenuItem value="all">All objectives</MenuItem>
        {OBJECTIVES.map((o) => <MenuItem key={o.id} value={o.id}>{o.no}. {o.short}</MenuItem>)}
      </Select>
    </FormControl>
  )
  const fPicField = (
    <FormControl key="pic" size="small" sx={{ minWidth: 140 }}>
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
        renderValue={(s) => (s.length === 0
          ? 'All PICs'
          : s.map((id) => (id === 'none' ? 'Unassigned' : (assignees.find((x) => x.id === id)?.nick || id))).join(', '))}
        sx={{ maxWidth: 220 }}
      >
        <MenuItem value="none">Unassigned</MenuItem>
        {/* assignees, not people: IT and any other partner team own
            delivery on real projects and have to be filterable, even
            though they carry no scorecard. */}
        {assignees.map((p) => (
          <MenuItem key={p.id} value={p.id}>
            {p.nick}
            {p.scorecard === false && (
              <Typography component="span" variant="body2" sx={{ ml: 1.5, color: 'text.secondary' }}>
                no scorecard
              </Typography>
            )}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
  const fTeamField = (
    <FormControl key="team" size="small" sx={{ minWidth: 132 }}>
      <InputLabel id="team-filter-label">Team</InputLabel>
      <Select
        labelId="team-filter-label"
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
  )
  const fSubField = (
    <FormControl key="sub" size="small" sx={{ minWidth: 148 }}>
      <InputLabel shrink id="subteam-filter-label">Sub team</InputLabel>
      <Select
        multiple
        notched
        labelId="subteam-filter-label"
        label="Sub team"
        value={fSub}
        onChange={(e) => setFSub(typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value)}
        displayEmpty
        renderValue={(s) => (s.length === 0
          ? 'All sub teams'
          : s.map((t) => (t === 'none' ? 'None' : t)).join(', '))}
        sx={{ maxWidth: 240 }}
      >
        <MenuItem value="none">No sub team</MenuItem>
        {subTeams.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
      </Select>
    </FormControl>
  )
  const fFteField = (
    <FormControl key="fte" size="small" fullWidth sx={{ minWidth: 140 }}>
      <InputLabel id="fte-filter-label">FTE</InputLabel>
      <Select labelId="fte-filter-label" label="FTE" value={fHc} onChange={(e) => setFHc(e.target.value)}>
        <MenuItem value="all">Any FTE</MenuItem>
        <MenuItem value="some">Has FTE (&gt; 0)</MenuItem>
        <MenuItem value="none">No FTE</MenuItem>
        <MenuItem value="gte0.5">0.5 FTE or more</MenuItem>
        <MenuItem value="gte1">1 FTE or more</MenuItem>
        <MenuItem value="gte3">3 FTE or more</MenuItem>
      </Select>
    </FormControl>
  )
  const fCommitField = (
    <FormControl key="commit" size="small" fullWidth sx={{ minWidth: 140 }}>
      <InputLabel id="commit-filter-label">Commit</InputLabel>
      <Select labelId="commit-filter-label" label="Commit" value={fCommit} onChange={(e) => setFCommit(e.target.value)}>
        <MenuItem value="all">All levels</MenuItem>
        {COMMIT_LEVELS.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
      </Select>
    </FormControl>
  )
  const fGapField = (
    <FormControl key="gap" size="small" fullWidth sx={{ minWidth: 140 }}>
      <InputLabel id="gap-filter-label">Data gap</InputLabel>
      <Select labelId="gap-filter-label" label="Data gap" value={fGap} onChange={(e) => setFGap(e.target.value)}>
        <MenuItem value="all">Everything</MenuItem>
        <MenuItem value="saving">Missing saving hrs</MenuItem>
        <MenuItem value="nokey">Missing Jira key</MenuItem>
        <MenuItem value="pic">Missing PIC</MenuItem>
        <MenuItem value="manday">No effort estimate</MenuItem>
        <MenuItem value="gate">Below the ROI gate</MenuItem>
        <MenuItem value="pastdue">Past due, not done</MenuItem>
      </Select>
    </FormControl>
  )
  const search = (
    <TextField
      key="q"
      size="small"
      placeholder="Search key, project, team, assignee…"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      inputProps={{ 'aria-label': 'search projects' }}
      InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: 'text.tertiary' }} /></InputAdornment> }}
      sx={{ flex: '1 1 220px', minWidth: { xs: 0, sm: 200 }, maxWidth: { sm: 360 } }}
    />
  )
  const count = `Showing ${rows.length} of ${projects.length}`

  /* ---------------------------------------------------------------- */
  /* The figures                                                       */
  /* ---------------------------------------------------------------- */
  const tileList = lay.tiles
    .map((id) => tileById[id])
    .filter((t) => t && (editingLayout || !lay.hiddenTiles.includes(t.id)))
  const firstRow = phone ? 4 : 6
  const rest = tileList.slice(firstRow)
  // The costing figures stay folded until any of them has a value (or on a
  // phone, always): a row of dashes is a row nobody needs to read.
  const folded = !editingLayout && !allTiles && rest.length > 0 && (phone || rest.every((t) => t.empty))
  const shownTiles = folded ? tileList.slice(0, firstRow) : tileList
  const canFold = !editingLayout && rest.length > 0 && (phone || rest.every((t) => t.empty))

  const figure = (t, i, list) => {
    const off = lay.hiddenTiles.includes(t.id)
    const isWide = lay.wideTiles.includes(t.id)
    const noteTone = t.tone ? tone[t.tone]?.fg : undefined
    return (
      <Box
        key={t.id}
        data-tile={t.id}
        data-stat={t.id}
        sx={{
          position: 'relative',
          gridColumn: isWide ? 'span 2' : 'span 1',
          px: { xs: 3, lg: 4 },
          py: 3,
          minWidth: 0,
          borderRight: 1,
          borderBottom: 1,
          borderColor: 'border.subtle',
          '&:hover .tile-tools, &:focus-within .tile-tools': { opacity: 1 },
        }}
      >
        <Box sx={{ opacity: off ? 0.4 : 1 }}>
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 1, minHeight: 16, minWidth: 0,
          }}
          >
            <Typography variant="subtitle2" component="div" noWrap sx={{ color: 'text.secondary' }}>{t.label}</Typography>
            {t.help && (
              <Tooltip title={t.help} placement="top">
                <InfoOutlinedIcon tabIndex={0} aria-label={`About ${t.label}`} sx={{ fontSize: 14, color: 'text.tertiary', cursor: 'help', flexShrink: 0 }} />
              </Tooltip>
            )}
          </Box>
          <Typography variant="figureSm" component="div" sx={{ mt: 1, color: t.empty ? 'text.tertiary' : 'text.primary', whiteSpace: 'nowrap' }}>
            {t.value}
          </Typography>
          {t.note && (
            <Typography variant="caption" component="div" sx={{ mt: 0.5, color: noteTone || 'text.tertiary' }}>
              {t.note}
            </Typography>
          )}
        </Box>
        {editingLayout && (
          <Box
            className="tile-tools"
            data-tile-controls={t.id}
            sx={{
              position: 'absolute',
              top: 6,
              right: 6,
              display: 'flex',
              gap: 0.25,
              p: 0.25,
              bgcolor: 'bg.raised',
              border: 1,
              borderColor: 'border.subtle',
              borderRadius: '6px',
              opacity: 0,
              transition: 'opacity 120ms',
              '@media (hover: none)': { opacity: 1 },
            }}
          >
            <Tooltip title="Move left"><span><IconButton size="small" disabled={i === 0} onClick={() => editLayout((d) => ({ ...d, tiles: moveId(d.tiles, t.id, -1) }))} aria-label={`move ${t.label} left`} sx={tool}><ChevronLeftIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
            <Tooltip title="Move right"><span><IconButton size="small" disabled={i === list.length - 1} onClick={() => editLayout((d) => ({ ...d, tiles: moveId(d.tiles, t.id, 1) }))} aria-label={`move ${t.label} right`} sx={tool}><ChevronRightIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
            <Tooltip title={isWide ? 'Narrower' : 'Wider'}><IconButton size="small" onClick={() => editLayout((d) => ({ ...d, wideTiles: toggleId(d.wideTiles, t.id) }))} aria-label={`${isWide ? 'narrower' : 'wider'} ${t.label}`} sx={tool}>{isWide ? <WidthNormalOutlinedIcon sx={{ fontSize: 16 }} /> : <WidthWideOutlinedIcon sx={{ fontSize: 16 }} />}</IconButton></Tooltip>
            <Tooltip title={off ? 'Show' : 'Hide'}><IconButton size="small" onClick={() => editLayout((d) => ({ ...d, hiddenTiles: toggleId(d.hiddenTiles, t.id) }))} aria-label={`${off ? 'show' : 'hide'} ${t.label}`} data-toggle-tile={t.id} sx={tool}>{off ? <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} /> : <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />}</IconButton></Tooltip>
          </Box>
        )}
      </Box>
    )
  }

  /* ---------------------------------------------------------------- */
  /* The table                                                         */
  /* ---------------------------------------------------------------- */
  const surface = theme.palette.bg.surface
  const picked = `color-mix(in srgb, ${theme.palette.primary.main} ${mode === 'dark' ? 14 : 8}%, ${surface})`
  const muted = (p) => OUT_OF_PLAN.has(p.commitLevel) || p.outsideTeam

  if (!ready) {
    return (
      <Box>
        <PageHeader title="Projects" description={`${projects.length} projects in the 2026 register.`} />
        <SectionSkeleton figures={phone ? 4 : 6} rows={8} header={false} label="Loading the register…" />
      </Box>
    )
  }

  return (
    <Box>
      <PageHeader title="Projects" description={description} help={editingLayout ? null : help} actions={actions} />

      {(blocked.length > 0 || layoutError) && (
        <Box sx={{ display: 'grid', gap: 3, mb: { xs: 3, sm: 4 } }}>
          {blocked.length > 0 && (
            <Alert
              severity="error"
              variant="outlined"
              action={onGoTo ? <Button color="inherit" variant="outlined" onClick={() => onGoTo('people')} sx={{ whiteSpace: 'nowrap' }}>Fix on Scorecards</Button> : null}
            >
              Saving is blocked: {blocked.map((x) => `${x.nick} is at ${Math.round(x.sum * 100)}%`).join(', ')}.
              Every scorecard must total exactly 100% before the plan can be saved.
            </Alert>
          )}
          {layoutError && (
            <Alert severity="error" variant="outlined" onClose={() => setLayoutError(null)}>
              {layoutError} Your arrangement is still here; try Save layout again.
            </Alert>
          )}
        </Box>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: editingLayout ? 7 : { xs: 3, sm: 4 } }}>
        <LayoutBlock {...block('about')}>
          {/* Shown only if an administrator turns it on: the page explains
              itself from "About this page" in the header. */}
          <Box sx={{
            display: 'flex', gap: 2, alignItems: 'flex-start', px: 3, py: 2.5, bgcolor: 'bg.subtle', borderRadius: '8px',
          }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.tertiary', mt: '1px' }} />
            <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '96ch' }}>
              {phone
                ? 'Tap a project to open it.'
                : 'Every cell edits in place. Click a project’s name or row to open it; the pencil renames it and the receipt icon opens its cost sheet.'}
            </Typography>
          </Box>
        </LayoutBlock>

        <LayoutBlock {...block('filters')}>
          {phone ? (
            <Toolbar count={count}>
              {search}
              <Button
                variant="outlined"
                onClick={() => setFiltersOpen(true)}
                aria-haspopup="dialog"
                startIcon={<FilterListIcon />}
                sx={{ flexShrink: 0 }}
              >
                Filters{dropdownsOn ? ` (${dropdownsOn})` : ''}
              </Button>
            </Toolbar>
          ) : (
            <Toolbar count={count}>
              {search}
              {fObjective}
              {fPicField}
              {fTeamField}
              {fSubField}
              <Button
                variant="outlined"
                startIcon={<FilterListIcon />}
                onClick={(e) => setMoreEl(e.currentTarget)}
                aria-haspopup="dialog"
                aria-expanded={!!moreEl}
                sx={{ flexShrink: 0, minHeight: 36 }}
              >
                More filters{moreOn ? ` (${moreOn})` : ''}
              </Button>
              {filtersOn && <Button onClick={clearFilters} sx={{ flexShrink: 0 }}>Clear filters</Button>}
            </Toolbar>
          )}
          <Popover
            open={!!moreEl}
            anchorEl={moreEl}
            onClose={() => setMoreEl(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            slotProps={{ paper: { sx: { mt: 1 } } }}
          >
            <Box role="dialog" aria-label="more filters" sx={{ p: 4, width: 280, display: 'grid', gap: 3 }}>
              <Typography variant="h3">More filters</Typography>
              {fFteField}
              {fCommitField}
              {fGapField}
            </Box>
          </Popover>
        </LayoutBlock>

        <LayoutBlock {...block('figures')}>
          <Paper variant="outlined" data-figure-strip data-stat-scope={filtersOn ? 'filtered' : 'all'} sx={{ overflow: 'hidden' }}>
            {/* Each figure draws its own right and bottom rule; the grid runs
                a pixel past the frame on those sides so the outer ones are
                clipped away, whatever the row length or a wide figure. */}
            <Box sx={(t) => ({
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              [t.breakpoints.up('sm')]: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' },
              [t.breakpoints.up('md')]: { gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' },
              mr: '-1px',
              mb: '-1px',
            })}
            >
              {shownTiles.map((t, i) => figure(t, i, shownTiles))}
            </Box>
            {canFold && (
              <Box sx={{ borderTop: 1, borderColor: 'border.subtle', px: 2, py: 1 }}>
                <Button onClick={() => setAllTiles((o) => !o)} aria-expanded={!folded}>
                  {folded ? 'Show all figures' : 'Show fewer figures'}
                </Button>
              </Box>
            )}
          </Paper>
        </LayoutBlock>

        {!phone && (
          <LayoutBlock {...block('tools')}>
            {/*
              * Export what is on screen, and import it back.
              *
              * The whole-plan export in the header is a different thing: it is
              * the eleven-sheet book of record. This one is the working file —
              * the rows you have filtered to, in a shape that can be edited and
              * imported.
              */}
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end',
            }}
            >
              <Tooltip title={exportHint}>
                <span>
                  <Button
                    variant="outlined"
                    startIcon={busy ? <Spinner size={14} /> : <FileDownloadOutlinedIcon />}
                    disabled={!rows.length || busy}
                    onClick={doExport}
                  >
                    {exportLabel}
                  </Button>
                </span>
              </Tooltip>
              <Tooltip title="Updates only the rows named in the file. You see every change before it is saved.">
                <span>
                  <Button
                    variant="outlined"
                    startIcon={<FileUploadOutlinedIcon />}
                    disabled={busy}
                    onClick={() => setImporting({ choosing: true })}
                  >
                    Import
                  </Button>
                </span>
              </Tooltip>
              {/* Which columns the register shows: an administrator's choice,
                  made once for everybody. A phone shows rows, not columns. */}
              {canWrite && (
                <>
                  <Button
                    variant="outlined"
                    startIcon={<ViewColumnOutlinedIcon />}
                    onClick={(e) => setColsEl(e.currentTarget)}
                    aria-haspopup="menu"
                    data-columns-button
                  >
                    Columns{hidden.size ? ` (${PROJECT_COLUMNS.length - hidden.size} of ${PROJECT_COLUMNS.length})` : ''}
                  </Button>
                  <Menu
                    anchorEl={colsEl}
                    open={!!colsEl}
                    onClose={() => setColsEl(null)}
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                    MenuListProps={{ dense: true, 'aria-label': 'columns' }}
                    slotProps={{ paper: { sx: { width: 280, maxHeight: 'min(560px, 80vh)' } } }}
                  >
                    <Box sx={{ px: 3, pt: 1, pb: 2 }}>
                      <Typography variant="h3">Columns</Typography>
                      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>
                        Shown to everyone who opens the register. The name, the select box and the cost sheet always show.
                      </Typography>
                      {colsNote && (
                        <Typography variant="caption" component="div" sx={{ color: tone.warning.fg, mt: 1 }} data-columns-note>
                          {colsNote}
                        </Typography>
                      )}
                    </Box>
                    <Divider />
                    {PROJECT_COLUMNS.map((c) => (
                      <MenuItem key={c.id} onClick={() => toggleColumn(c.id)} data-column={c.id}>
                        <ListItemIcon>
                          <Checkbox size="small" edge="start" checked={show(c.id)} tabIndex={-1} disableRipple sx={{ p: 0.5 }} />
                        </ListItemIcon>
                        <ListItemText primary={c.label} />
                      </MenuItem>
                    ))}
                    <Divider />
                    <Box sx={{ px: 1, pb: 0.5 }}>
                      <Button onClick={showAllColumns} disabled={!hidden.size}>Show every column</Button>
                    </Box>
                  </Menu>
                </>
              )}
            </Box>
          </LayoutBlock>
        )}

        <LayoutBlock {...block('table')}>
          {sel.size > 0 && !phone && (
            <Box
              role="region"
              aria-label="selected projects"
              sx={{
                display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minHeight: 44, px: 3, py: 1, mb: 2, bgcolor: 'bg.subtle', borderRadius: '8px',
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 500, mr: 2 }}>{sel.size} selected</Typography>
              <Button variant="outlined" onClick={(e) => setBulkEl(e.currentTarget)} aria-haspopup="menu">Bulk edit</Button>
              <Menu anchorEl={bulkEl} open={!!bulkEl} onClose={() => setBulkEl(null)} MenuListProps={{ dense: true }}>
                <Typography variant="subtitle2" component="div" sx={{ px: 3, py: 1, color: 'text.secondary' }}>
                  Set commit level
                </Typography>
                {COMMIT_LEVELS.map((c) => (
                  <MenuItem key={c.id} onClick={() => applyBulk({ commitLevel: c.id })}>{c.label}</MenuItem>
                ))}
                <Divider />
                <Typography variant="subtitle2" component="div" sx={{ px: 3, py: 1, color: 'text.secondary' }}>
                  Assign PIC
                </Typography>
                {people.map((p) => (
                  <MenuItem key={p.id} onClick={() => applyBulk({ pic: p.id })}>{p.nick}</MenuItem>
                ))}
              </Menu>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteOutlineIcon />}
                onClick={() => {
                  if (confirm(`Delete ${sel.size} project${sel.size === 1 ? '' : 's'}? This cannot be undone (reload the baseline from the ⋮ menu to restore).`)) {
                    onDelete([...sel]); setSel(new Set())
                  }
                }}
              >
                Delete
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button onClick={() => setSel(new Set())}>Clear selection</Button>
            </Box>
          )}
          {phone ? (
            <PhoneList rows={rows} assignees={assignees} onOpen={setDetailKey} onClear={clearFilters} filtered={filtersOn} />
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
                  aria-label="project register"
                  sx={{
                    '& th': { whiteSpace: 'nowrap' },
                    '& td': {
                      fontSize: '0.8125rem', lineHeight: '18px', py: 1.5, verticalAlign: 'middle',
                    },
                    '& th, & td': { px: 2 },
                    '& th.MuiTableCell-paddingCheckbox, & td.MuiTableCell-paddingCheckbox': { px: 1, width: 40 },
                    // The held columns are opaque, so what scrolls under them is
                    // hidden, and take the row's hover and selected tint too.
                    '& td.held': { bgcolor: surface },
                    '& tbody tr.MuiTableRow-hover:hover td.held': { bgcolor: 'bg.subtle' },
                    '& tbody tr.Mui-selected td.held': { bgcolor: picked },
                    '& tbody tr': { cursor: 'pointer' },
                    // The pencil shows on the row in hand, not on all 86.
                    '& .row-tool': { opacity: 0, transition: 'opacity 120ms' },
                    '& tr:hover .row-tool, & .row-tool:focus-visible': { opacity: 1 },
                    '@media (hover: none)': { '& .row-tool': { opacity: 1 } },
                  }}
                >
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" {...stick('select', true)}>
                        <Checkbox
                          size="small"
                          checked={allSelected}
                          indeterminate={sel.size > 0 && !allSelected}
                          onChange={toggleAll}
                          inputProps={{ 'aria-label': 'select every project shown' }}
                        />
                      </TableCell>
                      {/* The cost sheet has a button of its own; a click on the rest
                          of the row opens the project's detail instead. */}
                      <TableCell padding="checkbox" {...stick('cost', true)} />
                      {show('jiraKey') && head('jiraKey', 'Jira', 'left', 96)}
                      {head('summary', 'Project', 'left', { sm: 208, md: 248 })}
                      {show('objective') && <TableCell sx={{ minWidth: 196 }}>Objective</TableCell>}
                      {show('pic') && <TableCell sx={{ minWidth: 104 }}>PIC</TableCell>}
                      {show('savingHours') && head('savingHours', 'Saving hrs/mth', 'right', 112)}
                      {/* The other half of the QUANTIFIED benefit: money that is money
                          rather than time, so it sits next to the hours it adds to. */}
                      {show('cashBenefit') && head('monetaryAnnualBenefit', 'Cash benefit/yr', 'right', 124)}
                      {/* And beside them the part no number carries: a case made only
                          of figures is half a case. */}
                      {show('softBenefits') && <TableCell sx={{ minWidth: 176 }}>Soft benefits</TableCell>}
                      {show('fte') && head('fte', 'FTE', 'right', 64)}
                      {show('manday') && head('manday', 'Mandays', 'right', 92)}
                      {/* One column, not three: the build/CAPEX/OPEX split lives in
                          the tooltip and in the cost sheet. */}
                      {show('investment') && head('investment', 'Investment', 'right', 100)}
                      {show('roi') && head('roi', 'ROI', 'right', 80)}
                      {show('payback') && head('paybackMonths', 'Payback', 'right', 88)}
                      {show('commit') && <TableCell sx={{ minWidth: 124 }}>Commit</TableCell>}
                      {show('status') && <TableCell sx={{ minWidth: 112 }}>Status</TableCell>}
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
                          sx={muted(p) ? { '& > td > *': { opacity: 0.55 } } : undefined}
                        >
                          <TableCell padding="checkbox" {...stick('select')}>
                            <Checkbox
                              size="small"
                              checked={sel.has(p.key)}
                              inputProps={{ 'aria-label': `select ${p.summary || p.key}` }}
                              onChange={() => setSel((s) => {
                                const n = new Set(s)
                                if (n.has(p.key)) n.delete(p.key)
                                else n.add(p.key)
                                return n
                              })}
                            />
                          </TableCell>
                          <TableCell padding="checkbox" {...stick('cost')}>
                            <Tooltip title={`Cost sheet for ${p.jiraKey || p.key}: effort, CAPEX, monthly cost, notes${p.comment ? '. Has notes.' : ''}`}>
                              <IconButton
                                size="small"
                                onClick={() => setCostKey(p.key)}
                                aria-label="open cost breakdown"
                                sx={{ width: 28, height: 28, color: p.comment ? 'text.primary' : 'text.tertiary', '&:hover': { color: 'text.primary' } }}
                              >
                                <ReceiptLongIcon sx={{ fontSize: 17 }} />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                          {show('jiraKey') && (
                            <TableCell sx={{ whiteSpace: 'nowrap' }} {...stick('jiraKey')}>
                              <TextCell
                                value={p.jiraKey}
                                placeholder="—"
                                width={84}
                                onChange={(v) => onUpdate(p.key, { jiraKey: v })}
                                label="Jira key"
                              />
                            </TableCell>
                          )}
                          <TableCell sx={{ maxWidth: { sm: 240, md: 320 }, minWidth: { sm: 208, md: 248 } }} {...stick('summary')}>
                            {/* The way into the project: its name opens its detail, in a popup. */}
                            <NameCell p={p} onOpen={setDetailKey} onRename={(v) => onUpdate(p.key, { summary: v || 'Untitled' })} />
                            <MetaCell p={p} onUpdate={(patch) => onUpdate(p.key, patch)} />
                          </TableCell>
                          {show('objective') && (
                            <TableCell>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <CellSelect
                                  value={p.objective}
                                  onChange={(e) => onUpdate(p.key, { objective: e.target.value })}
                                  width={180}
                                  label="objective"
                                  renderValue={(v) => (
                                    <Box sx={{
                                      display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0,
                                    }}
                                    >
                                      <Dot color={CHART[mode].series[objIdx]} />
                                      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {OBJ_BY_ID[v]?.short}
                                      </Box>
                                    </Box>
                                  )}
                                >
                                  {OBJECTIVES.map((o, i) => (
                                    <MenuItem key={o.id} value={o.id}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                        <Dot color={CHART[mode].series[i]} />
                                        {o.no}. {o.short}
                                      </Box>
                                    </MenuItem>
                                  ))}
                                </CellSelect>
                                <AlsoServes
                                  project={p}
                                  onChange={(ids) => onUpdate(p.key, { objectives: ids })}
                                />
                              </Box>
                            </TableCell>
                          )}
                          {show('pic') && (
                            <TableCell>
                              <CellSelect
                                displayEmpty
                                value={p.pic ?? ''}
                                onChange={(e) => onUpdate(p.key, { pic: e.target.value || null })}
                                width={92}
                                label="PIC"
                                renderValue={(v) => (v
                                  ? assignees.find((x) => x.id === v)?.nick
                                  : <Box component="span" sx={{ color: tone.warning.fg }}>No PIC</Box>)}
                              >
                                <MenuItem value="">No PIC yet</MenuItem>
                                {assignees.map((x) => (
                                  <MenuItem key={x.id} value={x.id}>
                                    {x.nick}
                                    <Typography component="span" variant="body2" sx={{ ml: 1.5, color: 'text.secondary' }}>
                                      {x.name}{x.scorecard === false ? ', no scorecard' : ''}
                                    </Typography>
                                  </MenuItem>
                                ))}
                              </CellSelect>
                            </TableCell>
                          )}
                          {show('savingHours') && (
                            <TableCell align="right">
                              {/* Still editable — it is a real figure and worth keeping
                                  on the record. Struck through because it is not ours:
                                  the PIC is IT or the business, so the hours are outside
                                  the team's commitment and outside every scorecard. */}
                              <Tooltip title={p.outsideTeam
                                ? `Delivered by ${assignees.find((x) => x.id === p.pic)?.nick || 'a partner'}: kept on the register, but not counted in the team's committed saving hours and not on anyone's scorecard.`
                                : p.savingHours == null ? 'Saving hours are TBC in the source. This project cannot be committed until it is quantified.' : ''}
                              >
                                <Box sx={{ display: 'inline-block', textDecoration: p.outsideTeam ? 'line-through' : 'none' }}>
                                  <NumCell
                                    value={p.savingHours}
                                    placeholder="TBC"
                                    estimated={false}
                                    width={88}
                                    label="saving hours a month"
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
                                : 'Cash this delivers that the saving hours do not already capture: a licence dropped, a penalty avoided. Per year. Leave it empty where the hours are the saving, or it is counted twice.'}
                              >
                                <Box sx={{ display: 'inline-block' }}>
                                  <NumCell
                                    value={p.monetaryAnnualBenefit ?? null}
                                    estimated={false}
                                    width={100}
                                    label="cash benefit a year"
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
                                  : `${fmtHours(p.savingHours)} hrs a month ÷ ${fin.hoursPerFteMonth} = ${(p.fte ?? 0).toFixed(1)} FTE. It follows the saving hours, and the FTE ratio on the Model page moves every row at once.`
                              }
                              >
                                <Box component="span" sx={{ cursor: 'help', color: p.fte > 0 ? 'text.primary' : 'text.tertiary' }}>
                                  {p.savingHours == null ? '—' : (p.fte ?? 0).toFixed(1)}
                                </Box>
                              </Tooltip>
                            </TableCell>
                          )}
                          {show('manday') && (
                            <TableCell align="right">
                              {p.tasks && p.tasks.length ? (
                                // Derived from the tasks, so it is a result, not an input.
                                // Clicking it opens the breakdown it is the sum of.
                                <Tooltip title={`${p.tasks.length} task${p.tasks.length === 1 ? '' : 's'} totalling ${fmtHours(p.manday)} mandays. Click to see the breakdown.`}>
                                  <Box
                                    component="button"
                                    type="button"
                                    onClick={() => setCostKey(p.key)}
                                    sx={{
                                      border: 0,
                                      background: 'none',
                                      p: '5px 8px',
                                      cursor: 'pointer',
                                      font: 'inherit',
                                      fontVariantNumeric: 'tabular-nums',
                                      color: 'primary.text',
                                      textDecoration: 'underline dotted',
                                      textUnderlineOffset: 3,
                                      borderRadius: '6px',
                                    }}
                                  >
                                    {fmtHours(p.manday)}
                                  </Box>
                                </Tooltip>
                              ) : (
                                <NumCell
                                  value={p.manday}
                                  width={72}
                                  estimated={p.mandayEstimated}
                                  label="mandays"
                                  onChange={(v) => onUpdate(p.key, { manday: v ?? 0, mandayEstimated: false })}
                                />
                              )}
                            </TableCell>
                          )}
                          {show('investment') && (
                            <TableCell align="right">
                              {p.investment == null ? (
                                <Tooltip title={`No mandays and no CAPEX yet. This project can afford ${p.affordableMandays == null ? '—' : Math.round(p.affordableMandays).toLocaleString()} mandays and still clear the gate. Open the cost sheet (the receipt icon) to add CAPEX or a monthly running cost.`}>
                                  <Box component="span" sx={{ color: 'text.tertiary', cursor: 'help' }}>—</Box>
                                </Tooltip>
                              ) : (
                                <Tooltip title={`Build ${fmtMoney(p.buildCost ?? 0, sym)} plus CAPEX ${fmtMoney(p.capex ?? 0, sym)} = ${fmtMoney(p.investment, sym)} one-off${p.opexRunRate > 0 ? `, plus ${fmtMoney(p.opexRunRate, sym)} a month of OPEX (${fmtMoney(p.opexYear, sym)} in 2026)` : ', with no monthly running cost'}. The cost sheet has the month-by-month table.`}>
                                  <Box component="span" sx={{ cursor: 'help' }}>{fmtMoneyShort(p.investment, sym)}</Box>
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
                                    : `Worth ${fmtMoneyShort(p.annualBenefit, sym)} a year. Enter mandays or a CAPEX to get a return: break-even is ${Math.round(p.breakEvenMandays).toLocaleString()} mandays, and ${Math.round(p.affordableMandays).toLocaleString()} clears the gate.`
                                }
                                >
                                  <Box component="span" sx={{ color: 'text.tertiary', cursor: 'help' }}>—</Box>
                                </Tooltip>
                              ) : (
                                <Tooltip title={`${p.gate === 'pass' ? 'Clears' : 'Below'} the ${fmtRoi(fin.roiGate)} gate. ${fmtMoney(p.monthlyBenefit, sym)} a month less ${fmtMoney(p.opexRunRate, sym)} of OPEX = ${fmtMoney(p.netMonthly, sym)} net; ${fmtMoney(p.netHorizonBenefit, sym)} over ${horizon} months against ${fmtMoney(p.investment, sym)} invested, net ${fmtMoney(p.netBenefit, sym)}, ${p.paybackMonths == null ? 'and it never pays back' : `paying back in ${fmtMonths(p.paybackMonths)}`}.`}>
                                  {/* Benefit per project lives in this tooltip, the totals
                                      strip, the scorecard portfolio and the workbook — a
                                      column for it as well pushed Commit off the table. */}
                                  <Box
                                    component="span"
                                    aria-label={`${fmtRoi(p.roi)}, ${p.gate === 'pass' ? 'clears' : 'below'} the gate`}
                                    sx={{
                                      display: 'inline-flex', alignItems: 'center', gap: 1.5, cursor: 'help',
                                    }}
                                  >
                                    <Dot color={p.gate === 'pass' ? tone.success.solid : tone.danger.solid} />
                                    {fmtRoi(p.roi)}
                                  </Box>
                                </Tooltip>
                              )}
                            </TableCell>
                          )}
                          {show('payback') && (
                            <TableCell align="right">
                              {p.paybackMonths == null ? (
                                <Tooltip title={
                                  p.savingHours == null
                                    ? 'Saving hours are still TBC, so there is nothing to pay the investment back.'
                                    : p.netMonthly != null && p.netMonthly <= 0
                                      ? `The ${fmtMoney(p.opexRunRate, sym)} a month of OPEX is at or above the ${fmtMoney(p.monthlyBenefit, sym)} a month this returns, so it never pays back.`
                                      : 'Enter mandays or a CAPEX to get a payback period.'
                                }
                                >
                                  <Box component="span" sx={{ color: p.netMonthly != null && p.netMonthly <= 0 && p.investment != null ? tone.danger.fg : 'text.tertiary', cursor: 'help' }}>
                                    {p.netMonthly != null && p.netMonthly <= 0 && p.investment != null ? 'Never' : '—'}
                                  </Box>
                                </Tooltip>
                              ) : (
                                <Tooltip title={`${fmtMoney(p.investment, sym)} invested, returning ${fmtMoney(p.netMonthly, sym)} a month after OPEX: repaid in ${fmtMonths(p.paybackMonths)}. The gate is a payback of ${fmtMonths(gateAsPaybackMonths(fin))}.`}>
                                  <Box component="span" sx={{ cursor: 'help' }}>{fmtMonthsShort(p.paybackMonths)}</Box>
                                </Tooltip>
                              )}
                            </TableCell>
                          )}
                          {show('commit') && (
                            <TableCell>
                              <CellSelect
                                value={p.commitLevel}
                                onChange={(e) => onUpdate(p.key, { commitLevel: e.target.value })}
                                width={112}
                                label="commit level"
                                renderValue={(v) => (
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    {COMMIT_DOT[v] === 'hollow'
                                      ? <Dot hollow />
                                      : <Dot color={tone[COMMIT_DOT[v]]?.solid} />}
                                    {COMMIT_LEVELS.find((c) => c.id === v)?.label}
                                  </Box>
                                )}
                              >
                                {COMMIT_LEVELS.map((c) => (
                                  <MenuItem key={c.id} value={c.id} sx={{ alignItems: 'flex-start', py: 1.5 }}>
                                    <Box>
                                      <Typography variant="body1" sx={{ fontWeight: 500 }}>{c.label}</Typography>
                                      <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'normal', maxWidth: 300 }}>{c.help}</Typography>
                                    </Box>
                                  </MenuItem>
                                ))}
                              </CellSelect>
                            </TableCell>
                          )}
                          {show('status') && (
                            <TableCell>
                              {/* A pill, coloured by where the work is; the word is on it
                                  too. Whatever Jira calls it is shown as it is. */}
                              <StatePills p={p} column />
                            </TableCell>
                          )}
                          {show('delete') && (
                            <TableCell padding="checkbox">
                              <Tooltip title="Delete this project">
                                <IconButton
                                  size="small"
                                  className="row-tool"
                                  aria-label={`delete ${p.summary || p.key}`}
                                  sx={{ width: 28, height: 28, color: 'text.secondary', '&:hover': { color: tone.danger.fg } }}
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
                        <TableCell colSpan={3 + PROJECT_COLUMNS.length} sx={{ cursor: 'default', borderBottom: 0 }}>
                          <EmptyState
                            icon={FolderOpenOutlinedIcon}
                            title="No projects match these filters"
                            body="Clear a filter or search for something else."
                            action={filtersOn ? <Button variant="outlined" onClick={clearFilters}>Clear filters</Button> : null}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              {/* More to the right: a 12px fade at the edge says so. */}
              <Box
                aria-hidden
                sx={{
                  position: 'absolute',
                  top: 1,
                  right: 1,
                  bottom: 1,
                  width: 12,
                  pointerEvents: 'none',
                  borderTopRightRadius: 8,
                  borderBottomRightRadius: 8,
                  background: `linear-gradient(to right, ${alpha(surface, 0)}, ${surface})`,
                  opacity: moreRight ? 1 : 0,
                  transition: 'opacity 120ms',
                }}
                data-scroll-cue={moreRight ? 'on' : 'off'}
              />
            </Box>
          )}
        </LayoutBlock>
      </Box>

      {/* A phone's filters: a sheet from the bottom of the screen. */}
      <Dialog
        open={phone && filtersOpen}
        onClose={() => setFiltersOpen(false)}
        fullWidth
        aria-labelledby="filters-title"
        sx={{ '& .MuiDialog-container': { alignItems: 'flex-end' } }}
        PaperProps={{
          sx: {
            [PHONE]: {
              height: 'auto', maxHeight: '88vh !important', borderRadius: '12px 12px 0 0 !important',
            },
          },
        }}
      >
        <DialogTitle id="filters-title" sx={{ pr: 14 }}>
          Filters
          <IconButton aria-label="close" onClick={() => setFiltersOpen(false)} sx={{ position: 'absolute', right: 8, top: 10, width: 40, height: 40, color: 'text.secondary' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box
            id="project-filters"
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr)',
              gap: 3,
              pt: 2,
              '& .MuiFormControl-root': { minWidth: 0, width: '100%' },
              '& .MuiFormControl-root .MuiInputBase-root': { maxWidth: 'none' },
            }}
          >
            {fObjective}
            {fPicField}
            {fTeamField}
            {fSubField}
            {fFteField}
            {fCommitField}
            {fGapField}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={clearFilters} disabled={!filtersOn}>Clear filters</Button>
          <Button variant="contained" onClick={() => setFiltersOpen(false)}>
            Show {rows.length} project{rows.length === 1 ? '' : 's'}
          </Button>
        </DialogActions>
      </Dialog>

      <ImportDialog
        result={importing?.result}
        fileName={importing?.fileName}
        choosing={!!importing?.choosing}
        busy={busy}
        onChoose={() => fileRef.current?.click()}
        onPick={takeFile}
        onClose={() => setImporting(null)}
        onApply={() => { onImport(importing.result); setImporting(null) }}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        aria-label="import projects"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ''            // so the same file can be picked twice
          await takeFile(file)
        }}
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

      {/* Looked up by key on every render, so a CAPEX typed inside it moves the
          ROI in the header of the very same dialog. */}
      <ProjectCostDialog
        project={costProject}
        plan={plan}
        onUpdate={onUpdate}
        onClose={() => setCostKey(null)}
      />
    </Box>
  )
}
