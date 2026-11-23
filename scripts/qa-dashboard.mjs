/**
 * QA, AREA B — the manager's Dashboard, end to end and on fake data only.
 *
 * The real server against an in-memory database, a fake Jira and a fake
 * OpenAI-compatible LLM. Team members send their week through the real API;
 * an administrator then reads the Dashboard in a real browser. Every case
 * B01–B25 prints PASS or FAIL with what it saw.
 *
 *   npm run build && node scripts/qa-dashboard.mjs [--shots DIR]
 *
 * Never the live site, never a real Jira: every URL here is 127.0.0.1.
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MongoMemoryServer } from 'mongodb-memory-server'
import puppeteer from 'puppeteer-core'
import { weekOf } from '../src/lib/weekly.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SHOTS = (() => { const i = process.argv.indexOf('--shots'); return i > 0 ? process.argv[i + 1] : null })()
if (SHOTS && !existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const day = (w, n) => { const d = new Date(`${w}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const PORT = 5610
const JPORT = 5611
const LPORT = 5612
const base = `http://127.0.0.1:${PORT}`

const results = []
const check = (id, ok, detail = '') => {
  results.push({ id, ok: !!ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id} ${detail ? `— ${String(detail).slice(0, 300)}` : ''}`)
}

const WEEK = weekOf()
const seed = JSON.parse(readFileSync(`${ROOT}/src/data/seed.json`, 'utf8'))
const team = seed.people.filter((p) => p.scorecard !== false)
const acc = Object.fromEntries(team.map((p) => [p.id, `acc-${p.id}`]))
const nameOfAcc = Object.fromEntries(team.map((p) => [acc[p.id], p.name]))

/* A project with a very long name and no PIC trouble, for B24. */
const LONG_NAME = 'Very long project name for wrapping — consolidation of the regional finance reporting packs across every business unit and every legal entity, phase two'
const isDone = (p) => /done|complete|cancel/i.test(`${p.status || ''} ${p.srcStatus || ''}`)
const live = seed.projects.filter((p) => p.jiraKey && !p.deleted && !/\[deleted\]/i.test(p.summary) && !isDone(p))

/* ---------------------------------------------- the week's Jira, invented */
const issues = new Map()
const put = (key, f) => issues.set(key, { key, ...f })
let n = 7001
const tasksOf = {}
const firstOwned = {}
for (const person of team) {
  const mine = live.filter((p) => p.pic === person.id).slice(0, 3)
  for (const p of mine) {
    const epic = p.jiraKey.toUpperCase()
    if (!issues.has(epic)) {
      put(epic, { summary: p.summary, type: 'Epic', assignee: acc[person.id], start: p.start || null, due: p.due || null, status: 'In Progress', cat: 'indeterminate' })
    }
    for (let i = 0; i < 2; i++) {
      const key = `FNP-${n++}`
      put(key, { summary: `${p.summary.slice(0, 40)} — step ${i + 1}`, assignee: acc[person.id], parent: epic, start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
      ;(tasksOf[person.id] = tasksOf[person.id] || []).push({ key, project: p.key, epic })
    }
    if (!firstOwned[person.id]) firstOwned[person.id] = p
  }
}

const jiraState = { down: false }
const writes = []
const asRaw = (i) => ({
  key: i.key,
  fields: {
    summary: i.summary,
    status: { name: i.status, statusCategory: { key: i.cat } },
    duedate: i.due || null,
    customfield_10015: i.start || null,
    assignee: i.assignee ? { accountId: i.assignee, displayName: nameOfAcc[i.assignee] } : null,
    issuetype: { name: i.type || 'Task' },
    parent: i.parent ? { key: i.parent, fields: { summary: issues.get(i.parent)?.summary || '', status: { name: issues.get(i.parent)?.status || 'To Do' } } } : null,
    created: '2026-01-01T00:00:00.000+0700', updated: '2026-01-01T00:00:00.000+0700', resolutiondate: null, description: i.description || null,
  },
})
const body = (req) => new Promise((r) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => r(Buffer.concat(b))) })
const fold = (s) => String(s || '').trim().toLowerCase()
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
  const raw = await body(req)
  const json = () => { try { return JSON.parse(raw.toString()) } catch { return {} } }
  const m = (re) => u.pathname.match(re)
  if (jiraState.down) return send(503, { errorMessages: ['Jira is down for maintenance'] })
  if (u.pathname === '/rest/api/3/user/search') {
    const q = fold(u.searchParams.get('query'))
    const p = team.find((x) => fold(x.name) === q)
    return send(200, p ? [{ accountId: acc[p.id], displayName: p.name, accountType: 'atlassian', active: true }] : [])
  }
  if (u.pathname === '/rest/api/3/search/jql') {
    const jql = json().jql || ''
    const a = (jql.match(/assignee = "([^"]+)"/) || [])[1]
    const dueFrom = (jql.match(/duedate >= "([^"]+)"/) || [])[1]
    const under = (jql.match(/parent IN \(([^)]*)\)/) || [])[1]?.split(',').map((s) => s.trim().replace(/"/g, ''))
    const list = [...issues.values()].filter((i) => (a ? i.assignee === a : true)
      && (!under || under.includes(i.key) || under.includes(i.parent))
      && (!dueFrom || !i.due || i.due >= dueFrom))
    return send(200, { issues: list.map(asRaw) })
  }
  let k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/)
  if (k) { writes.push({ kind: 'comment', key: k[1], body: raw.toString() }); return send(201, { id: `c${writes.length}` }) }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/attachments$/)
  if (k) return send(200, [])
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/)
  if (k) {
    if (req.method === 'GET') return send(200, { transitions: [{ id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }, { id: '41', name: 'Put on hold', to: { name: 'On Hold', statusCategory: { key: 'indeterminate' } } }] })
    const i = issues.get(k[1]); const tid = json().transition?.id
    writes.push({ kind: 'transition', key: k[1], id: tid })
    if (i && tid === '41') { i.status = 'On Hold' } else if (i) { i.status = 'Done'; i.cat = 'done' }
    return send(204)
  }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/)
  if (k) {
    const i = issues.get(k[1])
    if (!i) return send(404, { errorMessages: ['Issue does not exist'] })
    if (req.method === 'PUT') { const f = json().fields || {}; if ('description' in f) i.description = f.description; if ('duedate' in f) i.due = f.duedate; writes.push({ kind: 'put', key: k[1], fields: Object.keys(f) }); return send(204) }
    return send(200, asRaw(i))
  }
  return send(404, { errorMessages: [`fake Jira has no ${req.method} ${u.pathname}`] })
})
await new Promise((r) => fake.listen(JPORT, r))

/* The fake LLM: a summary that repeats what members wrote, so B15 can see it got through. */
const llmCalls = []
const fakeLlm = createServer(async (req, res) => {
  const raw = (await body(req)).toString()
  let j = {}
  try { j = JSON.parse(raw) } catch { /* */ }
  const user = j.messages?.at(-1)?.content || ''
  llmCalls.push(user)
  const said = [...user.matchAll(/their update: (.+)/g)].map((x) => x[1]).slice(0, 3)
  const content = `**Headline** — QA summary of ${said.length} updates.\n### Focus\n${said.map((s) => `- ${s}`).join('\n') || '- nothing yet'}`
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }))
})
await new Promise((r) => fakeLlm.listen(LPORT, r))

/* --------------------------------------------------------------- server */
const mongod = await MongoMemoryServer.create()
const TOKEN = 'qa-dashboard-service-token-'.padEnd(48, '7')
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: ROOT,
  env: {
    ...process.env, PORT: String(PORT), MONGODB_URI: mongod.getUri(), MONGODB_DB: 'team_kpi_planning', AUTH_SECRET: 's', AUTH_ADMIN_EMAILS: 'boss@lotuss.com', KPI_SERVICE_TOKEN: TOKEN,
    JIRA_BASE_URL: `http://127.0.0.1:${JPORT}`, JIRA_EMAIL: 'app@lotuss.com', JIRA_API_TOKEN: 'fake', JIRA_ALLOW_WRITES: 'true', JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log', SMTP_USER: 'sender@gmail.com', APP_URL: 'https://kpi.example', LOTUS_API_KEY: 'fake-key', LOTUS_LLM_URL: `http://127.0.0.1:${LPORT}/v1/chat/completions`,
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

let br
try {
  // The plan, with one project given a very long name (B24).
  const plan = JSON.parse(JSON.stringify(seed))
  const longP = firstOwned.james || firstOwned[team[0].id]
  // One active project put on hold in the register (B11): the last one of the third member's.
  const holdPeople = Object.keys(tasksOf)
  const HOLD = tasksOf[holdPeople[2]]?.at(-1)?.project || null
  plan.projects = plan.projects.map((p) => (p.key === longP.key ? { ...p, summary: LONG_NAME }
    : p.key === HOLD ? { ...p, onHold: { at: new Date().toISOString(), by: 'qa' } } : p))
  await call('PUT', '/api/scenarios/Baseline', { payload: plan, updatedBy: 'qa' }, 'service')
  const boss = await signUp('boss@lotuss.com')

  /* ------------------------------------------------- each member's week */
  const cookies = {}
  for (const person of team) {
    const email = `${person.id}@lotuss.com`
    cookies[person.id] = await signUp(email)
    await call('PUT', `/api/auth/users/${email}`, { person: person.id }, boss)
  }
  const LONG_UPDATE = `Long update for wrapping. ${'Reconciled the intercompany balances, chased the open items with each entity and wrote up the variances. '.repeat(14)}`
  const sendTask = async (pid, t, b) => {
    const r = await call('POST', `/api/weekly/${WEEK}/jira/${t.key}/update`, b, cookies[pid])
    if (r.status !== 200) console.log(`  (setup) ${pid} ${t.key} → ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    return r
  }
  // James: plans, and reports every task: the first with a very long update.
  const people = Object.keys(tasksOf)
  const J = people.includes('james') ? 'james' : people[0]
  const K = people.includes('kade') ? 'kade' : people[1]
  const P = people.find((x) => x !== J && x !== K)
  await call('POST', `/api/weekly/${WEEK}/jira/plan`, {}, cookies[J])
  for (const [i, t] of tasksOf[J].entries()) {
    await sendTask(J, t, i === 0 ? { progress: LONG_UPDATE, done: true } : { progress: `QA-WORDS-${t.key} finished the mapping and handed it over.`, done: true })
  }
  // Kade: one of their tasks blocked, one with a decision; the rest left out.
  await call('POST', `/api/weekly/${WEEK}/jira/plan`, {}, cookies[K])
  const [k1, k2] = tasksOf[K]
  await sendTask(K, k1, { progress: 'Started the load, stopped at the source.', done: false, reason: 'Waiting for the data feed.', blocker: 'QA-BLOCKER IT has not opened the SAP extract.' })
  await sendTask(K, k2, { progress: 'Two options drafted.', done: false, reason: 'Waiting on a decision.', decision: true, decisionText: 'QA-DECISION allocate by sales or by headcount?' })
  // P: one task on hold.
  if (P && tasksOf[P]?.length) await sendTask(P, tasksOf[P][0], { progress: 'Paused at the business’s request.', done: false, hold: true })

  // A date-change proposal through the Monday form, for someone outside Jira mode.
  const formPerson = team.find((x) => !tasksOf[x.id])
  let proposal = null
  if (formPerson) {
    const proj = plan.projects.find((p) => p.pic === formPerson.id && p.due && !p.deleted) || plan.projects.find((p) => p.due && !p.deleted && !isDone(p))
    const later = day(proj.due, 21)
    const save = await call('PUT', `/api/weekly/${WEEK}/mine`, {
      focus: 'QA focus', submit: 'report',
      tasks: [{ id: 't1', title: 'QA slipping task', projectKey: proj.key, expected: day(WEEK, 4), priority: 'must', effort: 2, done: false, pct: 40, newDate: later, affects: true, blockerCategory: 'it', blocker: 'Waiting for IT' }],
    }, cookies[formPerson.id])
    if (save.status !== 200) console.log('  (setup) proposal problems', JSON.stringify(save.body))
    proposal = { person: formPerson.id, project: proj.key, from: proj.due, to: later, save: save.status, err: save.body?.error || save.body?.problems }
    console.log('  (setup) proposal', JSON.stringify(proposal))
  }

  /* ------------------------------------------------------------ browser */
  const exe = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p))
  br = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'], protocolTimeout: 120000 })
  const pageErrors = []
  const open = async (who, vp = { width: 1440, height: 900 }) => {
    const pg = await br.newPage()
    pg.on('dialog', (d) => d.accept())
    pg.on('pageerror', (e) => pageErrors.push(e.message))
    pg.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text().slice(0, 300)) })
    await pg.setViewport(vp)
    const [cn, cv] = who.split('=')
    await pg.setCookie({ name: cn, value: cv, url: base })
    return pg
  }
  const ready = async (pg) => {
    await pg.waitForFunction(() => document.querySelector('section[aria-label="who holds what"] [data-owners-tabs], section[aria-label="who holds what"] [data-project]'), { timeout: 60000 }).catch(() => {})
    await sleep(1500)
  }
  const shot = (pg, name, full = false) => (SHOTS ? pg.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }) : null)
  const text = (pg, sel) => pg.evaluate((s) => document.querySelector(s)?.innerText || '', sel)
  const OWN = 'section[aria-label="who holds what"]'
  const clickOwnersFilter = async (pg, v) => { await pg.evaluate((x) => document.querySelector(`[data-owners-filter="${x}"]`)?.click(), v); await sleep(400) }

  const a = await open(boss)
  await a.goto(`${base}/`, { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(a)

  // B01 — lands on the Dashboard, full width, no sideways scroll.
  const land = await a.evaluate(() => ({ h: document.querySelector('h1, h2, h3, h4')?.innerText || '', hash: window.location.hash, title: document.body.innerText.slice(0, 200) }))
  const widths = {}
  for (const w of [1280, 1440, 1920]) {
    await a.setViewport({ width: w, height: 900 }); await sleep(700)
    widths[w] = await a.evaluate(() => {
      const own = document.querySelector('section[aria-label="who holds what"]')?.getBoundingClientRect()
      return { over: document.documentElement.scrollWidth - window.innerWidth, ownW: Math.round(own?.width || 0) }
    })
  }
  await a.setViewport({ width: 1440, height: 900 }); await sleep(500)
  check('B01 dashboard first, full width, no sideways scroll', /Dashboard/.test(land.title) && Object.values(widths).every((x) => x.over <= 0) && widths[1920].ownW > 1500, JSON.stringify({ land: land.hash, widths }))
  await shot(a, 'b01-dashboard')

  // B02 — tile = card count = rows.
  await clickOwnersFilter(a, 'all')
  const tile = await text(a, 'section[aria-label="Active projects"], [data-card="active"]')
  const shown = Number((tile.match(/(\d+)\s*\n?\s*of \d+/) || [])[1])
  const own = await text(a, OWN)
  const said = Number((own.match(/(\d+) active projects?/) || [])[1])
  const listed = await a.evaluate((s) => document.querySelectorAll(`${s} [data-project]`).length, OWN)
  check('B02 active tile = card count = rows', shown > 0 && shown === said && said === listed, `tile ${shown} · card ${said} · rows ${listed}`)

  // B03 — updated tile counts only fully reported projects.
  const upd = await text(a, '[data-card="updated"]')
  const updN = Number((upd.match(/(\d+)\s*\n?\s*of \d+/) || [])[1])
  const fully = await a.evaluate((s) => [...document.querySelectorAll(`${s} [data-project]`)].filter((r) => /All \d+ reported/i.test(r.innerText)).length, OWN)
  check('B03 updated tile = fully reported rows', Number.isFinite(updN) && updN === fully, `tile ${updN} · rows with "All n reported" ${fully} · ${upd.replace(/\n/g, ' | ')}`)

  // B04 — a new update shows without a reload.
  const kLeft = tasksOf[K][2] || null
  const target = kLeft || tasksOf[K][0]
  await sendTask(K, target, { progress: `QA-LIVE-${target.key} just sent while the dashboard was open.`, done: true })
  const seenAt = Date.now()
  let liveSeen = false
  // a visible refresh, if there is one; otherwise the tab regaining focus; otherwise wait.
  const hasRefresh = await a.evaluate(() => !!document.querySelector('[data-dash-refresh]'))
  if (hasRefresh) await a.evaluate(() => document.querySelector('[data-dash-refresh]').click())
  else await a.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')) })
  for (let i = 0; i < 20 && !liveSeen; i++) { await sleep(1000); liveSeen = (await text(a, OWN)).includes(`QA-LIVE-${target.key}`) }
  check('B04 a new update shows without reloading the page', liveSeen && hasRefresh, `seen ${liveSeen} after ${Math.round((Date.now() - seenAt) / 1000)}s · refresh button ${hasRefresh}`)

  // B05 — member tabs.
  await clickOwnersFilter(a, 'all')
  const tabs = await a.evaluate(() => [...document.querySelectorAll('[data-owners-tab]')].map((t) => ({ id: t.dataset.ownersTab, label: t.innerText.trim() })))
  const everyone = Number((tabs.find((t) => t.id === 'all')?.label.match(/\((\d+)\)/) || [])[1])
  const sum = tabs.filter((t) => t.id !== 'all').reduce((s, t) => s + Number((t.label.match(/\((\d+)\)/) || [])[1] || 0), 0)
  const pick = tabs.find((t) => t.id !== 'all' && /\((?!0\))\d+\)/.test(t.label))
  await a.evaluate((id) => document.querySelector(`[data-owners-tab="${id}"]`)?.click(), pick?.id); await sleep(500)
  const onlyThem = await a.evaluate((s) => {
    const heads = [...document.querySelectorAll(`${s} tbody tr td[colspan]`)].map((td) => td.innerText.split('\n')[0].trim())
    return { heads, rows: document.querySelectorAll(`${s} [data-project]`).length }
  }, OWN)
  const pickN = Number((pick?.label.match(/\((\d+)\)/) || [])[1])
  await clickOwnersFilter(a, 'stale')
  const tabsAtt = await a.evaluate(() => [...document.querySelectorAll('[data-owners-tab]')].map((t) => t.innerText.trim()))
  await a.evaluate(() => document.querySelector('[data-owners-tab="all"]')?.click()); await sleep(300)
  check('B05 member tabs: counts add up, a name shows only theirs, counts follow the toggle',
    everyone === sum && everyone === listed && onlyThem.heads.length === 1 && onlyThem.rows === pickN && tabsAtt.join() !== tabs.map((t) => t.label).join(),
    JSON.stringify({ everyone, sum, pick: pick?.label, onlyThem, tabsAtt }))

  // B06 — tabs pinned while the list scrolls.
  await clickOwnersFilter(a, 'all')
  const stuck = await a.evaluate(() => {
    const tabsEl = document.querySelector('section[aria-label="who holds what"] [data-owners-tabs]')
    let box = tabsEl?.parentElement
    while (box && !(box.scrollHeight > box.clientHeight + 20 && window.getComputedStyle(box).overflowY === 'auto')) box = box.parentElement
    if (!tabsEl || !box) return { skipped: true }
    box.scrollTop = 400
    const d = Math.round(tabsEl.getBoundingClientRect().top - box.getBoundingClientRect().top)
    box.scrollTop = 0
    return { d }
  })
  check('B06 member tabs stay pinned', !stuck.skipped && Math.abs(stuck.d) <= 2, JSON.stringify(stuck))

  // B07 — a member with nothing under the toggle says so.
  await clickOwnersFilter(a, 'stale')
  const allTabs = await a.evaluate(() => [...document.querySelectorAll('[data-owners-tab]')].map((t) => ({ id: t.dataset.ownersTab, label: t.innerText.trim() })))
  const zero = allTabs.find((t) => /\(0\)/.test(t.label))
  let zeroMsg = ''
  if (zero) {
    await a.evaluate((id) => document.querySelector(`[data-owners-tab="${id}"]`)?.click(), zero.id); await sleep(400)
    zeroMsg = await text(a, OWN)
  }
  check('B07 an empty member tab says why and how to see more', !zero || /Nothing for .+ pick All/.test(zeroMsg), zero ? zeroMsg.split('\n').slice(-2).join(' | ') : 'no zero tab under Not updated')
  await a.evaluate(() => document.querySelector('[data-owners-tab="all"]')?.click()); await sleep(300)

  // B08 — project name opens its page; Back returns with the tab and the toggle kept.
  await clickOwnersFilter(a, 'all')
  await a.evaluate((id) => document.querySelector(`[data-owners-tab="${id}"]`)?.click(), pick?.id); await sleep(400)
  const pkey = await a.evaluate((s) => { const t = document.querySelector(`${s} [data-open-project]`); t?.click(); return t?.dataset.openProject }, OWN)
  await sleep(1500)
  const onProject = await a.evaluate(() => decodeURIComponent(window.location.hash))
  await a.goBack({ waitUntil: 'networkidle0' }).catch(() => {})
  await ready(a)
  const back = await a.evaluate(() => ({
    hash: window.location.hash,
    tab: document.querySelector('[data-owners-tab][aria-selected="true"]')?.dataset.ownersTab,
    filter: document.querySelector('[data-owners-filter][aria-pressed="true"]')?.dataset.ownersFilter,
  }))
  check('B08 project name opens its page; Back keeps the tab and the toggle', onProject === `#project/${pkey}` && back.tab === pick?.id && back.filter === 'all', JSON.stringify({ onProject, back, want: pick?.id }))
  await a.evaluate(() => document.querySelector('[data-owners-tab="all"]')?.click()); await sleep(300)

  // B09 — a task opens its project page.
  const t9 = await a.evaluate((s) => { const t = document.querySelector(`${s} [data-open-task]`); const key = t?.closest('[data-project]')?.dataset.project; t?.click(); return key }, OWN)
  await sleep(1000)
  const h9 = await a.evaluate(() => decodeURIComponent(window.location.hash))
  check('B09 a task opens its project page', !!t9 && h9 === `#project/${t9}`, `${t9} → ${h9}`)
  await a.goto(`${base}/`, { waitUntil: 'networkidle0' }); await ready(a)

  // B10 — follow up asks first, sends once, then says it was sent.
  await clickOwnersFilter(a, 'all')
  const fuKey = await a.evaluate(() => document.querySelector('button[aria-label^="follow up "]')?.getAttribute('aria-label').replace('follow up ', ''))
  const fuBefore = (await call('GET', '/api/followups?week=current', undefined, boss)).body.followups?.length || 0
  await a.evaluate((k) => document.querySelector(`button[aria-label="follow up ${k}"]`)?.click(), fuKey)
  await a.waitForSelector('[data-followup-confirm]', { timeout: 5000 }).catch(() => {})
  const asks = await text(a, '[data-followup-confirm]')
  await a.evaluate(() => { const b = [...document.querySelectorAll('[data-followup-confirm] button')].find((x) => /Send the email/.test(x.textContent)); b?.click(); b?.click() })
  await sleep(2500)
  const fuAfter = (await call('GET', '/api/followups?week=current', undefined, boss)).body.followups?.length || 0
  const fuCell = await a.evaluate((k) => document.querySelector(`[data-followup="${k}"]`)?.innerText || '', fuKey)
  check('B10 follow up asks first, sends once, shows it was sent', /Send the email/.test(asks) && fuAfter === fuBefore + 1 && /Asked|Updated/i.test(fuCell), JSON.stringify({ fuKey, fuBefore, fuAfter, fuCell: fuCell.replace(/\n/g, ' | ') }))

  // B11 — on hold: no follow-up, says why.
  const holdKey = HOLD
  const holdCell = holdKey ? await a.evaluate((k) => document.querySelector(`[data-followup="${k}"]`)?.innerText || document.querySelector(`[data-project="${k}"]`)?.innerText || '', holdKey) : ''
  const holdBtn = holdKey ? await a.$(`button[aria-label="follow up ${holdKey}"]`) : null
  check('B11 on hold: no follow-up, and says why', !!holdKey && /On hold — no update needed/.test(holdCell) && !holdBtn, `${holdKey}: ${holdCell.replace(/\n/g, ' | ').slice(0, 200)}`)

  // B12 — the team card's pills match what people did.
  const wk = (await call('GET', `/api/weekly/${WEEK}`, undefined, boss)).body
  const teamCard = await a.evaluate(() => [...document.querySelectorAll('[aria-label$="\'s week"]')].map((e) => e.innerText.replace(/\n/g, ' | ')))
  const nick = Object.fromEntries(plan.people.map((p) => [p.id, p.nick]))
  const label = { ontime: 'On time', late: 'Late', missing: 'Missing', pending: 'Not due yet', open: 'Not due yet' }
  const mism = (wk.team || []).filter((t) => t.required).filter((t) => {
    const row = teamCard.find((r) => r.split(' | ').map((x) => x.trim()).includes(nick[t.person] || t.person))
    return !row || !row.toLowerCase().includes(`plan: ${String(label[t.standing?.plan] || t.standing?.plan).toLowerCase()}`)
  }).map((t) => `${t.person}:${t.standing?.plan}`)
  check('B12 the team card agrees with each person’s plan standing', teamCard.length > 0 && mism.length === 0, `mismatch ${mism.join(', ') || 'none'} · ${teamCard.slice(0, 3).join(' || ')}`)

  // B13 — the decision a member raised shows, deciding removes it and writes to Jira.
  const decCard = await text(a, '[data-card="decisions"]')
  const hasDec = decCard.includes('QA-DECISION')
  const commentsBefore = writes.filter((w) => w.kind === 'comment' && w.key === k2.key).length
  let decided = false
  if (hasDec) {
    await a.evaluate(() => {
      const b = [...document.querySelectorAll('[data-card="decisions"] [data-decision] button')].find((x) => x.textContent.trim() === 'Mark decided')
      b?.click()
    })
    await sleep(600)
    const ta = await a.$('[data-card="decisions"] [data-decision] input')
    if (ta) { await ta.focus(); await a.keyboard.type('QA decided: by sales.') }
    await a.evaluate(() => {
      const b = [...document.querySelectorAll('[data-card="decisions"] [data-decision] button')].find((x) => x.textContent.trim() === 'Save' && !x.disabled)
      b?.click()
    })
    await sleep(2500)
    decided = !(await text(a, '[data-card="decisions"]')).includes('QA-DECISION allocate')
  }
  await sleep(1500)
  const commentsAfter = writes.filter((w) => w.kind === 'comment' && w.key === k2.key).length
  await shot(a, 'b13-after')
  if (pageErrors.length) console.log('  page errors so far:', pageErrors.slice(0, 3).join(' || '))
  check('B13 a raised decision shows; deciding clears it and writes to Jira', hasDec && decided && commentsAfter > commentsBefore, JSON.stringify({ hasDec, decided, commentsBefore, commentsAfter, card: decCard.replace(/\n/g, ' | ').slice(0, 200) }))

  // B14 — a date-change proposal can be approved and the plan follows.
  const decCard2 = await text(a, '[data-card="decisions"]')
  let approved = false
  if (proposal) {
    const hasProp = decCard2.includes(proposal.project)
    await a.evaluate((k) => document.querySelector(`[data-date-request="${k}"] [data-date-approve]`)?.click(), proposal.project)
    await sleep(3000)
    const after = (await call('GET', '/api/scenarios/Baseline', undefined, boss)).body
    const due = after.payload?.projects?.find((p) => p.key === proposal.project)?.due
    approved = due === proposal.to
    check('B14 a date change can be approved from the Dashboard and the plan follows', hasProp && approved, JSON.stringify({ hasProp, due, want: proposal.to, card: decCard2.replace(/\n/g, ' | ').slice(0, 240) }))
  } else check('B14 a date change can be approved from the Dashboard and the plan follows', false, 'no proposal could be raised in setup')

  // B15 — Rewrite now, with the member's words.
  await a.evaluate(() => document.querySelector('[data-card="summary"]')?.scrollIntoView())
  const hasRewrite = await a.evaluate(() => !!document.querySelector('[data-summary-rewrite]'))
  const callsBefore = llmCalls.length
  if (hasRewrite) {
    await a.evaluate(() => document.querySelector('[data-summary-rewrite]').click())
    await a.waitForFunction(() => /on request/.test(document.querySelector('[data-card="summary"]')?.innerText || ''), { timeout: 30000 }).catch(() => {})
  }
  const sum15 = await text(a, '[data-card="summary"]')
  const newCall = llmCalls.slice(callsBefore).at(-1) || ''
  check('B15 Rewrite now writes a summary with what members wrote', hasRewrite && /on request/.test(sum15) && /QA summary of [1-9]/.test(sum15) && /QA-LIVE-/.test(newCall),
    `${sum15.replace(/\n/g, ' | ').slice(0, 200)} · new LLM call carries the latest update: ${/QA-LIVE-/.test(newCall)}`)
  await shot(a, 'b15-summary')

  // B16 — the week switcher: last week's data; follow-ups say this week.
  const prevBtn = await a.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /previous week/i.test(x.getAttribute('aria-label') || ''))
    b?.click(); return !!b
  })
  await sleep(4000)
  const past = await text(a, OWN)
  const prevNo = await a.evaluate(() => document.body.innerText.match(/Week (\d+)/)?.[1])
  check('B16 last week from the switcher; follow-ups say they ask about this week', prevBtn && /Week before|week \d+/i.test(past) && (/Follow-ups ask about this week/.test(past) || !/Follow up/.test(past)), JSON.stringify({ prevBtn, prevNo, past: past.split('\n').slice(0, 4).join(' | ') }))
  await a.goto(`${base}/`, { waitUntil: 'networkidle0' }); await ready(a)

  // B17 — nothing stays loading.
  await sleep(6000)
  const stuckLoading = await a.evaluate(() => [...document.querySelectorAll('[data-card]')].filter((c) => /Loading/.test(c.innerText) && c.getBoundingClientRect().height > 0).map((c) => c.dataset.card))
  check('B17 no card stays on "Loading"', stuckLoading.length === 0, stuckLoading.join(', ') || 'none')

  // B18 — Jira unreachable: the card says so and still shows what was sent.
  jiraState.down = true
  const b18 = await open(boss)
  await b18.goto(`${base}/`, { waitUntil: 'networkidle0' }); await ready(b18)
  await b18.evaluate(() => document.querySelector('[data-owners-filter="all"]')?.click()); await sleep(800)
  const down = await text(b18, OWN)
  check('B18 Jira down: says so and still shows what people sent', /Jira could not be read/.test(down) && /QA-WORDS-|QA-LIVE-/.test(down), down.split('\n').slice(0, 6).join(' | '))
  await b18.close()
  jiraState.down = false

  // B19 — Edit layout at full width: open, cancel, nothing changes; no overflow while editing.
  const layoutBefore = (await call('GET', '/api/dashboard/layout', undefined, boss)).body
  await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit layout')?.click()); await sleep(800)
  const editOver = await a.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  const editing = await a.evaluate(() => /Drag a card by its title bar/.test(document.body.innerText))
  await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')?.click()); await sleep(600)
  const layoutAfter = (await call('GET', '/api/dashboard/layout', undefined, boss)).body
  check('B19 Edit layout works at full width; Cancel changes nothing', editing && editOver <= 0 && JSON.stringify(layoutBefore) === JSON.stringify(layoutAfter), JSON.stringify({ editing, editOver }))

  // B20 — phone width.
  const ph = await open(boss, { width: 390, height: 844, isMobile: true, hasTouch: true })
  await ph.goto(`${base}/`, { waitUntil: 'networkidle0' }); await ready(ph)
  const phone = await ph.evaluate(() => {
    const tabsEl = document.querySelector('[data-owners-tabs] .MuiTabs-scroller')
    return { over: document.documentElement.scrollWidth - window.innerWidth, tabsScroll: tabsEl ? tabsEl.scrollWidth > tabsEl.clientWidth : null, cards: document.querySelectorAll('[data-owner-cards]').length }
  })
  await shot(ph, 'b20-phone', true)
  check('B20 phone: stacked cards, tabs scroll sideways, no page overflow', phone.over <= 0 && phone.cards === 1, JSON.stringify(phone))
  await ph.close()

  // B21 — View as a member: read only.
  const v = await open(boss)
  await v.goto(`${base}/?go#weekly`, { waitUntil: 'networkidle0' }); await sleep(2500)
  await v.evaluate(() => { const s = [...document.querySelectorAll('input[type="checkbox"]')].find((i) => /view as|team member/i.test(i.closest('label, div')?.innerText || '')); s?.click() })
  await sleep(3000)
  const va = await v.evaluate(() => ({
    said: /read only/i.test(document.body.innerText),
    enabledSubmit: [...document.querySelectorAll('button')].filter((b) => /^Submit|^Send/i.test(b.textContent.trim()) && !b.disabled).length,
  }))
  check('B21 View as a member is read only and says so', va.said && va.enabledSubmit === 0, JSON.stringify(va))
  await v.close()

  // B22 — Blockers by type (an extra card): added in edit mode, shows the blocker, then cancelled.
  await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Edit layout')?.click()); await sleep(600)
  await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add card')?.click()); await sleep(500)
  await a.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Blockers by type/.test(m.textContent))?.click()); await sleep(1500)
  const blk = await text(a, '[data-card="blockers"]')
  await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Cancel')?.click()); await sleep(500)
  check('B22 Blockers by type shows the reported blocker', /QA-BLOCKER|SAP extract|Waiting for the data feed/.test(blk), blk.replace(/\n/g, ' | ').slice(0, 200))

  // B23 — "Latest update" and the follow-up's "Updated x ago" agree, once the owner answers a follow-up.
  const answer = Object.entries(tasksOf).flatMap(([pid, list]) => list.map((t) => ({ pid, t }))).find((x) => x.t.project === fuKey && x.pid !== J)
  if (answer) await sendTask(answer.pid, answer.t, { progress: 'QA answer to the follow-up.', done: true })
  await a.evaluate(() => document.querySelector('[data-dash-refresh]')?.click()); await sleep(4000)
  await clickOwnersFilter(a, 'all')
  const agree = await a.evaluate((s) => [...document.querySelectorAll(`${s} tr[data-project]`)].map((r) => {
    const cells = r.querySelectorAll('td')
    const latest = cells[3]?.innerText.trim()
    const fu = (cells[4]?.textContent.match(/Updated ((?:just now)|(?:\d+ ?(?:min|h|days?)))/i) || [])[1]
    return { key: r.dataset.project, latest, fu }
  }).filter((x) => x.fu), OWN)
  const disagree = agree.filter((x) => !x.latest.toLowerCase().startsWith(x.fu.toLowerCase()))
  const fus = (await call('GET', '/api/followups?week=current', undefined, boss)).body.followups || []
  check('B23 Latest update and "Updated x ago" agree', agree.length > 0 && disagree.length === 0, JSON.stringify(disagree.slice(0, 3)) + ` of ${agree.length} · answer ${answer ? `${answer.pid} ${answer.t.key}` : 'none'} · followups ${JSON.stringify(fus.map((f) => ({ k: f.projectKey, s: f.status, p: f.person })))}`)

  // B24 — long names and long updates do not break the table.
  const longRow = await a.evaluate((s, k) => {
    const r = document.querySelector(`${s} [data-project="${k}"]`)
    if (!r) return null
    const tbl = r.closest('table')
    const wrap = tbl?.parentElement
    const cell = r.querySelector('td')
    return {
      tableOver: wrap ? wrap.scrollWidth - wrap.clientWidth : null,
      cellOver: cell ? cell.scrollWidth - cell.clientWidth : null,
      clamped: [...r.querySelectorAll('p, span')].some((e) => window.getComputedStyle(e).webkitLineClamp === '3'),
      h: Math.round(r.getBoundingClientRect().height),
    }
  }, OWN, longP.key)
  check('B24 long name and long update wrap or clamp, never break the table', !!longRow && longRow.tableOver <= 0 && longRow.cellOver <= 1 && longRow.clamped && longRow.h < 400, JSON.stringify(longRow))

  // B25 — clickable looks clickable.
  const cur = await a.evaluate((s) => {
    const q = (sel) => [...document.querySelectorAll(sel)].slice(0, 3).map((e) => window.getComputedStyle(e).cursor)
    return { project: q(`${s} [data-open-project]`), task: q(`${s} [data-open-task]`), tab: q('[data-owners-tab]'), follow: q('button[aria-label^="follow up "]'), plainTitle: [...document.querySelectorAll(`${s} [data-week-task] > p`)].slice(0, 3).map((e) => window.getComputedStyle(e).cursor) }
  }, OWN)
  const allPointer = ['project', 'task', 'tab', 'follow'].every((k) => cur[k].length && cur[k].every((c) => c === 'pointer'))
  check('B25 every clickable thing shows a pointer; plain text does not', allPointer && cur.plainTitle.every((c) => c !== 'pointer'), JSON.stringify(cur))

  check('no page errors in the browser', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 3).join(' | '))
} catch (e) {
  console.log('CRASH', e.stack)
  results.push({ id: 'crash', ok: false })
} finally {
  if (br) await br.close().catch(() => {})
  const bad = serverErr.filter((s) => /error/i.test(s) && !/\[mail\]|\[followup\]/.test(s))
  if (bad.length) console.log('server errors:', bad.slice(0, 5).join('\n'))
  server.kill(); await mongod.stop(); fake.close(); fakeLlm.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — failed: ${failed.map((f) => f.id.split(' ')[0]).join(', ')}` : ''}`)
  process.exit(failed.length ? 1 : 0)
}
