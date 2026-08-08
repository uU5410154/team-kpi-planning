import { useState } from 'react'
import {
  Box, Grid, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Alert, AlertTitle, ToggleButton, ToggleButtonGroup, Link, Chip, Divider,
} from '@mui/material'
import StatTile from '../components/StatTile.jsx'
import { HBar, StackedHBar, GateScatter, Meter, useChartTokens } from '../components/Charts.jsx'
import { OBJECTIVES, CHART, STATUS } from '../lib/palette.js'
import { fmtHours, fmtPct, fmtRatio, paybackMonths, SAVING_BASIS } from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

function Section({ title, subtitle, children, action }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Box>
          <Typography variant="h4">{title}</Typography>
          {subtitle && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  )
}

export default function Dashboard({ plan, onGoTo }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const tokens = useChartTokens()
  const { totals, people, projects, quality, byObjective, settings } = plan
  const [byPersonView, setByPersonView] = useState('chart')

  const ranked = [...people].sort((a, b) => b.hours - a.hours)

  const gatePoints = projects
    .filter((p) => (p.commitLevel === 'commit' || p.commitLevel === 'stretch') && p.savingHours != null && p.manday > 0)
    .map((p) => ({ key: p.key, summary: p.summary, savingHours: p.savingHours, manday: p.manday }))

  const series = OBJECTIVES.map((o, i) => ({
    id: o.id,
    label: `${o.no}. ${o.short}`,
    color: CHART[mode].series[i],
  }))

  const covTone = totals.coverage >= 1 ? 'good' : totals.coverage >= 0.9 ? 'warning' : 'critical'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* ---------- headline row ---------- */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <StatTile
            hero
            label="Total saving hours"
            value={fmtHours(totals.totalHours)}
            unit={settings.savingBasis === 'monthly' ? 'hrs / month' : 'hrs / year'}
            tone={totals.totalCoverage >= 1 ? 'good' : totals.totalCoverage >= 0.9 ? 'warning' : 'critical'}
            context={`${fmtPct(totals.totalCoverage)} of the ${totals.target.toLocaleString()} hr target · ${fmtHours(totals.doneHours)} already delivered`}
            help="Every project in the register, summed straight from the Saving hrs/mth column. No filtering — this always reconciles to the source workbook."
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatTile
            label={totals.teamRatio == null ? 'Headcount released' : 'Efficiency ratio'}
            value={totals.teamRatio == null ? fmtHours(totals.committedHC) : fmtRatio(totals.teamRatio)}
            unit={totals.teamRatio == null ? 'HC' : 'hrs / manday'}
            tone={totals.teamRatio == null ? undefined : totals.teamRatio >= settings.ratioGate ? 'good' : 'critical'}
            context={
              totals.teamRatio == null
                ? `Objective 1 needs mandays — none entered yet on ${quality.estimatedManday} projects`
                : `Gate is ${settings.ratioGate.toFixed(1)} · ${totals.failingGate} project${totals.failingGate === 1 ? '' : 's'} below it`
            }
            help={`Objective 1. Saving hours returned per manday invested. This is a gate, not a maximiser — it stops low-value work being booked for its hour count. On the ${SAVING_BASIS[settings.savingBasis].label.toLowerCase()} basis the gate implies a ${(() => { const m = paybackMonths(settings.ratioGate, settings.savingBasis); return m == null ? '—' : m < 24 ? `${m.toFixed(0)}-month` : `${(m / 12).toFixed(1)}-year` })()} payback on build effort.`}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatTile
            label="Concentration"
            value={fmtPct(totals.top2Share)}
            unit="in top 2"
            tone={totals.top2Share > 0.4 ? 'critical' : totals.top2Share > 0.25 ? 'warning' : 'good'}
            context={totals.topProjects[0] ? `Largest: ${totals.topProjects[0].key} at ${fmtHours(totals.topProjects[0].savingHours)} hrs` : '—'}
            help="Share of the committed pool sitting in the two largest projects. Above 40% the whole target depends on two deliveries landing."
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatTile
            label="Past due, not done"
            value={quality.pastDue}
            unit={`of ${quality.total}`}
            tone={quality.pastDue > 20 ? 'critical' : quality.pastDue > 5 ? 'warning' : 'good'}
            context={`Carrying ${fmtHours(quality.pastDueHours)} committed hrs · ${quality.missingSaving} epics still unquantified`}
            help={`Epics whose Jira due date is before ${settings.asOfDate} and whose status is not Done. Seven of twelve months are gone — anything still open here needs re-dating or dropping.`}
          />
        </Grid>
      </Grid>

      {quality.estimatedManday > 0 && (
        <Alert severity="warning" variant="outlined">
          <AlertTitle sx={{ fontWeight: 600 }}>Objective 1 has no denominator yet</AlertTitle>
          The source workbook records saving hours and headcount but no build effort, so mandays are blank on{' '}
          {quality.estimatedManday} of {quality.total} projects and the efficiency ratio cannot be computed. Enter
          mandays on the Projects tab and the gate, the scatter and every per-person ratio come alive.{' '}
          <Link component="button" onClick={() => onGoTo('projects')} sx={{ fontWeight: 600 }}>
            Enter mandays →
          </Link>
        </Alert>
      )}

      <Grid container spacing={2.5}>
        {/* ---------- target bridge ---------- */}
        <Grid item xs={12} md={5}>
          <Section title="Target bridge" subtitle="How the book converts into a commitment">
            <Box sx={{ mb: 2.5 }}>
              <Meter
                value={totals.totalHours}
                target={totals.target}
                label="Total book vs management target"
                sublabel={
                  totals.totalHours - totals.target >= 0
                    ? `${fmtHours(totals.totalHours - totals.target)} hrs of headroom above target`
                    : `${fmtHours(totals.target - totals.totalHours)} hrs short of target`
                }
              />
            </Box>
            <Table size="small">
              <TableBody>
                {[
                  ['Done — delivered', totals.byStatus.Done || 0, 'good'],
                  ['In Progress', totals.byStatus['In Progress'] || 0, null],
                  ['Not Start', totals.byStatus['Not Start'] || 0, 'warning'],
                ].map(([label, v, tone]) => (
                  <TableRow key={label}>
                    <TableCell sx={{ borderBottom: 'none', pl: 0, color: 'text.secondary' }}>{label}</TableCell>
                    <TableCell align="right" sx={{ borderBottom: 'none', pr: 0, fontWeight: 600, color: tone === 'good' ? STATUS.good : tone === 'warning' ? STATUS.warning : 'text.primary' }}>
                      {fmtHours(v)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell sx={{ pl: 0, fontWeight: 700, borderTop: 1, borderColor: 'divider' }}>
                    TOTAL — all {plan.projects.length} projects
                  </TableCell>
                  <TableCell align="right" sx={{ pr: 0, fontWeight: 700, borderTop: 1, borderColor: 'divider' }}>
                    {fmtHours(totals.totalHours)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ pl: 0, borderBottom: 'none', color: 'text.secondary' }}>Management target</TableCell>
                  <TableCell align="right" sx={{ pr: 0, borderBottom: 'none', color: 'text.secondary' }}>
                    {totals.target.toLocaleString()}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
              Sums the <em>Saving hrs/mth</em> column across every project, with no objective or risk filtering — it
              always reconciles to the source workbook.
            </Typography>

            {/* The gross-to-bankable bridge: what the team is targeted on vs
                what the six scorecards can actually add up to. */}
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>
              Gross vs bankable
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ pl: 0, borderBottom: 'none', color: 'text.secondary' }}>
                    Bankable across the six scorecards
                  </TableCell>
                  <TableCell align="right" sx={{ pr: 0, borderBottom: 'none', fontWeight: 700 }}>
                    {fmtHours(totals.bankableHours)}
                  </TableCell>
                </TableRow>
                {totals.partnerHours > 0 && (
                  <TableRow>
                    <TableCell sx={{ pl: 0, borderBottom: 'none', color: 'text.secondary' }}>
                      Built by partner / outsource devs
                    </TableCell>
                    <TableCell align="right" sx={{ pr: 0, borderBottom: 'none', color: STATUS.warning, fontWeight: 600 }}>
                      −{fmtHours(totals.partnerHours)}
                    </TableCell>
                  </TableRow>
                )}
                {totals.fallbackHours > 0 && (
                  <TableRow>
                    <TableCell sx={{ pl: 0, borderBottom: 'none', color: 'text.secondary' }}>
                      Of which absorbed by {people.find((x) => x.id === totals.fallbackPic)?.nick || 'the lead'}
                      <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
                        {totals.fallbackCount} project{totals.fallbackCount === 1 ? '' : 's'} owned by IT or unassigned
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ pr: 0, borderBottom: 'none', fontWeight: 600 }}>
                      {fmtHours(totals.fallbackHours)}
                    </TableCell>
                  </TableRow>
                )}
                {totals.orphanHours > 0 && (
                  <TableRow>
                    <TableCell sx={{ pl: 0, borderBottom: 'none', color: 'text.secondary' }}>
                      Credited to nobody
                    </TableCell>
                    <TableCell align="right" sx={{ pr: 0, borderBottom: 'none', color: STATUS.critical, fontWeight: 600 }}>
                      {fmtHours(totals.orphanHours)}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
              {settings.creditPartners
                ? 'Net view — partner devs dilute each person\'s share, so the team cannot personally bank the whole pool. Never add the individual targets together and compare them to the team target.'
                : 'Gross view — each owner is credited whole projects even where a partner dev builds them. Switch to the net view on the Model tab to see what they can personally bank.'}
              {totals.fallbackHours > 0 &&
                ` Projects owned by IT or left unassigned are credited to ${people.find((x) => x.id === totals.fallbackPic)?.nick || 'the team lead'}, who carries the team's overall KPI.`}
            </Typography>
          </Section>
        </Grid>

        {/* ---------- by person ---------- */}
        <Grid item xs={12} md={7}>
          <Section
            title="Credited saving hours by person"
            subtitle="After contribution shares — each project's hours are split once across its contributors, never double-banked"
            action={
              <ToggleButtonGroup
                size="small"
                exclusive
                value={byPersonView}
                onChange={(_e, v) => v && setByPersonView(v)}
              >
                <ToggleButton value="chart" sx={{ textTransform: 'none', px: 1.5 }}>Chart</ToggleButton>
                <ToggleButton value="mix" sx={{ textTransform: 'none', px: 1.5 }}>Mix</ToggleButton>
                <ToggleButton value="table" sx={{ textTransform: 'none', px: 1.5 }}>Table</ToggleButton>
              </ToggleButtonGroup>
            }
          >
            {byPersonView === 'chart' && (
              <HBar
                data={ranked.map((p) => ({
                  label: p.nick,
                  value: p.hours,
                  note: `${p.countedCount} projects · ${fmtRatio(p.ratio)} hrs/manday`,
                }))}
                unit=" hrs"
              />
            )}
            {byPersonView === 'mix' && (
              <StackedHBar
                rows={ranked.map((p) => ({ label: p.nick, values: p.byObjective }))}
                series={series}
              />
            )}
            {byPersonView === 'table' && (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Person</TableCell>
                    <TableCell align="right">Projects</TableCell>
                    <TableCell align="right">Credited hrs</TableCell>
                    <TableCell align="right">Mandays</TableCell>
                    <TableCell align="right">Ratio</TableCell>
                    <TableCell align="right">Missing data</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ranked.map((p) => (
                    <TableRow key={p.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{p.nick}</TableCell>
                      <TableCell align="right">{p.countedCount}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtHours(p.hours)}</TableCell>
                      <TableCell align="right">{fmtHours(p.manday)}</TableCell>
                      <TableCell align="right" sx={{ color: p.ratio != null && p.ratio < settings.ratioGate ? STATUS.critical : 'text.primary' }}>
                        {fmtRatio(p.ratio)}
                      </TableCell>
                      <TableCell align="right">{p.missingSaving || '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </Grid>

        {/* ---------- efficiency gate ---------- */}
        <Grid item xs={12} md={7}>
          <Section
            title="Objective 1 — the efficiency gate"
            subtitle={`Each dot is a project. Anything below the dashed line returns less than ${settings.ratioGate.toFixed(1)} saving hours per manday invested.`}
          >
            <GateScatter
              points={gatePoints}
              gate={settings.ratioGate}
              emptyMessage="No mandays have been entered yet, so there is nothing to plot. Add mandays on the Projects tab and every project appears here against the gate."
            />
          </Section>
        </Grid>

        {/* ---------- objective mix ---------- */}
        <Grid item xs={12} md={5}>
          <Section
            title="Where the hours come from"
            subtitle="Objectives 2, 4 and 5 all feed the one 3,000 hr pool. Objective 3 is date-gated to Nov 2026 and carries no hours."
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Objective</TableCell>
                  <TableCell align="right">Projects</TableCell>
                  <TableCell align="right">Hours</TableCell>
                  <TableCell align="right">Pool</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {OBJECTIVES.map((o, i) => {
                  const n = projects.filter((p) => p.objective === o.id).length
                  const h = byObjective[o.id] || 0
                  return (
                    <TableRow key={o.id} hover>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: CHART[mode].series[i], flexShrink: 0 }} />
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                              {o.no}. {o.short}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              Target: {o.target}
                            </Typography>
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell align="right">{n}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtHours(h)}</TableCell>
                      <TableCell align="right">
                        <Chip
                          size="small"
                          variant="outlined"
                          label={o.countsToPool ? 'Yes' : 'Gated'}
                          color={o.countsToPool ? 'default' : 'warning'}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Section>
        </Grid>

        {/* ---------- concentration ---------- */}
        <Grid item xs={12}>
          <Section
            title="Concentration risk"
            subtitle={`The five largest projects carry ${fmtPct(totals.topProjects.reduce((a, p) => a + (p.savingHours ?? 0), 0) / (totals.headlineHours || 1))} of the committed pool.`}
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Jira</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>PIC</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">Saving hrs</TableCell>
                  <TableCell align="right">Share of pool</TableCell>
                  <TableCell align="right">Coverage if it slips</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {totals.topProjects.map((p) => {
                  const person = people.find((x) => x.id === p.pic)
                  const without = (totals.headlineHours - (p.savingHours ?? 0)) / totals.target
                  return (
                    <TableRow key={p.key} hover>
                      <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.key}</TableCell>
                      <TableCell>{p.summary}</TableCell>
                      <TableCell>{person?.nick || <Typography variant="body2" sx={{ color: STATUS.critical, fontWeight: 600 }}>TBC</Typography>}</TableCell>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {p.srcStatus || p.status}
                        </Typography>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtHours(p.savingHours)}</TableCell>
                      <TableCell align="right">{fmtPct((p.savingHours ?? 0) / (totals.headlineHours || 1))}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600, color: without < 1 ? STATUS.critical : STATUS.good }}>
                        {fmtPct(without)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Section>
        </Grid>
      </Grid>
    </Box>
  )
}
