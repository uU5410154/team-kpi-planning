import { useState } from 'react'
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Divider, Tooltip,
} from '@mui/material'
import FolderIcon from '@mui/icons-material/FolderOutlined'
import StatTile from '../components/StatTile.jsx'
import {
  WelcomeBanner, IconTile, PAGE_COLOR, personColor,
} from '../components/Brand.jsx'
import { HBar, StackedHBar, GateScatter, Meter } from '../components/Charts.jsx'
import { OBJECTIVES, CHART, STATUS } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtRatio, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths,
  gateAsHoursPerManday, gateAsPaybackMonths, servesObjective as serves,
} from '../lib/model.js'
import CardFrame from './CardFrame.jsx'

/*
 * THE CARDS THAT DESCRIBE THE YEAR: the welcome, the headline figures, the
 * target bridge, the money and the guideline. These were the Dashboard before
 * the manager cards were added; each is now a card that can be moved, resized
 * or taken off, and says exactly what it said before.
 */

// Personal contribution, so the bars add up to the team figure.
const rankedOf = (plan) => [...plan.people].sort((a, b) => b.ownHours - a.ownHours)
const Cell = ({ children }) => <Box sx={{ minWidth: 0 }}>{children}</Box>
const TILE = [PAGE_COLOR.projects, PAGE_COLOR.dashboard, PAGE_COLOR.people, PAGE_COLOR.apps, PAGE_COLOR.timeline]

function ListRows({ rows, onOpen }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {rows.map((r) => (
        <Box
          key={r.key}
          onClick={r.open ? () => onOpen?.(r.open) : undefined}
          role={r.open ? 'link' : undefined}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.25, p: 1, borderRadius: '12px',
            border: 1, borderColor: 'divider', bgcolor: 'action.hover', cursor: r.open ? 'pointer' : 'default',
            '&:hover': r.open ? { borderColor: 'text.disabled' } : undefined,
          }}
        >
          {r.tile}
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 650 }}>{r.title}</Typography>
            <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>{r.sub}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

export function WelcomeCard({ ctx, f }) {
  const { plan, hello, onGoTo } = ctx
  const { totals, quality } = plan
  return (
    <CardFrame {...f} bare title="Welcome">
      <WelcomeBanner
        eyebrow="Welcome to F&A Tech KPI Planning"
        title={`Hello ${hello}`}
        subtitle={`${fmtHours(totals.totalHours)} saving hours a month in the plan — ${fmtPct(totals.totalCoverage)} of the `
          + `${totals.target.toLocaleString()} target. ${quality.pastDue} project${quality.pastDue === 1 ? ' is' : 's are'} past due and not done.`}
        next={{
          label: 'Weekly check-in',
          sub: 'See who has sent their plan and report this week',
          onClick: () => onGoTo?.('weekly'),
        }}
      />
    </CardFrame>
  )
}

export function BiggestCard({ ctx, f }) {
  const { totals } = ctx.plan
  return (
    <CardFrame {...f} title="Biggest projects" sub={`${totals.topProjects.length} carrying the most hours`}>
      <ListRows
        onOpen={ctx.onOpenProject}
        rows={totals.topProjects.map((p, i) => ({
          key: p.key,
          open: p.key,
          tile: <IconTile icon={FolderIcon} color={TILE[i % TILE.length]} size={34} />,
          title: p.summary || p.key,
          sub: `${p.jiraKey || p.key} · ${fmtHours(p.savingHours)} hrs/mth`,
        }))}
      />
    </CardFrame>
  )
}

export function TeamCard({ ctx, f }) {
  const { plan } = ctx
  const ranked = rankedOf(plan)
  return (
    <CardFrame {...f} title="The team" sub={`${ranked.length} people, by hours credited`}>
      <ListRows
        rows={ranked.map((p) => ({
          key: p.id,
          tile: <IconTile text={(p.nick || p.name || '?').slice(0, 2)} color={personColor(plan.people, p.id)} size={34} />,
          title: p.name || p.nick,
          sub: `${fmtHours(p.ownHours)} hrs/mth · ${p.ownCount ?? 0} project${p.ownCount === 1 ? '' : 's'}`,
        }))}
      />
    </CardFrame>
  )
}

export function HeadlineCard({ ctx, f }) {
  const {
    totals, quality, settings, finance: fin,
  } = ctx.plan
  const sym = fin.symbol
  // Sized to the card, not the screen: five across when it is wide enough,
  // fewer and taller when it is not.
  return (
    <CardFrame {...f} bare title="Headline figures">
      <Box sx={{
        height: '100%', display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gridAutoRows: '1fr',
      }}
      >
        <Cell>
          <StatTile
            hero
            label="Total saving hours"
            value={fmtHours(totals.totalHours)}
            unit={settings.savingBasis === 'monthly' ? 'hrs / month' : 'hrs / year'}
            tone={totals.totalCoverage >= 1 ? 'good' : totals.totalCoverage >= 0.9 ? 'warning' : 'critical'}
            context={`${fmtPct(totals.totalCoverage)} of the ${totals.target.toLocaleString()} hr target · ${fmtHours(totals.doneHours)} already delivered`}
            help="Every project in the register, summed straight from the Saving hrs/mth column. No filtering — this always reconciles to the source workbook."
          />
        </Cell>
        <Cell>
          <StatTile
            label="Value of hours released"
            value={fmtMoneyShort(fin.annualBenefit, sym)}
            unit="per year"
            context={`${fin.fteReleased.toFixed(1)} FTE at ${fmtMoney(fin.acctHourRate, sym)} an hour · ${fmtMoneyShort(fin.monthlyBenefit, sym)}/month`}
            help={`Objective 1. The saving hours valued at the accountant rate set on the Model tab: ${fmtHours(totals.totalHours)} hrs/month ÷ the FTE ratio of ${fin.hoursPerFteMonth} hrs = ${fin.fteReleased.toFixed(1)} FTE. This is capacity released, not cash taken off the payroll.`}
          />
        </Cell>
        <Cell>
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
            help={`Objective 1's gate. The benefit over ${fin.horizonMonths} months, NET of ${fmtMoney(fin.opexRunRate, sym)} a month of operating cost, against the whole investment: ${fmtMoney(fin.buildCost ?? 0, sym)} of build at ${fmtMoney(fin.devDayRate, sym)} a manday plus ${fmtMoney(fin.capex ?? 0, sym)} of CAPEX. Only projects carrying a cost are in EITHER side of this. The gate of ${fmtRoi(fin.roiGate)} is a payback of ${fmtMonths(gateAsPaybackMonths(fin))}, equivalent to ${gateAsHoursPerManday(fin)?.toFixed(2)} saving hours per manday on a project with no CAPEX or OPEX.`}
          />
        </Cell>
        <Cell>
          <StatTile
            label="Concentration"
            value={fmtPct(totals.top2Share)}
            unit="in top 2"
            tone={totals.top2Share > 0.4 ? 'critical' : totals.top2Share > 0.25 ? 'warning' : 'good'}
            context={totals.topProjects[0] ? `Largest: ${totals.topProjects[0].key} at ${fmtHours(totals.topProjects[0].savingHours)} hrs` : '—'}
            help="Share of the committed pool sitting in the two largest projects. Above 40% the whole target depends on two deliveries landing."
          />
        </Cell>
        <Cell>
          <StatTile
            label="Past due, not done"
            value={quality.pastDue}
            unit={`of ${quality.total}`}
            tone={quality.pastDue > 20 ? 'critical' : quality.pastDue > 5 ? 'warning' : 'good'}
            context={`Carrying ${fmtHours(quality.pastDueHours)} committed hrs · ${quality.missingSaving} epics still unquantified`}
            help={`Epics whose Jira due date is before ${settings.asOfDate} and whose status is not Done.`}
          />
        </Cell>
      </Box>
    </CardFrame>
  )
}

export function BridgeCard({ ctx, f }) {
  const { plan } = ctx
  const { totals, people, settings } = plan
  const lead = people.find((x) => x.id === totals.fallbackPic)?.nick || 'the lead'
  const row = (label, value, colour, note) => (
    <TableRow key={label}>
      <TableCell sx={{ pl: 0, borderBottom: 'none', color: 'text.secondary' }}>
        {label}
        {note && <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block' }}>{note}</Typography>}
      </TableCell>
      <TableCell align="right" sx={{ pr: 0, borderBottom: 'none', fontWeight: 600, color: colour || 'text.primary' }}>{value}</TableCell>
    </TableRow>
  )
  return (
    <CardFrame {...f} title="Target bridge" sub="How the book converts into a commitment">
      <Box sx={{ mb: 2.5 }}>
        <Meter
          value={totals.totalHours}
          target={totals.target}
          label="Total book vs management target"
          sublabel={totals.totalHours - totals.target >= 0
            ? `${fmtHours(totals.totalHours - totals.target)} hrs of headroom above target`
            : `${fmtHours(totals.target - totals.totalHours)} hrs short of target`}
        />
      </Box>
      <Table size="small">
        <TableBody>
          {row('Done — delivered', fmtHours(totals.byStatus.Done || 0), STATUS.good)}
          {row('In Progress', fmtHours(totals.byStatus['In Progress'] || 0))}
          {row('Not Start', fmtHours(totals.byStatus['Not Start'] || 0), STATUS.warning)}
          <TableRow>
            <TableCell sx={{ pl: 0, fontWeight: 700, borderTop: 1, borderColor: 'divider' }}>TOTAL — all {plan.projects.length} projects</TableCell>
            <TableCell align="right" sx={{ pr: 0, fontWeight: 700, borderTop: 1, borderColor: 'divider' }}>{fmtHours(totals.totalHours)}</TableCell>
          </TableRow>
          {row('Management target', totals.target.toLocaleString(), 'text.secondary')}
          {totals.nextYearHours > 0 && row('Deferred to next year', `(${fmtHours(totals.nextYearHours)})`, 'text.disabled',
            `${totals.nextYearCount} project${totals.nextYearCount === 1 ? '' : 's'} · not in the total above`)}
        </TableBody>
      </Table>
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 1 }}>Gross vs bankable</Typography>
      <Table size="small">
        <TableBody>
          {row('Bankable across the six scorecards', fmtHours(totals.bankableHours))}
          {totals.outsideHours > 0 && row('Owned by IT or the business', `−${fmtHours(totals.outsideHours)}`, STATUS.warning,
            `${totals.outsideCount} project${totals.outsideCount === 1 ? '' : 's'} · on the register, off our book`)}
          {totals.partnerHours > 0 && row('Built by partner / outsource devs', `−${fmtHours(totals.partnerHours)}`, STATUS.warning)}
          {totals.fallbackHours > 0 && row(`Of which absorbed by ${lead}`, fmtHours(totals.fallbackHours), null,
            `${totals.fallbackCount} unassigned project${totals.fallbackCount === 1 ? '' : 's'}`)}
          {totals.orphanHours > 0 && row('Credited to nobody', fmtHours(totals.orphanHours), STATUS.critical)}
        </TableBody>
      </Table>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5 }}>
        {settings.creditPartners
          ? 'Net view — partner devs dilute each person\'s share, so the team cannot personally bank the whole pool.'
          : 'Gross view — each owner is credited whole projects even where a partner dev builds them.'}
      </Typography>
    </CardFrame>
  )
}

export function ByPersonCard({ ctx, f }) {
  const { plan, mode } = ctx
  const { totals, finance: fin } = plan
  const sym = fin.symbol
  const [view, setView] = useState('chart')
  const ranked = rankedOf(plan)
  const series = OBJECTIVES.map((o, i) => ({ id: o.id, label: `${o.no}. ${o.short}`, color: CHART[mode].series[i] }))
  return (
    <CardFrame
      {...f}
      title="Credited saving hours by person"
      sub="Personal contribution after shares — each project's hours are split once, never double-banked."
      action={(
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && setView(v)}>
          <ToggleButton value="chart" sx={{ textTransform: 'none', px: 1.5 }}>Chart</ToggleButton>
          <ToggleButton value="mix" sx={{ textTransform: 'none', px: 1.5 }}>Mix</ToggleButton>
          <ToggleButton value="table" sx={{ textTransform: 'none', px: 1.5 }}>Table</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      {view === 'chart' && (
        <HBar
          data={ranked.map((p) => ({ label: p.nick, value: p.ownHours, note: `${p.ownCount} projects · ${fmtRatio(p.ratio)} hrs/manday` }))}
          unit=" hrs"
        />
      )}
      {view === 'mix' && <StackedHBar rows={ranked.map((p) => ({ label: p.nick, values: p.ownByObjective }))} series={series} />}
      {view === 'table' && (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 640 }}>
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
              {ranked.map((p) => {
                const roi = p.investment > 0 ? (p.costedNetBenefit - p.investment) / p.investment : null
                return (
                  <TableRow key={p.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{p.nick}</TableCell>
                    <TableCell align="right">{p.ownCount}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtHours(p.ownHours)}</TableCell>
                    <TableCell align="right">{fmtMoneyShort(p.monthlyBenefit * 12, sym)}</TableCell>
                    <TableCell align="right">{fmtHours(p.manday)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={`Build ${fmtMoneyShort(p.buildCost, sym)} + CAPEX ${fmtMoneyShort(p.capex, sym)} — at ${p.nick}'s share of each project.`}>
                        <span>{fmtMoneyShort(p.investment, sym)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right" sx={{ color: roi != null && roi < fin.roiGate ? STATUS.critical : 'text.primary' }}>{fmtRoi(roi)}</TableCell>
                    <TableCell align="right">{p.missingSaving || '—'}</TableCell>
                  </TableRow>
                )
              })}
              <TableRow>
                <TableCell sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider' }}>Team total</TableCell>
                <TableCell sx={{ borderTop: 2, borderColor: 'divider' }} />
                <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider' }}>{fmtHours(totals.teamHours)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider' }}>
                  {fmtMoneyShort(ranked.reduce((a, x) => a + x.monthlyBenefit * 12, 0), sym)}
                </TableCell>
                <TableCell colSpan={4} sx={{ borderTop: 2, borderColor: 'divider' }} />
              </TableRow>
            </TableBody>
          </Table>
        </Box>
      )}
    </CardFrame>
  )
}

export function GateCard({ ctx, f }) {
  const fin = ctx.plan.finance
  const sym = fin.symbol
  const points = ctx.plan.projects
    .filter((p) => (p.commitLevel === 'commit' || p.commitLevel === 'stretch') && p.investment != null && p.netHorizonBenefit != null)
    .map((p) => ({
      key: p.key,
      summary: p.summary,
      x: p.investment,
      y: p.netHorizonBenefit,
      note: `${fmtMoney(p.investment, sym)} invested · ${fmtMoney(p.netHorizonBenefit, sym)} back over ${fin.horizonMonths} months after OPEX · ROI ${fmtRoi(p.roi)}`,
    }))
  return (
    <CardFrame
      {...f}
      title="Objective 1 — is the build worth it"
      sub={`Each dot is a project: everything invested against what it gives back over ${fin.horizonMonths} months after operating cost. The dashed line is the gate — ${fmtRoi(fin.roiGate)}.`}
    >
      <GateScatter
        points={points}
        gate={1 + fin.roiGate}
        xLabel={`Investment — build + CAPEX (${fin.currency})`}
        yLabel={`Net benefit over ${fin.horizonMonths} months, after OPEX (${fin.currency})`}
        fmt={(v) => fmtMoneyShort(v, sym)}
        emptyMessage={`No cost has been entered yet, so there is nothing to plot. The benefit side is already known — ${fmtMoneyShort(fin.annualBenefit, sym)} a year — but a return needs a cost.`}
      />
    </CardFrame>
  )
}

export function GuidelineCard({ ctx, f }) {
  const { plan, mode } = ctx
  const {
    totals, projects, settings, finance: fin, mixByObjective: byObjective,
  } = plan
  const objTarget = (o) => {
    if (o.measure === 'ratio') return fmtRoi(fin.roiGate)
    if (o.measure === 'hours') return fmtHours(settings.teamTarget ?? totals.guidelineTarget ?? 3000)
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
    if (o.measure === 'hours') return totals.headlineHours >= (settings.teamTarget ?? totals.guidelineTarget ?? 3000) ? STATUS.good : STATUS.warning
    if (o.measure === 'count') {
      const target = fin.objectiveTargets?.[o.id]
      if (!target) return 'text.primary'
      return (plan.countByObjective?.[o.id] ?? 0) >= target ? STATUS.good : STATUS.warning
    }
    return 'text.primary'
  }
  return (
    <CardFrame
      {...f}
      title="2026 management KPI guideline"
      sub="The objectives as issued, with what the team is carrying against each."
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
              const n = projects.filter((p) => serves(p, o.id)).length
              return (
                <TableRow key={o.id} hover>
                  <TableCell sx={{ verticalAlign: 'top' }}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <Box sx={{
                        width: 10, height: 10, borderRadius: '2px', mt: 0.6, bgcolor: CHART[mode].series[i], flexShrink: 0,
                      }}
                      />
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35, color: o.guidelineName ? 'text.primary' : 'text.disabled' }}>
                          {o.guidelineName || `(continues ${OBJECTIVES[i - 1]?.guidelineName})`}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Objective {o.no} in this app</Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}><Typography variant="body2" sx={{ lineHeight: 1.4 }}>{o.guidelineDetail}</Typography></TableCell>
                  <TableCell sx={{ verticalAlign: 'top' }}><Typography variant="body2" sx={{ lineHeight: 1.5, fontWeight: 500 }}>{o.guidelineTarget}</Typography></TableCell>
                  <TableCell align="right" sx={{ verticalAlign: 'top' }}>{n}</TableCell>
                  <TableCell align="right" sx={{ verticalAlign: 'top', fontWeight: 600 }}>{fmtHours(byObjective[o.id] || 0)}</TableCell>
                  <TableCell align="right" sx={{ verticalAlign: 'top' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{objTarget(o)}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {o.measure === 'ratio' ? 'or better' : o.measure === 'count' ? o.countUnit : o.measure === 'hours' ? 'hrs/month' : 'milestone'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ verticalAlign: 'top' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: objTone(o) }}>{objActual(o)}</Typography>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {o.measure === 'ratio' ? `on ${fmtMoneyShort(fin.annualBenefit, fin.symbol)}/yr` : o.measure === 'count' ? 'delivered' : o.measure === 'hours' ? 'committed' : 'as planned'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </CardFrame>
  )
}

export function ConcentrationCard({ ctx, f }) {
  const { totals, people } = ctx.plan
  return (
    <CardFrame
      {...f}
      title="Concentration risk"
      sub={`The five largest projects carry ${fmtPct(totals.topProjects.reduce((a, p) => a + (p.savingHours ?? 0), 0) / (totals.headlineHours || 1))} of the committed pool.`}
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 560 }}>
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
              const without = totals.target > 0 ? (totals.headlineHours - (p.savingHours ?? 0)) / totals.target : null
              return (
                <TableRow key={p.key} hover sx={{ cursor: 'pointer' }} onClick={() => ctx.onOpenProject?.(p.key)}>
                  <TableCell sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{p.key}</TableCell>
                  <TableCell>{p.summary}</TableCell>
                  <TableCell>{person?.nick || <Typography variant="body2" sx={{ color: STATUS.critical, fontWeight: 600 }}>TBC</Typography>}</TableCell>
                  <TableCell><Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.srcStatus || p.status}</Typography></TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtHours(p.savingHours)}</TableCell>
                  <TableCell align="right">{fmtPct((p.savingHours ?? 0) / (totals.headlineHours || 1))}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: without < 1 ? STATUS.critical : STATUS.good }}>{fmtPct(without)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </CardFrame>
  )
}
