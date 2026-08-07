/**
 * Boots the real Express server against a real mongod and drives the actual
 * HTTP endpoints the browser calls. This is the full path:
 *   fetch -> express route -> db.js -> mongod -> back again.
 *
 * Run with: node scripts/check-api.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('starting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5311
const base = `http://127.0.0.1:${PORT}`

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'team_kpi_planning',
    MONGODB_COLLECTION: 'kpi_scenarios',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', (d) => process.stdout.write(`   [server] ${d}`))
server.stderr.on('data', (d) => process.stderr.write(`   [server:err] ${d}`))

// wait for it to answer
const waitUp = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })
      if (r.ok) return await r.json()
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server never came up')
}

try {
  const health = await waitUp()
  console.log()
  check('GET /api/health reports the store connected', health.store?.connected === true, JSON.stringify(health.store))

  // empty list
  let r = await fetch(`${base}/api/scenarios`)
  check('GET /api/scenarios returns an empty array', r.status === 200 && (await r.json()).length === 0)

  // unknown scenario
  r = await fetch(`${base}/api/scenarios/nothing-here`)
  check('GET unknown scenario is 404', r.status === 404)

  // rejects a bad payload
  r = await fetch(`${base}/api/scenarios/Bad`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: { nope: true } }),
  })
  check('PUT with a malformed payload is 400', r.status === 400, String(r.status))

  // real save
  const payload = { people: seed.people, projects: seed.projects, settings: { targetHours: 3000, savingBasis: 'monthly' } }
  r = await fetch(`${base}/api/scenarios/${encodeURIComponent('Aug review')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, updatedBy: 'Gun' }),
  })
  const saved = await r.json()
  check('PUT saves a scenario', r.status === 200 && saved.name === 'Aug review', JSON.stringify(saved))

  // read back over HTTP
  r = await fetch(`${base}/api/scenarios/${encodeURIComponent('Aug review')}`)
  const doc = await r.json()
  check('GET reads it back', r.status === 200 && doc.payload.projects.length === seed.projects.length,
    `${doc.payload?.projects?.length} projects`)

  const sumIn = seed.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  const sumOut = doc.payload.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  check('saving hours survive the HTTP round trip', Math.abs(sumIn - sumOut) < 1e-9,
    `${sumOut.toFixed(1)} vs ${sumIn.toFixed(1)}`)

  // a name with a space and a slash-free unicode name
  r = await fetch(`${base}/api/scenarios/${encodeURIComponent('บัญชี v2')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, updatedBy: 'ป้อ' }),
  })
  check('PUT handles URL-encoded unicode names', r.status === 200)

  // listing
  r = await fetch(`${base}/api/scenarios`)
  const list = await r.json()
  check('GET lists both, newest first', list.length === 2 && list[0].name === 'บัญชี v2',
    list.map((x) => x.name).join(', '))
  check('listing does not ship the payload', list[0].payload === undefined)

  // delete
  r = await fetch(`${base}/api/scenarios/${encodeURIComponent('บัญชี v2')}`, { method: 'DELETE' })
  check('DELETE removes it', r.status === 200 && (await r.json()).deleted === 1)
  r = await fetch(`${base}/api/scenarios`)
  check('one scenario left', (await r.json()).length === 1)

  // SPA routes still work alongside the API
  r = await fetch(`${base}/projects`)
  check('SPA deep link still served', r.status === 200 && (await r.text()).includes('<div id="root">'))
} finally {
  server.kill()
  await mongod.stop()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
