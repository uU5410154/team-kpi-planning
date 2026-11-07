import { useCallback, useEffect, useState } from 'react'
import {
  Alert, Box, Button, IconButton, InputAdornment, Paper, Tab, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined'
import * as auth from '../lib/authApi.js'
import { Spinner } from '../components/Loading.jsx'
import { ErrorState } from '../components/ui.jsx'

/*
 * The way in, and the way to ask for a way in.
 *
 * Registering does NOT let anybody in. An address ending @lotuss.com proves
 * somebody works here; it does not say they should see what the team is being
 * appraised on. So an account arrives waiting, and an administrator grants it
 * a role, which is a decision a person makes, once, rather than a rule a
 * domain name enforces.
 */

const DOWN = {
  server: {
    title: 'The server is not reachable right now.',
    body: 'Try again in a minute. If it keeps happening, the app may be restarting.',
  },
  db: {
    title: 'Signing in is not possible right now.',
    body: 'The app cannot reach its database. Try again in a minute.',
  },
  locked: {
    title: 'Signing in is switched off on this server.',
    body: 'The server has no AUTH_SECRET. An administrator has to set it in the Render dashboard.',
  },
}

/* Outages, as opposed to something about what was typed. */
const isOutage = (err) => err instanceof TypeError
  || /cannot reach its database|not possible just now|AUTH_SECRET|^5\d\d\b/i.test(err?.message || '')

/* 40px fields: the small size, given a little more room, label kept centred. */
const field = {
  '& .MuiInputBase-input': { py: '10px' },
  '& .MuiInputLabel-sizeSmall:not(.MuiInputLabel-shrink)': { transform: 'translate(14px, 10px) scale(1)' },
}

export default function SignIn({ config, onSignedIn }) {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  // What the server said about what was typed: shown under the field it is about.
  const [serverError, setServerError] = useState(null)
  const [done, setDone] = useState(null)
  const [down, setDown] = useState(config?.locked ? { ...DOWN.locked } : null)
  const [checking, setChecking] = useState(false)

  const domain = config?.domain || '@lotuss.com'
  const clean = email.trim().toLowerCase()
  const up = mode === 'up'

  /*
   * Ask whether the server and its database answer before anybody types,
   * so an outage is said up front rather than discovered at the button.
   */
  const check = useCallback(async () => {
    if (config?.locked) { setDown({ ...DOWN.locked }); return true }
    setChecking(true)
    try {
      const res = await fetch('/api/health', { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const h = await res.json().catch(() => ({}))
      if (h.store?.configured && h.store.connected === false) { setDown({ ...DOWN.db }); return false }
      setDown(null)
      return true
    } catch {
      setDown({ ...DOWN.server })
      return false
    } finally {
      setChecking(false)
    }
  }, [config?.locked])
  useEffect(() => { check() }, [check])

  const errors = {}
  if (!clean) errors.email = 'Enter your work email.'
  else if (!(clean.length > domain.length && clean.endsWith(domain))) errors.email = `Use your ${domain} address.`
  if (!password) errors.password = up ? 'Choose a password.' : 'Enter your password.'
  else if (up && password.length < 8) errors.password = 'Use at least 8 characters.'
  if (up && password && confirm !== password) errors.confirm = confirm ? 'The two passwords do not match.' : 'Type the password again.'
  const shownErrors = tried ? errors : {}
  const count = Object.keys(errors).length

  const switchMode = (_e, v) => {
    setMode(v)
    setTried(false)
    setServerError(null)
    setDone(null)
  }

  const go = async (e) => {
    e?.preventDefault?.()
    if (busy) return
    setTried(true)
    setServerError(null)
    if (count) return
    setBusy(true)
    setDone(null)
    try {
      if (!up) {
        const r = await auth.signIn(clean, password)
        onSignedIn(r.user)
        return
      }
      const r = await auth.register(clean, password)
      if (r.user.status === 'active') {
        // A bootstrap address is live immediately; no reason to make them type
        // it all again.
        const s = await auth.signIn(clean, password)
        onSignedIn(s.user)
        return
      }
      setDone(r.message)
      setMode('in')
      setTried(false)
      setPassword('')
      setConfirm('')
    } catch (err) {
      if (isOutage(err)) {
        await check()
        setDown((d) => d || { title: 'That did not go through.', body: `${err.message} Try again in a minute.` })
      } else {
        const msg = err.message
        // Sign-in errors (wrong password, waiting for approval) sit under the
        // password; a register error goes beside the field it is about.
        const where = !up || (/password/i.test(msg) && !/address|email/i.test(msg)) ? 'password' : 'email'
        setServerError({ where, msg })
      }
    } finally {
      setBusy(false)
    }
  }

  const helper = (key, fallback = undefined) => {
    if (shownErrors[key]) return shownErrors[key]
    if (serverError?.where === key) return serverError.msg
    return fallback
  }
  const isError = (key) => !!shownErrors[key] || serverError?.where === key

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        px: { xs: 3, sm: 6 },
        py: { xs: 6, sm: 10 },
        bgcolor: 'bg.page',
      }}
    >
      <Box sx={{ width: '100%', maxWidth: 400 }}>
        <Paper variant="outlined" sx={{ p: { xs: 5, sm: 8 }, borderRadius: '8px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Box
              aria-hidden
              sx={{
                width: 32, height: 32, borderRadius: '6px', bgcolor: 'bg.subtle', border: 1, borderColor: 'border.strong', display: 'grid', placeItems: 'center', flexShrink: 0,
              }}
            >
              <Box sx={{
                width: 13, height: 13, borderRadius: '2px', border: 2, borderColor: 'text.secondary',
              }}
              />
            </Box>
            <Typography variant="h1">F&amp;A Tech KPI</Typography>
          </Box>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3 }}>
            {up ? 'Ask for an account with your Lotus’s work email.' : 'Sign in with your Lotus’s work email.'}
          </Typography>

          {down && (
            <Box sx={{ mt: 5 }} data-signin-down>
              {/* The retry sits under the words: beside them, a 400px card squeezes the text. */}
              <ErrorState
                title={down.title}
                body={(
                  <>
                    {down.body}
                    {!config?.locked && (
                      <Box component="span" sx={{ display: 'block', mt: 2 }}>
                        <Button
                          variant="outlined"
                          color="inherit"
                          onClick={check}
                          disabled={checking}
                          startIcon={checking ? <Spinner size={14} /> : null}
                          sx={{ color: 'text.primary' }}
                        >
                          {checking ? 'Checking…' : 'Try again'}
                        </Button>
                      </Box>
                    )}
                  </>
                )}
              />
            </Box>
          )}

          <Tabs
            value={mode}
            onChange={switchMode}
            aria-label="Sign in or register"
            sx={{ mt: 5, borderBottom: 1, borderColor: 'border.subtle' }}
          >
            <Tab value="in" label="Sign in" sx={{ px: 0, mr: 6 }} />
            <Tab value="up" label="Register" sx={{ px: 0 }} />
          </Tabs>

          {done && (
            <Alert severity="success" onClose={() => setDone(null)} sx={{ mt: 5 }} data-signin-done>
              {done}
            </Alert>
          )}

          {config && !config.store && (
            <Alert severity="warning" sx={{ mt: 5 }}>
              No database is configured on the server, so there is nowhere to keep accounts. Set
              {' '}
              <strong>MONGODB_URI</strong>
              {' '}
              before anybody can sign in.
            </Alert>
          )}

          <Box component="form" onSubmit={go} noValidate sx={{ mt: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <TextField
              fullWidth
              size="small"
              label="Work email"
              type="email"
              value={email}
              autoComplete="username"
              inputMode="email"
              onChange={(e) => { setEmail(e.target.value); if (serverError?.where === 'email') setServerError(null) }}
              error={isError('email')}
              helperText={helper('email')}
              placeholder={`name${domain}`}
              sx={field}
            />
            <TextField
              fullWidth
              size="small"
              label="Password"
              type={show ? 'text' : 'password'}
              value={password}
              autoComplete={up ? 'new-password' : 'current-password'}
              onChange={(e) => { setPassword(e.target.value); if (serverError?.where === 'password') setServerError(null) }}
              error={isError('password')}
              helperText={helper('password', up ? 'At least 8 characters.' : undefined)}
              sx={field}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={show ? 'Hide password' : 'Show password'}>
                      <IconButton
                        onClick={() => setShow((v) => !v)}
                        edge="end"
                        aria-label={show ? 'hide password' : 'show password'}
                        sx={{ width: { xs: 40, sm: 32 }, height: { xs: 40, sm: 32 }, color: 'text.secondary' }}
                      >
                        {show ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
            {up && (
              <TextField
                fullWidth
                size="small"
                label="Password again"
                type={show ? 'text' : 'password'}
                value={confirm}
                autoComplete="new-password"
                onChange={(e) => setConfirm(e.target.value)}
                error={isError('confirm')}
                helperText={helper('confirm')}
                sx={field}
              />
            )}

            <Button
              type="submit"
              fullWidth
              variant="contained"
              aria-busy={busy || undefined}
              disabled={busy}
              startIcon={busy ? <Box component="span" data-loading sx={{ display: 'inline-flex' }}><Spinner size={14} /></Box> : null}
              sx={{
                mt: 1,
                minHeight: 40,
                '&.Mui-disabled': { bgcolor: 'primary.main', color: '#fff', opacity: 0.75 },
              }}
            >
              {busy ? (up ? 'Creating account…' : 'Signing in…') : (up ? 'Create account' : 'Sign in')}
            </Button>
            {tried && count >= 2 && (
              <Typography variant="body2" role="alert" sx={{ color: 'error.main', mt: 1 }}>
                {`Fix the ${count} marked fields.`}
              </Typography>
            )}
          </Box>

          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 6, maxWidth: '72ch' }}>
            {up
              ? 'A new account waits until an administrator approves it and chooses what it can see.'
              : `New here? Register with your ${domain} address, then wait for an administrator to approve it.`}
          </Typography>
        </Paper>
      </Box>
    </Box>
  )
}
