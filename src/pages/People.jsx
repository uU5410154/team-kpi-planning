import { useState } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow,
  Grid, Chip, Tabs, Tab, Alert, Divider, Tooltip,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import StatTile from '../components/StatTile.jsx'
import { OBJ_BY_ID, OBJECTIVES, CHART, STATUS } from '../lib/palette.js'
import { fmtHours, fmtPct, fmtRatio } from '../lib/model.js'
import { useTheme } from '@mui/material/styles'

const BAND_LABEL = { lead: 'Team Lead', senior: 'Senior', analyst: 'Analyst' }

export default function People({ plan }) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const { people, settings, totals } = plan
  const [who, setWho] = useState(people[0]?.id)
  const p = people.find((x) => x.id === who) || people[0]
  if (!p) return null

  const weightSum = p.kpiLines.reduce((a, l) => a + l.weight, 0)
  const weightOk = Math.abs(weightSum - 1) < 0.0005
  const shareOfTeam = totals.headlineHours > 0 ? p.hours / totals.headlineHours : 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Paper variant="outlined">
        <Tabs
          value={who}
          onChange={(_e, v) => setWho(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1, '& .MuiTab-root': { textTransform: 'none', fontWeight: 600, minHeight: 56 } }}
        >
          {people.map((x) => (
            <Tab
              key={x.id}
              value={x.id}
              label={
                <Box sx={{ textAlign: 'left' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{x.nick}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {fmtHours(x.hours)} hrs · {x.countedCount} proj
                  </Typography>
                </Box>
              }
            />
          ))}
        </Tabs>
      </Paper>

      <Box>
        <Typography variant="h2">{p.name}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {p.nick} · {BAND_LABEL[p.band]} · holds{' '}
          {p.objectives.length
            ? p.objectives.map((o) => `Objective ${OBJ_BY_ID[o]?.no}`).join(', ')
            : 'no objectives yet'}
        </Typography>
      </Box>

      <Grid container spacing={2}>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Credited saving hours"
            value={fmtHours(p.hours)}
            unit="hrs"
            context={`${fmtPct(shareOfTeam)} of the team commitment`}
            help="Project hours multiplied by this person's contribution share. Shares on a project always sum to 100%, so no hour is credited twice."
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Efficiency ratio"
            value={fmtRatio(p.ratio)}
            unit="hrs / manday"
            tone={p.ratio == null ? undefined : p.ratio >= settings.ratioGate ? 'good' : 'critical'}
            context={`Gate ${settings.ratioGate.toFixed(1)} · ${fmtHours(p.manday)} mandays credited`}
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Projects"
            value={p.countedCount}
            unit={`of ${p.projectCount}`}
            context="Counted (commit + stretch) of all projects they touch"
          />
        </Grid>
        <Grid item xs={6} md={3}>
          <StatTile
            label="Missing saving hours"
            value={p.missingSaving}
            unit="projects"
            tone={p.missingSaving > 5 ? 'critical' : p.missingSaving > 0 ? 'warning' : 'good'}
            context={p.missingSaving ? 'Cannot be committed until quantified' : 'Fully quantified'}
          />
        </Grid>
      </Grid>

      {p.hours === 0 && (
        <Alert severity="warning" variant="outlined">
          {p.nick} carries no quantified saving hours. A saving-hours KPI would be meaningless here — either transfer
          quantified work to them on the Projects tab, or lean their scorecard on the capability and milestone lines below.
        </Alert>
      )}

      <Grid container spacing={2.5}>
        {/* ---------- weight table ---------- */}
        <Grid item xs={12} md={5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h4">2026 KPI weights</Typography>
              <Chip
                size="small"
                icon={weightOk ? <CheckCircleIcon /> : <WarningAmberIcon />}
                color={weightOk ? 'success' : 'error'}
                variant="outlined"
                label={`Total ${fmtPct(weightSum)}`}
              />
            </Box>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Block</TableCell>
                  <TableCell>KPI line</TableCell>
                  <TableCell align="right">Weight</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {p.kpiLines.map((l) => {
                  const o = l.objective ? OBJ_BY_ID[l.objective] : null
                  const idx = o ? OBJECTIVES.findIndex((x) => x.id === o.id) : -1
                  return (
                    <TableRow key={l.id} hover>
                      <TableCell>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                          {l.block}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {idx >= 0 && (
                            <Box sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: CHART[mode].series[idx], flexShrink: 0 }} />
                          )}
                          <Box>
                            <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.35 }}>
                              {o ? `Obj ${o.no} — ${o.name}` : l.label}
                            </Typography>
                            {o && (
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                Target {o.target} · {fmtHours(p.byObjective[o.id] || 0)} hrs credited
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtPct(l.weight)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            <Divider sx={{ my: 2 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Weights are derived from the <strong>{BAND_LABEL[p.band]}</strong> band
              ({fmtPct(settings.bands[p.band].corporate)} corporate / {fmtPct(settings.bands[p.band].delivery)} delivery /{' '}
              {fmtPct(settings.bands[p.band].people)} capability) and split across the objectives actually held. Change
              the band split on the Model tab.
            </Typography>
          </Paper>
        </Grid>

        {/* ---------- portfolio ---------- */}
        <Grid item xs={12} md={7}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h4" sx={{ mb: 0.5 }}>Project portfolio</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 2 }}>
              Contribution % is this person's normalised share of the project. Credited hours = project hours × share.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Jira</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell>Role</TableCell>
                  <TableCell align="right">Share</TableCell>
                  <TableCell align="right">Project hrs</TableCell>
                  <TableCell align="right">Credited</TableCell>
                  <TableCell>Level</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {p.rows
                  .slice()
                  .sort((a, b) => (b.p.savingHours ?? 0) * b.share - (a.p.savingHours ?? 0) * a.share)
                  .map(({ p: pr, share }) => {
                    const roles =
                      pr.contributors?.find((c) => c.person === p.id)?.roles.join('/') ||
                      (pr.pic === p.id ? 'pic' : '—')
                    const credited = (pr.savingHours ?? 0) * share
                    const counted = pr.commitLevel === 'commit' || pr.commitLevel === 'stretch'
                    return (
                      <TableRow key={pr.key} hover sx={{ opacity: counted ? 1 : 0.5 }}>
                        <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{pr.key}</TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ lineHeight: 1.3 }}>{pr.summary}</Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Obj {OBJ_BY_ID[pr.objective]?.no} · {pr.srcStatus || pr.status}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{roles}</Typography>
                        </TableCell>
                        <TableCell align="right">{fmtPct(share)}</TableCell>
                        <TableCell align="right">
                          {pr.savingHours == null ? (
                            <Tooltip title="Not quantified in Jira">
                              <WarningAmberIcon sx={{ fontSize: 15, color: STATUS.warning }} />
                            </Tooltip>
                          ) : fmtHours(pr.savingHours)}
                        </TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {pr.savingHours == null ? '—' : fmtHours(credited)}
                        </TableCell>
                        <TableCell>
                          <Typography variant="caption" sx={{ textTransform: 'capitalize', color: 'text.secondary' }}>
                            {pr.commitLevel}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )
                  })}
              </TableBody>
            </Table>
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}
