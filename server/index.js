import express from 'express'
import compression from 'compression'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const app = express()

app.use(compression())
app.use(express.json({ limit: '5mb' }))

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'team-kpi-planning' }))

// The client owns all mutable state (localStorage) so the app survives Render's
// ephemeral filesystem. The server only ships the immutable Jira-derived seed.
app.use(express.static(path.join(root, 'dist'), { maxAge: '1h', index: false }))

app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')))

const port = process.env.PORT || 5000
app.listen(port, () => console.log(`team-kpi-planning listening on :${port}`))
