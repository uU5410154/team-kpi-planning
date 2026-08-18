import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Chip, TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Switch, Tooltip, InputAdornment, Button, Alert, LinearProgress,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import SyncIcon from '@mui/icons-material/Sync'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { IconButton, CircularProgress, Popover, Divider } from '@mui/material'
import EditCalendarIcon from '@mui/icons-material/EditCalendar'
import * as api from '../lib/api.js'
import { useTheme } from '@mui/material/styles'
import { STATUS, CHART, OBJ_BY_ID } from '../lib/palette.js'
import { fmtHours, isDate, timelineOf } from '../lib/model.js'

const DAY = 86400000
const at = (d) => Date.parse(`${d}T00:00:00Z`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The two dates a plan is made of.
 *
 * Held as a draft and saved on purpose, rather than written on every
 * keystroke: a half-typed year is not a date, and this one is pushed to a real
 * ticket that other people are looking at.
 */
function PlanEditor({ row, onSave, saving, jira }) {
  const [start, setStart] = useState(row.timeline.plannedStart || '')
  const [due, setDue] = useState(row.timeline.plannedEnd || '')
  const bad = !!start && !!due && start > due

  return (
    <Box sx={{ p: 2, width: 290 }}>
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Planned dates</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        {row.jiraKey
          ? (jira?.writable
            ? `Saved here and written to ${row.jiraKey}.`
            : `Saved here only — writing to ${row.jiraKey} is switched off on the server.`)
          : 'Saved here. No Jira key on this row.'}
      </Typography>
      <TextField
        size="small"
        fullWidth
        type="date"
        label="Planned start"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        InputLabelProps={{ shrink: true }}
        sx={{ mb: 1.5 }}
      />
      <TextField
        size="small"
        fullWidth
        type="date"
        label="Planned finish"
        value={due}
        onChange={(e) => setDue(e.target.value)}
        InputLabelProps={{ shrink: true }}
        error={bad}
        helperText={bad ? 'The finish is before the start.' : ' '}
      />
      <Divider sx={{ my: 1 }} />
      <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mb: 1.5 }}>
        The actual dates are not editable: Jira stamps a resolution date when an issue is resolved and will not accept
        one as a field, so outcomes are read from there and never written back.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button size="small" onClick={() => { setStart(''); setDue('') }} disabled={saving}>Clear both</Button>
        <Button
          size="small"
          variant="contained"
          disabled={saving || bad}
          onClick={() => onSave(row, { start, due })}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Box>
    </Box>
  )
}

/**
 * Planned against actual, as bars on one calendar.
 *
 * The register holds both a plan (start, due) and what happened (actualStart,
 * actualEnd). Four date columns in a table are unreadable — the question is
 * "did this slip", and a slip is a shape rather than a number. So the plan is
 * drawn as an outline, the outcome solid beneath it, and the gap between their
 * right-hand edges IS the delay.
 *
 * A project with no actual dates is drawn as a plan with an empty track, which
 * is the truthful picture: most of this register has never been told what
 * happened. It is never coloured as though it were on time.
 */
export default function Timeline({ plan, settings, onUpdate }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const asOf = settings.asOfDate
  const t = plan.totals.timeliness

  /*
   * Jira, through our own server.
   *
   * The browser never holds a Jira credential: it sends the keys the register
   * already contains and the server, which does hold one, answers with those
   * issues and nothing else.
   */
  const [jira, setJira] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [syncNote, setSyncNote] = useState(null)
  useEffect(() => {
    let dead = false
    api.jiraStatus().then((s) => { if (!dead) setJira(s) }).catch(() => setJira({ configured: false }))
    return () => { dead = true }
  }, [])

  const keyed = useMemo(
    () => plan.projects.filter((p) => /^[A-Za-z][A-Za-z0-9_]+-\d+$/.test(String(p.jiraKey || '').trim())),
    [plan.projects],
  )

  const sync = async () => {
    setSyncing(true)
    setSyncNote(null)
    try {
      const r = await api.jiraIssues(keyed.map((p) => p.jiraKey.trim()))
      const byKey = new Map(r.issues.map((i) => [i.key.toUpperCase(), i]))
      let changed = 0
      let fromCreated = 0
      for (const p of keyed) {
        const issue = byKey.get(p.jiraKey.trim().toUpperCase())
        if (!issue) continue
        /*
         * Only what actually happened. The PLAN is never touched — not the
         * start, not the due date — however tempting it is to take Jira's due
         * date as authoritative: the plan is what was committed to at the
         * start of the year, and Jira's due date moves whenever somebody drags
         * a card.
         */
        const patch = {}
        const actualStart = issue.start || issue.created || null
        const actualEnd = issue.done ? (issue.resolved || null) : null
        if (actualStart && actualStart !== p.actualStart) patch.actualStart = actualStart
        if (actualEnd && actualEnd !== p.actualEnd) patch.actualEnd = actualEnd
        // A ticket reopened in Jira has to be able to un-finish here too, or
        // the chart keeps reporting a finish that was taken back.
        if (!issue.done && p.actualEnd) patch.actualEnd = null
        if (issue.startSource === 'created') fromCreated += 1
        if (Object.keys(patch).length) {
          onUpdate(p.key, patch)
          changed += 1
        }
      }
      setSyncNote({
        severity: 'success',
        text: `${changed} project${changed === 1 ? '' : 's'} updated from ${r.issues.length} Jira issue${r.issues.length === 1 ? '' : 's'}`
          + `${r.missing.length ? ` · ${r.missing.length} key${r.missing.length === 1 ? '' : 's'} not found in Jira: ${r.missing.slice(0, 4).join(', ')}` : ''}`
          + `${fromCreated ? ` · ${fromCreated} start date${fromCreated === 1 ? '' : 's'} taken from when the ticket was raised, Jira having no Start date on them` : ''}`,
      })
    } catch (e) {
      setSyncNote({ severity: 'error', text: e.message })
    } finally {
      setSyncing(false)
    }
  }

  /*
   * The work underneath a row, fetched only when somebody asks for it.
   *
   * A hundred and fifty-nine epics have thousands of tasks between them, and
   * pulling all of it to draw six visible rows would be slow, rude to Jira's
   * rate limit, and mostly wasted. So: expand a row, fetch that row's children
   * once, keep them for the session.
   *
   * Keyed by JIRA key rather than by project, because a child expands the same
   * way its parent did — an initiative opens into epics, an epic into tasks —
   * and the loader does not need to know which level it is looking at.
   */
  const [open, setOpen] = useState(() => new Set())
  const [kids, setKids] = useState(() => new Map())

  const toggle = async (jiraKey) => {
    if (!jiraKey) return
    const key = jiraKey.trim().toUpperCase()
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (kids.has(key)) return
    setKids((prev) => new Map(prev).set(key, { loading: true, rows: [], error: null }))
    try {
      const r = await api.jiraChildren([key])
      const issues = (r.byParent && r.byParent[key]) || []
      setKids((prev) => new Map(prev).set(key, { loading: false, error: null, rows: issues }))
    } catch (e) {
      setKids((prev) => new Map(prev).set(key, { loading: false, error: e.message, rows: [] }))
    }
  }

  /*
   * A Jira issue, read as the register reads a project, so one drawing routine
   * serves both. The task's PLAN is its due date; a task rarely carries a
   * planned start, and inventing one from its creation date would draw a bar
   * nobody committed to.
   */
  const asRow = (issue) => ({
    rowKey: issue.key,
    jiraKey: issue.key,
    title: issue.summary,
    sub: `${issue.key} · ${issue.type || 'issue'} · ${issue.status}`,
    timeline: timelineOf({
      start: null,
      due: issue.due,
      actualStart: issue.start || issue.created,
      actualEnd: issue.done ? issue.resolved : null,
      status: issue.done ? 'Done' : issue.status,
    }, asOf),
    outsideTeam: false,
  })

  /*
   * Editing the plan, in both places at once.
   *
   * The register is master for the PLAN — it is where the year was committed
   * to — so a change here writes the project and then pushes the same two
   * dates to the ticket. Outcomes go the other way and only the other way:
   * Jira stamps a resolution date when an issue is resolved and will not
   * accept one as a field, which is why there is no box for it here.
   */
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const savePlan = async (row, next) => {
    setSaving(true)
    try {
      // The register first: it is the thing being reported on, and it must
      // hold the change even if Jira is unreachable.
      if (row.projectKey) onUpdate(row.projectKey, { start: next.start || null, due: next.due || null })
      if (row.jiraKey && jira?.writable) {
        await api.jiraUpdate(row.jiraKey, { start: next.start || null, due: next.due || null })
        setSyncNote({ severity: 'success', text: `${row.jiraKey} updated here and in Jira.` })
      } else if (row.jiraKey && jira?.configured) {
        setSyncNote({
          severity: 'info',
          text: `Saved here. Not written to ${row.jiraKey}: this server has writing switched off `
            + '(set JIRA_ALLOW_WRITES=true in the Render dashboard).',
        })
      }
      setEditing(null)
    } catch (e) {
      // The register keeps the change; the ticket did not take it. Saying so
      // is the whole point — a silent half-write is how two systems drift.
      setSyncNote({ severity: 'error', text: `Saved here, but Jira refused it: ${e.message}` })
    } finally {
      setSaving(false)
    }
  }

  const [q, setQ] = useState('')
  const [fPic, setFPic] = useState('all')
  const [fState, setFState] = useState('all')
  const [ours, setOurs] = useState(true)

  const rows = useMemo(() => {
    const hay = q.trim().toLowerCase()
    return plan.projects
      .filter((p) => p.commitLevel !== 'nextyear' && p.commitLevel !== 'excluded')
      .filter((p) => (ours ? !p.outsideTeam : true))
      .filter((p) => p.timeline.plannedStart || p.timeline.plannedEnd || p.timeline.actualStart)
      .filter((p) => (fPic === 'all' ? true : (p.pic || 'none') === fPic))
      .filter((p) => {
        if (fState === 'all') return true
        if (fState === 'late') return (p.timeline.lateBy ?? 0) > 0
        if (fState === 'overdue') return p.timeline.overdue
        return p.timeline.state === fState
      })
      .filter((p) => !hay || `${p.jiraKey || ''} ${p.summary} ${p.program || ''}`.toLowerCase().includes(hay))
      .sort((a, b) => String(a.timeline.plannedStart || a.timeline.actualStart || '9999')
        .localeCompare(String(b.timeline.plannedStart || b.timeline.actualStart || '9999')))
  }, [plan.projects, q, fPic, fState, ours])

  /*
   * The calendar the bars are drawn on, taken from the dates actually present
   * rather than assumed to be the plan year: a project that started in
   * December 2025 or runs into 2027 has to be visible, not clipped to keep the
   * grid tidy.
   */
  const span = useMemo(() => {
    const all = []
    for (const p of rows) {
      const tl = p.timeline
      for (const d of [tl.plannedStart, tl.plannedEnd, tl.actualStart, tl.actualEnd]) {
        if (isDate(d)) all.push(at(d))
      }
    }
    const year = Number((asOf || '2026-01-01').slice(0, 4))
    all.push(at(`${year}-01-01`), at(`${year}-12-31`))
    const min = Math.min(...all)
    const max = Math.max(...all)
    const pad = Math.max(DAY * 7, (max - min) * 0.02)
    return { from: min - pad, to: max + pad }
  }, [rows, asOf])

  const pct = (ms) => ((ms - span.from) / (span.to - span.from)) * 100
  const bar = (a, b) => {
    if (!isDate(a) && !isDate(b)) return null
    // A single date is still worth drawing: a start with no end is a bar that
    // has begun, not a bar that does not exist.
    const s = at(isDate(a) ? a : b)
    const e = at(isDate(b) ? b : a)
    const left = pct(Math.min(s, e))
    const width = Math.max(0.4, pct(Math.max(s, e)) - left)
    return { left, width }
  }

  // Month ticks across the whole span.
  const ticks = useMemo(() => {
    const out = []
    const d = new Date(span.from)
    d.setUTCDate(1)
    d.setUTCHours(0, 0, 0, 0)
    for (let i = 0; i < 60; i++) {
      const ms = d.getTime()
      if (ms > span.to) break
      if (ms >= span.from) out.push({ ms, label: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() })
      d.setUTCMonth(d.getUTCMonth() + 1)
    }
    return out
  }, [span])

  const picks = [{ id: 'all', nick: 'All PICs' }, ...plan.assignees.map((p) => ({ id: p.id, nick: p.nick }))]
  const late = (p) => (p.timeline.lateBy ?? 0) > 0
  const colourOf = (p) => {
    if (late(p)) return STATUS.critical
    if (p.timeline.state === 'finished') return STATUS.good
    return CHART[mode].series[0]
  }

  /*
   * One row, and everything underneath it.
   *
   * Defined here rather than at module scope so it shares the calendar the
   * bars are measured against — a task drawn on its own scale would line up
   * with nothing above it, which is the one thing a Gantt chart has to get
   * right.
   *
   * Recursive on purpose: an initiative opens into epics and an epic into
   * tasks, and neither the fetch nor the drawing needs to know which it is
   * looking at.
   */
  function RowGroup({ row, depth }) {
    const tl = row.timeline
    const planned = bar(tl.plannedStart, tl.plannedEnd)
    const actual = bar(tl.actualStart, tl.actualEnd || (tl.running ? asOf : null))
    const colour = colourOf(row)
    const key = String(row.jiraKey || '').trim().toUpperCase()
    const canOpen = !!key && !!jira?.configured
    /*
     * A project row is editable because the register owns its plan. A Jira
     * child is editable only when this server is allowed to write, since there
     * is nothing here to save it into — the ticket IS the record.
     */
    const canEdit = !!row.projectKey || (!!row.jiraKey && !!jira?.writable)
    const isOpen = open.has(key)
    const under = kids.get(key)

    return (
      <>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            minHeight: depth ? 28 : 34,
            borderBottom: 1,
            borderColor: 'divider',
            opacity: row.outsideTeam ? 0.6 : 1,
            bgcolor: depth ? 'action.hover' : undefined,
            '&:hover': { bgcolor: 'action.selected' },
          }}
        >
          <Box sx={{ width: 300, flexShrink: 0, px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.5 + depth * 2 }}>
            {canOpen ? (
              <IconButton
                size="small"
                sx={{ p: 0.25 }}
                onClick={() => toggle(key)}
                aria-label={isOpen ? `collapse ${key}` : `expand ${key}`}
              >
                {under?.loading ? <CircularProgress size={13} />
                  : isOpen ? <ExpandMoreIcon sx={{ fontSize: 17 }} /> : <ChevronRightIcon sx={{ fontSize: 17 }} />}
              </IconButton>
            ) : (
              <Box sx={{ width: 21, flexShrink: 0 }} />
            )}
            <Box sx={{ overflow: 'hidden' }}>
              <Typography variant="body2" noWrap sx={{ fontSize: depth ? '0.72rem' : '0.78rem', fontWeight: depth ? 400 : 600 }}>
                {row.title}
              </Typography>
              <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block', fontSize: '0.65rem' }}>
                {row.sub}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ position: 'relative', flex: 1, height: depth ? 28 : 34 }}>
            {ticks.map((tk) => (
              <Box
                key={tk.ms}
                sx={{
                  position: 'absolute', left: `${pct(tk.ms)}%`, top: 0, bottom: 0,
                  borderLeft: 1, borderColor: 'divider', opacity: 0.5,
                }}
              />
            ))}
            <Box sx={{
              position: 'absolute', left: `${pct(at(asOf))}%`, top: 0, bottom: 0,
              borderLeft: 2, borderColor: STATUS.warning, opacity: 0.7,
            }}
            />

            {planned && (
              <Tooltip title={`Planned ${tl.plannedStart || '—'} to ${tl.plannedEnd || '—'}${tl.plannedDays != null ? ` · ${tl.plannedDays} days` : ''}${canEdit ? ' · click to change' : ''}`}>
                <Box
                  onClick={canEdit ? (e) => setEditing({ anchor: e.currentTarget, row }) : undefined}
                  sx={{
                    position: 'absolute',
                    left: `${planned.left}%`,
                    width: `${planned.width}%`,
                    top: depth ? 4 : 6,
                    height: depth ? 7 : 9,
                    borderRadius: 0.5,
                    border: 1,
                    borderColor: 'text.disabled',
                    cursor: canEdit ? 'pointer' : 'default',
                    '&:hover': canEdit ? { borderColor: 'primary.main', bgcolor: 'action.selected' } : undefined,
                  }}
                />
              </Tooltip>
            )}
            {!planned && canEdit && (
              <Tooltip title="No planned dates — click to set them">
                <IconButton
                  size="small"
                  sx={{ position: 'absolute', left: 2, top: depth ? 2 : 5, p: 0.25, opacity: 0.35, '&:hover': { opacity: 1 } }}
                  onClick={(e) => setEditing({ anchor: e.currentTarget, row })}
                  aria-label={`set dates for ${row.rowKey}`}
                >
                  <EditCalendarIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
            {actual && (
              <Tooltip title={`Actual ${tl.actualStart || '—'} to ${tl.actualEnd || (tl.running ? 'still running' : '—')}${tl.actualDays != null ? ` · ${tl.actualDays} days` : ''}`}>
                <Box sx={{
                  position: 'absolute',
                  left: `${actual.left}%`,
                  width: `${actual.width}%`,
                  top: depth ? 14 : 18,
                  height: depth ? 7 : 9,
                  borderRadius: 0.5,
                  bgcolor: colour,
                }}
                />
              </Tooltip>
            )}
            {!actual && planned && (
              <Typography
                variant="caption"
                sx={{
                  position: 'absolute',
                  left: `${Math.min(92, planned.left + planned.width + 0.6)}%`,
                  top: depth ? 11 : 15,
                  fontSize: '0.6rem',
                  color: 'text.disabled',
                  whiteSpace: 'nowrap',
                }}
              >
                no actual dates
              </Typography>
            )}
          </Box>

          <Box sx={{ width: 96, flexShrink: 0, px: 1, textAlign: 'right' }}>
            {tl.lateBy == null ? (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>
            ) : (
              <Chip
                size="small"
                label={tl.lateBy > 0 ? `+${tl.lateBy}d` : `${tl.lateBy}d`}
                variant="outlined"
                sx={{
                  height: 19,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  color: tl.lateBy > 0 ? STATUS.critical : STATUS.good,
                  borderColor: tl.lateBy > 0 ? STATUS.critical : STATUS.good,
                }}
              />
            )}
          </Box>
        </Box>

        {isOpen && under && !under.loading && (
          under.error ? (
            <Box sx={{ pl: 4 + depth * 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ color: STATUS.critical }}>{under.error}</Typography>
            </Box>
          ) : under.rows.length === 0 ? (
            <Box sx={{ pl: 4 + depth * 2, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                Nothing under {key} in Jira.
              </Typography>
            </Box>
          ) : (
            under.rows.map((issue) => (
              <RowGroup key={issue.key} row={asRow(issue)} depth={depth + 1} />
            ))
          )
        )}
      </>
    )
  }

  const stat = (label, value, tone) => (
    <Box sx={{ minWidth: 96 }}>
      <Typography variant="h3" sx={{ color: tone || 'text.primary', lineHeight: 1.1 }}>{value}</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 320 }}>
          <Typography variant="h2">Timeline</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            What was planned, and what actually happened. The outline is the plan; the solid bar is the outcome. The gap
            between their right-hand edges is the slip.
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Button
            variant="outlined"
            startIcon={<SyncIcon />}
            disabled={!jira?.configured || syncing || !keyed.length}
            onClick={sync}
          >
            {syncing ? 'Reading Jira…' : `Sync ${keyed.length} from Jira`}
          </Button>
          <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}>
            {jira == null ? 'checking…'
              : jira.configured ? `${jira.site?.replace(/^https?:\/\//, '')} as ${jira.account}`
                : 'not configured on the server'}
          </Typography>
        </Box>
      </Box>
      {syncing && <LinearProgress />}
      {syncNote && (
        <Alert severity={syncNote.severity} onClose={() => setSyncNote(null)}>{syncNote.text}</Alert>
      )}
      {jira && !jira.configured && (
        <Alert severity="info">
          Jira is not connected on the server, so actual dates have to be typed in by hand. To connect it, set{' '}
          <strong>JIRA_BASE_URL</strong>, <strong>JIRA_EMAIL</strong> and <strong>JIRA_API_TOKEN</strong> in the Render
          dashboard under Environment — the token stays on the server and is never sent to this page.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2.5, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {stat('with a plan', t.planned)}
        {stat('finished', t.finished, STATUS.good)}
        {stat('running now', t.running)}
        {stat('past due, unfinished', t.overdue, t.overdue ? STATUS.critical : undefined)}
        {stat('judged against a date', t.judged)}
        {stat('of those, on time', t.onTime, t.onTime ? STATUS.good : 'text.secondary')}
        {stat('average slip', t.avgSlip == null ? '—' : `${t.avgSlip}d`, t.avgSlip ? STATUS.warning : undefined)}
        {t.noDates > 0 && stat('no dates at all', t.noDates, 'text.disabled')}
      </Paper>

      <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          size="small"
          placeholder="Search key, project, programme"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ minWidth: 260 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>PIC</InputLabel>
          <Select label="PIC" value={fPic} onChange={(e) => setFPic(e.target.value)}>
            {picks.map((p) => <MenuItem key={p.id} value={p.id}>{p.nick}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel>State</InputLabel>
          <Select label="State" value={fState} onChange={(e) => setFState(e.target.value)}>
            <MenuItem value="all">Everything</MenuItem>
            <MenuItem value="overdue">Past due, unfinished</MenuItem>
            <MenuItem value="late">Late by any measure</MenuItem>
            <MenuItem value="running">Running now</MenuItem>
            <MenuItem value="finished">Finished</MenuItem>
            <MenuItem value="not started">Not started</MenuItem>
          </Select>
        </FormControl>
        <FormControlLabel
          control={<Switch size="small" checked={ours} onChange={(e) => setOurs(e.target.checked)} />}
          label={<Typography variant="body2">Ours only</Typography>}
        />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {rows.length} project{rows.length === 1 ? '' : 's'} on the chart
        </Typography>
      </Paper>

      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Box sx={{ display: 'flex', borderBottom: 1, borderColor: 'divider', bgcolor: 'action.hover' }}>
          <Box sx={{ width: 300, flexShrink: 0, px: 1.5, py: 0.75 }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>PROJECT</Typography>
          </Box>
          <Box sx={{ position: 'relative', flex: 1, height: 26 }}>
            {ticks.map((tk) => (
              <Box
                key={tk.ms}
                sx={{
                  position: 'absolute', left: `${pct(tk.ms)}%`, top: 0, bottom: 0,
                  borderLeft: 1, borderColor: 'divider', pl: 0.5,
                }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem' }}>
                  {tk.label === 'Jan' ? `${tk.label} ${String(tk.year).slice(2)}` : tk.label}
                </Typography>
              </Box>
            ))}
          </Box>
          <Box sx={{ width: 96, flexShrink: 0, px: 1, py: 0.75, textAlign: 'right' }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>SLIP</Typography>
          </Box>
        </Box>

        <Box sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {rows.map((p) => (
            <RowGroup
              key={p.key}
              row={{
                rowKey: p.key,
                projectKey: p.key,
                jiraKey: p.jiraKey,
                title: p.summary,
                sub: [
                  p.jiraKey || null,
                  OBJ_BY_ID[p.objective] ? `Obj ${OBJ_BY_ID[p.objective].no}` : null,
                  p.savingHours ? `${fmtHours(p.savingHours)} hrs/mth` : null,
                ].filter(Boolean).join(' · '),
                timeline: p.timeline,
                outsideTeam: p.outsideTeam,
              }}
              depth={0}
            />
          ))}
          {rows.length === 0 && (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Nothing matches that filter.
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>

      <Popover
        open={!!editing}
        anchorEl={editing?.anchor}
        onClose={() => setEditing(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {editing && <PlanEditor row={editing.row} onSave={savePlan} saving={saving} jira={jira} />}
      </Popover>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>How to read it</Typography>
        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 34, height: 9, border: 1, borderColor: 'text.disabled', borderRadius: 0.5 }} />
            <Typography variant="caption">planned</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 34, height: 9, bgcolor: STATUS.good, borderRadius: 0.5 }} />
            <Typography variant="caption">finished on time</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 34, height: 9, bgcolor: STATUS.critical, borderRadius: 0.5 }} />
            <Typography variant="caption">late, or past due and unfinished</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 2, height: 14, bgcolor: STATUS.warning }} />
            <Typography variant="caption">today ({asOf})</Typography>
          </Box>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
          <strong>Planned dates are never edited to match reality.</strong> Moving a due date to the day something
          actually landed is how a portfolio comes to look as though everything arrived on time. The plan stays as it
          was set, and the outcome is recorded beside it. Each kind of date has one owner:{' '}
          <strong>the plan is owned here</strong> — click a planned bar to change it, and it is written to the ticket
          too — while <strong>outcomes are owned by Jira</strong> and only ever read. A resolution date cannot be typed
          into Jira at all: it is stamped when an issue is resolved, so it arrives from there or not at all. A project counts as on time or late only once there is
          something to judge — a due date, and either a finish or a date already gone past. {t.judged} of {t.planned}{' '}
          with a plan qualify so far; the rest show an empty track rather than a green bar, because nobody has said what
          happened yet.
        </Typography>
      </Paper>
    </Box>
  )
}
