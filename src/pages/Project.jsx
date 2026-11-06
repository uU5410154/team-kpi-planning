import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, Button, Grid, Link, Skeleton, Alert, Divider,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import TimelineIcon from '@mui/icons-material/ViewTimelineOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import FolderIcon from '@mui/icons-material/FolderOutlined'
import * as api from '../lib/api.js'
import { fmtHours } from '../lib/model.js'
import { OBJ_BY_ID } from '../lib/palette.js'
import {
  weekLabel, weekTitle, PROPOSAL_LABEL, BLOCKER_CATEGORIES, PRIORITIES,
} from '../lib/weekly.js'
import {
  Pill, IconTile, PAGE_COLOR, personColor, statusTone,
} from '../components/Brand.jsx'
import FollowUp, { ago } from '../components/FollowUp.jsx'
import ActiveControl from '../dashboard/ActiveControl.jsx'
import { activeInWeek } from '../lib/manager.js'

/**
 * ONE PROJECT, IN FULL.
 *
 * What the register says about it — owner, dates, status, hours, the Jira
 * epic — and everything the weekly check-ins have said: what is waiting for a
 * decision, what is in the way, and every task week by week. Opened from the
 * manager dashboard and from the email an administrator gets when a follow-up
 * is answered.
 *
 * Every register line on the same Jira epic is read together, as the Timeline
 * draws them: they are one piece of work.
 */

const CATEGORY = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))
const PRIORITY = Object.fromEntries(PRIORITIES.map((p) => [p.id, p.label]))
const PROPOSAL_TONE = {
  pending: 'violet', deciding: 'violet', approved: 'good', rejected: 'bad', withdrawn: 'neutral',
}
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
}) : '—')

function Fact({ label, children }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{label}</Typography>
      <Typography variant="body2" component="div" sx={{ fontWeight: 600, mt: 0.25 }}>{children}</Typography>
    </Box>
  )
}

function TaskLine({ t }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', py: 0.75 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.title}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
          {t.nick}
          {t.priority ? ` · ${PRIORITY[t.priority]}` : ''}
          {t.expected ? ` · expected ${fmtDay(t.expected)}` : ''}
          {t.carriedFrom ? ` · carried from ${weekLabel(t.carriedFrom)}` : ''}
        </Typography>
        {t.done === false && t.blocker && (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.25 }}>
            In the way{t.blockerCategory ? ` (${CATEGORY[t.blockerCategory]})` : ''}: {t.blocker}
            {t.newDate ? ` · now ${fmtDay(t.newDate)}` : ''}
          </Typography>
        )}
      </Box>
      {t.done === true && <Pill label="Done" tone="good" />}
      {t.done === false && <Pill label={`Not done${t.pct != null ? ` · ${t.pct}%` : ''}`} tone="warn" />}
      {t.done == null && <Pill label={t.reportIn ? 'No answer' : 'Planned'} tone="neutral" />}
    </Box>
  )
}

export default function Project({
  plan, projectKey, canWrite, onUpdate, onBack, onShowTimeline,
}) {
  const p = plan.projects.find((x) => x.key === projectKey)
    || plan.projects.find((x) => String(x.jiraKey || '').toUpperCase() === String(projectKey || '').toUpperCase())
  // Every register line on the same epic: one piece of work.
  const lines = useMemo(() => {
    if (!p) return []
    const k = String(p.jiraKey || '').trim().toUpperCase()
    return k ? plan.projects.filter((x) => !x.deleted && String(x.jiraKey || '').trim().toUpperCase() === k) : [p]
  }, [plan.projects, p])
  const keys = lines.map((x) => x.key)

  const [weekly, setWeekly] = useState(undefined)
  const [follow, setFollow] = useState([])
  const [jiraSite, setJiraSite] = useState(null)
  useEffect(() => {
    let stop = false
    api.weeklyByProject().then((r) => { if (!stop) setWeekly(r.byProject || {}) }).catch(() => { if (!stop) setWeekly(null) })
    if (canWrite) api.followups(null).then((r) => { if (!stop) setFollow(r.followups || []) }).catch(() => {})
    api.jiraStatus().then((s) => { if (!stop) setJiraSite(s?.site || null) }).catch(() => {})
    return () => { stop = true }
  }, [projectKey, canWrite])

  if (!p) {
    return (
      <Alert severity="warning" action={<Button color="inherit" size="small" onClick={onBack}>Back</Button>}>
        There is no project {projectKey} in the register.
      </Alert>
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
  // Active this week: by its dates, unless an administrator overrode it.
  const active = lines.length > 0 && lines.every((x) => activeInWeek(x))
  const forced = lines.every((x) => x.active === true) ? 'switched on' : lines.every((x) => x.active === false) ? 'switched off' : 'by its dates'
  const hours = lines.reduce((a, x) => a + (x.savingHours || 0), 0)
  const jiraKey = String(p.jiraKey || '').trim()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box>
        <Button size="small" startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 1, color: 'text.secondary' }}>Back</Button>
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
          <Box sx={{
            display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap',
          }}
          >
            <IconTile icon={FolderIcon} color={PAGE_COLOR.projects} size={44} />
            <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
              <Typography variant="h2" sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' } }}>{p.summary || p.key}</Typography>
              <Box sx={{
                display: 'flex', gap: 0.75, alignItems: 'center', flexWrap: 'wrap', mt: 0.75,
              }}
              >
                {jiraKey && (jiraSite
                  ? (
                    <Link href={`${jiraSite}/browse/${jiraKey}`} target="_blank" rel="noopener noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, fontWeight: 600 }}>
                      {jiraKey}<OpenInNewIcon sx={{ fontSize: 14 }} />
                    </Link>
                  )
                  : <Typography variant="body2" sx={{ fontWeight: 600 }}>{jiraKey}</Typography>)}
                {(p.srcStatus || p.status) && <Pill label={p.srcStatus || p.status} tone={statusTone(p.status || p.srcStatus)} />}
                <Pill label={active ? 'Active' : 'Not active'} tone={active ? 'info' : 'neutral'} title={`This week, ${forced}`} />
                {lines.length > 1 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{lines.length} register lines on this epic</Typography>}
              </Box>
            </Box>
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap',
            }}
            >
              {canWrite && (
                <ActiveControl
                  projects={lines}
                  size="medium"
                  label="active project"
                  onSet={(v) => keys.forEach((k) => onUpdate(k, { active: v }))}
                />
              )}
              <Button size="small" startIcon={<TimelineIcon />} onClick={() => onShowTimeline?.(p.key)}>Timeline</Button>
              {canWrite && (
                <FollowUp
                  projectKey={p.key}
                  followup={lastFollow}
                  onSent={(f) => setFollow((list) => [f, ...list])}
                />
              )}
            </Box>
          </Box>

          <Divider sx={{ my: 2 }} />
          <Grid container spacing={2}>
            <Grid item xs={6} sm={4} md={2}>
              <Fact label="Owner">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {owner && <IconTile text={(owner.nick || '?').slice(0, 2)} color={personColor(plan.people, owner.id)} size={24} />}
                  {owner?.nick || owner?.name || 'TBC'}
                </Box>
              </Fact>
            </Grid>
            <Grid item xs={6} sm={4} md={2}><Fact label="Start">{fmtDay(p.start)}</Fact></Grid>
            <Grid item xs={6} sm={4} md={2}><Fact label="Due">{fmtDay(p.due)}</Fact></Grid>
            <Grid item xs={6} sm={4} md={2}><Fact label="Saving hours / month">{fmtHours(hours)}</Fact></Grid>
            <Grid item xs={6} sm={4} md={2}><Fact label="Objective">{OBJ_BY_ID[p.objective]?.short || '—'}</Fact></Grid>
            <Grid item xs={6} sm={4} md={2}><Fact label="Latest weekly update">{latest ? ago(latest) : 'none yet'}</Fact></Grid>
          </Grid>
        </Paper>
      </Box>

      {weekly === undefined && <Skeleton variant="rounded" height={160} />}
      {weekly === null && (
        <Alert severity="info" variant="outlined">The weekly check-ins could not be read just now, so only the register is shown.</Alert>
      )}

      {waiting.length > 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }} component="section" aria-label="waiting for a decision">
          <Typography variant="h4" sx={{ mb: 1 }}>Waiting for a decision</Typography>
          {waiting.map((x) => (
            <Typography key={x.id} variant="body2" sx={{ py: 0.5 }}>
              <strong>{x.nick}</strong> asks to move it from {fmtDay(x.currentDue)} to {x.proposedDue ? fmtDay(x.proposedDue) : 'a date you pick'}
              {' '}— “{x.taskTitle}”.
            </Typography>
          ))}
        </Paper>
      )}

      {story.blockers.length > 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }} component="section" aria-label="in the way">
          <Typography variant="h4" sx={{ mb: 1 }}>In the way</Typography>
          {story.blockers.map((b) => (
            <Typography key={`${b.week}.${b.person}.${b.title}`} variant="body2" sx={{ py: 0.5 }}>
              <strong>{b.nick}</strong>{b.blockerCategory ? ` · ${CATEGORY[b.blockerCategory]}` : ''}: {b.blocker}
              <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}> — “{b.title}”, {weekTitle(b.week)}</Typography>
            </Typography>
          ))}
        </Paper>
      )}

      {weekly && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }} component="section" aria-label="week by week">
          <Typography variant="h4">Week by week</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
            Every task linked to this project in the weekly check-ins, the last eight weeks.
          </Typography>
          {weeks.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>Nobody has reported on this project in the last eight weeks.</Typography>
          )}
          {weeks.map((w) => (
            <Box key={w} sx={{ borderTop: 1, borderColor: 'divider', pt: 1, mt: 1 }}>
              <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>{weekTitle(w)}</Typography>
              {byWeek[w].map((t) => <TaskLine key={`${t.person}.${t.title}.${t.expected}`} t={t} />)}
            </Box>
          ))}
        </Paper>
      )}

      {decided.length > 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }} component="section" aria-label="date changes decided">
          <Typography variant="h4" sx={{ mb: 1 }}>Date changes decided</Typography>
          {decided.map((x) => (
            <Box key={x.id} sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.5, flexWrap: 'wrap' }}>
              <Pill label={PROPOSAL_LABEL[x.status]} tone={PROPOSAL_TONE[x.status]} />
              <Typography variant="body2">
                {x.status === 'approved'
                  ? `Moved from ${fmtDay(x.fromDue)} to ${fmtDay(x.decidedDue)}`
                  : `Kept at ${fmtDay(x.currentDue)} — ${x.reason}`}
                {' '}· asked by {x.nick}, decided by {x.decidedBy}
              </Typography>
            </Box>
          ))}
        </Paper>
      )}
    </Box>
  )
}
