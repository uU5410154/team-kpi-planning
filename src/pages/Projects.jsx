import { useState, useMemo } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, TableSortLabel,
  TextField, Select, MenuItem, InputAdornment, Chip, Checkbox, Button, Stack, Tooltip,
  FormControl, InputLabel, TableContainer, Menu, Alert,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import { OBJECTIVES, OBJ_BY_ID, COMMIT_LEVELS, STATUS, CHART } from '../lib/palette.js'
import { fmtHours, fmtRatio } from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

const COMMIT_COLOR = {
  commit: STATUS.good,
  stretch: '#2a78d6',
  watch: STATUS.warning,
  excluded: '#898781',
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
        if (t === '') { onChange(null); return }
        const n = Number(t.replace(/,/g, ''))
        if (Number.isFinite(n) && n >= 0) onChange(n)
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

export default function Projects({ plan, onUpdate, onBulk }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { projects, people, settings } = plan

  const [q, setQ] = useState('')
  const [fObj, setFObj] = useState('all')
  const [fPic, setFPic] = useState('all')
  const [fCommit, setFCommit] = useState('all')
  const [fGap, setFGap] = useState('all')
  const [sort, setSort] = useState({ by: 'savingHours', dir: 'desc' })
  const [sel, setSel] = useState(() => new Set())
  const [bulkEl, setBulkEl] = useState(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let out = projects.filter((p) => {
      if (needle && !`${p.key} ${p.summary} ${p.team ?? ''} ${p.assignee ?? ''}`.toLowerCase().includes(needle)) return false
      if (fObj !== 'all' && p.objective !== fObj) return false
      if (fPic !== 'all' && (fPic === 'none' ? !!p.pic : p.pic !== fPic)) return false
      if (fCommit !== 'all' && p.commitLevel !== fCommit) return false
      if (fGap === 'saving' && p.savingHours != null) return false
      if (fGap === 'pic' && !!p.pic) return false
      if (fGap === 'manday' && !p.mandayEstimated) return false
      if (fGap === 'gate' && p.gate !== 'fail') return false
      if (fGap === 'pastdue' && !p.pastDue) return false
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
  }, [projects, q, fObj, fPic, fCommit, fGap, sort])

  const head = (id, label, align = 'left') => (
    <TableCell align={align} sortDirection={sort.by === id ? sort.dir : false}>
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

  const shown = rows.reduce((a, p) => a + (p.commitLevel === 'commit' && OBJ_BY_ID[p.objective]?.countsToPool ? (p.savingHours ?? 0) : 0), 0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity="info" variant="outlined">
        Edit any cell below — <strong>PIC</strong>, <strong>saving hours</strong>, <strong>mandays</strong>,{' '}
        <strong>objective</strong> and <strong>commit level</strong> all recalculate the dashboard and the export live.
        Italic figures are seed estimates that have not been confirmed. Everything is saved in this browser; use{' '}
        <em>Save scenario</em> in the ⋮ menu to keep a copy or share it.
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
              <MenuItem value="pic">Missing PIC</MenuItem>
              <MenuItem value="manday">Manday still a guess</MenuItem>
              <MenuItem value="gate">Below the gate</MenuItem>
              <MenuItem value="pastdue">Past due, not done</MenuItem>
            </Select>
          </FormControl>
        </Stack>

        <Stack direction="row" spacing={2} alignItems="center" sx={{ mt: 1.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {rows.length} of {projects.length} projects · {fmtHours(shown)} committed hrs in view
          </Typography>
          <Box sx={{ flex: 1 }} />
          {sel.size > 0 && (
            <>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{sel.size} selected</Typography>
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
        </Stack>
      </Paper>

      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: '72vh' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ bgcolor: 'background.paper' }}>
                <Checkbox size="small" checked={allSelected} indeterminate={sel.size > 0 && !allSelected} onChange={toggleAll} />
              </TableCell>
              {head('key', 'Jira')}
              {head('summary', 'Project')}
              <TableCell sx={{ minWidth: 150 }}>Objective</TableCell>
              <TableCell sx={{ minWidth: 118 }}>PIC</TableCell>
              {head('savingHours', 'Saving hrs', 'right')}
              {head('manday', 'Mandays', 'right')}
              {head('ratio', 'Ratio', 'right')}
              <TableCell sx={{ minWidth: 122 }}>Commit</TableCell>
              <TableCell>Status</TableCell>
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
                  <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap', fontSize: '0.75rem' }}>{p.key}</TableCell>
                  <TableCell sx={{ maxWidth: 300 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.3 }}>
                      {p.summary}
                      {p.deleted && <Chip size="small" label="deleted in Jira" sx={{ ml: 1, height: 18 }} />}
                    </Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {[p.team, p.department].filter(Boolean).join(' · ') || '—'}
                      {p.partners?.length ? ` · partners: ${p.partners.join(', ')}` : ''}
                    </Typography>
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
                      renderValue={(v) => (v ? people.find((x) => x.id === v)?.nick : 'TBC')}
                    >
                      <MenuItem value=""><em>TBC — unassigned</em></MenuItem>
                      {people.map((x) => <MenuItem key={x.id} value={x.id}>{x.nick} — {x.name}</MenuItem>)}
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
                      <Tooltip title="No saving hours recorded in Jira — this project cannot be committed until it is quantified">
                        <WarningAmberIcon sx={{ fontSize: 14, color: STATUS.warning, ml: 0.5, verticalAlign: 'middle' }} />
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} align="center" sx={{ py: 6, color: 'text.secondary' }}>
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
