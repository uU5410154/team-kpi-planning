/**
 * A VISIBLE FOCUS RING for keyboard users: a muted outline in the primary
 * colour around a button, a toggle or a link that has keyboard focus. MUI
 * marks keyboard focus with .Mui-focusVisible; plain elements use
 * :focus-visible. A mouse click shows nothing.
 */
export const focusRingSx = {
  '&.Mui-focusVisible, &:focus-visible': {
    outline: '2px solid',
    outlineColor: 'primary.light',
    outlineOffset: 2,
    zIndex: 1,
  },
}
