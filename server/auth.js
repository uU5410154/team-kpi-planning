import crypto from 'node:crypto'
import { connect, UNAVAILABLE } from './db.js'

/**
 * Who may open this app, and what they are allowed to see.
 *
 * Two roles. An ADMIN sees everything, including this list. A USER sees the
 * five tabs that describe the work — the register, the scorecards, the team,
 * the timeline and the home screen — and not the model behind them.
 *
 * Nobody is let in by registering. An account arrives PENDING and an admin
 * grants it a role, which is the point: an address ending @lotuss.com proves
 * somebody works here, not that they should see the team's appraisal data.
 *
 * ABOUT STORING THE PASSWORD. The admin was asked to be able to read it back,
 * which means it cannot be stored the way passwords normally are — a hash is
 * one-way by design and that is the whole of its value. So each password is
 * kept TWICE:
 *
 *   - as a scrypt hash with its own salt, which is what a login is checked
 *     against. Nothing reversible is ever consulted to let somebody in;
 *   - as an AES-256-GCM ciphertext, which is what the admin screen decrypts.
 *
 * The key for the second one lives in AUTH_SECRET, in the server environment,
 * never in the database. A dump of the collection on its own therefore reveals
 * no passwords. That is a real improvement on storing them in the clear, and
 * it is still weaker than not being able to read them at all: anybody holding
 * both the database and the server's environment holds every password, and
 * people reuse passwords. Worth saying plainly rather than burying.
 */

export const ROLES = ['admin', 'user']
export const STATUSES = ['pending', 'active', 'inactive']

const cfg = () => ({
  domain: (process.env.AUTH_EMAIL_DOMAIN || '@lotuss.com').toLowerCase(),
  collection: process.env.MONGODB_USERS_COLLECTION || 'kpi_users',
  /*
   * The addresses that are admins the moment they register, so there is a way
   * in before there is anybody to approve anybody. Everything else waits.
   */
  bootstrap: String(process.env.AUTH_ADMIN_EMAILS || 'wisarut.gunjarueg@lotuss.com')
    .split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean),
  secret: process.env.AUTH_SECRET || '',
  ttlDays: Number(process.env.AUTH_SESSION_DAYS || 30),
})

/*
 * The key material. Derived from AUTH_SECRET where it is set; where it is not,
 * from a constant, and the server says so loudly on startup — an unset secret
 * means the stored ciphertext is readable by anybody with the code, which is
 * most of the value gone.
 */
let warned = false
const keys = () => {
  const { secret } = cfg()
  if (!secret && !warned) {
    warned = true
    console.warn('[auth] AUTH_SECRET is not set — stored passwords are recoverable by anybody '
      + 'holding this code. Set it in the Render dashboard.')
  }
  const base = secret || 'team-kpi-planning-development-only'
  return {
    enc: crypto.createHash('sha256').update(`${base}:passwords`).digest(),
    mac: crypto.createHash('sha256').update(`${base}:sessions`).digest(),
  }
}

/* ---------------------------------------------------------------- passwords */

const hashOf = (password, salt) =>
  crypto.scryptSync(String(password), salt, 64).toString('hex')

/** What is stored for one password: a one-way hash, and a reversible copy. */
export function seal(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', keys().enc, iv)
  const body = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()])
  return {
    salt,
    hash: hashOf(password, salt),
    // iv:tag:ciphertext, all hex. Self-contained, so rotating a record does
    // not depend on anything stored elsewhere.
    secret: `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${body.toString('hex')}`,
  }
}

/** The password back again, for the admin screen only. */
export function reveal(record) {
  try {
    const [ivHex, tagHex, bodyHex] = String(record?.secret || '').split(':')
    if (!ivHex || !tagHex || !bodyHex) return null
    const d = crypto.createDecipheriv('aes-256-gcm', keys().enc, Buffer.from(ivHex, 'hex'))
    d.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([d.update(Buffer.from(bodyHex, 'hex')), d.final()]).toString('utf8')
  } catch {
    // Written under a different AUTH_SECRET, or tampered with. Not an error to
    // shout about: the account still works, its password just cannot be read.
    return null
  }
}

/** Constant-time, so a wrong password cannot be found a character at a time. */
export function verify(record, password) {
  if (!record?.salt || !record?.hash) return false
  const a = Buffer.from(record.hash, 'hex')
  const b = Buffer.from(hashOf(password, record.salt), 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/* ----------------------------------------------------------------- sessions */

/**
 * A session is the email, an expiry and a signature over both.
 *
 * Signed rather than stored: no session table to grow, and revoking is done by
 * the account's own status, which is checked on every request anyway. Turning
 * somebody off therefore ends their session at once rather than whenever it
 * happened to expire.
 */
export function signSession(email) {
  const until = Date.now() + cfg().ttlDays * 86400000
  const body = Buffer.from(JSON.stringify({ email, until })).toString('base64url')
  const sig = crypto.createHmac('sha256', keys().mac).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function readSession(token) {
  const [body, sig] = String(token || '').split('.')
  if (!body || !sig) return null
  const want = crypto.createHmac('sha256', keys().mac).update(body).digest('base64url')
  // Same length by construction, but compare safely regardless.
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null
  try {
    const { email, until } = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (!email || !until || Date.now() > until) return null
    return { email, until }
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------- store */

let users = null
async function coll() {
  const c = await connect()
  if (!c) return null
  if (users) return users
  users = c.s.db.collection(cfg().collection)
  await users.createIndex({ email: 1 }, { unique: true })
  return users
}

export const cleanEmail = (raw) => String(raw || '').trim().toLowerCase()

/** Whether an address may register at all. */
export function emailAllowed(email) {
  const e = cleanEmail(email)
  const { domain } = cfg()
  // A local part is required: "@lotuss.com" on its own is not an address.
  return e.length > domain.length && e.endsWith(domain) && !/\s/.test(e) && (e.match(/@/g) || []).length === 1
}

export const passwordProblem = (password) => {
  const p = String(password || '')
  if (p.length < 8) return 'A password needs at least 8 characters.'
  if (p.length > 200) return 'That password is too long.'
  return null
}

/** What the browser is told about somebody. Never the hash, never the salt. */
export const publicUser = (u, { withPassword = false } = {}) => (u ? {
  email: u.email,
  role: u.role,
  status: u.status,
  createdAt: u.createdAt,
  approvedAt: u.approvedAt || null,
  approvedBy: u.approvedBy || null,
  lastLoginAt: u.lastLoginAt || null,
  ...(withPassword ? { password: reveal(u) } : {}),
} : null)

export async function register(email, password) {
  const c = await coll()
  if (!c) return UNAVAILABLE
  const e = cleanEmail(email)
  const existing = await c.findOne({ email: e })
  if (existing) return { error: 'That address is already registered.' }

  const boot = cfg().bootstrap.includes(e)
  const doc = {
    email: e,
    ...seal(password),
    /*
     * The bootstrap addresses arrive ready to work. Everybody else waits for
     * one of them, which is the point of the queue.
     */
    role: boot ? 'admin' : 'user',
    status: boot ? 'active' : 'pending',
    createdAt: new Date().toISOString(),
    approvedAt: boot ? new Date().toISOString() : null,
    approvedBy: boot ? 'bootstrap' : null,
  }
  await c.insertOne(doc)
  return { user: publicUser(doc) }
}

export async function login(email, password) {
  const c = await coll()
  if (!c) return UNAVAILABLE
  const u = await c.findOne({ email: cleanEmail(email) })
  // The same answer whether the address is unknown or the password is wrong:
  // one that distinguishes them tells a stranger which addresses exist.
  if (!u || !verify(u, password)) return { error: 'That email and password do not match.' }
  if (u.status === 'pending') return { error: 'This account is waiting for an administrator to approve it.' }
  if (u.status !== 'active') return { error: 'This account has been switched off. Ask an administrator.' }
  await c.updateOne({ email: u.email }, { $set: { lastLoginAt: new Date().toISOString() } })
  return { user: publicUser(u), token: signSession(u.email) }
}

/** The account behind a session, re-read every time so a change lands at once. */
export async function currentUser(token) {
  const s = readSession(token)
  if (!s) return null
  const c = await coll()
  if (!c) return null
  const u = await c.findOne({ email: s.email })
  return u && u.status === 'active' ? publicUser(u) : null
}

export async function listUsers() {
  const c = await coll()
  if (!c) return UNAVAILABLE
  const rows = await c.find({}, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray()
  return rows.map((u) => publicUser(u, { withPassword: true }))
}

export async function updateUser(email, patch, by) {
  const c = await coll()
  if (!c) return UNAVAILABLE
  const e = cleanEmail(email)
  const u = await c.findOne({ email: e })
  if (!u) return { error: 'No such account.' }

  const set = {}
  if (patch.role !== undefined) {
    if (!ROLES.includes(patch.role)) return { error: 'Unknown role.' }
    set.role = patch.role
  }
  if (patch.status !== undefined) {
    if (!STATUSES.includes(patch.status)) return { error: 'Unknown status.' }
    set.status = patch.status
    if (patch.status === 'active' && u.status === 'pending') {
      set.approvedAt = new Date().toISOString()
      set.approvedBy = by || 'admin'
    }
  }
  if (patch.password !== undefined) {
    const bad = passwordProblem(patch.password)
    if (bad) return { error: bad }
    Object.assign(set, seal(patch.password))
  }
  if (!Object.keys(set).length) return { error: 'Nothing to change.' }

  await c.updateOne({ email: e }, { $set: set })
  return { user: publicUser({ ...u, ...set }, { withPassword: true }) }
}

export async function removeUser(email) {
  const c = await coll()
  if (!c) return UNAVAILABLE
  const r = await c.deleteOne({ email: cleanEmail(email) })
  return { deleted: r.deletedCount }
}

/** How many admins can still log in — the guard against locking everybody out. */
export async function activeAdmins() {
  const c = await coll()
  if (!c) return UNAVAILABLE
  return c.countDocuments({ role: 'admin', status: 'active' })
}

export const status = () => ({
  configured: true,
  domain: cfg().domain,
  secretSet: !!cfg().secret,
  bootstrap: cfg().bootstrap,
})
