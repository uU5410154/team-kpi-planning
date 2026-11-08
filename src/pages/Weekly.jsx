import { projectOnHold } from '../lib/hold.js'
import { needsUpdate, statusOf } from '../lib/taskUpdate.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, IconButton, Tooltip, Alert, TextField, MenuItem, Autocomplete,
  ToggleButton, ToggleButtonGroup, Collapse, Skeleton, LinearProgress, Dialog, DialogTitle, DialogContent, DialogActions,
  useMediaQuery,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import visuallyHidden from '@mui/utils/visuallyHidden'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import TimelineIcon from '@mui/icons-material/ViewTimelineOutlined'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import WorkOutlineIcon from '@mui/icons-material/WorkOutlineOutlined'
import AiAssist from '../components/AiAssist.jsx'
import JiraWeek, { choiceSx, projectLabel, renderProjectOption } from '../components/JiraWeek.jsx'
import { Spinner } from '../components/Loading.jsx'
import { activeInWeek } from '../lib/manager.js'
import Markdown from '../components/Markdown.jsx'
import {
  EmptyState, ErrorState, PageHeader, Section, StatusPill,
} from '../components/ui.jsx'
import { pulseSx } from '../components/pulse.js'
import * as api from '../lib/api.js'
import {
  addWeeks, weekNo, bangkokTime, STATUS_LABEL, PRIORITIES, BLOCKER_CATEGORIES, newTaskId,
  planProblems, reportProblems, cleanEntry, slipImpact, PROPOSAL_LABEL,
} from '../lib/weekly.js'

/**
 * THE WEEKLY CHECK-IN.
 *
 * A member's page is a short to-do list: the one next thing to do at the top,
 * then their tasks for the week under their projects — open cards for what
 * still needs an update, single rows for what is done. Below, for an
 * administrator only, the team: every plan, report and blocker. A team member
 * sees their own week and nobody else's.
 *
 * The server decides who sees what (see /api/weekly in server/index.js). This
 * page only lays out what it is sent.
 */

const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '–')
const fmtWeek = (w) => new Date(`${w}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
/** Bangkok wall-clock without the comma: "Fri 6 Nov 15:00". */
const bkk = (ms) => bangkokTime(ms).replace(',', '')
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const DUE_LINE = 'Plan due Mon 08:00, update due Fri 15:00, editable until next Mon 08:00 (Bangkok).'

/* ------------------------------------------------------------ small marks */

/** A person's initial on a neutral disc. */
function Avatar({ name, size = 28 }) {
  const letter = (String(name || '?').match(/[\p{L}]/u) || ['?'])[0].toUpperCase()
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'bg.subtle',
        color: 'text.secondary',
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {letter}
    </Box>
  )
}

// Where somebody stands, as a pill: "Plan late", "Report missing".
const STANDING_TONE = {
  open: 'neutral', missing: 'danger', ontime: 'success', late: 'warning',
}
function StandingPill({ label, value }) {
  if (!value || value === 'open') return null
  return <StatusPill tone={STANDING_TONE[value]}>{`${label} ${STATUS_LABEL[value].toLowerCase()}`}</StatusPill>
}

const PRIORITY_TONE = { must: 'danger', should: 'warning', nice: 'neutral' }
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]))
const CATEGORY_LABEL = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))
function PriorityPill({ priority }) {
  if (!priority) return null
  return <StatusPill tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</StatusPill>
}

const SUMMARY_WHEN = {
  plan: 'after the Monday plans', report: 'after the Friday reports', second: 'after the Sunday second chance',
}

const PROPOSAL_TONE = {
  pending: 'info', approved: 'success', rejected: 'danger', withdrawn: 'neutral', deciding: 'info',
}

/*
 * What became of a task's request to move its project — on the task itself,
 * so the member sees the answer where they gave the date.
 */
function ProposalNote({ proposal }) {
  if (!proposal || proposal.status === 'withdrawn') return null
  const p = proposal
  const text = {
    pending: p.proposedDue
      ? `Asks to move ${p.projectKey} from ${fmtDay(p.currentDue)} to ${fmtDay(p.proposedDue)}.`
      : `Says ${p.projectKey}'s deadline (${fmtDay(p.currentDue)}) moves; the approver picks the new date.`,
    deciding: 'Being decided now.',
    approved: `${p.projectKey} moved from ${fmtDay(p.fromDue)} to ${fmtDay(p.decidedDue)} by ${p.decidedBy || 'an administrator'}`
      + `${p.jira?.written ? `, and in Jira (${p.jira.key})` : ''}.`,
    rejected: `${p.projectKey} stays due ${fmtDay(p.currentDue)}. ${p.decidedBy || 'The approver'}: “${p.reason}”`,
  }[p.status]
  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap',
    }}
    >
      <StatusPill tone={PROPOSAL_TONE[p.status]}>{PROPOSAL_LABEL[p.status] || p.status}</StatusPill>
      <Typography variant="body2" sx={{ color: 'text.secondary', flex: '1 1 220px' }}>{text}</Typography>
    </Box>
  )
}

/** A small link from a task to its project's bar on the Timeline. */
function TimelineLink({ projectKey, onShow, icon = false }) {
  if (!projectKey || !onShow) return null
  if (icon) {
    return (
      <Tooltip title={`Show ${projectKey} on the Timeline`}>
        <IconButton size="small" onClick={() => onShow(projectKey)} aria-label={`show ${projectKey} on the Timeline`} sx={{ my: -1 }}>
          <TimelineIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Tooltip>
    )
  }
  return (
    <Button
      size="small"
      variant="text"
      startIcon={<TimelineIcon />}
      onClick={() => onShow(projectKey)}
      sx={{ flexShrink: 0, minHeight: 28, px: 1.5 }}
    >
      Timeline
    </Button>
  )
}

/* ---------------------------------------------------- the week switcher */

/** Back and forward a week, and straight back to this one. */
function WeekNav({
  data, onGo, onToday, switching, loadingWeek,
}) {
  const ahead = data.week > data.current
  const arrow = {
    width: { xs: 36, sm: 28 }, height: { xs: 36, sm: 28 }, color: 'text.secondary', '&:hover': { color: 'text.primary', bgcolor: 'bg.surface' },
  }
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', width: { xs: '100%', sm: 'auto' }, justifyContent: { xs: 'center', sm: 'flex-end' },
    }}
    >
      {switching && (
        <Box role="status" data-loading sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Spinner size={14} />
          <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{`Loading week ${weekNo(loadingWeek)}…`}</Typography>
        </Box>
      )}
      <Box
        data-week-switcher
        sx={{
          display: 'inline-flex', alignItems: 'center', height: { xs: 40, sm: 32 }, p: '2px', borderRadius: '6px', bgcolor: 'bg.subtle',
        }}
      >
        <Tooltip title="Previous week">
          <IconButton size="small" onClick={() => onGo(-1)} aria-label="previous week" sx={arrow}><ChevronLeftIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Typography
          component="div"
          data-week-shown={data.week}
          sx={{
            height: { xs: 36, sm: 28 },
            lineHeight: { xs: '36px', sm: '28px' },
            px: 3,
            minWidth: 128,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            fontWeight: 500,
            fontSize: '0.875rem',
            borderRadius: '4px',
            bgcolor: 'bg.surface',
          }}
        >
          {`Week ${weekNo(data.week)}, ${fmtWeek(data.week)}`}
        </Typography>
        <Tooltip title={ahead ? 'Planning goes one week ahead' : 'Next week'}>
          <span>
            <IconButton size="small" onClick={() => onGo(1)} disabled={ahead} aria-label="next week" sx={arrow}><ChevronRightIcon fontSize="small" /></IconButton>
          </span>
        </Tooltip>
      </Box>
      {data.week !== data.current && (
        <Button variant="text" size="small" onClick={onToday} sx={{ whiteSpace: 'nowrap' }} data-week-today>This week</Button>
      )}
    </Box>
  )
}

/* ------------------------------------------------------------ next step */

/**
 * THE NEXT STEP for the week on screen: one line saying what to do, and, when
 * there is something to do, the one button that does it.
 */
function NextStep({ next }) {
  const todo = !!(next.action && next.onClick)
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label="Next step"
      data-next-step
      sx={(t) => ({
        px: { xs: 3, sm: 4 },
        py: { xs: 3, sm: 3.5 },
        display: 'flex',
        alignItems: 'center',
        columnGap: 4,
        rowGap: 3,
        flexWrap: 'wrap',
        // A quiet edge, not a bright one: the button carries the call to action.
        borderLeft: `3px solid ${todo ? alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.5 : 0.45) : t.palette.border.strong}`,
      })}
    >
      <Box sx={{ flex: '1 1 300px', minWidth: 0 }}>
        {next.loading ? (
          <Box role="status" aria-label="Working out your next step">
            <Skeleton variant="text" width={260} height={24} sx={{ maxWidth: '90%' }} />
            <Skeleton variant="text" width={200} height={18} sx={{ maxWidth: '70%' }} />
          </Box>
        ) : (
          <Typography variant="h2" sx={{ overflowWrap: 'anywhere' }}>{next.label}</Typography>
        )}
        {next.sub && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, overflowWrap: 'anywhere' }}>{next.sub}</Typography>}
        {next.progress != null && (
          <LinearProgress
            variant="determinate"
            value={Math.round(next.progress * 100)}
            aria-label={next.label}
            sx={{ mt: 2.5, maxWidth: 360 }}
          />
        )}
      </Box>
      {todo && (
        <Button
          variant="contained"
          onClick={next.onClick}
          sx={[{ flexShrink: 0, minHeight: { xs: 40, sm: 36 }, width: { xs: '100%', sm: 'auto' } }, next.pulse && pulseSx]}
          data-next-action
        >
          {next.action}
        </Button>
      )}
    </Paper>
  )
}

/**
 * WHILE THE WEEK IS ON ITS WAY: the shape of what is coming — the next-step
 * bar and three task cards — with what it is waiting for said to a screen
 * reader (and to the checks) in words.
 */
function WeekSkeleton({ label, next = true, cards = 3 }) {
  return (
    <Box role="status" aria-live="polite" data-loading sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }}>
      <Box component="span" sx={visuallyHidden}>{label}</Box>
      {next && (
        <Box sx={{
          px: 4, py: 3.5, border: 1, borderColor: 'border.subtle', borderRadius: '8px', bgcolor: 'bg.surface',
        }}
        >
          <Skeleton variant="text" width={280} height={24} sx={{ maxWidth: '80%' }} />
          <Skeleton variant="text" width={220} height={18} sx={{ maxWidth: '60%' }} />
        </Box>
      )}
      {Array.from({ length: cards }, (_, i) => (
        <Box
          key={i}
          sx={{
            border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflow: 'hidden', bgcolor: 'bg.surface',
          }}
        >
          <Box sx={{
            height: 48, px: 4, display: 'flex', alignItems: 'center', bgcolor: 'bg.subtle', borderBottom: 1, borderColor: 'border.subtle',
          }}
          >
            <Skeleton variant="text" width={[240, 200, 260][i % 3]} height={18} sx={{ bgcolor: 'border.subtle', maxWidth: '70%' }} />
          </Box>
          <Box sx={{ p: 4 }}>
            <Skeleton variant="text" width={[300, 260, 220][i % 3]} height={20} sx={{ maxWidth: '85%' }} />
            <Skeleton variant="text" width={160} height={16} />
            {i === 0 && <Skeleton variant="rounded" height={76} sx={{ mt: 3 }} />}
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/* ------------------------------------------------- an approver's decision */

/*
 * ONE PROPOSAL, AS THE APPROVER SEES IT.
 *
 * Everything needed to decide without opening anything else: who, which task,
 * the project's date now and the date asked for, what is in the way, and
 * whether the dates and the member agree. Then a date (filled in with the one
 * asked for, and changeable), Approve, and Reject — which asks for a reason,
 * because a member told "no" without one cannot do anything with it.
 */
function DecisionRow({
  p, jira, onApprove, onReject, busy, onShowTimeline,
}) {
  const [due, setDue] = useState(p.proposedDue || '')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const now = p.projectDueNow
  const moved = now && p.currentDue && now !== p.currentDue
  const days = due && now ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86400000) : null
  const blockedJira = p.epicKey && jira?.configured && !jira?.writable
  return (
    <Box sx={{
      px: { xs: 3, sm: 4 }, py: 3.5, display: 'flex', flexDirection: 'column', gap: 2.5,
    }}
    >
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', gap: 3, flexWrap: 'wrap',
      }}
      >
        <Avatar name={p.nick} />
        <Box sx={{ minWidth: 0, flex: '1 1 220px' }}>
          <Typography variant="h3" component="h4">{`${p.nick}: ${p.taskTitle}`}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>
            {`${p.projectKey}${p.projectSummary ? ` ${p.projectSummary}` : ''}, week ${weekNo(p.week)}`}
          </Typography>
        </Box>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 2, ml: 'auto',
        }}
        >
          {p.disagree && <StatusPill tone="warning">Dates and member disagree</StatusPill>}
          <TimelineLink projectKey={p.projectKey} onShow={onShowTimeline} />
        </Box>
      </Box>

      <Box sx={{ pl: { sm: 10 }, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        <Typography variant="body1">
          Project due <strong>{fmtDay(now)}</strong>
          {moved && <Box component="span" sx={{ color: 'text.secondary' }}>{` (was ${fmtDay(p.currentDue)} when this was raised)`}</Box>}
          {p.proposedDue
            ? <>. The task now lands <strong>{fmtDay(p.newDate)}</strong>{p.byDate ? `, ${plural(p.byDate, 'day')} late.` : '.'}</>
            : <>. The task now lands {fmtDay(p.newDate)}, inside the due date, but {p.nick} says the deadline moves.</>}
        </Typography>
        {p.blocker && (
          <Box sx={{
            display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap',
          }}
          >
            {p.blockerCategory && <StatusPill tone="neutral">{CATEGORY_LABEL[p.blockerCategory]}</StatusPill>}
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', flex: '1 1 220px', color: 'text.secondary' }}>{p.blocker}</Typography>
          </Box>
        )}

        {!rejecting ? (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
          }}
          >
            <TextField
              size="small"
              type="date"
              label="New project due date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: 190 }}
              inputProps={{ 'aria-label': `new due date for ${p.projectKey}` }}
            />
            <Button variant="contained" disabled={!!busy || !due} onClick={() => onApprove(p, due)} startIcon={busy === `approve:${p.id}` ? <Spinner size={14} /> : null}>
              {busy === `approve:${p.id}` ? 'Approving…' : 'Approve'}
            </Button>
            <Button color="error" variant="text" disabled={!!busy} onClick={() => setRejecting(true)}>Reject</Button>
            {days !== null && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {days > 0 ? `Moves it ${plural(days, 'day')} later` : days < 0 ? `Moves it ${plural(-days, 'day')} earlier` : 'No change'}
              </Typography>
            )}
          </Box>
        ) : (
          <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap',
          }}
          >
            <TextField
              size="small"
              label="Why not? The member sees this."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              multiline
              minRows={1}
              sx={{ flex: '1 1 260px' }}
              autoFocus
            />
            <Button disabled={!!busy} onClick={() => setRejecting(false)}>Cancel</Button>
            <Button color="error" variant="outlined" disabled={!!busy || reason.trim().length < 3} onClick={() => onReject(p, reason)}>
              {busy === `reject:${p.id}` ? 'Rejecting…' : 'Reject date change'}
            </Button>
          </Box>
        )}
        <Typography variant="caption" sx={{ color: blockedJira ? 'tone.warning.fg' : 'text.secondary', maxWidth: '72ch' }}>
          {p.epicKey
            ? (blockedJira
              ? `${p.epicKey} is in Jira and this server may not write to Jira, so approving is refused. Set JIRA_ALLOW_WRITES=true in Render first; otherwise the 07:00 sync puts the old date back.`
              : jira?.configured
                ? `Approving also writes the new due date to ${p.epicKey} in Jira. It counts as a re-plan; the first one on a project is free.`
                : 'Approving moves the project here. It counts as a re-plan; the first one on a project is free.')
            : 'This project has no Jira epic, so approving moves it here only. It counts as a re-plan; the first one is free.'}
        </Typography>
      </Box>
    </Box>
  )
}

const blankTask = () => ({
  id: newTaskId(), title: '', projectKey: null, jiraKey: null, expected: null, effort: null, priority: null,
  carriedFrom: null, done: null, pct: null, blocker: '', blockerCategory: null, newDate: null, affects: null,
})

/* ------------------------------------------------- the person's projects */

/*
 * YOUR PROJECTS, ALREADY ON THE PAGE.
 *
 * The projects this person is PIC of and that are not finished, listed in
 * their week without having to go looking: active ones first, then anything
 * past its date, then by due date. One click puts a task on the project; one
 * already on this week's plan says so instead.
 */
const OPEN_PROJECTS_SHOWN = 8

function MyProjects({
  projects, onAdd, readOnly, onPlan, ahead = false, past = null,
}) {
  const whose = ahead ? 'next week’s plan' : past ? `week ${past}’s plan` : 'this week’s plan'
  const [all, setAll] = useState(false)
  if (!projects.length) return null
  const shown = all ? projects : projects.slice(0, OPEN_PROJECTS_SHOWN)
  return (
    <Section
      title="Your projects"
      meta={`${plural(projects.length, 'open project')} where you are PIC.${readOnly ? '' : ` Add a task to put one on ${whose}.`}`}
      aria-label="your projects"
      padded={false}
    >
      {shown.map((p, i) => {
        const planned = onPlan.has(p.key)
        return (
          <Box
            key={p.key}
            data-my-project={p.key}
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'minmax(0,1fr) auto', md: '84px minmax(0,1fr) auto 76px 144px' },
              gridTemplateAreas: { xs: '"name name" "meta act"', md: '"key name pill due act"' },
              alignItems: 'center',
              columnGap: 3,
              rowGap: 1,
              px: { xs: 3, sm: 4 },
              py: { xs: 2.5, md: 0 },
              minHeight: { md: 44 },
              borderTop: i ? 1 : 0,
              borderColor: 'border.subtle',
            }}
          >
            <Typography variant="body1" sx={{ gridArea: 'key', display: { xs: 'none', md: 'block' }, fontWeight: 500, whiteSpace: 'nowrap' }}>{p.jiraKey || p.key}</Typography>
            <Typography
              variant="body1"
              title={p.summary}
              sx={{
                gridArea: 'name', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: { xs: 'normal', md: 'nowrap' },
              }}
            >
              <Box component="span" sx={{ display: { md: 'none' }, fontWeight: 500, mr: 1.5 }}>{p.jiraKey || p.key}</Box>
              {p.summary}
            </Typography>
            <Box sx={{
              gridArea: { xs: 'meta', md: 'pill' }, display: 'flex', alignItems: 'center', gap: 2, minWidth: 0,
            }}
            >
              {p.active && <StatusPill tone="info">Active</StatusPill>}
              {p.overdue && <StatusPill tone="danger">Past due</StatusPill>}
              <Typography variant="body2" sx={{ display: { md: 'none' }, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {p.due ? `Due ${fmtDay(p.due)}` : 'No due date'}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ gridArea: 'due', display: { xs: 'none', md: 'block' }, color: 'text.secondary', whiteSpace: 'nowrap', textAlign: 'right' }}>
              {p.due ? fmtDay(p.due) : '–'}
            </Typography>
            <Box sx={{ gridArea: 'act', display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
              {planned
                ? <Typography variant="caption" sx={{ color: 'text.tertiary', whiteSpace: 'nowrap', py: 1 }}>{`On ${whose}`}</Typography>
                : !readOnly && (
                  <Button size="small" variant="text" startIcon={<AddIcon />} onClick={() => onAdd(p.key)} sx={{ whiteSpace: 'nowrap', mr: -1.5, minHeight: { xs: 40, sm: 32 } }} aria-label={`add a task on ${p.jiraKey || p.key}`}>
                    Add task
                  </Button>
                )}
            </Box>
          </Box>
        )
      })}
      {projects.length > OPEN_PROJECTS_SHOWN && (
        <Box sx={{
          px: { xs: 3, sm: 4 }, py: 1.5, borderTop: 1, borderColor: 'border.subtle',
        }}
        >
          <Button size="small" variant="text" onClick={() => setAll((x) => !x)} sx={{ ml: -1.5 }}>
            {all ? 'Show fewer' : `Show all ${projects.length}`}
          </Button>
        </Box>
      )}
    </Section>
  )
}

/* ------------------------------------------------------------ one task */

/** The heading a project is listed under in the project picker. */
const PROJECT_GROUP = { pic: 'Your projects (you are PIC)', helping: 'Projects you help on', other: 'Other projects' }
const projectGroup = (p) => PROJECT_GROUP[p.mine] || PROJECT_GROUP.other

/** A week planned on the form (no Jira): one task, its plan and, later, how it went. */
function TaskEditor({
  task, index, projects, projectByKey, onChange, onRemove, readOnly, showReport, jiraTasks, onNeedJira, jiraHint,
  proposal, onShowTimeline, aiOn,
}) {
  const set = (patch) => onChange({ ...task, ...patch })
  const project = task.projectKey ? projectByKey[task.projectKey] : null
  const impact = slipImpact(task, project?.due)
  const children = project?.jiraKey ? jiraTasks[project.jiraKey] : null

  useEffect(() => {
    if (project?.jiraKey && children === undefined) onNeedJira(project.jiraKey)
  }, [project?.jiraKey, children, onNeedJira])

  return (
    <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minHeight: 28 }}>
        <Typography variant="h3" component="h3">{`Task ${index + 1}`}</Typography>
        <PriorityPill priority={task.priority} />
        {task.carriedFrom && (
          <Tooltip title="Not finished last time, so it was carried into this week">
            <Typography variant="caption" sx={{ color: 'text.tertiary' }}>{`Carried from ${fmtDay(task.carriedFrom)}`}</Typography>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {!readOnly && (
          <Tooltip title="Remove task">
            <IconButton size="small" onClick={onRemove} aria-label={`remove task ${index + 1}`} sx={{ mr: -1 }}>
              <DeleteOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <TextField
        size="small"
        label="What"
        value={task.title}
        onChange={(e) => set({ title: e.target.value })}
        disabled={readOnly}
        fullWidth
        multiline
        maxRows={4}
      />

      <Box sx={{
        display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: 'minmax(0,2fr) minmax(0,1.4fr)' },
      }}
      >
        <Autocomplete
          size="small"
          options={projects}
          groupBy={projectGroup}
          openOnFocus
          autoHighlight
          value={project || null}
          disabled={readOnly}
          onChange={(_e, v) => set({ projectKey: v?.key || null, jiraKey: null })}
          getOptionLabel={(p) => projectLabel(p)}
          renderOption={renderProjectOption()}
          isOptionEqualToValue={(a, b) => a.key === b.key}
          renderInput={(params) => <TextField {...params} label="Project (optional)" />}
        />
        <Autocomplete
          size="small"
          freeSolo
          options={children || []}
          disabled={readOnly || !project}
          value={task.jiraKey || ''}
          loading={!!project?.jiraKey && children === undefined}
          getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.key} ${o.summary}`)}
          isOptionEqualToValue={(o, v) => (typeof o === 'string' ? o : o.key) === (typeof v === 'string' ? v : v?.key)}
          onChange={(_e, v) => set({ jiraKey: (typeof v === 'string' ? v : v?.key) || null })}
          onInputChange={(_e, v, reason) => {
            if (reason === 'input') set({ jiraKey: v.trim().toUpperCase() || null })
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Jira task (optional)"
              helperText={!project ? 'Pick a project first' : (children === null ? 'Type the key, e.g. FNP-123' : undefined)}
            />
          )}
        />
      </Box>

      <Box sx={{
        display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, minmax(0,1fr))' },
      }}
      >
        <TextField
          size="small"
          type="date"
          label="Expect to finish"
          value={task.expected || ''}
          onChange={(e) => set({ expected: e.target.value || null })}
          disabled={readOnly}
          InputLabelProps={{ shrink: true }}
          sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
        />
        <TextField
          size="small"
          type="number"
          label="Effort (days)"
          value={task.effort ?? ''}
          onChange={(e) => set({ effort: e.target.value === '' ? null : Number(e.target.value) })}
          disabled={readOnly}
          inputProps={{
            min: 0, max: 99, step: 0.5, inputMode: 'decimal',
          }}
        />
        <TextField
          size="small"
          select
          label="Priority"
          value={task.priority || ''}
          onChange={(e) => set({ priority: e.target.value || null })}
          disabled={readOnly}
        >
          {PRIORITIES.map((p) => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
        </TextField>
      </Box>

      {project && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
        }}
        >
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {`Project due ${fmtDay(project.due)}`}
            {task.expected && project.due && task.expected > project.due && (
              <Box component="span" sx={{ color: 'tone.warning.fg' }}>
                , but this task is expected after it
              </Box>
            )}
          </Typography>
          <TimelineLink projectKey={project.key} onShow={onShowTimeline} />
        </Box>
      )}
      <ProposalNote proposal={proposal} />

      {showReport && (
        <>
          <Box sx={{ borderTop: 1, borderColor: 'border.subtle', mx: { xs: -3, sm: -4 } }} />
          <Box sx={{
            display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, columnGap: 4, rowGap: 1.5, flexDirection: { xs: 'column', sm: 'row' },
          }}
          >
            <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', width: { sm: 64 }, flexShrink: 0 }}>This week</Typography>
            <ToggleButtonGroup
              exclusive
              value={task.done === null ? null : task.done ? 'done' : 'not'}
              onChange={(_e, v) => {
                if (v === null) return
                set(v === 'done'
                  ? { done: true, pct: 100 }
                  : { done: false, pct: task.pct === 100 ? null : task.pct })
              }}
              disabled={readOnly}
              sx={choiceSx()}
            >
              <ToggleButton value="done">Finished</ToggleButton>
              <ToggleButton value="not">Not finished</ToggleButton>
            </ToggleButtonGroup>
            {jiraHint && (
              <Typography variant="caption" sx={{ color: 'tone.success.fg' }}>
                {jiraHint}
              </Typography>
            )}
          </Box>

          {task.done === false && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <Box sx={{
                display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, minmax(0,1fr))' },
              }}
              >
                <TextField
                  size="small"
                  type="number"
                  label="% done"
                  value={task.pct ?? ''}
                  onChange={(e) => set({ pct: e.target.value === '' ? null : Number(e.target.value) })}
                  disabled={readOnly}
                  inputProps={{
                    min: 0, max: 100, step: 5, inputMode: 'numeric',
                  }}
                />
                <TextField
                  size="small"
                  type="date"
                  label="New expected date"
                  value={task.newDate || ''}
                  onChange={(e) => set({ newDate: e.target.value || null })}
                  disabled={readOnly}
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  size="small"
                  select
                  label="Waiting on"
                  value={task.blockerCategory || ''}
                  onChange={(e) => set({ blockerCategory: e.target.value || null })}
                  disabled={readOnly}
                  sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
                >
                  {BLOCKER_CATEGORIES.map((c) => <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>)}
                </TextField>
              </Box>
              <Box>
                <TextField
                  size="small"
                  label="What is blocking it?"
                  value={task.blocker}
                  onChange={(e) => set({ blocker: e.target.value })}
                  disabled={readOnly}
                  multiline
                  minRows={2}
                  maxRows={8}
                  fullWidth
                />
                <Box sx={{ mt: 2 }}>
                  <AiAssist
                    available={aiOn}
                    disabled={readOnly}
                    field="blocker"
                    text={task.blocker}
                    onText={(t) => set({ blocker: t })}
                    task={{ title: task.title, newDate: task.newDate, projectDue: project?.due || null }}
                    onSuggest={(sg) => set({ blockerCategory: sg.category, ...(sg.affects !== null ? { affects: sg.affects } : {}) })}
                  />
                </Box>
              </Box>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap',
              }}
              >
                <Typography variant="body1">Does this push the project&rsquo;s deadline?</Typography>
                <ToggleButtonGroup
                  exclusive
                  value={task.affects === null ? null : task.affects ? 'yes' : 'no'}
                  onChange={(_e, v) => { if (v !== null) set({ affects: v === 'yes' }) }}
                  disabled={readOnly}
                  sx={choiceSx()}
                >
                  <ToggleButton value="yes">Yes</ToggleButton>
                  <ToggleButton value="no">No</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {impact.byDate !== null && (
                <Alert severity={impact.disagree ? 'warning' : 'info'} variant="outlined">
                  {`The new date is ${plural(impact.byDate, 'day')} after the project's due date (${fmtDay(project?.due)}).`}
                  {impact.disagree && ' You answered that it does not push the deadline; your manager sees both.'}
                </Alert>
              )}
              {impact.byDate === null && impact.disagree && (
                <Alert severity="warning" variant="outlined">
                  {`The new date is still inside the project's due date (${fmtDay(project?.due)}), but you answered that it pushes the deadline. Your manager sees both.`}
                </Alert>
              )}
            </Box>
          )}
        </>
      )}
    </Paper>
  )
}

/* ------------------------------------------------- one week, read only */

/** An administrator's view of somebody else's week: one row per task. */
function WeekSummary({
  entry, projectByKey, proposals = {}, onShowTimeline,
}) {
  if (!entry) {
    return <EmptyState inline title="Nothing saved for this week." />
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', '& > * + *': { borderTop: 1, borderColor: 'border.subtle' } }}>
      {entry.focus && (
        <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', py: 2.5, maxWidth: '72ch' }}>{entry.focus}</Typography>
      )}
      {entry.tasks.map((t) => {
        const p = t.projectKey ? projectByKey[t.projectKey] : null
        const impact = slipImpact(t, p?.due)
        const st = statusOf(t)
        const meta = [
          t.projectKey && `${t.projectKey}${p ? ` ${p.summary}` : ''}`,
          t.jiraKey && !String(t.title || '').startsWith(t.jiraKey) && t.jiraKey,
          t.carriedFrom && 'carried over',
          t.expected && `expected ${fmtDay(t.expected)}`,
          t.effort != null && `${t.effort} d`,
          t.reportedAt && `sent ${new Date(t.reportedAt).toLocaleString('en-GB', {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok',
          }).replace(',', '')}`,
        ].filter(Boolean).join(', ')
        const notDone = !t.hold && t.done === false
        return (
          <Box key={t.id} sx={{ py: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{
              display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap',
            }}
            >
              <Typography variant="h3" component="h4" sx={{ flex: '1 1 240px', minWidth: 0 }}>{t.title}</Typography>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0,
              }}
              >
                {st && <StatusPill tone={st.tone}>{st.label}</StatusPill>}
                <PriorityPill priority={t.priority} />
                <TimelineLink projectKey={t.projectKey} onShow={onShowTimeline} icon />
              </Box>
            </Box>
            {meta && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{meta}</Typography>}
            {/* What they wrote on it: the update itself, not just whether it finished. */}
            {t.progress && (
              <Typography variant="body1" data-team-progress sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxWidth: '72ch' }}>
                {t.progress}
              </Typography>
            )}
            {t.hold && t.reason && !/^on hold$/i.test(t.reason.trim()) && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`On hold: ${t.reason}`}</Typography>
            )}
            {notDone && (
              <>
                {[t.pct != null && `${t.pct}% done`, t.newDate && `new date ${fmtDay(t.newDate)}`, t.blockerCategory && `waiting on ${CATEGORY_LABEL[t.blockerCategory].toLowerCase()}`,
                  t.affects != null && (t.affects ? 'says it pushes the deadline' : 'says the deadline holds')].filter(Boolean).length > 0 && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {[t.pct != null && `${t.pct}% done`, t.newDate && `new date ${fmtDay(t.newDate)}`, t.blockerCategory && `waiting on ${CATEGORY_LABEL[t.blockerCategory].toLowerCase()}`,
                      t.affects != null && (t.affects ? 'says it pushes the deadline' : 'says the deadline holds')].filter(Boolean).join(', ').replace(/^./, (c) => c.toUpperCase())}
                  </Typography>
                )}
                {(t.blocker || t.reason) && (
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {`Blocker: ${t.blocker || t.reason}`}
                  </Typography>
                )}
                {impact.byDate !== null && (
                  <Typography variant="body2" sx={{ color: 'tone.danger.fg' }}>
                    {`${plural(impact.byDate, 'day')} past the project's due date (${fmtDay(p?.due)})`}
                  </Typography>
                )}
                {impact.disagree && (
                  <Typography variant="body2" sx={{ color: 'tone.danger.fg' }}>
                    The dates and the member disagree on whether the deadline moves.
                  </Typography>
                )}
                <ProposalNote proposal={proposals[t.id]} />
              </>
            )}
          </Box>
        )
      })}
      {entry.unplanned?.length > 0 && (
        <Box sx={{ py: 2.5 }}>
          <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mb: 1 }}>Adhoc work</Typography>
          {entry.unplanned.map((u) => (
            <Typography key={u.id} variant="body2" sx={{ color: 'text.secondary' }}>
              {`${u.title}${u.projectKey ? ` (${u.projectKey})` : ''}${u.effort !== null && u.effort !== undefined ? `, ${u.effort} d` : ''}`}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  )
}

/* ------------------------------------------------------------ adhoc work */

/** Adhoc work on a Jira week: added in a dialog and saved at once. */
function AdhocDialog({
  open, onClose, onSave, projects, projectByKey,
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const [item, setItem] = useState({ title: '', projectKey: null, effort: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  useEffect(() => { if (open) { setItem({ title: '', projectKey: null, effort: null }); setError(null) } }, [open])
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave({ id: newTaskId(), ...item, title: item.title.trim() })
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth fullScreen={phone} PaperProps={{ 'aria-label': 'add adhoc work' }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, pr: 3 }}>
        <Box component="span" sx={{ flex: 1 }}>Add adhoc work</Box>
        <IconButton aria-label="close" onClick={onClose} disabled={busy} size="small"><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1 }}>Time spent this week on anything that is not a Jira task.</Typography>
          <TextField size="small" label="What" value={item.title} onChange={(e) => setItem((x) => ({ ...x, title: e.target.value }))} fullWidth autoFocus />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(0,1fr) 120px' }, gap: 3 }}>
            <Autocomplete
              size="small"
              options={projects}
              groupBy={projectGroup}
              openOnFocus
              autoHighlight
              value={item.projectKey ? projectByKey[item.projectKey] || null : null}
              onChange={(_e, v) => setItem((x) => ({ ...x, projectKey: v?.key || null }))}
              getOptionLabel={(p) => projectLabel(p)}
              renderOption={renderProjectOption()}
              isOptionEqualToValue={(a, b) => a.key === b.key}
              renderInput={(params) => <TextField {...params} label="Project (optional)" />}
            />
            <TextField
              size="small"
              type="number"
              label="Days"
              value={item.effort ?? ''}
              inputProps={{ min: 0, step: 0.5, inputMode: 'decimal' }}
              onChange={(e) => setItem((x) => ({ ...x, effort: e.target.value === '' ? null : Number(e.target.value) }))}
            />
          </Box>
          {error && <ErrorState title="The adhoc work was not saved." body={`${error} Your text is kept; try again.`} />}
        </Box>
      </DialogContent>
      <DialogActions sx={phone ? { position: 'sticky', bottom: 0, bgcolor: 'bg.raised', borderTop: 1, borderColor: 'border.subtle' } : undefined}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={busy || item.title.trim().length < 2} startIcon={busy ? <Spinner size={14} /> : null}>
          {busy ? 'Saving…' : 'Save adhoc work'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* ------------------------------------------------------------ the page */

export default function Weekly({
  plan, me, onProjectsChanged, onProjectsAdded, onShowTimeline, focusProject = null,
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const admin = me?.role === 'admin'
  const [week, setWeek] = useState('current')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [draft, setDraft] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(null)
  const [problems, setProblems] = useState([])
  const [notice, setNotice] = useState(null)
  const [open, setOpen] = useState(() => new Set())
  const [jiraTasks, setJiraTasks] = useState({})
  const [jiraDone, setJiraDone] = useState({})
  const [adhocOpen, setAdhocOpen] = useState(false)
  const asked = useRef(new Set())
  const myWeekRef = useRef(null)
  // Arriving from a follow-up email: the project asked about, lit for a moment.
  const [focused, setFocused] = useState(null)
  const [askedAbout, setAskedAbout] = useState(null)
  const handledFocus = useRef(0)
  /*
   * WAITING FOR A DECISION — an administrator's list, across every week, not
   * only the one on screen: a proposal raised last Friday is still waiting on
   * Monday.
   */
  const [pending, setPending] = useState(null)
  const [jira, setJira] = useState(null)
  const [deciding, setDeciding] = useState(null)
  // Whether the AI is there to help. Asked once; the buttons stay hidden if not.
  const [aiOn, setAiOn] = useState(false)
  useEffect(() => {
    api.aiStatus().then((r) => setAiOn(!!r.configured)).catch(() => setAiOn(false))
  }, [])
  // Each member's Jira week, for the team list: what is due, not only what was sent.
  const [teamJira, setTeamJira] = useState({})
  // The AI's summary of the week on screen, for an administrator.
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    if (!admin || !data?.week) return
    let stop = false
    api.aiSummary(data.week).then((r) => { if (!stop) setSummary(r) }).catch(() => { if (!stop) setSummary(null) })
    return () => { stop = true }
  }, [admin, data?.week])
  const loadPending = useCallback(async () => {
    if (!admin) return
    try { setPending((await api.proposals('pending')).proposals) } catch { setPending(null) }
  }, [admin])
  useEffect(() => {
    if (!admin) return
    loadPending()
    api.jiraStatus().then(setJira).catch(() => setJira({ configured: false }))
  }, [admin, loadPending])
  const teamIds = (data?.team || []).map((r) => r.person).join(',')
  useEffect(() => {
    if (!admin || !data?.week || !jira?.configured || !teamIds) return undefined
    let stop = false
    setTeamJira({})
    for (const person of teamIds.split(',')) {
      api.jiraWeekOf(data.week, person)
        .then((r) => { if (!stop) setTeamJira((m) => ({ ...m, [person]: r })) })
        .catch(() => { if (!stop) setTeamJira((m) => ({ ...m, [person]: null })) })
    }
    return () => { stop = true }
  }, [admin, data?.week, jira?.configured, teamIds])

  /*
   * The projects a task can be on. The person's own come first and are what
   * the list opens on: the ones they are PIC of, then the ones they help on.
   * Everything else follows, since work on somebody else's project still
   * counts.
   */
  const myId = me?.person || null
  const projects = useMemo(() => {
    const rank = { pic: 0, helping: 1, other: 2 }
    return (plan?.projects || []).filter((p) => !p.deleted && !/\[\s*deleted\s*\]/i.test(p.summary || '')).map((p) => {
      const mine = !myId ? 'other' : p.pic === myId ? 'pic'
        : (p.contributors || []).some((c) => c.person === myId) ? 'helping' : 'other'
      return {
        key: p.key, summary: p.summary || '', due: p.due || null, jiraKey: p.jiraKey || null, mine,
      }
    }).sort((a, b) => rank[a.mine] - rank[b.mine])
  }, [plan, myId])
  const projectByKey = useMemo(() => Object.fromEntries(projects.map((p) => [p.key, p])), [projects])
  /*
   * WHAT A NEW JIRA TASK CAN GO UNDER: a project with a Jira epic (the task is
   * created under it) that is still open — not finished, not Done, not left
   * out or deleted — one entry per epic, their own (PIC) first.
   */
  const taskProjects = useMemo(() => {
    const rank = { pic: 0, helping: 1, other: 2 }
    const closed = (s) => /^(done|closed|cancel)/i.test(String(s || '').trim())
    const byKey = Object.fromEntries((plan?.projects || []).map((p) => [p.key, p]))
    const seen = new Set()
    return projects
      .filter((p) => {
        const row = byKey[p.key] || {}
        return p.jiraKey && row.commitLevel !== 'excluded' && row.commitLevel !== 'nextyear'
          && row.timeline?.state !== 'finished' && !closed(row.status) && !closed(row.jiraStatus)
      })
      .sort((a, b) => (rank[a.mine] - rank[b.mine]) || a.summary.localeCompare(b.summary))
      .filter((p) => { const k = p.jiraKey.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true })
  }, [projects, plan])
  // This person's open projects, for the list in their week.
  const myOpen = useMemo(() => {
    if (!myId) return []
    return (plan?.projects || [])
      .filter((p) => !p.deleted && !/\[\s*deleted\s*\]/i.test(p.summary || '') && p.pic === myId && p.commitLevel !== 'nextyear' && p.commitLevel !== 'excluded'
        && p.timeline?.state !== 'finished' && !projectOnHold(p))
      .map((p) => ({
        key: p.key,
        jiraKey: p.jiraKey || null,
        summary: p.summary || '',
        due: p.due || p.timeline?.plannedEnd || null,
        active: activeInWeek(p, data?.week || undefined),
        overdue: !!p.timeline?.overdue,
      }))
      .sort((a, b) => (b.active - a.active) || (b.overdue - a.overdue)
        || String(a.due || '9999').localeCompare(String(b.due || '9999')))
      // Several register lines on one epic are one project to its PIC.
      .filter((p, i, all) => !p.jiraKey || all.findIndex((x) => x.jiraKey === p.jiraKey) === i)
  }, [plan, myId, data?.week])

  /*
   * THE WEEK FROM JIRA. When this person's Jira account is found, their week
   * is their Jira tasks, card by card (components/JiraWeek.jsx). When it is
   * not — Jira off, account not linked, name not matched — the Monday form
   * below is still there.
   */
  // undefined while it is being asked for; null when there is no week to ask about.
  const [jw, setJw] = useState(undefined)
  const [preset, setPreset] = useState(null)
  // Next step's "Add a task" opens the new-task dialog; a date saved on a
  // week ahead lets it move on to "My plan is set".
  const [addSignal, setAddSignal] = useState(0)
  const [datesSaved, setDatesSaved] = useState({})
  const loadJira = useCallback(async (w) => {
    if (!w || w === 'current') return
    try { setJw(await api.jiraWeek(w)) } catch (e) { setJw({ jira: 'error', error: e.message }) }
  }, [])
  useEffect(() => {
    if (data?.week && data.person) { setJw(undefined); loadJira(data.week) } else if (data) setJw(null)
  }, [data?.week, data?.person, loadJira])
  const jiraMode = jw?.jira === 'on'
  // Not yet known whether this week runs from Jira or from the form: a
  // skeleton, rather than a flash of the Monday form that Jira then replaces.
  const jwLoading = !!data?.person && jw === undefined

  const load = useCallback(async (w) => {
    setError(null)
    try {
      const r = await api.loadWeek(w)
      setData(r)
      setDraft(r.mine ? cleanEntry(r.mine) : null)
      setDirty(false)
      setProblems([])
      // The week the server resolved 'current' to, so the arrows count from it.
      if (w === 'current') setWeek(r.week)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // 'current' resolves to a Monday and becomes the week; that week is already
  // on screen then, and loading it a second time would throw away anything
  // added to the draft in between — the task a follow-up link opens on.
  useEffect(() => { if (data?.week !== week) load(week) }, [week])

  // A week left with edits unsaved is a week lost when the tab closes.
  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /*
   * The Jira tasks under a project, asked for once per epic and only when
   * somebody picks that project. `null` means Jira could not say (switched
   * off, or the call failed): the field then takes a typed key instead.
   */
  const needJira = useCallback((epic) => {
    if (asked.current.has(epic)) return
    asked.current.add(epic)
    api.jiraChildren([epic])
      .then((r) => setJiraTasks((m) => ({ ...m, [epic]: r.byParent?.[epic] || [] })))
      .catch(() => setJiraTasks((m) => ({ ...m, [epic]: null })))
  }, [])

  /*
   * WHAT JIRA ALREADY KNOWS IS FINISHED.
   *
   * A task linked to a Jira ticket that Jira shows resolved is pre-ticked
   * Finished on the report — the member can untick it. Only when the member
   * has not answered yet: a choice they made is never overridden. Nothing is
   * written back to Jira.
   */
  useEffect(() => {
    if (!draft || !data?.writable || !data?.mine?.planSubmittedAt) return
    const keys = draft.tasks.filter((t) => t.jiraKey && t.done === null).map((t) => t.jiraKey)
    if (!keys.length) return
    let stop = false
    api.jiraIssues(keys).then((r) => {
      if (stop) return
      const done = new Set((r.issues || []).filter((i) => i.done).map((i) => i.key))
      if (!done.size) return
      setJiraDone(Object.fromEntries([...done].map((k) => [k, true])))
      setDraft((d) => ({
        ...d,
        tasks: d.tasks.map((t) => (t.jiraKey && done.has(t.jiraKey) && t.done === null ? { ...t, done: true, pct: 100 } : t)),
      }))
      setDirty(true)
    }).catch(() => {})
    return () => { stop = true }
    // Once per week loaded: re-running on every keystroke would re-ask Jira.
  }, [data])

  /*
   * FROM A FOLLOW-UP EMAIL: #weekly/FNP-88 opens this week on that project's
   * task, adding one if the week does not have it yet, so the member has only
   * to fill it in and save — which answers the follow-up.
   */
  useEffect(() => {
    if (!focusProject?.key || handledFocus.current === focusProject.n || !data || !draft) return
    if (data.week !== data.current) return
    handledFocus.current = focusProject.n
    const key = focusProject.key
    window.history.replaceState(null, '', '#weekly')
    const proj = projectByKey[key]
    if (!proj) { setError(`There is no project ${key} in the register. Check the link, or open the project from the Projects page.`); return }
    setAskedAbout(proj)
    if (data.writable && !jiraMode && !draft.tasks.some((t) => t.projectKey === key)) {
      setDraft((dr) => ({ ...dr, tasks: [...dr.tasks, { ...blankTask(), projectKey: key }] }))
      setDirty(true)
    }
    setFocused(key)
    const t1 = setTimeout(() => {
      document.querySelector(`[data-task-project="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 300)
    const t2 = setTimeout(() => setFocused(null), 6000)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [focusProject?.n, data, draft, projectByKey, jiraMode])

  const edit = (patch) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true) }
  const editTask = (i, t) => edit({ tasks: draft.tasks.map((x, j) => (j === i ? t : x)) })

  const decide = async (kind, p, arg) => {
    setDeciding(`${kind}:${p.id}`)
    setError(null)
    try {
      if (kind === 'approve') {
        const r = await api.approveProposal(p.id, arg)
        // The plan in THIS browser moves too, with exactly what the server
        // saved, so the next automatic save does not put the old date back.
        onProjectsChanged?.(r.projects || [])
        setNotice(`${p.projectKey} is now due ${fmtDay(r.proposal.decidedDue)}`
          + `${r.proposal.jira?.written ? `, and ${r.proposal.jira.key} in Jira says so too` : ''}.`)
      } else {
        await api.rejectProposal(p.id, arg)
        setNotice(`Date change rejected. ${p.nick} sees your reason.`)
      }
      await Promise.all([loadPending(), data ? load(data.week) : null])
    } catch (e) {
      setError(e.message)
    } finally {
      setDeciding(null)
    }
  }

  const save = async (submit) => {
    const body = { ...draft, ...(submit ? { submit } : {}) }
    // Checked here first so every missing answer is listed at once; the server
    // checks again and is the one that counts.
    const clean = cleanEntry(body)
    const local = submit === 'plan' ? planProblems(clean)
      : submit === 'report' ? [...planProblems(clean), ...reportProblems(clean)] : []
    if (local.length) { setProblems(local); return }
    setBusy(submit || 'save')
    setProblems([])
    try {
      await api.saveMyWeek(data.week, body)
      setNotice(submit === 'plan' ? 'Plan submitted.' : submit === 'report' ? 'Report submitted.' : 'Draft saved.')
      await load(data.week)
    } catch (e) {
      setError(e.message)
      setProblems(e.problems || [])
    } finally {
      setBusy(null)
    }
  }

  /*
   * A Jira week's adhoc work is saved as it is added or removed. The tasks
   * are Jira's, kept by the server; last week's carried-over form tasks do
   * not belong in it.
   */
  const saveAdhoc = async (unplanned, said) => {
    const body = {
      ...draft, unplanned, mode: 'jira', tasks: draft.tasks.filter((t) => t.source === 'jira'),
    }
    await api.saveMyWeek(data.week, body)
    setNotice(said)
    await load(data.week)
  }
  const removeAdhoc = async (id) => {
    setBusy('adhoc')
    try {
      await saveAdhoc(draft.unplanned.filter((x) => x.id !== id), 'Adhoc work removed.')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const go = (n) => {
    if (dirty && !window.confirm('You have unsaved changes on this week. Leave them?')) return
    setWeek(addWeeks(data.week, n))
  }

  const about = (
    <>
      <Typography variant="body2" component="p">
        The plan is due Monday 08:00 and the update Friday 15:00; Sunday 15:00 is the second chance. A week stays
        editable until the next Monday 08:00. All times are Bangkok time.
      </Typography>
      <Typography variant="body2" component="p">
        Each task&rsquo;s update posts to that task in Jira: a comment, any pictures, and Done or Hold when you pick it.
        A week ahead is for planning: give your Jira tasks dates in it, then confirm the plan.
      </Typography>
      {admin && (
        <Typography variant="body2" component="p">
          Open a person under The team this week to read their week. A late task that moves its project waits for your
          decision at the top.
        </Typography>
      )}
    </>
  )

  if (!data) {
    return (
      <Box>
        <PageHeader title="Weekly" description={DUE_LINE} help={about} />
        {error
          ? <ErrorState title="The week did not load." body={`${error} Check your connection and try again.`} onRetry={() => load(week)} />
          : <WeekSkeleton label="Loading your week…" />}
      </Box>
    )
  }
  // The arrows moved to a week that has not arrived yet.
  const switching = !error && week !== 'current' && week !== data.week

  const d = data.deadlines
  const mine = data.mine
  const readOnly = !data.writable
  const planIn = !!mine?.planSubmittedAt
  const reportIn = !!mine?.reportSubmittedAt
  // The report half appears once there is a plan to report on, or once Friday
  // has come — whichever is first, so a plan never submitted can still be
  // reported against when the week is nearly over.
  const showReport = planIn || (d && data.now >= d.reportDue - 2 * 86400_000)
  const n = weekNo(data.week)

  /*
   * THE ONE THING TO DO NEXT, said in the bar. Worked out from where this
   * person's own week stands; an administrator who does not submit is told
   * how the team is doing instead.
   */
  const toMyWeek = () => myWeekRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // This week's proposals, by person and task, for the notes on each task.
  const propsBy = {}
  for (const p of data.proposals || []) {
    propsBy[p.person] = propsBy[p.person] || {}
    propsBy[p.person][p.taskId] = p
  }
  const required = (data.team || []).filter((r) => r.required)
  const plansIn = required.filter((r) => r.entry?.planSubmittedAt).length
  const reportsIn = required.filter((r) => ['ontime', 'late'].includes(r.standing?.report)).length
  // A Jira week's own next step: the next task to update, then next week's
  // plan; a week ahead is planned by its dates and confirmed.
  const jwReady = jiraMode && jw.week === data.week
  const jiraTodo = jwReady ? [...(jw.overdue || []), ...(jw.tasks || [])].filter((t) => needsUpdate(t, jw.writable)) : []
  const toTask = (key) => {
    const card = document.querySelector(`[data-jira-task="${key}"]`)
    if (!card) { toMyWeek(); return }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => card.querySelector('textarea')?.focus({ preventScroll: true }), 400)
  }
  // To the tasks with no dates, or else the new-task dialog.
  const toPlanning = () => {
    const undated = document.querySelector('[data-undated]')
    if (undated) { undated.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    setAddSignal((x) => x + 1)
  }
  const confirmPlan = async () => {
    try {
      await api.confirmJiraPlan(data.week)
      load(data.week)
    } catch (e) {
      setError(e.message)
    }
  }
  const next = (() => {
    if (data.locked) return { label: `Week ${n} is locked`, sub: 'You can read it but not change it.' }
    if (!data.person) {
      return admin
        ? {
          label: `${plansIn} of ${required.length} plans in`, sub: `${reportsIn} of ${required.length} updates in`, progress: required.length ? plansIn / required.length : 0,
        }
        : { label: 'Your account is not linked yet', sub: 'Ask an administrator to link it to your name on the Access page.' }
    }
    // Whether the week is Jira's or the form's decides the step: wait for it.
    if (jwLoading || (jiraMode && !jwReady)) return { loading: true }
    if (jwReady) {
      if (data.week > data.current) {
        if (planIn) return { label: `Week ${n} is planned`, sub: 'You can still change the dates on your tasks until the week starts.' }
        /*
         * Nothing to confirm until something is planned: first dates or a new
         * task, then "My plan is set" — one button, here only.
         */
        const covering = (jw.tasks || []).length
        if (!covering && !datesSaved[data.week]) {
          const undated = (jw.undated || []).length > 0
          return {
            label: `Plan week ${n}`,
            sub: `Nothing of yours in Jira is dated in week ${n} yet. Give your tasks dates, or add a task.`,
            action: undated ? 'Set dates on my tasks' : 'Add a task',
            onClick: toPlanning,
            pulse: true,
          }
        }
        return {
          label: `Plan week ${n}`,
          sub: `${plural(covering, 'task')} of yours ${covering === 1 ? 'is' : 'are'} dated in it. Add or re-date any others, then confirm.`,
          action: `My plan for week ${n} is set`,
          onClick: confirmPlan,
          pulse: true,
        }
      }
      if (jiraTodo.length) {
        const t = jiraTodo[0]
        return {
          label: `Update ${plural(jiraTodo.length, 'task')} for week ${n}`,
          sub: `Next: ${t.key} ${t.summary}`,
          action: 'Update next task',
          onClick: () => toTask(t.key),
          pulse: true,
        }
      }
      if (data.week === data.current) {
        const n1 = weekNo(addWeeks(data.week, 1))
        return {
          label: 'Every task is updated',
          sub: `Next, plan week ${n1}: set dates on your tasks before Monday 08:00.`,
          action: `Plan week ${n1}`,
          onClick: () => go(1),
          pulse: true,
        }
      }
      return { label: `Week ${n} is all updated`, sub: 'You can still change an update until the week locks.' }
    }
    if (!planIn) {
      return {
        label: 'Send your plan for the week', sub: `Due ${bkk(d.planDue)}, Bangkok time.`, action: 'Write my plan', onClick: toMyWeek, pulse: true,
      }
    }
    if (!reportIn) {
      return {
        label: 'Report how the week went', sub: `Due ${bkk(d.reportDue)}. Sunday 15:00 is the second chance.`, action: 'Write my report', onClick: toMyWeek, pulse: true,
      }
    }
    return { label: 'Your plan and report are in', sub: 'You can still edit until the week locks.' }
  })()

  // What the My week header says under its title.
  const myMeta = jiraMode || jwLoading
    ? (data.week > data.current
      ? `Planning week ${n}: your Jira tasks dated in it are your plan.`
      : `Your Jira tasks dated in week ${n}.${data.locked ? '' : ` Update due ${bkk(d.reportDue)}.`}`)
    : `Plan due ${bkk(d.planDue)}, report due ${bkk(d.reportDue)}, locks ${bkk(d.locksAt)}.`
  // One place for a confirmation: beside the form's buttons, or under the next step.
  const formMode = !!draft && !jiraMode && !jwLoading

  const weekNav = (
    <WeekNav
      data={data}
      onGo={go}
      onToday={() => { if (!dirty || window.confirm('Leave unsaved changes?')) setWeek(data.current) }}
      switching={switching}
      loadingWeek={week}
    />
  )

  return (
    <Box>
      <PageHeader
        title="Weekly"
        description={DUE_LINE}
        help={about}
        actions={phone ? null : weekNav}
      >
        {phone ? weekNav : null}
      </PageHeader>

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }}>
        {error && <Alert severity="error" variant="outlined" onClose={() => setError(null)}>{error}</Alert>}
        {next && <NextStep next={next} />}
        {notice && !formMode && <Alert severity="success" variant="outlined" onClose={() => setNotice(null)}>{notice}</Alert>}

        {!data.person && admin && (
          <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.5, color: 'text.secondary', mt: -1,
          }}
          >
            <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.tertiary', mt: 0.25, flexShrink: 0 }} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Your account is not linked to a team member, so there is no week of your own. Link it on the Access page if you submit too.
            </Typography>
          </Box>
        )}

        {/* ------------------------------------------- waiting for a decision */}
        {admin && pending && pending.length > 0 && (
          <Section
            title="Waiting for your decision"
            meta={`${plural(pending.length, 'late task')} that would move ${pending.length === 1 ? 'its project' : 'their projects'}. Approve the new due date, or reject it with a reason.`}
            padded={false}
            sx={{ '& [data-decision-row] + [data-decision-row]': { borderTop: 1, borderColor: 'border.subtle' } }}
          >
            {pending.map((p) => (
              <Box key={`${p.id}:${p.updatedAt}`} data-decision-row>
                <DecisionRow
                  p={p}
                  jira={jira}
                  busy={deciding}
                  onApprove={(x, due) => decide('approve', x, due)}
                  onReject={(x, why) => decide('reject', x, why)}
                  onShowTimeline={onShowTimeline}
                />
              </Box>
            ))}
          </Section>
        )}

        {/* ------------------------------------------------ the AI summary */}
        {admin && summary?.ai && (
          <Section
            title={(
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5 }}>
                <AutoAwesomeIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                The week, summarised
              </Box>
            )}
            aria-label="The week, summarised"
            meta={summary.summaries[0]
              ? `Written ${new Date(summary.summaries[0].writtenAt).toLocaleString('en-GB', {
                timeZone: 'Asia/Bangkok', weekday: 'short', hour: '2-digit', minute: '2-digit',
              })} ${SUMMARY_WHEN[summary.summaries[0].trigger] || ''}`.trim()
              : `No summary yet for week ${n}. The AI writes one after each deadline and emails it to the administrators.`}
            data-no-summary={summary.summaries[0] ? undefined : true}
            // With no summary the meta line says it all: no empty body under it.
            sx={{ '& > div:last-of-type:empty': { display: 'none' } }}
          >
            {summary.summaries[0] ? (
              <>
                <Box sx={{ maxWidth: '80ch' }}><Markdown text={summary.summaries[0].text} /></Box>
                <Typography variant="caption" component="div" sx={{ color: 'text.tertiary', mt: 3 }}>
                  Written by AI from what the team submitted. Check anything you act on against the week below.
                </Typography>
              </>
            ) : null}
          </Section>
        )}

        {/* ---------------------------------------------------- my week */}
        {draft && (
          <Box ref={myWeekRef} sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 }, scrollMarginTop: 96 }}>
            <Box sx={{ mt: { xs: 1, sm: 2 } }}>
              <Box sx={{
                display: 'flex', alignItems: 'center', columnGap: 2, rowGap: 1, flexWrap: 'wrap',
              }}
              >
                <Typography variant="h2" component="h2" sx={{ mr: 1 }}>My week</Typography>
                <StandingPill label="Plan" value={data.mineStanding?.plan} />
                <StandingPill label="Report" value={data.mineStanding?.report} />
              </Box>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{myMeta}</Typography>
            </Box>

            {formMode && mine?.draft && draft.tasks.length > 0 && (
              <Alert severity="info" variant="outlined">
                {`${plural(draft.tasks.length, 'unfinished task')} carried over from last week. Edit, remove or add to them, then save.`}
              </Alert>
            )}
            {jw?.jira === 'unmatched' && (
              <Alert severity="info" variant="outlined">
                {`Your Jira account was not found from your name on the team${jw.names?.length ? ` (tried ${jw.names.join(', ')})` : ''}, so this week uses the form below. Ask an administrator to add your Jira display name on the Model page.`}
              </Alert>
            )}
            {askedAbout && (
              <Alert severity="info" variant="outlined" onClose={() => setAskedAbout(null)}>
                Your manager asked for an update on <strong>{askedAbout.jiraKey || askedAbout.key}</strong>
                {askedAbout.summary ? ` ${askedAbout.summary}` : ''}.
                {jiraMode ? ' Submit an update on its tasks below, or add one.' : ' Fill in its task below, then save or submit.'}
                {' '}They are told when you do.
              </Alert>
            )}
            {(jwLoading || (jiraMode && jw.week !== data.week)) && (
              <WeekSkeleton label={`Reading your Jira tasks for week ${n}…`} next={false} />
            )}
            {jwReady && (
              <JiraWeek
                week={data.week}
                current={data.current}
                person={data.person}
                canWrite={!readOnly}
                jw={jw}
                onReload={() => { loadJira(data.week); load(data.week) }}
                onDatesSaved={() => setDatesSaved((m) => ({ ...m, [data.week]: true }))}
                addSignal={addSignal}
                projects={taskProjects}
                preset={preset}
                onPresetUsed={() => setPreset(null)}
                focusKey={focused}
                aiOn={aiOn}
                planIn={planIn}
                planInAt={mine?.planSubmittedAt || null}
                onGoWeek={go}
                onProjectAdded={(r) => { if (r.project) onProjectsAdded?.([r.project]) }}
              />
            )}
            {jwReady && (
              <MyProjects
                projects={myOpen}
                readOnly={readOnly}
                ahead={data.week > data.current}
                past={data.week < data.current ? n : null}
                onPlan={new Set([...(jw.tasks || []), ...(jw.overdue || [])].map((t) => t.project?.key).filter(Boolean))}
                onAdd={(key) => setPreset(key)}
              />
            )}

            {formMode && (
              <>
                <Section title="Focus" meta={readOnly ? null : 'A few sentences. This is what your manager reads first.'}>
                  <TextField
                    label="This week I'm focused on…"
                    value={draft.focus}
                    onChange={(e) => edit({ focus: e.target.value })}
                    disabled={readOnly}
                    multiline
                    minRows={2}
                    maxRows={8}
                    fullWidth
                  />
                  <Box sx={{ mt: 2 }}>
                    <AiAssist available={aiOn} disabled={readOnly} field="focus" text={draft.focus} onText={(t) => edit({ focus: t })} />
                  </Box>
                </Section>

                <MyProjects
                  projects={myOpen}
                  readOnly={readOnly}
                  onPlan={new Set(draft.tasks.map((t) => t.projectKey).filter(Boolean))}
                  onAdd={(key) => edit({ tasks: [...draft.tasks, { ...blankTask(), projectKey: key }] })}
                />

                {draft.tasks.map((t, i) => (
                  <Box
                    key={t.id}
                    data-task-project={t.projectKey || undefined}
                    sx={{
                      borderRadius: '8px',
                      transition: 'box-shadow 180ms ease-out',
                      boxShadow: focused && t.projectKey === focused ? (th) => `0 0 0 2px ${th.palette.primary.main}` : 'none',
                    }}
                  >
                    <TaskEditor
                      task={t}
                      index={i}
                      projects={projects}
                      projectByKey={projectByKey}
                      onChange={(nx) => editTask(i, nx)}
                      onRemove={() => edit({ tasks: draft.tasks.filter((_x, j) => j !== i) })}
                      readOnly={readOnly}
                      showReport={showReport}
                      jiraTasks={jiraTasks}
                      onNeedJira={needJira}
                      jiraHint={t.jiraKey && jiraDone[t.jiraKey] ? `${t.jiraKey} is resolved in Jira` : null}
                      proposal={propsBy[data.person]?.[t.id]}
                      onShowTimeline={onShowTimeline}
                      aiOn={aiOn}
                    />
                  </Box>
                ))}
                {!readOnly && (
                  <Button
                    startIcon={<AddIcon />}
                    onClick={() => edit({ tasks: [...draft.tasks, blankTask()] })}
                    sx={{ alignSelf: 'flex-start', mt: -1 }}
                  >
                    Add a task
                  </Button>
                )}
              </>
            )}

            {/* ------------------------------------- adhoc / unplanned work */}
            {jwReady && data.week <= data.current && (
              <Section
                title="Adhoc work"
                meta="Time spent this week on anything that is not a Jira task."
                padded={false}
                actions={!readOnly ? (
                  <Button startIcon={<AddIcon />} onClick={() => setAdhocOpen(true)} sx={{ mr: -1.5 }} disabled={busy === 'adhoc'}>Add adhoc work</Button>
                ) : null}
              >
                {draft.unplanned.length === 0 ? (
                  <Box sx={{ px: { xs: 3, sm: 4 } }}>
                    <EmptyState inline icon={WorkOutlineIcon} title="No adhoc work this week." />
                  </Box>
                ) : draft.unplanned.map((u, i) => (
                  <Box
                    key={u.id}
                    sx={{
                      display: 'flex', alignItems: 'center', gap: 3, px: { xs: 3, sm: 4 }, minHeight: 44, py: 1, borderTop: i ? 1 : 0, borderColor: 'border.subtle',
                    }}
                  >
                    <Typography variant="body1" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                      {u.title}
                      {u.projectKey && <Box component="span" sx={{ color: 'text.secondary', ml: 2 }}>{u.projectKey}</Box>}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      {u.effort != null ? `${u.effort} d` : '–'}
                    </Typography>
                    {!readOnly && (
                      <Tooltip title="Remove">
                        <IconButton size="small" onClick={() => removeAdhoc(u.id)} disabled={busy === 'adhoc'} aria-label="remove unplanned work" sx={{ mr: -1 }}>
                          <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                ))}
              </Section>
            )}
            {formMode && showReport && (
              <Section
                title="Unplanned work"
                meta="Anything that took your time this week and was not in Monday’s plan."
                actions={!readOnly ? (
                  <Button
                    startIcon={<AddIcon />}
                    onClick={() => edit({ unplanned: [...draft.unplanned, { id: newTaskId(), title: '', projectKey: null, effort: null }] })}
                    sx={{ mr: -1.5 }}
                  >
                    Add unplanned work
                  </Button>
                ) : null}
              >
                {draft.unplanned.length === 0 && <EmptyState inline title="No unplanned work this week." />}
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {draft.unplanned.map((u, i) => (
                    <Box
                      key={u.id}
                      sx={{
                        display: 'grid',
                        gap: 2,
                        alignItems: 'center',
                        gridTemplateColumns: { xs: 'minmax(0,1fr) 88px 40px', sm: 'minmax(0,3fr) minmax(0,2fr) 110px 40px' },
                      }}
                    >
                      <TextField
                        size="small"
                        label="What"
                        value={u.title}
                        disabled={readOnly}
                        onChange={(e) => edit({ unplanned: draft.unplanned.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                        sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' } }}
                      />
                      <Autocomplete
                        size="small"
                        options={projects}
                        groupBy={projectGroup}
                        openOnFocus
                        autoHighlight
                        value={u.projectKey ? projectByKey[u.projectKey] || null : null}
                        disabled={readOnly}
                        onChange={(_e, v) => edit({ unplanned: draft.unplanned.map((x, j) => (j === i ? { ...x, projectKey: v?.key || null } : x)) })}
                        getOptionLabel={(p) => projectLabel(p)}
                        renderOption={renderProjectOption()}
                        isOptionEqualToValue={(a, b) => a.key === b.key}
                        renderInput={(params) => <TextField {...params} label="Project" />}
                      />
                      <TextField
                        size="small"
                        type="number"
                        label="Days"
                        value={u.effort ?? ''}
                        disabled={readOnly}
                        inputProps={{ min: 0, step: 0.5, inputMode: 'decimal' }}
                        onChange={(e) => edit({ unplanned: draft.unplanned.map((x, j) => (j === i ? { ...x, effort: e.target.value === '' ? null : Number(e.target.value) } : x)) })}
                      />
                      {!readOnly ? (
                        <Tooltip title="Remove">
                          <IconButton size="small" onClick={() => edit({ unplanned: draft.unplanned.filter((_x, j) => j !== i) })} aria-label="remove unplanned work">
                            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                          </IconButton>
                        </Tooltip>
                      ) : <span />}
                    </Box>
                  ))}
                </Box>
              </Section>
            )}

            {/* ----------------------------------------- the form's buttons */}
            {formMode && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {problems.length > 0 && (
                  <Alert severity="warning" variant="outlined">
                    <Box component="ul" sx={{ m: 0, pl: 4 }}>
                      {problems.map((p) => <li key={p}>{p}</li>)}
                    </Box>
                  </Alert>
                )}
                {notice && <Alert severity="success" variant="outlined" onClose={() => setNotice(null)}>{notice}</Alert>}
                {!readOnly && (
                  <Box sx={{
                    display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, alignItems: { xs: 'stretch', sm: 'center' }, gap: 2,
                  }}
                  >
                    <Button variant="outlined" onClick={() => save(null)} disabled={!!busy || !dirty} sx={phone ? { minHeight: 40 } : null}>
                      {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
                    </Button>
                    {!planIn && (
                      <Button variant="contained" onClick={() => save('plan')} disabled={!!busy} sx={phone ? { minHeight: 40 } : null}>
                        {busy === 'plan' ? 'Submitting…' : 'Submit plan'}
                      </Button>
                    )}
                    {planIn && !reportIn && showReport && (
                      <Button variant="contained" onClick={() => save('report')} disabled={!!busy} sx={phone ? { minHeight: 40 } : null}>
                        {busy === 'report' ? 'Submitting…' : 'Submit report'}
                      </Button>
                    )}
                    {planIn && (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {`Plan in ${bkk(mine.planSubmittedAt)}${reportIn ? `, report in ${bkk(mine.reportSubmittedAt)}` : ''}. You can still edit until the week locks.`}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* ------------------------------------------------ the team
            An administrator's: a member sees their own week and nobody else's. */}
        {admin && (
          <Section
            title="The team this week"
            meta={(data.team || []).length ? `${plural(required.length, 'person', 'people')} on the submit list.` : null}
            padded={false}
            sx={{ mt: draft ? { xs: 1, sm: 2 } : 0 }}
          >
            {(data.team || []).length === 0 && (
              <Box sx={{ px: 4 }}>
                <EmptyState inline title="Nobody is on the submit list." body="Add people to it on the Access page." />
              </Box>
            )}
            {(data.team || []).map((row, i) => {
              const isOpen = open.has(row.person)
              const e = row.entry
              const tj = teamJira[row.person]
              // A week run from Jira: counted against what is DUE (their Jira week), not only what was sent.
              const jiraRow = tj?.jira === 'on' || e?.mode === 'jira' || (e?.tasks || []).some((t) => t.source === 'jira')
              const total = e?.tasks?.length || 0
              const hold = e?.tasks?.filter((t) => t.hold).length || 0
              const done = e?.tasks?.filter((t) => !t.hold && t.done === true).length || 0
              const blocked = e?.tasks?.filter((t) => !t.hold && t.done === false).length || 0
              const due = tj?.jira === 'on' ? [...(tj.overdue || []), ...(tj.tasks || [])] : null
              const sentOn = due ? due.filter((t) => t.update).length : total
              const latest = jiraRow
                ? [...(e?.tasks || [])].filter((t) => t.progress).sort((a, b) => String(b.reportedAt || '').localeCompare(String(a.reportedAt || '')))[0] || null
                : null
              const tail = `${done ? `, ${done} finished` : ''}${blocked ? `, ${blocked} not finished` : ''}${hold ? `, ${hold} on hold` : ''}`
              const counts = jiraRow
                ? `${due ? `${sentOn} of ${plural(due.length, 'task')} updated` : tj === undefined && jira?.configured ? 'Reading Jira…' : `${plural(total, 'task')} updated`}${tail}`
                : total > 0 ? `${plural(total, 'task')}${tail}` : null
              const focusLine = jiraRow && !row.focus
                ? (latest ? `${latest.jiraKey || latest.title}: ${latest.progress}` : null)
                : row.focus
              const toggle = () => setOpen((s) => {
                const nx = new Set(s)
                if (nx.has(row.person)) nx.delete(row.person); else nx.add(row.person)
                return nx
              })
              return (
                <Box key={row.person} sx={{ borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
                  <Box sx={{
                    display: 'flex', alignItems: 'flex-start', gap: 3, px: { xs: 3, sm: 4 }, py: 2.5,
                  }}
                  >
                    <Box sx={{ pt: 0.25 }}><Avatar name={row.nick} /></Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{
                        display: 'flex', alignItems: 'center', columnGap: 3, rowGap: 1, flexWrap: 'wrap', minHeight: 28,
                      }}
                      >
                        <Typography
                          variant="body1"
                          sx={{
                            fontWeight: 500, minWidth: { md: 120 }, flexBasis: { xs: '100%', sm: 'auto' }, cursor: 'pointer',
                          }}
                          onClick={toggle}
                        >
                          {row.nick}
                          {row.person === data.person && <Box component="span" sx={{ color: 'text.tertiary', fontWeight: 400, ml: 1.5 }}>you</Box>}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'nowrap' }}>
                          <StandingPill label="Plan" value={row.standing?.plan} />
                          <StandingPill label="Report" value={row.standing?.report} />
                        </Box>
                        {counts && (
                          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-team-counts={jiraRow ? row.person : undefined}>
                            {counts}
                          </Typography>
                        )}
                      </Box>
                      {/* Collapsed: the focus they wrote — or, for a week run from Jira (which has no
                          focus), the latest update they sent. */}
                      {!isOpen && (
                        <Typography
                          variant="body2"
                          title={focusLine || undefined}
                          sx={{
                            color: focusLine ? 'text.secondary' : 'text.tertiary', mt: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          }}
                        >
                          {focusLine || (jiraRow ? 'No task updated yet.' : 'No focus written yet.')}
                        </Typography>
                      )}
                    </Box>
                    <Tooltip title={isOpen ? 'Hide their week' : 'Show their week'}>
                      <IconButton
                        size="small"
                        aria-label={`${isOpen ? 'hide' : 'show'} ${row.nick}'s week`}
                        aria-expanded={isOpen}
                        onClick={toggle}
                        sx={{ mr: -1, width: { xs: 40, sm: 32 }, height: { xs: 40, sm: 32 } }}
                      >
                        <ExpandMoreIcon fontSize="small" sx={{ transition: 'transform 180ms ease-out', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  <Collapse in={isOpen} unmountOnExit>
                    <Box sx={{ pl: { xs: 3, sm: 14 }, pr: { xs: 3, sm: 4 }, pb: 2, mt: -1 }}>
                      <WeekSummary entry={e} projectByKey={projectByKey} proposals={propsBy[row.person]} onShowTimeline={onShowTimeline} />
                    </Box>
                  </Collapse>
                </Box>
              )
            })}
          </Section>
        )}
      </Box>

      {jwReady && !readOnly && (
        <AdhocDialog
          open={adhocOpen}
          onClose={() => setAdhocOpen(false)}
          projects={projects}
          projectByKey={projectByKey}
          onSave={(item) => saveAdhoc([...draft.unplanned, item], 'Adhoc work saved.')}
        />
      )}
    </Box>
  )
}
