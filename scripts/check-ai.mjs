/**
 * The AI: writing help, the weekly summary and the administrators' chatbot.
 *
 * Runs the real server against a real mongod and a FAKE Lotus LLM on
 * localhost, which records every request — so the checks can read exactly
 * what was sent (the key, the prompt, the data in it) as well as what came
 * back. Nothing reaches the real model.
 *
 *   node scripts/check-ai.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { weekOf, deadlines } from '../src/lib/weekly.js'
import { summarySlot } from '../server/ai.js'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'
import { weeklyForExport } from '../src/lib/api.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const BKK = (iso) => Date.parse(`${iso}+07:00`)

console.log('\n--- when the summary is written ---')
check('Monday 07:59 — not yet', summarySlot(BKK('2026-11-02T07:59')) === null)
check('MONDAY 08:00 — AFTER THE PLANS', summarySlot(BKK('2026-11-02T08:00')) === 'plan')
check('FRIDAY 15:00 — AFTER THE REPORTS', summarySlot(BKK('2026-11-06T15:00')) === 'report')
check('SUNDAY 15:00 — AFTER THE SECOND CHANCE', summarySlot(BKK('2026-11-08T15:00')) === 'second')
check('Wednesday — never', summarySlot(BKK('2026-11-04T12:00')) === null)

/* ------------------------------------------------------------ the leak */

console.log('\n--- the leaked key ---')
{
  const ref = new URL('../lotus-llm.md', import.meta.url)
  const leaked = existsSync(ref) ? (readFileSync(ref, 'utf8').match(/accounting\.lotuss\.[A-F0-9]+/) || [])[0] : null
  if (!leaked) {
    console.log('SKIP  the leaked key is not on this machine to try')
  } else {
    const llm = await import('../server/llm.js')
    process.env.LOTUS_API_KEY = leaked
    const st = llm.status()
    check('THE KEY FROM THE REFERENCE DOCUMENT IS REFUSED, NOT USED', st.configured === false && /leaked/.test(st.reason))
    process.env.LOTUS_API_KEY = 'some-new-key'
    check('  a new one is accepted', llm.status().configured === true)
    delete process.env.LOTUS_API_KEY
    check('no key, no AI — and it says which setting', llm.status().configured === false && /LOTUS_API_KEY/.test(llm.status().reason))
  }
}

/* ------------------------------------------------------------ fake LLM */

const calls = []
const fake = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const j = JSON.parse(body || '{}')
    calls.push({ auth: req.headers.authorization, url: req.url, body: j })
    const sys = j.messages?.find((m) => m.role === 'system')?.content || ''
    const last = j.messages?.[j.messages.length - 1]?.content || ''
    const reply = (content, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(status === 200 ? { choices: [{ message: { role: 'assistant', content } }] } : { error: content }))
    }
    if (/FAIL500/.test(last)) return reply('boom', 500)
    if (/classify blockers/.test(sys)) return reply('Sure: {"category": "it", "affects": true, "why": "It needs a change from IT."}')
    if (/weekly summary/.test(sys)) {
      return reply(`**Headline** A steady week.\n### Blockers and risks\n- ${/Waiting on AP/.test(last) ? 'AP blocker seen' : 'no blocker seen'}`)
    }
    if (/assistant inside the F&A Tech/.test(sys)) {
      const sees = ['FNP-88', 'annual benefit', 'Waiting on AP'].filter((x) => sys.includes(x))
      return reply(`<think>private reasoning</think>I can see: ${sees.join(', ')}. Turns: ${j.messages.length}.`)
    }
    if (/single word/.test(last)) return reply('ok')
    return reply(`Polished: ${last.split('---\n').pop()}`)
  })
})
await new Promise((r) => fake.listen(5414, r))

/* --------------------------------------------------------------- server */

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5364
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'ai-service-token-'.padEnd(48, '4')
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
    LOTUS_LLM_URL: 'http://127.0.0.1:5414/llm/v1/chat/completions',
    LOTUS_API_KEY: 'test-key-not-real',
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
  await call('PUT', '/api/auth/users/boss@lotuss.com', { person: 'gun' }, boss)
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)
  const WEEK = weekOf()

  console.log('\n--- writing help ---')
  const stM = (await call('GET', '/api/ai/status', undefined, james)).body
  check('a member learns the AI is there, and nothing more', stM.configured === true && stM.model === undefined && stM.reason === undefined)
  check('  an administrator sees which model', (await call('GET', '/api/ai/status', undefined, boss)).body.model === 'default')
  const notes = await call('POST', '/api/ai/write', { kind: 'notes', field: 'focus', text: 'ocr pilot, vendor call tue' }, james)
  check('NOTES COME BACK AS AN UPDATE', notes.status === 200 && notes.body.text === 'Polished: ocr pilot, vendor call tue', JSON.stringify(notes.body))
  const sent = calls[calls.length - 1]
  check('  THE KEY GOES AS A BEARER TOKEN, FROM THE SERVER', sent.auth === 'Bearer test-key-not-real')
  check('  to the model named, without its reasoning preamble',
    sent.body.model === 'default' && sent.body.chat_template_kwargs?.enable_thinking === false)
  check('  ASKED TO KEEP THE MEMBER’S LANGUAGE', /same language/i.test(sent.body.messages[0].content) && /Never translate/.test(sent.body.messages[0].content))
  check('  and told not to invent', /add nothing that is not in the notes/.test(sent.body.messages[1].content))
  check('polish is its own instruction', (await call('POST', '/api/ai/write', { kind: 'polish', field: 'blocker', text: 'waitng IT' }, james)).status === 200
    && /Fix the grammar/.test(calls[calls.length - 1].body.messages[1].content))
  check('nothing written, nothing asked', (await call('POST', '/api/ai/write', { kind: 'notes', text: '  ' }, james)).status === 400)
  const sug = await call('POST', '/api/ai/write', {
    kind: 'blocker', field: 'blocker', text: 'need a firewall rule for the SFTP', task: { title: 'Bank feed', newDate: '2026-12-01', projectDue: '2026-11-30' },
  }, james)
  check('A BLOCKER GETS A SUGGESTED CATEGORY AND DEADLINE EFFECT — read out of the model’s JSON',
    sug.body.category === 'it' && sug.body.affects === true && /IT/.test(sug.body.why), JSON.stringify(sug.body))
  check('  from the task’s own dates', /Project due: 2026-11-30/.test(calls[calls.length - 1].body.messages[1].content))
  const fail = await call('POST', '/api/ai/write', { kind: 'notes', text: 'FAIL500' }, james)
  check('THE MODEL FAILING IS A CLEAR ERROR, NOT A CRASH', fail.status === 502 && /500/.test(fail.body.error), fail.body.error)
  check('a stranger gets nothing', (await call('POST', '/api/ai/write', { kind: 'notes', text: 'x' })).status === 401)
  const burst = await Promise.all(Array.from({ length: 24 }, () => call('POST', '/api/ai/write', { kind: 'polish', text: 'x' }, james)))
  check('A RUNAWAY CLIENT IS SLOWED DOWN — at most twenty a minute each', burst.some((r) => r.status === 429))

  console.log('\n--- the weekly summary ---')
  await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'AP automation',
    tasks: [{
      title: 'Vendor mapping', projectKey: 'FNP-88', expected: '2026-11-06', effort: 1, priority: 'must', done: false, pct: 40,
      blocker: 'Waiting on AP for the vendor list', blockerCategory: 'business', newDate: '2026-12-15', affects: true,
    }],
    submit: 'report',
  }, james)
  const before = calls.length
  const friday = deadlines(WEEK).reportDue + 30 * 60_000
  const run1 = await call('POST', '/api/weekly/reminders/run', { at: new Date(friday).toISOString() }, boss)
  check('FRIDAY AFTER 15:00: THE SUMMARY IS WRITTEN', run1.body.summary?.written === `${WEEK}:report`, JSON.stringify(run1.body.summary))
  const prompt = calls.slice(before).find((c) => /weekly summary/.test(c.body.messages[0].content))
  check('  in English, whatever the members wrote in', /Write in English/.test(prompt?.body.messages[0].content || ''))
  check('  FROM THE WEEK ITSELF — blockers, dates and who has not sent',
    /Waiting on AP for the vendor list/.test(prompt?.body.messages[1].content || '')
    && /new date 2026-12-15/.test(prompt.body.messages[1].content) && /report: Missing/.test(prompt.body.messages[1].content))
  await call('POST', '/api/weekly/reminders/run', { at: new Date(friday + 20 * 60_000).toISOString() }, boss)
  check('ONCE — a second pass does not write it again',
    calls.slice(before).filter((c) => /weekly summary/.test(c.body.messages[0].content)).length === 1)
  const sm = await call('GET', `/api/ai/summary?week=${WEEK}`, undefined, boss)
  check('an administrator reads it', sm.body.summaries?.[0]?.text?.includes('AP blocker seen'))
  check('A MEMBER CANNOT', (await call('GET', `/api/ai/summary?week=${WEEK}`, undefined, james)).status === 403)
  let mailed = []
  for (let i = 0; i < 30 && !mailed.length; i++) {
    mailed = await db.db('team_kpi_planning').collection('kpi_mail_log').find({ _id: { $regex: '^summary:' }, status: 'sent' }).toArray()
    if (!mailed.length) await new Promise((r) => setTimeout(r, 150))
  }
  check('AND IT IS EMAILED TO THE ADMINISTRATORS', mailed.length === 1 && JSON.stringify(mailed[0].to) === '["boss@lotuss.com"]'
    && /AP blocker seen/.test(mailed[0].body || ''))

  console.log('\n--- the chatbot ---')
  check('A MEMBER HAS NO CHATBOT', (await call('POST', '/api/ai/chats', { message: 'hi' }, james)).status === 403)
  const a1 = await call('POST', '/api/ai/chats', { message: 'Which projects are late?' }, boss)
  check('AN ADMINISTRATOR ASKS, AND A CONVERSATION IS KEPT',
    a1.status === 200 && a1.body.chat?.messages?.length === 2 && a1.body.chat.title === 'Which projects are late?', JSON.stringify(a1.body).slice(0, 200))
  check('  THE MODEL WAS GIVEN THE REGISTER, THE MONEY AND THE WEEKLY CHECK-INS',
    /FNP-88, annual benefit, Waiting on AP/.test(a1.body.chat?.messages?.[1]?.content || ''), a1.body.chat?.messages?.[1]?.content)
  check('  and the model’s private reasoning is never shown', !/private reasoning/.test(a1.body.chat?.messages?.[1]?.content || ''))
  check('  TOLD TO ANSWER IN THE LANGUAGE IT IS ASKED IN, and only from the data',
    /language of the question/.test(calls[calls.length - 1].body.messages[0].content) && /never guess or invent/.test(calls[calls.length - 1].body.messages[0].content))
  const a2 = await call('POST', '/api/ai/chats', { chatId: a1.body.chat.id, message: 'และของใครบ้าง' }, boss)
  check('A FOLLOW-UP CARRIES THE CONVERSATION', a2.body.chat?.messages?.length === 4 && /Turns: 4/.test(a2.body.chat.messages[3].content),
    a2.body.chat?.messages?.[3]?.content)
  check('their conversations are listed for them', (await call('GET', '/api/ai/chats', undefined, boss)).body.chats?.length === 1)
  check('a conversation that is not theirs is not found', (await call('GET', '/api/ai/chats/nope', undefined, boss)).status === 404)

  check('THE ACCESS TAB’S TEST ASKS FOR ONE WORD', (await call('POST', '/api/ai/test', {}, boss)).body.reply === 'ok')

  console.log('\n--- the Excel "Weekly" sheet ---')
  {
    const loader = (cookie) => async (w) => {
      const r = await call('GET', `/api/weekly/${w}`, undefined, cookie)
      if (r.status !== 200) throw new Error(r.body.error)
      return r.body
    }
    const state = {
      meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'Weekly test',
    }
    const plan = computePlan(state)
    const read = async (weekly) => {
      const wb = await buildWorkbook(plan, state, weekly)
      const back = new ExcelJS.Workbook()
      await back.xlsx.load(await wb.xlsx.writeBuffer())
      return back
    }
    const forBoss = await weeklyForExport(4, loader(boss))
    check('FOUR WEEKS ARE GATHERED, NEWEST FIRST', forBoss?.weeks?.length === 4 && forBoss.weeks[0].week === WEEK
      && forBoss.weeks[1].week < WEEK && forBoss.full === true)
    const wb = await read(forBoss)
    const ws = wb.getWorksheet('Weekly')
    check('THE WORKBOOK HAS A "WEEKLY" SHEET', !!ws && ws.state !== 'hidden')
    const rows = []
    ws?.eachRow((row) => rows.push(row.values.slice(1).map((v) => (v && typeof v === 'object' && 'richText' in v ? v.richText.map((t) => t.text).join('') : v))))
    const head = rows.find((r) => r[0] === 'Person') || []
    const col = (name) => head.indexOf(name)
    const task = rows.find((r) => r[col('Task')] === 'Vendor mapping')
    check('  ONE ROW PER TASK, with the report on it',
      !!task && task[col('Done')] === 'No' && task[col('% done')] === 0.4 && task[col('Blocker')] === 'Waiting on AP for the vendor list'
      && task[col('Waiting on')] === 'Waiting on business user' && task[col('New date')] === '2026-12-15' && task[col('Pushes deadline')] === 'Yes',
      JSON.stringify(task))
    check('  the project is named, not only keyed', /^FNP-88 — ./.test(task?.[col('Project')] || ''))
    check('  THE DATE REQUEST IS ON THE TASK', /^Waiting for approval/.test(task?.[col('Date request')] || ''), task?.[col('Date request')])
    check('  STANDING PER PERSON — the report is in, on time', task?.[col('Report')] === 'On time', task?.[col('Report')])
    check('  everybody on the submit list has a row, even with nothing in',
      rows.some((r) => r[col('Task')] === 'Nothing submitted'))
    check('  each week is headed with how many are in', rows.some((r) => /^WEEK OF .* reports in 1 of \d+/.test(String(r[0] || ''))))
    check('  the workbook still opens on the register', wb.worksheets[wb.views?.[0]?.activeTab ?? 0]?.name === 'Projects')

    const forMember = await weeklyForExport(4, loader(james))
    const mws = (await read(forMember)).getWorksheet('Weekly')
    const mrows = []
    mws?.eachRow((row) => mrows.push(row.values.slice(1)))
    const mhead = mrows.find((r) => r[0] === 'Person') || []
    check('A MEMBER’S EXPORT HOLDS THEIR OWN TASKS', mrows.some((r) => r[mhead.indexOf('Task')] === 'Vendor mapping'))
    check('  and no standing for anybody — that is an administrator’s', mrows.every((r) => !['On time', 'Late', 'Missing'].includes(r[mhead.indexOf('Plan')]) && !['On time', 'Late', 'Missing'].includes(r[mhead.indexOf('Report')])))
    check('  and says so at the top', /as a team member sees it/.test(String(mrows[1]?.[0] || '')))
    check('NO STORE, NO SHEET — and the export still works',
      !(await read(await weeklyForExport(4, async () => { throw new Error('down') }))).getWorksheet('Weekly'))
  }

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
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })
    const as = async (cookie, vp) => {
      const pg = await browser.newPage()
      await pg.setViewport(vp)
      const [n, v] = cookie.split('=')
      await pg.setCookie({ name: n, value: v, url: base })
      return pg
    }
    // The minute's allowance is spent above; let it pass.
    await new Promise((r) => setTimeout(r, 61_000))

    console.log('\n--- a member writing, on a phone ---')
    const m = await as(james, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await m.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await m.waitForFunction(() => document.body.innerText.includes('Write up my notes'), { timeout: 15000 }).catch(() => {})
    check('THE WRITING HELP IS BESIDE THE BOX', (await m.evaluate(() => document.body.innerText)).includes('Write up my notes'))
    await m.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Write up my notes'))?.click())
    await m.waitForFunction(() => [...document.querySelectorAll('textarea')].some((t) => t.value.startsWith('Polished:')), { timeout: 10000 }).catch(() => {})
    check('  AND REPLACES THE TEXT FOR THE MEMBER TO EDIT', await m.evaluate(() => [...document.querySelectorAll('textarea')].some((t) => t.value === 'Polished: AP automation')))
    await m.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Undo'))?.click())
    await new Promise((r) => setTimeout(r, 300))
    check('  WITH ONE CLICK TO PUT THEIR OWN WORDS BACK', await m.evaluate(() => [...document.querySelectorAll('textarea')].some((t) => t.value === 'AP automation')))
    check('  and nothing spills sideways at 390px', (await m.evaluate(() => document.documentElement.scrollWidth)) <= 390)
    check('a member has no Ask button', !(await m.evaluate(() => !!document.querySelector('[aria-label="Ask about the plan"]'))))

    console.log('\n--- the administrator ---')
    const a = await as(boss, { width: 1440, height: 900 })
    await a.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await a.waitForFunction(() => document.body.innerText.includes('The week, summarised'), { timeout: 15000 }).catch(() => {})
    const wt = await a.evaluate(() => document.body.innerText)
    check('THE SUMMARY IS ON THE WEEKLY PAGE', wt.includes('The week, summarised') && wt.includes('AP blocker seen'))
    await a.evaluate(() => [...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Ask')?.click())
    await a.waitForFunction(() => document.body.innerText.includes('Ask about the plan'), { timeout: 8000 }).catch(() => {})
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('What is blocking the team'))?.click())
    await a.waitForFunction(() => document.body.innerText.includes('I can see:'), { timeout: 15000 }).catch(() => {})
    check('THE ASK PANEL ANSWERS FROM THE PAGE', (await a.evaluate(() => document.body.innerText)).includes('I can see: FNP-88'))
    // Past the panel's slide-in, so it is measured where it rests.
    await new Promise((r) => setTimeout(r, 700))
    const panel = await a.evaluate(() => {
      const p = document.querySelector('.MuiDrawer-paper')
      const r = p?.getBoundingClientRect()
      return r ? { left: Math.round(r.left), right: Math.round(r.right), width: innerWidth } : null
    })
    check('  the panel sits fully on screen', panel && panel.right <= panel.width && panel.left >= 0, JSON.stringify(panel))
    if (process.env.SHOT_DIR) await a.screenshot({ path: `${process.env.SHOT_DIR}/ai-chat.png` })
    await a.goto(`${base}/#users`, { waitUntil: 'networkidle0' })
    await a.waitForFunction(() => document.body.innerText.includes('AI (Lotus LLM)'), { timeout: 15000 }).catch(() => {})
    await a.waitForFunction(() => /Connected — model|The AI is off/.test(document.body.innerText), { timeout: 8000 }).catch(() => {})
    const at = await a.evaluate(() => document.body.innerText)
    check('THE ACCESS TAB SAYS THE AI IS CONNECTED', /Connected — model/.test(at), at.slice(at.indexOf('AI (Lotus'), at.indexOf('AI (Lotus') + 300).replace(/\n/g, ' | '))

    console.log('\n--- the Dashboard ---')
    const d = await as(boss, { width: 1440, height: 900 })
    await d.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await d.waitForFunction(() => document.body.innerText.includes('This week ·'), { timeout: 15000 }).catch(() => {})
    await d.waitForFunction(() => document.body.innerText.includes('AP blocker seen'), { timeout: 8000 }).catch(() => {})
    const sect = (label) => d.evaluate((l) => document.querySelector(`section[aria-label="${l}"]`)?.innerText || '', label)
    const wk = await sect('this week')
    check('THE DASHBOARD SHOWS THIS WEEK — each person, their focus and where they stand',
      /Plans in \d+ of \d+ · reports in 1 of \d+/.test(wk) && wk.includes('AP automation') && /REPORT: ON TIME/i.test(wk) && /PLAN: /i.test(wk),
      wk.slice(0, 300).replace(/\n/g, ' | '))
    const wait = await sect('waiting for your decision')
    check('  THE DATE CHANGES WAITING FOR A DECISION', /1 request to move/.test(wait) && wait.includes('FNP-88') && wait.includes('15 Dec'),
      wait.replace(/\n/g, ' | '))
    check('  THE AI’S SUMMARY OF THE WEEK', (await sect('the week, summarised')).includes('AP blocker seen'))
    const chatsBefore = (await call('GET', '/api/ai/chats', undefined, boss)).body.chats.length
    await d.evaluate(() => [...document.querySelectorAll('section[aria-label="ask about the plan"] button')]
      .find((b) => b.textContent.includes('Which costed projects'))?.click())
    await d.waitForFunction(() => document.querySelector('.MuiDrawer-paper')?.innerText.includes('I can see:'), { timeout: 15000 }).catch(() => {})
    const drawer = await d.evaluate(() => document.querySelector('.MuiDrawer-paper')?.innerText || '')
    check('  A STARTER QUESTION OPENS THE CHAT, ALREADY ASKED',
      drawer.includes('Which costed projects are below the ROI gate?') && drawer.includes('I can see:'), drawer.slice(0, 200).replace(/\n/g, ' | '))
    check('  as a new conversation', (await call('GET', '/api/ai/chats', undefined, boss)).body.chats.length === chatsBefore + 1)
    if (process.env.SHOT_DIR) {
      await d.keyboard.press('Escape')
      await new Promise((r) => setTimeout(r, 500))
      await d.screenshot({ path: `${process.env.SHOT_DIR}/dashboard-week.png` })
    }
    const dp = await as(boss, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await dp.goto(`${base}/`, { waitUntil: 'networkidle0' })
    await dp.waitForFunction(() => document.body.innerText.includes('This week ·'), { timeout: 15000 }).catch(() => {})
    check('  and on a phone nothing spills sideways', (await dp.evaluate(() => document.documentElement.scrollWidth)) <= 390)
    // Previewing as a member: no Dashboard, so nothing of this to leak.
    await dp.evaluate(() => localStorage.setItem('fa-kpi-view-as', 'member'))
    await dp.goto(`${base}/?again=1`, { waitUntil: 'networkidle0' })
    await new Promise((r) => setTimeout(r, 800))
    check('VIEWING AS A MEMBER, the Dashboard and its weekly panel are not there',
      !(await dp.evaluate(() => !!document.querySelector('section[aria-label="waiting for your decision"]'))))
  }
} catch (e) {
  failures++
  console.log(`FAIL  the suite crashed — ${e.stack}`)
} finally {
  if (browser) await browser.close()
  server.kill()
  fake.close()
  await db.close()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall AI checks passed')
process.exit(failures ? 1 : 0)
