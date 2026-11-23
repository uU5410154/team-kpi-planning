/**
 * QA, AREA C: the Projects page and a project's own page, end to end.
 *
 * A real server on a throwaway database, a fake Jira, an administrator and a
 * team member in real browsers. Nothing here touches the live site or a real
 * Jira; every name and date is invented.
 *
 *   node scripts/qa-projects.mjs            # all cases
 *   SHOT_DIR=/tmp/x node scripts/qa-projects.mjs   # and screenshots
 *
 * Cases C01–C25 of the QA round (2026-11-23). Prints one line per case.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MongoMemoryServer } from 'mongodb-memory-server'
import puppeteer from 'puppeteer-core'
import { weekOf } from '../src/lib/weekly.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOT = process.env.SHOT_DIR || null
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const day = (w, n) => { const d = new Date(`${w}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const WEEK = weekOf()

const results = []
const check = (id, ok, note = '') => {
  results.push({ id, ok: !!ok, note })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${String(note).replace(/\s+/g, ' ').slice(0, 220)}`)
}

/* ------------------------------------------------------------ fake Jira */
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const NAMES = Object.fromEntries(seed.people.map((p) => [`acc-${p.id}`, p.name]))
const ACC = Object.fromEntries(seed.people.map((p) => [p.id, `acc-${p.id}`]))
const P = seed.projects.find((p) => p.key === 'FNP-379') // James's: PL Forecast
const OTHER = seed.projects.find((p) => p.key === 'FNP-935') // James's too
const issues = new Map()
const put = (key, f) => issues.set(key, { key, ...f })
for (const p of seed.projects) if (p.jiraKey && !issues.has(p.jiraKey)) put(p.jiraKey, { summary: p.summary, type: 'Epic', status: 'In Progress', cat: 'indeterminate', assignee: p.pic ? ACC[p.pic] : null })
put('FNP-9001', { summary: 'Load the October actuals', assignee: ACC.james, parent: P.jiraKey, start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
put('FNP-9002', { summary: 'Allocation rule for shared cost', assignee: ACC.james, parent: P.jiraKey, start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
put('FNP-9003', { summary: 'Map the new cost lines', assignee: ACC.kade, parent: P.jiraKey, start: day(WEEK, 0), due: day(WEEK, 3), status: 'To Do', cat: 'new' })
const writes = []
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
    description: i.description || null,
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
    if (u.pathname === '/rest/api/3/myself') return send(200, { accountId: 'acc-app', displayName: 'App' })
    if (u.pathname === '/rest/api/3/user/search') {
      const q = (u.searchParams.get('query') || '').toLowerCase()
      const hit = Object.entries(NAMES).find(([, n]) => n.toLowerCase() === q)
      return send(200, hit ? [{ accountId: hit[0], displayName: hit[1], accountType: 'atlassian', active: true }] : [])
    }
    if (u.pathname === '/rest/api/3/search/jql') {
      const jql = body.jql || ''
      const lists = [...jql.matchAll(/(?:key|parent) IN \(([^)]*)\)/g)].map((x) => x[1].split(',').map((s) => s.trim().replace(/"/g, '')))
      const named = lists.flat()
      const acc = (jql.match(/assignee = "([^"]+)"/) || [])[1]
      const noEpics = /issuetype != /.test(jql)
      const onlyEpics = /issuetype = "/.test(jql)
      const list = [...issues.values()].filter((i) => (acc ? i.assignee === acc : true) && (!noEpics || i.type !== 'Epic') && (!onlyEpics || i.type === 'Epic')
        && (!lists.length || named.includes(i.key) || named.includes(i.parent)))
      return send(200, { issues: list.map(asRaw) })
    }
    let k = u.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/)
    if (k) { writes.push({ kind: 'comment', key: k[1] }); return send(201, { id: `c${writes.length}` }) }
    k = u.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/attachments$/)
    if (k) return send(200, [])
    k = u.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/)
    if (k) {
      if (req.method === 'GET') return send(200, { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }] })
      const i = issues.get(k[1])
      writes.push({ kind: 'transition', key: k[1] })
      if (i) { i.status = 'Done'; i.cat = 'done' }
      return send(204)
    }
    k = u.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/)
    if (k) {
      const i = issues.get(k[1])
      if (!i) return send(404, { errorMessages: ['Issue does not exist'] })
      if (req.method === 'PUT') {
        const f = body.fields || {}
        if ('description' in f) i.description = f.description
        if ('duedate' in f) i.due = f.duedate
        if ('customfield_10015' in f) i.start = f.customfield_10015
        writes.push({ kind: 'put', key: k[1], fields: Object.keys(f) })
        return send(204)
      }
      return send(200, asRaw(i))
    }
    return send(404, { errorMessages: [`fake Jira has no ${req.method} ${u.pathname}`] })
  })
})
const JPORT = 5620
await new Promise((r) => fake.listen(JPORT, r))

/* --------------------------------------------------------------- server */
console.log('starting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5621
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'qa-projects-token-'.padEnd(48, '7')
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'team_kpi_planning',
    AUTH_SECRET: 'qa-secret',
    AUTH_ADMIN_EMAILS: 'boss@lotuss.com,boss2@lotuss.com',
    KPI_SERVICE_TOKEN: TOKEN,
    JIRA_BASE_URL: `http://127.0.0.1:${JPORT}`,
    JIRA_EMAIL: 'app@lotuss.com',
    JIRA_API_TOKEN: 'fake-token',
    JIRA_ALLOW_WRITES: 'true',
    JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log',
    SMTP_USER: 'sender@gmail.com',
    APP_URL: 'https://kpi.example',
    LOTUS_API_KEY: '',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const serverErr = []
server.stderr.on('data', (b) => serverErr.push(String(b)))
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await sleep(300)
}
const call = async (method, path, b, who) => {
  const headers = { 'Content-Type': 'application/json' }
  if (who === 'service') headers.authorization = `Bearer ${TOKEN}`
  else if (who) headers.cookie = who
  const r = await fetch(base + path, { method, headers, body: b === undefined ? undefined : JSON.stringify(b) })
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }
}
const signUp = async (email, admin = false) => {
  await call('POST', '/api/auth/register', { email, password: 'password1' })
  if (!admin) await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}
const sharedPlan = async () => (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body
const sharedProject = async (key) => (await sharedPlan()).payload?.projects?.find((x) => x.key === key)

const exe = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
].find((x) => existsSync(x))

let browser
try {
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'qa' }, 'service')
  const boss = await signUp('boss@lotuss.com', true)
  const boss2 = await signUp('boss2@lotuss.com', true)
  const james = await signUp('james@lotuss.com')
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)

  // James reports on the project's two tasks: one finished, one blocked with a decision asked.
  const r1 = await call('POST', `/api/weekly/${WEEK}/jira/FNP-9001/update`, { progress: 'Loaded October actuals and reconciled them to the GL.', done: true }, james)
  const r2 = await call('POST', `/api/weekly/${WEEK}/jira/FNP-9002/update`, {
    progress: 'Drafted two options for the allocation rule.', done: false, reason: 'Waiting on a decision.', blocker: 'Finance has not chosen the driver yet.', decision: true, decisionText: 'Allocate shared cost by sales or by headcount?',
  }, james)
  if (r1.status !== 200 || r2.status !== 200) console.log('SETUP: member updates', r1.status, JSON.stringify(r1.body).slice(0, 200), r2.status, JSON.stringify(r2.body).slice(0, 200))

  if (!exe) throw new Error('no Chrome found')
  browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 60000 })
  const dialogs = []
  const as = async (cookie, vp = { width: 1440, height: 900 }) => {
    const pg = await (await browser.createBrowserContext()).newPage()
    await pg.setViewport(vp)
    const [n, v] = cookie.split('=')
    await pg.setCookie({ name: n, value: v, url: base })
    pg.on('dialog', (d) => { dialogs.push(d.message() || d.type()); d.accept() })
    pg.errors = []
    pg.on('pageerror', (e) => pg.errors.push(e.message))
    return pg
  }
  const shot = async (pg, name, full = false) => { if (SHOT) await pg.screenshot({ path: `${SHOT}/${name}.png`, fullPage: full }) }
  const open = async (pg, hash) => {
    await pg.goto(`${base}/?go#${hash}`, { waitUntil: 'networkidle0', timeout: 90000 })
    await pg.waitForFunction(() => !document.querySelector('[data-save-status]') || !/Loading the shared plan/.test(document.body.innerText), { timeout: 30000 }).catch(() => {})
    await sleep(1500)
  }
  const waitSaved = (pg) => pg.waitForFunction(() => document.querySelector('[data-save-status]')?.dataset.saveStatus === 'saved', { timeout: 30000 }).then(() => true).catch(() => false)
  const noSideways = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
  const rowOf = (key) => `[data-register-table] tbody tr:has([data-open-project="${key}"])`

  const a = await as(boss)

  /* C01 — full width, no sideways scroll */
  await open(a, 'projects')
  await a.waitForSelector('[data-register-table]', { timeout: 30000 })
  const c01 = {}
  for (const w of [1280, 1440]) {
    await a.setViewport({ width: w, height: 900 }); await sleep(700)
    c01[w] = await a.evaluate(() => {
      const t = document.querySelector('[data-register-table]')
      const box = (t.closest('[class*="MuiPaper"]') || t.parentElement).getBoundingClientRect()
      // The side menu's right edge: the content starts there.
      const nav = [...document.querySelectorAll('div')].map((e) => e.getBoundingClientRect()).filter((r) => r.left < 40 && r.width > 150 && r.width < 400 && r.height > 500).sort((x, y) => y.right - x.right)[0]
      const left = nav ? nav.right : 0
      return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, gapLeft: Math.round(box.left - left), gapRight: Math.round(document.documentElement.clientWidth - box.right) }
    })
  }
  await a.setViewport({ width: 1440, height: 900 }); await sleep(500)
  check('C01', Object.values(c01).every((x) => x.sw <= x.cw + 1 && x.gapLeft <= 40 && x.gapRight <= 40), JSON.stringify(c01))
  await shot(a, 'c01-projects')

  /* C02 — Team / Sub team / Programme dropdowns save and survive reload */
  const c02 = await (async () => {
    const sel = `${rowOf(P.key)} input[aria-label="Programme"]`
    await a.click(sel)
    await a.waitForSelector('[role="listbox"] [role="option"]', { timeout: 5000 })
    const opts = await a.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.innerText.trim()))
    await a.keyboard.type('QA Programme Z')
    await sleep(300)
    const add = await a.evaluate(() => [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.innerText.trim()))
    await a.keyboard.press('Enter')
    await sleep(300)
    const saved = await waitSaved(a)
    const srv = await sharedProject(P.key)
    await a.reload({ waitUntil: 'networkidle0' }); await sleep(2500)
    const after = await a.evaluate((s) => document.querySelector(s)?.value, sel)
    return { opts: opts.slice(0, 4), add: add.slice(0, 2), saved, server: srv?.program, after }
  })().catch((e) => ({ error: e.message }))
  check('C02', c02.server === 'QA Programme Z' && c02.after === 'QA Programme Z' && c02.add?.some((o) => /Add "QA Programme Z"/.test(o)), JSON.stringify(c02))

  /* C03 — a faded row says why it is not counted */
  // The partners' rows (IT, User) are the ones delivered by somebody else: show them first.
  await a.evaluate(() => document.querySelector('[data-show-partners]')?.click()); await sleep(500)
  const c03 = await a.evaluate(() => {
    const pills = [...document.querySelectorAll('[data-not-counted]')]
    const faded = pills.map((x) => window.getComputedStyle(x).opacity)
    return { n: pills.length, first: pills[0]?.innerText, faded: faded[0] }
  })
  await a.evaluate(() => document.querySelector('[data-projects-clear]')?.click()); await sleep(300)
  check('C03', c03.n > 0 && /not counted · /i.test(c03.first || ''), JSON.stringify(c03))

  /* C04 — one obvious Clear for search and filters */
  const c04 = await (async () => {
    const before = await a.evaluate(() => {
      const b = document.querySelector('[data-projects-clear]')
      return b ? { there: true, disabled: b.disabled, inRow: !!b.closest('#project-filters, [data-projects-filterbar]') } : { there: false }
    })
    const search = 'input[placeholder^="Search key, project"]'
    await a.click(search, { clickCount: 3 }); await a.type(search, 'Forecast'); await sleep(400)
    const typed = await a.evaluate(() => ({ shown: (document.body.innerText.match(/Showing (\d+) of/) || [])[1], clear: !!document.querySelector('[data-projects-clear]') && !document.querySelector('[data-projects-clear]').disabled }))
    await a.evaluate(() => document.querySelector('[data-projects-clear]')?.click()); await sleep(400)
    const after = await a.evaluate(() => ({ q: document.querySelector('input[placeholder^="Search key, project"]').value, disabled: document.querySelector('[data-projects-clear]')?.disabled }))
    return { before, typed, after }
  })().catch((e) => ({ error: e.message }))
  check('C04', c04.before?.there && c04.before.disabled && c04.typed?.clear && c04.after?.q === '' && c04.after.disabled === true, JSON.stringify(c04))

  /* C05 — a new project shows on the Timeline and its own page */
  const c05 = await (async () => {
    const keysBefore = (await a.evaluate(() => JSON.parse(localStorage.getItem('fa-tech-kpi-2026')).projects.map((x) => x.key)))
    // With a search still in the box, as somebody would have.
    const search = 'input[placeholder^="Search key, project"]'
    await a.click(search, { clickCount: 3 }); await a.type(search, 'Forecast'); await sleep(300)
    await a.click('[data-add-project]')
    await sleep(1200)
    const st = await a.evaluate(() => JSON.parse(localStorage.getItem('fa-tech-kpi-2026')).projects)
    const added = st.find((x) => !keysBefore.includes(x.key))
    if (!added) return { error: 'no project added' }
    const ui = await a.evaluate(() => ({ q: document.querySelector('input[placeholder^="Search key, project"]').value, focusedInName: !!document.activeElement?.closest('[data-name-editing]'), selected: document.activeElement?.selectionEnd - document.activeElement?.selectionStart }))
    // Typed straight over the name, which is open and selected.
    const naming = ui.focusedInName
    if (naming) {
      await a.keyboard.type('QA Commercial process')
      await a.keyboard.press('Enter'); await sleep(400)
      await a.evaluate(() => document.activeElement?.blur())
    }
    await sleep(500)
    const saved = await waitSaved(a)
    const srv = await sharedProject(added.key)
    await open(a, 'timeline')
    await a.type('input[placeholder="Search key, project, programme"]', 'QA Commercial'); await sleep(800)
    const tl = await a.evaluate(() => ({ setDates: document.querySelectorAll('[data-timeline-set-dates]').length, text: document.body.innerText.includes('QA Commercial process') }))
    await open(a, `project/${added.key}`)
    const page = await a.evaluate(() => ({ h: document.querySelector('h2')?.innerText }))
    return { key: added.key, ui, naming, saved, server: srv?.summary, tl, page }
  })().catch((e) => ({ error: e.message }))
  check('C05', c05.ui?.q === '' && c05.naming && c05.server === 'QA Commercial process' && c05.tl?.setDates === 1 && c05.page?.h === 'QA Commercial process', JSON.stringify(c05))
  const NEW_KEY = c05.key

  /* C06 — a row opens the project; closing keeps the page as it was */
  const c06 = await (async () => {
    await open(a, 'projects')
    const search = 'input[placeholder^="Search key, project"]'
    await a.type(search, 'Dashboard'); await sleep(500)
    await a.evaluate(() => window.scrollTo(0, 200))
    const y0 = await a.evaluate(() => window.scrollY)
    const key = await a.evaluate(() => document.querySelector('[data-register-table] [data-open-project]')?.dataset.openProject)
    await a.evaluate((k) => document.querySelector(`[data-open-project="${k}"]`).click(), key)
    await a.waitForSelector('[data-project-detail] h2', { timeout: 10000 })
    const title = await a.evaluate(() => document.querySelector('[data-project-detail] h2')?.innerText)
    await shot(a, 'c06-detail')
    await a.keyboard.press('Escape'); await sleep(600)
    const after = await a.evaluate(() => ({ q: document.querySelector('input[placeholder^="Search key, project"]').value, y: window.scrollY, open: !!document.querySelector('[data-project-detail] h2') }))
    return { key, title, y0, after }
  })().catch((e) => ({ error: e.message }))
  check('C06', c06.title && !c06.after?.open && c06.after?.q === 'Dashboard' && Math.abs((c06.after?.y ?? -99) - c06.y0) < 5, JSON.stringify(c06))

  /* C07 — the project page shows what the member sent */
  await open(a, `project/${P.key}`)
  await a.waitForFunction(() => /Week by week/.test(document.body.innerText) && !/Loading check-ins/.test(document.body.innerText), { timeout: 20000 }).catch(() => {})
  await sleep(1500)
  const c07 = await a.evaluate(() => {
    const s = document.querySelector('section[aria-label="week by week"]')?.innerText || ''
    return { text: s.slice(0, 600), hasProgress: s.includes('Loaded October actuals'), done: /DONE/i.test(s), who: s.includes('James'), sent: /sent /.test(s) }
  })
  check('C07', c07.hasProgress && c07.done && c07.who && c07.sent, JSON.stringify(c07).slice(0, 300))
  await shot(a, 'c07-project', true)

  /* C12 — the Active pill says why */
  const c12 = await a.evaluate(() => {
    const el = document.querySelector('[data-active-pill]')
    const pill = el?.querySelector('[title]') || el?.firstElementChild
    return { on: el?.dataset.activePill, why: el?.dataset.activeWhy, title: pill?.getAttribute('title'), text: el?.parentElement?.innerText }
  })
  check('C12', c12.on && c12.why && /This week: /.test(c12.title || ''), JSON.stringify(c12))

  /* C14 — the Jira link goes to the issue */
  const c14 = await a.evaluate((k) => [...document.querySelectorAll('a')].find((x) => x.innerText.trim().startsWith(k))?.href || null, P.jiraKey)
  check('C14', c14 === `http://127.0.0.1:${JPORT}/browse/${P.jiraKey}`, String(c14))

  /* C21 — this week's Jira tasks under it, with holder and status */
  const c21 = await a.evaluate(() => {
    const s = document.querySelector('section[aria-label="in jira this week"]')?.innerText || ''
    return { there: !!s, kade: /FNP-9003/.test(s) && /Kade/.test(s), status: /To Do/i.test(s), text: s.slice(0, 300) }
  })
  check('C21', c21.there && c21.kade && c21.status, JSON.stringify(c21))

  /* C22 — blockers and decisions on its page */
  const c22 = await a.evaluate(() => ({
    blocker: (document.querySelector('section[aria-label="in the way"]')?.innerText || '').includes('Finance has not chosen the driver'),
    decision: (document.body.innerText).includes('Allocate shared cost by sales or by headcount?'),
  }))
  check('C22', c22.blocker && c22.decision, JSON.stringify(c22))

  /* C23 — the header names the project */
  const c23 = await a.evaluate(() => ({ head: document.querySelector('header h4, header .MuiTypography-h4')?.innerText, title: document.title }))
  check('C23', (c23.head || '').includes(P.summary) || (c23.title || '').includes(P.summary), JSON.stringify(c23))

  /* C25 — every action has a label or tooltip */
  const c25 = await a.evaluate(() => {
    const main = document.querySelector('main') || document.body
    const bad = [...main.querySelectorAll('button, a, [role="button"]')].filter((b) => b.offsetParent && !(b.innerText.trim() || b.getAttribute('aria-label') || b.getAttribute('title') || b.closest('[title]')))
    return bad.map((b) => b.outerHTML.slice(0, 120))
  })
  check('C25', c25.length === 0, JSON.stringify(c25).slice(0, 300))

  /* C08 — status changed on the project page shows on Projects and Timeline */
  const c08 = await (async () => {
    await a.click('[data-status-picker]'); await sleep(300)
    await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.innerText.trim() === 'Done')?.click())
    await sleep(500)
    const saved = await waitSaved(a)
    const srv = await sharedProject(P.key)
    await open(a, 'projects')
    const row = await a.evaluate((s) => document.querySelector(s)?.innerText || '', rowOf(P.key))
    await open(a, 'timeline')
    await a.type('input[placeholder="Search key, project, programme"]', P.jiraKey); await sleep(700)
    const tl = await a.evaluate(() => [...document.querySelectorAll('[data-timeline-status]')].map((x) => x.innerText.trim()).filter(Boolean))
    return { saved, server: srv?.status, row: /\bDone\b/i.test(row), tl }
  })().catch((e) => ({ error: e.message }))
  check('C08', c08.server === 'Done' && c08.row && c08.tl?.some((x) => /done/i.test(x)), JSON.stringify(c08))

  /* C09 — dates changed on the project page move the Timeline bar */
  const c09 = await (async () => {
    await open(a, `project/${OTHER.key}`)
    const btn = await a.$('[data-edit-dates]')
    if (!btn) return { error: 'no way to change the dates on the project page' }
    await btn.click(); await sleep(400)
    await a.evaluate(() => {
      const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }
      const [s, d] = [...document.querySelectorAll('[data-dates-editor] input[type="date"]')]
      set(s, '2026-10-01'); set(d, '2026-12-15')
    })
    await sleep(200)
    await a.evaluate(() => [...document.querySelectorAll('[data-dates-editor] button')].find((b) => /^Save/.test(b.innerText.trim()))?.click())
    await sleep(800)
    const fact = await a.evaluate(() => document.body.innerText.includes('15 Dec 2026'))
    const saved = await waitSaved(a)
    const srv = await sharedProject(OTHER.key)
    const jiraPut = writes.some((w) => w.kind === 'put' && w.key === OTHER.jiraKey && w.fields.includes('duedate'))
    return { fact, saved, start: srv?.start, due: srv?.due, jiraPut }
  })().catch((e) => ({ error: e.message }))
  check('C09', c09.fact && c09.start === '2026-10-01' && c09.due === '2026-12-15' && c09.jiraPut, JSON.stringify(c09))

  /* C10 — an unknown key */
  await open(a, 'project/NOPE-1')
  const c10 = await a.evaluate(() => {
    const al = [...document.querySelectorAll('[role="alert"]')].map((x) => x.innerText).join(' | ')
    return { alert: al.slice(0, 200), back: [...document.querySelectorAll('[role="alert"] button, [role="alert"] a')].map((b) => b.innerText.trim()) }
  })
  check('C10', /no project NOPE-1/i.test(c10.alert) && c10.back.length > 0, JSON.stringify(c10))

  /* C13 — on hold, then Resume, everywhere */
  const c13 = await (async () => {
    await open(a, `project/${OTHER.key}`)
    await a.click('[data-status-picker]'); await sleep(300)
    await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.innerText.trim() === 'On Hold')?.click())
    await sleep(600)
    const held = await a.evaluate(() => ({ pill: /On Hold/i.test(document.querySelector('[data-status-picker]')?.innerText || ''), resume: !!document.querySelector('[data-resume]') }))
    await waitSaved(a)
    const s1 = await sharedProject(OTHER.key)
    await a.evaluate(() => document.querySelector('[data-resume]')?.click()); await sleep(600)
    await waitSaved(a)
    const s2 = await sharedProject(OTHER.key)
    const after = await a.evaluate(() => ({ pill: document.querySelector('[data-status-picker]')?.innerText, resume: !!document.querySelector('[data-resume]') }))
    return { held, heldOnServer: !!s1?.onHold, resumedOnServer: !s2?.onHold, after }
  })().catch((e) => ({ error: e.message }))
  check('C13', c13.held?.pill && c13.held.resume && c13.heldOnServer && c13.resumedOnServer && !c13.after?.resume, JSON.stringify(c13))

  /* C15 — the project page on a phone */
  const ph = await as(boss, { width: 390, height: 844 })
  await open(ph, `project/${P.key}`)
  const c15 = { sideways: !(await noSideways(ph)), h: await ph.evaluate(() => getComputedStyle(document.querySelector('h2')).fontSize) }
  await shot(ph, 'c15-phone', true)
  check('C15', !c15.sideways, JSON.stringify(c15))
  await ph.close()

  /* C16 — two administrators, one field */
  const c16 = await (async () => {
    const doc = await sharedPlan()
    const baseAt = doc.updatedAt
    const edit = (summary) => ({ ...doc.payload, projects: doc.payload.projects.map((x) => (x.key === OTHER.key ? { ...x, comment: summary } : x)) })
    const first = await call('PUT', '/api/scenarios/Baseline', { payload: edit('First admin’s note'), updatedBy: 'boss', baseUpdatedAt: baseAt }, boss)
    const second = await call('PUT', '/api/scenarios/Baseline', { payload: edit('Second admin’s note'), updatedBy: 'boss2', baseUpdatedAt: baseAt }, boss2)
    const kept = (await sharedProject(OTHER.key))?.comment
    return { first: first.status, second: second.status, conflicts: second.body?.conflicts?.length, kept }
  })().catch((e) => ({ error: e.message }))
  check('C16', c16.first === 200 && c16.second === 409 && c16.conflicts > 0 && c16.kept === 'First admin’s note', JSON.stringify(c16))

  /* C17 — a deleted project is gone everywhere */
  const c17 = await (async () => {
    if (!NEW_KEY) return { error: 'no new project from C05' }
    await open(a, 'projects')
    await a.evaluate((s) => document.querySelector(`${s} input[type="checkbox"]`)?.click(), rowOf(NEW_KEY)); await sleep(300)
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Delete/.test(b.innerText.trim()))?.click()); await sleep(500)
    // A confirm dialog, if there is one.
    await a.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /^Delete/.test(b.innerText.trim()))?.click()); await sleep(600)
    await waitSaved(a)
    const projects = await a.evaluate((k) => !!document.querySelector(`[data-open-project="${k}"]`), NEW_KEY)
    await open(a, 'timeline')
    await a.type('input[placeholder="Search key, project, programme"]', 'QA Commercial'); await sleep(700)
    const tl = await a.evaluate(() => document.body.innerText.includes('QA Commercial process'))
    await open(a, 'dashboard')
    await sleep(2500)
    const dash = await a.evaluate(() => document.body.innerText.includes('QA Commercial process'))
    const srv = await sharedProject(NEW_KEY)
    return { projects, tl, dash, server: srv ? (srv.deleted ? 'flagged' : 'still there') : 'gone' }
  })().catch((e) => ({ error: e.message }))
  check('C17', c17.projects === false && c17.tl === false && c17.dash === false && c17.server !== 'still there', JSON.stringify(c17))

  /* C18 — no stray "Leave site?" after saving */
  const c18 = await (async () => {
    await open(a, 'projects')
    const n0 = dialogs.length
    await a.click(`${rowOf(P.key)} input[aria-label="Team"]`); await sleep(300)
    await a.keyboard.press('ArrowDown'); await a.keyboard.press('Enter'); await sleep(300)
    await a.evaluate(() => document.activeElement?.blur())
    // The "Saved" still showing from the last edit is not this edit's: wait for this one to start saving first.
    await a.waitForFunction(() => document.querySelector('[data-save-status]')?.dataset.saveStatus !== 'saved', { timeout: 8000 }).catch(() => {})
    const saved = await waitSaved(a)
    await open(a, 'timeline')
    await open(a, 'projects')
    return { saved, dialogs: dialogs.length - n0 }
  })().catch((e) => ({ error: e.message }))
  check('C18', c18.saved && c18.dialogs === 0, JSON.stringify(c18))

  /* C19 — a long name does not break the table */
  const c19 = await (async () => {
    const long = 'A very long project name that keeps going '.repeat(5).trim()
    await a.evaluate((k) => document.querySelector(`[data-rename-project="${k}"]`)?.click(), OTHER.key); await sleep(300)
    await a.evaluate(() => document.querySelector('[data-name-editing] input')?.select())
    await a.keyboard.type(long); await a.keyboard.press('Enter'); await sleep(300)
    await a.evaluate(() => document.activeElement?.blur()); await sleep(500)
    const r = await a.evaluate((k) => {
      const link = document.querySelector(`[data-open-project="${k}"]`)
      const tr = link?.closest('tr')
      return { rowH: Math.round(tr?.getBoundingClientRect().height || 0), title: link?.getAttribute('title'), sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cell: Math.round(link?.closest('td')?.getBoundingClientRect().width || 0) }
    }, OTHER.key)
    return r
  })().catch((e) => ({ error: e.message }))
  check('C19', c19.sw <= c19.cw + 1 && c19.rowH < 140 && c19.cell <= 340, JSON.stringify(c19))

  /* C20 — a dropdown by keyboard */
  const c20 = await (async () => {
    const sel = `${rowOf(P.key)} input[aria-label="Sub team"]`
    await a.focus(sel)
    await a.keyboard.press('ArrowDown'); await sleep(300)
    const opened = await a.evaluate(() => document.querySelectorAll('[role="listbox"] [role="option"]').length)
    await a.keyboard.press('Escape'); await sleep(200)
    const closed = await a.evaluate(() => document.querySelectorAll('[role="listbox"]').length === 0)
    // Away and back, as Tab would: the value is selected, so typing replaces it.
    await a.evaluate(() => document.activeElement?.blur()); await sleep(200)
    await a.focus(sel)
    await a.keyboard.type('QA Sub K'); await sleep(200)
    await a.keyboard.press('Enter'); await sleep(400)
    const v = await a.evaluate((s) => document.querySelector(s)?.value, sel)
    return { opened, closed, v }
  })().catch((e) => ({ error: e.message }))
  check('C20', c20.opened > 0 && c20.closed && c20.v === 'QA Sub K', JSON.stringify(c20))

  /* C24 — an edit says it was saved */
  const c24 = await (async () => {
    await a.click(`${rowOf(P.key)} input[aria-label="Programme"]`, { clickCount: 1 }); await sleep(200)
    await a.keyboard.type('QA Programme Y'); await a.keyboard.press('Enter'); await sleep(300)
    await a.evaluate(() => document.activeElement?.blur())
    const seen = []
    for (let i = 0; i < 30; i++) {
      const s = await a.evaluate(() => document.querySelector('[data-save-status]')?.dataset.saveStatus || null)
      if (s && seen.at(-1) !== s) seen.push(s)
      if (s === 'saved' && seen.length > 1) break
      await sleep(500)
    }
    return { seen }
  })().catch((e) => ({ error: e.message }))
  check('C24', c24.seen?.includes('saving') && c24.seen?.at(-1) === 'saved', JSON.stringify(c24))

  /* C11 — a member and a project page */
  const m = await as(james)
  await m.goto(`${base}/#project/${P.key}`, { waitUntil: 'networkidle0', timeout: 90000 }); await sleep(3000)
  const c11 = await m.evaluate(() => ({ hash: window.location.hash, text: (document.querySelector('main') || document.body).innerText.slice(0, 400) }))
  await shot(m, 'c11-member')
  check('C11', /project|not open|administrator/i.test(c11.text) && !/Week by week/.test(c11.text) && c11.text.length > 20, JSON.stringify(c11))

  const errs = [...new Set([...(a.errors || []), ...(m.errors || [])])]
  if (errs.length) console.log('PAGE ERRORS', JSON.stringify(errs).slice(0, 600))
} catch (e) {
  console.log('CRASH', e.stack)
} finally {
  const srvErrs = serverErr.filter((s) => /error/i.test(s) && !/ExperimentalWarning/.test(s))
  if (srvErrs.length) console.log('SERVER ERRORS', srvErrs.join('').slice(0, 800))
  const order = Array.from({ length: 25 }, (_, i) => `C${String(i + 1).padStart(2, '0')}`)
  const by = Object.fromEntries(results.map((r) => [r.id, r]))
  console.log(`\n${order.map((id) => `${id} ${by[id] ? (by[id].ok ? 'PASS' : 'FAIL') : 'NOT RUN'}`).join(' · ')}`)
  const failed = order.filter((id) => !by[id]?.ok)
  console.log(failed.length ? `\n${failed.length} CASE(S) NOT PASSING` : '\nall area C cases pass')
  await browser?.close().catch(() => {})
  server.kill(); await mongod.stop(); fake.close()
  process.exit(failed.length ? 1 : 0)
}
