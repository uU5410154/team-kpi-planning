/**
 * A PROJECT'S STATUS, set from the Projects page, the project page and the
 * Timeline: the four choices, what each writes, and who may set it.
 *
 *   node scripts/check-status.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { STATUS_CHOICES, statusChoice, statusPatch, heldInJira } from '../src/lib/projectStatus.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('\n--- the four choices ---')
check('NOT START, IN PROGRESS, ON HOLD, DONE', STATUS_CHOICES.join('|') === 'Not Start|In Progress|On Hold|Done')
check('a project on hold reads On Hold, whatever its status', statusChoice({ status: 'In Progress', onHold: { at: 'x' } }) === 'On Hold')
check('  and so does one on hold in Jira', statusChoice({ status: 'In Progress', jiraStatus: 'On Hold' }) === 'On Hold' && heldInJira({ jiraStatus: 'On Hold' }))
check('Done reads Done; anything "in progress" reads In Progress; the rest Not Start',
  statusChoice({ status: 'Done' }) === 'Done' && statusChoice({ status: 'In Progress' }) === 'In Progress' && statusChoice({ status: 'Not Start' }) === 'Not Start')
const done = statusPatch('Done', 'a@b')
check('CHOOSING A STATUS SETS IT, TAKES IT OFF HOLD AND CLEARS THE WORKBOOK\'S OLD WORDING', done.status === 'Done' && done.onHold === null && done.srcStatus === null)
const hold = statusPatch('On Hold', 'a@b', '2026-11-12T00:00:00Z')
check('ON HOLD IS A FLAG BESIDE THE STATUS, which it leaves alone', !('status' in hold) && hold.onHold.by === 'a@b' && hold.onHold.at === '2026-11-12T00:00:00Z')
check('a word that is not a choice writes nothing', statusPatch('Finished') === null)

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5366
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'status-service-token-'.padEnd(48, '3')
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'team_kpi_planning',
    AUTH_SECRET: 'a-test-secret',
    AUTH_ADMIN_EMAILS: 'boss@lotuss.com',
    KPI_SERVICE_TOKEN: TOKEN,
    JIRA_BASE_URL: '',
    JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', (b) => { if (/Error|error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 300))
}
const call = async (method, path, body, who) => {
  const headers = { 'Content-Type': 'application/json' }
  if (who === 'service') headers.authorization = `Bearer ${TOKEN}`
  else if (who) headers.cookie = who
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}
const signUp = async (email) => {
  await call('POST', '/api/auth/register', { email, password: 'password1' })
  if (email !== 'boss@lotuss.com') await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}
const project = async (key) => (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body.payload.projects.find((p) => p.key === key)

try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  // A workbook wording on James's project, which a choice must clear.
  seed.projects = seed.projects.map((p) => (p.key === 'FNP-379' ? { ...p, srcStatus: 'UAT' } : p))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)

  console.log('\n--- who may set it ---')
  check('a stranger cannot', (await call('PUT', '/api/projects/FNP-379/status', { status: 'Done' })).status === 401)
  const r1 = await call('PUT', '/api/projects/FNP-379/status', { status: 'Done' }, james)
  check('THE PROJECT\'S PIC CAN — a team member, on their own project', r1.status === 200 && r1.body.project?.status === 'Done', `${r1.status} ${r1.body.error || ''}`)
  const p1 = await project('FNP-379')
  check('  and it is in the shared plan, the workbook\'s "UAT" cleared', p1.status === 'Done' && p1.srcStatus === null)
  const r2 = await call('PUT', '/api/projects/FNP-1265/status', { status: 'Done' }, james)
  check('BUT NOT ON SOMEBODY ELSE\'S PROJECT', r2.status === 403 && (await project('FNP-1265')).status !== 'Done', `${r2.status}`)
  const r3 = await call('PUT', '/api/projects/FNP-1265/status', { status: 'On Hold' }, boss)
  const p3 = await project('FNP-1265')
  check('AN ADMINISTRATOR CAN SET ANY PROJECT, e.g. On Hold', r3.status === 200 && p3.onHold?.by === 'boss@lotuss.com')
  check('  which leaves its status as it was, for when it resumes', p3.status === seed.projects.find((p) => p.key === 'FNP-1265').status)
  check('a word that is not a status is refused', (await call('PUT', '/api/projects/FNP-379/status', { status: 'Finished' }, james)).status === 400)
  check('a project that is not in the register is a 404', (await call('PUT', '/api/projects/FNP-999999/status', { status: 'Done' }, boss)).status === 404)
} catch (e) {
  check('the suite crashed', false, e.stack)
} finally {
  server.kill()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall status checks passed')
process.exit(failures ? 1 : 0)
