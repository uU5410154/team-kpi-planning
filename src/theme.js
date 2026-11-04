import { createTheme, alpha } from '@mui/material/styles'

/*
 * THE CHROME: deep navy under a violet glow, one bright blue for whatever can
 * be pressed, and soft-cornered panels with a hairline edge.
 *
 * Chrome colours only. Data ink — the series colours, the status colours —
 * lives in lib/palette.js and is deliberately not restyled with the chrome:
 * those were validated for colour-blind contrast and a mood board is not a
 * reason to undo that.
 *
 * Dark is the mode the app opens in and the one this was designed for. Light
 * is the same palette turned over — lavender-white surfaces, the same blue —
 * so switching modes reads as the same product rather than a different one.
 */

// Kept under its old name: the Excel export and a few pages import it, and the
// workbook's own colours are a separate decision from the app's.
const NAVY = {
  900: '#051c2c',
  800: '#0a2a3f',
  700: '#0f3b57',
  600: '#134a6e',
  500: '#1b6091',
  300: '#5b8aa8',
  100: '#d7e2ea',
}

/** The surfaces, named once so the sidebar, the header and the pages agree. */
export const SURFACE = {
  dark: {
    page: '#080b26',
    panel: '#0f1338',
    raised: '#151a47',
    rail: '#0b0f2e',
    edge: 'rgba(129, 140, 248, 0.16)',
    glow: 'rgba(124, 58, 237, 0.42)',
    glow2: 'rgba(59, 91, 255, 0.28)',
  },
  light: {
    page: '#f2f3fb',
    panel: '#ffffff',
    raised: '#f7f7fe',
    rail: '#ffffff',
    edge: 'rgba(30, 35, 90, 0.10)',
    glow: 'rgba(124, 58, 237, 0.10)',
    glow2: 'rgba(59, 91, 255, 0.08)',
  },
}

const BLUE = '#4f6bff'
const BLUE_DEEP = '#3a52e8'

const shared = (mode) => {
  const s = SURFACE[mode]
  const dark = mode === 'dark'
  return {
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
      h1: { fontSize: '2rem', fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.015em' },
      h3: { fontSize: '1.125rem', fontWeight: 650, letterSpacing: '-0.01em' },
      h4: { fontSize: '1rem', fontWeight: 650 },
      subtitle2: { fontSize: '0.72rem', fontWeight: 650, letterSpacing: '0.08em', textTransform: 'uppercase' },
      body2: { fontSize: '0.875rem', lineHeight: 1.55 },
      caption: { fontSize: '0.75rem', lineHeight: 1.45 },
    },
    /*
     * The base unit stays at 4. Pages size their own shapes as multiples of it
     * — a Timeline bar is 0.5, a tile is 1 — and raising it would have rounded
     * every one of those at once. The soft corners are given to the components
     * that should have them, below, in pixels.
     */
    shape: { borderRadius: 4 },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            WebkitFontSmoothing: 'antialiased',
            backgroundColor: s.page,
            /*
             * The glow: violet from the top left, blue from the top right,
             * fading into the navy. Fixed, so it stays behind the work as the
             * page scrolls instead of scrolling away with the first screen.
             */
            backgroundImage: `radial-gradient(1100px 560px at 12% -8%, ${s.glow}, transparent 62%),`
              + ` radial-gradient(900px 480px at 100% -4%, ${s.glow2}, transparent 60%)`,
            backgroundAttachment: 'fixed',
            backgroundRepeat: 'no-repeat',
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: 14 },
          outlined: {
            borderColor: s.edge,
            // A faint lift at the top edge, as on the reference: panels read
            // as lit from above rather than as flat cut-outs.
            ...(dark && { backgroundImage: `linear-gradient(180deg, ${alpha(BLUE, 0.05)} 0%, transparent 140px)` }),
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 650, borderRadius: 10 },
          containedPrimary: {
            boxShadow: dark ? `0 6px 18px ${alpha(BLUE, 0.35)}` : `0 4px 12px ${alpha(BLUE, 0.25)}`,
            '&:hover': { boxShadow: dark ? `0 8px 22px ${alpha(BLUE, 0.45)}` : `0 6px 16px ${alpha(BLUE, 0.3)}` },
          },
          outlined: { borderColor: s.edge },
        },
      },
      MuiIconButton: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            backgroundColor: dark ? alpha('#ffffff', 0.025) : '#ffffff',
          },
          notchedOutline: { borderColor: s.edge },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          root: { fontVariantNumeric: 'tabular-nums', paddingTop: 8, paddingBottom: 8, borderColor: s.edge },
          head: { fontWeight: 650, fontSize: '0.72rem', letterSpacing: '0.05em', textTransform: 'uppercase' },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 650, fontSize: '0.6875rem', borderRadius: 8 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontSize: '0.75rem',
            lineHeight: 1.5,
            maxWidth: 320,
            borderRadius: 8,
            backgroundColor: dark ? '#1c2257' : '#1e2350',
            border: `1px solid ${dark ? s.edge : 'transparent'}`,
          },
        },
      },
      MuiMenu: {
        styleOverrides: { paper: { border: `1px solid ${s.edge}`, backgroundColor: s.raised } },
      },
      MuiPopover: { styleOverrides: { paper: { backgroundColor: s.raised } } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', borderColor: s.edge, borderRadius: 10 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 12 } } },
      MuiDivider: { styleOverrides: { root: { borderColor: s.edge } } },
      MuiLinearProgress: { styleOverrides: { root: { borderRadius: 4 } } },
      // On a phone a dialog keeps a 12px margin instead of 32px, so a 390px
      // screen gives it 366px to work with rather than 326px.
      MuiDialog: {
        styleOverrides: {
          paper: ({ theme }) => ({
            backgroundColor: s.raised,
            border: `1px solid ${s.edge}`,
            borderRadius: 16,
            [theme.breakpoints.down('sm')]: {
              margin: 12,
              width: 'calc(100% - 24px)',
              maxWidth: 'calc(100% - 24px)',
              maxHeight: 'calc(100% - 24px)',
            },
          }),
        },
      },
      MuiDrawer: { styleOverrides: { paper: { backgroundImage: 'none' } } },
    },
  }
}

export const buildTheme = (mode) => {
  const s = SURFACE[mode]
  return createTheme({
    ...shared(mode),
    palette:
      mode === 'dark'
        ? {
            mode: 'dark',
            primary: { main: BLUE, dark: BLUE_DEEP, light: '#8195ff', contrastText: '#ffffff' },
            secondary: { main: '#a855f7' },
            background: { default: s.page, paper: s.panel },
            text: { primary: '#eef0ff', secondary: '#a5aad6', disabled: 'rgba(238,240,255,0.38)' },
            divider: s.edge,
            action: {
              hover: 'rgba(129, 140, 248, 0.08)',
              selected: 'rgba(99, 102, 241, 0.18)',
            },
          }
        : {
            mode: 'light',
            primary: { main: BLUE_DEEP, dark: '#2b3fc4', light: BLUE, contrastText: '#ffffff' },
            secondary: { main: '#7c3aed' },
            background: { default: s.page, paper: s.panel },
            text: { primary: '#13163a', secondary: '#575c84' },
            divider: s.edge,
            action: {
              hover: 'rgba(58, 82, 232, 0.05)',
              selected: 'rgba(58, 82, 232, 0.10)',
            },
          },
  })
}

export { NAVY }
