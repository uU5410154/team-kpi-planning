/**
 * Date proposals: a slipped task asks to move its project, an administrator
 * approves or rejects it, and an approval moves the project here and in Jira.
 *
 * Runs the real server against a real mongod and a fake Jira on localhost —
 * first with writing to Jira switched off, then on — and finishes in a real
 * browser: the decision panel, the Timeline markers and the phone.
 *
 *   node scripts/check-approvals.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { weekOf, proposalFor } from '../src/lib/weekly.js'

let failures = 0
// Set SHOT_DIR to keep screenshots of each screen the browser checks visit.
const shot = async (page, name) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png` }) }
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ------------------------------------------------------------- the rule */

console.log('\n--- when a slip becomes a proposal ---')
const proj = { key: 'P-1', due: '2026-11-30' }
const slip = {
  done: false, projectKey: 'P-1', newDate: '2026-12-10', affects: false,
}
check('A NEW DATE PAST THE PROJECT’S DUE ASKS TO MOVE IT, to that date',
  proposalFor(slip, proj)?.proposedDue === '2026-12-10' && proposalFor(slip, proj).byDate === 10)
check('  even when the member says it does not — flagged as a disagreement', proposalFor(slip, proj).disagree === true)
const says = proposalFor({ ...slip, newDate: '2026-11-20', affects: true }, proj)
check('A MEMBER WHO SAYS IT PUSHES THE DEADLINE ASKS TOO, with no date to propose',
  says && says.proposedDue === null && says.disagree === true, JSON.stringify(says))
check('a slip inside the due date that the member says is fine asks nothing',
  proposalFor({ ...slip, newDate: '2026-11-20' }, proj) === null)
check('a finished task asks nothing', proposalFor({ ...slip, done: true }, proj) === null)
check('a task on no project asks nothing', proposalFor({ ...slip, projectKey: null }, proj) === null)

/* ------------------------------------------------------------ fake Jira */

const writes = []
let failNext = false
const fake = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (req.method === 'PUT') {
      if (failNext) {
        failNext = false
        res.writeHead(400, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ errorMessages: ['You do not have permission to edit issues in this project.'] }))
      }
      writes.push({ key: decodeURIComponent(req.url.split('/').pop()), fields: JSON.parse(body || '{}').fields })
      res.writeHead(204)
      return res.end()
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ issues: [] }))
  })
})
await new Promise((r) => fake.listen(5413, r))

/* --------------------------------------------------------------- server */

const mongod = await MongoMemoryServer.create()
const PORT = 5362
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'approvals-service-token-'.padEnd(48, '5')
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let server = null
const start = async (allowWrites) => {
  if (server) {
    server.kill()
    await new Promise((r) => server.once('exit', r))
  }
  server = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGODB_URI: mongod.getUri(),
      MONGODB_DB: 'team_kpi_planning',
      AUTH_SECRET: 'a-test-secret',
      AUTH_ADMIN_EMAILS: 'boss@lotuss.com',
      KPI_SERVICE_TOKEN: TOKEN,
      JIRA_BASE_URL: 'http://127.0.0.1:5413',
      JIRA_EMAIL: 'bot@lotuss.com',
      JIRA_API_TOKEN: 'fake',
      JIRA_SYNC_ENABLED: 'false',
      JIRA_ALLOW_WRITES: allowWrites ? 'true' : '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  server.stderr.on('data', (b) => { if (/Error|error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) return } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 300))
  }
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
  if (email !== 'boss@lotuss.com') await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}
const planNow = async () => (await call('GET', '/api/scenarios/Baseline', undefined, 'service')).body.payload.projects
const projectNow = async (key) => (await planNow()).find((p) => p.key === key)
const pending = async (who) => (await call('GET', '/api/weekly/proposals?status=pending', undefined, who)).body.proposals || []

const task = (over) => ({
  expected: '2026-11-06', effort: 1, priority: 'must', done: false, pct: 50,
  blocker: 'Waiting on AP for sample statements', blockerCategory: 'business', ...over,
})

let browser
try {
  await start(false)
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  const kade = await signUp('kade@lotuss.com')
  await call('PUT', '/api/auth/users/boss@lotuss.com', { person: 'gun' }, boss)
  await call('PUT', '/api/auth/users/james@lotuss.com', { person: 'james' }, boss)
  await call('PUT', '/api/auth/users/kade@lotuss.com', { person: 'kade' }, boss)
  const WEEK = weekOf()
  const before88 = await projectNow('FNP-88')

  console.log('\n--- a report raises proposals ---')
  const jamesWeek = {
    focus: 'AP automation',
    tasks: [
      task({ id: 'tslip88', title: 'Vendor mapping', projectKey: 'FNP-88', newDate: '2026-05-20', affects: false }),
      task({ id: 'tsays4', title: 'Store lease data', projectKey: 'ROW-4', newDate: '2026-09-01', affects: true }),
      task({ id: 'tslip1151', title: 'Asset tagging', projectKey: 'FNP-1151', newDate: '2026-12-15', affects: true }),
      task({ id: 'tdone88', title: 'Already finished', projectKey: 'FNP-88', done: true, pct: 100 }),
      task({ id: 'tnoproj', title: 'Admin', projectKey: null, newDate: '2026-12-31', affects: true }),
    ],
    submit: 'report',
  }
  const rep = await call('PUT', `/api/weekly/${WEEK}/mine`, jamesWeek, james)
  check('the report is in', rep.status === 200, JSON.stringify(rep.body).slice(0, 160))
  let list = await pending(boss)
  check('THREE SLIPS, THREE PROPOSALS — not the finished task, not the one on no project',
    list.length === 3 && list.every((p) => p.person === 'james'), list.map((p) => p.taskTitle).join(', '))
  const p88 = list.find((p) => p.projectKey === 'FNP-88')
  const p4 = list.find((p) => p.projectKey === 'ROW-4')
  const p1151 = list.find((p) => p.projectKey === 'FNP-1151')
  check('  FNP-88 asks for the task’s new date, 20 days late', p88?.proposedDue === '2026-05-20' && p88.byDate === 20)
  check('  and is flagged: the member said it does not move', p88?.disagree === true)
  check('  ROW-4 has no date to propose — the member says it moves, the dates say not', p4 && p4.proposedDue === null)
  check('  each carries who, the blocker and the project', p88?.nick === 'James' && /sample statements/.test(p88.blocker)
    && p88.projectSummary.length > 0 && p88.epicKey === 'FNP-88')

  await call('PUT', `/api/weekly/${WEEK}/mine`, {
    focus: 'x', tasks: [task({ id: 'kdraft', title: 'Draft slip', projectKey: 'FNP-88', newDate: '2026-12-01', affects: true })],
  }, kade)
  check('A DRAFT RAISES NOTHING — nobody approves a half-written report', (await pending(boss)).length === 3)

  console.log('\n--- who sees them ---')
  check('a member sees their own', (await pending(james)).length === 3)
  check('A MEMBER DOES NOT SEE A COLLEAGUE’S', (await pending(kade)).length === 0)
  check('A MEMBER CANNOT APPROVE', (await call('POST', `/api/weekly/proposals/${p88.id}/approve`, {}, james)).status === 403)
  check('  or reject', (await call('POST', `/api/weekly/proposals/${p88.id}/reject`, { reason: 'nope' }, james)).status === 403)
  const kadeStory = (await call('GET', '/api/weekly/projects', undefined, kade)).body.byProject
  const kadeRows = Object.values(kadeStory).flatMap((x) => [...x.history, ...x.blockers, ...x.proposals])
  check('ON THE TIMELINE A MEMBER GETS NONE OF A COLLEAGUE’S WEEKS',
    kadeRows.length > 0 && kadeRows.every((r) => r.person === 'kade') && !JSON.stringify(kadeStory).includes('Vendor mapping'),
    kadeRows.map((r) => r.person).join(','))
  const bossStory = (await call('GET', '/api/weekly/projects', undefined, boss)).body.byProject
  check('an administrator gets the project’s blockers and its waiting proposal',
    bossStory['FNP-88']?.blockers?.[0]?.nick === 'James' && bossStory['FNP-88'].proposals.some((p) => p.status === 'pending'))
  check('  and its week-by-week history, everybody’s',
    bossStory['FNP-88']?.history?.filter((h) => h.person === 'james').length === 2
    && bossStory['FNP-88'].history.some((h) => h.person === 'kade'))
  const wk = (await call('GET', `/api/weekly/${WEEK}`, undefined, james)).body
  check('the week tells the member what became of each task’s date', wk.proposals?.length === 3)

  console.log('\n--- Jira connected, writing switched OFF ---')
  const off = await call('POST', `/api/weekly/proposals/${p88.id}/approve`, {}, boss)
  check('AN EPIC THAT IS IN JIRA IS NOT APPROVED WHILE WRITES ARE OFF — the 07:00 sync would undo it',
    off.status === 409 && /JIRA_ALLOW_WRITES/.test(off.body.error), off.body.error)
  check('  the project has not moved', (await projectNow('FNP-88')).due === '2026-04-30')
  check('  the proposal is still waiting', (await pending(boss)).some((p) => p.id === p88.id))
  check('  and nothing reached Jira', writes.length === 0)

  const noDate = await call('POST', `/api/weekly/proposals/${p4.id}/approve`, {}, boss)
  check('A PROPOSAL WITH NO DATE NEEDS THE APPROVER TO PICK ONE', noDate.status === 400, noDate.body.error)
  const row4before = await projectNow('ROW-4')
  const ok4 = await call('POST', `/api/weekly/proposals/${p4.id}/approve`, { due: '2026-10-15' }, boss)
  const row4 = await projectNow('ROW-4')
  check('A PROJECT WITH NO EPIC IS MOVED HERE, writes or no writes', ok4.status === 200 && row4.due === '2026-10-15', ok4.body.error)
  check('  AS A RE-PLAN: counted, with the original commitment kept',
    row4.replanCount === (row4before.replanCount || 0) + 1 && row4.baselineDue === (row4before.baselineDue || '2026-09-30'),
    JSON.stringify({ n: row4.replanCount, base: row4.baselineDue }))
  check('  the answer carries the fields for the approver’s own browser',
    ok4.body.projects?.[0]?.key === 'ROW-4' && ok4.body.projects[0].due === '2026-10-15')
  check('  and the proposal says who approved it, and from what', ok4.body.proposal?.status === 'approved'
    && ok4.body.proposal.decidedBy === 'boss@lotuss.com' && ok4.body.proposal.fromDue === '2026-09-30')

  console.log('\n--- writing to Jira switched ON ---')
  await start(true)
  failNext = true
  const refused = await call('POST', `/api/weekly/proposals/${p88.id}/approve`, {}, boss)
  check('JIRA REFUSES → NOTHING CHANGES', refused.status === 502 && /permission/.test(refused.body.error), refused.body.error)
  check('  the project has not moved', (await projectNow('FNP-88')).due === '2026-04-30')
  check('  and it is still waiting, to try again', (await pending(boss)).some((p) => p.id === p88.id))

  const ok88 = await call('POST', `/api/weekly/proposals/${p88.id}/approve`, {}, boss)
  const now88 = await projectNow('FNP-88')
  check('APPROVED: THE EPIC’S DUE DATE IS WRITTEN TO JIRA',
    writes.some((w) => w.key === 'FNP-88' && w.fields?.duedate === '2026-05-20'), JSON.stringify(writes))
  check('  and the project moves in the plan', ok88.status === 200 && now88.due === '2026-05-20')
  check('  counted as a re-plan', now88.replanCount === (before88.replanCount || 0) + 1 && now88.baselineDue === '2026-04-30')
  check('  the proposal records the Jira write', ok88.body.proposal?.jira?.written === true && ok88.body.proposal.jira.key === 'FNP-88')
  check('THE SAME PROPOSAL CANNOT BE APPROVED TWICE', (await call('POST', `/api/weekly/proposals/${p88.id}/approve`, {}, boss)).status === 409)

  const ok1151 = await call('POST', `/api/weekly/proposals/${p1151.id}/approve`, { due: '2026-12-20' }, boss)
  const lines = (await planNow()).filter((p) => String(p.jiraKey || '').toUpperCase() === 'FNP-1151')
  check('THE APPROVER MAY CHANGE THE DATE, and every register line on the epic moves together',
    ok1151.status === 200 && lines.length === 3 && lines.every((p) => p.due === '2026-12-20'),
    lines.map((p) => `${p.key}@${p.due}`).join(', '))
  check('  and Jira gets the date the approver chose', writes.some((w) => w.key === 'FNP-1151' && w.fields?.duedate === '2026-12-20'))

  console.log('\n--- a new date reopens it; a rejection needs a reason ---')
  const moved = {
    ...jamesWeek,
    submit: undefined,
    tasks: jamesWeek.tasks.map((t) => (t.id === 'tslip88' ? { ...t, newDate: '2026-06-10' } : t)),
  }
  await call('PUT', `/api/weekly/${WEEK}/mine`, moved, james)
  list = await pending(boss)
  const again = list.find((p) => p.id === p88.id)
  check('A DIFFERENT DATE AFTER APPROVAL IS A NEW QUESTION — back to waiting',
    again?.proposedDue === '2026-06-10' && again.earlier?.[0]?.status === 'approved', JSON.stringify(again?.earlier))
  check('  asked against where the project stands now', again?.projectDueNow === '2026-05-20')
  check('THE SAME DATE AGAIN DOES NOT REOPEN A DECIDED ONE', !list.some((p) => p.id === p1151.id))
  check('a rejection without a reason is refused',
    (await call('POST', `/api/weekly/proposals/${p88.id}/reject`, { reason: '' }, boss)).status === 400)
  const rej = await call('POST', `/api/weekly/proposals/${p88.id}/reject`, { reason: 'Hold the date; I will ask AP today.' }, boss)
  check('a rejection with one goes through', rej.status === 200 && rej.body.proposal.status === 'rejected')
  check('  the project stays where it was', (await projectNow('FNP-88')).due === '2026-05-20')
  const seen = (await call('GET', `/api/weekly/${WEEK}`, undefined, james)).body.proposals.find((p) => p.id === p88.id)
  check('  AND THE MEMBER SEES WHY', seen?.reason === 'Hold the date; I will ask AP today.')

  console.log('\n--- withdrawn, and two approvers at once ---')
  const kadeSlip = { focus: 'x', tasks: [task({ id: 'kslip', title: 'OCR model', projectKey: 'FNP-795', newDate: '2026-12-01', affects: true })] }
  await call('PUT', `/api/weekly/${WEEK}/mine`, { ...kadeSlip, submit: 'report' }, kade)
  check('a second member’s report raises theirs', (await pending(boss)).some((p) => p.person === 'kade'))
  await call('PUT', `/api/weekly/${WEEK}/mine`, { ...kadeSlip, tasks: [{ ...kadeSlip.tasks[0], done: true, pct: 100 }] }, kade)
  check('MARKING IT FINISHED WITHDRAWS IT', !(await pending(boss)).some((p) => p.person === 'kade'))
  await call('PUT', `/api/weekly/${WEEK}/mine`, kadeSlip, kade)
  const kp = (await pending(boss)).find((p) => p.person === 'kade')
  const both = await Promise.all([1, 2].map(() => call('POST', `/api/weekly/proposals/${kp.id}/approve`, {}, boss)))
  check('TWO APPROVALS AT ONCE: EXACTLY ONE GOES THROUGH',
    both.filter((r) => r.status === 200).length === 1, both.map((r) => r.status).join(','))
  check('  and the project was moved once', writes.filter((w) => w.key === 'FNP-795').length === 1)

  /* -------------------------------------------------------------- browser */

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
    // One waiting proposal for the page to show.
    await call('PUT', `/api/weekly/${WEEK}/mine`, {
      ...moved,
      tasks: moved.tasks.map((t) => (t.id === 'tslip1151' ? { ...t, newDate: '2027-01-20' } : t)),
    }, james)
    const waiting = (await pending(boss)).find((p) => p.projectKey === 'FNP-1151')
    check('(set-up) one proposal waiting', !!waiting)

    browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] })
    const as = async (cookie, vp) => {
      const pg = await browser.newPage()
      await pg.setViewport(vp)
      const [n, v] = cookie.split('=')
      await pg.setCookie({ name: n, value: v, url: base })
      return pg
    }

    console.log('\n--- the approver’s page ---')
    const a = await as(boss, { width: 1440, height: 900 })
    await a.goto(`${base}/?go#weekly`, { waitUntil: 'networkidle0' })
    await a.waitForFunction(() => document.body.innerText.includes('Waiting for your decision'), { timeout: 15000 }).catch(() => {})
    const atext = await a.evaluate(() => document.body.innerText)
    await shot(a, 'approvals-panel')
    check('THE DECISION PANEL LISTS WHAT IS WAITING', atext.includes('Waiting for your decision') && atext.includes('Asset tagging'))
    check('  and says Jira will be written', /also writes the new due date to FNP-1151 in Jira/i.test(atext))
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Approve')?.click())
    await a.waitForFunction(() => /is now due/.test(document.body.innerText), { timeout: 10000 }).catch(() => {})
    check('APPROVED FROM THE PAGE: the project moves', (await projectNow('FNP-1151')).due === '2027-01-20')
    check('  and the page says so', /FNP-1151 is now due/.test(await a.evaluate(() => document.body.innerText)))
    check('  and the approver’s own copy of the plan has the new date, so a later save cannot undo it',
      await a.evaluate(() => {
        const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026') || '{}')
        return (st.projects || []).find((p) => p.key === 'FNP-1151')?.due === '2027-01-20'
      }))

    /*
     * The approver's browser holds the moved date as an unsaved change until
     * its automatic save a few seconds later — which then writes the WHOLE
     * plan. That save must carry the approved date, not the old one.
     */
    const savedBy = async () => (await call('GET', '/api/scenarios', undefined, 'service')).body.find((x) => x.name === 'Baseline')
    const afterApproval = await savedBy()
    let resaved = afterApproval
    for (let i = 0; i < 40 && resaved.updatedAt === afterApproval.updatedAt; i++) {
      await new Promise((r) => setTimeout(r, 300))
      resaved = await savedBy()
    }
    check('THE APPROVER’S BROWSER THEN SAVES THE WHOLE PLAN ITSELF', resaved.updatedAt !== afterApproval.updatedAt,
      `${afterApproval.updatedBy} → ${resaved.updatedBy}`)
    check('  AND THAT SAVE KEEPS THE APPROVED DATE — it does not put the old one back',
      (await projectNow('FNP-1151')).due === '2027-01-20')

    console.log('\n--- the Timeline ---')
    // Something waiting again, so there is a forecast to draw.
    await call('PUT', `/api/weekly/${WEEK}/mine`, {
      ...moved,
      tasks: moved.tasks.map((t) => (t.id === 'tslip1151' ? { ...t, newDate: '2027-03-01' } : t)),
    }, james)
    // A different address, so the browser really reloads: the same one with
    // only the #part unchanged is not a navigation at all.
    await a.goto(`${base}/?again=1#weekly`, { waitUntil: 'networkidle0' })
    await a.waitForFunction(() => document.body.innerText.includes('Waiting for your decision'), { timeout: 15000 }).catch(() => {})
    // The task's link, not the side menu's Timeline tab.
    await a.evaluate(() => [...document.querySelectorAll('main button, button')]
      .find((b) => b.textContent.trim() === 'Timeline' && b.getAttribute('role') !== 'tab')?.click())
    await a.waitForSelector('[data-keys~="FNP-1151"]', { timeout: 10000 }).catch(() => {})
    const tl = await a.evaluate(() => {
      const row = document.querySelector('[data-keys~="FNP-1151"]')
      return {
        hash: location.hash,
        lit: row ? getComputedStyle(row).boxShadow.includes('inset') : false,
        waiting: !!row?.querySelector('[aria-label="date change waiting"]'),
        blocked: !!row?.querySelector('[aria-label="blocked"]'),
        forecast: !!row?.querySelector('[aria-label="forecast"]'),
      }
    })
    await shot(a, 'approvals-timeline')
    check('A WEEKLY TASK’S “TIMELINE” LINK OPENS ITS BAR, LIT', tl.hash === '#timeline' && tl.lit, JSON.stringify(tl))
    check('  marked as waiting for a date change, and as blocked', tl.waiting && tl.blocked)
    check('  WITH THE ASKED-FOR DATE DRAWN AS A FORECAST', tl.forecast)
    await a.evaluate(() => document.querySelector('[aria-label="weekly updates for FNP-1151"]')?.click())
    await a.waitForFunction(() => document.body.innerText.includes('Week by week'), { timeout: 5000 }).catch(() => {})
    const story = await a.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '')
    await shot(a, 'approvals-story')
    // Pills are upper-cased on screen, so the words are matched without case.
    check('CLICKING THE PROJECT SHOWS ITS WEEKLY HISTORY', /week by week/i.test(story) && story.includes('Asset tagging')
      && /waiting for approval/i.test(story) && /approved/i.test(story), story.slice(0, 200))

    console.log('\n--- an administrator viewing as a team member ---')
    const asMember = (await call('GET', `/api/weekly/${WEEK}?view=member`, undefined, boss)).body
    check('THE SERVER ANSWERS AN ADMINISTRATOR BY A MEMBER’S RULES WHEN ASKED',
      asMember.team.every((r) => r.entry === undefined && r.standing === undefined) && asMember.mine !== undefined)
    check('  and sends only their own proposals',
      (await call('GET', '/api/weekly/proposals?status=all&view=member', undefined, boss)).body.proposals.every((p) => p.person === 'gun'))
    check('  but what the account may DO is unchanged — it can still decide',
      (await call('POST', '/api/weekly/proposals/nope/reject?view=member', { reason: 'xxx' }, boss)).status === 404)

    await a.evaluate(() => localStorage.removeItem('fa-kpi-view-as'))
    await a.goto(`${base}/?landing=1`, { waitUntil: 'networkidle0' })
    await a.waitForSelector('[role="tab"]', { timeout: 15000 })
    const selected = () => a.evaluate(() => [...document.querySelectorAll('[role="tab"]')]
      .find((t) => t.getAttribute('aria-selected') === 'true')?.textContent.trim())
    check('AN ADMINISTRATOR OPENS THE APP ON THE DASHBOARD', (await selected()) === 'Dashboard', await selected())
    await a.evaluate(() => document.querySelector('input[aria-label="view as a team member"]').click())
    await a.waitForFunction(() => document.body.innerText.includes('Viewing as a team member'), { timeout: 8000 }).catch(() => {})
    const tabsNow = await a.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()))
    check('SWITCHED TO A MEMBER’S VIEW: A MEMBER’S PAGES, AND NO OTHERS',
      JSON.stringify(tabsNow) === JSON.stringify(['Weekly', 'My scorecard', 'Timeline', 'Presentation', 'Apps']), tabsNow.join(' | '))
    check('  landed on their week, since a member has no Dashboard', (await selected()) === 'Weekly')
    await a.waitForFunction(() => document.body.innerText.includes('My week'), { timeout: 10000 }).catch(() => {})
    const asText = await a.evaluate(() => document.body.innerText)
    check('  with no decision panel and no colleague’s blockers', !asText.includes('Waiting for your decision')
      && !asText.includes('Blocker:') && asText.includes('My week'))
    check('  and it says so, with the way back', asText.includes('Viewing as a team member') && asText.includes('Back to administrator'))
    await a.reload({ waitUntil: 'networkidle0' })
    await a.waitForSelector('[role="tab"]', { timeout: 15000 })
    check('  REMEMBERED ACROSS A RELOAD', (await a.evaluate(() => document.querySelectorAll('[role="tab"]').length)) === 5)
    await a.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Back to administrator')?.click())
    await a.waitForFunction(() => document.querySelectorAll('[role="tab"]').length > 5, { timeout: 8000 }).catch(() => {})
    check('“BACK TO ADMINISTRATOR” BRINGS EVERY PAGE BACK', (await a.evaluate(() => document.querySelectorAll('[role="tab"]').length)) === 10)

    console.log('\n--- the member, on a phone ---')
    const m = await as(james, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await m.goto(`${base}/?go#weekly`, { waitUntil: 'networkidle0' })
    await m.waitForFunction(() => document.body.innerText.includes('My week'), { timeout: 15000 })
    const mtext = await m.evaluate(() => document.body.innerText)
    await m.evaluate(() => [...document.querySelectorAll('span')].find((x) => /^rejected$/i.test(x.textContent))?.scrollIntoView({ block: 'center' }))
    await shot(m, 'approvals-phone')
    check('THE MEMBER SEES THE REJECTION AND ITS REASON ON THE TASK', /rejected/i.test(mtext) && mtext.includes('I will ask AP today'))
    check('  and the approval on the other', /approved/i.test(mtext) && /moved from/.test(mtext))
    check('  and no decision panel — that is the approver’s', !mtext.includes('Waiting for your decision'))
    const wide = await m.evaluate(() => document.documentElement.scrollWidth)
    check('NOTHING SPILLS SIDEWAYS AT 390px', wide <= 390, `scrollWidth ${wide}`)
  }
} catch (e) {
  failures++
  console.log(`FAIL  the suite crashed — ${e.stack}`)
} finally {
  if (browser) await browser.close()
  if (server) server.kill()
  fake.close()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall approval checks passed')
process.exit(failures ? 1 : 0)
