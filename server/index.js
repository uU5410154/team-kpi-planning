import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import * as store from './db.js'
import * as jira from './jira.js'
import * as auth from './auth.js'
import { runSync, lastRun, startSchedule } from './jiraSync.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// Local dev convenience: load server/.env if present. On Render the values
// come from the dashboard, so this is a no-op there.
try {
  for (const line of readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    const k = t.slice(0, i).trim()
    // Only when the key is genuinely ABSENT. Testing for falsiness let an
    // explicitly empty value be overwritten by the file — a suite that asked
    // for no database got the real cluster instead, and spent eight seconds
    // failing to reach it on every boot.
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim()
  }
} catch { /* no .env — fine */ }

const app = express()
app.use(compression())
app.use(express.json({ limit: '8mb' }))

/* ------------------------- who is asking ------------------------- */

/*
 * Who is asking. Read from a signed cookie and checked against the account
 * itself on every request, so switching somebody off ends their session now
 * rather than whenever it would have expired.
 */
const COOKIE = 'kpi_session'
const readCookie = (req, name) => {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}
const setCookie = (res, token) => {
  const bits = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Number(process.env.AUTH_SESSION_DAYS || 30) * 86400}`,
  ]
  // Render terminates TLS in front of the app, so the cookie is only marked
  // Secure where the request actually arrived over https.
  if (process.env.NODE_ENV === 'production') bits.push('Secure')
  res.setHeader('Set-Cookie', bits.join('; '))
}

/*
 * The person behind a request, or null.
 *
 * Three ways to be somebody: no database at all (a local run, where there are
 * no accounts and nothing shared to protect — the same rule /api/auth/me has
 * always applied), the service token the ops scripts carry, or a session.
 */
const LOCAL_ADMIN = { email: 'local', role: 'admin', status: 'active', local: true }
const whoIs = async (req) => {
  if (!store.isConfigured()) return LOCAL_ADMIN
  return auth.serviceUser(req.headers.authorization) || auth.currentUser(readCookie(req, COOKIE))
}

/*
 * DENY BY DEFAULT.
 *
 * Every /api route needs somebody signed in, except the handful a stranger
 * needs to become somebody — and the health check, which Render calls with no
 * credentials. Until this existed every plan and Jira route was open to the
 * internet: anybody could read every scorecard, overwrite the shared plan, or
 * delete it. Listing what is PUBLIC rather than what is protected means a route
 * added tomorrow is shut until somebody decides otherwise.
 *
 * Which ROLE may do what is then said on the route itself, with `adminOnly`.
 */
const PUBLIC = new Set([
  'GET /api/health',
  'GET /api/auth/config',
  'GET /api/auth/me',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
])
app.use('/api', async (req, res, next) => {
  if (PUBLIC.has(`${req.method} ${req.baseUrl}${req.path}`.replace(/\/$/, ''))) return next()
  try {
    const me = await whoIs(req)
    if (!me) {
      return res.status(401).json({ error: auth.locked() ? auth.LOCKED_MESSAGE : 'Sign in first.' })
    }
    req.me = me
    return next()
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Could not check who is asking.' })
  }
})

/** Writes to the plan, Jira and the account list: administrators only. */
const adminOnly = (req, res, next) => (req.me?.role === 'admin'
  ? next()
  : res.status(403).json({ error: 'Administrators only.' }))

/* ---------------------------- api ---------------------------- */

app.get('/api/health', async (_req, res) => {
  res.json({ ok: true, service: 'team-kpi-planning', store: await store.status(), jira: jira.status() })
})

/* ---------------------------- jira ---------------------------- */

app.get('/api/jira/status', (_req, res) => res.json({
  ...jira.status(),
  // Whether this server will WRITE, which the page needs to know before it
  // offers somebody a date field that cannot save.
  writable: String(process.env.JIRA_ALLOW_WRITES || '').toLowerCase() === 'true',
}))

/*
 * Issues BY KEY, and by nothing else.
 *
 * The client sends the keys its own register holds; it cannot send JQL. That
 * is deliberate: this endpoint is open to anybody who can open the app, and a
 * query parameter would make it a general-purpose window onto Jira running
 * under one account's credentials.
 */
app.post('/api/jira/issues', async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : []
  if (keys.length > 400) {
    return res.status(400).json({ error: 'Too many keys in one request (max 400).' })
  }
  try {
    const r = await jira.issuesByKey(keys)
    if (r === jira.UNAVAILABLE) {
      return res.status(503).json({
        error: 'Jira is not configured on this server. Set JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN.',
      })
    }
    return res.json(r)
  } catch (e) {
    // Jira's own words, so a wrong token reads as a wrong token rather than as
    // the app being broken.
    return res.status(502).json({ error: e.message || 'Jira request failed.' })
  }
})

/*
 * Run the whole sync on the server, against the shared plan.
 *
 * The same merge the button uses, but it does not need a browser open — which
 * is what makes a schedule worth having.
 */
app.post('/api/jira/sync', adminOnly, async (_req, res) => {
  try {
    const r = await runSync({ trigger: 'manual' })
    return res.status(r.ok ? 200 : 400).json(r)
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message || 'Sync failed.' })
  }
})

/** What the last sync did, whoever or whatever started it. */
app.get('/api/jira/sync', (_req, res) => res.json(lastRun() || { at: null, ok: null }))

/** Every epic in the Jira project, so the app can spot the ones it lacks. */
app.get('/api/jira/epics', async (req, res) => {
  try {
    const r = await jira.epics({ since: req.query.since })
    if (r === jira.UNAVAILABLE) {
      return res.status(503).json({ error: 'Jira is not configured on this server.' })
    }
    return res.json(r)
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Jira request failed.' })
  }
})

/** What the tasks under each epic add up to: latest date, and whether all done. */
app.post('/api/jira/rollup', async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : []
  if (keys.length > 400) {
    return res.status(400).json({ error: 'Too many parents in one request (max 400).' })
  }
  try {
    const r = await jira.rollupOf(keys)
    if (r === jira.UNAVAILABLE) {
      return res.status(503).json({ error: 'Jira is not configured on this server.' })
    }
    return res.json(r)
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Jira request failed.' })
  }
})

/*
 * Write the plan back to a ticket.
 *
 * Guarded by JIRA_ALLOW_WRITES. This edits real tickets under one account's
 * credentials and is reachable by anyone who can open the app, so it stays off
 * until somebody turns it on deliberately in the Render dashboard.
 */
app.put('/api/jira/issue/:key', adminOnly, async (req, res) => {
  if (String(process.env.JIRA_ALLOW_WRITES || '').toLowerCase() !== 'true') {
    return res.status(403).json({
      error: 'Writing to Jira is switched off. Set JIRA_ALLOW_WRITES=true on the server to enable it.',
    })
  }
  const patch = {}
  if ('start' in (req.body || {})) patch.start = req.body.start
  if ('due' in (req.body || {})) patch.due = req.body.due
  try {
    const r = await jira.updateIssue(req.params.key, patch)
    if (r === jira.UNAVAILABLE) {
      return res.status(503).json({ error: 'Jira is not configured on this server.' })
    }
    return res.json(r)
  } catch (e) {
    return res.status(e.statusCode === 400 ? 400 : 502).json({ error: e.message || 'Jira rejected the change.' })
  }
})

/** The work under an epic, or the epics under an initiative. One level. */
app.post('/api/jira/children', async (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? req.body.keys : []
  if (keys.length > 40) {
    return res.status(400).json({ error: 'Too many parents in one request (max 40).' })
  }
  try {
    const r = await jira.childrenOf(keys)
    if (r === jira.UNAVAILABLE) {
      return res.status(503).json({ error: 'Jira is not configured on this server.' })
    }
    return res.json(r)
  } catch (e) {
    return res.status(502).json({ error: e.message || 'Jira request failed.' })
  }
})

const unavailable = (res) =>
  res.status(503).json({ error: 'Scenario store unavailable — your work is still saved in this browser.' })

const cleanName = (n) => String(n || '').trim().slice(0, 80)

app.get('/api/scenarios', async (_req, res) => {
  const rows = await store.listScenarios()
  if (rows === store.UNAVAILABLE) return unavailable(res)
  res.json(rows)
})

app.get('/api/scenarios/:name', async (req, res) => {
  const doc = await store.getScenario(cleanName(req.params.name))
  if (doc === store.UNAVAILABLE) return unavailable(res)
  // null here genuinely means "no scenario by that name", not an outage
  if (!doc) return res.status(404).json({ error: 'No scenario by that name.' })
  res.json(doc)
})

// The whole plan, replaced. A team member reads it (the Overall team page and
// the Timeline are built from it) but changes reach it through an administrator.
app.put('/api/scenarios/:name', adminOnly, async (req, res) => {
  const name = cleanName(req.params.name)
  if (!name) return res.status(400).json({ error: 'A scenario name is required.' })
  const { payload, updatedBy } = req.body || {}
  if (!payload || !Array.isArray(payload.projects) || !Array.isArray(payload.people)) {
    return res.status(400).json({ error: 'Payload must contain projects and people arrays.' })
  }
  const saved = await store.saveScenario(name, payload, updatedBy)
  if (saved === store.UNAVAILABLE) return unavailable(res)
  res.json(saved)
})

/*
 * THE HOME SCREEN, ON ITS OWN.
 *
 * The Apps page is not the register. It has nothing to do with saving hours or
 * commitments, and it was being held hostage by the rules that protect them: a
 * browser only saves the plan once it has linked to the database this session,
 * and it now stands down entirely when it is behind — both correct for the
 * register, and both meant the home screen never left the machine it was
 * arranged on, three attempts running.
 *
 * So it reads and writes through here instead. A read-modify-write of ONE
 * field on the server: it cannot overwrite anybody's register, cannot lose a
 * project, and does not care whether the browser is up to date on anything
 * else. Arranging icons is not an edit that needs protecting from itself.
 */
app.get('/api/scenarios/:name/apps', async (req, res) => {
  const doc = await store.getScenario(cleanName(req.params.name))
  if (doc === store.UNAVAILABLE) return unavailable(res)
  return res.json({ apps: Array.isArray(doc?.payload?.apps) ? doc.payload.apps : [] })
})

app.put('/api/scenarios/:name/apps', async (req, res) => {
  const name = cleanName(req.params.name)
  if (!name) return res.status(400).json({ error: 'A scenario name is required.' })
  const { apps } = req.body || {}
  if (!Array.isArray(apps)) return res.status(400).json({ error: 'apps must be an array.' })
  // A home screen is small by construction. A cap so a bug in the browser
  // cannot post a megabyte of icons into the plan every keystroke.
  if (JSON.stringify(apps).length > 2_000_000) {
    return res.status(413).json({ error: 'That home screen is too large to store.' })
  }
  const doc = await store.getScenario(name)
  if (doc === store.UNAVAILABLE) return unavailable(res)
  if (!doc?.payload) return res.status(404).json({ error: `No scenario "${name}".` })
  const saved = await store.saveScenario(name, { ...doc.payload, apps }, 'home screen')
  if (saved === store.UNAVAILABLE) return unavailable(res)
  return res.json({ ...saved, apps: apps.length })
})

app.delete('/api/scenarios/:name', adminOnly, async (req, res) => {
  const r = await store.deleteScenario(cleanName(req.params.name))
  if (r === store.UNAVAILABLE) return unavailable(res)
  res.json(r)
})

/* ----------------------------- accounts ----------------------------- */

app.get('/api/auth/config', (_req, res) => res.json({
  ...auth.status(),
  // Whether accounts can work at all: without a database there is nowhere to
  // keep them, and the app says so rather than failing at the login box.
  store: store.isConfigured(),
}))

app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body || {}
  if (!auth.emailAllowed(email)) {
    return res.status(400).json({ error: `Use your work address — it has to end ${auth.status().domain}.` })
  }
  const bad = auth.passwordProblem(password)
  if (bad) return res.status(400).json({ error: bad })
  if (auth.locked()) return res.status(503).json({ error: auth.LOCKED_MESSAGE })
  const r = await auth.register(email, password)
  if (r === store.UNAVAILABLE) return unavailable(res)
  if (r.error) return res.status(409).json({ error: r.error })
  return res.json({
    user: r.user,
    // Said here rather than left to be discovered at the login box.
    message: r.user.status === 'active'
      ? 'Account created. You can sign in now.'
      : 'Account created. An administrator has to approve it before you can sign in.',
  })
})

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {}
  if (auth.locked()) return res.status(503).json({ error: auth.LOCKED_MESSAGE })
  const r = await auth.login(email, password)
  if (r === store.UNAVAILABLE) return unavailable(res)
  if (r.error) return res.status(401).json({ error: r.error })
  setCookie(res, r.token)
  return res.json({ user: r.user })
})

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
  res.json({ ok: true })
})

app.get('/api/auth/me', async (req, res) => {
  /*
   * NO ACCOUNT STORE, NO LOCK.
   *
   * Accounts live in the same database as the plan. Without one there is
   * nowhere to keep them, nothing shared to protect — the register is this
   * browser's own local copy — and no way for anybody to ever be approved. A
   * sign-in page there would be a door with no key, in front of an empty room.
   *
   * So the app opens, as it did before there were accounts at all, and says
   * which mode it is in rather than pretending. On Render, where MONGODB_URI
   * is set, this branch never runs.
   */
  // whoIs answers the local admin itself when there is no store.
  return res.json({ user: await whoIs(req) })
})

app.get('/api/auth/users', adminOnly, async (_req, res) => {
  const rows = await auth.listUsers()
  if (rows === store.UNAVAILABLE) return unavailable(res)
  return res.json({ users: rows })
})

app.put('/api/auth/users/:email', adminOnly, async (req, res) => {
  const { me } = req
  const email = auth.cleanEmail(req.params.email)
  const patch = req.body || {}

  /*
   * THE LAST ADMIN CANNOT LOCK THE DOOR BEHIND THEMSELVES.
   *
   * Demoting or switching off the only active administrator would leave an app
   * nobody can administer and no way back in except the server's environment.
   * Refused, with the reason, rather than done and regretted.
   */
  const losing = patch.role === 'user' || (patch.status && patch.status !== 'active')
  if (losing) {
    const admins = await auth.activeAdmins()
    if (admins === store.UNAVAILABLE) return unavailable(res)
    const rows = await auth.listUsers()
    const target = rows === store.UNAVAILABLE ? null : rows.find((u) => u.email === email)
    if (target && target.role === 'admin' && target.status === 'active' && admins <= 1) {
      return res.status(409).json({ error: 'This is the only administrator who can still sign in. Grant somebody else the role first.' })
    }
  }

  const r = await auth.updateUser(email, patch, me.email)
  if (r === store.UNAVAILABLE) return unavailable(res)
  if (r.error) return res.status(400).json({ error: r.error })
  return res.json(r)
})

app.delete('/api/auth/users/:email', adminOnly, async (req, res) => {
  const { me } = req
  const email = auth.cleanEmail(req.params.email)
  if (email === me.email) return res.status(409).json({ error: 'You cannot delete your own account.' })
  const r = await auth.removeUser(email)
  if (r === store.UNAVAILABLE) return unavailable(res)
  return res.json(r)
})

// An /api address that matches no route is an error, not the app's HTML page
// with a 200 — which is what a typo in a script used to get back and parse.
app.all('/api/*', (_req, res) => res.status(404).json({ error: 'No such API route.' }))

/* --------------------------- client -------------------------- */

app.use(express.static(path.join(root, 'dist'), { maxAge: '1h', index: false }))
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))

const port = process.env.PORT || 5000
app.listen(port, async () => {
  console.log(`team-kpi-planning listening on :${port}`)
  if (store.isConfigured() && auth.locked()) {
    console.error(`[auth] ${auth.LOCKED_MESSAGE} Nobody can sign in until it is.`)
  }
  const s = await store.status()
  console.log(
    s.connected
      ? `scenario store: ${s.db}.${s.collection}`
      : `scenario store: unavailable (${s.reason}) — clients fall back to browser storage`,
  )
  // Armed after the port is open, so a slow Jira cannot delay the app coming
  // up. Silent when Jira is not configured — there would be nothing to sync.
  if (jira.status().configured) startSchedule()
})
