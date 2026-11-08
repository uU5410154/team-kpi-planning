/**
 * The manager's view of the WORK, end to end (QA pass of 2026-11-07):
 *
 *   - "active" = its dates, OR Jira work under it covering the week, OR an
 *     update sent that week, OR an open decision — with Always/Never on top —
 *     and the Dashboard tiles, "Who holds what" and the project page agree;
 *   - one register key Jira does not know no longer sinks the sync, and is named;
 *   - Jira's errors read as words, never HTML;
 *   - the project page shows what the member wrote, and On hold;
 *   - Follow up asks before it emails;
 *   - the phone dashboard does not scroll sideways;
 *   - "View as" shows that member's own week.
 *
 * Real server, real mongod, a fake Jira and Chrome.  node scripts/check-manager-active.mjs
 */
/* global document, window */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { weekOf, addWeeks } from '../src/lib/weekly.js'
import {
  activeSource, activitySignals, projectCounts, workUnits, lastWeekFromJira, ownerRows, unitSource,
} from '../src/lib/manager.js'
import { jiraError } from '../server/jira.js'
import { plainError } from '../src/lib/api.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ------------------------------------------------------------- pure */

console.log('\n--- active: the dates, or the work ---')
{
  const W = '2026-11-02'
  const old = { key: 'P1', jiraKey: 'FNP-1', start: '2026-01-01', due: '2026-03-01' }
  const sig = (o) => ({ jira: new Set(o.jira || []), updated: new Set(o.updated || []), decisions: new Set(o.decisions || []) })
  check('NOTHING BUT OLD DATES: not active', activeSource(old, W, sig({})) === 'none')
  check('JIRA WORK UNDER IT COVERING THE WEEK MAKES IT ACTIVE', activeSource(old, W, sig({ jira: ['P1'] })) === 'jira')
  check('AN UPDATE SENT THAT WEEK MAKES IT ACTIVE', activeSource(old, W, sig({ updated: ['P1'] })) === 'update')
  check('AN OPEN DECISION MAKES IT ACTIVE', activeSource(old, W, sig({ decisions: ['P1'] })) === 'decision')
  check('  its own dates are said first', activeSource({ ...old, due: '2026-12-01' }, W, sig({ jira: ['P1'] })) === 'dates')
  check('NEVER STILL WINS OVER THE WORK', activeSource({ ...old, active: false }, W, sig({ jira: ['P1'], updated: ['P1'] })) === 'forced-off')
  check('  and Always over nothing', activeSource({ ...old, active: true }, W, sig({})) === 'forced-on')
  check('  next year is never active, whatever the work', activeSource({ ...old, commitLevel: 'nextyear' }, W, sig({ jira: ['P1'] })) === 'none')
  const lines = [{ key: 'A', jiraKey: 'FNP-9' }, { key: 'A#2', jiraKey: 'FNP-9' }, { key: 'B', jiraKey: 'FNP-8' }]
  const s = activitySignals({ projects: lines, jira: { A: [{ key: 'FNP-10' }] }, decisions: [{ projectKey: 'B' }] })
  check('A SIGNAL REACHES EVERY REGISTER LINE ON THE SAME EPIC', s.jira.has('A') && s.jira.has('A#2') && !s.jira.has('B') && s.decisions.has('B'))
  const c = projectCounts(lines, W, s)
  check('  AND THE EPIC COUNTS ONCE', c.total === 2 && c.lines === 3 && c.active === 2 && c.byJira === 1 && c.byDecision === 1, JSON.stringify(c))
  check('  one piece of work per epic', workUnits(lines).map((u) => u.keys.join('+')).join() === 'A+A#2,B')
  check('  a unit is active when any of its lines is', unitSource([{ key: 'x', active: false }, { key: 'y', active: true }], W) === 'forced-on')
  const g = ownerRows({ projects: lines.map((p) => ({ ...p, pic: 'kade' })), people: [{ id: 'kade', nick: 'Kade' }], signals: s, now: { week: W, team: [] } })
  check('WHO HOLDS WHAT LISTS THE EPIC ONCE, saying how many lines', g[0]?.projects.length === 2 && g[0].projects.find((p) => p.key === 'A')?.lines === 2
    && g[0].projects.find((p) => p.key === 'A')?.why === 'jira', JSON.stringify(g[0]?.projects.map((p) => [p.key, p.lines, p.why])))
  const lw = lastWeekFromJira({ P: [
    { key: 'FNP-1', summary: 'Held now, said not done then', done: false, status: 'On Hold', update: { nick: 'J', done: false, hold: false, progress: 'x', reason: 'y' } },
    { key: 'FNP-2', summary: 'Silent, held now', done: false, status: 'On Hold', update: null },
  ] })
  check('LAST WEEK: WHAT THE MEMBER SAID THAT WEEK BEATS TODAY’S STATUS', lw.P[0].hold === false && lw.P[0].done === false && !lw.P[0].statusToday)
  check('  and with nothing said, today’s status is marked as such', lw.P[1].hold === true && lw.P[1].statusToday === true)
}

console.log('\n--- errors, in words ---')
{
  const html = jiraError(503, '<html><body>Service Unavailable</body></html>')
  check('A 503 PAGE OF HTML BECOMES A SENTENCE', !/</.test(html.message) && /not answering/i.test(html.message) && html.statusCode === 503, html.message)
  const bad = jiraError(400, JSON.stringify({ errorMessages: ["An issue with key 'FNP-1446' does not exist for field 'key'."] }))
  check('  Jira’s own message is kept', /FNP-1446' does not exist/.test(bad.message) && !/errorMessages/.test(bad.message), bad.message)
  check('THE PAGE NEVER SHOWS RAW JSON', plainError(new Error('Jira 400: {"errorMessages":["An issue with key \'X-1\' does not exist"]}')) === "Jira 400: An issue with key 'X-1' does not exist")
  check('  nor raw HTML', !/</.test(plainError(new Error('Jira 503: <html><body>down</body></html>'))))
}

/* ------------------------------------------------------------- fake Jira */

const WEEK = weekOf()
const LAST = addWeeks(WEEK, -1)
const day = (w, n) => { const d = new Date(`${w}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const ACC = { james: 'acc-james-0001', kade: 'acc-kade-0002' }
const NAMES = { [ACC.james]: 'Pipat Singhasiri', [ACC.kade]: 'Jarinya Phosri' }
const UNKNOWN = 'FNP-1446'
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
// A James project nothing but Jira work makes active this week.
const byDates = (p) => activeSource(p, WEEK) !== 'none'
const quiet = seed.projects.filter((p) => p.jiraKey && p.jiraKey !== UNKNOWN && !byDates(p) && !p.deleted
  && !['nextyear', 'excluded'].includes(p.commitLevel) && !/hold/i.test(`${p.status} ${p.srcStatus || ''}`) && seed.projects.filter((x) => x.jiraKey === p.jiraKey).length === 1)
const P_JIRA = quiet.find((p) => p.pic === 'kade') || quiet[0]
const P_HOLD = quiet.find((p) => p.key !== P_JIRA.key && p.pic === 'james') || quiet.find((p) => p.key !== P_JIRA.key)
const P_DONE = quiet.find((p) => ![P_JIRA.key, P_HOLD.key].includes(p.key) && p.pic === 'james') || quiet.find((p) => ![P_JIRA.key, P_HOLD.key].includes(p.key))
// And one its owner put on hold in the register, with Jira work this week all the same.
const P_HELD = quiet.find((p) => ![P_JIRA.key, P_HOLD.key, P_DONE.key].includes(p.key) && p.pic)
seed.projects = seed.projects.map((p) => (p.key === P_HELD.key ? { ...p, onHold: { at: '2026-11-01T00:00:00.000Z', by: 'test' } } : p))
const issues = new Map()
const put = (key, f) => issues.set(key, { key, ...f })
for (const p of seed.projects) if (p.jiraKey && p.jiraKey !== UNKNOWN && !issues.has(p.jiraKey)) put(p.jiraKey, { summary: p.summary, type: 'Epic', status: 'In Progress', cat: 'indeterminate' })
put('FNP-7001', { summary: 'Kade’s task this week', assignee: ACC.kade, parent: P_JIRA.jiraKey, start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
put('FNP-7002', { summary: 'Paused piece of work', assignee: ACC.james, parent: P_HOLD.jiraKey, start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
put('FNP-7003', { summary: 'Finished this week', assignee: ACC.james, parent: P_DONE.jiraKey, start: day(LAST, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
put('FNP-7004', { summary: 'Work under a held project', assignee: ACC.kade, parent: P_HELD.jiraKey, start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
let jiraDown = false
const asRaw = (i) => ({
  key: i.key,
  fields: {
    summary: i.summary,
    status: { name: i.status, statusCategory: { key: i.cat } },
    duedate: i.due || null,
    customfield_10015: i.start || null,
    assignee: i.assignee ? { accountId: i.assignee, displayName: NAMES[i.assignee] } : null,
    issuetype: { name: i.type || 'Task' },
    parent: i.parent ? { key: i.parent, fields: { summary: issues.get(i.parent)?.summary || '', status: { name: 'In Progress' } } } : null,
    created: '2026-01-01T00:00:00.000+0700',
    updated: '2026-01-01T00:00:00.000+0700',
    resolutiondate: null,
  },
})
const fake = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const u = new URL(req.url, 'http://x')
    const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { /* none */ }
    if (jiraDown) { res.writeHead(503, { 'Content-Type': 'text/html' }); return res.end('<html><body><h1>503 Service Unavailable</h1></body></html>') }
    if (u.pathname === '/rest/api/3/user/search') {
      const q = (u.searchParams.get('query') || '').toLowerCase()
      const hit = Object.entries(NAMES).find(([, n]) => n.toLowerCase() === q)
      return send(200, hit ? [{ accountId: hit[0], displayName: hit[1], accountType: 'atlassian', active: true }] : [])
    }
    if (u.pathname === '/rest/api/3/search/jql') {
      const jql = body.jql || ''
      const lists = [...jql.matchAll(/(?:key|parent) IN \(([^)]*)\)/g)].map((x) => x[1].split(',').map((s) => s.trim().replace(/"/g, '')))
      const named = lists.flat()
      const bad = named.find((k) => /^[A-Z]+-\d+$/.test(k) && !issues.has(k))
      if (bad) return send(400, { errorMessages: [`An issue with key '${bad}' does not exist for field 'key'.`] })
      const acc = (jql.match(/assignee = "([^"]+)"/) || [])[1]
      const noEpics = /issuetype != /.test(jql)
      const onlyEpics = /issuetype = "/.test(jql)
      const list = [...issues.values()].filter((i) => (acc ? i.assignee === acc : true) && (!noEpics || i.type !== 'Epic') && (!onlyEpics || i.type === 'Epic')
        && (!lists.length || named.includes(i.key) || named.includes(i.parent)))
      return send(200, { issues: list.map(asRaw) })
    }
    if (/\/transitions$/.test(u.pathname)) return send(200, { transitions: [] })
    const k = u.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/)
    if (k) return issues.has(k[1]) ? send(200, asRaw(issues.get(k[1]))) : send(404, { errorMessages: ['Issue does not exist'] })
    return send(404, { errorMessages: [`fake Jira has no ${req.method} ${u.pathname}`] })
  })
})
const JPORT = 5392
await new Promise((r) => fake.listen(JPORT, r))

/* --------------------------------------------------------------- server */

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5391
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'active-service-token-'.padEnd(48, '5')
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
    JIRA_BASE_URL: `http://127.0.0.1:${JPORT}`,
    JIRA_EMAIL: 'app@lotuss.com',
    JIRA_API_TOKEN: 'fake-token',
    JIRA_ALLOW_WRITES: 'false',
    JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log',
    SMTP_USER: 'sender@gmail.com',
    APP_URL: 'https://kpi.example',
    LOTUS_API_KEY: '',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', (b) => { if (/Error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await sleep(300)
}
const db = new MongoClient(mongod.getUri())
await db.connect()
const D = db.db('team_kpi_planning')
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

let browser
try {
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  await signUp('kade@lotuss.com')
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)
  await call('PUT', '/api/auth/users/kade@lotuss.com', { person: 'kade' }, boss)

  console.log('\n--- one key Jira does not know ---')
  const sync = await call('POST', '/api/jira/sync', undefined, boss)
  check('THE SYNC RUNS WITH FNP-1446 ON THE REGISTER', sync.status === 200 && sync.body.ok === true, JSON.stringify(sync.body).slice(0, 200))
  check('  AND NAMES IT', (sync.body.missingInJira || []).includes(UNKNOWN) && /Jira does not know FNP-1446\. Check the key on the Projects page/.test(sync.body.missingNote || ''), sync.body.missingNote)
  const iss = await call('POST', '/api/jira/issues', { keys: [UNKNOWN, P_JIRA.jiraKey] }, boss)
  check('ISSUES: the rest still come back, the unknown one is listed', iss.status === 200 && iss.body.issues?.some((i) => i.key === P_JIRA.jiraKey) && iss.body.skipped?.includes(UNKNOWN))
  const ro = await call('POST', '/api/jira/rollup', { keys: [UNKNOWN, P_JIRA.jiraKey] }, boss)
  check('ROLLUP TOO', ro.status === 200 && ro.body.byParent?.[P_JIRA.jiraKey]?.total === 1 && ro.body.skipped?.includes(UNKNOWN), JSON.stringify(ro.body).slice(0, 160))
  const kids = await call('POST', '/api/jira/children', { keys: [UNKNOWN, P_JIRA.jiraKey] }, boss)
  check('AND THE WORK UNDER AN EPIC', kids.status === 200 && kids.body.byParent?.[P_JIRA.jiraKey]?.length === 1)
  jiraDown = true
  const down = await call('POST', '/api/jira/issues', { keys: ['FNP-9999'] }, boss)
  jiraDown = false
  check('JIRA DOWN: A SENTENCE, NOT ITS HTML', down.status === 502 && !/</.test(down.body.error || '') && /not answering/i.test(down.body.error || ''), down.body.error)
  // The sync rewrote the plan; put the seed back so the rest reads as planned.
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')

  console.log('\n--- what was written, on the project page ---')
  // An old blocker on the task, from last week's report…
  await D.collection('kpi_weekly').insertOne({
    week: LAST,
    person: 'james',
    mode: 'jira',
    focus: '',
    tasks: [{ id: 'jFNP7003', title: 'FNP-7003 Finished this week', projectKey: P_DONE.key, jiraKey: 'FNP-7003', done: false, hold: false, blocker: 'OLD BLOCKER FROM LAST WEEK', progress: 'Started it.', reason: 'OLD BLOCKER FROM LAST WEEK', reportedAt: `${day(LAST, 4)}T09:00:00.000Z`, source: 'jira' }],
    unplanned: [],
    planSubmittedAt: `${day(LAST, 0)}T09:00:00.000Z`,
    reportSubmittedAt: `${day(LAST, 4)}T09:00:00.000Z`,
    updatedAt: `${day(LAST, 4)}T09:00:00.000Z`,
  })
  // …and this week it is done; another task is put on hold.
  const s1 = await call('POST', `/api/weekly/${WEEK}/jira/FNP-7003/update`, { progress: 'Finished and handed over to FP&A.', done: true }, james)
  const s2 = await call('POST', `/api/weekly/${WEEK}/jira/FNP-7002/update`, { progress: 'Paused until the new chart of accounts is signed off.', hold: true, done: false, reason: 'Waiting for the CFO' }, james)
  check('james sends two updates', s1.status === 200 && s2.status === 200, `${JSON.stringify(s1.body).slice(0, 120)} ${JSON.stringify(s2.body).slice(0, 120)}`)
  const bp = (await call('GET', '/api/weekly/projects', undefined, boss)).body.byProject || {}
  const held = (bp[P_HOLD.key]?.history || []).find((t) => t.week === WEEK)
  check('THE WEEKLY STORY CARRIES THE PROGRESS TEXT AND THE HOLD', held?.progress?.startsWith('Paused until') && held.hold === true, JSON.stringify(held))
  check('  "IN THE WAY" COMES FROM THE LATEST UPDATE: the old blocker is gone', !(bp[P_DONE.key]?.blockers || []).some((b) => /OLD BLOCKER/.test(b.blocker)), JSON.stringify(bp[P_DONE.key]?.blockers))
  check('  and a hold is not "in the way"', !(bp[P_HOLD.key]?.blockers || []).length)

  console.log('\n--- view as a member ---')
  const asJames = await call('GET', `/api/weekly/${WEEK}/jira?view=member&as=james`, undefined, boss)
  check('AN ADMINISTRATOR READS JAMES’S OWN JIRA WEEK', asJames.status === 200 && asJames.body.jira === 'on' && asJames.body.tasks?.some((t) => t.key === 'FNP-7002'), JSON.stringify(asJames.body).slice(0, 160))
  const wk = await call('GET', `/api/weekly/${WEEK}?view=member&as=james`, undefined, boss)
  check('  HIS WEEK, NOT WRITABLE BY THE ADMINISTRATOR', wk.body.person === 'james' && wk.body.writable === false && wk.body.team.length === 1)
  check('A MEMBER CANNOT USE IT', (await call('GET', `/api/weekly/${WEEK}/jira?view=member&as=kade`, undefined, james)).body.tasks?.every((t) => t.key !== 'FNP-7001'))
  check('  nor name somebody who is not on the team', (await call('GET', `/api/weekly/${WEEK}?view=member&as=nobody`, undefined, boss)).status === 400)
  check('  AND IT NEVER WRITES: a POST as "james" is the administrator’s own',
    (await call('POST', `/api/weekly/${WEEK}/jira/FNP-7002/update?view=member&as=james`, { progress: 'x', done: true }, boss)).status !== 200)

  /* ------------------------------------------------------------- browser */
  const chrome = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find((p) => p && existsSync(p))
  if (!chrome || !existsSync(new URL('../dist/index.html', import.meta.url))) {
    console.log('\nSKIP  browser checks — no Chrome, or run `npm run build` first')
  } else {
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })
    const as = async (cookie, vp) => {
      const pg = await (await browser.createBrowserContext()).newPage()
      await pg.setViewport(vp)
      const [n, v] = cookie.split('=')
      await pg.setCookie({ name: n, value: v, url: base })
      return pg
    }
    const sect = (pg, l) => pg.evaluate((x) => document.querySelector(`section[aria-label="${x}"]`)?.innerText || '', l)
    const ready = (pg) => pg.waitForFunction(() => {
      const s = document.querySelector('section[aria-label="who holds what"]')
      return s && !s.querySelector('[data-loading]') && /active project/.test(s.innerText)
    }, { timeout: 30000 }).catch(() => {})

    console.log('\n--- the dashboard and the project page agree ---')
    const a = await as(boss, { width: 1440, height: 900 })
    await a.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await ready(a)
    const act = await sect(a, 'Active projects')
    const shown = Number((act.match(/\n(\d+)\n/) || act.match(/(\d+)\s*\n?\s*of \d+/) || [])[1])
    const own = await sect(a, 'who holds what')
    const listed = await a.evaluate(() => document.querySelectorAll('section[aria-label="who holds what"] [data-project]').length)
    const said = Number((own.match(/(\d+) active projects?/) || [])[1])
    check('THE ACTIVE TILE, THE CARD’S COUNT AND ITS ROWS AGREE', shown > 0 && shown === said && said === listed, `tile ${shown} · card ${said} · rows ${listed} — ${act.replace(/\n/g, ' | ')}`)
    check('  THE TILE SAYS WHY: by dates and by Jira work', /by dates/.test(act) && /Jira work this week/.test(act), act.replace(/\n/g, ' | '))
    check('A PROJECT ACTIVE ONLY BY ITS JIRA WORK IS LISTED, and says so',
      await a.evaluate((k) => (document.querySelector(`section[aria-label="who holds what"] [data-project="${k}"]`)?.innerText || '').includes('Jira this week'), P_JIRA.key), P_JIRA.key)
    const upd = await sect(a, 'Updated this week')
    check('UPDATED THIS WEEK COUNTS THE TWO PROJECTS JAMES UPDATED, of the same active total',
      /\n2\n/.test(`\n${upd}\n`) && upd.includes(`of ${shown} active`), upd.replace(/\n/g, ' | '))
    check('THE UNKNOWN KEY IS NAMED ON THE CARD', /Jira does not know FNP-1446/.test(own))

    // Follow up: nothing is sent on the first click.
    const sentBefore = await D.collection('kpi_followups').countDocuments()
    await a.evaluate((k) => document.querySelector(`button[aria-label="follow up ${k}"]`)?.click(), P_JIRA.key)
    await a.waitForSelector('[data-followup-confirm]', { timeout: 5000 }).catch(() => {})
    const conf = await a.evaluate(() => document.querySelector('[data-followup-confirm]')?.innerText || '')
    check('FOLLOW UP ASKS FIRST: who gets it and what it asks', /Email Kade about/i.test(conf) && /this week’s update/.test(conf) && /Send email/.test(conf), conf.replace(/\n/g, ' | '))
    check('  AND NOTHING IS SENT YET', (await D.collection('kpi_followups').countDocuments()) === sentBefore)
    await a.evaluate(() => [...document.querySelectorAll('[data-followup-confirm] button')].find((b) => b.textContent.trim() === 'Cancel')?.click())
    await sleep(300)
    check('  Cancel sends nothing', (await D.collection('kpi_followups').countDocuments()) === sentBefore)
    const heldCell = await a.evaluate((k) => document.querySelector(`[data-followup="${k}"]`)?.innerText || '', P_HELD.key)
    check('A PROJECT ON HOLD OFFERS NO FOLLOW-UP, and says why', /On hold, no update needed/.test(heldCell)
      && !(await a.$(`button[aria-label="follow up ${P_HELD.key}"]`)), `${P_HELD.key}: ${heldCell}`)
    if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/active-dashboard.png` })

    const pill = async (key) => {
      await a.goto(`${base}/#project/${key}`, { waitUntil: 'networkidle0' })
      await a.waitForFunction(() => !!document.querySelector('[data-active-pill]'), { timeout: 15000 }).catch(() => {})
      return a.evaluate(() => ({ on: document.querySelector('[data-active-pill]')?.dataset.activePill, why: document.querySelector('[data-active-pill]')?.dataset.activeWhy, text: document.body.innerText }))
    }
    const pj = await pill(P_JIRA.key)
    check('THE PROJECT PAGE AGREES: active, because of its Jira work', pj.on === 'on' && pj.why === 'jira' && pj.text.includes('has Jira work this week'), JSON.stringify({ on: pj.on, why: pj.why }))
    const ph = await pill(P_HOLD.key)
    check('THE PROJECT PAGE SHOWS WHAT WAS WRITTEN', ph.text.includes('Paused until the new chart of accounts is signed off.'))
    check('  AND ON HOLD AS A PILL, with why', /ON HOLD/i.test(ph.text) && ph.text.includes('Why on hold: Waiting for the CFO') && !/In the way: On hold/.test(ph.text))
    const pd = await pill(P_DONE.key)
    check('  AN OLD WEEK’S BLOCKER IS NOT "IN THE WAY" ONCE THE TASK MOVED ON', !/OLD BLOCKER FROM LAST WEEK\n?\s*—/.test(pd.text) && pd.text.includes('Finished and handed over to FP&A.'))
    if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/active-project.png`, fullPage: true })

    console.log('\n--- a phone ---')
    const p = await as(boss, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await p.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await ready(p)
    const w = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, more: !!document.querySelector('button[aria-label="More"]'), switcher: !!document.querySelector('[data-week-switcher]') }))
    check('THE PHONE DASHBOARD DOES NOT SCROLL SIDEWAYS', w.sw <= w.cw + 1, JSON.stringify(w))
    const moreIn = await p.evaluate(() => { const b = document.querySelector('button[aria-label="More"]')?.getBoundingClientRect(); return !!b && b.right <= window.innerWidth })
    check('  the ⋮ menu and the week switcher are both on screen', moreIn && w.switcher)
    check('  WHO HOLDS WHAT IS A STACK OF CARDS', await p.evaluate(() => !!document.querySelector('[data-owner-cards]') && !document.querySelector('section[aria-label="who holds what"] table')))

    console.log('\n--- view as James ---')
    const v = await as(boss, { width: 1280, height: 900 })
    await v.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await v.evaluate(() => { localStorage.setItem('fa-kpi-view-as', 'member'); localStorage.setItem('fa-kpi-view-as-person', 'james') })
    await v.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await v.reload({ waitUntil: 'networkidle0' })
    // His two tasks are both updated, so they sit under "Already updated": his Jira name and week say it is his.
    await v.waitForFunction(() => /Pipat Singhasiri|FNP-700[23]/.test(document.body.innerText), { timeout: 20000 }).catch(() => {})
    const vt = await v.evaluate(() => document.body.innerText)
    check('VIEW AS: A PERSON PICKER', !!(await v.$('[data-view-as="james"]')) && /Viewing as a team member: James/.test(vt))
    check('  AND JAMES’S OWN JIRA WEEK, not "not linked"', /Pipat Singhasiri|FNP-700[23]/.test(vt) && !/not linked/i.test(vt),
      (vt.match(/.{0,80}not linked.{0,80}/i) || [vt.slice(0, 200)])[0].replace(/\n/g, ' | '))
    check('  read only: nothing to submit', !(await v.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^Send update|^Submit/.test(b.textContent.trim()) && !b.disabled))))
    if (process.env.SHOT_DIR) await v.screenshot({ path: `${process.env.SHOT_DIR}/active-viewas.png` })
  }
} catch (e) {
  failures++
  console.log(`FAIL  the suite crashed — ${e.stack}`)
} finally {
  if (browser) await browser.close()
  server.kill()
  fake.close()
  await db.close()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall manager active checks passed')
process.exit(failures ? 1 : 0)
