import { useEffect, useState } from 'react'
import {
  Paper, Typography, Alert, Button, Box,
} from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import * as api from '../lib/api.js'

/*
 * THE AI, for an administrator: whether the Lotus LLM is reachable with the
 * key on the server, and a one-click test that asks it for a single word —
 * so a wrong or expired key shows up here, not in the middle of somebody's
 * Friday report.
 */
export default function AiSettings() {
  const [st, setSt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  useEffect(() => { api.aiStatus().then(setSt).catch((e) => setSt({ configured: false, reason: e.message })) }, [])

  const test = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await api.aiTest()
      setResult({ ok: true, text: `It answered “${r.reply}” in ${(r.ms / 1000).toFixed(1)} s.` })
    } catch (e) {
      setResult({ ok: false, text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.5 }, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Box>
        <Typography variant="h4" sx={{ mb: 0.5 }}>AI (Lotus LLM)</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Helps members write their week, writes the weekly summary after each deadline, and answers the
          administrators&rsquo; questions. Called from the server only; the key never reaches a browser.
        </Typography>
      </Box>
      {st && (st.configured
        ? <Alert severity="success" sx={{ py: 0.25 }}>Connected — model “{st.model}”.</Alert>
        : (
          <Alert severity="warning">
            The AI is off: {st.reason} In the Render dashboard, under Environment, add <strong>LOTUS_API_KEY</strong> with a key
            from the Lotus platform team. Everything else works without it.
          </Alert>
        ))}
      <Box>
        <Button variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={test} disabled={busy || !st?.configured}>
          {busy ? 'Asking…' : 'Test the AI'}
        </Button>
      </Box>
      {result && <Alert severity={result.ok ? 'success' : 'error'} onClose={() => setResult(null)}>{result.text}</Alert>}
    </Paper>
  )
}
