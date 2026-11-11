import { C, MONTHS, BAR, BAR_TEXT, statusStyle, deckDate } from './theme.js'

/*
 * THE COMPOSITE ELEMENTS, BROKEN INTO PRIMITIVES.
 *
 * A project card, the roadmap, a task timeline, the thank-you art and a status
 * pill are each drawn from plain rectangles, lines and text boxes. The SAME
 * list is drawn on screen and written into the PowerPoint file, so the
 * download looks like the slide — PowerPoint has no "card", but it has every
 * one of its parts, and they stay editable there.
 *
 * Every primitive: { k: 'rect' | 'text' | 'chevron' | 'arc' | 'line', x, y, w, h,
 * fill, border, borderWidth, radius, dashed, text, size (pt), bold, color,
 * align, valign, link } — `link` is the project a click on it should open while
 * presenting.
 */

const bullets = (v) => (Array.isArray(v) ? v : String(v || '').split('\n'))
  .map((s) => String(s).trim()).filter(Boolean)
  .map((s) => (/^[•\-–]/.test(s) ? s.replace(/^[-–]\s*/, '• ') : `• ${s}`)).join('\n')

export const CARD_LABELS = { accomplishment: 'ACCOMPLISHMENT', impact: 'IMPACT', next: 'NEXT MILESTONE', target: 'TARGET DATE' }

/* ----------------------------------------------------------------- pill */

export function pillParts({ x, y, w, h }, status, size = 6.75, link = null) {
  const s = statusStyle(status)
  return [
    { k: 'rect', x, y, w, h, fill: s.fill, border: s.border, borderWidth: 1, radius: h / 2, link },
    { k: 'text', x, y, w, h, text: status || '', size, bold: true, color: s.text, align: 'center', valign: 'middle', link },
  ]
}

/* ----------------------------------------------------------------- card */

export function cardParts(el) {
  const { x, y, w, h } = el
  const d = el.data || {}
  const tone = el.style?.tone === 'yellow' ? 'yellow' : 'blue'
  const sx = w / 411
  const sy = h / 196
  const f = Math.min(sx, sy * 1.2) * (el.style?.scale || 1)
  const link = d.projectKey || null
  const head = Math.max(24, 41 * sy)
  const r = 6 * Math.min(sx, sy)
  const labels = { ...CARD_LABELS, ...(d.labels || {}) }
  // The label column is as wide as "ACCOMPLISHMENT" at this size, and never most of the card.
  const lx = x + 14 * sx
  const lw = Math.min(w * 0.36, 91 * Math.max(sx, f))
  const vx = lx + lw + 4 * sx
  const vw = x + w - 10 * sx - vx
  // A long name gets smaller type rather than running out of the header.
  const titleW = w - 130 * sx
  const titlePt = 12.15 * f
  const perLine = titleW / (titlePt * (4 / 3) * 0.56)
  const name = d.title || 'Project name'
  const titleSize = name.length > perLine * 2 ? titlePt * Math.max(0.62, Math.sqrt((perLine * 2) / name.length)) : titlePt
  const out = [
    { k: 'rect', x, y, w, h, fill: tone === 'yellow' ? C.cardYellow : C.cardBlue, border: tone === 'yellow' ? C.yellow : C.blue, borderWidth: 1.5, radius: r, link },
    { k: 'rect', x, y, w, h: head, fill: tone === 'yellow' ? C.yellow : C.blue, radius: r, link },
    { k: 'rect', x, y: y + head / 2, w, h: head / 2, fill: tone === 'yellow' ? C.yellow : C.blue, link },
    {
      k: 'text', x: lx, y, w: titleW, h: head, text: name, size: titleSize, bold: true,
      color: tone === 'yellow' ? C.navy : C.white, valign: 'middle', link, field: 'title',
    },
  ]
  if (d.status) out.push(...pillParts({ x: x + w - 102 * sx, y: y + (head - 23 * sy) / 2, w: 88 * sx, h: 23 * sy }, d.status, 6.75 * f, link))

  // The three boxes share what is left, by how much each has to say.
  const rows = ['accomplishment', 'impact', 'next']
  const top = y + head + 8 * sy
  const targetH = 17 * sy
  const bottom = y + h - 6 * sy - targetH - 2 * sy
  const weight = rows.map((k) => Math.max(1, (Array.isArray(d[k]) ? d[k] : String(d[k] || '').split('\n')).filter((s) => String(s).trim()).length) + 0.6)
  const total = weight.reduce((a, b) => a + b, 0)
  let cy = top
  rows.forEach((k, i) => {
    const rh = ((bottom - top) * weight[i]) / total
    out.push(
      { k: 'text', x: lx, y: cy, w: lw, h: rh, text: labels[k], size: 6.38 * f, bold: true, color: C.blue, valign: 'top', link },
      { k: 'text', x: vx, y: cy, w: vw, h: rh, text: bullets(d[k]), size: 7.8 * f, color: C.ink, valign: 'top', link, field: k },
    )
    cy += rh
  })
  out.push(
    { k: 'text', x: lx, y: bottom + 2 * sy, w: lw, h: targetH, text: labels.target, size: 6.38 * f, bold: true, color: C.blue, valign: 'middle', link },
    { k: 'text', x: vx, y: bottom + 2 * sy, w: vw, h: targetH, text: d.target || 'TBC', size: 7.8 * f, color: C.ink, valign: 'middle', link, field: 'target' },
  )
  return out
}

/* -------------------------------------------------------------- roadmap */

const dayOfYear = (iso, year) => {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(t)) return null
  const start = Date.UTC(year, 0, 1)
  const end = Date.UTC(year + 1, 0, 1)
  return Math.min(1, Math.max(0, (t - start) / (end - start)))
}

export const toneFor = (status, i) => (/^(go live|done|live)$/i.test(String(status || '')) ? 'green' : (i % 2 ? 'yellow' : 'blue'))

export function roadmapParts(el) {
  const { x, y, w, h } = el
  const d = el.data || {}
  const year = d.year || new Date().getFullYear()
  const rows = d.rows || []
  const f = el.style?.scale || 1
  const labelW = w * 0.155
  const statusW = w * 0.085
  const gx = x + labelW + statusW + 8
  const gw = w - (labelW + statusW + 14)
  const headH = 22
  // Group rows ("FINANCE") are a little taller than a project row.
  const units = rows.reduce((a, r) => a + (r.group ? 1.15 : 1), 0) || 1
  const rowH = Math.min(26, (h - headH - 6) / units)
  const out = [
    { k: 'rect', x, y, w, h, fill: C.white, border: '#DCE6F2', borderWidth: 1, radius: 6 },
    { k: 'text', x: x + 8, y: y + 4, w: labelW, h: headH - 6, text: 'INITIATIVE', size: 5.6 * f, bold: true, color: '#5B6B80', valign: 'middle' },
    { k: 'text', x: x + labelW + 4, y: y + 4, w: statusW, h: headH - 6, text: 'STATUS', size: 5.6 * f, bold: true, color: '#5B6B80', valign: 'middle', align: 'center' },
  ]
  MONTHS.forEach((m, i) => out.push({
    k: 'text', x: gx + (gw / 12) * i, y: y + 4, w: gw / 12, h: headH - 6, text: m, size: 5.6 * f, bold: true, color: '#5B6B80', align: 'center', valign: 'middle',
  }))
  let cy = y + headH
  let n = 0
  for (const r of rows) {
    if (r.group) {
      const gh = rowH * 1.15 - 3
      out.push(
        { k: 'rect', x: x + 4, y: cy + 1, w: w - 8, h: gh, fill: C.blue, radius: 4 },
        { k: 'text', x: x + 14, y: cy + 1, w: w - 30, h: gh, text: String(r.group).toUpperCase(), size: 7.5 * f, bold: true, color: C.white, valign: 'middle' },
      )
      cy += rowH * 1.15
      continue
    }
    const link = r.projectKey || null
    const rh = rowH - 3
    out.push(
      { k: 'rect', x: x + 4, y: cy + 1, w: w - 8, h: rh, fill: C.white, border: '#E1E9F3', borderWidth: 0.75, radius: 3, link },
      { k: 'text', x: x + 10, y: cy + 1, w: labelW - 8, h: rh, text: r.label || r.projectKey || '', size: 6.4 * f, bold: true, color: C.navy, valign: 'middle', link },
    )
    if (r.status) out.push(...pillParts({ x: x + labelW + 4, y: cy + 1 + rh * 0.18, w: statusW, h: rh * 0.64 }, r.status, 5.2 * f, link))
    // No dates, no bar: a bar would claim dates nobody gave.
    const a = r.start || r.end ? dayOfYear(r.start || `${year}-01-01`, year) : null
    const b = r.end || r.start ? dayOfYear(r.end || `${year}-12-31`, year) : null
    if (a != null && b != null && b > a) {
      const tone = r.tone || toneFor(r.status, n)
      out.push(
        { k: 'rect', x: gx + gw * a, y: cy + 1 + rh * 0.2, w: Math.max(6, gw * (b - a)), h: rh * 0.6, fill: BAR[tone], radius: (rh * 0.6) / 2, link },
        { k: 'text', x: gx + gw * a, y: cy + 1 + rh * 0.2, w: Math.max(6, gw * (b - a)), h: rh * 0.6, text: r.bar || '', size: 5.2 * f, bold: true, color: BAR_TEXT[tone], align: 'center', valign: 'middle', link },
      )
    }
    cy += rowH
    n += 1
  }
  return out
}

/* ------------------------------------------------------- task timeline */

const parse = (iso) => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null
}
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

/** The months a timeline spans, from `from` to `to` (both ISO dates). */
export function monthsBetween(from, to) {
  const a = parse(from)
  const b = parse(to)
  if (!a || !b) return []
  const out = []
  let y = a.y
  let m = a.m
  while ((y < b.y || (y === b.y && m <= b.m)) && out.length < 18) {
    out.push({ y, m })
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }
  return out
}

/* Where a date falls, in weeks from the first month: W1–W4 of each month. */
function weekPos(iso, months, end = false) {
  const p = parse(iso)
  if (!p || !months.length) return null
  const i = months.findIndex((mo) => mo.y === p.y && mo.m === p.m)
  if (i < 0) {
    const first = months[0]
    return (p.y < first.y || (p.y === first.y && p.m < first.m)) ? 0 : months.length * 4
  }
  const dim = daysIn(p.y, p.m)
  const day = p.d - 1 + (end ? 1 : 0)
  const wk = Math.min(3, Math.floor(day / 7))
  const span = wk === 3 ? dim - 21 : 7
  const frac = Math.min(1, (day - wk * 7) / span)
  return i * 4 + wk + frac
}

export function tasksParts(el, todayIso = new Date().toISOString().slice(0, 10)) {
  const { x, y, w, h } = el
  const d = el.data || {}
  const f = el.style?.scale || 1
  const months = monthsBetween(d.from, d.to)
  const rows = d.rows || []
  const labelW = w * 0.24
  const gx = x + labelW
  const gw = w - labelW
  const cols = Math.max(1, months.length * 4)
  const cw = gw / cols
  const h1 = 18
  const h2 = 16
  const rowH = Math.min(24, (h - h1 - h2) / Math.max(1, rows.length))
  const link = d.projectKey || null
  const out = [
    { k: 'rect', x, y, w, h: h1 + h2 + rowH * rows.length, fill: C.white, border: '#9FB3CC', borderWidth: 0.75 },
    { k: 'rect', x, y, w: labelW, h: h1 + h2, fill: C.blue },
    { k: 'text', x, y, w: labelW, h: h1 + h2, text: 'Task', size: 8 * f, bold: true, color: C.white, align: 'center', valign: 'middle' },
  ]
  months.forEach((mo, i) => {
    out.push(
      { k: 'rect', x: gx + i * 4 * cw, y, w: 4 * cw, h: h1, fill: C.blue, border: '#5E9BDA', borderWidth: 0.5 },
      { k: 'text', x: gx + i * 4 * cw, y, w: 4 * cw, h: h1, text: `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo.m]}${months.length > 12 || mo.y !== months[0].y ? ` ${String(mo.y).slice(2)}` : ''}`, size: 7.5 * f, bold: true, color: C.white, align: 'center', valign: 'middle' },
    )
    for (let k = 0; k < 4; k++) {
      out.push(
        { k: 'rect', x: gx + (i * 4 + k) * cw, y: y + h1, w: cw, h: h2, fill: C.blue, border: '#5E9BDA', borderWidth: 0.5 },
        { k: 'text', x: gx + (i * 4 + k) * cw, y: y + h1, w: cw, h: h2, text: `W${k + 1}`, size: 5.5 * f, bold: true, color: C.white, align: 'center', valign: 'middle' },
      )
    }
  })
  let cy = y + h1 + h2
  for (const r of rows) {
    const rlink = r.key || link
    out.push({ k: 'rect', x, y: cy, w, h: rowH, fill: r.group ? C.band : C.white, border: '#B8C4D4', borderWidth: 0.5, link: rlink })
    out.push({ k: 'text', x: x + 6, y: cy, w: labelW - 10, h: rowH, text: r.label || '', size: (r.group ? 7 : 6.6) * f, bold: !!r.group, color: '#0E1B2C', valign: 'middle', link: rlink })
    if (!r.group) {
      for (let k = 0; k <= cols; k++) out.push({ k: 'line', x: gx + k * cw, y: cy, w: 0, h: rowH, border: '#D3DBE6', borderWidth: 0.5 })
    }
    const a = weekPos(r.start || r.end, months)
    const b = weekPos(r.end || r.start, months, true)
    if (a != null && b != null && b >= a) {
      out.push({
        k: 'rect', x: gx + a * cw, y: cy + rowH * 0.28, w: Math.max(cw * 0.5, (b - a) * cw), h: rowH * 0.44,
        fill: r.done ? '#3DDC84' : C.yellow, radius: 1.5, link: rlink,
      })
    }
    cy += rowH
  }
  if (d.today !== false) {
    const t = weekPos(todayIso, months)
    if (t != null && t > 0 && t < cols) {
      out.push({ k: 'line', x: gx + t * cw, y: y + h1 - 6, w: 0, h: cy - (y + h1) + 6, border: C.red, borderWidth: 1.25, dashed: true })
    }
  }
  return out
}

/* ------------------------------------------------------------- thank you */

export function thanksParts(el) {
  const { x, y, w, h } = el
  const s = Math.min(w / 960, h / 540)
  const cx = x + w / 2
  return [
    { k: 'rect', x, y, w, h, fill: C.thanks },
    { k: 'chevron', x: cx - 230 * s, y: y + h * 0.33, w: 58 * s, h: 100 * s, fill: C.yellow, dir: 'right' },
    { k: 'chevron', x: cx + 172 * s, y: y + h * 0.33, w: 58 * s, h: 100 * s, fill: C.white, dir: 'left' },
    { k: 'text', x: cx - 165 * s, y: y + h * 0.33, w: 330 * s, h: 100 * s, text: 'THANK YOU', size: 30 * s, bold: true, color: C.white, align: 'center', valign: 'middle' },
    { k: 'arc', x: cx - 300 * s, y: y + h * 0.56, w: 600 * s, h: 160 * s, border: C.white, borderWidth: 14 * s },
  ]
}

/* --------------------------------------------------------------- dispatch */

export function partsOf(el) {
  if (el.type === 'card') return cardParts(el)
  if (el.type === 'roadmap') return roadmapParts(el)
  if (el.type === 'tasks') return tasksParts(el)
  if (el.type === 'thanks') return thanksParts(el)
  if (el.type === 'pill') return pillParts(el, el.data?.status || 'On Track', el.style?.fontSize || 6.75, el.data?.projectKey || null)
  return null
}

export { deckDate }
