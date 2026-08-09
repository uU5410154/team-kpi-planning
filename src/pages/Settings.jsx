import {
  Box, Paper, Typography, Grid, TextField, Slider, Table, TableBody, TableCell,
  TableHead, TableRow, Select, MenuItem, Divider, Alert, FormControlLabel, Switch, Chip,
  InputAdornment,
} from '@mui/material'
import { OBJECTIVES } from '../lib/palette.js'
import {
  ROLE_ORDER, fmtPct, fmtHours, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths,
  gateAsHoursPerManday, gateAsPaybackMonths, SAVING_BASIS,
} from '../lib/model.js'

const BANDS = [
  { id: 'lead', label: 'Team Lead' },
  { id: 'senior', label: 'Senior' },
  { id: 'analyst', label: 'Analyst' },
]

function Card({ title, subtitle, children }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Typography variant="h4">{title}</Typography>
      {subtitle && (
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 2 }}>
          {subtitle}
        </Typography>
      )}
      {children}
    </Paper>
  )
}

export default function Settings({ plan, state, onSettings, onPerson, scenarioName, onScenarioName }) {
  const { settings, people, totals, finance: fin } = plan
  const sym = fin.symbol

  const setFinance = (patch) => onSettings({ finance: { ...settings.finance, ...patch } })
  const money = (label, key, help) => (
    <Box sx={{ mb: 2 }}>
      <TextField
        fullWidth
        size="small"
        type="number"
        label={label}
        value={settings.finance[key]}
        onChange={(e) => setFinance({ [key]: Math.max(0, Number(e.target.value) || 0) })}
        InputProps={{ startAdornment: <InputAdornment position="start">{sym}</InputAdornment> }}
        inputProps={{ step: 1000, min: 0 }}
      />
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
        {help}
      </Typography>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Alert severity="info" variant="outlined">
        These settings drive every number on the Dashboard, the Scorecards and the Excel export. Nothing here is stored
        on a server — it lives in this browser and in the scenario files you save.
      </Alert>

      <Grid container spacing={2.5}>
        <Grid item xs={12} md={6}>
          <Card title="Targets and the efficiency gate" subtitle="Objective 2 sets the pool; Objective 1 sets the gate applied across it">
            <TextField
              fullWidth
              size="small"
              label="Scenario name"
              value={scenarioName}
              onChange={(e) => onScenarioName(e.target.value)}
              sx={{ mb: 2.5 }}
            />
            <TextField
              fullWidth
              size="small"
              type="number"
              label="Management target — saving hours"
              value={settings.targetHours}
              onChange={(e) => onSettings({ targetHours: Math.max(0, Number(e.target.value) || 0) })}
              sx={{ mb: 3 }}
            />

            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Saving-hours basis
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              Jira does not label its <em>Saving Hours</em> column. The 2025 workbook counted hours <strong>per month</strong>;
              the 2026 target of 3,000 is unlabelled. The choice changes the economics twelvefold — confirm it with
              management before the gate is signed off.
            </Typography>
            <Select
              fullWidth
              size="small"
              value={settings.savingBasis}
              onChange={(e) => onSettings({ savingBasis: e.target.value })}
              sx={{ mb: 3 }}
            >
              {Object.values(SAVING_BASIS).map((b) => (
                <MenuItem key={b.id} value={b.id}>
                  {b.label} — each project's saving hours are {b.id === 'annual' ? 'an annual' : 'a monthly'} figure
                </MenuItem>
              ))}
            </Select>

            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Objective 1 gate — {fmtRoi(fin.roiGate)} return within {fin.horizonMonths} months
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              A project must return at least this much on top of what it cost to build, inside the horizon. That is a
              payback of <strong>{fmtMonths(gateAsPaybackMonths(fin))}</strong>, which at the rates below is{' '}
              <strong>{gateAsHoursPerManday(fin)?.toFixed(2) ?? '—'} saving hours per manday</strong> — the same
              standard as the 4.0 hrs/manday gate this replaced. Change a salary and this equivalence moves with it.
            </Typography>
            <Slider
              value={fin.roiGate}
              min={0}
              max={5}
              step={0.25}
              marks={[{ value: 0, label: '0%' }, { value: 1, label: '100%' }, { value: 2, label: '200%' }, { value: 5, label: '500%' }]}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => fmtRoi(v)}
              onChange={(_e, v) => setFinance({ roiGate: v })}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={`Portfolio ROI ${fmtRoi(fin.roi)}`} />
              <Chip
                size="small"
                variant="outlined"
                color={totals.failingGate ? 'error' : 'success'}
                label={`${totals.failingGate} project(s) below the gate`}
              />
              {fin.uncostedCount > 0 && (
                <Chip size="small" variant="outlined" color="warning" label={`${fin.uncostedCount} without an effort estimate`} />
              )}
            </Box>

            <Divider sx={{ my: 2.5 }} />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.includeStretchInHeadline}
                  onChange={(e) => onSettings({ includeStretchInHeadline: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Count stretch projects in the headline</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Off is the conservative posture — commit to what is bankable, show stretch as upside.
                  </Typography>
                </Box>
              }
            />
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card
            title="Objective 1 — what an hour is worth"
            subtitle="Two salaries drive every money figure in the app. A manday of build becomes a cost; an hour handed back to an accountant becomes a benefit."
          >
            {money(
              'Developer — monthly salary',
              'devMonthlySalary',
              `The person who BUILDS the automation. Becomes ${fmtMoney(fin.devDayRate, sym)} per manday at ${fin.daysPerFteMonth.toFixed(2)} working days a month.`,
            )}
            {money(
              'Accountant — monthly salary',
              'acctMonthlySalary',
              `The person whose manual hours are handed back. Becomes ${fmtMoney(fin.acctHourRate, sym)} per saved hour at the FTE ratio of ${fin.hoursPerFteMonth} hours a month, set below.`,
            )}

            <Box sx={{ p: 1.75, bgcolor: 'action.hover', borderRadius: 1, mb: 2.5 }}>
              <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, mb: 0.5 }}>
                What the book is worth at these rates
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {fmtHours(totals.totalHours)} hrs/month ÷ {fin.hoursPerFteMonth} ={' '}
                <strong>{fin.fteReleased.toFixed(1)} FTE</strong> released ·{' '}
                <strong>{fmtMoneyShort(fin.monthlyBenefit, sym)}/month</strong> ·{' '}
                <strong>{fmtMoneyShort(fin.annualBenefit, sym)}/year</strong>
                <br />
                The source workbook's own FTE column sums to <strong>{totals.totalHC.toFixed(1)}</strong>.{' '}
                {fin.hoursPerFteMonth === 176
                  ? `At the workbook's own ratio of 176 that is the same division, project by project; the ${Math.abs(fin.fteReleased - totals.totalHC).toFixed(1)} difference is rounding alone — the workbook rounds each row to one decimal before adding them up.`
                  : `That column was built at the workbook's ratio of 176 hours; you are dividing by ${fin.hoursPerFteMonth}, so this app and the source will not agree until you put it back.`}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
                This is the value of capacity released, not cash removed from the payroll. Treating it as a headcount
                reduction is a separate management decision.
              </Typography>
            </Box>

            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Benefit horizon — {fin.horizonMonths} months
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              How long a delivered automation is credited with paying back. ROI, net benefit and the gate are all
              stated over this window.
            </Typography>
            <Slider
              value={fin.horizonMonths}
              min={6}
              max={60}
              step={6}
              marks={[{ value: 12, label: '1y' }, { value: 36, label: '3y' }, { value: 60, label: '5y' }]}
              valueLabelDisplay="auto"
              onChange={(_e, v) => setFinance({ horizonMonths: v })}
            />

            <Divider sx={{ my: 2.5 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Conversion assumptions — the FTE ratio
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              <strong>Hours per FTE / month</strong> is the FTE ratio, and it does two jobs at once. It turns saving
              hours into <strong>FTE released</strong>, and it divides the accountant's monthly salary into the{' '}
              <strong>hourly rate</strong> behind every baht figure in the app — so changing it moves both. The default
              of <strong>176</strong> is the source workbook's own divisor: it computes its FTE column as{' '}
              <code>saving hrs ÷ (22 × 8)</code>, 22 working days of 8 hours.
            </Typography>
            <Grid container spacing={1.5}>
              <Grid item xs={4}>
                <TextField
                  fullWidth size="small" type="number" label="Hours per FTE / month"
                  value={settings.finance.hoursPerFteMonth}
                  onChange={(e) => setFinance({ hoursPerFteMonth: Math.max(1, Number(e.target.value) || 1) })}
                  inputProps={{ step: 0.1, min: 1 }}
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  fullWidth size="small" type="number" label="Hrs / manday"
                  value={settings.finance.hoursPerManday}
                  onChange={(e) => setFinance({ hoursPerManday: Math.max(1, Number(e.target.value) || 1) })}
                  inputProps={{ step: 0.5, min: 1 }}
                />
              </Grid>
              <Grid item xs={4}>
                <TextField
                  fullWidth size="small" type="number" label="On-cost ×"
                  value={settings.finance.loadFactor}
                  onChange={(e) => setFinance({ loadFactor: Math.max(0.1, Number(e.target.value) || 1) })}
                  inputProps={{ step: 0.05, min: 0.1 }}
                />
              </Grid>
            </Grid>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.25 }}>
              Working days a month is <strong>derived</strong> ({fin.hoursPerFteMonth} ÷ {fin.hoursPerManday} ={' '}
              {fin.daysPerFteMonth.toFixed(2)}), so a manday of cost and an hour of benefit are always quoted against
              the same month. On-cost covers social security, bonus and benefits — it multiplies both rates, so it
              moves every baht figure and leaves every ROI <strong>exactly unchanged</strong>.
            </Typography>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card
            title="Contribution weights by role"
            subtitle="Raw weights from the Jira role labels. On each project they are normalised to sum to 100%, so a project's hours are never banked twice."
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Jira role label</TableCell>
                  <TableCell align="right">Raw weight</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ROLE_ORDER.map((r) => (
                  <TableRow key={r} hover>
                    <TableCell sx={{ fontWeight: 500 }}>
                      {r === 'assignee' ? 'assignee (no explicit role)' : `${r}-<name>`}
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        variant="standard"
                        type="number"
                        value={settings.roleWeights[r] ?? 0}
                        onChange={(e) =>
                          onSettings({
                            roleWeights: { ...settings.roleWeights, [r]: Math.max(0, Number(e.target.value) || 0) },
                          })
                        }
                        inputProps={{ step: 0.05, min: 0, style: { textAlign: 'right', width: 70, fontVariantNumeric: 'tabular-nums' } }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 2 }}>
              A person holding two roles on one project counts once, at their strongest role — holding both{' '}
              <code>pm</code> and <code>dev</code> does not double the claim.
            </Typography>

            <Divider sx={{ my: 2.5 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              Who absorbs unowned saving hours
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              Projects owned by a partner team such as <strong>IT</strong>, or left unassigned, still deliver saving
              hours. They are credited to the person accountable for the team's overall KPI rather than being lost.
            </Typography>
            <Select
              fullWidth
              size="small"
              value={settings.fallbackPic || ''}
              onChange={(e) => onSettings({ fallbackPic: e.target.value || null })}
              displayEmpty
            >
              <MenuItem value=""><em>Nobody — leave them uncredited</em></MenuItem>
              {people.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.nick} — {p.name} ({p.role})</MenuItem>
              ))}
            </Select>
            {totals.fallbackHours > 0 && (
              <Typography variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 600 }}>
                Currently absorbing {fmtHours(totals.fallbackHours)} hrs across {totals.fallbackCount} project
                {totals.fallbackCount === 1 ? '' : 's'}.
              </Typography>
            )}

            <Divider sx={{ my: 2.5 }} />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.creditPartners}
                  onChange={(e) => onSettings({ creditPartners: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Let partner devs dilute the team's share (net view)
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    35 projects are built partly or wholly by partner and outsource devs
                    (tao, buzz, fah, luem, fia, central-it, finance-it).
                  </Typography>
                </Box>
              }
            />
            <Box sx={{ mt: 2, p: 1.75, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                <strong>Off (gross)</strong> — the six owners are credited the whole project. Right if the 3,000 hr
                target holds the team accountable for hours delivered, whoever writes the code.
                <br />
                <strong>On (net)</strong> — partner devs enter the denominator, so the six can only bank their own
                share. Right if each person is scored on personal contribution.
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 1.25, fontWeight: 600 }}>
                Currently bankable by the six: {fmtHours(totals.bankableHours)} hrs ={' '}
                {fmtPct(totals.bankableCoverage)} of target
                {totals.partnerHours > 0 && ` · ${fmtHours(totals.partnerHours)} hrs sit with partners`}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: 'text.secondary' }}>
                The two readings differ by roughly 1,050 hrs. Settle which one management intends before any
                individual target is signed.
              </Typography>
            </Box>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card
            title="Objective emphasis"
            subtitle="Relative weight inside the delivery block. Normalised across whichever objectives a person actually holds."
          >
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Objective</TableCell>
                  <TableCell align="right">Priority</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {OBJECTIVES.map((o) => (
                  <TableRow key={o.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{o.no}. {o.name}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {o.target}{o.countsToPool ? '' : ' · date-gated, no hour credit'}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <TextField
                        size="small"
                        variant="standard"
                        type="number"
                        value={settings.objectivePriority[o.id] ?? 1}
                        onChange={(e) =>
                          onSettings({
                            objectivePriority: {
                              ...settings.objectivePriority,
                              [o.id]: Math.max(0, Number(e.target.value) || 0),
                            },
                          })
                        }
                        inputProps={{ step: 0.5, min: 0, style: { textAlign: 'right', width: 70, fontVariantNumeric: 'tabular-nums' } }}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <Divider sx={{ my: 2.5 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5 }}>Team roster and bands</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Person</TableCell>
                  <TableCell>Band</TableCell>
                  <TableCell align="right">Credited hrs</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {people.map((p) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{p.nick}</Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{p.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        variant="standard"
                        value={p.band}
                        onChange={(e) => onPerson(p.id, { band: e.target.value })}
                        sx={{ fontSize: '0.8125rem' }}
                      >
                        {BANDS.map((b) => <MenuItem key={b.id} value={b.id}>{b.label}</MenuItem>)}
                      </Select>
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtHours(p.hours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </Grid>
      </Grid>
    </Box>
  )
}
