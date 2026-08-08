import {
  Box, Paper, Typography, Grid, TextField, Slider, Table, TableBody, TableCell,
  TableHead, TableRow, Select, MenuItem, Divider, Alert, FormControlLabel, Switch, Chip,
} from '@mui/material'
import { OBJECTIVES } from '../lib/palette.js'
import { ROLE_ORDER, fmtPct, fmtHours, paybackMonths, SAVING_BASIS } from '../lib/model.js'

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
  const { settings, people, totals } = plan

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
              Efficiency gate — {settings.ratioGate.toFixed(1)} saving hours per manday
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
              A project must return at least this many saving hours for each manday invested. On the{' '}
              <strong>{SAVING_BASIS[settings.savingBasis].label.toLowerCase()}</strong> basis that is a payback of{' '}
              <strong>
                {(() => {
                  const m = paybackMonths(settings.ratioGate, settings.savingBasis)
                  return m == null ? '—' : m < 24 ? `${m.toFixed(1)} months` : `${(m / 12).toFixed(1)} years`
                })()}
              </strong>{' '}
              on the build effort. Raise it to demand a faster payback.
            </Typography>
            <Slider
              value={settings.ratioGate}
              min={0.5}
              max={40}
              step={0.5}
              marks={[{ value: 4, label: '4' }, { value: 8, label: '8' }, { value: 20, label: '20' }, { value: 40, label: '40' }]}
              valueLabelDisplay="auto"
              onChange={(_e, v) => onSettings({ ratioGate: v })}
            />
            <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
              <Chip size="small" variant="outlined" label={`Team ratio ${totals.teamRatio == null ? '—' : totals.teamRatio.toFixed(1)}`} />
              <Chip size="small" variant="outlined" color={totals.failingGate ? 'error' : 'success'} label={`${totals.failingGate} project(s) below the gate`} />
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
