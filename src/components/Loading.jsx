import { Box, CircularProgress, Typography } from '@mui/material'

/**
 * WHILE SOMETHING LOADS: a small spinner and what it is waiting for, so a
 * page never shows "nothing here" when it simply has not heard back yet.
 *
 *   inline   one line, for a table cell or beside a heading
 *   block    centred in its space, for a card or a whole page
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
        gap: 1,
        color: 'text.secondary',
        ...(block && { justifyContent: 'center', py: 5, flexDirection: 'column', gap: 1.5 }),
      }}
    >
      <CircularProgress size={size || (block ? 28 : 14)} thickness={block ? 4 : 5} sx={{ color: 'text.secondary' }} />
      <Typography variant={block ? 'body2' : 'caption'} sx={{ color: 'text.secondary' }}>{label}</Typography>
    </Box>
  )
}
