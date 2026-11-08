/* global document */
/**
 * WHILE DATA LOADS, A SPINNER — NOT AN EMPTY PAGE.
 *
 * Drives the built app in a real browser with chosen API calls held back, and
 * checks that each page shows its spinner ([data-loading]) while it waits,
 * never the "nothing here" text that only a loaded-but-empty answer may show,
 * and that the spinner is gone once the data is in.
 *
 * Run after `npm run build`: node scripts/check-loading.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((p) => p && existsSync(p))
if (!chrome || !existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.log('SKIP — no Chrome, or run `npm run build` first')
  process.exit(0)
}

const mongod = await MongoMemoryServer.create()
const PORT = 5383
const base = `http://127.0.0.1:${PORT}`
const SERVICE = `Bearer ${'loading-service-token-'.padEnd(48, '5')}`
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
    KPI_SERVICE_TOKEN: SERVICE.slice(7),
    JIRA_BASE_URL: '',
    JIRA_SYNC_ENABLED: 'false',
    LOTUS_API_KEY: '',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 400))
}
const call = async (method, path, body, who) => {
  const headers = { 'Content-Type': 'application/json' }
  if (who === 'service') headers.authorization = SERVICE
  else if (who) headers.cookie = who
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}
const signUp = async (email, password = 'password1') => {
  await call('POST', '/api/auth/register', { email, password })
  if (email !== 'boss@lotuss.com') await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password })).cookie
}

let browser
try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com', 'bosspass1')
  const james = await signUp('james@lotuss.com')
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)
  // Jira is off here, so stand in for it: the week comes back as a Jira week.
  const jiraOn = (week) => ({ jira: 'on', writable: false, account: 'James', week, tasks: [], overdue: [], undated: [] })

  browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })

  /*
   * A page whose matching requests are held for `ms` before they go through —
   * or answered with a stand-in body once held.
   */
  const open = async (cookie, rules) => {
    const pg = await (await browser.createBrowserContext()).newPage()
    await pg.setViewport({ width: 1440, height: 900 })
    const [n, v] = cookie.split('=')
    await pg.setCookie({ name: n, value: v, url: base })
    await pg.setRequestInterception(true)
    pg.on('request', (req) => {
      const path = new URL(req.url()).pathname
      const rule = rules.find((r) => r.match.test(path))
      if (!rule) { req.continue(); return }
      setTimeout(() => {
        if (rule.body) req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(rule.body(path)) })
        else req.continue()
      }, rule.ms)
    })
    return pg
  }
  const spinners = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-loading]')]
    .filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.innerText.trim()))
  const text = (pg) => pg.evaluate(() => document.body.innerText)
  const waitText = (pg, s, timeout = 10000) => pg.waitForFunction((x) => document.body.innerText.includes(x), { timeout }, s).then(() => true).catch(() => false)
  const waitNoSpinner = (pg, timeout = 10000) => pg.waitForFunction(
    () => ![...document.querySelectorAll('[data-loading]')].some((el) => el.getBoundingClientRect().height > 0),
    { timeout },
  ).then(() => true).catch(() => false)

  console.log('\n--- the Weekly page ---')
  {
    const pg = await open(james, [
      { match: /^\/api\/weekly\/current$/, ms: 1500 },
      { match: /^\/api\/weekly\/\d{4}-\d{2}-\d{2}\/jira$/, ms: 2000, body: (p) => jiraOn(p.split('/')[3]) },
    ])
    await pg.goto(`${base}/#weekly`, { waitUntil: 'domcontentloaded' })
    const sawWeek = await waitText(pg, 'Loading your week')
    check('WHILE THE WEEK LOADS, A SPINNER SAYS SO', sawWeek && (await spinners(pg)).some((s) => s.includes('Loading your week')),
      JSON.stringify(await spinners(pg)))
    check('  and no week is drawn yet', !(await text(pg)).includes('My week'))
    const sawJira = await waitText(pg, 'Reading your Jira tasks')
    check('WHILE JIRA IS ASKED, A SPINNER SAYS SO', sawJira, JSON.stringify(await spinners(pg)))
    const t = await text(pg)
    check('  NOT THE MONDAY FORM THAT JIRA WOULD THEN REPLACE', !t.includes('This week I\'m focused on') && !t.includes('Submit plan'),
      t.slice(0, 300).replace(/\n/g, ' | '))
    check('  and the next step waits too', !t.includes('Send your plan for the week'))
    const gone = await waitNoSpinner(pg)
    check('ONCE IT IS IN, THE SPINNERS ARE GONE', gone, JSON.stringify(await spinners(pg)))
    check('  and the week is there', (await text(pg)).includes('My week'))
    await pg.close()
  }

  console.log('\n--- the project page ---')
  {
    const pg = await open(boss, [{ match: /^\/api\/weekly\/projects$/, ms: 2000 }])
    await pg.goto(`${base}/#project/FNP-88`, { waitUntil: 'domcontentloaded' })
    const saw = await waitText(pg, 'Loading check-ins')
    check('WHILE THE CHECK-INS LOAD, A SPINNER SAYS SO', saw && (await spinners(pg)).some((s) => s.includes('Loading check-ins')),
      JSON.stringify(await spinners(pg)))
    const t = await text(pg)
    check('  NOT "NOBODY HAS REPORTED"', !t.includes('Nobody has reported on this project'))
    check('  NOR "none yet" for the latest update', !/Latest weekly update\s*none yet/.test(t))
    const gone = await waitNoSpinner(pg)
    check('ONCE THEY ARE IN, THE SPINNERS ARE GONE', gone, JSON.stringify(await spinners(pg)))
    check('  and the empty answer may show now', (await text(pg)).includes('Nobody has reported on this project'))
    await pg.close()
  }

  console.log('\n--- the dashboard ---')
  {
    const pg = await open(boss, [{ match: /^\/api\/decisions$/, ms: 2500 }])
    await pg.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
    const saw = await waitText(pg, 'Loading decisions')
    check('WHILE THE DECISIONS LOAD, THE CARD SPINS', saw, JSON.stringify(await spinners(pg)))
    check('  NOT "No date changes or decisions are waiting"', !(await text(pg)).includes('No date changes or decisions are waiting'))
    const ok = await waitText(pg, 'No date changes or decisions are waiting')
    check('ONCE THEY ARE IN, THE EMPTY ANSWER SHOWS', ok)
    check('  and that card no longer spins', !(await spinners(pg)).some((s) => s.includes('Loading decisions')))
    await pg.close()
  }
} catch (e) {
  check('unexpected error', false, e.stack || e.message)
} finally {
  await browser?.close()
  server.kill()
  await mongod.stop()
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED')
process.exit(failures ? 1 : 0)
