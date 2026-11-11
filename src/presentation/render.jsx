import { memo } from 'react'
import { W, H, FONT, C, BACKGROUNDS, ptToPx } from './theme.js'
import { partsOf } from './layout.js'

/*
 * ONE SLIDE, DRAWN.
 *
 * Laid out on the 960 × 540 canvas and scaled to whatever width it is shown
 * at — a thumbnail, the editor, a full screen — so it is the same slide at
 * every size. Drawn in the deck's own light colours whatever the app's theme.
 */

export const assetUrl = (id) => (id ? `/api/decks/assets/${id}` : null)

export function imageSrc(data, brand) {
  if (!data) return null
  if (data.asset) return assetUrl(data.asset)
  if (data.brand && brand?.[data.brand]) return assetUrl(brand[data.brand])
  return null
}

const just = { left: 'flex-start', center: 'center', right: 'flex-end' }
const vjust = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }

/* A box of text, as PowerPoint draws one: it may run past its box. */
export function TextBox({ x, y, w, h, text, size = 12, bold, italic, underline, color = C.ink, align = 'left', valign = 'top', lineHeight = 1.2, fill, clip = false, style }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, width: w, height: h, display: 'flex', flexDirection: 'column',
      justifyContent: vjust[valign] || 'flex-start', overflow: clip ? 'hidden' : 'visible', background: fill || undefined, ...style,
    }}
    >
      <div style={{
        fontFamily: FONT, fontSize: ptToPx(size), fontWeight: bold ? 700 : 400, fontStyle: italic ? 'italic' : 'normal',
        textDecoration: underline ? 'underline' : 'none', color, textAlign: align, lineHeight, whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere', display: 'block', alignSelf: 'stretch', justifyContent: just[align],
      }}
      >
        {text}
      </div>
    </div>
  )
}

function Part({ p, onRef }) {
  const click = p.link && onRef ? (e) => { e.stopPropagation(); onRef(p.link) } : undefined
  const cursor = click ? 'pointer' : undefined
  if (p.k === 'rect') {
    return (
      <div
        onClick={click}
        style={{
          position: 'absolute', left: p.x, top: p.y, width: p.w, height: p.h, background: p.fill || 'transparent',
          border: p.border ? `${p.borderWidth || 1}px ${p.dashed ? 'dashed' : 'solid'} ${p.border}` : 'none',
          borderRadius: p.radius || 0, boxSizing: 'border-box', cursor,
        }}
      />
    )
  }
  if (p.k === 'line') {
    return (
      <div style={{
        position: 'absolute', left: p.x, top: p.y, width: Math.max(0, p.w), height: Math.max(0, p.h),
        borderLeft: p.w === 0 ? `${p.borderWidth || 1}px ${p.dashed ? 'dashed' : 'solid'} ${p.border}` : 'none',
        borderTop: p.h === 0 ? `${p.borderWidth || 1}px ${p.dashed ? 'dashed' : 'solid'} ${p.border}` : 'none',
      }}
      />
    )
  }
  if (p.k === 'text') {
    return (
      <div onClick={click} style={{ cursor }}>
        <TextBox x={p.x} y={p.y} w={p.w} h={p.h} text={p.text} size={p.size} bold={p.bold} italic={p.italic} color={p.color} align={p.align} valign={p.valign} clip lineHeight={1.18} style={{ padding: 0, pointerEvents: click ? 'auto' : 'none' }} />
      </div>
    )
  }
  if (p.k === 'chevron') {
    const pts = p.dir === 'left'
      ? '100,0 45,50 100,100 55,100 0,50 55,0'
      : '0,0 55,0 100,50 55,100 0,100 55,50'
    return (
      <svg style={{ position: 'absolute', left: p.x, top: p.y }} width={p.w} height={p.h} viewBox="0 0 100 100" preserveAspectRatio="none">
        <polygon points={pts} fill={p.fill} />
      </svg>
    )
  }
  if (p.k === 'arc') {
    const bw = p.borderWidth || 10
    return (
      <svg style={{ position: 'absolute', left: p.x, top: p.y, overflow: 'visible' }} width={p.w} height={p.h}>
        <path d={`M ${bw} ${bw} A ${p.w / 2 - bw} ${p.h - bw * 2} 0 0 0 ${p.w - bw} ${bw}`} fill="none" stroke={p.border} strokeWidth={bw} strokeLinecap="round" />
      </svg>
    )
  }
  return null
}

/* A picture slot with nothing in it yet: the deck's dashed placeholder. */
function EmptyPicture({ el, editable }) {
  return (
    <div style={{
      position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, border: `2px dashed ${C.blue}`, borderRadius: 8,
      boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.blue, fontFamily: FONT, fontSize: 14,
      background: 'rgba(0,113,205,0.03)',
    }}
    >
      {editable ? 'Picture — paste a screenshot, or choose one on the right' : ''}
    </div>
  )
}

export const ElementView = memo(function ElementView({ el, brand, onRef, editable }) {
  const s = el.style || {}
  const parts = partsOf(el)
  if (parts) {
    return (
      <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, opacity: s.opacity ?? 1 }}>
        {parts.map((p, i) => <Part key={i} p={p} onRef={onRef} />)}
      </div>
    )
  }
  if (el.type === 'text') {
    return (
      <TextBox
        x={el.x} y={el.y} w={el.w} h={el.h} text={el.text} size={s.fontSize || 12} bold={s.bold} italic={s.italic}
        underline={s.underline} color={s.color || C.ink} align={s.align} valign={s.valign} lineHeight={s.lineHeight || 1.2}
        fill={s.fill}
        style={{ opacity: s.opacity ?? 1, border: s.border ? `${s.borderWidth || 1}px ${s.dashed ? 'dashed' : 'solid'} ${s.border}` : undefined, borderRadius: s.radius || 0, boxSizing: 'border-box' }}
      />
    )
  }
  if (el.type === 'rect') {
    return (
      <div style={{
        position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, background: s.fill || 'transparent',
        border: s.border ? `${s.borderWidth || 1}px ${s.dashed ? 'dashed' : 'solid'} ${s.border}` : 'none',
        borderRadius: s.radius || 0, boxSizing: 'border-box', opacity: s.opacity ?? 1,
      }}
      />
    )
  }
  if (el.type === 'image') {
    const src = imageSrc(el.data, brand)
    if (!src) return el.data?.brand ? null : <EmptyPicture el={el} editable={editable} />
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, objectFit: el.data?.fit || 'contain',
          opacity: s.opacity ?? 1, borderRadius: s.radius || 0, border: s.border ? `${s.borderWidth || 1}px solid ${s.border}` : 'none', boxSizing: 'border-box',
        }}
      />
    )
  }
  return null
})

export function Background({ slide, brand }) {
  const bg = BACKGROUNDS[slide.bg] || BACKGROUNDS.light
  const pic = bg.brand && brand?.[bg.brand] ? assetUrl(brand[bg.brand]) : null
  const fallback = bg.brand && !pic
    ? 'radial-gradient(120% 90% at 100% 100%, #D9E8FB 0%, rgba(217,232,251,0) 55%), radial-gradient(60% 70% at 0% 100%, rgba(255,192,31,0.35) 0%, rgba(255,192,31,0) 60%), #FFFFFF'
    : null
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, background: fallback || bg.color }} />
      {pic && <img src={pic} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: W, height: H, objectFit: 'cover' }} />}
    </>
  )
}

/**
 * The slide at `width` pixels wide. `children` are drawn on top, in the
 * slide's own 960 × 540 coordinates — the editor's selection handles.
 */
export function SlideView({ slide, brand, width = 960, onRef, editable = false, hideIds = null, children, style }) {
  const s = width / W
  return (
    <div style={{ width, height: (width * H) / W, position: 'relative', overflow: 'hidden', background: '#fff', ...style }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, transform: `scale(${s})`, transformOrigin: '0 0', fontFamily: FONT }}>
        <Background slide={slide} brand={brand} />
        {(slide.elements || []).map((el) => (hideIds?.has(el.id) ? null : <ElementView key={el.id} el={el} brand={brand} onRef={onRef} editable={editable} />))}
        {children}
      </div>
    </div>
  )
}
