import { Box, CircularProgress, Typography } from '@mui/material'

export { SectionSkeleton } from './ui.jsx'

/**
 * A spinner whose arc keeps its length (disableShrink) and runs over a faint
 * ring, so it reads as a spinner at any moment it is looked at, never as a
 * stray dot.
 */
export function Spinner({ size = 14 }) {
  const thickness = size >= 20 ? 3.6 : 4.5
  return (
    <Box sx={{
      position: 'relative', width: size, height: size, flexShrink: 0, display: 'inline-flex',
    }}
    >
      <CircularProgress
        variant="determinate"
        value={100}
        size={size}
        thickness={thickness}
        aria-hidden
        sx={{ position: 'absolute', inset: 0, color: 'border.subtle' }}
      />
      <CircularProgress
        disableShrink
        size={size}
        thickness={thickness}
        aria-hidden
        sx={{ position: 'absolute', inset: 0, color: 'text.secondary', animationDuration: '900ms' }}
      />
    </Box>
  )
}

/**
 * WHILE SOMETHING LOADS: a spinner and what it is waiting for, so a page
 * never shows "nothing here" when it simply has not heard back yet.
 *
 *   inline   14px, one line, for a table cell or beside a heading
 *   block    24px, centred in its space, for a card or a whole page
 *
 * For a page or a table, prefer SectionSkeleton: the shape of what is coming.
 */
export default function Loading({ label = 'Loading…', variant = 'inline', size }) {
  const block = variant === 'block'
  return (
    <Box
      role="status"
      aria-live="polite"
      data-loading
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        color: 'text.secondary',
        minWidth: 0,
        ...(block && {
          justifyContent: 'center', py: 6, flexDirection: 'column', gap: 2,
        }),
      }}
    >
      <Spinner size={size || (block ? 24 : 14)} />
      <Typography variant={block ? 'body2' : 'caption'} sx={{ color: 'text.secondary', whiteSpace: block ? 'normal' : 'nowrap' }}>{label}</Typography>
    </Box>
  )
}
