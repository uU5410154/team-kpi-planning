import { useCallback, useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Button, Chip, TextField, Alert, Switch, FormControlLabel, Table, TableBody,
  TableCell, TableHead, TableRow,
} from '@mui/material'
import SendIcon from '@mui/icons-material/SendOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import * as api from '../lib/api.js'
import Loading from './Loading.jsx'
import { Pill } from './Brand.jsx'

/*
 * THE WEEKLY EMAILS, for an administrator.
 *
 * Whether email can go out at all (and if not, the two settings that are
 * missing), a test to oneself — the only honest way to know a reminder will
 * reach a work inbox rather than its junk folder — a switch to pause the
 * reminders, the list that gets the 23:00 "still missing" email, and the last
 * forty emails with what happened to each.
 */

const KIND = {
  headsup: 'heads-up', reminder: 'reminder', digest: '23:00 list', proposal: 'proposal', decision: 'decision', test: 'test',
}
const TONE = {
  sent: 'good', failed: 'bad', sending: 'violet',
}
const SCHEDULE = [
  ['Mon 07:00', 'heads-up: the plan is due at 08:00'],
  ['Mon 08:00–23:00', 'every hour, to anybody whose plan is not in'],
  ['Fri 10:00', 'heads-up: the report is due at 15:00'],
  ['Fri 15:00–23:00', 'every hour, to anybody whose report is not in'],
  ['Sun 15:00–23:00', 'every hour — the second chance'],
  ['23:00 Mon, Fri, Sun', 'who is still missing, to the list below'],
]

export default function MailSettings({ weekly, onWeekly }) {
  const [mail, setMail] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(null)
  const [add, setAdd] = useState('')

  const load = useCallback(async () => {
    try { setMail(await api.mailStatus()) } catch (e) { setError(e.message) }
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (patch, what) => {
    setBusy(what)
    setError(null)
    try { onWeekly(await api.saveWeeklyOptions(patch)) } catch (e) { setError(e.message) } finally { setBusy(null) }
  }
  const list = weekly?.escalation
  const addAddress = () => {
    const v = add.trim().toLowerCase()
    if (!v) return
    save({ escalation: [...(list || []), v] }, 'escalation').then(() => setAdd(''))
  }

  const test = async () => {
    setBusy('test')
    setError(null)
    setNote(null)
    try {
      const r = await api.sendTestMail()
      setNote(`Sent to ${r.to}. If it is not in your inbox within a few minutes, look in junk — and if it is there, mark it as not junk.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
      load()
    }
  }

  const st = mail?.status
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Weekly check-in: emails</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Reminders go to the account linked to each person on the submit list — somebody with no account linked
          cannot be reminded, and is named in the 23:00 email instead. Bangkok time; no exceptions for leave.
        </Typography>
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {note && <Alert severity="success" onClose={() => setNote(null)}>{note}</Alert>}

      {!mail && !error && <Loading label="Checking the email set-up…" />}
      {st && (st.configured ? (
        <Alert severity="success" sx={{ py: 0.25 }}>
          Sending as <strong>{st.from}</strong>{st.mode !== 'gmail' ? ` (${st.mode})` : ''}.
        </Alert>
      ) : (
        <Alert severity="warning">
          Email is not set up, so nothing is sent. In the Render dashboard, under Environment, add{' '}
          {st.missing.map((m, i) => <span key={m}>{i ? ' and ' : ''}<strong>{m}</strong></span>)} — the Gmail address, and an
          app password made for it at myaccount.google.com/apppasswords.
        </Alert>
      ))}

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="contained" startIcon={<SendIcon />} onClick={test} disabled={!!busy || !st?.configured}>
          {busy === 'test' ? 'Sending…' : 'Send me a test email'}
        </Button>
        <FormControlLabel
          control={(
            <Switch
              checked={weekly?.remindersOn !== false}
              disabled={!weekly || !!busy}
              onChange={(e) => save({ remindersOn: e.target.checked }, 'on')}
            />
          )}
          label={weekly?.remindersOn === false ? 'Reminders paused' : 'Reminders on'}
        />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'max-content 1fr' }, columnGap: 2, rowGap: 0.5 }}>
        {SCHEDULE.map(([when, what]) => (
          <Box key={when} sx={{ display: 'contents' }}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>{when}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', mb: { xs: 0.75, sm: 0 } }}>{what}</Typography>
          </Box>
        ))}
      </Box>

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>Who gets the 23:00 list</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {weekly === undefined && <Loading label="Loading…" />}
          {weekly !== undefined && !list && <Chip label="Every administrator (nobody has set a list)" variant="outlined" />}
          {(list || []).map((e) => (
            <Chip
              key={e}
              label={e}
              onDelete={busy ? undefined : () => save({ escalation: list.filter((x) => x !== e).length ? list.filter((x) => x !== e) : null }, 'escalation')}
            />
          ))}
          <TextField
            size="small"
            placeholder="add an address"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addAddress() }}
            sx={{ minWidth: 220 }}
            inputProps={{ 'aria-label': 'add an address to the 23:00 list' }}
          />
          <Button onClick={addAddress} disabled={!add.trim() || !!busy}>Add</Button>
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.75 }}>
          Any address, not only people with an account here. Remove them all to go back to every administrator.
        </Typography>
      </Box>

      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="subtitle2">Sent lately</Typography>
          <Button size="small" startIcon={<RefreshIcon />} onClick={load}>Refresh</Button>
        </Box>
        {!mail && !error && <Loading label="Loading sent emails…" />}
        {mail && mail.recent.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.disabled' }}>Nothing yet.</Typography>
        )}
        {mail && mail.recent.length > 0 && (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ minWidth: 620 }}>
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>What</TableCell>
                  <TableCell>To</TableCell>
                  <TableCell>Subject</TableCell>
                  <TableCell>Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mail.recent.map((m) => (
                  <TableRow key={m._id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>
                      {new Date(m.sentAt || m.at).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' })}
                    </TableCell>
                    <TableCell>{KIND[m.kind] || m.kind}</TableCell>
                    <TableCell sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.to.join(', ')}>
                      {m.to.join(', ')}
                    </TableCell>
                    <TableCell>{m.subject}</TableCell>
                    <TableCell>
                      <Pill label={m.status} tone={TONE[m.status] || 'neutral'} title={m.error || undefined} />
                      {m.error && (
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', maxWidth: 260 }}>{m.error}</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>
    </Paper>
  )
}
