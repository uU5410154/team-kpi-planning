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

  const setBand = (band, key, value) => {
    const b = { ...settings.bands[band], [key]: value }
    // Keep the three blocks summing to 1.0 by absorbing the delta into delivery,
    // so a scorecard can never drift off 100%.
    const others = ['corporate', 'delivery', 'people'].filter((k) => k !== key)
    const rest = 1 - value
    const restSum = others.reduce((a, k) => a + settings.bands[band][k], 0) || 1
    others.forEach((k) => { b[k] = (settings.bands[band][k] / restSum) * rest })
    onSettings({ bands: { ...settings.bands, [band]: b } })
  }

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
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card
            title="Scorecard weight bands"
            subtitle="Each band's three blocks always total 100%. Move one and the others re-proportion automatically."
          >
            {BANDS.map((b) => {
              const v = settings.bands[b.id]
              const sum = v.corporate + v.delivery + v.people
              return (
                <Box key={b.id} sx={{ mb: 3 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>{b.label}</Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={Math.abs(sum - 1) < 0.001 ? 'success' : 'error'}
                      label={`Σ ${fmtPct(sum)}`}
                    />
                  </Box>
                  {[
                    ['corporate', 'Corporate KPI'],
                    ['delivery', 'Delivery (held objectives)'],
                    ['people', 'Capability / people'],
                  ].map(([k, label]) => (
                    <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 0.5 }}>
                      <Typography variant="caption" sx={{ width: 170, color: 'text.secondary' }}>{label}</Typography>
                      <Slider
                        size="small"
                        value={v[k]}
                        min={0}
                        max={0.8}
                        step={0.05}
                        onChange={(_e, val) => setBand(b.id, k, val)}
                        sx={{ flex: 1 }}
                      />
                      <Typography variant="caption" sx={{ width: 42, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {fmtPct(v[k])}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )
            })}
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
