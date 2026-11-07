import { Box, Typography, Button } from '@mui/material'
import { StatusPill } from './ui.jsx'

/*
 * SHARED MARKS: the status pill, the neutral icon tile and the summary block
 * at the top of the Dashboard. Shared here so every page draws them the same
 * way and a colour means the same thing wherever it appears.
 *
 * Colour is for meaning only (docs/DESIGN.md §1.1, §7): a pill says what
 * something IS — late, finished, on hold — and always carries the word as
 * well as the colour, so nobody has to tell orange from red to read it.
 */

/*
 * The old pill tone names, kept because pages pass them. The hue is no
 * longer chosen here: each name maps to one of the five status tones.
 */
export const PILL = {
  high: '#D0545B',
  medium: '#C98A2E',
  low: '#4F86D9',
  good: '#3FA672',
  bad: '#D0545B',
  warn: '#C98A2E',
  info: '#4F86D9',
  violet: '#4F86D9',
  neutral: '#6B7482',
}

const TONE_OF = {
  high: 'danger',
  medium: 'warning',
  low: 'info',
  good: 'success',
  bad: 'danger',
  warn: 'warning',
  info: 'info',
  violet: 'info',
  neutral: 'neutral',
}

/**
 * A status label: tinted, small, in sentence case as written. `tone` is a key
 * of PILL (or one of success/warning/danger/info/neutral).
 */
export function Pill({ label, tone = 'neutral', title, sx }) {
  return <StatusPill tone={TONE_OF[tone] || tone} title={title} sx={sx}>{label}</StatusPill>
}

/*
 * The colour each page used to be known by. Kept as an export for anything
 * that still imports it, but the chrome no longer uses it: navigation and
 * search are monochrome.
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
 * One colour per person, fixed by their place in the roster. For charts only:
 * an avatar or a tile outside a chart is neutral.
 */
const PERSON_COLORS = ['#7d8ff0', '#cf7fa6', '#62b98a', '#d6ad55', '#a18ad9', '#5fb6c7', '#d98a62', '#9095b8']
export const personColor = (people, id) => {
  const i = (people || []).findIndex((p) => p.id === id)
  return PERSON_COLORS[(i < 0 ? 0 : i) % PERSON_COLORS.length]
}

/*
 * A small square holding an icon or a person's initials. Neutral whatever
 * colour is passed: `color` is accepted so existing callers keep working.
 */
export function IconTile({ icon: Icon, text, size = 30, sx }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '6px',
        display: 'grid',
        placeItems: 'center',
        color: 'text.secondary',
        bgcolor: 'bg.subtle',
        fontSize: Math.max(11, Math.round(size * 0.4)),
        fontWeight: 500,
        lineHeight: 1,
        ...sx,
      }}
    >
      {Icon ? <Icon sx={{ fontSize: Math.round(size * 0.6) }} /> : text}
    </Box>
  )
}

/*
 * THE SUMMARY AT THE TOP OF THE DASHBOARD.
 *
 * A plain block on the surface: a title, one line on where the year stands,
 * and the next thing to do as an ordinary button. `eyebrow` is accepted for
 * old callers and shown, if given, as a quiet line above the title.
 */
export function WelcomeBanner({
  eyebrow, title, subtitle, next, children,
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        borderRadius: '8px',
        border: 1,
        borderColor: 'border.subtle',
        bgcolor: 'bg.surface',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        height: '100%',
        p: { xs: 3, sm: 4 },
      }}
    >
      {eyebrow && (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>{eyebrow}</Typography>
      )}
      <Typography variant="h1" component="h2">{title}</Typography>
      {subtitle && (
        <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: '72ch' }}>{subtitle}</Typography>
      )}
      {children}
      {next && (
        <Box sx={{
          mt: 'auto', pt: 3, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap',
        }}
        >
          <Box sx={{ minWidth: 0, flex: '1 1 200px' }}>
            <Typography variant="body1" sx={{ fontWeight: 500 }}>{next.label}</Typography>
            {next.sub && <Typography variant="body2" sx={{ color: 'text.secondary' }}>{next.sub}</Typography>}
          </Box>
          <Button variant="outlined" onClick={next.onClick} sx={{ flexShrink: 0 }}>
            {next.action || 'Open Weekly'}
          </Button>
        </Box>
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

/** Done is green, under way is blue, not begun is grey, anything else blue. */
export const statusTone = (st) => {
  const x = String(st || '').toLowerCase()
  if (/done|complete|closed|resolved/.test(x)) return 'good'
  if (/progress|uat|test|review|develop/.test(x)) return 'info'
  if (/not ?start|to ?do|backlog|open/.test(x)) return 'neutral'
  return 'violet'
}
