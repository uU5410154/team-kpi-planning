import { useEffect, useRef, useState } from 'react'
import {
  Box, Button, ToggleButton, ToggleButtonGroup, Typography, CircularProgress, Tooltip,
} from '@mui/material'
import MicIcon from '@mui/icons-material/MicNoneOutlined'
import StopIcon from '@mui/icons-material/StopRounded'
import * as api from '../lib/api.js'

/*
 * SAY THE UPDATE INSTEAD OF TYPING IT (owner, 2026-11-22).
 *
 * The browser turns speech into text — Chrome and Edge have it built in, in
 * Thai and in English — and the Lotus AI turns that transcript into the card's
 * fields: progress, finished or not, why, what is in the way, a decision. The
 * Lotus model takes no audio itself (tested: "At most 0 audio(s)"), so it only
 * ever sees text. Nothing goes to Jira until the member checks the fields and
 * presses Submit. With the AI off, the transcript goes into the progress box
 * as it was heard.
 */

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null
export const voiceSupported = () => !!Recognition

const LANG_KEY = 'fa-kpi-voice-lang'
const LANGS = [['th-TH', 'ไทย'], ['en-US', 'EN']]
const readLang = () => { try { return localStorage.getItem(LANG_KEY) || 'th-TH' } catch { return 'th-TH' } }

const ERRORS = {
  'not-allowed': 'The browser was not allowed to use the microphone. Allow it from the address bar, then try again.',
  'service-not-allowed': 'The browser was not allowed to use the microphone. Allow it from the address bar, then try again.',
  'no-speech': 'Nothing was heard. Press Speak and talk a little closer to the microphone.',
  'audio-capture': 'No microphone was found.',
  network: 'The browser could not reach its speech service. Check the connection, or type the update.',
}

export default function VoiceUpdate({
  disabled = false, aiOn = false, task = null, onFields,
}) {
  const [lang, setLang] = useState(readLang)
  const [state, setState] = useState('idle') // idle | listening | writing
  const [heard, setHeard] = useState('')
  const [error, setError] = useState(null)
  const rec = useRef(null)
  const said = useRef('')
  const stopped = useRef(false)
  useEffect(() => () => { try { rec.current?.abort() } catch { /* gone */ } }, [])

  if (!Recognition) {
    return (
      <Typography variant="caption" sx={{ color: 'text.disabled' }} data-voice-unsupported>
        Speaking an update needs Chrome or Edge.
      </Typography>
    )
  }

  const pickLang = (v) => {
    if (!v) return
    setLang(v)
    try { localStorage.setItem(LANG_KEY, v) } catch { /* a private window */ }
  }

  const finish = async () => {
    const text = said.current.trim()
    rec.current = null
    if (!text) { setState('idle'); setError((e) => e || ERRORS['no-speech']); return }
    if (!aiOn) {
      onFields?.({ progress: text }, text, false)
      setState('idle')
      return
    }
    setState('writing')
    try {
      const r = await api.aiWrite({ kind: 'voice', field: 'progress', text, task })
      onFields?.(r.fields || { progress: text }, text, true)
    } catch (e) {
      // The words are not lost: they go in as heard, and the member is told.
      onFields?.({ progress: text }, text, false)
      setError(`The AI could not fill in the fields (${e.message}), so what you said is in the progress box as it was heard.`)
    } finally {
      setState('idle')
    }
  }

  const start = () => {
    setError(null)
    setHeard('')
    said.current = ''
    stopped.current = false
    const r = new Recognition()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    r.onresult = (ev) => {
      let final = ''
      let interim = ''
      for (let i = 0; i < ev.results.length; i++) {
        const t = ev.results[i][0]?.transcript || ''
        if (ev.results[i].isFinal) final += t; else interim += t
      }
      said.current = `${final} ${interim}`.trim()
      setHeard(said.current)
    }
    r.onerror = (ev) => {
      if (ev.error === 'aborted') return
      setError(ERRORS[ev.error] || `Speech could not be turned into text (${ev.error}).`)
    }
    // Ends on Stop, or by itself after a pause: either way, what was said is used.
    r.onend = () => { finish() }
    rec.current = r
    try {
      r.start()
      setState('listening')
    } catch (e) {
      setError(`The microphone could not start: ${e.message}`)
      rec.current = null
    }
  }
  const stop = () => {
    stopped.current = true
    try { rec.current?.stop() } catch { /* already stopped */ }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }} data-voice>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {state === 'listening' ? (
          <Button size="small" variant="contained" color="error" startIcon={<StopIcon />} onClick={stop} data-voice-stop>
            Stop
          </Button>
        ) : (
          <Tooltip title="Say what happened on it this week — whether it is finished, why not, what is in the way, any decision needed. The browser turns your voice into text (Chrome uses Google, Edge uses Microsoft); the Lotus AI then fills in the fields below for you to check. Nothing goes to Jira until you press Submit.">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={state === 'writing' ? <CircularProgress size={14} /> : <MicIcon />}
                onClick={start}
                disabled={disabled || state === 'writing'}
                data-voice-start
                sx={{ color: 'text.primary', borderColor: 'divider' }}
              >
                {state === 'writing' ? 'Writing it up…' : 'Speak update'}
              </Button>
            </span>
          </Tooltip>
        )}
        <ToggleButtonGroup size="small" exclusive value={lang} onChange={(_e, v) => pickLang(v)} disabled={state !== 'idle' || disabled} aria-label="language spoken">
          {LANGS.map(([v, label]) => (
            <ToggleButton key={v} value={v} sx={{ px: 1, py: 0.25, fontSize: '0.75rem', textTransform: 'none' }} data-voice-lang={v}>{label}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {state === 'listening' ? 'Listening… press Stop when you have finished.'
            : state === 'writing' ? 'The Lotus AI is filling in the fields.'
              : aiOn ? 'Speak in Thai or English; the AI fills in the fields for you to check.' : 'Speak in Thai or English; what you say goes into the progress box.'}
        </Typography>
      </Box>
      {state === 'listening' && heard && (
        <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', pl: 0.5 }} data-voice-heard>{heard}</Typography>
      )}
      {error && <Typography variant="caption" sx={{ color: 'error.main' }} data-voice-error>{error}</Typography>}
    </Box>
  )
}
