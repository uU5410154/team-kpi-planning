/**
 * Drives the real built app in a real browser — the exact user journey that
 * exposed the bug: edit a project's saving hours on the Projects tab, then
 * check the Scorecards tab shows the new number.
 *
 * Requires a Chromium-based browser. Run with: node scripts/check-ui.mjs
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const exe = BROWSERS.find((p) => existsSync(p))
if (!exe) { console.log('SKIP — no Chromium-based browser found'); process.exit(0) }

const PORT = 5321
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), MONGODB_URI: '' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1700, height: 1000 })

/** Find the Projects-tab row for a Jira key and return its saving-hours input. */
const savingInput = async (jiraKey) =>
  page.evaluateHandle((key) => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => [...r.querySelectorAll('input')].some((i) => i.value === key))
    if (!row) return null
    // column order: jira, project(3 inputs), objective, pic, saving, hc, manday
    const nums = [...row.querySelectorAll('input')].filter((i) => i.style.textAlign === 'right')
    return nums[0] || null
  }, jiraKey)

const scorecardTarget = async (objLabel) =>
  page.evaluate((label) => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => r.innerText.includes(label))
    if (!row) return null
    const inp = [...row.querySelectorAll('input')].find((i) => i.style.textAlign === 'right')
    return inp ? inp.value : null
  }, objLabel)

try {
  /* ---------- start clean ---------- */
  await page.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 800))

  const headline = () => page.evaluate(() => document.body.innerText.match(/([\d,]+)\s*\/\s*3,000 hrs/)?.[1] ?? null)
  check('app loads with the source total', (await headline()) === '4,227', String(await headline()))

  /* ---------- read the scorecard BEFORE ---------- */
  await page.goto(`${base}/#people`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 600))
  // Gun is the team lead, so this line carries the TEAM's objective-1 total.
  // Assert the delta rather than a constant.
  const before = Number(await scorecardTarget('Obj 1 — Financial'))
  check('scorecard shows a live figure before the edit', Number.isFinite(before), String(before))

  /* ---------- edit the project ---------- */
  await page.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 600))
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'FNP-1431')
  await new Promise((r) => setTimeout(r, 500))

  const input = await savingInput('FNP-1431')
  check('found the saving-hours cell for FNP-1431', !!(await input.jsonValue?.()) || !!input)
  await input.click()
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('33')
  await page.keyboard.press('Tab')          // blur commits
  await new Promise((r) => setTimeout(r, 600))

  const projVal = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => [...r.querySelectorAll('input')].some((i) => i.value === 'FNP-1431'))
    const nums = [...row.querySelectorAll('input')].filter((i) => i.style.textAlign === 'right')
    return nums[0].value
  })
  check('project cell now reads 33', projVal === '33', projVal)

  const totalsStrip = await page.evaluate(() => document.body.innerText.match(/SAVING HRS \/ MONTH\s*\n\s*([\d,]+)/)?.[1] ?? null)
  check('filtered totals strip updated', totalsStrip === '33', String(totalsStrip))

  /* ---------- THE BUG: scorecard must follow ---------- */
  await page.goto(`${base}/#people`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 700))
  const after = Number(await scorecardTarget('Obj 1 — Financial'))
  check('SCORECARD FOLLOWED THE +1 EDIT', after === before + 1, `${before} -> ${after}`)

  const driftWarning = await page.evaluate(() => document.body.innerText.includes('no longer match'))
  check('no spurious drift warning', driftWarning === false)

  /* ---------- header total moved by exactly 1 ---------- */
  check('header total is 4,228', (await headline()) === '4,228', String(await headline()))

  /* ---------- a no-op blur on the target must not pin it ---------- */
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => r.innerText.includes('Obj 1 — Financial'))
    const inp = [...row.querySelectorAll('input')].find((i) => i.style.textAlign === 'right')
    inp.focus(); inp.blur()
  })
  await new Promise((r) => setTimeout(r, 400))
  check('focus+blur did not pin the target',
    (await page.evaluate(() => document.body.innerText.includes('no longer match'))) === false)

  await page.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 500))
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'FNP-1431')
  await new Promise((r) => setTimeout(r, 500))
  const input2 = await savingInput('FNP-1431')
  await input2.click()
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('41')
  await page.keyboard.press('Tab')
  await new Promise((r) => setTimeout(r, 600))
  await page.goto(`${base}/#people`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 700))
  check('a second edit still reaches the scorecard', Number(await scorecardTarget('Obj 1 — Financial')) === before + 9,
    String(await scorecardTarget('Obj 1 — Financial')))

  /* ---------- deliberate override still pins ---------- */
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => r.innerText.includes('Obj 1 — Financial'))
    const inp = [...row.querySelectorAll('input')].find((i) => i.style.textAlign === 'right')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    inp.focus(); setter.call(inp, '250'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
  })
  await new Promise((r) => setTimeout(r, 600))
  check('deliberate override sticks', (await scorecardTarget('Obj 1 — Financial')) === '250',
    String(await scorecardTarget('Obj 1 — Financial')))
  check('and is flagged as drifted',
    await page.evaluate(() => document.body.innerText.includes('no longer match')))

  /* ---------- reported crash: filter, then change a PIC ---------- */
  // Removing a KPI line puts a scorecard off 100%, which is what makes the
  // Projects tab render its blocked-save alert. That alert referenced a <Link>
  // that was never imported, so the whole page threw on the next render.
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // Reassignment can no longer break a card — the delivery block absorbs it —
  // so force the blocked state the only way that still can: push the fixed
  // corporate weights past 100%.
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const rows = [...document.querySelectorAll('tbody tr')]
    for (const label of ['CP AXTRA Sales', 'CP AXTRA EAT']) {
      const row = rows.find((r) => r.innerText.includes(label))
      const inp = [...row.querySelectorAll('input')].find((i) => i.style.textAlign === 'right')
      inp.focus(); setter.call(inp, '80'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
    }
  })
  await new Promise((r) => setTimeout(r, 600))

  await page.goto(`${base}/#projects`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 600))
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'FNP-1431')
  await new Promise((r) => setTimeout(r, 600))

  const alertShown = await page.evaluate(() => document.body.innerText.includes('Saving is blocked'))
  check('the blocked-save alert renders on a filtered list', alertShown)

  // change the PIC on the filtered row
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => [...r.querySelectorAll('input')].some((i) => i.value === 'FNP-1431'))
    const combos = [...row.querySelectorAll('[role="combobox"]')]
    combos[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"]')]
    const kade = opts.find((o) => o.textContent.includes('Kade'))
    if (kade) kade.click()
  })
  await new Promise((r) => setTimeout(r, 700))

  check('changing PIC on a filtered list throws nothing', errors.length === 0, errors.join(' | '))
  const stillRendered = await page.evaluate(() =>
    document.body.innerText.includes('Add project') && document.querySelectorAll('tbody tr').length > 0)
  check('the projects table is still rendered afterwards', stillRendered)
} catch (e) {
  failures++
  console.log(`FAIL  unexpected error — ${e.message}`)
} finally {
  await browser.close()
  server.kill()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
