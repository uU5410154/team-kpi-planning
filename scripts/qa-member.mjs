/**
 * QA, AREA A — a member submitting their week (the Weekly page, run from Jira).
 *
 * Twenty-five cases, A01–A25, against the real server, a real mongod
 * (in memory) and a FAKE Jira that records every write. Nothing here reaches
 * the live site or a real Jira. Ports 5600–5609.
 *
 *   npm run build && node scripts/qa-member.mjs
 *   QA_SHOTS=/some/dir node scripts/qa-member.mjs   # also screenshots
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'
import { weekOf, addWeeks, weekNo } from '../src/lib/weekly.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const SHOTS = process.env.QA_SHOTS || ''
const WEEK = weekOf()
const NEXT = addWeeks(WEEK, 1)
const LAST = addWeeks(WEEK, -1)
const day = (w, n) => { const d = new Date(`${w}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/* -------------------------------------------------------------- results */
const results = []
const record = (id, name, ok, detail = '') => {
  results.push({ id, name, ok: !!ok, detail: String(detail).slice(0, 300) })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`)
}
const tryCase = async (id, name, fn) => {
  try {
    const r = await fn()
    record(id, name, r?.ok ?? r, r?.detail ?? '')
  } catch (e) {
    record(id, name, false, `threw: ${e.message.split('\n')[0]}`)
  }
}

/* ------------------------------------------------------------ fake Jira */
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const team = seed.people
const acc = Object.fromEntries(team.map((p) => [p.id, `acc-${p.id}`]))
const nameOfAcc = Object.fromEntries(team.map((p) => [acc[p.id], p.name]))
const issues = new Map()
const put = (key, f) => issues.set(key, { key, status: 'To Do', cat: 'new', ...f })
// James: four tasks over three projects this week, one undated, one next week.
put('FNP-2001', { summary: 'Reconcile the forecast', assignee: acc.james, parent: 'FNP-379', start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
put('FNP-2010', { summary: 'Build the forecast pivot', assignee: acc.james, parent: 'FNP-379', start: day(WEEK, 1), due: day(WEEK, 3) })
put('FNP-2002', { summary: 'Count the stock loss lines', assignee: acc.james, parent: 'FNP-1070', start: day(LAST, 3), due: day(WEEK, 2) })
put('FNP-2006', { summary: 'His task on Kade’s project', assignee: acc.james, parent: 'FNP-267', start: day(WEEK, 0), due: day(WEEK, 4) })
put('FNP-2003', { summary: 'Write the runbook', assignee: acc.james, parent: 'FNP-379' })
put('FNP-2004', { summary: 'Demo to FP&A', assignee: acc.james, parent: 'FNP-379', start: day(NEXT, 1), due: day(NEXT, 2) })
// Kade: one task.
put('FNP-2005', { summary: 'Kade’s own task', assignee: acc.kade, parent: 'FNP-1151', start: day(WEEK, 0), due: day(WEEK, 4) })
// The epics.
for (const [k, s] of [['FNP-379', 'PL Forecast'], ['FNP-1070', 'Fresh Stock Loss'], ['FNP-267', 'Supplier Portal'], ['FNP-1151', 'Fixed Asset Retirement']]) {
  put(k, { summary: s, type: 'Epic', status: 'In Progress', cat: 'indeterminate' })
}
const writes = []
const failComment = new Set()
const asRaw = (i) => ({
  key: i.key,
  fields: {
    summary: i.summary,
    status: { name: i.status, statusCategory: { key: i.cat } },
    duedate: i.due || null,
    customfield_10015: i.start || null,
    assignee: i.assignee ? { accountId: i.assignee, displayName: nameOfAcc[i.assignee] } : null,
    issuetype: { name: i.type || 'Task' },
    parent: i.parent ? { key: i.parent, fields: { summary: issues.get(i.parent)?.summary || `Epic ${i.parent}`, status: { name: issues.get(i.parent)?.status || 'To Do' } } } : null,
    created: '2026-01-01T00:00:00.000+0700',
    updated: '2026-01-01T00:00:00.000+0700',
    resolutiondate: null,
    description: i.description || null,
  },
})
let nextKey = 9001
const body = (req) => new Promise((r) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => r(Buffer.concat(b))) })
const fold = (s) => String(s || '').trim().toLowerCase()
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
  const raw = await body(req)
  const json = () => { try { return JSON.parse(raw.toString()) } catch { return {} } }
  const m = (re) => u.pathname.match(re)
  if (u.pathname === '/rest/api/3/user/search') {
    const q = fold(u.searchParams.get('query'))
    const p = team.find((x) => fold(x.name) === q)
    return send(200, p ? [{ accountId: acc[p.id], displayName: p.name, accountType: 'atlassian', active: true }] : [])
  }
  if (u.pathname === '/rest/api/3/search/jql') {
    const jql = json().jql || ''
    const a = (jql.match(/assignee = "([^"]+)"/) || [])[1]
    const noEpics = /issuetype != /.test(jql)
    const dueFrom = (jql.match(/duedate >= "([^"]+)"/) || [])[1]
    const under = (jql.match(/parent IN \(([^)]*)\)/) || [])[1]?.split(',').map((s) => s.trim().replace(/"/g, ''))
    const list = [...issues.values()].filter((i) => (a ? i.assignee === a : true) && (!noEpics || i.type !== 'Epic')
      && (!under || under.includes(i.key) || under.includes(i.parent))
      && (!dueFrom || !i.due || i.due >= dueFrom))
    return send(200, { issues: list.map(asRaw) })
  }
  if (m(/^\/rest\/api\/3\/issue\/createmeta\/[A-Z]+\/issuetypes$/)) {
    return send(200, { issueTypes: [{ id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 }, { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 }] })
  }
  if (req.method === 'POST' && u.pathname === '/rest/api/3/issue') {
    const f = json().fields || {}
    const key = `FNP-${nextKey++}`
    put(key, { summary: f.summary, assignee: f.assignee?.accountId, parent: f.parent?.key, start: f.customfield_10015, due: f.duedate, type: f.issuetype?.id === '10000' ? 'Epic' : 'Task' })
    writes.push({ kind: 'create', key, fields: f })
    return send(201, { key, id: String(nextKey) })
  }
  let k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/)
  if (k && failComment.has(k[1])) return send(503, { errorMessages: ['Jira is down for maintenance'] })
  if (k) { writes.push({ kind: 'comment', key: k[1], body: json().body }); return send(201, { id: `c${writes.length}` }) }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/attachments$/)
  if (k) {
    const names = [...raw.toString('latin1').matchAll(/filename="([^"]+)"/g)].map((x) => x[1])
    writes.push({ kind: 'attach', key: k[1], names })
    return send(200, names.map((filename) => ({ filename })))
  }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/)
  if (k) {
    if (req.method === 'GET') return send(200, { transitions: [{ id: '21', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }, { id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }, { id: '41', name: 'Put on hold', to: { name: 'On Hold', statusCategory: { key: 'indeterminate' } } }] })
    const tid = json().transition?.id
    writes.push({ kind: 'transition', key: k[1], id: tid })
    const i = issues.get(k[1])
    if (i && tid === '41') { i.status = 'On Hold'; i.cat = 'indeterminate' } else if (i && tid === '31') { i.status = 'Done'; i.cat = 'done' }
    return send(204)
  }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/)
  if (k) {
    const i = issues.get(k[1])
    if (!i) return send(404, { errorMessages: ['Issue does not exist'] })
    if (req.method === 'PUT') {
      const f = json().fields || {}
      writes.push({ kind: 'description' in f ? 'description' : 'dates', key: k[1], fields: f })
      if ('description' in f) i.description = f.description
      if ('duedate' in f) i.due = f.duedate
      if ('customfield_10015' in f) i.start = f.customfield_10015
      return send(204)
    }
    return send(200, asRaw(i))
  }
  return send(404, { errorMessages: [`fake Jira has no ${req.method} ${u.pathname}`] })
})
await new Promise((r) => fake.listen(5601, r))

/* --------------------------------------------------------------- server */
const mongod = await MongoMemoryServer.create()
const PORT = 5600
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'qa-member-service-token-'.padEnd(48, '5')
const root = new URL('..', import.meta.url).pathname
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'team_kpi_planning',
    AUTH_SECRET: 'qa-secret',
    AUTH_ADMIN_EMAILS: 'boss@lotuss.com',
    KPI_SERVICE_TOKEN: TOKEN,
    JIRA_BASE_URL: 'http://127.0.0.1:5601',
    JIRA_EMAIL: 'app@lotuss.com',
    JIRA_API_TOKEN: 'fake',
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
const signUp = async (email) => {
  await call('POST', '/api/auth/register', { email, password: 'password1' })
  if (email !== 'boss@lotuss.com') await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

let browser
const tmp = mkdtempSync(join(tmpdir(), 'qa-member-'))
try {
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'qa' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  const kade = await signUp('kade@lotuss.com')
  const pol = await signUp('pol@lotuss.com')
  const nobody = await signUp('nobody@lotuss.com')
  for (const [e, p] of [['james', 'james'], ['kade', 'kade'], ['pol', 'pol']]) await call('PUT', `/api/auth/users/${e}@lotuss.com`, { person: p }, boss)

  const exe = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].find((p) => existsSync(p))
  if (!exe) throw new Error('no Chrome found')
  browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 })

  const pageErrors = []
  const as = async (cookie, vp = { width: 1440, height: 900 }) => {
    const ctx = await browser.createBrowserContext()
    const pg = await ctx.newPage()
    pg.setDefaultTimeout(30000)
    pg.on('dialog', (d) => d.accept())
    pg.on('pageerror', (e) => pageErrors.push(e.message))
    await pg.setViewport(vp)
    const [n, v] = cookie.split('=')
    await pg.setCookie({ name: n, value: v, url: base })
    return pg
  }
  const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: join(SHOTS, `${name}.png`) }) }
  const text = (pg) => pg.evaluate(() => document.body.innerText)
  const waitWeek = (pg) => pg.waitForFunction(() => !!document.querySelector('[data-jira-task]') || /Nothing in Jira with you as PIC|not linked/i.test(document.body.innerText), { timeout: 40000 })
  const show = (pg, key) => pg.evaluate((k) => window.dispatchEvent(new CustomEvent('jira-week-show', { detail: { taskKey: k } })), key)
  const pos = (pg) => pg.evaluate(() => [...document.querySelectorAll('[data-project-pos]')].find((e) => e.offsetParent)?.innerText || '')
  // The update box of a card, and its second box ("why not finished").
  const boxes = (pg, key) => pg.evaluateHandle((k) => [...document.querySelectorAll(`[data-jira-task="${k}"] textarea`)].filter((t) => t.getAttribute('aria-hidden') !== 'true' && !t.readOnly), key)
  const typeIn = async (pg, key, idx, str) => {
    await show(pg, key)
    await sleep(250)
    const h = await boxes(pg, key)
    const el = await h.evaluateHandle((l, i) => l[i], idx)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.asElement().click()
    await pg.keyboard.type(str)
  }
  const choose = (pg, key, label) => pg.evaluate((k, l) => [...document.querySelectorAll(`[data-jira-task="${k}"] button`)].find((b) => b.textContent.trim() === l)?.click(), key, label)
  const submitBtn = (pg, key) => pg.evaluate((k) => document.querySelector(`button[aria-label="submit ${k}"]`)?.click(), key)
  const cardText = (pg, key) => pg.evaluate((k) => document.querySelector(`[data-jira-task="${k}"]`)?.innerText || '', key)
  const wroteTo = (key, kind) => writes.filter((w) => w.key === key && w.kind === kind)
  const waitPosted = (pg, key) => pg.waitForFunction((k) => !!document.querySelector(`[data-posted="${k}"]`) || !!document.querySelector(`[data-jira-task="${k}"] [data-post-failed]`), { timeout: 30000 }, key).catch(() => {})

  /* ================================================================ James */
  let pg = await as(james)
  await pg.goto(`${base}/`, { waitUntil: 'networkidle0' })
  await waitWeek(pg)
  await sleep(800)
  await shot(pg, 'a01-landing')

  await tryCase('A01', 'member lands on Weekly, own current week, no admin tabs', async () => {
    const t = await text(pg)
    const onWeekly = !!(await pg.$('[aria-label="my Jira tasks"]'))
    const adminTabs = ['Cost & ROI', 'Capacity & sprint', 'Management Pack', 'Data quality'].filter((x) => t.includes(x))
    const thisWeek = /this week/i.test(t) && t.includes(`Week ${weekNo(WEEK)}`)
    // The week arrows sit on the "My week" line, not wrapped under it.
    const sameRow = await pg.evaluate(() => {
      const h = [...document.querySelectorAll('h3')].find((e) => e.textContent.trim() === 'My week')
      const nav = document.querySelector('button[aria-label="previous week"]')
      return h && nav ? Math.abs(h.getBoundingClientRect().top - nav.getBoundingClientRect().top) < 24 : false
    })
    return { ok: onWeekly && !adminTabs.length && thisWeek && sameRow, detail: JSON.stringify({ onWeekly, adminTabs, thisWeek, sameRow, hash: await pg.evaluate(() => location.hash) }) }
  })

  await tryCase('A02', '"Project i of n", arrows and dots move between projects', async () => {
    const before = await pos(pg)
    const chips = await pg.$$eval('[data-project-chip]', (l) => l.filter((e) => e.offsetParent).length)
    await pg.click('[data-project-next]')
    await sleep(500)
    const after = await pos(pg)
    await pg.click('[data-project-prev]')
    await sleep(500)
    const back = await pos(pg)
    // A dot jumps straight there.
    await pg.evaluate(() => [...document.querySelectorAll('[data-project-chip]')].filter((e) => e.offsetParent)[2]?.click())
    await sleep(500)
    const third = await pos(pg)
    return { ok: /Project 1 of 3/.test(before) && /Project 2 of 3/.test(after) && /Project 1 of 3/.test(back) && /Project 3 of 3/.test(third) && chips === 3, detail: JSON.stringify({ before, after, back, third, chips }) }
  })

  await tryCase('A03', 'keyboard Left/Right moves between projects; arrows are labelled', async () => {
    await pg.evaluate(() => document.activeElement?.blur())
    await pg.evaluate(() => [...document.querySelectorAll('[data-project-chip]')].filter((e) => e.offsetParent)[0]?.click())
    await sleep(400)
    await pg.keyboard.press('ArrowRight')
    await sleep(500)
    const moved = await pos(pg)
    await pg.keyboard.press('ArrowLeft')
    await sleep(500)
    const back = await pos(pg)
    // Typing in a box must not move the slide.
    const labels = await pg.$$eval('[data-project-prev], [data-project-next]', (l) => l.map((e) => e.getAttribute('aria-label') || ''))
    return { ok: /Project 2 of 3/.test(moved) && /Project 1 of 3/.test(back) && labels.every((l) => /project/.test(l)), detail: JSON.stringify({ moved, back, labels }) }
  })

  await tryCase('A04', 'empty update is blocked with a message at the field', async () => {
    await show(pg, 'FNP-2001'); await sleep(300)
    await submitBtn(pg, 'FNP-2001'); await sleep(400)
    const r = await pg.evaluate(() => {
      const card = document.querySelector('[data-jira-task="FNP-2001"]')
      const box = [...card.querySelectorAll('textarea')].find((t) => t.getAttribute('aria-hidden') !== 'true')
      return { invalid: box?.getAttribute('aria-invalid'), problem: card.querySelector('[data-submit-problem]')?.innerText || '', helper: card.querySelector('.Mui-error')?.closest('.MuiFormControl-root')?.innerText || '' }
    })
    const required = await pg.evaluate(() => document.querySelector('[data-jira-task="FNP-2001"] [data-update-box]')?.innerText || '')
    return { ok: r.invalid === 'true' && /Fill in/.test(r.problem) && /Required/i.test(required) && !wroteTo('FNP-2001', 'comment').length, detail: JSON.stringify({ ...r, required: required.slice(0, 80) }) }
  })

  await tryCase('A05', 'no Finished / Not finished / On hold choice is blocked', async () => {
    await typeIn(pg, 'FNP-2001', 0, 'Matched the forecast to the ledger for October.')
    await submitBtn(pg, 'FNP-2001'); await sleep(400)
    const err = await pg.evaluate(() => document.querySelector('[data-jira-task="FNP-2001"] [data-field-error="status"]')?.innerText || '')
    return { ok: !!err && !wroteTo('FNP-2001', 'comment').length, detail: err }
  })

  await tryCase('A06', 'Not finished without a reason is blocked and says why', async () => {
    await choose(pg, 'FNP-2001', 'Not finished'); await sleep(250)
    await submitBtn(pg, 'FNP-2001'); await sleep(400)
    const t = await cardText(pg, 'FNP-2001')
    return { ok: /why|reason/i.test(t.match(/Say why[^\n]*|why it is not finished[^\n]*/i)?.[0] || '') && !wroteTo('FNP-2001', 'comment').length, detail: (t.match(/[^\n]*why[^\n]*/gi) || []).join(' | ').slice(0, 200) }
  })

  await tryCase('A07', 'valid submit: comment + description in Jira, card says sent', async () => {
    await typeIn(pg, 'FNP-2001', 1, 'November close needs one more week.')
    await submitBtn(pg, 'FNP-2001')
    await waitPosted(pg, 'FNP-2001')
    await sleep(600)
    const flash = await pg.evaluate(() => document.querySelector('[data-posted="FNP-2001"]')?.innerText || '')
    const c = wroteTo('FNP-2001', 'comment').length
    const d = wroteTo('FNP-2001', 'description').length
    return { ok: c === 1 && d === 1 && /Posted to FNP-2001/.test(flash), detail: JSON.stringify({ comments: c, descriptions: d, flash }) }
  })
  await shot(pg, 'a07-posted')

  await tryCase('A08', 'Finished moves the Jira task to Done', async () => {
    await typeIn(pg, 'FNP-2010', 0, 'Pivot built and checked with FP&A.')
    await choose(pg, 'FNP-2010', 'Finished'); await sleep(200)
    await submitBtn(pg, 'FNP-2010')
    await waitPosted(pg, 'FNP-2010')
    await sleep(500)
    const t = wroteTo('FNP-2010', 'transition').map((w) => w.id)
    return { ok: t.includes('31') && issues.get('FNP-2010').status === 'Done', detail: JSON.stringify({ transitions: t, status: issues.get('FNP-2010').status }) }
  })

  await tryCase('A09', 'On hold moves the Jira task to its hold status, page says on hold', async () => {
    await sleep(2500) // the slide moves on by itself after a project is done
    await typeIn(pg, 'FNP-2006', 0, 'Paused while Kade re-scopes the portal.')
    await choose(pg, 'FNP-2006', 'On hold'); await sleep(200)
    const note = await pg.evaluate(() => document.querySelector('[data-jira-task="FNP-2006"] [data-hold-note]')?.innerText || '')
    await submitBtn(pg, 'FNP-2006')
    await waitPosted(pg, 'FNP-2006')
    await sleep(500)
    const t = wroteTo('FNP-2006', 'transition').map((w) => w.id)
    return { ok: t.includes('41') && issues.get('FNP-2006').status === 'On Hold' && /hold/i.test(note), detail: JSON.stringify({ transitions: t, note }) }
  })

  await tryCase('A10', 're-submitting the same day replaces the description entry, says so', async () => {
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^All \(/.test(b.textContent.trim()))?.click())
    await sleep(400)
    await show(pg, 'FNP-2001'); await sleep(300)
    const label = await pg.evaluate(() => document.querySelector('button[aria-label="submit FNP-2001"]')?.textContent.trim())
    await typeIn(pg, 'FNP-2001', 0, ' Also fixed the FX rate.')
    await submitBtn(pg, 'FNP-2001')
    await waitPosted(pg, 'FNP-2001')
    await sleep(600)
    const flash = await pg.evaluate(() => document.querySelector('[data-posted="FNP-2001"]')?.innerText || '')
    const desc = JSON.stringify(issues.get('FNP-2001').description || {})
    const entries = (desc.match(/update from/g) || []).length
    return { ok: label === 'Submit again' && entries === 1 && /replaced/.test(flash), detail: JSON.stringify({ label, entries, flash }) }
  })

  await tryCase('A13', 'partly reported: not counted as sent; member sees what is left', async () => {
    const w = (await call('GET', `/api/weekly/${WEEK}`, undefined, james)).body
    const t = await text(pg)
    const left = /Not updated yet \(1\)/.test(t)
    return { ok: w.mineStanding?.report !== 'ontime' && !w.mine?.reportSubmittedAt && left, detail: JSON.stringify({ report: w.mineStanding?.report, left, sentAt: w.mine?.reportSubmittedAt || null }) }
  })

  await tryCase('A14', 'text typed on one project survives moving away and back', async () => {
    await show(pg, 'FNP-2002'); await sleep(300)
    await typeIn(pg, 'FNP-2002', 0, 'Counted 40 of 120 lines.')
    await pg.click('[data-project-next]'); await sleep(500)
    await pg.click('[data-project-prev]'); await sleep(500)
    await show(pg, 'FNP-2002'); await sleep(300)
    const v = await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2002"] textarea')].find((t) => t.getAttribute('aria-hidden') !== 'true')?.value)
    return { ok: v === 'Counted 40 of 120 lines.', detail: v }
  })

  await tryCase('A15', 'text survives a reload (draft kept) and says it is not sent', async () => {
    await pg.reload({ waitUntil: 'networkidle0' })
    await waitWeek(pg); await sleep(800)
    await show(pg, 'FNP-2002'); await sleep(400)
    const r = await pg.evaluate(() => ({
      v: [...document.querySelectorAll('[data-jira-task="FNP-2002"] textarea')].find((t) => t.getAttribute('aria-hidden') !== 'true')?.value,
      note: document.querySelector('[data-jira-task="FNP-2002"] [data-draft-restored]')?.innerText || '',
    }))
    return { ok: r.v === 'Counted 40 of 120 lines.' && /not posted/.test(r.note), detail: JSON.stringify(r) }
  })

  await tryCase('A11', 'Submit all sends the complete ones, names the incomplete, loses nothing', async () => {
    // FNP-2002: text but no choice (incomplete). FNP-2001: changed again, complete.
    await typeIn(pg, 'FNP-2001', 0, ' Plus the summary tab.')
    await sleep(400)
    const bar = await pg.evaluate(() => document.querySelector('[data-submit-all-bar]')?.innerText || '')
    await pg.evaluate(() => document.querySelector('[data-submit-all]')?.click())
    await pg.waitForFunction(() => /sent to Jira/.test(document.querySelector('[data-submit-all-bar]')?.innerText || ''), { timeout: 30000 }).catch(() => {})
    await sleep(1500)
    const after = await pg.evaluate(() => document.querySelector('[data-submit-all-bar]')?.innerText || '')
    await show(pg, 'FNP-2002'); await sleep(300)
    const kept = await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2002"] textarea')].find((t) => t.getAttribute('aria-hidden') !== 'true')?.value)
    return { ok: /2 updates/.test(bar) && /1 of 2 sent/.test(after) && /FNP-2002/.test(after) && kept === 'Counted 40 of 120 lines.', detail: JSON.stringify({ bar, after, kept }) }
  })
  await shot(pg, 'a11-submit-all')

  await tryCase('A16', 'Decision needed requires its text, then reaches the manager', async () => {
    await show(pg, 'FNP-2002'); await sleep(300)
    await choose(pg, 'FNP-2002', 'Not finished'); await sleep(200)
    await typeIn(pg, 'FNP-2002', 1, 'Waiting for the store counts.')
    await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2002"] label')].find((l) => /Decision needed/.test(l.textContent))?.click())
    await sleep(250)
    await submitBtn(pg, 'FNP-2002'); await sleep(400)
    const blocked = !wroteTo('FNP-2002', 'comment').length && /decision/i.test(await cardText(pg, 'FNP-2002'))
    const errShown = await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2002"] .Mui-error')].length > 0)
    // The decision box is the last visible textarea.
    const h = await boxes(pg, 'FNP-2002')
    const n = await h.evaluate((l) => l.length)
    const el = await h.evaluateHandle((l, i) => l[i], n - 1)
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.asElement().click()
    const focused = await pg.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.closest('[data-submit-all-bar]') ? 'IN-BAR' : ''} ${document.activeElement?.closest('.MuiFormControl-root')?.querySelector('label')?.textContent || ''}`)
    await shot(pg, 'a16-typing')
    await pg.keyboard.type('Write off the unmatched lines or recount?')
    await submitBtn(pg, 'FNP-2002')
    await waitPosted(pg, 'FNP-2002')
    await sleep(800)
    const dec = (await call('GET', '/api/decisions', undefined, boss)).body.decisions || []
    const there = dec.some((d) => d.jiraKey === 'FNP-2002' && /Write off/.test(d.text || d.decisionText || ''))
    const errs = await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2002"] .Mui-error, [data-jira-task="FNP-2002"] [data-field-error], [data-jira-task="FNP-2002"] .MuiAlert-message')].map((e) => e.innerText).join(' | '))
    const vals = await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2002"] textarea')].filter((t) => t.getAttribute('aria-hidden') !== 'true').map((t) => t.value))
    return { ok: blocked && errShown && there, detail: JSON.stringify({ blocked, errShown, decisions: dec.map((d) => d.jiraKey), comments: wroteTo('FNP-2002', 'comment').length, focused, errs: errs.slice(0, 200), vals }) }
  })

  await tryCase('A12', 'every task reported: the report counts as sent', async () => {
    await sleep(500)
    const w = (await call('GET', `/api/weekly/${WEEK}`, undefined, james)).body
    const jw = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
    const left = [...(jw.tasks || [])].filter((t) => !t.update).map((t) => t.key)
    return { ok: !!w.mine?.reportSubmittedAt && w.mineStanding?.report === 'ontime' && !left.length, detail: JSON.stringify({ report: w.mineStanding?.report, left }) }
  })

  await tryCase('A17', 'a wrong file / oversized picture is refused plainly; a good one attaches', async () => {
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^All \(/.test(b.textContent.trim()))?.click())
    await sleep(300)
    await show(pg, 'FNP-2001'); await sleep(300)
    const txt = join(tmp, 'notes.txt'); writeFileSync(txt, 'not a picture')
    const big = join(tmp, 'huge.gif'); writeFileSync(big, Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(5 * 1024 * 1024, 1)]))
    const good = join(tmp, 'shot.png'); writeFileSync(good, PNG)
    const input = await pg.$('[data-jira-task="FNP-2001"] input[type=file]')
    const msgOf = () => pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2001"] .MuiAlert-message')].map((e) => e.innerText).join(' | '))
    await input.uploadFile(txt); await sleep(500)
    const m1 = await msgOf()
    await input.uploadFile(big); await sleep(1500)
    const m2 = await msgOf()
    await input.uploadFile(good); await sleep(800)
    const thumbs = await pg.$$eval('[data-jira-task="FNP-2001"] [data-attached-images] img', (l) => l.length)
    return { ok: /Only pictures/.test(m1) && /too large/.test(m2) && thumbs === 1, detail: JSON.stringify({ m1, m2, thumbs }) }
  })

  await tryCase('A23', 'Jira down at submit: kept, told plainly, Retry posts it', async () => {
    failComment.add('FNP-2001')
    await submitBtn(pg, 'FNP-2001')
    await waitPosted(pg, 'FNP-2001')
    await sleep(1500)
    await show(pg, 'FNP-2001'); await sleep(300)
    const warn = await pg.evaluate(() => document.querySelector('[data-jira-task="FNP-2001"] [data-post-failed]')?.innerText || '')
    const stored = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body.tasks.find((t) => t.key === 'FNP-2001')?.update?.jira?.state
    failComment.delete('FNP-2001')
    await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2001"] button')].find((b) => /Retry posting/.test(b.textContent))?.click())
    await waitPosted(pg, 'FNP-2001')
    await sleep(1500)
    const after = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body.tasks.find((t) => t.key === 'FNP-2001')?.update?.jira?.state
    return { ok: /NOT posted/.test(warn) && /down/i.test(warn) && stored === 'failed' && after === 'posted', detail: JSON.stringify({ warn: warn.slice(0, 140), stored, after }) }
  })

  await tryCase('A24', 'member cannot open admin pages by URL, nor read others’ weeks', async () => {
    await pg.goto(`${base}/#cost`, { waitUntil: 'networkidle0' }); await sleep(1500)
    const t1 = await text(pg)
    const costShown = /Cost & ROI/.test(t1) && /EAC|budget/i.test(t1)
    await pg.goto(`${base}/#dashboard`, { waitUntil: 'networkidle0' }); await sleep(1500)
    const t2 = await text(pg)
    const dashShown = /Who holds what/.test(t2)
    const w = (await call('GET', `/api/weekly/${WEEK}`, undefined, james)).body
    const others = (w.team || []).filter((r) => r.person !== 'james').length
    const gov = (await call('GET', '/api/gov', undefined, james)).status
    return { ok: !costShown && !dashShown && others === 0 && gov === 403, detail: JSON.stringify({ costShown, dashShown, others, gov, hash: await pg.evaluate(() => location.hash) }) }
  })

  await tryCase('A25', 'Plan week N button opens next week; confirming the plan works', async () => {
    await pg.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await waitWeek(pg); await sleep(800)
    const label = await pg.evaluate(() => document.querySelector('button[data-plan-box]')?.innerText || '')
    await pg.click('button[data-plan-box]')
    await pg.waitForFunction((n) => document.body.innerText.includes(`Week ${n}`) && /next week/i.test(document.body.innerText), { timeout: 30000 }, weekNo(NEXT))
    await pg.waitForFunction(() => /is set|Set dates \/ add tasks/.test(document.querySelector('[data-next-step]')?.innerText || ''), { timeout: 30000 }).catch(() => {})
    const step = await pg.evaluate(() => document.querySelector('[data-next-step]')?.innerText || '')
    await shot(pg, 'a25-plan')
    await pg.evaluate(() => [...document.querySelectorAll('[data-next-step] button')].find((b) => /is set/.test(b.textContent))?.click())
    await pg.waitForFunction(() => /is planned/.test(document.querySelector('[data-next-step]')?.innerText || ''), { timeout: 30000 }).catch(() => {})
    const after = await pg.evaluate(() => document.querySelector('[data-next-step]')?.innerText || '')
    const w = (await call('GET', `/api/weekly/${NEXT}`, undefined, james)).body
    return { ok: /Plan week \d+ before Mon 08:00/.test(label) && /is set/.test(step) && /is planned/.test(after) && !!w.mine?.planSubmittedAt, detail: JSON.stringify({ label, step: step.slice(0, 120), after: after.slice(0, 80) }) }
  })

  await tryCase('A18', 'a locked past week cannot be submitted and says why', async () => {
    const OLD = addWeeks(WEEK, -2)
    issues.set('FNP-2090', { key: 'FNP-2090', summary: 'Old week task', assignee: acc.james, parent: 'FNP-379', start: day(OLD, 0), due: day(OLD, 4), status: 'To Do', cat: 'new' })
    // A fresh load, on this week (the case before left it on next week).
    await pg.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await pg.reload({ waitUntil: 'networkidle0' })
    await waitWeek(pg); await sleep(500)
    for (let i = 0; i < 2; i++) { await pg.click('button[aria-label="previous week"]'); await sleep(1500) }
    await pg.waitForFunction((n) => document.body.innerText.includes(`Week ${n}`), { timeout: 30000 }, weekNo(OLD)).catch(async (e) => { await shot(pg, 'a18-stuck'); throw new Error(`${e.message} — page says: ${(await text(pg)).match(/Week \d+[^\n]*/g)?.slice(0, 3).join(' / ')}`) })
    await sleep(2500)
    const t = await text(pg)
    const submits = await pg.$$eval('button[aria-label^="submit "]', (l) => l.filter((b) => !b.disabled).length)
    const asksToWrite = await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task]')].some((c) => /Write your update|Required/i.test(c.innerText)))
    const api = await call('POST', `/api/weekly/${OLD}/jira/FNP-2090/update`, { progress: 'x', done: true }, james)
    await shot(pg, 'a18-locked')
    issues.delete('FNP-2090')
    return { ok: /locked|closed/i.test(t) && submits === 0 && api.status === 409 && !asksToWrite, detail: JSON.stringify({ submits, asksToWrite, api: api.status, says: (t.match(/[^\n]*(locked|closed)[^\n]*/i) || [''])[0].slice(0, 120) }) }
  })

  await tryCase('A21', 'a task started last week and due this week shows (past-due ones are not owed: owner rule 2026-11-06)', async () => {
    const jw = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
    return { ok: (jw.tasks || []).some((t) => t.key === 'FNP-2002'), detail: (jw.tasks || []).map((t) => t.key).join() }
  })
  await pg.close()

  /* ================================================== phone, as Kade */
  await tryCase('A22', 'at 390px: no sideways scroll, prev/next and Submit reachable', async () => {
    const k = await as(kade, { width: 390, height: 844, isMobile: true, hasTouch: true })
    await k.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await waitWeek(k); await sleep(1000)
    await shot(k, 'a22-phone')
    const r = await k.evaluate(() => {
      const vis = (el) => !!el && !!el.offsetParent && el.getBoundingClientRect().width > 0
      return {
        over: document.documentElement.scrollWidth - window.innerWidth,
        submit: vis(document.querySelector('button[aria-label^="submit "]')),
        submitInside: (() => { const b = document.querySelector('button[aria-label^="submit "]')?.getBoundingClientRect(); return b ? b.right <= window.innerWidth + 1 : false })(),
        fontPx: parseFloat(getComputedStyle(document.querySelector('[data-jira-task] textarea') || document.body).fontSize),
      }
    })
    await k.close()
    return { ok: r.over <= 0 && r.submit && r.submitInside && r.fontPx >= 14, detail: JSON.stringify(r) }
  })
  // Prev/next on a phone need more than one project: James at 390px.
  await tryCase('A22b', 'at 390px with several projects: prev/next buttons visible in the header', async () => {
    const j = await as(james, { width: 390, height: 844, isMobile: true, hasTouch: true })
    await j.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await waitWeek(j); await sleep(1000)
    await j.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^All \(/.test(b.textContent.trim()))?.click())
    await sleep(500)
    const r = await j.evaluate(() => ({
      over: document.documentElement.scrollWidth - window.innerWidth,
      prev: [...document.querySelectorAll('button[aria-label="previous project"]')].some((b) => b.offsetParent),
      next: [...document.querySelectorAll('button[aria-label="next project"]')].some((b) => b.offsetParent),
    }))
    await shot(j, 'a22b-phone-james')
    await j.close()
    return { ok: r.over <= 0 && r.prev && r.next, detail: JSON.stringify(r) }
  })

  /* ===================================================== Pol: nothing */
  await tryCase('A19', 'a member with no Jira tasks sees a friendly empty state with a next step', async () => {
    const p = await as(pol)
    await p.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await waitWeek(p); await sleep(1000)
    const t = await text(p)
    const add = await p.$$eval('button', (l) => l.some((b) => /Add a task/.test(b.textContent)))
    await shot(p, 'a19-empty')
    await p.close()
    const line = (t.match(/Nothing in Jira[^\n]*/) || [''])[0]
    return { ok: /Nothing in Jira with you as PIC/.test(t) && add && !/undated/.test(line), detail: line }
  })

  /* ================================================ unlinked account */
  await tryCase('A20', 'an account not linked to a person gets a clear message', async () => {
    const n = await as(nobody)
    await n.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await sleep(3000)
    const t = await text(n)
    await shot(n, 'a20-unlinked')
    await n.close()
    const times = (t.match(/not linked/gi) || []).length
    return { ok: /not linked/i.test(t) && /administrator/i.test(t) && times === 1, detail: `${times}× · ${(t.match(/[^\n]*not linked[^\n]*/i) || [''])[0].slice(0, 120)}` }
  })

  console.log(`\npage errors: ${[...new Set(pageErrors)].slice(0, 8).join(' | ') || 'none'}`)
} catch (e) {
  console.log(`CRASH ${e.stack}`)
  results.push({ id: 'CRASH', name: e.message, ok: false })
} finally {
  await browser?.close().catch(() => {})
  server.kill()
  await mongod.stop()
  fake.close()
  const failed = results.filter((r) => !r.ok)
  if (process.env.QA_OUT) writeFileSync(process.env.QA_OUT, JSON.stringify({ results, serverErrors: serverErr.filter((s) => /error/i.test(s)).slice(0, 10) }, null, 1))
  console.log(`\n${results.length - failed.length} of ${results.length} passed${failed.length ? `; failing: ${failed.map((r) => r.id).join(', ')}` : ''}`)
  process.exit(failed.length ? 1 : 0)
}
