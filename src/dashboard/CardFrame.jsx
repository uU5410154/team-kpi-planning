import {
  Box, Paper, Typography, IconButton, Tooltip,
} from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import CloseIcon from '@mui/icons-material/Close'

/*
 * ONE CARD ON THE DASHBOARD — the Section look (docs/DESIGN.md §4).
 *
 * A title, an optional line under it and an action on the right; the body
 * fills the rest of the card and scrolls inside it, so a card sized small on
 * the grid stays that size rather than pushing everything below it down.
 *
 * In edit mode the title bar is what is dragged (the class `dash-drag`), so a
 * button inside a card still works while the layout is being arranged, and a
 * cross takes the card off. The card shows a dashed edge while it can move.
 *
 * `bare` cards draw their own frame — the summary and the figures — and get
 * only the edit handles laid over them.
 */

export const DRAG = 'dash-drag'

const EDGE = { outline: '1px dashed', outlineColor: 'border.strong', outlineOffset: 2 }

function EditBar({ title, onRemove, overlay }) {
  return (
    <Box
      className={DRAG}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        cursor: 'move',
        ...(overlay ? {
          flexShrink: 0,
          zIndex: 3,
          px: 2,
          minHeight: 28,
          borderRadius: '6px',
          bgcolor: 'bg.subtle',
          color: 'text.secondary',
        } : {}),
      }}
    >
      <DragIndicatorIcon sx={{ fontSize: 18, color: 'text.tertiary' }} />
      {overlay && <Typography variant="caption" sx={{ flex: 1, fontWeight: 500, color: 'text.secondary' }} noWrap>{title}</Typography>}
      {onRemove && (
        <Tooltip title="Remove this card">
          <IconButton
            size="small"
            onClick={onRemove}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label={`remove ${title}`}
            sx={{ color: 'text.secondary', ml: overlay ? 0 : 'auto', p: 0.5 }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

export default function CardFrame({
  title, sub, action, children, editing, onRemove, bare = false, fill = true, label,
}) {
  const outline = editing ? EDGE : {}
  if (bare) {
    // Editing, the bar sits ABOVE the card's own content rather than over its
    // title, so what is being moved can still be read.
    return (
      <Box
        component="section"
        aria-label={label || title}
        sx={{
          position: 'relative',
          height: fill ? '100%' : 'auto',
          overflow: fill ? 'auto' : 'visible',
          borderRadius: '8px',
          ...outline,
          ...(editing ? { display: 'flex', flexDirection: 'column', gap: 1 } : {}),
        }}
      >
        {editing && <EditBar title={title} onRemove={onRemove} overlay />}
        {editing ? <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{children}</Box> : children}
      </Box>
    )
  }
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={label || title}
      sx={{
        height: fill ? '100%' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        overflow: 'hidden',
        ...outline,
      }}
    >
      <Box
        className={editing ? DRAG : undefined}
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 2,
          px: { xs: 3, sm: 4 },
          pt: { xs: 3, sm: 4 },
          pb: 3,
          flexWrap: 'wrap',
          cursor: editing ? 'move' : 'default',
        }}
      >
        {editing && <DragIndicatorIcon sx={{ fontSize: 18, color: 'text.tertiary', mt: 0.75 }} />}
        <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
          <Typography variant="h2">{title}</Typography>
          {sub && <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>{sub}</Typography>}
        </Box>
        {!editing && action}
        {editing && onRemove && (
          <Tooltip title="Remove this card">
            <IconButton
              size="small"
              onClick={onRemove}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label={`remove ${title}`}
              sx={{ color: 'text.secondary' }}
            >
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={{
        flex: 1, minHeight: 0, overflow: fill ? 'auto' : 'visible', px: { xs: 3, sm: 4 }, pb: { xs: 3, sm: 4 },
      }}
      >
        {children}
      </Box>
    </Paper>
  )
}
