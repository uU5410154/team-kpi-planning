import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Chip,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { OBJECTIVES, CHART, STATUS } from '../lib/palette.js'
import { fmtHours, fmtPct, fmtRoi, fmtMoneyShort, targetUnit } from '../lib/model.js'

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
 */
export default function Team({ plan }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { people, settings, finance: fin } = plan
  const sym = fin.symbol

  /*
   * What a person's line for this objective says, in the unit that objective
   * is measured in. The three columns mirror the sheet: what they are aiming
   * at, how much of their card it is, and where they stand.
   */
  const cellFor = (p, o) => {
    const line = p.kpiLines.find((l) => l.objective === o.id && !l.custom)
    if (!line) return null
    const kind = line.targetKind
    const target = kind === 'percent' ? fmtRoi((Number(line.target) || 0) / 100)
      : kind === 'hours' ? `${fmtHours(line.target)} ${targetUnit(line, settings.savingBasis, sym)}`
        : kind === 'number' ? `${Number(line.target).toLocaleString()} ${line.unit || ''}`.trim()
          : String(line.target ?? '—')
    const actual = kind === 'percent'
      ? (line.creditedRatio == null ? '—' : fmtRoi(line.creditedRatio))
      : kind === 'hours' ? fmtHours(p.byObjective[o.id] || 0)
        : kind === 'number' ? String(p.countByObjective?.[o.id] ?? 0)
          : (line.creditedHours ? `${fmtHours(line.creditedHours)} hrs` : '—')
    const tone = kind === 'percent' && line.creditedRatio != null
      ? (line.meetsTarget ? STATUS.good : STATUS.critical)
      : 'text.primary'
    return { line, target, actual, tone }
  }

  const cell = { fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box>
        <Typography variant="h2">Overall team</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          Every scorecard side by side — the same grid as the <strong>Overall_Objectives</strong> sheet in the
          export. Each person totals 100% across the objectives they hold.
        </Typography>
      </Box>

      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ '& th, & td': { px: 1.25 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ minWidth: 230, position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 2 }}>
                KPI line
              </TableCell>
              {people.map((p) => (
                <TableCell key={p.id} align="center" colSpan={3} sx={{ borderLeft: 1, borderColor: 'divider' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {p.nick}{p.aggregatesTeam && ' · team'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {fmtHours(p.scorecardHours)} hrs · {p.scorecardCount} proj
                  </Typography>
                </TableCell>
              ))}
            </TableRow>
            <TableRow>
              <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 2 }} />
              {people.map((p) => [
                <TableCell key={`${p.id}-t`} align="right" sx={{ ...cell, borderLeft: 1, borderColor: 'divider' }}>Target</TableCell>,
                <TableCell key={`${p.id}-w`} align="right" sx={cell}>Weight</TableCell>,
                <TableCell key={`${p.id}-a`} align="right" sx={cell}>Now</TableCell>,
              ])}
            </TableRow>
          </TableHead>

          <TableBody>
            {OBJECTIVES.map((o, i) => (
              <TableRow key={o.id} hover>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: CHART[mode].series[i], flexShrink: 0 }} />
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                        Obj {o.no} — {o.name}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {o.measure === 'ratio' ? 'a return, at or above the gate'
                          : o.measure === 'hours' ? 'saving hours a month'
                            : o.measure === 'count' ? `${o.countUnit} delivered`
                              : 'a delivery date'}
                      </Typography>
                    </Box>
                  </Box>
                </TableCell>

                {people.map((p) => {
                  const c = cellFor(p, o)
                  if (!c) {
                    return [
                      <TableCell key={`${p.id}-${o.id}-t`} align="center" colSpan={3}
                        sx={{ ...cell, color: 'text.disabled', borderLeft: 1, borderColor: 'divider' }}>
                        not held
                      </TableCell>,
                    ]
                  }
                  return [
                    <TableCell key={`${p.id}-${o.id}-t`} align="right" sx={{ ...cell, borderLeft: 1, borderColor: 'divider' }}>
                      <Tooltip title={c.line.overridden ? 'Typed over the calculated figure' : 'From the project register'}>
                        <span style={{ fontWeight: c.line.overridden ? 700 : 400 }}>{c.target}</span>
                      </Tooltip>
                    </TableCell>,
                    <TableCell key={`${p.id}-${o.id}-w`} align="right" sx={cell}>
                      {fmtPct(c.line.weight)}
                    </TableCell>,
                    <TableCell key={`${p.id}-${o.id}-a`} align="right" sx={{ ...cell, color: c.tone, fontWeight: 600 }}>
                      {c.actual}
                    </TableCell>,
                  ]
                })}
              </TableRow>
            ))}

            {/* the two totals the sheet carries, for the same reason */}
            <TableRow>
              <TableCell sx={{ borderTop: 2, borderColor: 'divider', fontWeight: 700, position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                TOTAL SAVING HRS/MONTH
              </TableCell>
              {people.map((p) => [
                <TableCell key={`${p.id}-th`} align="right"
                  sx={{ ...cell, borderTop: 2, borderColor: 'divider', fontWeight: 800, borderLeft: 1 }}>
                  {fmtHours(p.kpiTotals.savingHours)}
                </TableCell>,
                <TableCell key={`${p.id}-tw`} sx={{ borderTop: 2, borderColor: 'divider' }} />,
                <TableCell key={`${p.id}-ta`} align="right"
                  sx={{ ...cell, borderTop: 2, borderColor: 'divider', color: 'text.secondary' }}>
                  {Math.abs(p.kpiTotals.savingHours - p.registerHours) > 0.5
                    ? `reg ${fmtHours(p.registerHours)}`
                    : ''}
                </TableCell>,
              ])}
            </TableRow>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                WEIGHT TOTAL — must be 100%
              </TableCell>
              {people.map((p) => {
                const sum = p.kpiLines.reduce((a, l) => a + l.weight, 0)
                const ok = Math.abs(sum - 1) < 1e-9
                return [
                  <TableCell key={`${p.id}-ws`} sx={{ borderLeft: 1, borderColor: 'divider' }} />,
                  <TableCell key={`${p.id}-wv`} align="right" sx={cell}>
                    <Chip
                      size="small"
                      label={fmtPct(sum)}
                      sx={{
                        height: 20,
                        fontWeight: 700,
                        color: ok ? STATUS.good : STATUS.critical,
                        borderColor: ok ? STATUS.good : STATUS.critical,
                      }}
                      variant="outlined"
                    />
                  </TableCell>,
                  <TableCell key={`${p.id}-we`} />,
                ]
              })}
            </TableRow>
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>How to read it</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
          Each objective is measured in its own unit, which is what lets one project answer to several without
          being counted twice. <strong>Obj 2</strong> carries every saving hour in the plan;{' '}
          <strong>Obj 1</strong> is those same hours priced, expressed as a return the plan has to clear;{' '}
          <strong>Obj 4</strong> and <strong>Obj 5</strong> count what was delivered;{' '}
          <strong>Obj 3</strong> is a date. So the saving-hours total below is the hours ONCE — not the sum of
          five rows. Where a figure has been typed over the calculated one it is shown in bold, and where a
          card states something different from the register the register&rsquo;s figure is printed beside the
          total.
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1.5 }}>
          Team total {fmtHours(plan.totals.committedHours)} hrs/month committed ·{' '}
          {fmtMoneyShort(fin.annualBenefit, sym)} a year · gate {fmtRoi(fin.roiGate)}
        </Typography>
      </Paper>
    </Box>
  )
}
