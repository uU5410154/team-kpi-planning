/**
 * The manager dashboard: active projects, who holds what, follow-ups, the
 * project page, and the card layout every administrator shares.
 *
 * Runs the real server against a real mongod, with email written to the mail
 * log instead of sent, and drives the built app in Chrome.
 *
 *   node scripts/check-manager.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { weekOf, addWeeks } from '../src/lib/weekly.js'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'
import {
  projectCounts, updatedCount, ownerRows, slipping, workload, blockersByType, submissionTrend,
  activeInWeek, activeSource, activeUnits, workUnits,
} from '../src/lib/manager.js'
import { cleanLayout } from '../server/manager.js'
import { DEFAULT_LAYOUT, EXTRA_CARDS } from '../src/dashboard/layout.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('\n--- active, by the dates ---')
{
  const W = '2026-11-02' // Monday of week 45
  const src = (p) => activeSource(p, W)
  check('DATES COVERING THE WEEK MAKE A PROJECT ACTIVE', src({ start: '2026-10-01', due: '2026-12-01' }) === 'dates')
  check('  a start on the Sunday counts; one the next Monday does not',
    src({ start: '2026-11-08', due: '2026-12-01' }) === 'dates' && src({ start: '2026-11-09', due: '2026-12-01' }) === 'none')
  check('  a due date on the Monday counts; the Sunday before does not',
    src({ start: '2026-10-01', due: '2026-11-02' }) === 'dates' && src({ start: '2026-10-01', due: '2026-11-01' }) === 'none')
  check('  a single date counts in its own week', src({ due: '2026-11-05' }) === 'dates' && src({ start: '2026-11-04' }) === 'dates')
  check('  a project that finished before the week is not active',
    src({ start: '2026-10-01', due: '2026-12-01', actualEnd: '2026-10-20' }) === 'none'
    && src({ start: '2026-10-01', due: '2026-12-01', status: 'Done' }) === 'none')
  check('  work now landing later (adjusted due) keeps it active', src({ start: '2026-10-01', due: '2026-10-20', adjustedDue: '2026-11-03' }) === 'dates')
  check('  no dates, not active', src({}) === 'none' && activeInWeek({}, W) === false)
  check('AN ADMINISTRATOR’S OVERRIDE WINS EITHER WAY',
    src({ active: true }) === 'forced-on' && activeInWeek({ active: true }, W)
    && src({ active: false, start: '2026-10-01', due: '2026-12-01' }) === 'forced-off'
    && !activeInWeek({ active: false, start: '2026-10-01', due: '2026-12-01' }, W))
  check('  next year and excluded are never active',
    !activeInWeek({ commitLevel: 'nextyear', start: '2026-10-01', due: '2026-12-01' }, W)
    && !activeInWeek({ commitLevel: 'excluded', active: true }, W))
}

console.log('\n--- the layout, cleaned ---')
{
  const c = cleanLayout([
    { type: 'owners', x: 0, y: 0, w: 12, h: 14 },
    { type: 'owners', x: 3, y: 3, w: 3, h: 3 },
    { type: '<script>', x: 0, y: 0, w: 1, h: 1 },
    { type: 'active', x: 99, y: -4, w: 40, h: 1 },
  ])
  check('ONE OF EACH CARD, junk dropped, sizes kept on the grid',
    c.length === 2 && c[0].w === 12 && c[1].x === 11 && c[1].y === 0 && c[1].w === 12 && c[1].h === 2, JSON.stringify(c))
  check('not a list, not a layout', cleanLayout('nope') === null)
  check('EVERY CARD IN THE DEFAULT LAYOUT FITS THE TWELVE COLUMNS', DEFAULT_LAYOUT.every((it) => it.x + it.w <= 12))
  check('  and the default survives cleaning unchanged', JSON.stringify(cleanLayout(DEFAULT_LAYOUT)) === JSON.stringify(DEFAULT_LAYOUT))
  check('THE FOUR EXTRA CARDS ARE OFFERED, not on by default',
    EXTRA_CARDS.length === 4 && EXTRA_CARDS.every((t) => !DEFAULT_LAYOUT.some((it) => it.type === t)))
}

/* --------------------------------------------------------------- server */

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5366
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'manager-service-token-'.padEnd(48, '6')
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'team_kpi_planning',
    AUTH_SECRET: 'a-test-secret',
    AUTH_ADMIN_EMAILS: 'boss@lotuss.com,deputy@lotuss.com',
    KPI_SERVICE_TOKEN: TOKEN,
    JIRA_BASE_URL: '',
    JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log',
    SMTP_USER: 'sender@gmail.com',
    APP_URL: 'https://kpi.example',
    LOTUS_API_KEY: '',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', (b) => { if (/Error|error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await sleep(300)
}
const db = new MongoClient(mongod.getUri())
await db.connect()
const mails = () => db.db('team_kpi_planning').collection('kpi_mail_log')
const waitMail = async (prefix) => {
  for (let i = 0; i < 40; i++) {
    const m = await mails().findOne({ _id: { $regex: `^${prefix}` }, status: 'sent' })
    if (m) return m
    await sleep(150)
  }
  return null
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
  if (!['boss@lotuss.com', 'deputy@lotuss.com'].includes(email)) await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}

let browser
let m
// Each account in a browser of its own, as each person has: one shared
// profile would share local storage, and one account's copy of the plan would
// overwrite another's.
const as = async (cookie, vp) => {
  const pg = await (await browser.createBrowserContext()).newPage()
  await pg.setViewport(vp)
  const [n, v] = cookie.split('=')
  await pg.setCookie({ name: n, value: v, url: base })
  return pg
}
const text = (pg) => pg.evaluate(() => document.body.innerText)
try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  const ACTIVE = ['FNP-379', 'FNP-877', 'FNP-267', 'ROW-9']
  seed.projects = seed.projects.map((p) => (ACTIVE.includes(p.key) ? { ...p, active: true } : p))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const deputy = await signUp('deputy@lotuss.com')
  const james = await signUp('james@lotuss.com')
  await call('PUT', '/api/auth/users/boss@lotuss.com', { person: 'gun' }, boss)
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)
  const WEEK = weekOf()
  const LAST = addWeeks(WEEK, -1)

  // Last week, James reported on FNP-379: not finished, blocked.
  await db.db('team_kpi_planning').collection('kpi_weekly').insertOne({
    week: LAST,
    person: 'james',
    focus: 'Forecast model',
    tasks: [{
      id: 'tlast1', title: 'Build the forecast model', projectKey: 'FNP-379', done: false, pct: 60, blocker: 'Waiting on IT for the data feed',
      blockerCategory: 'it', newDate: '2026-12-20', affects: true, expected: LAST, effort: 3, priority: 'must',
      progress: 'Built the driver tree for three regions; the fourth waits on the feed.',
    }],
    unplanned: [],
    planSubmittedAt: new Date(Date.parse(`${LAST}T00:00:00Z`)).toISOString(),
    reportSubmittedAt: new Date(Date.parse(`${LAST}T08:00:00Z`) + 4 * 86400_000).toISOString(),
    updatedAt: new Date().toISOString(),
  })
  // This week, a plan with a task on FNP-379.
  const saved = await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'Forecast, then budget data',
    tasks: [{ title: 'Validate the forecast with FP&A', projectKey: 'FNP-379', expected: addWeeks(WEEK, 0), effort: 2, priority: 'must' }],
  }, james)
  check('a member saves their week', saved.status === 200, JSON.stringify(saved.body).slice(0, 120))

  console.log('\n--- what the cards say ---')
  {
    const now = (await call('GET', `/api/weekly/${WEEK}`, undefined, boss)).body
    const prev = (await call('GET', `/api/weekly/${LAST}`, undefined, boss)).body
    const plan = computePlan({ meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS })
    const counts = projectCounts(plan.projects, WEEK)
    const activeNow = plan.projects.filter((p) => !p.deleted && activeInWeek(p, WEEK))
    // Counted per piece of work: register lines on one epic count once (FNP-1151 is three).
    check('ACTIVE: THE FOUR SWITCHED ON, plus those whose dates cover this week, of every project in the register',
      counts.forced === 4 && counts.active === activeUnits(plan.projects, WEEK).length && counts.active === counts.forced + counts.byDates
      && counts.total === workUnits(plan.projects).length && counts.lines === plan.projects.filter((p) => !p.deleted).length, JSON.stringify(counts))
    const up = updatedCount(plan.projects, now)
    check('UPDATED THIS WEEK: one of the active has a task on it', up.updated === 1 && up.active === activeNow.length, JSON.stringify(up))
    const groups = ownerRows({ projects: plan.projects, people: plan.assignees, now, prev })
    const jg = groups.find((g) => g.person === 'james')
    const f379 = jg?.projects.find((p) => p.key === 'FNP-379')
    const jamesActive = activeNow.filter((p) => p.pic === 'james').map((p) => p.key).sort()
    check('WHO HOLDS WHAT: James holds FNP-379 and FNP-877, and whatever else of his is active',
      jg?.projects.map((p) => p.key).sort().join() === jamesActive.join() && jamesActive.includes('FNP-379') && jamesActive.includes('FNP-877'),
      jg?.projects.map((p) => p.key).join())
    check('  last week’s task, and that it did not finish',
      f379?.lastWeek[0]?.title === 'Build the forecast model' && f379.lastWeek[0].done === false && f379.lastWeek[0].pct === 60)
    check('  this week’s task', f379?.thisWeek[0]?.title === 'Validate the forecast with FP&A')
    check('  and when it was last updated', !!f379?.latest)
    check('  a project with no owner is listed under "No owner", last',
      groups[groups.length - 1].person === null && groups[groups.length - 1].projects.some((p) => p.key === 'ROW-9'))
    const blockers = blockersByType(prev)
    check('BLOCKERS BY TYPE: last week’s IT blocker', blockers.it?.[0]?.blocker === 'Waiting on IT for the data feed')
    const slip = slipping({ projects: plan.projects, asOf: '2026-11-05', weeks: [now, prev], pending: [] })
    check('SLIPPING: FNP-379 lands after its due (31 Aug), and is past due',
      slip.find((s) => s.key === 'FNP-379')?.why.map((w) => w.kind).sort().join() === 'lands,pastDue', JSON.stringify(slip.find((s) => s.key === 'FNP-379')))
    const wl = workload({ projects: plan.projects, people: plan.people, week: now })
    check('WORKLOAD: James planned 2 days, and holds his active projects',
      wl.find((r) => r.person === 'james')?.days === 2 && wl.find((r) => r.person === 'james')?.active === jamesActive.length)
    const tr = submissionTrend([now, prev])
    check('SUBMISSION TREND: oldest week first, James on time last week',
      tr.weeks[0] === LAST && tr.people.find((p) => p.person === 'james')?.weeks[LAST]?.report === 'ontime')
  }

  console.log('\n--- the shared layout ---')
  check('nobody has arranged it yet: the default', (await call('GET', '/api/dashboard/layout', undefined, boss)).body.items === null)
  check('A MEMBER CANNOT READ IT', (await call('GET', '/api/dashboard/layout', undefined, james)).status === 403)
  check('  NOR SAVE ONE', (await call('PUT', '/api/dashboard/layout', { items: [] }, james)).status === 403)
  check('a layout is a list', (await call('PUT', '/api/dashboard/layout', { items: 'x' }, boss)).status === 400)
  await call('PUT', '/api/dashboard/layout', { items: [{ type: 'owners', x: 0, y: 0, w: 12, h: 10 }, { type: 'blockers', x: 0, y: 10, w: 6, h: 8 }] }, boss)
  const seen = (await call('GET', '/api/dashboard/layout', undefined, deputy)).body
  check('ONE ADMINISTRATOR SAVES IT, ANOTHER SEES IT', seen.items?.map((i) => i.type).join() === 'owners,blockers' && seen.updatedBy === 'boss@lotuss.com')
  await call('DELETE', '/api/dashboard/layout', undefined, deputy)
  check('and back to the default', (await call('GET', '/api/dashboard/layout', undefined, boss)).body.items === null)

  console.log('\n--- follow-ups ---')
  check('A MEMBER CANNOT FOLLOW UP', (await call('POST', '/api/followups', { projectKey: 'FNP-877' }, james)).status === 403)
  const noOwner = await call('POST', '/api/followups', { projectKey: 'ROW-9' }, boss)
  check('a project with no owner: nobody to ask, and it says so', noOwner.status === 409 && /no owner/.test(noOwner.body.error), noOwner.body.error)
  const noAccount = await call('POST', '/api/followups', { projectKey: 'FNP-267' }, boss)
  check('AN OWNER WITH NO ACCOUNT: told to link one on the Access tab', noAccount.status === 409 && /Access tab/.test(noAccount.body.error), noAccount.body.error)
  const fu = await call('POST', '/api/followups', { projectKey: 'FNP-877' }, boss)
  check('FOLLOW UP FNP-877: sent to its owner', fu.status === 200 && fu.body.followup?.person === 'james' && fu.body.followup.status === 'sent', JSON.stringify(fu.body).slice(0, 160))
  const m1 = await waitMail('followup:')
  check('  THE EMAIL GOES TO JAMES, with a link to his week on that project',
    JSON.stringify(m1?.to) === '["james@lotuss.com"]' && (m1?.body || '').includes('https://kpi.example/#weekly/FNP-877'), m1 && JSON.stringify(m1.to))
  check('  and names the project in the subject', /FNP-877/.test(m1?.subject || ''))
  check('ASKING AGAIN AT ONCE IS A DOUBLE CLICK, not a second email', (await call('POST', '/api/followups', { projectKey: 'FNP-877' }, boss)).status === 429)
  const list = (await call('GET', '/api/followups?week=current', undefined, boss)).body.followups || []
  check('the follow-up is listed, waiting', list.length === 1 && list[0].status === 'sent')

  /* ------------------------------------------------------------- browser */
  const chrome = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find((p) => p && existsSync(p))
  if (!chrome || !existsSync(new URL('../dist/index.html', import.meta.url))) {
    console.log('\nSKIP  browser checks — no Chrome, or run `npm run build` first')
    // The answer, without a browser: James saves a task on the project.
    await call('PUT', `/api/weekly/${WEEK}/mine`, {
      focus: 'Forecast, then budget data',
      tasks: [
        { title: 'Validate the forecast with FP&A', projectKey: 'FNP-379', expected: WEEK, effort: 2, priority: 'must' },
        { title: 'Load the budget data', projectKey: 'FNP-877', expected: WEEK, effort: 1, priority: 'should' },
      ],
    }, james)
  } else {
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })

    console.log('\n--- the member answers from the email link ---')
    m = await as(james, { width: 1280, height: 900 })
    await m.goto(`${base}/#weekly/FNP-877`, { waitUntil: 'networkidle0' })
    await m.waitForFunction(() => document.body.innerText.includes('Your manager asked for an update'), { timeout: 15000 }).catch(() => {})
    check('THE LINK OPENS THEIR WEEK, SAYING WHAT WAS ASKED', (await text(m)).includes('Your manager asked for an update on FNP-877'))
    const added = await m.evaluate(() => !!document.querySelector('[data-task-project="FNP-877"]'))
    check('  WITH A TASK READY ON THAT PROJECT', added)
    check('  and the address no longer repeats it on reload', await m.evaluate(() => window.location.hash === '#weekly'))
    // Fill in the new task's title and save.
    await m.evaluate(() => {
      const box = document.querySelector('[data-task-project="FNP-877"]')
      const input = [...box.querySelectorAll('input, textarea')].find((i) => !i.value && i.type !== 'hidden' && !i.readOnly)
      input?.focus()
    })
    await m.keyboard.type('Load the budget data')
    await m.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save draft')?.click())
    await m.waitForFunction(() => document.body.innerText.includes('Saved.'), { timeout: 10000 }).catch(() => {})
    check('  the member saves', (await text(m)).includes('Saved.'))
  }

  const done = await waitMail('followup-done:')
  check('SAVING ANSWERS THE FOLLOW-UP — the administrator is emailed',
    JSON.stringify(done?.to) === '"boss@lotuss.com"' || JSON.stringify(done?.to) === '["boss@lotuss.com"]', done && JSON.stringify(done.to))
  check('  WITH A LINK TO THE PROJECT PAGE', (done?.body || '').includes('https://kpi.example/#project/FNP-877'))
  check('  and the task in it', /Load the budget data/.test(done?.body || ''))
  const after = (await call('GET', '/api/followups?week=current', undefined, boss)).body.followups || []
  check('the follow-up now reads updated', after[0]?.status === 'updated' && !!after[0].updatedAt)

  if (browser) {
    console.log('\n--- the dashboard ---')
    const a = await as(boss, { width: 1440, height: 900 })
    await a.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await a.waitForFunction(() => document.querySelector('section[aria-label="who holds what"]')?.innerText.includes('Load the budget data'), { timeout: 15000 }).catch(() => {})
    const sect = (pg, l) => pg.evaluate((x) => document.querySelector(`section[aria-label="${x}"]`)?.innerText || '', l)
    // Per piece of work, as the tiles count: register lines on one epic once.
    const total = workUnits(seed.projects).length
    const nActive = activeUnits(seed.projects, WEEK).length
    const act = await sect(a, 'Active projects')
    check(`ACTIVE PROJECTS: ${nActive} (4 switched on, the rest by their dates), of every project in the register`,
      new RegExp(`\\b${nActive}\\b`).test(act) && act.includes(`of ${total}`) && act.includes('4 switched on'), act.replace(/\n/g, ' | '))
    const upd = await sect(a, 'Updated this week')
    check(`UPDATED THIS WEEK: 2 of ${nActive}`, /\b2\b/.test(upd) && upd.includes(`of ${nActive} active`), upd.replace(/\n/g, ' | '))
    // No card is left blank: each says something under its title.
    const blank = await a.evaluate(() => [...document.querySelectorAll('[data-card]')]
      .filter((c) => c.innerText.trim().split('\n').filter((l) => l.trim()).length < 2).map((c) => c.getAttribute('data-card')))
    check('NO CARD IS LEFT BLANK', blank.length === 0, blank.join(','))
    const sum = await sect(a, 'the week, summarised')
    check('  the summary card says why there is no summary', /not switched on/i.test(sum), sum.replace(/\n/g, ' | '))
    const own = await sect(a, 'who holds what')
    check('WHO HOLDS WHAT: by owner, last week and this week',
      own.includes('James') && own.includes('PL Forecast') && own.includes('Build the forecast model') && /Not done, 60%/i.test(own)
      && own.includes('Validate the forecast with FP&A'), own.slice(0, 400).replace(/\n/g, ' | '))
    check('  EACH TASK SHOWS WHAT THE MEMBER WROTE ABOUT IT, NOT JUST ITS NAME', own.includes('Built the driver tree for three regions')
      && /In the way: Waiting on IT/.test(own), own.slice(0, 500).replace(/\n/g, ' | '))
    check('  THE ANSWERED FOLLOW-UP SAYS SO', /UPDATED .*AGO|UPDATED JUST NOW/i.test(own))
    check('  a project with no owner cannot be followed up', own.includes('No owner to ask'))
    // The week switcher in the page header: any week, and straight back.
    const shownWeek = () => a.evaluate(() => document.querySelector('[data-week-shown]')?.getAttribute('data-week-shown'))
    check('THE DASHBOARD HEADER HAS A WEEK SWITCHER, ON THIS WEEK', (await shownWeek()) === WEEK, String(await shownWeek()))
    await a.click('[aria-label="previous week"]')
    await a.waitForFunction(() => /Week before/i.test(document.querySelector('section[aria-label="who holds what"]')?.innerText || ''), { timeout: 10000 }).catch(() => {})
    const back = await sect(a, 'who holds what')
    check('  A WEEK BACK: the dashboard is about that week and the one before', (await shownWeek()) === addWeeks(WEEK, -1)
      && /Week before/i.test(back) && !/This week \(W\d+\)/i.test(back), back.slice(0, 200).replace(/\n/g, ' | '))
    await a.click('[data-week-today]')
    await a.waitForFunction(() => /This week \(W\d+\)/i.test(document.querySelector('section[aria-label="who holds what"]')?.innerText || ''), { timeout: 10000 }).catch(() => {})
    check('  "This week" brings it back', (await shownWeek()) === WEEK && /This week \(W\d+\)/i.test(await sect(a, 'who holds what')))
    // Kade has no account: the button says why.

    for (const width of [390, 768]) {
      const n = await as(boss, { width, height: 860 })
      await n.goto(`${base}/`, { waitUntil: 'networkidle0' })
      await sleep(700)
      const r = await n.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sw2: !!document.querySelector('[data-week-switcher]') }))
      check(`  @${width}px the switcher fits, with no sideways scroll`, r.sw2 && r.sw <= r.cw + 1, JSON.stringify(r))
      await n.browserContext().close()
    }
    // Follow up asks first; the answer comes once "Send email" is pressed.
    await a.evaluate(() => document.querySelector('button[aria-label="follow up FNP-267"]')?.click())
    await a.waitForSelector('[data-followup-send]', { timeout: 5000 }).catch(() => {})
    await a.evaluate(() => document.querySelector('[data-followup-send]')?.click())
    await a.waitForFunction(() => document.body.innerText.includes('Link one on the Access tab'), { timeout: 8000 }).catch(() => {})
    check('FOLLOW UP SAYS WHY IT CANNOT', (await text(a)).includes('Link one on the Access tab'))
    await a.evaluate(() => [...document.querySelectorAll('section[aria-label="who holds what"] button')].find((b) => b.textContent.trim() === 'Not updated')?.click())
    await sleep(300)
    const stale = await sect(a, 'who holds what')
    check('"NOT UPDATED" LEAVES ONLY THE PROJECTS WITHOUT A TASK THIS WEEK', !stale.includes('PL Forecast') && stale.includes('Supplier Portal'))
    if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/manager-dashboard.png` })

    console.log('\n--- the project page ---')
    await a.evaluate(() => [...document.querySelectorAll('section[aria-label="who holds what"] button')].find((b) => b.textContent.trim() === 'All')?.click())
    await sleep(200)
    await a.evaluate(() => [...document.querySelectorAll('section[aria-label="who holds what"] button')].find((b) => b.textContent.trim() === 'PL Forecast')?.click())
    // "Week by week" is drawn while the check-ins load (with a spinner): wait for them.
    await a.waitForFunction(() => document.body.innerText.includes('Week by week')
      && !document.querySelector('section[aria-label="week by week"] [data-loading]'), { timeout: 10000 }).catch(() => {})
    const pt = await text(a)
    check('A PROJECT’S NAME OPENS ITS PAGE', a.url().endsWith('#project/FNP-379') && pt.includes('PL Forecast'), a.url())
    check('  owner, due date and hours', pt.includes('Owner') && pt.includes('31 Aug 2026') && pt.includes('Saving hours a month'))
    check('  WHAT IS IN THE WAY', pt.includes('Waiting on IT for the data feed'), pt.slice(pt.indexOf('PL Forecast'), pt.indexOf('PL Forecast') + 900).replace(/\n/g, ' | '))
    check('  AND EVERY WEEK’S TASKS', pt.includes('Build the forecast model') && pt.includes('Validate the forecast with FP&A'))
    if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/project-page.png` })
    await a.goBack({ waitUntil: 'networkidle0' })
    await a.waitForFunction(() => !!document.querySelector('section[aria-label="who holds what"]'), { timeout: 10000 }).catch(() => {})
    check('  Back returns to the dashboard', !!(await a.$('section[aria-label="who holds what"]')))

    console.log('\n--- arranging the dashboard ---')
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit layout')?.click())
    await sleep(300)
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add card')?.click())
    await sleep(300)
    await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent.trim() === 'Slipping projects')?.click())
    await sleep(400)
    check('A CARD IS ADDED', !!(await a.$('[data-card="slipping"]')))
    await a.evaluate(() => document.querySelector('button[aria-label="remove Concentration risk"]')?.click())
    await sleep(300)
    check('A CARD IS REMOVED', !(await a.$('[data-card="concentration"]')))
    // Drag the "Updated this week" card to the far left of its row, by its bar.
    const before = await a.evaluate(() => {
      const r = document.querySelector('[data-card="updated"]').getBoundingClientRect()
      return { x: r.x, y: r.y }
    })
    const bar = await a.evaluate(() => {
      const r = document.querySelector('[data-card="updated"] .dash-drag').getBoundingClientRect()
      return { x: r.x + 10, y: r.y + r.height / 2 }
    })
    await a.mouse.move(bar.x, bar.y)
    await a.mouse.down()
    for (let i = 1; i <= 12; i++) { await a.mouse.move(bar.x - i * 60, bar.y + i * 2); await sleep(16) }
    await a.mouse.up()
    await sleep(500)
    const movedTo = await a.evaluate(() => {
      const r = document.querySelector('[data-card="updated"]').getBoundingClientRect()
      return { x: r.x, y: r.y }
    })
    check('A CARD IS DRAGGED BY ITS TITLE BAR', Math.abs(movedTo.x - before.x) > 100 || Math.abs(movedTo.y - before.y) > 100,
      `${JSON.stringify(before)} → ${JSON.stringify(movedTo)}`)
    // Resize "Waiting for your decision" from its corner.
    const h0 = await a.evaluate(() => document.querySelector('[data-card="decisions"]').getBoundingClientRect().height)
    const corner = await a.evaluate(() => {
      const r = document.querySelector('[data-card="decisions"] .react-resizable-handle').getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
    await a.mouse.move(corner.x, corner.y)
    await a.mouse.down()
    for (let i = 1; i <= 10; i++) { await a.mouse.move(corner.x, corner.y + i * 15); await sleep(16) }
    await a.mouse.up()
    await sleep(500)
    const h1 = await a.evaluate(() => document.querySelector('[data-card="decisions"]').getBoundingClientRect().height)
    check('A CARD IS RESIZED FROM ITS CORNER', h1 > h0 + 60, `${Math.round(h0)} → ${Math.round(h1)}`)
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save layout')?.click())
    await a.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Edit layout'), { timeout: 8000 }).catch(() => {})
    const lay = (await call('GET', '/api/dashboard/layout', undefined, deputy)).body
    const types = (lay.items || []).map((i) => i.type)
    check('SAVED — FOR EVERY ADMINISTRATOR', types.includes('slipping') && !types.includes('concentration'), types.join())
    check('  with the new size and place', (lay.items || []).find((i) => i.type === 'decisions')?.h > 4)
    const planMark = async () => (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body.updatedAt
    const markBefore = await planMark()
    const d = await as(deputy, { width: 1440, height: 900 })
    await d.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await d.waitForFunction(() => !!document.querySelector('[data-card="slipping"]'), { timeout: 10000 }).catch(() => {})
    check('ANOTHER ADMINISTRATOR OPENS THE SAME DASHBOARD', !!(await d.$('[data-card="slipping"]')) && !(await d.$('[data-card="concentration"]')))
    const slip = await sect(d, 'slipping projects')
    check('  and the slipping card says why', slip.includes('PL Forecast') && /past due/i.test(slip), slip.slice(0, 200).replace(/\n/g, ' | '))
    if (process.env.SHOT_DIR) await d.screenshot({ path: `${process.env.SHOT_DIR}/manager-arranged.png`, fullPage: false })
    await sleep(5000)
    check('OPENING THE DASHBOARD WRITES NOTHING TO THE PLAN', (await planMark()) === markBefore)

    console.log('\n--- the Timeline switch ---')
    // Back to the first tab: a tab left behind another does not paint, and
    // a click waits for it to.
    await a.bringToFront()
    await a.goto(`${base}/#timeline`, { waitUntil: 'networkidle0' })
    const ctl = (k) => `[aria-label="active ${k}"]`
    await a.waitForFunction((sel) => !!document.querySelector(sel), { timeout: 15000 }, ctl('FNP-935')).catch(() => {})
    check('EACH PROJECT ROW HAS AN ACTIVE CONTROL', !!(await a.$(ctl('FNP-935'))))
    check('  FNP-379 reads as switched on by an administrator',
      await a.evaluate((sel) => { const b = document.querySelector(sel); return b?.dataset.active === 'on' && b.dataset.activeMode === 'on' }, ctl('FNP-379')))
    check('  FNP-935, past its dates and not switched on, reads Auto and not active',
      await a.evaluate((sel) => { const b = document.querySelector(sel); return b?.dataset.active === 'off' && b.dataset.activeMode === 'auto' }, ctl('FNP-935')))
    // Pick from the control's menu, then wait for the plan to save itself (four seconds after an edit).
    const choose = async (key, item) => {
      await a.evaluate((sel) => document.querySelector(sel)?.click(), ctl(key))
      await a.waitForSelector('[role="menuitem"]', { timeout: 5000 }).catch(() => {})
      await a.evaluate((t) => [...document.querySelectorAll('[role="menuitem"]')].find((x) => x.textContent.startsWith(t))?.click(), item)
    }
    const saved = async (key, want) => {
      let p = null
      for (let i = 0; i < 30; i++) {
        await sleep(500)
        p = (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body.payload?.projects?.find((x) => x.key === key)
        if (want(p)) return { ok: true, p }
      }
      return { ok: false, p, said: (await text(a)).split('\n').filter((l) => /sav|newer|someone|conflict|offline|changed/i.test(l)).slice(0, 8) }
    }
    await choose('FNP-935', 'Always active')
    let r935 = await saved('FNP-935', (p) => p?.active === true)
    check('"ALWAYS ACTIVE" SAVES TO THE SHARED PLAN', r935.ok, r935.ok ? '' : JSON.stringify(r935))
    check('  and the control now reads active', await a.evaluate((sel) => document.querySelector(sel)?.dataset.active === 'on', ctl('FNP-935')))
    await choose('FNP-935', 'Never active')
    r935 = await saved('FNP-935', (p) => p?.active === false)
    check('"NEVER ACTIVE" SAVES TOO', r935.ok, r935.ok ? '' : JSON.stringify(r935))
    await choose('FNP-935', 'Automatic')
    r935 = await saved('FNP-935', (p) => p && p.active === undefined)
    check('"AUTOMATIC" TAKES THE OVERRIDE OFF AGAIN', r935.ok, r935.ok ? '' : JSON.stringify(r935.p?.active))
    await a.evaluate(() => document.querySelector('input[aria-label="active projects only"]')?.click())
    await sleep(400)
    const shownRows = await a.evaluate(() => [...document.querySelectorAll('[aria-label^="active FNP-"], [aria-label^="active ROW-"]')]
      .filter((x) => x.tagName !== 'INPUT').map((x) => x.dataset.active))
    check('"ACTIVE ONLY" SHOWS JUST THE ACTIVE ONES', shownRows.length > 0 && shownRows.every((v) => v === 'on'), shownRows.join(','))

    console.log('\n--- members, and phones ---')
    await m.bringToFront()
    await m.goto(`${base}/#project/FNP-379`, { waitUntil: 'networkidle0' })
    await sleep(600)
    check('A MEMBER CANNOT OPEN A PROJECT PAGE', !(await text(m)).includes('Week by week'))
    check('  and the link does not add a task to their week', !(await m.evaluate(() => !!document.querySelector('[data-task-project="FNP-379"]')))
      || (await m.evaluate(() => document.querySelectorAll('[data-task-project="FNP-379"]').length)) === 1)
    check('  nor say their manager asked', !(await text(m)).includes('Your manager asked for an update on FNP-379'))
    check('  NOR THE SIDE MENU SHOW A "PROJECT" PAGE', !(await a.evaluate(() => [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.trim() === 'Project'))))
    const ph = await as(boss, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await ph.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await ph.waitForFunction(() => !!document.querySelector('section[aria-label="who holds what"]'), { timeout: 15000 }).catch(() => {})
    check('ON A PHONE THE CARDS STACK, nothing spills sideways', (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 390)
    check('  and the layout is not edited there', !(await ph.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Edit layout'))))

    console.log('\n--- a member sees their own ---')
    // A colleague's week, with a focus line that must not reach James.
    await db.db('team_kpi_planning').collection('kpi_weekly').insertOne({
      week: WEEK, person: 'kade', focus: 'KADE-ONLY focus line', tasks: [], unplanned: [], updatedAt: new Date().toISOString(),
    })
    await m.bringToFront()
    await m.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await m.waitForFunction(() => document.body.innerText.includes('My week'), { timeout: 15000 }).catch(() => {})
    const wk = await text(m)
    check('THEIR WEEK, AND NOBODY ELSE’S: no team list, no colleague’s focus',
      !wk.includes('KADE-ONLY') && !wk.includes('What the team is focused on') && !wk.includes('The team this week'))
    check('  THE WEEK CARRIES ITS NUMBER', /Week \d{1,2}\n/.test(wk) && /\d{1,2} \w{3} \d{4} · this week/.test(wk))
    check('  no Excel export and no file menu — both are the whole plan',
      !(await m.evaluate(() => [...document.querySelectorAll('button')].some((b) => /Export Excel/.test(b.textContent) || b.getAttribute('aria-label') === 'More'))))
    check('  the side menu shows their own progress, not the team’s', wk.includes('Your projects, finished') && !wk.includes('Saving hours, committed'))
    const tabsM = await m.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()))
    check('  the scorecard tab is theirs', tabsM.includes('My scorecard') && !tabsM.includes('Overall team'), tabsM.join(' | '))
    // Their open projects are listed in their week without asking.
    if (process.env.SHOT_DIR) { await m.evaluate(() => document.querySelector('section[aria-label="your projects"]')?.scrollIntoView({ block: 'center' })); await m.screenshot({ path: `${process.env.SHOT_DIR}/my-projects.png` }) }
    const mine = await m.evaluate(() => [...document.querySelectorAll('[data-my-project]')].map((x) => x.getAttribute('data-my-project')))
    check('THEIR PROJECTS ARE ON THE PAGE ALREADY', wk.includes('Your projects') && mine.length > 0 && !mine.includes('FNP-267'), mine.join(','))
    check('  one already planned says so', (await m.evaluate(() => document.querySelector('[data-my-project="FNP-379"]')?.textContent || '')).includes('on this week’s plan'))
    const addOn = await m.evaluate(() => {
      const row = [...document.querySelectorAll('[data-my-project]')].find((x) => [...x.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Add task'))
      if (!row) return null
      ;[...row.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add task').click()
      return row.getAttribute('data-my-project')
    })
    await sleep(300)
    check('  ONE CLICK PUTS A TASK ON A PROJECT', !!addOn && (await m.evaluate((k) => !!document.querySelector(`[data-task-project="${k}"]`), addOn)), addOn)
    // Clicking a task's project field opens the list on their own projects.
    await m.evaluate(() => [...document.querySelectorAll('label')].find((l) => /^Project/.test(l.textContent))?.parentElement.querySelector('input')?.focus())
    await m.evaluate(() => [...document.querySelectorAll('label')].find((l) => /^Project/.test(l.textContent))?.parentElement.querySelector('input')?.click())
    await m.waitForSelector('[role="listbox"]', { timeout: 5000 }).catch(() => {})
    const list = await m.evaluate(() => {
      const box = document.querySelector('[role="listbox"]')
      return box ? [...box.querySelectorAll('.MuiAutocomplete-groupLabel, [role="option"]')].slice(0, 6).map((x) => x.textContent.trim()) : []
    })
    check('THE PROJECT LIST POPS UP ON THEIR OWN PROJECTS FIRST',
      /^Your projects \(you are PIC\)/.test(list[0] || '') && list.slice(1).some((x) => x.startsWith('FNP-379')), list.join(' | '))
    await m.keyboard.press('Escape')

    await m.goto(`${base}/#team`, { waitUntil: 'networkidle0' })
    await m.waitForFunction(() => document.body.innerText.includes('My scorecard'), { timeout: 10000 }).catch(() => {})
    const heads = await m.evaluate(() => [...document.querySelectorAll('thead tr:first-child th')].map((t) => t.textContent.trim()).slice(1))
    check('MY SCORECARD: ONE CARD, THEIRS', heads.length === 1 && /^James/.test(heads[0]), heads.join(' | '))
    check('  and no team total', !(await text(m)).includes('Team total'))

    await m.goto(`${base}/#timeline`, { waitUntil: 'networkidle0' })
    await m.waitForFunction(() => document.body.innerText.includes('Only the projects you hold'), { timeout: 10000 }).catch(() => {})
    const tl = await text(m)
    check('THE TIMELINE SHOWS ONLY THEIR PROJECTS', tl.includes('PL Forecast') && !tl.includes('Supplier Portal'))
    check('  and says so', tl.includes('Only the projects you hold'))
    const picks = await m.evaluate(async () => {
      const sel = [...document.querySelectorAll('[role="combobox"]')].find((x) => x.closest('.MuiFormControl-root')?.textContent.includes('PIC'))
      sel?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 300))
      const opts = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim())
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return opts
    })
    check('  the PIC filter offers only the people on those projects', picks.length > 0 && !picks.includes('Kade') && !picks.includes('Pol'), picks.join(' | '))

    // The header search finds their own projects, not a colleague's.
    await m.keyboard.press('Escape')
    await m.evaluate(() => document.querySelector('input[placeholder^="Search"]')?.focus())
    await m.keyboard.type('Supplier Portal')
    await sleep(400)
    const found = await m.evaluate(() => [...document.querySelectorAll('[role="option"], li')].map((o) => o.textContent).join(' | '))
    check('THE SEARCH DOES NOT FIND A COLLEAGUE’S PROJECT', !found.includes('FNP-267'), found.slice(0, 120))

    const asBossWeek = (await call('GET', `/api/weekly/${WEEK}`, undefined, boss)).body
    check('AN ADMINISTRATOR STILL READS EVERYBODY', asBossWeek.team.some((r) => r.person === 'kade' && r.focus === 'KADE-ONLY focus line'))
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

console.log(failures ? `\n${failures} FAILED` : '\nall manager dashboard checks passed')
process.exit(failures ? 1 : 0)
