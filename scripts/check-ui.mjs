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
// The app warns before unloading with unsaved changes. That guard is working
// as intended; here it would block the test's navigations, so accept it.
page.on('dialog', (d) => d.accept().catch(() => {}))

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

  /* ---------- the lead's card must show the TEAM ---------- */
  await page.goto(`${base}/#people`, { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 700))

  const leadCard = await page.evaluate(() => ({
    label: document.body.innerText.includes('TEAM SAVING HOURS'),
    personalLabel: document.body.innerText.includes('CREDITED SAVING HOURS'),
    teamWording: document.body.innerText.includes("carries the team's overall KPI"),
    value: document.body.innerText.match(/TEAM SAVING HOURS[\s\S]*?([\d,]+)\s*\n?\s*hrs/)?.[1] ?? null,
  }))
  check('the lead card is labelled as the team, not personal',
    leadCard.label && !leadCard.personalLabel, JSON.stringify(leadCard))
  check('it says it carries the team KPI', leadCard.teamWording)
  // The lead's own tab also shows the team figure, so it cannot supply his
  // personal slice; check-lead.mjs proves the exact sum at model level. Here,
  // assert the card and its tab agree and that the figure genuinely spans the
  // team rather than one person.
  const tabTotals = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')]
      .map((t) => t.innerText.match(/([\d,.]+)\s*hrs/)?.[1])
      .filter(Boolean)
      .map((s) => Number(s.replace(/,/g, ''))))
  const leadValue = Number((leadCard.value || '0').replace(/,/g, ''))
  check('the lead card and the lead tab agree', Math.abs(leadValue - tabTotals[0]) <= 1,
    `card ${leadValue} vs tab ${tabTotals[0]}`)
  check('the lead figure spans the whole team',
    leadValue > tabTotals.slice(1).reduce((a, b) => a + b, 0),
    `lead ${leadValue} > others ${tabTotals.slice(1).reduce((a, b) => a + b, 0)}`)
  check('and exceeds every individual member',
    tabTotals.slice(1).every((v) => leadValue > v), tabTotals.join(', '))
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

  /* ---------- weights on the 5-point grid ---------- */
  await page.evaluate(() => localStorage.clear())
  // A hash-only change is not a navigation, so goto would hang waiting for one.
  await page.goto(`${base}/?fresh=1#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))

  // The weight input is the LAST right-aligned input in a KPI row; the target
  // input sits before it and is also right-aligned when it holds hours.
  const weightsOf = () => page.evaluate(() =>
    [...document.querySelectorAll('tbody tr')]
      .filter((r) => /^(Corporate|Delivery|Capability)/i.test(r.innerText))
      .map((r) => {
        const i = [...r.querySelectorAll('input')].filter((x) => x.style.textAlign === 'right').pop()
        return i ? Number(i.value) : null
      })
      .filter((v) => v !== null))

  const w = await weightsOf()
  check('every weight on screen is a multiple of 5', w.length > 0 && w.every((v) => v % 5 === 0), w.join(' / '))
  check('they total 100%', w.reduce((a, b) => a + b, 0) === 100, String(w.reduce((a, b) => a + b, 0)))

  /* ---------- clicking a KPI line filters the portfolio ---------- */
  // Headers are uppercased by the theme, so match case-insensitively.
  const portfolioCount = () => page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    if (!heads.length) return 0
    return heads[heads.length - 1].closest('table').querySelectorAll('tbody tr').length
  })

  const allRows = await portfolioCount()
  check('the portfolio lists the whole book to start', allRows > 20, String(allRows))

  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 2 — F&A process automation'))
    row.querySelector('td:nth-child(2)').click()
  })
  await new Promise((r) => setTimeout(r, 600))

  const filtered = await portfolioCount()
  check('clicking a KPI line filters the portfolio', filtered > 0 && filtered < allRows,
    `${allRows} -> ${filtered}`)
  check('the filter chip appears',
    await page.evaluate(() => document.body.innerText.includes('Process automation')))
  check('every remaining row belongs to that objective',
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
      const table = heads[heads.length - 1].closest('table')
      return [...table.querySelectorAll('tbody tr')].every((r) => r.innerText.includes('Obj 2'))
    }))

  // clicking again clears it
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 2 — F&A process automation'))
    row.querySelector('td:nth-child(2)').click()
  })
  await new Promise((r) => setTimeout(r, 600))
  check('clicking again clears the filter', (await portfolioCount()) === allRows)

  // editing a weight must not toggle the filter
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 2 — F&A process automation'))
    const inp = [...row.querySelectorAll('input')].find((x) => x.style.textAlign === 'right' && x.value.length <= 3)
    inp.focus(); inp.blur()
  })
  await new Promise((r) => setTimeout(r, 400))
  check('touching the weight input does not toggle the filter', (await portfolioCount()) === allRows)

  /* ---------- editing the portfolio ---------- */
  const teamHeadline = () => page.evaluate(() =>
    Number((document.body.innerText.match(/TEAM SAVING HOURS[\s\S]*?([\d,]+)\s*\n?\s*hrs/)?.[1] ?? '0').replace(/,/g, '')))
  const before2 = await teamHeadline()

  const bumped = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    const table = heads[heads.length - 1].closest('table')
    const row = [...table.querySelectorAll('tbody tr')][0]
    const inp = [...row.querySelectorAll('input')].find((x) => x.style.textAlign === 'right')
    const was = Number(inp.value)
    inp.focus(); setter.call(inp, String(was + 100)); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
    return was
  })
  await new Promise((r) => setTimeout(r, 700))
  check('the portfolio saving-hours cell is editable', Number.isFinite(bumped), String(bumped))
  check('editing it moves the team headline', (await teamHeadline()) === before2 + 100,
    `${before2} -> ${await teamHeadline()}`)
  check('and the header total moves with it',
    (await page.evaluate(() => document.body.innerText.match(/([\d,]+)\s*\/\s*3,000 hrs/)?.[1])) ===
      (before2 + 100).toLocaleString('en-US'))
  check('weights are still on the grid after the edit',
    (await weightsOf()).every((v) => v % 5 === 0))
} catch (e) {
  failures++
  console.log(`FAIL  unexpected error — ${e.message}`)
} finally {
  await browser.close()
  server.kill()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
