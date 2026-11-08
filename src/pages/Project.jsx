import { useEffect, useMemo, useState } from 'react'
import {
  Box, Typography, Button, Link, Skeleton, ButtonBase,
} from '@mui/material'
import TimelineIcon from '@mui/icons-material/ViewTimelineOutlined'
import HistoryIcon from '@mui/icons-material/HistoryOutlined'
import * as api from '../lib/api.js'
import { projectOnHold } from '../lib/hold.js'
import { fmtHours } from '../lib/model.js'
import { OBJ_BY_ID } from '../lib/palette.js'
import {
  weekLabel, weekNo, PROPOSAL_LABEL, BLOCKER_CATEGORIES, PRIORITIES, weekOf,
} from '../lib/weekly.js'
import { statusTone } from '../components/Brand.jsx'
import FollowUp, { ago } from '../components/FollowUp.jsx'
import { Spinner } from '../components/Loading.jsx'
import {
  PageHeader, Section, StatusPill, EmptyState, ErrorState,
} from '../components/ui.jsx'
import ActiveControl from '../dashboard/ActiveControl.jsx'
import {
  activitySignals, unitSource, unitActive, ACTIVE_WHY,
} from '../lib/manager.js'

/**
 * ONE PROJECT, IN FULL.
 *
 * What the register says about it (owner, dates, status, hours, the Jira
 * epic) and everything the weekly check-ins have said: what is waiting for a
 * decision, what is in the way, and every task week by week. Opened from the
 * manager dashboard, from the register's popup, and from the email an
 * administrator gets when a follow-up is answered.
 *
 * Every register line on the same Jira epic is read together, as the Timeline
 * draws them: they are one piece of work.
 */

const CATEGORY = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))
const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]))
const PROPOSAL_TONE = {
  pending: 'info', deciding: 'info', approved: 'success', rejected: 'danger', withdrawn: 'neutral',
}
const PILL_TONE = {
  good: 'success', info: 'info', neutral: 'neutral', violet: 'info',
}
const STATUS_WORD = { 'Not Start': 'Not started', 'In Progress': 'In progress', 'On Hold': 'On hold' }
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}) : null)
const fmtShort = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', timeZone: 'UTC',
}) : '')
const Dash = () => <Box component="span" sx={{ color: 'text.tertiary' }}>–</Box>

/** One fact in the definition grid: a label over its value. */
function Fact({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" component="dt" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body1" component="dd" className="tabular" sx={{ fontWeight: 500, mt: 1, ml: 0 }} noWrap>{children}</Typography>
    </Box>
  )
}

/*
 * One part of the page. On the page it is a Section (a card); inside the
 * project popup the dialog is already the surface, so the parts are separated
 * by space and a hairline, not drawn as boxes within the box.
 */
function Part({
  flat, title, meta, children, ...rest
}) {
  if (!flat) return <Section title={title} meta={meta} padded={false} {...rest}>{children}</Section>
  return (
    <Box component="section" {...rest}>
      {title && <Typography variant="h2">{title}</Typography>}
      {meta && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{meta}</Typography>}
      <Box sx={{ mt: 2, borderTop: 1, borderColor: 'border.subtle' }}>{children}</Box>
    </Box>
  )
}

/** Where a task stands, as one pill. */
function TaskPill({ t, hold }) {
  if (hold) return <StatusPill tone="warning">On hold</StatusPill>
  if (t.done === true) return <StatusPill tone="success">Done</StatusPill>
  if (t.done === false) return <StatusPill tone="warning">{`Not done${t.pct != null ? `, ${t.pct}%` : ''}`}</StatusPill>
  return <StatusPill tone="neutral">{t.reportIn ? 'No answer' : 'Planned'}</StatusPill>
}

function TaskLine({ t, first, px }) {
  // "On hold" written as the blocker is how the Jira flow records a hold; it is not in the way.
  const hold = t.hold || (t.done === false && /^on hold$/i.test(String(t.blocker || '').trim()))
  const why = !hold && t.done === false ? (t.blocker && !/^on hold$/i.test(t.blocker.trim()) ? t.blocker : t.reason || '') : ''
  const meta = [
    t.nick,
    t.priority ? PRIORITY[t.priority] : null,
    t.expected ? `expected ${fmtShort(t.expected)}` : null,
    t.carriedFrom ? `carried from week ${weekNo(t.carriedFrom)}` : null,
    t.reportedAt ? `sent ${ago(t.reportedAt)}` : null,
  ].filter(Boolean).join(', ')
  return (
    <Box
      sx={{
        display: 'flex', gap: 3, alignItems: 'flex-start', px, py: 3, borderTop: first ? 0 : 1, borderColor: 'border.subtle',
      }}
      data-task-line={t.jiraKey || t.title}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="h3" component="div">{t.title}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{meta}</Typography>
        {t.progress && (
          <Typography
            variant="body2"
            data-progress
            sx={{
              mt: 2, pl: 2, borderLeft: 2, borderColor: 'border.strong', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5, maxWidth: '72ch',
            }}
          >
            {t.progress}
          </Typography>
        )}
        {hold && t.reason && !/^on hold$/i.test(t.reason.trim()) && (
          <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary' }}>Why on hold: {t.reason}</Typography>
        )}
        {why && (
          <Typography variant="body2" sx={{ mt: 1.5 }}>
            In the way{t.blockerCategory ? ` (${CATEGORY[t.blockerCategory]})` : ''}: {why}
            {t.newDate ? <Box component="span" sx={{ color: 'text.secondary' }}>{`, now ${fmtDay(t.newDate)}`}</Box> : null}
          </Typography>
        )}
      </Box>
      <TaskPill t={t} hold={hold} />
    </Box>
  )
}

/** What the active pill says, beside why, in the description. */
const WHY_WORDS = {
  'forced-on': 'switched on by an administrator',
  'forced-off': 'switched off by an administrator',
  jira: ACTIVE_WHY.jira,
  update: ACTIVE_WHY.update,
  decision: ACTIVE_WHY.decision,
}

export default function Project({
  plan, projectKey, canWrite, onUpdate, onBack, onShowTimeline, inDialog = false, actions = null,
}) {
  const p = plan.projects.find((x) => x.key === projectKey)
    || plan.projects.find((x) => String(x.jiraKey || '').toUpperCase() === String(projectKey || '').toUpperCase())
  // Every register line on the same epic: one piece of work.
  const lines = useMemo(() => {
    if (!p) return []
    const k = String(p.jiraKey || '').trim().toUpperCase()
    return k ? plan.projects.filter((x) => !x.deleted && String(x.jiraKey || '').trim().toUpperCase() === k) : [p]
  }, [plan.projects, p])
  const held = lines.some(projectOnHold)
  const heldInJira = lines.map((l) => l.jiraStatus).find((x) => x && projectOnHold({ jiraStatus: x })) || null
  const keys = lines.map((x) => x.key)

  const [weekly, setWeekly] = useState(undefined)
  const [follow, setFollow] = useState([])
  const [jiraSite, setJiraSite] = useState(null)
  // What makes it active this week beside its dates: Jira work, an open
  // decision (and an update, from `weekly`). Undefined while asked for.
  const [coverage, setCoverage] = useState(undefined)
  const [openDecisions, setOpenDecisions] = useState(undefined)
  // Bumped by "Try again" when the check-ins could not be read.
  const [attempt, setAttempt] = useState(0)
  const thisWeek = weekOf()
  useEffect(() => {
    let stop = false
    setWeekly(undefined)
    api.weeklyByProject().then((r) => { if (!stop) setWeekly(r.byProject || {}) }).catch(() => { if (!stop) setWeekly(null) })
    if (canWrite) api.followups(null).then((r) => { if (!stop) setFollow(r.followups || []) }).catch(() => {})
    api.jiraStatus().then((s) => { if (!stop) setJiraSite(s?.site || null) }).catch(() => {})
    if (canWrite) {
      api.jiraCoverage(thisWeek).then((r) => { if (!stop) setCoverage(r?.jira === 'on' ? r.byProject || {} : null) }).catch(() => { if (!stop) setCoverage(null) })
    } else setCoverage(null)
    api.decisions('open').then((r) => { if (!stop) setOpenDecisions(r.decisions || []) }).catch(() => { if (!stop) setOpenDecisions(null) })
    return () => { stop = true }
  }, [projectKey, canWrite, thisWeek, attempt])
  const signals = useMemo(() => activitySignals({
    projects: plan.projects, jira: coverage || null, decisions: openDecisions || null, history: weekly || null, weekMonday: thisWeek,
  }), [plan.projects, coverage, openDecisions, weekly, thisWeek])
  const signalsReady = weekly !== undefined && coverage !== undefined && openDecisions !== undefined

  if (!p) {
    return (
      <Box>
        {!inDialog && <PageHeader title="Project not found" back={onBack ? { label: 'Back', onClick: onBack } : undefined} />}
        <EmptyState
          title={`There is no project ${projectKey} in the register.`}
          body="It may have been removed or renamed. Find it on the Projects page."
          action={onBack && <Button variant="outlined" onClick={onBack}>{inDialog ? 'Close' : 'Back'}</Button>}
        />
      </Box>
    )
  }

  const story = { history: [], blockers: [], proposals: [] }
  for (const k of keys) {
    const w = weekly?.[k]
    if (!w) continue
    story.history.push(...w.history)
    story.blockers.push(...w.blockers)
    story.proposals.push(...w.proposals)
  }
  const waiting = story.proposals.filter((x) => x.status === 'pending' || x.status === 'deciding')
  const decided = story.proposals.filter((x) => x.status === 'approved' || x.status === 'rejected')
  const byWeek = {}
  for (const t of story.history) (byWeek[t.week] = byWeek[t.week] || []).push(t)
  const weeks = Object.keys(byWeek).sort().reverse()
  const latest = story.history.map((t) => t.updatedAt).filter(Boolean).sort().pop()
  const lastFollow = follow.filter((f) => keys.includes(f.projectKey)).sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0] || null

  const owner = plan.assignees?.find((x) => x.id === p.pic) || plan.people.find((x) => x.id === p.pic)
  // Active this week: the same answer as the dashboard's (dates, Jira work,
  // an update, an open decision) unless an administrator overrode it.
  const why = unitSource(lines, thisWeek, signals)
  const active = unitActive(lines, thisWeek, signals)
  const hours = lines.reduce((a, x) => a + (x.savingHours || 0), 0)
  const jiraKey = String(p.jiraKey || '').trim()
  const status = p.srcStatus || p.status

  /* ------------------------------------------------------------ header */
  const title = (
    <Box component="span" sx={{ display: 'inline' }}>
      <Box component="span" sx={{ mr: 3 }}>{p.summary || p.key}</Box>
      <Box
        component="span"
        sx={{
          display: 'inline-flex', gap: 1.5, verticalAlign: 'middle', position: 'relative', top: -2, flexWrap: 'wrap',
        }}
      >
        {held
          ? (
            <StatusPill
              tone="warning"
              title={heldInJira ? `On hold in Jira (${heldInJira}). Its tasks are left out of the weekly update.` : 'Put on hold from a weekly update. Its tasks are left out of the weekly update.'}
            >
              On hold
            </StatusPill>
          )
          : status && <StatusPill tone={PILL_TONE[statusTone(p.status || p.srcStatus)] || 'neutral'}>{STATUS_WORD[status] || status}</StatusPill>}
        {signalsReady && (
          <Box component="span" data-active-pill={active ? 'on' : 'off'} data-active-why={why} sx={{ display: 'inline-flex' }}>
            <StatusPill tone={active ? 'info' : 'neutral'} title={`This week: ${ACTIVE_WHY[why]}`}>{active ? 'Active' : 'Not active'}</StatusPill>
          </Box>
        )}
      </Box>
    </Box>
  )
  // "FNP-379, James, has Jira work this week": the key, who holds it, and why it is active when not by its dates.
  const after = [
    owner?.nick || owner?.name || 'no owner yet',
    signalsReady && active && WHY_WORDS[why] ? WHY_WORDS[why] : null,
    lines.length > 1 ? `${lines.length} register lines on this epic` : null,
  ].filter(Boolean)
  const description = (
    <>
      {jiraKey && jiraSite
        ? <Link href={`${jiraSite}/browse/${jiraKey}`} target="_blank" rel="noopener noreferrer" title="Open in Jira" sx={{ fontWeight: 500 }}>{jiraKey}</Link>
        : <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{jiraKey || p.key}</Box>}
      {after.map((x) => `, ${x}`).join('')}
    </>
  )
  const headerActions = (
    <Box sx={{
      display: { xs: 'flex', sm: 'contents' }, flexWrap: 'wrap', alignItems: 'center', gap: 2, width: '100%',
    }}
    >
      {canWrite && lines.some((l) => l.onHold) && (
        <Button variant="outlined" data-resume onClick={() => keys.forEach((k) => onUpdate(k, { onHold: null }))}>
          Resume
        </Button>
      )}
      {canWrite && (signalsReady ? (
        <ActiveControl
          projects={lines}
          size="medium"
          label="active project"
          signals={signals}
          onSet={(v) => keys.forEach((k) => onUpdate(k, { active: v }))}
        />
      ) : (
        /* Until every signal is in, the control would say the wrong thing: it waits, saying so. */
        <ButtonBase
          disabled
          aria-label="checking whether this project is active"
          sx={{
            display: 'inline-flex', alignItems: 'center', gap: 1.5, height: 28, px: 2.5, borderRadius: '4px', border: 1, borderColor: 'border.subtle', color: 'text.tertiary', fontSize: '0.8125rem', fontWeight: 500,
          }}
        >
          <Spinner size={12} />
          Checking activity…
        </ButtonBase>
      ))}
      {actions}
      <Button variant="text" startIcon={<TimelineIcon />} onClick={() => onShowTimeline?.(p.key)}>Timeline</Button>
      {canWrite && (
        <FollowUp
          projectKey={p.key}
          followup={lastFollow}
          onSent={(f) => setFollow((list) => [f, ...list])}
          owner={owner?.nick}
          summary={p.summary}
          compact
        />
      )}
    </Box>
  )

  // Rows run to the card's padding on the page; in the popup, to the dialog's.
  const px = inDialog ? 0 : { xs: 3, sm: 4 }

  /* ------------------------------------------------------------- facts */
  const grid = (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        columnGap: 6,
        rowGap: 4,
        gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))', md: 'repeat(6, minmax(0, 1fr))' },
      }}
    >
      <Fact label="Owner">{owner?.nick || owner?.name || 'TBC'}</Fact>
      <Fact label="Start">{fmtDay(p.start) || <Dash />}</Fact>
      <Fact label="Due">{fmtDay(p.due) || <Dash />}</Fact>
      <Fact label="Saving hours a month">{fmtHours(hours)}</Fact>
      <Fact label="Objective">{OBJ_BY_ID[p.objective]?.short || <Dash />}</Fact>
      <Fact label="Latest weekly update">
        {weekly === undefined
          ? <Skeleton variant="text" width={80} height={20} sx={{ display: 'inline-block' }} />
          : latest ? ago(latest) : 'None yet'}
      </Fact>
    </Box>
  )
  // In the popup the facts are one tinted block, the dialog's single callout.
  const facts = inDialog
    ? <Box aria-label="facts" sx={{ bgcolor: 'bg.subtle', borderRadius: '8px', p: { xs: 3, sm: 4 } }}>{grid}</Box>
    : <Section aria-label="facts" padded>{grid}</Section>

  return (
    <Box>
      <PageHeader
        title={title}
        description={description}
        back={!inDialog && onBack ? { label: 'Back', onClick: onBack } : undefined}
        actions={headerActions}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: inDialog ? 5 : { xs: 3, sm: 4 } }}>
        {facts}

        {weekly === null && (
          <ErrorState
            title="The weekly check-ins could not be read."
            body="Only the register is shown. Try again in a moment."
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}

        {waiting.length > 0 && (
          <Part flat={inDialog} title="Waiting for a decision" aria-label="waiting for a decision">
            {waiting.map((x, i) => (
              <Box key={x.id} sx={{ px, py: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
                <Typography variant="body1">
                  <Box component="span" sx={{ fontWeight: 500 }}>{x.nick}</Box>
                  {` asks to move it from ${fmtDay(x.currentDue) || 'no date'} to ${x.proposedDue ? fmtDay(x.proposedDue) : 'a date you pick'}.`}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{`On “${x.taskTitle}”`}</Typography>
              </Box>
            ))}
          </Part>
        )}

        {story.blockers.length > 0 && (
          <Part flat={inDialog} title="In the way" aria-label="in the way">
            {story.blockers.map((b, i) => (
              <Box key={`${b.week}.${b.person}.${b.title}`} sx={{ px, py: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
                <Typography variant="body1">
                  <Box component="span" sx={{ fontWeight: 500 }}>{b.nick}</Box>
                  {b.blockerCategory ? <Box component="span" sx={{ color: 'text.secondary' }}>{` (${CATEGORY[b.blockerCategory]})`}</Box> : null}
                  {`: ${b.blocker}`}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {`On “${b.title}”, week ${weekNo(b.week)}, ${weekLabel(b.week)}`}
                </Typography>
              </Box>
            ))}
          </Part>
        )}

        {weekly !== null && (
          <Part
            flat={inDialog}
            title="Week by week"
            meta="Every task linked to this project in the weekly check-ins, the last eight weeks."
            aria-label="week by week"
          >
            {weekly === undefined && (
              <Box role="status" aria-label="Loading check-ins…" data-loading>
                <Box sx={{ px: inDialog ? 0 : { xs: 3, sm: 4 }, py: 2, bgcolor: inDialog ? 'transparent' : 'bg.subtle' }}><Skeleton variant="text" width={160} height={20} /></Box>
                {[0, 1, 2].map((i) => (
                  <Box key={i} sx={{ px, py: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
                    <Skeleton variant="text" width={['46%', '58%', '38%'][i]} height={20} />
                    <Skeleton variant="text" width="24%" height={16} sx={{ mt: 0.5 }} />
                  </Box>
                ))}
              </Box>
            )}
            {weekly && weeks.length === 0 && (
              <Box sx={{ px }}>
                <EmptyState inline icon={HistoryIcon} title="Nobody has reported on this project in the last eight weeks." />
              </Box>
            )}
            {weeks.map((w) => (
              <Box key={w}>
                <Box sx={inDialog ? {
                  pt: 4, pb: 1, borderBottom: 1, borderColor: 'border.subtle',
                } : {
                  px, py: 2, bgcolor: 'bg.subtle', borderTop: 1, borderBottom: 1, borderColor: 'border.subtle', mt: '-1px',
                }}
                >
                  <Typography variant="h3" component="h3">{`Week ${weekNo(w)}, ${weekLabel(w)}`}</Typography>
                </Box>
                {byWeek[w].map((t, i) => <TaskLine key={`${t.person}.${t.title}.${t.expected}`} t={t} first={i === 0} px={px} />)}
              </Box>
            ))}
          </Part>
        )}

        {decided.length > 0 && (
          <Part flat={inDialog} title="Date changes decided" aria-label="date changes decided">
            {decided.map((x, i) => (
              <Box
                key={x.id}
                sx={{
                  display: 'flex', gap: 3, alignItems: 'flex-start', px, py: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle',
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1">
                    {x.status === 'approved'
                      ? `Moved from ${fmtDay(x.fromDue)} to ${fmtDay(x.decidedDue)}`
                      : `Kept at ${fmtDay(x.currentDue)}: ${x.reason}`}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>{`Asked by ${x.nick}, decided by ${x.decidedBy}`}</Typography>
                </Box>
                <StatusPill tone={PROPOSAL_TONE[x.status]}>{PROPOSAL_LABEL[x.status]}</StatusPill>
              </Box>
            ))}
          </Part>
        )}
      </Box>
    </Box>
  )
}
