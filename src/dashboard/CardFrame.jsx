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

/*
 * The handles laid over a bare card while the board is arranged: a grip and
 * a cross in one small raised group at its top-right corner. The card's own
 * label already names it, so the group carries no title of its own.
 */
function EditHandles({ title, onRemove }) {
  return (
    <Box
      data-edit-handles
      sx={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        height: 28,
        pl: 1,
        pr: onRemove ? 0.5 : 1,
        borderRadius: '6px',
        bgcolor: 'bg.raised',
        border: 1,
        borderColor: 'border.subtle',
      }}
    >
      <DragIndicatorIcon aria-hidden sx={{ fontSize: 16, color: 'text.tertiary' }} />
      {onRemove && (
        <Tooltip title="Remove this card">
          <IconButton
            size="small"
            onClick={onRemove}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            aria-label={`remove ${title}`}
            sx={{ color: 'text.secondary', p: 0.5, borderRadius: '4px' }}
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
    /*
     * Editing, the whole tile is what is dragged (it has no buttons of its
     * own to keep working), and the grip and cross sit over its corner. The
     * tile keeps its size and its own label, so it reads as it will on the
     * board.
     */
    return (
      <Box
        component="section"
        aria-label={label || title}
        className={editing ? DRAG : undefined}
        sx={{
          position: 'relative',
          height: fill ? '100%' : 'auto',
          overflow: fill ? 'auto' : 'visible',
          borderRadius: '8px',
          ...outline,
          ...(editing ? { cursor: 'move', userSelect: 'none' } : {}),
        }}
      >
        {editing && <EditHandles title={title} onRemove={onRemove} />}
        {children}
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
