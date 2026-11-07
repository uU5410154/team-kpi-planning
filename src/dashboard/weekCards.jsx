import { useState } from 'react'
import {
  Box, Typography, Button, ButtonBase, Skeleton, Table, TableBody, TableCell, TableHead, TableRow,
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
  STATUS_LABEL, weekNo, weekTitle, bangkokTime, BLOCKER_CATEGORIES,
} from '../lib/weekly.js'
import {
  projectCounts, updatedCount, ownerRows, reportedWeek, blockersByType, slipping, workload, submissionTrend,
} from '../lib/manager.js'
import CardFrame from './CardFrame.jsx'

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
  return <>{Array.from({ length: rows }, (_x, i) => <Skeleton key={i} height={40} />)}</>
}

const ProjectLink = ({ p, onOpen }) => (
  <Link component="button" onClick={() => onOpen?.(p.key)} sx={{ fontWeight: 650, textAlign: 'left', color: 'text.primary' }} underline="hover">
    {p.summary || p.key}
  </Link>
)

/* --------------------------------------------------------------- counts */

export function ActiveCard({ ctx, f }) {
  const week = ctx.now?.week
  const {
    total, active, forced, byDates,
  } = projectCounts(ctx.plan.projects, week || undefined)
  return (
    <CardFrame {...f} bare title="Active projects">
      <StatTile
        label="Active projects"
        value={active}
        unit={`of ${total} in the register`}
        context={active
          ? `${byDates} by their dates${forced ? ` · ${forced} switched on` : ''} · ${week ? `week ${weekNo(week)}` : 'this week'}`
          : 'No project’s dates cover this week — switch one on in the Timeline'}
        help="A project is active in a week when its start-to-due dates cover that week. An administrator can override that either way on the Timeline or the project page. The total counts every project in the register, active or not."
      />
    </CardFrame>
  )
}

export function UpdatedCard({ ctx, f }) {
  const { now } = ctx
  const { updated, active } = updatedCount(ctx.plan.projects, now)
  const planDue = now?.deadlines?.planDue
  const early = !now || now.now < planDue
  const share = active ? updated / active : 0
  return (
    <CardFrame {...f} bare title="Updated this week">
      <StatTile
        label="Updated this week"
        value={now ? updated : '—'}
        unit={`of ${active} active`}
        tone={early || !active ? undefined : share >= 1 ? 'good' : share >= 0.5 ? 'warning' : 'critical'}
        context={now
          ? `${Math.max(0, active - updated)} not updated yet · ${weekTitle(now.week)}`
          : 'The weekly check-ins could not be read'}
        help="An active project counts as updated when somebody's week has a task linked to it — saved or submitted. Follow up from the owners card to ask for one."
      />
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

export function OwnersCard({ ctx, f }) {
  const [only, setOnly] = useState('all')
  const groups = ownerRows({
    projects: ctx.plan.projects, people: ctx.plan.assignees || ctx.plan.people, now: ctx.now, prev: ctx.prev, followups: ctx.followups, prevJira: ctx.prevJira,
  })
  const shown = groups
    .map((g) => ({ ...g, projects: only === 'stale' ? g.projects.filter((p) => !p.thisWeek.length) : g.projects }))
    .filter((g) => g.projects.length)
  const count = groups.reduce((a, g) => a + g.projects.length, 0)
  return (
    <CardFrame
      {...f}
      title="Who holds what"
      label="who holds what"
      sub={ctx.now ? `${count} active project${count === 1 ? '' : 's'} by owner — last week, this week, and a follow-up a click away` : undefined}
      action={(
        <ToggleButtonGroup size="small" exclusive value={only} onChange={(_e, v) => v && setOnly(v)}>
          <ToggleButton value="all" sx={{ textTransform: 'none', px: 1.5 }}>All</ToggleButton>
          <ToggleButton value="stale" sx={{ textTransform: 'none', px: 1.5 }}>Not updated</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      {ctx.now === undefined || ctx.now === null ? <Waiting ctx={ctx} /> : (
        <>
          {count === 0 && (
            <Box sx={{ py: 1 }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                No project is active this week: none has start and due dates covering week {weekNo(ctx.now.week)}, and none is
                switched on. Give projects their dates, or set one to &ldquo;Always active&rdquo; on the Timeline.
              </Typography>
              <Button size="small" variant="outlined" onClick={() => ctx.onGoTo?.('timeline')}>Open the Timeline</Button>
            </Box>
          )}
          {ctx.prevJiraError && (
            <Typography variant="caption" sx={{ color: 'warning.light', display: 'block', mb: 1 }} data-coverage-error>
              Week {ctx.prev ? weekNo(ctx.prev.week) : ''} could not be read from Jira, so only what people typed in shows: {ctx.prevJiraError}
            </Typography>
          )}
          {count > 0 && shown.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Every active project has an update this week.</Typography>
          )}
          {shown.length > 0 && (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 860, '& td': { verticalAlign: 'top' } }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: '24%' }}>Project</TableCell>
                    <TableCell sx={{ width: '28%' }}>{ctx.isCurrent === false ? 'Week before' : 'Last week'}{ctx.prev ? ` · week ${weekNo(ctx.prev.week)}` : ''}</TableCell>
                    <TableCell sx={{ width: '26%' }}>{ctx.isCurrent === false ? 'Week' : 'This week · week'} {weekNo(ctx.now.week)}</TableCell>
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
                          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                            {p.jiraKey || p.key} · due {fmtDay(p.due)}
                          </Typography>
                        </TableCell>
                        <TableCell><TaskList tasks={p.lastWeek} kind="last" empty={ctx.prevJira ? 'Nothing in Jira covered last week' : 'No task last week'} /></TableCell>
                        <TableCell><TaskList tasks={p.thisWeek} kind="this" empty="Not updated yet" /></TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ color: p.latest ? 'text.primary' : 'text.disabled' }}>
                            {p.latest ? ago(p.latest) : 'never'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {g.person ? (
                            <FollowUp compact projectKey={p.key} followup={p.followup} onSent={ctx.onFollowSent} />
                          ) : (
                            <Typography variant="caption" sx={{ color: 'text.disabled' }}>No owner to ask</Typography>
                          )}
                        </TableCell>
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
      title={week ? `This week · ${weekTitle(week.week)}` : 'This week'}
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
                  {row.focus || 'No focus written yet.'}
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
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <TextField size="small" fullWidth placeholder="What was decided (also written on the task in Jira)" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="small" variant="contained" onClick={save} disabled={busy || !note.trim()}>Save</Button>
          <Button size="small" onClick={() => setOpen(false)}>Cancel</Button>
        </Box>
      )}
      {error && <Typography variant="caption" sx={{ color: 'error.main' }}>{error}</Typography>}
    </Box>
  )
}

export function DecisionsCard({ ctx, f }) {
  const pending = ctx.pending || []
  const asked = ctx.decisions || []
  const parts = [
    pending.length ? `${pending.length} request${pending.length === 1 ? '' : 's'} to move a project's date` : null,
    asked.length ? `${asked.length} decision${asked.length === 1 ? '' : 's'} asked for on tasks` : null,
  ].filter(Boolean)
  return (
    <CardFrame
      {...f}
      label="waiting for your decision"
      title="Waiting for your decision"
      sub={parts.length ? parts.join(' · ') : 'No date changes or decisions are waiting.'}
      action={pending.length > 0 && <Button size="small" onClick={() => ctx.onGoTo?.('weekly')}>Decide</Button>}
    >
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
  const when = (x) => new Date(x.writtenAt).toLocaleString('en-GB', {
    timeZone: 'Asia/Bangkok', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
  const next = nextSummary(ctx.now)
  let sub
  if (ctx.aiOn && own) sub = `Written by AI ${when(own)} ${WHEN[own.trigger] || ''}`
  else if (ctx.aiOn && older) sub = `Last week’s, written ${when(older)} · this week’s is written after ${next}`
  else if (ctx.aiOn) sub = 'Written by itself after Monday 08:00, Friday 15:00 and Sunday 15:00.'
  return (
    <CardFrame {...f} label="the week, summarised" title="The week, summarised" sub={sub}>
      {!ctx.aiOn && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          The AI is not switched on, so there is no summary. Add LOTUS_API_KEY on Render, then press Test the AI on
          the Access tab.
        </Typography>
      )}
      {ctx.aiOn && latest && <Markdown text={latest.text} dense />}
      {ctx.aiOn && !latest && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {ctx.summary === undefined
            ? 'Loading the summary…'
            : ctx.summary === null
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
      {!ctx.aiOn ? (
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
  const week = reportedWeek(ctx.now, ctx.prev)
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
    projects: ctx.plan.projects, asOf: ctx.plan.settings.asOfDate, weeks: [ctx.now, ctx.prev].filter(Boolean), pending: ctx.pending || [],
  })
  const nick = Object.fromEntries((ctx.plan.assignees || ctx.plan.people).map((p) => [p.id, p.nick]))
  return (
    <CardFrame {...f} label="slipping projects" title="Slipping projects" sub={`${list.length} active project${list.length === 1 ? '' : 's'} past due, landing late, or asking to move`}>
      {list.length === 0 && <Typography variant="body2" sx={{ color: 'text.secondary' }}>No active project is slipping.</Typography>}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {list.map((p) => (
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
  const rows = workload({ projects: ctx.plan.projects, people: ctx.plan.people, week: ctx.now })
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

