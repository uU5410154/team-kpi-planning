/**
 * A held finish date, and the sync that must not touch it.
 *
 * Jira stamps its resolution date when somebody drags the last card, and on
 * work delivered months before anybody closed it off that reads as drift
 * nobody caused — with no way to correct it in Jira. So the register holds its
 * own copy on the projects somebody marks, and the whole feature is worth
 * exactly as much as this guarantee: the morning sync leaves that ONE field
 * alone, keeps everything else up to date, and never holds anything by itself.
 *
 *   node scripts/check-heldfinish.mjs
 */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { mergeJira } from '../src/lib/jiraMerge.js'
import {
  computePlan, repairState, pinFinishPatch, unpinFinishPatch, driftOf,
} from '../src/lib/model.js'
import { PROJECT_COLUMNS, columnFor } from '../src/lib/projectSheet.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* A project delivered in March, closed off in Jira in June. */
const base = {
  key: 'P1',
  jiraKey: 'FNP-1',
  summary: 'Delivered in March, closed in June',
  pic: 'kade',
  objective: 'efficiency',
  commitLevel: 'commit',
  start: '2026-01-05',
  due: '2026-03-31',
  actualStart: '2026-01-05',
  actualEnd: '2026-06-30',
  savingHours: 10,
}
const jira = {
  issues: [{
    key: 'FNP-1',
    summary: 'Delivered in March, closed in June',
    start: '2026-01-05',
    due: '2026-03-31',
    created: '2026-01-02',
    resolved: '2026-06-30',
    done: true,
    started: true,
  }],
  epics: [],
  rollups: {
    'FNP-1': {
      total: 2, done: 2, allDone: true, anyStarted: true, started: true,
      latestResolved: '2026-06-30', latestDue: '2026-06-30', latestDelayDue: null, delayKey: null,
    },
  },
}

const state = (projects) => ({ projects, people: [], settings: {} })

console.log('— the patch helpers —')
const held = { ...base, ...pinFinishPatch(base, '2026-03-30') }
check('holding writes the date and the flag together',
  held.actualEnd === '2026-03-30' && held.actualEndPinned === true)
check('holding with no date given keeps the one it has',
  pinFinishPatch(base, null).actualEnd === '2026-06-30')
check('holding a project with nothing to hold is refused',
  pinFinishPatch({ key: 'x' }, null).actualEndPinned === false,
  JSON.stringify(pinFinishPatch({ key: 'x' }, null)))
check('a bad date is not a date', pinFinishPatch(base, '2026-02-31').actualEnd === '2026-06-30')
check('releasing leaves the date for the sync to correct',
  unpinFinishPatch().actualEndPinned === false && !('actualEnd' in unpinFinishPatch()))
check('the repairs refuse a held blank',
  repairState(state([{ ...base, actualEnd: null, actualEndPinned: true }])).projects[0].actualEndPinned === false)

console.log('\n— the sync —')
const unheldAfter = mergeJira(state([{ ...base, actualEnd: '2026-03-30' }]), jira, {})
check('WITHOUT a hold, the sync takes Jira\'s date',
  unheldAfter.projects[0].actualEnd === '2026-06-30', unheldAfter.projects[0].actualEnd)
check('...and says it changed something', unheldAfter.updated === 1)
check('...and holds nothing of its own accord',
  unheldAfter.projects[0].actualEndPinned !== true && unheldAfter.pinned === 0)

const after = mergeJira(state([held]), jira, {})
check('WITH a hold, the sync leaves the date alone',
  after.projects[0].actualEnd === '2026-03-30', after.projects[0].actualEnd)
check('...and the hold survives it', after.projects[0].actualEndPinned === true)
check('...and the sync reports what it left alone', after.pinned === 1, String(after.pinned))
// It DID change something — the task counts, which this project did not have
// yet. What matters is that the finish was not among them.
check('...while still taking the task counts',
  after.projects[0].tasksTotal === 2 && after.projects[0].tasksDone === 2)
check('...and a second run then changes nothing at all',
  mergeJira(state([after.projects[0]]), jira, {}).updated === 0)

/* Everything else about a held project must still follow Jira. */
const moved = {
  issues: [{ ...jira.issues[0], summary: 'Renamed in Jira', start: '2026-02-02' }],
  epics: [],
  rollups: { 'FNP-1': { ...jira.rollups['FNP-1'], total: 5, done: 5 } },
}
const afterMoved = mergeJira(state([held]), moved, {})
const p2 = afterMoved.projects[0]
check('a held project still takes its name from Jira', p2.summary === 'Renamed in Jira', p2.summary)
check('a held project still takes its start date from Jira', p2.start === '2026-02-02', p2.start)
check('a held project still counts its tasks', p2.tasksTotal === 5 && p2.tasksDone === 5)
check('and STILL will not give up the finish date', p2.actualEnd === '2026-03-30', p2.actualEnd)

/* Running it twice must not walk anything back. */
const twice = mergeJira(state([p2]), moved, {})
check('a second sync is a no-op', twice.updated === 0 && twice.projects[0].actualEnd === '2026-03-30')

/* Releasing it hands the field back. */
const released = { ...p2, ...unpinFinishPatch() }
const afterRelease = mergeJira(state([released]), jira, {})
check('released, the next sync takes Jira\'s date back',
  afterRelease.projects[0].actualEnd === '2026-06-30', afterRelease.projects[0].actualEnd)

console.log('\n— what it does to the score —')
const drifting = computePlan(repairState(state([{ ...base }])))
const fixed = computePlan(repairState(state([held])))
const dOld = driftOf(drifting.projects[0])
const dNew = driftOf(fixed.projects[0])
check('the late date drifts', dOld.drifted === true, `${dOld.days} days of ${Math.round(dOld.allowance)} allowed`)
check('the held date does not', dNew.drifted === false, `${dNew.days} days of ${Math.round(dNew.allowance)} allowed`)
check('and the allowance itself is unchanged — only what was spent against it',
  dOld.allowance === dNew.allowance, `${dOld.allowance}`)
check('the saving hours are untouched either way',
  drifting.totals.committedHours === fixed.totals.committedHours,
  String(fixed.totals.committedHours))
check('a held date is still shown as an outcome, not as a plan',
  fixed.projects[0].timeline.actualEnd === '2026-03-30'
  && fixed.projects[0].timeline.plannedEnd === '2026-03-31')

console.log('\n— the register sheet —')
check('the finish column round-trips', !!columnFor('Finished'))
check('the hold column round-trips', !!columnFor('Finish held'))
const flag = PROJECT_COLUMNS.find((c) => c.key === 'actualEndPinned')
check('"yes" holds it', flag.parse('yes') === true && flag.parse('Y') === true && flag.parse('HELD') === true)
check('"no" releases it', flag.parse('no') === false && flag.parse('FALSE') === false)
check('A BLANK CHANGES NOTHING', flag.parse('') === undefined && flag.parse(null) === undefined)
check('it reads back as a word', flag.read({ actualEndPinned: true }) === 'yes' && flag.read({}) === '')

/* ---------- and the switch a person actually uses ---------- */

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const exe = BROWSERS.find((x) => existsSync(x))
if (!exe) {
  console.log('\nSKIP — no Chromium-based browser found')
  console.log(failures ? `\n${failures} failed` : '\nall good')
  process.exit(failures ? 1 : 0)
}

console.log('\n— the switch —')
const PORT = 5337
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), MONGODB_URI: '' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const url = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1700, height: 1000 })
page.on('dialog', (d) => d.accept().catch(() => {}))
await page.goto(`${url}/#projects`, { waitUntil: 'networkidle2' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1000))

/** What the browser has stored for one project. */
const stored = (jiraKey) => page.evaluate((k) => {
  const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026') || '{}')
  const p = (st.projects || []).find((x) => x.jiraKey === k)
  return p ? { actualEnd: p.actualEnd || null, held: p.actualEndPinned === true } : null
}, jiraKey)

/*
 * A project with a commitment and no recorded finish — which is every project
 * in the seed, and the case the fallback exists for: holding a date on a
 * project that has none takes the date it was committed to.
 */
const target = await page.evaluate(() => {
  const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026') || '{}')
  const p = (st.projects || []).find((x) => x.due && x.jiraKey)
  return p ? p.jiraKey : null
})
check('the register has a project to work on', !!target, String(target))

const openDialog = await page.evaluate((k) => {
  const row = [...document.querySelectorAll('tbody tr')]
    .find((r) => [...r.querySelectorAll('input')].some((i) => i.value === k))
  if (!row) return false
  const btn = row.querySelector('[aria-label="open cost breakdown"]')
  if (!btn) return false
  btn.click()
  return true
}, target)
check('its dialog opens from the register', openDialog)
await new Promise((r) => setTimeout(r, 700))

const hasBlock = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  return !!dlg && dlg.innerText.includes('Finish date') && dlg.innerText.includes('Hold this date')
})
check('the dialog offers the hold', hasBlock)
check('and says it is following Jira until then', await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  return !!dlg && dlg.innerText.includes('Following Jira')
}))
check('the date is not editable while the sync owns it', await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const input = [...dlg.querySelectorAll('input[type="date"]')].pop()
  return !!input && input.disabled
}))

const was = await stored(target)
await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const sw = [...dlg.querySelectorAll('input[type="checkbox"]')].pop()
  sw.click()
})
await new Promise((r) => setTimeout(r, 500))
const now = await stored(target)
const due = await page.evaluate((k) => {
  const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026') || '{}')
  return (st.projects || []).find((x) => x.jiraKey === k)?.due || null
}, target)
check('the switch holds it', now?.held === true, JSON.stringify(now))
check('...at the date it had, or the one it was committed to',
  now?.actualEnd === (was?.actualEnd || due), `${was?.actualEnd || '—'} / due ${due} → ${now?.actualEnd}`)
check('...and the date becomes editable', await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const input = [...dlg.querySelectorAll('input[type="date"]')].pop()
  return !!input && !input.disabled
}))
check('...and the dialog says so', await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  return dlg.innerText.includes('Held.') && dlg.innerText.includes('leaves the finish date')
}))

/* Set a date by hand — the correction the whole feature exists for. */
await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const input = [...dlg.querySelectorAll('input[type="date"]')].pop()
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, '2026-02-02')
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
})
await new Promise((r) => setTimeout(r, 500))
check('a date typed by hand is stored', (await stored(target))?.actualEnd === '2026-02-02',
  JSON.stringify(await stored(target)))
check('...and it is still held', (await stored(target))?.held === true)

/* The timeline says which projects are held, without opening anything. */
await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const close = [...dlg.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close')
  close?.click()
})
await page.goto(`${url}/#timeline`, { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1500))
check('the timeline marks a held project on its row',
  await page.evaluate(() => document.body.innerText.includes('finish held')))

/* Releasing it hands the field back. */
await page.goto(`${url}/#projects`, { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 900))
await page.evaluate((k) => {
  const row = [...document.querySelectorAll('tbody tr')]
    .find((r) => [...r.querySelectorAll('input')].some((i) => i.value === k))
  row.querySelector('[aria-label="open cost breakdown"]').click()
}, target)
await new Promise((r) => setTimeout(r, 700))
await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"]')
  const sw = [...dlg.querySelectorAll('input[type="checkbox"]')].pop()
  sw.click()
})
await new Promise((r) => setTimeout(r, 500))
const back = await stored(target)
check('releasing clears the hold', back?.held === false, JSON.stringify(back))
check('...and leaves the date for the sync to correct', back?.actualEnd === '2026-02-02')

await browser.close()
server.kill()
console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
