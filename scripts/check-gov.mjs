/**
 * Management's first release: role rates, budgets and cost lines kept on the
 * server (administrators only), actual effort from Jira worklogs, Cost & ROI
 * and Capacity worked out from them, edits saved field by field with
 * conflicts refused, and every change in the history.
 *
 * Pure arithmetic first, then the real server against a real mongod and a
 * fake Jira on :5418 that serves worklogs, then the pages in Chrome.
 *
 *   node scripts/check-gov.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { rateFor, projectCostOf, costContext, portfolioCosts, capacityOf } from '../src/lib/costs.js'
import { dataQuality, overviewOf } from '../src/lib/governance.js'
import { diffPlan, cleanProject } from '../server/governance.js'
import { planDiff, mergePlan, diffId, merge3 } from '../src/lib/planMerge.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const near = (a, b, tol = 0.5) => a != null && b != null && Math.abs(a - b) <= tol

console.log('\n--- the arithmetic ---')
{
  const rates = {
    roles: [
      { id: 'dev', name: 'Developer', hourlyRate: 500, status: 'approved', effectiveFrom: '2026-01-01', effectiveTo: null },
      { id: 'dev', name: 'Developer (old)', hourlyRate: 400, status: 'superseded' },
      { id: 'ba', name: 'Business Analyst', hourlyRate: 350, status: 'draft' },
      { id: 'pm', name: 'Project Manager', hourlyRate: 800, status: 'approved', effectiveFrom: '2026-06-01' },
    ],
    people: { james: { role: 'dev', project: 50 }, kade: { role: 'ba' } },
    overrides: [{ projectKey: 'P-2', role: 'dev', hourlyRate: 650, status: 'approved' }, { projectKey: 'P-1', role: 'dev', hourlyRate: 9999, status: 'pending' }],
    defaultRole: 'ba',
  }
  check('AN APPROVED RATE WINS; A SUPERSEDED ONE IS NEVER USED', rateFor(rates, 'dev', '2026-03-02')?.rate === 500)
  check('  a draft is used only when nothing is approved, and says so', rateFor(rates, 'ba', '2026-03-02')?.rate === 350 && rateFor(rates, 'ba').approved === false)
  check('  outside its effective period a rate does not apply', rateFor(rates, 'pm', '2026-03-02') === null && rateFor(rates, 'pm', '2026-07-06')?.rate === 800)
  check('  an APPROVED project exception wins on that project only; a pending one never', rateFor(rates, 'dev', '2026-03-02', 'P-2')?.rate === 650 && rateFor(rates, 'dev', '2026-03-02', 'P-1')?.rate === 500)

  const people = [{ id: 'james', nick: 'James', jiraNames: ['Pipat Singhasiri'] }, { id: 'kade', nick: 'Kade', jiraNames: ['Jarinya Phosri'] }]
  const fin = { horizonMonths: 12, hoursPerManday: 8, hoursPerFteMonth: 176, acctHourRate: 100, devDayRate: 4000, roiGate: 2, symbol: '฿' }
  const p = {
    key: 'P-1', jiraKey: 'FNP-1', summary: 'One', pic: 'james', status: 'In Progress', manday: 10, commitLevel: 'commit',
    horizonBenefit: 120000, capex: 5000, opexRunRate: 100, savingHours: 100, due: '2026-12-31',
  }
  const gov = {
    rates,
    projects: { 'P-1': { budget: { approved: 60000, original: 50000 }, costs: [{ category: 'vendor', label: 'SOW', forecast: 10000, actual: 4000 }, { category: 'software', label: 'Licence', recurring: true, monthly: 200, actual: 0 }], labour: [], benefit: { state: 'validated', actualHours: 80, expectedHours: 90, recurringCost: 50 } } },
    worklogs: { at: '2026-11-20T00:00:00Z', ok: true, byProject: { 'FNP-1': { hours: 30, remainingHours: 0, byWeek: { '2026-11-09': { 'Pipat Singhasiri': 20, 'Jarinya Phosri': 6, 'A Stranger': 4 } }, carried: 2, inProgress: 3, issues: 5 } } },
    blocked: { 'P-1': { weeks: 2, days: 10, lastBlocker: 'IT feed' } },
  }
  const plan = { projects: [p], people, finance: fin, settings: { asOfDate: '2026-11-22' } }
  const ctx = costContext(plan, gov)
  const c = projectCostOf(p, ctx)
  check('FORECAST LABOUR = PLANNED MANDAYS × 8 × THE PIC’S ROLE RATE', c.forecastHours === 80 && c.forecastLabour === 80 * 500, `${c.forecastHours} h, ${c.forecastLabour}`)
  check('ACTUAL LABOUR = EACH LOGGED HOUR AT ITS LOGGER’S ROLE RATE (a stranger at the default role)', c.actualHours === 30 && c.actualLabour === 20 * 500 + 6 * 350 + 4 * 350, String(c.actualLabour))
  check('  and the stranger is named, to be matched', c.unmapped.join() === 'A Stranger')
  check('REMAINING = FORECAST − LOGGED when neither Jira nor the admin says', c.remainingHours === 50 && c.remainingLabour === 50 * 500)
  const otherF = 5000 + 100 * 12 + 10000 + 200 * 12
  check('OTHER COST: the register’s CAPEX and OPEX, then the lines (a recurring line × the horizon)', c.otherForecast === otherF && c.otherActual === 4000, `${c.otherForecast} / ${c.otherActual}`)
  const eac = c.actualLabour + 4000 + c.remainingLabour + (otherF - 4000)
  check('EAC = ACTUAL + REMAINING, labour and other', c.eac === eac, `${c.eac} vs ${eac}`)
  check('BUDGET VARIANCE = EAC − APPROVED BUDGET', c.variance === eac - 60000 && c.originalBudget === 50000)
  const expected = 90 * 100 * 12 - 50 * 12
  const validated = 80 * 100 * 12 - 50 * 12
  check('PROJECTED ROI = (EXPECTED BENEFIT − EAC) ÷ EAC', near(c.projectedRoi, (expected - eac) / eac, 1e-9))
  check('ACTUAL ROI = (VALIDATED BENEFIT − ACTUAL COST) ÷ ACTUAL COST', near(c.actualRoi, (validated - c.actualTotal) / c.actualTotal, 1e-9) && c.actualTotal === c.actualLabour + 4000)
  check('FORECAST ROI = (FORECAST BENEFIT − FORECAST COST) ÷ FORECAST COST', near(c.forecastRoi, (120000 - (40000 + otherF)) / (40000 + otherF), 1e-9))

  const unvalidated = projectCostOf(p, costContext(plan, { ...gov, projects: { 'P-1': { ...gov.projects['P-1'], benefit: { state: 'implemented', actualHours: 80 } } } }))
  check('NO VALIDATION, NO ACTUAL ROI — an estimate is never called value released', unvalidated.actualRoi === null && unvalidated.gaps.includes('Benefit not validated'))
  const bare = projectCostOf({ ...p, jiraKey: null }, costContext(plan, { rates: null, projects: {}, worklogs: null }))
  check('NOTHING RECORDED: a gap, never a zero', bare.actualLabour === null && bare.actualHours === null && bare.budget === null && bare.variance === null
    && bare.gaps.includes('No approved budget') && bare.forecastLabour === 80 * 500, JSON.stringify(bare.gaps))
  check('  with no role rates the Model page’s developer rate prices the plan, flagged', bare.rate?.source === 'Model page developer salary' && bare.unapprovedRate)

  const cap = capacityOf(plan, gov)
  const j = cap.people.find((x) => x.id === 'james')
  check('CAPACITY: A MEMBER HAS THEIR PROJECT SHARE OF A FULL-TIME MONTH', j.monthHours === 88 && j.allocationSet && cap.people.find((x) => x.id === 'kade').monthHours === 176)
  check('  logged hours come from their Jira name', j.logged === 20 && cap.strangers[0]?.name === 'A Stranger')
  check('  50 hours left to 31 Dec at 50% is a sustainable load', j.warning === null && j.peak > 0 && j.peak < 0.85, String(j.peak))
  const tight = capacityOf({ ...plan, projects: [{ ...p, due: '2026-11-27' }] }, gov).people.find((x) => x.id === 'james')
  check('  the same 50 hours due next week is OVER capacity', tight.warning === 'over', String(tight.peak))
  const row = cap.projects[0]
  check('  per project: at completion, variance, carry-over, blocked days, WIP', row.fac === 80 && row.variance === 0 && row.carried === 2 && row.blockedDays === 10 && row.wip === 3)

  const money = portfolioCosts(plan, gov)
  const q = dataQuality({ ...plan, settings: { ...plan.settings } }, { gov })
  const o = overviewOf({ ...plan, settings: { sprintDays: 14 } }, q, money, cap)
  check('THE OVERVIEW STATES BUDGET VARIANCE AND ACTUAL ROI ONCE THE RECORDS EXIST', o.headline.budget.value === c.variance && near(o.headline.actualRoi.value, c.actualRoi, 1e-9) && o.headline.capacity.value === 0)
  check('DATA QUALITY: worklogs are a source with a status', q.global.some((g) => g.id === 'worklogs'))

  const recs = cleanProject({ budget: { approved: '1,200,000' }, costs: [{ category: 'bogus', forecast: -5 }], benefit: { state: 'nonsense' } })
  check('THE SERVER CLEANS WHAT IT IS SENT', recs.budget.approved === 1200000 && recs.costs[0].category === 'other' && recs.costs[0].forecast === 0 && recs.benefit.state === 'estimated')
  const d = diffPlan({ projects: [{ key: 'A', due: '2026-01-01' }], people: [], settings: { x: 1 } }, { projects: [{ key: 'A', due: '2026-02-01' }, { key: 'B' }], people: [], settings: { x: 2 } }, 'boss')
  check('A PLAN SAVE IS DIFFED FIELD BY FIELD', d.some((x) => x.key === 'A' && x.field === 'due' && x.from === '"2026-01-01"' && x.to === '"2026-02-01"')
    && d.some((x) => x.key === 'B' && x.field === 'added') && d.some((x) => x.kind === 'plan.settings' && x.field === 'x'))
}

console.log('\n--- two copies of the plan, field by field ---')
{
  const theirs = { projects: [{ key: 'A', due: '2026-02-01', pic: 'kade' }, { key: 'C', summary: 'New there' }], people: [{ id: 'gun', nick: 'Gun' }], settings: { sprintDays: 14, x: 1 }, apps: [1] }
  const mine = { projects: [{ key: 'A', due: '2026-01-01', pic: 'kade', manday: 5 }, { key: 'B', summary: 'New here' }], people: [{ id: 'gun', nick: 'Gunn' }], settings: { sprintDays: 10, x: 1 }, apps: [1] }
  const d = planDiff(mine, theirs)
  const ids = d.map(diffId).sort()
  check('EVERY FIELD THE TWO DISAGREE ON, AND ONLY THOSE', ids.join() === ['people|gun|nick', 'projects|A|due', 'projects|A|manday', 'projects|B|(whole record)', 'projects|C|(whole record)', 'settings||sprintDays'].sort().join(), ids.join())
  const kept = mergePlan(theirs, d, {})
  check('  nothing chosen: the shared plan, untouched', JSON.stringify(kept) === JSON.stringify(theirs))
  const m = mergePlan(theirs, d, { 'projects|A|manday': 'mine', 'projects|B|(whole record)': 'mine', 'settings||sprintDays': 'mine', 'projects|C|(whole record)': 'mine' })
  const A = m.projects.find((p) => p.key === 'A')
  check('  "mine" takes exactly that field; the rest stays shared', A.manday === 5 && A.due === '2026-02-01' && m.settings.sprintDays === 10 && m.people[0].nick === 'Gun')
  check('  a record only here is added; one only there is removed when mine is chosen', m.projects.some((p) => p.key === 'B') && !m.projects.some((p) => p.key === 'C'))

  const base = { projects: [{ key: 'A', due: '2026-01-01', manday: 1 }, { key: 'D', due: '2026-05-01' }], settings: { sprintDays: 14 } }
  const t2 = { projects: [{ key: 'A', due: '2026-03-01', manday: 1 }, { key: 'D', due: '2026-06-01' }], settings: { sprintDays: 14 } }
  const m2 = { projects: [{ key: 'A', due: '2026-01-01', manday: 9 }], settings: { sprintDays: 7 } }
  const x = merge3(base, t2, m2)
  const xa = x.merged.projects.find((p) => p.key === 'A')
  check('THREE-WAY: EACH SIDE’S OWN FIELDS ARE KEPT — their date, my mandays and my setting', xa.due === '2026-03-01' && xa.manday === 9 && x.merged.settings.sprintDays === 7)
  check('  deleting a record the other side edited is a conflict, not a silent loss', x.conflicts.length === 1 && x.conflicts[0].id === 'D' && x.merged.projects.some((p) => p.key === 'D'), JSON.stringify(x.conflicts))
  const y = merge3(base, t2, { ...base, projects: [{ key: 'A', due: '2026-02-01', manday: 1 }, base.projects[1]] })
  check('  the same field changed differently on both sides is a conflict', y.conflicts.length === 1 && y.conflicts[0].field === 'due' && y.conflicts[0].mine === '2026-02-01' && y.conflicts[0].theirs === '2026-03-01')
}

/* ------------------------------------------------------------ fake Jira */
const LOGS = {
  'FNP-379': [{ author: 'Pipat Singhasiri', started: '2026-11-10T09:00:00.000+0700', s: 5 * 3600 }, { author: 'Pipat Singhasiri', started: '2026-11-17T09:00:00.000+0700', s: 3 * 3600 }],
  'FNP-2001': Array.from({ length: 25 }, (_, i) => ({ author: i % 5 ? 'Pipat Singhasiri' : 'Jarinya Phosri', started: '2026-11-11T10:00:00.000+0700', s: 3600 })),
}
const ISSUES = [
  { key: 'FNP-379', summary: 'Epic', cat: 'indeterminate', est: 40 * 3600, rem: 10 * 3600 },
  { key: 'FNP-2001', parent: 'FNP-379', summary: 'Task', cat: 'indeterminate', est: 20 * 3600, rem: 6 * 3600, sprints: 2, assignee: 'Pipat Singhasiri' },
  { key: 'FNP-2002', parent: 'FNP-379', summary: 'Done task', cat: 'done', est: 8 * 3600, rem: 0 },
]
const wlOf = (key) => (LOGS[key] || []).map((w) => ({ author: { displayName: w.author }, started: w.started, timeSpentSeconds: w.s }))
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString() || '{}') : {}
  if (u.pathname === '/rest/api/3/search/jql') {
    const jql = body.jql || ''
    if (!/OR key IN/.test(jql)) return send(200, { issues: [] })
    const under = (jql.match(/parent IN \(([^)]*)\)/) || [])[1]?.split(',') || []
    const list = ISSUES.filter((i) => under.includes(i.key) || under.includes(i.parent))
    return send(200, {
      issues: list.map((i) => {
        const all = wlOf(i.key)
        return {
          key: i.key,
          fields: {
            summary: i.summary,
            status: { name: i.cat, statusCategory: { key: i.cat } },
            parent: i.parent ? { key: i.parent } : null,
            assignee: i.assignee ? { displayName: i.assignee } : null,
            timeoriginalestimate: i.est,
            timeestimate: i.rem,
            customfield_10020: Array.from({ length: i.sprints || 1 }, (_, n) => ({ name: `S${n}`, startDate: '2026-11-01', endDate: '2026-11-14' })),
            worklog: { total: all.length, worklogs: all.slice(0, 20) },
          },
        }
      }),
    })
  }
  const m = u.pathname.match(/^\/rest\/api\/3\/issue\/([A-Z]+-\d+)\/worklog$/)
  if (m) return send(200, { worklogs: wlOf(m[1]), total: wlOf(m[1]).length })
  return send(404, { errorMessages: ['no such thing in the fake'] })
})
await new Promise((r) => fake.listen(5418, r))

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5379
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'gov-service-token-'.padEnd(48, '8')
const root = new URL('..', import.meta.url).pathname
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_URI: mongod.getUri(),
    MONGODB_DB: 'team_kpi_planning',
    AUTH_SECRET: 'a-test-secret',
    AUTH_ADMIN_EMAILS: 'boss@lotuss.com,boss2@lotuss.com',
    KPI_SERVICE_TOKEN: TOKEN,
    JIRA_BASE_URL: 'http://127.0.0.1:5418',
    JIRA_EMAIL: 'app@lotuss.com',
    JIRA_API_TOKEN: 'fake-token',
    JIRA_SYNC_ENABLED: 'false',
    MAIL_TRANSPORT: 'log',
    LOTUS_API_KEY: '',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const serverErr = []
server.stderr.on('data', (b) => serverErr.push(String(b)))
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await sleep(300)
}
const call = async (method, path, b, who) => {
  const headers = { 'Content-Type': 'application/json' }
  if (who === 'service') headers.authorization = `Bearer ${TOKEN}`
  else if (who) headers.cookie = who
  const res = await fetch(base + path, { method, headers, body: b === undefined ? undefined : JSON.stringify(b) })
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}
const signUp = async (email) => {
  await call('POST', '/api/auth/register', { email, password: 'password1' })
  await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}

let browser
try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  const first = await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const boss2 = await signUp('boss2@lotuss.com')
  const james = await signUp('james@lotuss.com')

  console.log('\n--- administrators only ---')
  check('A MEMBER CANNOT READ RATES OR BUDGETS', (await call('GET', '/api/gov', undefined, james)).status === 403)
  check('  nor write them', (await call('PATCH', '/api/gov/records/rates', { changes: [{ path: 'roles', from: [], to: [] }] }, james)).status === 403)
  const g0 = (await call('GET', '/api/gov', undefined, boss)).body
  check('AN ADMINISTRATOR STARTS FROM EMPTY RECORDS', Array.isArray(g0.rates?.roles) && g0.rates.roles.length === 0 && g0.worklogs === null)

  console.log('\n--- field by field, never silently over newer work ---')
  const roles = [{ id: 'dev', name: 'Developer', rateType: 'internal', hourlyRate: 500, status: 'approved' }, { id: 'ba', name: 'Business Analyst', hourlyRate: 350, status: 'approved' }]
  const r1 = await call('PATCH', '/api/gov/records/rates', { changes: [{ path: 'roles', from: [], to: roles }, { path: 'people', from: {}, to: { james: { role: 'dev', project: 60 }, kade: { role: 'ba' } } }] }, boss)
  check('ROLE RATES AND MEMBERS’ ROLES ARE SAVED', r1.status === 200 && r1.body.record?.roles?.length === 2 && r1.body.record.people.james.project === 60, JSON.stringify(r1.body).slice(0, 200))
  const a = await call('PATCH', '/api/gov/records/project:FNP-379', { changes: [{ path: 'budget.approved', from: null, to: 100000 }] }, boss)
  check('A PROJECT’S APPROVED BUDGET IS SAVED, AND BECOMES ITS BASELINE BUDGET', a.status === 200 && a.body.record.budget.approved === 100000 && a.body.record.budget.original === 100000)
  // Two administrators had the page open on 100,000. One moves it to 120,000; the other, still seeing 100,000, types 90,000.
  const b1 = await call('PATCH', '/api/gov/records/project:FNP-379', { changes: [{ path: 'budget.approved', from: 100000, to: 120000 }] }, boss)
  const b2 = await call('PATCH', '/api/gov/records/project:FNP-379', { changes: [{ path: 'budget.approved', from: 100000, to: 90000 }] }, boss2)
  check('THE SECOND, OUT OF DATE, IS REFUSED FOR THAT FIELD, WITH BOTH VALUES', b1.status === 200 && b2.status === 409
    && b2.body.conflicts?.[0]?.path === 'budget.approved' && b2.body.conflicts[0].theirs === 120000 && b2.body.conflicts[0].yours === 90000 && b2.body.updatedBy === 'boss@lotuss.com', JSON.stringify(b2.body))
  const other = await call('PATCH', '/api/gov/records/project:FNP-379', { changes: [{ path: 'budget.note', from: '', to: 'Approved at steering' }] }, boss2)
  check('  a DIFFERENT field of the same record goes through', other.status === 200 && other.body.record.budget.approved === 120000)
  const forced = await call('PATCH', '/api/gov/records/project:FNP-379', { changes: [{ path: 'budget.approved', from: 100000, to: 90000 }], force: ['budget.approved'] }, boss2)
  check('  and choosing "keep mine" overwrites it on purpose', forced.status === 200 && forced.body.record.budget.approved === 90000)
  check('THE BASELINE BUDGET NEVER MOVES', forced.body.record.budget.original === 100000)
  const costs = [{ id: 'c1', category: 'vendor', label: 'SOW', forecast: 20000, actual: 5000 }]
  await call('PATCH', '/api/gov/records/project:FNP-379', { changes: [{ path: 'costs', from: [], to: costs }, { path: 'benefit.state', from: 'estimated', to: 'validated' }, { path: 'benefit.actualHours', from: null, to: 30 }] }, boss)
  const hist = (await call('GET', '/api/gov/audit?key=FNP-379', undefined, boss)).body.rows || []
  check('EVERY CHANGE IS IN THE HISTORY: who, which field, from what to what', hist.some((x) => x.field === 'budget.approved' && x.from === '120000' && x.to === '90000' && x.by === 'boss2@lotuss.com')
    && hist.some((x) => x.field === 'costs') && hist.some((x) => x.field === 'benefit.state' && x.to === '"validated"'), hist.map((x) => `${x.field}:${x.from}>${x.to}`).join(' '))
  check('  a bad path is refused', (await call('PATCH', '/api/gov/records/project:FNP-379', { changes: [{ path: '__proto__.x', from: 1, to: 2 }] }, boss)).status === 400)

  console.log('\n--- actual effort from Jira ---')
  const s = await call('POST', '/api/gov/worklogs/sync', {}, boss)
  const w = s.body.worklogs
  const p379 = w?.byProject?.['FNP-379']
  check('THE WORKLOGS ARE READ FOR EVERY KEYED PROJECT', s.status === 200 && w.ok === true && !!p379, JSON.stringify(s.body).slice(0, 200))
  check('  every entry, past the twenty a search returns', w.entries === 27 && p379.hours === 33, `${w.entries} entries, ${p379?.hours} h`)
  check('  by person and by week', p379.byPerson['Pipat Singhasiri'] === 28 && p379.byPerson['Jarinya Phosri'] === 5 && p379.byWeek['2026-11-09']?.['Pipat Singhasiri'] === 25)
  check('  remaining estimate (open issues only), carry-over, work in progress', p379.remainingHours === 16 && p379.carried === 1 && p379.inProgress === 2 && p379.done === 1, JSON.stringify({ r: p379.remainingHours, c: p379.carried, i: p379.inProgress }))
  const g1 = (await call('GET', '/api/gov', undefined, boss)).body
  check('  and kept for the pages', g1.worklogs?.byProject?.['FNP-379']?.hours === 33)

  console.log('\n--- RAID ---')
  const add = await call('POST', '/api/gov/raid', { item: { type: 'risk', title: 'Vendor late', projectKey: 'FNP-379', severity: 'high', exposure: { cost: 50000, days: 10 } } }, boss)
  check('A RISK IS RECORDED WITH ITS EXPOSURE', add.status === 200 && add.body.item?.exposure?.cost === 50000)
  const seen = add.body.item
  const e1 = await call('PUT', `/api/gov/raid/${seen.id}`, { item: { ...seen, owner: 'James' }, seen }, boss)
  const e2 = await call('PUT', `/api/gov/raid/${seen.id}`, { item: { ...seen, owner: 'Kade' }, seen }, boss2)
  check('  two edits of the same field: the second is refused', e1.status === 200 && e2.status === 409 && e2.body.conflicts?.[0]?.path === 'owner')

  console.log('\n--- the shared plan ---')
  const stale = await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'x', baseUpdatedAt: '2001-01-01T00:00:00.000Z' }, boss)
  check('A BROWSER BEHIND THE SHARED PLAN CANNOT REPLACE IT', stale.status === 409 && stale.body.conflict === true)
  const moved = JSON.parse(JSON.stringify(seed))
  moved.projects.find((p) => p.key === 'FNP-379').due = '2026-12-24'
  const ok = await call('PUT', '/api/scenarios/Baseline', { payload: moved, updatedBy: 'x', baseUpdatedAt: first.body.updatedAt }, boss)
  check('  one that is up to date can', ok.status === 200)
  // Two browsers both started from that save. One moves FNP-379's PIC; the other, a different project's mandays.
  const v1 = JSON.parse(JSON.stringify(moved))
  v1.projects.find((p) => p.key === 'FNP-379').savingHours = 99
  const s1 = await call('PUT', '/api/scenarios/Baseline', { payload: v1, updatedBy: 'a', baseUpdatedAt: ok.body.updatedAt }, boss)
  const v2 = JSON.parse(JSON.stringify(moved))
  v2.projects.find((p) => p.key === 'FNP-88').manday = 42
  const s2 = await call('PUT', '/api/scenarios/Baseline', { payload: v2, updatedBy: 'b', baseUpdatedAt: ok.body.updatedAt }, boss2)
  const both = (await call('GET', '/api/scenarios/Baseline', undefined, boss)).body.payload
  check('TWO SAVES FROM THE SAME VERSION, ON DIFFERENT FIELDS, ARE MERGED — neither is lost', s1.status === 200 && s2.status === 200 && s2.body.merged === true
    && both.projects.find((p) => p.key === 'FNP-379').savingHours === 99 && both.projects.find((p) => p.key === 'FNP-88').manday === 42, `${s1.status} ${s2.status} ${JSON.stringify(s2.body).slice(0, 120)}`)
  const v3 = JSON.parse(JSON.stringify(moved))
  v3.projects.find((p) => p.key === 'FNP-379').savingHours = 7
  const s3 = await call('PUT', '/api/scenarios/Baseline', { payload: v3, updatedBy: 'c', baseUpdatedAt: ok.body.updatedAt }, boss)
  check('  the SAME field changed on both sides is refused, naming it', s3.status === 409 && s3.body.conflicts?.some((c) => c.id === 'FNP-379' && c.field === 'savingHours' && c.theirs === '99' && c.mine === '7'), JSON.stringify(s3.body).slice(0, 200))
  await sleep(300)
  const ph = (await call('GET', '/api/gov/audit?kind=plan.project&key=FNP-379', undefined, boss)).body.rows || []
  check('  AND THE CHANGE IS IN THE HISTORY', ph.some((x) => x.field === 'due' && x.to === '"2026-12-24"' && x.by === 'boss@lotuss.com'), JSON.stringify(ph[0]))

  console.log('\n--- the pages ---')
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((x) => existsSync(x))
  if (!chrome || !existsSync(new URL('../dist/index.html', import.meta.url))) {
    console.log('SKIP  the pages (no Chrome or no build)')
  } else {
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] })
    const pg = await browser.newPage()
    pg.on('pageerror', (e) => console.log(`PAGEERR ${e.message}`))
    pg.on('dialog', (d) => d.accept())
    pg.on('console', (m) => { if (m.type() === 'error') console.log(`CONSOLE ${m.text().slice(0, 300)}`) })
    await pg.setViewport({ width: 1440, height: 900 })
    const [n, v] = boss.split('=')
    await pg.setCookie({ name: n, value: v, url: base })
    const open = async (tab, sel) => {
      await pg.goto(`${base}/?go#${tab}`, { waitUntil: 'networkidle2', timeout: 45000 })
      await pg.waitForSelector(sel, { timeout: 15000 }).catch(() => {})
      if (process.env.SHOT_DIR) await pg.screenshot({ path: `${process.env.SHOT_DIR}/gov-${tab}.png`, fullPage: false })
      return pg.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)
    }
    const setup = await open('rates', '[data-budget-row="FNP-379"]')
    check('COSTS & RATES: THE ROLE RATES, THE TEAM, EVERY PROJECT’S BUDGET', /Role rates/i.test(setup) && /Project budgets and costs/i.test(setup) && await pg.evaluate(() => [...document.querySelectorAll('[data-rate-row] input')].some((i) => i.value === 'Developer'))
      && await pg.evaluate(() => document.querySelector('[data-budget-row="FNP-379"] input')?.value === '90000'))
    check('  and the worklog read', /27 worklog entries/.test(setup), (setup.match(/Last read[^\n]*/) || [''])[0])
    const cost = await open('cost', '[data-cost-row="FNP-379"]')
    check('COST & ROI: BUDGET, ACTUAL, EAC, VARIANCE, THE THREE ROIs', /Approved budget/i.test(cost) && /Estimate at completion/i.test(cost) && /Validated actual ROI/i.test(cost)
      && await pg.evaluate(() => /฿90k/.test(document.querySelector('[data-stat="budget"]')?.textContent || '') && /฿/.test(document.querySelector('[data-stat="actual"]')?.textContent || '')), cost.slice(0, 300).replace(/\n/g, ' | '))
    const capT = await open('capacity', '[data-effort-row="FNP-379"]')
    check('CAPACITY & SPRINT: PEOPLE’S LOAD AND EACH PROJECT’S EFFORT', /Capacity & sprint/i.test(capT) && /Next 12 weeks/i.test(capT)
      && await pg.evaluate(() => document.querySelector('[data-effort-row="FNP-379"]')?.innerText.includes('33')))
    const ov = await open('overview', '[data-metric="budget"]')
    check('THE MANAGEMENT OVERVIEW NOW STATES BUDGET VARIANCE', await pg.evaluate(() => /฿/.test(document.querySelector('[data-metric="budget"]')?.textContent || '')), ov.slice(0, 120))
    const ben = await open('benefits', '[data-benefit-row="FNP-379"]')
    check('BENEFITS: FIVE STATES, AND FNP-379 VALIDATED WITH ITS 30 HOURS', /Post-stabilisation validated/i.test(ben)
      && await pg.evaluate(() => /30/.test(document.querySelector('[data-benefit-row="FNP-379"]')?.innerText || '') && /validated/i.test(document.querySelector('[data-benefit-row="FNP-379"]')?.innerText || '')))
    await pg.click('[data-open-benefit="FNP-379"]')
    await pg.waitForSelector('[data-benefit-dialog]', { timeout: 5000 }).catch(() => {})
    await pg.click('[data-save-benefit]')
    await sleep(400)
    const probs = await pg.evaluate(() => document.querySelector('[data-benefit-problems]')?.innerText || '')
    check('  a validated benefit with no validator, owner or baseline is refused, saying what it needs', /validated/i.test(probs) && /owner/i.test(probs) && /validation date/i.test(probs), probs)
    await pg.keyboard.press('Escape')
    await sleep(300)
    const raidT = await open('raid', '[data-raid-row]')
    check('DECISIONS & RAID: THE RISK, WITH ITS VALUE AT RISK', /Vendor late/.test(raidT) && await pg.evaluate(() => /฿/.test(document.querySelector('[data-stat="atRisk"]')?.textContent || '')))
    const histT = await open('history', '[data-audit-row]')
    check('CHANGE HISTORY: WHO CHANGED WHAT', await pg.evaluate(() => document.querySelectorAll('[data-audit-row]').length) > 5 && /budget\.approved/.test(histT) && /boss2@lotuss\.com/.test(histT))
    const evT = await open('evidence', '[data-page="evidence"]')
    check('PERFORMANCE EVIDENCE: THE SEVEN DIMENSIONS, NO RANKING', /Delivery/i.test(evT) && /Forecasting/i.test(evT) && /Collaboration/i.test(evT) && !/\brank\b/i.test(evT.replace(/no rank|not rank|never rank/gi, '')), evT.slice(0, 200).replace(/\n/g, ' | '))
    const packT = await open('pack', '[data-pack]')
    check('MANAGEMENT PACK: SUMMARY, DECISIONS, DATA LIMITS, AND HOW TO ISSUE IT', /Management Pack/i.test(packT) && /decision/i.test(packT) && /confidence/i.test(packT) && /Issue this pack/i.test(packT), packT.slice(0, 200).replace(/\n/g, ' | '))
    const wide = await pg.evaluate(() => document.documentElement.scrollWidth)
    check('  nothing spills sideways', wide <= 1440, String(wide))
  }
} catch (e) {
  failures++
  console.log(`FAIL  crashed: ${e.stack}`)
} finally {
  if (browser) await browser.close()
  server.kill()
  await mongod.stop()
  fake.close()
  const errs = serverErr.join('').split('\n').filter((l) => /Error/.test(l))
  if (errs.length) console.log(`server said:\n${errs.slice(0, 10).join('\n')}`)
  console.log(failures ? `\n${failures} governance check(s) failed` : '\nall governance record checks passed')
  process.exit(failures ? 1 : 0)
}
