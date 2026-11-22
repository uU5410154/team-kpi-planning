import { useMemo, useState } from 'react'
import {
  Box, Typography, Table, TableHead, TableBody, TableRow, TableCell, Alert, Link, TableSortLabel, ToggleButton, ToggleButtonGroup, Tooltip,
} from '@mui/material'
import { portfolioCosts, BENEFIT_STATE_LABEL, COST_CATEGORY_LABEL } from '../lib/costs.js'
import { useGov } from '../components/GovConflict.jsx'
import {
  Section, Stat, PageHead, money, pctOf, signedMoney, TONE,
} from '../components/GovUi.jsx'
import { Pill } from '../components/Brand.jsx'
import Loading from '../components/Loading.jsx'

/*
 * COST AND ROI (management design summary, Priority 1).
 *
 * Forecast and actual spend by project and by cost type, the estimate at
 * completion against the approved budget, and the return three ways:
 *
 *   forecast ROI   (forecast benefit − forecast total cost) ÷ forecast cost
 *   projected ROI  (current expected benefit − EAC) ÷ EAC
 *   actual ROI     (validated realised benefit − actual cost) ÷ actual cost
 *
 * All over the benefit horizon (the Model page's, normally 12 months). Saved
 * hours are capacity released, not a cash saving, and an estimate is never
 * called value released.
 */

const COLS = [
  ['name', 'Project'], ['budget', 'Budget'], ['forecastTotal', 'Forecast cost'], ['actualTotal', 'Actual'], ['eac', 'EAC'],
  ['variance', 'Variance'], ['forecastRoi', 'Forecast ROI'], ['projectedRoi', 'Projected ROI'], ['actualRoi', 'Actual ROI'], ['payback', 'Payback'], ['benefitState', 'Benefit'],
]

export default function CostRoi({ plan, onOpenProject, onGoTo }) {
  const { gov, error } = useGov()
  const [sort, setSort] = useState({ by: 'eac', dir: 'desc' })
  const [show, setShow] = useState('all')
  const c = useMemo(() => (gov ? portfolioCosts(plan, gov) : null), [plan, gov])
  if (error) return <Alert severity="error">{error}</Alert>
  if (!c) return <Loading variant="block" label="Working out cost and return…" />
  const sym = plan.finance?.symbol || '฿'
  const gate = plan.finance?.roiGate ?? 2
  const t = c.totals
  const cov = c.coverage
  const pick = {
    all: () => true,
    over: (r) => r.variance > 0,
    below: (r) => r.projectedRoi != null && r.projectedRoi < gate,
    nobudget: (r) => r.budget == null,
  }[show]
  const rows = c.rows.filter(pick).sort((a, b) => {
    const k = sort.by
    const va = a[k]
    const vb = b[k]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    const d = typeof va === 'string' ? va.localeCompare(vb) : va - vb
    return sort.dir === 'asc' ? d : -d
  })
  const noData = !cov.budgeted && !cov.withActual
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }} data-page="cost">
      <PageHead title="Cost & ROI">
        Forecast and actual spend, the estimate at completion against the approved budget, and the return three ways —
        forecast, projected and validated actual — over a {c.horizon}-month benefit horizon. Saved hours are capacity
        released, not a cash saving.
      </PageHead>

      {noData && (
        <Alert severity="warning" variant="outlined" action={onGoTo && <Link component="button" onClick={() => onGoTo('rates')}>Open Costs &amp; rates</Link>}>
          No approved budgets and no worklogs yet, so budget variance and actual cost cannot be stated. Add budgets and
          role rates on Costs &amp; rates, and read the worklogs from Jira there.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)', xl: 'repeat(8, 1fr)' } }}>
        <Stat label="Approved budget" value={money(t.budget, sym)} note={`${cov.budgeted} of ${cov.projects} projects`} gap={!cov.budgeted ? 'No budgets recorded' : null} data-stat="budget" />
        <Stat label="Forecast cost" value={money(t.forecastTotal, sym)} note="Labour forecast + other cost lines" help="Forecast labour (hours × role rate) plus the register's CAPEX and OPEX over the horizon, plus the vendor, software, infrastructure and other lines." />
        <Stat label="Actual spend" value={money(t.actualTotal, sym)} note={`Logged hours on ${cov.withActual} projects`} gap={!cov.withActual ? 'No worklogs read yet' : null} help="Hours logged in Jira × the rate of the role that logged them, plus actual amounts on the cost lines." data-stat="actual" />
        <Stat label="Estimate at completion" value={money(t.eac, sym)} note="Actual + remaining" help="Actual labour + actual other cost + remaining hours × rate + remaining other cost." data-stat="eac" />
        <Stat
          label="Budget variance"
          value={signedMoney(t.variance, sym)}
          tone={t.variance > 0 ? TONE.bad : t.variance != null ? TONE.good : undefined}
          note={cov.budgeted ? `${cov.overBudget} over budget · budgeted projects only` : null}
          gap={!cov.budgeted ? 'No budgets recorded' : null}
          help="EAC − approved budget, over the projects that have a budget."
          data-stat="variance"
        />
        <Stat label="Forecast ROI" value={pctOf(t.forecastRoi)} note="Estimated benefit vs forecast cost" help="(Forecast benefit − forecast total cost) ÷ forecast total cost." />
        <Stat label="Projected ROI" value={pctOf(t.projectedRoi)} tone={t.projectedRoi != null ? (t.projectedRoi >= gate ? TONE.good : TONE.warn) : undefined} note={`Return gate ${pctOf(gate)}`} help="(Current expected benefit − EAC) ÷ EAC." data-stat="projected" />
        <Stat
          label="Validated actual ROI"
          value={pctOf(t.actualRoi)}
          note={cov.validated ? `${cov.validated} validated project${cov.validated === 1 ? '' : 's'}` : null}
          gap={!cov.validated ? 'No benefit validated yet' : null}
          help="(Validated realised benefit − actual total cost) ÷ actual total cost. Only projects whose benefit is post-stabilisation validated or realised."
          data-stat="actualRoi"
        />
      </Box>

      {(cov.draftRates > 0 || cov.unmapped.length > 0) && (
        <Alert severity="info" variant="outlined">
          {cov.draftRates > 0 && <>{cov.draftRates} project{cov.draftRates === 1 ? ' is' : 's are'} costed at a rate that is not approved yet (a draft, or the Model page salary). </>}
          {cov.unmapped.length > 0 && <>Worklogs by {cov.unmapped.join(', ')} are not matched to the team and are costed at the default rate.</>}
        </Alert>
      )}

      <Section title="By cost type" subtitle="Forecast and actual across the team's projects.">
        <Table size="small" sx={{ maxWidth: 720 }}>
          <TableHead><TableRow><TableCell>Category</TableCell><TableCell align="right">Forecast</TableCell><TableCell align="right">Actual</TableCell><TableCell align="right">Remaining</TableCell></TableRow></TableHead>
          <TableBody>
            {Object.entries(c.byCategory).map(([k, v]) => (
              <TableRow key={k} data-category={k}>
                <TableCell>{COST_CATEGORY_LABEL[k]}</TableCell>
                <TableCell align="right">{money(v.forecast, sym)}</TableCell>
                <TableCell align="right">{money(v.actual, sym)}</TableCell>
                <TableCell align="right">{v.forecast != null ? money(Math.max(0, v.forecast - (v.actual || 0)), sym) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title="Projects"
        subtitle={`Click a heading to sort. Below the return gate means a projected ROI under ${pctOf(gate)}.`}
        action={(
          <ToggleButtonGroup size="small" exclusive value={show} onChange={(_e, v) => v && setShow(v)}>
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="over" data-filter-over>Over budget ({cov.overBudget})</ToggleButton>
            <ToggleButton value="below">Below the gate</ToggleButton>
            <ToggleButton value="nobudget">No budget</ToggleButton>
          </ToggleButtonGroup>
        )}
      >
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {COLS.map(([k, label]) => (
                  <TableCell key={k} align={k === 'name' || k === 'benefitState' ? 'left' : 'right'}>
                    <TableSortLabel active={sort.by === k} direction={sort.by === k ? sort.dir : 'desc'} onClick={() => setSort((s) => ({ by: k, dir: s.by === k && s.dir === 'desc' ? 'asc' : 'desc' }))}>
                      {label}
                    </TableSortLabel>
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.key} hover data-cost-row={r.key}>
                  <TableCell sx={{ minWidth: 220 }}>
                    <Link component="button" onClick={() => onOpenProject?.(r.key)} sx={{ fontWeight: 600, textAlign: 'left' }}>{r.key}</Link>
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{r.name}</Typography>
                  </TableCell>
                  <TableCell align="right">{money(r.budget, sym)}</TableCell>
                  <TableCell align="right">{money(r.forecastTotal, sym)}</TableCell>
                  <TableCell align="right">
                    <Tooltip title={r.actualHours != null ? `${Math.round(r.actualHours)} h logged` : r.gaps.find((g) => /worklog|Jira key/.test(g)) || ''}>
                      <span>{money(r.actualTotal, sym)}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">{money(r.eac, sym)}</TableCell>
                  <TableCell align="right" sx={{ color: r.variance > 0 ? TONE.bad : r.variance != null ? TONE.good : 'text.disabled', fontWeight: r.variance > 0 ? 700 : 400 }}>{signedMoney(r.variance, sym)}</TableCell>
                  <TableCell align="right">{pctOf(r.forecastRoi)}</TableCell>
                  <TableCell align="right" sx={{ color: r.projectedRoi != null && r.projectedRoi < gate ? TONE.warn : undefined }}>{pctOf(r.projectedRoi)}</TableCell>
                  <TableCell align="right">{pctOf(r.actualRoi)}</TableCell>
                  <TableCell align="right">{r.payback == null ? '—' : `${r.payback.toFixed(1)} mo`}</TableCell>
                  <TableCell>
                    <Pill label={BENEFIT_STATE_LABEL[r.benefitState] || r.benefitState} tone={r.benefitState === 'realized' || r.benefitState === 'validated' ? 'good' : r.benefitState === 'estimated' ? 'neutral' : 'violet'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
        {!rows.length && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1 }}>No project matches.</Typography>}
      </Section>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Benefit = saved hours × the accountant hourly rate on the Model page, plus any monetary benefit, less the benefit&rsquo;s
        recurring operating cost, over {c.horizon} months. Expected benefit uses the Benefits page&rsquo;s expected hours where
        given, else the register&rsquo;s estimate. Validated benefit uses the actual hours confirmed after go-live.
      </Typography>
    </Box>
  )
}
