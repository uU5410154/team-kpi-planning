import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Chip, Skeleton, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  Typography, useMediaQuery,
} from '@mui/material'
import SendIcon from '@mui/icons-material/SendOutlined'
import CloseIcon from '@mui/icons-material/Close'
import MailOutlineIcon from '@mui/icons-material/MailOutline'
import * as api from '../lib/api.js'
import { Spinner } from './Loading.jsx'
import { EmptyState, Section, StatusPill } from './ui.jsx'

/*
 * THE WEEKLY EMAILS, for an administrator.
 *
 * Whether email can go out at all (and if not, the two settings that are
 * missing), a test to oneself (the only honest way to know a reminder will
 * reach a work inbox rather than its junk folder), a switch to pause the
 * reminders, the list that gets the 23:00 "still missing" email, and the last
 * forty emails with what happened to each.
 */

const KIND = {
  headsup: 'Heads-up', reminder: 'Reminder', digest: '23:00 list', proposal: 'Proposal', decision: 'Decision', test: 'Test',
}
const RESULT = {
  sent: { label: 'Sent', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  sending: { label: 'Sending', tone: 'info' },
}
const SCHEDULE = [
  ['Mon 07:00', 'Heads-up: the plan is due at 08:00'],
  ['Mon 08:00–23:00', 'Every hour, to anybody whose plan is not in'],
  ['Fri 10:00', 'Heads-up: the report is due at 15:00'],
  ['Fri 15:00–23:00', 'Every hour, to anybody whose report is not in'],
  ['Sun 15:00–23:00', 'Every hour, as the second chance'],
  ['Mon, Fri, Sun 23:00', 'Who is still missing, to the list below'],
]
const FIRST = 10

/* "7 Nov, 19:37", Bangkok time. */
const when = (iso) => new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
})

/* A small dot in a status colour, beside the words that say the status. */
function Dot({ tone }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(t) => ({
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: t.palette.tone[tone]?.solid || t.palette.tone.neutral.solid, mt: '6px',
      })}
    />
  )
}

/*
 * One setting: its name on the left and the control on the right on a
 * computer, one above the other on a phone. Rows are split by hairlines.
 */
function Row({ title, children, first = false }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', md: '200px minmax(0, 1fr)' },
      columnGap: 6,
      rowGap: 2,
      px: { xs: 3, sm: 4 },
      py: 4,
      borderTop: first ? 0 : 1,
      borderColor: 'border.subtle',
    }}
    >
      <Typography variant="h3" sx={{ pt: { md: 0.5 } }}>{title}</Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

export default function MailSettings({ weekly, onWeekly, reloadKey = 0 }) {
  const phone = useMediaQuery((t) => t.breakpoints.down('sm'))
  const [mail, setMail] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [busy, setBusy] = useState(null)
  const [add, setAdd] = useState('')
  const [addError, setAddError] = useState(null)
  const [all, setAll] = useState(false)

  const load = useCallback(async () => {
    try {
      setMail(await api.mailStatus())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }, [])
  useEffect(() => { load() }, [load, reloadKey])

  const save = async (patch, what) => {
    setBusy(what)
    setError(null)
    try {
      onWeekly(await api.saveWeeklyOptions(patch))
      return true
    } catch (e) {
      if (what === 'escalation') setAddError(e.message); else setError(e.message)
      return false
    } finally {
      setBusy(null)
    }
  }
  const list = weekly?.escalation
  const addAddress = async (e) => {
    e?.preventDefault?.()
    const v = add.trim().toLowerCase()
    if (!v) { setAddError('Type an email address first.'); return }
    if ((list || []).includes(v)) { setAddError('That address is already on the list.'); return }
    setAddError(null)
    if (await save({ escalation: [...(list || []), v] }, 'escalation')) setAdd('')
  }
  const removeAddress = (e) => {
    const rest = list.filter((x) => x !== e)
    save({ escalation: rest.length ? rest : null }, 'escalation')
  }

  const test = async () => {
    setBusy('test')
    setError(null)
    setNote(null)
    try {
      const r = await api.sendTestMail()
      setNote(`Sent to ${r.to}. If it is not in your inbox within a few minutes, look in junk and mark it as not junk.`)
    } catch (e) {
      setError(`The test email did not go: ${e.message}`)
    } finally {
      setBusy(null)
      load()
    }
  }

  const st = mail?.status
  const recent = mail?.recent || []
  const shown = all ? recent : recent.slice(0, FIRST)
  const paused = weekly?.remindersOn === false

  return (
    <Section
      title="Weekly check-in: emails"
      meta="Reminders go to the account linked to each person on the submit list, on Bangkok time."
      padded={false}
      data-access-mail
      actions={st?.configured ? (
        <Button
          variant="outlined"
          startIcon={busy === 'test' ? <Spinner size={14} /> : <SendIcon />}
          onClick={test}
          disabled={!!busy}
        >
          {busy === 'test' ? 'Sending…' : 'Send me a test email'}
        </Button>
      ) : null}
    >
      <Row title="Sender" first>
        {!st && !error && (
          <Box role="status" data-loading sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'text.secondary', minHeight: 20 }}>
            <Spinner size={14} />
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>Checking the email set-up…</Typography>
          </Box>
        )}
        {!st && error && (
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Dot tone="danger" />
            <Typography variant="body1">
              The email set-up could not be read.
              {' '}
              <Button variant="text" onClick={load} sx={{ ml: 1, my: -1 }}>Try again</Button>
            </Typography>
          </Box>
        )}
        {st && st.configured && (
          <Box sx={{ display: 'flex', gap: 2, minWidth: 0 }}>
            <Dot tone="success" />
            <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
              Sending as <Box component="span" sx={{ fontWeight: 500 }}>{st.from}</Box>
              {st.mode !== 'gmail' && <Box component="span" sx={{ color: 'text.secondary' }}>{` (${st.mode})`}</Box>}
            </Typography>
          </Box>
        )}
        {st && !st.configured && (
          <>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Dot tone="warning" />
              <Typography variant="body1">Email is not set up, so nothing is sent.</Typography>
            </Box>
            <Box sx={{
              mt: 3, p: 3, borderRadius: '6px', bgcolor: 'bg.subtle', maxWidth: '72ch',
            }}
            >
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                In the Render dashboard, under Environment, add{' '}
                {st.missing.map((m, i) => <span key={m}>{i ? ' and ' : ''}<Box component="strong" sx={{ color: 'text.primary', fontWeight: 600 }}>{m}</Box></span>)}
                : the Gmail address, and an app password made for it at myaccount.google.com/apppasswords.
              </Typography>
            </Box>
          </>
        )}
        {note && <Alert severity="success" onClose={() => setNote(null)} sx={{ mt: 3 }}>{note}</Alert>}
        {error && st && <Alert severity="error" onClose={() => setError(null)} sx={{ mt: 3 }}>{error}</Alert>}
      </Row>

      <Row title="Reminders">
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <Switch
            checked={!paused}
            disabled={!weekly || !!busy}
            onChange={(e) => save({ remindersOn: e.target.checked }, 'on')}
            inputProps={{ 'aria-labelledby': 'mail-reminders-label' }}
            sx={{ mt: -1.5, ml: -2.5 }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography id="mail-reminders-label" variant="body1" sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 2 }}>
              Send reminders
              {busy === 'on' && <Spinner size={12} />}
            </Typography>
            <Typography variant="body2" sx={{ color: paused ? 'warning.main' : 'text.secondary', mt: 0.5 }}>
              {paused
                ? 'Paused. Nobody is reminded and no 23:00 list goes out until you switch this back on.'
                : 'On. The emails below go out on schedule.'}
            </Typography>
          </Box>
        </Box>
      </Row>

      <Row title="Schedule">
        <Box
          component="dl"
          sx={{
            display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'max-content minmax(0, 1fr)' }, columnGap: 6, rowGap: { xs: 0, sm: 1.5 }, m: 0,
          }}
        >
          {SCHEDULE.map(([at, what]) => (
            <Box key={at} sx={{ display: 'contents' }}>
              <Typography component="dt" variant="body2" sx={{ fontWeight: 500, color: 'text.primary', whiteSpace: 'nowrap' }}>{at}</Typography>
              <Typography component="dd" variant="body2" sx={{ color: 'text.secondary', m: 0, mb: { xs: 2, sm: 0 } }}>{what}</Typography>
            </Box>
          ))}
        </Box>
      </Row>

      <Row title="Who gets the 23:00 list">
        {weekly === undefined && (
          <Box role="status" data-loading sx={{ display: 'flex', alignItems: 'center', gap: 2, color: 'text.secondary' }}>
            <Spinner size={14} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>Loading the list…</Typography>
          </Box>
        )}
        {weekly !== undefined && (
          <>
            <Box sx={{
              display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mb: 3,
            }}
            >
              {!list && (
                <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                  Every administrator, until you add an address.
                </Typography>
              )}
              {(list || []).map((e) => (
                <Chip
                  key={e}
                  label={e}
                  variant="outlined"
                  onDelete={busy ? undefined : () => removeAddress(e)}
                  sx={{ color: 'text.primary', maxWidth: '100%' }}
                  deleteIcon={<CloseIcon aria-label={`Remove ${e}`} />}
                />
              ))}
            </Box>
            <Box
              component="form"
              onSubmit={addAddress}
              noValidate
              sx={{
                display: 'flex', gap: 2, alignItems: 'flex-start', maxWidth: 480,
              }}
            >
              <TextField
                size="small"
                label="Add an address"
                type="email"
                value={add}
                onChange={(e) => { setAdd(e.target.value); setAddError(null) }}
                error={!!addError}
                helperText={addError || (list
                  ? 'Any address works. Remove them all to go back to every administrator.'
                  : 'Any address works, not only people with an account here.')}
                sx={{ flex: 1, minWidth: 0 }}
                inputProps={{ 'aria-label': 'add an address to the 23:00 list' }}
              />
              <Button
                type="submit"
                variant="text"
                disabled={busy === 'escalation'}
                startIcon={busy === 'escalation' ? <Spinner size={14} /> : null}
                sx={{ mt: { xs: 0, sm: '2px' }, flexShrink: 0 }}
              >
                Add
              </Button>
            </Box>
          </>
        )}
      </Row>

      <Box sx={{ borderTop: 1, borderColor: 'border.subtle' }}>
        <Box sx={{
          display: 'flex', alignItems: 'baseline', gap: 2, px: { xs: 3, sm: 4 }, pt: 4, pb: 3,
        }}
        >
          <Typography variant="h3">Sent lately</Typography>
          {mail && recent.length > 0 && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {recent.length === 1 ? '1 email' : `Last ${recent.length} emails`}
            </Typography>
          )}
        </Box>
        {!mail && !error && <LogSkeleton phone={phone} />}
        {!mail && error && (
          <Box sx={{ px: { xs: 3, sm: 4 }, pb: 4 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>The sent emails could not be read.</Typography>
          </Box>
        )}
        {mail && recent.length === 0 && (
          <Box sx={{ px: { xs: 3, sm: 4 }, pb: 2 }}>
            <EmptyState inline icon={MailOutlineIcon} title="No emails sent yet." body="Each reminder and test email will be listed here." />
          </Box>
        )}
        {mail && recent.length > 0 && (phone ? (
          <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, borderTop: 1, borderColor: 'border.subtle' }}>
            {shown.map((m) => {
              const r = RESULT[m.status] || { label: m.status, tone: 'neutral' }
              return (
                <Box
                  component="li"
                  key={m._id}
                  sx={{
                    display: 'flex', gap: 2, alignItems: 'flex-start', px: 3, py: 2.5, borderBottom: 1, borderColor: 'border.subtle',
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body1" noWrap sx={{ fontWeight: 500 }} title={m.subject}>{m.subject}</Typography>
                    <Typography variant="body2" noWrap sx={{ color: 'text.secondary', mt: 0.5 }}>
                      {`${KIND[m.kind] || m.kind}, ${when(m.sentAt || m.at)}, to ${m.to.join(', ')}`}
                    </Typography>
                    {m.error && <Typography variant="body2" sx={{ color: 'error.main', mt: 0.5 }}>{m.error}</Typography>}
                  </Box>
                  <StatusPill tone={r.tone} sx={{ mt: 0.25 }}>{r.label}</StatusPill>
                </Box>
              )
            })}
          </Box>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: 640, tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 120 }} />
                <col style={{ width: 104 }} />
                <col style={{ width: '28%' }} />
                <col />
                <col style={{ width: 96 }} />
              </colgroup>
              <TableHead>
                <TableRow>
                  <TableCell>Time</TableCell>
                  <TableCell>Kind</TableCell>
                  <TableCell>To</TableCell>
                  <TableCell>Subject</TableCell>
                  <TableCell>Result</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((m) => {
                  const r = RESULT[m.status] || { label: m.status, tone: 'neutral' }
                  const to = m.to.join(', ')
                  return (
                    <TableRow key={m._id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>{when(m.sentAt || m.at)}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{KIND[m.kind] || m.kind}</TableCell>
                      <TableCell sx={ellipsis} title={to}>{to}</TableCell>
                      <TableCell sx={ellipsis} title={m.subject}>
                        {m.subject}
                        {m.error && <Typography variant="body2" sx={{ color: 'error.main', whiteSpace: 'normal' }}>{m.error}</Typography>}
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={r.tone} title={m.error || undefined}>{r.label}</StatusPill>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Box>
        ))}
        {mail && recent.length > FIRST && (
          <Box sx={{ px: { xs: 1, sm: 2 }, py: 1, borderTop: 1, borderColor: 'border.subtle' }}>
            <Button variant="text" onClick={() => setAll((v) => !v)}>
              {all ? `Show the latest ${FIRST}` : `Show all ${recent.length}`}
            </Button>
          </Box>
        )}
      </Box>
    </Section>
  )
}

const ellipsis = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }

function LogSkeleton({ phone }) {
  return (
    <Box role="status" aria-label="Loading sent emails…" data-loading>
      {!phone && <Box sx={{ height: 36, bgcolor: 'bg.subtle', borderTop: 1, borderColor: 'border.subtle' }} />}
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            height: 44, display: 'flex', alignItems: 'center', gap: 6, px: 3, borderTop: phone || i ? 1 : 0, borderColor: 'border.subtle',
          }}
        >
          <Skeleton variant="text" width={80} height={16} />
          {!phone && <Skeleton variant="text" width={70} height={16} />}
          <Skeleton variant="text" height={16} sx={{ flex: 1, maxWidth: 360 }} />
          <Box sx={{ flex: 1 }} />
          <Skeleton variant="rounded" width={44} height={20} />
        </Box>
      ))}
    </Box>
  )
}
