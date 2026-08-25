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
  'FNP-4': {
    key: 'FNP-4',
    fields: {
      summary: 'Selected for development, untouched',
      status: { name: 'Selected for Development', statusCategory: { key: 'new' } },
      created: '2026-05-24T09:00:00.000+0700',
      updated: '2026-08-18T09:00:00.000+0700',
      duedate: '2026-10-31',
      resolutiondate: null,
      customfield_10015: '2026-08-16',
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

/*
 * The start dates as the fixture began, snapshotted here because the write-back
 * test later moves one of them — and the browser sync reads a DIFFERENT server
 * process with its own cache, so what it sees is the original. Comparing
 * against the mutated fixture would be comparing against something the code
 * under test never saw.
 */
const START_AT_FIRST = Object.fromEntries(
  Object.entries(ISSUES).map(([k, v]) => [k, v.fields.customfield_10015 || null]),
)

const CHILDREN = {
  // Nothing here has begun: a plan, not work in progress.
  'FNP-4': [
    {
      key: 'FNP-41',
      fields: {
        summary: 'Planned, not started',
        status: { name: 'Backlog', statusCategory: { key: 'new' } },
        issuetype: { name: 'Task' },
        parent: { key: 'FNP-4' },
        created: '2026-08-18T09:00:00.000+0700',
        updated: '2026-08-18T09:00:00.000+0700',
        duedate: '2026-09-05',
        resolutiondate: null,
        // A start date three weeks out. A plan, not an event.
        customfield_10015: '2026-08-24',
      },
    },
  ],
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
        // Carried across two sprints: the window is the first start to the
        // last end, which is what a carry-over actually means.
        customfield_10020: [
          { id: 1, name: 'Sprint 1', startDate: '2026-01-05T00:00:00.000Z', endDate: '2026-01-18T23:59:59.000Z' },
          { id: 2, name: 'Sprint 2', startDate: '2026-01-19T00:00:00.000Z', endDate: '2026-02-01T23:59:59.000Z' },
        ],
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
      key: 'FNP-16',
      fields: {
        summary: 'Blocked: data team delayed',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Task' },
        parent: { key: 'FNP-1' },
        created: '2026-02-01T09:00:00.000+0700',
        updated: '2026-02-01T09:00:00.000+0700',
        duedate: '2026-09-30',
        resolutiondate: null,
        customfield_10015: null,
        // Mixed case on purpose: a label is a label however it was typed.
        labels: ['blocked', 'IT-Delay'],
      },
    },
    {
      key: 'FNP-17',
      fields: {
        summary: 'Overran on its own, nobody else to blame',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Task' },
        parent: { key: 'FNP-1' },
        created: '2026-02-01T09:00:00.000+0700',
        updated: '2026-02-01T09:00:00.000+0700',
        duedate: '2026-12-31',
        resolutiondate: null,
        customfield_10015: null,
        labels: ['spillover'],
      },
    },
    {
      key: 'FNP-18',
      fields: {
        summary: 'No dates, no sprint, nothing at all',
        status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
        issuetype: { name: 'Task' },
        parent: { key: 'FNP-1' },
        created: '2026-01-06T09:00:00.000+0700',
        updated: '2026-05-06T09:00:00.000+0700',
        duedate: null,
        resolutiondate: null,
        customfield_10015: '2026-01-20',
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
        customfield_10020: [
          { id: 3, name: 'Sprint 9 Week 2', startDate: '2026-08-16T00:00:00.000Z', endDate: '2026-08-22T23:59:59.000Z' },
        ],
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
    let issues = /issuetype = /.test(jql)
      ? Object.entries(ISSUES).map(([k, v]) => ({ ...v, key: k }))
      : /^parent IN/.test(jql)
        ? Object.values(CHILDREN).flat().filter((c) => keys.includes(c.fields.parent.key))
        : keys.map((k) => ISSUES[k]).filter(Boolean)
    /*
     * Rank is a deliberate scramble here: neither key order nor date order, so
     * a client that quietly sorts by either is caught rather than passing by
     * coincidence.
     */
    if (/ORDER BY Rank ASC/.test(jql)) {
      const rank = ['FNP-14', 'FNP-12', 'FNP-11', 'FNP-13', 'FNP-16', 'FNP-17', 'FNP-18']
      issues = [...issues].sort((a, b) => rank.indexOf(a.key) - rank.indexOf(b.key))
    }
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
    kids.byParent['FNP-1'].length === 7 && kids.byParent['FNP-2'].length === 0,
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
  check('every epic in the project comes back', r.epics.length === 4,
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

/* ---------------- renamed, added, deleted ---------------- */
console.log(String.fromCharCode(10) + '--- a board that changes shape ---')
{
  const { mergeJira } = await import('../src/lib/jiraMerge.js')
  const plan = {
    projects: [
      {
        key: 'P-1',
        jiraKey: 'FNP-1',
        summary: 'The name it had last week',
        savingHours: 120,
        manday: 8,
        commitLevel: 'commit',
        actualStart: null,
        actualEnd: null,
      },
      { key: 'P-2', jiraKey: 'FNP-GONE-99', summary: 'Ticket somebody deleted', savingHours: 40, commitLevel: 'commit' },
    ],
  }
  const issues = [{
    key: 'FNP-1',
    summary: 'The name it has today',
    status: 'Done',
    done: true,
    created: '2026-01-05',
    start: '2026-01-10',
    resolved: '2026-04-01',
    startSource: 'start-date',
  }]

  const r = mergeJira(plan, { issues, epics: [] }, { addNew: false })
  const one = r.projects.find((x) => x.jiraKey === 'FNP-1')
  check('AN EPIC RENAMED IN JIRA IS RENAMED HERE', one.summary === 'The name it has today', one.summary)
  check('  and the rename is reported, not silent',
    r.renamed === 1 && r.renames[0].from === 'The name it had last week',
    JSON.stringify(r.renames))
  check('  while its hours, effort and commit level are untouched',
    one.savingHours === 120 && one.manday === 8 && one.commitLevel === 'commit',
    'a name is Jira’s; a KPI is not')

  const gone = r.projects.find((x) => x.key === 'P-2')
  check('A TICKET DELETED IN JIRA DOES NOT DELETE THE ROW',
    !!gone && gone.savingHours === 40,
    'the row carries hours and a place in a KPI that never lived in Jira')

  // Adding is the epic import, already proven above; assert it here too so the
  // three verbs are checked in one place.
  const added = mergeJira(plan, {
    issues: [],
    epics: [{ key: 'FNP-NEW-1', summary: 'Raised this morning', status: 'Backlog', created: '2026-08-19' }],
  }, { addNew: true })
  check('AN EPIC ADDED IN JIRA APPEARS HERE', added.addedKeys.includes('FNP-NEW-1'), JSON.stringify(added.addedKeys))

  // And renaming back is just another rename: nothing sticks.
  const backAgain = mergeJira({ projects: r.projects },
    { issues: [{ ...issues[0], summary: 'The name it had last week' }], epics: [] }, { addNew: false })
  check('  a name changed back changes back', backAgain.renamed === 1
    && backAgain.projects.find((x) => x.jiraKey === 'FNP-1').summary === 'The name it had last week')

  // Only three fields may ever move.
  // What a sync owns: the ticket's own facts, and the start it maintains.
  const allowed = new Set(['summary', 'start', 'actualStart', 'actualEnd'])
  const moved = new Set()
  plan.projects.forEach((was) => {
    const now = r.projects.find((x) => x.key === was.key)
    for (const f of new Set([...Object.keys(was), ...Object.keys(now)])) {
      if (JSON.stringify(was[f]) !== JSON.stringify(now[f])) moved.add(f)
    }
  })
  check('AND NOTHING ELSE MOVES', [...moved].every((f) => allowed.has(f)),
    [...moved].join(', ') || 'nothing moved at all')
}

/* ---------------- tasks follow their board too ---------------- */
console.log(String.fromCharCode(10) + '--- a task renamed, added or deleted in Jira ---')
{
  // The fixture is shared with the checks below, so it is put back exactly as
  // it was afterwards — a test that leaves the world different is a test that
  // breaks the next one for reasons that have nothing to do with the code.
  const original = JSON.parse(JSON.stringify(CHILDREN['FNP-1']))

  const before = await (await fetch(`${base}/api/jira/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-1'] }),
  })).json()
  const wasCount = before.byParent['FNP-1'].length

  // rename one, delete one, add one — in the stand-in Jira itself
  CHILDREN['FNP-1'][0].fields.summary = 'Renamed in Jira just now'
  const deleted = CHILDREN['FNP-1'].pop()
  CHILDREN['FNP-1'].push({
    key: 'FNP-15',
    fields: {
      summary: 'Created in Jira just now',
      status: { name: 'Backlog', statusCategory: { key: 'new' } },
      issuetype: { name: 'Task' },
      parent: { key: 'FNP-1' },
      created: '2026-08-19T09:00:00.000+0700',
      updated: '2026-08-19T09:00:00.000+0700',
      duedate: null,
      resolutiondate: null,
      customfield_10015: null,
    },
  })

  const after = await (await fetch(`${base}/api/jira/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-1'] }),
  })).json()
  const rows = after.byParent['FNP-1']
  check('A TASK RENAMED IN JIRA READS ITS NEW NAME',
    rows.some((c) => c.summary === 'Renamed in Jira just now'))
  check('A TASK ADDED IN JIRA APPEARS', rows.some((c) => c.key === 'FNP-15'))
  check('A TASK DELETED IN JIRA DISAPPEARS', !rows.some((c) => c.key === deleted.key),
    `${wasCount} before, ${rows.length} after`)
  check('  because tasks are never stored, only read',
    rows.length === wasCount, 'one out, one in')

  CHILDREN['FNP-1'] = original
}

/* ---------------- the order Jira shows ---------------- */
console.log(String.fromCharCode(10) + '--- children come back in the order Jira lists them ---')
{
  const kids = await (await fetch(`${base}/api/jira/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-1'] }),
  })).json()
  const order = kids.byParent['FNP-1'].map((c) => c.key)
  check('IT ASKS JIRA FOR RANK ORDER, WHICH IS THE BOARD ORDER',
    kids.ordering === 'Rank ASC' && askedFor.some((j) => /ORDER BY Rank ASC/.test(j)),
    `ordering: ${kids.ordering}`)
  check('AND HANDS BACK EXACTLY THAT ORDER',
    JSON.stringify(order)
      === JSON.stringify(['FNP-14', 'FNP-12', 'FNP-11', 'FNP-13', 'FNP-16', 'FNP-17', 'FNP-18']),
    order.join(', '))
  check('  which is neither key order nor date order',
    order.join() !== [...order].sort().join(), 'a sort by anything else would have shown here')
}

/* ---------------- nothing has started until something is in flight ------- */
console.log(String.fromCharCode(10) + '--- a plan is not work in progress ---')
{
  const { mergeJira } = await import('../src/lib/jiraMerge.js')

  const r = await (await fetch(`${base}/api/jira/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-4'] }),
  })).json()
  const epic = r.issues[0]
  check('AN EPIC IN THE BACKLOG HAS NOT STARTED, WHATEVER DATE IT CARRIES',
    epic.started === false && epic.start === '2026-08-16',
    `status ${epic.status}, start date ${epic.start}`)

  const kids = await (await fetch(`${base}/api/jira/rollup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-4', 'FNP-1'] }),
  })).json()
  check('  nor has anything under it', kids.byParent['FNP-4'].anyStarted === false,
    `${kids.byParent['FNP-4'].started} of ${kids.byParent['FNP-4'].total} started`)
  check('  while a project with work in flight HAS', kids.byParent['FNP-1'].anyStarted === true,
    `${kids.byParent['FNP-1'].started} of ${kids.byParent['FNP-1'].total} started`)

  const merged = mergeJira(
    { projects: [{ key: 'P4', jiraKey: 'FNP-4', due: '2026-10-31' }] },
    { issues: [epic], rollups: { 'FNP-4': kids.byParent['FNP-4'] } },
    { addNew: false },
  ).projects[0]
  check('SO NO ACTUAL BAR IS DRAWN FOR IT', merged.actualStart == null && merged.actualEnd == null,
    'a start date three weeks out is a plan, not an event')

  // And a task that has begun still gets one.
  const started = mergeJira(
    { projects: [{ key: 'P1', jiraKey: 'FNP-2', due: '2026-10-31' }] },
    {
      issues: [{
        key: 'FNP-2', summary: 'x', status: 'In Progress', started: true, done: false,
        created: '2026-02-01', start: '2026-02-01', resolved: null,
      }],
      rollups: {},
    },
    { addNew: false },
  ).projects[0]
  check('  while work actually in flight still gets its bar', started.actualStart === '2026-02-01')
}

/* ---------------- the sprint is the plan ---------------- */
console.log(String.fromCharCode(10) + '--- a task is scheduled by its sprint ---')
{
  const kids = await (await fetch(`${base}/api/jira/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-1'] }),
  })).json()
  const rows = kids.byParent['FNP-1']
  const carried = rows.find((c) => c.key === 'FNP-11')
  const dateless = rows.find((c) => c.key === 'FNP-12')
  const plain = rows.find((c) => c.key === 'FNP-13')

  check('A TASK CARRIED ACROSS SPRINTS SPANS BOTH',
    carried.sprintStart === '2026-01-05' && carried.sprintEnd === '2026-02-01',
    `${carried.sprintStart} to ${carried.sprintEnd} across ${carried.sprintCount} sprints`)
  check('  and the sprint is what gets planned against, not its own dates',
    carried.planStart === '2026-01-05' && carried.planEnd === '2026-02-01',
    `own dates were ${carried.start} to ${carried.due}`)
  check('  while its own dates are still carried, so the difference is visible',
    carried.start === '2026-01-08' && carried.due === '2026-02-01')
  check('  and the sprint is named', /Sprint 2/.test(carried.sprintName || ''), carried.sprintName)

  check('A TASK WITH NO DATES OF ITS OWN GETS THE SPRINT’S',
    dateless.due === null && dateless.planEnd === '2026-08-22',
    `no due date of its own, scheduled ${dateless.planStart} to ${dateless.planEnd}`)

  check('and a task in no sprint keeps its own dates',
    plain.sprintEnd == null && plain.planEnd === plain.due,
    `${plain.planEnd} from its own due date`)
}

/* ---------------- what the tasks add up to ---------------- */
console.log(String.fromCharCode(10) + '--- the rollup under each epic ---')
{
  const r = await (await fetch(`${base}/api/jira/rollup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['FNP-1', 'FNP-2'] }),
  })).json()
  const one = r.byParent['FNP-1']
  check('it counts the tasks under a parent', one.total === 7, JSON.stringify(one))
  check('  and how many are resolved', one.done === 3, `${one.done} of ${one.total}`)
  check('  SO IT KNOWS THE PROJECT IS NOT FINISHED', one.allDone === false,
    'one task is still open')
  // A SPRINT end where a task has one: that is the window the work is
  // actually scheduled in.
  check('  it takes the latest date any task needs', one.latestDue === '2026-12-31', String(one.latestDue))
  check('  and the LATEST resolution', one.latestResolved === '2026-04-01', String(one.latestResolved))
  check('  BUT ONLY A LABELLED TASK CAN CLAIM A DELAY',
    one.latestDelayDue === '2026-09-30' && one.delayKey === 'FNP-16',
    `${one.delayCount} labelled ${r.delayLabel}; the December overrun is not one of them`)
  check('a parent with no tasks is not "all done"',
    r.byParent['FNP-2'].total === 0 && r.byParent['FNP-2'].allDone === false,
    'there was nothing to finish')
  check('AND THE TOKEN IS NOT IN IT', !JSON.stringify(r).includes(TOKEN))
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
    return ['FNP-1', 'FNP-2', 'FNP-3']
      .map((k) => st.projects.find((p) => p.jiraKey === k))
      .filter(Boolean)
      .map((p) => JSON.parse(JSON.stringify(p)))
  })
  await page.goto(`${base}/?synced=1#timeline`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3500))

  const label = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Sync with Jira/.test(x.innerText))
    return b ? b.innerText.trim() : null
  })
  // No longer counts keys in its label: it pulls the whole board, not just
  // the rows that happen to have one.
  check('the sync button is offered', label === 'Sync with Jira', String(label))

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => /Sync with Jira/.test(x.innerText)).click()
  })
  await new Promise((r) => setTimeout(r, 3000))

  const byKeyIssue = Object.fromEntries(['FNP-1', 'FNP-2', 'FNP-3']
    .map((k) => [k, { start: START_AT_FIRST[k] }]))
  const after = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    /*
     * BY KEY, not by position. The sync adds any epic the register lacks at
     * the TOP of the list, so the first three rows are no longer the three
     * this test set up — and a check that silently read the wrong rows would
     * be worse than one that failed.
     */
    const want = ['FNP-1', 'FNP-2', 'FNP-3']
    const mine = want.map((k) => st.projects.find((p) => p.jiraKey === k)).filter(Boolean)
    const byKey = Object.fromEntries(mine.map((p) => [p.jiraKey, p]))
    return {
      note: (document.body.innerText.match(new RegExp('[0-9]+ projects? updated[^' + String.fromCharCode(10) + ']*')) || [''])[0],
      rows: mine.map((p) => ({
        jira: p.jiraKey, start: p.start, due: p.due, actualStart: p.actualStart, actualEnd: p.actualEnd,
      })),
      one: byKey['FNP-1'],
      two: byKey['FNP-2'],
      three: byKey['FNP-3'],
    }
  })

  /*
   * The start is written, the finish is NOT: FNP-1 has four tasks and one is
   * still open, and a project is finished when the last thing under it is —
   * not when somebody drags the epic to Done.
   */
  check('IT WROTE THE ACTUAL START', after.one.actualStart === '2026-01-10', String(after.one.actualStart))
  check('AND HELD THE FINISH BACK WHILE A TASK IS OPEN', after.one.actualEnd == null,
    `the epic says done, its tasks say ${after.one.tasksDone} of ${after.one.tasksTotal}`)
  check('  while recording where the work now lands', after.one.adjustedDue === '2026-09-30',
    `from ${after.one.adjustedCause}, the task marked as somebody else's delay`)
  check('  AND NOT FROM THE TASK THAT SIMPLY OVERRAN',
    after.one.adjustedDue !== '2026-12-31' && after.one.adjustedCause === 'FNP-16',
    'an unlabelled overrun is this team’s own slippage, not an adjustment')
  check('an unfinished issue gets a start and no finish',
    after.two.actualStart === '2026-02-01' && !after.two.actualEnd,
    JSON.stringify({ s: after.two.actualStart, e: after.two.actualEnd }))
  check('A TICKET REOPENED IN JIRA UN-FINISHES HERE TOO', after.three.actualEnd === null,
    'a finish that was taken back must not keep being reported')
  /*
   * BOTH PLANNED DATES NOW FOLLOW THE TICKET.
   *
   * The due date was frozen here for months, on the reasoning that a sync
   * rewriting the commitment would be marking its own homework. What settled
   * it the other way is that this server cannot write to Jira: the board is
   * where these dates are moved, and twenty-nine of them had drifted away from
   * the register — one by 417 days. So it follows the ticket, and the move is
   * RECORDED as a re-plan rather than applied silently, which is what keeps it
   * honest: the first is free, the rest are drift.
   */
  check('THE COMMITTED DUE DATE FOLLOWS THE TICKET',
    after.rows.every((r) => r.due === (byKeyIssue[r.jira]?.due || r.due)),
    after.rows.map((r) => `${r.jira} due ${r.due}`).join(' | '))
  check('  while the planned start follows the ticket',
    after.rows.every((r, i) => r.start === (byKeyIssue[r.jira]?.start || before[i].start)),
    after.rows.map((r) => `${r.jira} ${r.start}`).join(' | '))

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
  const full = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    return ['FNP-1', 'FNP-2', 'FNP-3']
      .map((k) => st.projects.find((p) => p.jiraKey === k))
      .filter(Boolean)
  })
  check('  and a moved commitment is recorded as a re-plan, not applied quietly',
    after.rows.every((r, i) => {
      const moved = (byKeyIssue[r.jira]?.due || null) && byKeyIssue[r.jira].due !== before[i].due
      const row = full.find((x) => x.jiraKey === r.jira)
      // First move: the baseline names what was first promised, and the count
      // says one — which is the free re-plan, spent but not yet drift.
      return !moved || (row.baselineDue === before[i].due && (row.replanCount || 0) >= 1)
    }),
    after.rows.map((r) => {
      const row = full.find((x) => x.jiraKey === r.jira)
      return `${r.jira} baseline ${row?.baselineDue} moves ${row?.replanCount || 0}`
    }).join(' | '))

  const drifted = []
  full.forEach((now, i) => {
    const was = before[i]
    for (const field of new Set([...Object.keys(was), ...Object.keys(now)])) {
      /*
       * What a sync owns, and nothing else. Three came from the ticket itself;
       * two come from the tasks underneath it — where the work now lands, and
       * how much of it is finished.
       */
      /*
       * `due`, `baselineDue` and `replanCount` move together or not at all:
       * the commitment follows the ticket and the move is recorded. Listing
       * them here is the point of this check — a field that starts moving
       * without being named must fail it.
       */
      if (['start', 'due', 'baselineDue', 'replanCount',
        'actualStart', 'actualEnd', 'summary', 'adjustedDue', 'adjustedCause', 'tasksTotal', 'tasksDone']
        .includes(field)) continue
      if (JSON.stringify(was[field]) !== JSON.stringify(now[field])) {
        drifted.push(`${was.jiraKey}.${field}: ${JSON.stringify(was[field])} -> ${JSON.stringify(now[field])}`)
      }
    }
  })
  check('A SYNC TOUCHES THE PLANNED AND ACTUAL DATES, THE NAME AND THE TASK COUNTS — NOTHING ELSE',
    drifted.length === 0,
    drifted.join(' | ') || `${Object.keys(before[0]).length} fields per project, all unchanged but those`)
  check('  and the name it wrote is the one Jira holds',
    full.every((now) => !now.jiraKey || typeof now.summary === 'string'),
    full.map((p) => `${p.jiraKey}: ${String(p.summary).slice(0, 28)}`).join(' | '))
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
    /Task that finished late/.test(opened.text) && /No dates, no sprint, nothing at all/.test(opened.text),
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
      // The planned start now follows the ticket, and the actual start is
      // still held separately — the bar is drawn from the plan, the fact is
      // kept as it happened.
      return p.actualStart === '2026-01-10' && p.start === '2026-01-10'
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

  // ---- and the page renders them in that order ----
  const drawnOrder = await page.evaluate(() => {
    // Read the rendered text top to bottom and keep the first mention of each
    // child key: whatever order the DOM is in IS the order on screen.
    const text = document.body.innerText
    const seen = []
    for (const m of text.matchAll(/FNP-1[1-4]/g)) {
      if (!seen.includes(m[0])) seen.push(m[0])
    }
    return seen
  })
  check('THE PAGE DRAWS THEM IN THE ORDER JIRA GAVE',
    JSON.stringify(drawnOrder) === JSON.stringify(['FNP-14', 'FNP-12', 'FNP-11', 'FNP-13']),
    drawnOrder.join(', '))

  // ---- a task with NO due date still gets something to read against ----
  const borrowed = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('div')]
      .filter((d) => (d.innerText || '').includes('FNP-18 ·') && d.querySelectorAll('div').length < 40)
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

/* ---------------- the sync the server runs by itself ---------------- */
console.log(String.fromCharCode(10) + '--- the schedule, and the sync that does not need a browser ---')
{
  const { startSchedule } = await import('../server/jiraSync.js')

  // 07:00 in a named timezone, whatever the machine's own clock says.
  process.env.JIRA_SYNC_HOUR = '7'
  process.env.JIRA_SYNC_TZ = 'Asia/Bangkok'
  const armed = startSchedule()
  check('THE DAILY SYNC IS ARMED', !!armed && armed.hour === 7 && armed.tz === 'Asia/Bangkok',
    armed ? `next in ${Math.round(armed.nextInMs / 60000)} min` : 'not armed')
  check('  for a time within the next day', armed.nextInMs > 0 && armed.nextInMs <= 86400000,
    `${Math.round(armed.nextInMs / 3600000)} hours away`)
  // Prove it lands on the hour: now + wait, read back in Bangkok, must be 07:00.
  const landing = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour12: false, hour: '2-digit', minute: '2-digit',
  }).format(new Date(Date.now() + armed.nextInMs))
  check('  AND IT LANDS ON 07:00 IN THAT TIMEZONE, not on the machine’s', landing === '07:00', landing)
  armed.stop()

  process.env.JIRA_SYNC_ENABLED = 'false'
  check('and it can be switched off', startSchedule() === null)
  delete process.env.JIRA_SYNC_ENABLED
}

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
