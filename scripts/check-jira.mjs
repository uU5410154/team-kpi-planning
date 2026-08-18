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

const CHILDREN = {
  'FNP-1': [
    {
      key: 'FNP-11',
      fields: {
        summary: 'Task that finished late',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        issuetype: { name: 'Task' },
        parent: { key: 'FNP-1' },
        created: '2026-01-06T09:00:00.000+0700',
        updated: '2026-03-20T09:00:00.000+0700',
        duedate: '2026-02-01',
        resolutiondate: '2026-03-15T09:00:00.000+0700',
        customfield_10015: '2026-01-08',
      },
    },
    {
      key: 'FNP-13',
      fields: {
        summary: 'Task that finished early',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        issuetype: { name: 'Task' },
        parent: { key: 'FNP-1' },
        created: '2026-01-06T09:00:00.000+0700',
        updated: '2026-02-10T09:00:00.000+0700',
        duedate: '2026-03-01',
        resolutiondate: '2026-02-10T09:00:00.000+0700',
        customfield_10015: '2026-01-08',
      },
    },
    {
      key: 'FNP-14',
      fields: {
        summary: 'Task that finished on the day',
        status: { name: 'Done', statusCategory: { key: 'done' } },
        issuetype: { name: 'Task' },
        parent: { key: 'FNP-1' },
        created: '2026-01-06T09:00:00.000+0700',
        updated: '2026-04-01T09:00:00.000+0700',
        duedate: '2026-04-01',
        resolutiondate: '2026-04-01T09:00:00.000+0700',
        customfield_10015: '2026-01-08',
      },
    },
    {
      key: 'FNP-12',
      fields: {
        summary: 'Task with no due date of its own',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Story' },
        parent: { key: 'FNP-1' },
        created: '2026-01-06T09:00:00.000+0700',
        updated: '2026-05-06T09:00:00.000+0700',
        duedate: null,
        resolutiondate: null,
        customfield_10015: '2026-01-20',
      },
    },
  ],
}

const writes = []
const fake = createServer((req, res) => {
  seenAuth.push(req.headers.authorization || '')
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    // A write: Jira answers 204 and the ticket changes.
    if (req.method === 'PUT') {
      const sent = JSON.parse(body || '{}')
      writes.push({ url: req.url, fields: sent.fields })
      const key = decodeURIComponent(req.url.split('/').pop())
      if (ISSUES[key] && sent.fields) {
        if ('duedate' in sent.fields) ISSUES[key].fields.duedate = sent.fields.duedate
        if ('customfield_10015' in sent.fields) ISSUES[key].fields.customfield_10015 = sent.fields.customfield_10015
      }
      res.writeHead(204)
      return res.end()
    }
    const parsed = body ? JSON.parse(body) : {}
    askedFor.push(parsed.jql || '')
    const jql = String(parsed.jql || '')
    const keys = jql.replace(/.*\(|\).*/g, '').split(',').map((k) => k.trim())
    const issues = /issuetype = /.test(jql)
      ? Object.entries(ISSUES).map(([k, v]) => ({ ...v, key: k }))
      : /^parent IN/.test(jql)
        ? Object.values(CHILDREN).flat().filter((c) => keys.includes(c.fields.parent.key))
        : keys.map((k) => ISSUES[k]).filter(Boolean)
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

/* ---------------- the breakdown ---------------- */
console.log(String.fromCharCode(10) + '--- an epic breaks down into its tasks ---')
{
  const kids = await (await fetch(`${base}/api/jira/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-1', 'FNP-2'] }),
  })).json()
  check('children come back under the parent that owns them',
    kids.byParent['FNP-1'].length === 4 && kids.byParent['FNP-2'].length === 0,
    JSON.stringify(Object.fromEntries(Object.entries(kids.byParent).map(([k, v]) => [k, v.length]))))
  const child = kids.byParent['FNP-1'].find((c) => c.key === 'FNP-11')
  check('a task carries its own dates', child.due === '2026-02-01' && child.resolved === '2026-03-15',
    `${child.due} planned, ${child.resolved} actual`)
  check('  and its issue type, so a Story reads as a Story', child.type === 'Task',
    kids.byParent['FNP-1'].map((c) => `${c.key}:${c.type}`).join(', '))
  check('AND THE TOKEN IS STILL NOT IN THE ANSWER', !JSON.stringify(kids).includes(TOKEN))

  const bad = await fetch(`${base}/api/jira/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: Array.from({ length: 60 }, (_, i) => `FNP-${i}`) }),
  })
  check('and too many parents at once is refused', bad.status === 400)
}

/* ---------------- epics the register has never seen ---------------- */
console.log(String.fromCharCode(10) + '--- new epics can be found and brought in ---')
{
  const r = await (await fetch(`${base}/api/jira/epics`)).json()
  check('every epic in the project comes back', r.epics.length === 3,
    r.epics.map((e) => e.key).join(', '))
  check('  under a query the CLIENT never supplied',
    /project = FNP AND issuetype = "Epic"/.test(r.jql), r.jql)
  check('  and the token is still not in it', !JSON.stringify(r).includes(TOKEN))

  // A window can be asked for, and it has to arrive as a number.
  const windowed = await (await fetch(`${base}/api/jira/epics?since=30`)).json()
  check('a since window becomes a bounded clause', /created >= -30d/.test(windowed.jql), windowed.jql)
  const nasty = await (await fetch(`${base}/api/jira/epics?since=${encodeURIComponent('1d OR project = SECRET')}`)).json()
  check('AND A WINDOW THAT IS NOT A NUMBER IS DROPPED, NOT PASSED THROUGH',
    !/SECRET/.test(nasty.jql), nasty.jql)
}

/* ---------------- writing the plan back ---------------- */
console.log(String.fromCharCode(10) + '--- the plan can be pushed to Jira, and only the plan ---')
{
  // Off by default, however configured Jira is: this edits real tickets.
  const off = await fetch(`${base}/api/jira/issue/FNP-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due: '2026-06-01' }),
  })
  check('WRITING IS REFUSED UNTIL IT IS SWITCHED ON',
    off.status === 403 && /JIRA_ALLOW_WRITES/.test((await off.json()).error),
    'a token with write access is not the same as permission to use it')
  check('  and nothing reached Jira', writes.length === 0, JSON.stringify(writes))
}

const PORT3 = 5414
const writable = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT3),
    MONGODB_URI: '',
    JIRA_BASE_URL: 'http://127.0.0.1:5411',
    JIRA_EMAIL: EMAIL,
    JIRA_API_TOKEN: TOKEN,
    JIRA_ALLOW_WRITES: 'true',
  },
  stdio: 'ignore',
})
const wbase = `http://127.0.0.1:${PORT3}`
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${wbase}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break
  } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 400))
}
{
  const st3 = await (await fetch(`${wbase}/api/jira/status`)).json()
  check('with it on, the server says it can write', st3.writable === true)

  const ok = await fetch(`${wbase}/api/jira/issue/FNP-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start: '2026-01-20', due: '2026-06-01' }),
  })
  const okBody = await ok.json()
  check('BOTH PLANNED DATES REACH THE TICKET', ok.status === 200
    && writes.some((w) => w.fields.duedate === '2026-06-01' && w.fields.customfield_10015 === '2026-01-20'),
    JSON.stringify(okBody))

  // The whitelist: anything else in the body is dropped, not forwarded.
  await fetch(`${wbase}/api/jira/issue/FNP-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      due: '2026-07-01', summary: 'hacked', status: 'Done', assignee: 'somebody', resolutiondate: '2026-01-01',
    }),
  })
  const last = writes[writes.length - 1]
  check('NOTHING BUT DATES IS EVER FORWARDED',
    Object.keys(last.fields).every((f) => ['duedate', 'customfield_10015'].includes(f)),
    JSON.stringify(last.fields))

  const bad = await fetch(`${wbase}/api/jira/issue/FNP-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due: 'next Tuesday' }),
  })
  check('a date that is not a date is refused before it is sent', bad.status === 400)

  const clear = await fetch(`${wbase}/api/jira/issue/FNP-1`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ due: null }),
  })
  check('and null clears a date rather than meaning "leave it"',
    clear.status === 200 && writes[writes.length - 1].fields.duedate === null)

  // Read it back: the cache must not serve what Jira no longer holds.
  const after = await (await fetch(`${wbase}/api/jira/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-1'] }),
  })).json()
  check('A WRITE INVALIDATES THE CACHED COPY',
    after.issues[0].start === '2026-01-20' && after.issues[0].due === null,
    JSON.stringify({ start: after.issues[0].start, due: after.issues[0].due }))
}
writable.kill()

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
    // The whole row, so what comes back can be compared field by field.
    return st.projects.slice(0, 3).map((p) => JSON.parse(JSON.stringify(p)))
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

  /*
   * And nothing else moved either.
   *
   * A sync exists to record when things happened. Saving hours, mandays,
   * cost, objective, commit level, owner — none of that is Jira's to have an
   * opinion about, and a sync that quietly restated any of it would rewrite
   * the KPI the register exists to report. Compared field by field rather
   * than by spot-check, so a field added later is covered without anybody
   * remembering to add it here.
   */
  const full = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fa-tech-kpi-2026')).projects.slice(0, 3))
  const drifted = []
  full.forEach((now, i) => {
    const was = before[i]
    for (const field of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (field === 'actualStart' || field === 'actualEnd') continue
      if (JSON.stringify(was[field]) !== JSON.stringify(now[field])) {
        drifted.push(`${was.jiraKey}.${field}: ${JSON.stringify(was[field])} -> ${JSON.stringify(now[field])}`)
      }
    }
  })
  check('A SYNC TOUCHES THE ACTUAL DATES AND NOTHING ELSE', drifted.length === 0,
    drifted.join(' | ') || `${Object.keys(before[0]).length} fields per project, all unchanged but the two`)
  check('  the saving hours in particular are Jira’s business to nobody',
    full.every((now, i) => now.savingHours === before[i].savingHours),
    full.map((p, i) => `${p.jiraKey} ${before[i].savingHours} -> ${p.savingHours}`).join(' | '))
  check('it says what it did, including where a start came from',
    /taken from when the ticket was raised/.test(after.note), after.note)

  // ---- the breakdown, on screen ----
  const rowsBefore = await page.evaluate(() =>
    document.querySelectorAll('[aria-label^="expand"], [aria-label^="collapse"]').length)
  check('every keyed row offers a breakdown', rowsBefore >= 3, `${rowsBefore} expandable rows`)

  await page.evaluate(() => {
    document.querySelector('[aria-label="expand FNP-1"]').click()
  })
  await new Promise((r) => setTimeout(r, 2500))
  const opened = await page.evaluate(() => ({
    text: document.body.innerText,
    collapsible: !!document.querySelector('[aria-label="collapse FNP-1"]'),
  }))
  check('EXPANDING AN EPIC SHOWS ITS TASKS',
    /Task that finished late/.test(opened.text) && /Task with no due date of its own/.test(opened.text),
    opened.collapsible ? 'row is now collapsible' : 'row did not open')
  check('  and each task says what it is',
    /FNP-11 · Task/.test(opened.text) && /FNP-12 · Story/.test(opened.text),
    (opened.text.match(new RegExp('FNP-1[12][^' + String.fromCharCode(10) + ']*', 'g')) || []).join(' | '))
  check('  and a late task carries its own slip',
    /\+42d/.test(opened.text), 'FNP-11 was due 2026-02-01 and finished 2026-03-15')

  // ---- both bars start on the same day ----
  const aligned = await page.evaluate(() => {
    // sx compiles to a class, so there is no inline style to read — the
    // rendered geometry is the thing being asserted anyway.
    const rows = [...document.querySelectorAll('div')]
      .filter((d) => (d.innerText || '').includes('FNP-1 ·') && d.querySelectorAll('div').length < 40)
    const row = rows[rows.length - 1]
    const track = row && [...row.parentElement.parentElement.children]
      .find((c) => getComputedStyle(c).position === 'relative' && c.children.length > 2)
    if (!track) return null
    return [...track.children]
      .filter((c) => getComputedStyle(c).position === 'absolute' && c.getBoundingClientRect().width > 1)
      .map((c) => ({
        left: Math.round(c.getBoundingClientRect().left * 10) / 10,
        width: Math.round(c.getBoundingClientRect().width * 10) / 10,
        filled: getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)',
        hatched: getComputedStyle(c).backgroundImage !== 'none',
      }))
      .filter((b) => b.width > 2)
  })
  const plannedBar = aligned?.find((b) => !b.filled)
  const actualBar = aligned?.find((b) => b.filled)
  check('THE ACTUAL BAR STARTS ON THE PLANNED START',
    plannedBar && actualBar && Math.abs(plannedBar.left - actualBar.left) < 0.01,
    aligned ? `planned at ${plannedBar?.left}%, actual at ${actualBar?.left}%` : 'no bars found')
  check('  and the real start is still recorded, not lost',
    await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
      const p = st.projects.find((x) => x.jiraKey === 'FNP-1')
      return p.actualStart === '2026-01-10' && p.start === '2026-01-01'
    }),
    'drawn from the plan, held as it happened')

  // ---- a task with no planned start still draws a pair ----
  const taskBars = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div')]
      .filter((d) => (d.innerText || '').includes('FNP-11 ·') && d.querySelectorAll('div').length < 40)
    const row = rows[rows.length - 1]
    const track = row && [...row.parentElement.parentElement.children]
      .find((c) => getComputedStyle(c).position === 'relative' && c.children.length > 2)
    if (!track) return null
    return [...track.children]
      .filter((c) => getComputedStyle(c).position === 'absolute' && c.getBoundingClientRect().width > 2)
      .map((c) => ({
        left: Math.round(c.getBoundingClientRect().left * 10) / 10,
        width: Math.round(c.getBoundingClientRect().width * 10) / 10,
        filled: getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)',
        hatched: getComputedStyle(c).backgroundImage !== 'none',
      }))
  })
  const tPlanned = taskBars?.find((b) => !b.filled && !b.hatched)
  const tActual = taskBars?.find((b) => b.filled && !b.hatched)
  check('A TASK DRAWS TWO BARS, NOT A DOT AND A BAR',
    tPlanned && tActual && tPlanned.width > 5 && tActual.width > 5,
    taskBars ? `planned ${tPlanned?.width}px, actual ${tActual?.width}px` : 'no bars found')
  check('  starting on the same day, so only the finish differs',
    tPlanned && tActual && Math.abs(tPlanned.left - tActual.left) < 0.01,
    `planned at ${tPlanned?.left}, actual at ${tActual?.left}`)
  check('  and the overrun is drawn beyond the planned edge',
    taskBars.some((b) => b.hatched && b.left >= tPlanned.left + tPlanned.width - 1),
    `${taskBars.filter((b) => b.hatched).length} hatched segment(s)`)

  // ---- a task with NO due date still gets something to read against ----
  const borrowed = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div')]
      .filter((d) => (d.innerText || '').includes('FNP-12 ·') && d.querySelectorAll('div').length < 40)
    const row = rows[rows.length - 1]
    const track = row && [...row.parentElement.parentElement.children]
      .find((c) => getComputedStyle(c).position === 'relative' && c.children.length > 2)
    if (!track) return null
    const bars = [...track.children]
      .filter((c) => getComputedStyle(c).position === 'absolute' && c.getBoundingClientRect().width > 2)
      .map((c) => ({
        left: Math.round(c.getBoundingClientRect().left * 10) / 10,
        width: Math.round(c.getBoundingClientRect().width * 10) / 10,
        filled: getComputedStyle(c).backgroundColor !== 'rgba(0, 0, 0, 0)',
        dashed: getComputedStyle(c).borderTopStyle === 'dashed',
      }))
    const chip = row.parentElement.parentElement.querySelector('.MuiChip-root')
    return { bars, chip: chip ? chip.innerText.trim() : null }
  })
  const dashed = borrowed?.bars.find((b) => b.dashed)
  const solid = borrowed?.bars.find((b) => b.filled)
  check('A TASK WITH NO DUE DATE STILL SHOWS A PAIR',
    !!dashed && !!solid && dashed.width > 5 && solid.width > 5,
    borrowed ? `dashed ${dashed?.width}px, solid ${solid?.width}px` : 'no bars found')
  check('  the borrowed line is DASHED, not drawn as its own plan', dashed?.dashed === true)
  check('  and no slip is claimed against a date it never had',
    borrowed?.chip == null || borrowed.chip === '' || borrowed.chip === '—',
    `chip reads ${JSON.stringify(borrowed?.chip)}`)
  check('  the legend explains the dashed line',
    /borrowed/.test(await page.evaluate(() => document.body.innerText)))

  // ---- a task is the bottom of the chart ----
  const leaves = await page.evaluate(() => ({
    epicOpens: !!document.querySelector('[aria-label="collapse FNP-1"]'),
    taskOffersToOpen: !!document.querySelector('[aria-label="expand FNP-11"]')
      || !!document.querySelector('[aria-label="expand FNP-12"]'),
  }))
  check('A STORY OR TASK OFFERS NO FURTHER BREAKDOWN', leaves.taskOffersToOpen === false,
    'sub-tasks are not what a portfolio timeline is read for')
  check('  while the epic above it still opens', leaves.epicOpens === true)

  // ---- the three finishes read differently ----
  const finishes = await page.evaluate(() => {
    const out = {}
    for (const key of ['FNP-11', 'FNP-13', 'FNP-14']) {
      const row = [...document.querySelectorAll('div')].find((d) => {
        const t = d.innerText || ''
        return t.startsWith(key + ' ·') || (d.previousElementSibling && false)
      })
      void row
    }
    // Read the slip chips instead: they carry the same colour as their bar.
    const chips = [...document.querySelectorAll('.MuiChip-root')].map((c) => ({
      label: c.innerText.trim(),
      colour: getComputedStyle(c).color,
    }))
    out.chips = chips
    out.text = document.body.innerText
    return out
  })
  const chipFor = (label) => finishes.chips.find((c) => c.label === label)
  check('A LATE FINISH, AN EARLY ONE AND AN ON-TIME ONE ARE ALL SHOWN',
    !!chipFor('+42d') && !!chipFor('-19d') && !!chipFor('0d'),
    finishes.chips.map((c) => c.label).join(' | '))
  check('  and they are three different colours, not two',
    new Set([chipFor('+42d')?.colour, chipFor('-19d')?.colour, chipFor('0d')?.colour]).size === 3,
    [chipFor('+42d')?.colour, chipFor('-19d')?.colour, chipFor('0d')?.colour].join(' | '))
  check('  the legend names all three outcomes',
    /ahead of schedule/.test(finishes.text) && /on schedule/.test(finishes.text)
    && /behind schedule/.test(finishes.text))

  await page.evaluate(() => {
    document.querySelector('[aria-label="collapse FNP-1"]').click()
  })
  await new Promise((r) => setTimeout(r, 700))
  const closed = await page.evaluate(() => document.body.innerText)
  check('  and it closes again', !/Task that finished late/.test(closed))

  // ---- epics the register has never seen ----
  const beforeCount = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('fa-tech-kpi-2026')).projects.length)
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Find new epics/.test(b.innerText)).click()
  })
  await new Promise((r) => setTimeout(r, 2500))
  const dialog = await page.evaluate(() => ({
    open: !!document.querySelector('[role="dialog"]'),
    text: document.querySelector('[role="dialog"]')?.innerText || '',
    rows: document.querySelectorAll('[role="dialog"] li').length,
  }))
  // FNP-1..3 are on projects already, so nothing should be offered.
  check('AN EPIC ALREADY ON THE REGISTER IS NOT OFFERED AGAIN',
    dialog.open === false && /Nothing new/.test(await page.evaluate(() => document.body.innerText)),
    dialog.open ? `${dialog.rows} offered: ${dialog.text.slice(0, 120)}` : 'nothing offered')

  // Take one off the register and it becomes findable again.
  await page.evaluate(() => {
    const K = 'fa-tech-kpi-2026'
    const st = JSON.parse(localStorage.getItem(K))
    st.projects = st.projects.map((p) => (p.jiraKey === 'FNP-3' ? { ...p, jiraKey: '' } : p))
    localStorage.setItem(K, JSON.stringify(st))
  })
  await page.goto(`${base}/?found=1#timeline`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3000))
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Find new epics/.test(b.innerText)).click()
  })
  await new Promise((r) => setTimeout(r, 2500))
  const offered = await page.evaluate(() => ({
    open: !!document.querySelector('[role="dialog"]'),
    text: document.querySelector('[role="dialog"]')?.innerText || '',
    rows: document.querySelectorAll('[role="dialog"] li').length,
  }))
  check('AND ONE THE REGISTER LACKS IS FOUND', offered.open && offered.rows === 1,
    offered.text.split(String.fromCharCode(10)).slice(0, 3).join(' / '))
  check('  it says what it will do with it',
    /Watch/.test(offered.text) && /committed total/.test(offered.text))

  await page.evaluate(() => {
    [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Add 1 to the register/.test(b.innerText)).click()
  })
  await new Promise((r) => setTimeout(r, 1500))
  const added = await page.evaluate((was) => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    const row = st.projects.find((p) => p.jiraKey === 'FNP-3')
    return {
      grew: st.projects.length - was,
      row: row && {
        summary: row.summary,
        commitLevel: row.commitLevel,
        savingHours: row.savingHours,
        manday: row.manday,
        start: row.start,
        due: row.due,
        atTop: st.projects[0].jiraKey === 'FNP-3',
      },
    }
  }, beforeCount)
  check('IT IS ADDED TO THE REGISTER', added.grew === 1 && !!added.row, JSON.stringify(added))
  check('  as WATCH, carrying no hours and no effort',
    added.row.commitLevel === 'watch' && added.row.savingHours == null && !(added.row.manday > 0),
    `${added.row.commitLevel}, hours ${added.row.savingHours}, mandays ${added.row.manday}`)
  check('  with Jira’s dates as its plan, this once',
    added.row.start === '2026-01-02' && added.row.due === '2026-05-01',
    `${added.row.start} to ${added.row.due}`)
  check('  and at the top, where a new row belongs', added.row.atTop === true)

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
