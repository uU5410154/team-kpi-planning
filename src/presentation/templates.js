import { W, H, C, deckDate } from './theme.js'
import { toneFor } from './layout.js'
import { timelineOf, todayISO } from '../lib/model.js'

/*
 * THE SLIDES OF THE IT GOVERNANCE DECK, as templates.
 *
 * Each builds the elements of one slide in the deck's own positions and
 * sizes. Everything a template makes is an ordinary element afterwards —
 * moved, resized, retyped or deleted like anything else on the slide. The
 * project cards, the roadmap and the task timeline keep the project they came
 * from, so they can be refreshed from the app and opened while presenting.
 */

let seq = 0
export const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const text = (x, y, w, h, value, style = {}, extra = {}) => ({
  id: newId(), type: 'text', x, y, w, h, text: value, style: { fontSize: 12, color: C.ink, ...style }, ...extra,
})
export const rect = (x, y, w, h, style = {}, extra = {}) => ({ id: newId(), type: 'rect', x, y, w, h, style, ...extra })
export const image = (x, y, w, h, data = {}, extra = {}) => ({ id: newId(), type: 'image', x, y, w, h, style: {}, data: { fit: 'contain', ...data }, ...extra })

/* The slide title and the short yellow bar under it, where the deck puts them. */
export const titleBlock = (value, { color = C.navy, size = 20 } = {}) => [
  text(38, 18, 640, 40, value, { fontSize: size, bold: true, color, valign: 'middle' }, { role: 'title' }),
  rect(39, 59, 111, 6, { fill: C.yellow, radius: 3 }, { role: 'titlebar' }),
]

export const slide = (kind, elements, extra = {}) => ({ id: newId(), kind, bg: 'light', notes: '', elements, ...extra })

/* ------------------------------------------------------------ project facts */

/*
 * WHAT THE DECK CALLS A PROJECT'S STATE: GO LIVE once it is done, Planning
 * before it starts, and On Track while it runs — unless it is past its date or
 * held up, which the app knows and the deck should say.
 */
export function deckStatus(p, asOf = todayISO()) {
  if (!p) return 'On Track'
  if (/hold/i.test(String(p.status || '')) || p.hold) return 'On Hold'
  if (p.status === 'Done') return 'GO LIVE'
  if (/not\s*start/i.test(String(p.status || ''))) return 'Planning'
  const t = timelineOf(p, asOf)
  if (t.overdue || t.adjustedEnd) return 'Delayed'
  return 'On Track'
}

/* A name short enough for one line of a list or a roadmap row. */
export const shortName = (v, n = 40) => {
  const t = String(v || '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1).replace(/[\s,–—-]+$/, '')}…` : t
}

/* "FNP-2108 Load October actuals" reads as "Load October actuals" on a slide. */
const plainTitle = (t) => String(t || '').replace(/^\s*[A-Z][A-Z0-9_]+-\d+\s*[:–—-]?\s*/, '').trim()

const firstLines = (v, n = 2) => String(v || '').split(/\n|(?<=[.;])\s+/).map((s) => s.trim().replace(/[.;]$/, '')).filter(Boolean).slice(0, n)

/** A project card's words, from the plan alone (no weekly updates yet). */
export function cardFromProject(p) {
  const impact = Array.isArray(p.softBenefits) && p.softBenefits.length
    ? p.softBenefits.slice(0, 2)
    : [
      ...(Number(p.savingHours) > 0 ? [`Saves ${Math.round(p.savingHours).toLocaleString('en-US')} hours a month`] : []),
      ...firstLines(p.notes, 1),
    ].slice(0, 2)
  return {
    projectKey: p.key,
    title: p.summary || p.key,
    status: deckStatus(p),
    accomplishment: p.status === 'Done' ? ['Delivered and live'] : [],
    impact,
    next: [],
    target: deckDate(p.adjustedDue && p.adjustedDue > (p.due || '') ? p.adjustedDue : p.due),
  }
}

/*
 * THE WEEKLY UPDATES, AS A CARD: what was finished lately, and what is next.
 * `facts` is what /api/decks/project/:key answers.
 */
export function cardFromFacts(p, facts) {
  const base = cardFromProject(p || facts?.project || {})
  const hist = facts?.history || []
  const seen = new Set()
  const uniq = (list) => list.filter((t) => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  const done = uniq(hist.filter((h) => h.done === true).map((h) => plainTitle(h.title)).filter(Boolean)).slice(0, 3)
  const latestWeek = hist[0]?.week
  const open = uniq(hist.filter((h) => h.week === latestWeek && h.done !== true && !h.hold).map((h) => plainTitle(h.title)).filter(Boolean)).slice(0, 3)
  return {
    ...base,
    accomplishment: done.length ? done : base.accomplishment,
    next: open.length ? open : base.next,
  }
}

/* ------------------------------------------------------------------ slides */

export function coverSlide({ title = 'IT Finance Governance', subtitle = 'by F&A Tech Solution Team', date = '', hasBrand = false } = {}) {
  return slide('cover', [
    text(56, 128, 640, 60, title, { fontSize: 38, bold: true, color: C.navy2, valign: 'middle' }, { role: 'title' }),
    rect(58, 218, 144, 2, { fill: C.navy2 }),
    text(56, 230, 420, 30, subtitle, { fontSize: 17, color: C.inkSoft, valign: 'middle' }, { role: 'subtitle' }),
    text(56, 258, 420, 24, date ? deckDate(date) : '', { fontSize: 11, color: C.inkSoft, valign: 'middle' }, { role: 'date' }),
    ...(hasBrand ? [image(745, 20, 176, 55, { brand: 'logo' })] : []),
  ], { bg: 'cover' })
}

export function agendaSlide(projects) {
  const fin = projects.filter((p) => p.team !== 'Accounting').slice(0, 9)
  const acc = projects.filter((p) => p.team === 'Accounting').slice(0, 9)
  // One line each, and smaller type when there are more of them, so the list stays in its box.
  const list = (ps) => ps.map((p, i) => `${String(i + 1).padStart(2, '0')}   ${shortName(p.summary || p.key, 36)}`).join('\n')
  const size = (n) => (n <= 5 ? 12.75 : n <= 7 ? 11.5 : 10)
  const lh = (n) => (n <= 5 ? 2.05 : n <= 7 ? 1.8 : 1.55)
  return slide('agenda', [
    text(38, 18, 520, 34, 'Agenda', { fontSize: 20, bold: true, color: C.blue, valign: 'middle' }, { role: 'title' }),
    rect(39, 58, 111, 6, { fill: C.yellow, radius: 3 }, { role: 'titlebar' }),
    rect(48, 108, 410, 356, { fill: '#F2F8FD', border: C.blue, borderWidth: 1.5, radius: 6 }),
    rect(48, 108, 410, 70, { fill: C.blue, radius: 6 }),
    text(76, 108, 360, 70, 'Finance Initiatives', { fontSize: 18, bold: true, color: C.white, valign: 'middle' }),
    text(76, 196, 360, 250, list(fin), { fontSize: size(fin.length), color: '#15324B', lineHeight: lh(fin.length) }),
    rect(502, 108, 410, 356, { fill: '#FFF9E8', border: C.yellow, borderWidth: 1.5, radius: 6 }),
    rect(502, 108, 410, 70, { fill: C.yellow, radius: 6 }),
    text(530, 108, 360, 70, 'Accounting Initiatives', { fontSize: 18, bold: true, color: C.blue, valign: 'middle' }),
    text(530, 196, 360, 250, list(acc), { fontSize: size(acc.length), color: '#15324B', lineHeight: lh(acc.length) }),
  ], { bg: 'white' })
}

/*
 * PROJECT UPDATE CARDS: 2 × 2 for up to four, 3 × 2 for five or six, as on
 * the deck's Finance and Accounting slides. Blue and yellow alternate like a
 * chessboard.
 */
export function updatesSlide(titleText, cards) {
  const n = Math.min(6, cards.length)
  const cols = n <= 4 ? 2 : 3
  const gap = cols === 2 ? 26 : 20
  const left = 47
  const top = 96
  const cw = (W - left * 2 - gap * (cols - 1)) / cols
  const ch = (H - top - 22 - 18) / 2
  const els = cards.slice(0, 6).map((c, i) => {
    const r = Math.floor(i / cols)
    const k = i % cols
    return {
      id: newId(),
      type: 'card',
      x: left + k * (cw + gap),
      y: top + r * (ch + 18),
      w: cw,
      h: ch,
      // Three across, the cards are narrower: the type is kept readable rather than shrunk with them.
      style: { tone: (r + k) % 2 ? 'yellow' : 'blue', scale: cols === 3 ? 1.35 : 1.05 },
      data: c,
    }
  })
  return slide('updates', [...titleBlock(titleText), ...els])
}

export function roadmapSlide(projects, { year = Number(todayISO().slice(0, 4)), hasBrand = false, title = 'F&A Tech Team – Key Initiatives' } = {}) {
  const groups = [['Finance', projects.filter((p) => p.team !== 'Accounting')], ['Accounting', projects.filter((p) => p.team === 'Accounting')]]
  const rows = []
  for (const [g, ps] of groups) {
    if (!ps.length) continue
    rows.push({ id: newId(), group: g })
    ps.forEach((p, i) => {
      const status = deckStatus(p)
      rows.push({
        id: newId(), projectKey: p.key, label: shortName(p.summary || p.key, 34), status,
        bar: status === 'GO LIVE' ? 'Live' : '', start: p.start || '', end: (p.actualEnd || p.adjustedDue || p.due || ''), tone: toneFor(status, i),
      })
    })
  }
  return slide('roadmap', [
    ...titleBlock(title),
    text(640, 70, 290, 18, `${year} DELIVERY ROADMAP`, { fontSize: 8, bold: true, color: C.blue, align: 'right', valign: 'middle' }),
    ...(hasBrand ? [image(800, 18, 128, 46, { brand: 'logo' })] : []),
    { id: newId(), type: 'roadmap', x: 26, y: 96, w: 908, h: 428, style: {}, data: { year, rows } },
  ], { bg: 'white' })
}

/*
 * ONE PROJECT'S TASKS BY WEEK, like the "PL Forecast Task Timeline" slides.
 * `issues` are the Jira tasks under the project's epic.
 */
export function tasksSlide(p, issues = []) {
  const rows = issues.slice(0, 18).map((t) => ({
    id: newId(), key: t.key, label: t.summary || t.key, start: t.start || t.created || t.due || '', end: t.due || t.resolved || t.start || '', done: !!t.done,
  }))
  const dates = rows.flatMap((r) => [r.start, r.end]).filter(Boolean).sort()
  const from = (dates[0] || p.start || todayISO()).slice(0, 8) + '01'
  const to = dates[dates.length - 1] || p.due || todayISO()
  const status = deckStatus(p)
  return slide('tasks', [
    ...titleBlock(`${p.summary || p.key} – Task Timeline`),
    { id: newId(), type: 'pill', x: 790, y: 26, w: 120, h: 26, style: { fontSize: 9 }, data: { status, projectKey: p.key } },
    { id: newId(), type: 'tasks', x: 26, y: 84, w: 908, h: 440, style: {}, data: { projectKey: p.key, from, to, today: true, rows } },
  ], { bg: 'white' })
}

export function sectionSlide(team, { hasBrand = false } = {}) {
  const name = team === 'Accounting' ? 'Accounting' : 'Finance'
  if (hasBrand) return slide('section', [], { bg: name === 'Accounting' ? 'accounting' : 'finance' })
  return slide('section', [
    text(76, 170, 560, 150, `${name} Tech\nInitiative`, { fontSize: 44, bold: true, color: C.navy, valign: 'middle', lineHeight: 1.1 }, { role: 'title' }),
    rect(80, 330, 120, 5, { fill: C.yellow, radius: 2 }),
  ], { bg: 'cover' })
}

export function imageSlide(titleText = 'Screenshot') {
  return slide('image', [
    ...titleBlock(titleText, { color: C.blue }),
    image(60, 90, 840, 420, {}),
  ], { bg: 'white' })
}

export function thanksSlide() {
  return slide('thanks', [{ id: newId(), type: 'thanks', x: 0, y: 0, w: W, h: H, style: {}, locked: true }], { bg: 'blue' })
}

export function blankSlide(titleText = 'Title') {
  return slide('blank', [...titleBlock(titleText)])
}

/* Cards in sixes, one slide each: "… – Project Update", "… (2)". */
export function updatesSlides(titleText, cards) {
  const out = []
  for (let i = 0; i < cards.length; i += 6) out.push(updatesSlide(i ? `${titleText} (${i / 6 + 1})` : titleText, cards.slice(i, i + 6)))
  return out
}

/*
 * THE MEETING DECK IN ONE GO: cover, agenda, the Finance and Accounting
 * updates, the roadmap and thank you — what the 13 Nov deck is, from the
 * projects chosen.
 */
export function standardDeck(projects, { title, subtitle, date, hasBrand } = {}) {
  const fin = projects.filter((p) => p.team !== 'Accounting')
  const acc = projects.filter((p) => p.team === 'Accounting')
  return [
    coverSlide({ title, subtitle, date, hasBrand: hasBrand?.logo }),
    agendaSlide(projects),
    ...(fin.length ? updatesSlides('Finance Initiatives – Project Update', fin.map(cardFromProject)) : []),
    ...(acc.length ? updatesSlides('Accounting Initiatives – Project Update', acc.map(cardFromProject)) : []),
    roadmapSlide(projects, { hasBrand: hasBrand?.logo }),
    thanksSlide(),
  ]
}
