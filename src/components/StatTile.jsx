import { useState } from 'react'
import { Box, Paper, Typography, Tooltip, IconButton, TextField, Chip } from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import UndoIcon from '@mui/icons-material/Undo'
import { STATUS } from '../lib/palette.js'

/**
 * A headline number with optional context line. Deliberately not a chart —
 * a single current value reads better as a tile than as a one-bar bar chart.
 */
/**
 * A headline number that can be typed over.
 *
 * `override` turns the tile into an editable one: `override.value` is what the
 * register calculates, `override.current` what the card is claiming, and
 * `override.on` says which of the two is being shown. Reverting restores the
 * calculated figure rather than re-deriving it, so the number that comes back
 * is provably the one that was there before.
 */
export default function StatTile({ label, value, unit, context, tone, help, hero = false, override }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const toneColor =
    tone === 'good' ? STATUS.good : tone === 'critical' ? STATUS.critical : tone === 'warning' ? STATUS.warning : null

  const commit = () => {
    setEditing(false)
    const t = String(draft).replace(/[,\s฿]/g, '').trim()
    if (t === '') { override.onChange(null); return }
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0) override.onChange(n)
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
          {label}
        </Typography>
        {help && (
          <Tooltip title={help} arrow placement="top">
            <InfoOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled', cursor: 'help' }} />
          </Tooltip>
        )}
        {override && (
          <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.25 }}>
            {override.on && (
              <Chip
                size="small"
                label="manual"
                color="warning"
                variant="outlined"
                sx={{ height: 18, fontSize: '0.625rem', fontWeight: 700 }}
              />
            )}
            <Tooltip title={override.editHelp || 'Type a figure over the calculated one'}>
              <IconButton
                size="small"
                aria-label={`override ${label}`}
                sx={{ p: 0.25 }}
                onClick={() => { setDraft(String(override.current ?? '')); setEditing(true) }}
              >
                <EditOutlinedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            {override.on && (
              <Tooltip title={`Revert to the calculated ${override.calcLabel ?? 'figure'}`}>
                <IconButton
                  size="small"
                  aria-label={`revert ${label}`}
                  sx={{ p: 0.25 }}
                  onClick={() => { setEditing(false); override.onChange(null) }}
                >
                  <UndoIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        {editing ? (
          <TextField
            autoFocus
            size="small"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setEditing(false)
            }}
            placeholder={String(override.calc ?? '')}
            helperText="blank to revert"
            inputProps={{ 'aria-label': `${label} value`, style: { fontSize: '1.25rem', fontWeight: 600, padding: '4px 8px' } }}
            sx={{ width: 160 }}
          />
        ) : (
          <Typography
            component="div"
            sx={{
              fontSize: hero ? '2.75rem' : '1.75rem',
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              color: override?.on ? STATUS.warning : (toneColor || 'text.primary'),
            }}
          >
            {value}
          </Typography>
        )}
        {unit && (
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
            {unit}
          </Typography>
        )}
      </Box>
      {context && (
        <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1, display: 'block' }}>
          {context}
        </Typography>
      )}
      {override?.on && (
        <Typography variant="caption" sx={{ color: STATUS.warning, display: 'block', fontWeight: 600 }}>
          typed over {override.calcLabel} — the project register still says so
        </Typography>
      )}
    </Paper>
  )
}
