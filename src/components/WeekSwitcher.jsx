import { Box, IconButton, Tooltip, Typography, Button } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import {
  weekOf, addWeeks, weekNo, weekTitle,
} from '../lib/weekly.js'

/**
 * WHICH WEEK THE DASHBOARD SHOWS, in the top bar: back and forward a week,
 * and straight back to this one. `week` null means this week.
 */
export default function WeekSwitcher({ week, onChange, compact = false }) {
  const current = weekOf()
  const shown = week || current
  const isNow = shown === current
  const go = (n) => {
    const next = addWeeks(shown, n)
    onChange(next === current ? null : next)
  }
  return (
    <Box
      data-week-switcher
      sx={{
        display: 'flex', alignItems: 'center', flexShrink: 0, border: 1, borderColor: 'divider', borderRadius: 2, pl: 0.25, pr: 0.25,
      }}
    >
      <Tooltip title="Previous week">
        <IconButton size="small" onClick={() => go(-1)} aria-label="previous week"><ChevronLeftIcon fontSize="small" /></IconButton>
      </Tooltip>
      <Tooltip title={weekTitle(shown)}>
        <Typography variant="body2" sx={{ fontWeight: 650, px: 0.5, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} data-week-shown={shown}>
          {compact ? `W${weekNo(shown)}` : `Week ${weekNo(shown)}`}
          {!compact && (
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.75 }}>
              {isNow ? 'this week' : addWeeks(current, -1) === shown ? 'last week' : addWeeks(current, 1) === shown ? 'next week' : ''}
            </Typography>
          )}
        </Typography>
      </Tooltip>
      <Tooltip title="Next week">
        <IconButton size="small" onClick={() => go(1)} aria-label="next week"><ChevronRightIcon fontSize="small" /></IconButton>
      </Tooltip>
      {!isNow && (
        <Button size="small" onClick={() => onChange(null)} sx={{ minWidth: 0, px: 1, whiteSpace: 'nowrap' }} data-week-today>
          {compact ? 'Now' : 'This week'}
        </Button>
      )}
    </Box>
  )
}
