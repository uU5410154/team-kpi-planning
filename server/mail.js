import nodemailer from 'nodemailer'
import { connect, UNAVAILABLE } from './db.js'

/**
 * SENDING EMAIL, AND REMEMBERING WHAT WAS SENT.
 *
 * Through a Gmail account and an app password (SMTP_USER, SMTP_PASSWORD in the
 * Render dashboard) — the account named there sends everything. The password
 * never leaves the server and is never shown on a page.
 *
 * Every email has a NAME before it is sent — "the 15:00 Friday reminder to
 * James for the week of 2 Nov" — and that name is written to the mail log
 * first, as a unique key. A second attempt to send the same email finds the
 * name already there and stops. That is what makes the schedule safe to run
 * every minute, after a restart, or twice at once: an email is sent once or
 * not at all, never twice.
 *
 * MAIL_TRANSPORT=log builds every email and logs it without sending — for the
 * test suites, and for trying the schedule out against a copy of the data.
 */

const cfg = () => {
  const user = String(process.env.SMTP_USER || '').trim()
  return {
    user,
    pass: String(process.env.SMTP_PASSWORD || '').replace(/\s+/g, ''),
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 465),
    from: process.env.MAIL_FROM || (user ? `F&A KPI Planning <${user}>` : ''),
    transport: String(process.env.MAIL_TRANSPORT || '').toLowerCase(),
    log: process.env.MONGODB_MAIL_LOG_COLLECTION || 'kpi_mail_log',
    appUrl: (process.env.APP_URL || 'https://team-kpi-planning.onrender.com').replace(/\/$/, ''),
  }
}

export const appUrl = () => cfg().appUrl
/**
 * A link to one page of the app. ?go marks it as asked for on purpose, so an
 * administrator lands on that page rather than on the Dashboard.
 */
export const pageLink = (hash) => `${appUrl()}/?go#${hash}`

/** Whether email can go out at all, and from whom. Never the password. */
export function status() {
  const c = cfg()
  if (c.transport === 'log') return { configured: true, from: c.from || 'test@localhost', mode: 'log only — nothing is sent' }
  return {
    configured: !!(c.user && c.pass),
    from: c.from || null,
    mode: 'gmail',
    missing: [!c.user && 'SMTP_USER', !c.pass && 'SMTP_PASSWORD'].filter(Boolean),
  }
}

let transporter = null
let transporterKey = ''
function transport() {
  const c = cfg()
  const key = `${c.transport}|${c.user}|${c.pass}|${c.host}|${c.port}`
  if (transporter && transporterKey === key) return transporter
  transporter = c.transport === 'log'
    ? nodemailer.createTransport({ jsonTransport: true })
    : nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.port === 465,
      auth: { user: c.user, pass: c.pass },
    })
  transporterKey = key
  return transporter
}

let logColl = null
async function log() {
  const c = await connect()
  if (!c) return null
  if (!logColl) {
    logColl = c.s.db.collection(cfg().log)
    await logColl.createIndex({ at: -1 })
  }
  return logColl
}

/*
 * SEND ONE NAMED EMAIL, AT MOST ONCE.
 *
 * Returns 'sent', 'duplicate' (somebody already sent it), 'failed', or
 * 'unconfigured'. A failure is kept with its reason and may be tried again —
 * up to three times — by a later call with the same name; a success never is.
 */
export async function sendOnce(id, { to, subject, html, text, kind, meta = {} }) {
  if (!status().configured) return 'unconfigured'
  const list = [...new Set((Array.isArray(to) ? to : [to]).map((x) => String(x || '').trim().toLowerCase()).filter(Boolean))]
  if (!list.length) return 'nobody'
  const l = await log()
  if (!l) return UNAVAILABLE
  const now = new Date().toISOString()
  try {
    await l.insertOne({
      _id: id, kind, to: list, subject, status: 'sending', attempts: 1, at: now, ...meta,
    })
  } catch (e) {
    if (e.code !== 11000) throw e
    // Already named. Only a failure with tries left is taken again.
    const retry = await l.updateOne(
      { _id: id, status: 'failed', attempts: { $lt: 3 } },
      { $set: { status: 'sending', at: now }, $inc: { attempts: 1 } },
    )
    if (!retry.modifiedCount) return 'duplicate'
  }
  try {
    const c = cfg()
    const info = await transport().sendMail({
      from: c.from || 'test@localhost', to: list.join(', '), subject, html, text,
    })
    await l.updateOne({ _id: id }, {
      $set: {
        status: 'sent',
        sentAt: new Date().toISOString(),
        // The whole message only when nothing was really sent, for the tests
        // to read; a real email's body is not worth keeping twice.
        ...(c.transport === 'log' ? { body: text } : {}),
        messageId: info.messageId || null,
      },
    })
    return 'sent'
  } catch (e) {
    await l.updateOne({ _id: id }, { $set: { status: 'failed', error: String(e.message || e).slice(0, 500) } })
    console.warn(`[mail] ${id} failed: ${e.message}`)
    return 'failed'
  }
}

/** The latest emails, newest first, for the Access tab. */
export async function recent(limit = 40) {
  const l = await log()
  if (!l) return UNAVAILABLE
  return l.find({}, { projection: { body: 0 } }).sort({ at: -1 }).limit(limit).toArray()
}

/** Every logged email whose name starts with `prefix` — the test suites read these. */
export async function byPrefix(prefix) {
  const l = await log()
  if (!l) return UNAVAILABLE
  const safe = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return l.find({ _id: { $regex: `^${safe}` } }).sort({ at: 1 }).toArray()
}

/* ------------------------------------------------------------- the look */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]))

/*
 * One layout for every email: a heading, a few lines, one button. Tables and
 * inline styles, because that is what Outlook renders; the colours are the
 * app's. Every email also has a plain-text part, for whoever reads that.
 */
export function layout({
  heading, lines = [], button, foot,
}) {
  const html = `<!doctype html><html><body style="margin:0;background:#f2f3fb;font-family:Segoe UI,Arial,sans-serif;color:#13163a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f3fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e5f5">
<tr><td style="background:linear-gradient(135deg,#3b22a8,#6d2fd8);background-color:#4b2bc0;padding:20px 24px;color:#ffffff">
<div style="font-size:12px;opacity:.85;font-weight:600">F&amp;A Tech · Weekly check-in</div>
<div style="font-size:22px;font-weight:800;margin-top:6px">${esc(heading)}</div></td></tr>
<tr><td style="padding:20px 24px;font-size:15px;line-height:1.55">
${lines.map((l) => `<p style="margin:0 0 12px">${l.html ?? esc(l)}</p>`).join('\n')}
${button ? `<p style="margin:20px 0 4px"><a href="${esc(button.href)}" style="display:inline-block;background:#3a52e8;color:#ffffff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:10px">${esc(button.label)}</a></p>` : ''}
</td></tr>
${foot ? `<tr><td style="padding:0 24px 20px;font-size:12px;color:#6b6f96">${esc(foot)}</td></tr>` : ''}
</table></td></tr></table></body></html>`
  const text = [heading, '', ...lines.map((l) => (typeof l === 'string' ? l : l.text)), '', button ? `${button.label}: ${button.href}` : '', foot || '']
    .filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n')
  return { html, text }
}

export { esc }
