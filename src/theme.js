import { createTheme } from '@mui/material/styles'

// Restrained consulting-report chrome: deep navy, hairline rules, generous
// whitespace, tabular figures in every table. Chrome colours only — data ink
// lives in lib/palette.js.
const NAVY = {
  900: '#051c2c',
  800: '#0a2a3f',
  700: '#0f3b57',
  600: '#134a6e',
  500: '#1b6091',
  300: '#5b8aa8',
  100: '#d7e2ea',
}

const shared = {
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    h1: { fontSize: '2rem', fontWeight: 600, letterSpacing: '-0.02em' },
    h2: { fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.015em' },
    h3: { fontSize: '1.125rem', fontWeight: 600, letterSpacing: '-0.01em' },
    h4: { fontSize: '1rem', fontWeight: 600 },
    subtitle2: { fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' },
    body2: { fontSize: '0.875rem', lineHeight: 1.55 },
    caption: { fontSize: '0.75rem', lineHeight: 1.45 },
  },
  shape: { borderRadius: 4 },
  components: {
    MuiCssBaseline: {
      styleOverrides: { body: { WebkitFontSmoothing: 'antialiased' } },
    },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600 } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { fontVariantNumeric: 'tabular-nums', paddingTop: 8, paddingBottom: 8 },
        head: { fontWeight: 600, fontSize: '0.75rem', letterSpacing: '0.04em', textTransform: 'uppercase' },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, fontSize: '0.6875rem' } } },
    MuiTooltip: { styleOverrides: { tooltip: { fontSize: '0.75rem', lineHeight: 1.5, maxWidth: 320 } } },
  },
}

export const buildTheme = (mode) =>
  createTheme({
    ...shared,
    palette:
      mode === 'dark'
        ? {
            mode: 'dark',
            primary: { main: '#4d9fd6', dark: '#1b6091', contrastText: '#04141f' },
            secondary: { main: '#c98500' },
            background: { default: '#0d0d0d', paper: '#1a1a19' },
            text: { primary: '#ffffff', secondary: '#c3c2b7' },
            divider: 'rgba(255,255,255,0.12)',
          }
        : {
            mode: 'light',
            primary: { main: NAVY[900], dark: '#04141f', light: NAVY[500], contrastText: '#ffffff' },
            secondary: { main: '#1b6091' },
            background: { default: '#f9f9f7', paper: '#ffffff' },
            text: { primary: '#0b0b0b', secondary: '#52514e' },
            divider: 'rgba(11,11,11,0.12)',
          },
  })

export { NAVY }
