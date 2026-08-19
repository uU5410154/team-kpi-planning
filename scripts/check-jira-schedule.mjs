/**
 * The sync the server runs on its own, against a real mongod and a stand-in
 * Jira.
 *
 * The button needs somebody with the tab open. This does not, which is the
 * whole point of a schedule — and it writes to the SHARED plan, so what it
 * gets wrong everybody sees.
 *
 * Run with: node scripts/check-jira-schedule.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { readFileSync } from 'node:fs'

let bad = 0
const check = (n, ok, d = '') => { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`) }

const EPICS = [
  { key: 'FNP-900', fields: { summary: 'Already on the register', issuetype: { name: 'Epic' }, status: { name: 'Done', statusCategory: { key: 'done' } }, created: '2026-01-01T09:00:00+0700', duedate: '2026-03-01', resolutiondate: '2026-02-01T09:00:00+0700', customfield_10015: '2026-01-05' } },
  { key: 'FNP-922', fields: { summary: 'Supplier Inquiry Automation', issuetype: { name: 'Epic' }, status: { name: 'Backlog', statusCategory: { key: 'new' } }, created: '2026-05-24T09:00:00+0700', duedate: '2026-06-20', resolutiondate: null, customfield_10015: '2026-05-17' } },
]
const fake = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const jql = String(JSON.parse(body || '{}').jql || '')
    const issues = /issuetype = /.test(jql) ? EPICS : EPICS.filter((e) => jql.includes(e.key))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ issues }))
  })
})
await new Promise((r) => fake.listen(5421, r))

const mongod = await MongoMemoryServer.create()
const uri = mongod.getUri('team_kpi_planning')
const cli = new MongoClient(uri); await cli.connect()
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
await cli.db('team_kpi_planning').collection('kpi_scenarios').insertOne({
  name: 'Baseline',
  payload: {
    people: seed.people,
    projects: [{ ...seed.projects[0], jiraKey: 'FNP-900', actualStart: null, actualEnd: null }],
    settings: {},
    repair: 3,
  },
  updatedAt: new Date().toISOString(),
  updatedBy: 'fixture',
})
await cli.close()

const PORT = 5422
const srv = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: uri,
    JIRA_BASE_URL: 'http://127.0.0.1:5421',
    JIRA_EMAIL: 'gun@example.com',
    JIRA_API_TOKEN: 'tok',
    JIRA_SYNC_ENABLED: 'false',
  },
  stdio: 'ignore',
})
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 400))
}

const r = await (await fetch(`${base}/api/jira/sync`, { method: 'POST' })).json()
console.log('report:', JSON.stringify(r))
check('THE SERVER SYNCS WITHOUT A BROWSER', r.ok === true)
check('  it refreshed the row it already had', r.updated === 1, `${r.updated} updated`)
check('  AND ADDED THE EPIC NOBODY HAD ENTERED', r.added === 1 && r.addedKeys.includes('FNP-922'),
  JSON.stringify(r.addedKeys))
check('  and wrote it to the shared plan', r.wrote === true)

const back = await (await fetch(`${base}/api/scenarios/Baseline`)).json()
const rows = back.payload.projects
const fresh = rows.find((p) => p.jiraKey === 'FNP-922')
check('the new epic is on the register', !!fresh, `${rows.length} rows`)
check('  as WATCH, with no hours', fresh.commitLevel === 'watch' && fresh.savingHours == null)
check('  with Jira\u2019s dates as its plan', fresh.start === '2026-05-17' && fresh.due === '2026-06-20',
  `${fresh.start}..${fresh.due}`)
check('  and at the top of the register', rows[0].jiraKey === 'FNP-922')
const old = rows.find((p) => p.jiraKey === 'FNP-900')
check('the existing row got its actual dates', old.actualStart === '2026-01-05' && old.actualEnd === '2026-02-01',
  `${old.actualStart}..${old.actualEnd}`)
check('AND NOTHING DERIVED WAS WRITTEN INTO THE STORE',
  !('timeline' in old) && !('shares' in old) && !('roi' in old),
  Object.keys(old).filter((k) => ['timeline', 'shares', 'roi', 'fte'].includes(k)).join(', ') || 'clean')

const again = await (await fetch(`${base}/api/jira/sync`, { method: 'POST' })).json()
check('RUNNING IT TWICE CHANGES NOTHING THE SECOND TIME',
  again.updated === 0 && again.added === 0 && again.wrote === false,
  `${again.updated} updated, ${again.added} added, wrote ${again.wrote}`)

const status = await (await fetch(`${base}/api/jira/sync`)).json()
check('and the last run can be read back', status.ok === true && !!status.at, status.at)

srv.kill(); fake.close(); await mongod.stop()
console.log(bad === 0 ? '\nALL CHECKS PASSED' : `\n${bad} FAILED`)
process.exit(bad ? 1 : 0)
