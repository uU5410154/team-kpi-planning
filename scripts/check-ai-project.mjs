/**
 * A NEW PROJECT WITH THE LOTUS LLM — the draft, the checks on it, and the
 * three places it is offered (member Weekly, admin Projects, admin Timeline).
 *
 * Against the real server, a real mongod (in memory), a FAKE Jira that
 * records every write and a FAKE Lotus LLM. Nothing here reaches the live
 * site, a real Jira or the real LLM. Ports 5640–5642.
 *
 *   npm run build && node scripts/check-ai-project.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { normalizeDraft, optionsFor } from '../server/projectDraft.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`)
}

/* ------------------------------------------------- the checks on a draft */
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
{
  const adminOpts = optionsFor({ people: seed.people, projects: seed.projects, admin: true })
  const memberOpts = optionsFor({ people: seed.people, projects: seed.projects, me: { person: 'james' }, admin: false })
  check('a member is offered only themselves as PIC, and only Adhoc work / Change Request',
    memberOpts.people.length === 1 && memberOpts.people[0].id === 'james' && memberOpts.kinds.map((k) => k.id).join() === 'adhoc,cr',
    JSON.stringify({ people: memberOpts.people.map((p) => p.id), kinds: memberOpts.kinds.map((k) => k.id) }))
  check('an administrator is offered everybody and a plain Project too',
    adminOpts.people.length === seed.people.length && adminOpts.kinds[0].id === 'project')

  const a = normalizeDraft({
    summary: 'AP invoice matching', kind: 'project', pic: 'KADE', team: 'accounting', subTeam: 'ap (non-trade)',
    objective: 'process_automation', start: '2027-02-26', due: '2026-12-01', savingHours: '40.04', description: 'x',
  }, { options: adminOpts, admin: true })
  check('names, teams and sub teams are matched without regard to case; dates the wrong way round are swapped',
    a.draft.pic === 'kade' && a.draft.team === 'Accounting' && a.draft.subTeam === 'AP (Non-Trade)'
      && a.draft.start === '2026-12-01' && a.draft.due === '2027-02-26' && a.draft.savingHours === 40 && a.missing.length === 0,
    JSON.stringify(a))

  const b = normalizeDraft({
    summary: 'x', kind: 'project', pic: 'Somebody Else', team: 'Marketing', objective: 'world_peace', start: '2026-02-30', due: 'soon', savingHours: 'lots',
  }, { options: adminOpts, admin: true })
  check('anything the register does not know comes back empty and is named as missing',
    !b.draft.pic && !b.draft.team && !b.draft.objective && !b.draft.start && !b.draft.due && b.draft.savingHours == null
      && ['summary', 'pic', 'team', 'objective', 'start', 'due', 'savingHours'].every((k) => b.missing.includes(k)),
    JSON.stringify(b))

  const c = normalizeDraft({ summary: 'Fix the VAT report', kind: 'project', pic: 'kade' }, { options: memberOpts, me: { person: 'james' }, admin: false })
  check('a member\'s project is theirs whatever the words say, and cannot be a planned Project',
    c.draft.pic === 'james' && c.draft.kind === 'adhoc', JSON.stringify(c.draft))
}

/* ------------------------------------------------------------ fake Jira */
const team = seed.people
const acc = Object.fromEntries(team.map((p) => [p.id, `acc-${p.id}`]))
const writes = []
let nextKey = 9500
const body = (req) => new Promise((r) => { const b = []; req.on('data', (x) => b.push(x)); req.on('end', () => r(Buffer.concat(b).toString())) })
const fold = (s) => String(s || '').trim().toLowerCase()
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
  const raw = await body(req)
  const json = () => { try { return JSON.parse(raw) } catch { return {} } }
  if (u.pathname === '/rest/api/3/user/search') {
    const q = fold(u.searchParams.get('query'))
    const p = team.find((x) => fold(x.name) === q)
    return send(200, p ? [{ accountId: acc[p.id], displayName: p.name, accountType: 'atlassian', active: true }] : [])
  }
  if (u.pathname === '/rest/api/3/search/jql') return send(200, { issues: [] })
  if (/^\/rest\/api\/3\/issue\/createmeta\/[A-Z]+\/issuetypes$/.test(u.pathname)) {
    return send(200, { issueTypes: [{ id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 }, { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 }] })
  }
  if (req.method === 'POST' && u.pathname === '/rest/api/3/issue') {
    const key = `FNP-${nextKey++}`
    writes.push({ key, fields: json().fields || {} })
    return send(201, { key, id: String(nextKey) })
  }
  return send(404, { errorMessages: [`fake Jira has no ${req.method} ${u.pathname}`] })
})
await new Promise((r) => fake.listen(5641, r))

/* ------------------------------------------------------- fake Lotus LLM */
const asked = []
const ADMIN_ANSWER = {
  summary: 'AP invoice matching', kind: 'project', pic: 'kade', team: 'Accounting', subTeam: 'AP (Non-Trade)',
  objective: 'process_automation', start: '2026-12-01', due: '2027-02-26', savingHours: 40,
  description: 'Automate matching of AP invoices for Non-Trade.',
}
const MEMBER_ANSWER = {
  summary: 'VAT report fix', kind: 'project', pic: 'kade', team: 'Finance', subTeam: 'Central Finance',
  objective: null, start: '2026-12-07', due: '2026-12-18', savingHours: 6, description: 'Fix the VAT report totals.',
}
const llmFake = createServer(async (req, res) => {
  const b = JSON.parse(await body(req) || '{}')
  const sys = b.messages?.[0]?.content || ''
  const user = b.messages?.[1]?.content || ''
  asked.push({ sys, user })
  const content = /GARBAGE/.test(user) ? 'Sorry, I cannot help with that.'
    : `Here you are:\n\`\`\`json\n${JSON.stringify(/People \(id/.test(sys) ? ADMIN_ANSWER : MEMBER_ANSWER)}\n\`\`\``
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content } }] }))
})
await new Promise((r) => llmFake.listen(5642, r))

/* --------------------------------------------------------------- server */
const mongod = await MongoMemoryServer.create()
const PORT = 5640
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'check-ai-project-token-'.padEnd(48, '7')
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
    JIRA_BASE_URL: 'http://127.0.0.1:5641',
    JIRA_EMAIL: 'app@lotuss.com',
    JIRA_API_TOKEN: 'fake',
    JIRA_ALLOW_WRITES: 'true',
    JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log',
    APPS_CATALOG: 'off',
    LOTUS_API_KEY: 'fake-key',
    LOTUS_LLM_URL: 'http://127.0.0.1:5642/v1/chat/completions',
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
const plan = async () => (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body?.payload

let browser
try {
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'qa' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)

  /* ---- the API ---- */
  const dm = await call('POST', '/api/ai/project-draft', { text: 'The VAT report totals are wrong, fix them in December' }, james)
  check('a member gets a draft: PIC forced to them, kind not Project, the missing objective named',
    dm.status === 200 && dm.body.draft?.pic === 'james' && dm.body.draft?.kind === 'adhoc' && dm.body.missing?.includes('objective'),
    JSON.stringify(dm.body).slice(0, 300))
  check('the LLM is NOT shown the team list when a member drafts', !/People \(id/.test(asked.at(-1)?.sys || ''))
  const da = await call('POST', '/api/ai/project-draft', { text: 'AP invoice matching for Non-Trade, Kade leads, Dec to Feb, 40 hrs a month' }, boss)
  check('an administrator gets a draft with the PIC the words named', da.status === 200 && da.body.draft?.pic === 'kade' && da.body.missing?.length === 0,
    JSON.stringify(da.body.draft))
  check('the LLM is told today\'s date and the register\'s teams', /Today is \d{4}-\d{2}-\d{2}/.test(asked.at(-1)?.sys || '') && /AP \(Non-Trade\)/.test(asked.at(-1)?.sys || ''))
  const dg = await call('POST', '/api/ai/project-draft', { text: 'GARBAGE GARBAGE GARBAGE' }, boss)
  check('an answer that is not JSON is a plain error, not a broken form', dg.status === 502 && /fill the form in yourself/.test(dg.body.error || ''), dg.body.error)
  const ds = await call('POST', '/api/ai/project-draft', { text: 'hi' }, boss)
  check('too short to work from is refused', ds.status === 400)
  const dn = await call('POST', '/api/ai/project-draft', { text: 'anything at all here' })
  check('signed out, no draft', dn.status === 401 || dn.status === 403, dn.status)
  const blank = await call('GET', '/api/ai/project-draft', undefined, james)
  check('the form\'s lists for filling in by hand', blank.status === 200 && blank.body.options?.teams?.length >= 2 && blank.body.options?.people?.length === 1)
  const memberEpic = await call('POST', '/api/jira/epics', { summary: 'Sneaky', kind: 'project', start: '2026-12-01', due: '2026-12-02' }, james)
  check('a member cannot use the administrator\'s epic route', memberEpic.status === 403, memberEpic.status)
  const memberProject = await call('POST', '/api/jira/projects', { summary: 'Sneaky plan', kind: 'project', start: '2026-12-01', due: '2026-12-02' }, james)
  check('a member cannot raise a planned Project, only Adhoc work or a Change Request', memberProject.status === 400, JSON.stringify(memberProject.body))
  check('and neither attempt wrote to Jira', writes.length === 0, writes.length)

  /* ---- the browser ---- */
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
  const field = (pg, k) => pg.evaluate((key) => document.querySelector(`[data-ai-project] [data-field="${key}"]`)?.value ?? null, k)
  const describeAndDraft = async (pg, words) => {
    await pg.waitForSelector('[data-ai-project-text]')
    await pg.click('[data-ai-project-text]')
    await pg.keyboard.type(words)
    await pg.waitForFunction(() => !document.querySelector('[data-ai-project-draft]')?.disabled, { timeout: 10000 })
    await pg.click('[data-ai-project-draft]')
    await pg.waitForSelector('[data-ai-project-create]', { timeout: 20000 })
    await sleep(300)
  }

  // An administrator, on the Projects page.
  const a = await as(boss)
  await a.goto(`${base}/?go#projects`, { waitUntil: 'networkidle0' })
  await a.waitForSelector('[data-add-project-ai]', { timeout: 30000 })
  await a.click('[data-add-project-ai]')
  await describeAndDraft(a, 'AP invoice matching for Non-Trade, Kade leads, Dec to Feb, 40 hrs a month')
  const af = {}
  for (const k of ['kind', 'summary', 'pic', 'team', 'subTeam', 'start', 'due', 'objective', 'savingHours']) af[k] = await field(a, k)
  check('Projects: "Add with AI" fills the form from the description',
    af.kind === 'project' && af.summary === 'AP invoice matching' && af.pic === 'kade' && af.team === 'Accounting'
      && af.subTeam === 'AP (Non-Trade)' && af.start === '2026-12-01' && af.due === '2027-02-26' && af.objective === 'process_automation' && af.savingHours === '40',
    JSON.stringify(af))
  const before = writes.length
  check('nothing is created by drafting', before === 0, before)
  // The person corrects the name before creating.
  await a.click('[data-ai-project] [data-field="summary"]', { clickCount: 3 })
  await a.evaluate(() => document.activeElement?.select?.())
  await a.keyboard.type('AP invoice auto-matching')
  await a.click('[data-ai-project-create]')
  await a.waitForFunction(() => !document.querySelector('[data-ai-project]'), { timeout: 20000 })
  const epicW = writes.at(-1)
  check('Create makes ONE Jira epic, assigned to the PIC, unlabelled, with the corrected name and the dates',
    writes.length === 1 && epicW.fields.issuetype?.id === '10000' && epicW.fields.assignee?.accountId === acc.kade && !epicW.fields.labels
      && epicW.fields.summary === 'AP invoice auto-matching' && epicW.fields.duedate === '2027-02-26' && epicW.fields.customfield_10015 === '2026-12-01',
    JSON.stringify(epicW?.fields).slice(0, 300))
  await sleep(800)
  const note = await a.evaluate(() => document.querySelector('[data-ai-project-note]')?.innerText || '')
  check('and says what it did', note.includes(epicW.key) && /Watch/.test(note), note)
  // The autosave carries the row to the shared plan.
  let row = null
  for (let i = 0; i < 30 && !row; i++) { await sleep(500); row = (await plan())?.projects?.find((p) => p.jiraKey === epicW.key) }
  check('the register row is linked to the epic and carries the form, as Watch',
    row && row.pic === 'kade' && row.team === 'Accounting' && row.subTeam === 'AP (Non-Trade)' && row.savingHours === 40
      && row.objective === 'process_automation' && row.commitLevel === 'watch' && row.start === '2026-12-01' && row.due === '2027-02-26',
    JSON.stringify(row && { pic: row.pic, team: row.team, sub: row.subTeam, h: row.savingHours, obj: row.objective, cl: row.commitLevel, start: row.start, due: row.due }))
  const shown = await a.evaluate((k) => document.body.innerText.includes(k) || [...document.querySelectorAll('input')].some((i) => i.value === k), epicW.key)
  check('and it is on screen in the register', shown)

  // The Timeline offers it too.
  await a.goto(`${base}/?go#timeline`, { waitUntil: 'networkidle0' })
  await a.waitForSelector('[data-timeline-add-ai]', { timeout: 30000 })
  await a.click('[data-timeline-add-ai]')
  await a.waitForSelector('[data-ai-project-text]')
  // By hand: the form opens with the lists and nothing guessed.
  await a.click('[data-ai-project-byhand]')
  await a.waitForSelector('[data-ai-project-create]')
  const hand = { summary: await field(a, 'summary'), kind: await field(a, 'kind'), disabled: await a.evaluate(() => document.querySelector('[data-ai-project-create]').disabled), why: await a.evaluate(() => document.querySelector('[data-ai-project-problems]')?.innerText) }
  check('Timeline: "Add with AI" is there, and "Fill in by hand" opens an empty form that will not create until named, PIC and dated',
    hand.summary === '' && hand.kind === 'project' && hand.disabled && /Name the project/.test(hand.why || ''), JSON.stringify(hand))
  await a.keyboard.press('Escape')
  await sleep(400)

  // A member, on the Weekly page.
  const m = await as(james)
  await m.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
  await m.waitForSelector('[data-new-project-ai]', { timeout: 40000 })
  const memberHas = await m.evaluate(() => ({ timeline: !!document.querySelector('[data-timeline-add-ai]'), projects: !!document.querySelector('[data-add-project-ai]') }))
  await m.click('[data-new-project-ai]')
  await describeAndDraft(m, 'The VAT report totals are wrong, fix them in December')
  const mf = {
    pic: await field(m, 'pic'),
    kind: await field(m, 'kind'),
    picDisabled: await m.evaluate(() => !!document.querySelector('[data-ai-project] [data-field="pic"]')?.closest('.MuiInputBase-root')?.classList.contains('Mui-disabled')),
    missing: await m.evaluate(() => document.querySelector('[data-ai-project-missing]')?.innerText || ''),
    kinds: null,
  }
  check('Weekly: "New project with AI" fills the form; the PIC is the member and cannot be changed; the missing objective is pointed out',
    mf.pic === 'james' && mf.kind === 'adhoc' && mf.picDisabled && /objective/.test(mf.missing), JSON.stringify(mf))
  await m.click('[data-ai-project-create]')
  await m.waitForFunction(() => !document.querySelector('[data-ai-project]'), { timeout: 20000 })
  const mw = writes.at(-1)
  check('the member\'s Create makes an Adhoc-work epic assigned to them',
    writes.length === 2 && mw.fields.assignee?.accountId === acc.james && (mw.fields.labels || []).includes('adhoc-work') && mw.fields.summary === 'VAT report fix',
    JSON.stringify(mw?.fields).slice(0, 300))
  const mrow = (await plan())?.projects?.find((p) => p.jiraKey === mw.key)
  check('and the register row has them as PIC, the team and sub team, and their saving estimate as a note — not as KPI hours',
    mrow && mrow.pic === 'james' && mrow.team === 'Finance' && mrow.subTeam === 'Central Finance' && mrow.savingHours == null
      && /estimates about 6 saving hours a month/.test(mrow.comment || ''),
    JSON.stringify(mrow && { pic: mrow.pic, team: mrow.team, sub: mrow.subTeam, h: mrow.savingHours, c: mrow.comment }))
  check('a member sees no admin "Add with AI" buttons', !memberHas.timeline && !memberHas.projects, JSON.stringify(memberHas))

  /* ---- "Add project" on the Timeline: straight to the form ---- */
  const setNative = (pg, k, v) => pg.evaluate((key, val) => {
    const el = document.querySelector(`[data-ai-project] [data-field="${key}"]`)
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, k, v)
  const pickMui = async (pg, k, optionText) => {
    await pg.evaluate((key) => document.querySelector(`[data-ai-project] [data-field="${key}"]`)?.closest('.MuiInputBase-root')
      ?.querySelector('[role="combobox"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })), k)
    await sleep(300)
    await pg.evaluate((t) => [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((o) => o.textContent.trim().startsWith(t))?.click(), optionText)
    await sleep(300)
  }
  await a.goto(`${base}/?go#timeline`, { waitUntil: 'networkidle0' })
  await a.waitForSelector('[data-timeline-add]', { timeout: 30000 })
  await a.click('[data-timeline-add]')
  await a.waitForSelector('[data-ai-project-create]', { timeout: 15000 })
  const direct = await a.evaluate(() => !document.querySelector('[data-ai-project-text]'))
  await setNative(a, 'summary', 'Month-end close checklist')
  await pickMui(a, 'pic', 'Gun')
  await setNative(a, 'start', '2026-12-01')
  await setNative(a, 'due', '2026-12-31')
  await sleep(300)
  const w0 = writes.length
  await a.click('[data-ai-project-create]')
  await a.waitForFunction(() => !document.querySelector('[data-ai-project]'), { timeout: 20000 })
  const tw = writes.at(-1)
  await sleep(800)
  const onChart = await a.evaluate((k) => !!document.querySelector(`[data-keys~="NEW-1"], [data-keys]`) && document.body.innerText.includes('Month-end close checklist'), tw?.key)
  check('Timeline: "Add project" opens the form directly; Create makes the epic for the PIC and the project is on the chart',
    direct && writes.length === w0 + 1 && tw.fields.assignee?.accountId === acc.gun && tw.fields.summary === 'Month-end close checklist' && onChart,
    JSON.stringify({ direct, n: writes.length - w0, who: tw?.fields.assignee, onChart }))

  /* ---- a member, on their own Timeline ---- */
  const mt = await as(james)
  await mt.goto(`${base}/#timeline`, { waitUntil: 'networkidle0' })
  await mt.waitForSelector('[data-timeline-add-own] [data-timeline-add]', { timeout: 30000 })
  const mtHas = await mt.evaluate(() => ({ find: [...document.querySelectorAll('button')].some((b) => /Find new epics|Sync with Jira/.test(b.textContent)), ai: !!document.querySelector('[data-timeline-add-own] [data-timeline-add-ai]') }))
  await mt.click('[data-timeline-add-own] [data-timeline-add]')
  await mt.waitForSelector('[data-ai-project-create]', { timeout: 15000 })
  const mtForm = { pic: await field(mt, 'pic'), kind: await field(mt, 'kind') }
  await setNative(mt, 'summary', 'Fix the accrual upload')
  await setNative(mt, 'start', '2026-12-02')
  await setNative(mt, 'due', '2026-12-09')
  await sleep(300)
  const w1 = writes.length
  await mt.click('[data-ai-project-create]')
  await mt.waitForFunction(() => !document.querySelector('[data-ai-project]'), { timeout: 20000 })
  await sleep(1200)
  const mtw = writes.at(-1)
  const mtShown = await mt.evaluate(() => document.body.innerText.includes('Fix the accrual upload'))
  const mtRow = (await plan())?.projects?.find((p) => p.jiraKey === mtw?.key)
  check('a member\'s own Timeline has "Add project" and "Add with AI" (no Jira sync buttons); it creates THEIR Adhoc epic and shows it at once',
    !mtHas.find && mtHas.ai && mtForm.pic === 'james' && mtForm.kind === 'adhoc' && writes.length === w1 + 1
      && mtw.fields.assignee?.accountId === acc.james && mtRow?.pic === 'james' && mtShown,
    JSON.stringify({ mtHas, mtForm, n: writes.length - w1, row: !!mtRow, mtShown }))

  // On a phone the dialog takes the width, less the theme's 12px edge, and nothing scrolls sideways.
  const p = await as(boss, { width: 390, height: 844 })
  await p.goto(`${base}/?go#projects`, { waitUntil: 'networkidle0' })
  await p.waitForSelector('[data-add-project-ai]', { timeout: 30000 })
  await p.evaluate(() => document.querySelector('[data-add-project-ai]').click())
  await describeAndDraft(p, 'AP invoice matching for Non-Trade, Kade leads, Dec to Feb, 40 hrs a month')
  const ph = await p.evaluate(() => {
    const d = document.querySelector('[data-ai-project] .MuiDialog-paper')
    return { w: Math.round(d.getBoundingClientRect().width), sideways: d.scrollWidth - d.clientWidth }
  })
  check('on a phone the form takes the width (less the 12px edge every dialog has) without sideways scrolling', ph.w >= 360 && ph.sideways <= 0, JSON.stringify(ph))

  check('no page errors', pageErrors.length === 0, [...new Set(pageErrors)].slice(0, 4).join(' | '))
} catch (e) {
  failed++
  console.log(`CRASH ${e.stack}`)
} finally {
  await browser?.close().catch(() => {})
  server.kill()
  await mongod.stop()
  fake.close()
  llmFake.close()
  const errs = serverErr.filter((s) => /error/i.test(s))
  if (errs.length) console.log(`server stderr: ${errs.slice(0, 4).join(' | ').slice(0, 600)}`)
  console.log(failed ? `${failed} CHECK(S) FAILED` : 'ALL CHECKS PASSED')
  process.exit(failed ? 1 : 0)
}
