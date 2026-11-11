import { W, H, PX_PER_IN, BACKGROUNDS, FONT } from './theme.js'
import { partsOf } from './layout.js'
import { imageSrc, assetUrl } from './render.jsx'

/*
 * THE DECK AS A POWERPOINT FILE, in the same format as on screen.
 *
 * Every element is written as PowerPoint's own shapes and text boxes — a card
 * becomes its rectangles and text boxes, not a picture of a card — so the file
 * can still be edited in PowerPoint. Positions come from the same layout the
 * screen uses (layout.js), divided by 96 to make inches.
 */

const IN = (px) => px / PX_PER_IN
const hex = (c) => (c ? String(c).replace('#', '').toUpperCase() : undefined)
const fontFace = FONT.split(',')[0]

async function dataUrlOf(url) {
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`A picture could not be loaded (${res.status}).`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('A picture could not be read.'))
    r.readAsDataURL(blob)
  })
}

const sizeOf = (src) => new Promise((resolve) => {
  const im = new Image()
  im.onload = () => resolve({ w: im.naturalWidth || 1, h: im.naturalHeight || 1 })
  im.onerror = () => resolve({ w: 1, h: 1 })
  im.src = src
})

function line(p) {
  if (!p.border) return { type: 'none' }
  return { color: hex(p.border), width: (p.borderWidth || 1) * 0.75, dashType: p.dashed ? 'dash' : 'solid' }
}

function addText(slide, p) {
  slide.addText(String(p.text ?? ''), {
    x: IN(p.x), y: IN(p.y), w: IN(Math.max(1, p.w)), h: IN(Math.max(1, p.h)),
    fontFace, fontSize: Math.max(1, Math.round((p.size || 12) * 10) / 10), bold: !!p.bold, italic: !!p.italic,
    underline: p.underline ? { style: 'sng' } : undefined,
    color: hex(p.color) || '17324D', align: p.align || 'left', valign: p.valign || 'top', margin: 0,
    lineSpacingMultiple: p.lineHeight && p.lineHeight !== 1.2 ? p.lineHeight : undefined,
    fill: p.fill ? { color: hex(p.fill) } : undefined,
    line: p.border ? line(p) : undefined,
    isTextBox: true, fit: 'none', wrap: true,
  })
}

function addPart(pptx, slide, p) {
  if (p.k === 'rect') {
    const r = p.radius ? Math.min(p.radius, Math.min(p.w, p.h) / 2) : 0
    slide.addShape(r ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
      x: IN(p.x), y: IN(p.y), w: IN(Math.max(0.5, p.w)), h: IN(Math.max(0.5, p.h)),
      fill: p.fill ? { color: hex(p.fill) } : { type: 'none' }, line: line(p), rectRadius: r ? IN(r) : undefined,
    })
  } else if (p.k === 'line') {
    slide.addShape(pptx.ShapeType.line, {
      x: IN(p.x), y: IN(p.y), w: IN(p.w), h: IN(p.h), line: { color: hex(p.border), width: (p.borderWidth || 1) * 0.75, dashType: p.dashed ? 'dash' : 'solid' },
    })
  } else if (p.k === 'text') {
    addText(slide, p)
  } else if (p.k === 'chevron') {
    slide.addShape(pptx.ShapeType.chevron, {
      x: IN(p.x), y: IN(p.y), w: IN(p.w), h: IN(p.h), fill: { color: hex(p.fill) }, line: { type: 'none' }, flipH: p.dir === 'left',
    })
  } else if (p.k === 'arc') {
    // The bottom half of an ellipse whose top edge is the primitive's top: a
    // filled block arc, which every PowerPoint viewer draws (a plain arc's
    // outline is not drawn by all of them).
    const bw = p.borderWidth || 10
    slide.addShape(pptx.ShapeType.blockArc, {
      x: IN(p.x), y: IN(p.y - p.h), w: IN(p.w), h: IN(p.h * 2), angleRange: [0, 180],
      arcThicknessRatio: Math.min(1, (bw * 2) / Math.min(p.w, p.h * 2)),
      fill: { color: hex(p.border) }, line: { type: 'none' },
    })
  }
}

async function addImage(slide, el, brand, cache) {
  const src = imageSrc(el.data, brand)
  if (!src) return
  if (!cache.has(src)) cache.set(src, await dataUrlOf(src))
  const data = cache.get(src)
  const { w: iw, h: ih } = await sizeOf(data)
  if ((el.data?.fit || 'contain') === 'cover') {
    const s = Math.max(el.w / iw, el.h / ih)
    const w = iw * s
    const h = ih * s
    slide.addImage({
      data, x: IN(el.x), y: IN(el.y), w: IN(el.w), h: IN(el.h),
      sizing: { type: 'crop', x: IN((w - el.w) / 2), y: IN((h - el.h) / 2), w: IN(el.w), h: IN(el.h) },
    })
    return
  }
  const s = Math.min(el.w / iw, el.h / ih)
  const w = iw * s
  const h = ih * s
  slide.addImage({ data, x: IN(el.x + (el.w - w) / 2), y: IN(el.y + (el.h - h) / 2), w: IN(w), h: IN(h) })
}

/** Build the .pptx and hand it to the browser to save. */
export async function downloadPptx(deck, brand, { onProgress } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'
  pptx.title = deck.title || 'Presentation'
  pptx.company = 'F&amp;A Tech'
  const cache = new Map()
  const slides = (deck.slides || []).filter((s) => !s.hidden)
  for (let i = 0; i < slides.length; i++) {
    onProgress?.(i + 1, slides.length)
    const s = slides[i]
    const slide = pptx.addSlide()
    const bg = BACKGROUNDS[s.bg] || BACKGROUNDS.light
    const pic = bg.brand && brand?.[bg.brand] ? assetUrl(brand[bg.brand]) : null
    if (pic) {
      if (!cache.has(pic)) cache.set(pic, await dataUrlOf(pic))
      slide.background = { data: cache.get(pic) }
    } else {
      slide.background = { color: hex(bg.color) }
    }
    for (const el of s.elements || []) {
      const parts = partsOf(el)
      if (parts) { for (const p of parts) addPart(pptx, slide, p); continue }
      const st = el.style || {}
      if (el.type === 'text') {
        addText(slide, {
          x: el.x, y: el.y, w: el.w, h: el.h, text: el.text, size: st.fontSize || 12, bold: st.bold, italic: st.italic, underline: st.underline,
          color: st.color, align: st.align, valign: st.valign, lineHeight: st.lineHeight, fill: st.fill, border: st.border, borderWidth: st.borderWidth, dashed: st.dashed,
        })
      } else if (el.type === 'rect') {
        addPart(pptx, slide, { k: 'rect', x: el.x, y: el.y, w: el.w, h: el.h, fill: st.fill, border: st.border, borderWidth: st.borderWidth, radius: st.radius, dashed: st.dashed })
      } else if (el.type === 'image') {
        try { await addImage(slide, el, brand, cache) } catch { /* a missing picture leaves its space empty */ }
      }
    }
    if (s.notes) slide.addNotes(s.notes)
  }
  const name = `${String(deck.title || 'Presentation').replace(/[\\/:*?"<>|]+/g, ' ').trim()}${deck.date ? ` ${deck.date}` : ''}.pptx`
  await pptx.writeFile({ fileName: name })
  return name
}

export { W, H }
