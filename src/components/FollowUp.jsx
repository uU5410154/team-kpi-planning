import { useState } from 'react'
import {
  Box, Button, Typography, CircularProgress, Tooltip,
} from '@mui/material'
import MailIcon from '@mui/icons-material/MailOutline'
import * as api from '../lib/api.js'
import { Pill } from './Brand.jsx'

/*
 * FOLLOW UP: email a project's owner a link to update it.
 *
 * Says what became of the last one — asked, and when; updated, and when — so
 * nobody sends a third email about a project that was answered an hour ago.
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
  projectKey, followup, onSent, compact = false,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const f = followup

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.followUp(projectKey)
      onSent?.(r.followup)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{
      display: 'flex', flexDirection: 'column', alignItems: compact ? 'flex-end' : 'flex-start', gap: 0.4, minWidth: 0,
    }}
    >
      <Tooltip title="Email the owner a link to update this project on their Weekly page">
        <span>
          <Button
            size="small"
            variant="outlined"
            onClick={send}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={12} /> : <MailIcon sx={{ fontSize: '16px !important' }} />}
            aria-label={`follow up ${projectKey}`}
            sx={{
              whiteSpace: 'nowrap', color: 'text.primary', borderColor: 'divider', py: 0.25,
            }}
          >
            Follow up
          </Button>
        </span>
      </Tooltip>
      {f && !error && (
        f.status === 'updated'
          ? <Pill label={`Updated ${ago(f.updatedAt)}`} tone="good" />
          : <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>Asked {ago(f.sentAt)}</Typography>
      )}
      {error && (
        <Typography variant="caption" sx={{ color: 'error.main', maxWidth: 260, textAlign: compact ? 'right' : 'left' }}>{error}</Typography>
      )}
    </Box>
  )
}
