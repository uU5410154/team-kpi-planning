import { useState } from 'react'
import {
  Box, Typography, Button, ButtonBase, Table, TableBody, TableCell, TableHead, TableRow,
  Link, ToggleButton, ToggleButtonGroup, Tooltip, TextField, Skeleton,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import WarningAmberIcon from '@mui/icons-material/WarningAmberRounded'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import InboxIcon from '@mui/icons-material/InboxOutlined'
import EventBusyIcon from '@mui/icons-material/EventBusyOutlined'
import StatTile from '../components/StatTile.jsx'
import Markdown from '../components/Markdown.jsx'
import FollowUp, { ago } from '../components/FollowUp.jsx'
import { PILL } from '../components/Brand.jsx'
import { StatusPill, EmptyState } from '../components/ui.jsx'
import {
  STATUS_LABEL, weekNo, weekLabel, bangkokTime, BLOCKER_CATEGORIES, addWeeks,
} from '../lib/weekly.js'
import {
  projectCounts, updatedCount, ownerRows, reportedWeek, blockersByType, slipping, workload, submissionTrend,
  activeWords,
} from '../lib/manager.js'
import CardFrame from './CardFrame.jsx'
import { Avatar, RowsSkeleton, ScrollX } from './planCards.jsx'
import { plainError } from '../lib/api.js'

/*
 * THE MANAGER'S CARDS: what is active, what has been updated this week, who
 * holds what and where it stands, with a follow-up a click away, and the
 * weekly check-in at a glance. Everything is worked out in lib/manager.js
 * from the same weeks the Weekly page reads.
 *
 * Drawn to the "Ledger" system: rows split by hairlines, states as small
 * pills in sentence case, a skeleton of the rows while they load, and never
 * an "empty" line before the answer is in.
 */

const TONE = {
  open: 'neutral', missing: 'danger', ontime: 'success', late: 'warning',
}
const WHEN = {
  plan: 'after the Monday plans', report: 'after the Friday reports', second: 'after the Sunday second chance',
}
const STARTERS = [
  'Which projects are past due, and who holds them?',
  'What is blocking the team this week?',
  'Which costed projects are below the ROI gate?',
]
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '–')
/** "Week 45, 2 Nov 2026". */
const weekName = (w) => `Week ${weekNo(w)}, ${weekLabel(w)}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a card shows while the weeks load, or when the database is not there. */
function Waiting({ ctx, rows = 3 }) {
  if (ctx.now === null) {
    return (
      <EmptyState
        inline
        icon={ErrorOutlineIcon}
        title="The weekly check-ins could not be read."
        body="Reload the page to try again."
      />
    )
  }
  return <RowsSkeleton rows={rows} label="Loading the week…" />
}

const ProjectLink = ({ p, onOpen }) => (
  <Link
    component="button"
    onClick={() => onOpen?.(p.key)}
    underline="hover"
    sx={{
      fontWeight: 500, fontSize: '0.875rem', lineHeight: '20px', textAlign: 'left', color: 'text.primary', verticalAlign: 'baseline',
    }}
  >
    {p.summary || p.key}
  </Link>
)

/** A small label for a section of a row: "Last week (W44)". */
const RowLabel = ({ children }) => (
  <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mb: 1 }}>{children}</Typography>
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

/** A figure on its way: the shape of a number, announced as loading. */
const FigureLoading = () => (
  <Box component="span" role="status" aria-label="Loading" data-loading sx={{ display: 'inline-block' }}>
    <Skeleton variant="text" width={56} height={28} />
  </Box>
)

export function ActiveCard({ ctx, f }) {
  const week = ctx.now?.week
  const c = projectCounts(ctx.plan.projects, week || undefined, ctx.signals)
  const when = weekWord(ctx)
  return (
    <CardFrame {...f} bare title="Active projects">
      {figureLoading(ctx) ? (
        <StatTile label="Active projects" value={<FigureLoading />} unit="" context="Reading the week and Jira" help={ACTIVE_HELP} />
      ) : (
        <StatTile
          label="Active projects"
          value={c.active}
          unit={`of ${c.total} in the register`}
          context={c.active
            ? activeWords(c, when).split(' · ').join(', ')
            : `Nothing covers ${when}. Switch a project on in the Timeline.`}
          help={ACTIVE_HELP + (ctx.nowJiraError ? ` Jira could not be read just now, so Jira work is not counted. ${plainError(ctx.nowJiraError)}` : '')}
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
  const missing = Math.max(0, active - updated)
  return (
    <CardFrame {...f} bare title="Updated this week">
      {figureLoading(ctx) && now !== null ? (
        <StatTile label={label} value={<FigureLoading />} unit="" context="Reading the week and Jira" />
      ) : (
        <StatTile
          label={label}
          value={now ? updated : '—'}
          unit={`of ${active} active`}
          tone={early || !active ? undefined : share >= 1 ? 'good' : share >= 0.5 ? 'warning' : 'critical'}
          context={now
            ? (missing ? `${missing} not updated yet` : 'Every active project is updated')
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
        mt: 1,
        pl: 2,
        borderLeft: 2,
        borderColor: 'border.strong',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        lineHeight: 1.5,
        maxWidth: '72ch',
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

/** Where a task stands, as one pill: done, not done, on hold, no answer or planned. */
function TaskPill({ t, kind }) {
  const answered = t.done != null || !!t.reportedAt || !!t.progress
  const hold = t.hold || (t.done === false && /^on hold$/i.test(String(t.blocker || '').trim()))
  if (hold) return <StatusPill tone="warning">On hold</StatusPill>
  if (t.done === true) return <StatusPill tone="success">Done</StatusPill>
  if (t.done === false) return <StatusPill tone="warning">{`Not done${t.pct != null ? `, ${t.pct}%` : ''}`}</StatusPill>
  if (kind === 'last' || !answered) return <StatusPill tone="neutral">{kind === 'last' ? 'No answer' : 'Planned'}</StatusPill>
  return null
}

/*
 * A project's tasks in one week: each with where it stands (Done, Not done,
 * On hold, or no answer yet), who holds it, and what they wrote about it.
 */
function TaskList({ tasks, empty, kind }) {
  if (!tasks.length) return <Typography variant="body2" sx={{ color: 'text.tertiary' }}>{empty}</Typography>
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {tasks.map((t) => {
        const hold = t.hold || (t.done === false && /^on hold$/i.test(String(t.blocker || '').trim()))
        const why = t.done === false ? (t.reason || t.blocker || '') : ''
        const meta = [
          t.nick,
          kind === 'this' && t.expected ? `expected ${fmtDay(t.expected)}` : null,
          t.done === false && t.newDate ? `now ${fmtDay(t.newDate)}` : null,
          // Nobody wrote about it that week: what shows is Jira's status today.
          t.statusToday ? 'status today' : null,
        ].filter(Boolean).join(', ')
        return (
          <Box key={`${t.person}.${t.id}`} sx={{ minWidth: 0 }} data-week-task={t.jiraKey || t.id}>
            <Typography variant="body2" sx={{ color: 'text.primary', lineHeight: '18px' }}>{t.title}</Typography>
            <Box sx={{
              display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mt: 1,
            }}
            >
              <TaskPill t={t} kind={kind} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>{meta}</Typography>
            </Box>
            {t.progress && <UpdateText text={t.progress} />}
            {why && !/^on hold$/i.test(why.trim()) && (
              <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 1 }}>
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
  if (!g.person) return <Typography variant="caption" sx={{ color: 'text.tertiary', textAlign: compact ? 'right' : 'left' }}>No owner to ask</Typography>
  // Does the owner hold any Jira work under it this week? If not, the email says to add a task.
  const theirs = (p.keys || [p.key]).flatMap((k) => ctx.nowJira?.[k] || []).filter((t) => t.holder === g.nick || t.update?.nick === g.nick)
  const note = ctx.nowJira && !theirs.length && !p.thisWeek.some((t) => t.person === g.person)
    ? `${g.nick} has no task on it in Jira this week, so the email asks them to add one from their Weekly page.`
    : null
  const off = p.onHold ? 'On hold, no update needed'
    : ctx.isCurrent === false ? 'Follow-ups ask about this week' : null
  return (
    <FollowUp compact={compact} projectKey={p.key} followup={p.followup} onSent={ctx.onFollowSent} owner={g.nick} summary={p.summary} note={note} off={off} />
  )
}

/** Under a project's name: its key and due date, and why it is on the list when that is not its dates. */
function RowFacts({ p, hold = true }) {
  const words = [
    p.jiraKey || p.key,
    p.due ? `due ${fmtDay(p.due)}` : null,
    p.lines > 1 ? `${p.lines} register lines` : null,
  ].filter(Boolean).join(', ')
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 0.5,
    }}
    >
      <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{words}</Typography>
      {p.why === 'jira' && (
        <Tooltip title="Active because Jira has work under it covering this week">
          <span><StatusPill tone="neutral">Jira this week</StatusPill></span>
        </Tooltip>
      )}
      {p.why === 'decision' && <StatusPill tone="info">Open decision</StatusPill>}
      {p.why === 'forced-on' && <StatusPill tone="neutral">Switched on</StatusPill>}
      {hold && p.onHold && <StatusPill tone="warning">On hold</StatusPill>}
    </Box>
  )
}

/** One line on where a project stands this week, for the phone's rows. */
function WeekState({ p }) {
  if (p.onHold) return <StatusPill tone="warning">On hold</StatusPill>
  if (p.thisWeek.some((t) => t.reportedAt || t.done != null || t.progress)) return <StatusPill tone="success">Updated</StatusPill>
  if (p.thisWeek.length) return <StatusPill tone="neutral">Planned</StatusPill>
  return <StatusPill tone="warning">Not updated</StatusPill>
}

/** On a phone: one row per project, its weeks a tap away. */
function OwnerRow({
  ctx, g, p, lastHead, thisHead, lastEmpty, lastLoading, first,
}) {
  const [open, setOpen] = useState(false)
  return (
    <Box data-project={p.key} sx={{ py: 3, borderTop: first ? 0 : 1, borderColor: 'border.subtle' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <ProjectLink p={p} onOpen={ctx.onOpenProject} />
          {/* Its state is the pill on the right; not said twice. */}
          <RowFacts p={p} hold={false} />
        </Box>
        <Box sx={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0,
        }}
        >
          <WeekState p={p} />
          {p.latest && <Typography variant="caption" sx={{ color: 'text.tertiary', whiteSpace: 'nowrap' }}>{`Sent ${ago(p.latest)}`}</Typography>}
        </Box>
      </Box>
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mt: 2, flexWrap: 'wrap',
      }}
      >
        <Button
          variant="text"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 180ms ease-out' }} />}
          sx={{ ml: -2, color: 'text.secondary' }}
        >
          {open ? 'Hide tasks' : 'Show tasks'}
        </Button>
        <RowFollowUp ctx={ctx} g={g} p={p} />
      </Box>
      {open && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, mt: 2 }}>
          <Box>
            <RowLabel>{lastHead}</RowLabel>
            {lastLoading ? <RowsSkeleton rows={1} label="Loading from Jira…" /> : <TaskList tasks={p.lastWeek} kind="last" empty={lastEmpty} />}
          </Box>
          <Box>
            <RowLabel>{thisHead}</RowLabel>
            <TaskList tasks={p.thisWeek} kind="this" empty="Not updated yet" />
          </Box>
        </Box>
      )}
    </Box>
  )
}

/** The owner's line above their projects. */
const OwnerHead = ({ g }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
    <Avatar name={g.nick} size={24} />
    <Typography variant="h3" component="span">{g.nick}</Typography>
    <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{plural(g.projects.length, 'project')}</Typography>
  </Box>
)

/** One callout at the top of the card: what Jira could not tell us. */
function JiraNote({ ctx }) {
  const err = ctx.prevJiraError || ctx.nowJiraError
  const unknown = ctx.unknownKeys || []
  if (!err && !unknown.length) return null
  return (
    <Box
      sx={{
        display: 'flex', gap: 2, alignItems: 'flex-start', p: 3, mb: 3, borderRadius: '6px', bgcolor: 'bg.subtle',
      }}
    >
      <WarningAmberIcon sx={(t) => ({ fontSize: 18, mt: '1px', color: t.palette.tone.warning.fg, flexShrink: 0 })} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        {err && (
          <Typography variant="body2" data-coverage-error>
            {`Jira could not be read just now, so only what people sent in shows${ctx.nowJiraError ? ', and Jira work does not make a project active' : ''}. `}
            <Box component="span" sx={{ color: 'text.secondary' }}>{plainError(err)}</Box>
          </Typography>
        )}
        {unknown.length > 0 && (
          <Typography variant="body2" data-unknown-keys>
            {`Jira does not know ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? ` and ${unknown.length - 5} more` : ''}. `}
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {`Check ${unknown.length === 1 ? 'the key' : 'those keys'} on the Projects page; everything else is read as usual.`}
            </Box>
          </Typography>
        )}
      </Box>
    </Box>
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
  // Last week comes from Jira a moment after the rest: a placeholder until it does.
  const lastLoading = ctx.prevJira === undefined
  const shown = groups
    .map((g) => ({ ...g, projects: only === 'stale' ? g.projects.filter((p) => !p.thisWeek.length) : g.projects }))
    .filter((g) => g.projects.length)
  const count = groups.reduce((a, g) => a + g.projects.length, 0)
  const past = ctx.isCurrent === false
  const prevWeek = ctx.prev ? ctx.prev.week : ctx.now ? addWeeks(ctx.now.week, -1) : null
  const prevNo = prevWeek ? weekNo(prevWeek) : ''
  const lastHead = `${past ? 'Week before' : 'Last week'}${prevNo ? ` (W${prevNo})` : ''}`
  const thisHead = ctx.now ? `${past ? 'That week' : 'This week'} (W${weekNo(ctx.now.week)})` : ''
  const lastEmpty = ctx.prevJira ? `Nothing in Jira covered week ${prevNo}` : `No task in week ${prevNo}`
  const loading = ctx.now === undefined || ctx.planLoading || (ctx.now && !ctx.signalsReady)
  const compact = !!f.compact
  return (
    <CardFrame
      {...f}
      title="Who holds what"
      label="who holds what"
      sub={ctx.now && !loading
        ? `${plural(count, 'active project')} by owner, ${past ? `week ${weekNo(ctx.now.week)} and the week before` : 'this week and last'}`
        : undefined}
      action={(
        <ToggleButtonGroup size="small" exclusive value={only} onChange={(_e, v) => v && setOnly(v)} aria-label="show">
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="stale">Not updated</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      {ctx.now === null ? <Waiting ctx={ctx} /> : loading ? <RowsSkeleton rows={5} label="Loading the week and Jira…" /> : (
        <>
          <JiraNote ctx={ctx} />
          {count === 0 && (
            <EmptyState
              icon={EventBusyIcon}
              title={`No project is active in week ${weekNo(ctx.now.week)}.`}
              body="None has dates or Jira work covering it, nobody sent an update, and none is switched on. Switch one on in the Timeline."
              action={<Button variant="outlined" onClick={() => ctx.onGoTo?.('timeline')}>Open Timeline</Button>}
            />
          )}
          {count > 0 && shown.length === 0 && (
            <EmptyState inline icon={CheckCircleOutlineIcon} title={`Every active project has an update ${past ? 'that week' : 'this week'}.`} />
          )}
          {shown.length > 0 && compact && (
            /* On a phone: one row per project, under its owner. */
            <Box data-owner-cards sx={{ mx: { xs: -3, sm: -4 } }}>
              {shown.map((g) => (
                <Box key={`h:${g.person || 'none'}`}>
                  <Box sx={{ px: { xs: 3, sm: 4 }, py: 2, bgcolor: 'bg.subtle' }}><OwnerHead g={g} /></Box>
                  <Box sx={{ px: { xs: 3, sm: 4 } }}>
                    {g.projects.map((p, i) => (
                      <OwnerRow
                        key={p.key}
                        first={i === 0}
                        ctx={ctx}
                        g={g}
                        p={p}
                        lastHead={lastHead}
                        thisHead={thisHead}
                        lastEmpty={lastEmpty}
                        lastLoading={lastLoading}
                      />
                    ))}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
          {shown.length > 0 && !compact && (
            <ScrollX>
              <Table size="small" sx={{ minWidth: 940, tableLayout: 'fixed', '& td': { verticalAlign: 'top', py: 3 } }}>
                <colgroup>
                  <col style={{ width: '27%' }} />
                  <col />
                  <col />
                  <col style={{ width: 120 }} />
                  <col style={{ width: 156 }} />
                </colgroup>
                <TableHead>
                  <TableRow>
                    <TableCell className="sticky-col">Project</TableCell>
                    <TableCell>{lastHead}</TableCell>
                    <TableCell>{thisHead}</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Latest update</TableCell>
                    <TableCell align="right">Follow-up</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shown.map((g) => [
                    <TableRow key={`h:${g.person || 'none'}`}>
                      <TableCell colSpan={5} sx={{ bgcolor: 'bg.subtle', py: '8px !important' }}><OwnerHead g={g} /></TableCell>
                    </TableRow>,
                    ...g.projects.map((p) => (
                      <TableRow key={p.key} data-project={p.key}>
                        <TableCell className="sticky-col">
                          <ProjectLink p={p} onOpen={ctx.onOpenProject} />
                          <RowFacts p={p} />
                        </TableCell>
                        <TableCell>
                          {lastLoading
                            ? <RowsSkeleton rows={1} label="Loading from Jira…" />
                            : <TaskList tasks={p.lastWeek} kind="last" empty={lastEmpty} />}
                        </TableCell>
                        <TableCell><TaskList tasks={p.thisWeek} kind="this" empty="Not updated yet" /></TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ color: p.latest ? 'text.primary' : 'text.tertiary', whiteSpace: 'nowrap' }}>
                            {p.latest ? ago(p.latest) : 'Never'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right"><RowFollowUp ctx={ctx} g={g} p={p} /></TableCell>
                      </TableRow>
                    )),
                  ])}
                </TableBody>
              </Table>
            </ScrollX>
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
  if (!e) return 'Nothing sent yet'
  const tasks = e.tasks || []
  if (e.mode === 'jira' || tasks.some((t) => t.source === 'jira' || t.reportedAt)) {
    const sent = tasks.filter((t) => t.reportedAt || t.done != null || t.hold)
    if (!sent.length) return 'No task updated yet'
    const hold = sent.filter((t) => t.hold).length
    const done = sent.filter((t) => t.done === true).length
    return [plural(sent.length, 'task') + ' updated', done ? `${done} done` : null, hold ? `${hold} on hold` : null].filter(Boolean).join(', ')
  }
  return 'No focus written yet'
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
      title={ctx.isCurrent === false ? 'That week' : 'This week'}
      sub={week && [
        `Plans in ${inCount('plan')} of ${required.length}`,
        `reports in ${inCount('report')} of ${required.length}`,
        reportOpen ? `reports due ${bangkokTime(week.deadlines.reportDue)}` : null,
      ].filter(Boolean).join(', ')}
      action={<Button variant="text" onClick={() => ctx.onGoTo?.('weekly')}>Open Weekly</Button>}
    >
      {!week ? <Waiting ctx={ctx} rows={4} /> : (
        <Box>
          {team.length === 0 && <EmptyState inline icon={InboxIcon} title="Nobody is on the submit list." body="Add people under Access." />}
          {team.map((row, i) => (
            <ButtonBase
              key={row.person}
              onClick={() => ctx.onGoTo?.('weekly')}
              aria-label={`${row.nick}'s week`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                columnGap: 3,
                rowGap: 1.5,
                flexWrap: 'wrap',
                width: 'calc(100% + 16px)',
                mx: -2,
                px: 2,
                py: 2.5,
                textAlign: 'left',
                justifyContent: 'flex-start',
                borderTop: i ? 1 : 0,
                borderColor: 'border.subtle',
                transition: 'background-color 120ms',
                '&:hover': { bgcolor: 'bg.subtle' },
              }}
            >
              <Avatar name={row.nick} />
              <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>{row.nick}</Typography>
                <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>{row.focus || weekLine(row.entry)}</Typography>
              </Box>
              {row.standing && (
                <Box sx={{
                  display: 'flex', gap: 1.5, flexWrap: 'wrap', flexShrink: 0,
                }}
                >
                  <StatusPill tone={TONE[row.standing.plan]}>{`Plan ${STATUS_LABEL[row.standing.plan].toLowerCase()}`}</StatusPill>
                  <StatusPill tone={TONE[row.standing.report]}>{`Report ${STATUS_LABEL[row.standing.report].toLowerCase()}`}</StatusPill>
                </Box>
              )}
            </ButtonBase>
          ))}
        </Box>
      )}
    </CardFrame>
  )
}

/*
 * A decision a member asked for on a Jira task. "Mark decided" takes a line
 * on what was decided, which is also written on the task in Jira.
 */
function TaskDecision({ d, onDecide, first }) {
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
    <Box data-decision={d.jiraKey} sx={{ py: 3, borderTop: first ? 0 : 1, borderColor: 'border.subtle' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            <Box component="span" sx={{ color: 'text.secondary', mr: 1.5 }}>{d.jiraKey}</Box>
            {d.summary || ''}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: '72ch' }}>
            {`${d.nick} asks: “${d.text}”`}
          </Typography>
        </Box>
        {!open && <Button variant="text" onClick={() => setOpen(true)} sx={{ flexShrink: 0, mr: -2 }}>Mark decided</Button>}
      </Box>
      {open && (
        <Box sx={{
          display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap', mt: 3,
        }}
        >
          <TextField
            size="small"
            autoFocus
            label="What was decided"
            helperText="Also written on the task in Jira."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            sx={{ flex: '1 1 240px' }}
          />
          <Button variant="contained" onClick={save} disabled={busy || !note.trim()} sx={{ minHeight: 36 }}>{busy ? 'Saving…' : 'Save'}</Button>
          <Button variant="text" onClick={() => setOpen(false)} disabled={busy} sx={{ minHeight: 36 }}>Cancel</Button>
        </Box>
      )}
      {error && <Typography variant="body2" sx={(t) => ({ color: t.palette.tone.danger.fg, mt: 1 })}>{error}</Typography>}
    </Box>
  )
}

export function DecisionsCard({ ctx, f }) {
  const pending = ctx.pending || []
  const asked = ctx.decisions || []
  const loading = ctx.pending === undefined || ctx.decisions === undefined
  const unread = ctx.pending === null && ctx.decisions === null
  const parts = [
    asked.length ? plural(asked.length, 'decision') + ' on tasks' : null,
    pending.length ? plural(pending.length, 'date change') : null,
  ].filter(Boolean)
  const none = !loading && !unread && !asked.length && !pending.length
  return (
    <CardFrame
      {...f}
      label="waiting for your decision"
      title="Waiting for your decision"
      sub={loading || unread || none ? undefined
        : `${parts.join(', ')}${ctx.isCurrent === false ? ', as of today' : ''}`}
    >
      {loading && <RowsSkeleton rows={2} label="Loading decisions…" />}
      {ctx.decided && (
        <Typography variant="body2" data-decided sx={{ color: 'text.secondary', mb: 2, p: 3, borderRadius: '6px', bgcolor: 'bg.subtle' }}>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{`Decided${ctx.decided.key ? ` on ${ctx.decided.key}` : ''}: `}</Box>
          {`“${ctx.decided.note}”${ctx.decided.key ? '. Written on the task in Jira, where the member can see it.' : '.'}`}
        </Typography>
      )}
      {unread && (
        <EmptyState inline icon={ErrorOutlineIcon} title="The waiting decisions could not be read." body="Reload the page to try again." />
      )}
      {none && <EmptyState inline icon={CheckCircleOutlineIcon} title="Nothing is waiting for you." />}
      <Box>
        {asked.map((d, i) => <TaskDecision key={d.id} d={d} onDecide={ctx.onDecide} first={i === 0} />)}
        {pending.map((p, i) => (
          <Box
            key={p.id}
            sx={{
              display: 'flex', alignItems: 'flex-start', gap: 3, py: 3, borderTop: i === 0 && !asked.length ? 0 : 1, borderColor: 'border.subtle',
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body1" noWrap sx={{ fontWeight: 500 }}>
                <Box component="span" sx={{ color: 'text.secondary', mr: 1.5 }}>{p.projectKey}</Box>
                {p.projectSummary || ''}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                {`${p.nick} asks to move it from ${fmtDay(p.currentDue)} to ${p.proposedDue ? fmtDay(p.proposedDue) : 'a date you pick'}`}
                {p.disagree ? '; the dates and the member disagree' : ''}
              </Typography>
            </Box>
            <Button variant="text" onClick={() => ctx.onGoTo?.('weekly')} sx={{ flexShrink: 0, mr: -2 }}>Decide</Button>
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
  // Still asking: whether the AI is on, this week's summary, or (with none) last week's.
  const loading = ctx.aiOn === undefined || (ctx.aiOn && (ctx.summary === undefined || (ctx.summary && !own && ctx.prevSummary === undefined)))
  const when = (x) => new Date(x.writtenAt).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const next = nextSummary(ctx.now)
  let sub
  if (ctx.aiOn && own) sub = `Written by AI ${when(own)}, ${WHEN[own.trigger] || ''}`.replace(/, $/, '')
  else if (ctx.aiOn && older) sub = `Last week’s, written ${when(older)}. This week’s comes after ${next}.`
  return (
    <CardFrame {...f} label="the week, summarised" title="The week, summarised" sub={loading ? undefined : sub}>
      {loading && <RowsSkeleton rows={3} lines={1} label="Loading the summary…" />}
      {!loading && ctx.aiOn === false && (
        <EmptyState
          inline
          icon={AutoAwesomeIcon}
          title="The AI is not switched on, so no summary is written."
          body="An administrator turns it on from the Access page."
        />
      )}
      {!loading && ctx.aiOn && latest && <Markdown text={latest.text} dense />}
      {!loading && ctx.aiOn && !latest && (
        ctx.summary === null
          ? <EmptyState inline icon={ErrorOutlineIcon} title="The summary could not be read." body="Reload the page to try again." />
          : (
            <EmptyState
              inline
              icon={AutoAwesomeIcon}
              title={`No summary yet${ctx.now ? ` for week ${weekNo(ctx.now.week)}` : ''}.`}
              body={`The AI writes one after each deadline, the next after ${next || 'Monday 08:00'}, and emails it to the administrators.`}
            />
          )
      )}
    </CardFrame>
  )
}

export function AskCard({ ctx, f }) {
  return (
    <CardFrame {...f} label="ask about the plan" title="Ask about the plan" sub={ctx.aiOn ? 'In English or Thai, answered from the register, the money and the check-ins.' : undefined}>
      {ctx.aiOn === undefined ? <RowsSkeleton rows={3} lines={1} /> : !ctx.aiOn ? (
        <EmptyState inline icon={AutoAwesomeIcon} title="The AI is not switched on." body="Questions about the plan need it." />
      ) : (
        <Box>
          {STARTERS.map((q, i) => (
            <ButtonBase
              key={q}
              onClick={() => ctx.onAsk?.(q)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                width: 'calc(100% + 16px)',
                mx: -2,
                px: 2,
                py: 2.5,
                textAlign: 'left',
                justifyContent: 'flex-start',
                borderTop: i ? 1 : 0,
                borderColor: 'border.subtle',
                transition: 'background-color 120ms',
                '&:hover': { bgcolor: 'bg.subtle' },
                '&:hover .ask-go': { color: 'text.primary' },
              }}
            >
              <AutoAwesomeIcon sx={{ fontSize: 16, color: 'text.tertiary', flexShrink: 0 }} />
              <Typography variant="body1" sx={{ flex: 1, minWidth: 0 }}>{q}</Typography>
              <ChevronRightIcon className="ask-go" sx={{ fontSize: 18, color: 'text.tertiary', flexShrink: 0 }} />
            </ButtonBase>
          ))}
          <Button variant="text" onClick={() => ctx.onAsk?.(null)} sx={{ mt: 2, ml: -2 }}>Ask something else</Button>
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
      sub={week ? `${total} from the reports for ${weekName(week.week)}` : undefined}
    >
      {!week ? <Waiting ctx={ctx} /> : total === 0 ? (
        <EmptyState inline icon={CheckCircleOutlineIcon} title="Nothing was reported as in the way." />
      ) : BLOCKER_CATEGORIES.filter((c) => by[c.id]?.length).map((c, i) => (
        <Box key={c.id} sx={{ pt: i ? 3 : 0, pb: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
          <Box sx={{
            display: 'flex', alignItems: 'baseline', gap: 2, mb: 1,
          }}
          >
            <Typography variant="h3">{c.label}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>{by[c.id].length}</Typography>
          </Box>
          {by[c.id].map((t) => (
            <Typography key={`${t.person}.${t.id}`} variant="body2" sx={{ py: 0.5, color: 'text.secondary' }}>
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{t.nick}</Box>
              {t.projectKey && (
                <>
                  {', '}
                  <Link component="button" onClick={() => ctx.onOpenProject?.(t.projectKey)} sx={{ verticalAlign: 'baseline', fontSize: 'inherit' }}>
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

const SLIP = {
  pastDue: ['danger', 'Past due'], lands: ['warning', 'Lands late'], waiting: ['info', 'Date change waiting'],
}

export function SlippingCard({ ctx, f }) {
  const list = slipping({
    projects: ctx.plan.projects, asOf: ctx.plan.settings.asOfDate, weeks: [ctx.now, ctx.prev].filter(Boolean), pending: ctx.pending || [], signals: ctx.signals,
  })
  const nick = Object.fromEntries((ctx.plan.assignees || ctx.plan.people).map((p) => [p.id, p.nick]))
  // The weeks and the requests to move a date both feed it: wait for them.
  const slipLoading = ctx.now === undefined || ctx.prev === undefined || ctx.pending === undefined
  return (
    <CardFrame {...f} label="slipping projects" title="Slipping projects" sub={slipLoading ? undefined : `${plural(list.length, 'active project')} past due, landing late, or asking to move`}>
      {slipLoading && <RowsSkeleton rows={3} />}
      {!slipLoading && list.length === 0 && <EmptyState inline icon={CheckCircleOutlineIcon} title="No active project is slipping." />}
      {!slipLoading && list.map((p, i) => (
        <Box key={p.key} sx={{ py: 2.5, borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
          <ProjectLink p={p} onOpen={ctx.onOpenProject} />
          <Box sx={{
            display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mt: 1,
          }}
          >
            <Typography variant="body2" sx={{ color: 'text.secondary', mr: 1 }}>{`${nick[p.pic] || 'No owner'}, due ${fmtDay(p.due)}`}</Typography>
            {p.why.slice(0, 2).map((w) => (
              <StatusPill key={w.kind} tone={(SLIP[w.kind] || ['neutral'])[0]} title={w.text}>{(SLIP[w.kind] || [null, w.text])[1]}</StatusPill>
            ))}
          </Box>
        </Box>
      ))}
    </CardFrame>
  )
}

export function WorkloadCard({ ctx, f }) {
  const rows = workload({
    projects: ctx.plan.projects, people: ctx.plan.people, week: ctx.now, signals: ctx.signals,
  })
  const max = Math.max(5, ...rows.map((r) => r.days))
  return (
    <CardFrame {...f} label="workload this week" title="Workload this week" sub="Days of effort planned, and active projects held. A working week is five days.">
      {!ctx.now ? <Waiting ctx={ctx} /> : (
        <Box>
          {rows.map((r, i) => (
            <Box key={r.person} sx={{ py: 2.5, borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <Typography variant="body1" sx={{ fontWeight: 500, minWidth: 88 }}>{r.nick}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }}>
                  {[plural(r.tasks, 'task'), plural(r.active, 'active project')].join(', ')}
                </Typography>
                {r.days > 5 && <StatusPill tone="warning">Over five days</StatusPill>}
                <Typography variant="body1" className="tabular" sx={{ fontWeight: 500, color: r.days ? 'text.primary' : 'text.tertiary' }}>
                  {r.days ? plural(r.days, 'day') : 'No plan'}
                </Typography>
              </Box>
              <Box
                role="progressbar"
                aria-label={`${r.nick} planned days`}
                aria-valuenow={r.days}
                aria-valuemin={0}
                aria-valuemax={max}
                sx={{
                  mt: 1.5, height: 4, borderRadius: '2px', bgcolor: 'bg.subtle', overflow: 'hidden',
                }}
              >
                <Box sx={(t) => ({
                  height: '100%', width: `${Math.min(100, (r.days / max) * 100)}%`, borderRadius: '2px', bgcolor: r.days > 5 ? t.palette.tone.warning.solid : t.palette.tone.info.solid,
                })}
                />
              </Box>
            </Box>
          ))}
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
        <Box
          aria-label={`${stage}: ${s ? STATUS_LABEL[s] : 'not required'}`}
          sx={{
            width: 10, height: 10, borderRadius: '2px', bgcolor: alpha(hue, s ? 0.9 : 0.2),
          }}
        />
      </Tooltip>
    )
  }
  return (
    <CardFrame {...f} label="submission trend" title="Submission trend" sub="Plan and report per person, the last eight weeks. Hover a mark to read it.">
      {!t ? <Waiting ctx={ctx} /> : (
        <ScrollX>
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow>
                <TableCell className="sticky-col">Person</TableCell>
                {t.weeks.map((w) => <TableCell key={w} align="center" sx={{ whiteSpace: 'nowrap' }}>{fmtDay(w)}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {t.people.map((p) => (
                <TableRow key={p.person}>
                  <TableCell className="sticky-col" sx={{ fontWeight: 500 }}>{p.nick}</TableCell>
                  {t.weeks.map((w) => (
                    <TableCell key={w} align="center">
                      <Box sx={{ display: 'inline-flex', gap: 1 }}>
                        {cell(p.weeks[w]?.plan, 'Plan')}
                        {cell(p.weeks[w]?.report, 'Report')}
                      </Box>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="sticky-col" sx={{ color: 'text.secondary' }}>Reports on time</TableCell>
                {t.report.map((r) => (
                  <TableCell key={r.week} align="center" className="tabular" sx={{ color: 'text.secondary' }}>
                    {r.ontime}/{r.ontime + r.late + r.missing + r.open}
                  </TableCell>
                ))}
              </TableRow>
            </TableBody>
          </Table>
        </ScrollX>
      )}
      {t && (
          <Box sx={{
            display: 'flex', gap: 4, flexWrap: 'wrap', pt: 3,
          }}
          >
            {[['On time', PILL.good], ['Late', PILL.warn], ['Missing', PILL.bad]].map(([l, c]) => (
              <Box key={l} sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{
                  width: 8, height: 8, borderRadius: '2px', bgcolor: c,
                }}
                />
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>{l}</Typography>
              </Box>
            ))}
          </Box>
      )}
    </CardFrame>
  )
}
