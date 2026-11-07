/**
 * A VISIBLE FOCUS RING for keyboard users (docs/DESIGN.md §1.6): a 2px
 * outline in the primary colour, 2px off the edge, on whatever has keyboard
 * focus. The theme sets the same ring globally; this is for components that
 * draw their own focus state and need it back. A mouse click shows nothing.
 */
export const focusRingSx = {
  '&.Mui-focusVisible, &:focus-visible': {
    outline: '2px solid',
    outlineColor: 'primary.main',
    outlineOffset: 2,
    zIndex: 1,
  },
}
