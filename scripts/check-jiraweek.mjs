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
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import { weekOf, addWeeks } from '../src/lib/weekly.js'
import { coversWeek, taskSpan, appendWeeklyEntry, ddmmyyyy } from '../server/jira.js'
import { commentText } from '../server/jiraWeek.js'
import { mentionsHold, projectOnHold } from '../src/lib/hold.js'
import { needsUpdate, updateProblems, postedSummary } from '../src/lib/taskUpdate.js'
import { lastWeekFromJira } from '../src/lib/manager.js'

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
put('FNP-2002', { description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Original scope: load FY25 budget by cost centre.' }] }] }, summary: 'Load last year budget', assignee: ACC.james, parent: 'FNP-877', start: day(LAST, 3), due: day(WEEK, 2), status: 'To Do', cat: 'new' })
put('FNP-2003', { summary: 'Write the runbook', assignee: ACC.james, parent: 'FNP-379', status: 'To Do', cat: 'new' })
put('FNP-2004', { summary: 'Demo to FP&A', assignee: ACC.james, parent: 'FNP-379', start: day(NEXT, 1), due: day(NEXT, 2), status: 'To Do', cat: 'new' })
put('FNP-2005', { summary: 'Kade’s own task', assignee: ACC.kade, parent: 'FNP-267', start: day(WEEK, 0), due: day(WEEK, 4), status: 'To Do', cat: 'new' })
// The rule (owner, 2026-11-06): what James updates is what has him as PIC
// (assignee) in Jira, epic or task, whose timeline covers the week.
const EXTRA = ['FNP-2006', 'FNP-2007', 'FNP-2008', 'FNP-2009', 'FNP-2011', 'FNP-935', 'FNP-5000']
put('FNP-2006', { summary: 'His task on Kade’s project', assignee: ACC.james, parent: 'FNP-267', start: day(WEEK, 0), due: day(WEEK, 4), status: 'To Do', cat: 'new' })
put('FNP-2007', { summary: 'Under an epic not in the register', assignee: ACC.james, parent: 'FNP-4444', start: day(WEEK, 0), due: day(WEEK, 4), status: 'To Do', cat: 'new' })
put('FNP-935', { summary: 'Dashboard Portal Configuration', type: 'Epic', assignee: ACC.james, start: day(LAST, 0), due: day(NEXT, 4), status: 'In Progress', cat: 'indeterminate' })
// …and NOT these: past due, or marked [DELETED] (the item, its epic, its register row).
put('FNP-2009', { summary: 'Long past due, never closed', assignee: ACC.james, parent: 'FNP-379', start: day(LAST, 0), due: day(LAST, 3), status: 'To Do', cat: 'new' })
put('FNP-2008', { summary: 'Under a project deleted in the register', assignee: ACC.james, parent: 'FNP-868', start: day(WEEK, 0), due: day(WEEK, 2), status: 'To Do', cat: 'new' })
put('FNP-5000', { summary: 'ERP Migration [DELETED]', type: 'Epic', assignee: ACC.james, start: day(WEEK, 0), due: day(NEXT, 4), status: 'To Do', cat: 'new' })
put('FNP-2011', { summary: 'Under a deleted epic', assignee: ACC.james, parent: 'FNP-5000', start: day(WEEK, 0), due: day(WEEK, 2), status: 'To Do', cat: 'new' })
const writes = []
const taskJql = []
// Keys whose comments Jira refuses, as a Jira that is down would.
const failComment = new Set()
const asRaw = (i) => ({
  key: i.key,
  fields: {
    summary: i.summary,
    status: { name: i.status, statusCategory: { key: i.cat } },
    duedate: i.due || null,
    customfield_10015: i.start || null,
    assignee: i.assignee ? { accountId: i.assignee, displayName: i.assignee === ACC.james ? 'Pipat Singhasiri' : 'Jarinya Phosri' } : null,
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
    const noEpics = /issuetype != /.test(jql)
    const dueFrom = (jql.match(/duedate >= "([^"]+)"/) || [])[1]
    const under = (jql.match(/parent IN \(([^)]*)\)/) || [])[1]?.split(',')
    if (acc) taskJql.push(jql)
    // As Jira does: a key it does not know fails the whole query.
    if (under?.some((k) => /^ZZZ-/.test(k))) return send(400, { errorMessages: [`An issue with key '${under.find((k) => /^ZZZ-/.test(k))}' does not exist for field 'key'.`] })
    const list = [...issues.values()].filter((i) => (acc ? i.assignee === acc : true) && (!noEpics || i.type !== 'Epic')
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
    put(key, {
      summary: f.summary, assignee: f.assignee?.accountId, parent: f.parent?.key, start: f.customfield_10015, due: f.duedate,
      status: 'To Do', cat: 'new', type: f.issuetype?.id === '10000' ? 'Epic' : 'Task', labels: f.labels,
    })
    writes.push({ kind: 'create', key, fields: f })
    return send(201, { key, id: String(nextKey) })
  }
  let k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/comment$/)
  if (k && failComment.has(k[1])) return send(503, { errorMessages: ['Jira is down for maintenance'] })
  if (k) { writes.push({ kind: 'comment', key: k[1], body: json().body }); return send(201, { id: `c${writes.length}` }) }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/attachments$/)
  if (k) {
    const names = [...raw.toString('latin1').matchAll(/filename="([^"]+)"/g)].map((x) => x[1])
    writes.push({ kind: 'attach', key: k[1], names, token: req.headers['x-atlassian-token'] })
    return send(200, names.map((filename) => ({ filename })))
  }
  k = m(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/transitions$/)
  if (k) {
    if (req.method === 'GET') return send(200, { transitions: [{ id: '21', to: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }, { id: '31', to: { name: 'Done', statusCategory: { key: 'done' } } }, { id: '41', name: 'Put on hold', to: { name: 'On Hold', statusCategory: { key: 'indeterminate' } } }] })
    writes.push({ kind: 'transition', key: k[1], id: json().transition?.id })

    const tid = json().transition?.id
    const i = issues.get(k[1])
    if (i && tid === '41') { i.status = 'On Hold'; i.cat = 'indeterminate' } else if (i) { i.status = 'Done'; i.cat = 'done' }
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
  const gone = seed.projects.find((p) => p.key === 'FNP-868')
  gone.summary = `${gone.summary} [DELETED]`
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  const nobody = await signUp('nobody@lotuss.com')
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)

  console.log('\n--- the week, from Jira ---')
  const w = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
  check('A MEMBER’S WEEK IS THEIR JIRA TASKS', w.jira === 'on' && w.account === 'Pipat Singhasiri', JSON.stringify(w).slice(0, 160))
  const got = (w.tasks || []).map((t) => t.key).sort().join()
  check('  EVERYTHING WITH THEM AS PIC WHOSE TIMELINE COVERS THE WEEK, epic or task', got === ['FNP-2001', 'FNP-2002', 'FNP-2006', 'FNP-2007', 'FNP-935'].sort().join(), got)
  check('  their epic is there as an epic, as its own project', w.tasks?.find((t) => t.key === 'FNP-935')?.epic === true
    && w.tasks.find((t) => t.key === 'FNP-935').project?.key === 'FNP-935')
  check('  NOT one past due, NOT next week’s, NOT a colleague’s', !(w.tasks || []).some((t) => ['FNP-2009', 'FNP-2004', 'FNP-2005'].includes(t.key)) && (w.overdue || []).length === 0)
  check('  NOTHING MARKED [DELETED]: the epic, a task under it, a task under a deleted register row',
    !(w.tasks || []).some((t) => ['FNP-5000', 'FNP-2011', 'FNP-2008'].includes(t.key)))
  check('  and the undated one, to plan', w.undated?.map((t) => t.key).join() === 'FNP-2003', w.undated?.map((t) => t.key).join())
  const asked = taskJql.at(-1) || ''
  check('  Jira is asked only for what is due this week or later', asked.includes(`duedate >= "${WEEK}"`) && !/issuetype != /.test(asked), asked.slice(0, 200))
  for (const k of EXTRA) issues.delete(k)
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
  check('  the plan counts as in; the report not yet (FNP-2002 is unreported)', !!entry?.planSubmittedAt && !entry.reportSubmittedAt)

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
  const flat = (n) => (n?.text || '') + (n?.content || []).map(flat).join('|')
  const desc1 = flat(issues.get('FNP-2002').description)
  const today = ddmmyyyy()
  check('THE UPDATE IS ADDED TO THE ISSUE\'S DESCRIPTION, AFTER WHAT IS THERE', desc1.startsWith('Original scope: load FY25 budget by cost centre.')
    && desc1.indexOf(today) > desc1.indexOf('Original scope') && /Started the load/.test(desc1) && notDone.body.update?.jira?.description === 'updated', desc1.slice(0, 240))
  check(`  its first line starts with the date, dd-mm-yyyy (${today})`, /^\d{2}-\d{2}-\d{4}$/.test(today)
    && issues.get('FNP-2002').description.content.at(-4)?.content?.[0]?.text === today, JSON.stringify(issues.get('FNP-2002').description.content.at(-4)).slice(0, 160))
  const second = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2002/update`, { progress: 'Loaded half of it', done: false, reason: 'Budget file late from FP&A' }, james)
  const desc2 = flat(issues.get('FNP-2002').description)
  check('  A SECOND SUBMIT THE SAME DAY REPLACES THAT DAY’S ENTRY; NOTHING EARLIER IS CHANGED', desc2.startsWith('Original scope: load FY25 budget by cost centre.')
    && (desc2.match(new RegExp(today, 'g')) || []).length === 1 && desc2.includes('Loaded half of it') && !desc2.includes('Started the load')
    && second.body.update?.jira?.descriptionReplaced === true, desc2.slice(0, 300))
  const fresh = appendWeeklyEntry(null, '**06-11-2026** — first entry')
  check('  an issue with no description gets the entry as its description', fresh.content.length === 1 && flat(fresh).startsWith('06-11-2026'))
  {
    const yesterday = appendWeeklyEntry(appendWeeklyEntry(null, '**05-11-2026** — old\n**Status:** Not finished'), '**06-11-2026** — today\n**Status:** Not finished')
    const again = appendWeeklyEntry(yesterday, '**06-11-2026** — today\n**Status:** Finished', '**06-11-2026** — today\n**Status:** Not finished')
    const edited = appendWeeklyEntry(yesterday, '**06-11-2026** — today\n**Status:** Finished', '**06-11-2026** — today\n**Status:** something else')
    check('  only the same day’s entry, found exactly as written, is replaced; an entry edited in Jira is kept and the new one appended',
      flat(again).includes('old') && (flat(again).match(/Not finished/g) || []).length === 1 && flat(again).includes('Finished') && (flat(again).match(/06-11-2026/g) || []).length === 1 && again.replaced === true
      && (flat(edited).match(/06-11-2026/g) || []).length === 2 && !edited.replaced, `${flat(again)} // ${flat(edited)}`)
  }
  check('  dd-mm-yyyy is Bangkok\'s date', ddmmyyyy(Date.parse('2026-11-06T18:30:00Z')) === '07-11-2026' && ddmmyyyy(Date.parse('2026-11-06T16:59:00Z')) === '06-11-2026')
  check('NOT FINISHED, WITH THE REASON', notDone.status === 200 && !writes.some((x) => x.kind === 'transition' && x.key === 'FNP-2002'))
  const entry2 = await D.collection('kpi_weekly').findOne({ week: WEEK, person: 'james' })
  check('  EVERY TASK OF THE WEEK UPDATED: THE REPORT COUNTS AS IN', !!entry2?.reportSubmittedAt && notDone.body.reportIn === true)
  const again = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
  check('the week now shows each task’s update', again.tasks.find((t) => t.key === 'FNP-2001')?.update?.done === true
    && again.tasks.find((t) => t.key === 'FNP-2002')?.update?.reason === 'Budget file late from FP&A')

  // ON HOLD: read from what they wrote, and the item moved to Hold in Jira.
  {
    // The word as a status counts; the verb, or "hold" inside a longer word, does not (QA, 2026-11-07).
    const HOLD = ['This project is hold', 'Put on hold until Q1', 'Budget owner is on leave, so this is on hold until 20 Nov', 'On hold — waiting for the budget',
      'We put the project on hold', 'Put it on hold until January', 'Holding it for now while FP&A decides', 'Hold for now', 'Hold until the budget is approved',
      'Paused until the new chart of accounts lands', 'Suspended by the CFO', 'Parked until Q1', 'Status: hold', 'The task was hold last week',
      'Mapped 3 lines. Hold.', 'On-hold pending CFO sign-off', 'โปรเจกต์นี้โฮลด์ไว้ก่อน', 'ระงับไว้ก่อน', 'งานนี้ hold ไว้ก่อน', 'หยุดชั่วคราวรอ budget']
    const NOT_HOLD = ['Reconciled the forecast', 'No longer on hold, resumed work', 'Set the threshold', 'Household data loaded',
      'Mapped 140 of 210 cost lines. Will hold a review session with FP&A on Monday.', 'Added RTC; the stakeholders put the threshold logic on hold',
      'We will hold the meeting on Friday', 'Hold a workshop with AP next week', 'Emailed the account holder', 'Mapped the holding company entities',
      'Updated the shareholder list', 'Hold on, the file is still loading', 'Holding a call with IT tomorrow', 'Placeholder rows removed', 'บริษัทโฮลดิ้งส่งไฟล์แล้ว']
    const missed = HOLD.filter((x) => !mentionsHold(x))
    const wrong = NOT_HOLD.filter(mentionsHold)
    check(`"HOLD" AS A STATUS IS READ AS ON HOLD (${HOLD.length} phrases)`, !missed.length, missed.join(' | '))
    check(`  "hold a review", "threshold", "holder", "holding company" are NOT (${NOT_HOLD.length} phrases)`, !wrong.length, wrong.join(' | '))
  }
  check('WHAT IS MISSING FROM AN UPDATE IS SAID BY FIELD, BEFORE ANYTHING IS SENT', JSON.stringify(Object.keys(updateProblems({ progress: '', done: null })))
    === '["progress","status"]' && Object.keys(updateProblems({ progress: 'x', done: false, hold: false, reason: '' })).join() === 'reason'
    && !Object.keys(updateProblems({ progress: 'x', done: false, hold: true })).length)

  // A POST JIRA DID NOT TAKE is kept here, and is still to do.
  {
    put('FNP-2016', { summary: 'Jira refuses this one', assignee: ACC.james, parent: 'FNP-379', start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
    failComment.add('FNP-2016')
    const fr = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2016/update`, { progress: 'Did the thing', done: true }, james)
    const fw = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
    const ft = fw.tasks.find((t) => t.key === 'FNP-2016')
    check('A FAILED JIRA POST IS KEPT HERE, SAYS WHY, AND STILL COUNTS AS TO DO', fr.status === 200 && fr.body.update?.jira?.state === 'failed'
      && /maintenance|503/.test(fr.body.update.jira.error || '') && ft?.update?.jira?.state === 'failed' && needsUpdate(ft, fw.writable)
      && !needsUpdate(fw.tasks.find((t) => t.key === 'FNP-2001'), fw.writable), JSON.stringify(ft?.update?.jira))
    check('  with writes switched off on the server, the update kept here is all there is, and counts', !needsUpdate(ft, false))
    failComment.delete('FNP-2016')
    const rt = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2016/update`, { progress: 'Did the thing', done: true }, james)
    check('  sent again, it reaches Jira', rt.body.update?.jira?.state === 'posted' && /^Posted to FNP-2016 in Jira — comment, description, Done/.test(postedSummary('FNP-2016', rt.body.update.jira)),
      postedSummary('FNP-2016', rt.body.update?.jira))
    issues.delete('FNP-2016')
    await D.collection('kpi_task_updates').deleteOne({ _id: `${WEEK}.james.FNP-2016` })
  }
  put('FNP-2012', { summary: 'Vendor portal phase 2', assignee: ACC.james, parent: 'FNP-379', start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
  const held = await call('POST', `/api/weekly/${WEEK}/jira/FNP-2012/update`, { progress: 'This project is hold', hold: true }, james)
  check('ON HOLD IS SUBMITTED WITHOUT A REASON, AND MOVES THE ITEM TO HOLD IN JIRA', held.status === 200 && held.body.update?.hold === true
    && held.body.update.done === false && held.body.update.jira?.hold === 'On Hold'
    && writes.some((x) => x.kind === 'transition' && x.key === 'FNP-2012' && x.id === '41'), JSON.stringify(held.body).slice(0, 200))
  check('  and the comment says On hold', writes.some((x) => x.kind === 'comment' && x.key === 'FNP-2012' && /On hold/.test(JSON.stringify(x.body))))
  issues.delete('FNP-2012')
  await D.collection('kpi_task_updates').deleteOne({ _id: `${WEEK}.james.FNP-2012` })

  // NOTHING ON HOLD IN THE WEEK: the item itself, its epic, or its register project.
  {
    const taken = ['FNP-379', 'FNP-877', 'FNP-267', 'FNP-868', 'FNP-935']
    const [paused, heldEpic] = seed.projects.filter((p) => p.jiraKey && !taken.includes(p.jiraKey) && !/deleted/i.test(p.summary)).slice(0, 2)
    paused.onHold = { at: 'test', by: 'test' }
    await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
    const HOLDS = ['FNP-2013', 'FNP-2014', 'FNP-7000', 'FNP-2015', heldEpic.jiraKey]
    put('FNP-2013', { summary: 'On hold in Jira itself', assignee: ACC.james, parent: 'FNP-379', start: day(WEEK, 0), due: day(WEEK, 4), status: 'On Hold', cat: 'indeterminate' })
    put('FNP-7000', { summary: 'An epic on hold', type: 'Epic', assignee: ACC.kade, start: day(WEEK, 0), due: day(NEXT, 4), status: 'On Hold', cat: 'indeterminate' })
    put('FNP-2014', { summary: 'Under an epic on hold', assignee: ACC.james, parent: 'FNP-7000', start: day(WEEK, 0), due: day(WEEK, 4), status: 'To Do', cat: 'new' })
    put('FNP-2015', { summary: 'Under a project on hold in the register', assignee: ACC.james, parent: paused.jiraKey, start: day(WEEK, 0), due: day(WEEK, 4), status: 'To Do', cat: 'new' })
    put(heldEpic.jiraKey, { summary: heldEpic.summary, type: 'Epic', assignee: ACC.james, start: day(WEEK, 0), due: day(NEXT, 4), status: 'In Progress', cat: 'indeterminate' })
    const hw = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
    const seen = (hw.tasks || []).map((t) => t.key)
    check('NOTHING ON HOLD IS ASKED FOR: in Hold in Jira, under an epic on hold, under a project on hold here',
      !seen.some((k) => ['FNP-2013', 'FNP-2014', 'FNP-2015'].includes(k)) && seen.includes(heldEpic.jiraKey), seen.join())
    const pe = await call('POST', `/api/weekly/${WEEK}/jira/${heldEpic.jiraKey}/update`, { progress: 'Project on hold until budget is approved', hold: true }, james)
    const row = (await D.collection('kpi_scenarios').findOne({ name: 'Baseline' }))?.payload?.projects?.find((p) => p.key === heldEpic.key)
    check('A PROJECT EPIC PUT ON HOLD: HOLD IN JIRA, AND THE REGISTER SAYS SO FOR THE PROJECT PAGE',
      pe.body.update?.jira?.hold === 'On Hold' && pe.body.update.jira.register === 'updated' && row?.jiraStatus === 'On Hold' && projectOnHold(row), JSON.stringify(pe.body.update?.jira))
    const hw2 = (await call('GET', `/api/weekly/${WEEK}/jira`, undefined, james)).body
    check('  the update they just sent stays on their page this week', (hw2.tasks || []).some((t) => t.key === heldEpic.jiraKey && t.update?.hold))
    const nw = (await call('GET', `/api/weekly/${NEXT}/jira`, undefined, james)).body
    check('  and next week it is not asked for', !(nw.tasks || []).some((t) => t.key === heldEpic.jiraKey), (nw.tasks || []).map((t) => t.key).join())
    check('  a project put on hold here reads as on hold; Resume clears it', projectOnHold(paused) && !projectOnHold({ ...paused, onHold: null }))
    for (const k of HOLDS) issues.delete(k)
    await D.collection('kpi_task_updates').deleteOne({ _id: `${WEEK}.james.${heldEpic.jiraKey}` })
    delete paused.onHold
    await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  }

  // THE MANAGER'S "LAST WEEK": each project's Jira work whose timeline covered it.
  {
    const cov = await call('GET', `/api/jira/coverage/${LAST}`, undefined, boss)
    const row877 = seed.projects.find((p) => p.jiraKey === 'FNP-877')
    const on877 = (cov.body.byProject || {})[row877.key] || []
    const every = Object.values(cov.body.byProject || {}).flat().map((t) => t.key)
    check('LAST WEEK IS THE JIRA WORK WHOSE TIMELINE COVERED LAST WEEK, BY PROJECT', cov.status === 200 && cov.body.jira === 'on'
      && on877.some((t) => t.key === 'FNP-2002') && !every.includes('FNP-2004') && !every.includes('FNP-2001'), JSON.stringify(cov.body).slice(0, 240))
    check('  only an administrator asks for it', (await call('GET', `/api/jira/coverage/${LAST}`, undefined, james)).status === 403)
    // A register key Jira does not know must not blank out every project.
    const stray = seed.projects.find((p) => p.jiraKey && !['FNP-877', 'FNP-379'].includes(p.jiraKey))
    const was = stray.jiraKey
    stray.jiraKey = 'ZZZ-1'
    await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
    const cov2 = await call('GET', `/api/jira/coverage/${LAST}`, undefined, boss)
    check('A KEY JIRA DOES NOT KNOW IS LEFT OUT; EVERY OTHER PROJECT STILL SHOWS', cov2.body.jira === 'on'
      && ((cov2.body.byProject || {})[row877.key] || []).some((t) => t.key === 'FNP-2002') && (cov2.body.skipped || []).includes('ZZZ-1'), JSON.stringify(cov2.body).slice(0, 200))
    stray.jiraKey = was
    await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
    const lw = lastWeekFromJira({ P1: [
      { key: 'FNP-1', summary: 'Done one', done: true, assignee: 'A', status: 'Done', update: null },
      { key: 'FNP-2', summary: 'Said not done', done: false, assignee: 'B', status: 'In Progress', update: { nick: 'Bee', done: false, progress: 'Mapped 3 of 5 feeds', reason: 'Waiting on IT', submittedAt: 'x' } },
      { key: 'FNP-3', summary: 'Silent', done: false, assignee: 'C', status: 'To Do', update: null },
      { key: 'FNP-4', summary: 'Paused', done: false, assignee: 'D', status: 'On Hold', update: null },
    ] })
    check('  each reads Done, Not done (with why), no answer, or On hold', lw.P1[0].done === true && lw.P1[1].done === false && lw.P1[1].blocker === 'Waiting on IT'
      && lw.P1[1].nick === 'Bee' && lw.P1[1].progress === 'Mapped 3 of 5 feeds' && lw.P1[2].done === null && lw.P1[3].hold === true, JSON.stringify(lw.P1))
  }
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
    // A tab with an unsent draft asks before it goes; the checks always say yes.
    pg.on('dialog', (d) => d.accept().catch(() => {}))
    const [n, v] = james.split('=')
    await pg.setCookie({ name: n, value: v, url: base })
    // Next week's plan was confirmed above; un-set it for a moment, so the
    // reminder to plan it has something to remind about.
    const nextPlanAt = (await D.collection('kpi_weekly').findOne({ week: NEXT, person: 'james' }))?.planSubmittedAt
    await D.collection('kpi_weekly').updateOne({ week: NEXT, person: 'james' }, { $unset: { planSubmittedAt: '' } })
    await pg.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await pg.waitForSelector('[data-jira-task]', { timeout: 15000 }).catch(() => {})
    const txt = await pg.evaluate(() => document.body.innerText)
    await D.collection('kpi_weekly').updateOne({ week: NEXT, person: 'james' }, { $set: { planSubmittedAt: nextPlanAt } })
    check('THE PAGE SHOWS THEIR JIRA TASKS, NOT THE MONDAY FORM', txt.includes('FNP-2010') && !txt.includes('This week I\'m focused on'))
    check('  with the filter between not-updated and updated', /Not updated yet 1(?!\d)/.test(txt) && /Already updated 2(?!\d)/.test(txt), (txt.match(/Not updated yet \d+|Already updated \d+/g) || []).join(' '))
    // The reminder comes from Thursday (Bangkok) while next week's plan is not set.
    const bkkDay = new Date(Date.now() + 7 * 3600_000).getUTCDay()
    const lateInWeek = bkkDay === 0 || bkkDay >= 4
    check(`  and the reminder to plan next week ${lateInWeek ? 'is there (Thursday on)' : 'waits for Thursday'}`,
      /Don’t forget next week’s plan|Don't forget next week's plan/.test(txt) === lateInWeek)
    {
      // With next week's plan set, nothing to remind about.
      const p2 = await (await browser.createBrowserContext()).newPage()
      await p2.setViewport({ width: 1280, height: 900 })
      await p2.setCookie({ name: james.split('=')[0], value: james.split('=')[1], url: base })
      await p2.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
      await p2.waitForSelector('[data-jira-task]', { timeout: 15000 }).catch(() => {})
      check('  and no reminder once next week’s plan is set', !/Don.t forget next week/.test(await p2.evaluate(() => document.body.innerText)))
      await p2.close()
    }
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
        // One framed block: the header and the card share the same 1px border.
        framed: !!g && getComputedStyle(g).borderLeftWidth === '1px' && getComputedStyle(g).borderTopWidth === '1px' && getComputedStyle(g.querySelector('button')).borderLeftWidth === '0px'
          && g.getBoundingClientRect().bottom >= document.querySelector('[data-jira-task="FNP-2010"]').getBoundingClientRect().bottom,
      }
    })
    check('  each task sits under its project header, saying how many are left', !!head.group && /to update/i.test(head.header || ''), head.header)
    check('  the project and its tasks are one framed block', head.framed)
    check('  the next step names the task to update, on a pulsing button', /Update 1 task/.test(head.next || '') && /FNP-2010/.test(head.next || '') && !!head.anim && head.anim !== 'none' && !head.hello, `${head.next} · ${head.anim}`)
    // The button takes them to that task's progress box.
    await pg.click('[data-next-action]')
    await sleep(700)
    check('  and pressing it puts them in that task\'s progress box',
      await pg.evaluate(() => document.activeElement?.closest('[data-jira-task]')?.getAttribute('data-jira-task') === 'FNP-2010'))
    // Writing "hold" picks On hold for them; taking it out un-picks it.
    await pg.keyboard.type('This project is hold')
    await sleep(250)
    const holdOn = await pg.evaluate(() => {
      const card = document.querySelector('[data-jira-task="FNP-2010"]')
      const b = [...card.querySelectorAll('button')].find((x) => x.textContent.trim() === 'On hold')
      return { pressed: b?.getAttribute('aria-pressed'), note: card.querySelector('[data-hold-note]')?.textContent || '' }
    })
    check('  WRITING "HOLD" PICKS ON HOLD, AND SAYS IT WILL MOVE IN JIRA', holdOn.pressed === 'true' && /Hold status in Jira/.test(holdOn.note), JSON.stringify(holdOn))
    for (let i = 0; i < 'This project is hold'.length; i++) await pg.keyboard.press('Backspace')
    await sleep(250)
    check('  and taking it out un-picks it', await pg.evaluate(() => {
      const b = [...document.querySelectorAll('[data-jira-task="FNP-2010"] button')].find((x) => x.textContent.trim() === 'On hold')
      return b?.getAttribute('aria-pressed') === 'false'
    }))
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
    // AN UNSENT DRAFT survives going to another week and back, and a reload.
    const cardState = () => pg.evaluate(() => {
      const card = document.querySelector('[data-jira-task="FNP-2010"]')
      const why = [...(card?.querySelectorAll('label') || [])].find((l) => /Why isn/.test(l.textContent))
      return {
        progress: card?.querySelector('textarea')?.value || null,
        reason: why?.parentElement.querySelector('textarea, input')?.value || null,
        restored: !!card?.querySelector('[data-draft-restored]'),
        notFinished: [...(card?.querySelectorAll('button') || [])].find((b) => b.textContent.trim() === 'Not finished')?.getAttribute('aria-pressed'),
      }
    })
    await sleep(300)
    await pg.click('[aria-label="next week"]')
    await pg.waitForFunction(() => document.body.innerText.includes('Planning week'), { timeout: 10000 }).catch(() => {})
    await pg.click('[aria-label="previous week"]')
    await pg.waitForSelector('[data-jira-task="FNP-2010"]', { timeout: 10000 }).catch(() => {})
    const afterSwitch = await cardState()
    check('AN UNSENT DRAFT SURVIVES A WEEK SWITCH', afterSwitch.progress === 'Tied out three of five accounts' && afterSwitch.reason === 'Two accounts wait on AP'
      && afterSwitch.notFinished === 'true' && afterSwitch.restored, JSON.stringify(afterSwitch))
    await pg.reload({ waitUntil: 'networkidle0' })
    await pg.waitForSelector('[data-jira-task="FNP-2010"]', { timeout: 15000 }).catch(() => {})
    const afterReload = await cardState()
    check('  AND A RELOAD', afterReload.progress === 'Tied out three of five accounts' && afterReload.reason === 'Two accounts wait on AP' && afterReload.notFinished === 'true',
      JSON.stringify(afterReload))
    // PICTURES: attached with the button, dropped onto the card, pasted anywhere on it.
    const pngFile = new URL('../scratch-attach.png', import.meta.url)
    writeFileSync(pngFile, Buffer.from(PNG.split(',')[1], 'base64'))
    const input = await pg.$('[data-jira-task="FNP-2010"] input[type="file"]')
    await input.uploadFile(fileURLToPath(pngFile))
    await sleep(500)
    const dropPaste = async (kind) => pg.evaluate(async (k, data) => {
      const card = document.querySelector('[data-jira-task="FNP-2010"]')
      const blob = await (await fetch(data)).blob()
      const dt = new DataTransfer()
      dt.items.add(new File([blob], `${k}.png`, { type: 'image/png' }))
      if (k === 'drop') {
        card.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
        card.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
      } else {
        // Pasted into the blocker box, not the progress box: anywhere on the card counts.
        const into = [...card.querySelectorAll('input, textarea')].at(-1)
        into.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      }
    }, kind, PNG)
    await dropPaste('drop')
    await sleep(400)
    await dropPaste('paste')
    await sleep(400)
    const pics = await pg.evaluate(() => ({
      n: document.querySelectorAll('[data-jira-task="FNP-2010"] [data-attached-images] img').length,
      full: document.querySelector('[data-jira-task="FNP-2010"] [data-attach-image]')?.disabled,
    }))
    check('A PICTURE CAN BE ATTACHED, DROPPED ON THE CARD, OR PASTED ANYWHERE ON IT', pics.n === 3, JSON.stringify(pics))
    check('  three is the most, and the button says so by switching off', pics.full === true)
    unlinkSync(pngFile)
    if (process.env.SHOT_DIR) await pg.screenshot({ path: `${process.env.SHOT_DIR}/jira-week.png`, fullPage: true })
    await pg.evaluate(() => document.querySelector('[aria-label="submit FNP-2010"]').click())
    await pg.waitForFunction(() => /Already updated 3(?!\d)/.test(document.body.innerText), { timeout: 10000 }).catch(() => {})
    const after = await pg.evaluate(() => document.body.innerText)
    check('SUBMIT ON THE CARD POSTS IT AND MOVES IT TO "ALREADY UPDATED"', /Already updated 3(?!\d)/.test(after) && /Not updated yet 0(?!\d)/.test(after))
    check('  the comment reached Jira', writes.some((x) => x.kind === 'comment' && x.key === 'FNP-2010' && /Two accounts wait on AP/.test(JSON.stringify(x.body))))
    check('  AND THE THREE PICTURES ARE ATTACHED TO THE ISSUE IN JIRA', writes.some((x) => x.kind === 'attach' && x.key === 'FNP-2010' && x.names.length === 3), JSON.stringify(writes.filter((x) => x.kind === 'attach').map((x) => [x.key, x.names])))
    const told = await pg.evaluate(() => ({
      flash: document.querySelector('[data-posted="FNP-2010"]')?.innerText || '',
      draft: Object.keys(localStorage).filter((k) => k.includes(':FNP-2010')),
    }))
    check('  AND SAYS SO WHERE THE CARD WAS: what reached Jira', /Posted to FNP-2010 in Jira — comment, 3 pictures, description/.test(told.flash), told.flash)
    check('  the draft is gone once it is sent', told.draft.length === 0, told.draft.join())

    // Done in Jira, then said Not finished: told before it is posted.
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Already updated/.test(b.textContent.trim()))?.click())
    await pg.waitForSelector('[data-jira-task="FNP-2001"]', { timeout: 5000 }).catch(() => {})
    // A sent update is folded to one row: Edit opens it.
    check('A SENT UPDATE IS ONE ROW, WITH EDIT', await pg.evaluate(() => {
      const card = document.querySelector('[data-jira-task="FNP-2001"]')
      return !!card && !card.querySelector('textarea') && !!card.querySelector('[aria-label="edit the update on FNP-2001"]')
    }))
    await pg.click('[aria-label="edit the update on FNP-2001"]')
    await pg.waitForSelector('[data-jira-task="FNP-2001"] textarea', { timeout: 5000 }).catch(() => {})
    const pick = (key, label) => pg.evaluate((k, l) => [...document.querySelectorAll(`[data-jira-task="${k}"] button`)].find((b) => b.textContent.trim() === l)?.click(), key, label)
    await pick('FNP-2001', 'Not finished')
    await sleep(250)
    const doneWarn = await pg.evaluate(() => ({
      warn: document.querySelector('[data-jira-task="FNP-2001"] [data-done-warning]')?.innerText || '',
      btn: document.querySelector('[aria-label="submit FNP-2001"]')?.innerText || '',
    }))
    check('RE-SUBMITTING AN ITEM DONE IN JIRA AS NOT FINISHED WARNS FIRST', /FNP-2001 is Done in Jira\. This update won.t reopen it/.test(doneWarn.warn) && /Post anyway/.test(doneWarn.btn), JSON.stringify(doneWarn))
    await pick('FNP-2001', 'Finished')
    await sleep(250)
    check('  and picking Finished again takes the warning away', !(await pg.evaluate(() => !!document.querySelector('[data-jira-task="FNP-2001"] [data-done-warning]'))))
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Not updated yet/.test(b.textContent.trim()))?.click())

    // ADD A TASK: only projects with a Jira epic that are still open, one per epic.
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add a task')?.click())
    await pg.waitForSelector('[aria-label="new Jira task"] input', { timeout: 5000 }).catch(() => {})
    await pg.click('[aria-label="new Jira task"] input')
    await pg.waitForSelector('[role="option"]', { timeout: 5000 }).catch(() => {})
    const opts = await pg.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()))
    const epicKeys = new Set([...seed.projects.filter((p) => p.jiraKey).map((p) => p.jiraKey), np.body.epic?.key])
    const lead = opts.map((o) => o.split(/\s+/)[0])
    check('"ADD A TASK" OFFERS ONLY PROJECTS WITH A JIRA EPIC, ONE PER EPIC, NONE FINISHED OR DELETED', opts.length > 0 && opts.length < seed.projects.length
      && lead.every((k) => epicKeys.has(k)) && new Set(lead).size === lead.length && !opts.some((o) => /deleted/i.test(o))
      && !lead.includes('FNP-868'), `${opts.length} of ${seed.projects.length}: ${opts.slice(0, 3).join(' | ')}`)
    await pg.keyboard.press('Escape')
    await pg.evaluate(() => [...document.querySelectorAll('[aria-label="new Jira task"] button')].find((b) => b.textContent.trim() === 'Cancel')?.click())
    // NEW PROJECT: the one-line intro stands clear of the first field's label.
    await pg.waitForFunction(() => !document.querySelector('[aria-label="new Jira task"]'), { timeout: 5000 }).catch(() => {})
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'New project')?.click())
    await pg.waitForSelector('[aria-label="new project"] [data-dialog-intro]', { timeout: 5000 }).catch(() => {})
    const npGap = await pg.evaluate(() => {
      const d = document.querySelector('[aria-label="new project"]')
      const intro = d?.querySelector('[data-dialog-intro]')
      const label = d?.querySelector('label')
      return intro && label ? { gap: Math.round(label.getBoundingClientRect().top - intro.getBoundingClientRect().bottom), label: label.textContent } : null
    })
    check('"NEW PROJECT" LEAVES ROOM BETWEEN ITS INTRO AND THE FIRST FIELD', !!npGap && npGap.label.startsWith('Type') && npGap.gap >= 18, JSON.stringify(npGap))
    await pg.evaluate(() => [...document.querySelectorAll('[aria-label="new project"] button')].find((b) => b.textContent.trim() === 'Cancel')?.click())
    await pg.waitForFunction(() => !document.querySelector('[aria-label="new project"]'), { timeout: 5000 }).catch(() => {})
    await pg.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Plan week \d+/.test(b.textContent.trim()))?.click())
    await pg.waitForSelector('[data-jira-task="FNP-2004"] input[type="date"]', { timeout: 10000 }).catch(() => {})
    const plan2 = await pg.evaluate(() => document.body.innerText)
    check('  ONE "MY PLAN IS SET" AT MOST, IN THE NEXT STEP BAR', (await pg.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /My plan for week/.test(b.textContent)).length)) <= 1)
    check('NEXT WEEK OPENS FOR PLANNING, WITH DATES TO SET', plan2.includes('Planning week') && plan2.includes('FNP-2004')
      && (await pg.evaluate(() => !!document.querySelector('[data-jira-task="FNP-2004"] input[type="date"]'))), plan2.slice(plan2.indexOf('My week'), plan2.indexOf('My week') + 500).replace(/\n/g, ' | '))
    // Changing a date shows "Save dates" straight away; putting it back hides it.
    const setDue = (v) => pg.evaluate((val) => {
      const el = document.querySelectorAll('[data-jira-task="FNP-2004"] input[type="date"]')[1]
      const was = el.value
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return was
    }, v)
    const saveDatesBtn = () => pg.evaluate(() => {
      const b = [...document.querySelectorAll('[data-jira-task="FNP-2004"] button')].find((x) => x.textContent.trim() === 'Save dates')
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), disabled: b.disabled }
    })
    const noSaveYet = await saveDatesBtn()
    const dueWas = await setDue(day(NEXT, 3))
    await sleep(250)
    const saveShown = await saveDatesBtn()
    check('A CHANGED DATE SHOWS "SAVE DATES" AT ONCE', !noSaveYet && !!saveShown && saveShown.w > 0 && saveShown.h >= 32 && !saveShown.disabled, JSON.stringify({ noSaveYet, saveShown }))
    await setDue(dueWas)
    await sleep(250)
    check('  and putting the date back takes it away', !(await saveDatesBtn()))
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
    await bp.evaluate(() => [...document.querySelectorAll('[data-decision="FNP-2002"] button')].find((b) => b.textContent.trim() === 'Mark decided').click())
    await bp.waitForSelector('[data-decision="FNP-2002"] input', { timeout: 5000 }).catch(() => {})
    await bp.focus('[data-decision="FNP-2002"] input')
    await bp.keyboard.type('Yes, load it and true up next week.')
    await bp.evaluate(() => [...document.querySelectorAll('[data-decision="FNP-2002"] button')].find((b) => b.textContent.trim() === 'Save').click())
    await bp.waitForFunction(() => !document.querySelector('[data-decision="FNP-2002"]'), { timeout: 8000 }).catch(() => {})
    await sleep(300)
    check('  DECIDED THERE, IT LEAVES THE LIST AND IS WRITTEN ON THE TASK',
      !(await bp.evaluate(() => !!document.querySelector('[data-decision="FNP-2002"]')))
      && writes.some((x) => x.kind === 'comment' && x.key === 'FNP-2002' && /true up next week/.test(JSON.stringify(x.body))))

    // A CLOSED WEEK: the record, with nothing to plan or add.
    await pg.goto(`${base}/#weekly`, { waitUntil: 'networkidle0' })
    await pg.waitForSelector('[data-jira-task], [data-next-step]', { timeout: 15000 }).catch(() => {})
    for (let i = 0; i < 2; i++) {
      const was = await pg.evaluate(() => document.querySelector('[data-next-step]')?.parentElement?.innerText || '')
      await pg.click('[aria-label="previous week"]')
      await pg.waitForFunction((w) => (document.querySelector('[data-next-step]')?.parentElement?.innerText || '') !== w && !/Reading your Jira|Loading week/.test(document.body.innerText), { timeout: 10000 }, was).catch(() => {})
    }
    await sleep(500)
    const shut = await pg.evaluate(() => document.body.innerText)
    check('A LOCKED WEEK HAS NO PLANNING PROMPTS AND NO ADD-A-TASK', /Week \d+ is locked/.test(shut) && !/Plan week \d+/.test(shut) && !/Don.t forget next week/.test(shut)
      && !/Add a task/.test(shut) && !/New project/.test(shut), (shut.match(/Week \d+ is locked[^\n]*/) || [''])[0])

    // A POST JIRA REFUSED: still to do on the page, with Try again on its card.
    put('FNP-2017', { summary: 'Jira will refuse this', assignee: ACC.james, parent: 'FNP-379', start: day(WEEK, 0), due: day(WEEK, 4), status: 'In Progress', cat: 'indeterminate' })
    failComment.add('FNP-2017')
    await call('POST', `/api/weekly/${WEEK}/jira/FNP-2017/update`, { progress: 'Drafted the memo', done: false, reason: 'Waiting on sign-off' }, james)
    await pg.goto(`${base}/?again#weekly`, { waitUntil: 'networkidle0' })
    await pg.waitForSelector('[data-jira-task="FNP-2017"]', { timeout: 15000 }).catch(() => {})
    const fail = await pg.evaluate(() => {
      const card = document.querySelector('[data-jira-task="FNP-2017"]')
      return {
        warn: card?.querySelector('[data-post-failed]')?.innerText || '',
        retry: !!card && [...card.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Try again'),
        next: document.querySelector('[data-next-step]')?.innerText.replace(/\s+/g, ' ') || '',
        group: card?.closest('[data-project-group]')?.querySelector('button')?.innerText.replace(/\s+/g, ' ') || '',
      }
    })
    check('A FAILED JIRA POST STAYS UNDER "NOT UPDATED YET", SAYS WHY, WITH TRY AGAIN', /Jira did not take this update on FNP-2017/.test(fail.warn) && /maintenance|503/.test(fail.warn) && fail.retry, JSON.stringify(fail))
    check('  the Next step and the project block count it as to do', /Update 1 task/.test(fail.next) && /FNP-2017/.test(fail.next) && /1 to update/i.test(fail.group), `${fail.next} · ${fail.group}`)
    failComment.delete('FNP-2017')
    await pg.evaluate(() => [...document.querySelectorAll('[data-jira-task="FNP-2017"] button')].find((b) => b.textContent.trim() === 'Try again')?.click())
    await pg.waitForSelector('[data-posted="FNP-2017"]', { timeout: 10000 }).catch(() => {})
    // The confirmation shows first; the card leaves the list once the week reloads.
    await pg.waitForFunction(() => !document.querySelector('[data-jira-task="FNP-2017"]'), { timeout: 10000 }).catch(() => {})
    const retried = await pg.evaluate(() => ({
      flash: document.querySelector('[data-posted="FNP-2017"]')?.innerText || '',
      still: !!document.querySelector('[data-jira-task="FNP-2017"]'),
    }))
    check('  RETRY POSTS IT, AND THE CARD MOVES TO "ALREADY UPDATED" WITH A CONFIRMATION', /Posted to FNP-2017 in Jira/.test(retried.flash) && !retried.still
      && writes.some((x) => x.kind === 'comment' && x.key === 'FNP-2017' && /Drafted the memo/.test(JSON.stringify(x.body))), JSON.stringify(retried))
    if (process.env.SHOT_DIR) await pg.screenshot({ path: `${process.env.SHOT_DIR}/jira-retried.png`, fullPage: true })
    issues.delete('FNP-2017')

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
