import { useState } from 'react'
import { Box, Button, Typography, CircularProgress } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import * as api from '../lib/api.js'
import { BLOCKER_CATEGORIES } from '../lib/weekly.js'
import { Pill } from './Brand.jsx'

/*
 * HELP WITH WRITING, beside the box it helps with.
 *
 * "Write up my notes" turns rough notes into a clear update; "Polish" tidies
 * what is already there. Either one REPLACES the text in the box — the member
 * reads it there, edits it, and can put their own words back with one click.
 * Nothing is saved or submitted by the AI; the member still does that.
 *
 * For a blocker, "Suggest" proposes what it is waiting on and whether it
 * moves the deadline, and fills those in only when the member says so.
 *
 * Hidden entirely when the AI is not available on the server.
 */

const CATEGORY = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))

export default function AiAssist({
  available, field, text, onText, task, onSuggest, disabled,
}) {
  const [busy, setBusy] = useState(null)
  const [undo, setUndo] = useState(null)
  const [error, setError] = useState(null)
  const [suggestion, setSuggestion] = useState(null)
  if (!available || disabled) return null
  const empty = !String(text || '').trim()

  const run = async (kind) => {
    setBusy(kind)
    setError(null)
    setSuggestion(null)
    try {
      const r = await api.aiWrite({ kind, field, text, task })
      if (kind === 'blocker') {
        setSuggestion(r)
      } else {
        setUndo(text)
        onText(r.text)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const btn = (kind, label) => (
    <Button
      size="small"
      onClick={() => run(kind)}
      disabled={!!busy || empty}
      startIcon={busy === kind ? <CircularProgress size={12} /> : <AutoAwesomeIcon sx={{ fontSize: '15px !important' }} />}
      sx={{ py: 0.1, minHeight: 0, fontSize: '0.74rem', color: 'text.secondary', '&:hover': { color: 'primary.light' } }}
    >
      {label}
    </Button>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: -0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexWrap: 'wrap' }}>
        {btn('notes', 'Write up my notes')}
        {btn('polish', 'Polish')}
        {field === 'blocker' && onSuggest && btn('blocker', 'Suggest what it is waiting on')}
        {undo !== null && !busy && (
          <Button
            size="small"
            onClick={() => { onText(undo); setUndo(null) }}
            sx={{ py: 0.1, minHeight: 0, fontSize: '0.74rem' }}
          >
            Undo — put my words back
          </Button>
        )}
      </Box>
      {busy && busy !== 'blocker' && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Writing… this can take a few seconds.</Typography>
      )}
      {error && <Typography variant="caption" sx={{ color: 'error.main' }}>{error}</Typography>}
      {suggestion && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', p: 1, borderRadius: '10px', border: 1, borderColor: 'divider',
        }}
        >
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Suggested:</Typography>
          <Pill label={CATEGORY[suggestion.category]} tone="info" />
          {suggestion.affects !== null && (
            <Pill label={suggestion.affects ? 'likely pushes the deadline' : 'deadline likely holds'} tone={suggestion.affects ? 'warn' : 'good'} />
          )}
          {suggestion.why && <Typography variant="caption" sx={{ flex: '1 1 200px' }}>{suggestion.why}</Typography>}
          <Button size="small" variant="outlined" onClick={() => { onSuggest(suggestion); setSuggestion(null) }}>Use it</Button>
          <Button size="small" onClick={() => setSuggestion(null)}>Dismiss</Button>
        </Box>
      )}
    </Box>
  )
}
