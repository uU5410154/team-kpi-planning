import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, IconButton, Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DoneIcon from '@mui/icons-material/Done'
import EditIcon from '@mui/icons-material/Edit'
import {
  isFolder, newApp, moveTo, dropOnto, patchItem, removeItem,
  safeUrl, tintOf, initialsOf,
} from '../lib/homeScreen.js'

/*
 * The grid. One set of numbers, used by the layout, the hit-testing and the
 * animation alike — three copies of "how wide is a tile" is how an icon ends
 * up landing one slot away from where it was dropped.
 */
const TILE = 92
const ICON = 64
const LABEL = 26
const ROW = ICON + LABEL + 18
const HOLD_MS = 450
const MERGE_MS = 420

/** Where slot n sits, given how many fit across. */
const slotOf = (index, cols) => ({
  x: (index % cols) * TILE,
  y: Math.floor(index / cols) * ROW,
})

/**
 * A home screen for the links this team keeps reaching for.
 *
 * Built with pointer events rather than HTML5 drag-and-drop, because the whole
 * point is the feel: the dragged icon follows your finger, the others slide out
 * of its way, and holding one over another for a moment makes a folder. Native
 * drag events give a ghost image and a drop target, which is a different and
 * much worse thing.
 */
export default function Apps({ apps, onChange }) {
  const [editing, setEditing] = useState(false)
  const [openFolder, setOpenFolder] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [drag, setDrag] = useState(null)
  const [mergeInto, setMergeInto] = useState(null)

  const surface = useRef(null)
  const holdTimer = useRef(null)
  const mergeTimer = useRef(null)
  const dragRef = useRef(null)
  const justDragged = useRef(false)
  const [cols, setCols] = useState(6)

  /* How many tiles fit across, measured rather than guessed. */
  useEffect(() => {
    const el = surface.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const measure = () => setCols(Math.max(2, Math.floor((el.clientWidth - 16) / TILE)))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const items = apps || []
  const folder = openFolder ? items.find((it) => it.id === openFolder) : null

  /* The list being arranged: the screen, or the inside of an open folder. */
  const shown = folder ? (folder.items || []) : items

  const stop = useCallback(() => {
    clearTimeout(holdTimer.current)
    clearTimeout(mergeTimer.current)
    setMergeInto(null)
  }, [])

  /**
   * The slot a pointer is over.
   *
   * Rounded to the NEAREST gap rather than the tile it is inside, so an icon
   * dropped just left of centre goes before its neighbour rather than after —
   * which is what the gap opening up in front of you promised it would do.
   */
  const slotAt = (px, py) => {
    const col = Math.max(0, Math.min(cols - 1, Math.round(px / TILE)))
    const row = Math.max(0, Math.floor(py / ROW))
    return Math.max(0, Math.min(shown.length, row * cols + col))
  }

  /** The item a pointer is sitting ON, for folder-making. */
  const itemAt = (px, py) => {
    const col = Math.floor(px / TILE)
    const row = Math.floor(py / ROW)
    if (col < 0 || col >= cols || row < 0) return null
    const index = row * cols + col
    const it = shown[index]
    if (!it) return null
    // Only the middle of a tile merges; the edges are for slipping between.
    const cx = col * TILE + TILE / 2
    const cy = row * ROW + ICON / 2 + 8
    const near = Math.abs(px - cx) < ICON * 0.36 && Math.abs(py - cy) < ICON * 0.42
    return near ? it : null
  }

  const onPointerDown = (e, item) => {
    if (e.button != null && e.button !== 0) return
    const rect = surface.current.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY
    // A long press with no movement is the way into edit mode, exactly as on a
    // phone; a short one is a tap and opens the link.
    holdTimer.current = setTimeout(() => setEditing(true), HOLD_MS)
    dragRef.current = {
      id: item.id,
      startX,
      startY,
      moved: false,
      from: folder ? 'folder' : 'screen',
      x: startX - rect.left,
      y: startY - rect.top,
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 6) return
    if (!d.moved) {
      d.moved = true
      clearTimeout(holdTimer.current)
      setEditing(true)
    }
    const rect = surface.current.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    d.x = px
    d.y = py
    const over = itemAt(px, py)
    const canMerge = over && over.id !== d.id && !isFolder(shown.find((x) => x.id === d.id))
    setDrag({ id: d.id, x: px, y: py, slot: slotAt(px, py) })

    /*
     * A folder needs a MOMENT of hovering, not a passing brush. Without the
     * pause, dragging an icon across a full screen would swallow every icon it
     * crossed on the way.
     */
    if (canMerge && mergeInto !== over.id) {
      clearTimeout(mergeTimer.current)
      mergeTimer.current = setTimeout(() => setMergeInto(over.id), MERGE_MS)
    }
    if (!canMerge) {
      clearTimeout(mergeTimer.current)
      if (mergeInto) setMergeInto(null)
    }
  }

  const onPointerUp = (item) => {
    const d = dragRef.current
    dragRef.current = null
    clearTimeout(holdTimer.current)
    clearTimeout(mergeTimer.current)

    if (!d) return
    if (!d.moved) {
      // Not a drag — the click handler below decides what a tap means.
      setDrag(null)
      setMergeInto(null)
      return
    }
    // Suppress the click the browser sends after the drag we just finished.
    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 60)

    const target = mergeInto
    setDrag(null)
    setMergeInto(null)

    if (folder) {
      // Rearranging inside an open folder.
      const order = [...(folder.items || [])]
      const at = order.findIndex((x) => x.id === d.id)
      const to = Math.max(0, Math.min(order.length - 1, slotAt(d.x, d.y)))
      if (at >= 0 && at !== to) {
        const [moved] = order.splice(at, 1)
        order.splice(to, 0, moved)
        onChange(items.map((it) => (it.id === folder.id ? { ...it, items: order } : it)))
      }
      return
    }

    if (target) {
      onChange(dropOnto(items, d.id, target))
      return
    }
    onChange(moveTo(items, d.id, slotAt(d.x, d.y)))
  }

  /*
   * What a tap means. In edit mode a folder still opens — that is how you
   * rearrange what is inside one — while an app does not, because its own
   * remove and edit buttons are sitting on it.
   */
  const tap = (item) => {
    if (justDragged.current || !item) return
    if (isFolder(item)) { setOpenFolder(item.id); return }
    if (editing) { setDialog({ mode: 'edit', item }); return }
    openApp(item)
  }

  const openApp = (item) => {
    const href = safeUrl(item.url)
    if (!href) {
      setDialog({ mode: 'edit', item })
      return
    }
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  /* Save an app from the dialog. */
  const save = (draft) => {
    const clean = { name: draft.name.trim() || 'New app', url: draft.url.trim(), icon: draft.icon || null }
    if (draft.id) {
      onChange(patchItem(items, draft.id, clean))
    } else if (folder) {
      onChange(items.map((it) => (it.id === folder.id
        ? { ...it, items: [...(it.items || []), newApp(clean)] }
        : it)))
    } else {
      onChange([...items, newApp(clean)])
    }
    setDialog(null)
  }

  const remove = (id) => {
    onChange(removeItem(items, id))
    if (openFolder && !items.some((it) => it.id === openFolder)) setOpenFolder(null)
  }

  const rows = Math.max(1, Math.ceil((shown.length + (editing ? 1 : 0)) / cols))

  /* Where each tile sits, with the dragged one's slot left open. */
  const positions = useMemo(() => {
    const map = new Map()
    let cursor = 0
    const dragSlot = drag ? drag.slot : -1
    shown.forEach((it) => {
      if (drag && it.id === drag.id) return
      if (cursor === dragSlot) cursor += 1
      map.set(it.id, cursor)
      cursor += 1
    })
    return map
  }, [shown, drag])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 300 }}>
          <Typography variant="h2">Apps</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            The links this team keeps reaching for. Drag to rearrange, hold one over another to make a folder, and
            press and hold anywhere to start editing — the same gestures as a phone, and shared with everyone on the
            plan rather than kept in one browser.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {editing ? (
            <Button variant="contained" startIcon={<DoneIcon />} onClick={() => setEditing(false)}>Done</Button>
          ) : (
            <Button variant="outlined" startIcon={<EditIcon />} onClick={() => setEditing(true)}>Arrange</Button>
          )}
          <Button variant="outlined" startIcon={<AddIcon />} onClick={() => setDialog({ mode: 'new' })}>
            Add app
          </Button>
        </Box>
      </Box>

      <Paper
        variant="outlined"
        sx={{
          p: 2,
          minHeight: 320,
          position: 'relative',
          borderRadius: 3,
          background: (t) => (t.palette.mode === 'dark'
            ? 'radial-gradient(1200px 400px at 20% -10%, rgba(80,120,220,0.18), transparent 60%)'
            : 'radial-gradient(1200px 400px at 20% -10%, rgba(80,120,220,0.10), transparent 60%)'),
          userSelect: 'none',
          touchAction: 'none',
        }}
        onPointerMove={onPointerMove}
        onPointerUp={() => onPointerUp(null)}
        onPointerLeave={() => { dragRef.current = null; setDrag(null); stop() }}
      >
        <Box ref={surface} sx={{ position: 'relative', height: rows * ROW + 8 }}>
          {shown.length === 0 && (
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.disabled' }}>
                Nothing here yet — add the first app.
              </Typography>
            </Box>
          )}

          {shown.map((item) => {
            const dragging = drag && drag.id === item.id
            const at = slotOf(positions.get(item.id) ?? 0, cols)
            const pos = dragging
              ? { x: drag.x - ICON / 2, y: drag.y - ICON / 2 - 4 }
              : { x: at.x + (TILE - ICON) / 2, y: at.y }
            return (
              <Box
                key={item.id}
                data-app-id={item.id}
                data-app-kind={isFolder(item) ? 'folder' : 'app'}
                data-app-name={item.name}
                role="button"
                tabIndex={0}
                aria-label={item.name}
                onPointerDown={(e) => onPointerDown(e, item)}
                onPointerUp={() => onPointerUp(item)}
                onClick={() => tap(item)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(item) } }}
                sx={{
                  position: 'absolute',
                  width: ICON,
                  transform: `translate3d(${pos.x}px, ${pos.y}px, 0) scale(${dragging ? 1.18 : 1})`,
                  transition: dragging ? 'none' : 'transform 240ms cubic-bezier(.2,.8,.3,1)',
                  zIndex: dragging ? 20 : 1,
                  cursor: 'pointer',
                  filter: dragging ? 'drop-shadow(0 12px 22px rgba(0,0,0,.45))' : 'none',
                  animation: editing && !dragging ? 'wiggle 320ms ease-in-out infinite alternate' : 'none',
                  '@keyframes wiggle': {
                    from: { rotate: '-1.6deg' },
                    to: { rotate: '1.6deg' },
                  },
                }}
              >
                <Box sx={{ position: 'relative' }}>
                  <AppIcon item={item} merging={mergeInto === item.id} />
                  {editing && (
                    <IconButton
                      size="small"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); remove(item.id) }}
                      sx={{
                        position: 'absolute',
                        top: -8,
                        left: -8,
                        width: 20,
                        height: 20,
                        bgcolor: 'background.paper',
                        border: 1,
                        borderColor: 'divider',
                        '&:hover': { bgcolor: 'error.main', color: '#fff' },
                      }}
                      aria-label={`remove ${item.name}`}
                    >
                      <CloseIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  )}
                  {editing && !isFolder(item) && (
                    <IconButton
                      size="small"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setDialog({ mode: 'edit', item }) }}
                      sx={{
                        position: 'absolute',
                        top: -8,
                        right: -8,
                        width: 20,
                        height: 20,
                        bgcolor: 'background.paper',
                        border: 1,
                        borderColor: 'divider',
                      }}
                      aria-label={`edit ${item.name}`}
                    >
                      <EditIcon sx={{ fontSize: 12 }} />
                    </IconButton>
                  )}
                </Box>
                <Typography
                  variant="caption"
                  align="center"
                  sx={{
                    display: 'block',
                    mt: 0.5,
                    fontSize: '0.68rem',
                    lineHeight: 1.15,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: 'text.primary',
                  }}
                >
                  {item.name}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Paper>

      {folder && (
        <FolderView
          folder={folder}
          onClose={() => setOpenFolder(null)}
          onRename={(name) => onChange(patchItem(items, folder.id, { name }))}
          onOpenApp={openApp}
          onRemove={remove}
          onEject={(id) => onChange(moveTo(items, id, items.length))}
          onAdd={() => setDialog({ mode: 'new' })}
          editing={editing}
        />
      )}

      <AppDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSave={save}
        onMoveOut={folder ? null : undefined}
      />

      <Paper variant="outlined" sx={{ p: 2.5 }}>
        <Typography variant="h4" sx={{ mb: 1 }}>How it works</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.7 }}>
          <strong>Drag</strong> an icon and the others move out of its way; drop it where the gap opened.{' '}
          <strong>Hold one icon over another</strong> for a moment and the two become a folder — named after whatever
          the two apps have in common, if anything. Dragging the second-to-last app out of a folder dissolves it, since
          a folder holding one app is just an app with an extra tap in front of it.{' '}
          <strong>Press and hold</strong> the screen to rearrange, which is also where the remove and edit buttons
          appear. A tap opens the link in a new tab.
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', mt: 1.5 }}>
          Only http and https links are followed. This screen is part of the shared plan, so what you arrange is what
          everybody sees — and pictures are stored at 128 pixels so a hundred apps stay a rounding error next to the
          register.
        </Typography>
      </Paper>
    </Box>
  )
}

/** The rounded square itself: a picture, or the initials on a tint. */
function AppIcon({ item, merging, size = ICON }) {
  const folderish = isFolder(item)
  const hue = tintOf(item.name)
  return (
    <Box
      sx={{
        width: size,
        height: size,
        borderRadius: `${size * 0.24}px`,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        // The ring iOS shows when a drop would make a folder.
        boxShadow: merging
          ? '0 0 0 3px rgba(255,255,255,.85), 0 0 0 6px rgba(80,140,255,.9)'
          : '0 2px 6px rgba(0,0,0,.28)',
        transform: merging ? 'scale(1.08)' : 'none',
        transition: 'transform 160ms ease, box-shadow 160ms ease',
        background: folderish
          ? 'linear-gradient(160deg, rgba(255,255,255,.28), rgba(255,255,255,.08))'
          : (item.icon ? '#fff' : `linear-gradient(160deg, hsl(${hue} 78% 58%), hsl(${hue + 18} 72% 44%))`),
        backdropFilter: folderish ? 'blur(6px)' : 'none',
        border: folderish ? '1px solid rgba(255,255,255,.25)' : 'none',
      }}
    >
      {folderish ? (
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '3px',
          p: '6px',
          width: '100%',
          height: '100%',
        }}
        >
          {(item.items || []).slice(0, 9).map((child) => (
            <Box
              key={child.id}
              sx={{
                borderRadius: '4px',
                overflow: 'hidden',
                background: child.icon ? '#fff' : `hsl(${tintOf(child.name)} 74% 56%)`,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              {child.icon
                ? <Box component="img" src={child.icon} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (
                  <Typography sx={{ fontSize: 7, fontWeight: 800, color: '#fff' }}>
                    {initialsOf(child.name).slice(0, 1)}
                  </Typography>
                )}
            </Box>
          ))}
        </Box>
      ) : item.icon ? (
        <Box component="img" src={item.icon} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: size * 0.3, letterSpacing: '.02em' }}>
          {initialsOf(item.name)}
        </Typography>
      )}
    </Box>
  )
}

/** An opened folder: the iOS sheet, with its name editable in place. */
function FolderView({ folder, onClose, onRename, onOpenApp, onRemove, onEject, onAdd, editing }) {
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} PaperProps={{ sx: { borderRadius: 3 }, 'data-folder-open': folder.id }}>
      <DialogTitle sx={{ pb: 1 }}>
        <TextField
          variant="standard"
          value={folder.name}
          onChange={(e) => onRename(e.target.value)}
          inputProps={{ style: { textAlign: 'center', fontSize: '1.05rem', fontWeight: 700 } }}
          fullWidth
        />
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-start', py: 1 }}>
          {(folder.items || []).map((child) => (
            <Box key={child.id} sx={{ width: ICON, textAlign: 'center' }}>
              <Box sx={{ position: 'relative' }}>
                <Box onClick={() => onOpenApp(child)} sx={{ cursor: 'pointer' }}>
                  <AppIcon item={child} />
                </Box>
                {editing && (
                  <IconButton
                    size="small"
                    onClick={() => onRemove(child.id)}
                    sx={{
                      position: 'absolute', top: -8, left: -8, width: 20, height: 20, bgcolor: 'background.paper', border: 1, borderColor: 'divider',
                    }}
                    aria-label={`remove ${child.name}`}
                  >
                    <CloseIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                )}
              </Box>
              <Typography variant="caption" noWrap sx={{ display: 'block', mt: 0.5, fontSize: '0.68rem' }}>
                {child.name}
              </Typography>
              <Tooltip title="Take it out of the folder">
                <Button size="small" data-eject={child.id} sx={{ fontSize: '0.6rem', minWidth: 0, px: 0.5 }} onClick={() => onEject(child.id)}>
                  move out
                </Button>
              </Tooltip>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onAdd} startIcon={<AddIcon />}>Add to this folder</Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}

/** Add or edit one app: a name, a link, and a picture. */
function AppDialog({ state, onClose, onSave }) {
  const [draft, setDraft] = useState({ name: '', url: '', icon: null })
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!state) return
    const it = state.item
    setDraft(it ? { id: it.id, name: it.name, url: it.url || '', icon: it.icon || null } : { name: '', url: '', icon: null })
    setError(null)
  }, [state])

  /*
   * The picture is squared off and shrunk to 128 before it is stored. A photo
   * off a phone is three megabytes; a hundred of those would be a plan nobody
   * could save, and at icon size nobody could tell the difference anyway.
   */
  const takeImage = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const side = Math.min(img.width, img.height)
        const canvas = document.createElement('canvas')
        canvas.width = 128
        canvas.height = 128
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128)
        setDraft((d) => ({ ...d, icon: canvas.toDataURL('image/png') }))
      }
      img.onerror = () => setError('That file could not be read as an image.')
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  if (!state) return null
  return (
    <Dialog open fullWidth maxWidth="xs" onClose={onClose}>
      <DialogTitle>{draft.id ? 'Edit app' : 'Add an app'}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, mt: 0.5 }}>
          <AppIcon item={{ name: draft.name || 'App', icon: draft.icon }} size={72} />
          <Box>
            <Button component="label" size="small" variant="outlined">
              Choose picture
              <input hidden type="file" accept="image/*" onChange={(e) => takeImage(e.target.files?.[0])} />
            </Button>
            {draft.icon && (
              <Button size="small" onClick={() => setDraft((d) => ({ ...d, icon: null }))} sx={{ ml: 1 }}>
                Remove
              </Button>
            )}
            <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', mt: 0.5 }}>
              Squared off and stored at 128px. Without one, the initials are used.
            </Typography>
          </Box>
        </Box>
        <TextField
          fullWidth
          size="small"
          label="Name"
          name="app-name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          sx={{ mb: 2 }}
          autoFocus
        />
        <TextField
          fullWidth
          size="small"
          label="Link"
          name="app-url"
          placeholder="lotusretails.atlassian.net/jira/software/..."
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          error={!!error}
          helperText={error || 'http and https only. Typed without one, https is assumed.'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => {
            if (draft.url.trim() && !safeUrl(draft.url)) {
              setError('That is not a link this can open.')
              return
            }
            onSave(draft)
          }}
        >
          {draft.id ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
