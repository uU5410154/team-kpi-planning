import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, IconButton, Tooltip, MenuItem, Select, FormControl, InputLabel,
  Autocomplete, Tabs, Tab, Skeleton, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DoneIcon from '@mui/icons-material/Done'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import AppsOutlinedIcon from '@mui/icons-material/AppsOutlined'
import FilterListOffIcon from '@mui/icons-material/FilterListOff'
import {
  isFolder, newApp, moveTo, dropOnto, patchItem, removeItem,
  safeUrl, linkOf, initialsOf,
} from '../lib/homeScreen.js'
import {
  PageHeader, StatusPill, EmptyState,
} from '../components/ui.jsx'
import { APP_STATUSES, APP_DEPARTMENTS, statusOf } from '../data/appCatalog.js'

/*
 * The grid. One set of numbers, used by the layout, the hit-testing and the
 * animation alike: three copies of "how wide is a tile" is how a card ends up
 * landing one slot away from where it was dropped.
 *
 * Desktop: as many 220px-or-wider cards as fit. Tablet: two. Phone: one list.
 */
const MIN_TILE = 220
const GAP = 16
const CARD_H = 96
const ROW_H = 64
const HOLD_MS = 450
const MERGE_MS = 420

/** The tone a status draws in, for the pill and the dot. */
const toneOf = (id) => statusOf(id)?.tone || 'neutral'

/** "No apps in POC for Finance", worded for whichever filters are set. */
const emptyTitle = (status, dept) => {
  const label = statusOf(status)?.label
  if (label && dept !== 'all') return `No apps in ${label} for ${dept}`
  if (label) return `No apps in ${label}`
  return `No apps for ${dept}`
}

/**
 * The F&A team's apps: a launcher card for each, by status and department.
 *
 * Arranging is built with pointer events rather than HTML5 drag-and-drop,
 * because the point is the feel: the dragged card follows the pointer, the
 * others slide out of its way, and holding one over another for a moment
 * makes a folder. The screen is shared: what one person arranges, everyone
 * sees.
 */
export default function Apps({ apps, onChange, loading = false }) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
  const tablet = useMediaQuery(theme.breakpoints.between('sm', 'md'), { noSsr: true })

  const [editing, setEditing] = useState(false)
  const [openFolder, setOpenFolder] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [drag, setDrag] = useState(null)
  const [mergeInto, setMergeInto] = useState(null)

  const [surface, setSurface] = useState(null)
  const holdTimer = useRef(null)
  const mergeTimer = useRef(null)
  const dragRef = useRef(null)
  const justDragged = useRef(false)
  const [width, setWidth] = useState(0)

  /* How wide the grid is, measured rather than guessed. */
  useLayoutEffect(() => {
    if (!surface) return undefined
    const measure = () => setWidth(surface.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(measure)
    ro.observe(surface)
    return () => ro.disconnect()
  }, [surface])

  const gap = phone ? 0 : GAP
  const cols = phone ? 1 : tablet ? 2 : Math.max(1, Math.floor((width + GAP) / (MIN_TILE + GAP)))
  const tileW = Math.max(0, (width - gap * (cols - 1)) / cols)
  const tileH = phone ? ROW_H : CARD_H
  const pitchX = tileW + gap
  const pitchY = tileH + gap
  const slotOf = (index) => ({ x: (index % cols) * pitchX, y: Math.floor(index / cols) * pitchY })

  const items = useMemo(() => apps || [], [apps])

  /*
   * WHERE EACH APP STANDS, AND WHOSE IT IS: the status tabs and the department
   * filter. Filtering shows the matching apps on their own (folders opened up),
   * in their screen order; arranging happens on the unfiltered screen.
   */
  const [status, setStatus] = useState('all')
  const [dept, setDept] = useState('all')
  const flat = useMemo(() => items.flatMap((it) => (isFolder(it) ? (it.items || []) : [it])), [items])
  const departments = useMemo(() => [...new Set(flat.map((a) => a.department).filter(Boolean))].sort(), [flat])
  const inDept = flat.filter((a) => dept === 'all' || a.department === dept)
  const countOf = (id) => inDept.filter((a) => a.status === id).length
  const filtering = status !== 'all' || dept !== 'all'
  const filtered = filtering ? inDept.filter((a) => status === 'all' || a.status === status) : null
  const clearFilters = () => { setStatus('all'); setDept('all') }

  const folder = !filtering && openFolder ? items.find((it) => it.id === openFolder) : null
  const firstLoad = loading && items.length === 0

  /* The cards on screen: the filtered apps, or the screen itself. */
  const shown = filtered || items

  const stop = useCallback(() => {
    clearTimeout(holdTimer.current)
    clearTimeout(mergeTimer.current)
    setMergeInto(null)
  }, [])
  useEffect(() => stop, [stop])

  /**
   * The slot the dragged card's centre is over.
   *
   * Rounded to the NEAREST gap rather than the card it is inside, so a card
   * dropped just left of centre goes before its neighbour rather than after:
   * which is what the gap opening up in front of it promised.
   */
  const slotAt = (cx, cy) => {
    if (cols === 1) return Math.max(0, Math.min(shown.length - 1, Math.round((cy - tileH / 2) / pitchY)))
    const col = Math.max(0, Math.min(cols, Math.round(cx / pitchX)))
    const row = Math.max(0, Math.floor(cy / pitchY))
    return Math.max(0, Math.min(shown.length - 1, row * cols + col))
  }

  /** The card (other than the dragged one) whose middle the dragged card's centre is over. */
  const itemAt = (cx, cy, dragId) => {
    const col = Math.floor(cx / pitchX)
    const row = Math.floor(cy / pitchY)
    if (col < 0 || col >= cols || row < 0) return null
    const it = shown.find((x) => x.id !== dragId && positions.get(x.id) === row * cols + col)
    if (!it) return null
    // Only the middle of a card merges; the edges are for slipping between.
    const mx = col * pitchX + tileW / 2
    const my = row * pitchY + tileH / 2
    return Math.abs(cx - mx) < tileW * 0.3 && Math.abs(cy - my) < tileH * 0.36 ? it : null
  }

  const onPointerDown = (e, item) => {
    if (e.button != null && e.button !== 0) return
    if (filtering || !surface) return
    const rect = surface.getBoundingClientRect()
    const at = slotOf(positions.get(item.id) ?? 0)
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // A long press with no movement is the way into arranging, exactly as on a
    // phone; a short one is a tap and opens the link.
    holdTimer.current = setTimeout(() => {
      setEditing(true)
      if (dragRef.current) dragRef.current.held = true
    }, HOLD_MS)
    dragRef.current = {
      id: item.id,
      startX: e.clientX,
      startY: e.clientY,
      grabX: px - at.x,
      grabY: py - at.y,
      moved: false,
      held: false,
      // On a touch screen only the handle drags; anywhere else a finger scrolls.
      handle: !!e.target.closest?.('[data-drag-handle]'),
      x: px,
      y: py,
    }
    if (e.pointerType === 'mouse' || dragRef.current.handle) e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const centreOf = (d) => ({ cx: d.x - d.grabX + tileW / 2, cy: d.y - d.grabY + tileH / 2 })

  const onPointerMove = (e) => {
    const d = dragRef.current
    if (!d || !surface) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 6) return
    if (!d.moved) {
      if (e.pointerType !== 'mouse' && !d.handle && !d.held) {
        // A finger moving anywhere but the handle is a scroll, not a drag.
        clearTimeout(holdTimer.current)
        dragRef.current = null
        return
      }
      d.moved = true
      clearTimeout(holdTimer.current)
      setEditing(true)
    }
    const rect = surface.getBoundingClientRect()
    d.x = e.clientX - rect.left
    d.y = e.clientY - rect.top
    const { cx, cy } = centreOf(d)
    const over = itemAt(cx, cy, d.id)
    const canMerge = over && !isFolder(shown.find((x) => x.id === d.id))
    // Over another card's middle, the gap stays where it was: the card being
    // aimed at holds still instead of sliding out from under the pointer.
    const slot = canMerge ? (drag && drag.id === d.id ? drag.slot : (positions.get(d.id) ?? 0)) : slotAt(cx, cy)
    setDrag({
      id: d.id, x: d.x - d.grabX, y: d.y - d.grabY, slot,
    })

    /*
     * A folder needs a MOMENT of hovering, not a passing brush. Without the
     * pause, dragging a card across a full screen would swallow every card it
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

  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    clearTimeout(holdTimer.current)
    clearTimeout(mergeTimer.current)

    if (!d) return
    if (!d.moved) {
      setDrag(null)
      setMergeInto(null)
      // A long press started arranging; the click that follows is not a tap.
      if (d.held) {
        justDragged.current = true
        setTimeout(() => { justDragged.current = false }, 60)
      }
      return
    }
    // Suppress the click the browser sends after the drag just finished.
    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 60)

    const target = mergeInto
    const { cx, cy } = centreOf(d)
    setDrag(null)
    setMergeInto(null)

    if (target) {
      onChange(dropOnto(items, d.id, target))
      return
    }
    onChange(moveTo(items, d.id, slotAt(cx, cy)))
  }

  const cancelDrag = () => {
    dragRef.current = null
    setDrag(null)
    stop()
  }

  /*
   * What a tap means. While arranging, a folder still opens and an app opens
   * its editor; otherwise a folder opens and an app opens its link.
   */
  const tap = (item) => {
    if (justDragged.current || !item) return
    if (isFolder(item)) { setOpenFolder(item.id); return }
    if (editing) { setDialog({ mode: 'edit', item }); return }
    openApp(item)
  }

  const openApp = (item) => {
    const href = linkOf(item.url)
    if (!href) return
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  /* Save an app from the dialog. */
  const save = (draft) => {
    const clean = {
      name: draft.name.trim() || 'New app',
      url: draft.url.trim(),
      icon: draft.icon || null,
      department: (draft.department || '').trim() || null,
      status: draft.status || null,
      note: (draft.note || '').trim(),
    }
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
    const next = removeItem(items, id)
    onChange(next)
    if (openFolder && !next.some((it) => it.id === openFolder)) setOpenFolder(null)
  }

  /* Where each card sits, with the dragged one's slot left open. */
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
    if (drag) map.set(drag.id, drag.slot)
    return map
  }, [shown, drag])

  const rows = Math.max(1, Math.ceil(shown.length / cols))
  const gridHeight = rows * pitchY - gap

  const about = (
    <>
      <p>Click a card to open the app in a new tab. Cards that say Link coming have no address yet.</p>
      <p>
        To arrange, press Arrange or press and hold any card. Drag a card to reorder it. Hold it over another
        app for a moment and the two become a folder. Take apps out of a folder from inside it; a folder left
        with one app turns back into that app.
      </p>
      <p>This page is shared: what you add or arrange, everyone on the team sees.</p>
      <p>Only http and https links open. Pictures are stored at 128 pixels.</p>
    </>
  )

  return (
    <Box>
      <PageHeader
        title="Apps"
        description="Tools the F&A team uses, by status and department."
        help={about}
        actions={(
          <>
            {editing ? (
              <Button variant="contained" startIcon={<DoneIcon />} onClick={() => setEditing(false)}>Done</Button>
            ) : (
              <Button
                variant="outlined"
                startIcon={<DragIndicatorIcon />}
                onClick={() => { clearFilters(); setEditing(true) }}
                disabled={firstLoad}
              >
                Arrange
              </Button>
            )}
            <Button
              variant={editing ? 'outlined' : 'contained'}
              startIcon={<AddIcon />}
              onClick={() => setDialog({ mode: 'new' })}
              disabled={firstLoad}
            >
              Add app
            </Button>
          </>
        )}
      >
        {/* Status tabs, and the department filter at the right end of the row. */}
        <Box
          data-app-filters
          sx={{
            display: 'flex',
            alignItems: { xs: 'stretch', sm: 'center' },
            flexDirection: { xs: 'column', sm: 'row' },
            gap: { xs: 3, sm: 4 },
            borderBottom: { sm: 1 },
            borderColor: { sm: 'border.subtle' },
          }}
        >
          <Tabs
            value={status}
            onChange={(_e, v) => { setStatus(v); setEditing(false) }}
            variant="scrollable"
            scrollButtons={false}
            aria-label="App status"
            sx={{
              flex: '1 1 auto',
              minWidth: 0,
              borderBottom: { xs: 1, sm: 0 },
              borderColor: { xs: 'border.subtle' },
              // The underline sits exactly under each label, and "All" lines up with the title.
              '& .MuiTab-root': { px: 0, mr: 6, flexShrink: 0 },
              '& .MuiTab-root:last-of-type': { mr: 0 },
            }}
          >
            <Tab
              value="all"
              data-status-tab="all"
              label={<TabLabel label="All" count={firstLoad ? null : inDept.length} />}
            />
            {APP_STATUSES.map((s) => (
              <Tab
                key={s.id}
                value={s.id}
                data-status-tab={s.id}
                label={<TabLabel label={s.label} tone={s.tone} count={firstLoad ? null : countOf(s.id)} />}
              />
            ))}
          </Tabs>
          {departments.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 168, flexShrink: 0, mb: { sm: 1 } }}>
              <Select
                value={dept}
                onChange={(e) => { setDept(e.target.value); setEditing(false) }}
                inputProps={{ 'aria-label': 'Department' }}
                data-dept-filter
                sx={{ height: { xs: 40, sm: 32 } }}
                renderValue={(v) => (v === 'all' ? 'All departments' : v)}
              >
                <MenuItem value="all">All departments</MenuItem>
                {departments.map((d) => (
                  <MenuItem key={d} value={d} sx={{ display: 'flex', gap: 4 }}>
                    <Box component="span" sx={{ flex: 1 }}>{d}</Box>
                    <Box component="span" sx={{ color: 'text.tertiary' }}>{flat.filter((a) => a.department === d).length}</Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </Box>
      </PageHeader>

      {firstLoad && <AppsSkeleton phone={phone} tablet={tablet} />}

      {!firstLoad && shown.length === 0 && (
        <Box sx={{ border: 1, borderColor: 'border.subtle', borderRadius: '8px', bgcolor: 'bg.surface' }}>
          {filtering ? (
            <EmptyState
              icon={FilterListOffIcon}
              title={emptyTitle(status, dept)}
              body="Pick another status or department to see more."
              action={<Button variant="text" onClick={clearFilters}>Show all</Button>}
            />
          ) : (
            <EmptyState
              icon={AppsOutlinedIcon}
              title="No apps yet"
              body="Add the tools the team opens most. Everyone sees the same page."
            />
          )}
        </Box>
      )}

      {!firstLoad && shown.length > 0 && (
        <Box
          ref={setSurface}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
          sx={{
            position: 'relative',
            height: gridHeight,
            userSelect: 'none',
            WebkitTouchCallout: 'none',
            touchAction: 'pan-y',
            ...(phone && {
              border: 1, borderColor: 'border.subtle', borderRadius: '8px', bgcolor: 'bg.surface', height: gridHeight + 2,
            }),
          }}
        >
          {width > 0 && shown.map((item) => {
            const dragging = drag && drag.id === item.id
            const slot = positions.get(item.id) ?? 0
            const at = slotOf(slot)
            const pos = dragging ? { x: drag.x, y: drag.y } : at
            return (
              <AppTile
                key={item.id}
                item={item}
                phone={phone}
                width={tileW}
                height={tileH}
                x={pos.x}
                y={pos.y}
                first={slot === 0}
                last={slot === shown.length - 1}
                dragging={!!dragging}
                merging={mergeInto === item.id}
                editing={editing}
                onPointerDown={(e) => onPointerDown(e, item)}
                onTap={(e) => {
                  const href = !editing && !isFolder(item) ? linkOf(item.url) : null
                  // Ctrl/Cmd-click or a middle click: let the browser open it its own way.
                  if (href && !justDragged.current && (e.metaKey || e.ctrlKey || e.shiftKey)) return
                  e.preventDefault()
                  tap(item)
                }}
                onEdit={() => setDialog({ mode: 'edit', item })}
                onRemove={() => setConfirm(item)}
              />
            )
          })}
        </Box>
      )}

      {/*
        The hint while arranging floats at the bottom rather than above the
        grid: pushing the cards down mid-drag would move the very card the
        pointer is aiming at.
      */}
      {editing && !filtering && !firstLoad && (
        <Box
          role="note"
          sx={{
            position: 'sticky',
            bottom: { xs: 12, sm: 16 },
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            width: 'fit-content',
            maxWidth: '100%',
            mx: 'auto',
            mt: 5,
            px: 4,
            py: 2,
            borderRadius: '8px',
            bgcolor: 'bg.raised',
            border: 1,
            borderColor: 'border.subtle',
            boxShadow: (t) => (t.palette.mode === 'dark' ? '0 8px 24px rgba(0,0,0,.45)' : '0 8px 24px rgba(16,24,40,.12)'),
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 18, color: 'text.tertiary', flexShrink: 0 }} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Drag to reorder. Drop on another app to make a folder.
          </Typography>
        </Box>
      )}

      {folder && (
        <FolderView
          folder={folder}
          phone={phone}
          onClose={() => setOpenFolder(null)}
          onRename={(name) => onChange(patchItem(items, folder.id, { name }))}
          onOpenApp={openApp}
          onRemove={(child) => setConfirm(child)}
          onEject={(id) => onChange(moveTo(items, id, items.length))}
          onAdd={() => setDialog({ mode: 'new' })}
          editing={editing}
        />
      )}

      <AppDialog
        state={dialog}
        onClose={() => setDialog(null)}
        onSave={save}
        departments={departments}
      />

      <ConfirmRemove
        item={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => { remove(confirm.id); setConfirm(null) }}
      />
    </Box>
  )
}

/** A tab's words: a status dot, the label, the count in the quiet colour. */
function TabLabel({ label, tone, count }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.5, whiteSpace: 'nowrap' }}>
      {tone && (
        <Box
          component="span"
          aria-hidden
          sx={(t) => ({
            width: 6, height: 6, borderRadius: '50%', bgcolor: (t.palette.tone[tone] || t.palette.tone.neutral).solid,
          })}
        />
      )}
      {label}
      {count != null && <Box component="span" sx={{ color: 'text.tertiary', fontWeight: 400 }}>{count}</Box>}
    </Box>
  )
}

/**
 * One app, or one folder, as a launcher card (a list row on a phone).
 * The whole card is the link; while arranging it is the drag handle.
 */
function AppTile({
  item, phone, width, height, x, y, first, last, dragging, merging, editing, onPointerDown, onTap, onEdit, onRemove,
}) {
  const folderish = isFolder(item)
  const st = !folderish ? statusOf(item.status) : null
  const href = !folderish ? linkOf(item.url) : null
  const live = editing || folderish || !!href
  const asLink = !!href && !editing
  // An app with a link stays an <a> while arranging (without its href), so the
  // card under a drag that starts arranging is not swapped for a new element
  // mid-gesture, which would drop the pointer.
  const count = folderish ? (item.items || []).length : 0
  const tip = !editing && !dragging && item.note ? item.note : ''

  const sub = folderish
    ? `${count} apps`
    : (item.department || (phone ? '' : 'No department'))

  const keep = (e) => e.stopPropagation()
  const controls = editing && (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        bgcolor: 'bg.raised',
        border: 1,
        borderColor: 'border.subtle',
        borderRadius: '6px',
        ...(!phone && { position: 'absolute', top: 8, right: 8 }),
        '& .MuiIconButton-root': {
          width: phone ? 36 : 24, height: phone ? 36 : 24, borderRadius: '5px', color: 'text.secondary',
        },
      }}
    >
      <Box
        data-drag-handle
        aria-hidden
        sx={{
          width: phone ? 36 : 22, height: phone ? 36 : 24, display: 'grid', placeItems: 'center', color: 'text.tertiary', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none',
        }}
      >
        <DragIndicatorIcon sx={{ fontSize: phone ? 20 : 16 }} />
      </Box>
      {!folderish && (
        <Tooltip title="Edit">
          <IconButton onPointerDown={keep} onClick={(e) => { e.stopPropagation(); onEdit() }} aria-label={`edit ${item.name}`}>
            <EditOutlinedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Remove">
        <IconButton
          onPointerDown={keep}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          aria-label={`remove ${item.name}`}
          sx={{ '&:hover': { color: 'error.main' } }}
        >
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )

  const pill = st && (
    <StatusPill tone={st.tone} data-app-status={item.status}>{st.label}</StatusPill>
  )

  const name = (
    <Typography
      variant="body1"
      component="div"
      sx={{
        fontWeight: 500,
        lineHeight: '20px',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: phone || (!href && !folderish) ? 1 : 2,
        WebkitBoxOrient: 'vertical',
        overflowWrap: 'anywhere',
        color: 'text.primary',
      }}
    >
      {item.name}
    </Typography>
  )

  const linkComing = !folderish && !href && (
    <Typography variant="caption" component="div" sx={{ color: 'text.tertiary' }}>Link coming</Typography>
  )

  const body = phone ? (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 3, height: '100%', px: 3,
    }}
    >
      <AppIcon item={item} merging={merging} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {name}
        <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
          {sub}
          {!folderish && !href && (
            <Box component="span" sx={{ color: 'text.tertiary' }}>{sub ? ', link coming' : 'Link coming'}</Box>
          )}
        </Typography>
      </Box>
      {editing ? controls : pill}
    </Box>
  ) : (
    <Box sx={{
      display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', p: 3,
    }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, minHeight: 40 }}>
        <AppIcon item={item} merging={merging} />
        <Box sx={{ flex: 1, minWidth: 0, pr: editing ? (folderish ? 12 : 18) : 0 }}>
          {name}
          {linkComing}
        </Box>
        {asLink && <OpenInNewIcon aria-hidden sx={{ fontSize: 16, color: 'text.tertiary', alignSelf: 'flex-start', mt: 0.5 }} />}
      </Box>
      <Box sx={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, minHeight: 20,
      }}
      >
        <Typography variant="body2" noWrap sx={{ color: item.department || folderish ? 'text.secondary' : 'text.tertiary', minWidth: 0 }}>
          {sub}
        </Typography>
        {pill}
      </Box>
      {controls}
    </Box>
  )

  return (
    <Tooltip title={tip} placement="bottom-start" enterDelay={500} disableInteractive>
      <Box
        component={href ? 'a' : 'div'}
        href={asLink ? href : undefined}
        target={asLink ? '_blank' : undefined}
        rel={asLink ? 'noopener noreferrer' : undefined}
        draggable={false}
        data-app-id={item.id}
        data-app-kind={folderish ? 'folder' : 'app'}
        data-app-name={item.name}
        role={asLink ? undefined : (live ? 'button' : undefined)}
        tabIndex={live ? 0 : -1}
        aria-label={folderish ? `${item.name}, folder of ${count} apps` : (editing ? `edit ${item.name}` : item.name)}
        aria-disabled={live ? undefined : true}
        onPointerDown={onPointerDown}
        onClick={onTap}
        onKeyDown={(e) => {
          // A link already turns Enter into a click; a button-like card needs telling.
          if (!live || asLink) return
          if (e.key === 'Enter' || e.key === ' ') onTap(e)
        }}
        sx={(t) => ({
          position: 'absolute',
          left: 0,
          top: 0,
          width,
          height,
          display: 'block',
          color: 'inherit',
          textDecoration: 'none',
          transform: `translate3d(${x}px, ${y}px, 0)`,
          transition: dragging ? 'none' : 'transform 180ms ease-out, background-color 120ms, border-color 120ms',
          zIndex: dragging ? 20 : 1,
          cursor: editing ? (dragging ? 'grabbing' : 'grab') : (live ? 'pointer' : 'default'),
          outline: merging ? `2px solid ${t.palette.primary.main}` : undefined,
          outlineOffset: merging ? 1 : undefined,
          ...(phone ? {
            bgcolor: dragging ? 'bg.raised' : (merging ? 'primary.tint' : 'transparent'),
            borderTop: first && !dragging ? 0 : 1,
            borderColor: 'border.subtle',
            borderRadius: dragging ? '8px' : `${first ? 8 : 0}px ${first ? 8 : 0}px ${last ? 8 : 0}px ${last ? 8 : 0}px`,
            ...(dragging && { border: 1, borderColor: 'border.strong' }),
          } : {
            bgcolor: dragging ? 'bg.raised' : (merging ? 'primary.tint' : 'bg.surface'),
            border: 1,
            borderColor: dragging ? 'border.strong' : 'border.subtle',
            borderRadius: '8px',
          }),
          boxShadow: dragging ? (t.palette.mode === 'dark' ? '0 8px 24px rgba(0,0,0,.45)' : '0 8px 24px rgba(16,24,40,.12)') : 'none',
          ...(live && !dragging && {
            '&:hover': { bgcolor: merging ? 'primary.tint' : 'bg.subtle', ...(!phone && { borderColor: 'border.strong' }) },
          }),
          '&:focus-visible': { outlineOffset: phone ? -2 : 2 },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      >
        {body}
      </Box>
    </Tooltip>
  )
}

/** The square itself: a picture, a folder's first four, or neutral initials. */
function AppIcon({ item, merging, size = 40 }) {
  const folderish = isFolder(item)
  const radius = size >= 56 ? 10 : size <= 32 ? 6 : 8
  return (
    <Box
      aria-hidden
      sx={(t) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${radius}px`,
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
        position: 'relative',
        bgcolor: 'bg.subtle',
        transform: merging ? 'scale(1.06)' : 'none',
        transition: 'transform 120ms ease-out',
        // A hairline inside the edge, so a white picture still has a shape on a white card.
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          boxShadow: `inset 0 0 0 1px ${t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(16,24,40,0.08)'}`,
          pointerEvents: 'none',
        },
      })}
    >
      {folderish ? (
        <Box sx={{
          display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '2px', p: '4px', width: '100%', height: '100%',
        }}
        >
          {(item.items || []).slice(0, 4).map((child) => (
            <Box
              key={child.id}
              sx={{
                borderRadius: '3px', overflow: 'hidden', bgcolor: 'border.subtle', display: 'grid', placeItems: 'center',
              }}
            >
              {child.icon
                ? <Box component="img" src={child.icon} alt="" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : (
                  <Typography component="span" sx={{ fontSize: 8, fontWeight: 600, color: 'text.secondary', lineHeight: 1 }}>
                    {initialsOf(child.name).slice(0, 1)}
                  </Typography>
                )}
            </Box>
          ))}
        </Box>
      ) : item.icon ? (
        <Box component="img" src={item.icon} alt="" draggable={false} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Typography component="span" sx={{ fontWeight: 600, color: 'text.secondary', fontSize: Math.round(size * 0.34), lineHeight: 1 }}>
          {initialsOf(item.name)}
        </Typography>
      )}
    </Box>
  )
}

/** Eight placeholder cards in the grid's own shape while the shared page loads. */
function AppsSkeleton({ phone, tablet }) {
  const cards = Array.from({ length: 8 }, (_, i) => i)
  return (
    <Box
      role="status"
      aria-live="polite"
      aria-label="Loading apps"
      data-loading
      sx={phone ? {
        border: 1, borderColor: 'border.subtle', borderRadius: '8px', bgcolor: 'bg.surface',
      } : {
        display: 'grid',
        gap: `${GAP}px`,
        gridTemplateColumns: tablet ? 'repeat(2, minmax(0, 1fr))' : `repeat(auto-fill, minmax(${MIN_TILE}px, 1fr))`,
      }}
    >
      {cards.map((i) => (phone ? (
        <Box
          key={i}
          sx={{
            height: ROW_H, display: 'flex', alignItems: 'center', gap: 3, px: 3, borderTop: i ? 1 : 0, borderColor: 'border.subtle',
          }}
        >
          <Skeleton variant="rounded" width={40} height={40} sx={{ borderRadius: '8px' }} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width={`${50 + ((i * 17) % 30)}%`} height={18} />
            <Skeleton variant="text" width={80} height={16} />
          </Box>
          <Skeleton variant="rounded" width={52} height={20} sx={{ borderRadius: '4px' }} />
        </Box>
      ) : (
        <Box
          key={i}
          sx={{
            height: CARD_H, p: 3, border: 1, borderColor: 'border.subtle', borderRadius: '8px', bgcolor: 'bg.surface', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Skeleton variant="rounded" width={40} height={40} sx={{ borderRadius: '8px', flexShrink: 0 }} />
            <Skeleton variant="text" width={`${45 + ((i * 17) % 35)}%`} height={18} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Skeleton variant="text" width={80} height={16} />
            <Skeleton variant="rounded" width={52} height={20} sx={{ borderRadius: '4px' }} />
          </Box>
        </Box>
      )))}
    </Box>
  )
}

/** Remove an app or a folder, after saying who it disappears for. */
function ConfirmRemove({ item, onClose, onConfirm }) {
  if (!item) return null
  const folderish = isFolder(item)
  const n = folderish ? (item.items || []).length : 0
  return (
    <Dialog open fullWidth maxWidth="sm" onClose={onClose} aria-labelledby="remove-app-title">
      <DialogTitle id="remove-app-title">{`Remove ${item.name}?`}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {folderish
            ? `The folder and the ${n} apps in it leave the Apps page for everyone.`
            : 'It leaves the Apps page for everyone. You can add it again later.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="outlined" color="error" onClick={onConfirm}>Remove</Button>
      </DialogActions>
    </Dialog>
  )
}

/** An opened folder: its name, editable in place, and its apps as rows. */
function FolderView({
  folder, phone, onClose, onRename, onOpenApp, onRemove, onEject, onAdd, editing,
}) {
  return (
    <Dialog
      open
      fullWidth
      maxWidth="sm"
      fullScreen={phone}
      onClose={onClose}
      aria-label={`Folder ${folder.name}`}
      PaperProps={{ 'data-folder-open': folder.id }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, pb: 2 }}>
        <TextField
          size="small"
          label="Folder name"
          value={folder.name}
          onChange={(e) => onRename(e.target.value)}
          sx={{ flex: 1, mt: 1 }}
        />
        <Tooltip title="Close">
          <IconButton onClick={onClose} aria-label="close folder" sx={{ mt: 1 }}><CloseIcon /></IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent sx={{ px: 0 }}>
        {(folder.items || []).map((child, i) => {
          const st = statusOf(child.status)
          const href = linkOf(child.url)
          return (
            <Box
              key={child.id}
              sx={{
                display: 'flex', alignItems: 'center', gap: 3, px: 5, py: 2, borderTop: i ? 1 : 0, borderColor: 'border.subtle',
              }}
            >
              <Box
                role={href ? 'link' : undefined}
                tabIndex={href ? 0 : -1}
                onClick={() => onOpenApp(child)}
                onKeyDown={(e) => { if (e.key === 'Enter') onOpenApp(child) }}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 3, flex: 1, minWidth: 0, cursor: href ? 'pointer' : 'default', borderRadius: '6px',
                }}
              >
                <AppIcon item={child} size={32} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body1" noWrap sx={{ fontWeight: 500 }}>{child.name}</Typography>
                  <Typography variant="body2" noWrap sx={{ color: 'text.secondary' }}>
                    {child.department || 'No department'}
                    {!href && <Box component="span" sx={{ color: 'text.tertiary' }}>, link coming</Box>}
                  </Typography>
                </Box>
              </Box>
              {st && !phone && <StatusPill tone={toneOf(child.status)}>{st.label}</StatusPill>}
              <Button size="small" variant="text" data-eject={child.id} onClick={() => onEject(child.id)} sx={{ flexShrink: 0 }}>
                Move out
              </Button>
              {editing && (
                <Tooltip title="Remove">
                  <IconButton size="small" onClick={() => onRemove(child)} aria-label={`remove ${child.name}`} sx={{ '&:hover': { color: 'error.main' } }}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          )
        })}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onAdd} startIcon={<AddIcon />} sx={{ mr: 'auto' }}>Add to this folder</Button>
        <Button variant="contained" onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  )
}

const BLANK = {
  name: '', url: '', icon: null, department: '', status: '', note: '',
}

/** Add or edit one app: a picture, a name, a link, where it stands. */
function AppDialog({
  state, onClose, onSave, departments = [],
}) {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
  const [draft, setDraft] = useState(BLANK)
  const [error, setError] = useState(null)
  const [pictureError, setPictureError] = useState(null)

  useEffect(() => {
    if (!state) return
    const it = state.item
    setDraft(it
      ? {
        id: it.id, name: it.name, url: it.url || '', icon: it.icon || null, department: it.department || '', status: it.status || '', note: it.note || '',
      }
      : BLANK)
    setError(null)
    setPictureError(null)
  }, [state])

  const deptOptions = useMemo(() => [...new Set([...APP_DEPARTMENTS, ...departments])], [departments])

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
        setPictureError(null)
      }
      img.onerror = () => setPictureError('That file is not a picture. Choose a PNG or JPG.')
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  const submit = () => {
    if (draft.url.trim() && !safeUrl(draft.url)) {
      setError('Enter a web address such as intranet.lotuss.org, or leave it empty.')
      return
    }
    onSave(draft)
  }

  if (!state) return null
  const set = (k) => (e) => setDraft((d) => ({ ...d, [k]: e.target.value }))
  return (
    <Dialog open fullWidth maxWidth="sm" fullScreen={phone} onClose={onClose} aria-labelledby="app-dialog-title">
      <DialogTitle id="app-dialog-title" sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box component="span" sx={{ flex: 1 }}>{draft.id ? 'Edit app' : 'Add app'}</Box>
        <Tooltip title="Close">
          <IconButton onClick={onClose} aria-label="close" sx={{ mr: -2 }}><CloseIcon /></IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent>
        <Box
          component="form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); submit() }}
          sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 1 }}
        >
          <Box sx={{ display: 'flex', gap: 4, alignItems: 'center', mb: 2 }}>
            <AppIcon item={{ name: draft.name || 'App', icon: draft.icon }} size={56} />
            <Box sx={{ minWidth: 0 }}>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button component="label" size="small" variant="outlined">
                  Choose picture
                  <input hidden type="file" accept="image/*" onChange={(e) => takeImage(e.target.files?.[0])} />
                </Button>
                {draft.icon && (
                  <Button size="small" variant="text" onClick={() => setDraft((d) => ({ ...d, icon: null }))}>
                    Remove picture
                  </Button>
                )}
              </Box>
              <Typography variant="caption" component="div" sx={{ color: pictureError ? 'error.main' : 'text.secondary', mt: 1 }}>
                {pictureError || 'Square pictures work best. Without one, the initials show.'}
              </Typography>
            </Box>
          </Box>
          <TextField
            fullWidth
            size="small"
            label="Name"
            name="app-name"
            value={draft.name}
            onChange={set('name')}
            autoFocus
          />
          <TextField
            fullWidth
            size="small"
            label="Link"
            name="app-url"
            placeholder="lotusretails.atlassian.net/jira"
            value={draft.url}
            onChange={(e) => { setError(null); set('url')(e) }}
            error={!!error}
            helperText={error || 'https is added if missing'}
          />
          <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', sm: 'row' } }}>
            <Autocomplete
              freeSolo
              options={deptOptions}
              inputValue={draft.department}
              onInputChange={(_e, v) => setDraft((d) => ({ ...d, department: v }))}
              sx={{ flex: 1 }}
              renderInput={(params) => (
                <TextField {...params} size="small" label="Department" name="app-department" helperText="Pick one or type a new one" />
              )}
            />
            <FormControl size="small" sx={{ flex: 1 }}>
              <InputLabel id="app-status">Status</InputLabel>
              <Select labelId="app-status" label="Status" value={draft.status} onChange={set('status')} name="app-status">
                <MenuItem value=""><Box component="span" sx={{ color: 'text.secondary' }}>Not set</Box></MenuItem>
                {APP_STATUSES.map((s) => (
                  <MenuItem key={s.id} value={s.id}>{s.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <TextField
            fullWidth
            size="small"
            label="Note (optional)"
            name="app-note"
            value={draft.note}
            onChange={set('note')}
          />
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit}>
          {draft.id ? 'Save changes' : 'Add app'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
