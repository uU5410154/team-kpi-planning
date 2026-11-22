import { useEffect, useState } from 'react'
import { Box, Paper, Typography, TextField, Tooltip } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

/*
 * The small pieces the governance pages share: a framed section, a headline
 * figure, a number box that saves when you leave it, and the CP AXTRA tones
 * for the few marks that carry meaning.
 */

export const TONE = { good: '#43938f', warn: '#c8961f', bad: '#da3832', blue: '#306fc7', muted: '#7b8aa0' }

export function Section({ title, subtitle, action, children, sx, ...rest }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 1.5, sm: 2.25 }, minWidth: 0, ...sx }} {...rest}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 220 }}>
          <Typography variant="h4">{title}</Typography>
          {subtitle && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.25 }}>{subtitle}</Typography>}
        </Box>
        {action}
      </Box>
      {children}
    </Paper>
  )
}

export function Stat({ label, value, note, tone, help, gap, ...rest }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.75, minHeight: 112, display: 'flex', flexDirection: 'column' }} {...rest}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontSize: '0.68rem' }}>{label}</Typography>
        {help && (
          <Tooltip title={help}>
            <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled', cursor: 'help', ml: 0.5 }} aria-label={`about ${label}`} />
          </Tooltip>
        )}
      </Box>
      <Typography sx={{ fontSize: '1.6rem', fontWeight: 700, mt: 0.5, color: tone || 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </Typography>
      {gap && <Typography variant="caption" sx={{ color: TONE.warn, fontWeight: 600 }}>{gap}</Typography>}
      {note && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{note}</Typography>}
    </Paper>
  )
}

export const parseNum = (t) => {
  const s = String(t ?? '').replace(/[,\s฿%]/g, '')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}

/**
 * A number that saves when you leave it (or press Enter), and only when it
 * changed. `onCommit(next, prev)`.
 */
export function NumField({ value, onCommit, label, width = 110, suffix, disabled, ...rest }) {
  const fmt = (v) => (v == null ? '' : String(v))
  const [t, setT] = useState(fmt(value))
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setT(fmt(value)) }, [value, editing])
  const bad = Number.isNaN(parseNum(t))
  return (
    <TextField
      size="small"
      label={label}
      value={t}
      disabled={disabled}
      error={bad}
      onFocus={() => setEditing(true)}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => {
        setEditing(false)
        const n = parseNum(t)
        if (Number.isNaN(n)) { setT(fmt(value)); return }
        if (n !== (value ?? null)) onCommit(n, value ?? null)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      InputProps={suffix ? { endAdornment: <Typography variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>{suffix}</Typography> } : undefined}
      inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, 'aria-label': rest['aria-label'] || label }}
      sx={{ width }}
      {...rest}
    />
  )
}

/** A text box that saves when you leave it. */
export function TextCommit({ value, onCommit, ...rest }) {
  const [t, setT] = useState(value || '')
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setT(value || '') }, [value, editing])
  return (
    <TextField
      size="small"
      value={t}
      onFocus={() => setEditing(true)}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => { setEditing(false); if (t !== (value || '')) onCommit(t, value || '') }}
      onKeyDown={(e) => { if (e.key === 'Enter' && !rest.multiline) e.currentTarget.blur() }}
      {...rest}
    />
  )
}

export const money = (n, sym = '฿') => {
  if (n == null || !Number.isFinite(n)) return '—'
  const a = Math.abs(n)
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M` : a >= 1e3 ? `${Math.round(a / 1e3).toLocaleString()}k` : Math.round(a).toLocaleString()
  return `${n < 0 ? '−' : ''}${sym}${s}`
}
export const moneyFull = (n, sym = '฿') => (n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '−' : ''}${sym}${Math.round(Math.abs(n)).toLocaleString()}`)
export const pctOf = (n) => (n == null || !Number.isFinite(n) ? '—' : `${n >= 0 ? '+' : '−'}${Math.round(Math.abs(n) * 100)}%`)
export const signedMoney = (n, sym = '฿') => (n == null ? '—' : `${n > 0 ? '+' : ''}${money(n, sym)}`)

export const PageHead = ({ title, children }) => (
  <Box>
    <Typography variant="h2">{title}</Typography>
    {children && <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 900 }}>{children}</Typography>}
  </Box>
)
