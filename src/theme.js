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
 * LIGHT is the mode the app opens in, since November 2026 at management's
 * request: white and soft blue (see SURFACE.light). Dark is still one click
 * away on the header's sun/moon button, for whoever prefers it.
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
    page: '#070818',
    panel: '#0d0f26',
    raised: '#13162f',
    rail: '#0a0b1f',
    // The big panel the pages sit in: dark enough to read on, see-through
    // enough that the glow shows at its edges, as on the reference.
    stage: 'rgba(8, 9, 26, 0.86)',
    edge: 'rgba(150, 156, 220, 0.12)',
    glow: 'rgba(110, 70, 220, 0.30)',
    glow2: 'rgba(60, 90, 220, 0.16)',
    glow3: 'rgba(120, 70, 200, 0.14)',
    // The light falling across a card: blue from the top left, a little
    // violet at the far corner.
    sheen: 'linear-gradient(160deg, rgba(120,130,240,0.06) 0%, rgba(120,130,240,0) 45%)',
  },
  /*
   * LIGHT, as management asked (November 2026): white panels on a pale
   * blue-grey page, soft grey hairlines, and the CP AXTRA blue for what can be
   * pressed — the look of the finance Power BI reports, calm rather than
   * bright. No violet glow: a faint blue wash at the top only.
   */
  light: {
    page: '#f3f6fa',
    panel: '#ffffff',
    raised: '#ffffff',
    rail: '#ffffff',
    stage: 'rgba(255, 255, 255, 0.94)',
    edge: 'rgba(32, 58, 100, 0.13)',
    glow: 'rgba(48, 111, 199, 0.07)',
    glow2: 'rgba(48, 111, 199, 0.04)',
    glow3: 'rgba(67, 147, 143, 0.03)',
    sheen: 'none',
    shadow: '0 1px 3px rgba(31, 42, 61, 0.08), 0 6px 18px rgba(31, 42, 61, 0.08)',
  },
}

// One blue for whatever can be pressed — a little quieter than a pure
// electric blue, so a primary button stands out without glaring.
const BLUE = '#5468e0'
const BLUE_DEEP = '#4256c4'
// The light theme's blue: CP AXTRA blue (48, 111, 199), and a deeper shade.
const AXTRA = '#306fc7'
const AXTRA_DEEP = '#255aa3'

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
            backgroundImage: `radial-gradient(1000px 420px at 45% -12%, ${s.glow}, transparent 65%),`
              + ` radial-gradient(800px 520px at 100% 10%, ${s.glow2}, transparent 62%),`
              + ` radial-gradient(700px 600px at -5% 105%, ${s.glow3}, transparent 60%)`,
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
            // Lit glass rather than a flat cut-out: a soft blue sheen from
            // the top left, as on the reference's cards.
            backgroundImage: s.sheen,
            // Light: a soft drop shadow, so a white card stands clear of the
            // pale page (management asked for clearer cards, Nov 2026).
            boxShadow: s.shadow,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', fontWeight: 650, borderRadius: 10 },
          containedPrimary: {
            boxShadow: 'none',
            '&:hover': { boxShadow: 'none', backgroundColor: dark ? BLUE_DEEP : AXTRA_DEEP },
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
            backgroundColor: dark ? '#1c2257' : '#25344d',
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
            primary: { main: BLUE, dark: BLUE_DEEP, light: '#8796ec', contrastText: '#ffffff' },
            secondary: { main: '#9b84d8' },
            background: { default: s.page, paper: s.panel },
            text: { primary: '#e7e9f5', secondary: '#9a9fbf', disabled: 'rgba(231,233,245,0.36)' },
            divider: s.edge,
            action: {
              hover: 'rgba(150, 156, 220, 0.06)',
              selected: 'rgba(110, 125, 230, 0.14)',
            },
          }
        : {
            mode: 'light',
            primary: { main: AXTRA, dark: AXTRA_DEEP, light: '#6a98da', contrastText: '#ffffff' },
            secondary: { main: '#43938f' },
            background: { default: s.page, paper: s.panel },
            text: { primary: '#1f2a3d', secondary: '#5b6a80', disabled: 'rgba(31, 42, 61, 0.38)' },
            divider: s.edge,
            action: {
              hover: 'rgba(48, 111, 199, 0.05)',
              selected: 'rgba(48, 111, 199, 0.10)',
            },
          },
  })
}

export { NAVY }
