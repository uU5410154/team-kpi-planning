import { Box, Paper, Typography, IconButton, Tooltip } from '@mui/material'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import CloseIcon from '@mui/icons-material/Close'

/*
 * ONE CARD ON THE DASHBOARD.
 *
 * A title, an optional line under it and an action on the right; the body
 * fills the rest of the card and scrolls inside it, so a card sized small on
 * the grid stays that size rather than pushing everything below it down.
 *
 * In edit mode the title bar is what is dragged (the class `dash-drag`), so a
 * button inside a card still works while the layout is being arranged, and a
 * cross takes the card off.
 *
 * `bare` cards draw their own frame — the welcome banner and the stat tiles —
 * and get only the edit handles laid over them.
 */

export const DRAG = 'dash-drag'

function EditBar({ title, onRemove, overlay }) {
  return (
    <Box
      className={DRAG}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        cursor: 'move',
        ...(overlay ? {
          flexShrink: 0, zIndex: 3, px: 1, py: 0.25, borderRadius: '10px',
          bgcolor: 'action.hover', color: 'text.primary', border: 1, borderColor: 'divider',
        } : {}),
      }}
    >
      <DragIndicatorIcon sx={{ fontSize: 18, opacity: 0.7 }} />
      {overlay && <Typography variant="caption" sx={{ flex: 1, fontWeight: 600 }} noWrap>{title}</Typography>}
      {onRemove && (
        <Tooltip title="Remove this card">
          <IconButton
            size="small"
            onClick={onRemove}
            onMouseDown={(e) => e.stopPropagation()}
            aria-label={`remove ${title}`}
            sx={{ color: 'inherit', ml: overlay ? 0 : 'auto', p: 0.25 }}
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
  const outline = editing ? { outline: '1px dashed', outlineColor: 'primary.main', outlineOffset: 2 } : {}
  if (bare) {
    // Editing, the bar sits ABOVE the card's own content rather than over its
    // title, so what is being moved can still be read.
    return (
      <Box
        component="section"
        aria-label={label || title}
        sx={{
          position: 'relative', height: fill ? '100%' : 'auto', overflow: fill ? 'auto' : 'visible', borderRadius: '16px', ...outline,
          ...(editing ? { display: 'flex', flexDirection: 'column', gap: 0.5 } : {}),
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
        height: fill ? '100%' : 'auto', display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', ...outline,
      }}
    >
      <Box
        className={editing ? DRAG : undefined}
        sx={{
          display: 'flex', alignItems: 'flex-start', gap: 1, px: { xs: 1.75, sm: 2.25 }, pt: 1.75, pb: 1.25, flexWrap: 'wrap',
          cursor: editing ? 'move' : 'default',
        }}
      >
        {editing && <DragIndicatorIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.25 }} />}
        <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
          <Typography variant="h4">{title}</Typography>
          {sub && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>{sub}</Typography>}
        </Box>
        {!editing && action}
        {editing && onRemove && (
          <Tooltip title="Remove this card">
            <IconButton size="small" onClick={onRemove} onMouseDown={(e) => e.stopPropagation()} aria-label={`remove ${title}`}>
              <CloseIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Box sx={{
        flex: 1, minHeight: 0, overflow: fill ? 'auto' : 'visible', px: { xs: 1.75, sm: 2.25 }, pb: 2,
      }}
      >
        {children}
      </Box>
    </Paper>
  )
}
