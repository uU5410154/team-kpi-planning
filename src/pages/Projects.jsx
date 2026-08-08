import { useState, useMemo } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel,
  TextField, Select, MenuItem, InputAdornment, Chip, Checkbox, Button, Stack, Tooltip,
  FormControl, InputLabel, TableContainer, Menu, Alert, IconButton, CircularProgress,
} from '@mui/material'
import SaveIcon from '@mui/icons-material/Save'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import SearchIcon from '@mui/icons-material/Search'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import { OBJECTIVES, OBJ_BY_ID, COMMIT_LEVELS, STATUS, CHART } from '../lib/palette.js'
import { fmtHours, fmtRatio, fmtPct } from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

const COMMIT_COLOR = {
  commit: STATUS.good,
  stretch: '#2a78d6',
  watch: STATUS.warning,
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
  const { projects, people, settings } = plan
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
      if (fGap === 'manday' && !p.mandayEstimated) return false
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

  /** Totals for whatever the filters currently show — recomputed on every change. */
  const agg = useMemo(() => {
    const savingRows = rows.filter((p) => p.savingHours != null)
    const hours = savingRows.reduce((a, p) => a + p.savingHours, 0)
    const hc = rows.reduce((a, p) => a + (p.hc || 0), 0)
    const manday = rows.reduce((a, p) => a + (p.manday || 0), 0)
    const withRatio = rows.filter((p) => p.ratio != null)
    return {
      count: rows.length,
      hours,
      hc,
      manday,
      // Portfolio ratio: total hours over total mandays. A plain mean of the
      // per-project ratios would let a tiny project outweigh a large one.
      ratio: manday > 0 ? hours / manday : null,
      meanRatio: withRatio.length
        ? withRatio.reduce((a, p) => a + p.ratio, 0) / withRatio.length
        : null,
      done: rows.filter((p) => p.status === 'Done').reduce((a, p) => a + (p.savingHours ?? 0), 0),
      tbc: rows.filter((p) => p.savingHours == null).length,
      pctOfBook: plan.totals.totalHours > 0 ? hours / plan.totals.totalHours : 0,
    }
  }, [rows, plan.totals.totalHours])

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
              <MenuItem value="manday">Manday still a guess</MenuItem>
              <MenuItem value="gate">Below the gate</MenuItem>
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
            { label: 'Saving hrs / month', value: fmtHours(agg.hours), sub: `${fmtPct(agg.pctOfBook)} of the whole book`, strong: true },
            { label: 'Of which delivered', value: fmtHours(agg.done), sub: 'status Done' },
            { label: 'Headcount', value: agg.hc ? agg.hc.toFixed(1) : '—', sub: 'HC released' },
            { label: 'Mandays', value: agg.manday ? fmtHours(agg.manday) : '—', sub: agg.manday ? 'invested' : 'not entered yet' },
            {
              label: 'Ratio (avg)',
              value: agg.ratio == null ? '—' : fmtRatio(agg.ratio),
              sub: agg.ratio == null ? 'needs mandays' : `gate ${settings.ratioGate.toFixed(1)}`,
              tone: agg.ratio == null ? undefined : agg.ratio >= settings.ratioGate ? STATUS.good : STATUS.critical,
              help: 'Total saving hours ÷ total mandays across the filtered rows. A weighted average — a plain mean of per-project ratios would let a tiny project outweigh a large one.',
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
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ bgcolor: 'background.paper' }}>
                <Checkbox size="small" checked={allSelected} indeterminate={sel.size > 0 && !allSelected} onChange={toggleAll} />
              </TableCell>
              {head('jiraKey', 'Jira', 'left', 104)}
              {head('summary', 'Project')}
              <TableCell sx={{ minWidth: 150 }}>Objective</TableCell>
              <TableCell sx={{ minWidth: 118 }}>PIC</TableCell>
              {head('savingHours', 'Saving hrs/mth', 'right')}
              {head('hc', 'HC', 'right')}
              {head('manday', 'Mandays', 'right')}
              {head('ratio', 'Ratio', 'right')}
              <TableCell sx={{ minWidth: 122 }}>Commit</TableCell>
              <TableCell>Status</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((p) => {
              const objIdx = OBJECTIVES.findIndex((o) => o.id === p.objective)
              return (
                <TableRow key={p.key} hover selected={sel.has(p.key)} sx={{ opacity: p.commitLevel === 'excluded' ? 0.55 : 1 }}>
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
                      width={92}
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
                        width={92}
                        onChange={(v) => onUpdate(p.key, { team: v })}
                      />
                      <TextCell
                        value={p.subTeam}
                        placeholder="Sub team"
                        width={112}
                        onChange={(v) => onUpdate(p.key, { subTeam: v })}
                      />
                      <TextCell
                        value={p.program}
                        placeholder="Programme"
                        width={132}
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
                      sx={{ fontSize: '0.8125rem', width: '100%' }}
                      renderValue={(v) => {
                        const o = OBJ_BY_ID[v]
                        return (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: CHART[mode].series[objIdx], flexShrink: 0 }} />
                            {o?.no}. {o?.short}
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
                      sx={{ fontSize: '0.8125rem', width: '100%', color: p.pic ? 'text.primary' : STATUS.critical }}
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
                      width={56}
                      onChange={(v) => onUpdate(p.key, { hc: v })}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <NumCell
                      value={p.manday}
                      width={64}
                      estimated={p.mandayEstimated}
                      onChange={(v) => onUpdate(p.key, { manday: v ?? 0, mandayEstimated: false })}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {p.ratio == null ? (
                      <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>
                    ) : (
                      <Tooltip title={p.gate === 'pass' ? `Passes the ${settings.ratioGate.toFixed(1)} hrs/manday gate` : `Below the ${settings.ratioGate.toFixed(1)} hrs/manday gate`}>
                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, justifyContent: 'flex-end' }}>
                          {p.gate === 'pass'
                            ? <CheckCircleOutlineIcon sx={{ fontSize: 14, color: STATUS.good }} />
                            : <ErrorOutlineIcon sx={{ fontSize: 14, color: STATUS.critical }} />}
                          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                            {fmtRatio(p.ratio)}
                          </Typography>
                        </Box>
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
                      <Tooltip title={`Due ${p.due} and not Done — already past due`}>
                        <Typography
                          variant="caption"
                          sx={{ display: 'block', color: STATUS.critical, fontWeight: 600, whiteSpace: 'nowrap' }}
                        >
                          past due {p.due}
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
