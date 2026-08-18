import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Chip, TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Switch, Tooltip, InputAdornment, Button, Alert, LinearProgress,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import SyncIcon from '@mui/icons-material/Sync'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  IconButton, CircularProgress, Popover, Divider, Dialog, DialogTitle, DialogContent,
  DialogActions, Checkbox, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
} from '@mui/material'
import EditCalendarIcon from '@mui/icons-material/EditCalendar'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
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
export default function Timeline({ plan, settings, onUpdate, onAddProjects }) {
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
  /*
   * A story or a task is the bottom of this chart. Sub-tasks exist in Jira and
   * are not what anybody is reading a portfolio timeline to find out, so those
   * rows offer no chevron at all rather than one that opens onto noise.
   */
  const LEAF = /^(story|task|sub-?task|bug|defect)$/i

  const asRow = (issue) => ({
    rowKey: issue.key,
    jiraKey: issue.key,
    title: issue.summary,
    sub: `${issue.key} · ${issue.type || 'issue'} · ${issue.status}`,
    leaf: LEAF.test(issue.type || ''),
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

  /*
   * Epics raised in Jira that the register has never heard of.
   *
   * The comparison happens here rather than on the server, because this side
   * is the only one that knows what the register holds. Nothing is added
   * without being shown first: an epic in Jira is not automatically this
   * team's work, and a register that grows by itself stops being a decision.
   */
  const [finding, setFinding] = useState(false)
  const [candidates, setCandidates] = useState(null)
  const [picked, setPicked] = useState(() => new Set())

  const findNew = async () => {
    setFinding(true)
    setSyncNote(null)
    try {
      const r = await api.jiraEpics()
      const have = new Set(plan.projects
        .map((p) => String(p.jiraKey || '').trim().toUpperCase())
        .filter(Boolean))
      const fresh = r.epics.filter((e) => !have.has(e.key.toUpperCase()))
      setCandidates({ all: r.epics.length, project: r.project, rows: fresh })
      setPicked(new Set(fresh.map((e) => e.key)))
      if (!fresh.length) {
        setSyncNote({ severity: 'success', text: `Nothing new — all ${r.epics.length} epics in ${r.project} are already on the register.` })
        setCandidates(null)
      }
    } catch (e) {
      setSyncNote({ severity: 'error', text: e.message })
    } finally {
      setFinding(false)
    }
  }

  const addPicked = () => {
    const rows = candidates.rows.filter((e) => picked.has(e.key))
    onAddProjects(rows.map((e) => ({
      jiraKey: e.key,
      summary: e.summary || e.key,
      /*
       * Jira's dates ARE the plan for a project the register is meeting for
       * the first time — there is no earlier commitment for them to overwrite.
       * That is the one moment this is true, which is why the sync never does
       * it afterwards.
       */
      start: e.start || null,
      due: e.due || null,
      actualStart: e.start || e.created || null,
      actualEnd: e.done ? e.resolved : null,
      status: e.done ? 'Done' : (/progress/i.test(e.status) ? 'In Progress' : 'Not Start'),
      /*
       * WATCH, not commit. An epic somebody raised in Jira has not been
       * costed, sized or agreed as part of this team's year; letting it into
       * the committed total on arrival would move the KPI by accident.
       * Somebody promotes it deliberately, once it has hours against it.
       */
      commitLevel: 'watch',
      comment: [
        e.assignee ? `Jira assignee: ${e.assignee}` : null,
        `Imported from ${e.key} on the Timeline tab.`,
      ].filter(Boolean).join('\n'),
    })))
    setSyncNote({
      severity: 'success',
      text: `${rows.length} epic${rows.length === 1 ? '' : 's'} added to the register as WATCH — they carry no saving hours `
        + 'and count toward nothing until somebody sizes them.',
    })
    setCandidates(null)
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
        if (fState === 'ahead') return (p.timeline.lateBy ?? 0) < 0
        if (fState === 'on') return p.timeline.lateBy === 0
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

  /*
   * The three answers a finished project can give, and they are not shades of
   * one another: early, on the day, and late are different outcomes and get
   * different colours. Anything still running is neither — it is blue, and
   * says nothing about a finish it has not reached.
   */
  const AHEAD = mode === 'dark' ? '#3ba7f0' : '#1d7fc4'
  const finishOf = (tl) => {
    if (tl.lateBy == null) return null
    if (tl.lateBy > 0) return 'late'
    if (tl.lateBy < 0) return 'ahead'
    return 'on'
  }
  const FINISH_COLOUR = { ahead: AHEAD, on: STATUS.good, late: STATUS.critical }
  const FINISH_WORD = { ahead: 'ahead of schedule', on: 'on schedule', late: 'behind schedule' }
  const colourOf = (p) => {
    const f = finishOf(p.timeline)
    if (f) return FINISH_COLOUR[f]
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
    /*
     * A task carries a due date and no planned start — Jira's Start date is an
     * epic-level habit here, and 31 of the 40 tasks under one epic have no due
     * date at all. Drawn literally, its plan collapsed to a sliver at the due
     * date and there was nothing to compare the outcome against: the two bars
     * were a dot and a bar rather than a pair.
     *
     * So a plan with an end but no start is drawn from the same left edge as
     * the outcome. Both bars then start together and the only difference
     * between them is where they finish, which is the comparison being asked
     * for. The tooltip says the start was not planned, so nothing here claims
     * a commitment that was never made.
     */
    const plannedLeft = tl.plannedStart || tl.actualStart
    const planned = tl.plannedEnd ? bar(plannedLeft, tl.plannedEnd) : bar(tl.plannedStart, tl.plannedEnd)
    /*
     * The actual bar starts where the PLAN starts.
     *
     * Asked for, and it is the right call for this chart: lining both bars up
     * on the left makes the only difference between them the one that matters
     * — where they end. Two bars offset at both ends turn a simple question
     * ("did it land on time") into mental arithmetic.
     *
     * The real start is not lost. It is in the tooltip, and the model still
     * holds it, so nothing that measures duration is reading the drawn bar.
     */
    const drawnStart = tl.plannedStart || tl.actualStart
    const finished = tl.actualEnd || (tl.running ? asOf : null)
    const actual = bar(drawnStart, finished)
    const finish = finishOf(tl)
    const colour = colourOf(row)

    /*
     * The variance, drawn as its own segment beyond the planned edge (late) or
     * short of it (early). That segment IS the slip: its length is the number
     * in the last column, so the chart and the figure cannot disagree.
     */
    const overrun = finish === 'late' && tl.plannedEnd && tl.actualEnd
      ? bar(tl.plannedEnd, tl.actualEnd) : null
    const saved = finish === 'ahead' && tl.plannedEnd && tl.actualEnd
      ? bar(tl.actualEnd, tl.plannedEnd) : null
    const key = String(row.jiraKey || '').trim().toUpperCase()
    const canOpen = !!key && !!jira?.configured && !row.leaf
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
              <Tooltip title={[
                `Planned ${tl.plannedStart || '—'} to ${tl.plannedEnd || '—'}`,
                tl.plannedDays != null ? `${tl.plannedDays} days` : null,
                !tl.plannedStart && tl.plannedEnd
                  ? 'No planned start — drawn from where the work began, so only the finish is compared'
                  : null,
                canEdit ? 'click to change' : null,
              ].filter(Boolean).join(' · ')}
              >
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
              <Tooltip title={[
                `Actually ran ${tl.actualStart || '—'} to ${tl.actualEnd || (tl.running ? 'still running' : '—')}`,
                tl.actualDays != null ? `${tl.actualDays} days` : null,
                finish ? `Finished ${FINISH_WORD[finish]} by ${Math.abs(tl.lateBy)} day${Math.abs(tl.lateBy) === 1 ? '' : 's'}` : null,
                tl.plannedStart && tl.actualStart && tl.plannedStart !== tl.actualStart
                  ? `Bar drawn from the planned start (${tl.plannedStart}); work actually began ${tl.actualStart}`
                  : null,
              ].filter(Boolean).join(' · ')}
              >
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
            {overrun && (
              <Tooltip title={`${tl.lateBy} days beyond the planned finish`}>
                <Box sx={{
                  position: 'absolute',
                  left: `${overrun.left}%`,
                  width: `${overrun.width}%`,
                  top: depth ? 14 : 18,
                  height: depth ? 7 : 9,
                  borderRadius: 0.5,
                  // Hatched, so an overrun cannot be mistaken for work: it is
                  // the gap between the promise and the delivery.
                  backgroundImage: `repeating-linear-gradient(45deg, ${STATUS.critical}, ${STATUS.critical} 3px, transparent 3px, transparent 6px)`,
                  border: 1,
                  borderColor: STATUS.critical,
                }}
                />
              </Tooltip>
            )}
            {saved && (
              <Tooltip title={`${Math.abs(tl.lateBy)} days earlier than planned`}>
                <Box sx={{
                  position: 'absolute',
                  left: `${saved.left}%`,
                  width: `${saved.width}%`,
                  top: depth ? 14 : 18,
                  height: depth ? 7 : 9,
                  borderRadius: 0.5,
                  backgroundImage: `repeating-linear-gradient(45deg, ${AHEAD}, ${AHEAD} 3px, transparent 3px, transparent 6px)`,
                  border: 1,
                  borderColor: AHEAD,
                  opacity: 0.65,
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
                  color: FINISH_COLOUR[finish] || STATUS.good,
                  borderColor: FINISH_COLOUR[finish] || STATUS.good,
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
            startIcon={<PlaylistAddIcon />}
            disabled={!jira?.configured || finding}
            onClick={findNew}
            sx={{ mr: 1 }}
          >
            {finding ? 'Looking…' : 'Find new epics'}
          </Button>
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
            <MenuItem value="late">Behind schedule</MenuItem>
            <MenuItem value="on">Finished on schedule</MenuItem>
            <MenuItem value="ahead">Finished ahead of schedule</MenuItem>
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

      <Dialog open={!!candidates} onClose={() => setCandidates(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {candidates?.rows.length} epic{candidates?.rows.length === 1 ? '' : 's'} in {candidates?.project} that the
          register does not have
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Box sx={{ px: 3, py: 1.5 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Of {candidates?.all} epics in the project. Anything added comes in as <strong>Watch</strong> with no
              saving hours, so it appears on the register and in nobody&rsquo;s committed total until it has been sized
              and promoted. Jira&rsquo;s dates become its plan — the only time that happens, since there is no earlier
              commitment to overwrite.
            </Typography>
          </Box>
          <List dense sx={{ maxHeight: '50vh', overflowY: 'auto' }}>
            {candidates?.rows.map((e) => (
              <ListItem key={e.key} disablePadding>
                <ListItemButton
                  onClick={() => setPicked((prev) => {
                    const next = new Set(prev)
                    if (next.has(e.key)) next.delete(e.key)
                    else next.add(e.key)
                    return next
                  })}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Checkbox edge="start" size="small" checked={picked.has(e.key)} tabIndex={-1} disableRipple />
                  </ListItemIcon>
                  <ListItemText
                    primary={e.summary || e.key}
                    secondary={[
                      e.key,
                      e.status,
                      e.assignee ? `assigned ${e.assignee}` : null,
                      e.start || e.due ? `plan ${e.start || '—'} to ${e.due || '—'}` : 'no dates in Jira',
                      e.resolved ? `resolved ${e.resolved}` : null,
                    ].filter(Boolean).join(' · ')}
                    primaryTypographyProps={{ fontSize: '0.85rem' }}
                    secondaryTypographyProps={{ fontSize: '0.7rem' }}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setPicked(new Set(candidates.rows.map((e) => e.key)))}>All</Button>
          <Button size="small" onClick={() => setPicked(new Set())}>None</Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setCandidates(null)}>Cancel</Button>
          <Button variant="contained" disabled={!picked.size} onClick={addPicked}>
            Add {picked.size} to the register
          </Button>
        </DialogActions>
      </Dialog>

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
            <Box sx={{ width: 34, height: 9, bgcolor: AHEAD, borderRadius: 0.5 }} />
            <Typography variant="caption">finished ahead of schedule</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 34, height: 9, bgcolor: STATUS.good, borderRadius: 0.5 }} />
            <Typography variant="caption">finished on schedule</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 34, height: 9, bgcolor: STATUS.critical, borderRadius: 0.5 }} />
            <Typography variant="caption">behind schedule</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{
              width: 34,
              height: 9,
              borderRadius: 0.5,
              border: 1,
              borderColor: STATUS.critical,
              backgroundImage: `repeating-linear-gradient(45deg, ${STATUS.critical}, ${STATUS.critical} 3px, transparent 3px, transparent 6px)`,
            }}
            />
            <Typography variant="caption">the slip itself — days past the planned finish</Typography>
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
