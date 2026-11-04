/**
 * The weekly check-in: its calendar, its rules, and who sees what.
 *
 * Three parts. The calendar is pure and checked at fixed instants, so it does
 * not depend on what day the suite happens to run. The API is driven against a
 * real server and a real mongod, as a member, a second member and an
 * administrator. The page is then opened in a real browser at iPhone width.
 *
 *   node scripts/check-weekly.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import {
  weekOf, isWeek, addWeeks, deadlines, isLocked, canWriteWeek, stageStatus, cleanEntry, planProblems,
  reportProblems, slipImpact, carryOver, defaultSubmitters,
} from '../src/lib/weekly.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const T = (iso) => Date.parse(iso)

/* ------------------------------------------------------------- calendar */

console.log('\n--- the calendar, in Bangkok time ---')
check('a Wednesday afternoon belongs to its Monday', weekOf(T('2026-11-04T10:00:00Z')) === '2026-11-02')
check('SUNDAY NIGHT BELONGS TO THE WEEK BEFORE, not the next',
  weekOf(T('2026-11-08T16:59:00Z')) === '2026-11-02', 'Sun 23:59 Bangkok')
check('  and one minute later the new week has begun',
  weekOf(T('2026-11-08T17:00:00Z')) === '2026-11-09', 'Mon 00:00 Bangkok is still Sun 17:00 UTC')
check('a Monday is a week; a Tuesday is not', isWeek('2026-11-02') && !isWeek('2026-11-03'))
check('weeks add across a month end', addWeeks('2026-11-30', 1) === '2026-12-07')

const d = deadlines('2026-11-02')
check('THE PLAN IS DUE MONDAY 08:00 BANGKOK', d.planDue === T('2026-11-02T01:00:00Z'))
check('THE REPORT IS DUE FRIDAY 15:00 BANGKOK', d.reportDue === T('2026-11-06T08:00:00Z'))
check('the second chance is Sunday 15:00', d.secondChance === T('2026-11-08T08:00:00Z'))
check('THE WEEK LOCKS THE NEXT MONDAY 08:00', d.locksAt === T('2026-11-09T01:00:00Z'))
check('  open one minute before', !isLocked('2026-11-02', T('2026-11-09T00:59:00Z')))
check('  locked on the minute', isLocked('2026-11-02', T('2026-11-09T01:00:00Z')))

const wed = T('2026-11-04T05:00:00Z')
check('this week can be written', canWriteWeek('2026-11-02', wed))
check('next week can be written (a plan on Friday afternoon)', canWriteWeek('2026-11-09', wed))
check('the week after cannot', !canWriteWeek('2026-11-16', wed))
check('last week, once locked, cannot', !canWriteWeek('2026-10-26', wed))
check('last week is still open on Monday at 07:59', canWriteWeek('2026-10-26', T('2026-11-02T00:59:00Z')))

check('submitted by the deadline is on time', stageStatus('2026-11-06T07:59:00Z', d.reportDue) === 'ontime')
check('A MINUTE AFTER IS LATE', stageStatus('2026-11-06T08:01:00Z', d.reportDue) === 'late')
check('nothing in, before the deadline, is not due yet', stageStatus(null, d.reportDue, wed) === 'open')
check('nothing in, after it, is missing', stageStatus(null, d.planDue, wed) === 'missing')

console.log('\n--- what a week has to hold ---')
const plan = cleanEntry({
  focus: 'Close the AP OCR pilot',
  tasks: [
    { title: 'Train the model', projectKey: 'FNP-1265', jiraKey: 'fnp-2001', expected: '2026-11-06', effort: 2, priority: 'must' },
    { title: '' },
    { title: 'Evil', effort: 'lots', priority: 'urgent', jiraKey: 'DROP TABLE', expected: 'tomorrow', pct: 500 },
  ],
})
check('a row with no title is dropped', plan.tasks.length === 2)
check('a Jira key is upper-cased', plan.tasks[0].jiraKey === 'FNP-2001')
check('rubbish is cleaned to null, never to zero',
  plan.tasks[1].effort === null && plan.tasks[1].priority === null && plan.tasks[1].jiraKey === null
  && plan.tasks[1].expected === null, JSON.stringify(plan.tasks[1]))
check('a percentage is held to 0..100', plan.tasks[1].pct === 100)
check('AN INCOMPLETE PLAN LISTS EVERY GAP', planProblems(plan).length === 3, planProblems(plan).join(' | '))
check('a complete plan has none', planProblems(cleanEntry({ ...plan, tasks: [plan.tasks[0]] })).length === 0)
check('a plan with no focus is not complete', planProblems(cleanEntry({ tasks: [plan.tasks[0]] })).length === 1)

const unfinished = cleanEntry({ tasks: [{ ...plan.tasks[0], done: false }] })
check('AN UNFINISHED TASK NEEDS %, BLOCKER, CATEGORY, NEW DATE AND IMPACT',
  reportProblems(unfinished).length === 5, reportProblems(unfinished).join(' | '))
check('a finished task needs nothing more', reportProblems(cleanEntry({ tasks: [{ ...plan.tasks[0], done: true }] })).length === 0)
check('a task nobody reported on is a gap', reportProblems(cleanEntry({ tasks: [plan.tasks[0]] })).length === 1)

const slip = { done: false, newDate: '2026-12-10', affects: false }
check('A NEW DATE PAST THE PROJECT DUE IS COUNTED IN DAYS', slipImpact(slip, '2026-11-30').byDate === 10)
check('  and a member who says it does not matter is flagged', slipImpact(slip, '2026-11-30').disagree === true)
check('a date inside the project agrees with "no impact"', slipImpact({ ...slip, newDate: '2026-11-20' }, '2026-11-30').disagree === false)
check('"it pushes the deadline" against a date inside it is flagged',
  slipImpact({ ...slip, newDate: '2026-11-20', affects: true }, '2026-11-30').disagree === true)
check('no project, no comparison and no flag', slipImpact(slip, null).byDate === null && !slipImpact(slip, null).disagree)

const carried = carryOver({
  tasks: [
    { id: 'a1111', title: 'Done one', done: true, expected: '2026-11-03' },
    { id: 'b2222', title: 'Slipped', done: false, expected: '2026-11-05', newDate: '2026-11-12', priority: 'must', blocker: 'IT', pct: 40 },
    { id: 'c3333', title: 'Never reported', done: null, expected: '2026-11-06' },
  ],
}, '2026-11-02')
check('MONDAY CARRIES THE UNFINISHED AND THE UNREPORTED', carried.map((t) => t.title).join(',') === 'Slipped,Never reported')
check('  at the new date given on Friday', carried[0].expected === '2026-11-12')
check('  with Friday’s answers wiped', carried[0].done === null && carried[0].blocker === '' && carried[0].pct === null)
check('  remembering where it came from', carried[0].carriedFrom === '2026-11-02')
check('  and keeping that through a second carry',
  carryOver({ tasks: carried }, '2026-11-09')[0].carriedFrom === '2026-11-02')

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
check('THE DEFAULT SUBMIT LIST IS ALL SIX, GUN INCLUDED, AND NOT IT',
  defaultSubmitters(seed.people).sort().join(',') === 'gun,james,kade,pol,pphen,tha',
  defaultSubmitters(seed.people).join(','))

/* ------------------------------------------------------------------ API */

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5361
const base = `http://127.0.0.1:${PORT}`
const SERVICE = `Bearer ${'weekly-service-token-'.padEnd(48, '3')}`
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
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', (b) => { if (/Error|error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
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
  const WEEK = weekOf()
  const NEXT = addWeeks(WEEK, 1)
  const firstProject = seed.projects.find((p) => !p.deleted && p.due)
  check('the shared plan is stored', (await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')).status === 200)

  const boss = await signUp('boss@lotuss.com', 'bosspass1')
  const james = await signUp('james@lotuss.com')
  const kade = await signUp('kade@lotuss.com')

  console.log('\n--- nobody is anybody until an administrator says so ---')
  check('a stranger gets nothing', (await call('GET', '/api/weekly/current')).status === 401)
  const unlinked = await call('GET', '/api/weekly/current', undefined, james)
  check('an unlinked member can open the page', unlinked.status === 200 && unlinked.body.person === null)
  check('  but has no week of their own', unlinked.body.mine === null && unlinked.body.writable === false)
  check('  and cannot save one', (await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: 'x' }, james)).status === 409)

  check('A MEMBER CANNOT LINK THEMSELVES', (await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, james)).status === 403)
  check('an administrator links an account to a person',
    (await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)).body.user?.person === 'james')
  check('  and the account says so on the next request',
    (await call('GET', '/api/auth/me', undefined, james)).body.user?.person === 'james')
  const twice = await call('PUT', '/api/auth/users/kade@lotuss.com', { person: 'james' }, boss)
  check('TWO ACCOUNTS CANNOT BE THE SAME PERSON', twice.status === 400 && /james@lotuss\.com/.test(twice.body.error), twice.body.error)
  check('a person not on the team is refused',
    (await call('PUT', '/api/auth/users/kade@lotuss.com', { person: 'nobody' }, boss)).status === 400)
  await call('PUT', '/api/auth/users/kade@lotuss.com', { person: 'kade' }, boss)
  await call('PUT', '/api/auth/users/boss@lotuss.com', { person: 'gun' }, boss)

  console.log('\n--- who has to submit ---')
  const s0 = await call('GET', '/api/weekly/settings', undefined, james)
  check('BY DEFAULT, ALL SIX WITH A SCORECARD', s0.body.isDefault && s0.body.submitters.sort().join(',') === 'gun,james,kade,pol,pphen,tha',
    s0.body.submitters.join(','))
  check('a member cannot change the list', (await call('PUT', '/api/weekly/settings', { submitters: ['james'] }, james)).status === 403)
  check('nobody off the team can be put on it',
    (await call('PUT', '/api/weekly/settings', { submitters: ['james', 'ghost'] }, boss)).status === 400)
  const s1 = await call('PUT', '/api/weekly/settings', { submitters: ['gun', 'james', 'kade', 'pol', 'pphen'] }, boss)
  check('an administrator can', s1.status === 200 && !s1.body.isDefault && !s1.body.submitters.includes('tha'))

  console.log('\n--- a member’s week ---')
  const task = {
    title: 'Finish the OCR training set', projectKey: firstProject.key, expected: '2026-12-31', effort: 2, priority: 'must',
  }
  const draft = await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: '', tasks: [{ ...task, effort: null }] }, james)
  check('A HALF-WRITTEN DRAFT SAVES', draft.status === 200 && !draft.body.entry.planSubmittedAt)
  const early = await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: '', tasks: [task], submit: 'plan' }, james)
  check('AN INCOMPLETE PLAN IS NOT SUBMITTED, and every gap is named',
    early.status === 400 && early.body.problems?.length === 1, JSON.stringify(early.body.problems))
  const sub = await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: 'OCR pilot this week', tasks: [task], submit: 'plan' }, james)
  check('a complete plan is submitted', sub.status === 200 && !!sub.body.entry.planSubmittedAt)
  const firstAt = sub.body.entry.planSubmittedAt
  await new Promise((r) => setTimeout(r, 30))
  const again = await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: 'OCR pilot, and the vendor call', tasks: [task] }, james)
  check('EDITING AFTERWARDS KEEPS THE FIRST SUBMISSION TIME', again.body.entry.planSubmittedAt === firstAt)
  check('  but a submitted plan cannot be hollowed out',
    (await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: '', tasks: [] }, james)).status === 400)
  const reportGap = await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'OCR pilot', tasks: [{ ...task, done: false }], submit: 'report',
  }, james)
  check('AN UNFINISHED TASK CANNOT BE REPORTED WITHOUT ITS BLOCKER AND NEW DATE',
    reportGap.status === 400 && reportGap.body.problems.length === 5)
  const report = await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'OCR pilot',
    tasks: [{
      ...task, done: false, pct: 60, blocker: 'Waiting for 200 sample statements from AP', blockerCategory: 'business',
      newDate: '2027-01-15', affects: false,
    }],
    unplanned: [{ title: 'Audit request', effort: 0.5 }],
    submit: 'report',
  }, james)
  check('a complete report is submitted', report.status === 200 && !!report.body.entry.reportSubmittedAt,
    JSON.stringify(report.body).slice(0, 200))
  check('A MEMBER CANNOT WRITE ANYBODY ELSE’S WEEK — the person comes from the account',
    (await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: 'hijack', person: 'kade' }, james)).status === 400
    && (await call('GET', '/api/weekly/current', undefined, kade)).body.mine?.focus !== 'hijack')
  check('a week two ahead cannot be written',
    (await call('PUT', `/api/weekly/${addWeeks(WEEK, 2)}/mine`, { focus: 'x' }, james)).status === 409)
  const old = await call('PUT', `/api/weekly/${addWeeks(WEEK, -2)}/mine`, { focus: 'x' }, james)
  check('A LOCKED WEEK CANNOT BE WRITTEN', old.status === 409 && /locked/i.test(old.body.error), old.body.error)
  check('a week that is not a Monday is refused', (await call('GET', '/api/weekly/2026-11-04', undefined, james)).status === 400)

  await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'Kade’s private focus', tasks: [{ ...task, title: 'Kade secret task', blocker: 'KADE-BLOCKER' }],
  }, kade)

  console.log('\n--- who sees what ---')
  const asJames = (await call('GET', `/api/weekly/${WEEK}`, undefined, james)).body
  check('a member sees their own week in full', asJames.mine?.tasks?.[0]?.blocker === 'Waiting for 200 sample statements from AP')
  const kadeRow = asJames.team.find((r) => r.person === 'kade')
  check('A MEMBER SEES A COLLEAGUE’S FOCUS', kadeRow?.focus === 'Kade’s private focus')
  check('  AND NOTHING ELSE OF THEIR WEEK', !kadeRow.entry && !kadeRow.standing
    && !JSON.stringify(asJames.team).includes('KADE-BLOCKER') && !JSON.stringify(asJames.team).includes('Kade secret task'),
  Object.keys(kadeRow).join(','))
  check('  not even who is late', asJames.team.every((r) => r.standing === undefined))
  check('the submit list decides the rows; Thapanee is off it', !asJames.team.some((r) => r.person === 'tha'))

  const asBoss = (await call('GET', `/api/weekly/${WEEK}`, undefined, boss)).body
  const jamesRow = asBoss.team.find((r) => r.person === 'james')
  check('AN ADMINISTRATOR SEES EVERY WEEK IN FULL', jamesRow?.entry?.tasks?.[0]?.blocker?.startsWith('Waiting for 200'))
  check('  and where each person stands', ['ontime', 'late'].includes(jamesRow.standing?.plan)
    && ['ontime', 'late'].includes(jamesRow.standing?.report), JSON.stringify(jamesRow.standing))
  check('  including who has sent nothing',
    ['open', 'missing'].includes(asBoss.team.find((r) => r.person === 'pol')?.standing?.plan))
  check('an administrator has a week of their own when linked', asBoss.person === 'gun' && asBoss.writable === true)
  check('an administrator cannot write a member’s week either',
    (await call('PUT', `/api/weekly/${WEEK}/mine`, { focus: 'boss wrote this' }, boss)).status === 200
    && (await call('GET', `/api/weekly/${WEEK}`, undefined, james)).body.mine.focus === 'OCR pilot')

  console.log('\n--- next Monday ---')
  const next = (await call('GET', `/api/weekly/${NEXT}`, undefined, james)).body
  check('NEXT WEEK OPENS WITH THE UNFINISHED TASK CARRIED', next.mine?.draft === true && next.mine.tasks.length === 1,
    JSON.stringify(next.mine?.tasks?.map((t) => t.title)))
  check('  at the new date given on Friday', next.mine.tasks[0].expected === '2027-01-15')
  check('  and nothing is stored until it is saved',
    (await call('GET', `/api/weekly/${NEXT}`, undefined, boss)).body.team.find((r) => r.person === 'james').entry === null)

  /* -------------------------------------------------------------- browser */

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
    console.log('\n--- the page, on an iPhone ---')
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    const [name, value] = kade.split('=')
    await page.setCookie({ name, value, url: base })
    await page.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.body.innerText.includes('My week'), { timeout: 15000 })
    const text = await page.evaluate(() => document.body.innerText)
    check('A MEMBER LANDS ON THEIR WEEK', text.includes('Weekly check-in') && text.includes('My week'))
    check('  with their own draft in it', await page.evaluate(() => [...document.querySelectorAll('textarea')].some((t) => t.value === 'Kade’s private focus')))
    check('  and a colleague’s focus below', text.includes('OCR pilot'))
    check('  and none of the colleague’s blocker', !text.includes('Waiting for 200 sample'))
    const wide = await page.evaluate(() => document.documentElement.scrollWidth)
    check('NOTHING SPILLS SIDEWAYS AT 390px', wide <= 390, `scrollWidth ${wide}`)

    // Fill the missing bits and submit the plan through the page.
    await page.evaluate(() => {
      const set = (el, v) => {
        const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const byLabel = (txt) => [...document.querySelectorAll('label')].find((l) => l.textContent.startsWith(txt))
      set(document.getElementById(byLabel('Effort').htmlFor), '1.5')
    })
    await page.evaluate(() => [...document.querySelectorAll('[role="combobox"]')].find((el) => el.closest('.MuiTextField-root')?.querySelector('label')?.textContent.startsWith('Priority'))
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    await page.waitForSelector('li[role="option"]')
    await page.evaluate(() => [...document.querySelectorAll('li[role="option"]')].find((li) => li.textContent === 'Should').click())
    await page.waitForFunction(() => !document.querySelector('li[role="option"]'))
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Submit plan').click())
    await page.waitForFunction(() => document.body.innerText.includes('Plan submitted'), { timeout: 10000 }).catch(() => {})
    const after = await call('GET', `/api/weekly/${WEEK}`, undefined, kade)
    check('A PLAN SUBMITTED FROM THE PHONE IS STORED', !!after.body.mine?.planSubmittedAt
      && after.body.mine.tasks[0].effort === 1.5 && after.body.mine.tasks[0].priority === 'should',
    JSON.stringify(after.body.mine?.tasks?.[0]))

    // The administrator's view.
    const admin = await browser.newPage()
    await admin.setViewport({ width: 1440, height: 900 })
    const [bn, bv] = boss.split('=')
    await admin.setCookie({ name: bn, value: bv, url: base })
    await admin.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await admin.waitForFunction(() => document.body.innerText.includes('The team this week'), { timeout: 15000 })
    await admin.evaluate(() => document.querySelector('[aria-label="show James\'s week"]').click())
    await admin.waitForFunction(() => document.body.innerText.includes('Blocker:'), { timeout: 5000 }).catch(() => {})
    const atext = await admin.evaluate(() => document.body.innerText)
    check('AN ADMINISTRATOR READS A MEMBER’S BLOCKER', atext.includes('Blocker: Waiting for 200 sample statements'))
    check('  with the slip measured against the project', /days? past the project/.test(atext))
    check('  and the disagreement called out', atext.includes('disagree'))

    await admin.goto(`${base}/#users`, { waitUntil: 'networkidle0' })
    // The heading paints before the accounts arrive; wait for a row.
    await admin.waitForFunction(() => document.body.innerText.includes('james@lotuss.com'), { timeout: 15000 })
    const utext = await admin.evaluate(() => document.body.innerText)
    check('THE ACCESS TAB LINKS ACCOUNTS TO PEOPLE', /not linked|James/.test(utext)
      && await admin.evaluate(() => !!document.querySelector('[aria-label="team member for james@lotuss.com"]')))
    check('  and holds the submit list', utext.includes('Weekly check-in: who has to submit'))
  }
} catch (e) {
  failures++
  console.log(`FAIL  the suite crashed — ${e.stack}`)
} finally {
  if (browser) await browser.close()
  server.kill()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall weekly checks passed')
process.exit(failures ? 1 : 0)
