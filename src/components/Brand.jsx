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

/** The pill colours, as on the reference: bright fill, and text that reads on it. */
export const PILL = {
  high: { bg: '#ff6a2b', fg: '#ffffff' },
  medium: { bg: '#f5c518', fg: '#1a1500' },
  low: { bg: '#22d3ee', fg: '#04222a' },
  good: { bg: '#22c55e', fg: '#03210f' },
  bad: { bg: '#ef4444', fg: '#ffffff' },
  warn: { bg: '#f59e0b', fg: '#1f1300' },
  info: { bg: '#4f6bff', fg: '#ffffff' },
  violet: { bg: '#a855f7', fg: '#ffffff' },
  neutral: { bg: '#5b6191', fg: '#ffffff' },
}

/** A solid, rounded, upper-case label. `tone` is a key of PILL. */
export function Pill({ label, tone = 'neutral', title, sx }) {
  const c = PILL[tone] || PILL.neutral
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
        fontSize: '0.62rem',
        fontWeight: 800,
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

/** The colour each page is known by — its tile in the menu, the header and search. */
export const PAGE_COLOR = {
  dashboard: '#4f6bff',
  projects: '#f5b81a',
  people: '#ec4899',
  weekly: '#a855f7',
  team: '#22c55e',
  timeline: '#22d3ee',
  apps: '#ff6a2b',
  settings: '#8b93c9',
  users: '#ef4444',
}

/*
 * One colour per person, fixed by their place in the roster rather than by
 * a hash of their name, so the same person is the same colour on every page.
 */
const PERSON_COLORS = ['#4f6bff', '#ec4899', '#22c55e', '#f5b81a', '#a855f7', '#22d3ee', '#ff6a2b', '#8b93c9']
export const personColor = (people, id) => {
  const i = (people || []).findIndex((p) => p.id === id)
  return PERSON_COLORS[(i < 0 ? 0 : i) % PERSON_COLORS.length]
}

/** A coloured rounded square holding an icon or a letter or two. */
export function IconTile({
  icon: Icon, text, color = '#4f6bff', size = 30, sx,
}) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${Math.round(size * 0.3)}px`,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
        bgcolor: color,
        backgroundImage: `linear-gradient(145deg, ${alpha('#ffffff', 0.22)}, transparent 60%)`,
        boxShadow: `0 4px 12px ${alpha(color, 0.35)}`,
        fontSize: size * 0.4,
        fontWeight: 800,
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
      background: 'linear-gradient(135deg, #1d1a6b 0%, #3b22a8 45%, #6d2fd8 100%)',
      border: '1px solid rgba(168, 140, 255, 0.28)',
      boxShadow: '0 18px 40px rgba(76, 29, 149, 0.35)',
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
          position: 'absolute', right: 0, bottom: 0, width: { xs: '90%', md: '60%' }, height: '100%', opacity: 0.35, pointerEvents: 'none',
        }}
      >
        {[60, 95, 130, 165, 200, 235].map((r) => (
          <circle key={r} cx="300" cy="300" r={r} fill="none" stroke="#c4b5fd" strokeWidth="1" />
        ))}
      </Box>
      <Box sx={{
        position: 'absolute', top: -80, left: -60, width: 260, height: 260, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(99,102,241,0.55), transparent 70%)', pointerEvents: 'none',
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
            bgcolor: 'rgba(255,255,255,0.10)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.14)',
            transition: 'background-color .15s',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.16)' },
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body1" sx={{ fontWeight: 700 }}>{next.label}</Typography>
            {next.sub && <Typography variant="body2" sx={{ opacity: 0.8 }}>{next.sub}</Typography>}
          </Box>
          <Box sx={{
            width: 44, height: 44, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center',
            border: '1.5px dashed rgba(255,255,255,0.55)',
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
