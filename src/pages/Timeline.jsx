import {
  Fragment, useEffect, useMemo, useRef, useState,
} from 'react'
import {
  Box, Paper, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  FormControlLabel, Switch, Tooltip, InputAdornment, Button, Alert, useMediaQuery, Skeleton, Snackbar, Drawer,
  IconButton, CircularProgress, Popover, Divider, Dialog, DialogTitle, DialogContent,
  DialogActions, Checkbox, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Menu,
  ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import { useTheme, alpha, keyframes } from '@mui/material/styles'
import SearchIcon from '@mui/icons-material/Search'
import FilterListIcon from '@mui/icons-material/FilterList'
import SyncIcon from '@mui/icons-material/Sync'
import CloudSyncIcon from '@mui/icons-material/CloudSyncOutlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import EditCalendarIcon from '@mui/icons-material/EditCalendarOutlined'
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import CloseIcon from '@mui/icons-material/Close'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import ReportProblemIcon from '@mui/icons-material/ReportProblemOutlined'
import HourglassIcon from '@mui/icons-material/HourglassTopOutlined'
import * as api from '../lib/api.js'
import { mergeJira, JIRA_KEY } from '../lib/jiraMerge.js'
import { OBJ_BY_ID } from '../lib/palette.js'
import {
  fmtHours, isDate, timelineOf, pinFinishPatch, unpinFinishPatch, timelinessOf,
} from '../lib/model.js'
import { syncStatus } from '../lib/storage.js'
import { PageHeader, StatusPill } from '../components/ui.jsx'
import ActiveControl from '../dashboard/ActiveControl.jsx'
import { activitySignals, activeUnits } from '../lib/manager.js'
import { weekOf, weekTitle, PROPOSAL_LABEL, BLOCKER_CATEGORIES } from '../lib/weekly.js'

const CATEGORY_LABEL = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))
const fmtD = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–')
const fmtS = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '–')
const PROPOSAL_TONE = { pending: 'info', approved: 'success', rejected: 'danger', deciding: 'info' }
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// The typographic minus, so "−19d" reads as a number and not a dash.
const signed = (n) => (n > 0 ? `+${n}d` : n < 0 ? `−${Math.abs(n)}d` : '0d')

const DAY = 86400000
const at = (d) => Date.parse(`${d}T00:00:00Z`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An opaque mix of two hex colours: a tint a sticky cell can sit on without showing what scrolls beneath. */
const mix = (a, b, t) => {
  const p = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
  const [x, y] = [p(a), p(b)]
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`
}

/**
 * The two dates a plan is made of.
 *
 * Held as a draft and saved on purpose, rather than written on every
 * keystroke: a half-typed year is not a date, and this one is pushed to a real
 * ticket that other people are looking at.
 */
function PlanEditor({
  row, onSave, onHold, saving, jira,
}) {
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
    <Box sx={{ p: 4, width: 320, maxWidth: 'calc(100vw - 32px)' }}>
      <Typography variant="h3">Planned dates</Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 4 }}>
        {row.jiraKey
          ? (jira?.writable
            ? `Saved here and written to ${row.jiraKey}.`
            : `Saved here only. Writing to ${row.jiraKey} is switched off on the server.`)
          : 'Saved here. This row has no Jira key.'}
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <TextField
          size="small"
          fullWidth
          type="date"
          label="Planned start"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          InputLabelProps={{ shrink: true }}
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
          helperText={bad ? 'The finish is before the start.' : undefined}
        />
      </Box>
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
      <Divider sx={{ my: 4 }} />
      {canHold ? (
        <>
          <Typography variant="h3" sx={{ mb: 1 }}>Finish date</Typography>
          <FormControlLabel
            sx={{ ml: -1, mr: 0, mb: 1, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { pt: 1 } }}
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
            label={<Typography variant="body2">Hold it here, so the Jira sync leaves it alone</Typography>}
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
              sx={{ mt: 2 }}
            />
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Follows Jira: the day the last task under this project was resolved. Hold it only when that is not the
              day the work landed.
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Actual dates come from Jira and cannot be edited here. Jira stamps them when an issue is resolved.
        </Typography>
      )}
      <Box sx={{
        display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 5,
      }}
      >
        <Button variant="text" onClick={() => { setStart(''); setDue('') }} disabled={saving}>Clear both</Button>
        <Button
          variant="contained"
          disabled={saving || bad}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : null}
          onClick={() => onSave(row, { start, due })}
        >
          {saving ? 'Saving…' : 'Save dates'}
        </Button>
      </Box>
    </Box>
  )
}

/** A key in the legend: a small drawing of the mark, then its name. */
function Key({ children, label }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
      <Box component="span" aria-hidden sx={{ display: 'inline-flex', position: 'relative', width: 28, height: 18, flexShrink: 0 }}>
        {children}
      </Box>
      <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
    </Box>
  )
}

/**
 * Planned against actual, as bars on one calendar.
 *
 * The register holds both a plan (start, due) and what happened (actualStart,
 * actualEnd). Four date columns in a table are unreadable — the question is
 * "did this slip", and a slip is a shape rather than a number. So the plan is
 * drawn as an outline, the outcome solid beneath it, and the part of the
 * outcome past the plan's right-hand edge IS the delay.
 *
 * A project with no actual dates is drawn as a plan with an empty track, which
 * is the truthful picture: most of this register has never been told what
 * happened. It is never coloured as though it were on time.
 */
export default function Timeline({
  plan, settings, onUpdate, onAddProjects, onReplaceProjects, rawProjects, readOnly = false, jump = null, note = null,
  onOpenWeekly, planLoading = false,
}) {
  const theme = useTheme()
  const P = theme.palette
  const tone = P.tone
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  /*
   * NARROW is about the room the page has, not the window: a tablet with the
   * menu open leaves the page a phone's width, and gets a phone's columns and
   * a phone's folded filters.
   */
  const [boxW, setBoxW] = useState(0)
  const narrow = phone || (boxW > 0 && boxW < 640)
  // The figures line folds into rows of three below a laptop's width.
  const stacked = narrow || (boxW > 0 && boxW < 900)
  /*
   * The two pinned columns. On a phone the name takes a little over half the
   * width and wraps onto two lines, rather than cutting every project off
   * after a dozen letters; the calendar scrolls sideways in what is left.
   */
  const NAME_W = narrow ? Math.max(170, Math.round((boxW || 360) * 0.55)) : 296
  const SLIP_W = narrow ? 60 : 80
  const PINNED_W = NAME_W + SLIP_W
  /*
   * THE CHART IS THE PAGE. Everything above it is one header, one toolbar and
   * one line of figures, and the chart takes the rest of the window with its
   * own scroll — so the month header stays in sight however far down the list
   * somebody reads.
   */
  const ROW_H = 36
  const KID_H = 34
  // The calendar header: a tier for the years (or months), a tier for the units.
  const TIER_H = 20
  const HEAD_H = 44
  const asOf = settings.asOfDate

  // The marks, from the status tones. Colour only where it means something.
  const INK = {
    // A step above border.strong: a 1px outline at 1.6:1 vanished on both
    // surfaces, and the plan is half of what the chart says.
    plan: P.text.disabled,
    running: alpha(tone.info.solid, 0.7),
    finished: alpha(tone.neutral.solid, 0.7),
    late: tone.danger.solid,
    early: tone.success.solid,
    earlyTint: tone.success.tint,
    adjusted: tone.warning.solid,
    forecast: tone.info.fg,
    forecastTint: tone.info.tint,
    today: tone.warning.solid,
  }
  const ROW_BG = P.bg.surface
  const HOVER_BG = P.bg.subtle
  const LIT_BG = mix(P.bg.surface, P.primary.main, P.mode === 'dark' ? 0.18 : 0.1)
  // The row somebody was sent to: lit, held while the page scrolls to it, then one 1.2s fade.
  const litFade = useMemo(() => keyframes`
    0%, 76% { background-color: ${LIT_BG}; }
    100% { background-color: ${ROW_BG}; }
  `, [LIT_BG, ROW_BG])

  /*
   * Jira, through our own server.
   *
   * The browser never holds a Jira credential: it sends the keys the register
   * already contains and the server, which does hold one, answers with those
   * issues and nothing else.
   */
  const [jira, setJira] = useState(null)
  const [syncing, setSyncing] = useState(false)
  // The outcome of anything this page did, said in a toast.
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

  /*
   * WHEN TO DRAW. The rows are the plan's, but their markers (blocked, a date
   * waiting for approval) and the Jira buttons arrive a moment later. Rather
   * than draw a chart that then grows markers under the reader's eye, the
   * chart waits for them behind a skeleton of itself — and never for longer
   * than four seconds, so a slow check-in service cannot hold the plan back.
   */
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 4000)
    return () => clearTimeout(t)
  }, [])
  const ready = !planLoading && (waited || (weeklyIn && (readOnly || jira != null)))

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
   * for a few seconds, so the eye lands on it rather than hunting a list. It
   * waits for the chart to be drawn — there is nothing to scroll to before.
   */
  const [flash, setFlash] = useState(null)
  useEffect(() => {
    if (jump?.focus) setFlash(jump.focus)
  }, [jump?.n])
  useEffect(() => {
    if (!flash || !ready) return undefined
    const t1 = setTimeout(() => {
      document.querySelector(`[data-keys~="${CSS.escape(flash)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 250)
    const t2 = setTimeout(() => setFlash(null), 5000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [flash, ready])

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
          title: 'Not synced: this browser is behind the shared plan',
          text: `${latest.updatedBy || 'Somebody'} saved the shared plan ${new Date(latest.updatedAt).toLocaleString('en-GB')}. `
            + 'Syncing now would rewrite the register from this older copy and undo their changes.',
          note: 'Reload the page to take the shared plan, then sync. Or use Sync for everyone, which runs on the shared plan itself.',
          reload: true,
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
          title: 'Already up to date with Jira',
          text: `${plural(fetched.issues.length, 'issue')} checked, and all ${board.epics.length} epics in ${board.project} are on the register.`,
          note: api.unknownNote(fetched.missing),
        })
        return
      }
      onReplaceProjects(r.projects)
      const did = [
        r.updated ? `${plural(r.updated, 'project')} updated` : null,
        r.renamed
          ? `${r.renamed} renamed to match Jira (${r.renames.slice(0, 2).map((x) => x.to).join(', ')}${r.renamed > 2 ? '…' : ''})`
          : null,
        r.added
          ? `${plural(r.added, 'new epic')} added as Watch (${r.addedKeys.slice(0, 5).join(', ')}${r.addedKeys.length > 5 ? '…' : ''})`
          : null,
        r.fromCreated
          ? `${plural(r.fromCreated, 'start')} taken from when the ticket was raised`
          : null,
        r.skippedExcluded
          ? `${plural(r.skippedExcluded, 'excluded project')} not touched`
          : null,
      ].filter(Boolean)
      setSyncNote({
        severity: 'success',
        title: `Synced ${plural(fetched.issues.length || keyed.length, 'project')} with Jira`,
        text: did.length ? `${did.join(', ')}.` : null,
        /*
         * WHERE IT LANDED, said out loud.
         *
         * This merge is in this browser. It said "3 projects updated" and
         * nothing about who could see them, so somebody synced on their
         * machine, watched a delay bar appear, and a colleague opening the app
         * saw nothing — which reads as the app being broken rather than as the
         * change never having left the room.
         */
        note: [api.unknownNote(fetched.missing), 'This is in your browser. Use Sync for everyone to update the shared plan.']
          .filter(Boolean).join(' '),
      })
    } catch (e) {
      setSyncNote({
        severity: 'error', title: 'Jira did not answer', text: `${api.plainError(e)} Nothing was changed.`, retry: sync,
      })
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

  const loadKids = async (key) => {
    setKids((prev) => new Map(prev).set(key, { loading: true, rows: [], error: null }))
    try {
      const r = await api.jiraChildren([key])
      const issues = (r.byParent && r.byParent[key]) || []
      setKids((prev) => new Map(prev).set(key, { loading: false, error: null, rows: issues }))
    } catch (e) {
      setKids((prev) => new Map(prev).set(key, { loading: false, error: api.plainError(e), rows: [] }))
    }
  }

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
    await loadKids(key)
  }

  /*
   * A story or a task is the bottom of this chart. Sub-tasks exist in Jira and
   * are not what anybody is reading a portfolio timeline to find out, so those
   * rows offer no chevron at all rather than one that opens onto noise.
   */
  const LEAF = /^(story|task|sub-?task|bug|defect)$/i

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
    sub: [
      issue.key,
      issue.type || 'Issue',
      issue.status,
      // Which sprint the dates came from, so a bar drawn from a sprint window
      // is never mistaken for one somebody typed.
      issue.sprintName || null,
    ].filter(Boolean).join(', '),
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
        setSyncNote({
          severity: 'error',
          title: 'The shared sync did not run',
          text: `${api.plainError(r.error || 'The server could not run the sync.')} The shared plan is unchanged.`,
          retry: syncShared,
        })
        return
      }
      const did = [
        r.updated ? `${plural(r.updated, 'project')} changed` : null,
        r.added ? `${plural(r.added, 'new epic')} added as Watch` : null,
        r.adjusted ? `${r.adjusted} carrying an adjusted date from a delay elsewhere` : null,
        r.pinned ? `${plural(r.pinned, 'finish date')} left alone as held` : null,
        // Said out loud, because "excluded" is a decision somebody made and
        // a sync that silently honoured it would be indistinguishable from
        // one that silently ignored it.
        r.skippedExcluded ? `${plural(r.skippedExcluded, 'excluded project')} not touched` : null,
      ].filter(Boolean)
      setSyncNote({
        severity: 'success',
        title: r.wrote ? 'Shared plan synced with Jira' : 'The shared plan was already up to date',
        text: did.length ? `${did.join(', ')}.` : null,
        note: [r.missingNote || api.unknownNote(r.missingInJira), r.wrote ? 'Reload the page to see it. Everyone else gets it when they do.' : null]
          .filter(Boolean).join(' '),
        reload: !!r.wrote,
      })
    } catch (e) {
      setSyncNote({
        severity: 'error', title: 'The shared sync did not run', text: `${api.plainError(e)} The shared plan is unchanged.`, retry: syncShared,
      })
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
        title: `Finish held at ${fmtD(date)}`,
        text: `${row.jiraKey || row.projectKey}: the sync keeps updating everything else.`,
      }
      : {
        severity: 'info',
        title: 'Finish date released',
        text: `${row.jiraKey || row.projectKey}: the next sync takes it from Jira again.`,
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
        setSyncNote({ severity: 'success', title: 'Dates saved', text: `${row.jiraKey} updated here and in Jira.` })
      } else if (row.jiraKey && jira?.configured) {
        setSyncNote({
          severity: 'info',
          title: 'Dates saved here',
          text: `Not written to ${row.jiraKey}: writing to Jira is switched off on this server `
            + '(set JIRA_ALLOW_WRITES=true in the Render dashboard).',
        })
      } else {
        setSyncNote({ severity: 'success', title: 'Dates saved' })
      }
      setEditing(null)
    } catch (e) {
      // The register keeps the change; the ticket did not take it. Saying so
      // is the whole point — a silent half-write is how two systems drift.
      setSyncNote({
        severity: 'error',
        title: 'Saved here, but Jira refused it',
        text: `${api.plainError(e)} Open the dates again and save to retry.`,
      })
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
        setSyncNote({
          severity: 'success',
          title: 'Nothing new in Jira',
          text: `All ${r.epics.length} epics in ${r.project} are already on the register.`,
        })
        setCandidates(null)
      }
    } catch (e) {
      setSyncNote({
        severity: 'error', title: 'Jira did not answer', text: api.plainError(e), retry: findNew,
      })
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
      title: `${plural(rows.length, 'epic')} added to the register`,
      text: 'Added as Watch. They carry no saving hours and count toward nothing until somebody sizes them.',
    })
    setCandidates(null)
  }

  const [scale, setScale] = useState('month')
  const scrollRef = useRef(null)
  const rootRef = useRef(null)
  // Narrow, the filters fold into a sheet behind one button.
  const [showFilters, setShowFilters] = useState(false)
  const [moreAt, setMoreAt] = useState(null)
  // Whether the calendar is scrolled away from either end: the fade on that edge says there is more.
  const [edges, setEdges] = useState({ left: false, right: false, bar: 0 })

  /*
   * How much room the chart has: its width, so the month view never squeezes
   * its bars into a sliver beside the pinned columns, and its height, which is
   * whatever the window has left below the toolbar — so the chart fills the
   * screen and scrolls inside itself, header row always in sight.
   */
  const [fitH, setFitH] = useState(null)
  const readEdges = () => {
    const el = scrollRef.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    const bar = el.offsetWidth - el.clientWidth
    setEdges((e) => (e.left === left && e.right === right && e.bar === bar ? e : { left, right, bar }))
  }
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const fit = () => {
      setBoxW(el.clientWidth)
      const top = el.getBoundingClientRect().top + window.scrollY
      setFitH(Math.max(phone ? 360 : 420, Math.round(window.innerHeight - top - 16)))
      readEdges()
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    // The whole page too: a notice opening above the chart moves it down.
    if (rootRef.current) ro.observe(rootRef.current)
    window.addEventListener('resize', fit)
    return () => { ro.disconnect(); window.removeEventListener('resize', fit) }
  }, [phone, ready])
  const [q, setQ] = useState('')
  const [fPic, setFPic] = useState('all')
  const [fState, setFState] = useState('all')
  const [ours, setOurs] = useState(true)
  // The administrator's own word on what is being worked on now. Read by the
  // manager dashboard; nothing becomes active by itself.
  const [onlyActive, setOnlyActive] = useState(false)
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
      .sort((a, b) => String(a.timeline.plannedStart || a.timeline.actualStart || '9999')
        .localeCompare(String(b.timeline.plannedStart || b.timeline.actualStart || '9999')))
  }, [plan.projects, q, fPic, fState, ours, onlyActive, activeKeys])

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
    const seenAt = new Map()
    for (const p of rows) {
      const key = String(p.jiraKey || '').trim().toUpperCase()
      // No ticket: nothing to collapse onto, and two register rows with no key
      // are two different pieces of work as far as anything here can tell.
      if (!key) { out.push({ ...p, projectKeys: [p.key], lines: 1 }); continue }
      const seen = seenAt.get(key)
      if (!seen) {
        const row = {
          ...p, projectKeys: [p.key], lines: 1, objectiveIds: p.objective ? [p.objective] : [],
        }
        seenAt.set(key, row)
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
  // A phone's floor is tighter, so the window around today shows half a year rather than two months.
  const MONTH_MIN = phone ? 360 : 560
  const trackPx = scale === 'month'
    ? (phone || (boxW > 0 && boxW - PINNED_W < MONTH_MIN) ? MONTH_MIN : null)
    : Math.max(720, Math.round(days * (scale === 'day' ? PER_UNIT.day : PER_UNIT.week / 7)))
  // The calendar's drawn width, for deciding whether a word fits beside a bar.
  const trackW = trackPx || Math.max(0, boxW - PINNED_W)

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
   * `strong` marks the line worth seeing at a glance — the turn of the year on
   * the month scale, the first of the month on the finer ones — so a day view
   * still reads as a calendar rather than as three hundred identical stripes.
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
            // The year is named in the tier above, so January is a month like the rest.
            label: MONTHS[d.getUTCMonth()],
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
   * The tier above the units: years on the month and week scales, months on
   * the day scale. The period the calendar opens in is named at its left edge
   * too, so the first months on screen are never anonymous.
   */
  const tiers = useMemo(() => {
    const out = []
    const d = new Date(span.from)
    d.setUTCHours(0, 0, 0, 0)
    const byMonth = scale === 'day'
    const name = (x) => (byMonth ? `${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}` : String(x.getUTCFullYear()))
    const first = name(d)
    if (byMonth) d.setUTCDate(1)
    else d.setUTCMonth(0, 1)
    for (let i = 0; i < 60 && d.getTime() <= span.to; i++) {
      if (d.getTime() > span.from) out.push({ ms: d.getTime(), label: name(d) })
      if (byMonth) d.setUTCMonth(d.getUTCMonth() + 1)
      else d.setUTCFullYear(d.getUTCFullYear() + 1)
    }
    out.unshift({ ms: span.from, label: first, lead: true })
    return out
  }, [span, scale])

  /*
   * Scrolled to today whenever the scale changes.
   *
   * A day view of a fourteen-month span is nine thousand pixels wide, and it
   * opens on the first of January — five thousand pixels from anything anybody
   * wanted to look at. Landing on today is the only sane starting point.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || (scale === 'month' && !trackPx)) return
    const width = el.scrollWidth - el.clientWidth
    if (width <= 0) return
    const at01 = (pct(at(asOf)) / 100) * (el.scrollWidth - PINNED_W)
    // Today in the middle of the calendar that is in view — the part between
    // the two pinned columns, not the middle of the whole box.
    el.scrollLeft = Math.max(0, Math.min(width, at01 - Math.max(0, el.clientWidth - PINNED_W) / 2))
    readEdges()
  }, [scale, asOf, span.from, span.to, trackPx, PINNED_W, ready])

  const picks = [{ id: 'all', nick: 'All PICs' }, ...plan.assignees.map((p) => ({ id: p.id, nick: p.nick }))]

  /*
   * The three answers a finished project can give: early, on the day, and
   * late. They are said in the Slip column, and drawn as the part of the bar
   * either side of the plan's right-hand edge — red past it, green short of
   * it. The bar itself only says whether the work is still running (blue) or
   * finished (grey).
   */
  const finishOf = (tl) => {
    if (tl.lateBy == null) return null
    if (tl.lateBy > 0) return 'late'
    if (tl.lateBy < 0) return 'ahead'
    return 'on'
  }
  const FINISH_WORD = { ahead: 'ahead of schedule', on: 'on schedule', late: 'behind schedule' }

  /** What a row with no outcome to draw says beside its plan. */
  const quietWord = (tl) => {
    if (tl.running) return `Running since ${fmtS(tl.actualStart)}`
    if (tl.state === 'finished') return 'Done, no finish date'
    if (tl.actualStart) return 'Started, not finished'
    if (tl.tasksDone > 0) return `${tl.tasksDone} of ${tl.tasksTotal} tasks done`
    return 'Not started'
  }

  // The vertical places of the two lanes, from the middle of the row, so a
  // row that grows (a two-line name on a phone) keeps its bars centred.
  const lane = (depth) => (depth
    ? { plan: 'calc(50% - 8px)', actual: 'calc(50% + 2px)', h: 6 }
    : { plan: 'calc(50% - 10px)', actual: 'calc(50% + 2px)', h: 8 })

  // What the chart currently draws, for a legend that names only those.
  const drawn = { adjusted: false, forecast: false, borrowed: false, blocked: false, waiting: false }

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
   * looking at. Called as a function, not mounted as a component, so a
   * re-render of the page does not tear every row down and build it again.
   */
  const rowGroup = ({ row, depth, parentPlan }) => {
    const tl = row.timeline
    const L = lane(depth)
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
     * says whose date it is.
     */
    const inherited = !tl.plannedEnd && parentPlan?.end && (tl.actualStart || tl.actualEnd)
      ? bar(tl.actualStart || parentPlan.start, parentPlan.end)
      : null

    /*
     * THE ADJUSTED TIMELINE — project rows only.
     *
     * When another team holds a project up, a task is raised for it carrying a
     * date past the project's own. This line runs to that date: where the work
     * now lands, drawn beside the plan rather than replacing it, so the
     * commitment and the adjustment can both be read at once.
     */
    const adjusted = depth === 0 && tl.adjustedEnd ? bar(plannedLeft, tl.adjustedEnd) : null
    /*
     * The actual bar starts where the PLAN starts: lining both bars up on the
     * left makes the only difference between them the one that matters —
     * where they end. The real start is in the tooltip, and the model still
     * holds it, so nothing that measures duration is reading the drawn bar.
     */
    const drawnStart = tl.plannedStart || tl.actualStart
    const finished = tl.actualEnd || (tl.running ? asOf : null)
    /*
     * AND ONLY WHERE THERE IS AN OUTCOME TO DRAW: a real start, a real finish,
     * or a status that says it is in flight. A bar that does not know when the
     * work ran is not evidence of work, and belongs on no chart.
     */
    /*
     * A start with neither a finish nor a running status (marked Done with no
     * date, or started and left) has no length to draw: it was a one-pixel
     * sliver. It is said in words beside the plan instead.
     */
    const happened = !!tl.actualEnd || !!tl.running
    const actual = happened ? bar(drawnStart, finished) : null
    const finish = finishOf(tl)

    /*
     * The variance, drawn as its own segment beyond the planned edge (late) or
     * short of it (early). That segment IS the slip: its length is the number
     * in the last column, so the chart and the figure cannot disagree. Work
     * still running past its date is late up to today.
     */
    const overrun = finish === 'late' && tl.plannedEnd && actual && (tl.actualEnd || tl.running)
      ? bar(tl.plannedEnd, tl.actualEnd || asOf) : null
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
    if (adjusted) drawn.adjusted = true
    if (forecast) drawn.forecast = true
    if (inherited) drawn.borrowed = true
    if (wk?.blockers.length) drawn.blocked = true
    if (wk?.pending.length) drawn.waiting = true

    // A word beside a plan with no outcome, where there is room for it.
    const quiet = !actual && planned ? quietWord(tl) : null
    /*
     * Where the word goes: just past the plan, stopping short of the today
     * line rather than running through it — or, with no room before it, just
     * past it. Never beyond the calendar into the Slip column.
     */
    let quietAt = planned ? ((planned.left + planned.width) / 100) * trackW + 8 : 0
    let roomPx = trackW - 8 - quietAt
    if (quiet) {
      const todayPx = (pct(at(asOf)) / 100) * trackW
      const wants = quiet.length * 6.5
      if (todayPx > quietAt - 2 && todayPx < quietAt + Math.min(wants, roomPx)) {
        if (todayPx - quietAt - 6 >= Math.min(wants, 80)) roomPx = todayPx - quietAt - 6
        else { quietAt = todayPx + 6; roomPx = trackW - 8 - quietAt }
      }
    }
    const sayQuiet = quiet && roomPx >= 64

    const sticky = {
      position: 'sticky',
      zIndex: 1,
      bgcolor: 'inherit',
      flexShrink: 0,
      alignSelf: 'stretch',
    }
    const open1 = depth === 0 ? () => setStory(row) : undefined

    return (
      <Fragment key={row.rowKey}>
        <Box
          data-keys={depth === 0 ? (row.projectKeys || []).join(' ') : undefined}
          sx={{
            display: 'flex',
            alignItems: 'stretch',
            minHeight: depth ? KID_H : ROW_H,
            borderBottom: 1,
            borderColor: 'border.subtle',
            bgcolor: ROW_BG,
            transition: 'background-color 120ms',
            '&:hover': { bgcolor: HOVER_BG },
            // The row a weekly task sent somebody to: the tint, and an edge.
            ...(lit ? {
              boxShadow: `inset 2px 0 0 ${P.primary.main}`,
              animation: `${litFade} 5s ease-out forwards`,
              '@media (prefers-reduced-motion: reduce)': { animation: 'none', bgcolor: LIT_BG },
            } : {}),
            // The active switch: a quiet dot at rest, the whole control on hover or focus.
            '& .tl-active .MuiButtonBase-root': { borderColor: 'transparent', px: 1 },
            '& .tl-active .MuiTypography-root': { display: 'none' },
            '&:hover .tl-active .MuiButtonBase-root, & .tl-active:focus-within .MuiButtonBase-root': { borderColor: 'border.strong', px: 1.75 },
            '&:hover .tl-active .MuiTypography-root, & .tl-active:focus-within .MuiTypography-root': { display: 'inline' },
            '&:hover .tl-quiet-edit': { color: 'text.secondary' },
          }}
        >
          <Box sx={{
            ...sticky,
            left: 0,
            width: NAME_W,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: 1 + depth * 5,
            pr: 2,
            py: narrow && depth === 0 ? 1.5 : 0,
            borderRight: 1,
            borderColor: 'border.subtle',
          }}
          >
            {canOpen ? (
              <IconButton
                size="small"
                sx={{
                  width: narrow ? 36 : 24, height: narrow ? 36 : 24, p: 0, flexShrink: 0, color: 'text.secondary', mx: narrow ? -1 : 0,
                }}
                onClick={() => toggle(key)}
                aria-label={isOpen ? `collapse ${key}` : `expand ${key}`}
                aria-expanded={isOpen}
              >
                {under?.loading ? <CircularProgress size={14} color="inherit" />
                  : isOpen ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ChevronRightIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            ) : (
              <Box sx={{ width: narrow ? 28 : 24, flexShrink: 0 }} />
            )}
            <Box
              sx={{
                overflow: 'hidden',
                flex: 1,
                minWidth: 0,
                cursor: depth === 0 ? 'pointer' : 'default',
                borderRadius: '4px',
                '&:hover .tl-name': depth === 0 ? { color: 'primary.text' } : undefined,
              }}
              // A project's name opens what the weekly check-ins say about it.
              onClick={open1}
              onKeyDown={depth === 0 ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStory(row) } } : undefined}
              role={depth === 0 ? 'button' : undefined}
              tabIndex={depth === 0 ? 0 : undefined}
              aria-label={depth === 0 ? `weekly updates for ${row.jiraKey || row.projectKey}` : undefined}
            >
              <Typography
                className="tl-name"
                title={row.title}
                sx={{
                  fontSize: depth ? '0.8125rem' : '0.875rem',
                  fontWeight: depth ? 400 : 500,
                  lineHeight: '18px',
                  color: 'text.primary',
                  transition: 'color 120ms',
                  ...(narrow && depth === 0 ? {
                    display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere',
                  } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
                }}
              >
                {row.title}
              </Typography>
              <Typography
                component="span"
                title={row.sub}
                sx={{
                  display: 'block', fontSize: '0.75rem', lineHeight: '16px', color: depth ? 'text.tertiary' : 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}
              >
                {row.sub}
              </Typography>
            </Box>
            {/* The markers: something is blocking it, or it is asking to move. */}
            {wk?.blockers.length > 0 && (
              <Tooltip title={`${plural(wk.blockers.length, 'open blocker')} from the weekly check-in. Click the name to read.`}>
                <ReportProblemIcon aria-label="blocked" sx={{ fontSize: 16, color: tone.warning.fg, flexShrink: 0 }} />
              </Tooltip>
            )}
            {wk?.pending.length > 0 && (
              <Tooltip title={`${plural(wk.pending.length, 'date change')} waiting for approval`}>
                <HourglassIcon aria-label="date change waiting" sx={{ fontSize: 16, color: tone.info.fg, flexShrink: 0 }} />
              </Tooltip>
            )}
            {/* ACTIVE: by its dates, or an administrator's override, on every
                register line behind the bar at once — the same work, so the
                same answer. */}
            {depth === 0 && row.projectKeys?.length > 0 && !readOnly && (
              <Box className="tl-active" sx={{ display: 'inline-flex', flexShrink: 0 }}>
                <ActiveControl
                  projects={row.projectKeys.map((k) => projectOf[k])}
                  week={thisWeek}
                  signals={signals}
                  label={`active ${row.jiraKey || row.projectKey}`}
                  // Narrow, the column has no room for the word as well as the name.
                  size={narrow ? 'dot' : 'small'}
                  onSet={(v) => row.projectKeys.forEach((k) => onUpdate(k, { active: v }))}
                />
              </Box>
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
            overflow: 'hidden',
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
                  borderLeft: 1,
                  borderColor: tk.strong ? 'border.strong' : 'border.subtle',
                  // Weekends shaded on the day scale: an overrun that swallowed
                  // a weekend is a different story from one that did not.
                  bgcolor: tk.weekend ? 'action.hover' : undefined,
                }}
              />
            ))}
            <Box sx={{
              position: 'absolute', left: `${pct(at(asOf))}%`, top: 0, bottom: 0, borderLeft: `1px solid ${INK.today}`,
            }}
            />

            {planned && (
              <Tooltip title={[
                `Planned ${fmtD(tl.plannedStart)} to ${fmtD(tl.plannedEnd)}${tl.plannedDays != null ? `, ${tl.plannedDays} days` : ''}.`,
                !tl.plannedStart && tl.plannedEnd
                  ? 'No planned start: drawn from where the work began, so only the finish is compared.'
                  : null,
                quiet ? `${quiet}.` : null,
                canEdit ? 'Click to change the dates.' : null,
              ].filter(Boolean).join(' ')}
              >
                <Box
                  data-bar="plan"
                  onClick={canEdit ? (e) => setEditing({ anchor: e.currentTarget, row }) : undefined}
                  sx={{
                    position: 'absolute',
                    left: `${planned.left}%`,
                    width: `${planned.width}%`,
                    top: L.plan,
                    height: L.h,
                    borderRadius: '2px',
                    border: `1px solid ${INK.plan}`,
                    cursor: canEdit ? 'pointer' : 'default',
                    transition: 'border-color 120ms',
                    '&:hover': canEdit ? { borderColor: P.primary.main } : undefined,
                  }}
                />
              </Tooltip>
            )}
            {!planned && canEdit && (
              <Tooltip title="No planned dates. Click to set them.">
                <IconButton
                  className="tl-quiet-edit"
                  size="small"
                  sx={{
                    position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24, p: 0, color: 'text.tertiary',
                  }}
                  onClick={(e) => setEditing({ anchor: e.currentTarget, row })}
                  aria-label={`set dates for ${row.rowKey}`}
                >
                  <EditCalendarIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
            {inherited && (
              <Tooltip title={`No due date on this one. The dashed line is ${parentPlan.ownerKey || 'its epic'}’s planned finish (${fmtD(parentPlan.end)}), shown for reference only. Nothing is measured against it.`}>
                <Box
                  data-bar="borrowed"
                  sx={{
                    position: 'absolute',
                    left: `${inherited.left}%`,
                    width: `${inherited.width}%`,
                    top: L.plan,
                    height: L.h,
                    borderRadius: '2px',
                    border: '1px dashed',
                    borderColor: INK.plan,
                  }}
                />
              </Tooltip>
            )}
            {adjusted && (
              <Tooltip title={`Adjusted to ${fmtD(tl.adjustedEnd)}, ${tl.adjustedBy} days past the committed `
                + `${fmtD(tl.plannedEnd)}. From ${tl.adjustedCause || 'a task'} underneath, marked as a delay caused `
                + 'elsewhere. The commitment itself has not moved.'}
              >
                <Box
                  data-bar="adjusted"
                  sx={{
                    position: 'absolute',
                    left: `${adjusted.left}%`,
                    width: `${adjusted.width}%`,
                    top: `calc(${L.actual} + ${L.h + 2}px)`,
                    height: 2,
                    borderRadius: '1px',
                    bgcolor: INK.adjusted,
                  }}
                />
              </Tooltip>
            )}
            {forecast && (
              <Tooltip title={`Asked to move to ${fmtD(wk.forecast)}, waiting for approval. Drawn from the committed `
                + `${fmtD(tl.plannedEnd)}; the commitment itself has not moved.`}
              >
                <Box
                  aria-label="forecast"
                  data-bar="forecast"
                  onClick={() => setStory(row)}
                  sx={{
                    position: 'absolute',
                    left: `${forecast.left}%`,
                    width: `${forecast.width}%`,
                    top: L.plan,
                    height: L.h,
                    borderRadius: '2px',
                    border: `1px dashed ${INK.forecast}`,
                    bgcolor: INK.forecastTint,
                    cursor: 'pointer',
                  }}
                />
              </Tooltip>
            )}
            {actual && (
              <Tooltip title={[
                `Actually ran ${fmtD(tl.actualStart)} to ${tl.actualEnd ? fmtD(tl.actualEnd) : (tl.running ? 'still running' : '–')}${tl.actualDays != null ? `, ${tl.actualDays} days` : ''}.`,
                finish ? `Finished ${FINISH_WORD[finish]}${tl.lateBy ? ` by ${plural(Math.abs(tl.lateBy), 'day')}` : ''}.` : null,
                tl.plannedStart && tl.actualStart && tl.plannedStart !== tl.actualStart
                  ? `Drawn from the planned start (${fmtD(tl.plannedStart)}); the work actually began ${fmtD(tl.actualStart)}.`
                  : null,
              ].filter(Boolean).join(' ')}
              >
                <Box
                  data-bar="actual"
                  sx={{
                    position: 'absolute',
                    left: `${actual.left}%`,
                    width: `${actual.width}%`,
                    top: L.actual,
                    height: L.h,
                    borderRadius: '2px',
                    bgcolor: tl.actualEnd ? INK.finished : INK.running,
                  }}
                />
              </Tooltip>
            )}
            {overrun && (
              <Tooltip title={`${plural(tl.lateBy, 'day')} past the planned finish${tl.actualEnd ? '' : ', and still running'}`}>
                <Box
                  data-bar="slip"
                  sx={{
                    position: 'absolute',
                    left: `${overrun.left}%`,
                    width: `${overrun.width}%`,
                    top: L.actual,
                    height: L.h,
                    borderRadius: '0 2px 2px 0',
                    bgcolor: INK.late,
                  }}
                />
              </Tooltip>
            )}
            {saved && (
              <Tooltip title={`${plural(Math.abs(tl.lateBy), 'day')} earlier than planned`}>
                <Box
                  data-bar="early"
                  sx={{
                    position: 'absolute',
                    left: `${saved.left}%`,
                    width: `${saved.width}%`,
                    top: L.actual,
                    height: L.h,
                    borderRadius: '0 2px 2px 0',
                    border: `1px solid ${INK.early}`,
                    bgcolor: INK.earlyTint,
                  }}
                />
              </Tooltip>
            )}
            {/*
              * Three different silences, and they are not the same thing: work
              * under way has no finish YET, work never begun has no start, and
              * a row nobody has reported on has neither. Said beside the plan
              * where it fits, and always in the plan's tooltip.
              */}
            {sayQuiet && (
              <Typography
                component="span"
                sx={{
                  position: 'absolute',
                  left: `${(quietAt / trackW) * 100}%`,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  maxWidth: `${Math.floor(roomPx)}px`,
                  fontSize: '0.75rem',
                  lineHeight: '16px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  color: 'text.tertiary',
                  pointerEvents: 'none',
                }}
              >
                {quiet}
              </Typography>
            )}
          </Box>

          <Box sx={{
            ...sticky,
            right: 0,
            width: SLIP_W,
            px: narrow ? 2 : 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            borderLeft: 1,
            borderColor: 'border.subtle',
          }}
          >
            {tl.lateBy == null ? (
              <Typography component="span" sx={{ fontSize: '0.75rem', color: 'text.tertiary' }} aria-label="no slip to measure">–</Typography>
            ) : tl.lateBy > 0 ? (
              <StatusPill
                tone="danger"
                data-slip={signed(tl.lateBy)}
                title={`${plural(tl.lateBy, 'day')} behind schedule`}
                sx={narrow ? { height: 18, px: 1.5 } : undefined}
              >
                {signed(tl.lateBy)}
              </StatusPill>
            ) : (
              <Typography
                component="span"
                data-slip={signed(tl.lateBy)}
                title={tl.lateBy < 0 ? `${plural(Math.abs(tl.lateBy), 'day')} ahead of schedule` : 'On schedule'}
                className="tabular"
                sx={{
                  fontSize: '0.75rem', fontWeight: 500, lineHeight: '16px', whiteSpace: 'nowrap', color: tl.lateBy < 0 ? tone.success.fg : 'text.secondary',
                }}
              >
                {signed(tl.lateBy)}
              </Typography>
            )}
          </Box>
        </Box>

        {isOpen && under && !under.loading && (
          under.error ? (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', pl: 8 + depth * 5, pr: 3, py: 1.5, borderBottom: 1, borderColor: 'border.subtle',
            }}
            >
              <Typography variant="body2" sx={{ color: tone.danger.fg }}>
                {`Jira did not send the work under ${key}. ${under.error}`}
              </Typography>
              <Button variant="text" size="small" onClick={() => loadKids(key)}>Try again</Button>
            </Box>
          ) : under.rows.length === 0 ? (
            <Box sx={{
              pl: 8 + depth * 5, pr: 3, py: 2, borderBottom: 1, borderColor: 'border.subtle',
            }}
            >
              <Typography variant="body2" sx={{ color: 'text.tertiary' }}>
                {`Nothing under ${key} in Jira.`}
              </Typography>
            </Box>
          ) : (
            under.rows.map((issue) => rowGroup({
              row: asRow(issue),
              depth: depth + 1,
              parentPlan: { start: tl.plannedStart, end: tl.plannedEnd, ownerKey: row.jiraKey },
            }))
          )
        )}
      </Fragment>
    )
  }

  /*
   * The figures follow the search box and the filters: they describe the bars
   * on screen, and the line says whether that is everything or a part of it.
   */
  const filtering = !!q.trim() || fPic !== 'all' || fState !== 'all' || !ours || onlyActive
  // Undated projects are never on the chart; how many there are is the register's figure.
  const t = { ...timelinessOf(rows), noDates: filtering ? 0 : plan.totals.timeliness.noDates }
  const figures = [
    {
      key: 'planned', label: 'Planned', value: t.planned, tip: 'With a plan: a start or a due date on the register.',
    },
    {
      key: 'finished', label: 'Finished', value: t.finished, tone: t.finished ? 'success' : null, tip: 'Finished, with a date to say when.',
    },
    {
      key: 'running', label: 'Running', value: t.running, tone: t.running ? 'info' : null, tip: 'Started and not yet finished.',
    },
    {
      key: 'overdue', label: 'Past due', value: t.overdue, tone: t.overdue ? 'danger' : null, tip: 'Past due and unfinished: the due date has gone by and nothing says it landed.',
    },
    {
      key: 'ontime',
      label: 'On time',
      value: `${t.onTime} of ${t.judged}`,
      tip: `${t.onTime} of the ${t.judged} judged against a date landed on time. A project is judged once it has a due date and either a finish or a date already gone past.`,
    },
    {
      key: 'slip', label: 'Average slip', value: t.avgSlip == null ? '–' : `${t.avgSlip}d`, tone: t.avgSlip ? 'warning' : null, tip: 'Average slip, over the late ones only.',
    },
  ]

  // How many filters are away from their defaults — on the button that hides
  // them, so a short list is never a mystery.
  const changed = [fPic !== 'all', fState !== 'all', !ours, onlyActive].filter(Boolean).length
  const clearFilters = () => {
    setFPic('all'); setFState('all'); setOurs(true); setOnlyActive(false)
  }

  const picSelect = (full) => (
    <FormControl size="small" sx={full ? { width: '100%' } : { minWidth: 140 }}>
      <InputLabel>PIC</InputLabel>
      <Select label="PIC" value={fPic} onChange={(e) => setFPic(e.target.value)}>
        {picks.map((p) => <MenuItem key={p.id} value={p.id}>{p.nick}</MenuItem>)}
      </Select>
    </FormControl>
  )
  const stateSelect = (full) => (
    <FormControl size="small" sx={full ? { width: '100%' } : { minWidth: 160 }}>
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
  )
  const switchSx = { m: 0, gap: 1, '& .MuiFormControlLabel-label': { whiteSpace: 'nowrap', color: 'text.primary' } }
  const switches = (
    <>
      <FormControlLabel
        sx={switchSx}
        control={<Switch size="small" checked={ours} onChange={(e) => setOurs(e.target.checked)} />}
        label="Ours only"
      />
      <FormControlLabel
        sx={switchSx}
        control={<Switch size="small" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} inputProps={{ 'aria-label': 'active projects only' }} />}
        label={(
          <Tooltip title="Active this week: its dates cover this week, Jira work under it does, somebody sent an update on it this week, or a decision on it is open. An administrator can also set it to always active.">
            <span>
              Active only
              <Box component="span" sx={{ color: 'text.tertiary', ml: 1 }} className="tabular">{activeList.length}</Box>
            </span>
          </Tooltip>
        )}
      />
    </>
  )

  const scaleSwitch = (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={scale}
      onChange={(_e, v) => v && setScale(v)}
      aria-label="Calendar scale"
      sx={{ flexShrink: 0, ml: 'auto', '& .MuiToggleButton-root': { minHeight: phone ? 36 : 28, px: 3 } }}
    >
      <ToggleButton value="day">Day</ToggleButton>
      <ToggleButton value="week">Week</ToggleButton>
      <ToggleButton value="month">Month</ToggleButton>
    </ToggleButtonGroup>
  )

  /* THE TOOLBAR: search, filters, and the scale, in one row. */
  const toolbar = (
    <Box
      data-timeline="filters"
      sx={{
        display: 'flex', alignItems: 'center', gap: 2, rowGap: 2, flexWrap: 'wrap', minWidth: 0,
      }}
    >
      <TextField
        size="small"
        placeholder="Search key, project, programme"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        inputProps={{ 'aria-label': 'Search the timeline' }}
        sx={{ flex: narrow ? '1 1 160px' : '1 1 200px', maxWidth: 360, minWidth: 0 }}
        InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18, color: 'text.tertiary' }} /></InputAdornment> }}
      />
      {narrow ? (
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<FilterListIcon />}
          onClick={() => setShowFilters(true)}
          aria-haspopup="dialog"
          sx={{ flexShrink: 0, minHeight: 36 }}
        >
          {changed ? `Filters (${changed})` : 'Filters'}
        </Button>
      ) : (
        <>
          {picSelect(false)}
          {stateSelect(false)}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, pl: 1 }}>{switches}</Box>
          {changed > 0 && (
            <Button variant="text" onClick={clearFilters} sx={{ flexShrink: 0 }}>Clear filters</Button>
          )}
        </>
      )}
      {/* On a phone the scale lives in the sheet with the filters: one row less above the chart. */}
      {!phone && scaleSwitch}
    </Box>
  )

  /* The header's actions: the one Jira action people use, the rest behind ⋮. */
  const jiraTip = jira?.configured ? ` Reads ${jira.site?.replace(/^https?:\/\//, '')} as ${jira.account}.` : ''
  const actions = !readOnly && jira?.configured !== false ? (
    <>
      <Tooltip title={jira == null ? 'Checking the Jira connection…' : `Reads Jira and updates your copy of the register. Nobody else sees it until you save.${jiraTip}`}>
        <span>
          <Button
            variant="outlined"
            startIcon={syncing ? <CircularProgress size={14} color="inherit" /> : <SyncIcon />}
            disabled={!jira?.configured || syncing || sharing}
            onClick={sync}
            sx={{ minHeight: 36 }}
          >
            {syncing ? 'Syncing…' : 'Sync with Jira'}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="More Jira actions" describeChild>
        <span>
          <IconButton
            aria-label="More Jira actions"
            aria-haspopup="menu"
            disabled={!jira?.configured}
            onClick={(e) => setMoreAt(e.currentTarget)}
            sx={{ width: 36, height: 36, color: 'text.secondary', border: 1, borderColor: 'border.strong' }}
          >
            {finding || sharing ? <CircularProgress size={14} color="inherit" /> : <MoreVertIcon fontSize="small" />}
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        anchorEl={moreAt}
        open={!!moreAt}
        onClose={() => setMoreAt(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 320, maxWidth: 'calc(100vw - 24px)', mt: 1 } } }}
      >
        <MenuItem
          disabled={finding}
          onClick={() => { setMoreAt(null); findNew() }}
          sx={{ alignItems: 'flex-start', py: 2 }}
        >
          <ListItemIcon sx={{ mt: 0.25 }}><PlaylistAddIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary={finding ? 'Looking in Jira…' : 'Find new epics'}
            secondary="Epics in Jira that the register does not have yet"
            secondaryTypographyProps={{ sx: { whiteSpace: 'normal' } }}
          />
        </MenuItem>
        <MenuItem
          disabled={syncing || sharing}
          onClick={() => { setMoreAt(null); syncShared() }}
          sx={{ alignItems: 'flex-start', py: 2 }}
        >
          <ListItemIcon sx={{ mt: 0.25 }}><CloudSyncIcon fontSize="small" /></ListItemIcon>
          <ListItemText
            primary={sharing ? 'Syncing for everyone…' : 'Sync for everyone'}
            secondary={`Runs the sync on the shared plan everybody loads, as the 07:00 job does each morning.${jiraTip}`}
            secondaryTypographyProps={{ sx: { whiteSpace: 'normal' } }}
          />
        </MenuItem>
      </Menu>
    </>
  ) : null

  /* The long explanation, behind "About this page". */
  const help = (
    <>
      <Typography variant="body2" component="p">
        <Box component="strong" sx={{ color: 'text.primary' }}>How to read it.</Box>
        {' '}
        Each project has two lanes. The outline is the plan. The bar beneath it is what happened: blue while the
        work is running, grey once it is finished. Where the bar runs past the outline, the red part is the slip.
        Where it stops short, the green part is the time saved. A bar that ends where the outline ends finished on
        schedule.
      </Typography>
      <Typography variant="body2" component="p">
        <Box component="strong" sx={{ color: 'text.primary' }}>Planned dates are never edited to match reality.</Box>
        {' '}
        The plan stays as it was set, and the outcome is recorded beside it. The plan is owned here: click a planned
        bar to change it, and it is written to the Jira ticket too. Outcomes are owned by Jira and only read, because
        Jira stamps a resolution date when an issue is resolved.
      </Typography>
      <Typography variant="body2" component="p">
        A project counts as on time or late once it can be judged: it has a due date, and either a finish or a due
        date already past.
        {` ${t.judged} of ${t.planned} with a plan qualify so far; the rest show an empty track until somebody says what happened.`}
      </Typography>
      {!readOnly && (
        <Typography variant="body2" component="p">
          Sync with Jira updates the copy in this browser. Sync for everyone runs the same sync on the shared plan,
          which is what the 07:00 job does every morning.
        </Typography>
      )}
    </>
  )

  // Drawn first, so the legend knows which marks are on screen.
  const chartRows = ready ? grouped.map((p) => rowGroup({
    row: {
      rowKey: p.key,
      projectKey: p.key,
      // Every register line this bar stands for. A date edited here moves all
      // of them: they are one piece of work in Jira, and a group that can be
      // split in half by one edit is worse than no grouping at all.
      projectKeys: p.projectKeys || [p.key],
      jiraKey: p.jiraKey,
      title: p.summary,
      sub: [
        p.jiraKey || null,
        // Every objective the collapsed lines serve, not just the first one's.
        (p.objectiveIds || [p.objective]).filter(Boolean).map((id) => (OBJ_BY_ID[id] ? `Obj ${OBJ_BY_ID[id].no}` : null))
          .filter(Boolean).join(' + ') || null,
        p.savingHours ? `${fmtHours(p.savingHours)} hrs/mth` : null,
        // Said out loud, so a reader can go and find the lines rather than
        // wonder why the hours do not match the register.
        p.lines > 1 ? `${p.lines} register lines` : null,
        // Said on the row, not only in the editor: a date the sync cannot touch
        // is something a reader has to be able to see without opening anything.
        p.actualEndPinned ? 'finish held' : null,
      ].filter(Boolean).join(', '),
      timeline: p.timeline,
      actualEndPinned: p.actualEndPinned,
      outsideTeam: p.outsideTeam,
    },
    depth: 0,
  })) : null

  /* THE LEGEND: the marks on screen and what they mean, under the chart. */
  const legend = (
    <Box
      data-timeline="legend"
      sx={{
        display: 'flex', alignItems: 'center', columnGap: 5, rowGap: 2, flexWrap: 'wrap', px: 1,
      }}
    >
      <Key label="Plan">
        <Box sx={{ position: 'absolute', inset: '5px 0', border: `1px solid ${INK.plan}`, borderRadius: '2px' }} />
      </Key>
      <Key label="Running">
        <Box sx={{ position: 'absolute', inset: '5px 0', bgcolor: INK.running, borderRadius: '2px' }} />
      </Key>
      <Key label="Finished">
        <Box sx={{ position: 'absolute', inset: '5px 0', bgcolor: INK.finished, borderRadius: '2px' }} />
      </Key>
      <Key label="On schedule">
        <Box sx={{ position: 'absolute', top: 1, height: 7, left: 0, right: 0, border: `1px solid ${INK.plan}`, borderRadius: '2px' }} />
        <Box sx={{ position: 'absolute', top: 10, height: 7, left: 0, right: 0, bgcolor: INK.finished, borderRadius: '2px' }} />
      </Key>
      <Key label="Behind schedule">
        <Box sx={{ position: 'absolute', top: 1, height: 7, left: 0, width: 18, border: `1px solid ${INK.plan}`, borderRadius: '2px' }} />
        <Box sx={{ position: 'absolute', top: 10, height: 7, left: 0, width: 18, bgcolor: INK.finished, borderRadius: '2px 0 0 2px' }} />
        <Box sx={{ position: 'absolute', top: 10, height: 7, left: 18, right: 0, bgcolor: INK.late, borderRadius: '0 2px 2px 0' }} />
      </Key>
      <Key label="Ahead of schedule">
        <Box sx={{ position: 'absolute', top: 1, height: 7, left: 0, right: 0, border: `1px solid ${INK.plan}`, borderRadius: '2px' }} />
        <Box sx={{ position: 'absolute', top: 10, height: 7, left: 0, width: 18, bgcolor: INK.finished, borderRadius: '2px 0 0 2px' }} />
        <Box sx={{
          position: 'absolute', top: 10, height: 7, left: 18, right: 0, border: `1px solid ${INK.early}`, bgcolor: INK.earlyTint, borderRadius: '0 2px 2px 0',
        }}
        />
      </Key>
      {drawn.adjusted && (
        <Key label="Adjusted date, from a delay elsewhere">
          <Box sx={{ position: 'absolute', top: 8, height: 2, left: 0, right: 0, bgcolor: INK.adjusted }} />
        </Key>
      )}
      {drawn.forecast && (
        <Key label="New date asked for, waiting">
          <Box sx={{
            position: 'absolute', inset: '5px 0', border: `1px dashed ${INK.forecast}`, bgcolor: INK.forecastTint, borderRadius: '2px',
          }}
          />
        </Key>
      )}
      {drawn.borrowed && (
        <Key label="Its epic’s date, borrowed">
          <Box sx={{ position: 'absolute', inset: '5px 0', border: `1px dashed ${INK.plan}`, borderRadius: '2px' }} />
        </Key>
      )}
      {drawn.blocked && (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <ReportProblemIcon sx={{ fontSize: 16, color: tone.warning.fg }} aria-hidden />
          <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>Blocked</Typography>
        </Box>
      )}
      {drawn.waiting && (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
          <HourglassIcon sx={{ fontSize: 16, color: tone.info.fg }} aria-hidden />
          <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>Date change waiting</Typography>
        </Box>
      )}
      <Key label={`Today, ${fmtS(asOf)}`}>
        <Box sx={{ position: 'absolute', left: 13, top: 0, bottom: 0, borderLeft: `1px solid ${INK.today}` }} />
      </Key>
    </Box>
  )


  // The toast sits at the left edge of the page, clear of the side menu.
  const toastLeft = !phone && rootRef.current ? Math.round(rootRef.current.getBoundingClientRect().left) : null

  /*
   * The chart's column headings: Project, the calendar, Slip.
   *
   * The calendar is two tiers, the way a printed one is: the year (or, on the
   * day scale, the month) on top, the units beneath. A label is drawn only
   * where it fits whole — a month too narrow for "Feb" gets "F" — and never
   * under the Today tag. Half a word ("Fet", "Oc") reads as a mistake.
   */
  const todayX = (pct(at(asOf)) / 100) * trackW
  const unitLabel = (tk, i) => {
    if (trackW <= 0) return tk.label
    const cell = (((ticks[i + 1] ? pct(ticks[i + 1].ms) : 100) - pct(tk.ms)) / 100) * trackW
    const room = cell - 6
    const full = String(tk.label)
    if (full.length * 6.6 <= room) return full
    if (scale === 'month' && room >= 8) return full[0]
    return ''
  }
  const head = (
    <Box sx={{
      display: 'flex',
      height: HEAD_H,
      borderBottom: 1,
      borderColor: 'border.subtle',
      // Opaque, so rows scrolling underneath the pinned header do not show through it.
      bgcolor: 'bg.subtle',
      position: 'sticky',
      top: 0,
      zIndex: 3,
    }}
    >
      <Box sx={{
        width: NAME_W,
        flexShrink: 0,
        pl: narrow ? 9 : 8,
        pb: 1,
        display: 'flex',
        alignItems: 'flex-end',
        position: 'sticky',
        left: 0,
        bgcolor: 'bg.subtle',
        zIndex: 2,
        borderRight: 1,
        borderColor: 'border.subtle',
      }}
      >
        <Typography variant="subtitle2" component="span" sx={{ color: 'text.secondary' }}>Project</Typography>
      </Box>
      <Box sx={{
        position: 'relative', flex: trackPx ? 'none' : 1, width: trackPx || 'auto', overflow: 'hidden',
      }}
      >
        {ticks.map((tk, i) => (
          <Box
            key={tk.ms}
            sx={{
              position: 'absolute',
              left: `${pct(tk.ms)}%`,
              // As wide as its unit and no wider.
              width: ticks[i + 1] ? `${pct(ticks[i + 1].ms) - pct(tk.ms)}%` : undefined,
              top: TIER_H,
              bottom: 0,
              borderLeft: 1,
              borderColor: tk.strong ? 'border.strong' : 'border.subtle',
              pl: '4px',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Typography
              component="span"
              sx={{
                color: 'text.tertiary', fontSize: '0.75rem', lineHeight: '16px', whiteSpace: 'nowrap',
              }}
            >
              {unitLabel(tk, i)}
            </Typography>
          </Box>
        ))}
        {/* The top tier: the years, or on the day scale the months, with a
            rule down through both tiers where one turns into the next. */}
        {tiers.map((tr, i) => {
          const x = (pct(tr.ms) / 100) * trackW
          const nextX = tiers[i + 1] ? (pct(tiers[i + 1].ms) / 100) * trackW : trackW
          const wants = tr.label.length * 7 + 8
          const clearOfToday = x + wants < todayX - 30 || x > todayX + 30
          const fits = trackW <= 0 || (nextX - x >= wants && clearOfToday)
          return (
            <Box
              key={`tier-${tr.ms}`}
              aria-hidden={!fits}
              sx={{
                position: 'absolute',
                left: `${Math.max(0, pct(tr.ms))}%`,
                top: 0,
                height: tr.lead ? TIER_H : '100%',
                borderLeft: tr.lead ? 0 : 1,
                borderColor: 'border.strong',
                pl: '6px',
                pt: '3px',
                display: 'flex',
                alignItems: 'flex-start',
              }}
            >
              <Typography
                component="span"
                sx={{
                  color: 'text.secondary', fontSize: '0.75rem', lineHeight: '16px', fontWeight: 500, whiteSpace: 'nowrap',
                }}
              >
                {fits ? tr.label : ''}
              </Typography>
            </Box>
          )
        })}
        {/* Where today is, named above the line. Last, so the units come
            first in the row. */}
        <Box
          aria-label={`Today, ${fmtD(asOf)}`}
          sx={{
            position: 'absolute',
            left: `${pct(at(asOf))}%`,
            top: 2,
            transform: 'translateX(-50%)',
            height: TIER_H - 4,
            px: 1.5,
            display: 'flex',
            alignItems: 'center',
            borderRadius: '4px',
            bgcolor: 'bg.subtle',
            border: `1px solid ${INK.today}`,
            color: tone.warning.fg,
            fontSize: '0.75rem',
            fontWeight: 500,
            lineHeight: '14px',
            whiteSpace: 'nowrap',
            zIndex: 1,
          }}
        >
          Today
        </Box>
        <Box sx={{
          position: 'absolute', left: `${pct(at(asOf))}%`, top: TIER_H - 2, bottom: 0, borderLeft: `1px solid ${INK.today}`,
        }}
        />
      </Box>
      <Box sx={{
        width: SLIP_W,
        flexShrink: 0,
        px: narrow ? 2 : 3,
        pb: 1,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'flex-end',
        position: 'sticky',
        right: 0,
        bgcolor: 'bg.subtle',
        zIndex: 2,
        borderLeft: 1,
        borderColor: 'border.subtle',
      }}
      >
        <Typography variant="subtitle2" component="span" sx={{ color: 'text.secondary' }}>Slip</Typography>
      </Box>
    </Box>
  )

  const skeleton = (
    <Box role="status" aria-live="polite" aria-label="Loading the timeline" data-loading>
      <Box sx={{ height: HEAD_H, bgcolor: 'bg.subtle', borderBottom: 1, borderColor: 'border.subtle' }} />
      {Array.from({ length: 10 }, (_, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex', alignItems: 'center', height: ROW_H, borderBottom: 1, borderColor: 'border.subtle',
          }}
        >
          <Box sx={{
            width: NAME_W, flexShrink: 0, pl: narrow ? 9 : 8, pr: 3, borderRight: 1, borderColor: 'border.subtle', alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 0.75,
          }}
          >
            <Skeleton variant="text" height={12} width={`${[72, 58, 80, 64, 49, 76, 61, 68, 54, 70][i]}%`} sx={{ transform: 'none' }} />
            <Skeleton variant="text" height={10} width={`${[38, 44, 30, 41, 35, 46, 33, 39, 42, 36][i]}%`} sx={{ transform: 'none' }} />
          </Box>
          <Box sx={{ flex: 1, position: 'relative', alignSelf: 'stretch' }}>
            <Skeleton
              variant="rounded"
              height={8}
              sx={{
                position: 'absolute', top: 'calc(50% - 4px)', left: `${[4, 18, 26, 30, 42, 44, 45, 47, 50, 52][i]}%`, width: `${[30, 24, 22, 28, 20, 26, 22, 30, 24, 28][i]}%`,
              }}
            />
          </Box>
          <Box sx={{ width: SLIP_W, flexShrink: 0, alignSelf: 'stretch', borderLeft: 1, borderColor: 'border.subtle' }} />
        </Box>
      ))}
    </Box>
  )

  return (
    <Box ref={rootRef} sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 }, minWidth: 0 }}>
      <PageHeader
        title="Timeline"
        // A team member's line says which projects these are, or why there are none.
        description={readOnly && note ? note : 'Planned dates against what happened. The outline is the plan, the bar the outcome.'}
        actions={actions}
        help={help}
      >
        {toolbar}
      </PageHeader>

      {/* With no Jira, say so once and say what it means; the buttons go. */}
      {!readOnly && jira && !jira.configured && (
        <Box sx={{
          display: 'flex', alignItems: 'flex-start', gap: 2, px: 3, py: 2.5, borderRadius: '8px', bgcolor: 'bg.subtle', mt: { xs: -1, sm: -2 },
        }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 18, color: 'text.tertiary', mt: 0.25 }} />
          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '96ch' }}>
            Jira is not connected, so actual dates are typed in by hand. To connect it, set JIRA_BASE_URL, JIRA_EMAIL
            and JIRA_API_TOKEN in the Render dashboard; the token stays on the server.
          </Typography>
        </Box>
      )}

      <Paper variant="outlined" sx={{ overflow: 'hidden', position: 'relative', mt: { xs: -1, sm: -2 } }}>
        {/* THE FIGURES: one quiet line on top of the chart, with how many bars the filters left. */}
        <Box
          data-timeline="summary"
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 5,
            rowGap: 2,
            px: { xs: 3, sm: 4 },
            py: { xs: 2.5, sm: 2.5 },
            borderBottom: 1,
            borderColor: 'border.subtle',
          }}
        >
          <Box sx={{
            display: stacked ? 'grid' : 'flex',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            alignItems: stacked ? 'start' : 'center',
            rowGap: 2,
            columnGap: stacked ? 3 : 0,
            flex: stacked ? '1 1 100%' : '0 1 auto',
            minWidth: 0,
          }}
          >
            {figures.map((f, i) => (
              <Tooltip key={f.key} title={f.tip}>
                <Box
                  data-stat={f.key}
                  tabIndex={0}
                  sx={{
                    display: 'flex',
                    flexDirection: stacked ? 'column' : 'row',
                    alignItems: stacked ? 'flex-start' : 'baseline',
                    gap: stacked ? 0.25 : 2,
                    whiteSpace: 'nowrap',
                    cursor: 'default',
                    borderRadius: '4px',
                    ...(stacked ? {} : {
                      pl: i ? 4 : 0, pr: 4, borderLeft: i ? 1 : 0, borderColor: 'border.subtle',
                    }),
                  }}
                >
                  <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>{f.label}</Typography>
                  <Box component="span">
                    <Typography
                      component="span"
                      className="tabular"
                      sx={{
                        fontSize: '0.875rem', fontWeight: 600, lineHeight: '20px', color: f.value === '–' ? 'text.tertiary' : 'text.primary',
                      }}
                    >
                      {f.tone && (
                        <Box
                          component="span"
                          aria-hidden
                          sx={{
                            display: 'inline-block', width: 6, height: 6, borderRadius: '50%', bgcolor: tone[f.tone].solid, verticalAlign: 'middle', mr: 1.5, mb: '2px',
                          }}
                        />
                      )}
                      {f.value}
                    </Typography>
                  </Box>
                </Box>
              </Tooltip>
            ))}
          </Box>
          <Typography
            component="div"
            variant="caption"
            data-stat-scope={filtering ? 'filtered' : 'all'}
            sx={{
              color: 'text.secondary', ml: stacked ? 0 : 'auto', minWidth: 0, flex: stacked ? '1 1 100%' : '0 1 auto', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
            }}
          >
            {!ready && <CircularProgress size={14} color="inherit" aria-hidden />}
            <span>
              {/* The count is of BARS, which after collapsing is the number of
                  pieces of work — not the number of register lines behind them. */}
              {filtering ? 'Filtered: ' : ''}
              {plural(grouped.length, 'project')}
              {' on the chart'}
              {grouped.length !== rows.length && `, ${rows.length} register lines`}
              {t.noDates > 0 && (
                <Tooltip title="No dates at all, so not on the chart">
                  <span data-stat="undated">{`, ${t.noDates} undated`}</span>
                </Tooltip>
              )}
            </span>
          </Typography>
        </Box>

        <Box sx={{ position: 'relative' }}>
        <Box
          ref={scrollRef}
          data-timeline="chart"
          onScroll={readEdges}
          sx={{ overflowX: 'auto', overflowY: 'auto', maxHeight: fitH ? `${fitH}px` : '70vh' }}
        >
          {ready ? (
            <Box sx={{ minWidth: trackPx ? trackPx + PINNED_W : 'auto' }}>
              {head}
              <Box>
                {chartRows}
                {grouped.length === 0 && (
                  <Box sx={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, py: 6, px: 4, textAlign: 'center',
                  }}
                  >
                    <SearchIcon sx={{ fontSize: 24, color: 'text.tertiary', mb: 1 }} />
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>
                      {filtering ? 'No projects match these filters' : 'No projects with dates yet'}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '56ch' }}>
                      {filtering
                        ? 'Clear the search or the filters to see the whole plan.'
                        : 'Give a project a planned start or due date on the Projects page, and it appears here.'}
                    </Typography>
                    {filtering && (
                      <Button variant="text" sx={{ mt: 2 }} onClick={() => { setQ(''); clearFilters() }}>{q.trim() ? 'Clear search and filters' : 'Clear filters'}</Button>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          ) : skeleton}
        </Box>

        {/* The fades on a calendar that scrolls sideways: more this way. */}
        {ready && (
          <>
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                left: NAME_W,
                bottom: 0,
                top: 0,
                width: 12,
                pointerEvents: 'none',
                zIndex: 4,
                opacity: edges.left ? 1 : 0,
                transition: 'opacity 120ms',
                // The header's colour over the header, the rows' over the rows.
                background: `linear-gradient(to right, ${HOVER_BG}, ${alpha(HOVER_BG, 0)}) 0 0 / 100% ${HEAD_H}px no-repeat, `
                  + `linear-gradient(to right, ${ROW_BG}, ${alpha(ROW_BG, 0)}) 0 ${HEAD_H}px / 100% calc(100% - ${HEAD_H}px) no-repeat`,
              }}
            />
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                right: SLIP_W + edges.bar,
                bottom: 0,
                top: 0,
                width: 12,
                pointerEvents: 'none',
                zIndex: 4,
                opacity: edges.right ? 1 : 0,
                transition: 'opacity 120ms',
                background: `linear-gradient(to left, ${HOVER_BG}, ${alpha(HOVER_BG, 0)}) 0 0 / 100% ${HEAD_H}px no-repeat, `
                  + `linear-gradient(to left, ${ROW_BG}, ${alpha(ROW_BG, 0)}) 0 ${HEAD_H}px / 100% calc(100% - ${HEAD_H}px) no-repeat`,
              }}
            />
          </>
        )}
        </Box>
      </Paper>

      {legend}

      {/*
        * A PROJECT'S WEEKLY STORY: what is waiting to be decided, what is in
        * the way, and the last eight weeks of tasks against it, newest first.
        */}
      <Dialog open={!!story} onClose={() => setStory(null)} maxWidth="sm" fullWidth fullScreen={phone} scroll="paper">
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
          const itemSx = {
            display: 'flex', gap: 3, alignItems: 'flex-start', py: 2, borderTop: 1, borderColor: 'border.subtle', '&:first-of-type': { borderTop: 0, pt: 0 },
          }
          const groupTitle = (txt) => <Typography variant="h3" component="h3" sx={{ mb: 2 }}>{txt}</Typography>
          return (
            <>
              <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, pr: 3 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box component="span" sx={{ display: 'block', overflowWrap: 'anywhere' }}>{story.title}</Box>
                  <Typography variant="body2" component="span" sx={{ display: 'block', color: 'text.secondary', mt: 0.5, fontWeight: 400 }}>
                    {[story.jiraKey, story.timeline.plannedEnd ? `due ${fmtD(story.timeline.plannedEnd)}` : 'no due date'].filter(Boolean).join(', ')}
                    {readOnly ? '. Your own weeks only.' : '. Weekly check-ins, last eight weeks.'}
                  </Typography>
                </Box>
                <IconButton aria-label="Close" onClick={() => setStory(null)} sx={{ color: 'text.secondary', mt: -0.5 }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </DialogTitle>
              <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {wk.pending.length > 0 && (
                  <Box>
                    {groupTitle('Waiting for approval')}
                    {wk.pending.map((p) => (
                      <Box key={p.id} sx={itemSx}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body1">{p.taskTitle}</Typography>
                          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                            {p.nick}
                            {p.blocker ? `: ${p.blocker}` : ''}
                          </Typography>
                        </Box>
                        <StatusPill tone="info">{p.proposedDue ? `To ${fmtS(p.proposedDue)}` : 'Date to pick'}</StatusPill>
                      </Box>
                    ))}
                  </Box>
                )}
                {wk.blockers.length > 0 && (
                  <Box>
                    {groupTitle('In the way')}
                    {wk.blockers.map((b) => (
                      <Box key={`${b.week}${b.person}${b.title}`} sx={itemSx}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body1">{b.title}</Typography>
                          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25, whiteSpace: 'pre-wrap' }}>
                            {`${b.nick}: ${b.blocker}`}
                            {b.newDate ? ` New date ${fmtD(b.newDate)}.` : ''}
                          </Typography>
                        </Box>
                        <StatusPill tone="warning">{CATEGORY_LABEL[b.blockerCategory] || 'Blocked'}</StatusPill>
                      </Box>
                    ))}
                  </Box>
                )}
                {decided.length > 0 && (
                  <Box>
                    {groupTitle('Decided')}
                    {decided.map((p) => (
                      <Box key={p.id} sx={itemSx}>
                        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                          {p.status === 'approved'
                            ? `${p.nick}’s “${p.taskTitle}” moved from ${fmtD(p.fromDue)} to ${fmtD(p.decidedDue)}.`
                            : `${p.nick} asked for ${fmtD(p.newDate)}: “${p.reason}”`}
                        </Typography>
                        <StatusPill tone={PROPOSAL_TONE[p.status] || 'neutral'}>{PROPOSAL_LABEL[p.status]}</StatusPill>
                      </Box>
                    ))}
                  </Box>
                )}
                <Box>
                  {groupTitle('Week by week')}
                  {weeks.length === 0 && (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Nobody has put a task against this project in a weekly check-in yet.
                    </Typography>
                  )}
                  {weeks.map((w) => (
                    <Box key={w} sx={{ '& + &': { mt: 4 } }}>
                      <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mb: 1 }}>{weekTitle(w).replace(' · ', ', ')}</Typography>
                      {byWeek[w].map((h) => (
                        <Box key={`${h.person}${h.title}`} sx={{ ...itemSx, py: 1.5, '&:first-of-type': { borderTop: 0 } }}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body1">{h.title}</Typography>
                            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
                              {h.nick}
                              {h.done === false && h.newDate ? `, now ${fmtD(h.newDate)}` : h.expected ? `, expected ${fmtD(h.expected)}` : ''}
                            </Typography>
                          </Box>
                          <StatusPill tone={h.done === true ? 'success' : h.done === false ? 'warning' : 'neutral'}>
                            {h.done === true ? 'Finished' : h.done === false ? (h.pct != null ? `${h.pct}% done` : 'Not finished') : 'Planned'}
                          </StatusPill>
                        </Box>
                      ))}
                    </Box>
                  ))}
                </Box>
              </DialogContent>
              <DialogActions>
                <Button variant="text" onClick={() => setStory(null)}>Close</Button>
                {!readOnly && onOpenWeekly && wk.pending.length > 0 && (
                  <Button variant="contained" onClick={() => { setStory(null); onOpenWeekly() }}>Decide on the Weekly page</Button>
                )}
              </DialogActions>
            </>
          )
        })()}
      </Dialog>

      <Dialog open={!!candidates} onClose={() => setCandidates(null)} maxWidth="md" fullWidth fullScreen={phone} scroll="paper">
        <DialogTitle sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, pr: 3 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {`${plural(candidates?.rows.length || 0, 'epic')} in ${candidates?.project || 'Jira'} not on the register`}
          </Box>
          <IconButton aria-label="Close" onClick={() => setCandidates(null)} sx={{ color: 'text.secondary', mt: -0.5 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', px: 5, py: 4, maxWidth: '72ch' }}>
            {`Of ${candidates?.all} epics in the project. Anything added comes in as Watch with no saving hours, so it is in nobody’s committed total until it is sized and promoted. Jira’s dates become its plan.`}
          </Typography>
          <List dense disablePadding sx={{ borderTop: 1, borderColor: 'border.subtle' }}>
            {candidates?.rows.map((e) => (
              <ListItem key={e.key} disablePadding divider>
                <ListItemButton
                  sx={{ borderRadius: 0, px: 5, py: 1.5 }}
                  onClick={() => setPicked((prev) => {
                    const next = new Set(prev)
                    if (next.has(e.key)) next.delete(e.key)
                    else next.add(e.key)
                    return next
                  })}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Checkbox edge="start" size="small" checked={picked.has(e.key)} tabIndex={-1} disableRipple inputProps={{ 'aria-label': `add ${e.key}` }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={e.summary || e.key}
                    secondary={[
                      e.key,
                      e.status,
                      e.assignee ? `assigned to ${e.assignee}` : null,
                      e.start || e.due ? `plan ${fmtS(e.start)} to ${fmtD(e.due)}` : 'no dates in Jira',
                      e.resolved ? `resolved ${fmtD(e.resolved)}` : null,
                    ].filter(Boolean).join(', ')}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setPicked(new Set(candidates.rows.map((e) => e.key)))}>Select all</Button>
          <Button variant="text" onClick={() => setPicked(new Set())}>Select none</Button>
          <Box sx={{ flex: 1 }} />
          <Button variant="text" onClick={() => setCandidates(null)}>Cancel</Button>
          <Button variant="contained" disabled={!picked.size} onClick={addPicked}>
            {`Add ${picked.size} to the register`}
          </Button>
        </DialogActions>
      </Dialog>

      <Popover
        open={!!editing}
        anchorEl={editing?.anchor}
        onClose={() => setEditing(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{ paper: { sx: { mt: 1 } } }}
      >
        {editing && (
          <PlanEditor row={editing.row} onSave={savePlan} onHold={holdFinish} saving={saving} jira={jira} />
        )}
      </Popover>

      {/* Narrow, the filters live in a sheet from the bottom. Kept mounted, so
          the selects exist (and keep their values) while it is closed. */}
      {narrow && (
        <Drawer
          anchor="bottom"
          open={showFilters}
          onClose={() => setShowFilters(false)}
          keepMounted
          PaperProps={{ sx: { borderRadius: '12px 12px 0 0', maxHeight: '85vh' } }}
        >
          <Box sx={{ p: 4, pb: 5 }} role="dialog" aria-label="Filters">
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 4 }}>
              <Typography variant="h2" sx={{ flex: 1 }}>Filters</Typography>
              <IconButton aria-label="Close filters" onClick={() => setShowFilters(false)} sx={{ color: 'text.secondary', width: 40, height: 40 }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {phone && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 1 }}>
                  <Typography variant="subtitle2" component="span" sx={{ color: 'text.secondary' }}>Calendar</Typography>
                  {scaleSwitch}
                </Box>
              )}
              {picSelect(true)}
              {stateSelect(true)}
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, '& .MuiFormControlLabel-root': { minHeight: 40 } }}>{switches}</Box>
            </Box>
            <Box sx={{ display: 'flex', gap: 2, mt: 5 }}>
              <Button variant="text" disabled={!changed} onClick={clearFilters}>Clear filters</Button>
              <Box sx={{ flex: 1 }} />
              <Button variant="contained" onClick={() => setShowFilters(false)}>
                {`Show ${plural(grouped.length, 'project')}`}
              </Button>
            </Box>
          </Box>
        </Drawer>
      )}

      {/*
        * THE TOAST: what a sync, a save or a search for new epics did, raised
        * at the bottom left with a thin bar in its tone. A success goes by
        * itself; a warning or an error stays until it is dealt with, and says
        * what to do next.
        */}
      <Snackbar
        open={!!syncNote}
        autoHideDuration={syncNote && (syncNote.severity === 'success' || syncNote.severity === 'info')
          ? (`${syncNote.text || ''}${syncNote.note || ''}`.length > 120 ? 8000 : 4000)
          : null}
        onClose={(_e, why) => { if (why !== 'clickaway') setSyncNote(null) }}
        anchorOrigin={{ vertical: 'bottom', horizontal: phone ? 'center' : 'left' }}
        sx={toastLeft != null ? { left: { sm: `${toastLeft}px` } } : undefined}
      >
        {syncNote ? (
          <Alert
            severity={syncNote.severity}
            variant="filled"
            role={syncNote.severity === 'error' || syncNote.severity === 'warning' ? 'alert' : 'status'}
            onClose={() => setSyncNote(null)}
            sx={{ width: { xs: '100%', sm: 'auto' }, minWidth: { sm: 360 }, maxWidth: 560 }}
            action={syncNote.retry || syncNote.reload ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {syncNote.retry && (
                  <Button variant="text" size="small" onClick={() => { const r = syncNote.retry; setSyncNote(null); r() }}>Try again</Button>
                )}
                {syncNote.reload && (
                  <Button variant="text" size="small" onClick={() => window.location.reload()}>Reload</Button>
                )}
                <IconButton size="small" aria-label="Close" onClick={() => setSyncNote(null)} sx={{ color: 'text.secondary' }}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            ) : undefined}
          >
            {syncNote.title && (
              <Typography variant="body1" sx={{ fontWeight: 500, color: 'text.primary' }}>{syncNote.title}</Typography>
            )}
            {syncNote.text && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: syncNote.title ? 0.5 : 0 }}>{syncNote.text}</Typography>
            )}
            {/* Where the change landed, and who can see it. */}
            {syncNote.note && (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>{syncNote.note}</Typography>
            )}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  )
}
