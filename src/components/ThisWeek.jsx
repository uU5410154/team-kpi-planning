import { useEffect, useState } from 'react'
import {
  Box, Grid, Paper, Typography, Button, ButtonBase, Skeleton,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import EventRepeatIcon from '@mui/icons-material/EventRepeatOutlined'
import * as api from '../lib/api.js'
import { STATUS_LABEL, weekLabel, bangkokTime } from '../lib/weekly.js'
import { Pill, IconTile, personColor } from './Brand.jsx'
import Markdown from './Markdown.jsx'

/*
 * THIS WEEK, ON THE DASHBOARD.
 *
 * The administrator's first look at the weekly check-in without leaving the
 * page they open on: who has sent their plan and report and what each person
 * is focused on; the date changes waiting for a decision; the AI's latest
 * summary; and a way into the chatbot. Every one of them reads what the
 * Weekly page reads — this adds nothing of its own, and the decisions are
 * still made there.
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

function Card({
  title, sub, action, children, label,
}) {
  return (
    <Paper variant="outlined" component="section" aria-label={label || title} sx={{ p: { xs: 1.75, sm: 2.25 }, minWidth: 0 }}>
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5, flexWrap: 'wrap',
      }}
      >
        <Box sx={{ flex: '1 1 180px', minWidth: 0 }}>
          <Typography variant="h4">{title}</Typography>
          {sub && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>{sub}</Typography>}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  )
}

export default function ThisWeek({
  plan, onGoTo, aiOn, onAsk,
}) {
  const [week, setWeek] = useState(undefined) // undefined: loading; null: not available
  const [pending, setPending] = useState([])
  const [summary, setSummary] = useState(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    let stop = false
    api.loadWeek('current')
      .then((w) => { if (!stop) setWeek(w) })
      .catch(() => { if (!stop) setWeek(null) })
    api.proposals('pending')
      .then((r) => { if (!stop) setPending(r.proposals || []) })
      .catch(() => {})
    return () => { stop = true }
  }, [])
  useEffect(() => {
    if (!aiOn || !week?.week) return undefined
    let stop = false
    api.aiSummary(week.week).then((r) => { if (!stop) setSummary(r) }).catch(() => {})
    return () => { stop = true }
  }, [aiOn, week?.week])

  if (week === null) return null
  const goWeekly = () => onGoTo?.('weekly')

  const team = week?.team || []
  const required = team.filter((t) => t.required)
  const inCount = (stage) => required.filter((t) => ['ontime', 'late'].includes(t.standing?.[stage])).length
  const reportOpen = week && week.now < week.deadlines.reportDue
  const latest = summary?.summaries?.[0]

  return (
    <Grid container spacing={2}>
      {/* ---------- focus and standing, per person ---------- */}
      <Grid item xs={12} lg={7}>
        <Card
          label="this week"
          title={week ? `This week · ${weekLabel(week.week)}` : 'This week'}
          sub={week && (
            `Plans in ${inCount('plan')} of ${required.length} · reports in ${inCount('report')} of ${required.length}`
            + (reportOpen ? ` · reports due ${bangkokTime(week.deadlines.reportDue)}` : '')
          )}
          action={<Button size="small" onClick={goWeekly}>Open Weekly</Button>}
        >
          {week === undefined && [0, 1, 2].map((i) => <Skeleton key={i} height={52} />)}
          {week && team.length === 0 && (
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>Nobody is on the submit list.</Typography>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {team.map((row) => (
              <ButtonBase
                key={row.person}
                onClick={goWeekly}
                aria-label={`${row.nick}'s week`}
                sx={{
                  display: 'flex', alignItems: 'flex-start', gap: 1.25, p: 1, borderRadius: '10px', textAlign: 'left',
                  justifyContent: 'flex-start', width: '100%', '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <IconTile text={row.nick.slice(0, 2)} color={personColor(plan?.people, row.person)} size={30} />
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
        </Card>
      </Grid>

      <Grid item xs={12} lg={5}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* ---------- date changes waiting ---------- */}
          <Card
            label="waiting for your decision"
            title="Waiting for your decision"
            sub={pending.length
              ? `${pending.length} request${pending.length === 1 ? '' : 's'} to move a project's date`
              : 'No date changes are waiting.'}
            action={pending.length > 0 && <Button size="small" onClick={goWeekly}>Decide</Button>}
          >
            {pending.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {pending.slice(0, 4).map((p) => (
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
                {pending.length > 4 && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>and {pending.length - 4} more on the Weekly page</Typography>
                )}
              </Box>
            )}
          </Card>

          {/* ---------- the AI's summary ---------- */}
          {aiOn && (
            <Card
              label="the week, summarised"
              title="The week, summarised"
              sub={latest
                ? `Written by AI ${new Date(latest.writtenAt).toLocaleString('en-GB', {
                  timeZone: 'Asia/Bangkok', weekday: 'short', hour: '2-digit', minute: '2-digit',
                })} ${WHEN[latest.trigger] || ''}`
                : 'Written by itself after Monday 08:00, Friday 15:00 and Sunday 15:00.'}
            >
              {latest && (
                <>
                  <Box sx={{ maxHeight: more ? 'none' : 220, overflow: 'hidden', position: 'relative' }}>
                    <Markdown text={latest.text} dense />
                  </Box>
                  {(latest.text.split('\n').length > 9 || latest.text.length > 700) && (
                    <Button size="small" onClick={() => setMore((m) => !m)} sx={{ mt: 0.5, px: 0 }}>
                      {more ? 'Show less' : 'Show all'}
                    </Button>
                  )}
                </>
              )}
            </Card>
          )}

          {/* ---------- the chatbot ---------- */}
          {aiOn && onAsk && (
            <Card
              label="ask about the plan"
              title="Ask about the plan"
              sub="In English or Thai — answered from the register, the money and the check-ins."
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {STARTERS.map((q) => (
                  <Button
                    key={q}
                    variant="outlined"
                    size="small"
                    onClick={() => onAsk(q)}
                    startIcon={<AutoAwesomeIcon sx={{ fontSize: '15px !important' }} />}
                    sx={{
                      justifyContent: 'flex-start', textAlign: 'left', fontWeight: 500, color: 'text.primary', borderColor: 'divider',
                    }}
                  >
                    {q}
                  </Button>
                ))}
                <Button size="small" onClick={() => onAsk(null)} sx={{ alignSelf: 'flex-start', px: 0 }}>
                  Ask something else
                </Button>
              </Box>
            </Card>
          )}
        </Box>
      </Grid>
    </Grid>
  )
}
