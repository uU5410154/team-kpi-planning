import { createTheme } from '@mui/material/styles'
import { TONES } from './lib/palette.js'

/*
 * THE CHROME — "Ledger" (docs/DESIGN.md).
 *
 * A calm, cool-slate tool for a finance team: quiet flat surfaces with a
 * hairline edge, one blue for whatever can be pressed, and colour only where
 * it means something (status). No glows, no gradients, no glass.
 *
 * Chrome colours only. Data ink — the series colours — lives in
 * lib/palette.js and keeps its colour-blind-checked values; the status tones
 * live there too, so a chart and a pill agree on what "late" looks like.
 *
 * Dark is the mode the app opens in. Light is the same system turned over —
 * neutral grey and white, the same blue a shade deeper — so switching modes
 * reads as the same product rather than a different one.
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

/** The colour roles of §1.1, per mode. */
export const TOKENS = {
  dark: {
    bg: {
      page: '#0F1318', sidebar: '#0F1318', surface: '#151A21', subtle: '#1A2029', raised: '#1E2530',
    },
    border: { subtle: '#252D38', strong: '#344050' },
    text: {
      primary: '#E6E9EE', secondary: '#A2AAB7', tertiary: '#78828F', disabled: '#555E6B',
    },
    primary: {
      main: '#3D6FD9', hover: '#3563C4', text: '#82A7F2', tint: 'rgba(61,111,217,0.14)',
    },
    hover: 'rgba(162,170,183,0.07)',
    shadow: '0 8px 24px rgba(0,0,0,.45)',
    backdrop: 'rgba(5,8,12,.6)',
  },
  light: {
    bg: {
      page: '#F5F6F8', sidebar: '#FFFFFF', surface: '#FFFFFF', subtle: '#F0F2F5', raised: '#FFFFFF',
    },
    border: { subtle: '#E3E6EB', strong: '#CBD1D9' },
    text: {
      primary: '#161B22', secondary: '#4F5866', tertiary: '#6B7482', disabled: '#A3AAB5',
    },
    primary: {
      main: '#2F5FC4', hover: '#284FA6', text: '#2F5FC4', tint: 'rgba(47,95,196,0.08)',
    },
    hover: 'rgba(16,24,40,0.04)',
    shadow: '0 8px 24px rgba(16,24,40,.12)',
    backdrop: 'rgba(16,24,40,.35)',
  },
}

/*
 * The surfaces under their old names, so a file that still imports SURFACE
 * draws flat: the glows and the sheen are gone, the stage is see-through.
 */
export const SURFACE = Object.fromEntries(['dark', 'light'].map((m) => {
  const t = TOKENS[m]
  return [m, {
    page: t.bg.page,
    panel: t.bg.surface,
    raised: t.bg.raised,
    rail: t.bg.sidebar,
    subtle: t.bg.subtle,
    edge: t.border.subtle,
    strong: t.border.strong,
    stage: 'transparent',
    glow: 'transparent',
    glow2: 'transparent',
    glow3: 'transparent',
    sheen: 'none',
  }]
}))

export const FONT = '"Inter", "Noto Sans Thai", system-ui, -apple-system, "Segoe UI", sans-serif'
const PHONE = '@media (max-width:599.95px)'

const shared = (mode) => {
  const t = TOKENS[mode]
  const tone = TONES[mode]
  const dark = mode === 'dark'
  const overlay = {
    backgroundColor: t.bg.raised,
    backgroundImage: 'none',
    border: `1px solid ${t.border.subtle}`,
    boxShadow: t.shadow,
  }
  const SEV = {
    success: tone.success, info: tone.info, warning: tone.warning, error: tone.danger,
  }
  const cap = (s) => s[0].toUpperCase() + s.slice(1)
  // Alert: standard = the tone's tint with its words in the tone; outlined =
  // no fill, a quiet edge in the tone; filled = the toast (raised, a bar).
  const alertSeverity = Object.fromEntries(Object.entries(SEV).flatMap(([k, v]) => [
    [`standard${cap(k)}`, { backgroundColor: v.tint, color: v.fg, '& .MuiAlert-icon': { color: v.fg } }],
    [`outlined${cap(k)}`, {
      backgroundColor: 'transparent', color: t.text.primary, borderColor: v.tint.replace(/[\d.]+\)$/, '0.55)'), '& .MuiAlert-icon': { color: v.fg },
    }],
    [`filled${cap(k)}`, {
      ...overlay, color: t.text.primary, borderLeft: `3px solid ${v.solid}`, '& .MuiAlert-icon': { color: v.fg },
    }],
  ]))
  // A coloured Chip draws as a pill: the tint with the word in the tone.
  const stronger = (rgba) => rgba.replace(/[\d.]+\)$/, dark ? '0.24)' : '0.16)')
  const chipTone = Object.fromEntries(Object.entries(SEV).flatMap(([k, v]) => [
    [`filled${cap(k)}`, {
      backgroundColor: v.tint, color: v.fg, '&.MuiChip-clickable:hover, &.MuiChip-clickable.Mui-focusVisible': { backgroundColor: stronger(v.tint) },
    }],
    [`outlined${cap(k)}`, { borderColor: v.tint.replace(/[\d.]+\)$/, '0.55)'), color: v.fg }],
  ]))
  // A status never fills a button: a "contained" success or error button is
  // drawn soft — the tint with the word in the tone.
  const buttonTone = Object.fromEntries(Object.entries(SEV).map(([k, v]) => [
    `contained${cap(k)}`, { backgroundColor: v.tint, color: v.fg, '&:hover': { backgroundColor: stronger(v.tint) } },
  ]))
  const barTone = Object.fromEntries(Object.entries(SEV).map(([k, v]) => [`barColor${cap(k)}`, { backgroundColor: v.solid }]))

  return {
    spacing: 4,
    typography: {
      fontFamily: FONT,
      htmlFontSize: 16,
      fontSize: 14,
      fontWeightLight: 400,
      fontWeightRegular: 400,
      fontWeightMedium: 500,
      fontWeightBold: 600,
      h1: {
        fontSize: '1.375rem', lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.01em', [PHONE]: { fontSize: '1.25rem', lineHeight: '26px' },
      },
      h2: { fontSize: '1rem', lineHeight: '24px', fontWeight: 600, letterSpacing: 0 },
      h3: { fontSize: '0.875rem', lineHeight: '20px', fontWeight: 600, letterSpacing: 0 },
      // Not in the scale; kept so pages that still use them land on it.
      h4: { fontSize: '1rem', lineHeight: '24px', fontWeight: 600, letterSpacing: 0 },
      h5: { fontSize: '0.875rem', lineHeight: '20px', fontWeight: 600, letterSpacing: 0 },
      h6: { fontSize: '0.875rem', lineHeight: '20px', fontWeight: 600, letterSpacing: 0 },
      subtitle1: { fontSize: '0.875rem', lineHeight: '20px', fontWeight: 500 },
      subtitle2: { fontSize: '0.75rem', lineHeight: '16px', fontWeight: 500, letterSpacing: 0 },
      body1: { fontSize: '0.875rem', lineHeight: '20px' },
      body2: { fontSize: '0.8125rem', lineHeight: '18px' },
      caption: { fontSize: '0.75rem', lineHeight: '16px', letterSpacing: 0 },
      overline: {
        fontSize: '0.75rem', lineHeight: '16px', fontWeight: 500, letterSpacing: 0, textTransform: 'none',
      },
      button: {
        fontSize: '0.875rem', lineHeight: '20px', fontWeight: 500, letterSpacing: 0, textTransform: 'none',
      },
      figure: {
        fontFamily: FONT, fontSize: '1.75rem', lineHeight: '32px', fontWeight: 600, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums',
      },
      figureSm: {
        fontFamily: FONT, fontSize: '1.25rem', lineHeight: '28px', fontWeight: 600, letterSpacing: 0, fontVariantNumeric: 'tabular-nums',
      },
    },
    /*
     * The base unit stays at 4: pages size their own shapes as multiples of it
     * (`p: 4` is 16px). The corners are given per level, in pixels, below.
     */
    shape: { borderRadius: 6 },
    transitions: {
      duration: {
        shortest: 120, shorter: 120, short: 180, standard: 180, complex: 200, enteringScreen: 200, leavingScreen: 180,
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          html: { colorScheme: mode },
          body: {
            WebkitFontSmoothing: 'antialiased',
            MozOsxFontSmoothing: 'grayscale',
            backgroundColor: t.bg.page,
            backgroundImage: 'none',
          },
          /*
           * Tabular figures where numbers stack — numeric (right-aligned)
           * table columns, figures, number inputs — rather than on the whole
           * body: Inter's tabular set also widens the hyphen, which turns
           * "FNP-2060" into "FNP - 2060" in running text and in key columns.
           */
          '.MuiTableCell-alignRight, input[type="number"], input[inputmode="numeric"], input[inputmode="decimal"], .tabular': { fontVariantNumeric: 'tabular-nums' },
          'b, strong': { fontWeight: 600 },
          // One focus ring for everything a keyboard can reach.
          '*:focus-visible, .Mui-focusVisible': {
            outline: `2px solid ${t.primary.main}`,
            outlineOffset: 2,
          },
          // A text field shows focus on its own outline instead.
          'input:focus-visible, textarea:focus-visible, .MuiInputBase-root.Mui-focusVisible, .MuiSelect-select:focus-visible': { outline: 'none' },
          kbd: { fontFamily: FONT },
          '::selection': { backgroundColor: dark ? 'rgba(61,111,217,0.35)' : 'rgba(47,95,196,0.18)' },
          '@media (prefers-reduced-motion: reduce)': {
            '*, *::before, *::after': { transitionDuration: '0ms !important', scrollBehavior: 'auto !important' },
          },
        },
      },
      MuiTypography: {
        defaultProps: {
          variantMapping: {
            h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5', h6: 'h6', subtitle1: 'h6', subtitle2: 'h6', body1: 'p', body2: 'p', figure: 'div', figureSm: 'div',
          },
        },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: { backgroundImage: 'none' },
          rounded: { borderRadius: 8 },
          outlined: { borderColor: t.border.subtle, backgroundColor: t.bg.surface, backgroundImage: 'none' },
        },
      },
      MuiCard: {
        defaultProps: { variant: 'outlined' },
        styleOverrides: { root: { borderRadius: 8, borderColor: t.border.subtle, backgroundImage: 'none' } },
      },
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiButton: {
        defaultProps: { disableElevation: true, size: 'small' },
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            borderRadius: 6,
            letterSpacing: 0,
            boxShadow: 'none',
            transition: 'background-color 120ms, border-color 120ms, color 120ms',
            '&:hover': { boxShadow: 'none' },
            '& .MuiButton-startIcon > *:nth-of-type(1), & .MuiButton-endIcon > *:nth-of-type(1)': { fontSize: 18 },
            [PHONE]: { minHeight: 40 },
          },
          sizeSmall: { minHeight: 32, padding: '5px 12px', fontSize: '0.875rem' },
          sizeMedium: { minHeight: 36, padding: '7px 14px' },
          sizeLarge: { minHeight: 40, padding: '9px 16px', fontSize: '0.875rem' },
          textSizeSmall: { padding: '5px 8px' },
          containedPrimary: {
            backgroundColor: t.primary.main,
            color: '#fff',
            '&:hover': { backgroundColor: t.primary.hover },
          },
          outlined: { borderColor: t.border.strong },
          outlinedPrimary: {
            color: t.text.primary,
            borderColor: t.border.strong,
            '&:hover': { borderColor: t.border.strong, backgroundColor: t.hover },
          },
          outlinedInherit: { borderColor: t.border.strong },
          outlinedError: { borderColor: tone.danger.tint.replace(/[\d.]+\)$/, '0.55)') },
          textPrimary: { color: t.primary.text, '&:hover': { backgroundColor: t.hover } },
          ...buttonTone,
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            transition: 'background-color 120ms, color 120ms',
            '&:hover': { backgroundColor: t.hover },
          },
          colorInherit: {},
        },
      },
      MuiSvgIcon: { styleOverrides: { fontSizeSmall: { fontSize: '1.125rem' } } },
      MuiLink: {
        defaultProps: { underline: 'hover' },
        styleOverrides: { root: { color: t.primary.text, textDecorationColor: 'currentColor' } },
      },
      MuiInputBase: {
        styleOverrides: {
          root: { fontSize: '0.875rem', lineHeight: '20px' },
          input: { '&::placeholder': { color: t.text.tertiary, opacity: 1 } },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            backgroundColor: dark ? 'transparent' : '#FFFFFF',
            '&:hover:not(.Mui-disabled):not(.Mui-focused):not(.Mui-error) .MuiOutlinedInput-notchedOutline': { borderColor: t.text.tertiary },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1, borderColor: t.primary.main, boxShadow: `0 0 0 1px ${t.primary.main}` },
          },
          notchedOutline: { borderColor: t.border.strong },
          inputSizeSmall: { paddingTop: 8, paddingBottom: 8 },
        },
      },
      // The underlined field stays for in-place edits in tables: plain text at
      // rest, an edge on hover, the blue line once it has focus.
      MuiInput: {
        styleOverrides: {
          underline: {
            '&::before': { borderBottomColor: 'transparent' },
            '&:hover:not(.Mui-disabled, .Mui-error)::before': { borderBottom: `1px solid ${t.border.strong}` },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { color: t.text.secondary, fontSize: '0.875rem' },
          sizeSmall: { '&:not(.MuiInputLabel-shrink)': { transform: 'translate(14px, 8px) scale(1)' } },
        },
      },
      MuiFormLabel: { styleOverrides: { root: { color: t.text.secondary } } },
      MuiFormHelperText: {
        styleOverrides: { root: { fontSize: '0.75rem', lineHeight: '16px', marginTop: 4, color: t.text.secondary } },
      },
      MuiFormControlLabel: { styleOverrides: { label: { fontSize: '0.875rem' } } },
      MuiAutocomplete: {
        styleOverrides: {
          root: { '& .MuiOutlinedInput-root.MuiInputBase-sizeSmall': { paddingTop: 4, paddingBottom: 4 } },
          paper: { ...overlay, borderRadius: 8, marginTop: 4 },
          listbox: { padding: 4, '& .MuiAutocomplete-option': { minHeight: 36, borderRadius: 6, fontSize: '0.875rem' } },
          groupLabel: {
            backgroundColor: t.bg.raised, color: t.text.secondary, fontSize: '0.75rem', fontWeight: 500, lineHeight: '28px', paddingLeft: 12,
          },
          noOptions: { fontSize: '0.875rem', color: t.text.secondary },
        },
      },
      MuiSelect: { styleOverrides: { icon: { color: t.text.tertiary } } },
      MuiTableCell: {
        styleOverrides: {
          root: {
            fontSize: '0.875rem',
            lineHeight: '20px',
            padding: '8px 12px',
            borderColor: t.border.subtle,
            [PHONE]: { padding: '8px 8px' },
          },
          head: {
            fontWeight: 500,
            fontSize: '0.75rem',
            lineHeight: '16px',
            letterSpacing: 0,
            textTransform: 'none',
            color: t.text.secondary,
            backgroundColor: t.bg.subtle,
            height: 36,
            paddingTop: 6,
            paddingBottom: 6,
          },
          body: { height: 44 },
          sizeSmall: { padding: '6px 12px', '&.MuiTableCell-body': { height: 36 }, [PHONE]: { padding: '6px 8px' } },
          stickyHeader: { backgroundColor: t.bg.subtle },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&.MuiTableRow-hover:hover': { backgroundColor: t.bg.subtle },
            '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: t.primary.tint },
          },
        },
      },
      MuiTableSortLabel: {
        styleOverrides: {
          root: { '&.Mui-active': { color: t.text.primary } },
          icon: { fontSize: 14 },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 4, fontWeight: 500, fontSize: '0.75rem', height: 24, letterSpacing: 0,
          },
          sizeSmall: { height: 20 },
          labelSmall: { paddingLeft: 8, paddingRight: 8 },
          filled: { backgroundColor: tone.neutral.tint, color: t.text.secondary },
          outlined: { borderColor: t.border.strong, color: t.text.secondary },
          ...chipTone,
          filledPrimary: { backgroundColor: t.primary.tint, color: t.primary.text },
          outlinedPrimary: { borderColor: t.border.strong, color: t.primary.text },
          icon: { fontSize: 16, marginLeft: 6 },
          iconSmall: { fontSize: 14 },
          deleteIcon: { fontSize: 16 },
        },
      },
      MuiTabs: {
        styleOverrides: {
          root: { minHeight: 40 },
          indicator: { height: 2, backgroundColor: t.primary.main },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 40,
            minWidth: 0,
            padding: '8px 12px',
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.875rem',
            letterSpacing: 0,
            color: t.text.secondary,
            '&.Mui-selected': { color: t.text.primary },
            '&:hover': { color: t.text.primary },
          },
        },
      },
      // The segmented control: a sunk track, the chosen item lifted onto the surface.
      MuiToggleButtonGroup: {
        styleOverrides: {
          root: {
            backgroundColor: t.bg.subtle,
            borderRadius: 6,
            padding: 2,
            gap: 2,
            '& .MuiToggleButtonGroup-grouped': {
              margin: 0,
              border: '1px solid transparent',
              borderRadius: 4,
            },
            '& .MuiToggleButtonGroup-grouped.Mui-selected': {
              borderColor: t.border.strong,
            },
          },
        },
      },
      MuiToggleButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
            fontSize: '0.8125rem',
            lineHeight: '18px',
            letterSpacing: 0,
            color: t.text.secondary,
            borderColor: t.border.strong,
            borderRadius: 6,
            transition: 'background-color 120ms, color 120ms',
            '&:hover': { backgroundColor: t.hover, color: t.text.primary },
            '&.Mui-selected, &.Mui-selected:hover': {
              backgroundColor: t.bg.surface,
              color: t.text.primary,
            },
          },
          sizeSmall: { padding: '4px 10px', minHeight: 28 },
          sizeMedium: { padding: '6px 12px', minHeight: 32 },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            fontSize: '0.75rem',
            lineHeight: '16px',
            fontWeight: 400,
            maxWidth: 320,
            padding: '6px 8px',
            borderRadius: 6,
            color: t.text.primary,
            backgroundColor: t.bg.raised,
            border: `1px solid ${t.border.subtle}`,
            boxShadow: t.shadow,
          },
          arrow: { color: t.bg.raised, '&::before': { border: `1px solid ${t.border.subtle}` } },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { ...overlay, borderRadius: 8 },
          list: { padding: 4 },
        },
      },
      MuiMenuItem: {
        styleOverrides: {
          root: {
            minHeight: 36,
            borderRadius: 6,
            fontSize: '0.875rem',
            '&.Mui-selected': { backgroundColor: t.primary.tint },
            '&.Mui-selected:hover': { backgroundColor: t.primary.tint },
            '& .MuiListItemIcon-root': { color: t.text.secondary, minWidth: 32 },
            '& + .MuiDivider-root': { marginTop: 4, marginBottom: 4 },
          },
        },
      },
      MuiListItemIcon: { styleOverrides: { root: { color: t.text.secondary, minWidth: 32 } } },
      MuiListItemText: {
        styleOverrides: {
          primary: { fontSize: '0.875rem', lineHeight: '20px' },
          secondary: { fontSize: '0.8125rem', lineHeight: '18px', color: t.text.secondary },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: t.primary.tint },
          },
        },
      },
      MuiPopover: { styleOverrides: { paper: { ...overlay, borderRadius: 8 } } },
      MuiBackdrop: {
        styleOverrides: {
          root: ({ ownerState }) => (ownerState?.invisible ? {} : { backgroundColor: t.backdrop }),
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            ...overlay,
            borderRadius: 12,
            // A phone gets the whole screen: the title and the actions stay
            // put and only the body scrolls.
            [PHONE]: {
              margin: '0 !important',
              width: '100% !important',
              maxWidth: '100% !important',
              height: '100%',
              maxHeight: '100% !important',
              borderRadius: '0 !important',
              border: 'none',
            },
          },
          paperWidthSm: { maxWidth: 480 },
          paperWidthMd: { maxWidth: 720 },
          paperWidthLg: { maxWidth: 1040 },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontSize: '1.125rem', lineHeight: '26px', fontWeight: 600, padding: '20px 20px 12px',
          },
        },
      },
      MuiDialogContent: {
        styleOverrides: {
          // The title sits right above: a floating field label needs the 8px.
          root: { padding: '8px 20px 20px', '.MuiDialogTitle-root + &': { paddingTop: 8 } },
          dividers: { padding: 20, borderColor: t.border.subtle },
        },
      },
      MuiDialogContentText: { styleOverrides: { root: { color: t.text.secondary, fontSize: '0.875rem' } } },
      MuiDialogActions: {
        styleOverrides: {
          root: { padding: '12px 20px 16px', gap: 8, '& > :not(style) ~ :not(style)': { marginLeft: 0 } },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: { backgroundImage: 'none', backgroundColor: t.bg.raised, borderColor: t.border.subtle },
        },
      },
      MuiAlert: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontSize: '0.875rem',
            lineHeight: '20px',
            padding: '6px 12px',
            alignItems: 'flex-start',
          },
          icon: { padding: '8px 0', marginRight: 10, fontSize: 20, opacity: 1 },
          message: { padding: '8px 0' },
          action: { paddingTop: 2, marginRight: -4 },
          ...alertSeverity,
        },
      },
      MuiAlertTitle: { styleOverrides: { root: { fontWeight: 500, fontSize: '0.875rem', marginBottom: 2 } } },
      MuiSnackbarContent: {
        styleOverrides: {
          root: {
            ...overlay, color: t.text.primary, borderRadius: 12, fontSize: '0.875rem',
          },
        },
      },
      MuiSkeleton: {
        defaultProps: { animation: false },
        styleOverrides: { root: { backgroundColor: t.bg.subtle }, text: { borderRadius: 4 }, rounded: { borderRadius: 6 } },
      },
      MuiDivider: { styleOverrides: { root: { borderColor: t.border.subtle } } },
      MuiLinearProgress: {
        styleOverrides: {
          root: { borderRadius: 2, height: 4, backgroundColor: t.bg.subtle },
          bar: { borderRadius: 2 },
          barColorPrimary: { backgroundColor: t.primary.main },
          ...barTone,
          colorPrimary: { backgroundColor: t.bg.subtle },
          colorSuccess: { backgroundColor: t.bg.subtle },
          colorWarning: { backgroundColor: t.bg.subtle },
          colorError: { backgroundColor: t.bg.subtle },
          colorInfo: { backgroundColor: t.bg.subtle },
        },
      },
      MuiAvatar: {
        styleOverrides: {
          colorDefault: { backgroundColor: t.bg.subtle, color: t.text.secondary },
          root: { fontSize: '0.75rem', fontWeight: 500 },
        },
      },
      MuiAccordion: {
        defaultProps: { disableGutters: true, elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: t.bg.surface,
            border: `1px solid ${t.border.subtle}`,
            borderRadius: 8,
            '&::before': { display: 'none' },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          switchBase: { '&.Mui-checked + .MuiSwitch-track': { opacity: 1, backgroundColor: t.primary.main } },
          track: { backgroundColor: t.text.tertiary, opacity: 0.6 },
        },
      },
      MuiCheckbox: { styleOverrides: { root: { color: t.text.tertiary } } },
      MuiRadio: { styleOverrides: { root: { color: t.text.tertiary } } },
      MuiBadge: { styleOverrides: { badge: { fontWeight: 600, fontSize: '0.6875rem' } } },
    },
  }
}

export const buildTheme = (mode) => {
  const t = TOKENS[mode]
  const tone = TONES[mode]
  const status = (v) => ({
    main: v.fg, light: v.fg, dark: v.solid, contrastText: '#ffffff', fg: v.fg, solid: v.solid, tint: v.tint,
  })
  return createTheme({
    ...shared(mode),
    palette: {
      mode,
      primary: {
        main: t.primary.main,
        dark: t.primary.hover,
        light: t.primary.text,
        contrastText: '#ffffff',
        hover: t.primary.hover,
        text: t.primary.text,
        tint: t.primary.tint,
      },
      // No second brand colour: "secondary" is the neutral.
      secondary: {
        main: t.text.secondary, light: t.text.secondary, dark: t.text.tertiary, contrastText: t.bg.page,
      },
      success: status(tone.success),
      warning: status(tone.warning),
      error: status(tone.danger),
      info: status(tone.info),
      tone,
      background: { default: t.bg.page, paper: t.bg.surface },
      bg: t.bg,
      border: t.border,
      text: {
        primary: t.text.primary, secondary: t.text.secondary, tertiary: t.text.tertiary, disabled: t.text.disabled,
      },
      divider: t.border.subtle,
      action: {
        hover: t.hover,
        selected: t.primary.tint,
        disabled: t.text.disabled,
        disabledBackground: mode === 'dark' ? 'rgba(162,170,183,0.10)' : 'rgba(16,24,40,0.06)',
        focus: t.primary.tint,
      },
    },
  })
}

export { NAVY }
