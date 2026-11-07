import { Box, IconButton, Tooltip, Typography, Button } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  weekOf, addWeeks, weekNo, weekTitle,
} from '../lib/weekly.js'

/**
 * WHICH WEEK THE DASHBOARD SHOWS: back and forward a week, and straight back
 * to this one. `week` null means this week. Drawn as a 32px segmented
 * control — a sunk track with the week in the middle.
 *
 * `onWeekChange` is accepted as another name for `onChange`.
 */
export default function WeekSwitcher({
  week, onChange, onWeekChange, compact = false,
}) {
  const set = onChange || onWeekChange
  const current = weekOf()
  const shown = week || current
  const isNow = shown === current
  const go = (n) => {
    const next = addWeeks(shown, n)
    set?.(next === current ? null : next)
  }
  const rel = isNow ? 'this week' : addWeeks(current, -1) === shown ? 'last week' : addWeeks(current, 1) === shown ? 'next week' : ''
  const arrow = { width: 28, height: 28, color: 'text.secondary', '&:hover': { color: 'text.primary', bgcolor: 'bg.surface' } }
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 1, flexShrink: 0,
    }}
    >
      <Box
        data-week-switcher
        sx={{
          display: 'inline-flex', alignItems: 'center', height: 32, p: '2px', borderRadius: '6px', bgcolor: 'bg.subtle', flexShrink: 0,
        }}
      >
        <Tooltip title="Previous week">
          <IconButton size="small" onClick={() => go(-1)} aria-label="previous week" sx={arrow}><ChevronLeftIcon fontSize="small" /></IconButton>
        </Tooltip>
        <Tooltip title={weekTitle(shown)}>
          <Typography
            variant="body1"
            component="div"
            data-week-shown={shown}
            sx={{
              display: 'flex', alignItems: 'baseline', gap: 1, height: 28, lineHeight: '28px', px: 2, whiteSpace: 'nowrap', fontWeight: 500, borderRadius: '4px', bgcolor: 'bg.surface',
            }}
          >
            {compact ? `W${weekNo(shown)}` : `Week ${weekNo(shown)}`}
            {!compact && rel && (
              <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>{rel}</Typography>
            )}
          </Typography>
        </Tooltip>
        <Tooltip title="Next week">
          <IconButton size="small" onClick={() => go(1)} aria-label="next week" sx={arrow}><ChevronRightIcon fontSize="small" /></IconButton>
        </Tooltip>
      </Box>
      {!isNow && (
        <Button variant="text" size="small" onClick={() => set?.(null)} sx={{ minWidth: 0, whiteSpace: 'nowrap' }} data-week-today>
          {compact ? 'Now' : 'Back to this week'}
        </Button>
      )}
    </Box>
  )
}
