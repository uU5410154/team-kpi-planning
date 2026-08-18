import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import * as store from './db.js'
import * as jira from './jira.js'

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
 * Write the plan back to a ticket.
 *
 * Guarded by JIRA_ALLOW_WRITES. This edits real tickets under one account's
 * credentials and is reachable by anyone who can open the app, so it stays off
 * until somebody turns it on deliberately in the Render dashboard.
 */
app.put('/api/jira/issue/:key', async (req, res) => {
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

app.put('/api/scenarios/:name', async (req, res) => {
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

app.delete('/api/scenarios/:name', async (req, res) => {
  const r = await store.deleteScenario(cleanName(req.params.name))
  if (r === store.UNAVAILABLE) return unavailable(res)
  res.json(r)
})

/* --------------------------- client -------------------------- */

app.use(express.static(path.join(root, 'dist'), { maxAge: '1h', index: false }))
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))

const port = process.env.PORT || 5000
app.listen(port, async () => {
  console.log(`team-kpi-planning listening on :${port}`)
  const s = await store.status()
  console.log(
    s.connected
      ? `scenario store: ${s.db}.${s.collection}`
      : `scenario store: unavailable (${s.reason}) — clients fall back to browser storage`,
  )
})
