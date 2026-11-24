/**
 * QA: THE TIMELINE, END TO END (cases D01–D25).
 *
 * The real server and the built page, against an in-memory database and a
 * fake Jira — nothing here talks to the live site or to a real Jira. An
 * administrator and a team member (Gun) each drive the page in a browser.
 *
 *   npm run build && node scripts/qa-timeline.mjs
 *   SHOT_DIR=/some/dir node scripts/qa-timeline.mjs   # with screenshots
 *
 * Ports 5630–5639.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { weekOf } from '../src/lib/weekly.js'
import { computePlan, repairState } from '../src/lib/model.js'
import { statusChoice } from '../src/lib/projectStatus.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOT = process.env.SHOT_DIR || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const day = (w, n) => { const d = new Date(`${w}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const results = []
const check = (id, label, ok, detail = '') => {
  results.push({ id, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${label}${detail ? ` — ${detail}` : ''}`)
}

const exe = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => existsSync(p))
if (!exe) { console.log('SKIP — no Chromium-based browser found'); process.exit(0) }

const WEEK = weekOf()

/* ---------------------------------------------------------- the register */
const seed = JSON.parse(readFileSync(`${ROOT}/src/data/seed.json`, 'utf8'))

const acc = Object.fromEntries(seed.people.map((p) => [p.id, `acc-${p.id}`]))
const nameOfAcc = Object.fromEntries(seed.people.map((p) => [acc[p.id], p.name]))
const projects = seed.projects.map((p) => ({ ...p }))
const byKey = (k) => projects.find((p) => p.key === k)
// An undated project added on the Projects page.
projects.push({ ...byKey('ROW-4'), key: 'QA-UNDATED', jiraKey: null, summary: 'QA undated commercial process', start: null, due: null, actualStart: null, actualEnd: null, status: 'Not Start', pic: 'gun' })
// One project set to next year, one excluded: hidden from the chart, and said so.
byKey('FNP-292').commitLevel = 'nextyear'
byKey('FNP-228').commitLevel = 'excluded'
const SEED = { ...seed, projects }

/* --------------------------------------------------------------- fake Jira */
const issues = new Map()
const put = (key, f) => issues.set(key, { key, type: 'Task', status: 'In Progress', cat: 'indeterminate', ...f })
// Gun's active epic, with three tasks this week.
put('FNP-1431', { summary: byKey('FNP-1431').summary, type: 'Epic', assignee: acc.gun, start: '2026-03-01', due: '2026-10-31' })
put('FNP-7001', { summary: 'Build the mapping', parent: 'FNP-1431', assignee: acc.gun, start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress' })
put('FNP-7002', { summary: 'Test with October data', parent: 'FNP-1431', assignee: acc.gun, start: day(WEEK, 0), due: day(WEEK, 4), status: 'To Do', cat: 'new' })
put('FNP-7003', { summary: 'Hand over to FP&A', parent: 'FNP-1431', assignee: acc.gun, start: day(WEEK, -14), due: day(WEEK, -7), status: 'Done', cat: 'done', resolved: day(WEEK, -6) })
// FNP-146: finished in Jira, which the sync should bring into the register.
put('FNP-146', { summary: byKey('FNP-146').summary, type: 'Epic', assignee: acc.gun, start: '2026-01-06', due: '2026-06-30', status: 'Done', cat: 'done', resolved: '2026-07-10' })
// Two epics the register has never seen.
put('FNP-9901', { summary: 'QA new epic one', type: 'Epic', assignee: acc.kade, start: '2026-11-01', due: '2026-12-15' })
put('FNP-9902', { summary: 'QA new epic two', type: 'Epic', assignee: acc.james, start: '2026-11-10', due: '2026-12-20', status: 'To Do', cat: 'new' })
// The rest of the register's epics exist too, so the sync does not call them unknown.
for (const p of projects) {
  const k = String(p.jiraKey || '').trim().toUpperCase()
  if (/^[A-Z]+-\d+$/.test(k) && !issues.has(k)) {
    put(k, { summary: p.summary, type: 'Epic', assignee: p.pic ? acc[p.pic] : null, start: p.start || null, due: p.due || null, status: /done/i.test(p.status || '') ? 'Done' : 'In Progress', cat: /done/i.test(p.status || '') ? 'done' : 'indeterminate', resolved: /done/i.test(p.status || '') ? (p.due || null) : null })
  }
}
const jiraWrites = []
const asRaw = (i) => ({
  key: i.key,
  fields: {
    summary: i.summary,
    status: { name: i.status, statusCategory: { key: i.cat } },
    duedate: i.due || null,
    customfield_10015: i.start || null,
    assignee: i.assignee ? { accountId: i.assignee, displayName: nameOfAcc[i.assignee] } : null,
    issuetype: { name: i.type },
    parent: i.parent ? { key: i.parent, fields: { summary: issues.get(i.parent)?.summary || '', status: { name: issues.get(i.parent)?.status || 'To Do' } } } : null,
    created: '2026-01-01T00:00:00.000+0700',
    updated: '2026-01-01T00:00:00.000+0700',
    resolutiondate: i.resolved ? `${i.resolved}T10:00:00.000+0700` : null,
    description: i.description || null,
    labels: [],
  },
})
const body = (req) => new Promise((r) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => r(Buffer.concat(b))) })
const fold = (s) => String(s || '').trim().toLowerCase()
const list = (s) => (s || '').split(',').map((x) => x.trim().replace(/"/g, '').toUpperCase()).filter(Boolean)
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
  const raw = await body(req)
  const json = () => { try { return JSON.parse(raw.toString()) } catch { return {} } }
  const m = (re) => u.pathname.match(re)
  if (u.pathname === '/rest/api/3/myself') return send(200, { accountId: 'acc-app', displayName: 'App' })
  if (u.pathname === '/rest/api/3/user/search') {
    const q = fold(u.searchParams.get('query'))
    const p = seed.people.find((x) => fold(x.name) === q || fold(x.nick) === q)
    return send(200, p ? [{ accountId: acc[p.id], displayName: p.name, accountType: 'atlassian', active: true }] : [])
  }
  if (u.pathname === '/rest/api/3/search/jql') {
    const jql = json().jql || ''
    const a = (jql.match(/assignee = "([^"]+)"/) || [])[1]
    const dueFrom = (jql.match(/duedate >= "([^"]+)"/) || [])[1]
    const keys = list((jql.match(/key IN \(([^)]*)\)/) || [])[1])
    const parents = list((jql.match(/parent IN \(([^)]*)\)/) || [])[1])
    const onlyEpic = /issuetype = "Epic"/.test(jql)
    const noEpic = /issuetype != "Epic"/.test(jql)
    const out = [...issues.values()].filter((i) => {
      if (a && i.assignee !== a) return false
      if (onlyEpic && i.type !== 'Epic') return false
      if (noEpic && i.type === 'Epic') return false
      if (keys.length || parents.length) {
        const hit = keys.includes(i.key) || (i.parent && parents.includes(i.parent))
        if (!hit) return false
      }
      if (dueFrom && i.due && i.due < dueFrom) return false
      return true
    })
    return send(200, { issues: out.map(asRaw) })
  }
  let k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/)
  if (k) { jiraWrites.push({ kind: 'comment', key: k[1] }); return send(201, { id: `c${jiraWrites.length}` }) }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/attachments$/)
  if (k) return send(200, [])
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/worklog$/)
  if (k) return send(200, { worklogs: [] })
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/)
  if (k) {
    if (req.method === 'GET') return send(200, { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }] })
    jiraWrites.push({ kind: 'transition', key: k[1] })
    return send(204)
  }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/)
  if (k) {
    const i = issues.get(k[1])
    if (!i) return send(404, { errorMessages: ['Issue does not exist'] })
    if (req.method === 'PUT') {
      const f = json().fields || {}
      if ('duedate' in f) i.due = f.duedate
      if ('customfield_10015' in f) i.start = f.customfield_10015
      if ('description' in f) i.description = f.description
      jiraWrites.push({ kind: 'put', key: k[1], fields: Object.keys(f) })
      return send(204)
    }
    return send(200, asRaw(i))
  }
  return send(404, { errorMessages: [`fake Jira has no ${req.method} ${u.pathname}`] })
})
const JPORT = 5631
await new Promise((r) => fake.listen(JPORT, r))

/* ------------------------------------------------------------------ server */
const mongod = await MongoMemoryServer.create()
const PORT = 5630
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'qa-timeline-service-token-'.padEnd(48, '7')
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), MONGODB_URI: mongod.getUri(), MONGODB_DB: 'team_kpi_planning', AUTH_SECRET: 's', AUTH_ADMIN_EMAILS: 'boss@lotuss.com', KPI_SERVICE_TOKEN: TOKEN,
    JIRA_BASE_URL: `http://127.0.0.1:${JPORT}`, JIRA_EMAIL: 'app@lotuss.com', JIRA_API_TOKEN: 'fake', JIRA_ALLOW_WRITES: 'true', JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log', SMTP_USER: 'sender@gmail.com', APP_URL: 'https://kpi.example', LOTUS_API_KEY: '',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const serverErr = []
server.stderr.on('data', (b) => serverErr.push(String(b)))
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/health`)).ok) break } catch { /* wait */ } await sleep(300) }
const call = async (method, path, b, who) => {
  const headers = { 'Content-Type': 'application/json' }
  if (who === 'service') headers.authorization = `Bearer ${TOKEN}`; else if (who) headers.cookie = who
  const r = await fetch(base + path, { method, headers, body: b === undefined ? undefined : JSON.stringify(b) })
  return { status: r.status, body: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }
}
const signUp = async (email) => {
  await call('POST', '/api/auth/register', { email, password: 'password1' })
  if (email !== 'boss@lotuss.com') await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}
const sharedPlan = async () => (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body.payload
const projectOf = async (key) => (await sharedPlan()).projects.find((p) => p.key === key)

let browser
try {
  await call('PUT', '/api/scenarios/Baseline', { payload: SEED, updatedBy: 'qa' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const gun = await signUp('gun@lotuss.com')
  await call('PUT', '/api/auth/users/gun@lotuss.com', { person: 'gun' }, boss)
  // Gun's week: one task reported as blocked, so the chart has a marker to show.
  const wk = await call('GET', `/api/weekly/${WEEK}/jira`, undefined, gun)
  const sent = await call('POST', `/api/weekly/${WEEK}/jira/FNP-7001/update`, {
    progress: 'QA: built half the mapping; the rest waits on IT.', done: false, reason: 'Waiting on the extract.', blocker: 'IT has not opened the SAP extract yet.',
  }, gun)
  if (sent.status !== 200) console.log('NOTE  Gun could not send the update', sent.status, JSON.stringify(sent.body).slice(0, 200), 'tasks', (wk.body.tasks || []).map((t) => t.key).join(','))

  browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 })
  const open = async (cookie, viewport = { width: 1440, height: 900 }) => {
    // A browser of their own: two people never share one browser's storage.
    const ctx = await browser.createBrowserContext()
    const pg = await ctx.newPage()
    pg.on('dialog', (d) => d.accept())
    pg.errors = []
    pg.on('pageerror', (e) => pg.errors.push(e.message))
    await pg.setViewport(viewport)
    const [n, v] = cookie.split('=')
    await pg.setCookie({ name: n, value: v, url: base })
    return pg
  }
  const ready = async (pg) => {
    await pg.waitForFunction(() => document.querySelector('[data-timeline="filters"]') && /projects? on the chart/.test(document.body.innerText), { timeout: 60000 })
    await sleep(1200)
  }
  const goTimeline = async (pg) => {
    await pg.goto(`${base}/?go#timeline`, { waitUntil: 'networkidle0', timeout: 90000 })
    await ready(pg)
  }
  const shot = async (pg, name) => { if (SHOT) await pg.screenshot({ path: `${SHOT}/qa-tl-${name}.png` }) }
  // Rows on the chart: project rows carry data-keys.
  const rowKeys = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-keys]')].map((r) => r.getAttribute('data-keys')))
  const onChart = (pg) => pg.evaluate(() => Number((document.body.innerText.match(/(\d+) projects? on the chart/) || [])[1]))
  const typeSearch = async (pg, text) => {
    const box = await pg.$('input[placeholder="Search key, project, programme"]')
    await box.click()
    await box.evaluate((el) => el.select())
    await pg.keyboard.press('Backspace')
    if (text) await box.type(text)
    await sleep(700)
  }
  const pickSelect = async (pg, label, optionText) => {
    // MUI select: open by mouse-down on its button, then click the option.
    await pg.evaluate((l) => {
      const fc = [...document.querySelectorAll('[data-timeline="filters"] .MuiFormControl-root')].find((f) => f.querySelector('label')?.textContent.trim() === l)
      const btn = fc?.querySelector('[role="combobox"]')
      btn?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }, label)
    await sleep(400)
    const ok = await pg.evaluate((t) => {
      const li = [...document.querySelectorAll('[role="listbox"] li')].find((x) => x.textContent.trim() === t)
      li?.click()
      return !!li
    }, optionText)
    await sleep(300)
    await pg.keyboard.press('Escape')
    await sleep(500)
    return ok
  }
  // A select of ticks: leave exactly `want` ticked (by option text).
  const setTicks = async (pg, label, want) => {
    await pg.evaluate((l) => {
      const fc = [...document.querySelectorAll('[data-timeline="filters"] .MuiFormControl-root')].find((f) => f.querySelector('label')?.textContent.trim() === l)
      fc?.querySelector('[role="combobox"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }, label)
    await sleep(400)
    const names = await pg.evaluate(() => [...document.querySelectorAll('[role="listbox"] li')].filter((x) => x.querySelector('input[type="checkbox"]')).map((x) => x.textContent.trim()))
    for (const name of names) {
      await pg.evaluate((t, on) => {
        const li = [...document.querySelectorAll('[role="listbox"] li')].find((x) => x.textContent.trim() === t)
        if (li && li.querySelector('input[type="checkbox"]').checked !== on) li.click()
      }, name, want.includes(name))
      await sleep(150)
    }
    await pg.keyboard.press('Escape')
    await sleep(500)
    return names
  }
  const boxText = (pg, label) => pg.evaluate((l) => [...document.querySelectorAll('[data-timeline="filters"] .MuiFormControl-root')].find((f) => f.querySelector('label')?.textContent.trim() === l)?.querySelector('[role="combobox"]')?.textContent, label)
  // Every state and status ticked, so finished and done work is on the chart too.
  const showAll = async (pg) => { await pg.evaluate(() => document.querySelector('[data-timeline-show-ticked]')?.click()); await sleep(600) }
  const clear = async (pg) => { await pg.evaluate(() => document.querySelector('[data-timeline-clear]')?.click()); await sleep(600) }

  // The expected figures, from the same model the page uses.
  const plan0 = computePlan(repairState(await sharedPlan()))
  const live0 = plan0.projects.filter((p) => !p.deleted)
  const drawn = (p) => p.commitLevel !== 'nextyear' && p.commitLevel !== 'excluded'

  /* ================================================================ admin */
  const a = await open(boss)
  await goTimeline(a)
  await shot(a, 'admin')

  // D01
  const d01 = await a.evaluate(() => ({
    bars: document.querySelectorAll('[data-keys]').length,
    legend: /How to read it/.test(document.body.innerText),
    figures: document.querySelectorAll('[data-stat]').length,
    toolbarW: Math.round(document.querySelector('[data-timeline="filters"]').getBoundingClientRect().width),
    mainW: Math.round(document.querySelector('[data-timeline="filters"]').parentElement.getBoundingClientRect().width),
    sideways: document.documentElement.scrollWidth - window.innerWidth,
  }))
  check('D01', 'loads with bars, legend and figures, full width', d01.bars > 20 && d01.legend && d01.figures >= 5 && d01.sideways <= 0 && d01.toolbarW >= 1080, JSON.stringify(d01))

  // D25: rows in view at 1440x900, before anything is filtered.
  const d25 = await a.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-keys]')]
    const vis = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight }).length
    const first = rows[0]?.getBoundingClientRect().top
    return { vis, first: Math.round(first || 0), h: Math.round(rows[0]?.getBoundingClientRect().height || 0) }
  })
  check('D25', 'at least 14 project rows in view at 1440x900, rows readable', d25.vis >= 14 && d25.h >= 30, JSON.stringify(d25))

  // D24: every icon-only button names itself.
  const d24 = await a.evaluate(() => {
    const root = document.querySelector('[data-timeline="filters"]').parentElement
    return [...root.querySelectorAll('button, [role="button"]')].filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title') && !b.closest('[aria-label]'))
      .map((b) => b.outerHTML.slice(0, 80)).slice(0, 5)
  })
  check('D24', 'every icon-only button has an aria-label or title', d24.length === 0, d24.join(' | '))

  // D06: search by key, name and programme.
  const p146 = byKey('FNP-146')
  await typeSearch(a, 'FNP-146')
  const byKeyRows = await rowKeys(a)
  await typeSearch(a, p146.summary.slice(0, 12))
  const byNameRows = await rowKeys(a)
  const prog = live0.find((p) => drawn(p) && !p.outsideTeam && p.program)?.program
  await typeSearch(a, prog)
  const progRows = await rowKeys(a)
  const progOk = progRows.length > 0 && progRows.every((ks) => ks.split(' ').some((k) => (live0.find((p) => p.key === k)?.program || '').toLowerCase().includes(prog.toLowerCase())
    || (live0.find((p) => p.key === k)?.summary || '').toLowerCase().includes(prog.toLowerCase())))
  check('D06', 'search finds by key, name and programme', byKeyRows.some((k) => k.includes('FNP-146')) && byNameRows.some((k) => k.includes('FNP-146')) && progOk,
    `key ${byKeyRows.length} · name ${byNameRows.length} · programme "${prog}" ${progRows.length}`)

  // D20: the figures follow the filters.
  const scopeF = await a.evaluate(() => document.querySelector('[data-stat-scope]')?.dataset.statScope)
  await clear(a)
  const scopeA = await a.evaluate(() => document.querySelector('[data-stat-scope]')?.dataset.statScope)
  check('D20', 'the figures line says "Of those shown" while filtered, "All projects" when not', scopeF === 'filtered' && scopeA === 'all', `${scopeF} → ${scopeA}`)

  // D02: Clear resets everything, and is disabled with nothing to clear.
  const clearOffAtStart = await a.evaluate(() => document.querySelector('[data-timeline-clear]')?.disabled)
  const allCount = await onChart(a)
  await typeSearch(a, 'zzz-nothing')
  await pickSelect(a, 'State', 'Running, on track')
  await pickSelect(a, 'Sort', 'Name A–Z')
  const clearOn = await a.evaluate(() => !document.querySelector('[data-timeline-clear]')?.disabled)
  await clear(a)
  const after = await a.evaluate(() => ({
    q: document.querySelector('input[placeholder="Search key, project, programme"]').value,
    state: [...document.querySelectorAll('[data-timeline="filters"] .MuiFormControl-root')].find((f) => f.querySelector('label')?.textContent.trim() === 'State')?.querySelector('[role="combobox"]')?.textContent,
    sort: document.querySelector('[data-timeline-sort] .MuiSelect-select, [data-timeline-sort][role="combobox"]')?.textContent
      || [...document.querySelectorAll('[data-timeline="filters"] .MuiFormControl-root')].find((f) => f.querySelector('label')?.textContent.trim() === 'Sort')?.querySelector('[role="combobox"]')?.textContent,
    disabled: document.querySelector('[data-timeline-clear]')?.disabled,
  }))
  check('D02', 'Clear resets search and every filter; disabled when nothing to clear', clearOffAtStart && clearOn && after.q === '' && after.state === 'All but finished' && after.sort === 'Start date' && after.disabled && (await onChart(a)) === allCount, JSON.stringify(after))

  // D07: team and sub team.
  const someTeam = live0.find((p) => drawn(p) && !p.outsideTeam && p.team)?.team
  await pickSelect(a, 'Team', someTeam)
  const teamRows = await rowKeys(a)
  const teamOk = teamRows.length > 0 && teamRows.every((ks) => live0.find((p) => p.key === ks.split(' ')[0])?.team === someTeam)
  const someSub = live0.find((p) => drawn(p) && !p.outsideTeam && p.team === someTeam && p.subTeam)?.subTeam
  await pickSelect(a, 'Sub team', someSub)
  const subRows = await rowKeys(a)
  const subOk = subRows.length > 0 && subRows.every((ks) => live0.find((p) => p.key === ks.split(' ')[0])?.subTeam === someSub)
  // The clear inside each.
  await pickSelect(a, 'Sub team', 'Clear — all sub teams')
  const subCleared = (await rowKeys(a)).length === teamRows.length
  await pickSelect(a, 'Team', 'Clear — all teams')
  const teamCleared = (await onChart(a)) === allCount
  check('D07', 'Team and Sub team filter, each with its own clear', teamOk && subOk && subCleared && teamCleared, `${someTeam} ${teamRows.length} · ${someSub} ${subRows.length} · cleared ${subCleared}/${teamCleared}`)

  // D08: every State and every Status option filters to what it says, one at a time.
  const ours = live0.filter((p) => drawn(p) && !p.outsideTeam)
  const bucket = (tl) => (tl.state === 'finished' ? 'finished' : tl.overdue ? 'overdue' : tl.state === 'running' ? 'running' : 'not started')
  const STATES = [
    ['Not started', (p) => bucket(p.timeline) === 'not started'],
    ['Running, on track', (p) => bucket(p.timeline) === 'running'],
    ['Past due, unfinished', (p) => bucket(p.timeline) === 'overdue'],
    ['Finished', (p) => bucket(p.timeline) === 'finished'],
  ]
  const STATUSES = [
    ['Not start', (p) => statusChoice(p) === 'Not Start'],
    ['In progress', (p) => statusChoice(p) === 'In Progress'],
    ['On hold', (p) => statusChoice(p) === 'On Hold'],
    ['Done', (p) => statusChoice(p) === 'Done'],
  ]
  const stateBad = []
  const sweep = async (label, list, other, otherAll) => {
    await setTicks(a, other, otherAll)
    for (const [name, fn] of list) {
      await setTicks(a, label, [name])
      const keys = (await rowKeys(a)).flatMap((ks) => ks.split(' '))
      const want = new Set(ours.filter(fn).map((p) => p.key))
      const extra = keys.filter((k) => !want.has(k))
      const missing = [...want].filter((k) => !keys.includes(k))
      if (extra.length || missing.length) stateBad.push(`${label} ${name}: +${extra.length} −${missing.length}`)
    }
    await clear(a)
  }
  await sweep('State', STATES, 'Status', STATUSES.map(([n]) => n))
  await sweep('Status', STATUSES, 'State', STATES.map(([n]) => n))
  check('D08', 'each State and Status tick shows exactly those projects', stateBad.length === 0, stateBad.join('; '))

  // D26: by default the finished and done work is off the chart, and one click brings it back.
  const d26 = { state: await boxText(a, 'State'), status: await boxText(a, 'Status') }
  const shownKeys = (await rowKeys(a)).flatMap((ks) => ks.split(' '))
  d26.finishedShown = shownKeys.filter((k) => { const p = ours.find((x) => x.key === k); return p && (bucket(p.timeline) === 'finished' || statusChoice(p) === 'Done') }).length
  d26.expectHidden = ours.filter((p) => bucket(p.timeline) === 'finished' || statusChoice(p) === 'Done').length
  d26.link = await a.evaluate(() => document.querySelector('[data-timeline-show-ticked]')?.textContent || null)
  d26.before = await onChart(a)
  await a.evaluate(() => document.querySelector('[data-timeline-show-ticked]')?.click())
  await sleep(600)
  d26.after = await onChart(a)
  d26.afterBoxes = [await boxText(a, 'State'), await boxText(a, 'Status')]
  await clear(a)
  check('D26', 'default: State "All but finished", Status "All but done"; "+n finished / done — show" reveals them',
    d26.state === 'All but finished' && d26.status === 'All but done' && d26.finishedShown === 0
      && (d26.expectHidden === 0 || (/finished \/ done/.test(d26.link || '') && d26.after > d26.before))
      && d26.afterBoxes.join() === 'All,All', JSON.stringify(d26))

  // D09: Sort.
  await pickSelect(a, 'Sort', 'Name A–Z')
  const names = await a.evaluate(() => [...document.querySelectorAll('[data-keys]')].map((r) => r.querySelector('p')?.textContent || ''))
  const sorted = [...names].sort((x, y) => x.localeCompare(y))
  await pickSelect(a, 'Sort', 'Due soonest')
  const dues = (await rowKeys(a)).map((ks) => live0.find((p) => p.key === ks.split(' ')[0])?.timeline.plannedEnd || '9999')
  const duesOk = dues.every((d, i) => i === 0 || dues[i - 1] <= d)
  await pickSelect(a, 'Sort', 'Most late first')
  const lates = (await rowKeys(a)).map((ks) => live0.find((p) => p.key === ks.split(' ')[0])?.timeline.lateBy ?? -Infinity)
  const latesOk = lates.every((d, i) => i === 0 || lates[i - 1] >= d)
  await clear(a)
  check('D09', 'each Sort option orders the rows', JSON.stringify(names) === JSON.stringify(sorted) && duesOk && latesOk, `name ${JSON.stringify(names) === JSON.stringify(sorted)} · due ${duesOk} · late ${latesOk}`)

  // D05: what "Ours only" hides is said, and one click shows it.
  const others = live0.filter((p) => drawn(p) && p.outsideTeam).length
  const d05 = await a.evaluate(() => document.querySelector('[data-timeline-show-others]')?.textContent || '')
  await a.evaluate(() => document.querySelector('[data-timeline-show-others]')?.click())
  await sleep(600)
  const withOthers = await onChart(a)
  await clear(a)
  check('D05', '"+N not ours — show" names what Ours only hides, and shows them', others > 0 && d05.includes(`+${others}`) && withOthers > allCount, `${d05} · ${allCount} → ${withOthers}`)
  const outPlan = await a.evaluate(() => document.querySelector('[data-timeline-out-of-plan]')?.textContent || '')

  // D10: scales and Today.
  const scaleOf = async (label) => {
    await a.evaluate((l) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === l)?.click(), label)
    await sleep(900)
    return a.evaluate(() => {
      const head = [...document.querySelectorAll('div')].filter((d) => /PROJECT/.test(d.innerText || '') && /SLIP/.test(d.innerText || '') && d.children.length >= 3 && d.children.length <= 4).pop()
      const track = head?.children[1]
      // A label cut short ("202" for 2026) is a label nobody can read.
      const cells = track ? [...track.children].slice(0, -1) : []
      const clipped = cells.filter((c) => c.children[0] && c.children[0].getBoundingClientRect().right > c.getBoundingClientRect().right + 0.5).map((c) => c.textContent)
      return { ticks: track ? track.children.length : 0, w: Math.round(track?.getBoundingClientRect().width || 0), clipped }
    })
  }
  const sm = await scaleOf('Month')
  const sw = await scaleOf('Week')
  const sd = await scaleOf('Day')
  await a.evaluate(() => document.querySelector('[data-timeline-today]')?.click())
  await sleep(1200)
  const todayIn = await a.evaluate(() => {
    const t = document.querySelector('[data-timeline-today-label]')

    const r = t?.getBoundingClientRect()
    return r ? r.left > 0 && r.right < window.innerWidth : false
  })
  await scaleOf('Month')
  check('D10', 'Day / Week / Month change the scale; Today scrolls today into view; no year label clipped', sm.ticks > 0 && sw.ticks > sm.ticks && sd.ticks > sw.ticks && sd.w > sw.w && todayIn && sm.clipped.length === 0,
    `${sm.ticks}/${sw.ticks}/${sd.ticks} ticks · today in view ${todayIn} · clipped years ${JSON.stringify(sm.clipped)}`)

  // D16: pinned header and pinned name column.
  await scaleOf('Week')
  const d16 = await a.evaluate(async () => {
    const box = [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 50 && d.scrollWidth > d.clientWidth + 50 && /auto|scroll/.test(window.getComputedStyle(d).overflow))
    if (!box) return { box: false }
    const head = [...box.querySelectorAll('*')].find((d) => d.textContent.trim() === 'PROJECT')
    const name = box.querySelector('[data-keys] > div')
    const h0 = head.getBoundingClientRect().top
    const n0 = name.getBoundingClientRect().left
    box.scrollTop = 400; box.scrollLeft = 600
    await new Promise((r) => setTimeout(r, 300))
    const out = { box: true, headMoved: Math.round(head.getBoundingClientRect().top - h0), nameMoved: Math.round([...box.querySelectorAll('[data-keys] > div')].find((d) => d.getBoundingClientRect().top > h0 + 40)?.getBoundingClientRect().left - n0) }
    box.scrollTop = 0
    return out
  })
  await scaleOf('Month')
  check('D16', 'header row and name column stay pinned while scrolling both ways', d16.box && Math.abs(d16.headMoved) <= 1 && Math.abs(d16.nameMoved) <= 1, JSON.stringify(d16))

  // D18: slip values.
  const late = ours.find((p) => (p.timeline.lateBy ?? 0) > 0)
  const early = ours.find((p) => (p.timeline.lateBy ?? 0) < 0)
  const none = ours.find((p) => p.timeline.lateBy == null && (p.timeline.plannedStart || p.timeline.plannedEnd))
  const slipOf = (k) => a.evaluate((key) => {
    const row = document.querySelector(`[data-keys~="${key}"]`)
    return row ? row.lastElementChild.textContent.trim() : null
  }, k)
  await showAll(a)
  const sl = { late: late && await slipOf(late.key), early: early && await slipOf(early.key), none: none && await slipOf(none.key) }
  await clear(a)
  check('D18', 'slip shows +late, −early and — with nothing to judge', (!late || sl.late === `+${late.timeline.lateBy}d`) && (!early || sl.early === `${early.timeline.lateBy}d`) && (!none || sl.none === '—'),
    `${late?.key} ${sl.late} (want +${late?.timeline.lateBy}d) · ${early?.key} ${sl.early} · ${none?.key} ${sl.none}`)

  // D17: the blocker Gun reported shows on the bar.
  const d17 = await a.evaluate(() => !!document.querySelector('[data-keys~="FNP-1431"] [aria-label="blocked"]'))
  check('D17', 'a blocker from the weekly report shows as a marker on its bar', d17 && sent.status === 200, `marker ${d17} · update ${sent.status}`)

  // D12: the name opens the weekly updates.
  await typeSearch(a, 'FNP-1431')
  await a.evaluate(() => document.querySelector('[data-keys~="FNP-1431"] [role="button"][aria-label^="weekly updates"]')?.click())
  await sleep(800)
  const d12 = await a.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '')
  await shot(a, 'story')
  const storyOk = /built half the mapping/.test(d12) && /SAP extract/.test(d12) && !/\?%/.test(d12) && !/new date —/.test(d12)
  // And from there to the project's own page.
  await a.evaluate(() => document.querySelector('[data-story-open-project]')?.click())
  await sleep(1500)
  const storyHash = await a.evaluate(() => decodeURIComponent(window.location.hash))
  check('D12', 'the project name opens what members sent on it, and links to the project page', storyOk && storyHash === '#project/FNP-1431', `${storyHash} · ${d12.slice(0, 220).replace(/\n/g, ' | ')}`)
  await goTimeline(a)

  // D11: expanding the epic lists its Jira tasks, with their status.
  await a.evaluate(() => document.querySelector('[aria-label="expand FNP-1431"]')?.click())
  await a.waitForFunction(() => /Build the mapping/.test(document.body.innerText), { timeout: 15000 }).catch(() => {})
  const d11 = await a.evaluate(() => {
    const rows = [...document.querySelectorAll('div')].filter((d) => /^FNP-700\d/.test(d.querySelector?.('span')?.textContent || '') || false)
    const kids = [...document.querySelectorAll('[data-timeline-status]')].map((c) => c.textContent.trim())
    return { text: /Build the mapping/.test(document.body.innerText) && /Test with October data/.test(document.body.innerText), statuses: kids, rows: rows.length }
  })
  check('D11', 'expanding an epic lists its Jira tasks with their Jira status', d11.text && d11.statuses.includes('In Progress') && d11.statuses.some((s) => /to do/i.test(s)) && d11.statuses.some((s) => /done/i.test(s)), JSON.stringify(d11.statuses))
  await a.evaluate(() => document.querySelector('[aria-label="collapse FNP-1431"]')?.click())
  await clear(a)

  // D04: the Status column, and changing a status.
  const st0 = await a.evaluate(() => ({
    col: document.querySelectorAll('[data-keys] [data-timeline-status]').length,
    rows: document.querySelectorAll('[data-keys]').length,
    head: [...document.querySelectorAll('div')].some((d) => d.textContent.trim() === 'STATUS'),
  }))
  await typeSearch(a, 'FNP-939')
  await a.evaluate(() => document.querySelector('[data-keys~="FNP-939"] [data-status-picker]')?.click())
  await sleep(400)
  await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => m.textContent.trim() === 'Done')?.click())
  await sleep(600)
  const st1 = await a.evaluate(() => document.querySelector('[data-keys~="FNP-939"] [data-timeline-status]')?.textContent.trim())
  // Saved to the shared plan by the autosave.
  let saved939 = null
  for (let i = 0; i < 40 && !/done/i.test(saved939?.status || ''); i++) { await sleep(500); saved939 = await projectOf('FNP-939') }
  if (!/done/i.test(saved939?.status || '')) {
    await shot(a, 'not-saved')
    console.log('DEBUG not saved:', await a.evaluate(() => [...document.querySelectorAll('.MuiSnackbar-root, .MuiAlert-root, [role="alert"]')].map((e) => e.innerText.replace(/\n/g, ' ')).join(' || ').slice(0, 600)))
  }
  check('D04', 'Status column on every row; changing it shows at once and saves', st0.head && st0.col === st0.rows && /done/i.test(st1 || '') && /done/i.test(saved939?.status || ''), `${st0.col}/${st0.rows} cells · now "${st1}" · saved "${saved939?.status}"`)

  // D03: the undated project, and giving it dates.
  await clear(a)
  await typeSearch(a, 'QA undated')
  const d03a = await a.evaluate(() => ({ btn: !!document.querySelector('[data-keys~="QA-UNDATED"] [data-timeline-set-dates]'), last: document.querySelector('[data-keys]:last-of-type')?.getAttribute('data-keys') }))
  await a.evaluate(() => document.querySelector('[data-keys~="QA-UNDATED"] [data-timeline-set-dates]')?.click())
  await sleep(500)
  const setDate = async (label, v) => {
    await a.evaluate((l, val) => {
      const inp = [...document.querySelectorAll('.MuiPopover-paper input[type="date"]')].find((i) => i.closest('.MuiFormControl-root')?.querySelector('label')?.textContent.trim() === l)
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      set.call(inp, val)
      inp.dispatchEvent(new Event('input', { bubbles: true }))
    }, label, v)
    await sleep(200)
  }
  // D23 first: a finish before the start is refused, with a message.
  await setDate('Planned start', '2026-12-10')
  await setDate('Planned finish', '2026-12-01')
  const d23 = await a.evaluate(() => {
    const pop = document.querySelector('.MuiPopover-paper')
    const save = [...pop.querySelectorAll('button')].find((b) => /^Save/.test(b.textContent.trim()))
    return { disabled: save?.disabled, msg: /finish is before the start/i.test(pop.innerText) }
  })
  check('D23', 'the date editor refuses a finish before the start, and says why', d23.disabled && d23.msg, JSON.stringify(d23))
  await setDate('Planned finish', '2026-12-20')
  await a.evaluate(() => [...document.querySelectorAll('.MuiPopover-paper button')].find((b) => /^Save/.test(b.textContent.trim()))?.click())
  await sleep(800)
  const barNow = await a.evaluate(() => !document.querySelector('[data-keys~="QA-UNDATED"] [data-timeline-set-dates]'))
  let undated = null
  for (let i = 0; i < 40 && !undated?.due; i++) { await sleep(500); undated = await projectOf('QA-UNDATED') }
  await goTimeline(a)
  await typeSearch(a, 'QA undated')
  const barAfterReload = await a.evaluate(() => !document.querySelector('[data-keys~="QA-UNDATED"] [data-timeline-set-dates]') && !!document.querySelector('[data-keys~="QA-UNDATED"]'))
  check('D03', 'an undated project is listed with "set them"; dates saved draw the bar and survive reload', d03a.btn && barNow && undated?.start === '2026-12-10' && undated?.due === '2026-12-20' && barAfterReload,
    `button ${d03a.btn} · bar ${barNow} · saved ${undated?.start}→${undated?.due} · after reload ${barAfterReload}`)
  await clear(a)

  // D13: the active switch, and the Active filter following it.
  const idle = ours.find((p) => p.key === 'FNP-247')
  await typeSearch(a, idle.key)
  await showAll(a)
  await a.evaluate((k) => document.querySelector(`[aria-label="active ${k}"]`)?.click(), idle.jiraKey || idle.key)
  await sleep(400)
  const menu = await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent.trim()))
  await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /^Always/.test(m.textContent.trim()))?.click())
  await sleep(600)
  await clear(a)
  await showAll(a)
  await a.evaluate(() => document.querySelector('input[aria-label="active projects only"]')?.click())
  await sleep(700)
  const activeRows = await rowKeys(a)
  await clear(a)
  check('D13', 'switching a project to always active puts it under the Active filter', activeRows.some((k) => k.includes(idle.key)), `menu ${JSON.stringify(menu)} · active ${activeRows.length}`)

  // D21: Find new epics offers only what the register lacks.
  await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Find new epics')?.click())
  await a.waitForFunction(() => document.querySelector('[role="dialog"]'), { timeout: 20000 }).catch(() => {})
  const d21 = await a.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '')
  await shot(a, 'find-new')
  const offered = (d21.match(/FNP-\d+/g) || [])
  check('D21', 'Find new epics lists only epics not on the register', offered.includes('FNP-9901') && offered.includes('FNP-9902') && offered.every((k) => k === 'FNP-9901' || k === 'FNP-9902'), [...new Set(offered)].join(', '))
  await a.keyboard.press('Escape'); await sleep(500)

  // D22: Sync for everyone brings Jira's finish into the shared plan.
  const before146 = await projectOf('FNP-146')
  await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Sync for everyone')?.click())
  await a.waitForFunction(() => /shared plan/i.test(document.querySelector('.MuiAlert-message')?.innerText || ''), { timeout: 30000 }).catch(() => {})
  const syncMsg = await a.evaluate(() => document.querySelector('.MuiAlert-message')?.innerText || '')
  const after146 = await projectOf('FNP-146')
  check('D22', 'Sync with Jira brings Jira’s actual dates into the plan', after146?.actualEnd === '2026-07-10' && before146?.actualEnd !== '2026-07-10', `${before146?.actualEnd} → ${after146?.actualEnd} · "${syncMsg.slice(0, 120).replace(/\n/g, ' ')}"`)

  /* =============================================================== member */
  const g = await open(gun)
  await g.goto(`${base}/?go#timeline`, { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(g)
  await shot(g, 'member')
  const gunKeys = new Set(live0.filter((p) => p.pic === 'gun' || (p.contributors || []).includes?.('gun')).map((p) => p.key))
  const d14 = await g.evaluate(() => ({
    keys: [...document.querySelectorAll('[data-keys]')].map((r) => r.getAttribute('data-keys')),
    jiraButtons: [...document.querySelectorAll('button')].filter((b) => /Find new epics|Sync with Jira|Sync for everyone/.test(b.textContent)).length,
    setDates: document.querySelectorAll('[data-timeline-set-dates]').length,
    note: /Only the projects you hold/.test(document.body.innerText),
  }))
  const foreign = d14.keys.flatMap((k) => k.split(' ')).filter((k) => !gunKeys.has(k))
  check('D14', 'a member’s Timeline shows only their projects and cannot re-plan', d14.keys.length > 0 && foreign.length === 0 && d14.jiraButtons === 0 && d14.setDates === 0 && d14.note,
    `${d14.keys.length} rows · foreign ${foreign.join(',')} · jira buttons ${d14.jiraButtons} · set-dates ${d14.setDates}`)

  // D19: a member's header search sends them to the project's bar, whatever was filtered.
  await pickSelect(g, 'State', 'Finished')
  const gs = await g.$('input[aria-label="Search"]')
  let d19 = { search: !!gs }
  if (gs) {
    await gs.click()
    await gs.type('Sales Forecast')
    await sleep(900)
    d19.opts = await g.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()).slice(0, 4))
    await g.keyboard.press('ArrowDown')
    await g.keyboard.press('Enter')
    await sleep(1800)
    Object.assign(d19, await g.evaluate(() => ({
      hash: window.location.hash,
      rows: [...document.querySelectorAll('[data-keys]')].map((r) => r.getAttribute('data-keys')),
      state: [...document.querySelectorAll('[data-timeline="filters"] .MuiFormControl-root')].find((f) => f.querySelector('label')?.textContent.trim() === 'State')?.querySelector('[role="combobox"]')?.textContent,
      lit: !!document.querySelector('[data-keys~="FNP-1431"]'),
    })))
  }
  check('D19', 'the header search lands on the project with the filters reset', d19.lit && d19.state === 'All' && d19.rows.length >= 1, JSON.stringify(d19).slice(0, 300))
  await clear(g)

  // D15: a phone.
  await g.setViewport({ width: 390, height: 844 })
  await sleep(1200)
  const d15 = await g.evaluate(() => ({
    sideways: document.documentElement.scrollWidth - window.innerWidth,
    filtersBtn: [...document.querySelectorAll('button')].some((b) => /^Filters/.test(b.textContent.trim())),
    statusCol: document.querySelectorAll('[data-timeline-status]').length,
  }))
  await shot(g, 'phone')
  check('D15', 'on a phone: filters fold behind one button, no Status column, no sideways scroll', d15.sideways <= 0 && d15.filtersBtn && d15.statusCol === 0, JSON.stringify(d15))

  console.log(`\nnote: out-of-plan hint "${outPlan}"`)
  const pageErrors = [...new Set([...a.errors, ...g.errors])]
  if (pageErrors.length) console.log('page errors:', pageErrors.slice(0, 5).join(' | '))
} catch (e) {
  console.log('CRASH', e.stack)
  results.push({ id: 'crash', ok: false })
} finally {
  if (browser) await browser.close()
  server.kill(); await mongod.stop(); fake.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length} of ${results.length} passed${failed.length ? ` — failed: ${failed.map((r) => r.id).join(', ')}` : ''}`)
  const errs = serverErr.join('').split('\n').filter((l) => /error/i.test(l)).slice(0, 5)
  if (errs.length) console.log('server errors:', errs.join(' | '))
  process.exit(failed.length ? 1 : 0)
}
