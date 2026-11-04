/**
 * The weekly emails: when each one goes, to whom, and that none goes twice.
 *
 * The schedule is pure and checked at fixed Bangkok instants. Then the real
 * server runs against a real mongod with MAIL_TRANSPORT=log — every email is
 * built and logged exactly as it would be sent, and nothing leaves the
 * machine — and a reminder pass is run at chosen moments. Finally the Access
 * tab is opened in a browser.
 *
 *   node scripts/check-mail.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { slotsAt, emailsAt } from '../server/reminders.js'
import { weekOf, deadlines } from '../src/lib/weekly.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
// A Bangkok wall-clock time as an instant.
const BKK = (iso) => Date.parse(`${iso}+07:00`)
const kinds = (ms) => slotsAt(ms).map((s) => `${s.kind}:${s.stage}`).join(',')

/* ------------------------------------------------------------ the clock */

console.log('\n--- when each email goes (week of Mon 2 Nov 2026) ---')
check('Monday 06:59 — nothing', kinds(BKK('2026-11-02T06:59')) === '')
check('MONDAY 07:00 — THE HEADS-UP FOR THE PLAN', kinds(BKK('2026-11-02T07:00')) === 'headsup:plan')
check('MONDAY 08:00 — THE FIRST REMINDER, ON THE DEADLINE', kinds(BKK('2026-11-02T08:00')) === 'reminder:plan')
check('Monday 15:30 — still reminding, every hour', kinds(BKK('2026-11-02T15:30')) === 'reminder:plan')
check('MONDAY 23:00 — THE LAST REMINDER AND THE LIST OF WHO IS MISSING',
  kinds(BKK('2026-11-02T23:00')) === 'reminder:plan,digest:plan')
check('Tuesday — nothing (the schedule is three days a week)', kinds(BKK('2026-11-03T10:00')) === '')
check('FRIDAY 10:00 — THE HEADS-UP FOR THE REPORT', kinds(BKK('2026-11-06T10:00')) === 'headsup:report')
check('Friday 14:59 — nothing yet', kinds(BKK('2026-11-06T14:59')) === '')
check('FRIDAY 15:00 — REMINDERS BEGIN', kinds(BKK('2026-11-06T15:00')) === 'reminder:report')
check('Saturday — nothing', kinds(BKK('2026-11-07T12:00')) === '')
check('SUNDAY 15:00 — THE SECOND CHANCE', kinds(BKK('2026-11-08T15:00')) === 'reminder:report'
  && slotsAt(BKK('2026-11-08T15:00'))[0].second === true)
check('  about the week that began the Monday before, not the next one', slotsAt(BKK('2026-11-08T23:00'))[0].week === '2026-11-02')

console.log('\n--- who each one goes to ---')
const ctx = {
  submitters: ['james', 'kade', 'pol'],
  entries: { james: { planSubmittedAt: '2026-11-02T00:30:00Z' } },
  accounts: [
    { email: 'james@lotuss.com', role: 'user', status: 'active', person: 'james' },
    { email: 'kade@lotuss.com', role: 'user', status: 'active', person: 'kade' },
    { email: 'old@lotuss.com', role: 'user', status: 'inactive', person: null },
    { email: 'boss@lotuss.com', role: 'admin', status: 'active', person: 'gun' },
  ],
  nick: { james: 'James', kade: 'Kade', pol: 'Pol' },
  escalation: null,
}
const at9 = emailsAt(BKK('2026-11-02T09:00'), ctx)
check('A REMINDER GOES ONLY TO WHOEVER HAS NOT SENT', at9.length === 1 && at9[0].to === 'kade@lotuss.com', at9.map((e) => e.to).join(','))
check('  nobody is emailed who has no account linked — Pol has none', !at9.some((e) => /pol/i.test(String(e.to))))
check('  it says when it was due and that it repeats', /due at 08:00/.test(at9[0].text) && /every hour until 23:00/.test(at9[0].text))
check('  and links to the page', /\/#weekly/.test(at9[0].text))
const at10 = emailsAt(BKK('2026-11-02T10:00'), ctx)
check('EACH HOUR’S REMINDER HAS ITS OWN NAME — so the next hour is not taken for a repeat', at10[0].id !== at9[0].id)
check('  and the same hour’s, the same name — so it cannot go twice', emailsAt(BKK('2026-11-02T09:59'), ctx)[0].id === at9[0].id)
const digest = emailsAt(BKK('2026-11-02T23:00'), ctx).find((e) => e.kind === 'digest')
check('THE 23:00 LIST NAMES EVERYBODY MISSING', digest && /Kade/.test(digest.text) && /Pol/.test(digest.text) && !/James/.test(digest.text))
check('  and says who could not be reminded', /Pol — no account linked/.test(digest.text))
check('  and goes to the administrators while nobody has set a list', JSON.stringify(digest.to) === '["boss@lotuss.com"]')
const digest2 = emailsAt(BKK('2026-11-02T23:00'), { ...ctx, escalation: ['head@example.com'] }).find((e) => e.kind === 'digest')
check('  OR TO THE LIST, ONCE THERE IS ONE — any address', JSON.stringify(digest2.to) === '["head@example.com"]')
check('NOBODY MISSING, NO 23:00 EMAIL',
  !emailsAt(BKK('2026-11-02T23:00'), { ...ctx, submitters: ['james'] }).some((e) => e.kind === 'digest'))
const sun = emailsAt(BKK('2026-11-08T16:00'), ctx)
check('Sunday’s reminder says it is the second chance and the week locks tomorrow',
  sun.every((e) => /Second chance/.test(e.subject) && /locks at 08:00 tomorrow/.test(e.text)))
check('the HTML part is escaped — a nickname cannot inject markup',
  !emailsAt(BKK('2026-11-02T23:00'), { ...ctx, nick: { ...ctx.nick, pol: '<script>x</script>' } })
    .find((e) => e.kind === 'digest').html.includes('<script>'))

/* --------------------------------------------------------------- server */

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5363
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'mail-service-token-'.padEnd(48, '9')
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
    SMTP_USER: 'sender@gmail.com',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', (b) => { if (/Error|error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 300))
}
const db = new MongoClient(mongod.getUri())
await db.connect()
const logged = (prefix) => db.db('team_kpi_planning').collection('kpi_mail_log')
  .find({ _id: { $regex: `^${prefix}` } }).toArray()
const waitFor = async (prefix, n = 1) => {
  for (let i = 0; i < 40; i++) {
    const rows = await logged(prefix)
    // Finished, not merely begun: the body is stored once it has gone.
    if (rows.length >= n && rows.every((r) => r.status !== 'sending')) return rows
    await new Promise((r) => setTimeout(r, 150))
  }
  return logged(prefix)
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

let browser
try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  await signUp('kade@lotuss.com')
  await call('PUT', '/api/auth/users/boss@lotuss.com', { person: 'gun' }, boss)
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)
  await call('PUT', '/api/auth/users/kade@lotuss.com', { person: 'kade' }, boss)
  const WEEK = weekOf()
  const d = deadlines(WEEK)
  const iso = (ms) => new Date(ms).toISOString()
  await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'x', tasks: [{ title: 'A', expected: '2026-12-01', effort: 1, priority: 'must' }], submit: 'plan',
  }, james)

  console.log('\n--- the reminders, against the real server ---')
  const st = await call('GET', '/api/weekly/mail', undefined, boss)
  check('the Access tab can see email is set up, and as whom — never the password',
    st.body.status?.configured === true && !JSON.stringify(st.body).includes('SMTP_PASSWORD'))
  check('A MEMBER CANNOT SEE THE MAIL LOG', (await call('GET', '/api/weekly/mail', undefined, james)).status === 403)
  check('  or run the reminders', (await call('POST', '/api/weekly/reminders/run', {}, james)).status === 403)

  const run = (at) => call('POST', '/api/weekly/reminders/run', { at: iso(at) }, boss)
  const r1 = await run(d.planDue + 3600_000)
  check('MONDAY 09:00: REMINDERS GO OUT', r1.status === 200 && r1.body.sent > 0, JSON.stringify(r1.body).slice(0, 200))
  const mondayRows = await logged(`remind:plan:${WEEK}:`)
  check('  to Kade, who has not sent a plan', mondayRows.some((m) => m.to.includes('kade@lotuss.com')))
  check('  NOT TO JAMES, WHO HAS', !mondayRows.some((m) => m.to.includes('james@lotuss.com')))
  check('  and the email itself is right', mondayRows.find((m) => m.to.includes('kade@lotuss.com'))?.body?.includes('due at 08:00'))
  const r2 = await run(d.planDue + 3600_000 + 20 * 60_000)
  check('THE SAME HOUR AGAIN SENDS NOTHING — a restart or a second server cannot double it', r2.body.sent === 0
    && (await logged(`remind:plan:${WEEK}:`)).length === mondayRows.length, JSON.stringify(r2.body.results?.map((x) => x.result)))
  const r3 = await run(d.planDue + 2 * 3600_000)
  check('the next hour sends the next one', r3.body.sent === mondayRows.length)

  await call('PUT', '/api/weekly/settings', { remindersOn: false }, boss)
  check('PAUSED, NOTHING GOES', (await run(d.planDue + 3 * 3600_000)).body.skipped === 'reminders are paused')
  await call('PUT', '/api/weekly/settings', { remindersOn: true }, boss)

  check('a bad address is refused for the 23:00 list',
    (await call('PUT', '/api/weekly/settings', { escalation: ['not-an-address'] }, boss)).status === 400)
  check('a member cannot change it', (await call('PUT', '/api/weekly/settings', { escalation: ['x@y.com'] }, james)).status === 403)
  await call('PUT', '/api/weekly/settings', { escalation: ['head.of.fa@example.com'] }, boss)
  check('A MEMBER DOES NOT SEE THE LIST', (await call('GET', '/api/weekly/settings', undefined, james)).body.escalation === undefined)
  check('  an administrator does', (await call('GET', '/api/weekly/settings', undefined, boss)).body.escalation?.[0] === 'head.of.fa@example.com')
  await run(d.planDue + 15 * 3600_000)
  const dig = await logged(`digest:plan:${WEEK}`)
  check('23:00: THE LIST OF WHO IS MISSING GOES TO THE ESCALATION LIST', dig.length === 1
    && JSON.stringify(dig[0].to) === '["head.of.fa@example.com"]' && /Kade/.test(dig[0].body), JSON.stringify(dig[0]?.to))
  check('  naming those it could not remind', /no account linked/.test(dig[0]?.body || ''))

  console.log('\n--- as things happen ---')
  await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'x',
    tasks: [{
      id: 'mailslip', title: 'Vendor mapping', projectKey: 'FNP-88', expected: '2026-11-06', effort: 1, priority: 'must',
      done: false, pct: 30, blocker: 'AP has not sent the file', blockerCategory: 'business', newDate: '2026-06-01', affects: true,
    }],
    submit: 'report',
  }, james)
  const prop = await waitFor('proposal:')
  check('A NEW PROPOSAL IS EMAILED TO THE ADMINISTRATORS', prop.length === 1 && JSON.stringify(prop[0].to) === '["boss@lotuss.com"]',
    JSON.stringify(prop.map((p) => p.to)))
  check('  saying who, which project and why', /James asks to move FNP-88/.test(prop[0]?.subject || '') && /AP has not sent the file/.test(prop[0]?.body || ''))
  const pid = (await call('GET', '/api/weekly/proposals', undefined, boss)).body.proposals[0].id
  await call('POST', `/api/weekly/proposals/${pid}/reject`, { reason: 'Chase AP first.' }, boss)
  const dec = await waitFor('decision:')
  check('A DECISION IS EMAILED TO THE MEMBER WHO ASKED', dec.length === 1 && JSON.stringify(dec[0].to) === '["james@lotuss.com"]')
  check('  with the reason', /Chase AP first/.test(dec[0]?.body || ''))

  await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'x',
    tasks: [{
      id: 'gunslip', title: 'Board pack', projectKey: 'FNP-328', expected: '2026-11-06', effort: 1, priority: 'must',
      done: false, pct: 30, blocker: 'Waiting on finance', blockerCategory: 'business', newDate: '2027-06-01', affects: true,
    }],
    submit: 'report',
  }, boss)
  await new Promise((r) => setTimeout(r, 1200))
  check('AN ADMINISTRATOR’S OWN PROPOSAL DOES NOT EMAIL THEM ABOUT IT', (await logged('proposal:')).length === 1)

  const t = await call('POST', '/api/weekly/mail/test', {}, boss)
  check('A TEST EMAIL GOES TO WHOEVER ASKED', t.status === 200 && t.body.to === 'boss@lotuss.com'
    && (await logged('test:boss@lotuss.com')).length === 1)

  /* ------------------------------------------------------------- browser */
  const chrome = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find((p) => p && existsSync(p))
  if (!chrome) {
    console.log('\nSKIP  browser checks — no Chrome found')
  } else if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
    console.log('\nSKIP  browser checks — run `npm run build` first')
  } else {
    console.log('\n--- the Access tab ---')
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })
    const a = await browser.newPage()
    await a.setViewport({ width: 1440, height: 900 })
    const [n, v] = boss.split('=')
    await a.setCookie({ name: n, value: v, url: base })
    await a.goto(`${base}/#users`, { waitUntil: 'networkidle0' })
    await a.waitForFunction(() => document.body.innerText.includes('Sent lately'), { timeout: 15000 }).catch(() => {})
    const text = await a.evaluate(() => document.body.innerText)
    check('THE ACCESS TAB SHOWS THE EMAILS SECTION', text.includes('Weekly check-in: emails') && text.includes('Sending as'))
    check('  with the escalation list', text.includes('head.of.fa@example.com'))
    check('  and what went out', /Reminder: your weekly plan is not in yet/.test(text) && /Date change: James asks/.test(text))
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Send me a test email'))?.click())
    await a.waitForFunction(() => document.body.innerText.includes('Sent to boss@lotuss.com'), { timeout: 8000 }).catch(() => {})
    check('“SEND ME A TEST EMAIL” WORKS FROM THE PAGE', (await a.evaluate(() => document.body.innerText)).includes('Sent to boss@lotuss.com'))
    if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/mail-access.png`, fullPage: true })
  }
} catch (e) {
  failures++
  console.log(`FAIL  the suite crashed — ${e.stack}`)
} finally {
  if (browser) await browser.close()
  server.kill()
  await db.close()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall mail checks passed')
process.exit(failures ? 1 : 0)
