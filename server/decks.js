import { randomUUID } from 'node:crypto'
import { Binary } from 'mongodb'
import { connect, UNAVAILABLE } from './db.js'
import * as llm from './llm.js'

/**
 * PRESENTATIONS: the team's slide decks, in the IT governance deck's format.
 *
 * One shared list, as agreed: an administrator and a team member alike can
 * open and edit any deck. A deck is one document, saved whole; `rev` goes up
 * by one on every save and a save that names an older `rev` is refused, so two
 * people editing the same deck cannot silently undo each other.
 *
 * Pictures are kept apart from the decks, one document each, and a slide
 * holds only the picture's id — a deck with twenty screenshots would
 * otherwise outgrow what MongoDB allows in one document.
 *
 * The deck's look — the company logo, the cover and section illustrations —
 * is a set of pictures an administrator uploads once (the "brand"). They are
 * never in this repository, which is public.
 */

const cfg = () => ({
  decks: process.env.MONGODB_DECKS_COLLECTION || 'kpi_decks',
  assets: process.env.MONGODB_DECK_ASSETS_COLLECTION || 'kpi_deck_assets',
})

let colls = null
async function c() {
  const db = await connect()
  if (!db) return null
  if (!colls) {
    const d = db.s.db
    colls = { decks: d.collection(cfg().decks), assets: d.collection(cfg().assets) }
    await colls.decks.createIndex({ updatedAt: -1 })
  }
  return colls
}

/* --------------------------------------------------------------- cleaning */

const str = (v, max = 4000) => String(v ?? '').slice(0, max)
const num = (v, lo, hi, dflt = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}
const id = (v) => (/^[A-Za-z0-9_-]{1,64}$/.test(String(v || '')) ? String(v) : randomUUID().slice(0, 12))
const COLOR = /^#[0-9a-fA-F]{6}$/
const color = (v) => (COLOR.test(String(v || '')) ? String(v) : undefined)
const KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/

export const SLIDE_KINDS = ['cover', 'agenda', 'updates', 'roadmap', 'tasks', 'section', 'image', 'thanks', 'blank']
export const ELEMENT_TYPES = ['text', 'rect', 'image', 'card', 'roadmap', 'tasks', 'pill', 'thanks']
const BRAND_KEYS = ['logo', 'cover', 'finance', 'accounting']

function cleanStyle(s = {}) {
  const out = {}
  if (s.fontSize != null) out.fontSize = num(s.fontSize, 4, 160, 14)
  for (const k of ['bold', 'italic', 'underline', 'shadow']) if (s[k] != null) out[k] = !!s[k]
  for (const k of ['color', 'fill', 'border']) if (color(s[k])) out[k] = s[k]
  if (['left', 'center', 'right'].includes(s.align)) out.align = s.align
  if (['top', 'middle', 'bottom'].includes(s.valign)) out.valign = s.valign
  if (s.radius != null) out.radius = num(s.radius, 0, 200, 0)
  if (s.borderWidth != null) out.borderWidth = num(s.borderWidth, 0, 20, 1)
  if (s.dashed != null) out.dashed = !!s.dashed
  if (s.lineHeight != null) out.lineHeight = num(s.lineHeight, 0.8, 3, 1.2)
  if (s.opacity != null) out.opacity = num(s.opacity, 0, 1, 1)
  if (s.scale != null) out.scale = num(s.scale, 0.4, 3, 1)
  if (s.tone != null && ['blue', 'yellow'].includes(s.tone)) out.tone = s.tone
  return out
}

const lines = (v, n = 12, max = 400) => (Array.isArray(v) ? v : String(v ?? '').split('\n'))
  .map((x) => str(x, max)).filter((x, i, a) => x.trim() || i < a.length - 1).slice(0, n)

/** The data behind a data-bound element, cut to what each kind is. */
function cleanData(type, d = {}) {
  if (type === 'card') {
    return {
      projectKey: KEY.test(String(d.projectKey || '')) ? String(d.projectKey) : null,
      title: str(d.title, 200),
      status: str(d.status, 30),
      accomplishment: lines(d.accomplishment),
      impact: lines(d.impact),
      next: lines(d.next),
      target: str(d.target, 60),
      labels: d.labels && typeof d.labels === 'object'
        ? Object.fromEntries(['accomplishment', 'impact', 'next', 'target'].map((k) => [k, str(d.labels[k] ?? '', 40)]).filter(([, v]) => v))
        : undefined,
    }
  }
  if (type === 'roadmap') {
    const rows = Array.isArray(d.rows) ? d.rows.slice(0, 60) : []
    return {
      year: num(d.year, 2000, 2100, new Date().getFullYear()),
      rows: rows.map((r) => ({
        id: id(r.id),
        group: r.group ? str(r.group, 60) : undefined,
        projectKey: KEY.test(String(r.projectKey || '')) ? String(r.projectKey) : null,
        label: str(r.label, 120),
        status: str(r.status, 30),
        bar: str(r.bar, 80),
        start: str(r.start, 10),
        end: str(r.end, 10),
        tone: ['blue', 'yellow', 'green'].includes(r.tone) ? r.tone : undefined,
      })),
    }
  }
  if (type === 'tasks') {
    const rows = Array.isArray(d.rows) ? d.rows.slice(0, 40) : []
    return {
      projectKey: KEY.test(String(d.projectKey || '')) ? String(d.projectKey) : null,
      from: str(d.from, 10),
      to: str(d.to, 10),
      today: d.today !== false,
      rows: rows.map((r) => ({
        id: id(r.id),
        group: !!r.group,
        key: KEY.test(String(r.key || '')) ? String(r.key) : null,
        label: str(r.label, 160),
        start: str(r.start, 10),
        end: str(r.end, 10),
        done: !!r.done,
      })),
    }
  }
  if (type === 'pill') return { status: str(d.status, 30), projectKey: KEY.test(String(d.projectKey || '')) ? String(d.projectKey) : null }
  if (type === 'image') {
    return {
      asset: /^[A-Za-z0-9_-]{6,64}$/.test(String(d.asset || '')) ? String(d.asset) : null,
      brand: BRAND_KEYS.includes(d.brand) ? d.brand : null,
      fit: ['contain', 'cover'].includes(d.fit) ? d.fit : 'contain',
    }
  }
  return undefined
}

function cleanElement(e) {
  if (!e || !ELEMENT_TYPES.includes(e.type)) return null
  const out = {
    id: id(e.id),
    type: e.type,
    x: num(e.x, -960, 1920),
    y: num(e.y, -540, 1080),
    w: num(e.w, 2, 1920, 100),
    h: num(e.h, 2, 1080, 40),
    style: cleanStyle(e.style),
  }
  if (e.role) out.role = str(e.role, 30)
  if (e.locked) out.locked = true
  if (e.type === 'text') out.text = str(e.text, 6000)
  const data = cleanData(e.type, e.data)
  if (data) out.data = data
  return out
}

function cleanSlide(s) {
  return {
    id: id(s?.id),
    kind: SLIDE_KINDS.includes(s?.kind) ? s.kind : 'blank',
    bg: ['light', 'white', 'cover', 'finance', 'accounting', 'blue'].includes(s?.bg) ? s.bg : 'light',
    notes: str(s?.notes, 4000),
    hidden: !!s?.hidden,
    elements: (Array.isArray(s?.elements) ? s.elements : []).slice(0, 150).map(cleanElement).filter(Boolean),
  }
}

/** A deck as the editor sends it, cut to what a deck is. */
export function cleanDeck(d = {}) {
  return {
    title: str(d.title, 160).trim() || 'Untitled deck',
    date: str(d.date, 10),
    slides: (Array.isArray(d.slides) ? d.slides : []).slice(0, 80).map(cleanSlide),
  }
}

/* ------------------------------------------------------------------ decks */

const summary = (d) => ({
  id: d._id, title: d.title, date: d.date, slideCount: d.slideCount ?? (d.slides || []).length,
  createdBy: d.createdBy, createdAt: d.createdAt, updatedBy: d.updatedBy, updatedAt: d.updatedAt, rev: d.rev,
})

export async function list() {
  const k = await c()
  if (!k) return UNAVAILABLE
  // The first slide comes along, for the deck's picture in the list.
  const rows = await k.decks.find({}, { projection: { title: 1, date: 1, slides: { $slice: 1 }, slideCount: 1, createdBy: 1, createdAt: 1, updatedBy: 1, updatedAt: 1, rev: 1 } })
    .sort({ updatedAt: -1 }).limit(200).toArray()
  return rows.map((d) => ({ ...summary(d), first: d.slides?.[0] || null }))
}

const shape = (d) => ({ ...summary(d), slides: d.slides || [] })

export async function get(deckId) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const d = await k.decks.findOne({ _id: String(deckId) })
  return d ? shape(d) : null
}

export async function create(body, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const at = new Date().toISOString()
  const clean = cleanDeck(body)
  const doc = { _id: randomUUID().slice(0, 12), ...clean, slideCount: clean.slides.length, createdBy: by, createdAt: at, updatedBy: by, updatedAt: at, rev: 1 }
  await k.decks.insertOne(doc)
  return shape(doc)
}

/**
 * Save a whole deck. `rev` is the revision the editor started from: if
 * somebody else has saved since, nothing is written and the newer deck comes
 * back, so the editor can say so instead of overwriting it.
 */
export async function save(deckId, body, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const clean = cleanDeck(body)
  const size = Buffer.byteLength(JSON.stringify(clean))
  if (size > 3_000_000) return { status: 413, error: 'This deck is too large to save. Split it into two decks.' }
  const rev = Number(body?.rev)
  const at = new Date().toISOString()
  const r = await k.decks.findOneAndUpdate(
    { _id: String(deckId), rev },
    { $set: { ...clean, slideCount: clean.slides.length, updatedBy: by, updatedAt: at }, $inc: { rev: 1 } },
    { returnDocument: 'after' },
  )
  const doc = r?.value !== undefined ? r.value : r
  if (doc) return { deck: shape(doc) }
  const current = await k.decks.findOne({ _id: String(deckId) })
  if (!current) return { status: 404, error: 'That deck has been deleted.' }
  return { status: 409, error: `${current.updatedBy || 'Somebody'} saved this deck after you opened it.`, deck: shape(current) }
}

export async function remove(deckId) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const r = await k.decks.deleteOne({ _id: String(deckId) })
  return { deleted: r.deletedCount }
}

/* ----------------------------------------------------------------- pictures */

const MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
export const MAX_ASSET = 4_000_000

/** A picture sent as a data: URL. */
export async function addAsset({ dataUrl, name } = {}, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const m = String(dataUrl || '').match(/^data:([a-z/+-]+);base64,([A-Za-z0-9+/=\s]+)$/)
  if (!m || !MIME.includes(m[1])) return { status: 400, error: 'Only PNG, JPEG, WebP or GIF pictures can be added.' }
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length) return { status: 400, error: 'The picture is empty.' }
  if (buf.length > MAX_ASSET) return { status: 413, error: 'That picture is larger than 4 MB. Use a smaller one.' }
  const doc = { _id: randomUUID().replace(/-/g, '').slice(0, 20), mime: m[1], data: new Binary(buf), size: buf.length, name: str(name, 120), by, at: new Date().toISOString() }
  await k.assets.insertOne(doc)
  return { id: doc._id, url: `/api/decks/assets/${doc._id}`, size: doc.size }
}

export async function getAsset(assetId) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const d = await k.assets.findOne({ _id: String(assetId) })
  if (!d) return null
  return { mime: d.mime, data: Buffer.from(d.data.buffer) }
}

/* ------------------------------------------------------------------- brand */

const BRAND_ID = '__brand'

export async function getBrand() {
  const k = await c()
  if (!k) return UNAVAILABLE
  const d = await k.assets.findOne({ _id: BRAND_ID })
  const out = {}
  for (const b of BRAND_KEYS) out[b] = d?.[b] || null
  return out
}

export async function setBrand(patch = {}, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const set = { updatedBy: by, updatedAt: new Date().toISOString() }
  for (const b of BRAND_KEYS) {
    if (!(b in patch)) continue
    const v = patch[b]
    if (v === null) { set[b] = null; continue }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(v))) return { status: 400, error: `Not a picture: ${b}.` }
    if (!(await k.assets.findOne({ _id: String(v) }, { projection: { _id: 1 } }))) return { status: 400, error: `No such picture for ${b}.` }
    set[b] = String(v)
  }
  await k.assets.updateOne({ _id: BRAND_ID }, { $set: set }, { upsert: true })
  return getBrand()
}

/* ---------------------------------------------------------------------- AI */

const SAME_LANGUAGE = 'Write in the same language as the text you are given (Thai stays Thai, English stays English), unless the instruction asks for another language.'
const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

const bulletsOf = (v) => (Array.isArray(v) ? v : String(v || '').split('\n'))
  .map((x) => clip(String(x).replace(/^[•\-*\d.)\s]+/, ''), 160)).filter(Boolean).slice(0, 4)

/**
 * REWRITE ON REQUEST: some pieces of text and an instruction ("shorter",
 * "more formal", "in Thai", "two bullets each"). Answers with the same ids.
 */
export async function rewrite({ instruction, items } = {}) {
  const ask = clip(instruction, 600)
  const list = (Array.isArray(items) ? items : []).slice(0, 40)
    .map((it) => ({ id: str(it?.id, 80), text: str(it?.text, 2000) }))
    .filter((it) => it.id && it.text.trim())
  if (!ask) return { status: 400, error: 'Say what to change, e.g. "shorter" or "more formal".' }
  if (!list.length) return { status: 400, error: 'There is no text on this selection to rewrite.' }
  const out = await llm.chat([
    {
      role: 'system',
      content: 'You edit the text on presentation slides for a finance technology team. Keep every fact, number, date, name and project key; invent nothing. '
        + 'Slides are read at a glance: short phrases, no full stops at the end of bullets, no greetings or preambles. '
        + 'Keep the line structure: a text with several lines stays several lines (one bullet per line), and keep a leading "• " where there was one. '
        + `${SAME_LANGUAGE} Answer with JSON only: {"items":[{"id":"…","text":"…"}]} with the same ids.`,
    },
    { role: 'user', content: `Instruction: ${ask}\n\nTexts:\n${JSON.stringify({ items: list })}` },
  ], { temperature: 0.3, maxTokens: 2500 })
  const j = llm.jsonFrom(out)
  const known = new Set(list.map((x) => x.id))
  const got = (j?.items || []).filter((x) => known.has(String(x?.id)) && typeof x.text === 'string')
    .map((x) => ({ id: String(x.id), text: x.text.slice(0, 6000) }))
  if (!got.length) return { status: 502, error: 'The AI did not return the text in a form the slide can use. Try again.' }
  return { items: got }
}

/**
 * DRAFT PROJECT CARDS from what the app knows: each project's dates and
 * status, its last eight weeks of updates, open blockers and Jira tasks. The
 * caller has gathered that (`facts`); this writes the four boxes of the card.
 */
export async function draftCards({ projects, instruction } = {}) {
  const list = (Array.isArray(projects) ? projects : []).slice(0, 12)
  if (!list.length) return { status: 400, error: 'Pick at least one project.' }
  const out = await llm.chat([
    {
      role: 'system',
      content: 'You write project-update cards for an IT governance meeting slide. Each card has: '
        + '"accomplishment" (what was delivered so far), "impact" (the business benefit), "next" (the next milestone). '
        + 'Each is 1 to 3 short bullet phrases of at most 8 words, no full stops, no "•". Use only the facts given; if a box has no facts, '
        + 'write a sensible neutral phrase from the project name and status rather than inventing numbers. Keep project names, numbers and dates exact. '
        + `${SAME_LANGUAGE} Answer with JSON only: {"cards":[{"key":"FNP-1","accomplishment":["…"],"impact":["…"],"next":["…"]}]}`,
    },
    { role: 'user', content: `${instruction ? `Extra instruction: ${clip(instruction, 400)}\n\n` : ''}Projects:\n${JSON.stringify(list).slice(0, 24000)}` },
  ], { temperature: 0.3, maxTokens: 3000 })
  const j = llm.jsonFrom(out)
  const keys = new Set(list.map((p) => p.key))
  const cards = (j?.cards || []).filter((x) => keys.has(String(x?.key))).map((x) => ({
    key: String(x.key), accomplishment: bulletsOf(x.accomplishment), impact: bulletsOf(x.impact), next: bulletsOf(x.next),
  }))
  if (!cards.length) return { status: 502, error: 'The AI did not return cards the slide can use. Try again.' }
  return { cards }
}

/**
 * BUILD A WHOLE DECK from a request ("IT Gov deck for 13 Nov, Finance and
 * Accounting projects"): the AI chooses the slides and which projects go on
 * each; the browser then lays them out in the deck's format, and the person
 * edits from there.
 */
export async function plan({ request, projects } = {}) {
  const ask = clip(request, 800)
  if (!ask) return { status: 400, error: 'Say what the deck is for.' }
  const list = (Array.isArray(projects) ? projects : []).slice(0, 300)
  const out = await llm.chat([
    {
      role: 'system',
      content: 'You plan slide decks for a finance technology team\'s governance meetings, in a fixed format. Slide kinds: '
        + '"cover" (title, subtitle, date), "agenda" (lists projects under Finance and Accounting), '
        + '"updates" (up to 6 project-update cards: give their projectKeys; group Finance and Accounting on separate slides), '
        + '"roadmap" (a year roadmap of projects by month: projectKeys), "tasks" (one project\'s weekly task timeline: one projectKey), '
        + '"section" (a divider: title "Finance Tech Initiative" or "Accounting Tech Initiative"), "image" (a screenshot placeholder with a title), "thanks". '
        + 'Use only project keys from the list. Prefer projects that are active, recently delivered or due soon. '
        + `${SAME_LANGUAGE} Answer with JSON only: {"title":"…","subtitle":"…","slides":[{"kind":"updates","title":"Finance Initiatives – Project Update","projectKeys":["FNP-1"]}]}`,
    },
    { role: 'user', content: `Request: ${ask}\n\nProjects (key, name, team, status, start, due):\n${list.map((p) => [p.key, clip(p.summary, 80), p.team, p.status, p.start, p.due].join(' | ')).join('\n').slice(0, 30000)}` },
  ], { temperature: 0.2, maxTokens: 3000 })
  const j = llm.jsonFrom(out)
  const keys = new Set(list.map((p) => p.key))
  const slides = (j?.slides || []).slice(0, 40).filter((s) => SLIDE_KINDS.includes(s?.kind)).map((s) => ({
    kind: s.kind,
    title: clip(s.title, 160),
    subtitle: clip(s.subtitle, 160),
    projectKeys: (Array.isArray(s.projectKeys) ? s.projectKeys : []).map(String).filter((k) => keys.has(k)).slice(0, 40),
  }))
  if (!slides.length) return { status: 502, error: 'The AI did not return a deck plan the app can use. Try again.' }
  return { title: clip(j.title, 160), subtitle: clip(j.subtitle, 160), slides }
}
