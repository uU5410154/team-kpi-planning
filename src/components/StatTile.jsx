import { useState } from 'react'
import {
  Box, Paper, Typography, Tooltip, IconButton, TextField,
} from '@mui/material'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import UndoIcon from '@mui/icons-material/Undo'
import { StatusPill } from './ui.jsx'

/**
 * A headline number with its label and a line of context (docs/DESIGN.md §6).
 * Deliberately not a chart — a single current value reads better as a figure
 * than as a one-bar bar chart.
 *
 * The figure itself is always in the text colour. `tone` (good / warning /
 * critical) says how it stands with a small dot beside the label, never by
 * colouring the number.
 *
 * `override` turns the tile into an editable one: `override.value` is what the
 * register calculates, `override.current` what the card is claiming, and
 * `override.on` says which of the two is being shown. Reverting restores the
 * calculated figure rather than re-deriving it, so the number that comes back
 * is provably the one that was there before.
 */
const TONE = { good: 'success', critical: 'danger', warning: 'warning' }

export default function StatTile({
  label, value, unit, context, tone, help, hero = false, override,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const toneKey = TONE[tone] || null

  const commit = () => {
    setEditing(false)
    const t = String(draft).replace(/[,\s฿]/g, '').trim()
    if (t === '') { override.onChange(null); return }
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0) override.onChange(n)
  }

  const empty = value === null || value === undefined || value === '' || value === '—'

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 3, sm: 4 },
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
      }}
    >
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, minHeight: 20,
      }}
      >
        {toneKey && (
          <Box
            aria-hidden
            sx={(t) => ({
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: t.palette.tone[toneKey].solid,
            })}
          />
        )}
        <Typography variant="subtitle2" component="div" noWrap sx={{ color: 'text.secondary', minWidth: 0 }}>
          {label}
        </Typography>
        {help && (
          <Tooltip title={help} placement="top">
            <InfoOutlinedIcon tabIndex={0} aria-label={`About ${label}`} sx={{ fontSize: 14, color: 'text.tertiary', cursor: 'help', flexShrink: 0 }} />
          </Tooltip>
        )}
        {override && (
          <Box sx={{
            ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5,
          }}
          >
            {override.on && <StatusPill tone="warning">Manual</StatusPill>}
            <Tooltip title={override.editHelp || 'Type a figure over the calculated one'}>
              <IconButton
                size="small"
                aria-label={`override ${label}`}
                sx={{ p: 0.5, color: 'text.secondary' }}
                onClick={() => { setDraft(String(override.current ?? '')); setEditing(true) }}
              >
                <EditOutlinedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            {override.on && (
              <Tooltip title={`Revert to the calculated ${override.calcLabel ?? 'figure'}`}>
                <IconButton
                  size="small"
                  aria-label={`revert ${label}`}
                  sx={{ p: 0.5, color: 'text.secondary' }}
                  onClick={() => { setEditing(false); override.onChange(null) }}
                >
                  <UndoIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )}
      </Box>
      <Box sx={{
        display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', minWidth: 0,
      }}
      >
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
            helperText="Leave blank to revert"
            inputProps={{ 'aria-label': `${label} value`, style: { fontSize: '1.125rem', fontWeight: 600 } }}
            sx={{ width: 160 }}
          />
        ) : (
          <Typography
            component="div"
            variant={hero ? 'figure' : 'figureSm'}
            sx={{ color: empty ? 'text.tertiary' : 'text.primary', minWidth: 0 }}
          >
            {empty ? '—' : value}
          </Typography>
        )}
        {unit && (
          <Typography variant="body2" component="div" sx={{ color: 'text.secondary' }}>
            {unit}
          </Typography>
        )}
      </Box>
      {context && (
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
          {context}
        </Typography>
      )}
      {override?.on && (
        <Typography variant="caption" component="div" sx={(t) => ({ color: t.palette.tone.warning.fg })}>
          Typed over {override.calcLabel}. The project register still says the calculated figure.
        </Typography>
      )}
    </Paper>
  )
}
