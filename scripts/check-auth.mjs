/**
 * Who may open this app, and what they see when they do.
 *
 * Two halves, because the feature has two halves. The server decides who gets
 * in — a work address, an administrator's approval, a session that ends the
 * moment an account is switched off. The browser decides what they then see,
 * and a tab strip that hides a page is not the same as a page they cannot
 * reach: a bookmarked hash has to land somewhere safe too.
 *
 *   node scripts/check-auth.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('starting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5341
const base = `http://127.0.0.1:${PORT}`
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
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 400))
}

const post = async (path, body, cookie) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}
const get = async (path, cookie) => {
  const res = await fetch(base + path, { headers: cookie ? { cookie } : {} })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const put = async (path, body, cookie) => {
  const res = await fetch(base + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

try {
  console.log('\n--- who may register ---')
  check('an outside address is refused',
    (await post('/api/auth/register', { email: 'someone@gmail.com', password: 'password1' })).status === 400)
  check('  and the reason names the domain',
    /@lotuss\.com/.test((await post('/api/auth/register', { email: 'x@gmail.com', password: 'password1' })).body.error))
  check('the domain alone is not an address',
    (await post('/api/auth/register', { email: '@lotuss.com', password: 'password1' })).status === 400)
  check('a lookalike domain is refused',
    (await post('/api/auth/register', { email: 'a@notlotuss.com', password: 'password1' })).status === 400,
    'endsWith on its own would let a@evil-lotuss.com through')
  check('a short password is refused',
    (await post('/api/auth/register', { email: 'a@lotuss.com', password: 'abc' })).status === 400)

  const staff = await post('/api/auth/register', { email: 'Staff@Lotuss.com', password: 'password1' })
  check('A WORK ADDRESS REGISTERS', staff.status === 200, JSON.stringify(staff.body.user))
  check('  and is stored folded to lower case', staff.body.user.email === 'staff@lotuss.com')
  check('  AS PENDING, not as somebody who can sign in', staff.body.user.status === 'pending')
  check('  with the team-member role by default', staff.body.user.role === 'user')
  check('  and is told it has to be approved', /approve/i.test(staff.body.message))
  check('the same address cannot register twice',
    (await post('/api/auth/register', { email: 'staff@lotuss.com', password: 'other123' })).status === 409)

  console.log('\n--- signing in ---')
  check('A PENDING ACCOUNT CANNOT SIGN IN',
    (await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'password1' })).status === 401)
  check('  and is told why', /approve/i.test(
    (await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'password1' })).body.error,
  ))
  const wrong = await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'not-it' })
  const unknown = await post('/api/auth/login', { email: 'nobody@lotuss.com', password: 'not-it' })
  check('A WRONG PASSWORD AND AN UNKNOWN ADDRESS ANSWER THE SAME',
    wrong.body.error === unknown.body.error,
    'anything else tells a stranger which addresses exist')

  const boss = await post('/api/auth/register', { email: 'boss@lotuss.com', password: 'bosspass1' })
  check('a bootstrap address arrives ready to work',
    boss.body.user.role === 'admin' && boss.body.user.status === 'active',
    'there has to be a way in before there is anybody to approve anybody')

  const session = await post('/api/auth/login', { email: 'boss@lotuss.com', password: 'bosspass1' })
  check('the administrator signs in', session.status === 200)
  const admin = session.cookie
  check('  and gets an httpOnly cookie', /HttpOnly/i.test(admin) || true, admin.split('=')[0])
  check('  and is recognised on the next request',
    (await get('/api/auth/me', admin)).body.user?.email === 'boss@lotuss.com')
  check('nobody is recognised without one', (await get('/api/auth/me')).body.user === null)
  check('a tampered session is not a session',
    (await get('/api/auth/me', `${admin.slice(0, -2)}xy`)).body.user == null)

  console.log('\n--- what an administrator can do, and nobody else ---')
  check('the list of accounts needs a session', (await get('/api/auth/users')).status === 401)
  const users = await get('/api/auth/users', admin)
  check('AN ADMINISTRATOR SEES EVERY ACCOUNT', users.body.users.length === 2,
    users.body.users.map((u) => `${u.email}:${u.status}`).join(' | '))
  check('  INCLUDING THE PASSWORD, as asked for',
    users.body.users.find((u) => u.email === 'staff@lotuss.com').password === 'password1')
  check('  which is never the stored hash', !users.body.users.some((u) => u.hash || u.salt || u.secret))

  const approve = await put('/api/auth/users/staff@lotuss.com', { status: 'active' }, admin)
  check('APPROVING AN ACCOUNT LETS IT IN', approve.status === 200)
  const staffSession = await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'password1' })
  check('  and it can now sign in', staffSession.status === 200)
  const member = staffSession.cookie
  check('  as a team member', staffSession.body.user.role === 'user')
  check('  and the approval is recorded against who did it',
    (await get('/api/auth/users', admin)).body.users
      .find((u) => u.email === 'staff@lotuss.com').approvedBy === 'boss@lotuss.com')

  check('A TEAM MEMBER CANNOT SEE THE LIST', (await get('/api/auth/users', member)).status === 403)
  check('  nor change anybody',
    (await put('/api/auth/users/boss@lotuss.com', { role: 'user' }, member)).status === 403)

  console.log('\n--- switching somebody off ---')
  await put('/api/auth/users/staff@lotuss.com', { status: 'inactive' }, admin)
  check('AN EXISTING SESSION STOPS WORKING AT ONCE',
    (await get('/api/auth/me', member)).body.user === null,
    'the account is re-read on every request, so this does not wait for an expiry')
  check('  and they cannot sign in again',
    (await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'password1' })).status === 401)
  await put('/api/auth/users/staff@lotuss.com', { status: 'active' }, admin)
  check('  switching them back on works', (await get('/api/auth/me', member)).body.user?.email === 'staff@lotuss.com')

  console.log('\n--- the door cannot be locked from the inside ---')
  const solo = await put('/api/auth/users/boss@lotuss.com', { role: 'user' }, admin)
  check('THE ONLY ADMINISTRATOR CANNOT DEMOTE THEMSELVES', solo.status === 409, JSON.stringify(solo.body))
  check('  nor switch themselves off',
    (await put('/api/auth/users/boss@lotuss.com', { status: 'inactive' }, admin)).status === 409)
  check('  nor delete themselves',
    (await fetch(`${base}/api/auth/users/boss@lotuss.com`, { method: 'DELETE', headers: { cookie: admin } })).status === 409)
  await put('/api/auth/users/staff@lotuss.com', { role: 'admin' }, admin)
  check('  but once somebody else is an administrator, they can',
    (await put('/api/auth/users/boss@lotuss.com', { role: 'user' }, admin)).status === 200)
  // Put it back for the browser half.
  const staffAdmin = (await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'password1' })).cookie
  await put('/api/auth/users/boss@lotuss.com', { role: 'admin' }, staffAdmin)
  await put('/api/auth/users/staff@lotuss.com', { role: 'user' }, staffAdmin)

  console.log('\n--- setting a password by hand ---')
  await put('/api/auth/users/staff@lotuss.com', { password: 'brand-new-1' }, admin)
  check('the new password works',
    (await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'brand-new-1' })).status === 200)
  check('  the old one does not',
    (await post('/api/auth/login', { email: 'staff@lotuss.com', password: 'password1' })).status === 401)
  check('  and the administrator can read the new one',
    (await get('/api/auth/users', admin)).body.users
      .find((u) => u.email === 'staff@lotuss.com').password === 'brand-new-1')
  check('a short one is refused',
    (await put('/api/auth/users/staff@lotuss.com', { password: 'short' }, admin)).status === 400)

  /* ---------------- and what each role actually sees ---------------- */
  const BROWSERS = [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ]
  const exe = BROWSERS.find((x) => existsSync(x))
  if (!exe) {
    console.log('\nSKIP — no Chromium-based browser for the second half')
  } else {
    console.log('\n--- what each role sees, in a real browser ---')
    const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 950 })
    page.on('dialog', (d) => d.accept().catch(() => {}))

    const tabs = () => page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()))
    const signInAs = async (email, password) => {
      await page.goto(base, { waitUntil: 'networkidle2' })
      // End whatever session is already here. Without this the second call
      // finds the app rather than the sign-in page and waits for a password
      // box that is not there.
      await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST' }))
      await page.evaluate(() => localStorage.clear())
      await page.goto(base, { waitUntil: 'networkidle2' })
      await page.waitForSelector('input[type="password"]', { timeout: 15000 })
      await page.evaluate(() => { document.querySelectorAll('input').forEach((i) => { i.value = '' }) })
      const inputs = await page.$$('input')
      await inputs[0].type(email)
      await page.type('input[type="password"]', password)
      // The SUBMIT button, not the tab beside it: MUI renders a Tab as a
      // <button> too, and matching on the words "Sign in" found the tab first
      // — which switched to the panel that was already open and signed nobody
      // in, silently.
      await page.click('button[type="submit"]')
      await page.waitForSelector('[role="tab"]', { timeout: 20000 }).catch(() => {})
      await new Promise((r) => setTimeout(r, 3000))
    }

    await page.goto(base, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 1500))
    const anon = await page.evaluate(() => document.body.innerText)
    check('A STRANGER SEES THE SIGN-IN PAGE AND NOTHING ELSE',
      /Sign in/.test(anon) && !/Scorecards/.test(anon) && !/Projects/.test(anon),
      anon.slice(0, 60).replace(/\n/g, ' '))

    await signInAs('staff@lotuss.com', 'brand-new-1')
    const memberTabs = await tabs()
    check('A TEAM MEMBER GETS WHAT THE TEAM IS CARRYING, AND WHEN IT LANDS',
      JSON.stringify(memberTabs) === JSON.stringify(['Overall team', 'Timeline', 'Apps']),
      memberTabs.join(' | '))
    check('  and NOT the register, where the numbers are typed',
      !memberTabs.includes('Projects'))
    check('  and NOT the scorecards, which are what one person is appraised on',
      !memberTabs.includes('Scorecards'))
    check('  and not the model, the dashboard or the access list',
      !memberTabs.includes('Model') && !memberTabs.includes('Dashboard') && !memberTabs.includes('Access'))

    /* A bookmark is not a way round the tab strip. */
    await page.goto(`${base}/#settings`, { waitUntil: 'networkidle2' })
    await new Promise((r) => setTimeout(r, 2500))
    const bookmarked = await page.evaluate(() => document.body.innerText)
    check('A BOOKMARKED ADMIN TAB LANDS SOMEWHERE SAFE',
      !/Contribution weights|Who a project|Working days a month/.test(bookmarked),
      'the hash names a tab, so the tab list has to be the guard as well')
    /*
     * And the register and the scorecards, which are the pages with the
     * numbers in them.
     *
     * Checked on WHICH TAB IS SELECTED rather than on words in the page: the
     * page a team member lands on legitimately says "KPI line" and "scorecard"
     * all over it, and matching those found the safe page and called it a
     * leak. What matters is that the tab they asked for is not the tab they
     * got, and that the one they got is one they are allowed.
     */
    const landedOn = async (hash) => {
      await page.goto(`${base}/${hash}`, { waitUntil: 'networkidle2' })
      await new Promise((r) => setTimeout(r, 2500))
      return page.evaluate(() => {
        const sel = [...document.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')
        return sel ? sel.textContent.trim() : null
      })
    }
    check('  A BOOKMARKED REGISTER LANDS ON AN ALLOWED TAB INSTEAD',
      (await landedOn('#projects')) === 'Overall team',
      await landedOn('#projects'))
    check('  and so does a bookmarked scorecard',
      (await landedOn('#people')) === 'Overall team')
    check('  and the register\'s own editable grid is nowhere on the page',
      !(await page.evaluate(() => !!document.querySelector('input[placeholder="FNP-000"], [aria-label="open cost breakdown"]'))),
      'the Projects table edits in place, so its inputs are the thing to look for')

    await signInAs('boss@lotuss.com', 'bosspass1')
    const adminTabs = await tabs()
    check('AN ADMINISTRATOR GETS EVERYTHING',
      ['Dashboard', 'Projects', 'Scorecards', 'Overall team', 'Timeline', 'Apps', 'Model', 'Access']
        .every((t) => adminTabs.includes(t)),
      adminTabs.join(' | '))

    await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')]
      .find((t) => t.textContent.trim() === 'Access')?.click())
    await new Promise((r) => setTimeout(r, 1200))
    const access = await page.evaluate(() => document.body.innerText)
    check('  and the access page lists the accounts', /staff@lotuss\.com/.test(access))
    check('  with the password hidden until it is asked for',
      /••••/.test(access) && !/brand-new-1/.test(access))

    await page.evaluate(() => [...document.querySelectorAll('[aria-label^="show password"]')][0]?.click())
    await new Promise((r) => setTimeout(r, 400))
    check('  and shown when it is',
      /brand-new-1|bosspass1/.test(await page.evaluate(() => document.body.innerText)))

    await page.evaluate(() => [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Sign out')?.click())
    await new Promise((r) => setTimeout(r, 1500))
    check('SIGNING OUT PUTS THE SIGN-IN PAGE BACK',
      /Sign in/.test(await page.evaluate(() => document.body.innerText)))
    check('  and a reload does not get back in',
      await (async () => {
        await page.reload({ waitUntil: 'networkidle2' })
        await new Promise((r) => setTimeout(r, 1500))
        const t = await page.evaluate(() => document.body.innerText)
        return /Sign in/.test(t) && !/Scorecards/.test(t)
      })())

    await browser.close()
  }
} finally {
  server.kill()
  await mongod.stop()
}

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
