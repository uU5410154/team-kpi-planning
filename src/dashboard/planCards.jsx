import { useLayoutEffect, useRef, useState } from 'react'
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Tooltip, Button, ButtonBase, Skeleton,
} from '@mui/material'
import ScatterPlotIcon from '@mui/icons-material/ScatterPlotOutlined'
import { statusTone } from '../components/Brand.jsx'
import {
  StatusPill, FigureStrip, EmptyState,
} from '../components/ui.jsx'
import { HBar, StackedHBar, GateScatter, Meter } from '../components/Charts.jsx'
import { OBJECTIVES, CHART } from '../lib/palette.js'
import {
  fmtHours, fmtPct, fmtRatio, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths,
  gateAsHoursPerManday, gateAsPaybackMonths, servesObjective as serves,
} from '../lib/model.js'
import CardFrame from './CardFrame.jsx'

/*
 * THE CARDS THAT DESCRIBE THE YEAR: the summary, the headline figures, the
 * target bridge, the money and the guideline. Each is a card on the
 * dashboard that can be moved, resized or taken off.
 *
 * Drawn to the "Ledger" system (docs/DESIGN.md): rows split by hairlines
 * rather than boxes inside boxes, figures in the text colour with their
 * status beside them, numbers right-aligned and tabular.
 *
 * A few small pieces used by the week cards as well live here: the neutral
 * avatar, the row skeleton and the sideways scroller for wide tables.
 */

// Personal contribution, so the bars add up to the team figure.
const rankedOf = (plan) => [...plan.people].sort((a, b) => b.ownHours - a.ownHours)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

/** Two letters for a person: the first of each of two words, or the first two of one. */
export const initials = (name) => {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  const letters = (w) => w.replace(/[^\p{L}\p{N}]/gu, '')
  if (words.length >= 2) return (letters(words[0])[0] || '') + (letters(words[1])[0] || '')
  const w = letters(words[0] || '?')
  return w.slice(0, 1).toUpperCase() + w.slice(1, 2).toLowerCase()
}

/** A person, as neutral initials in a circle. No colour per person outside a chart. */
export function Avatar({ name, size = 28 }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'bg.subtle',
        border: 1,
        borderColor: 'border.subtle',
        color: 'text.secondary',
        fontSize: size >= 28 ? '0.75rem' : '0.6875rem',
        fontWeight: 500,
        lineHeight: 1,
      }}
    >
      {initials(name)}
    </Box>
  )
}

const BAR_W = ['72%', '58%', '66%', '49%', '61%', '54%']

/** The shape of a list that is on its way: rows split by hairlines. */
export function RowsSkeleton({ rows = 4, label = 'Loading…', lines = 2 }) {
  return (
    <Box role="status" aria-live="polite" aria-label={label} data-loading>
      {Array.from({ length: rows }, (_, i) => (
        <Box
          key={i}
          sx={{
            display: 'flex', alignItems: 'center', gap: 3, py: 2.5, borderTop: i ? 1 : 0, borderColor: 'border.subtle',
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton variant="text" height={18} width={BAR_W[i % BAR_W.length]} />
            {lines > 1 && <Skeleton variant="text" height={14} width="34%" sx={{ mt: 0.5 }} />}
          </Box>
          <Skeleton variant="text" height={18} width={48} />
        </Box>
      ))}
    </Box>
  )
}

/**
 * A wide table that scrolls sideways inside its card, never past the page
 * edge. Runs edge to edge in the card (cancelling the card's padding); a
 * 12px fade on the right says there is more; a sticky first column (cells
 * with the class `sticky-col`) keeps the row's name in view, with a hairline
 * once the rest has scrolled under it.
 */
export function ScrollX({ children, bleed = true }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => {
      const l = el.scrollLeft > 1
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [])
  return (
    <Box sx={{ position: 'relative', minWidth: 0, ...(bleed ? { mx: { xs: -3, sm: -4 } } : {}) }}>
      <Box
        ref={ref}
        data-scrolled={edge.l ? 'true' : 'false'}
        sx={{
          overflowX: 'auto',
          minWidth: 0,
          ...(bleed ? {
            '& th:first-of-type, & td:first-of-type': { pl: { xs: 3, sm: 4 } },
            '& th:last-of-type, & td:last-of-type': { pr: { xs: 3, sm: 4 } },
          } : {}),
          '& .sticky-col': {
            position: 'sticky', left: 0, zIndex: 1, bgcolor: 'bg.surface',
          },
          '& thead .sticky-col': { bgcolor: 'bg.subtle', zIndex: 2 },
          '& tr.MuiTableRow-hover:hover .sticky-col': { bgcolor: 'bg.subtle' },
          '&[data-scrolled="true"] .sticky-col': { boxShadow: (t) => `inset -1px 0 0 ${t.palette.border.subtle}` },
        }}
      >
        {children}
      </Box>
      {edge.r && (
        <Box
          aria-hidden
          sx={(t) => ({
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width: 12,
            pointerEvents: 'none',
            zIndex: 3,
            background: `linear-gradient(to left, ${t.palette.bg.surface}, rgba(0,0,0,0))`,
          })}
        />
      )}
    </Box>
  )
}

/**
 * One line of a list: what it is (14/500) with a line under it, and a figure
 * on the right. A row that opens something is a button the whole way across.
 */
function LedgerRow({
  lead, title, sub, figure, onClick, first,
}) {
  const body = (
    <>
      {lead}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" noWrap sx={{ fontWeight: 500 }} title={typeof title === 'string' ? title : undefined}>{title}</Typography>
        {sub && <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>{sub}</Typography>}
      </Box>
      {figure != null && (
        <Typography variant="body1" className="tabular" sx={{ fontWeight: 500, flexShrink: 0, textAlign: 'right', minWidth: 48 }}>
          {figure}
        </Typography>
      )}
    </>
  )
  const sx = {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    width: '100%',
    py: 2.5,
    px: 2,
    mx: -2,
    boxSizing: 'content-box',
    textAlign: 'left',
    borderTop: first ? 0 : 1,
    borderColor: 'border.subtle',
    borderRadius: 0,
  }
  if (!onClick) return <Box sx={sx}>{body}</Box>
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        ...sx,
        justifyContent: 'flex-start',
        transition: 'background-color 120ms',
        '&:hover': { bgcolor: 'bg.subtle' },
      }}
    >
      {body}
    </ButtonBase>
  )
}

/* ------------------------------------------------------------------ */
/* This year                                                           */
/* ------------------------------------------------------------------ */

/** A 4px bar: how far along, in the tone of how it stands. */
function ProgressBar({ value, tone }) {
  return (
    <Box
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(Math.min(1, value) * 100)}
      sx={{
        height: 4, borderRadius: '2px', bgcolor: 'bg.subtle', overflow: 'hidden',
      }}
    >
      <Box sx={(t) => ({
        height: '100%', width: `${Math.max(0, Math.min(1, value)) * 100}%`, bgcolor: t.palette.tone[tone].solid, borderRadius: '2px',
      })}
      />
    </Box>
  )
}

export function WelcomeCard({ ctx, f }) {
  const { plan, onGoTo } = ctx
  const { totals, quality } = plan
  const cov = totals.totalCoverage
  const tone = cov >= 1 ? 'success' : cov >= 0.9 ? 'warning' : 'danger'
  return (
    <CardFrame
      {...f}
      title="This year"
      label="This year"
      action={<Button variant="outlined" onClick={() => onGoTo?.('weekly')}>Open Weekly</Button>}
    >
      <Box data-year-summary sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary' }}>Saving hours a month</Typography>
          <Box sx={{
            display: 'flex', alignItems: 'baseline', gap: 2, flexWrap: 'wrap', mt: 1,
          }}
          >
            <Typography variant="figure" component="div">{fmtHours(totals.totalHours)}</Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>
              {`of ${totals.target.toLocaleString()} target (${fmtPct(cov)})`}
            </Typography>
          </Box>
        </Box>
        <ProgressBar value={totals.target ? totals.totalHours / totals.target : 0} tone={tone} />
        <Box sx={{
          display: 'flex', alignItems: 'center', columnGap: 4, rowGap: 1, flexWrap: 'wrap',
        }}
        >
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            <Box component="span" className="tabular" sx={{ color: 'text.primary', fontWeight: 500 }}>{fmtHours(totals.doneHours)}</Box>
            {' hrs delivered'}
          </Typography>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5 }}>
            {quality.pastDue > 0 && <StatusPill tone="danger">Past due</StatusPill>}
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              <Box component="span" className="tabular" sx={{ color: 'text.primary', fontWeight: 500 }}>{quality.pastDue}</Box>
              {` project${quality.pastDue === 1 ? ' is' : 's are'} past due and not done`}
            </Typography>
          </Box>
        </Box>
      </Box>
    </CardFrame>
  )
}

export function BiggestCard({ ctx, f }) {
  const { totals } = ctx.plan
  return (
    <CardFrame {...f} title="Biggest projects" sub={`The ${totals.topProjects.length} carrying the most saving hrs/mth`}>
      {totals.topProjects.map((p, i) => (
        <LedgerRow
          key={p.key}
          first={i === 0}
          onClick={() => ctx.onOpenProject?.(p.key)}
          title={p.summary || p.key}
          sub={p.jiraKey || p.key}
          figure={fmtHours(p.savingHours)}
        />
      ))}
    </CardFrame>
  )
}

export function TeamCard({ ctx, f }) {
  const { plan } = ctx
  const ranked = rankedOf(plan)
  return (
    <CardFrame {...f} title="The team" sub={`${plural(ranked.length, 'person', 'people')}, by saving hrs/mth credited`}>
      {ranked.map((p, i) => (
        <LedgerRow
          key={p.id}
          first={i === 0}
          lead={<Avatar name={p.name || p.nick} />}
          title={p.name || p.nick}
          sub={plural(p.ownCount ?? 0, 'project')}
          figure={fmtHours(p.ownHours)}
        />
      ))}
    </CardFrame>
  )
}

export function HeadlineCard({ ctx, f }) {
  const {
    totals, quality, settings, finance: fin,
  } = ctx.plan
  const sym = fin.symbol
  const items = [
    {
      key: 'hours',
      label: 'Saving hours',
      value: fmtHours(totals.totalHours),
      unit: settings.savingBasis === 'monthly' ? 'hrs/mth' : 'hrs/yr',
      note: `${fmtPct(totals.totalCoverage)} of the ${totals.target.toLocaleString()} target`,
      tone: totals.totalCoverage >= 1 ? 'success' : totals.totalCoverage >= 0.9 ? 'warning' : 'danger',
      info: 'Every project in the register, summed straight from the Saving hrs/mth column. No filtering: this always reconciles to the source workbook.',
      'data-stat': 'hours',
    },
    {
      key: 'value',
      label: 'Value of hours released',
      value: fmtMoneyShort(fin.annualBenefit, sym),
      unit: 'a year',
      note: `${fin.fteReleased.toFixed(1)} FTE at ${fmtMoney(fin.acctHourRate, sym)} an hour`,
      info: `Objective 1. The saving hours valued at the accountant rate set on the Model tab: ${fmtHours(totals.totalHours)} hrs a month ÷ the FTE ratio of ${fin.hoursPerFteMonth} hrs = ${fin.fteReleased.toFixed(1)} FTE. This is capacity released, not cash taken off the payroll.`,
      'data-stat': 'value',
    },
    {
      key: 'roi',
      label: 'Return on investment',
      value: fin.roi == null ? '—' : fmtRoi(fin.roi),
      unit: fin.roi == null ? undefined : `over ${fin.horizonMonths} months`,
      note: fin.roi == null
        ? 'No cost estimated yet'
        : fin.roi >= fin.roiGate ? `Clears the ${fmtRoi(fin.roiGate)} gate` : `Below the ${fmtRoi(fin.roiGate)} gate`,
      tone: fin.roi == null ? undefined : fin.roi >= fin.roiGate ? 'success' : 'danger',
      info: `Objective 1's gate. The benefit over ${fin.horizonMonths} months, net of ${fmtMoney(fin.opexRunRate, sym)} a month of operating cost, against the whole investment: ${fmtMoney(fin.buildCost ?? 0, sym)} of build at ${fmtMoney(fin.devDayRate, sym)} a manday plus ${fmtMoney(fin.capex ?? 0, sym)} of CAPEX. Only projects carrying a cost are in either side. ${fin.roi == null ? `${quality.uncosted} of ${quality.total} projects have no cost yet. ` : ''}The gate of ${fmtRoi(fin.roiGate)} is a payback of ${fmtMonths(gateAsPaybackMonths(fin))}, equivalent to ${gateAsHoursPerManday(fin)?.toFixed(2)} saving hours per manday on a project with no CAPEX or OPEX.`,
      'data-stat': 'roi',
    },
    {
      key: 'concentration',
      label: 'In the top two',
      value: fmtPct(totals.top2Share),
      unit: 'of hours',
      note: totals.topProjects[0] ? `Largest ${totals.topProjects[0].key}, ${fmtHours(totals.topProjects[0].savingHours)} hrs` : undefined,
      tone: totals.top2Share > 0.4 ? 'danger' : totals.top2Share > 0.25 ? 'warning' : undefined,
      info: 'Share of the committed pool sitting in the two largest projects. Above 40% the whole target depends on two deliveries landing.',
      'data-stat': 'concentration',
    },
    {
      key: 'pastdue',
      label: 'Past due, not done',
      value: quality.pastDue,
      unit: `of ${quality.total}`,
      note: `${fmtHours(quality.pastDueHours)} committed hrs`,
      tone: quality.pastDue > 20 ? 'danger' : quality.pastDue > 5 ? 'warning' : undefined,
      info: `Epics whose Jira due date is before ${settings.asOfDate} and whose status is not Done. ${quality.missingSaving} epics still have no saving hours.`,
      'data-stat': 'pastdue',
    },
  ]
  return (
    <CardFrame {...f} bare title="Headline figures">
      <FigureStrip items={items} max={5} sx={f.fill ? { height: '100%', '& > div:first-of-type': { height: '100%' } } : undefined} />
    </CardFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Target bridge: a two-column ledger                                  */
/* ------------------------------------------------------------------ */

function BridgeLine({
  label, value, note, strong = false, rule = false, muted = false,
}) {
  return (
    <Box sx={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 3,
      py: 2,
      borderTop: 1,
      borderColor: rule ? 'border.strong' : 'border.subtle',
    }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" sx={{ color: strong ? 'text.primary' : 'text.secondary', fontWeight: strong ? 600 : 400 }}>{label}</Typography>
        {note && <Typography variant="caption" component="div" sx={{ color: 'text.tertiary' }}>{note}</Typography>}
      </Box>
      <Typography
        variant="body1"
        className="tabular"
        sx={{
          flexShrink: 0, textAlign: 'right', fontWeight: strong ? 600 : 500, color: muted ? 'text.secondary' : 'text.primary',
        }}
      >
        {value}
      </Typography>
    </Box>
  )
}

export function BridgeCard({ ctx, f }) {
  const { plan } = ctx
  const { totals, people, settings } = plan
  const lead = people.find((x) => x.id === totals.fallbackPic)?.nick || 'the lead'
  const gap = totals.totalHours - totals.target
  return (
    <CardFrame {...f} title="Target bridge" sub="How the book converts into a commitment, in saving hrs/mth">
      <Box sx={{ mb: 3 }}>
        <Meter
          value={totals.totalHours}
          target={totals.target}
          label="Book against the management target"
          sublabel={gap >= 0 ? `${fmtHours(gap)} hrs above target` : `${fmtHours(-gap)} hrs short of target`}
        />
      </Box>
      <Box>
        <BridgeLine label="Done, delivered" value={fmtHours(totals.byStatus.Done || 0)} />
        <BridgeLine label="In progress" value={fmtHours(totals.byStatus['In Progress'] || 0)} />
        <BridgeLine label="Not started" value={fmtHours(totals.byStatus['Not Start'] || 0)} />
        <BridgeLine label={`Total, all ${plan.projects.length} projects`} value={fmtHours(totals.totalHours)} strong rule />
        <BridgeLine label="Management target" value={totals.target.toLocaleString()} muted />
        {totals.nextYearHours > 0 && (
          <BridgeLine
            label="Deferred to next year"
            value={`(${fmtHours(totals.nextYearHours)})`}
            muted
            note={`${plural(totals.nextYearCount, 'project')}, not in the total above`}
          />
        )}
      </Box>
      <Typography variant="h3" sx={{ mt: 5, mb: 1 }}>Gross vs bankable</Typography>
      <Box>
        <BridgeLine label="Bankable across the six scorecards" value={fmtHours(totals.bankableHours)} strong />
        {totals.outsideHours > 0 && (
          <BridgeLine
            label="Owned by IT or the business"
            value={`−${fmtHours(totals.outsideHours)}`}
            note={`${plural(totals.outsideCount, 'project')} on the register, off our book`}
          />
        )}
        {totals.partnerHours > 0 && <BridgeLine label="Built by partner or outsource devs" value={`−${fmtHours(totals.partnerHours)}`} />}
        {totals.fallbackHours > 0 && (
          <BridgeLine
            label={`Of which absorbed by ${lead}`}
            value={fmtHours(totals.fallbackHours)}
            note={plural(totals.fallbackCount, 'unassigned project')}
          />
        )}
        {totals.orphanHours > 0 && <BridgeLine label="Credited to nobody" value={fmtHours(totals.orphanHours)} note="No owner and no fallback" />}
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3, maxWidth: '72ch' }}>
        {settings.creditPartners
          ? 'Net view: partner devs dilute each person’s share, so the team cannot personally bank the whole pool.'
          : 'Gross view: each owner is credited whole projects even where a partner dev builds them.'}
      </Typography>
    </CardFrame>
  )
}

/* ------------------------------------------------------------------ */
/* By person                                                           */
/* ------------------------------------------------------------------ */

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
      sub="Each project’s hours are split once across its people, never double-banked."
      action={(
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, v) => v && setView(v)} aria-label="view">
          <ToggleButton value="chart">Chart</ToggleButton>
          <ToggleButton value="mix">Mix</ToggleButton>
          <ToggleButton value="table">Table</ToggleButton>
        </ToggleButtonGroup>
      )}
    >
      {view === 'chart' && (
        <HBar
          data={ranked.map((p) => ({ label: p.nick, value: p.ownHours, note: `${plural(p.ownCount, 'project')}, ${fmtRatio(p.ratio)} hrs/manday` }))}
          unit=" hrs"
        />
      )}
      {view === 'mix' && <StackedHBar rows={ranked.map((p) => ({ label: p.nick, values: p.ownByObjective }))} series={series} />}
      {view === 'table' && (
        <ScrollX>
          <Table size="small" sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow>
                <TableCell className="sticky-col">Person</TableCell>
                <TableCell align="right">Projects</TableCell>
                <TableCell align="right">Credited hrs/mth</TableCell>
                <TableCell align="right">Benefit a year</TableCell>
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
                    <TableCell className="sticky-col" sx={{ fontWeight: 500 }}>{p.nick}</TableCell>
                    <TableCell align="right">{p.ownCount}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 500 }}>{fmtHours(p.ownHours)}</TableCell>
                    <TableCell align="right">{fmtMoneyShort(p.monthlyBenefit * 12, sym)}</TableCell>
                    <TableCell align="right">{fmtHours(p.manday)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title={`Build ${fmtMoneyShort(p.buildCost, sym)} plus CAPEX ${fmtMoneyShort(p.capex, sym)}, at ${p.nick}'s share of each project.`}>
                        <span>{fmtMoneyShort(p.investment, sym)}</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5 }}>
                        {roi != null && roi < fin.roiGate && <StatusPill tone="danger">Below gate</StatusPill>}
                        {roi == null ? <Box component="span" sx={{ color: 'text.tertiary' }}>–</Box> : fmtRoi(roi)}
                      </Box>
                    </TableCell>
                    <TableCell align="right">{p.missingSaving || <Box component="span" sx={{ color: 'text.tertiary' }}>–</Box>}</TableCell>
                  </TableRow>
                )
              })}
              <TableRow>
                <TableCell className="sticky-col" sx={{ fontWeight: 600, borderTop: 1, borderColor: 'border.strong' }}>Team total</TableCell>
                <TableCell sx={{ borderTop: 1, borderColor: 'border.strong' }} />
                <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1, borderColor: 'border.strong' }}>{fmtHours(totals.teamHours)}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, borderTop: 1, borderColor: 'border.strong' }}>
                  {fmtMoneyShort(ranked.reduce((a, x) => a + x.monthlyBenefit * 12, 0), sym)}
                </TableCell>
                <TableCell colSpan={4} sx={{ borderTop: 1, borderColor: 'border.strong' }} />
              </TableRow>
            </TableBody>
          </Table>
        </ScrollX>
      )}
    </CardFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Objective 1's gate                                                  */
/* ------------------------------------------------------------------ */

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
      note: `${fmtMoney(p.investment, sym)} invested, ${fmtMoney(p.netHorizonBenefit, sym)} back over ${fin.horizonMonths} months after OPEX, ROI ${fmtRoi(p.roi)}`,
    }))
  return (
    <CardFrame
      {...f}
      title="Objective 1: is the build worth it"
      sub={points.length
        ? `Each dot is a project: what it cost against what it gives back over ${fin.horizonMonths} months. The dashed line is the ${fmtRoi(fin.roiGate)} gate.`
        : undefined}
    >
      {points.length ? (
        <GateScatter
          points={points}
          gate={1 + fin.roiGate}
          xLabel={`Investment, build plus CAPEX (${fin.currency})`}
          yLabel={`Net benefit over ${fin.horizonMonths} months, after OPEX (${fin.currency})`}
          fmt={(v) => fmtMoneyShort(v, sym)}
        />
      ) : (
        <EmptyState
          inline
          icon={ScatterPlotIcon}
          title="No project has a cost yet, so there is nothing to plot."
          body={`The benefit is ${fmtMoneyShort(fin.annualBenefit, sym)} a year; add mandays or CAPEX on the Projects page to see the return.`}
        />
      )}
    </CardFrame>
  )
}

/* ------------------------------------------------------------------ */
/* The guideline                                                       */
/* ------------------------------------------------------------------ */

export function GuidelineCard({ ctx, f }) {
  const { plan, mode } = ctx
  const {
    totals, projects, settings, finance: fin, mixByObjective: byObjective,
  } = plan
  const hoursTarget = settings.teamTarget ?? totals.guidelineTarget ?? 3000
  const objTarget = (o) => {
    if (o.measure === 'ratio') return fmtRoi(fin.roiGate)
    if (o.measure === 'hours') return fmtHours(hoursTarget)
    if (o.measure === 'count') return String(fin.objectiveTargets?.[o.id] ?? plan.countByObjective?.[o.id] ?? 0)
    return o.target
  }
  const objActual = (o) => {
    if (o.measure === 'ratio') return fin.roi == null ? null : fmtRoi(fin.roi)
    if (o.measure === 'hours') return fmtHours(totals.headlineHours)
    if (o.measure === 'count') return String(plan.countByObjective?.[o.id] ?? 0)
    return o.target
  }
  // Where it stands, as a word: the figure itself stays in the text colour.
  const objState = (o) => {
    if (o.measure === 'ratio') return fin.roi == null ? ['neutral', 'Not costed'] : fin.roi >= fin.roiGate ? ['success', 'Met'] : ['danger', 'Below']
    if (o.measure === 'hours') return totals.headlineHours >= hoursTarget ? ['success', 'Met'] : ['warning', 'Below']
    if (o.measure === 'count') {
      const target = fin.objectiveTargets?.[o.id]
      if (!target) return null
      return (plan.countByObjective?.[o.id] ?? 0) >= target ? ['success', 'Met'] : ['warning', 'Below']
    }
    return null
  }
  const top = { verticalAlign: 'top' }
  return (
    <CardFrame
      {...f}
      title="2026 management KPI guideline"
      sub="The objectives as issued, with what the team carries against each."
    >
      {f.phone ? OBJECTIVES.map((o, i) => {
        const state = objState(o)
        const actual = objActual(o)
        return (
          <Box key={o.id} sx={{ py: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle' }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 3 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>{o.guidelineName || `(continues ${OBJECTIVES[i - 1]?.guidelineName})`}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {`Objective ${o.no}, target ${objTarget(o)}, ${projects.filter((p) => serves(p, o.id)).length} projects, ${fmtHours(byObjective[o.id] || 0)} hrs/mth`}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                <Typography variant="body1" className="tabular" sx={{ fontWeight: 500, color: actual == null ? 'text.tertiary' : 'text.primary' }}>{actual ?? '–'}</Typography>
                {state && <StatusPill tone={state[0]} sx={{ mt: 1 }}>{state[1]}</StatusPill>}
              </Box>
            </Box>
            {o.guidelineTarget && (
              <Typography variant="body2" lang="th" sx={{ mt: 1.5, lineHeight: 1.6, color: 'text.secondary' }}>{o.guidelineTarget}</Typography>
            )}
          </Box>
        )
      }) : (
      <ScrollX>
        <Table size="small" sx={{ minWidth: 960, '& td': { py: 2.5 } }}>
          <TableHead>
            <TableRow>
              <TableCell className="sticky-col" sx={{ minWidth: 180, width: 190 }}>Objective</TableCell>
              <TableCell sx={{ minWidth: 200 }}>Objective detail</TableCell>
              <TableCell sx={{ minWidth: 220 }}>F&amp;A Tech</TableCell>
              <TableCell align="right" sx={{ minWidth: 64 }}>Projects</TableCell>
              <TableCell align="right" sx={{ minWidth: 80 }}>Hours/mth</TableCell>
              <TableCell align="right" sx={{ minWidth: 110 }}>Target</TableCell>
              <TableCell align="right" sx={{ minWidth: 140 }}>Where we are</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {OBJECTIVES.map((o, i) => {
              const n = projects.filter((p) => serves(p, o.id)).length
              const state = objState(o)
              const actual = objActual(o)
              return (
                <TableRow key={o.id} hover>
                  <TableCell className="sticky-col" sx={top}>
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                      <Box
                        aria-hidden
                        sx={{
                          width: 8, height: 8, borderRadius: '2px', mt: 1.5, bgcolor: CHART[mode].series[i], flexShrink: 0,
                        }}
                      />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body1" sx={{ fontWeight: 500, color: o.guidelineName ? 'text.primary' : 'text.secondary' }}>
                          {o.guidelineName || `(continues ${OBJECTIVES[i - 1]?.guidelineName})`}
                        </Typography>
                        <Typography variant="caption" component="div" sx={{ color: 'text.tertiary' }}>{`Objective ${o.no} in this app`}</Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell sx={top}>
                    <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>{o.guidelineDetail}</Typography>
                  </TableCell>
                  <TableCell sx={top} lang="th">
                    <Typography variant="body2" sx={{ lineHeight: 1.6, wordBreak: 'normal', overflowWrap: 'break-word' }}>{o.guidelineTarget}</Typography>
                  </TableCell>
                  <TableCell align="right" sx={top}>{n}</TableCell>
                  <TableCell align="right" sx={{ ...top, fontWeight: 500 }}>{fmtHours(byObjective[o.id] || 0)}</TableCell>
                  <TableCell align="right" sx={top}>
                    <Typography variant="body1" className="tabular" sx={{ fontWeight: 500 }}>{objTarget(o)}</Typography>
                    <Typography variant="caption" component="div" sx={{ color: 'text.tertiary' }}>
                      {o.measure === 'ratio' ? 'or better' : o.measure === 'count' ? o.countUnit : o.measure === 'hours' ? 'hrs/mth' : 'milestone'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={top}>
                    <Box sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5,
                    }}
                    >
                      {state && <StatusPill tone={state[0]}>{state[1]}</StatusPill>}
                      <Typography variant="body1" className="tabular" sx={{ fontWeight: 500, color: actual == null ? 'text.tertiary' : 'text.primary' }}>
                        {actual ?? '–'}
                      </Typography>
                    </Box>
                    <Typography variant="caption" component="div" sx={{ color: 'text.tertiary' }}>
                      {o.measure === 'ratio' ? `on ${fmtMoneyShort(fin.annualBenefit, fin.symbol)} a year` : o.measure === 'count' ? 'delivered' : o.measure === 'hours' ? 'committed' : 'as planned'}
                    </Typography>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </ScrollX>
      )}
    </CardFrame>
  )
}

/* ------------------------------------------------------------------ */
/* Concentration                                                       */
/* ------------------------------------------------------------------ */

const STATUS_WORD = { 'Not Start': 'Not started', 'In Progress': 'In progress' }
const PILL_TONE = {
  good: 'success', info: 'info', neutral: 'neutral', violet: 'info',
}

export function ConcentrationCard({ ctx, f }) {
  const { totals, people } = ctx.plan
  const share = totals.topProjects.reduce((a, p) => a + (p.savingHours ?? 0), 0) / (totals.headlineHours || 1)
  return (
    <CardFrame
      {...f}
      title="Concentration risk"
      sub={`The ${totals.topProjects.length} largest projects carry ${fmtPct(share)} of the committed pool.`}
    >
      {f.phone ? totals.topProjects.map((p, i) => {
        const person = people.find((x) => x.id === p.pic)
        const without = totals.target > 0 ? (totals.headlineHours - (p.savingHours ?? 0)) / totals.target : null
        const st = p.srcStatus || p.status
        return (
          <LedgerRow
            key={p.key}
            first={i === 0}
            onClick={() => ctx.onOpenProject?.(p.key)}
            title={p.summary || p.key}
            sub={[p.key, person?.nick || 'PIC to be confirmed', st ? (STATUS_WORD[st] || st) : null, `${fmtPct((p.savingHours ?? 0) / (totals.headlineHours || 1))} of pool`].filter(Boolean).join(', ')}
            figure={(
              <Box component="span" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                {fmtHours(p.savingHours)}
                {without != null && without < 1 && <StatusPill tone="danger">{`${fmtPct(without)} if it slips`}</StatusPill>}
              </Box>
            )}
          />
        )
      }) : (
      <ScrollX>
        <Table size="small" sx={{ minWidth: 760 }}>
          <TableHead>
            <TableRow>
              <TableCell className="sticky-col" sx={{ minWidth: 260 }}>Project</TableCell>
              <TableCell sx={{ minWidth: 90 }}>PIC</TableCell>
              <TableCell sx={{ minWidth: 110 }}>Status</TableCell>
              <TableCell align="right" sx={{ minWidth: 110 }}>Saving hrs/mth</TableCell>
              <TableCell align="right" sx={{ minWidth: 100 }}>Share of pool</TableCell>
              <TableCell align="right" sx={{ minWidth: 190 }}>Coverage if it slips</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {totals.topProjects.map((p) => {
              const person = people.find((x) => x.id === p.pic)
              const without = totals.target > 0 ? (totals.headlineHours - (p.savingHours ?? 0)) / totals.target : null
              const st = p.srcStatus || p.status
              return (
                <TableRow
                  key={p.key}
                  hover
                  tabIndex={0}
                  sx={{ cursor: 'pointer' }}
                  onClick={() => ctx.onOpenProject?.(p.key)}
                  onKeyDown={(e) => { if (e.key === 'Enter') ctx.onOpenProject?.(p.key) }}
                >
                  <TableCell className="sticky-col">
                    <Typography variant="body1" sx={{ fontWeight: 500 }}>{p.summary}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>{p.key}</Typography>
                  </TableCell>
                  <TableCell>{person?.nick || <StatusPill tone="warning">TBC</StatusPill>}</TableCell>
                  <TableCell>
                    {st ? <StatusPill tone={PILL_TONE[statusTone(st)] || 'neutral'}>{STATUS_WORD[st] || st}</StatusPill> : <Box component="span" sx={{ color: 'text.tertiary' }}>–</Box>}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500 }}>{fmtHours(p.savingHours)}</TableCell>
                  <TableCell align="right">{fmtPct((p.savingHours ?? 0) / (totals.headlineHours || 1))}</TableCell>
                  <TableCell align="right">
                    <Box sx={{
                      display: 'inline-flex', alignItems: 'center', gap: 1.5,
                    }}
                    >
                      {without != null && without < 1 && <StatusPill tone="danger">Below target</StatusPill>}
                      <span>{fmtPct(without)}</span>
                    </Box>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </ScrollX>
      )}
    </CardFrame>
  )
}
