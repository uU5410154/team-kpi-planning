import { useEffect, useRef, useState } from 'react'
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow, Tooltip,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined'
import { OBJECTIVES, CHART } from '../lib/palette.js'
import { fmtHours, fmtPct, fmtMoneyShort, targetUnit } from '../lib/model.js'
import {
  PageHeader, Section, StatusPill, EmptyState, SectionSkeleton,
} from '../components/ui.jsx'

/**
 * A horizontal scroller that says so: a 12px fade on whichever edge still has
 * columns beyond it, and an `is-scrolled` class once it has moved, so a pinned
 * first column can draw its edge only when something is sliding under it.
 *
 * A wide table must never be cut off by the page edge (docs/DESIGN.md §5); it
 * scrolls inside its own section instead.
 */
export function ScrollX({ children, sx, label }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ l: false, r: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const update = () => {
      const l = el.scrollLeft > 1
      const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdge((e) => (e.l === l && e.r === r ? e : { l, r }))
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    if (ro) {
      ro.observe(el)
      if (el.firstElementChild) ro.observe(el.firstElementChild)
    }
    return () => { el.removeEventListener('scroll', update); ro?.disconnect() }
  }, [])
  const fade = (t, side) => ({
    position: 'absolute',
    top: 0,
    bottom: 0,
    [side]: 0,
    width: 12,
    pointerEvents: 'none',
    zIndex: 3,
    transition: 'opacity 120ms',
    background: `linear-gradient(to ${side === 'right' ? 'left' : 'right'}, ${t.palette.mode === 'dark' ? 'rgba(0,0,0,0.40)' : 'rgba(16,24,40,0.10)'}, transparent)`,
  })
  return (
    <Box sx={{ position: 'relative', minWidth: 0 }}>
      <Box
        ref={ref}
        className={edge.l ? 'is-scrolled' : undefined}
        role={label ? 'region' : undefined}
        aria-label={label}
        tabIndex={label && edge.r ? 0 : undefined}
        sx={[{ overflowX: 'auto', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
      >
        {children}
      </Box>
      <Box aria-hidden sx={(t) => ({ ...fade(t, 'right'), opacity: edge.r ? 1 : 0 })} />
    </Box>
  )
}

/**
 * Every scorecard side by side — the same grid as the workbook's
 * Overall_Objectives sheet.
 *
 * The Scorecards tab answers "what is this person measured on". This one
 * answers the question a lead actually asks first: who is carrying what, and
 * does the team add up. Reading it off six separate cards means holding five
 * numbers in your head per person.
 *
 * It is built from the same computed people the workbook writes, so the two
 * cannot disagree — if a figure here is wrong it is wrong in the export too,
 * which is the point.
 *
 * `own`: a team member's view. The plan arrives already narrowed to them, so
 * the grid is their card alone, and the team's totals are left off.
 */
/** "dashboards/reports/portals" → "Dashboards, reports and portals delivered". */
const countLabel = (unit = '') => {
  const parts = String(unit).split('/').map((x) => x.trim()).filter(Boolean)
  const said = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] || 'Items')
  return `${said.charAt(0).toUpperCase()}${said.slice(1)} delivered`
}

export default function Team({ plan, own = false, loading = false }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { people, settings, finance: fin } = plan
  const sym = fin.symbol

  const title = own ? 'My scorecard' : 'Overall team'
  const description = own
    ? 'Your 2026 targets, the weight of each on your card, and where each stands now.'
    : 'Every scorecard side by side, as in the Overall_Objectives sheet of the export.'

  const help = (
    <>
      <p>
        Each objective is measured in its own unit, which is what lets one project answer to several without
        being counted twice.
      </p>
      <p>
        Objective 2 carries every saving hour in the plan. Objective 1 is on-time delivery, shown as the share of
        projects that drifted. Objectives 4 and 5 count what was delivered, and objective 3 is a date.
      </p>
      <p>
        So the saving-hours total is the hours once, not the sum of five rows. A target typed over the calculated
        figure is shown in bold, and where a card states something different from the register, the register&rsquo;s
        figure is printed beside the total.
      </p>
    </>
  )

  if (loading) {
    return (
      <Box>
        <PageHeader title={title} description={description} />
        <SectionSkeleton rows={7} />
      </Box>
    )
  }

  /*
   * What a person's line for this objective says, in the unit that objective
   * is measured in. The three columns mirror the sheet: what they are aiming
   * at, how much of their card it is, and where they stand.
   */
  const cellFor = (p, o) => {
    const line = p.kpiLines.find((l) => l.objective === o.id && !l.custom)
    if (!line) return null
    const kind = line.targetKind
    // The unit is in the row's description, so the columns carry figures only.
    const target = kind === 'percent' ? `Max ${Number(line.target) || 0}%`
      : kind === 'hours' ? fmtHours(line.target)
        : kind === 'number' ? Number(line.target).toLocaleString()
          : String(line.target ?? '–')
    const unitTip = kind === 'hours' ? targetUnit(line, settings.savingBasis, sym)
      : kind === 'number' ? (line.unit || '') : ''
    const actual = kind === 'percent'
      ? (line.creditedRatio == null ? null : fmtPct(line.creditedRatio))
      : kind === 'hours' ? fmtHours(p.byObjective[o.id] || 0)
        : kind === 'number' ? String(p.countByObjective?.[o.id] ?? 0)
          : (line.creditedHours ? `${fmtHours(line.creditedHours)} hrs` : null)
    const tone = kind === 'percent' && line.creditedRatio != null
      ? (line.meetsTarget ? 'success' : 'danger')
      : null
    return {
      line, target, actual, tone, unitTip,
    }
  }

  const dash = <Box component="span" sx={{ color: 'text.tertiary' }}>–</Box>
  const num = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }
  const groupEdge = { borderLeft: 1, borderLeftColor: 'border.subtle' }
  /*
   * The pinned first column. On a phone it narrows and wraps, so the people's
   * figures keep most of the width; a hairline marks where the scrolling part
   * begins, and deepens once something is sliding under it.
   */
  const stick = (head) => ({
    position: 'sticky',
    left: 0,
    zIndex: head ? 3 : 1,
    bgcolor: head ? 'bg.subtle' : 'bg.surface',
    minWidth: { xs: 148, sm: 248 },
    maxWidth: { xs: 160, sm: 280 },
    width: { sm: 264 },
    overflowWrap: 'anywhere',
    boxShadow: (t) => `inset -1px 0 0 ${t.palette.border.subtle}`,
    '.is-scrolled &': { boxShadow: (t) => `inset -1px 0 0 ${t.palette.border.strong}, 4px 0 8px -4px ${t.palette.mode === 'dark' ? 'rgba(0,0,0,0.5)' : 'rgba(16,24,40,0.12)'}` },
    '.MuiTableRow-hover:hover > &': { bgcolor: 'bg.subtle' },
  })

  const teamMeta = own ? null : (
    <>
      {`Team total ${fmtHours(plan.totals.committedHours)} hrs/month committed, ${fmtMoneyShort(fin.annualBenefit, sym)} a year, return gate ${fmtPct(fin.roiGate)}.`}
    </>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={title} description={description} help={help} />

      {own && people.length === 0 && (
        <Section>
          <EmptyState
            icon={PersonOffOutlinedIcon}
            title="Your account is not linked to your name on the team yet"
            body="Ask an administrator to link it on the Access page, and your scorecard appears here."
          />
        </Section>
      )}

      {people.length > 0 && (
        <Section
          title={own ? undefined : 'KPI lines by person'}
          meta={teamMeta}
          padded={false}
          // One person's card reads as a compact table, not one stretched across the screen.
          sx={own ? { maxWidth: 880 } : undefined}
        >
          <ScrollX label={own ? 'My scorecard' : 'Every scorecard, scroll sideways for more people'}>
            <Table
              size="small"
              sx={{
                minWidth: own ? 560 : undefined,
                '& td, & th': { px: { xs: 2, sm: 3 } },
                '& tbody td': { height: 52, verticalAlign: 'middle' },
              }}
            >
              <TableHead>
                <TableRow>
                  {/* One cell over both header rows, so the pinned column
                      never shows an empty second "KPI line" header. */}
                  <TableCell rowSpan={2} sx={{ ...stick(true), verticalAlign: 'bottom' }}>
                    KPI line
                  </TableCell>
                  {people.map((p) => (
                    <TableCell key={p.id} colSpan={3} sx={{ ...groupEdge, pt: 2, pb: 1, height: 'auto' }}>
                      <Typography variant="h3" component="div" sx={{ color: 'text.primary', whiteSpace: 'nowrap' }}>
                        {p.nick}{p.aggregatesTeam && ' (team)'}
                      </Typography>
                      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                        {fmtHours(p.scorecardHours)} hrs, {p.scorecardCount} project{p.scorecardCount === 1 ? '' : 's'}
                      </Typography>
                    </TableCell>
                  ))}
                </TableRow>
                <TableRow>
                  {people.map((p) => [
                    <TableCell key={`${p.id}-t`} align="right" sx={{ ...groupEdge, minWidth: 96 }}>Target</TableCell>,
                    <TableCell key={`${p.id}-w`} align="right" sx={{ minWidth: 64 }}>Weight</TableCell>,
                    <TableCell key={`${p.id}-a`} align="right" sx={{ minWidth: 72 }}>Now</TableCell>,
                  ])}
                </TableRow>
              </TableHead>

              <TableBody>
                {OBJECTIVES.map((o, i) => (
                  <TableRow key={o.id} hover>
                    <TableCell sx={stick(false)}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                        <Box
                          aria-hidden
                          sx={{
                            width: 8, height: 8, borderRadius: '2px', mt: '6px', bgcolor: CHART[mode].series[i], flexShrink: 0,
                          }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body1" sx={{ fontWeight: 500 }}>
                            Obj {o.no} — {o.name}
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
                            {o.measure === 'ratio' ? 'Share of projects that drifted'
                              : o.measure === 'hours' ? `Saving ${settings.savingBasis === 'annual' ? 'hours a year' : 'hours a month'}`
                                : o.measure === 'count' ? countLabel(o.countUnit)
                                  : 'A delivery date'}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>

                    {people.map((p) => {
                      const c = cellFor(p, o)
                      if (!c) {
                        return [
                          <TableCell key={`${p.id}-${o.id}-t`} colSpan={3} sx={{ ...groupEdge, color: 'text.tertiary' }}>
                            Not held
                          </TableCell>,
                        ]
                      }
                      return [
                        <TableCell key={`${p.id}-${o.id}-t`} align="right" sx={{ ...groupEdge, ...num }}>
                          <Tooltip title={`${c.unitTip ? `${c.target} ${c.unitTip}. ` : ''}${c.line.overridden ? 'Typed over the calculated figure.' : 'From the project register.'}`}>
                            <Box
                              component="span"
                              sx={{
                                fontWeight: c.line.overridden ? 600 : 400,
                                display: 'inline-block',
                                maxWidth: 200,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                verticalAlign: 'bottom',
                              }}
                            >
                              {c.target}
                            </Box>
                          </Tooltip>
                        </TableCell>,
                        <TableCell key={`${p.id}-${o.id}-w`} align="right" sx={num}>
                          {fmtPct(c.line.weight)}
                        </TableCell>,
                        <TableCell key={`${p.id}-${o.id}-a`} align="right" sx={num}>
                          {c.actual == null ? dash
                            : c.tone ? (
                              <Tooltip title={`${c.line.driftedCount ?? 0} of ${c.line.held ?? 0} projects drifted, limit ${c.line.target}%`}>
                                <span><StatusPill tone={c.tone}>{c.actual}</StatusPill></span>
                              </Tooltip>
                            )
                              : <Box component="span" sx={{ fontWeight: 500 }}>{c.actual}</Box>}
                        </TableCell>,
                      ]
                    })}
                  </TableRow>
                ))}

                {/* the two totals the sheet carries, for the same reason */}
                <TableRow sx={{ '& td': { borderTop: 1, borderTopColor: 'border.strong' } }}>
                  <TableCell sx={{ ...stick(false), fontWeight: 500 }}>
                    Total saving hrs/mth
                  </TableCell>
                  {people.map((p) => [
                    <TableCell key={`${p.id}-th`} align="right" sx={{ ...groupEdge, ...num, fontWeight: 600 }}>
                      {fmtHours(p.kpiTotals.savingHours)}
                    </TableCell>,
                    <TableCell key={`${p.id}-tw`} />,
                    <TableCell key={`${p.id}-ta`} align="right" sx={{ ...num, color: 'text.secondary' }}>
                      {Math.abs(p.kpiTotals.savingHours - p.registerHours) > 0.5 ? (
                        <Tooltip title="What the project register credits, where the card states something different">
                          <span>Register {fmtHours(p.registerHours)}</span>
                        </Tooltip>
                      ) : ''}
                    </TableCell>,
                  ])}
                </TableRow>
                <TableRow sx={{ '& td': { borderBottom: 0 } }}>
                  <TableCell sx={{ ...stick(false), fontWeight: 500 }}>
                    Weight total
                  </TableCell>
                  {people.map((p) => {
                    const sum = p.kpiLines.reduce((a, l) => a + l.weight, 0)
                    const ok = Math.abs(sum - 1) < 1e-9
                    return [
                      <TableCell key={`${p.id}-ws`} sx={groupEdge} />,
                      <TableCell key={`${p.id}-wv`} align="right" sx={num}>
                        <StatusPill tone={ok ? 'success' : 'danger'} title={ok ? 'Totals 100%' : 'Must total 100%'}>
                          {fmtPct(sum)}
                        </StatusPill>
                      </TableCell>,
                      <TableCell key={`${p.id}-we`} />,
                    ]
                  })}
                </TableRow>
              </TableBody>
            </Table>
          </ScrollX>
        </Section>
      )}
    </Box>
  )
}
