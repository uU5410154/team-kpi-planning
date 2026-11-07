import { useState } from 'react'
import {
  Box, Button, Typography, CircularProgress, Tooltip, Popover,
} from '@mui/material'
import MailIcon from '@mui/icons-material/MailOutline'
import * as api from '../lib/api.js'
import { Pill } from './Brand.jsx'

/*
 * FOLLOW UP: email a project's owner a link to update it.
 *
 * Nothing goes on the first click: it opens a short confirmation saying who
 * gets the email and what it asks, and only "Send" sends it. Says what became
 * of the last one — asked, and when; updated, and when — so nobody sends a
 * third email about a project that was answered an hour ago.
 *
 * `off` takes the button away and says why instead: a project on hold needs
 * no update, and a past week cannot be updated any more.
 */

export const ago = (iso, now = Date.now()) => {
  if (!iso) return ''
  const m = Math.round((now - Date.parse(iso)) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export default function FollowUp({
  projectKey, followup, onSent, compact = false, owner = null, summary = '', note = null, off = null,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [at, setAt] = useState(null)
  const f = followup

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.followUp(projectKey)
      onSent?.(r.followup)
      setAt(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const last = f && !error && (
    f.status === 'updated'
      ? <Pill label={`Updated ${ago(f.updatedAt)}`} tone="good" />
      : <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>Asked {ago(f.sentAt)}</Typography>
  )

  return (
    <Box
      data-followup={projectKey}
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: compact ? 'flex-end' : 'flex-start', gap: 0.4, minWidth: 0,
      }}
    >
      {off ? (
        <Typography variant="caption" data-followup-off sx={{ color: 'text.disabled', textAlign: compact ? 'right' : 'left', maxWidth: 200 }}>{off}</Typography>
      ) : (
        <>
          <Tooltip title="Email the owner a link to update this project on their Weekly page — you confirm first">
            <span>
              <Button
                size="small"
                variant="outlined"
                onClick={(e) => { setError(null); setAt(e.currentTarget) }}
                disabled={busy}
                startIcon={busy ? <CircularProgress size={12} /> : <MailIcon sx={{ fontSize: '16px !important' }} />}
                aria-label={`follow up ${projectKey}`}
                aria-haspopup="dialog"
                sx={{
                  whiteSpace: 'nowrap', color: 'text.primary', borderColor: 'divider', py: 0.25,
                }}
              >
                Follow up
              </Button>
            </span>
          </Tooltip>
          <Popover
            open={!!at}
            anchorEl={at}
            onClose={() => !busy && setAt(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: compact ? 'right' : 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: compact ? 'right' : 'left' }}
            slotProps={{ paper: { sx: { p: 2, maxWidth: 340, border: 1, borderColor: 'divider' } } }}
          >
            <Box role="dialog" aria-label={`confirm follow up ${projectKey}`} data-followup-confirm sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">Email {owner || 'the owner'} about {projectKey}?</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {owner || 'The owner'} gets an email asking for this week&rsquo;s update on {projectKey}{summary ? ` — ${summary}` : ''}:
                what they did, and if it is not finished, what is in the way. Its button opens their Weekly page on it.
              </Typography>
              {note && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{note}</Typography>}
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>When they send it, you get an email back.</Typography>
              {error && <Typography variant="caption" sx={{ color: 'error.main' }}>{error}</Typography>}
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 0.5 }}>
                <Button size="small" onClick={() => setAt(null)} disabled={busy}>Cancel</Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={send}
                  disabled={busy}
                  data-followup-send
                  startIcon={busy ? <CircularProgress size={12} /> : <MailIcon sx={{ fontSize: '16px !important' }} />}
                >
                  Send the email
                </Button>
              </Box>
            </Box>
          </Popover>
        </>
      )}
      {last}
      {error && !at && (
        <Typography variant="caption" sx={{ color: 'error.main', maxWidth: 260, textAlign: compact ? 'right' : 'left' }}>{error}</Typography>
      )}
    </Box>
  )
}
