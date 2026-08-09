import { useState } from 'react'
import {
  Box, Grid, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Alert, AlertTitle, ToggleButton, ToggleButtonGroup, Link, Divider, Tooltip,
} from '@mui/material'
import StatTile from '../components/StatTile.jsx'
import { HBar, StackedHBar, GateScatter, Meter } from '../components/Charts.jsx'
import { OBJECTIVES, CHART, STATUS } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtRatio, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths,
  gateAsHoursPerManday, gateAsPaybackMonths, servesObjective as serves,
} from '../lib/model.js'
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
  // mixByObjective, not byObjective: this chart asks where the work SITS,
  // which is the project's own objective. byObjective is the KPI map, and
  // every saving hour sits on the hours objective there.
  const { totals, people, projects, quality, mixByObjective: byObjective, settings, finance: fin } = plan

  /*
   * What each objective is aiming at, and where it stands — each in its own
   * unit. The hours column beside these says where the WORK sits; these two
   * say whether the objective is being met, which is a different question for
   * every one of them.
   */
  const objTarget = (o) => {
    if (o.measure === 'ratio') return fmtRoi(fin.roiGate)
    if (o.measure === 'hours') return fmtHours(settings.teamTarget ?? totals.guidelineTarget ?? 3000)
    // The goal for the year, not a readout of where we are.
    if (o.measure === 'count') return String(fin.objectiveTargets?.[o.id] ?? plan.countByObjective?.[o.id] ?? 0)
    return o.target
  }
  const objActual = (o) => {
    if (o.measure === 'ratio') return fin.roi == null ? '—' : fmtRoi(fin.roi)
    if (o.measure === 'hours') return fmtHours(totals.headlineHours)
    if (o.measure === 'count') return String(plan.countByObjective?.[o.id] ?? 0)
    return o.target
  }
  const objTone = (o) => {
    if (o.measure === 'ratio') return fin.roi == null ? 'text.disabled' : fin.roi >= fin.roiGate ? STATUS.good : STATUS.critical
    if (o.measure === 'hours') {
      const target = settings.teamTarget ?? totals.guidelineTarget ?? 3000
      return totals.headlineHours >= target ? STATUS.good : STATUS.warning
    }
    if (o.measure === 'count') {
      const target = fin.objectiveTargets?.[o.id]
      if (!target) return 'text.primary'
      return (plan.countByObjective?.[o.id] ?? 0) >= target ? STATUS.good : STATUS.warning
    }
    return 'text.primary'
  }
  const sym = fin.symbol
  const [byPersonView, setByPersonView] = useState('chart')

  // Personal contribution, so the bars add up to the team figure. The lead's
  // scorecard shows the team aggregate, which would swamp this chart and
  // double-count everyone else.
  const ranked = [...people].sort((a, b) => b.ownHours - a.ownHours)

  // x = the whole investment (build + CAPEX), y = what it returns over the
  // horizon NET of the monthly OPEX. The gate line is y = (1 + roiGate) * x, so
  // anything under it fails Objective 1 — and because both axes are exactly the
  // two sides of p.roi, a dot can never sit above the line while its own gate
  // chip reads "below".
  const gatePoints = projects
    .filter((p) => (p.commitLevel === 'commit' || p.commitLevel === 'stretch') && p.investment != null && p.netHorizonBenefit != null)
    .map((p) => ({
      key: p.key,
      summary: p.summary,
      x: p.investment,
      y: p.netHorizonBenefit,
      note: `${fmtMoney(p.investment, sym)} invested · ${fmtMoney(p.netHorizonBenefit, sym)} back over ${fin.horizonMonths} months after OPEX · ROI ${fmtRoi(p.roi)}`,
    }))

  const series = OBJECTIVES.map((o, i) => ({
    id: o.id,
    label: `${o.no}. ${o.short}`,
    color: CHART[mode].series[i],
  }))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* ---------- headline row ---------- */}
      {/* Five tiles, so a flex strip rather than a 12-column grid: thirds at
          tablet width, fifths once there is room for all of them. */}
      <Grid container spacing={2} sx={{ '& > .MuiGrid-item': { flexBasis: { lg: '20%' }, maxWidth: { lg: '20%' } } }}>
        <Grid item xs={12} sm={6} md={4}>
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
        <Grid item xs={12} sm={6} md={4}>
          <StatTile
            label="Value of hours released"
            value={fmtMoneyShort(fin.annualBenefit, sym)}
            unit="per year"
            context={`${fin.fteReleased.toFixed(1)} FTE at ${fmtMoney(fin.acctHourRate, sym)} an hour · ${fmtMoneyShort(fin.monthlyBenefit, sym)}/month`}
            help={`Objective 1. The saving hours valued at the accountant rate set on the Model tab: ${fmtHours(totals.totalHours)} hrs/month ÷ the FTE ratio of ${fin.hoursPerFteMonth} hrs = ${fin.fteReleased.toFixed(1)} FTE. This is capacity released, not cash taken off the payroll.`}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatTile
            label="Return on investment"
            value={fmtRoi(fin.roi)}
            unit={`over ${fin.horizonMonths} months`}
            tone={fin.roi == null ? undefined : fin.roi >= fin.roiGate ? 'good' : 'critical'}
            context={
              fin.roi == null
                ? `No cost estimated yet on ${quality.uncosted} of ${quality.total} projects`
                : `${fmtMoneyShort(fin.investment, sym)} invested${fin.opexRunRate > 0 ? ` + ${fmtMoneyShort(fin.opexRunRate, sym)}/mo` : ''} · gate ${fmtRoi(fin.roiGate)} · covers ${fmtPct(fin.roiCoverage)} of the benefit`
            }
            help={`Objective 1's gate. The benefit over ${fin.horizonMonths} months, NET of ${fmtMoney(fin.opexRunRate, sym)} a month of operating cost, against the whole investment: ${fmtMoney(fin.buildCost ?? 0, sym)} of build at ${fmtMoney(fin.devDayRate, sym)} a manday plus ${fmtMoney(fin.capex ?? 0, sym)} of CAPEX. No depreciation is applied — CAPEX is charged whole. Only projects carrying a cost are in EITHER side of this, so it is never a whole-book benefit divided by a partial cost. The gate of ${fmtRoi(fin.roiGate)} is a payback of ${fmtMonths(gateAsPaybackMonths(fin))}, equivalent to ${gateAsHoursPerManday(fin)?.toFixed(2)} saving hours per manday on a project with no CAPEX or OPEX.`}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatTile
            label="Concentration"
            value={fmtPct(totals.top2Share)}
            unit="in top 2"
            tone={totals.top2Share > 0.4 ? 'critical' : totals.top2Share > 0.25 ? 'warning' : 'good'}
            context={totals.topProjects[0] ? `Largest: ${totals.topProjects[0].key} at ${fmtHours(totals.topProjects[0].savingHours)} hrs` : '—'}
            help="Share of the committed pool sitting in the two largest projects. Above 40% the whole target depends on two deliveries landing."
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
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

      {quality.uncosted > 0 && (
        <Alert severity={fin.roiCoverage >= 0.9 ? 'info' : 'warning'} variant="outlined">
          <AlertTitle sx={{ fontWeight: 600 }}>
            {fin.roi == null
              ? 'Objective 1 has a benefit but no cost yet'
              : `Objective 1 covers ${fmtPct(fin.roiCoverage)} of the benefit`}
          </AlertTitle>
          The source workbook records saving hours and an FTE column but no build effort, so{' '}
          {quality.uncosted} of {quality.total} projects still carry neither mandays nor a CAPEX. The benefit side is
          live — <strong>{fmtMoneyShort(fin.annualBenefit, sym)} a year</strong> — but ROI, payback and net benefit
          stay blank on those, because a project with unknown effort has an unknown cost, not a cost of nothing. They
          are left out of both sides of the return rather than counted as free. Each one still shows the mandays it
          could absorb and still clear the gate, and clicking its row opens its CAPEX and monthly-cost sheet.{' '}
          <Link component="button" onClick={() => onGoTo('projects')} sx={{ fontWeight: 600 }}>
            Estimate effort →
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
                {totals.nextYearHours > 0 && (
                  <TableRow>
                    <TableCell sx={{ pl: 0, borderBottom: 'none', color: 'text.secondary' }}>
                      Deferred to next year
                      <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>
                        {totals.nextYearCount} project{totals.nextYearCount === 1 ? '' : 's'} · not in the total above
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ pr: 0, borderBottom: 'none', color: 'text.disabled', fontWeight: 600 }}>
                      ({fmtHours(totals.nextYearHours)})
                    </TableCell>
                  </TableRow>
                )}
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
            subtitle="Personal contribution after shares — each project's hours are split once, never double-banked. The lead's scorecard shows the team aggregate; this chart shows their own projects so the bars still add up."
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
                  value: p.ownHours,
                  note: `${p.ownCount} projects · ${fmtRatio(p.ratio)} hrs/manday`,
                }))}
                unit=" hrs"
              />
            )}
            {byPersonView === 'mix' && (
              <StackedHBar
                // ownByObjective, not byObjective: the lead's scorecard map is
                // the whole team's, so stacking it beside the others counted
                // every hour twice and the bars summed to 6,671 against 4,227.
                rows={ranked.map((p) => ({ label: p.nick, values: p.ownByObjective }))}
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
                    <TableCell align="right">Benefit / yr</TableCell>
                    <TableCell align="right">Mandays</TableCell>
                    <TableCell align="right">Investment</TableCell>
                    <TableCell align="right">ROI</TableCell>
                    <TableCell align="right">Missing data</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {ranked.map((p) => (
                    <TableRow key={p.id} hover>
                      <TableCell sx={{ fontWeight: 600 }}>{p.nick}</TableCell>
                      <TableCell align="right">{p.ownCount}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtHours(p.ownHours)}</TableCell>
                      <TableCell align="right">{fmtMoneyShort(p.monthlyBenefit * 12, sym)}</TableCell>
                      <TableCell align="right">{fmtHours(p.manday)}</TableCell>
                      <TableCell align="right">
                        <Tooltip title={`Build ${fmtMoneyShort(p.buildCost, sym)} + CAPEX ${fmtMoneyShort(p.capex, sym)}${p.opexRunRate > 0 ? `, and ${fmtMoneyShort(p.opexRunRate, sym)} a month of OPEX` : ''} — all at ${p.nick}'s share of each project.`}>
                          <span>{fmtMoneyShort(p.investment, sym)}</span>
                        </Tooltip>
                      </TableCell>
                      {/* Personal, like every other cell in this row — p.finance
                          is the SCORECARD view, which for the lead is the whole
                          team and would not belong beside their own hours. Net
                          of OPEX and over the whole investment, exactly like the
                          portfolio figure above. */}
                      {(() => {
                        const roi = p.investment > 0 ? (p.costedNetBenefit - p.investment) / p.investment : null
                        return (
                          <TableCell align="right" sx={{ color: roi != null && roi < fin.roiGate ? STATUS.critical : 'text.primary' }}>
                            {fmtRoi(roi)}
                          </TableCell>
                        )
                      })()}
                      <TableCell align="right">{p.missingSaving || '—'}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider' }}>
                      Team total
                    </TableCell>
                    <TableCell align="right" sx={{ borderTop: 2, borderColor: 'divider' }} />
                    <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider' }}>
                      {fmtHours(totals.teamHours)}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider' }}>
                      {fmtMoneyShort(ranked.reduce((a, x) => a + x.monthlyBenefit * 12, 0), sym)}
                    </TableCell>
                    <TableCell colSpan={3} sx={{ borderTop: 2, borderColor: 'divider' }} />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </Section>
        </Grid>

        {/* ---------- objective 1: is it worth it ---------- */}
        <Grid item xs={12}>
          <Section
            title="Objective 1 — is the build worth it"
            subtitle={`Each dot is a project: everything invested in it — mandays plus CAPEX — against what it gives back over ${fin.horizonMonths} months after its monthly operating cost, both in ${fin.currency}. The dashed line is the gate — a return of ${fmtRoi(fin.roiGate)}, or a payback of ${fmtMonths(gateAsPaybackMonths(fin))}. Anything below it costs more than it is worth.`}
          >
            <GateScatter
              points={gatePoints}
              gate={1 + fin.roiGate}
              xLabel={`Investment — build + CAPEX (${fin.currency})`}
              yLabel={`Net benefit over ${fin.horizonMonths} months, after OPEX (${fin.currency})`}
              fmt={(v) => fmtMoneyShort(v, sym)}
              emptyMessage={`No cost has been entered yet, so there is nothing to plot. The benefit side is already known — ${fmtMoneyShort(fin.annualBenefit, sym)} a year — but a return needs a cost. Use "Estimate effort" on the Projects tab, type mandays in, or click a project row to add its CAPEX, and every project appears here against the gate.`}
            />
          </Section>
        </Grid>

        {/* ---------- the management guideline, verbatim ---------- */}
        <Grid item xs={12}>
          <Section
            title="2026 management KPI guideline"
            subtitle="The objectives as issued, with what the team is currently carrying against each. Objectives 2, 4 and 5 all feed the one hour pool; objective 3 is date-gated and carries no hours."
          >
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 880 }}>
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ minWidth: 190 }}>Objective</TableCell>
                    <TableCell sx={{ minWidth: 280 }}>Objective detail</TableCell>
                    <TableCell sx={{ minWidth: 260 }}>F&amp;A Tech</TableCell>
                    <TableCell align="right">Projects</TableCell>
                    <TableCell align="right">Hours</TableCell>
                    <TableCell align="right" sx={{ minWidth: 120 }}>Target</TableCell>
                    <TableCell align="right" sx={{ minWidth: 120 }}>Where we are</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {OBJECTIVES.map((o, i) => {
                    // Every project that SERVES the objective, not only the
                    // ones whose primary tag it is — a dashboard that removes
                    // manual work belongs to both.
                    const n = projects.filter((p) => serves(p, o.id)).length
                    const h = byObjective[o.id] || 0
                    return (
                      <TableRow key={o.id} hover>
                        <TableCell sx={{ verticalAlign: 'top' }}>
                          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                            <Box sx={{ width: 10, height: 10, borderRadius: '2px', mt: 0.6, bgcolor: CHART[mode].series[i], flexShrink: 0 }} />
                            <Box>
                              {o.guidelineName ? (
                                <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35 }}>
                                  {o.guidelineName}
                                </Typography>
                              ) : (
                                <Typography variant="body2" sx={{ color: 'text.disabled', fontStyle: 'italic', lineHeight: 1.35 }}>
                                  (continues {OBJECTIVES[i - 1]?.guidelineName})
                                </Typography>
                              )}
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                Objective {o.no} in this app
                              </Typography>
                            </Box>
                          </Box>
                        </TableCell>
                        <TableCell sx={{ verticalAlign: 'top' }}>
                          <Typography variant="body2" sx={{ lineHeight: 1.4 }}>
                            {o.guidelineDetail}
                          </Typography>
                        </TableCell>
                        <TableCell sx={{ verticalAlign: 'top' }}>
                          <Typography variant="body2" sx={{ lineHeight: 1.5, fontWeight: 500 }}>
                            {o.guidelineTarget}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ verticalAlign: 'top' }}>{n}</TableCell>
                        <TableCell align="right" sx={{ verticalAlign: 'top', fontWeight: 600 }}>{fmtHours(h)}</TableCell>
                        {/* The target in the unit the objective is actually
                            measured in, and the live reading beside it. The
                            Hours column above says where the work sits; these
                            two say whether the objective is being met. */}
                        <TableCell align="right" sx={{ verticalAlign: 'top' }}>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {objTarget(o)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {o.measure === 'ratio' ? 'or better'
                              : o.measure === 'count' ? o.countUnit
                                : o.measure === 'hours' ? 'hrs/month' : 'milestone'}
                          </Typography>
                        </TableCell>
                        <TableCell align="right" sx={{ verticalAlign: 'top' }}>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: objTone(o) }}>
                            {objActual(o)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {o.measure === 'ratio' ? `on ${fmtMoneyShort(fin.annualBenefit, fin.symbol)}/yr`
                              : o.measure === 'count' ? 'delivered'
                                : o.measure === 'hours' ? 'committed' : 'as planned'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
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
                  // The target is user-editable and can be cleared to 0.
                  const without = totals.target > 0
                    ? (totals.headlineHours - (p.savingHours ?? 0)) / totals.target
                    : null
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
