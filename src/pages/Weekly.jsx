import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, IconButton, Tooltip, Chip, Alert, TextField, MenuItem, Autocomplete,
  ToggleButton, ToggleButtonGroup, Divider, CircularProgress, Collapse, Stack, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import LockIcon from '@mui/icons-material/LockOutlined'
import TimelineIcon from '@mui/icons-material/ViewTimelineOutlined'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import AiAssist from '../components/AiAssist.jsx'
import Markdown from '../components/Markdown.jsx'
import { STATUS } from '../lib/palette.js'
import {
  Pill, IconTile, WelcomeBanner, personColor,
} from '../components/Brand.jsx'
import * as api from '../lib/api.js'
import {
  addWeeks, weekLabel, bangkokTime, STATUS_LABEL, PRIORITIES, BLOCKER_CATEGORIES, newTaskId,
  planProblems, reportProblems, cleanEntry, slipImpact, PROPOSAL_LABEL,
} from '../lib/weekly.js'

/**
 * THE WEEKLY CHECK-IN.
 *
 * Two halves of one page. Monday: what this week is about and the tasks that
 * make it up. Friday: how each of those went — finished or not, and if not,
 * what is in the way, when it will land instead, and whether that moves the
 * project. Below, the team: everybody's focus line for a team member; every
 * plan, report and blocker for an administrator.
 *
 * The server decides who sees what (see /api/weekly in server/index.js). This
 * page only lays out what it is sent.
 */

// Where somebody stands, as a pill colour. The word is always on the pill too.
const PILL_TONE = {
  open: 'neutral', missing: 'bad', ontime: 'good', late: 'warn',
}
// Must / should / nice, as the reference's HIGH / MEDIUM / LOW.
const PRIORITY_TONE = { must: 'high', should: 'medium', nice: 'low' }
const PRIORITY_LABEL = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]))
const CATEGORY_LABEL = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—')

function StandingChip({ label, value }) {
  if (!value) return null
  return <Pill label={`${label}: ${STATUS_LABEL[value]}`} tone={PILL_TONE[value]} />
}

function PriorityPill({ priority }) {
  if (!priority) return null
  return <Pill label={PRIORITY_LABEL[priority]} tone={PRIORITY_TONE[priority]} />
}

const SUMMARY_WHEN = {
  plan: 'after the Monday plans', report: 'after the Friday reports', second: 'after the Sunday second chance',
}

const PROPOSAL_TONE = {
  pending: 'violet', approved: 'good', rejected: 'bad', withdrawn: 'neutral', deciding: 'violet',
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
      : `Says ${p.projectKey}'s deadline (${fmtDay(p.currentDue)}) moves; the approver will pick the new date.`,
    deciding: 'Being decided now.',
    approved: `${p.projectKey} moved from ${fmtDay(p.fromDue)} to ${fmtDay(p.decidedDue)} by ${p.decidedBy || 'an administrator'}`
      + `${p.jira?.written ? `, and in Jira (${p.jira.key})` : ''}.`,
    rejected: `${p.projectKey} stays due ${fmtDay(p.currentDue)}. ${p.decidedBy || 'The approver'}: “${p.reason}”`,
  }[p.status]
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
      <Pill label={PROPOSAL_LABEL[p.status] || p.status} tone={PROPOSAL_TONE[p.status]} />
      <Typography variant="caption" sx={{ color: 'text.secondary', flex: '1 1 220px' }}>{text}</Typography>
    </Box>
  )
}

/** A small link from a task to its project's bar on the Timeline. */
function TimelineLink({ projectKey, onShow }) {
  if (!projectKey || !onShow) return null
  return (
    <Button
      size="small"
      startIcon={<TimelineIcon sx={{ fontSize: '16px !important' }} />}
      onClick={() => onShow(projectKey)}
      sx={{ py: 0, minHeight: 0, fontSize: '0.72rem' }}
    >
      Timeline
    </Button>
  )
}

/*
 * ONE PROPOSAL, AS THE APPROVER SEES IT.
 *
 * Everything needed to decide without opening anything else: who, which task,
 * the project's date now and the date asked for, what is in the way, and
 * whether the dates and the member agree. Then a date (filled in with the one
 * asked for, and changeable), Approve, and Reject — which asks for a reason,
 * because a member told "no" without one cannot do anything with it.
 */
function DecisionCard({
  p, people, jira, onApprove, onReject, busy, onShowTimeline,
}) {
  const [due, setDue] = useState(p.proposedDue || '')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const now = p.projectDueNow
  const moved = now && p.currentDue && now !== p.currentDue
  const days = due && now ? Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${now}T00:00:00Z`)) / 86400000) : null
  const blockedJira = p.epicKey && jira?.configured && !jira?.writable
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <IconTile text={(p.nick || '?').slice(0, 2)} color={personColor(people, p.person)} size={32} />
        <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {p.nick} · {p.taskTitle}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {p.projectKey}{p.projectSummary ? ` · ${p.projectSummary}` : ''} · week of {weekLabel(p.week)}
          </Typography>
        </Box>
        {p.disagree && <Pill label="dates and member disagree" tone="warn" />}
        <TimelineLink projectKey={p.projectKey} onShow={onShowTimeline} />
      </Box>

      <Typography variant="body2">
        Project due <strong>{fmtDay(now)}</strong>
        {moved && <Box component="span" sx={{ color: 'text.secondary' }}> (was {fmtDay(p.currentDue)} when this was raised)</Box>}
        {p.proposedDue
          ? <> · task now lands <strong>{fmtDay(p.newDate)}</strong>{p.byDate ? `, ${p.byDate} day${p.byDate === 1 ? '' : 's'} late` : ''}</>
          : <> · task now lands {fmtDay(p.newDate)}, inside the due date — but {p.nick} says the deadline moves</>}
      </Typography>
      {p.blocker && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {p.blockerCategory && <Pill label={CATEGORY_LABEL[p.blockerCategory]} tone="neutral" />}
          <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap', flex: '1 1 220px' }}>{p.blocker}</Typography>
        </Box>
      )}

      {!rejecting ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
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
          <Button variant="contained" disabled={!!busy || !due} onClick={() => onApprove(p, due)}>
            {busy === `approve:${p.id}` ? 'Approving…' : 'Approve'}
          </Button>
          <Button color="error" disabled={!!busy} onClick={() => setRejecting(true)}>Reject</Button>
          {days !== null && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {days > 0 ? `moves it ${days} day${days === 1 ? '' : 's'} later` : days < 0 ? `moves it ${-days} days EARLIER` : 'no change'}
            </Typography>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
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
          <Button color="error" variant="contained" disabled={!!busy || reason.trim().length < 3} onClick={() => onReject(p, reason)}>
            {busy === `reject:${p.id}` ? 'Rejecting…' : 'Reject'}
          </Button>
          <Button disabled={!!busy} onClick={() => setRejecting(false)}>Cancel</Button>
        </Box>
      )}
      <Typography variant="caption" sx={{ color: blockedJira ? STATUS.warning : 'text.secondary' }}>
        {p.epicKey
          ? (blockedJira
            ? `${p.epicKey} is in Jira and this server is not allowed to write to Jira, so approving is refused until `
              + 'JIRA_ALLOW_WRITES=true is set in the Render dashboard — otherwise the 07:00 sync would put the old date back.'
            : jira?.configured
              ? `Approving also writes the new due date to ${p.epicKey} in Jira. It counts as a re-plan: the first one on a project is free.`
              : 'Approving moves the project here. It counts as a re-plan: the first one on a project is free.')
          : 'This project has no Jira epic, so approving moves it here only. It counts as a re-plan: the first one is free.'}
      </Typography>
    </Paper>
  )
}

const blankTask = () => ({
  id: newTaskId(), title: '', projectKey: null, jiraKey: null, expected: null, effort: null, priority: null,
  carriedFrom: null, done: null, pct: null, blocker: '', blockerCategory: null, newDate: null, affects: null,
})

/* ------------------------------------------------------------ one task */

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
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>Task {index + 1}</Typography>
        <PriorityPill priority={task.priority} />
        {task.carriedFrom && (
          <Tooltip title="Not finished last time, so it was carried into this week">
            <Chip size="small" label={`carried from ${fmtDay(task.carriedFrom)}`} sx={{ height: 20 }} />
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {!readOnly && (
          <IconButton size="small" onClick={onRemove} aria-label={`remove task ${index + 1}`}>
            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
          </IconButton>
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
        display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'minmax(0,2fr) minmax(0,1.4fr)' },
      }}
      >
        <Autocomplete
          size="small"
          options={projects}
          value={project || null}
          disabled={readOnly}
          onChange={(_e, v) => set({ projectKey: v?.key || null, jiraKey: null })}
          getOptionLabel={(p) => `${p.key} · ${p.summary}`}
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
          getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.key} · ${o.summary}`)}
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
        display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, minmax(0,1fr))' },
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
          inputProps={{ min: 0, max: 99, step: 0.5, inputMode: 'decimal' }}
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Project due {fmtDay(project.due)}
            {task.expected && project.due && task.expected > project.due && (
              <Box component="span" sx={{ color: STATUS.warning, fontWeight: 600 }}>
                {' '}· this task is expected after the project&rsquo;s due date
              </Box>
            )}
          </Typography>
          <TimelineLink projectKey={project.key} onShow={onShowTimeline} />
        </Box>
      )}
      <ProposalNote proposal={proposal} />

      {showReport && (
        <>
          <Divider />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>This week</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={task.done === null ? null : task.done ? 'done' : 'not'}
              onChange={(_e, v) => {
                if (v === null) return
                set(v === 'done'
                  ? { done: true, pct: 100 }
                  : { done: false, pct: task.pct === 100 ? null : task.pct })
              }}
              disabled={readOnly}
            >
              <ToggleButton value="done" sx={{ textTransform: 'none', px: 1.5 }}>Finished</ToggleButton>
              <ToggleButton value="not" sx={{ textTransform: 'none', px: 1.5 }}>Not finished</ToggleButton>
            </ToggleButtonGroup>
            {jiraHint && (
              <Typography variant="caption" sx={{ color: STATUS.good }}>
                {jiraHint}
              </Typography>
            )}
          </Box>

          {task.done === false && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{
                display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, minmax(0,1fr))' },
              }}
              >
                <TextField
                  size="small"
                  type="number"
                  label="% done"
                  value={task.pct ?? ''}
                  onChange={(e) => set({ pct: e.target.value === '' ? null : Number(e.target.value) })}
                  disabled={readOnly}
                  inputProps={{ min: 0, max: 100, step: 5, inputMode: 'numeric' }}
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
              <AiAssist
                available={aiOn}
                disabled={readOnly}
                field="blocker"
                text={task.blocker}
                onText={(t) => set({ blocker: t })}
                task={{ title: task.title, newDate: task.newDate, projectDue: project?.due || null }}
                onSuggest={(sg) => set({ blockerCategory: sg.category, ...(sg.affects !== null ? { affects: sg.affects } : {}) })}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
                <Typography variant="body2">Does this push the project&rsquo;s deadline?</Typography>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={task.affects === null ? null : task.affects ? 'yes' : 'no'}
                  onChange={(_e, v) => { if (v !== null) set({ affects: v === 'yes' }) }}
                  disabled={readOnly}
                >
                  <ToggleButton value="yes" sx={{ textTransform: 'none', px: 1.5 }}>Yes</ToggleButton>
                  <ToggleButton value="no" sx={{ textTransform: 'none', px: 1.5 }}>No</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {impact.byDate !== null && (
                <Alert severity={impact.disagree ? 'warning' : 'info'} sx={{ py: 0 }}>
                  The new date is {impact.byDate} day{impact.byDate === 1 ? '' : 's'} after the project&rsquo;s due
                  date ({fmtDay(project?.due)}).
                  {impact.disagree && ' You answered that it does not push the deadline — your manager will see both.'}
                </Alert>
              )}
              {impact.byDate === null && impact.disagree && (
                <Alert severity="warning" sx={{ py: 0 }}>
                  The new date is still inside the project&rsquo;s due date ({fmtDay(project?.due)}), but you answered
                  that it pushes the deadline — your manager will see both.
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

/** An administrator's view of somebody else's week. */
function WeekSummary({
  entry, projectByKey, proposals = {}, onShowTimeline,
}) {
  if (!entry) {
    return <Typography variant="body2" sx={{ color: 'text.disabled' }}>Nothing saved for this week.</Typography>
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {entry.focus && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{entry.focus}</Typography>
      )}
      {entry.tasks.map((t) => {
        const p = t.projectKey ? projectByKey[t.projectKey] : null
        const impact = slipImpact(t, p?.due)
        return (
          <Box key={t.id} sx={{ borderLeft: 3, borderColor: t.done === true ? STATUS.good : t.done === false ? STATUS.warning : 'divider', pl: 1.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.title}</Typography>
              <PriorityPill priority={t.priority} />
              {t.carriedFrom && <Pill label="carried" tone="violet" />}
              <TimelineLink projectKey={t.projectKey} onShow={onShowTimeline} />
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {[
                t.projectKey && `${t.projectKey}${p ? ` · ${p.summary}` : ''}`,
                t.jiraKey,
                `expected ${fmtDay(t.expected)}`,
                t.effort !== null && `${t.effort} d`,
              ].filter(Boolean).join(' · ')}
            </Typography>
            {t.done === true && <Typography variant="caption" sx={{ color: STATUS.good }}>Finished</Typography>}
            {t.done === false && (
              <Box>
                <Typography variant="caption" sx={{ color: STATUS.warning, display: 'block' }}>
                  Not finished{t.pct !== null ? ` · ${t.pct}%` : ''} · new date {fmtDay(t.newDate)}
                  {t.blockerCategory ? ` · ${CATEGORY_LABEL[t.blockerCategory]}` : ''}
                  {t.affects !== null ? ` · ${t.affects ? 'says it pushes the deadline' : 'says the deadline holds'}` : ''}
                </Typography>
                {t.blocker && (
                  <Typography variant="caption" sx={{ display: 'block', whiteSpace: 'pre-wrap' }}>
                    Blocker: {t.blocker}
                  </Typography>
                )}
                {impact.byDate !== null && (
                  <Typography variant="caption" sx={{ color: STATUS.critical, display: 'block', fontWeight: 600 }}>
                    {impact.byDate} day{impact.byDate === 1 ? '' : 's'} past the project&rsquo;s due date ({fmtDay(p?.due)})
                  </Typography>
                )}
                {impact.disagree && (
                  <Typography variant="caption" sx={{ color: STATUS.critical, display: 'block', fontWeight: 600 }}>
                    The dates and the member disagree on whether the deadline moves.
                  </Typography>
                )}
                <Box sx={{ mt: 0.5 }}><ProposalNote proposal={proposals[t.id]} /></Box>
              </Box>
            )}
          </Box>
        )
      })}
      {entry.unplanned?.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>Unplanned work</Typography>
          {entry.unplanned.map((u) => (
            <Typography key={u.id} variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
              • {u.title}{u.projectKey ? ` (${u.projectKey})` : ''}{u.effort !== null ? ` · ${u.effort} d` : ''}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  )
}

/* ------------------------------------------------------------ the page */

export default function Weekly({
  plan, me, hello = 'there', onProjectsChanged, onShowTimeline,
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
  const asked = useRef(new Set())
  const myWeekRef = useRef(null)
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

  const projects = useMemo(
    () => (plan?.projects || []).filter((p) => !p.deleted).map((p) => ({
      key: p.key, summary: p.summary || '', due: p.due || null, jiraKey: p.jiraKey || null,
    })),
    [plan],
  )
  const projectByKey = useMemo(() => Object.fromEntries(projects.map((p) => [p.key, p])), [projects])

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

  useEffect(() => { load(week) }, [week])

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
          + `${r.proposal.jira?.written ? ` — written to ${r.proposal.jira.key} in Jira too` : ''}.`)
      } else {
        await api.rejectProposal(p.id, arg)
        setNotice(`Rejected — ${p.nick} will see your reason.`)
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
      setNotice(submit === 'plan' ? 'Plan submitted.' : submit === 'report' ? 'Report submitted.' : 'Saved.')
      await load(data.week)
    } catch (e) {
      setError(e.message)
      setProblems(e.problems || [])
    } finally {
      setBusy(null)
    }
  }

  const go = (n) => {
    if (dirty && !window.confirm('You have unsaved changes on this week. Leave them?')) return
    setWeek(addWeeks(data.week, n))
  }

  if (!data && !error) {
    return <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}><CircularProgress size={28} /></Box>
  }

  const d = data?.deadlines
  const mine = data?.mine
  const readOnly = !data?.writable
  const planIn = !!mine?.planSubmittedAt
  const reportIn = !!mine?.reportSubmittedAt
  // The report half appears once there is a plan to report on, or once Friday
  // has come — whichever is first, so a plan never submitted can still be
  // reported against when the week is nearly over.
  const showReport = planIn || (d && data.now >= d.reportDue - 2 * 86400_000)

  /*
   * THE ONE THING TO DO NEXT, said in the banner. Worked out from where this
   * person's own week stands; an administrator who does not submit is told
   * how the team is doing instead.
   */
  const toMyWeek = () => myWeekRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // This week's proposals, by person and task, for the notes on each task.
  const propsBy = {}
  for (const p of data?.proposals || []) {
    propsBy[p.person] = propsBy[p.person] || {}
    propsBy[p.person][p.taskId] = p
  }
  const required = (data?.team || []).filter((r) => r.required)
  const plansIn = required.filter((r) => r.entry?.planSubmittedAt).length
  const next = (() => {
    if (!data) return null
    if (data.locked) return { label: 'This week is closed', sub: 'It locked at 08:00 the following Monday and is kept as the record.' }
    if (!data.person) {
      return admin
        ? { label: `${plansIn} of ${required.length} plans in`, sub: 'Open anybody below to read their week.' }
        : { label: 'Your account is not linked yet', sub: 'Ask an administrator to link it to your name on the Access tab.' }
    }
    if (!planIn) return { label: 'Send your plan for the week', sub: `Due ${bangkokTime(d.planDue)}, Bangkok time`, onClick: toMyWeek }
    if (!reportIn) return { label: 'Report how the week went', sub: `Due ${bangkokTime(d.reportDue)} — Sunday 15:00 is the second chance`, onClick: toMyWeek }
    return { label: 'All in for this week — thank you', sub: 'You can still edit until it locks.', onClick: toMyWeek }
  })()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {data && (
        <WelcomeBanner
          eyebrow={`Weekly check-in · week of ${weekLabel(data.week)}`}
          title={`Hello ${hello}`}
          subtitle={admin && required.length
            ? `${plansIn} of ${required.length} plans are in for this week.`
            : 'Your plan on Monday, how it went on Friday. Everything is in Bangkok time.'}
          next={next}
        />
      )}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 260 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            The plan for the week is due <strong>Monday 08:00</strong>; how it went is due <strong>Friday 15:00</strong>,
            with Sunday 15:00 as the second chance. A week stays editable until the next Monday 08:00. Bangkok time.
          </Typography>
        </Box>
        {data && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <IconButton onClick={() => go(-1)} aria-label="previous week"><ChevronLeftIcon /></IconButton>
            <Box sx={{ textAlign: 'center', minWidth: 150 }}>
              <Typography variant="h4">Week of {weekLabel(data.week)}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {data.week === data.current ? 'this week' : data.week > data.current ? 'next week' : 'past week'}
              </Typography>
            </Box>
            <IconButton
              onClick={() => go(1)}
              disabled={data.week > data.current}
              aria-label="next week"
            >
              <ChevronRightIcon />
            </IconButton>
            {data.week !== data.current && (
              <Button size="small" onClick={() => { if (!dirty || window.confirm('Leave unsaved changes?')) setWeek(data.current) }}>
                This week
              </Button>
            )}
          </Box>
        )}
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {/* Here as well as under My week: an administrator with no week of
          their own still needs to see that a decision went through. */}
      {notice && !draft && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      {data && !data.person && (
        <Alert severity="info">
          {admin
            ? 'Your account is not linked to anybody on the team, so there is no week of your own to fill in. Link it on the Access tab if you submit too.'
            : 'Your account is not linked to your name on the team yet, so the app cannot tell which week is yours. Ask an administrator to link it on the Access tab.'}
        </Alert>
      )}

      {/* ------------------------------------------- waiting for a decision */}
      {admin && pending && pending.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography variant="h3">Waiting for your decision</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>{pending.length}</Typography>
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: -0.75 }}>
            A task reported late that moves its project. Approve to move the project&rsquo;s due date — here and in Jira —
            or reject with a reason.
          </Typography>
          {pending.map((p) => (
            <DecisionCard
              key={`${p.id}:${p.updatedAt}`}
              p={p}
              people={plan?.people}
              jira={jira}
              busy={deciding}
              onApprove={(x, due) => decide('approve', x, due)}
              onReject={(x, why) => decide('reject', x, why)}
              onShowTimeline={onShowTimeline}
            />
          ))}
        </Box>
      )}

      {/* ------------------------------------------------ the AI summary */}
      {admin && summary?.ai && (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <AutoAwesomeIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            <Typography variant="h3">The week, summarised</Typography>
            {summary.summaries[0] && (
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                written {new Date(summary.summaries[0].writtenAt).toLocaleString('en-GB', {
                  timeZone: 'Asia/Bangkok', weekday: 'short', hour: '2-digit', minute: '2-digit',
                })}
                {' '}{SUMMARY_WHEN[summary.summaries[0].trigger]}
              </Typography>
            )}
          </Box>
          {summary.summaries[0]
            ? <Markdown text={summary.summaries[0].text} />
            : (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                The AI writes this by itself once each deadline has passed — Monday 08:00, Friday 15:00 and Sunday 15:00 —
                and emails it to the administrators.
              </Typography>
            )}
          {summary.summaries[0] && (
            <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1 }}>
              Written by AI from what the team submitted. Check anything you act on against the week below.
            </Typography>
          )}
        </Paper>
      )}

      {/* ---------------------------------------------------- my week */}
      {data && draft && (
        <Paper ref={myWeekRef} variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, display: 'flex', flexDirection: 'column', gap: 2, scrollMarginTop: 96 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="h3" sx={{ mr: 1 }}>My week</Typography>
            <StandingChip label="Plan" value={data.mineStanding?.plan} />
            <StandingChip label="Report" value={data.mineStanding?.report} />
            {data.locked && <Chip size="small" icon={<LockIcon />} label="Locked" />}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: -1 }}>
            Plan due {bangkokTime(d.planDue)} · report due {bangkokTime(d.reportDue)} · locks {bangkokTime(d.locksAt)}
          </Typography>

          {mine?.draft && draft.tasks.length > 0 && (
            <Alert severity="info" sx={{ py: 0 }}>
              {draft.tasks.length} unfinished task{draft.tasks.length === 1 ? '' : 's'} carried over from last week.
              Edit, remove or add to them — nothing is saved until you save.
            </Alert>
          )}
          {data.locked && (
            <Alert severity="info" sx={{ py: 0 }}>This week is locked and kept as the record.</Alert>
          )}

          <TextField
            label="This week I'm focused on…"
            value={draft.focus}
            onChange={(e) => edit({ focus: e.target.value })}
            disabled={readOnly}
            multiline
            minRows={2}
            maxRows={8}
            fullWidth
            helperText={readOnly ? undefined : 'A few sentences. This is what the team and your manager see first.'}
          />
          <AiAssist available={aiOn} disabled={readOnly} field="focus" text={draft.focus} onText={(t) => edit({ focus: t })} />

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {draft.tasks.map((t, i) => (
              <TaskEditor
                key={t.id}
                task={t}
                index={i}
                projects={projects}
                projectByKey={projectByKey}
                onChange={(next) => editTask(i, next)}
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
            ))}
            {!readOnly && (
              <Button
                startIcon={<AddIcon />}
                onClick={() => edit({ tasks: [...draft.tasks, blankTask()] })}
                sx={{ alignSelf: 'flex-start' }}
              >
                Add a task
              </Button>
            )}
          </Box>

          {showReport && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="h4">Unplanned work</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: -0.5 }}>
                Anything that took your time this week and was not in Monday&rsquo;s plan.
              </Typography>
              {draft.unplanned.map((u, i) => (
                <Box
                  key={u.id}
                  sx={{
                    display: 'grid', gap: 1, alignItems: 'center',
                    gridTemplateColumns: { xs: '1fr 88px 40px', sm: 'minmax(0,3fr) minmax(0,2fr) 110px 40px' },
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
                    value={u.projectKey ? projectByKey[u.projectKey] || null : null}
                    disabled={readOnly}
                    onChange={(_e, v) => edit({ unplanned: draft.unplanned.map((x, j) => (j === i ? { ...x, projectKey: v?.key || null } : x)) })}
                    getOptionLabel={(p) => `${p.key} · ${p.summary}`}
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
                    <IconButton size="small" onClick={() => edit({ unplanned: draft.unplanned.filter((_x, j) => j !== i) })} aria-label="remove unplanned work">
                      <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  ) : <span />}
                </Box>
              ))}
              {!readOnly && (
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => edit({ unplanned: [...draft.unplanned, { id: newTaskId(), title: '', projectKey: null, effort: null }] })}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Add unplanned work
                </Button>
              )}
            </Box>
          )}

          {problems.length > 0 && (
            <Alert severity="warning">
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {problems.map((p) => <li key={p}>{p}</li>)}
              </Box>
            </Alert>
          )}
          {notice && <Alert severity="success" onClose={() => setNotice(null)} sx={{ py: 0 }}>{notice}</Alert>}

          {!readOnly && (
            <Stack direction={phone ? 'column' : 'row'} spacing={1} sx={{ alignItems: phone ? 'stretch' : 'center' }}>
              <Button variant="outlined" onClick={() => save(null)} disabled={!!busy || !dirty}>
                {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
              </Button>
              {!planIn && (
                <Button variant="contained" onClick={() => save('plan')} disabled={!!busy}>
                  {busy === 'plan' ? 'Submitting…' : 'Submit plan'}
                </Button>
              )}
              {planIn && !reportIn && showReport && (
                <Button variant="contained" onClick={() => save('report')} disabled={!!busy}>
                  {busy === 'report' ? 'Submitting…' : 'Submit report'}
                </Button>
              )}
              {planIn && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Plan in {new Date(mine.planSubmittedAt).toLocaleString()}
                  {reportIn && ` · report in ${new Date(mine.reportSubmittedAt).toLocaleString()}`}
                  {' '}· you can still edit until it locks
                </Typography>
              )}
            </Stack>
          )}
        </Paper>
      )}

      {/* ---------------------------------------------------- the team */}
      {data && (
        <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="h3">{admin ? 'The team this week' : 'What the team is focused on'}</Typography>
          {data.team.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>Nobody is on the submit list.</Typography>
          )}
          {data.team.map((row) => {
            const isOpen = open.has(row.person)
            const e = row.entry
            const total = e?.tasks?.length || 0
            const done = e?.tasks?.filter((t) => t.done === true).length || 0
            const blocked = e?.tasks?.filter((t) => t.done === false).length || 0
            return (
              <Box key={row.person} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.25 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <IconTile text={row.nick.slice(0, 2)} color={personColor(plan?.people, row.person)} size={30} />
                  <Typography variant="body2" sx={{ fontWeight: 700, minWidth: 80 }}>
                    {row.nick}
                    {row.person === data.person && <Chip size="small" label="you" sx={{ ml: 0.75, height: 18, fontSize: '0.65rem' }} />}
                  </Typography>
                  {admin && <StandingChip label="Plan" value={row.standing?.plan} />}
                  {admin && <StandingChip label="Report" value={row.standing?.report} />}
                  {admin && total > 0 && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {total} task{total === 1 ? '' : 's'}{done ? ` · ${done} finished` : ''}{blocked ? ` · ${blocked} not finished` : ''}
                    </Typography>
                  )}
                  <Box sx={{ flex: 1 }} />
                  {admin && (
                    <IconButton
                      size="small"
                      aria-label={`${isOpen ? 'hide' : 'show'} ${row.nick}'s week`}
                      onClick={() => setOpen((s) => {
                        const n = new Set(s)
                        if (n.has(row.person)) n.delete(row.person); else n.add(row.person)
                        return n
                      })}
                    >
                      {isOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                    </IconButton>
                  )}
                </Box>
                {!isOpen && (
                  <Typography
                    variant="body2"
                    sx={{
                      color: row.focus ? 'text.primary' : 'text.disabled', mt: 0.5, whiteSpace: 'pre-wrap',
                    }}
                  >
                    {row.focus || 'No focus written yet.'}
                  </Typography>
                )}
                {admin && (
                  <Collapse in={isOpen} unmountOnExit>
                    <Box sx={{ mt: 1 }}>
                      <WeekSummary entry={e} projectByKey={projectByKey} proposals={propsBy[row.person]} onShowTimeline={onShowTimeline} />
                    </Box>
                  </Collapse>
                )}
              </Box>
            )
          })}
        </Paper>
      )}
    </Box>
  )
}
