import { useEffect, useRef, useState } from 'react'
import {
  Box, Typography, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, TextField, MenuItem, useMediaQuery,
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
  /*
   * On a phone there is no room for people side by side: three figures each
   * for six people is eighteen columns. It shows one person at a time, picked
   * above a four-column table, with the same rows and totals.
   */
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
  const [pickedId, setPickedId] = useState(null)
  const picked = people.find((p) => p.id === pickedId) || people[0]
  const shown = phone && picked ? [picked] : people
  const summary = (p) => `${fmtHours(p.scorecardHours)} hrs, ${p.scorecardCount} project${p.scorecardCount === 1 ? '' : 's'}`

  const title = own ? 'My scorecard' : 'Overall team'
  const description = own
    ? 'Your 2026 targets, the weight of each on your card, and where each stands now.'
    : 'Every scorecard side by side, the same grid as the Overall objectives sheet in the export.'

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
  // A hairline between one person's three columns and the next person's. One
  // person on a phone needs no such divider.
  const groupEdge = phone ? {} : { borderLeft: 1, borderLeftColor: 'border.subtle' }
  /*
   * The pinned first column, with a hairline where the scrolling part begins
   * that deepens once something is sliding under it. On a phone nothing
   * scrolls: the column takes whatever the three figures leave, and wraps.
   */
  const stick = (head) => (phone ? { overflowWrap: 'anywhere' } : {
    position: 'sticky',
    left: 0,
    zIndex: head ? 3 : 1,
    bgcolor: head ? 'bg.subtle' : 'bg.surface',
    minWidth: 248,
    maxWidth: 280,
    width: 264,
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
          // A member's phone shows their one card with no person header, so
          // what it adds up to moves up here.
          meta={own ? (phone && picked ? summary(picked) : null) : teamMeta}
          padded={false}
          // One person's card reads as a compact table, not one stretched across the screen.
          sx={own ? { maxWidth: 880 } : undefined}
        >
          {phone && !own && people.length > 1 && (
            <Box sx={{ px: 3, pt: 3, pb: 1 }}>
              <TextField
                select
                fullWidth
                size="small"
                label="Person"
                value={picked.id}
                onChange={(e) => setPickedId(e.target.value)}
                helperText={summary(picked)}
                SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 360 } } } }}
              >
                {people.map((p) => (
                  <MenuItem key={p.id} value={p.id} sx={{ minHeight: 44 }}>
                    {p.nick}{p.aggregatesTeam && ' (team)'}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}
          <ScrollX label={own ? 'My scorecard' : phone ? `Scorecard for ${picked?.nick || ''}` : 'Every scorecard, scroll sideways for more people'}>
            <Table
              size="small"
              sx={{
                minWidth: own && !phone ? 560 : undefined,
                '& td, & th': { px: { xs: 2, sm: 3 } },
                '& tbody td': { height: phone ? 48 : 52, verticalAlign: 'middle' },
              }}
            >
              <TableHead>
                {phone ? (
                  // One person: their name is in the picker (or it is your own
                  // card), so the head is the four columns alone.
                  <TableRow>
                    <TableCell sx={stick(true)}>KPI line</TableCell>
                    <TableCell align="right" sx={{ width: '1%', whiteSpace: 'nowrap' }}>Target</TableCell>
                    <TableCell align="right" sx={{ width: '1%', whiteSpace: 'nowrap' }}>Weight</TableCell>
                    <TableCell align="right" sx={{ width: '1%', whiteSpace: 'nowrap' }}>Now</TableCell>
                  </TableRow>
                ) : (
                  <>
                    <TableRow>
                      {/* One cell over both header rows, so the pinned column
                          never shows an empty second "KPI line" header. */}
                      <TableCell rowSpan={2} sx={{ ...stick(true), verticalAlign: 'bottom' }}>
                        KPI line
                      </TableCell>
                      {shown.map((p) => (
                        <TableCell key={p.id} colSpan={3} sx={{ ...groupEdge, pt: 2, pb: 1, height: 'auto' }}>
                          <Typography variant="h3" component="div" sx={{ color: 'text.primary', whiteSpace: 'nowrap' }}>
                            {p.nick}{p.aggregatesTeam && ' (team)'}
                          </Typography>
                          <Typography variant="caption" component="div" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                            {summary(p)}
                          </Typography>
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow>
                      {shown.map((p) => [
                        <TableCell key={`${p.id}-t`} align="right" sx={{ ...groupEdge, minWidth: 96 }}>Target</TableCell>,
                        <TableCell key={`${p.id}-w`} align="right" sx={{ minWidth: 64 }}>Weight</TableCell>,
                        <TableCell key={`${p.id}-a`} align="right" sx={{ minWidth: 72 }}>Now</TableCell>,
                      ])}
                    </TableRow>
                  </>
                )}
              </TableHead>

              <TableBody>
                {OBJECTIVES.map((o, i) => (
                  // No hover tint on a phone: a tap leaves it stuck on the row.
                  <TableRow key={o.id} hover={!phone}>
                    <TableCell sx={stick(false)}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                        <Box
                          aria-hidden
                          sx={{
                            width: 8, height: 8, borderRadius: '2px', mt: phone ? '5px' : '6px', bgcolor: CHART[mode].series[i], flexShrink: 0,
                          }}
                        />
                        <Box sx={{ minWidth: 0 }}>
                          {phone ? (
                            // A narrow column: the number on its own line, so
                            // the name does not break after a dangling dash.
                            <>
                              <Typography variant="body2" sx={{ color: 'text.secondary' }}>Obj {o.no}</Typography>
                              <Typography variant="body1" sx={{ fontWeight: 500 }}>{o.name}</Typography>
                            </>
                          ) : (
                            <Typography variant="body1" sx={{ fontWeight: 500 }}>
                              Obj {o.no} — {o.name}
                            </Typography>
                          )}
                          <Typography variant="body2" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
                            {o.measure === 'ratio' ? 'Share of projects that drifted'
                              : o.measure === 'hours' ? `Saving ${settings.savingBasis === 'annual' ? 'hours a year' : 'hours a month'}`
                                : o.measure === 'count' ? countLabel(o.countUnit)
                                  : 'A delivery date'}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>

                    {shown.map((p) => {
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
                  {shown.map((p) => [
                    <TableCell key={`${p.id}-th`} align="right" sx={{ ...groupEdge, ...num, fontWeight: 600 }}>
                      {fmtHours(p.kpiTotals.savingHours)}
                    </TableCell>,
                    <TableCell key={`${p.id}-tw`} />,
                    // On a phone the note may take two lines rather than widen the column.
                    <TableCell key={`${p.id}-ta`} align="right" sx={{ ...num, color: 'text.secondary', ...(phone && { whiteSpace: 'normal' }) }}>
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
                  {shown.map((p) => {
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
