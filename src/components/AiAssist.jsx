import { useState } from 'react'
import { Box, Button, Typography, CircularProgress } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import * as api from '../lib/api.js'
import { BLOCKER_CATEGORIES } from '../lib/weekly.js'
import { Pill } from './Brand.jsx'
import { focusRingSx } from './focus.js'

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

/*
 * What the member is told when the AI fails. The server's own words ("The AI
 * answered 500: {json}", a timeout, a refused key) are an administrator's to
 * read in the logs; the member only needs to know nothing changed. A message
 * meant for them — too many requests, say — is kept.
 */
export const AI_DOWN = 'The AI is not available right now — your text is unchanged.'
export const friendlyAiError = (message) => {
  const m = String(message || '')
  if (!m || /AI answered|Request failed \(5|timed? ?out|refused the key|LOTUS_|not configured|fetch|network|ECONN|socket|JSON|\{/i.test(m)) return AI_DOWN
  return `${m.replace(/\.?\s*$/, '.')} Your text is unchanged.`
}

export default function AiAssist({
  available, field, text, onText, task, onSuggest, disabled,
}) {
  const [busy, setBusy] = useState(null)
  const [undo, setUndo] = useState(null)
  const [error, setError] = useState(null)
  const [suggestion, setSuggestion] = useState(null)
  const [note, setNote] = useState(null)
  if (!available || disabled) return null
  const empty = !String(text || '').trim()

  const run = async (kind) => {
    setBusy(kind)
    setError(null)
    setNote(null)
    setSuggestion(null)
    try {
      const r = await api.aiWrite({ kind, field, text, task })
      if (kind === 'blocker') {
        setSuggestion(r)
      } else if (r.unchanged) {
        // Said, not silent: a click that changes nothing looks broken.
        setNote(kind === 'polish'
          ? 'The AI had nothing to change — it already reads well. Add a little more detail and try again.'
          : 'The AI had nothing to add from these notes. Write a little more about what happened, then try again.')
      } else {
        setUndo(text)
        onText(r.text)
        setNote(kind === 'polish' ? 'Polished — read it over before you submit.' : 'Written up — read it over before you submit.')
      }
    } catch (e) {
      setError(friendlyAiError(e.message))
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
      sx={{
        py: 0.1, minHeight: 0, fontSize: '0.74rem', color: 'text.secondary', '&:hover': { color: 'primary.light' }, ...focusRingSx,
      }}
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
            onClick={() => { onText(undo); setUndo(null); setNote(null) }}
            sx={{ py: 0.1, minHeight: 0, fontSize: '0.74rem' }}
          >
            Undo — put my words back
          </Button>
        )}
      </Box>
      {busy && busy !== 'blocker' && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Writing… this can take a few seconds.</Typography>
      )}
      {error && <Typography variant="caption" sx={{ color: 'text.secondary' }} data-ai-error>{error}</Typography>}
      {note && !busy && <Typography variant="caption" sx={{ color: 'text.secondary' }} data-ai-note>{note}</Typography>}
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
