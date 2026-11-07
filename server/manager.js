import { connect, UNAVAILABLE } from './db.js'
import * as weekly from './weekly.js'
import * as auth from './auth.js'
import * as mail from './mail.js'
import { weekOf } from '../src/lib/weekly.js'
import { cleanHiddenColumns } from '../src/lib/projectColumns.js'
import { cleanProjectLayout } from '../src/lib/projectLayout.js'

/**
 * THE MANAGER DASHBOARD'S OWN STORAGE.
 *
 *   layout     the one arrangement of cards every administrator sees. One
 *              document: an administrator who moves a card moves it for all of
 *              them, as agreed.
 *   followups  "please update this project" — sent to the project's owner,
 *              answered when they save their week with a task on it, and the
 *              administrator who asked is told.
 *
 * Neither is in the shared plan: that is one document saved whole, and a
 * follow-up answered while an administrator's browser holds an older copy
 * would be undone by that browser's next save.
 */

const cfg = () => ({
  layout: process.env.MONGODB_DASHBOARD_COLLECTION || 'kpi_dashboard_layout',
  followups: process.env.MONGODB_FOLLOWUPS_COLLECTION || 'kpi_followups',
})

let colls = null
async function c() {
  const db = await connect()
  if (!db) return null
  if (!colls) {
    const d = db.s.db
    colls = { layout: d.collection(cfg().layout), followups: d.collection(cfg().followups) }
    await colls.followups.createIndex({ week: 1, person: 1, status: 1 })
    await colls.followups.createIndex({ projectKey: 1, sentAt: -1 })
  }
  return colls
}

/* -------------------------------------------------------------- layout */

const LAYOUT_ID = 'managers'
const TYPE = /^[a-z][A-Za-z0-9]{1,40}$/
const int = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)))

/**
 * A layout as the grid sends it, cut down to what a layout is: which card,
 * where, how big. One of each card; at most sixty. Anything else is dropped,
 * so a bad client cannot store something the page then chokes on.
 */
export function cleanLayout(items) {
  if (!Array.isArray(items)) return null
  const seen = new Set()
  const out = []
  for (const it of items.slice(0, 60)) {
    const type = String(it?.type || it?.i || '')
    if (!TYPE.test(type) || seen.has(type)) continue
    seen.add(type)
    out.push({
      type,
      x: int(it.x, 0, 11),
      y: int(it.y, 0, 500),
      w: int(it.w, 1, 12),
      h: int(it.h, 2, 60),
    })
  }
  return out
}

export async function getLayout() {
  const k = await c()
  if (!k) return UNAVAILABLE
  const doc = await k.layout.findOne({ _id: LAYOUT_ID })
  return doc ? { items: doc.items, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy } : { items: null }
}

export async function saveLayout(items, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const clean = cleanLayout(items)
  if (!clean) return { error: 'A layout is a list of cards.' }
  const doc = { items: clean, updatedAt: new Date().toISOString(), updatedBy: by }
  await k.layout.updateOne({ _id: LAYOUT_ID }, { $set: doc }, { upsert: true })
  return doc
}

/** Back to the default arrangement, for everybody. */
export async function resetLayout() {
  const k = await c()
  if (!k) return UNAVAILABLE
  await k.layout.deleteOne({ _id: LAYOUT_ID })
  return { items: null }
}

/* ------------------------------------------------- the register's columns */

/*
 * Which columns of the Projects register are hidden, for everybody. Kept in
 * the same collection as the dashboard layout, as its own document: it is the
 * same kind of thing — how a shared page is arranged — and not in the plan,
 * which is saved whole from whichever browser saves last.
 */
const COLUMNS_ID = 'projects-columns'

export async function getProjectColumns() {
  const k = await c()
  if (!k) return UNAVAILABLE
  const doc = await k.layout.findOne({ _id: COLUMNS_ID })
  return doc
    ? { hidden: cleanHiddenColumns(doc.hidden) || [], updatedAt: doc.updatedAt, updatedBy: doc.updatedBy }
    : { hidden: [] }
}

export async function saveProjectColumns(hidden, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const clean = cleanHiddenColumns(hidden)
  if (!clean) return { error: 'Hidden columns are a list of column names.' }
  const doc = { hidden: clean, updatedAt: new Date().toISOString(), updatedBy: by }
  await k.layout.updateOne({ _id: COLUMNS_ID }, { $set: doc }, { upsert: true })
  return doc
}

/* --------------------------------------------- the Projects page's layout */

/*
 * Which blocks and figure tiles the Projects page shows, in what order: one
 * arrangement, made by an administrator, for everybody. Beside the dashboard
 * layout and the register's columns, for the same reason as them.
 */
const PROJECTS_LAYOUT_ID = 'projects-layout'

export async function getProjectLayout() {
  const k = await c()
  if (!k) return UNAVAILABLE
  const doc = await k.layout.findOne({ _id: PROJECTS_LAYOUT_ID })
  return doc
    ? { layout: cleanProjectLayout(doc.layout), updatedAt: doc.updatedAt, updatedBy: doc.updatedBy }
    : { layout: null }
}

export async function saveProjectLayout(layout, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const clean = cleanProjectLayout(layout)
  if (!clean) return { error: 'A layout lists the page\'s blocks and figures.' }
  const doc = { layout: clean, updatedAt: new Date().toISOString(), updatedBy: by }
  await k.layout.updateOne({ _id: PROJECTS_LAYOUT_ID }, { $set: doc }, { upsert: true })
  return doc
}

export async function resetProjectLayout() {
  const k = await c()
  if (!k) return UNAVAILABLE
  await k.layout.deleteOne({ _id: PROJECTS_LAYOUT_ID })
  return { layout: null }
}

/* ----------------------------------------------------------- follow-ups */

const activeAccounts = async () => {
  const rows = await auth.listUsers()
  return rows === UNAVAILABLE ? [] : rows.filter((a) => a.status === 'active')
}

// Asking twice inside this is a double click, not a second question.
const AGAIN_AFTER = 10 * 60_000

/**
 * ASK A PROJECT'S OWNER FOR AN UPDATE.
 *
 * The owner is the project's PIC in the register, reached through the account
 * linked to them on the Access tab. The email's button opens their Weekly page
 * on this project's task — added for them if their week does not have one —
 * so the update lands where every other update does and counts toward the
 * dashboard's "updated this week".
 */
export async function followUp(projectKey, by, now = Date.now()) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const r = await weekly.roster()
  if (r === UNAVAILABLE) return UNAVAILABLE
  const project = r.projects.find((p) => p.key === projectKey)
  if (!project) return { error: 'There is no such project in the register.', status: 404 }
  if (!project.pic) return { error: `${projectKey} has no owner (PIC) in the register, so there is nobody to ask.`, status: 409 }
  const owner = r.people.find((p) => p.id === project.pic)
  const nick = owner?.nick || project.pic
  const accounts = await activeAccounts()
  const to = accounts.filter((a) => a.person === project.pic).map((a) => a.email)
  if (!to.length) {
    return { error: `No account is linked to ${nick} yet. Link one on the Access tab, then follow up again.`, status: 409 }
  }
  if (!mail.status().configured) return { error: 'Email is not set up on the server yet (SMTP_USER and SMTP_PASSWORD).', status: 409 }

  const recent = await k.followups.findOne({ projectKey, sentAt: { $gte: new Date(now - AGAIN_AFTER).toISOString() } })
  if (recent) return { error: `${nick} was asked about ${projectKey} a few minutes ago.`, status: 429, followup: recent }

  const week = weekOf(now)
  const asker = accounts.find((a) => a.email === by)
  const askerNick = (asker?.person && r.people.find((p) => p.id === asker.person)?.nick) || by
  const doc = {
    _id: `${week}.${projectKey}.${now}`,
    week,
    projectKey,
    projectSummary: project.summary,
    person: project.pic,
    nick,
    to,
    by,
    sentAt: new Date(now).toISOString(),
    status: 'sent',
  }
  await k.followups.insertOne(doc)

  const link = `${mail.appUrl()}/#weekly/${encodeURIComponent(projectKey)}`
  const { html, text } = mail.layout({
    heading: `${askerNick} asks for an update on ${projectKey}`,
    lines: [
      `${projectKey}${project.summary ? ` — ${project.summary}` : ''}.`,
      'Please add this week’s update for it: what you are doing, and if it is not finished, what is in the way and when it will land.',
      'The button opens your week on the project. If none of its tasks is in your week yet, add one there (New task) and send the update on it.',
      'When you send it, your manager is told.',
    ],
    button: { label: `Update ${projectKey}`, href: link },
  })
  await mail.sendOnce(`followup:${doc._id}`, {
    to, kind: 'followup', subject: `Update needed: ${projectKey}${project.summary ? ` — ${project.summary}` : ''}`, html, text, meta: { followup: doc._id },
  })
  return { followup: doc }
}

export async function listFollowups({ week } = {}) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const q = week ? { week } : {}
  return (await k.followups.find(q).sort({ sentAt: -1 }).limit(300).toArray())
    .map(({ _id, ...f }) => ({ id: _id, ...f }))
}

/**
 * A MEMBER SAVED THEIR WEEK. Any follow-up waiting on them for a project
 * their week now has a task on is answered, and whoever asked is emailed a
 * link to the project.
 */
export async function answered(week, person, entry, now = Date.now()) {
  const k = await c()
  if (!k || !entry) return []
  const keys = new Set([...(entry.tasks || []), ...(entry.unplanned || [])].map((t) => t.projectKey).filter(Boolean))
  if (!keys.size) return []
  const open = await k.followups.find({ week, person, status: 'sent', projectKey: { $in: [...keys] } }).toArray()
  const done = []
  for (const f of open) {
    const at = new Date(now).toISOString()
    const r = await k.followups.updateOne({ _id: f._id, status: 'sent' }, { $set: { status: 'updated', updatedAt: at } })
    if (!r.modifiedCount) continue
    done.push({ ...f, status: 'updated', updatedAt: at })
    const task = (entry.tasks || []).find((t) => t.projectKey === f.projectKey)
      || (entry.unplanned || []).find((t) => t.projectKey === f.projectKey)
    const state = task?.done === true ? 'finished'
      : task?.done === false ? `not finished${task.pct != null ? ` (${task.pct}%)` : ''}${task.newDate ? `, now expected ${task.newDate}` : ''}`
        : task?.expected ? `expected ${task.expected}` : null
    if (!mail.status().configured) continue
    const { html, text } = mail.layout({
      heading: `${f.nick} updated ${f.projectKey}`,
      lines: [
        `${f.projectKey}${f.projectSummary ? ` — ${f.projectSummary}` : ''}.`,
        task?.title ? `“${task.title}”${state ? ` — ${state}` : ''}.` : null,
        task?.blocker ? `In the way: ${task.blocker}` : null,
      ].filter(Boolean),
      button: { label: `Open ${f.projectKey}`, href: `${mail.appUrl()}/#project/${encodeURIComponent(f.projectKey)}` },
      foot: `You asked for this update on ${new Date(f.sentAt).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })}.`,
    })
    await mail.sendOnce(`followup-done:${f._id}`, {
      to: f.by, kind: 'followup-done', subject: `Updated: ${f.projectKey} by ${f.nick}`, html, text, meta: { followup: f._id },
    })
  }
  return done
}
