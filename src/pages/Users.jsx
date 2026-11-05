import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Table, TableBody, TableCell, TableHead, TableRow, Select, MenuItem,
  Chip, Button, Alert, IconButton, Tooltip, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import { STATUS } from '../lib/palette.js'
import * as auth from '../lib/authApi.js'
import * as api from '../lib/api.js'
import { defaultSubmitters } from '../lib/weekly.js'
import MailSettings from '../components/MailSettings.jsx'
import AiSettings from '../components/AiSettings.jsx'

const ROLE_LABEL = { admin: 'Administrator', user: 'Team member' }
const STATUS_TONE = { active: STATUS.good, pending: STATUS.warning, inactive: 'text.disabled' }

/**
 * Who may open this app, and what each of them can see.
 *
 * Registering puts somebody in this list and nowhere else. Everything that
 * follows — the role, whether the account works at all — is decided here, by a
 * person, which is the point: a work address proves employment, not that
 * somebody should see what their colleagues are appraised on.
 */
export default function Users({ me, people = [] }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [shown, setShown] = useState(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [reset, setReset] = useState(null)

  /*
   * The team, as the weekly check-in knows it: the people who hold a
   * scorecard. IT and the business users are assignable in the register but
   * are not anybody's login.
   */
  const team = people.filter((p) => defaultSubmitters([p]).length)
  const [weekly, setWeekly] = useState(null)

  const load = useCallback(async () => {
    try {
      const [users, ws] = await Promise.all([auth.listUsers(), api.weeklySettings().catch(() => null)])
      setRows(users)
      setWeekly(ws)
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const toggleSubmitter = async (id) => {
    if (!weekly) return
    const next = weekly.submitters.includes(id)
      ? weekly.submitters.filter((x) => x !== id)
      : [...weekly.submitters, id]
    setBusy(`weekly:${id}`)
    try {
      setWeekly({ ...weekly, ...(await api.saveWeeklySettings(next)) })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => { load() }, [load])

  const patch = async (email, body) => {
    setBusy(email)
    setError(null)
    try {
      await auth.updateUser(email, body)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const pending = (rows || []).filter((u) => u.status === 'pending')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 300 }}>
          <Typography variant="h2">People with access</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            Registering adds somebody here and does nothing else. You decide whether the account works and what it can
            see: a <strong>team member</strong> gets their weekly check-in, the overall team, the timeline and the apps;
            an <strong>administrator</strong> gets everything, including the register, the scorecards and this page.
            Link each account to the person it is so the weekly check-in knows whose week to open.
          </Typography>
        </Box>
        <Button startIcon={<RefreshIcon />} onClick={load} variant="outlined">Refresh</Button>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {pending.length > 0 && (
        <Alert severity="warning">
          {pending.length} account{pending.length === 1 ? '' : 's'} waiting to be approved:{' '}
          <strong>{pending.map((u) => u.email).join(', ')}</strong>. They cannot sign in until you switch them on.
        </Alert>
      )}

      {/* Scrolls sideways on a phone rather than widening the whole page. */}
      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ minWidth: 1060 }}>
          <TableHead>
            <TableRow>
              <TableCell>Email</TableCell>
              <TableCell sx={{ width: 160 }}>Is</TableCell>
              <TableCell sx={{ width: 170 }}>Role</TableCell>
              <TableCell sx={{ width: 150 }}>Status</TableCell>
              <TableCell sx={{ width: 190 }}>Password</TableCell>
              <TableCell sx={{ width: 160 }}>Registered</TableCell>
              <TableCell sx={{ width: 160 }}>Last signed in</TableCell>
              <TableCell sx={{ width: 52 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {(rows || []).map((u) => {
              const isMe = u.email === me?.email
              return (
                <TableRow key={u.email} hover>
                  <TableCell sx={{ fontWeight: isMe ? 700 : 500 }}>
                    {u.email}
                    {isMe && <Chip size="small" label="you" sx={{ ml: 1, height: 18, fontSize: '0.65rem' }} />}
                  </TableCell>
                  <TableCell>
                    {/*
                      * Which person on the team this login is. The weekly
                      * check-in needs it to know whose week to open, and the
                      * reminders will need it to know whom to chase.
                      */}
                    <Select
                      size="small"
                      fullWidth
                      displayEmpty
                      value={u.person || ''}
                      disabled={busy === u.email}
                      onChange={(e) => patch(u.email, { person: e.target.value || null })}
                      sx={{ fontSize: '0.8125rem', color: u.person ? 'text.primary' : 'text.disabled' }}
                      SelectDisplayProps={{ 'aria-label': `team member for ${u.email}` }}
                    >
                      <MenuItem value=""><em>not linked</em></MenuItem>
                      {team.map((p) => {
                        const taken = (rows || []).find((x) => x.person === p.id && x.email !== u.email)
                        return (
                          <MenuItem key={p.id} value={p.id} disabled={!!taken}>
                            {p.nick}{taken ? ` (${taken.email.split('@')[0]})` : ''}
                          </MenuItem>
                        )
                      })}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      fullWidth
                      value={u.role}
                      disabled={busy === u.email}
                      onChange={(e) => patch(u.email, { role: e.target.value })}
                      sx={{ fontSize: '0.8125rem' }}
                    >
                      {Object.entries(ROLE_LABEL).map(([id, label]) => (
                        <MenuItem key={id} value={id}>{label}</MenuItem>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      size="small"
                      fullWidth
                      value={u.status}
                      disabled={busy === u.email}
                      onChange={(e) => patch(u.email, { status: e.target.value })}
                      sx={{ fontSize: '0.8125rem', color: STATUS_TONE[u.status] }}
                    >
                      <MenuItem value="pending">Waiting</MenuItem>
                      <MenuItem value="active">Active</MenuItem>
                      <MenuItem value="inactive">Switched off</MenuItem>
                    </Select>
                  </TableCell>
                  <TableCell>
                    {/*
                      * Hidden until asked for. It is on screen for whoever
                      * walks past otherwise, and this is the one screen in the
                      * app where that matters.
                      */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box
                        component="span"
                        sx={{
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          color: u.password ? 'text.primary' : 'text.disabled',
                        }}
                      >
                        {shown.has(u.email)
                          ? (u.password || 'cannot be read')
                          : '••••••••'}
                      </Box>
                      <IconButton
                        size="small"
                        onClick={() => setShown((s) => {
                          const n = new Set(s)
                          if (n.has(u.email)) n.delete(u.email); else n.add(u.email)
                          return n
                        })}
                        aria-label={`show password for ${u.email}`}
                      >
                        {shown.has(u.email)
                          ? <VisibilityOffIcon sx={{ fontSize: 16 }} />
                          : <VisibilityIcon sx={{ fontSize: 16 }} />}
                      </IconButton>
                      <Tooltip title="Set a new password for this account">
                        <Button
                          size="small"
                          sx={{ minWidth: 0, px: 0.5, fontSize: '0.65rem' }}
                          onClick={() => setReset({ email: u.email, value: '' })}
                        >
                          set
                        </Button>
                      </Tooltip>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'never'}
                  </TableCell>
                  <TableCell>
                    <Tooltip title={isMe ? 'You cannot delete your own account' : 'Delete this account'}>
                      <span>
                        <IconButton
                          size="small"
                          disabled={isMe || busy === u.email}
                          onClick={() => setConfirmDelete(u.email)}
                          aria-label={`delete ${u.email}`}
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              )
            })}
            {rows && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} sx={{ textAlign: 'center', color: 'text.disabled', py: 4 }}>
                  Nobody has registered yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>

      <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Weekly check-in: who has to submit</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
          Ticked people are expected to send a plan every Monday and a report every Friday, and will be the ones
          reminded. {weekly?.isDefault ? 'Nobody has changed this yet, so it is everybody with a scorecard.' : ''}
        </Typography>
        {!weekly && <Typography variant="body2" sx={{ color: 'text.disabled' }}>Could not load the list.</Typography>}
        {weekly && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {team.map((p) => {
              const on = weekly.submitters.includes(p.id)
              const linked = (rows || []).find((x) => x.person === p.id)
              return (
                <Tooltip key={p.id} title={linked ? `Signs in as ${linked.email}` : 'No account is linked to this person yet'}>
                  <Chip
                    label={p.nick}
                    color={on ? 'primary' : 'default'}
                    variant={on ? 'filled' : 'outlined'}
                    onClick={() => toggleSubmitter(p.id)}
                    disabled={busy === `weekly:${p.id}`}
                    aria-pressed={on}
                  />
                </Tooltip>
              )
            })}
          </Box>
        )}
      </Paper>

      <MailSettings weekly={weekly} onWeekly={(w) => setWeekly((cur) => ({ ...cur, ...w }))} />

      <AiSettings />

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>About the passwords on this page</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
          You asked to be able to read them, so each password is stored twice: as a one-way hash, which is the only
          thing a sign-in is ever checked against, and as an encrypted copy, which is what this column decrypts. The
          key lives in the server&rsquo;s environment and never in the database, so a copy of the database on its own
          gives up no passwords.
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.5, lineHeight: 1.6 }}>
          It is still weaker than not being able to read them at all — anybody holding both the database and the
          server&rsquo;s environment holds every password here, and people reuse passwords between systems. If reading
          them stops being useful, say so and the encrypted copy can be dropped: sign-in will carry on working
          untouched, and this column becomes &ldquo;set a new one&rdquo; instead.
        </Typography>
      </Paper>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Delete {confirmDelete}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            The account is removed and whoever holds it can register again from scratch. Nothing they entered in the
            plan is affected — the register does not belong to an account.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={async () => {
              const email = confirmDelete
              setConfirmDelete(null)
              setBusy(email)
              try {
                await auth.deleteUser(email)
                await load()
              } catch (e) {
                setError(e.message)
              } finally {
                setBusy(null)
              }
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!reset} onClose={() => setReset(null)} fullWidth maxWidth="xs">
        <DialogTitle>New password for {reset?.email}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            label="Password"
            value={reset?.value || ''}
            onChange={(e) => setReset((r) => ({ ...r, value: e.target.value }))}
            helperText="At least 8 characters. They are not told — you will have to."
            autoFocus
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReset(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!reset || (reset.value || '').length < 8}
            onClick={async () => {
              const { email, value } = reset
              setReset(null)
              await patch(email, { password: value })
            }}
          >
            Set it
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
