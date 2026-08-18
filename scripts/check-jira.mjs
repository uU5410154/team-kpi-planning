/**
 * The Jira path, end to end, against a stand-in Jira.
 *
 * What must hold:
 *   1. the token never leaves the server;
 *   2. the browser cannot ask Jira anything except for the keys it holds;
 *   3. a sync records what HAPPENED and never rewrites the plan;
 *   4. with no Jira configured the app still works, and says so.
 *
 * Runs the real server against a fake Atlassian on localhost. Run with:
 *   node scripts/check-jira.mjs
 */
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import puppeteer from 'puppeteer-core'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ---------------- a stand-in Atlassian ---------------- */
const TOKEN = 'test-token-never-leaves-the-server'
const EMAIL = 'gun@example.com'
const seenAuth = []
const askedFor = []

const ISSUES = {
  'FNP-1': {
    key: 'FNP-1',
    fields: {
      summary: 'Finished late',
      status: { name: 'Done', statusCategory: { key: 'done' } },
      created: '2026-01-05T09:00:00.000+0700',
      updated: '2026-04-02T09:00:00.000+0700',
      duedate: '2026-03-01',
      resolutiondate: '2026-04-01T17:00:00.000+0700',
      customfield_10015: '2026-01-10',
    },
  },
  'FNP-2': {
    key: 'FNP-2',
    fields: {
      summary: 'Still running, no start date on the ticket',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      created: '2026-02-01T09:00:00.000+0700',
      updated: '2026-08-01T09:00:00.000+0700',
      duedate: null,
      resolutiondate: null,
      customfield_10015: null,
    },
  },
  'FNP-3': {
    key: 'FNP-3',
    fields: {
      summary: 'Reopened after being marked done',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      created: '2026-01-01T09:00:00.000+0700',
      updated: '2026-08-01T09:00:00.000+0700',
      duedate: '2026-05-01',
      resolutiondate: null,
      customfield_10015: '2026-01-02',
    },
  },
}

const fake = createServer((req, res) => {
  seenAuth.push(req.headers.authorization || '')
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const parsed = body ? JSON.parse(body) : {}
    askedFor.push(parsed.jql || '')
    const keys = String(parsed.jql || '').replace(/.*\(|\).*/g, '').split(',').map((k) => k.trim())
    const issues = keys.map((k) => ISSUES[k]).filter(Boolean)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ issues }))
  })
})
await new Promise((r) => fake.listen(5411, r))

/* ---------------- the real server, pointed at it ---------------- */
const PORT = 5412
const srv = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: '',
    JIRA_BASE_URL: 'http://127.0.0.1:5411',
    JIRA_EMAIL: EMAIL,
    JIRA_API_TOKEN: TOKEN,
  },
  stdio: 'ignore',
})
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break
  } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 400))
}

console.log('--- the server can reach Jira, and says as whom ---')
const st = await (await fetch(`${base}/api/jira/status`)).json()
check('it reports itself configured', st.configured === true, JSON.stringify(st))
check('it names the account it acts as', st.account === EMAIL)
check('AND THE TOKEN IS NOT IN THE ANSWER', !JSON.stringify(st).includes(TOKEN),
  'a status endpoint that leaks the credential is worse than no status endpoint')

console.log('\n--- issues come back by key ---')
const r1 = await (await fetch(`${base}/api/jira/issues`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: ['FNP-1', 'FNP-2', 'FNP-404'] }),
})).json()
check('the issues that exist come back', r1.issues.length === 2, r1.issues.map((i) => i.key).join(', '))
check('AND THE ONE THAT DOES NOT IS REPORTED, NOT DROPPED',
  r1.missing.includes('FNP-404'), JSON.stringify(r1.missing))
check('the token was sent to Jira', seenAuth.some((a) => a.startsWith('Basic ')))
check('  and it is the right credential',
  seenAuth.some((a) => Buffer.from(a.replace('Basic ', ''), 'base64').toString() === `${EMAIL}:${TOKEN}`))
check('AND THE TOKEN IS NOT IN WHAT THE BROWSER RECEIVES', !JSON.stringify(r1).includes(TOKEN))

const one = r1.issues.find((i) => i.key === 'FNP-1')
check('a finished issue carries its resolution date', one.resolved === '2026-04-01', one.resolved)
check('  and its start date', one.start === '2026-01-10' && one.startSource === 'start-date')
check('  and reads as done from the status CATEGORY, not its name', one.done === true)
const two = r1.issues.find((i) => i.key === 'FNP-2')
check('an issue with no Start date says where its start came from',
  two.start === null && two.startSource === 'created' && two.created === '2026-02-01',
  JSON.stringify({ start: two.start, source: two.startSource }))

console.log('\n--- the browser cannot ask Jira anything else ---')
const inject = await (await fetch(`${base}/api/jira/issues`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: ['FNP-1) OR project=SECRET OR key IN (FNP-2'] }),
})).json()
check('A KEY THAT IS NOT A KEY IS DROPPED BEFORE IT REACHES JIRA',
  !askedFor.some((j) => /SECRET/.test(j)),
  askedFor.filter((j) => /SECRET/.test(j)).join(' | ') || 'no query mentioning it was ever sent')
check('  and the request simply returns nothing', inject.issues.length === 0, JSON.stringify(inject.issues))

const jqlAttempt = await fetch(`${base}/api/jira/issues`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ jql: 'project = SECRET' }),
})
const jqlBody = await jqlAttempt.json()
check('there is no way to pass JQL at all', jqlBody.issues?.length === 0,
  'the endpoint takes keys and nothing else')

const tooMany = await fetch(`${base}/api/jira/issues`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: Array.from({ length: 500 }, (_, i) => `FNP-${i}`) }),
})
check('and a request big enough to be abuse is refused', tooMany.status === 400)

/* ---------------- the sync, in a real browser ---------------- */
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

if (!exe) {
  console.log('\nSKIP — no Chromium-based browser found')
} else {
  console.log('\n--- and the sync writes outcomes without touching the plan ---')
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 1600, height: 1100 })
  await page.goto(`${base}/#timeline`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 4000))

  // Put our three fixture keys on real projects, with a plan of their own.
  const before = await page.evaluate(() => {
    const K = 'fa-tech-kpi-2026'
    const st = JSON.parse(localStorage.getItem(K))
    const keys = ['FNP-1', 'FNP-2', 'FNP-3']
    st.projects = st.projects.map((p, i) => (i < 3
      ? {
        ...p,
        jiraKey: keys[i],
        start: '2026-01-01',
        due: '2026-03-01',
        // FNP-3 is finished HERE and reopened in Jira.
        actualEnd: i === 2 ? '2026-04-04' : null,
        actualStart: null,
      }
      : { ...p, jiraKey: '' }))
    localStorage.setItem(K, JSON.stringify(st))
    return st.projects.slice(0, 3).map((p) => ({ key: p.key, start: p.start, due: p.due, hours: p.savingHours }))
  })
  await page.goto(`${base}/?synced=1#timeline`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3500))

  const label = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Sync \d+ from Jira/.test(x.innerText))
    return b ? b.innerText.trim() : null
  })
  check('the button offers exactly the keyed projects', label === 'Sync 3 from Jira', String(label))

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => /Sync \d+ from Jira/.test(x.innerText)).click()
  })
  await new Promise((r) => setTimeout(r, 3000))

  const after = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    const byKey = Object.fromEntries(st.projects.slice(0, 3).map((p) => [p.jiraKey, p]))
    return {
      note: (document.body.innerText.match(/\d+ projects? updated[^\n]*/) || [''])[0],
      rows: st.projects.slice(0, 3).map((p) => ({
        jira: p.jiraKey, start: p.start, due: p.due, actualStart: p.actualStart, actualEnd: p.actualEnd,
      })),
      one: byKey['FNP-1'],
      two: byKey['FNP-2'],
      three: byKey['FNP-3'],
    }
  })

  check('IT WROTE THE ACTUAL DATES', after.one.actualStart === '2026-01-10' && after.one.actualEnd === '2026-04-01',
    JSON.stringify(after.one && { s: after.one.actualStart, e: after.one.actualEnd }))
  check('an unfinished issue gets a start and no finish',
    after.two.actualStart === '2026-02-01' && !after.two.actualEnd,
    JSON.stringify({ s: after.two.actualStart, e: after.two.actualEnd }))
  check('A TICKET REOPENED IN JIRA UN-FINISHES HERE TOO', after.three.actualEnd === null,
    'a finish that was taken back must not keep being reported')
  check('AND THE PLAN IS EXACTLY AS IT WAS',
    after.rows.every((r, i) => r.start === before[i].start && r.due === before[i].due),
    after.rows.map((r) => `${r.jira} ${r.start}..${r.due}`).join(' | '))
  check('it says what it did, including where a start came from',
    /taken from when the ticket was raised/.test(after.note), after.note)

  await browser.close()
}

srv.kill()

/* ---------------- and without Jira at all ---------------- */
console.log('\n--- with no Jira configured, the app still works ---')
const PORT2 = 5413
const bare = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT2), MONGODB_URI: '', JIRA_BASE_URL: '', JIRA_EMAIL: '', JIRA_API_TOKEN: '' },
  stdio: 'ignore',
})
const base2 = `http://127.0.0.1:${PORT2}`
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${base2}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break
  } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 400))
}
const st2 = await (await fetch(`${base2}/api/jira/status`)).json()
check('it says so plainly', st2.configured === false)
const r2 = await fetch(`${base2}/api/jira/issues`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keys: ['FNP-1'] }),
})
check('and a sync fails with an explanation rather than a stack trace',
  r2.status === 503 && /JIRA_BASE_URL/.test((await r2.json()).error))
const page2 = await (await fetch(`${base2}/`)).text()
check('the app itself still serves', page2.includes('<div id="root">'))
bare.kill()
fake.close()

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
