import { useState } from 'react'
import {
  Box, Paper, Typography, TextField, Button, Alert, Tabs, Tab, InputAdornment, IconButton, Divider,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import * as auth from '../lib/authApi.js'

/**
 * The way in, and the way to ask for a way in.
 *
 * Registering does NOT let anybody in. An address ending @lotuss.com proves
 * somebody works here; it does not say they should see what the team is being
 * appraised on. So an account arrives waiting, and an administrator grants it
 * a role — which is a decision a person makes, once, rather than a rule a
 * domain name enforces.
 */
export default function SignIn({ config, onSignedIn }) {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)

  const domain = config?.domain || '@lotuss.com'
  const clean = email.trim().toLowerCase()
  const emailOk = clean.length > domain.length && clean.endsWith(domain)
  const passOk = password.length >= 8
  const matches = mode === 'in' || password === confirm
  const ready = emailOk && passOk && matches && !busy

  const go = async (e) => {
    e?.preventDefault?.()
    if (!ready) return
    setBusy(true)
    setNote(null)
    try {
      if (mode === 'in') {
        const r = await auth.signIn(clean, password)
        onSignedIn(r.user)
        return
      }
      const r = await auth.register(clean, password)
      setNote({ severity: r.user.status === 'active' ? 'success' : 'info', text: r.message })
      if (r.user.status === 'active') {
        // A bootstrap address is live immediately; no reason to make them type
        // it all again.
        const s = await auth.signIn(clean, password)
        onSignedIn(s.user)
        return
      }
      setMode('in')
      setPassword('')
      setConfirm('')
    } catch (err) {
      setNote({ severity: 'error', text: err.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      p: 2,
      background: (t) => (t.palette.mode === 'dark'
        ? 'radial-gradient(1200px 600px at 50% -10%, rgba(80,120,220,0.18), transparent 60%)'
        : 'radial-gradient(1200px 600px at 50% -10%, rgba(80,120,220,0.12), transparent 60%)'),
    }}
    >
      <Paper variant="outlined" sx={{ p: 4, width: '100%', maxWidth: 440, borderRadius: 3 }}>
        <Typography variant="h2" sx={{ mb: 0.5 }}>F&amp;A Tech 2026</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          The team&rsquo;s objectives, the register behind them, and what has actually landed.
        </Typography>

        <Tabs
          value={mode}
          onChange={(_e, v) => { setMode(v); setNote(null) }}
          sx={{ mb: 2.5, minHeight: 36 }}
        >
          <Tab value="in" label="Sign in" sx={{ minHeight: 36 }} />
          <Tab value="up" label="Register" sx={{ minHeight: 36 }} />
        </Tabs>

        {config && !config.store && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            No database is configured on the server, so there is nowhere to keep accounts. Set{' '}
            <strong>MONGODB_URI</strong> before anybody can sign in.
          </Alert>
        )}

        <Box component="form" onSubmit={go}>
          <TextField
            fullWidth
            size="small"
            label="Work email"
            value={email}
            autoComplete="username"
            onChange={(e) => setEmail(e.target.value)}
            error={!!email && !emailOk}
            helperText={email && !emailOk ? `It has to end ${domain}.` : ' '}
            sx={{ mb: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Password"
            type={show ? 'text' : 'password'}
            value={password}
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            onChange={(e) => setPassword(e.target.value)}
            error={!!password && !passOk}
            helperText={mode === 'up' ? 'At least 8 characters.' : ' '}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setShow((v) => !v)} edge="end" aria-label="show password">
                    {show ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
            sx={{ mb: 1 }}
          />
          {mode === 'up' && (
            <TextField
              fullWidth
              size="small"
              label="Password again"
              type={show ? 'text' : 'password'}
              value={confirm}
              autoComplete="new-password"
              onChange={(e) => setConfirm(e.target.value)}
              error={!!confirm && !matches}
              helperText={confirm && !matches ? 'The two do not match.' : ' '}
              sx={{ mb: 1 }}
            />
          )}

          {note && <Alert severity={note.severity} sx={{ mb: 2 }}>{note.text}</Alert>}

          <Button type="submit" fullWidth variant="contained" disabled={!ready} sx={{ mt: 1 }}>
            {busy ? 'Working…' : (mode === 'in' ? 'Sign in' : 'Create account')}
          </Button>
        </Box>

        <Divider sx={{ my: 3 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.6 }}>
          {mode === 'in'
            ? <>New here? Register with your {domain} address. An administrator approves the account and decides what
              it can see — registering on its own does not let anybody in.</>
            : <>Registering creates an account that <strong>waits</strong>. An administrator approves it and grants a
              role: a team member sees the register, the scorecards, the team, the timeline and the apps; an
              administrator sees everything, including the model behind the numbers.</>}
        </Typography>
      </Paper>
    </Box>
  )
}
