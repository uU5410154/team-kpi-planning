import { keyframes } from '@emotion/react'
import { alpha } from '@mui/material/styles'

/**
 * A SOFT PULSE for the one button that is the next thing to do: a ring that
 * grows out of the button and fades, every couple of seconds. Quiet enough
 * for the dark, muted look, and off for anyone who has asked their system for
 * less motion.
 */
const ring = keyframes`
  0%   { box-shadow: 0 0 0 0 var(--pulse-ring); }
  70%  { box-shadow: 0 0 0 9px transparent; }
  100% { box-shadow: 0 0 0 0 transparent; }
`

export const pulseSx = (t) => ({
  '--pulse-ring': alpha(t.palette.primary.main, 0.6),
  animation: `${ring} 1.8s ease-out infinite`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
})
