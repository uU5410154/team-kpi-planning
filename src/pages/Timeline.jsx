import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Chip, TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Switch, Tooltip, InputAdornment, Button, Alert, LinearProgress, useMediaQuery, Collapse,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import FilterListIcon from '@mui/icons-material/FilterList'
import Loading from '../components/Loading.jsx'
import SyncIcon from '@mui/icons-material/Sync'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  IconButton, CircularProgress, Popover, Divider, Dialog, DialogTitle, DialogContent,
  DialogActions, Checkbox, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
} from '@mui/material'
import EditCalendarIcon from '@mui/icons-material/EditCalendar'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import * as api from '../lib/api.js'
import { mergeJira, JIRA_KEY } from '../lib/jiraMerge.js'
import { useTheme } from '@mui/material/styles'
import { STATUS, CHART, OBJ_BY_ID } from '../lib/palette.js'
import {
  fmtHours, isDate, timelineOf, pinFinishPatch, unpinFinishPatch, timelinessOf,
} from '../lib/model.js'
import { syncStatus } from '../lib/storage.js'
import { alpha } from '@mui/material/styles'
import ReportProblemIcon from '@mui/icons-material/ReportProblemOutlined'
import HourglassIcon from '@mui/icons-material/HourglassTopOutlined'
import { Pill } from '../components/Brand.jsx'
import ActiveControl from '../dashboard/ActiveControl.jsx'
import { activitySignals, activeUnits } from '../lib/manager.js'
import { weekOf, weekTitle, PROPOSAL_LABEL, BLOCKER_CATEGORIES } from '../lib/weekly.js'

const CATEGORY_LABEL = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))
const FORECAST = '#a18ad9'
const fmtD = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—')
const PROPOSAL_TONE = { pending: 'violet', approved: 'good', rejected: 'bad', deciding: 'violet' }

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
function PlanEditor({ row, onSave, onHold, saving, jira }) {
  const [start, setStart] = useState(row.timeline.plannedStart || '')
  const [due, setDue] = useState(row.timeline.plannedEnd || '')
  const bad = !!start && !!due && start > due
  // Only a project can hold its finish date: a task's resolution is the raw
  // fact the project's is rolled up FROM, and holding one of those would put
  // the register and its own arithmetic in disagreement.
  const canHold = !!row.projectKey
  const held = row.actualEndPinned === true
  const [finish, setFinish] = useState(row.timeline.actualEnd || '')

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
      {/*
        * THE FINISH DATE, AND WHO OWNS IT.
        *
        * Normally Jira does: it stamps a resolution date when the last task is
        * resolved, and nothing here writes one back. But that date is when
        * somebody dragged the card, and on work delivered long before anybody
        * closed it off it reads as drift nobody caused — with no way to correct
        * it in Jira. So the register can hold its own copy, deliberately, one
        * project at a time, and the sync then leaves that one field alone.
        */}
      {canHold ? (
        <>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>Finish date</Typography>
          <FormControlLabel
            sx={{ mb: held ? 1 : 0 }}
            control={(
              <Switch
                size="small"
                checked={held}
                disabled={saving}
                onChange={(e) => onHold(row, e.target.checked
                  ? (finish || row.timeline.actualEnd || due || null)
                  : null)}
              />
            )}
            label={<Typography variant="caption">Hold it — the Jira sync will not touch it</Typography>}
          />
          {held ? (
            <TextField
              size="small"
              fullWidth
              type="date"
              label="Finished on"
              value={finish}
              onChange={(e) => setFinish(e.target.value)}
              onBlur={() => { if (finish && finish !== (row.timeline.actualEnd || '')) onHold(row, finish) }}
              InputLabelProps={{ shrink: true }}
              helperText="Held by hand. Everything else on this project still follows Jira."
            />
          ) : (
            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mb: 1.5 }}>
              Following Jira: the resolution date of the last task under this project, read every morning and never
              written back. Hold it only where that is not the day the work landed.
            </Typography>
          )}
          <Divider sx={{ my: 1.5 }} />
        </>
      ) : (
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mb: 1.5 }}>
          The actual dates are not editable: Jira stamps a resolution date when an issue is resolved and will not
          accept one as a field, so outcomes are read from there and never written back.
        </Typography>
      )}
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
export default function Timeline({
  plan, settings, onUpdate, onAddProjects, onReplaceProjects, rawProjects, readOnly = false, jump = null, note = null,
  onOpenWeekly,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  /*
   * The two pinned columns. 300 + 96 is wider than a phone, so the month view
   * — whose track takes whatever is left — drew its bars in 0px. On a phone
   * the columns narrow, and the month track keeps a floor and scrolls instead.
   */
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  /*
   * NARROW is about the room the page has, not the window: a tablet with the
   * menu open leaves the page a phone's width, and gets a phone's columns and
   * a phone's folded filters.
   */
  const [boxW, setBoxW] = useState(0)
  const narrow = phone || (boxW > 0 && boxW < 640)
  const NAME_W = narrow ? 160 : 280
  const SLIP_W = narrow ? 64 : 80
  const PINNED_W = NAME_W + SLIP_W
  /*
   * THE CHART IS THE PAGE. Everything above it is one title line, one toolbar
   * and one line of figures, and the chart takes the rest of the window with
   * its own scroll — so the month header stays in sight however far down the
   * list somebody reads. Rows are dense enough for a screen to hold a couple
   * of dozen projects rather than nine.
   */
  const ROW_H = 36
  const KID_H = 26
  const asOf = settings.asOfDate

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

  /*
   * WHAT THE WEEKLY CHECK-INS SAY ABOUT EACH PROJECT: the tasks people
   * reported against it, what is blocking them, and any request to move its
   * date. The server sends an administrator everybody's, a team member only
   * their own. Nothing here is required — with no database, or an older
   * server, the chart simply has no markers.
   */
  const [weekly, setWeekly] = useState({})
  // Still waiting for the check-ins: said beside the figures, so markers that
  // have not arrived yet are not read as "nothing blocked".
  const [weeklyIn, setWeeklyIn] = useState(false)
  const [story, setStory] = useState(null)
  useEffect(() => {
    let dead = false
    api.weeklyByProject()
      .then((r) => { if (!dead) setWeekly(r.byProject || {}) })
      .catch(() => {})
      .finally(() => { if (!dead) setWeeklyIn(true) })
    return () => { dead = true }
  }, [])
  /** Everything the check-ins say about the register lines behind one bar. */
  const weeklyOf = (keys) => {
    const out = { history: [], blockers: [], proposals: [] }
    for (const k of keys || []) {
      const w = weekly[k]
      if (!w) continue
      out.history.push(...w.history)
      out.blockers.push(...w.blockers)
      out.proposals.push(...w.proposals)
    }
    out.pending = out.proposals.filter((p) => p.status === 'pending' || p.status === 'deciding')
    // The furthest date anybody has asked for: where the work lands if it is approved.
    out.forecast = out.pending.map((p) => p.proposedDue).filter(Boolean).sort().pop() || null
    return out
  }

  /*
   * ARRIVING FROM A WEEKLY TASK: the bar it belongs to is scrolled to and lit
   * for a few seconds, so the eye lands on it rather than hunting a list.
   */
  const [flash, setFlash] = useState(null)
  useEffect(() => {
    if (!jump?.focus) return undefined
    setFlash(jump.focus)
    const t1 = setTimeout(() => {
      document.querySelector(`[data-keys~="${CSS.escape(jump.focus)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 250)
    const t2 = setTimeout(() => setFlash(null), 5000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [jump?.n])

  const keyed = useMemo(
    () => plan.projects.filter((p) => JIRA_KEY.test(String(p.jiraKey || '').trim())),
    [plan.projects],
  )

  /*
   * The whole board, not just what the register already knows about.
   *
   * Refreshing dates for rows that happen to carry a key left a newly created
   * epic invisible until somebody thought to press a different button — that
   * is a refresh, not a sync. It now pulls both: actual dates for everything
   * keyed, and any epic on the board the register has never seen.
   *
   * The merge itself is shared with the scheduled job on the server, so a run
   * at seven in the morning and a person clicking this cannot end up
   * disagreeing about what the register should contain.
   */
  const sync = async () => {
    setSyncing(true)
    setSyncNote(null)
    try {
      /*
       * NOT OVER A REGISTER THE SHARED PLAN HAS MOVED PAST.
       *
       * This merge rewrites the whole register from what THIS browser holds.
       * If somebody else has saved since this browser last loaded — excluded a
       * project, changed a commit level, added hours — merging over the stale
       * copy and saving puts every one of those decisions back the way it was.
       * That is how four projects marked Excluded came back as Watch.
       *
       * Jira is not the problem and neither is the merge: the input is. So the
       * input is checked first, and a browser that is behind is told to load
       * the shared plan rather than quietly overwrite it.
       */
      const mark = syncStatus()
      const list = await api.listScenarios().catch(() => null)
      const latest = Array.isArray(list) && list.length
        ? [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
        : null
      if (latest && mark.syncedAt && String(latest.updatedAt || '') > String(mark.syncedAt)) {
        setSyncNote({
          severity: 'warning',
          text: `The shared plan was saved ${new Date(latest.updatedAt).toLocaleString()} by ${latest.updatedBy || 'somebody'}, `
            + 'after this browser last had it. Syncing now would rewrite the register from this older copy and undo '
            + 'whatever has changed since.',
          note: 'Reload the page to take the shared plan first, then sync — or use “Sync for everyone”, which runs '
            + 'against the shared plan itself and cannot go stale.',
        })
        return
      }

      const [fetched, board, rolled] = await Promise.all([
        keyed.length
          ? api.jiraIssues(keyed.map((p) => p.jiraKey.trim()))
          : Promise.resolve({ issues: [], missing: [] }),
        api.jiraEpics(),
        /*
         * And what the tasks under each project add up to: when the last one
         * was resolved, and whether anything under it is dated past the date
         * the project committed to.
         */
        keyed.length
          ? api.jiraRollup(keyed.map((p) => p.jiraKey.trim()))
          : Promise.resolve({ byParent: {} }),
      ])
      /*
       * The RAW register, not the computed one.
       *
       * plan.projects carries everything computePlan derived — shares, ROI,
       * the timeline, thirty-odd fields — and writing those back into stored
       * state would bake a snapshot of yesterday's arithmetic into the plan,
       * where it would be saved, exported and never recomputed.
       */
      const r = mergeJira({ projects: rawProjects },
        { issues: fetched.issues, epics: board.epics, rollups: rolled.byParent || {} },
        { addNew: true })
      if (r.unchanged) {
        setSyncNote({
          severity: 'success',
          text: `Already up to date — ${fetched.issues.length} issues checked, and all ${board.epics.length} epics `
            + `in ${board.project} are on the register.`,
          note: api.unknownNote(fetched.missing),
        })
        return
      }
      onReplaceProjects(r.projects)
      setSyncNote({
        severity: 'success',
        text: [
          r.updated ? `${r.updated} project${r.updated === 1 ? '' : 's'} updated` : null,
          r.renamed
            ? `${r.renamed} renamed to match Jira (${r.renames.slice(0, 2).map((x) => x.to).join(', ')}${r.renamed > 2 ? '…' : ''})`
            : null,
          r.added
            ? `${r.added} new epic${r.added === 1 ? '' : 's'} added as Watch (${r.addedKeys.slice(0, 5).join(', ')}${r.addedKeys.length > 5 ? '…' : ''})`
            : null,
          api.unknownNote(fetched.missing),
          r.fromCreated
            ? `${r.fromCreated} start${r.fromCreated === 1 ? '' : 's'} taken from when the ticket was raised`
            : null,
          r.skippedExcluded
            ? `${r.skippedExcluded} excluded project${r.skippedExcluded === 1 ? '' : 's'} not touched`
            : null,
        ].filter(Boolean).join(' · '),
        /*
         * WHERE IT LANDED, said out loud.
         *
         * This merge is in this browser. It said "3 projects updated" and
         * nothing about who could see them, so somebody synced on their
         * machine, watched a delay bar appear, and a colleague opening the app
         * saw nothing — which reads as the app being broken rather than as the
         * change never having left the room.
         */
        note: 'This is in your browser. Use “Sync for everyone” to run it against the shared plan.',
      })
    } catch (e) {
      setSyncNote({ severity: 'error', text: api.plainError(e) })
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
      setKids((prev) => new Map(prev).set(key, { loading: false, error: api.plainError(e), rows: [] }))
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
    sub: [
      issue.key,
      issue.type || 'issue',
      issue.status,
      // Which sprint the dates came from, so a bar drawn from a sprint window
      // is never mistaken for one somebody typed.
      issue.sprintName || null,
    ].filter(Boolean).join(' · '),
    leaf: LEAF.test(issue.type || ''),
    timeline: timelineOf({
      /*
       * THE SPRINT IS THE PLAN, where there is one.
       *
       * A task's own dates say when somebody meant to touch it; the sprint is
       * what the team committed to in planning, and it is the window the work
       * is actually scheduled in. It also gives a bar to the many tasks
       * carrying no dates of their own at all.
       */
      start: issue.sprintStart || null,
      due: issue.planEnd || issue.due || null,
      /*
       * Only once it has actually started. A Backlog task carrying a sprint
       * date three weeks out has not begun, and drawing a bar from that date
       * to today claimed work was under way on everything anybody had planned.
       */
      actualStart: issue.started ? (issue.sprintStart || issue.start || issue.created) : null,
      actualEnd: issue.done ? issue.resolved : null,
      status: issue.done ? 'Done' : issue.status,
    }, asOf),
    fromSprint: !!issue.sprintEnd,
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

  /**
   * Run the sync on the server, against the plan everybody loads.
   *
   * The same merge, run in the place where the result is visible to the team
   * rather than to one browser. Nothing local is touched: the shared plan is
   * rewritten, and this browser picks it up the way it picks up any other
   * change to it — on the next load.
   */
  const [sharing, setSharing] = useState(false)
  const syncShared = async () => {
    setSharing(true)
    setSyncNote(null)
    try {
      const r = await api.jiraSyncShared()
      if (!r.ok) {
        setSyncNote({ severity: 'error', text: api.plainError(r.error || 'The server could not run the sync.') })
        return
      }
      setSyncNote({
        severity: 'success',
        text: [
          r.wrote ? 'The SHARED plan has been updated' : 'The shared plan was already up to date',
          r.updated ? `${r.updated} project${r.updated === 1 ? '' : 's'} changed` : null,
          r.added ? `${r.added} new epic${r.added === 1 ? '' : 's'} added as Watch` : null,
          r.adjusted ? `${r.adjusted} carrying an adjusted date from a delay elsewhere` : null,
          r.pinned ? `${r.pinned} finish date${r.pinned === 1 ? '' : 's'} left alone as held` : null,
          // Said out loud, because "excluded" is a decision somebody made and
          // a sync that silently honoured it would be indistinguishable from
          // one that silently ignored it.
          r.skippedExcluded ? `${r.skippedExcluded} excluded project${r.skippedExcluded === 1 ? '' : 's'} not touched` : null,
        ].filter(Boolean).join(' · '),
        note: [r.missingNote || api.unknownNote(r.missingInJira), r.wrote ? 'Reload the page to see it — everyone else will get it when they do.' : null]
          .filter(Boolean).join(' '),
      })
    } catch (e) {
      setSyncNote({ severity: 'error', text: api.plainError(e) })
    } finally {
      setSharing(false)
    }
  }

  /**
   * Hold a project's finish date against the sync, or hand it back.
   *
   * Register only — there is nothing to write to Jira here. That is the whole
   * point: Jira will not accept a resolution date, which is why the correction
   * has to live in the register and has to be able to survive the next sync.
   */
  const holdFinish = (row, date) => {
    const keys = (row.projectKeys || [row.projectKey]).filter(Boolean)
    if (!keys.length) return
    for (const k of keys) {
      const project = rawProjects?.find((x) => x.key === k) || { key: k, actualEnd: row.timeline.actualEnd }
      onUpdate(k, date ? pinFinishPatch(project, date) : unpinFinishPatch())
    }
    setSyncNote(date
      ? {
        severity: 'success',
        text: `${row.jiraKey || row.projectKey}: finish held at ${date}. The sync will keep updating everything else.`,
      }
      : {
        severity: 'info',
        text: `${row.jiraKey || row.projectKey}: finish released — the next sync takes it back from Jira.`,
      })
  }

  const savePlan = async (row, next) => {
    setSaving(true)
    try {
      // The register first: it is the thing being reported on, and it must
      // hold the change even if Jira is unreachable.
      // Every line behind this bar, not just the first: they are one epic.
      for (const k of (row.projectKeys || [row.projectKey]).filter(Boolean)) {
        onUpdate(k, { start: next.start || null, due: next.due || null })
      }
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
      setSyncNote({ severity: 'error', text: `Saved here, but Jira refused it: ${api.plainError(e)}` })
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
      setSyncNote({ severity: 'error', text: api.plainError(e) })
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

  const [scale, setScale] = useState('month')
  const scrollRef = useRef(null)
  const rootRef = useRef(null)
  // On a phone the filters fold behind one button.
  const [showFilters, setShowFilters] = useState(false)

  /*
   * How much room the chart has: its width, so the month view never squeezes
   * its bars into a sliver beside the pinned columns, and its height, which is
   * whatever the window has left below the toolbar — so the chart fills the
   * screen and scrolls inside itself, header row always in sight.
   */
  const [fitH, setFitH] = useState(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const fit = () => {
      setBoxW(el.clientWidth)
      const top = el.getBoundingClientRect().top + window.scrollY
      setFitH(Math.max(phone ? 360 : 420, Math.round(window.innerHeight - top - 16)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    // The whole page too: an alert opening above the chart moves it down.
    if (rootRef.current) ro.observe(rootRef.current)
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [phone])
  const [q, setQ] = useState('')
  const [fPic, setFPic] = useState('all')
  const [fState, setFState] = useState('all')
  const [ours, setOurs] = useState(true)
  // The administrator's own word on what is being worked on now. Read by the
  // manager dashboard; nothing becomes active by itself.
  const [onlyActive, setOnlyActive] = useState(false)
  // How the rows are ordered. Display only: every figure is the same either way.
  const [sortBy, setSortBy] = useState('start')
  /*
   * ACTIVE THIS WEEK, the dashboard's answer: its dates, Jira work covering the
   * week, an update sent this week or an open decision — unless an
   * administrator overrode it. The Jira and decision signals are an
   * administrator's to read; a member's Timeline goes by dates and updates.
   */
  const thisWeek = weekOf()
  const [coverage, setCoverage] = useState(null)
  const [openDecisions, setOpenDecisions] = useState(null)
  useEffect(() => {
    if (readOnly) return undefined
    let dead = false
    api.jiraCoverage(thisWeek).then((r) => { if (!dead && r?.jira === 'on') setCoverage(r.byProject || {}) }).catch(() => {})
    api.decisions('open').then((r) => { if (!dead) setOpenDecisions(r.decisions || []) }).catch(() => {})
    return () => { dead = true }
  }, [readOnly, thisWeek])
  const signals = useMemo(() => activitySignals({
    projects: plan.projects, jira: coverage, decisions: openDecisions, history: weekly, weekMonday: thisWeek,
  }), [plan.projects, coverage, openDecisions, weekly, thisWeek])
  const activeList = useMemo(() => activeUnits(plan.projects, thisWeek, signals), [plan.projects, thisWeek, signals])
  const activeKeys = useMemo(() => new Set(activeList.flatMap((u) => u.keys)), [activeList])
  const projectOf = useMemo(() => Object.fromEntries(plan.projects.map((p) => [p.key, p])), [plan.projects])
  // Sent here by the header search: that project, whatever was filtered before.
  useEffect(() => {
    if (!jump?.q) return
    setQ(jump.q); setFPic('all'); setFState('all'); setOurs(false); setOnlyActive(false)
  }, [jump?.n])

  const rows = useMemo(() => {
    const hay = q.trim().toLowerCase()
    return plan.projects
      .filter((p) => p.commitLevel !== 'nextyear' && p.commitLevel !== 'excluded')
      .filter((p) => (ours ? !p.outsideTeam : true))
      .filter((p) => (onlyActive ? activeKeys.has(p.key) : true))
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
      .sort((a, b) => {
        const byStart = String(a.timeline.plannedStart || a.timeline.actualStart || '9999')
          .localeCompare(String(b.timeline.plannedStart || b.timeline.actualStart || '9999'))
        if (sortBy === 'late') {
          // Most days late first; nothing to judge yet goes to the end.
          const la = a.timeline.lateBy ?? -Infinity
          const lb = b.timeline.lateBy ?? -Infinity
          return lb - la || byStart
        }
        if (sortBy === 'due') {
          return String(a.timeline.plannedEnd || '9999').localeCompare(String(b.timeline.plannedEnd || '9999')) || byStart
        }
        if (sortBy === 'name') return String(a.summary || '').localeCompare(String(b.summary || ''))
        return byStart
      })
  }, [plan.projects, q, fPic, fState, ours, onlyActive, activeKeys, sortBy])

  /*
   * ONE BAR PER TICKET.
   *
   * The register is allowed more than one line for the same epic, and it is
   * right that it is: FNP-1151 is carried as three lines because it delivers
   * three separate savings, and they are costed, credited and reported apart.
   * A TIMELINE is not about any of that. It is about when one piece of work
   * runs, and one piece of work drawn three times is a chart that lies about
   * how much is going on.
   *
   * So the lines are collapsed onto the ticket they share. The hours are added
   * up and the objectives listed, because a reader looking at the collapsed row
   * should see everything the lines it stands for were carrying — and every
   * register line behind it is kept, so editing a date from here moves all of
   * them rather than silently splitting the group apart.
   */
  const grouped = useMemo(() => {
    const out = []
    const at = new Map()
    for (const p of rows) {
      const key = String(p.jiraKey || '').trim().toUpperCase()
      // No ticket: nothing to collapse onto, and two register rows with no key
      // are two different pieces of work as far as anything here can tell.
      if (!key) { out.push({ ...p, projectKeys: [p.key], lines: 1 }); continue }
      const seen = at.get(key)
      if (!seen) {
        const row = {
          ...p, projectKeys: [p.key], lines: 1, objectiveIds: p.objective ? [p.objective] : [],
        }
        at.set(key, row)
        out.push(row)
        continue
      }
      seen.lines += 1
      seen.projectKeys.push(p.key)
      seen.savingHours = (seen.savingHours || 0) + (p.savingHours || 0)
      if (p.objective && !seen.objectiveIds.includes(p.objective)) seen.objectiveIds.push(p.objective)
      /*
       * The dates come from whichever line actually has a plan. A row added by
       * a sync before somebody had matched it to the register line that owns
       * the work carries no dates at all, and letting it win would blank the
       * bar for a project that has one.
       */
      const better = (!seen.timeline.plannedEnd && p.timeline.plannedEnd)
        || (!seen.timeline.plannedStart && p.timeline.plannedStart)
      if (better) {
        seen.timeline = p.timeline
        seen.due = p.due
        seen.start = p.start
        seen.actualEndPinned = p.actualEndPinned
      }
    }
    return out
  }, [rows])

  /*
   * The calendar the bars are drawn on, taken from the dates actually present
   * rather than assumed to be the plan year: a project that started in
   * December 2025 or runs into 2027 has to be visible, not clipped to keep the
   * grid tidy.
   */
  const span = useMemo(() => {
    const all = []
    for (const p of grouped) {
      const tl = p.timeline
      for (const d of [tl.plannedStart, tl.plannedEnd, tl.actualStart, tl.actualEnd, weeklyOf(p.projectKeys).forecast]) {
        if (isDate(d)) all.push(at(d))
      }
    }
    const year = Number((asOf || '2026-01-01').slice(0, 4))
    all.push(at(`${year}-01-01`), at(`${year}-12-31`))
    const min = Math.min(...all)
    const max = Math.max(...all)
    const pad = Math.max(DAY * 7, (max - min) * 0.02)
    return { from: min - pad, to: max + pad }
  }, [rows, asOf, weekly])

  /*
   * Months, weeks or days.
   *
   * A year across a screen answers "did this land in Q3". It cannot answer
   * "which week did it slip into", because a week is four pixels wide. So the
   * finer scales stop fitting the year into the width and give each unit a
   * real size instead, and the calendar scrolls sideways underneath a project
   * column that stays put.
   */
  const PER_UNIT = { month: 0, week: 46, day: 26 }
  const days = Math.max(1, Math.round((span.to - span.from) / DAY))
  // The month view fits the width it is given — unless that leaves the bars
  // too little room beside the pinned columns, when it keeps a floor and
  // scrolls instead (a phone, or a tablet with the menu open).
  const MONTH_MIN = 560
  const trackPx = scale === 'month'
    ? (phone || (boxW > 0 && boxW - PINNED_W < MONTH_MIN) ? MONTH_MIN : null)
    : Math.max(720, Math.round(days * (scale === 'day' ? PER_UNIT.day : PER_UNIT.week / 7)))

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

  /*
   * The gridlines, at whatever interval the scale asks for.
   *
   * `strong` marks the line worth seeing at a glance — the first of the month
   * on the finer scales — so a day view still reads as a calendar rather than
   * as three hundred identical stripes.
   */
  const ticks = useMemo(() => {
    const out = []
    const d = new Date(span.from)
    d.setUTCHours(0, 0, 0, 0)

    if (scale === 'month') {
      d.setUTCDate(1)
      for (let i = 0; i < 120 && d.getTime() <= span.to; i++) {
        const ms = d.getTime()
        if (ms >= span.from) {
          out.push({
            ms,
            // January is the year itself: "Jan 26" did not fit a month's width,
            // and clipped to "Jan 2" it read as a date.
            label: d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : MONTHS[d.getUTCMonth()],
            strong: d.getUTCMonth() === 0,
          })
        }
        d.setUTCMonth(d.getUTCMonth() + 1)
      }
      return out
    }

    if (scale === 'week') {
      // Back to the Monday on or before the start: a week that begins midweek
      // is not a week anybody reads.
      const back = (d.getUTCDay() + 6) % 7
      d.setUTCDate(d.getUTCDate() - back)
      for (let i = 0; i < 400 && d.getTime() <= span.to; i++) {
        const ms = d.getTime()
        if (ms >= span.from) {
          out.push({
            ms,
            label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
            strong: d.getUTCDate() <= 7,
          })
        }
        d.setUTCDate(d.getUTCDate() + 7)
      }
      return out
    }

    for (let i = 0; i < 1200 && d.getTime() <= span.to; i++) {
      const ms = d.getTime()
      const dow = d.getUTCDay()
      if (ms >= span.from) {
        out.push({
          ms,
          label: String(d.getUTCDate()),
          strong: d.getUTCDate() === 1,
          // Saturdays and Sundays, shaded: a four-day overrun that swallowed a
          // weekend is a different story from one that did not.
          weekend: dow === 0 || dow === 6,
          width: DAY,
        })
      }
      d.setUTCDate(d.getUTCDate() + 1)
    }
    return out
  }, [span, scale])

  /*
   * Scrolled to today whenever the scale changes.
   *
   * A day view of a fourteen-month span is nine thousand pixels wide, and it
   * opens on the first of January — five thousand pixels from anything anybody
   * wanted to look at. Landing on today is the only sane starting point.
   */
  const toToday = (smooth = false) => {
    const el = scrollRef.current
    if (!el || (scale === 'month' && !trackPx)) return
    const width = el.scrollWidth - el.clientWidth
    if (width <= 0) return
    const at01 = (pct(at(asOf)) / 100) * (el.scrollWidth - PINNED_W)
    el.scrollTo({ left: Math.max(0, Math.min(width, at01 - el.clientWidth / 2)), behavior: smooth ? 'smooth' : 'auto' })
  }
  useEffect(() => { toToday() }, [scale, asOf, span.from, span.to, trackPx, PINNED_W])

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
  function RowGroup({ row, depth, parentPlan }) {
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
     * Most tasks on this board carry no due date at all — thirty-one of the
     * forty under one epic. Drawn strictly they get an outcome bar and nothing
     * to read it against, which makes the row useless for the one question the
     * chart asks.
     *
     * So the epic's planned finish is drawn behind them, dashed, as a
     * reference. It is NOT the task's plan and is never treated as one: no
     * slip is computed from it, nothing is counted against it, and the tooltip
     * says whose date it is. A borrowed deadline shown as a borrowed deadline
     * is information; the same line drawn solid would be a commitment nobody
     * made.
     */
    const inherited = !tl.plannedEnd && parentPlan?.end && (tl.actualStart || tl.actualEnd)
      ? bar(tl.actualStart || parentPlan.start, parentPlan.end)
      : null

    /*
     * THE ADJUSTED TIMELINE — project rows only.
     *
     * When another team holds a project up, a task is raised for it carrying a
     * date past the project's own. This bar runs to that date: where the work
     * now lands, drawn beside the plan rather than replacing it, so the
     * commitment and the adjustment can both be read at once.
     *
     * Not on task rows. A task IS the thing that moved the date; giving it an
     * adjusted bar of its own would only restate its own due date.
     */
    const adjusted = depth === 0 && tl.adjustedEnd ? bar(plannedLeft, tl.adjustedEnd) : null
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
    /*
     * AND ONLY WHERE THERE IS AN OUTCOME TO DRAW.
     *
     * Because the bar is drawn from the PLANNED start, a project nobody has
     * touched still had two real dates to hand — the plan's — and drew a sliver
     * of an "actual" bar whose own tooltip read "Actually ran — to —". A bar
     * that says it does not know when the work ran is not evidence of work; it
     * is the absence of it, and it belongs on no chart.
     *
     * The evidence is the register's, not the drawing's: a real start, a real
     * finish, or a status that says it is in flight.
     */
    const happened = !!tl.actualStart || !!tl.actualEnd || !!tl.running
    const actual = happened ? bar(drawnStart, finished) : null
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
    const canEdit = !readOnly && (!!row.projectKey || (!!row.jiraKey && !!jira?.writable))
    const isOpen = open.has(key)
    const under = kids.get(key)
    // The check-ins, on project rows only: Jira tasks underneath have none.
    const wk = depth === 0 ? weeklyOf(row.projectKeys) : null
    const forecast = wk?.forecast && tl.plannedEnd && wk.forecast > tl.plannedEnd ? bar(tl.plannedEnd, wk.forecast) : null
    const lit = depth === 0 && flash && (row.projectKeys || []).includes(flash)

    return (
      <>
        <Box
          data-keys={depth === 0 ? (row.projectKeys || []).join(' ') : undefined}
          sx={{
            display: 'flex',
            alignItems: 'center',
            minHeight: depth ? KID_H : ROW_H,
            borderBottom: 1,
            borderColor: 'divider',
            opacity: row.outsideTeam ? 0.6 : 1,
            bgcolor: lit ? (t) => alpha(t.palette.primary.main, 0.22) : depth ? 'action.hover' : undefined,
            boxShadow: lit ? (t) => `inset 3px 0 0 ${t.palette.primary.main}` : undefined,
            transition: 'background-color .4s',
            '&:hover': { bgcolor: 'action.selected' },
          }}
        >
          <Box sx={{
            width: NAME_W,
            flexShrink: 0,
            alignSelf: 'stretch',
            px: 1,
            py: 0.25,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            pl: 0.75 + depth * 2,
            // Pinned: the calendar slides underneath it on the finer scales,
            // and a bar with no name against it is a bar nobody can use.
            position: 'sticky',
            left: 0,
            bgcolor: depth ? 'background.default' : 'background.paper',
            zIndex: 1,
          }}
          >
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
            <Box
              sx={{ overflow: 'hidden', flex: 1, cursor: depth === 0 ? 'pointer' : 'default' }}
              // A project's name opens what the weekly check-ins say about it.
              onClick={depth === 0 ? () => setStory(row) : undefined}
              role={depth === 0 ? 'button' : undefined}
              aria-label={depth === 0 ? `weekly updates for ${row.jiraKey || row.projectKey}` : undefined}
            >
              <Typography variant="body2" noWrap title={row.title} sx={{ fontSize: depth ? '0.72rem' : '0.78rem', fontWeight: depth ? 400 : 600, lineHeight: 1.3 }}>
                {row.title}
              </Typography>
              <Typography variant="caption" noWrap title={row.sub} sx={{ color: 'text.secondary', display: 'block', fontSize: '0.65rem', lineHeight: 1.3 }}>
                {row.sub}
              </Typography>
            </Box>
            {/* The markers: something is blocking it, or it is asking to move. */}
            {wk?.blockers.length > 0 && (
              <Tooltip title={`${wk.blockers.length} open blocker${wk.blockers.length === 1 ? '' : 's'} from the weekly check-in — click the name to read`}>
                <ReportProblemIcon aria-label="blocked" sx={{ fontSize: 16, color: STATUS.warning, flexShrink: 0 }} />
              </Tooltip>
            )}
            {wk?.pending.length > 0 && (
              <Tooltip title={`${wk.pending.length} date change${wk.pending.length === 1 ? '' : 's'} waiting for approval`}>
                <HourglassIcon aria-label="date change waiting" sx={{ fontSize: 16, color: FORECAST, flexShrink: 0 }} />
              </Tooltip>
            )}
            {/* ACTIVE: by its dates, or an administrator's override, on every
                register line behind the bar at once — the same work, so the
                same answer. */}
            {depth === 0 && row.projectKeys?.length > 0 && !readOnly && (
              <ActiveControl
                projects={row.projectKeys.map((k) => projectOf[k])}
                week={thisWeek}
                signals={signals}
                label={`active ${row.jiraKey || row.projectKey}`}
                // Narrow, the column has no room for the word as well as the name.
                size={narrow ? 'dot' : 'small'}
                onSet={(v) => row.projectKeys.forEach((k) => onUpdate(k, { active: v }))}
              />
            )}
          </Box>

          <Box sx={{
            position: 'relative',
            flex: trackPx ? 'none' : 1,
            width: trackPx || 'auto',
            // The full height of the row, so gridlines and the today line run
            // unbroken from one row into the next.
            alignSelf: 'stretch',
            minHeight: depth ? KID_H - 1 : ROW_H - 1,
          }}
          >
            {ticks.map((tk) => (
              <Box
                key={tk.ms}
                sx={{
                  position: 'absolute',
                  left: `${pct(tk.ms)}%`,
                  width: tk.weekend ? `${(tk.width / (span.to - span.from)) * 100}%` : undefined,
                  top: 0,
                  bottom: 0,
                  borderLeft: tk.strong ? 2 : 1,
                  borderColor: tk.strong ? 'text.disabled' : 'divider',
                  opacity: tk.strong ? 0.55 : 0.4,
                  // Weekends shaded on the day scale: an overrun that swallowed
                  // a weekend is a different story from one that did not.
                  bgcolor: tk.weekend ? 'action.hover' : undefined,
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
            {inherited && (
              <Tooltip title={`No due date on this one. Dashed line is ${parentPlan.ownerKey || 'its epic'}’s planned finish (${parentPlan.end}), shown for reference only — nothing is measured against it.`}>
                <Box sx={{
                  position: 'absolute',
                  left: `${inherited.left}%`,
                  width: `${inherited.width}%`,
                  top: depth ? 4 : 6,
                  height: depth ? 7 : 9,
                  borderRadius: 0.5,
                  border: '1px dashed',
                  borderColor: 'text.disabled',
                  opacity: 0.55,
                }}
                />
              </Tooltip>
            )}
            {adjusted && (
              <Tooltip title={`Adjusted to ${tl.adjustedEnd} — ${tl.adjustedBy} days past the committed `
                + `${tl.plannedEnd}. From ${tl.adjustedCause || 'a task'} underneath, marked as a delay caused `
                + 'elsewhere. The commitment itself has not moved.'}
              >
                <Box sx={{
                  position: 'absolute',
                  left: `${adjusted.left}%`,
                  width: `${adjusted.width}%`,
                  top: 12,
                  height: 5,
                  borderRadius: 0.5,
                  bgcolor: STATUS.warning,
                  opacity: 0.8,
                }}
                />
              </Tooltip>
            )}
            {forecast && (
              <Tooltip title={`Asked to move to ${wk.forecast} — waiting for approval. Drawn from the committed `
                + `${tl.plannedEnd}; the commitment itself has not moved.`}
              >
                <Box
                  aria-label="forecast"
                  onClick={() => setStory(row)}
                  sx={{
                    position: 'absolute',
                    left: `${forecast.left}%`,
                    width: `${forecast.width}%`,
                    top: 6,
                    height: 9,
                    borderRadius: 0.5,
                    border: `1.5px dashed ${FORECAST}`,
                    bgcolor: alpha(FORECAST, 0.18),
                    cursor: 'pointer',
                  }}
                />
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
                  whiteSpace: 'nowrap',
                  color: tl.running ? STATUS.warning : 'text.disabled',
                }}
              >
                {/*
                  * Three different silences, and they are not the same thing:
                  * work under way has no finish YET, work never begun has no
                  * start, and a row nobody has reported on has neither.
                  */}
                {tl.running
                  ? `in progress since ${tl.actualStart}`
                  : tl.state === 'finished'
                    ? 'done — no finish date recorded'
                    : tl.actualStart
                      ? 'started, not finished'
                      : tl.tasksDone > 0
                        ? `${tl.tasksDone} of ${tl.tasksTotal} tasks done`
                        : 'not started'}
              </Typography>
            )}
          </Box>

          <Box sx={{
            width: SLIP_W,
            flexShrink: 0,
            px: 1,
            alignSelf: 'stretch',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            position: 'sticky',
            right: 0,
            bgcolor: depth ? 'background.default' : 'background.paper',
            zIndex: 1,
          }}
          >
            {tl.lateBy == null ? (
              <Typography variant="caption" sx={{ color: 'text.disabled' }}>—</Typography>
            ) : (
              <Chip
                size="small"
                label={tl.lateBy > 0 ? `+${tl.lateBy}d` : `${tl.lateBy}d`}
                variant="outlined"
                sx={{
                  height: 18,
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  '& .MuiChip-label': { px: 0.75 },
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
              <RowGroup
                key={issue.key}
                row={asRow(issue)}
                depth={depth + 1}
                parentPlan={{ start: tl.plannedStart, end: tl.plannedEnd, ownerKey: row.jiraKey }}
              />
            ))
          )
        )}
      </>
    )
  }

  /*
   * THE FIGURES, AS ONE LINE. They used to be a card of big numbers that
   * pushed the chart below the fold; they are a caption to the chart, not a
   * dashboard of their own. Each still says what it counts when hovered.
   */
  const stat = (key, value, label, tip, tone) => (
    <Tooltip key={key} title={tip}>
      <Box component="span" data-stat={key} sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.5, whiteSpace: 'nowrap', cursor: 'default' }}>
        <Typography component="span" sx={{ fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.4, color: tone || 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </Typography>
        <Typography component="span" variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>{label}</Typography>
      </Box>
    </Tooltip>
  )
  /*
   * The figures follow the search box and the filters: they describe the bars
   * on screen, and the line says whether that is everything or a part of it.
   */
  const filtering = !!q.trim() || fPic !== 'all' || fState !== 'all' || !ours || onlyActive
  // Undated projects are never on the chart; how many there are is the register's figure.
  const t = { ...timelinessOf(rows), noDates: filtering ? 0 : plan.totals.timeliness.noDates }
  const stats = [
    <Typography key="scope" component="span" variant="caption" data-stat-scope={filtering ? 'filtered' : 'all'} sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
      {filtering ? 'Of those shown:' : 'All projects:'}
    </Typography>,
    stat('planned', t.planned, 'planned', 'With a plan: a start or a due date on the register'),
    stat('finished', t.finished, 'finished', 'Finished, with a date to say when', t.finished ? STATUS.good : undefined),
    stat('running', t.running, 'running', 'Started and not yet finished'),
    stat('overdue', t.overdue, 'past due', 'Past due, unfinished: the due date has gone by and nothing says it landed',
      t.overdue ? STATUS.critical : undefined),
    stat('ontime', `${t.onTime}/${t.judged}`, 'on time',
      `${t.onTime} of the ${t.judged} judged against a date landed on time. A project is judged once it has a due date `
        + 'and either a finish or a date already gone past.', t.onTime ? STATUS.good : 'text.secondary'),
    stat('slip', t.avgSlip == null ? '—' : `${t.avgSlip}d`, 'avg slip', 'Average slip, over the late ones only',
      t.avgSlip ? STATUS.warning : undefined),
    t.noDates > 0 ? stat('undated', t.noDates, 'undated', 'No dates at all, so not on the chart', 'text.disabled') : null,
  ].filter(Boolean)

  // Narrow, how many filters are away from their defaults — on the button
  // that hides them, so a short list is never a mystery.
  const changed = [fPic !== 'all', fState !== 'all', !ours, onlyActive, sortBy !== 'start'].filter(Boolean).length

  // Small, quiet controls: a toolbar, not a form.
  const jiraBtn = { fontSize: '0.75rem', px: 1, minWidth: 0 }
  const dense = { '& .MuiInputBase-input': { py: 0.6, fontSize: '0.8rem' }, '& .MuiInputLabel-root': { fontSize: '0.8rem' } }
  const switchLabel = { m: 0, gap: 0.25, '& .MuiFormControlLabel-label': { fontSize: '0.8rem', whiteSpace: 'nowrap' } }
  const filters = (
    <>
      <FormControl size="small" sx={{ minWidth: { xs: 0, sm: 120 }, flex: { xs: '1 1 140px', sm: 'none' }, ...dense }}>
        <InputLabel>PIC</InputLabel>
        <Select label="PIC" value={fPic} onChange={(e) => setFPic(e.target.value)}>
          {picks.map((p) => <MenuItem key={p.id} value={p.id}>{p.nick}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: { xs: 0, sm: 150 }, flex: { xs: '1 1 160px', sm: 'none' }, ...dense }}>
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
      <FormControl size="small" sx={{ minWidth: { xs: 0, sm: 130 }, flex: { xs: '1 1 140px', sm: 'none' }, ...dense }}>
        <InputLabel>Sort</InputLabel>
        <Select label="Sort" value={sortBy} onChange={(e) => setSortBy(e.target.value)} data-timeline-sort>
          <MenuItem value="start">Start date</MenuItem>
          <MenuItem value="late">Most late first</MenuItem>
          <MenuItem value="due">Due soonest</MenuItem>
          <MenuItem value="name">Name A–Z</MenuItem>
        </Select>
      </FormControl>
      <FormControlLabel
        sx={switchLabel}
        control={<Switch size="small" checked={ours} onChange={(e) => setOurs(e.target.checked)} />}
        label="Ours only"
      />
      <FormControlLabel
        sx={switchLabel}
        control={<Switch size="small" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} inputProps={{ 'aria-label': 'active projects only' }} />}
        label={(
          <Tooltip title="Active this week: its dates cover this week, Jira work under it does, somebody sent an update on it this week, or a decision on it is open — or an administrator set it to always active">
            <span>Active only ({activeList.length})</span>
          </Tooltip>
        )}
      />
    </>
  )

  return (
    <Box ref={rootRef} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, minWidth: 0 }}>
      {/* One line: what the page is, and — for an administrator — Jira. */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', columnGap: 1.25, flexWrap: 'wrap' }}>
            <Typography variant="h3" component="h1">Timeline</Typography>
            {/* On a phone the legend under the chart says the same, and the room is the chart's. */}
            <Typography variant="caption" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'inline' } }}>
              What was planned, and what actually happened. The outline is the plan; the solid bar is the outcome. The
              gap between their right-hand edges is the slip.
            </Typography>
          </Box>
          {/* A team member's: which projects these are, or why there are none. */}
          {note && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{note}</Typography>
          )}
        </Box>
        {/* Reading Jira into the plan, or syncing it for everyone, changes the
            shared plan — an administrator's job. A team member reads. */}
        {!readOnly && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', ml: 'auto' }}>
          {/* Which Jira, and as whom, is in the buttons' tooltips rather than a line of its own. */}
          {jira == null && <Loading label="Checking Jira…" />}
          <Button
            size="small"
            variant="outlined"
            startIcon={narrow ? null : <PlaylistAddIcon />}
            sx={narrow ? jiraBtn : undefined}
            disabled={!jira?.configured || finding}
            onClick={findNew}
          >
            {finding ? 'Looking…' : 'Find new epics'}
          </Button>
          <Tooltip title={`Reads Jira${jira?.configured ? ` (${jira.site?.replace(/^https?:\/\//, '')} as ${jira.account})` : ''} and updates YOUR copy of the register. Nobody else sees it until you save.`}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={narrow ? null : <SyncIcon />}
                sx={narrow ? jiraBtn : undefined}
                disabled={!jira?.configured || syncing || sharing}
                onClick={sync}
              >
                {syncing ? 'Reading Jira…' : 'Sync with Jira'}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={`Runs the same sync on the server against the SHARED plan — the one everybody loads. This is what the 07:00 job does every morning.${jira?.configured ? ` Reads ${jira.site?.replace(/^https?:\/\//, '')} as ${jira.account}.` : ''}`}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={narrow ? null : <SyncIcon />}
                sx={narrow ? jiraBtn : undefined}
                disabled={!jira?.configured || syncing || sharing}
                onClick={syncShared}
              >
                {sharing ? 'Syncing for everyone…' : 'Sync for everyone'}
              </Button>
            </span>
          </Tooltip>
        </Box>
        )}
      </Box>
      {syncing && <LinearProgress />}
      {syncNote && (
        <Alert severity={syncNote.severity} onClose={() => setSyncNote(null)}>
          {syncNote.text}
          {/* Where the change landed, and who can see it. A sync that says
              "3 projects updated" and nothing about whose copy they are in is
              how one person watches a bar appear and a colleague opening the
              same app sees nothing. */}
          {syncNote.note && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.9 }}>
              {syncNote.note}
            </Typography>
          )}
        </Alert>
      )}
      {jira && !jira.configured && (
        <Alert severity="info" sx={{ py: 0, '& .MuiAlert-message': { fontSize: '0.8rem' } }}>
          Jira is not connected on the server, so actual dates have to be typed in by hand. To connect it, set{' '}
          <strong>JIRA_BASE_URL</strong>, <strong>JIRA_EMAIL</strong> and <strong>JIRA_API_TOKEN</strong> in the Render
          dashboard under Environment — the token stays on the server and is never sent to this page.
        </Alert>
      )}

      {/* THE TOOLBAR: search, filters, and the scale, in one row that wraps. */}
      <Paper
        variant="outlined"
        data-timeline="filters"
        sx={{ px: 1, py: 0.75, display: 'flex', gap: 1, rowGap: 0.75, flexWrap: 'wrap', alignItems: 'center', borderRadius: 2.5 }}
      >
        <TextField
          size="small"
          placeholder="Search key, project, programme"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ flex: '1 1 160px', maxWidth: { sm: 280 }, minWidth: 0, ...dense }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment> }}
        />
        {narrow ? (
          <Button
            size="small"
            variant="outlined"
            color={showFilters || changed ? 'primary' : 'inherit'}
            startIcon={<FilterListIcon />}
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            sx={{ flexShrink: 0, borderColor: 'divider' }}
          >
            Filters{changed ? ` (${changed})` : ''}
          </Button>
        ) : filters}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={scale}
          onChange={(_e, v) => v && setScale(v)}
          sx={{ '& .MuiToggleButton-root': { py: 0.4, px: 1.25, fontSize: '0.75rem', lineHeight: 1.4 } }}
        >
          <ToggleButton value="day">Day</ToggleButton>
          <ToggleButton value="week">Week</ToggleButton>
          <ToggleButton value="month">Month</ToggleButton>
        </ToggleButtonGroup>
        <Button size="small" variant="outlined" onClick={() => toToday(true)} sx={{ flexShrink: 0, borderColor: 'divider', py: 0.3 }} data-timeline-today>
          Today
        </Button>
        {narrow && (
          <Collapse in={showFilters} sx={{ flexBasis: '100%' }}>
            <Box sx={{ display: 'flex', gap: 1, rowGap: 1, flexWrap: 'wrap', alignItems: 'center', pt: 0.5 }}>
              {filters}
            </Box>
          </Collapse>
        )}
      </Paper>

      {/* THE FIGURES: one quiet line, with how many bars the filters left. */}
      <Box
        data-timeline="summary"
        sx={{ display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 0.25, flexWrap: 'wrap', px: 0.5 }}
      >
        {stats}
        <Box sx={{ flex: 1 }} />
        {/* The key, on the same line: what each mark means. Full key at the bottom. */}
        <Box data-timeline="key" sx={{ display: 'flex', alignItems: 'center', columnGap: 1.5, rowGap: 0.25, flexWrap: 'wrap' }}>
          {[
            { el: <Box sx={{ width: 22, height: 8, border: 1, borderColor: 'text.disabled', borderRadius: 0.5 }} />, label: 'Plan' },
            { el: <Box sx={{ width: 22, height: 8, bgcolor: STATUS.good, borderRadius: 0.5 }} />, label: 'Finished on time' },
            { el: <Box sx={{ width: 22, height: 8, bgcolor: CHART[mode].series[0], borderRadius: 0.5 }} />, label: 'Running' },
            { el: <Box sx={{ width: 22, height: 8, bgcolor: AHEAD, borderRadius: 0.5 }} />, label: 'Finished early' },
            { el: <Box sx={{ width: 22, height: 8, bgcolor: STATUS.critical, borderRadius: 0.5 }} />, label: 'Late' },
            {
              el: <Box sx={{ width: 22, height: 8, borderRadius: 0.5, border: 1, borderColor: STATUS.critical, backgroundImage: `repeating-linear-gradient(45deg, ${STATUS.critical}, ${STATUS.critical} 3px, transparent 3px, transparent 6px)` }} />,
              label: 'Days of slip',
            },
            { el: <Box sx={{ width: 2, height: 12, bgcolor: STATUS.warning }} />, label: 'Today' },
          ].map((k) => (
            <Box key={k.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              {k.el}
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{k.label}</Typography>
            </Box>
          ))}
        </Box>

        {!weeklyIn && <Loading label="Loading check-ins…" />}
        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
          {/* The count is of BARS, which after collapsing is the number of
              pieces of work — not the number of register lines behind them. */}
          {grouped.length} project{grouped.length === 1 ? '' : 's'} on the chart
          {grouped.length !== rows.length && ` · ${rows.length} register lines`}
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ overflow: 'hidden', borderRadius: 2.5 }}>
        <Box
          ref={scrollRef}
          data-timeline="chart"
          sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: fitH ? `${fitH}px` : '70vh' }}
        >
          <Box sx={{ minWidth: trackPx ? trackPx + PINNED_W : 'auto' }}>
            <Box sx={{
              display: 'flex',
              borderBottom: 1,
              borderColor: 'divider',
              // Opaque, so rows scrolling underneath the pinned header do not
              // show through it.
              bgcolor: 'background.paper',
              backgroundImage: (th) => `linear-gradient(${th.palette.action.hover}, ${th.palette.action.hover})`,
              position: 'sticky',
              top: 0,
              zIndex: 3,
            }}
            >
              <Box sx={{
                width: NAME_W,
                flexShrink: 0,
                px: 1.5,
                py: 0.5,
                position: 'sticky',
                left: 0,
                bgcolor: 'background.paper',
                zIndex: 2,
              }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700 }}>PROJECT</Typography>
              </Box>
              <Box sx={{ position: 'relative', flex: trackPx ? 'none' : 1, width: trackPx || 'auto', height: 26 }}>
                {ticks.map((tk, i) => (
                  <Box
                    key={tk.ms}
                    sx={{
                      position: 'absolute',
                      left: `${pct(tk.ms)}%`,
                      // As wide as its month and no wider, so a long label
                      // ("Jan 26") is clipped rather than run into the next.
                      width: ticks[i + 1] ? `${pct(ticks[i + 1].ms) - pct(tk.ms)}%` : undefined,
                      top: 0,
                      bottom: 0,
                      borderLeft: tk.strong ? 2 : 1,
                      borderColor: tk.strong ? 'text.disabled' : 'divider',
                      pl: 0.4,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        color: tk.strong ? 'text.primary' : 'text.secondary',
                        fontSize: '0.62rem',
                        fontWeight: tk.strong ? 700 : 400,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tk.label}
                    </Typography>
                  </Box>
                ))}
                {/* Where today falls, named, so the orange line needs no legend. */}
                <Box
                  data-timeline-today-label
                  sx={{
                    position: 'absolute', left: `${pct(at(asOf))}%`, top: 2, transform: 'translateX(-50%)', zIndex: 1,
                    px: 0.6, borderRadius: 1, border: 1, borderColor: STATUS.warning, bgcolor: 'background.paper', pointerEvents: 'none',
                  }}
                >
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 700, color: STATUS.warning, lineHeight: 1.6, display: 'block' }}>Today</Typography>
                </Box>
              </Box>
              <Box sx={{
                width: SLIP_W,
                flexShrink: 0,
                px: 1,
                py: 0.5,
                textAlign: 'right',
                position: 'sticky',
                right: 0,
                bgcolor: 'background.paper',
                zIndex: 2,
              }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700 }}>SLIP</Typography>
              </Box>
            </Box>

            <Box>
          {grouped.map((p) => (
            <RowGroup
              key={p.key}
              row={{
                rowKey: p.key,
                projectKey: p.key,
                // Every register line this bar stands for. A date edited here
                // moves all of them: they are one piece of work in Jira, and a
                // group that can be split in half by one edit is worse than no
                // grouping at all.
                projectKeys: p.projectKeys || [p.key],
                jiraKey: p.jiraKey,
                title: p.summary,
                sub: [
                  p.jiraKey || null,
                  // Every objective the collapsed lines serve, not just the
                  // first one's.
                  (p.objectiveIds || [p.objective]).filter(Boolean).map((id) => (OBJ_BY_ID[id] ? `Obj ${OBJ_BY_ID[id].no}` : null))
                    .filter(Boolean).join(' + ') || null,
                  p.savingHours ? `${fmtHours(p.savingHours)} hrs/mth` : null,
                  // Said out loud, so a reader can go and find the lines rather
                  // than wonder why the hours do not match the register.
                  p.lines > 1 ? `${p.lines} register lines` : null,
                  // Said on the row, not only in the editor: a date the sync
                  // cannot touch is something a reader has to be able to see
                  // without opening anything.
                  p.actualEndPinned ? 'finish held' : null,
                ].filter(Boolean).join(' · '),
                timeline: p.timeline,
                actualEndPinned: p.actualEndPinned,
                outsideTeam: p.outsideTeam,
              }}
              depth={0}
            />
          ))}
              {grouped.length === 0 && (
                <Box sx={{ p: 4, textAlign: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Nothing matches that filter.
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        </Box>
      </Paper>

      {/*
        * A PROJECT'S WEEKLY STORY: what is waiting to be decided, what is in
        * the way, and the last eight weeks of tasks against it, newest first.
        */}
      <Dialog open={!!story} onClose={() => setStory(null)} maxWidth="sm" fullWidth>
        {story && (() => {
          const wk = weeklyOf(story.projectKeys)
          const byWeek = {}
          for (const h of wk.history) (byWeek[h.week] = byWeek[h.week] || []).push(h)
          const weeks = Object.keys(byWeek).sort().reverse()
          /*
           * Every decision, including the ones a later date reopened: an
           * approval that was asked again is still something that happened
           * to this project, and the reason it was asked again.
           */
          const decided = wk.proposals.flatMap((p) => [
            ...(p.earlier || []).map((e, i) => ({ ...p, ...e, id: `${p.id}:${i}` })),
            ...(p.status === 'approved' || p.status === 'rejected' ? [p] : []),
          ])
          return (
            <>
              <DialogTitle sx={{ pb: 0.5 }}>
                {story.title}
                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                  {[story.jiraKey, `due ${fmtD(story.timeline.plannedEnd)}`].filter(Boolean).join(' · ')}
                  {readOnly ? ' · only your own weeks are shown' : ' · the weekly check-ins, last eight weeks'}
                </Typography>
              </DialogTitle>
              <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {wk.pending.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Waiting for approval</Typography>
                    {wk.pending.map((p) => (
                      <Box key={p.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1 }}>
                        <Pill label={p.proposedDue ? `to ${fmtD(p.proposedDue)}` : 'date to pick'} tone="violet" />
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          <strong>{p.nick}</strong> · {p.taskTitle}
                          {p.blocker ? <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>{p.blocker}</Typography> : null}
                        </Typography>
                      </Box>
                    ))}
                    {!readOnly && onOpenWeekly && (
                      <Button size="small" variant="contained" onClick={() => { setStory(null); onOpenWeekly() }}>Decide on the Weekly page</Button>
                    )}
                  </Box>
                )}
                {wk.blockers.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>In the way</Typography>
                    {wk.blockers.map((b) => (
                      <Box key={`${b.week}${b.person}${b.title}`} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mb: 1 }}>
                        <Pill label={CATEGORY_LABEL[b.blockerCategory] || 'blocked'} tone="warn" />
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          <strong>{b.nick}</strong> · {b.title}
                          <Typography component="span" variant="caption" sx={{ display: 'block', color: 'text.secondary', whiteSpace: 'pre-wrap' }}>
                            {b.blocker} · new date {fmtD(b.newDate)}
                          </Typography>
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
                {decided.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>Decided</Typography>
                    {decided.map((p) => (
                      <Box key={p.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 0.75, flexWrap: 'wrap' }}>
                        <Pill label={PROPOSAL_LABEL[p.status]} tone={PROPOSAL_TONE[p.status]} />
                        <Typography variant="caption">
                          {p.status === 'approved'
                            ? `${fmtD(p.fromDue)} → ${fmtD(p.decidedDue)} for ${p.nick}'s “${p.taskTitle}”`
                            : `${p.nick}'s ${fmtD(p.newDate)} — “${p.reason}”`}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                )}
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>Week by week</Typography>
                  {weeks.length === 0 && (
                    <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                      Nobody has put a task against this project in a weekly check-in yet.
                    </Typography>
                  )}
                  {weeks.map((w) => (
                    <Box key={w} sx={{ mb: 1.25 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>{weekTitle(w)}</Typography>
                      {byWeek[w].map((h) => (
                        <Box key={`${h.person}${h.title}`} sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, flexWrap: 'wrap' }}>
                          <Pill
                            label={h.done === true ? 'finished' : h.done === false ? `${h.pct ?? '?'}%` : 'planned'}
                            tone={h.done === true ? 'good' : h.done === false ? 'warn' : 'neutral'}
                          />
                          <Typography variant="body2" sx={{ flex: '1 1 200px' }}>
                            <strong>{h.nick}</strong> · {h.title}
                            <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                              {h.done === false && h.newDate ? ` · now ${fmtD(h.newDate)}` : h.expected ? ` · expected ${fmtD(h.expected)}` : ''}
                            </Typography>
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  ))}
                </Box>
              </DialogContent>
              <DialogActions><Button onClick={() => setStory(null)}>Close</Button></DialogActions>
            </>
          )
        })()}
      </Dialog>

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
        {editing && (
          <PlanEditor row={editing.row} onSave={savePlan} onHold={holdFinish} saving={saving} jira={jira} />
        )}
      </Popover>

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, borderRadius: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>How to read it</Typography>
        <Box sx={{ display: 'flex', columnGap: 3, rowGap: 1, flexWrap: 'wrap', mb: 1.5 }}>
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
            <Box sx={{ width: 34, height: 5, borderRadius: 0.5, bgcolor: STATUS.warning, opacity: 0.8 }} />
            <Typography variant="caption">
              adjusted — where the work now lands, from the latest task date underneath
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 34, height: 9, borderRadius: 0.5, border: `1.5px dashed ${FORECAST}`, bgcolor: alpha(FORECAST, 0.18) }} />
            <Typography variant="caption">
              forecast — a new date asked for in a weekly report, waiting for approval
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ReportProblemIcon sx={{ fontSize: 16, color: STATUS.warning }} />
            <HourglassIcon sx={{ fontSize: 16, color: FORECAST }} />
            <Typography variant="caption">
              blocked, or a date change waiting — click a project&rsquo;s name for its weekly updates
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 34, height: 9, borderRadius: 0.5, border: '1px dashed', borderColor: 'text.disabled', opacity: 0.55 }} />
            <Typography variant="caption">its epic&rsquo;s deadline, borrowed — nothing is measured against it</Typography>
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
