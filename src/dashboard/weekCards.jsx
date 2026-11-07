import { useState } from 'react'
import {
  Box, Typography, Button, ButtonBase, Table, TableBody, TableCell, TableHead, TableRow,
  Link, ToggleButton, ToggleButtonGroup, Tooltip, LinearProgress, TextField,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import EventRepeatIcon from '@mui/icons-material/EventRepeatOutlined'
import HelpIcon from '@mui/icons-material/HelpOutlineOutlined'
import StatTile from '../components/StatTile.jsx'
import Markdown from '../components/Markdown.jsx'
import FollowUp, { ago } from '../components/FollowUp.jsx'
import {
  Pill, IconTile, personColor, PILL,
} from '../components/Brand.jsx'
import {
  STATUS_LABEL, weekNo, weekTitle, bangkokTime, BLOCKER_CATEGORIES, addWeeks,
} from '../lib/weekly.js'
import {
  projectCounts, updatedCount, ownerRows, reportedWeek, blockersByType, slipping, workload, submissionTrend,
  activeWords, ACTIVE_WHY,
} from '../lib/manager.js'
import CardFrame from './CardFrame.jsx'
import Loading from '../components/Loading.jsx'

/*
 * THE MANAGER'S CARDS: what is active, what has been updated this week, who
 * holds what and where it stands, with a follow-up a click away — and the
 * weekly check-in at a glance. Everything is worked out in lib/manager.js
 * from the same weeks the Weekly page reads.
 */

const TONE = {
  open: 'neutral', missing: 'bad', ontime: 'good', late: 'warn',
}
const WHEN = {
  plan: 'after the Monday plans', report: 'after the Friday reports', second: 'after the Sunday second chance',
}
const STARTERS = [
  'Which projects are past due, and who holds them?',
  'What is blocking the team this week?',
  'Which costed projects are below the ROI gate?',
]
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '—')

/** What a card shows while the weeks load, or when the database is not there. */
function Waiting({ ctx, rows = 3 }) {
  if (ctx.now === null) {
    return <Typography variant="body2" sx={{ color: 'text.disabled' }}>The weekly check-ins could not be read just now.</Typography>
  }
  return <Loading variant="block" label={rows > 3 ? 'Loading the week…' : 'Loading…'} />
}

const ProjectLink = ({ p, onOpen }) => (
  <Link component="button" onClick={() => onOpen?.(p.key)} sx={{ fontWeight: 650, textAlign: 'left', color: 'text.primary' }} underline="hover">
    {p.summary || p.key}
  </Link>
)

/* --------------------------------------------------------------- counts */

/** "this week", or "week 44" for a week picked from the switcher. */
const weekWord = (ctx) => (ctx.isCurrent === false && ctx.now ? `week ${weekNo(ctx.now.week)}` : 'this week')

export const ACTIVE_HELP = 'A project is active in a week, automatically, when any of these is true: its start-to-due dates '
  + 'cover the week; an epic or task under it in Jira has dates covering the week; somebody sent an update on it that week; '
  + 'or a decision asked for on one of its tasks is still open. An administrator can override that either way '
  + '(Always / Never) on the Timeline or the project page. Register lines on the same Jira epic count once. The total '
  + 'counts every project in the register, active or not.'

/** The figure cards wait for the plan and for every signal, rather than showing a number that then changes. */
const figureLoading = (ctx) => ctx.planLoading || ctx.now === undefined || !ctx.signalsReady

export function ActiveCard({ ctx, f }) {
  const week = ctx.now?.week
  const c = projectCounts(ctx.plan.projects, week || undefined, ctx.signals)
  const when = weekWord(ctx)
  return (
    <CardFrame {...f} bare title="Active projects">
      {figureLoading(ctx) ? (
        <StatTile label="Active projects" value={<Loading label="Loading…" />} unit="" context="Reading the week, and Jira" help={ACTIVE_HELP} />
      ) : (
        <StatTile
          label="Active projects"
          value={c.active}
          unit={`of ${c.total} in the register`}
          context={c.active
            ? `${activeWords(c, when)} · ${week ? `week ${weekNo(week)}` : 'this week'}`
            : `Nothing covers ${when}: no dates, no Jira work, no update — switch one on in the Timeline`}
          help={ACTIVE_HELP + (ctx.nowJiraError ? ` Jira could not be read just now, so Jira work is not counted: ${ctx.nowJiraError}` : '')}
        />
      )}
    </CardFrame>
  )
}

export function UpdatedCard({ ctx, f }) {
  const { now } = ctx
  const { updated, active } = updatedCount(ctx.plan.projects, now, ctx.signals)
  const planDue = now?.deadlines?.planDue
  const early = !now || now.now < planDue
  const share = active ? updated / active : 0
  // Named for the week on screen: "Updated this week", or "Updated in week 44".
  const label = ctx.isCurrent === false && now ? `Updated in week ${weekNo(now.week)}` : 'Updated this week'
  return (
    <CardFrame {...f} bare title="Updated this week">
      {figureLoading(ctx) && now !== null ? (
        <StatTile label={label} value={<Loading label="Loading…" />} unit="" context="Reading the week, and Jira" />
      ) : (
        <StatTile
          label={label}
          value={now ? updated : '—'}
          unit={`of ${active} active`}
          tone={early || !active ? undefined : share >= 1 ? 'good' : share >= 0.5 ? 'warning' : 'critical'}
          context={now
            ? `${Math.max(0, active - updated)} not updated yet · ${weekTitle(now.week)}`
            : 'The weekly check-ins could not be read'}
          help="An active project counts as updated when somebody sent an update on a task under it that week (or, in the form, saved a task linked to it). Follow up from “Who holds what” to ask for one."
        />
      )}
    </CardFrame>
  )
}

/* ---------------------------------------------------------- the owners */

/** What somebody wrote about a task, three lines at most until clicked. */
function UpdateText({ text }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 180
  return (
    <Typography
      variant="body2"
      data-update-text
      onClick={long ? () => setOpen((o) => !o) : undefined}
      title={long && !open ? 'Click to read it all' : undefined}
      sx={{
        color: 'text.secondary',
        mt: 0.5,
        pl: 1,
        borderLeft: 2,
        borderColor: 'divider',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.45,
        cursor: long ? 'pointer' : 'default',
        ...(!open && {
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }),
      }}
    >
      {text}
    </Typography>
  )
}

/*
 * A project's tasks in one week: each with where it stands (Done, Not done,
 * On hold, or no answer yet), who holds it, and what they wrote about it.
 */
function TaskList({ tasks, empty, kind }) {
  if (!tasks.length) return <Typography variant="caption" sx={{ color: 'text.disabled' }}>{empty}</Typography>
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {tasks.map((t) => {
        // Answered: a report came in (or, last week, Jira already says Done).
        const answered = t.done != null || !!t.reportedAt || !!t.progress
        const hold = t.hold || (t.done === false && /^on hold$/i.test(String(t.blocker || '').trim()))
        const why = t.done === false ? (t.reason || t.blocker || '') : ''
        return (
          <Box key={`${t.person}.${t.id}`} sx={{ minWidth: 0 }} data-week-task={t.jiraKey || t.id}>
            <Typography variant="body2" sx={{ lineHeight: 1.35 }}>{t.title}</Typography>
            <Box sx={{
              display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', mt: 0.25,
            }}
            >
              {hold && <Pill label="On hold" tone="warn" />}
              {!hold && t.done === true && <Pill label="Done" tone="good" />}
              {!hold && t.done === false && <Pill label={`Not done${t.pct != null ? ` · ${t.pct}%` : ''}`} tone="warn" />}
              {!hold && t.done == null && (kind === 'last' || !answered) && <Pill label={kind === 'last' ? 'No answer' : 'Planned'} tone="neutral" />}
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t.nick}
                {kind === 'this' && t.expected ? ` · expected ${fmtDay(t.expected)}` : ''}
                {t.done === false && t.newDate ? ` · now ${fmtDay(t.newDate)}` : ''}
                {/* Nobody wrote about it that week: what shows is Jira's status today. */}
                {t.statusToday ? ' · (status today)' : ''}
              </Typography>
            </Box>
            {t.progress && <UpdateText text={t.progress} />}
            {why && !/^on hold$/i.test(why.trim()) && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
                {hold ? 'Why on hold' : 'In the way'}: {why}
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/** The follow-up for one row, or why there is none. */
function RowFollowUp({ ctx, g, p, compact = true }) {
  if (!g.person) return <Typography variant="caption" sx={{ color: 'text.disabled' }}>No owner to ask</Typography>
  // Does the owner hold any Jira work under it this week? If not, the email says to add a task.
  const theirs = (p.keys || [p.key]).flatMap((k) => ctx.nowJira?.[k] || []).filter((t) => t.holder === g.nick || t.update?.nick === g.nick)
  const note = ctx.nowJira && !theirs.length && !p.thisWeek.some((t) => t.person === g.person)
    ? `${g.nick} has no task on it in Jira this week, so the email asks them to add one from their Weekly page.`
    : null
  const off = p.onHold ? 'On hold — no update needed'
    : ctx.isCurrent === false ? 'Follow-ups ask about this week' : null
  return (
    <FollowUp compact={compact} projectKey={p.key} followup={p.followup} onSent={ctx.onFollowSent} owner={g.nick} summary={p.summary} note={note} off={off} />
  )
}

/** Under a project's name: its key, due date, why it is on the list, how many register lines. */
function RowFacts({ p }) {
  return (
    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
      {p.jiraKey || p.key} · due {fmtDay(p.due)}
      {p.why && p.why !== 'dates' ? ` · ${ACTIVE_WHY[p.why]}` : ''}
      {p.lines > 1 ? ` · ${p.lines} register lines` : ''}
      {p.onHold ? ' · on hold' : ''}
    </Typography>
  )
}

export function OwnersCard({ ctx, f }) {
  const [only, setOnly] = useState('all')
  const groups = ownerRows({
    projects: ctx.plan.projects,
    people: ctx.plan.assignees || ctx.plan.people,
    now: ctx.now,
    prev: ctx.prev,
    followups: ctx.followups,
    prevJira: ctx.prevJira || null,
    signals: ctx.signals,
  })
  // Last week comes from Jira a moment after the rest: a spinner until it does.
  const lastLoading = ctx.prevJira === undefined
  const shown = groups
    .map((g) => ({ ...g, projects: only === 'stale' ? g.projects.filter((p) => !p.thisWeek.length) : g.projects }))
    .filter((g) => g.projects.length)
  const count = groups.reduce((a, g) => a + g.projects.length, 0)
  const past = ctx.isCurrent === false
  const prevNo = ctx.prev ? weekNo(ctx.prev.week) : ctx.now ? weekNo(addWeeks(ctx.now.week, -1)) : ''
  const lastHead = `${past ? 'Week before' : 'Last week'}${prevNo ? ` · week ${prevNo}` : ''}`
  const thisHead = ctx.now ? `${past ? 'Week' : 'This week · week'} ${weekNo(ctx.now.week)}` : ''
  const lastEmpty = ctx.prevJira ? `Nothing in Jira covered week ${prevNo}` : `No task in week ${prevNo}`
  const loading = ctx.now === undefined || ctx.planLoading || (ctx.now && !ctx.signalsReady)
  return (
    <CardFrame
      {...f}
      title="Who holds what"
      label="who holds what"
      sub={ctx.now && !loading ? `${count} active project${count === 1 ? '' : 's'} by owner, ${past ? `week ${weekNo(ctx.now.week)}` : 'this week'} — the week before, the week, and a follow-up a click away` : undefined}
      action={(
        <ToggleButtonGroup size="small" exclusive value={only} onChange={(_e, v) => v && setOnly(v)}>
          <ToggleButton value="all" sx={{ textTransform: 'none', px: 1.5 }}>All</ToggleButton>
          <ToggleButton value="stale" sx={{ textTransform: 'none', px: 1.5 }}>Not updated</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      {ctx.now === null ? <Waiting ctx={ctx} /> : loading ? <Loading variant="block" label="Loading the week, and Jira…" /> : (
        <>
          {count === 0 && (
            <Box sx={{ py: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                No project is active in week {weekNo(ctx.now.week)}: none has dates covering it, no Jira work under any covers
                it, nobody sent an update, and none is switched on. Set one to &ldquo;Always active&rdquo; on the Timeline.
              </Typography>
              <Button size="small" variant="outlined" onClick={() => ctx.onGoTo?.('timeline')}>Open the Timeline</Button>
            </Box>
          )}
          {(ctx.prevJiraError || ctx.nowJiraError) && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }} data-coverage-error>
              Jira could not be read just now, so only what people sent in shows{ctx.nowJiraError ? ', and Jira work does not make a project active' : ''}: {ctx.prevJiraError || ctx.nowJiraError}
            </Typography>
          )}
          {ctx.unknownKeys?.length > 0 && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }} data-unknown-keys>
              Jira does not know {ctx.unknownKeys.slice(0, 5).join(', ')}{ctx.unknownKeys.length > 5 ? ` and ${ctx.unknownKeys.length - 5} more` : ''} — check
              {ctx.unknownKeys.length === 1 ? ' the key' : ' those keys'} on the Projects page. Everything else is read as usual.
            </Typography>
          )}
          {count > 0 && shown.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Every active project has an update {past ? 'that week' : 'this week'}.</Typography>
          )}
          {shown.length > 0 && f.fill === false && (
            /* On a phone: one card per project, the weeks one under the other. */
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }} data-owner-cards>
              {shown.map((g) => (
                <Box key={`h:${g.person || 'none'}`} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <IconTile text={g.nick.slice(0, 2)} color={personColor(ctx.plan.people, g.person)} size={26} />
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{g.nick}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{g.projects.length} project{g.projects.length === 1 ? '' : 's'}</Typography>
                  </Box>
                  {g.projects.map((p) => (
                    <Box key={p.key} data-project={p.key} sx={{ border: 1, borderColor: 'divider', borderRadius: '12px', p: 1.25, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                      <Box>
                        <ProjectLink p={p} onOpen={ctx.onOpenProject} />
                        <RowFacts p={p} />
                      </Box>
                      <Box>
                        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>{lastHead}</Typography>
                        {lastLoading ? <Loading label="Loading from Jira…" /> : <TaskList tasks={p.lastWeek} kind="last" empty={lastEmpty} />}
                      </Box>
                      <Box>
                        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>{thisHead}</Typography>
                        <TaskList tasks={p.thisWeek} kind="this" empty="Not updated yet" />
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" sx={{ color: p.latest ? 'text.secondary' : 'text.disabled' }}>
                          Latest update {p.latest ? ago(p.latest) : 'never'}
                        </Typography>
                        <RowFollowUp ctx={ctx} g={g} p={p} />
                      </Box>
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          )}
          {shown.length > 0 && f.fill !== false && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 860, '& td': { verticalAlign: 'top' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: '24%' }}>Project</TableCell>
                    <TableCell sx={{ width: '28%' }}>{lastHead}</TableCell>
                    <TableCell sx={{ width: '26%' }}>{thisHead}</TableCell>
                    <TableCell sx={{ width: '9%' }}>Latest update</TableCell>
                    <TableCell align="right" sx={{ width: '13%' }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.map((g) => [
                    <TableRow key={`h:${g.person || 'none'}`}>
                      <TableCell colSpan={5} sx={{ bgcolor: 'action.hover', py: 0.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <IconTile text={g.nick.slice(0, 2)} color={personColor(ctx.plan.people, g.person)} size={26} />
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{g.nick}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {g.projects.length} project{g.projects.length === 1 ? '' : 's'}
                          </Typography>
                        </Box>
                      </TableCell>
                    </TableRow>,
                    ...g.projects.map((p) => (
                      <TableRow key={p.key} data-project={p.key}>
                        <TableCell>
                          <ProjectLink p={p} onOpen={ctx.onOpenProject} />
                          <RowFacts p={p} />
                        </TableCell>
                        <TableCell>
                          {lastLoading
                            ? <Loading label="Loading from Jira…" />
                            : <TaskList tasks={p.lastWeek} kind="last" empty={lastEmpty} />}
                        </TableCell>
                        <TableCell><TaskList tasks={p.thisWeek} kind="this" empty="Not updated yet" /></TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ color: p.latest ? 'text.primary' : 'text.disabled' }}>
                            {p.latest ? ago(p.latest) : 'never'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right"><RowFollowUp ctx={ctx} g={g} p={p} /></TableCell>
                      </TableRow>
                    )),
                  ])}
                </TableBody>
              </Table>
            </Box>
          )}
        </>
      )}
    </CardFrame>
  )
}

/* ------------------------------------------------- the week at a glance */

/*
 * One line on somebody's week when there is no focus to show: a week run from
 * Jira has none, so it says how many tasks they have sent an update on.
 */
function weekLine(e) {
  if (!e) return 'Nothing sent yet.'
  const tasks = e.tasks || []
  if (e.mode === 'jira' || tasks.some((t) => t.source === 'jira' || t.reportedAt)) {
    const sent = tasks.filter((t) => t.reportedAt || t.done != null || t.hold)
    if (!sent.length) return 'No task updated yet.'
    const hold = sent.filter((t) => t.hold).length
    const done = sent.filter((t) => t.done === true).length
    return `${sent.length} task${sent.length === 1 ? '' : 's'} updated${done ? ` · ${done} done` : ''}${hold ? ` · ${hold} on hold` : ''}`
  }
  return 'No focus written yet.'
}

export function TeamWeekCard({ ctx, f }) {
  const week = ctx.now
  const team = week?.team || []
  const required = team.filter((t) => t.required)
  const inCount = (stage) => required.filter((t) => ['ontime', 'late'].includes(t.standing?.[stage])).length
  const reportOpen = week && week.now < week.deadlines.reportDue
  return (
    <CardFrame
      {...f}
      label="this week"
      title={week ? `${ctx.isCurrent === false ? 'The week' : 'This week'} · ${weekTitle(week.week)}` : 'This week'}
      sub={week && (`Plans in ${inCount('plan')} of ${required.length} · reports in ${inCount('report')} of ${required.length}`
        + (reportOpen ? ` · reports due ${bangkokTime(week.deadlines.reportDue)}` : ''))}
      action={<Button size="small" onClick={() => ctx.onGoTo?.('weekly')}>Open Weekly</Button>}
    >
      {!week ? <Waiting ctx={ctx} /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {team.length === 0 && <Typography variant="body2" sx={{ color: 'text.disabled' }}>Nobody is on the submit list.</Typography>}
          {team.map((row) => (
            <ButtonBase
              key={row.person}
              onClick={() => ctx.onGoTo?.('weekly')}
              aria-label={`${row.nick}'s week`}
              sx={{
                display: 'flex', alignItems: 'flex-start', gap: 1.25, p: 1, borderRadius: '10px', textAlign: 'left',
                justifyContent: 'flex-start', width: '100%', '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <IconTile text={row.nick.slice(0, 2)} color={personColor(ctx.plan.people, row.person)} size={30} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{
                  display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap',
                }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 650, mr: 0.5 }}>{row.nick}</Typography>
                  {row.standing && <Pill label={`Plan: ${STATUS_LABEL[row.standing.plan]}`} tone={TONE[row.standing.plan]} />}
                  {row.standing && <Pill label={`Report: ${STATUS_LABEL[row.standing.report]}`} tone={TONE[row.standing.report]} />}
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    color: row.focus ? 'text.secondary' : 'text.disabled',
                    mt: 0.4,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {row.focus || weekLine(row.entry)}
                </Typography>
              </Box>
            </ButtonBase>
          ))}
        </Box>
      )}
    </CardFrame>
  )
}

/*
 * A decision a member asked for on a Jira task. "Decided" takes a line on
 * what was decided, which is also written on the task in Jira.
 */
function TaskDecision({ d, onDecide }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const save = async () => {
    setBusy(true)
    setError(null)
    try { await onDecide(d.id, note) } catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <Box data-decision={d.jiraKey} sx={{ p: 1, borderRadius: '10px', border: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <IconTile icon={HelpIcon} color="#c98b8b" size={30} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            {d.jiraKey}{d.summary ? ` — ${d.summary}` : ''}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {d.nick} asks: “{d.text}”
          </Typography>
        </Box>
        {!open && <Button size="small" onClick={() => setOpen(true)}>Decided</Button>}
      </Box>
      {open && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            fullWidth
            multiline
            maxRows={4}
            label="What was decided"
            helperText="Also written on the task in Jira."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="small" variant="outlined" onClick={save} disabled={busy || !note.trim()} sx={{ mt: 0.5 }}>Save</Button>
          <Button size="small" onClick={() => setOpen(false)} sx={{ mt: 0.5 }}>Cancel</Button>
        </Box>
      )}
      {error && <Typography variant="caption" sx={{ color: 'error.main' }}>{error}</Typography>}
    </Box>
  )
}

export function DecisionsCard({ ctx, f }) {
  const pending = ctx.pending || []
  const asked = ctx.decisions || []
  const loading = ctx.pending === undefined || ctx.decisions === undefined
  const unread = ctx.pending === null && ctx.decisions === null
  const parts = [
    pending.length ? `${pending.length} request${pending.length === 1 ? '' : 's'} to move a project's date` : null,
    asked.length ? `${asked.length} decision${asked.length === 1 ? '' : 's'} asked for on tasks` : null,
  ].filter(Boolean)
  return (
    <CardFrame
      {...f}
      label="waiting for your decision"
      title="Waiting for your decision"
      sub={loading ? undefined : unread ? 'The waiting decisions could not be read just now.'
        : `${parts.length ? parts.join(' · ') : 'No date changes or decisions are waiting.'}${ctx.isCurrent === false ? ' · as of today, whichever week is shown' : ''}`}
      action={pending.length > 0 && <Button size="small" onClick={() => ctx.onGoTo?.('weekly')}>Decide</Button>}
    >
      {loading && <Loading variant="block" label="Loading decisions…" />}
      {ctx.decided && (
        <Typography variant="caption" data-decided sx={{ color: 'text.secondary', display: 'block', mb: 0.75, pl: 1, borderLeft: 2, borderColor: 'divider' }}>
          Decided{ctx.decided.key ? ` on ${ctx.decided.key}` : ''}: “{ctx.decided.note}”
          {ctx.decided.key ? ' — written on the task in Jira, and the member can see it.' : '.'}
        </Typography>
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {asked.map((d) => <TaskDecision key={d.id} d={d} onDecide={ctx.onDecide} />)}
        {pending.map((p) => (
          <Box
            key={p.id}
            sx={{
              display: 'flex', alignItems: 'center', gap: 1.25, p: 1, borderRadius: '10px', border: 1, borderColor: 'divider',
            }}
          >
            <IconTile icon={EventRepeatIcon} color="#a18ad9" size={30} />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                {p.projectKey}{p.projectSummary ? ` — ${p.projectSummary}` : ''}
              </Typography>
              <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>
                {p.nick} · {fmtDay(p.currentDue)} → {p.proposedDue ? fmtDay(p.proposedDue) : 'date to be picked'}
                {p.disagree ? ' · dates and member disagree' : ''}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </CardFrame>
  )
}

/** When the next summary is due to be written, after `now`, for a week's answer. */
function nextSummary(week) {
  if (!week?.deadlines) return null
  const slots = [week.deadlines.planDue, week.deadlines.reportDue, week.deadlines.secondChance]
  const next = slots.find((t) => t > week.now)
  return next ? bangkokTime(next) : 'Monday 08:00'
}

export function SummaryCard({ ctx, f }) {
  // This week's newest; failing that, last week's, said as such.
  const own = ctx.summary?.summaries?.[0] || null
  const older = !own ? ctx.prevSummary?.summaries?.[0] || null : null
  const latest = own || older
  // Still asking: whether the AI is on, this week's summary, or — with none — last week's.
  const loading = ctx.aiOn === undefined || (ctx.aiOn && (ctx.summary === undefined || (ctx.summary && !own && ctx.prevSummary === undefined)))
  const when = (x) => new Date(x.writtenAt).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const next = nextSummary(ctx.now)
  let sub
  if (ctx.aiOn && own) sub = `Written by AI ${when(own)} ${WHEN[own.trigger] || ''}`
  else if (ctx.aiOn && older) sub = `Last week’s, written ${when(older)} · this week’s is written after ${next}`
  else if (ctx.aiOn) sub = 'Written by itself after Monday 08:00, Friday 15:00 and Sunday 15:00.'
  return (
    <CardFrame {...f} label="the week, summarised" title="The week, summarised" sub={loading ? undefined : sub}>
      {loading && <Loading variant="block" label="Loading the summary…" />}
      {!loading && ctx.aiOn === false && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The AI is not switched on, so there is no summary. Add LOTUS_API_KEY on Render, then press Test the AI on
          the Access tab.
        </Typography>
      )}
      {!loading && ctx.aiOn && latest && <Markdown text={latest.text} dense />}
      {!loading && ctx.aiOn && !latest && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {ctx.summary === null
              ? 'The summary could not be read just now.'
              : `No summary yet${ctx.now ? ` for ${weekTitle(ctx.now.week)}` : ''}. The AI writes one by itself after each deadline — the next after ${next || 'Monday 08:00'} — and emails it to the administrators.`}
        </Typography>
      )}
    </CardFrame>
  )
}

export function AskCard({ ctx, f }) {
  return (
    <CardFrame {...f} label="ask about the plan" title="Ask about the plan" sub="In English or Thai — answered from the register, the money and the check-ins.">
      {ctx.aiOn === undefined ? <Loading variant="block" label="Loading…" /> : !ctx.aiOn ? (
        <Typography variant="body2" sx={{ color: 'text.disabled' }}>The AI is not switched on.</Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {STARTERS.map((q) => (
            <Button
              key={q}
              variant="outlined"
              size="small"
              onClick={() => ctx.onAsk?.(q)}
              startIcon={<AutoAwesomeIcon sx={{ fontSize: '15px !important' }} />}
              sx={{
                justifyContent: 'flex-start', textAlign: 'left', fontWeight: 500, color: 'text.primary', borderColor: 'divider',
              }}
            >
              {q}
            </Button>
          ))}
          <Button size="small" onClick={() => ctx.onAsk?.(null)} sx={{ alignSelf: 'flex-start', px: 0 }}>Ask something else</Button>
        </Box>
      )}
    </CardFrame>
  )
}

/* ---------------------------------------------------------- the extras */

export function BlockersCard({ ctx, f }) {
  // Which week is "reported" depends on last week too: wait for both.
  const week = ctx.prev === undefined ? null : reportedWeek(ctx.now, ctx.prev)
  const by = blockersByType(week)
  const total = Object.values(by).reduce((a, l) => a + l.length, 0)
  const projectName = Object.fromEntries(ctx.plan.projects.map((p) => [p.key, p.summary || p.key]))
  return (
    <CardFrame
      {...f}
      label="blockers by type"
      title="Blockers by type"
      sub={week ? `${total} from the reports for ${weekTitle(week.week)}` : undefined}
    >
      {!week ? <Waiting ctx={ctx} /> : total === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Nothing reported as in the way.</Typography>
      ) : BLOCKER_CATEGORIES.filter((c) => by[c.id]?.length).map((c) => (
        <Box key={c.id} sx={{ mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="subtitle2">{c.label}</Typography>
            <Pill label={String(by[c.id].length)} tone="warn" />
          </Box>
          {by[c.id].map((t) => (
            <Typography key={`${t.person}.${t.id}`} variant="body2" sx={{ py: 0.25 }}>
              <strong>{t.nick}</strong>
              {t.projectKey && (
                <>
                  {' · '}
                  <Link component="button" onClick={() => ctx.onOpenProject?.(t.projectKey)} sx={{ verticalAlign: 'baseline' }}>
                    {projectName[t.projectKey] || t.projectKey}
                  </Link>
                </>
              )}
              {': '}{t.blocker}
            </Typography>
          ))}
        </Box>
      ))}
    </CardFrame>
  )
}

export function SlippingCard({ ctx, f }) {
  const list = slipping({
    projects: ctx.plan.projects, asOf: ctx.plan.settings.asOfDate, weeks: [ctx.now, ctx.prev].filter(Boolean), pending: ctx.pending || [], signals: ctx.signals,
  })
  const nick = Object.fromEntries((ctx.plan.assignees || ctx.plan.people).map((p) => [p.id, p.nick]))
  // The weeks and the requests to move a date both feed it: wait for them.
  const slipLoading = ctx.now === undefined || ctx.prev === undefined || ctx.pending === undefined
  return (
    <CardFrame {...f} label="slipping projects" title="Slipping projects" sub={slipLoading ? undefined : `${list.length} active project${list.length === 1 ? '' : 's'} past due, landing late, or asking to move`}>
      {slipLoading && <Loading variant="block" label="Loading…" />}
      {!slipLoading && list.length === 0 && <Typography variant="body2" sx={{ color: 'text.secondary' }}>No active project is slipping.</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {!slipLoading && list.map((p) => (
          <Box key={p.key} sx={{ borderBottom: 1, borderColor: 'divider', pb: 0.75 }}>
            <ProjectLink p={p} onOpen={ctx.onOpenProject} />
            <Box sx={{
              display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap', mt: 0.25,
            }}
            >
              <Typography variant="caption" sx={{ color: 'text.secondary', mr: 0.5 }}>{nick[p.pic] || 'No owner'} · due {fmtDay(p.due)}</Typography>
              {p.why.map((w) => <Pill key={w.kind} label={w.text} tone={w.kind === 'pastDue' ? 'bad' : w.kind === 'waiting' ? 'violet' : 'warn'} />)}
            </Box>
          </Box>
        ))}
      </Box>
    </CardFrame>
  )
}

export function WorkloadCard({ ctx, f }) {
  const rows = workload({
    projects: ctx.plan.projects, people: ctx.plan.people, week: ctx.now, signals: ctx.signals,
  })
  const max = Math.max(5, ...rows.map((r) => r.days))
  return (
    <CardFrame {...f} label="workload this week" title="Workload this week" sub="Days of effort planned this week, and active projects held">
      {!ctx.now ? <Waiting ctx={ctx} /> : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {rows.map((r) => (
            <Box key={r.person}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 650, minWidth: 80 }}>{r.nick}</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {r.days ? `${r.days} day${r.days === 1 ? '' : 's'}` : 'no plan yet'}
                  {` · ${r.tasks} task${r.tasks === 1 ? '' : 's'} · ${r.active} active project${r.active === 1 ? '' : 's'}`}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, (r.days / max) * 100)}
                aria-label={`${r.nick} planned days`}
                sx={{
                  mt: 0.5, height: 6, borderRadius: 3, bgcolor: 'action.hover',
                  '& .MuiLinearProgress-bar': { bgcolor: r.days > 5 ? PILL.warn : PILL.info, borderRadius: 3 },
                }}
              />
            </Box>
          ))}
          <Typography variant="caption" sx={{ color: 'text.disabled' }}>A working week is five days; more than that is marked.</Typography>
        </Box>
      )}
    </CardFrame>
  )
}

export function TrendCard({ ctx, f }) {
  const t = ctx.trend ? submissionTrend(ctx.trend) : null
  const cell = (s, stage) => {
    const hue = s === 'ontime' ? PILL.good : s === 'late' ? PILL.warn : s === 'missing' ? PILL.bad : PILL.neutral
    return (
      <Tooltip title={`${stage}: ${s ? STATUS_LABEL[s] : 'not required'}`}>
        <Box sx={{
          width: 12, height: 12, borderRadius: '3px', bgcolor: alpha(hue, s ? 0.85 : 0.2), border: 1, borderColor: alpha(hue, 0.5),
        }}
        />
      </Tooltip>
    )
  }
  return (
    <CardFrame {...f} label="submission trend" title="Submission trend" sub="Plan and report, per person, over the last eight weeks — green on time, amber late, red missing">
      {!t ? <Waiting ctx={ctx} /> : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 520 }}>
            <TableHead>
              <TableRow>
                <TableCell>Person</TableCell>
                {t.weeks.map((w) => <TableCell key={w} align="center" sx={{ whiteSpace: 'nowrap' }}>{fmtDay(w)}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {t.people.map((p) => (
                <TableRow key={p.person}>
                  <TableCell sx={{ fontWeight: 600 }}>{p.nick}</TableCell>
                  {t.weeks.map((w) => (
                    <TableCell key={w} align="center">
                      <Box sx={{ display: 'inline-flex', gap: 0.5 }}>
                        {cell(p.weeks[w]?.plan, 'Plan')}
                        {cell(p.weeks[w]?.report, 'Report')}
                      </Box>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow>
                <TableCell sx={{ color: 'text.secondary' }}>Reports on time</TableCell>
                {t.report.map((r) => (
                  <TableCell key={r.week} align="center" sx={{ color: 'text.secondary' }}>
                    {r.ontime}/{r.ontime + r.late + r.missing + r.open}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      )}
    </CardFrame>
  )
}

