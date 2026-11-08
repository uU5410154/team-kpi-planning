import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, Typography,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import * as api from '../lib/api.js'
import { Spinner } from './Loading.jsx'
import { Section } from './ui.jsx'

/*
 * THE AI, for an administrator: whether the Lotus LLM is reachable with the
 * key on the server, and a one-click test that asks it for a single word,
 * so a wrong or expired key shows up here, not in the middle of somebody's
 * Friday report.
 */
export default function AiSettings({ reloadKey = 0 }) {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const load = useCallback(() => {
    api.aiStatus().then(setSt).catch((e) => setSt({ configured: false, reason: e.message, failed: true }))
  }, [])
  useEffect(() => { load() }, [load, reloadKey])

  const test = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await api.aiTest()
      setResult({ ok: true, text: `It answered “${r.reply}” in ${(r.ms / 1000).toFixed(1)} s.` })
    } catch (e) {
      setResult({ ok: false, text: `The AI did not answer: ${e.message} Check the key, then test again.` })
    } finally {
      setBusy(false)
    }
  }

  const reason = String(st?.reason || '').trim().replace(/\.?$/, '.')

  return (
    <Section
      title="AI (Lotus LLM)"
      meta="Helps members write their week, summarises each week, and answers administrators’ questions. The key stays on the server."
      data-access-ai
      actions={st?.configured ? (
        <Button
          variant="outlined"
          startIcon={busy ? <Spinner size={14} /> : <AutoAwesomeIcon />}
          onClick={test}
          disabled={busy}
        >
          {busy ? 'Asking…' : 'Test the AI'}
        </Button>
      ) : null}
    >
      {!st && (
        <Box role="status" data-loading sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Spinner size={14} />
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>Checking the AI…</Typography>
        </Box>
      )}
      {st && st.configured && (
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Dot tone="success" />
          <Typography variant="body1">
            Connected — model
            {' '}
            <Box component="span" sx={{ fontWeight: 500 }}>{`“${st.model}”`}</Box>
            .
          </Typography>
        </Box>
      )}
      {st && !st.configured && (
        <>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Dot tone="warning" />
            <Typography variant="body1">
              {`The AI is off: ${reason} Everything else works without it.`}
            </Typography>
          </Box>
          <Box sx={{
            mt: 3, p: 3, borderRadius: '6px', bgcolor: 'bg.subtle', maxWidth: '72ch',
          }}
          >
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {st.failed
                ? 'The server did not answer. Refresh the page to check again.'
                : (
                  <>
                    To switch it on, add
                    {' '}
                    <Box component="strong" sx={{ color: 'text.primary', fontWeight: 600 }}>LOTUS_API_KEY</Box>
                    {' '}
                    in the Render dashboard under Environment, with a key from the Lotus platform team.
                  </>
                )}
            </Typography>
          </Box>
        </>
      )}
      {result && (
        <Alert severity={result.ok ? 'success' : 'error'} onClose={() => setResult(null)} sx={{ mt: 3 }}>
          {result.text}
        </Alert>
      )}
    </Section>
  )
}

function Dot({ tone }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(t) => ({
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: t.palette.tone[tone]?.solid, mt: '6px',
      })}
    />
  )
}
