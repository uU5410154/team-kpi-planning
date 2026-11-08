import { useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import * as api from '../lib/api.js'
import { BLOCKER_CATEGORIES } from '../lib/weekly.js'
import { Pill } from './Brand.jsx'
import { Spinner } from './Loading.jsx'

/*
 * HELP WITH WRITING, under the box it helps with.
 *
 * "Write up my notes" turns rough notes into a clear update; "Polish" tidies
 * what is already there. Either one REPLACES the text in the box — the member
 * reads it there, edits it, and can put their own words back with one click.
 * Nothing is saved or submitted by the AI; the member still does that.
 *
 * For a blocker, "Suggest" proposes what it is waiting on and whether it
 * moves the deadline, and fills those in only when the member says so.
 *
 * Drawn as one row under the field: the field's own helper line (`helper`) on
 * the left, the small text buttons on the right. With the AI switched off on
 * the server the buttons are not drawn at all, and only the helper line is.
 */

const CATEGORY = Object.fromEntries(BLOCKER_CATEGORIES.map((c) => [c.id, c.label]))

/*
 * What the member is told when the AI fails. The server's own words ("The AI
 * answered 500: {json}", a timeout, a refused key) are an administrator's to
 * read in the logs; the member only needs to know nothing changed. A message
 * meant for them — too many requests, say — is kept.
 */
export const AI_DOWN = 'The AI did not answer. Your text is unchanged; try again in a minute.'
export const friendlyAiError = (message) => {
  const m = String(message || '')
  if (!m || /AI answered|Request failed \(5|timed? ?out|refused the key|LOTUS_|not configured|fetch|network|ECONN|socket|JSON|\{/i.test(m)) return AI_DOWN
  return `${m.replace(/\.?\s*$/, '.')} Your text is unchanged.`
}

const textBtn = {
  minHeight: 28,
  px: 1.5,
  py: 0.5,
  fontSize: '0.8125rem',
  color: 'primary.text',
  whiteSpace: 'nowrap',
  '& .MuiButton-startIcon': { mr: 1 },
}

export default function AiAssist({
  available, field, text, onText, task, onSuggest, disabled, helper = null,
}) {
  const [busy, setBusy] = useState(null)
  const [undo, setUndo] = useState(null)
  const [error, setError] = useState(null)
  const [suggestion, setSuggestion] = useState(null)
  const [note, setNote] = useState(null)
  const on = available && !disabled
  if (!on) {
    return helper ? <Box sx={{ mt: -1 }}>{helper}</Box> : null
  }
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
          ? 'Nothing to change: it already reads well. Add more detail and try again.'
          : 'Nothing to add from these notes. Write a little more about what happened, then try again.')
      } else {
        setUndo(text)
        onText(r.text)
        setNote(kind === 'polish' ? 'Polished. Read it over before you submit.' : 'Written up. Read it over before you submit.')
      }
    } catch (e) {
      setError(friendlyAiError(e.message))
    } finally {
      setBusy(null)
    }
  }

  const btn = (kind, label) => (
    <Button
      variant="text"
      size="small"
      onClick={() => run(kind)}
      disabled={!!busy || empty}
      startIcon={busy === kind ? <Spinner size={14} /> : <AutoAwesomeIcon sx={{ fontSize: '16px !important' }} />}
      sx={textBtn}
    >
      {label}
    </Button>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: -1 }}>
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', columnGap: 2, rowGap: 0.5, flexWrap: 'wrap',
      }}
      >
        <Box sx={{ flex: '1 1 240px', minWidth: 0, pt: 0.75 }}>{helper}</Box>
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end', ml: 'auto', mr: -1.5,
        }}
        >
          {undo !== null && !busy && (
            <Button
              variant="text"
              size="small"
              onClick={() => { onText(undo); setUndo(null); setNote(null) }}
              sx={{ ...textBtn, color: 'text.secondary' }}
            >
              Undo, put my words back
            </Button>
          )}
          {btn('notes', 'Write up my notes')}
          {btn('polish', 'Polish')}
          {field === 'blocker' && onSuggest && btn('blocker', 'Suggest what it is waiting on')}
        </Box>
      </Box>
      {busy && busy !== 'blocker' && (
        <Typography variant="caption" role="status" sx={{ color: 'text.secondary' }}>Writing… this can take a few seconds.</Typography>
      )}
      {error && <Typography variant="caption" role="alert" sx={{ color: 'text.secondary' }} data-ai-error>{error}</Typography>}
      {note && !busy && <Typography variant="caption" role="status" sx={{ color: 'text.secondary' }} data-ai-note>{note}</Typography>}
      {suggestion && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', px: 3, py: 2, borderRadius: '6px', bgcolor: 'bg.subtle',
        }}
        >
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Suggested:</Typography>
          <Pill label={CATEGORY[suggestion.category]} tone="info" />
          {suggestion.affects !== null && (
            <Pill label={suggestion.affects ? 'Likely pushes the deadline' : 'Deadline likely holds'} tone={suggestion.affects ? 'warn' : 'good'} />
          )}
          {suggestion.why && <Typography variant="body2" sx={{ flex: '1 1 200px', color: 'text.secondary' }}>{suggestion.why}</Typography>}
          <Box sx={{ display: 'flex', gap: 1, ml: 'auto' }}>
            <Button size="small" onClick={() => setSuggestion(null)}>Dismiss</Button>
            <Button size="small" variant="outlined" onClick={() => { onSuggest(suggestion); setSuggestion(null) }}>Use it</Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}
