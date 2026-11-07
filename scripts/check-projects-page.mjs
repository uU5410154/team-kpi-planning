/**
 * The Projects register page: fits every screen, a phone gets cards, an
 * administrator hides columns for everybody, and a project opens in a popup.
 *
 * Runs the real server against a real mongod and drives the built app in
 * Chrome (run `npm run build` first).
 *
 *   node scripts/check-projects-page.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { cleanHiddenColumns, PROJECT_COLUMNS } from '../src/lib/projectColumns.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('\n--- the hidden columns, cleaned ---')
check('KNOWN IDS KEPT, EACH ONCE; junk dropped',
  JSON.stringify(cleanHiddenColumns(['pic', 'pic', 'summary', '<x>', 7, null, 'roi'])) === '["pic","roi"]')
check('not a list, not a choice', cleanHiddenColumns('pic') === null && cleanHiddenColumns({}) === null)
check('capped', cleanHiddenColumns(Array(5000).fill('pic')).length === 1)
check('the name can never be hidden', !PROJECT_COLUMNS.some((c) => c.id === 'summary'))

/* --------------------------------------------------------------- server */

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5371
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'projects-service-token-'.padEnd(48, '5')
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
const as = async (cookie, vp) => {
  const pg = await (await browser.createBrowserContext()).newPage()
  await pg.setViewport(vp)
  const [n, v] = cookie.split('=')
  await pg.setCookie({ name: n, value: v, url: base })
  pg.on('dialog', (d) => d.accept().catch(() => {}))
  return pg
}
const heads = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-register-table] thead th')].map((h) => h.innerText.trim().toLowerCase()))
const dialogs = (pg) => pg.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText))

try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const deputy = await signUp('deputy@lotuss.com')
  const james = await signUp('james@lotuss.com')

  console.log('\n--- the setting, on the server ---')
  check('nothing hidden to begin with', JSON.stringify((await call('GET', '/api/projects/columns', undefined, boss)).body.hidden) === '[]')
  check('A MEMBER CAN READ IT', (await call('GET', '/api/projects/columns', undefined, james)).status === 200)
  check('A MEMBER CANNOT SAVE IT (403)', (await call('PUT', '/api/projects/columns', { hidden: ['pic'] }, james)).status === 403)
  check('nobody signed in cannot read it', (await call('GET', '/api/projects/columns')).status === 401)
  check('hidden columns are a list', (await call('PUT', '/api/projects/columns', { hidden: 'pic' }, boss)).status === 400)
  const junk = await call('PUT', '/api/projects/columns', { hidden: ['roi', 'summary', '$where', 'roi'] }, boss)
  check('  and only known columns are kept', junk.status === 200 && JSON.stringify(junk.body.hidden) === '["roi"]', JSON.stringify(junk.body))
  await call('PUT', '/api/projects/columns', { hidden: [] }, boss)

  const chrome = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find((p) => p && existsSync(p))
  if (!chrome || !existsSync(new URL('../dist/index.html', import.meta.url))) {
    console.log('\nSKIP  browser checks — no Chrome, or run `npm run build` first')
  } else {
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })

    console.log('\n--- every screen size ---')
    for (const width of [390, 768, 1280, 1440]) {
      const pg = await as(boss, { width, height: 900 })
      await pg.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
      await sleep(600)
      const r = await pg.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
        table: !!document.querySelector('[data-register-table]'),
        cards: document.querySelectorAll('[data-project-card]').length,
        columns: !!document.querySelector('[data-columns-button]'),
        held: (() => {
          const td = document.querySelector('[data-register-table] tbody tr td')
          return td ? getComputedStyle(td).position : null
        })(),
        cue: document.querySelector('[data-scroll-cue]')?.dataset.scrollCue || null,
      }))
      check(`@${width}px: NO HORIZONTAL PAGE SCROLL`, r.sw <= r.cw + 1, `${r.sw} vs ${r.cw}`)
      if (width === 390) {
        check('  a phone shows cards, not the wide table', !r.table && r.cards > 50, JSON.stringify(r))
        check('  and no Columns control (cards have no columns)', !r.columns)
      } else {
        check('  the table, not cards', r.table && r.cards === 0, JSON.stringify(r))
        check('  its first columns are held while it scrolls', r.held === 'sticky', String(r.held))
        if (width === 768) check('  and a fade at the edge says there is more', r.cue === 'on', String(r.cue))
      }
      await pg.browserContext().close()
    }

    console.log('\n--- an administrator hides a column, for everybody ---')
    const a = await as(boss, { width: 1440, height: 900 })
    await a.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
    await sleep(600)
    check('the PIC column shows to begin with', (await heads(a)).includes('pic'))
    await a.click('[data-columns-button]')
    await sleep(300)
    await a.click('[data-column="pic"]')
    await sleep(800)
    await a.keyboard.press('Escape')
    await sleep(300)
    check('HIDDEN AT ONCE for the administrator', !(await heads(a)).includes('pic'), (await heads(a)).join(','))
    const stored = await call('GET', '/api/projects/columns', undefined, james)
    check('SAVED ON THE SERVER — a member reads it too', JSON.stringify(stored.body.hidden) === '["pic"]' && stored.body.updatedBy === 'boss@lotuss.com', JSON.stringify(stored.body))
    const d = await as(deputy, { width: 1440, height: 900 })
    await d.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
    await sleep(600)
    const dh = await heads(d)
    check('ANOTHER ADMINISTRATOR, IN ANOTHER BROWSER, DOES NOT SEE IT', dh.length > 5 && !dh.includes('pic') && dh.includes('objective'), dh.join(','))
    await d.reload({ waitUntil: 'networkidle0' })
    await sleep(600)
    check('  and still not after a reload', !(await heads(d)).includes('pic'))
    check('  head and body agree, cell for cell', await d.evaluate(() => {
      const t = document.querySelector('[data-register-table]')
      return t.querySelectorAll('thead th').length === t.querySelector('tbody tr').children.length
    }))
    await d.browserContext().close()

    console.log('\n--- a project opens in a popup ---')
    const name = await a.evaluate(() => document.querySelector('[data-open-project]').closest('td').querySelector('input').value)
    await a.click('[data-open-project]')
    await sleep(800)
    let ds = await dialogs(a)
    check('CLICKING A PROJECT OPENS ITS DETAIL, with its name', ds.length === 1 && ds[0].includes(name) && /open full page/i.test(ds[0]), `${name} | ${(ds[0] || '').slice(0, 80)}`)
    check('  and a link to the full page', await a.evaluate(() => !!document.querySelector('[role="dialog"] a[href^="#project/"]')))
    // An edit in the popup goes through the page's own update.
    await a.evaluate(() => document.querySelector('[role="dialog"] [aria-label="active project"]').click())
    await sleep(300)
    await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Always/.test(m.innerText))?.click())
    await sleep(500)
    check('THE ACTIVE SWITCH IN THE POPUP CHANGES THE PROJECT',
      (await a.evaluate(() => document.querySelector('[role="dialog"] [aria-label="active project"]')?.dataset.activeMode)) === 'on')
    // The cost sheet from inside the popup.
    await a.evaluate(() => document.querySelector('[data-open-cost-sheet]').click())
    await sleep(700)
    ds = await dialogs(a)
    check('THE COST SHEET OPENS FROM THE POPUP', ds.length === 2 && /CAPEX/.test(ds[1]) && /Monthly cost/i.test(ds[1]), String(ds.length))
    await a.keyboard.press('Escape')
    await sleep(500)
    await a.keyboard.press('Escape')
    await sleep(500)
    check('ESC CLOSES THEM', (await dialogs(a)).length === 0)

    // The row, away from its editable cells, opens it too.
    await a.evaluate(() => {
      const hs = [...document.querySelectorAll('[data-register-table] thead th')].map((h) => h.innerText.trim().toLowerCase())
      document.querySelector('[data-register-table] tbody tr').children[hs.indexOf('fte')].click()
    })
    await sleep(700)
    ds = await dialogs(a)
    check('A CLICK ON THE ROW OPENS THE DETAIL, not the cost sheet', ds.length === 1 && /open full page/i.test(ds[0]) && !/Monthly cost/i.test(ds[0]))
    await a.keyboard.press('Escape')
    await sleep(500)
    await a.evaluate(() => document.querySelector('[data-register-table] tbody tr input').click())
    await sleep(400)
    check('  a click on an input does not', (await dialogs(a)).length === 0)

    // The receipt button still goes straight to the cost sheet.
    await a.evaluate(() => document.querySelector('tbody tr button[aria-label="open cost breakdown"]').click())
    await sleep(700)
    ds = await dialogs(a)
    check('THE ROW\'S RECEIPT BUTTON STILL OPENS THE COST SHEET', ds.length === 1 && /Monthly cost/i.test(ds[0]))
    await a.keyboard.press('Escape')
    await sleep(400)

    console.log('\n--- on a phone ---')
    const ph = await as(boss, { width: 390, height: 844 })
    await ph.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
    await sleep(600)
    const card = await ph.evaluate(() => {
      const c = document.querySelector('[data-project-card]')
      return { key: c.dataset.projectCard, text: c.innerText }
    })
    await ph.click('[data-project-card]')
    await sleep(800)
    const full = await ph.evaluate(() => {
      const p = document.querySelector('[role="dialog"]')
      if (!p) return null
      const r = p.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), text: p.innerText }
    })
    check('TAPPING A CARD OPENS THE PROJECT, FULL SCREEN',
      !!full && full.w === 390 && full.h === 844 && full.text.includes(card.text.split('\n')[0]), JSON.stringify({ ...full, text: full?.text.slice(0, 60) }))
    await ph.keyboard.press('Escape')
    await sleep(500)
    check('  and Esc closes it', (await dialogs(ph)).length === 0)
    const filters = await ph.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^Filters/.test(x.innerText.trim()))
      const before = getComputedStyle(document.getElementById('project-filters')).display
      b.click()
      return { before, b: !!b }
    })
    await sleep(300)
    const after = await ph.evaluate(() => getComputedStyle(document.getElementById('project-filters')).display)
    check('A PHONE FOLDS THE FILTERS BEHIND A BUTTON', filters.b && filters.before === 'none' && after === 'grid', `${filters.before} -> ${after}`)
    await ph.browserContext().close()

    console.log('\n--- and back ---')
    await a.click('[data-columns-button]')
    await sleep(300)
    await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Show every column/.test(m.innerText)).click())
    await sleep(800)
    check('SHOW EVERY COLUMN puts it back, on the server too',
      JSON.stringify((await call('GET', '/api/projects/columns', undefined, james)).body.hidden) === '[]')
    await a.browserContext().close()
  }
} catch (e) {
  failures++
  console.log(`FAIL  the suite crashed — ${e.stack}`)
} finally {
  if (browser) await browser.close()
  server.kill()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall projects page checks passed')
process.exit(failures ? 1 : 0)
