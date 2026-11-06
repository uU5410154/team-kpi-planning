/**
 * A member's week, run from Jira: their tasks for the week, an update per
 * task posted back to Jira (comment, screenshot, Done), decisions raised to
 * the administrators, new tasks and projects created in Jira, and dates
 * planned there.
 *
 * Runs the real server against a real mongod and a FAKE Jira on :5415, which
 * records every write, then drives the built page in Chrome.
 *
 *   node scripts/check-jiraweek.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { weekOf, addWeeks } from '../src/lib/weekly.js'
import { coversWeek, taskSpan } from '../server/jira.js'
import { commentText } from '../server/jiraWeek.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const WEEK = weekOf()
const NEXT = addWeeks(WEEK, 1)
const LAST = addWeeks(WEEK, -1)
const day = (w, n) => { const d = new Date(`${w}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

console.log('\n--- which tasks belong to a week ---')
{
  check('A TASK WHOSE DATES COVER THE WEEK IS IN IT', coversWeek({ start: day(WEEK, -10), due: day(WEEK, 2) }, WEEK))
  check('  starting on its Sunday counts; the Monday after does not',
    coversWeek({ start: day(WEEK, 6), due: day(WEEK, 20) }, WEEK) && !coversWeek({ start: day(WEEK, 7), due: day(WEEK, 20) }, WEEK))
  check('  one date is enough', coversWeek({ due: day(WEEK, 3) }, WEEK) && coversWeek({ start: day(WEEK, 1) }, WEEK))
  check('  its own dates win over the sprint', taskSpan({ start: '2026-01-05', due: '2026-01-09', sprintStart: '2026-02-01', sprintEnd: '2026-02-14' }).start === '2026-01-05')
  check('  the sprint stands in when it has no date', taskSpan({ sprintStart: '2026-02-01', sprintEnd: '2026-02-14' }).end === '2026-02-14')
  check('  no date at all is in no week', !coversWeek({}, WEEK))
  const text = commentText({
    nick: 'James', week: WEEK, attachments: ['a.png'],
    u: { done: false, progress: 'Built it, see https://x.example/r', reason: 'Waiting for data', blocker: 'IT feed', decision: true, decisionText: 'Drop region B?' },
  })
  check('THE JIRA COMMENT SAYS WHO, WHICH WEEK, AND EVERY ANSWER',
    /from James/.test(text) && /Not finished/.test(text) && /Why not finished:\*\* Waiting/.test(text)
    && /Decision needed:\*\* Drop region B/.test(text) && /a\.png/.test(text), text.replace(/\n/g, ' | '))
}

/* ------------------------------------------------------------ fake Jira */
const ACC = { james: 'acc-james-0001', kade: 'acc-kade-0002' }
const issues = new Map()
const put = (key, f) => issues.set(key, { key, ...f })
put('FNP-2001', { summary: 'Reconcile the forecast', assignee: ACC.james, parent: 'FNP-379', start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
put('FNP-2002', { summary: 'Load last year budget', assignee: ACC.james, parent: 'FNP-877', start: day(LAST, 0), due: day(LAST, 3), status: 'To Do', cat: 'new' })
put('FNP-2003', { summary: 'Write the runbook', assignee: ACC.james, parent: 'FNP-379', status: 'To Do', cat: 'new' })
put('FNP-2004', { summary: 'Demo to FP&A', assignee: ACC.james, parent: 'FNP-379', start: day(NEXT, 1), due: day(NEXT, 2), status: 'To Do', cat: 'new' })
put('FNP-2005', { summary: 'Kade’s own task', assignee: ACC.kade, parent: 'FNP-267', start: day(WEEK, 0), due: day(WEEK, 4), status: 'To Do', cat: 'new' })
const writes = []
const asRaw = (i) => ({
  key: i.key,
  fields: {
    summary: i.summary,
    status: { name: i.status, statusCategory: { key: i.cat } },
    duedate: i.due || null,
    customfield_10015: i.start || null,
    assignee: i.assignee ? { accountId: i.assignee, displayName: i.assignee === ACC.james ? 'Pipat Singhasiri' : 'Jarinya Phosri' } : null,
    issuetype: { name: i.type || 'Task' },
    parent: i.parent ? { key: i.parent, fields: { summary: `Epic ${i.parent}` } } : null,
    created: '2026-01-01T00:00:00.000+0700',
    updated: '2026-01-01T00:00:00.000+0700',
    resolutiondate: null,
  },
})
let nextKey = 9001
const body = (req) => new Promise((r) => { const b = []; req.on('data', (c) => b.push(c)); req.on('end', () => r(Buffer.concat(b))) })
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
  const raw = await body(req)
  const json = () => { try { return JSON.parse(raw.toString()) } catch { return {} } }
  const m = (re) => u.pathname.match(re)
  if (u.pathname === '/rest/api/3/user/search') {
    const q = (u.searchParams.get('query') || '').toLowerCase()
    if (q === 'pipat singhasiri') return send(200, [{ accountId: ACC.james, displayName: 'Pipat Singhasiri', accountType: 'atlassian', active: true }])
    if (q === 'jarinya phosri') return send(200, [{ accountId: ACC.kade, displayName: 'Jarinya Phosri', accountType: 'atlassian', active: true }])
    return send(200, [])
  }
  if (u.pathname === '/rest/api/3/search/jql') {
    const jql = json().jql || ''
    const acc = (jql.match(/assignee = "([^"]+)"/) || [])[1]
    const list = [...issues.values()].filter((i) => (acc ? i.assignee === acc : true) && i.type !== 'Epic')
    return send(200, { issues: list.map(asRaw) })
  }
  if (m(/^\/rest\/api\/3\/issue\/createmeta\/[A-Z]+\/issuetypes$/)) {
    return send(200, { issueTypes: [{ id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 }, { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 }] })
  }
  if (req.method === 'POST' && u.pathname === '/rest/api/3/issue') {
    const f = json().fields || {}
    const key = `FNP-${nextKey++}`
    put(key, {
      summary: f.summary, assignee: f.assignee?.accountId, parent: f.parent?.key, start: f.customfield_10015, due: f.duedate,
      status: 'To Do', cat: 'new', type: f.issuetype?.id === '10000' ? 'Epic' : 'Task', labels: f.labels,
    })
    writes.push({ kind: 'create', key, fields: f })
    return send(201, { key, id: String(nextKey) })
  }
  let k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/)
  if (k) { writes.push({ kind: 'comment', key: k[1], body: json().body }); return send(201, { id: `c${writes.length}` }) }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/attachments$/)
  if (k) {
    const names = [...raw.toString('latin1').matchAll(/filename="([^"]+)"/g)].map((x) => x[1])
    writes.push({ kind: 'attach', key: k[1], names, token: req.headers['x-atlassian-token'] })
    return send(200, names.map((filename) => ({ filename })))
  }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/)
  if (k) {
    if (req.method === 'GET') return send(200, { transitions: [{ id: '21', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }, { id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }] })
    writes.push({ kind: 'transition', key: k[1], id: json().transition?.id })
    const i = issues.get(k[1]); if (i) { i.status = 'Done'; i.cat = 'done' }
    return send(204)
  }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)$/)
  if (k) {
    const i = issues.get(k[1])
    if (!i) return send(404, { errorMessages: ['Issue does not exist'] })
    if (req.method === 'PUT') {
      const f = json().fields || {}
      writes.push({ kind: 'dates', key: k[1], fields: f })
      if ('duedate' in f) i.due = f.duedate
      if ('customfield_10015' in f) i.start = f.customfield_10015
      return send(204)
    }
    return send(200, asRaw(i))
  }
  return send(404, { errorMessages: [`fake Jira has no ${req.method} ${u.pathname}`] })
})
await new Promise((r) => fake.listen(5415, r))

/* --------------------------------------------------------------- server */
console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5367
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'jiraweek-service-token-'.padEnd(48, '7')
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
    JIRA_BASE_URL: 'http://127.0.0.1:5415',
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
server.stderr.on('data', (b) => { if (/Error|error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await sleep(300)
}
const db = new MongoClient(mongod.getUri())
await db.connect()
const D = db.db('team_kpi_planning')

const call = async (method, path, b, who) => {
  const headers = { 'Content-Type': 'application/json' }
  if (who === 'service') headers.authorization = `Bearer ${TOKEN}`
  else if (who) headers.cookie = who
  const res = await fetch(base + path, { method, headers, body: b === undefined ? undefined : JSON.stringify(b) })
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}
const signUp = async (email) => {
  await call('POST', '/api/auth/register', { email, password: 'password1' })
  if (email !== 'boss@lotuss.com') await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}
// A 1×1 PNG, as a pasted screenshot arrives.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

let browser
try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  const nobody = await signUp('nobody@lotuss.com')
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)

  console.log('\n--- the week, from Jira ---')
  const w = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
  check('A MEMBER’S WEEK IS THEIR JIRA TASKS', w.jira === 'on' && w.account === 'Pipat Singhasiri', JSON.stringify(w).slice(0, 160))
  check('  the ones whose dates cover this week', w.tasks?.map((t) => t.key).join() === 'FNP-2001', w.tasks?.map((t) => t.key).join())
  check('  the overdue unfinished one too', w.overdue?.map((t) => t.key).join() === 'FNP-2002')
  check('  and the undated one, to plan', w.undated?.map((t) => t.key).join() === 'FNP-2003')
  check('  NOT next week’s, and NOT a colleague’s', ![...w.tasks, ...w.overdue].some((t) => ['FNP-2004', 'FNP-2005'].includes(t.key)))
  check('  each under its project in the register', w.tasks?.[0]?.project?.key === 'FNP-379', JSON.stringify(w.tasks?.[0]?.project))
  check('an account not linked to anybody is told so', (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, nobody)).body.jira === 'unlinked')

  console.log('\n--- one task’s update ---')
  const bad = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2001/update`, { progress: '', done: false }, james)
  check('AN INCOMPLETE UPDATE IS REFUSED, SAYING WHAT IS MISSING',
    bad.status === 400 && bad.body.problems?.some((p) => /what happened/.test(p)) && bad.body.problems?.some((p) => /why it is not finished/.test(p)), JSON.stringify(bad.body))
  const theirs = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2005/update`, { progress: 'x', done: true }, james)
  check('NOBODY POSTS ON A TASK THAT IS NOT THEIRS', theirs.status === 403, JSON.stringify(theirs.body))
  const before = writes.length
  const ok = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2001/update`, {
    progress: 'Matched the forecast to the GL; see https://x.example/rec', done: true, blocker: '',
    decision: true, decisionText: 'Do we keep region B in the model?', images: [{ name: 'recon', data: PNG }],
  }, james)
  check('A COMPLETE UPDATE IS SUBMITTED AND POSTED', ok.status === 200 && ok.body.update?.jira?.state === 'posted', JSON.stringify(ok.body).slice(0, 200))
  const mine = writes.slice(before)
  const att = mine.find((x) => x.kind === 'attach')
  const cm = mine.find((x) => x.kind === 'comment')
  check('  THE SCREENSHOT IS ATTACHED TO THE TASK IN JIRA', att?.key === 'FNP-2001' && att.names[0] === 'recon.png' && att.token === 'no-check', JSON.stringify(att))
  const cmText = JSON.stringify(cm?.body || {})
  check('  THE UPDATE IS A COMMENT ON THE TASK', cm?.key === 'FNP-2001' && /Matched the forecast/.test(cmText) && /Finished/.test(cmText) && /recon\.png/.test(cmText))
  check('  its link is a real link', /"href":"https:\/\/x\.example\/rec"/.test(cmText))
  check('  FINISHED MOVES IT TO DONE', mine.some((x) => x.kind === 'transition' && x.key === 'FNP-2001' && x.id === '31'))
  const entry = await D.collection('kpi_weekly').findOne({ week: WEEK, person: 'james' })
  const task = entry?.tasks?.find((t) => t.jiraKey === 'FNP-2001')
  check('IT COUNTS IN THE WEEK HERE — dashboard, reminders and summary read it',
    entry?.mode === 'jira' && task?.done === true && task.projectKey === 'FNP-379' && /Matched/.test(task.progress), JSON.stringify(task).slice(0, 160))
  check('  the plan counts as in; the report not yet (the overdue one is unreported)', !!entry?.planSubmittedAt && !entry.reportSubmittedAt)

  console.log('\n--- a decision is needed ---')
  const dl = (await call('GET', '/api/decisions', undefined, boss)).body.decisions || []
  check('THE ADMINISTRATORS SEE IT', dl.length === 1 && dl[0].jiraKey === 'FNP-2001' && /region B/.test(dl[0].text), JSON.stringify(dl).slice(0, 160))
  const dm = await D.collection('kpi_mail_log').findOne({ _id: { $regex: '^decision:' } })
  check('  AND ARE EMAILED', JSON.stringify(dm?.to || '').includes('boss@lotuss.com') && /Decision needed/.test(dm?.subject || ''), dm && dm.subject)
  check('  a member sees only their own', (await call('GET', '/api/decisions', undefined, james)).body.decisions?.length === 1)
  check('  only an administrator decides', (await call('POST', `/api/decisions/${encodeURIComponent(dl[0].id)}/decide`, { note: 'x' }, james)).status === 403)
  const decided = await call('POST', `/api/decisions/${encodeURIComponent(dl[0].id)}/decide`, { note: 'Keep region B.' }, boss)
  check('DECIDING CLOSES IT', decided.status === 200 && decided.body.decision?.status === 'decided')
  await sleep(300)
  check('  and the decision is written on the task in Jira', writes.some((x) => x.kind === 'comment' && x.key === 'FNP-2001' && /Keep region B/.test(JSON.stringify(x.body))))
  check('  no longer open', ((await call('GET', '/api/decisions', undefined, boss)).body.decisions || []).length === 0)

  const notDone = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2002/update`, { progress: 'Started the load', done: false, reason: 'Budget file late from FP&A' }, james)
  check('NOT FINISHED, WITH THE REASON', notDone.status === 200 && !writes.some((x) => x.kind === 'transition' && x.key === 'FNP-2002'))
  const entry2 = await D.collection('kpi_weekly').findOne({ week: WEEK, person: 'james' })
  check('  EVERY TASK OF THE WEEK UPDATED: THE REPORT COUNTS AS IN', !!entry2?.reportSubmittedAt && notDone.body.reportIn === true)
  const again = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
  check('the week now shows each task’s update', again.tasks.find((t) => t.key === 'FNP-2001')?.update?.done === true
    && again.overdue.find((t) => t.key === 'FNP-2002')?.update?.reason === 'Budget file late from FP&A')
  const adhoc = await call('PUT', `/api/weekly/${WEEK}/mine`, { mode: 'jira', focus: '', tasks: entry2.tasks, unplanned: [{ title: 'Audit request', effort: 0.5 }] }, james)
  const entry3 = await D.collection('kpi_weekly').findOne({ week: WEEK, person: 'james' })
  check('ADHOC WORK SAVES BESIDE THE JIRA TASKS, KEEPING THEM', adhoc.status === 200 && entry3.unplanned?.[0]?.title === 'Audit request'
    && entry3.tasks.find((t) => t.jiraKey === 'FNP-2001')?.progress?.startsWith('Matched'), JSON.stringify(adhoc.body).slice(0, 160))
  const locked = await call('POST', `/api/weekly/${addWeeks(WEEK, -3)}/jira/FNP-2002/update`, { progress: 'x', done: true }, james)
  check('a closed week takes no update', locked.status === 409)

  console.log('\n--- planning, in Jira ---')
  const nt = await call('POST', '/api/jira/tasks', { projectKey: 'FNP-379', summary: 'Prepare the FP&A demo deck', start: day(NEXT, 0), due: day(NEXT, 2) }, james)
  const made = writes.find((x) => x.kind === 'create' && x.key === nt.body.task?.key)
  check('A NEW TASK IS CREATED IN JIRA UNDER THE PROJECT’S EPIC, ASSIGNED TO THEM', nt.status === 200
    && made?.fields?.parent?.key === 'FNP-379' && made.fields.assignee?.accountId === ACC.james && made.fields.issuetype?.id === '10001'
    && made.fields.customfield_10015 === day(NEXT, 0) && made.fields.duedate === day(NEXT, 2), JSON.stringify(nt.body))
  check('  both dates are required', (await call('POST', '/api/jira/tasks', { projectKey: 'FNP-379', summary: 'No dates', start: '' }, james)).status === 400)
  check('  a project without an epic is refused', (await call('POST', '/api/jira/tasks', { projectKey: 'NOPE-1', summary: 'x', start: WEEK, due: WEEK }, james)).status === 400)
  const dates = await call('PUT', '/api/jira/tasks/FNP-2003/dates', { start: day(NEXT, 3), due: day(NEXT, 4) }, james)
  check('DATES ON A TASK ARE WRITTEN TO JIRA', dates.status === 200 && issues.get('FNP-2003').due === day(NEXT, 4))
  check('  not on somebody else’s', (await call('PUT', '/api/jira/tasks/FNP-2005/dates', { due: day(NEXT, 4) }, james)).status === 403)
  const nw = (await call('GET', `/api/weekly/${NEXT}/jira`, undefined, james)).body
  check('NEXT WEEK NOW HOLDS WHAT WAS PLANNED INTO IT', ['FNP-2003', 'FNP-2004', nt.body.task?.key].every((k) => nw.tasks?.some((t) => t.key === k)), nw.tasks?.map((t) => t.key).join())
  const conf = await call('POST', `/api/weekly/${NEXT}/jira/plan`, {}, james)
  const nextEntry = await D.collection('kpi_weekly').findOne({ week: NEXT, person: 'james' })
  check('“MY PLAN IS SET” RECORDS THE WEEK’S TASKS AS ITS PLAN', conf.status === 200 && conf.body.planned >= 3 && !!nextEntry?.planSubmittedAt
    && nextEntry.tasks.some((t) => t.jiraKey === 'FNP-2004'), JSON.stringify(conf.body))

  console.log('\n--- a new project ---')
  const np = await call('POST', '/api/jira/projects', { summary: 'Close checklist automation', kind: 'cr', start: day(NEXT, 0), due: day(NEXT, 30), description: 'Asked for by the controller.' }, james)
  const epic = writes.find((x) => x.kind === 'create' && x.key === np.body.epic?.key)
  check('A NEW PROJECT IS AN EPIC IN JIRA, LABELLED BY ITS KIND', np.status === 200 && epic?.fields?.issuetype?.id === '10000'
    && epic.fields.labels?.includes('change-request') && epic.fields.assignee?.accountId === ACC.james, JSON.stringify(np.body).slice(0, 200))
  const plan = (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body.payload
  const row = plan.projects.find((p) => p.jiraKey === np.body.epic?.key)
  check('  AND A ROW IN THE REGISTER, THEIRS, ON WATCH', row?.pic === 'james' && row.commitLevel === 'watch' && row.program === 'Change Request' && row.due === day(NEXT, 30), JSON.stringify(row || {}).slice(0, 200))
  check('  every other project is still there', plan.projects.length === seed.projects.length + 1)
  check('  a kind other than the two is refused', (await call('POST', '/api/jira/projects', { summary: 'Whatever', kind: 'big', start: WEEK, due: WEEK }, james)).status === 400)

  /* ------------------------------------------------------------- browser */
  const chrome = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find((p) => p && existsSync(p))
  if (!chrome || !existsSync(new URL('../dist/index.html', import.meta.url))) {
    console.log('\nSKIP  browser checks — no Chrome, or run `npm run build` first')
  } else {
    console.log('\n--- the page ---')
    // A fresh task this week, not yet updated.
    put('FNP-2010', { summary: 'Tie out the accruals', assignee: ACC.james, parent: 'FNP-379', start: day(WEEK, 1), due: day(WEEK, 3), status: 'In Progress', cat: 'indeterminate' })
    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })
    const pg = await (await browser.createBrowserContext()).newPage()
    await pg.setViewport({ width: 1280, height: 900 })
    const [n, v] = james.split('=')
    await pg.setCookie({ name: n, value: v, url: base })
    await pg.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await pg.waitForSelector('[data-jira-task]', { timeout: 15000 }).catch(() => {})
    const txt = await pg.evaluate(() => document.body.innerText)
    check('THE PAGE SHOWS THEIR JIRA TASKS, NOT THE MONDAY FORM', txt.includes('FNP-2010') && !txt.includes('This week I\'m focused on'))
    check('  with the filter between not-updated and updated', /Not updated yet \(1\)/.test(txt) && /Already updated \(2\)/.test(txt), (txt.match(/Not updated yet \(\d+\)|Already updated \(\d+\)/g) || []).join(' '))
    check('  and the reminder to plan next week', /Don’t forget next week’s plan|Don't forget next week's plan/.test(txt))
    check('  only the not-updated one is open to start with',
      (await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task]')].map((x) => x.getAttribute('data-jira-task')))).join() === 'FNP-2010')
    const head = await pg.evaluate(() => {
      const g = document.querySelector('[data-jira-task="FNP-2010"]')?.closest('[data-project-group]')
      const nx = document.querySelector('[data-next-step]')
      const btn = document.querySelector('[data-next-action]')
      return {
        group: g?.getAttribute('data-project-group'),
        header: g?.querySelector('button')?.innerText.replace(/\s+/g, ' '),
        next: nx?.innerText.replace(/\s+/g, ' '),
        anim: btn ? getComputedStyle(btn).animationName : null,
        hello: document.body.innerText.includes('Hello'),
      }
    })
    check('  each task sits under its project header, saying how many are left', !!head.group && /to update/i.test(head.header || ''), head.header)
    check('  the next step names the task to update, on a pulsing button', /Update 1 task/.test(head.next || '') && /FNP-2010/.test(head.next || '') && !!head.anim && head.anim !== 'none' && !head.hello, `${head.next} · ${head.anim}`)
    // The button takes them to that task's progress box.
    await pg.click('[data-next-action]')
    await sleep(700)
    check('  and pressing it puts them in that task\'s progress box',
      await pg.evaluate(() => document.activeElement?.closest('[data-jira-task]')?.getAttribute('data-jira-task') === 'FNP-2010'))
    // Fill in the card and submit.
    await pg.evaluate(() => {
      const card = document.querySelector('[data-jira-task="FNP-2010"]')
      card.querySelector('textarea').focus()
    })
    await pg.keyboard.type('Tied out three of five accounts')
    await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2010"] button')].find((b) => b.textContent.trim() === 'Not finished').click())
    await sleep(200)
    await pg.evaluate(() => {
      const box = [...document.querySelectorAll('[data-jira-task="FNP-2010"] label')].find((l) => /Why isn/.test(l.textContent))
      box?.parentElement.querySelector('textarea, input')?.focus()
    })
    await pg.keyboard.type('Two accounts wait on AP')
    if (process.env.SHOT_DIR) await pg.screenshot({ path: `${process.env.SHOT_DIR}/jira-week.png`, fullPage: true })
    await pg.evaluate(() => document.querySelector('[aria-label="submit FNP-2010"]').click())
    await pg.waitForFunction(() => document.body.innerText.includes('Already updated (3)'), { timeout: 10000 }).catch(() => {})
    const after = await pg.evaluate(() => document.body.innerText)
    check('SUBMIT ON THE CARD POSTS IT AND MOVES IT TO "ALREADY UPDATED"', after.includes('Already updated (3)') && after.includes('Not updated yet (0)'))
    check('  the comment reached Jira', writes.some((x) => x.kind === 'comment' && x.key === 'FNP-2010' && /Two accounts wait on AP/.test(JSON.stringify(x.body))))
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Plan week \d+/.test(b.textContent.trim()))?.click())
    await pg.waitForSelector('[data-jira-task="FNP-2004"] input[type="date"]', { timeout: 10000 }).catch(() => {})
    const plan2 = await pg.evaluate(() => document.body.innerText)
    check('NEXT WEEK OPENS FOR PLANNING, WITH DATES TO SET', plan2.includes('Planning week') && plan2.includes('FNP-2004')
      && (await pg.evaluate(() => !!document.querySelector('[data-jira-task="FNP-2004"] input[type="date"]'))), plan2.slice(plan2.indexOf('My week'), plan2.indexOf('My week') + 500).replace(/\n/g, ' | '))
    if (process.env.SHOT_DIR) await pg.screenshot({ path: `${process.env.SHOT_DIR}/jira-plan.png`, fullPage: true })
    // An administrator decides from the Dashboard.
    await call('POST', `/api/weekly/${WEEK}/jira/FNP-2002/update`, {
      progress: 'Started the load', done: false, reason: 'Budget file late', decision: true, decisionText: 'Load without the late file?',
    }, james)
    const bp = await (await browser.createBrowserContext()).newPage()
    await bp.setViewport({ width: 1400, height: 900 })
    const [bn, bv] = boss.split('=')
    await bp.setCookie({ name: bn, value: bv, url: base })
    await bp.goto(`${base}/#dashboard`, { waitUntil: 'networkidle0' })
    await bp.waitForSelector('[data-decision="FNP-2002"]', { timeout: 15000 }).catch(() => {})
    check('THE DASHBOARD SHOWS THE DECISION ASKED FOR', (await bp.evaluate(() => document.querySelector('[data-decision="FNP-2002"]')?.textContent || '')).includes('Load without the late file?'))
    await bp.evaluate(() => [...document.querySelectorAll('[data-decision="FNP-2002"] button')].find((b) => b.textContent.trim() === 'Decided').click())
    await bp.waitForSelector('[data-decision="FNP-2002"] input', { timeout: 5000 }).catch(() => {})
    await bp.focus('[data-decision="FNP-2002"] input')
    await bp.keyboard.type('Yes, load it and true up next week.')
    await bp.evaluate(() => [...document.querySelectorAll('[data-decision="FNP-2002"] button')].find((b) => b.textContent.trim() === 'Save').click())
    await bp.waitForFunction(() => !document.querySelector('[data-decision="FNP-2002"]'), { timeout: 8000 }).catch(() => {})
    await sleep(300)
    check('  DECIDED THERE, IT LEAVES THE LIST AND IS WRITTEN ON THE TASK',
      !(await bp.evaluate(() => !!document.querySelector('[data-decision="FNP-2002"]')))
      && writes.some((x) => x.kind === 'comment' && x.key === 'FNP-2002' && /true up next week/.test(JSON.stringify(x.body))))

    const wide = await (async () => { await pg.setViewport({ width: 390, height: 844 }); await sleep(300); return pg.evaluate(() => document.documentElement.scrollWidth) })()
    check('NOTHING SPILLS SIDEWAYS AT 390px', wide <= 390, `scrollWidth ${wide}`)
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

console.log(failures ? `\n${failures} FAILED` : '\nall Jira week checks passed')
process.exit(failures ? 1 : 0)
