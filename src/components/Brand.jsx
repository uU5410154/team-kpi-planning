import { Box, Typography, ButtonBase } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ArrowOutwardIcon from '@mui/icons-material/ArrowOutward'

/*
 * THE BRIGHT BITS: coloured icon tiles, solid pill labels, and the welcome
 * banner. Shared here so every page draws them the same way and a colour means
 * the same thing wherever it appears.
 *
 * These are chrome, not data ink. The charts keep their own validated palette
 * (lib/palette.js); a pill says what something IS — high priority, late,
 * finished — and always carries the word as well as the colour, so nobody has
 * to tell orange from red to read it.
 */

/*
 * The pill colours. Tinted, not solid: a faint wash of the colour with the
 * word in it, so a page of statuses reads as information rather than as a row
 * of warning lights. The hue still carries the meaning; the word always does.
 */
export const PILL = {
  high: '#f0845a',
  medium: '#e3b341',
  low: '#5cc6d6',
  good: '#4fbf7f',
  bad: '#e5676b',
  warn: '#e0a33e',
  info: '#7d93f2',
  violet: '#a98be8',
  neutral: '#8d92b8',
}

/** A tinted, rounded, upper-case label. `tone` is a key of PILL. */
export function Pill({ label, tone = 'neutral', title, sx }) {
  const hue = PILL[tone] || PILL.neutral
  const c = { bg: alpha(hue, 0.14), fg: hue }
  return (
    <Box
      component="span"
      title={title}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 20,
        px: 1,
        borderRadius: '6px',
        bgcolor: c.bg,
        color: c.fg,
        border: `1px solid ${alpha(hue, 0.28)}`,
        fontSize: '0.62rem',
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        lineHeight: 1,
        flexShrink: 0,
        ...sx,
      }}
    >
      {label}
    </Box>
  )
}

/*
 * The colour each page is known by — its tile in the menu, the header and
 * search. Muted on purpose: enough to tell the pages apart at a glance, not
 * enough to compete with the work on them.
 */
export const PAGE_COLOR = {
  dashboard: '#7d8ff0',
  projects: '#d6ad55',
  people: '#cf7fa6',
  weekly: '#a18ad9',
  team: '#62b98a',
  timeline: '#5fb6c7',
  apps: '#d98a62',
  settings: '#9095b8',
  users: '#d27373',
}

/*
 * One colour per person, fixed by their place in the roster rather than by
 * a hash of their name, so the same person is the same colour on every page.
 */
const PERSON_COLORS = ['#7d8ff0', '#cf7fa6', '#62b98a', '#d6ad55', '#a18ad9', '#5fb6c7', '#d98a62', '#9095b8']
export const personColor = (people, id) => {
  const i = (people || []).findIndex((p) => p.id === id)
  return PERSON_COLORS[(i < 0 ? 0 : i) % PERSON_COLORS.length]
}

/*
 * A rounded square holding an icon or a letter or two: a faint wash of the
 * colour, a hairline of it round the edge, and the icon in the colour itself.
 */
export function IconTile({
  icon: Icon, text, color = '#7d8ff0', size = 30, sx,
}) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${Math.round(size * 0.28)}px`,
        display: 'grid',
        placeItems: 'center',
        color,
        bgcolor: alpha(color, 0.13),
        border: `1px solid ${alpha(color, 0.22)}`,
        fontSize: size * 0.38,
        fontWeight: 700,
        ...sx,
      }}
    >
      {Icon ? <Icon sx={{ fontSize: size * 0.58 }} /> : text}
    </Box>
  )
}

/*
 * THE WELCOME BANNER.
 *
 * Who you are, the one sentence that matters today, and below it a glass
 * panel with the next thing to do — a button, not a paragraph. The arcs on
 * the right are decoration only and are hidden from screen readers.
 */
export function WelcomeBanner({
  eyebrow, title, subtitle, next, children,
}) {
  return (
    <Box sx={{
      position: 'relative',
      overflow: 'hidden',
      borderRadius: '20px',
      color: '#fff',
      // Deep indigo rather than bright violet: it marks the top of the page
      // without being the brightest thing on it.
      background: 'linear-gradient(135deg, #12153a 0%, #1b1a4a 55%, #2a2163 100%)',
      border: '1px solid rgba(150, 140, 230, 0.18)',
      display: 'flex',
      flexDirection: 'column',
      // Fills its row, so beside two lists it is as tall as they are and the
      // next-step panel sits on the bottom edge, as on the reference.
      height: '100%',
    }}
    >
      {/* The arcs, as on the reference: thin rings rising from the bottom. */}
      <Box
        component="svg"
        aria-hidden
        viewBox="0 0 400 260"
        preserveAspectRatio="xMaxYMax slice"
        sx={{
          position: 'absolute', right: 0, bottom: 0, width: { xs: '90%', md: '60%' }, height: '100%', opacity: 0.18, pointerEvents: 'none',
        }}
      >
        {[60, 95, 130, 165, 200, 235].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="#c4b5fd" strokeWidth="1" />
        ))}
      </Box>
      <Box sx={{
        position: 'absolute', top: -80, left: -60, width: 260, height: 260, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.22), transparent 70%)', pointerEvents: 'none',
      }}
      />

      <Box sx={{
        position: 'relative', flex: 1, px: { xs: 2.5, sm: 3.5 }, pt: { xs: 2.5, sm: 3.5 }, pb: { xs: 2, sm: 2.5 },
      }}
      >
        {eyebrow && (
          <Typography variant="body2" sx={{ fontWeight: 700, opacity: 0.92 }}>{eyebrow}</Typography>
        )}
        <Typography sx={{
          fontSize: { xs: '1.9rem', sm: '2.6rem' }, fontWeight: 800, letterSpacing: '-0.025em', lineHeight: 1.1, mt: 0.75,
        }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" sx={{ mt: 1, opacity: 0.85, maxWidth: 640 }}>{subtitle}</Typography>
        )}
        {children}
      </Box>

      {next && (
        <ButtonBase
          onClick={next.onClick}
          sx={{
            position: 'relative',
            m: { xs: 1, sm: 1.25 },
            mt: 0,
            px: { xs: 2, sm: 2.5 },
            py: 1.75,
            borderRadius: '16px',
            justifyContent: 'space-between',
            textAlign: 'left',
            gap: 2,
            bgcolor: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.10)',
            transition: 'background-color .15s',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.09)' },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{next.label}</Typography>
            {next.sub && <Typography variant="body2" sx={{ opacity: 0.8 }}>{next.sub}</Typography>}
          </Box>
          <Box sx={{
            width: 44, height: 44, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
            border: '1px solid rgba(255,255,255,0.25)',
          }}
          >
            <ArrowOutwardIcon sx={{ fontSize: 20 }} />
          </Box>
        </ButtonBase>
      )}
    </Box>
  )
}

/** "wisarut.gunjarueg@lotuss.com" → "Wisarut Gunjarueg". */
export const displayName = (email) => String(email || '')
  .split('@')[0]
  .split(/[._-]+/)
  .filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1))
  .join(' ') || 'there'
