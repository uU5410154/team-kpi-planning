import { keyframes } from '@emotion/react'

/**
 * A SINGLE SOFT FADE on what somebody was just sent to — the next thing to
 * do, or the row a link pointed at: the primary tint, once, fading out over
 * 1.2s. No ring and no repeat (docs/DESIGN.md §1.6), and nothing at all for
 * anyone who has asked their system for less motion.
 *
 * Drawn as an inset shade over the element's own background, so a filled
 * button keeps its colour underneath. Called with the theme, as before:
 * `sx={[base, on && pulseSx]}`.
 */
const fade = keyframes`
  from { box-shadow: inset 0 0 0 999px var(--pulse-tint); }
  to   { box-shadow: inset 0 0 0 999px transparent; }
`

export const pulseSx = (t) => ({
  '--pulse-tint': t.palette.primary.tint || 'rgba(61,111,217,0.14)',
  animation: `${fade} 1.2s ease-out 1`,
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
})
