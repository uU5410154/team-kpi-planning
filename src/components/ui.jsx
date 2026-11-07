import { Children, useState } from 'react'
import {
  Alert, Box, Button, Paper, Popover, Skeleton, Tooltip, Typography,
} from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'

/*
 * THE SHARED PRIMITIVES of the "Ledger" design system (docs/DESIGN.md §15).
 *
 * Pages build on these so a page header, a section, a row of figures, a
 * status, an empty or failed state look and read the same everywhere. Each
 * passes unknown `data-*` props through to its root, so test hooks land on
 * the element that carries the meaning.
 */

const dataProps = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k.startsWith('data-') || k.startsWith('aria-') || k === 'id' || k === 'role'))

/* ------------------------------------------------------------------ */
/* About this page: a quiet text button that opens the long explanation. */
/* ------------------------------------------------------------------ */

export function AboutPage({ children, label = 'About this page' }) {
  const [at, setAt] = useState(null)
  if (!children) return null
  return (
    <>
      <Button
        variant="text"
        size="small"
        startIcon={<InfoOutlinedIcon />}
        onClick={(e) => setAt(e.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={!!at}
        sx={{ flexShrink: 0, px: 1, ml: -1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
      >
        {label}
      </Button>
      <Popover
        open={!!at}
        anchorEl={at}
        onClose={() => setAt(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { p: 4, maxWidth: 440, mt: 1 } } }}
      >
        <Box role="dialog" aria-label={label} sx={{ typography: 'body2', color: 'text.secondary', '& p': { m: 0 }, '& p + p': { mt: 2 } }}>
          {typeof children === 'string' ? <Typography variant="body2">{children}</Typography> : children}
        </Box>
      </Popover>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Page header: the page's one title, a sentence under it, its actions. */
/* ------------------------------------------------------------------ */

export function PageHeader({
  title, description, actions, back, help, children, ...rest
}) {
  return (
    <Box component="div" data-page-header {...dataProps(rest)} sx={{ mb: { xs: 3, sm: 4, md: 5 } }}>
      {back && (
        <Button
          variant="text"
          size="small"
          startIcon={<ChevronLeftIcon />}
          onClick={back.onClick}
          sx={{ ml: -1.5, mb: 1, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}
        >
          {back.label || 'Back'}
        </Button>
      )}
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', gap: { xs: 2, sm: 4 }, flexWrap: 'wrap',
      }}
      >
        <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
          <Typography variant="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
          {(description || help) && (
            <Box sx={{
              display: 'flex', alignItems: 'center', columnGap: 3, rowGap: 0.5, flexWrap: 'wrap', mt: 1,
            }}
            >
              {description && (
                <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '72ch' }}>{description}</Typography>
              )}
              {help && <AboutPage>{help}</AboutPage>}
            </Box>
          )}
        </Box>
        {actions && (
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', justifyContent: 'flex-end', flex: '0 1 auto', maxWidth: '100%',
            '& .MuiButton-containedPrimary': { minHeight: 36 },
          }}
          >
            {actions}
          </Box>
        )}
      </Box>
      {children && <Box sx={{ mt: { xs: 3, sm: 4 } }}>{children}</Box>}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Section: the one card shape. Flat surface, hairline edge, radius 8.  */
/* ------------------------------------------------------------------ */

export function Section({
  title, meta, actions, children, dense = false, padded = true, sx, component = 'section', ...rest
}) {
  const pad = dense ? 3 : { xs: 3, sm: 4 }
  const head = !!(title || meta || actions)
  // A Paper underneath, so anything that finds a card by `.MuiPaper-root` still does.
  return (
    <Paper
      variant="outlined"
      component={component}
      aria-label={typeof title === 'string' && !rest['aria-label'] ? title : undefined}
      {...rest}
      sx={[{
        minWidth: 0,
        overflow: 'hidden',
      }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {head && (
        <Box sx={{
          display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap', px: pad, pt: pad, pb: dense ? 2 : 3,
        }}
        >
          <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
            {title && <Typography variant="h2">{title}</Typography>}
            {meta && <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: title ? 0.5 : 0 }}>{meta}</Typography>}
          </Box>
          {actions && (
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', flexShrink: 0, maxWidth: '100%',
            }}
            >
              {actions}
            </Box>
          )}
        </Box>
      )}
      {padded ? (
        <Box sx={{ px: pad, pb: pad, pt: head ? 0 : pad }}>{children}</Box>
      ) : (
        <Box sx={{ borderTop: head ? 1 : 0, borderColor: 'border.subtle' }}>{children}</Box>
      )}
    </Paper>
  )
}

/* ------------------------------------------------------------------ */
/* Status pill: a state in a word, tinted in its tone.                 */
/* ------------------------------------------------------------------ */

const TONE_ALIAS = {
  good: 'success', bad: 'danger', error: 'danger', critical: 'danger', warn: 'warning', high: 'danger', medium: 'warning', low: 'info', violet: 'info',
}

export function StatusPill({
  tone = 'neutral', dot = false, children, title, sx, ...rest
}) {
  const key = TONE_ALIAS[tone] || tone
  return (
    <Box
      component="span"
      title={title}
      {...dataProps(rest)}
      sx={[(t) => {
        const c = t.palette.tone?.[key] || t.palette.tone.neutral
        return {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          height: 20,
          px: 2,
          borderRadius: '4px',
          bgcolor: c.tint,
          color: c.fg,
          fontSize: '0.75rem',
          fontWeight: 500,
          lineHeight: '16px',
          letterSpacing: 0,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          verticalAlign: 'middle',
          '& .pill-dot': {
            width: 6, height: 6, borderRadius: '50%', bgcolor: c.solid, flexShrink: 0,
          },
        }
      }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {dot && <span className="pill-dot" aria-hidden />}
      {children}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Figures: a row of numbers split by hairlines, in one section.        */
/* ------------------------------------------------------------------ */

function Figure({ item, lg }) {
  const {
    label, value, unit, note, info, tone, dataAttr, ...rest
  } = item
  const empty = value === null || value === undefined || value === '' || value === '—'
  return (
    <Box {...dataProps(rest)} {...(dataAttr || {})} sx={{ px: 4, py: 3, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 16 }}>
        <Typography variant="subtitle2" component="div" noWrap sx={{ color: 'text.secondary' }}>{label}</Typography>
        {info && (
          <Tooltip title={info} placement="top">
            <InfoOutlinedIcon tabIndex={0} aria-label={`About ${typeof label === 'string' ? label : 'this figure'}`} sx={{ fontSize: 14, color: 'text.tertiary', cursor: 'help' }} />
          </Tooltip>
        )}
      </Box>
      <Box sx={{
        display: 'flex', alignItems: 'baseline', gap: 1, mt: 1, minWidth: 0,
      }}
      >
        <Typography variant={lg ? 'figure' : 'figureSm'} component="div" sx={{ color: empty ? 'text.tertiary' : 'text.primary', whiteSpace: 'nowrap' }}>
          {empty ? '—' : value}
        </Typography>
        {unit && !empty && <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{unit}</Typography>}
      </Box>
      {note && (
        <Typography
          variant="caption"
          component="div"
          sx={(t) => ({
            mt: 0.5, color: tone ? (t.palette.tone[TONE_ALIAS[tone] || tone]?.fg || t.palette.text.tertiary) : 'text.tertiary',
          })}
        >
          {note}
        </Typography>
      )}
    </Box>
  )
}

/* Hairlines between the cells of a responsive grid: a left edge on all but
   the first in a row, a top edge on all but the first row. */
const gridLines = (cols, n) => ({
  gridTemplateColumns: `repeat(${Math.min(cols, Math.max(n, 1))}, minmax(0, 1fr))`,
  '& > *': { borderLeft: 1, borderTop: 1, borderColor: 'border.subtle' },
  [`& > *:nth-of-type(${Math.min(cols, Math.max(n, 1))}n+1)`]: { borderLeft: 0 },
  [`& > *:nth-of-type(-n+${Math.min(cols, Math.max(n, 1))})`]: { borderTop: 0 },
})

export function FigureStrip({ items = [], max = 6, lg = false, sx }) {
  const [all, setAll] = useState(false)
  const list = items.filter(Boolean)
  const n = list.length
  const phoneList = all ? list : list.slice(0, 4)
  return (
    <Paper
      variant="outlined"
      data-figure-strip
      sx={[{ overflow: 'hidden', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {/* Tablet and up: every figure. */}
      <Box sx={(t) => ({
        display: { xs: 'none', sm: 'grid' },
        [t.breakpoints.between('sm', 'md')]: gridLines(3, n),
        [t.breakpoints.up('md')]: gridLines(Math.min(max, 6), n),
      })}
      >
        {list.map((it, i) => <Figure key={it.key || i} item={it} lg={lg && i === 0} />)}
      </Box>
      {/* A phone: two to a row, the first four until asked for the rest. */}
      <Box sx={{ display: { xs: 'grid', sm: 'none' }, ...gridLines(2, phoneList.length) }}>
        {phoneList.map((it, i) => <Figure key={it.key || i} item={it} lg={false} />)}
      </Box>
      {n > 4 && (
        <Box sx={{
          display: { xs: 'block', sm: 'none' }, borderTop: 1, borderColor: 'border.subtle', px: 2, py: 1,
        }}
        >
          <Button variant="text" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer figures' : 'Show all figures'}
          </Button>
        </Box>
      )}
    </Paper>
  )
}

/* ------------------------------------------------------------------ */
/* Empty, error, loading.                                               */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon: Icon, title, body, action, inline = false, ...rest
}) {
  if (inline) {
    return (
      <Box {...dataProps(rest)} sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2, color: 'text.secondary', minWidth: 0 }}>
        {Icon && <Icon sx={{ fontSize: 18, color: 'text.tertiary', flexShrink: 0 }} />}
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1, minWidth: 0 }}>
          {title}
          {body ? <Box component="span" sx={{ color: 'text.tertiary' }}>{` ${body}`}</Box> : null}
        </Typography>
        {action}
      </Box>
    )
  }
  return (
    <Box
      {...dataProps(rest)}
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 1, py: 6, px: 4,
      }}
    >
      {Icon && <Icon sx={{ fontSize: 24, color: 'text.tertiary', mb: 1 }} />}
      {title && <Typography variant="body1" sx={{ fontWeight: 500 }}>{title}</Typography>}
      {body && <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '56ch' }}>{body}</Typography>}
      {action && <Box sx={{ mt: 2 }}>{action}</Box>}
    </Box>
  )
}

export function ErrorState({
  title, body, onRetry, retryLabel = 'Try again', ...rest
}) {
  return (
    <Alert
      severity="error"
      variant="outlined"
      {...dataProps(rest)}
      action={onRetry ? (
        <Button variant="outlined" color="inherit" size="small" onClick={onRetry} sx={{ whiteSpace: 'nowrap' }}>{retryLabel}</Button>
      ) : undefined}
      sx={{ alignItems: 'flex-start' }}
    >
      {title && <Typography variant="body1" sx={{ fontWeight: 500, color: 'text.primary' }}>{title}</Typography>}
      {body && <Typography variant="body2" sx={{ color: 'text.secondary', mt: title ? 0.5 : 0 }}>{body}</Typography>}
    </Alert>
  )
}

const WIDTHS = ['62%', '48%', '71%', '39%', '56%', '67%', '44%', '59%']

/**
 * The shape of what is coming: a header bar, a row of figures, table rows.
 * Carries `data-loading` and role="status" like the spinner it stands in for.
 */
export function SectionSkeleton({
  rows = 5, figures = 0, header = true, label = 'Loading…',
}) {
  return (
    <Box role="status" aria-live="polite" aria-label={label} data-loading sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }}>
      {figures > 0 && (
        <Box sx={(t) => ({
          display: 'grid',
          bgcolor: 'bg.surface',
          border: 1,
          borderColor: 'border.subtle',
          borderRadius: '8px',
          overflow: 'hidden',
          [t.breakpoints.down('sm')]: gridLines(2, figures),
          [t.breakpoints.up('sm')]: gridLines(Math.min(figures, 6), figures),
        })}
        >
          {Array.from({ length: figures }, (_, i) => (
            <Box key={i} sx={{ px: 4, py: 3 }}>
              <Skeleton variant="text" width={90} height={16} />
              <Skeleton variant="text" width={70} height={28} sx={{ mt: 1 }} />
              <Skeleton variant="text" width={110} height={14} sx={{ mt: 0.5 }} />
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{
        bgcolor: 'bg.surface', border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflow: 'hidden',
      }}
      >
        {header && (
          <Box sx={{ px: 4, pt: 4, pb: 3 }}>
            <Skeleton variant="text" width={180} height={22} />
            <Skeleton variant="text" width={280} height={16} sx={{ mt: 0.5, maxWidth: '80%' }} />
          </Box>
        )}
        <Box sx={{ height: 36, bgcolor: 'bg.subtle', borderTop: header ? 1 : 0, borderColor: 'border.subtle' }} />
        {Array.from({ length: rows }, (_, i) => (
          <Box
            key={i}
            sx={{
              height: 44, display: 'flex', alignItems: 'center', gap: 4, px: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle',
            }}
          >
            <Skeleton variant="text" sx={{ flex: `0 0 ${WIDTHS[i % WIDTHS.length]}`, maxWidth: 420 }} height={16} />
            <Box sx={{ flex: 1 }} />
            <Skeleton variant="text" width={56} height={16} />
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Toolbar: search and filters in one row, the count at the right end.  */
/* ------------------------------------------------------------------ */

export function Toolbar({ children, count, sx }) {
  return (
    <Box
      sx={[{
        display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', minWidth: 0,
        '& .MuiFormControl-root:not(.MuiTextField-root)': { minWidth: 140 },
      }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {Children.toArray(children)}
      {count != null && (
        <Typography variant="caption" component="div" sx={{ color: 'text.secondary', ml: 'auto', whiteSpace: 'nowrap' }}>
          {count}
        </Typography>
      )}
    </Box>
  )
}
