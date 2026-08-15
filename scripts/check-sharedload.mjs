/**
 * A machine that has never opened the app gets the shared plan.
 *
 * The app boots from the browser it is running in, which is right for work in
 * progress and wrong on a second computer: with nothing in local storage it
 * fell back to the bundled seed, and every manday, cost and return read empty
 * as though the database were not connected at all.
 *
 * What must hold:
 *   1. a blank browser loads the most recent scenario from the database, and
 *      the mandays that were saved are on screen;
 *   2. a browser that already holds a plan is NEVER overwritten — it is told a
 *      newer one exists and left alone;
 *   3. with no database reachable the app still opens on the browser's own
 *      copy rather than failing.
 *
 * Runs a real mongod and the real server. Run with:
 *   node scripts/check-sharedload.mjs
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { MongoClient } from 'mongodb'
import { readFileSync } from 'node:fs'

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const exe = BROWSERS.find((p) => existsSync(p))
if (!exe) { console.log('SKIP — no Chromium-based browser found'); process.exit(0) }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))

// A plan with mandays on it — the thing that was missing on the second machine.
const MANDAY_ON = 42
const saved = {
  people: seed.people,
  projects: seed.projects.map((p) => (p.savingHours > 0 ? { ...p, manday: MANDAY_ON } : p)),
  settings: {},
  repair: 2,
}
const withMandays = saved.projects.filter((p) => p.manday === MANDAY_ON).length

const mongod = await MongoMemoryServer.create()
const uri = mongod.getUri('team_kpi_planning')
const client = new MongoClient(uri)
await client.connect()
await client.db('team_kpi_planning').collection('kpi_scenarios').insertOne({
  name: 'Baseline',
  payload: saved,
  updatedAt: new Date().toISOString(),
  updatedBy: 'the other computer',
})
await client.close()

const PORT = 5324
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), MONGODB_URI: uri },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 500))
}

const health = await (await fetch(`${base}/api/health`)).json()
check('the server reaches the database', health?.store?.connected === true, JSON.stringify(health?.store))

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })

try {
  /* ---------- 1. a browser that has never held a plan ---------- */
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 1000 })
  page.on('dialog', (d) => d.accept())
  await page.goto(`${base}/#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?fresh=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3000))

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('fa-tech-kpi-2026')
    if (!raw) return null
    const st = JSON.parse(raw)
    return {
      scenario: st.scenarioName,
      withMandays: st.projects.filter((p) => (p.manday || 0) > 0).length,
      sample: st.projects.find((p) => (p.manday || 0) > 0)?.manday ?? null,
    }
  })
  // Not by the scenario NAME: freshState calls its own plan "Baseline" too, so
  // that check passed on a browser that had loaded nothing at all.
  check('A BLANK BROWSER LOADS THE SHARED PLAN',
    stored?.withMandays === withMandays, JSON.stringify(stored))
  check('AND THE MANDAYS ARE THERE, NOT EMPTY',
    stored?.withMandays === withMandays && stored?.sample === MANDAY_ON,
    `${stored?.withMandays} of ${withMandays} projects, first reads ${stored?.sample}`)

  const onScreen = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.findIndex((h) => h.startsWith('manday'))
    const row = document.querySelector('tbody tr')
    return row ? (row.children[ix]?.querySelector('input')?.value ?? row.children[ix]?.innerText.trim()) : null
  })
  check('and the register shows them on screen',
    String(onScreen).replace(/,/g, '') === String(MANDAY_ON), String(onScreen))

  const toldSo = await page.evaluate(() => document.body.innerText)
  check('the app says where the plan came from', /shared database/i.test(toldSo),
    (toldSo.match(/Loaded[^\n]*/) || [''])[0])

  /* ---------- 1b. a SECOND visit, the seed already mirrored ---------- */
  // The app writes state to local storage on mount, so a window that has only
  // opened the app is holding a copy of the seed. It reported that as work in
  // progress and refused to take the shared plan — which is what an incognito
  // window did on its second load.
  await page.evaluate((seedProjects) => {
    const raw = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    // Exactly what a window that has only OPENED the app is holding: the
    // bundled seed, mirrored on mount, with no record of ever having agreed
    // with the database.
    delete raw.syncHash
    delete raw.syncedAt
    raw.projects = seedProjects
    localStorage.setItem('fa-tech-kpi-2026', JSON.stringify(raw))
  }, seed.projects)
  await page.goto(`${base}/?again=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3000))
  const second = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    return {
      withMandays: st.projects.filter((p) => (p.manday || 0) > 0).length,
      notice: /shared database was saved/i.test(document.body.innerText),
    }
  })
  check('A SECOND VISIT WITH NOTHING OF ITS OWN STILL TAKES THE SHARED PLAN',
    second.withMandays === withMandays, JSON.stringify(second))
  check('and is not told to open it by hand', second.notice === false, JSON.stringify(second))

  /* ---------- 1c. in sync, and the database moves on ---------- */
  /*
   * The case that had somebody staring at a stale register: this browser
   * loaded the shared plan and typed nothing, then somebody else saved to the
   * database. Holding a copy is not the same as having work in it — with
   * nothing of its own to lose, it must move on too, or it shows last week's
   * register indefinitely and reads as "the data was never ingested".
   */
  const client2 = new MongoClient(uri)
  await client2.connect()
  await client2.db('team_kpi_planning').collection('kpi_scenarios').updateOne(
    { name: 'Baseline' },
    {
      $set: {
        payload: { ...saved, projects: [...saved.projects, { ...saved.projects[0], key: 'BRAND-NEW-ROW', summary: 'Added by somebody else', manday: 99 }] },
        updatedAt: new Date(Date.now() + 60000).toISOString(),
        updatedBy: 'somebody else',
      },
    },
  )
  await client2.close()

  await page.goto(`${base}/?moved=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3500))
  const moved = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    return {
      rows: st.projects.length,
      hasNew: st.projects.some((p) => p.key === 'BRAND-NEW-ROW'),
      notice: /shared database was saved/i.test(document.body.innerText),
    }
  })
  check('AN UNTOUCHED BROWSER TAKES A NEWER SHARED PLAN', moved.hasNew, JSON.stringify(moved))
  check('without anybody having to be told', moved.notice === false, JSON.stringify(moved))

  /* ---------- 2. a browser that already holds work ---------- */
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    raw.scenarioName = 'My own work in progress'
    raw.projects = raw.projects.map((p) => ({ ...p, manday: p.manday ? 7 : p.manday }))
    localStorage.setItem('fa-tech-kpi-2026', JSON.stringify(raw))
  })
  await page.goto(`${base}/?mine=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 3000))

  const mine = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    return {
      scenario: st.scenarioName,
      sample: st.projects.find((p) => (p.manday || 0) > 0)?.manday ?? null,
      notice: /shared database was saved/i.test(document.body.innerText),
    }
  })
  check('WORK ALREADY IN THE BROWSER IS NOT OVERWRITTEN',
    mine?.sample === 7 && mine?.scenario === 'My own work in progress', JSON.stringify(mine))
  check('but it is told a newer plan is waiting', mine?.notice === true, JSON.stringify(mine))

  /* ---------- 3. no database at all ---------- */
  const noDbPort = 5325
  const noDb = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(noDbPort), MONGODB_URI: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const noDbBase = `http://127.0.0.1:${noDbPort}`
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${noDbBase}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  const p2 = await browser.newPage()
  await p2.goto(`${noDbBase}/#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await p2.evaluate(() => localStorage.clear())
  await p2.goto(`${noDbBase}/?nodb=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // Past the loader's own cap: with no database the app shows what it has
  // rather than waiting on a request that is never going to answer.
  await new Promise((r) => setTimeout(r, 5000))
  const rows = await p2.evaluate(() => document.querySelectorAll('tbody tr').length)
  check('WITH NO DATABASE THE APP STILL OPENS', rows > 10, `${rows} rows`)
  await p2.close()
  noDb.kill()
} finally {
  await browser.close()
  server.kill()
  await mongod.stop()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
