/**
 * PRESENTATIONS: the decks, their pictures and the AI that writes on them.
 *
 * The slide layouts first (pure: the same parts are drawn on screen and
 * written into PowerPoint), then the real server against a real mongod and a
 * FAKE Lotus LLM on localhost — nothing reaches the real model.
 *
 *   node scripts/check-decks.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { cleanDeck } from '../server/decks.js'
import { cardParts, roadmapParts, tasksParts, monthsBetween, partsOf } from '../src/presentation/layout.js'
import { deckStatus, cardFromFacts, standardDeck, updatesSlides } from '../src/presentation/templates.js'
import { parseInitiatives, linkAll, pillOf, targetDate, cardFromInitiative, initiativeRoadmap } from '../src/presentation/initiatives.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* -------------------------------------------------------------- layouts */

console.log('\n--- the slide layouts ---')
const card = { id: 'c1', type: 'card', x: 47, y: 96, w: 411, h: 196, style: { tone: 'blue' }, data: { projectKey: 'FNP-1', title: 'P&L Forecast Webapp Phase 1', status: 'GO LIVE', accomplishment: ['Full app trial launch', 'OneLogin integration'], impact: ['Database and edit trail'], next: [], target: '31-Aug-2026' } }
const parts = cardParts(card)
const texts = parts.filter((p) => p.k === 'text').map((p) => p.text)
check('A CARD HAS THE DECK\'S FOUR BOXES', ['ACCOMPLISHMENT', 'IMPACT', 'NEXT MILESTONE', 'TARGET DATE'].every((t) => texts.includes(t)), texts.join(' | '))
check('  with its words, one bullet per line', texts.includes('• Full app trial launch\n• OneLogin integration'))
check('  the status pill and the date', texts.includes('GO LIVE') && texts.includes('31-Aug-2026'))
check('  and every part knows its project, for the click while presenting', parts.every((p) => p.link === 'FNP-1'))
check('  and stays inside the card', parts.every((p) => p.x >= card.x - 0.5 && p.y >= card.y - 0.5 && p.x + p.w <= card.x + card.w + 0.5 && p.y + p.h <= card.y + card.h + 0.5))
const narrow = cardParts({ ...card, w: 275, style: { tone: 'yellow', scale: 1.35 } })
const label = narrow.find((p) => p.text === 'ACCOMPLISHMENT')
check('A NARROW CARD KEEPS "ACCOMPLISHMENT" ON ONE LINE', label.w >= 'ACCOMPLISHMENT'.length * label.size * (4 / 3) * 0.62, `${Math.round(label.w)}px for ${label.size.toFixed(1)}pt`)

const rm = roadmapParts({ x: 26, y: 96, w: 908, h: 428, data: { year: 2026, rows: [{ id: 'g', group: 'Finance' }, { id: 'a', projectKey: 'FNP-2', label: 'AI Sales Forecast', status: 'On Track', start: '2026-04-01', end: '2026-08-31', bar: 'Phase 1–5' }] } })
const bar = rm.find((p) => p.k === 'rect' && p.link === 'FNP-2' && p.fill === '#1580DA')
check('THE ROADMAP DRAWS A BAR FROM APRIL TO AUGUST', bar && bar.x > 26 + 908 * 0.3 && bar.x + bar.w < 26 + 908 * 0.95, bar && `${Math.round(bar.x)}…${Math.round(bar.x + bar.w)}`)
check('  under the FINANCE heading', rm.some((p) => p.text === 'FINANCE'))

check('A TASK TIMELINE SPANS THE MONTHS OF ITS TASKS', monthsBetween('2026-07-01', '2026-10-15').length === 4)
const tl = tasksParts({ x: 26, y: 84, w: 908, h: 440, data: { from: '2026-07-01', to: '2026-10-31', rows: [{ id: 'r', label: 'Develop RPA', start: '2026-07-08', end: '2026-07-21' }] } }, '2026-08-10')
check('  with W1–W4 under every month', tl.filter((p) => /^W[1-4]$/.test(p.text || '')).length === 16)
check('  and today drawn as a red dashed line', tl.some((p) => p.k === 'line' && p.dashed && p.border === '#E5484D'))
check('every composite draws something', ['card', 'roadmap', 'tasks', 'thanks', 'pill'].every((t) => (partsOf({ type: t, x: 0, y: 0, w: 960, h: 540, data: {}, style: {} }) || []).length > 0))

console.log('\n--- what a project is called on a slide ---')
check('Done is GO LIVE', deckStatus({ status: 'Done' }) === 'GO LIVE')
check('Not Start is Planning', deckStatus({ status: 'Not Start' }) === 'Planning')
check('past its date and not done is Delayed', deckStatus({ status: 'In Progress', start: '2026-01-01', due: '2026-02-01' }, '2026-11-11') === 'Delayed')
check('running inside its dates is On Track', deckStatus({ status: 'In Progress', start: '2026-01-01', due: '2026-12-31' }, '2026-11-11') === 'On Track')
const fc = cardFromFacts({ key: 'FNP-3', summary: 'X', status: 'In Progress', due: '2026-12-31' }, {
  history: [
    { week: '2026-11-09', title: 'FNP-2108 Load October actuals', done: true },
    { week: '2026-11-09', title: 'Reconcile the Q4 forecast', done: false },
  ],
})
check('A CARD FROM THE WEEKLY UPDATES: done → accomplishment, without the Jira key', JSON.stringify(fc.accomplishment) === '["Load October actuals"]', JSON.stringify(fc.accomplishment))
check('  open work → next milestone', JSON.stringify(fc.next) === '["Reconcile the Q4 forecast"]')
const ps = Array.from({ length: 8 }, (_v, i) => ({ key: `FNP-${i + 1}`, summary: `Project ${i + 1}`, team: i < 7 ? 'Finance' : 'Accounting', status: 'In Progress', start: '2026-01-01', due: '2026-12-31' }))
check('SEVEN CARDS ARE TWO SLIDES (six to a slide)', updatesSlides('Finance', ps.slice(0, 7).map((p) => ({ projectKey: p.key, title: p.summary }))).length === 2)
const std = standardDeck(ps, { title: 'IT Gov', date: '2026-11-13', hasBrand: {} })
check('THE MEETING DECK: cover, agenda, updates, roadmap, thank you', JSON.stringify(std.map((s) => s.kind)) === JSON.stringify(['cover', 'agenda', 'updates', 'updates', 'updates', 'roadmap', 'thanks']), std.map((s) => s.kind).join(','))

console.log('\n--- the initiative list, pasted from Excel ---')
const pasted = [
  'Project \tMile Stone\tStatus\tUsers\tTarget', '\t\t\t\t',
  'AI Sales Forecast\t\t\tFin - Retail\t',
  '\tAI Sales forecast Phase 1\tGO LIVE\tFin - Retail\tDec 2026',
  '\tAI Sales forecast Phase 2\tin-progress\tFin - Retail\tTBC (2027)',
  'PowerBI report - MALL\t\t\tFin - MALL\tDec 2026', '\t....\tin-progress\tFin - MALL\t',
  'LOI Autocheck', '\t\tGO LIVE\tAcc - AR\t',
  'Lease Master\t\tGO LIVE\tAcc - AP\t',
  'Supplier Inquiry system\t\tRequirement Gathering\tAcc - AP\tTBC (2027)',
].join('\n')
const items = parseInitiatives(pasted)
const tops = items.filter((x) => !x.parentId)
check('THE HEADER AND EMPTY ROWS ARE SKIPPED; FIVE INITIATIVES', tops.map((x) => x.name).join('|') === 'AI Sales Forecast|PowerBI report - MALL|LOI Autocheck|Lease Master|Supplier Inquiry system', tops.map((x) => x.name).join('|'))
check('  a milestone row goes under the initiative above it', items.filter((x) => x.parentId === tops[0].id).map((x) => x.name).join('|') === 'AI Sales forecast Phase 1|AI Sales forecast Phase 2')
check('  a "...." placeholder is not a milestone', !items.some((x) => /^\.+$/.test(x.name)))
check('  A NAME EXCEL WRAPPED ONTO ITS OWN LINE KEEPS ITS STATUS AND USERS', (() => { const l = items.find((x) => x.name === 'LOI Autocheck'); return l && l.status === 'GO LIVE' && l.users === 'Acc - AR' })())
check('  "Acc - …" users are Accounting, the rest Finance', items.find((x) => x.name === 'Lease Master').team === 'Accounting' && tops[0].team === 'Finance')
check('STATUS WORDS BECOME THE DECK\'S PILLS', ['GO LIVE', 'in-progress', 'UAT', 'Planning', 'Requirement Gathering'].map(pillOf).join('|') === 'GO LIVE|On Track|UAT|Planning|Req. Gathering')
check('TARGETS: "Dec 2026" is the 31st, "TBC (2027)" is 2027, "TBC" is no date', targetDate('Dec 2026') === '2026-12-31' && targetDate('Nov 2026') === '2026-11-30' && targetDate('TBC (2027)') === '2027-12-31' && targetDate('TBC') === null)
const reg = [
  { key: 'NEW-61', summary: 'Lease Master Phase 2' }, { key: 'FNP-865', summary: 'Shrinkage Automation (Dashboard) — Actual & Forecast' },
  { key: 'NEW-23', summary: 'Billing Transformation Phase 2 [DELETED]' }, { key: 'FNP-267', summary: 'Supplier Portal' },
]
const linked = linkAll(parseInitiatives('Lease Master\t\tGO LIVE\tAcc - AP\t\nShrinkage Automation\t\tin-progress\tFin\t\nBilling Transformation\t\tGO LIVE\tAcc - AP\t\nSupplier Portal OCR - Trade\t\tGO LIVE\tAcc - AP\t'), reg)
check('LINKED ONLY WHEN THE NAME PLAINLY IS THE PROJECT', linked.map((x) => x.projectKey || '-').join('|') === '-|FNP-865|-|-', linked.map((x) => x.projectKey || '-').join('|'))
const c1 = cardFromInitiative(tops[0], items)
check('AN INITIATIVE CARD: live milestones are the accomplishment, the rest next, with their target', JSON.stringify(c1.accomplishment) === '["AI Sales forecast Phase 1"]' && JSON.stringify(c1.next) === '["AI Sales forecast Phase 2 (TBC (2027))"]' && c1.status === 'On Track')
const rmap = initiativeRoadmap(items, tops, { year: 2026 }).elements.find((e) => e.type === 'roadmap').data.rows
const withKids = [{ id: 'P', parentId: null, name: 'Channel', status: 'in-progress', target: 'Dec 2026', team: 'Finance' }, { id: 'K', parentId: 'P', name: 'Net margin', projectKey: 'FNP-1065', target: 'Dec 2026', team: 'Finance' }]
const r2 = initiativeRoadmap(withKids, [withKids[0]], { year: 2026, byKey: { 'FNP-1065': { key: 'FNP-1065', start: '2026-05-04' } } }).elements.find((e) => e.type === 'roadmap').data.rows[1]
check('THE ROADMAP STARTS AN INITIATIVE WHEN ITS MILESTONES\' PROJECTS STARTED', r2.start === '2026-05-04' && r2.end === '2026-12-31', `${r2.start} → ${r2.end}`)
check('THE ROADMAP: no dates, no bar; TBC (2027) runs to December and says so', !rmap.find((r) => r.label === 'LOI Autocheck').end && rmap.find((r) => r.label === 'Supplier Inquiry system').bar === '→ 2027')

console.log('\n--- what the server keeps ---')
const dirty = cleanDeck({
  title: '', slides: [{ kind: 'nope', elements: [{ type: 'script', x: 1 }, { type: 'text', text: 'hi', x: 'a', style: { color: 'red', fontSize: 9999, onclick: 'x' } }, { type: 'card', data: { projectKey: 'not a key', title: 'T', accomplishment: 'a\nb' } }] }],
})
check('AN UNKNOWN ELEMENT TYPE IS DROPPED', dirty.slides[0].elements.length === 2)
check('  an unknown slide kind becomes blank, a missing title "Untitled deck"', dirty.slides[0].kind === 'blank' && dirty.title === 'Untitled deck')
check('  a colour that is not #RRGGBB is dropped, a size is clamped, unknown style keys go', !('color' in dirty.slides[0].elements[0].style) && dirty.slides[0].elements[0].style.fontSize === 160 && !('onclick' in dirty.slides[0].elements[0].style))
check('  a bad project key is dropped; lines become a list', dirty.slides[0].elements[1].data.projectKey === null && JSON.stringify(dirty.slides[0].elements[1].data.accomplishment) === '["a","b"]')

/* ------------------------------------------------------------ fake LLM */

const calls = []
const fake = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const j = JSON.parse(body || '{}')
    calls.push(j)
    const sys = j.messages?.find((m) => m.role === 'system')?.content || ''
    const last = j.messages?.[j.messages.length - 1]?.content || ''
    const reply = (content) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] })) }
    if (/edit the text on presentation slides/.test(sys)) {
      const items = JSON.parse(last.slice(last.indexOf('{'))).items
      return reply(`Here: ${JSON.stringify({ items: [...items.map((x) => ({ id: x.id, text: x.text.toUpperCase() })), { id: 'not-asked', text: 'x' }] })}`)
    }
    // Before the cards: the plan's own prompt mentions "project-update cards".
    if (/plan slide decks/.test(sys)) {
      return reply(JSON.stringify({ title: 'IT Gov', slides: [{ kind: 'cover', title: 'IT Gov' }, { kind: 'updates', title: 'Finance', projectKeys: ['FNP-379', 'FNP-NOPE-1'] }, { kind: 'bogus' }] }))
    }
    if (/write project-update cards/.test(sys)) {
      const keys = [...last.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1])
      return reply(JSON.stringify({ cards: keys.map((k) => ({ key: k, accomplishment: ['• Built it.'], impact: ['Faster close'], next: ['UAT'] })).concat([{ key: 'FNP-999999', accomplishment: ['x'] }]) }))
    }
    return reply('ok')
  })
})
await new Promise((r) => fake.listen(5415, r))

console.log('\nstarting a real mongod…')
const mongod = await MongoMemoryServer.create()
const PORT = 5365
const base = `http://127.0.0.1:${PORT}`
const TOKEN = 'deck-service-token-'.padEnd(48, '7')
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
    LOTUS_LLM_URL: 'http://127.0.0.1:5415/llm/v1/chat/completions',
    LOTUS_API_KEY: 'test-key-not-real',
  },
  stdio: ['ignore', 'ignore', 'pipe'],
})
server.stderr.on('data', (b) => { if (/Error|error/.test(String(b))) process.stderr.write(`   [server] ${b}`) })
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 300))
}

const call = async (method, path, body, who) => {
  const headers = { 'Content-Type': 'application/json' }
  if (who === 'service') headers.authorization = `Bearer ${TOKEN}`
  else if (who) headers.cookie = who
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const type = res.headers.get('content-type') || ''
  return { status: res.status, type, body: type.includes('json') ? await res.json().catch(() => ({})) : Buffer.from(await res.arrayBuffer()), cookie: (res.headers.get('set-cookie') || '').split(';')[0] }
}
const signUp = async (email) => {
  await call('POST', '/api/auth/register', { email, password: 'password1' })
  if (email !== 'boss@lotuss.com') await call('PUT', `/api/auth/users/${email}`, { status: 'active' }, 'service')
  return (await call('POST', '/api/auth/login', { email, password: 'password1' })).cookie
}

try {
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  await call('PUT', '/api/scenarios/Baseline', { payload: seed, updatedBy: 'test' }, 'service')
  const boss = await signUp('boss@lotuss.com')
  const james = await signUp('james@lotuss.com')
  const kade = await signUp('kade@lotuss.com')

  console.log('\n--- the shared list ---')
  check('a stranger cannot list the decks', (await call('GET', '/api/decks')).status === 401)
  const made = await call('POST', '/api/decks', { title: 'IT Gov 13 Nov', date: '2026-11-13', slides: std }, james)
  const id = made.body.deck?.id
  check('A TEAM MEMBER CAN MAKE A DECK', made.status === 200 && !!id && made.body.deck.slides.length === 7)
  const list = await call('GET', '/api/decks', undefined, kade)
  check('  AND ANOTHER MEMBER SEES IT IN THE ONE SHARED LIST', list.body.decks?.some((d) => d.id === id && d.slideCount === 7 && d.first?.kind === 'cover'))
  const opened = await call('GET', `/api/decks/${id}`, undefined, kade)
  const deck = opened.body.deck
  deck.slides[0].elements[0].text = 'Edited by Kade'
  const s1 = await call('PUT', `/api/decks/${id}`, { ...deck, rev: deck.rev }, kade)
  check('  AND CAN EDIT IT', s1.status === 200 && s1.body.deck.rev === deck.rev + 1 && s1.body.deck.updatedBy === 'kade@lotuss.com')
  const stale = await call('PUT', `/api/decks/${id}`, { ...deck, title: 'Old copy', rev: deck.rev }, boss)
  check('A SAVE FROM AN OLDER COPY IS REFUSED, NOT SILENTLY UNDONE', stale.status === 409 && stale.body.deck?.slides[0].elements[0].text === 'Edited by Kade', `${stale.status} ${stale.body.error}`)
  check('  and says who saved in between', /kade@lotuss\.com/.test(stale.body.error || ''))
  check('ONLY THE MAKER OR AN ADMINISTRATOR DELETES A DECK — not another member', (await call('DELETE', `/api/decks/${id}`, undefined, kade)).status === 403)

  console.log('\n--- pictures ---')
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const a = await call('POST', '/api/decks/assets', { dataUrl: png, name: 'dot.png' }, james)
  check('A MEMBER CAN ADD A SCREENSHOT', a.status === 200 && !!a.body.id)
  const got = await call('GET', `/api/decks/assets/${a.body.id}`, undefined, kade)
  check('  served back as the picture it was', got.status === 200 && got.type === 'image/png' && got.body.length > 60)
  check('  but not to a stranger', (await call('GET', `/api/decks/assets/${a.body.id}`)).status === 401)
  check('a file that is not a picture is refused', (await call('POST', '/api/decks/assets', { dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }, james)).status === 400)
  check('THE DECK PICTURES (LOGO, COVER) ARE AN ADMINISTRATOR\'S TO SET', (await call('PUT', '/api/decks/brand', { logo: a.body.id }, james)).status === 403)
  const br = await call('PUT', '/api/decks/brand', { logo: a.body.id }, boss)
  check('  an administrator sets them, and everybody reads them', br.status === 200 && (await call('GET', '/api/decks/brand', undefined, kade)).body.brand?.logo === a.body.id)
  check('  a picture that does not exist cannot be set', (await call('PUT', '/api/decks/brand', { cover: 'doesnotexist12' }, boss)).status === 400)

  console.log('\n--- a project, for the drill-down ---')
  const f = await call('POST', '/api/decks/facts', { keys: ['FNP-379', 'bad key'] }, kade)
  check('A MEMBER GETS ANY PROJECT\'S FACTS FOR A SLIDE (as agreed: decks carry the whole team)', f.status === 200 && f.body.facts['FNP-379']?.project?.summary && !('bad key' in f.body.facts))
  check('  one project on its own too', (await call('GET', '/api/decks/project/FNP-379', undefined, kade)).body.project?.key === 'FNP-379')

  console.log('\n--- the AI ---')
  const rw = await call('POST', '/api/decks/ai', { mode: 'rewrite', instruction: 'shout', items: [{ id: 'a', text: 'hello' }, { id: 'b|impact', text: 'one\ntwo' }] }, kade)
  check('REWRITE: the same ids come back, rewritten', rw.status === 200 && JSON.stringify(rw.body.items) === JSON.stringify([{ id: 'a', text: 'HELLO' }, { id: 'b|impact', text: 'ONE\nTWO' }]), JSON.stringify(rw.body))
  check('  an id that was not asked about is dropped', !rw.body.items?.some((x) => x.id === 'not-asked'))
  check('  and nothing to rewrite is a clear error', (await call('POST', '/api/decks/ai', { mode: 'rewrite', instruction: 'x', items: [] }, kade)).status === 400)
  const dr = await call('POST', '/api/decks/ai', { mode: 'draft', keys: ['FNP-379'], tasks: { 'FNP-379': ['Reconcile the Q4 forecast (In Progress)'] } }, kade)
  check('DRAFT: a card for the project, bullets cleaned', dr.status === 200 && JSON.stringify(dr.body.cards) === JSON.stringify([{ key: 'FNP-379', accomplishment: ['Built it.'], impact: ['Faster close'], next: ['UAT'] }]), JSON.stringify(dr.body))
  const sent = JSON.stringify(calls[calls.length - 1])
  check('  written from the project\'s facts and its Jira tasks', /FNP-379/.test(sent) && /Reconcile the Q4 forecast/.test(sent))
  const pl = await call('POST', '/api/decks/ai', { mode: 'plan', request: 'IT Gov deck', projects: [{ key: 'FNP-379', summary: 'PL Forecast', team: 'Finance' }] }, kade)
  check('BUILD: the slides come back, with only real project keys and kinds', pl.status === 200 && pl.body.slides.length === 2 && JSON.stringify(pl.body.slides[1].projectKeys) === '["FNP-379"]', JSON.stringify(pl.body))

  console.log('\n--- the initiative list on the server ---')
  check('THE LIST STARTS EMPTY', (await call('GET', '/api/decks/initiatives', undefined, kade)).body.items?.length === 0)
  const l1 = await call('PUT', '/api/decks/initiatives', { items, rev: 0 }, kade)
  check('A MEMBER CAN FILL IT', l1.status === 200 && l1.body.items.length === items.length && l1.body.rev === 1, `${l1.status} ${l1.body.error || ''}`)
  check('  and everybody reads the same list', (await call('GET', '/api/decks/initiatives', undefined, james)).body.items[0].name === 'AI Sales Forecast')
  const l2 = await call('PUT', '/api/decks/initiatives', { items: items.slice(0, 2), rev: 0 }, james)
  check('A SAVE FROM AN OLDER COPY IS REFUSED, with the newer list', l2.status === 409 && l2.body.list?.items?.length === items.length)
  const l3 = await call('PUT', '/api/decks/initiatives', { items: [{ name: 'Orphan', parentId: 'gone12', status: 'x' }, { name: '' }], rev: 1 }, james)
  check('  a milestone whose initiative is gone becomes an initiative; a nameless line is dropped', l3.status === 200 && l3.body.items.length === 1 && l3.body.items[0].parentId === null)

  console.log('\n--- deleting ---')
  check('THE MAKER CAN DELETE THEIR DECK', (await call('DELETE', `/api/decks/${id}`, undefined, james)).body.deleted === 1)
  check('  and it is gone for everybody', (await call('GET', `/api/decks/${id}`, undefined, kade)).status === 404)
} catch (e) {
  check('the suite crashed', false, e.stack)
} finally {
  server.kill()
  fake.close()
  await mongod.stop()
}

console.log(failures ? `\n${failures} FAILED` : '\nall deck checks passed')
process.exit(failures ? 1 : 0)
