import { useMemo, useState } from 'react'
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Alert, Link, Tooltip, TableSortLabel,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { capacityOf, roleName, LOAD_HIGH, LOAD_OVER } from '../lib/costs.js'
import { useGov } from '../components/GovConflict.jsx'
import { Section, Stat, PageHead, TONE } from '../components/GovUi.jsx'
import { Pill } from '../components/Brand.jsx'
import Loading from '../components/Loading.jsx'

/*
 * CAPACITY AND SPRINT (management design summary, Priority 1).
 *
 * Per person: what they have for projects (their share of a full-time
 * month), what is planned on them, what they logged in Jira, and the load of
 * the next twelve weeks — remaining effort on their projects spread to each
 * due date, against what they have. Per project: planned against actual
 * effort, what is left, forecast at completion, sprint carry-over, replans,
 * blocked days and work in progress.
 */

const h = (n) => (n == null ? '—' : Math.round(n).toLocaleString())
const md = (n, hpd) => (n == null ? '—' : (Math.round((n / hpd) * 10) / 10).toLocaleString())
const loadTone = (x) => (x == null ? null : x > LOAD_OVER ? TONE.bad : x > LOAD_HIGH ? TONE.warn : TONE.good)

function LoadStrip({ load }) {
  return (
    <Box sx={{ display: 'flex', gap: '2px' }} aria-label="load over the next twelve weeks">
      {load.map((w) => (
        <Tooltip key={w.week} title={`Week of ${w.week}: ${Math.round(w.hours)} h of ${Math.round(w.available)} h${w.load != null ? ` (${Math.round(w.load * 100)}%)` : ''}`}>
          <Box sx={(t) => ({
            width: 9,
            height: 20,
            borderRadius: '3px',
            bgcolor: w.load == null ? t.palette.divider : alpha(loadTone(w.load), Math.min(1, 0.25 + w.load * 0.6)),
          })}
          />
        </Tooltip>
      ))}
    </Box>
  )
}

export default function Capacity({ plan, onOpenProject, onGoTo }) {
  const { gov, error } = useGov()
  const [sort, setSort] = useState({ by: 'variance', dir: 'desc' })
  const cap = useMemo(() => (gov ? capacityOf(plan, gov) : null), [plan, gov])
  if (error) return <Alert severity="error">{error}</Alert>
  if (!cap) return <Loading variant="block" label="Working out capacity…" />
  const hpd = plan.finance?.hoursPerManday || 8
  const t = cap.totals
  const variance = t.variance
  const projects = [...cap.projects].sort((a, b) => {
    const va = a[sort.by]
    const vb = b[sort.by]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const d = typeof va === 'string' ? va.localeCompare(vb) : va - vb
    return sort.dir === 'asc' ? d : -d
  })
  const nick = Object.fromEntries((plan.people || []).map((p) => [p.id, p.nick || p.name]))
  const head = (k, label, align = 'right') => (
    <TableCell align={align}>
      <TableSortLabel active={sort.by === k} direction={sort.by === k ? sort.dir : 'desc'} onClick={() => setSort((s) => ({ by: k, dir: s.by === k && s.dir === 'desc' ? 'asc' : 'desc' }))}>{label}</TableSortLabel>
    </TableCell>
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="capacity">
      <PageHead title="Capacity & sprint">
        What the team has for projects, what is planned on it and what it actually logged in Jira — by person and by
        project — with carry-over, replans, blocked days and work in progress. Hours; man-days at {hpd} hours.
      </PageHead>

      {!cap.worklogs && (
        <Alert severity="warning" variant="outlined" action={onGoTo && <Link component="button" onClick={() => onGoTo('rates')}>Open Costs &amp; rates</Link>}>
          Jira&rsquo;s worklogs have not been read yet, so actual effort, carry-over and work in progress are not known.
        </Alert>
      )}
      {cap.worklogs?.ok === false && <Alert severity="error" variant="outlined">The last read of Jira&rsquo;s worklogs failed: {cap.worklogs.error}</Alert>}

      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)', xl: 'repeat(8, 1fr)' } }}>
        <Stat label="Available for projects" value={`${md(t.available, hpd)} md`} note="A year, at each member's project share" data-stat="available" />
        <Stat label="Planned effort" value={`${md(t.planned, hpd)} md`} note="Register man-days, or labour forecast" />
        <Stat label="Actual effort" value={t.actual == null ? '—' : `${md(t.actual, hpd)} md`} note={cap.worklogs?.at ? `Jira worklogs, ${new Date(cap.worklogs.at).toLocaleDateString()}` : null} gap={t.actual == null ? 'No worklogs read yet' : null} data-stat="actual" />
        <Stat label="Remaining estimate" value={`${md(t.remaining, hpd)} md`} note="Jira remaining, else forecast − logged" />
        <Stat
          label="Capacity variance"
          value={variance == null ? '—' : `${variance > 0 ? '+' : ''}${md(variance, hpd)} md`}
          tone={variance > 0 ? TONE.bad : variance != null ? TONE.good : undefined}
          note={variance == null ? null : `At completion − planned, over ${t.varianceProjects} project${t.varianceProjects === 1 ? '' : 's'} with both`}
          gap={variance == null ? 'Needs planned and actual effort' : null}
          help="(Actual + remaining) − planned. Above zero: the work is taking more than was planned."
          data-stat="variance"
        />
        <Stat label="Carried over" value={t.carried == null ? '—' : h(t.carried)} note="Open tasks in more than one sprint" />
        <Stat label="Replanned twice or more" value={h(t.repeatReplans)} note={`${h(t.replans)} replans in all`} tone={t.repeatReplans ? TONE.warn : undefined} />
        <Stat label="Blocked days" value={h(t.blockedDays)} note={`Work in progress: ${t.wip == null ? '—' : h(t.wip)} tasks`} help="Five working days for every week somebody reported a project blocked or on hold in the weekly check-in. An approximation: the check-in says a week was blocked, not for how many of its days." />
      </Box>

      <Section
        title="People"
        subtitle={`Load over the next ${cap.weeks.length} weeks: what is left on each member's projects, spread evenly to each due date, against their project hours. Amber above ${Math.round(LOAD_HIGH * 100)}%, red above ${Math.round(LOAD_OVER * 100)}%.`}
        data-section="people-load"
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Member</TableCell><TableCell>Role</TableCell><TableCell align="right">Project share</TableCell>
                <TableCell align="right">h / month</TableCell><TableCell align="right">Projects</TableCell>
                <TableCell align="right">Planned h</TableCell><TableCell align="right">Logged h</TableCell><TableCell align="right">Left h</TableCell>
                <TableCell align="right">WIP</TableCell><TableCell>Next {cap.weeks.length} weeks</TableCell><TableCell>Load</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cap.people.map((p) => (
                <TableRow key={p.id} data-person-load={p.id}>
                  <TableCell sx={{ fontWeight: 600 }}>{p.nick}</TableCell>
                  <TableCell>{p.role ? roleName(gov.rates, p.role) : <Typography variant="caption" sx={{ color: 'text.disabled' }}>not set</Typography>}</TableCell>
                  <TableCell align="right">{p.allocationSet ? `${p.allocation.project}%` : <Tooltip title="Not set on Costs & rates; taken as 100%"><span style={{ color: TONE.muted }}>100%*</span></Tooltip>}</TableCell>
                  <TableCell align="right">{h(p.monthHours)}</TableCell>
                  <TableCell align="right">{p.projects}</TableCell>
                  <TableCell align="right">{h(p.planned)}</TableCell>
                  <TableCell align="right">{h(p.logged)}</TableCell>
                  <TableCell align="right">{h(p.remaining)}</TableCell>
                  <TableCell align="right">{h(p.wip)}</TableCell>
                  <TableCell><LoadStrip load={p.load} /></TableCell>
                  <TableCell>
                    {p.warning === 'over' && <Pill label={`Over capacity · ${Math.round(p.peak * 100)}%`} tone="bad" />}
                    {p.warning === 'high' && <Pill label={`High · ${Math.round(p.peak * 100)}%`} tone="warn" />}
                    {!p.warning && <Pill label="OK" tone="good" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        {cap.strangers.length > 0 && (
          <Typography variant="caption" sx={{ color: TONE.warn, display: 'block', mt: 1 }}>
            Logged by people not on the team: {cap.strangers.map((s) => `${s.name} (${h(s.hours)} h)`).join(', ')}.
          </Typography>
        )}
      </Section>

      <Section title="Projects" subtitle="Planned against actual effort, and what is slowing delivery. Click a heading to sort." data-section="project-effort">
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {head('name', 'Project', 'left')}
                <TableCell>PIC</TableCell>
                {head('planned', 'Planned (h)')}
                {head('actual', 'Actual (h)')}
                {head('remaining', 'Remaining (h)')}
                {head('fac', 'At completion (h)')}
                {head('variance', 'Variance (h)')}
                {head('carried', 'Carried over')}
                {head('replans', 'Replans')}
                {head('blockedDays', 'Blocked days')}
                {head('wip', 'In progress')}
              </TableRow>
            </TableHead>
            <TableBody>
              {projects.map((x) => (
                <TableRow key={x.key} hover data-effort-row={x.key}>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Link component="button" onClick={() => onOpenProject?.(x.key)} sx={{ fontWeight: 600, textAlign: 'left' }}>{x.key}</Link>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{x.name}</Typography>
                  </TableCell>
                  <TableCell>{nick[x.pic] || '—'}</TableCell>
                  <TableCell align="right">{h(x.planned)}</TableCell>
                  <TableCell align="right">{h(x.actual)}</TableCell>
                  <TableCell align="right">{h(x.remaining)}</TableCell>
                  <TableCell align="right">{h(x.fac)}</TableCell>
                  <TableCell align="right" sx={{ color: x.variance > 0 ? TONE.bad : x.variance != null ? TONE.good : undefined }}>{x.variance == null ? '—' : `${x.variance > 0 ? '+' : ''}${h(x.variance)}`}</TableCell>
                  <TableCell align="right">{h(x.carried)}</TableCell>
                  <TableCell align="right" sx={{ color: x.replans >= 2 ? TONE.warn : undefined, fontWeight: x.replans >= 2 ? 700 : 400 }}>{x.replans}</TableCell>
                  <TableCell align="right">
                    {x.blockedDays ? <Tooltip title={x.lastBlocker || ''}><span>{x.blockedDays}</span></Tooltip> : 0}
                  </TableCell>
                  <TableCell align="right">{h(x.wip)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      </Section>
    </Box>
  )
}
