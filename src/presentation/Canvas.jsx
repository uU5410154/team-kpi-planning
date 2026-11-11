import { useEffect, useRef, useState } from 'react'
import { W, H, FONT, ptToPx, C } from './theme.js'
import { partsOf, CARD_LABELS } from './layout.js'
import { SlideView } from './render.jsx'

/*
 * THE SLIDE BEING EDITED.
 *
 * Click to select (Shift adds to the selection), drag to move, pull a handle
 * to resize, double-click any text to type in place — a text box, or one box
 * of a project card. Moving snaps to the slide's edges and centre, and to the
 * edges of the other elements, with a guide line where it snaps.
 *
 * `onBegin` is called once before a drag or a typed edit changes anything, so
 * the page can keep one undo step for the whole gesture; `onChange` then
 * applies each step without adding more.
 */

const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const SNAP = 5

const cardField = (el, field) => {
  const d = el.data || {}
  if (field === 'title' || field === 'target') return String(d[field] || '')
  return (Array.isArray(d[field]) ? d[field] : String(d[field] || '').split('\n')).join('\n')
}

export default function Canvas({ slide, brand, width, selected, onSelect, onBegin, onChange, readOnly = false }) {
  const box = useRef(null)
  const [drag, setDrag] = useState(null)
  const [guides, setGuides] = useState([])
  const [editing, setEditing] = useState(null) // { id, field, x, y, w, h, value, style }
  const scale = width / W
  const sel = new Set(selected)

  // Leaving the slide ends typing in it.
  useEffect(() => { setEditing(null) }, [slide.id])

  const toSlide = (e) => {
    const r = box.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  const update = (ids, fn) => onChange((s) => ({ ...s, elements: s.elements.map((el) => (ids.includes(el.id) ? fn(el) : el)) }))

  /* --------------------------------------------------------------- moving */

  const startMove = (e, el) => {
    if (readOnly || e.button !== 0) return
    e.stopPropagation()
    let ids = selected
    if (e.shiftKey) {
      ids = sel.has(el.id) ? selected.filter((x) => x !== el.id) : [...selected, el.id]
      onSelect(ids)
      return
    }
    if (!sel.has(el.id)) { ids = [el.id]; onSelect(ids) }
    const p = toSlide(e)
    const origin = Object.fromEntries(slide.elements.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y, w: x.w, h: x.h }]))
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'move', ids: ids.filter((i) => !slide.elements.find((x) => x.id === i)?.locked), start: p, origin, began: false })
  }

  const startResize = (e, el, handle) => {
    if (readOnly) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ kind: 'resize', ids: [el.id], handle, start: toSlide(e), origin: { [el.id]: { x: el.x, y: el.y, w: el.w, h: el.h } }, began: false, keep: el.type === 'image' })
  }

  /* Snap a moving box to the slide and to the other elements. */
  const snapBox = (b, ignore) => {
    const xs = [0, W / 2, W]
    const ys = [0, H / 2, H]
    for (const o of slide.elements) {
      if (ignore.includes(o.id)) continue
      xs.push(o.x, o.x + o.w / 2, o.x + o.w)
      ys.push(o.y, o.y + o.h / 2, o.y + o.h)
    }
    const g = []
    let { x, y } = b
    const tryAxis = (vals, edges, set, mk) => {
      let best = null
      for (const v of vals) {
        for (const [off, at] of edges) {
          const d = v - at
          if (Math.abs(d) <= SNAP && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, v, off }
        }
      }
      if (best) { set(best.d); g.push(mk(best.v)) }
    }
    tryAxis(xs, [[0, x], [b.w / 2, x + b.w / 2], [b.w, x + b.w]], (d) => { x += d }, (v) => ({ x: v }))
    tryAxis(ys, [[0, y], [b.h / 2, y + b.h / 2], [b.h, y + b.h]], (d) => { y += d }, (v) => ({ y: v }))
    return { x, y, g }
  }

  const onMove = (e) => {
    if (!drag) return
    const p = toSlide(e)
    const dx = p.x - drag.start.x
    const dy = p.y - drag.start.y
    if (!drag.began) {
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return
      onBegin()
      setDrag((d) => ({ ...d, began: true }))
    }
    if (drag.kind === 'move') {
      const first = drag.origin[drag.ids[0]]
      let sx = dx
      let sy = dy
      if (first && !e.altKey) {
        const s = snapBox({ x: first.x + dx, y: first.y + dy, w: first.w, h: first.h }, drag.ids)
        sx = s.x - first.x
        sy = s.y - first.y
        setGuides(s.g)
      } else setGuides([])
      update(drag.ids, (el) => ({ ...el, x: Math.round(drag.origin[el.id].x + sx), y: Math.round(drag.origin[el.id].y + sy) }))
    } else {
      const o = drag.origin[drag.ids[0]]
      const h = drag.handle
      let { x, y, w, h: hh } = o
      if (h.includes('e')) w = Math.max(8, o.w + dx)
      if (h.includes('s')) hh = Math.max(8, o.h + dy)
      if (h.includes('w')) { w = Math.max(8, o.w - dx); x = o.x + o.w - w }
      if (h.includes('n')) { hh = Math.max(8, o.h - dy); y = o.y + o.h - hh }
      if ((drag.keep || e.shiftKey) && h.length === 2) {
        const r = o.w / o.h
        if (w / hh > r) w = hh * r; else hh = w / r
        if (h.includes('w')) x = o.x + o.w - w
        if (h.includes('n')) y = o.y + o.h - hh
      }
      update(drag.ids, (el) => ({ ...el, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) }))
    }
  }

  const onUp = () => { setDrag(null); setGuides([]) }

  /* -------------------------------------------------------------- typing */

  const startEdit = (e, el) => {
    if (readOnly) return
    e.stopPropagation()
    if (el.type === 'text') {
      setEditing({ id: el.id, field: null, x: el.x, y: el.y, w: el.w, h: el.h, value: el.text || '', style: el.style || {} })
      return
    }
    if (el.type === 'card') {
      const p = toSlide(e)
      const hit = (partsOf(el) || []).find((q) => q.field && p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h)
      if (!hit) return
      setEditing({
        id: el.id, field: hit.field, x: hit.x, y: hit.y, w: hit.w, h: Math.max(hit.h, 24),
        value: cardField(el, hit.field), style: { fontSize: hit.size, bold: hit.bold, color: hit.color === C.white ? C.ink : hit.color },
        label: hit.field === 'title' ? 'Project name' : CARD_LABELS[hit.field],
      })
    }
  }

  const finishEdit = (save) => {
    const ed = editing
    setEditing(null)
    if (!save || !ed) return
    const el = slide.elements.find((x) => x.id === ed.id)
    if (!el) return
    const now = ed.field ? cardField(el, ed.field) : (el.text || '')
    if (now === ed.value) return
    onBegin()
    if (!ed.field) update([ed.id], (x) => ({ ...x, text: ed.value }))
    else {
      const v = ['title', 'target'].includes(ed.field) ? ed.value.replace(/\n/g, ' ') : ed.value.split('\n').map((s) => s.replace(/^•\s*/, ''))
      update([ed.id], (x) => ({ ...x, data: { ...x.data, [ed.field]: v } }))
    }
  }

  /* ---------------------------------------------------------------- draw */

  const hs = 8 / scale
  return (
    <div
      ref={box}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerDown={() => { if (!editing) onSelect([]) }}
      style={{ width, height: (width * H) / W, position: 'relative', boxShadow: '0 6px 30px rgba(0,0,0,0.35)', borderRadius: 4, overflow: 'hidden', touchAction: 'none' }}
    >
      <SlideView slide={slide} brand={brand} width={width} editable hideIds={editing?.field == null && editing ? new Set([editing.id]) : null}>
        {slide.elements.map((el) => (el.locked && !sel.has(el.id) ? null : (
          <div
            key={el.id}
            data-el={el.id}
            onPointerDown={(e) => startMove(e, el)}
            onDoubleClick={(e) => startEdit(e, el)}
            style={{
              position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, cursor: readOnly ? 'default' : 'move',
              outline: sel.has(el.id) ? `${1.5 / scale}px solid #3B82F6` : 'none', outlineOffset: 1 / scale,
            }}
            title={el.type === 'card' ? 'Double-click a box on the card to type in it' : el.type === 'text' ? 'Double-click to type' : undefined}
          />
        )))}
        {selected.length === 1 && !readOnly && (() => {
          const el = slide.elements.find((x) => x.id === selected[0])
          if (!el || el.locked) return null
          return HANDLES.map((h) => {
            const x = h.includes('w') ? el.x : h.includes('e') ? el.x + el.w : el.x + el.w / 2
            const y = h.includes('n') ? el.y : h.includes('s') ? el.y + el.h : el.y + el.h / 2
            return (
              <div
                key={h}
                onPointerDown={(e) => startResize(e, el, h)}
                style={{
                  position: 'absolute', left: x - hs / 2, top: y - hs / 2, width: hs, height: hs, background: '#fff',
                  border: `${1.5 / scale}px solid #3B82F6`, borderRadius: 2 / scale, cursor: `${h}-resize`, boxSizing: 'border-box',
                }}
              />
            )
          })
        })()}
        {guides.map((g, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', pointerEvents: 'none', background: '#EC4899',
              ...(g.x != null ? { left: g.x, top: 0, width: 1 / scale, height: H } : { top: g.y, left: 0, height: 1 / scale, width: W }),
            }}
          />
        ))}
        {editing && (
          <textarea
            autoFocus
            value={editing.value}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => setEditing((ed) => ({ ...ed, value: e.target.value }))}
            onBlur={() => finishEdit(true)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') finishEdit(false)
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) finishEdit(true)
            }}
            aria-label={editing.label || 'Text'}
            placeholder={editing.field && !['title', 'target'].includes(editing.field) ? 'One point per line' : ''}
            style={{
              position: 'absolute', left: editing.x - 2, top: editing.y - 2, width: editing.w + 4, height: Math.max(editing.h, 30) + 4,
              fontFamily: FONT, fontSize: ptToPx(editing.style.fontSize || 12), fontWeight: editing.style.bold ? 700 : 400,
              fontStyle: editing.style.italic ? 'italic' : 'normal', color: editing.style.color || C.ink, textAlign: editing.style.align || 'left',
              lineHeight: editing.style.lineHeight || 1.2, background: 'rgba(255,255,255,0.97)', border: `${1.5 / scale}px solid #3B82F6`,
              outline: 'none', resize: 'none', padding: 1, margin: 0, boxSizing: 'border-box', zIndex: 5, overflow: 'auto',
            }}
          />
        )}
      </SlideView>
    </div>
  )
}
