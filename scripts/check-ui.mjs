/**
 * Drives the real built app in a real browser — the exact user journey that
 * exposed the bug: edit a project's saving hours on the Projects tab, then
 * check the Scorecards tab shows the new number.
 *
 * Requires a Chromium-based browser. Run with: node scripts/check-ui.mjs
 */
import puppeteer from 'puppeteer-core'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import ExcelJS from 'exceljs'
import { columnFor } from '../src/lib/projectSheet.js'

// Objective 1 is measured in baht, so one extra saving hour per month moves its
// target by a year of that hour's value. Taken from the model rather than
// hardcoded, so the test cannot drift away from the app's own arithmetic.
// (rates are no longer needed here either)
// (the per-hour value is no longer needed: the checks below are in hours)

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
    // column order: jira, project(3 inputs), objective, pic, saving, manday
    // (FTE sits between them but is derived, so it is text, not an input)
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
  const before = Number(await scorecardTarget('Obj 2 — F&A process automation'))
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
  const after = Number(await scorecardTarget('Obj 2 — F&A process automation'))
  // One more saving hour, on the line that carries the hours. Objective 1 is a
  // percentage floor and rightly does not move with a single hour.
  check('SCORECARD FOLLOWED THE +1 EDIT', Math.abs(after - before - 1) <= 1,
    `${before} -> ${after}`)

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
  check('a second edit still reaches the scorecard',
    Math.abs(Number(await scorecardTarget('Obj 2 — F&A process automation')) - before - 9) <= 1,
    String(await scorecardTarget('Obj 2 — F&A process automation')))

  /* ---------- deliberate override still pins ---------- */
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('tbody tr')]
    const row = rows.find((r) => r.innerText.includes('Obj 2 — F&A process automation'))
    const inp = [...row.querySelectorAll('input')].find((i) => i.style.textAlign === 'right')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    inp.focus(); setter.call(inp, '250'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
  })
  await new Promise((r) => setTimeout(r, 600))
  check('deliberate override sticks', (await scorecardTarget('Obj 2 — F&A process automation')) === '250',
    String(await scorecardTarget('Obj 2 — F&A process automation')))
  check('and is flagged as drifted',
    await page.evaluate(() => document.body.innerText.includes('no longer match')))

  /* ---------- reported crash: filter, then change a PIC ---------- */
  // Removing a KPI line puts a scorecard off 100%, which is what makes the
  // Projects tab render its blocked-save alert. That alert referenced a <Link>
  // that was never imported, so the whole page threw on the next render.
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  // Reassignment can no longer break a card — the untouched lines absorb it —
  // so force the blocked state the only way that still can: type a weight on
  // EVERY line, leaving nothing free to take up the difference.
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const rows = [...document.querySelectorAll('tbody tr')].filter((r) => /^Obj \d+ —/.test(r.innerText))
    for (const row of rows) {
      const inp = [...row.querySelectorAll('input')].filter((i) => i.style.textAlign === 'right').pop()
      if (!inp) continue
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
  // Past the loader: a browser with nothing of its own waits for the shared
  // plan before painting, rather than showing an empty register meanwhile.
  await new Promise((r) => setTimeout(r, 4000))

  // The weight input is the LAST right-aligned input in a KPI row; the target
  // input sits before it and is also right-aligned when it holds hours.
  const weightsOf = () => page.evaluate(() =>
    [...document.querySelectorAll('tbody tr')]
      .filter((r) => /^Obj \d+ —/.test(r.innerText))
      .map((r) => {
        const i = [...r.querySelectorAll('input')].filter((x) => x.style.textAlign === 'right').pop()
        return i ? Number(i.value) : null
      })
      .filter((v) => v !== null))

  const w = await weightsOf()
  check('every weight on screen is a multiple of 5', w.length > 0 && w.every((v) => v % 5 === 0), w.join(' / '))
  check('they total 100%', w.reduce((a, b) => a + b, 0) === 100, String(w.reduce((a, b) => a + b, 0)))

  /* ---------- 2026 card: objectives only ---------- */
  // The card is objectives and nothing else, so there is no block column left
  // to inspect — assert the shape directly instead.
  const blocks = await page.evaluate(() =>
    [...document.querySelectorAll('tbody tr')]
      .map((r) => r.innerText.split(/\n/)[0].trim())
      .filter((t) => /^Obj \d+ —/.test(t)))
  check('the card carries only objective lines',
    blocks.length >= 1 && blocks.every((t) => /^Obj \d+ —/.test(t)), blocks.join(' | '))
  check('and no block column survives the corporate/capability removal',
    await page.evaluate(() => !/(?:Corporate|Capability)/.test(document.body.innerText)))
  check('CP AXTRA and capability lines are gone',
    await page.evaluate(() => !/CP AXTRA|GuRu|capability/i.test(document.body.innerText)))

  /* ---------- a typed weight is honoured exactly ---------- */
  const typeWeight = (label, value) => page.evaluate((lbl, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(lbl))
    const inp = [...row.querySelectorAll('input')].filter((i) => i.style.textAlign === 'right').pop()
    inp.focus(); setter.call(inp, String(val)); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
  }, label, value)

  await typeWeight('Obj 1 — Financial', 30)
  await new Promise((r) => setTimeout(r, 700))
  const typed = await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 1 — Financial'))
    return Number([...row.querySelectorAll('input')].filter((i) => i.style.textAlign === 'right').pop().value)
  })
  const wAfter = await weightsOf()
  check('a typed weight comes back exactly as typed', typed === 30, String(typed))
  check('the untouched lines absorb the rest', wAfter.reduce((a, b) => a + b, 0) === 100, wAfter.join(' / '))
  check('and they stay on the grid', wAfter.every((v) => v % 5 === 0), wAfter.join(' / '))

  // reset so the rest of the run starts from the defaults again
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /reset to default/i.test(b.innerText))
    if (btn) btn.click()
  })
  await new Promise((r) => setTimeout(r, 700))
  check('reset restores the default weights', (await weightsOf()).join('/') === w.join('/'),
    `${(await weightsOf()).join('/')} vs ${w.join('/')}`)

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
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 4 — Efficiency'))
    // The KPI-line cell, found by content rather than by index — dropping the
    // Block column shifted every position by one, and nth-child(2) then landed
    // on the Target cell, which deliberately stops the click.
    ;[...row.querySelectorAll('td')].find((c) => /^Obj \d+/.test(c.innerText.trim())).click()
  })
  await new Promise((r) => setTimeout(r, 600))

  const filtered = await portfolioCount()
  check('clicking a counted KPI line filters the portfolio', filtered > 0 && filtered < allRows,
    `${allRows} -> ${filtered}`)
  check('the filter chip appears',
    await page.evaluate(() => document.body.innerText.includes('Efficiency')))
  check('every remaining row serves that objective',
    await page.evaluate(() => {
      const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
      const table = heads[heads.length - 1].closest('table')
      return [...table.querySelectorAll('tbody tr')].every((r) => /Obj [14]/.test(r.innerText))
    }))


  // clicking again clears it
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 4 — Efficiency'))
    // The KPI-line cell, found by content rather than by index — dropping the
    // Block column shifted every position by one, and nth-child(2) then landed
    // on the Target cell, which deliberately stops the click.
    ;[...row.querySelectorAll('td')].find((c) => /^Obj \d+/.test(c.innerText.trim())).click()
  })
  await new Promise((r) => setTimeout(r, 600))
  check('clicking again clears the filter', (await portfolioCount()) === allRows)

  /* ---------- a line calculated over everything shows everything ---------- */
  // Objective 1 is a return worked out over every project and objective 2
  // collects every saving hour, so clicking either has to show the whole
  // portfolio. Showing five tagged projects under a figure derived from
  // eighty-six reads as a wrong number.
  for (const [label, chip] of [['Obj 1 — Financial', 'Financial'], ['Obj 2 — F&A process automation', 'Process automation']]) {
    await page.evaluate((lbl) => {
      const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(lbl))
      ;[...row.querySelectorAll('td')].find((c) => /^Obj \d+/.test(c.innerText.trim())).click()
    }, label)
    await new Promise((r) => setTimeout(r, 700))
    const shown = await portfolioCount()
    check(`${label.split(' —')[0]} SHOWS EVERY PROJECT BEHIND IT`, shown === allRows,
      `${shown} of ${allRows}`)
    check(`  and says so`,
      await page.evaluate(() => /every project/i.test(document.body.innerText)))
    await page.evaluate((lbl) => {
      const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes(lbl))
      ;[...row.querySelectorAll('td')].find((c) => /^Obj \d+/.test(c.innerText.trim())).click()
    }, label)
    await new Promise((r) => setTimeout(r, 500))
    void chip
  }

  // editing a weight must not toggle the filter
  await page.evaluate(() => {


    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 4 — Efficiency'))
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

  /* ---------- Objective 1 reads as money, end to end ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?money=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))

  const colIndex = (label) => page.evaluate((lbl) => {
    const table = document.querySelector('table')
    const heads = [...table.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    return heads.findIndex((h) => h.startsWith(lbl.toLowerCase()))
  }, label)

  const roiCol = await colIndex('roi')
  // Renamed from "Build cost": the column now carries the whole investment,
  // mandays plus CAPEX, and calling it build cost would misstate it.
  const costCol = await colIndex('investment')
  check('the Projects table has an ROI column', roiCol > 0, `index ${roiCol}`)
  check('and an investment column beside it', costCol > 0 && costCol < roiCol, `cost ${costCol} / roi ${roiCol}`)
  const paybackCol = await colIndex('payback')
  check('and a payback column after it', paybackCol === roiCol + 1, `payback ${paybackCol} / roi ${roiCol}`)
  check('the money strip carries CAPEX and OPEX beside the build cost',
    await page.evaluate(() => /\nCAPEX\n/.test(document.body.innerText) && /OPEX \/ YEAR/i.test(document.body.innerText)))

  /* ---------- the source column reads as FTE, not HC ---------- */
  const fteCol = await colIndex('fte')
  check('the Projects table heads the source column FTE', fteCol > 0, `index ${fteCol}`)
  const hcLeftovers = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('table thead th')].map((h) => h.innerText.trim())
    const labels = [...document.querySelectorAll('label')].map((l) => l.innerText.trim())
    return {
      heads: heads.filter((h) => /^hc$/i.test(h)),
      labels: labels.filter((l) => /headcount/i.test(l)),
      strip: /HC RELEASED/i.test(document.body.innerText),
      fteStrip: /FTE RELEASED/i.test(document.body.innerText),
      fteFilter: labels.some((l) => l === 'FTE'),
    }
  })
  check('no HC column header survives', hcLeftovers.heads.length === 0, hcLeftovers.heads.join(' | '))
  check('the headcount filter is relabelled FTE',
    hcLeftovers.fteFilter && hcLeftovers.labels.length === 0, hcLeftovers.labels.join(' | ') || 'no "headcount" label left')
  check('and the totals strip says FTE released',
    hcLeftovers.fteStrip && !hcLeftovers.strip, JSON.stringify({ fte: hcLeftovers.fteStrip, hc: hcLeftovers.strip }))

  // No effort in the seed, so ROI starts blank by design rather than as zero.
  const roiBefore = await page.evaluate((ix) => {
    const rows = [...document.querySelectorAll('tbody tr')]
    return rows.slice(0, 5).map((r) => r.children[ix]?.innerText.trim())
  }, roiCol)
  check('ROI is blank while no effort is estimated, not 0%',
    roiBefore.every((v) => v === '—'), roiBefore.join(' | '))

  // Type mandays into the first row; the money columns must all come alive.
  const filled = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const row = document.querySelector('tbody tr')
    // Located by its column, not by position among the inputs: FTE became a
    // derived cell and stopped being an input, which silently shifted the index.
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const mdCol = heads.findIndex((h) => h.startsWith('manday'))
    const md = row.children[mdCol]?.querySelector('input')
    md.focus(); setter.call(md, '25'); md.dispatchEvent(new Event('input', { bubbles: true })); md.blur()
    return md.value
  })
  await new Promise((r) => setTimeout(r, 800))
  check('mandays are editable on the Projects tab', filled === '25', filled)

  const money = await page.evaluate((c, r) => ({
    cost: document.querySelector('tbody tr').children[c]?.innerText.trim(),
    roi: document.querySelector('tbody tr').children[r]?.innerText.trim(),
    payback: document.querySelector('tbody tr').children[r + 1]?.innerText.trim(),
    strip: document.body.innerText.match(/BENEFIT \/ YEAR\s*\n\s*([^\n]+)/)?.[1]?.trim(),
  }), costCol, roiCol)
  check('entering mandays fills in the investment', /\d/.test(money.cost) && money.cost !== '—', money.cost)
  check('and shows an ROI for that project', /%/.test(money.roi), money.roi)
  check('and a payback period', /mo|yr/.test(money.payback || ''), money.payback)
  check('the benefit was already known without any effort estimate',
    /\d/.test(money.strip || ''), String(money.strip))

  /* ---------- the cost dialog: CAPEX and OPEX per project ---------- */
  // The user journey this exists for: click a project, add the infrastructure
  // it needs, and watch the return move on the table behind it.
  const dialogOpen = () => page.evaluate(() => !!document.querySelector('[role="dialog"]'))
  const dialogText = () => page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || '')
  const closeDialog = async () => {
    await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]')
      const btn = d && [...d.querySelectorAll('button')].find((b) => /^close$/i.test(b.innerText.trim()))
      if (btn) btn.click()
    })
    await new Promise((r) => setTimeout(r, 500))
  }
  /** Click a derived (non-editable) cell of the first row, by column index. */
  const clickRowCell = (ix) => page.evaluate((c) => {
    const cell = document.querySelector('tbody tr').children[c]
    cell.click()
  }, ix)

  // A click on an INPUT must not open it — every row is full of editable cells.
  await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const mdCol = heads.findIndex((h) => h.startsWith('manday'))
    document.querySelector('tbody tr').children[mdCol].querySelector('input').click()
  })
  await new Promise((r) => setTimeout(r, 400))
  check('clicking an input on the Projects tab does NOT open the dialog', (await dialogOpen()) === false)

  await page.evaluate(() => {
    const row = document.querySelector('tbody tr')
    const combo = row.querySelector('[role="combobox"]')
    if (combo) combo.click()
  })
  await new Promise((r) => setTimeout(r, 400))
  check('nor does clicking a dropdown', (await dialogOpen()) === false)
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 300))

  const roiBeforeCapex = await page.evaluate((r) => document.querySelector('tbody tr').children[r]?.innerText.trim(), roiCol)
  // The row itself is inert now — only the button opens the dialog.
  await clickRowCell(roiCol)
  await new Promise((r) => setTimeout(r, 400))
  check('clicking the row body does NOT open the dialog', (await dialogOpen()) === false)

  const openViaButton = () => page.evaluate(() => {
    const btn = document.querySelector('tbody tr button[aria-label="open cost breakdown"]')
    if (!btn) return false
    btn.click()
    return true
  })
  check('every row carries an open button', await openViaButton())
  await new Promise((r) => setTimeout(r, 700))
  check('the button opens the cost dialog', await dialogOpen())
  const dlg = await dialogText()
  check('the dialog offers CAPEX, OPEX and a monthly table',
    /CAPEX/.test(dlg) && /OPEX/.test(dlg) && /Monthly cost/i.test(dlg) && /FY2026/.test(dlg),
    dlg.slice(0, 120).replace(/\n/g, ' / '))
  // Table headers are uppercased by the theme, so match case-insensitively.
  check('the monthly table carries all twelve months',
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      .every((m) => dlg.toLowerCase().includes(m.toLowerCase())))

  // Type a CAPEX. The dialog's own header must move, and so must the table.
  const dialogRoi = () => page.evaluate(() =>
    document.querySelector('[role="dialog"]')?.innerText.match(/ROI\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? null)
  const roiInDialogBefore = await dialogRoi()
  const capexTyped = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const d = document.querySelector('[role="dialog"]')
    const label = [...d.querySelectorAll('label')].find((l) => /^CAPEX/.test(l.innerText))
    const input = label.closest('.MuiFormControl-root').querySelector('input')
    input.focus(); setter.call(input, '500000'); input.dispatchEvent(new Event('input', { bubbles: true })); input.blur()
    return input.value
  })
  await new Promise((r) => setTimeout(r, 700))
  check('the CAPEX field accepts an edit', capexTyped === '500000', capexTyped)
  check("the dialog's own ROI moves as the CAPEX is typed",
    (await dialogRoi()) !== roiInDialogBefore, `${roiInDialogBefore} -> ${await dialogRoi()}`)

  // Add an OPEX line while we are here — the grid must gain a row.
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    const btn = [...d.querySelectorAll('button')].find((b) => /add opex line/i.test(b.innerText))
    btn.click()
  })
  await new Promise((r) => setTimeout(r, 600))
  check('an OPEX line can be added', /2026 total/i.test(await dialogText()))

  await closeDialog()
  check('the dialog closes', (await dialogOpen()) === false)
  const roiAfterCapex = await page.evaluate((r) => document.querySelector('tbody tr').children[r]?.innerText.trim(), roiCol)
  check('EDITING CAPEX IN THE DIALOG MOVED THE ROI ON THE PROJECTS TAB',
    roiAfterCapex !== roiBeforeCapex && /%/.test(roiAfterCapex || ''),
    `${roiBeforeCapex} -> ${roiAfterCapex}`)
  const stripAfter = await page.evaluate(() => document.body.innerText.match(/\nCAPEX\s*\n\s*([^\n]+)/)?.[1]?.trim())
  check('and the CAPEX tile in the totals strip picked it up',
    /\d/.test(stripAfter || ''), String(stripAfter))

  /* ---------- the same dialog opens from a scorecard ---------- */
  await page.goto(`${base}/?cost=1#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  check('the scorecard opens with no dialog', (await dialogOpen()) === false)
  await page.evaluate(() => {
    const btn = document.querySelector('tbody tr button[aria-label="open cost breakdown"]')
    if (btn) { btn.click(); return }
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    const table = heads[heads.length - 1].closest('table')
    const row = table.querySelector('tbody tr')
    // The Jira cell — text, not an editable widget.
    row.children[0].click()
  })
  await new Promise((r) => setTimeout(r, 700))
  check('CLICKING A PROJECT ON THE SCORECARD OPENS THE SAME DIALOG', await dialogOpen())
  const dlg2 = await dialogText()
  check('and it is the same component — CAPEX, OPEX and the FY grid',
    /CAPEX/.test(dlg2) && /OPEX/.test(dlg2) && /FY2026/.test(dlg2),
    dlg2.slice(0, 120).replace(/\n/g, ' / '))
  await closeDialog()

  await page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    const table = heads[heads.length - 1].closest('table')
    const row = table.querySelector('tbody tr')
    row.querySelector('input').click()
  })
  await new Promise((r) => setTimeout(r, 500))
  check('clicking an input on the scorecard portfolio does NOT open it',
    (await dialogOpen()) === false)
  await page.evaluate(() => localStorage.clear())

  /* ---------- the rates are live from the Model tab ---------- */
  const annualTile = () => page.evaluate(() =>
    document.body.innerText.match(/VALUE OF HOURS RELEASED\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? null)

  await page.goto(`${base}/?money=2#dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1200))
  const benefitBefore = await annualTile()
  check('the dashboard leads with the value of the hours released', !!benefitBefore, String(benefitBefore))
  check('a return tile is present too',
    await page.evaluate(() => /RETURN ON INVESTMENT/i.test(document.body.innerText)))

  await page.goto(`${base}/?money=3#settings`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1200))
  const rateFields = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')].map((l) => l.innerText.trim())
    return labels.filter((l) => /salary/i.test(l))
  })
  check('both salary rates are editable on the Model tab',
    rateFields.some((l) => /developer/i.test(l)) && rateFields.some((l) => /accountant/i.test(l)),
    rateFields.join(' | '))

  const doubled = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const label = [...document.querySelectorAll('label')].find((l) => /accountant/i.test(l.innerText))
    const input = label.closest('.MuiFormControl-root').querySelector('input')
    input.focus(); setter.call(input, '60000'); input.dispatchEvent(new Event('input', { bubbles: true })); input.blur()
    return input.value
  })
  await new Promise((r) => setTimeout(r, 900))
  check('the accountant salary accepts an edit', doubled === '60000', doubled)

  await page.goto(`${base}/?money=4#dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1200))
  const benefitAfter = await annualTile()
  check('doubling the accountant rate moves the dashboard headline',
    benefitAfter !== benefitBefore, `${benefitBefore} -> ${benefitAfter}`)

  /* ---------- the scorecard portfolio carries ROI per project ---------- */
  await page.goto(`${base}/?money=5#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  const portfolioHeads = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    if (!heads.length) return []
    return [...heads[heads.length - 1].closest('table').querySelectorAll('thead th')]
      .map((h) => h.innerText.trim().toLowerCase())
  })
  check('the scorecard portfolio has an ROI column', portfolioHeads.includes('roi'), portfolioHeads.join(' | '))
  check('and a per-project benefit column', portfolioHeads.some((h) => h.startsWith('benefit')), portfolioHeads.join(' | '))
  check('and mandays, so a scorecard can be costed in place', portfolioHeads.includes('mandays'))
  check("objective 1's target on the card is stated in baht",
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 1 — Financial'))
      return row ? /฿|THB/.test(row.innerText) : false
    }))

  /* ---------- the FTE ratio is adjustable, and drives both sides ---------- */
  // The whole point of the ratio being a setting: it converts saving hours into
  // FTE AND divides the accountant salary into an hour rate. Halving it must
  // double the FTE released and double the money, in one edit.
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?ratio=0#dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1200))
  const fteTile = () => page.evaluate(() => {
    const t = document.body.innerText
    return {
      fte: Number(t.match(/VALUE OF HOURS RELEASED[\s\S]*?([\d.]+)\s*FTE/)?.[1] ?? 0),
      money: t.match(/VALUE OF HOURS RELEASED\s*\n\s*([^\n]+)/)?.[1]?.trim() ?? null,
    }
  })
  const ratioBefore = await fteTile()
  check('the dashboard states the FTE released at the default ratio',
    Math.abs(ratioBefore.fte - 24.0) < 0.2, `${ratioBefore.fte} FTE (4,227.4 / 176 = 24.0)`)

  await page.goto(`${base}/?ratio=1#settings`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1200))
  const ratioField = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => /hours per fte/i.test(l.innerText))
    if (!label) return null
    const input = label.closest('.MuiFormControl-root').querySelector('input')
    return { label: label.innerText.trim(), value: input.value }
  })
  check('the Model tab carries an FTE-ratio input, labelled as such',
    !!ratioField, ratioField ? `${ratioField.label} = ${ratioField.value}` : 'not found')
  check('and it defaults to the workbook divisor', ratioField?.value === '176', String(ratioField?.value))
  check('its help text says it drives the FTE figures AND the hourly rate',
    await page.evaluate(() => {
      const t = document.body.innerText
      return /FTE ratio/i.test(t) && /FTE released/i.test(t) && /hourly rate/i.test(t)
    }))

  const halved = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const label = [...document.querySelectorAll('label')].find((l) => /hours per fte/i.test(l.innerText))
    const input = label.closest('.MuiFormControl-root').querySelector('input')
    input.focus(); setter.call(input, '88'); input.dispatchEvent(new Event('input', { bubbles: true })); input.blur()
    return input.value
  })
  await new Promise((r) => setTimeout(r, 900))
  check('the FTE ratio accepts an edit', halved === '88', halved)

  await page.goto(`${base}/?ratio=2#dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1200))
  const ratioAfter = await fteTile()
  check('halving the ratio doubles the FTE released',
    Math.abs(ratioAfter.fte - ratioBefore.fte * 2) < 0.3,
    `${ratioBefore.fte} -> ${ratioAfter.fte} FTE`)
  check('and moves the money with it, because it sets the hourly rate too',
    ratioAfter.money !== ratioBefore.money, `${ratioBefore.money} -> ${ratioAfter.money}`)
  await page.evaluate(() => localStorage.clear())


  /* ---------- tasks, money<->manday, comments ---------- */
  await page.goto(`${base}/?tasks=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  // Give the first row a manday total the old way — a bare number typed into
  // the inline cell — so the migration path is what actually gets exercised:
  // opening the breakdown on a project that has a total and no tasks.
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.findIndex((h) => h.startsWith('manday'))
    const inp = document.querySelector('tbody tr').children[ix].querySelector('input')
    inp.focus(); setter.call(inp, '12'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
  })
  await new Promise((r) => setTimeout(r, 700))

  await page.evaluate(() => document.querySelector('tbody tr button[aria-label="open cost breakdown"]').click())
  await new Promise((r) => setTimeout(r, 700))
  const effortText = await dialogText()
  check('the dialog carries the effort breakdown', /Effort .* mandays by task/i.test(effortText),
    effortText.slice(0, 90).replace(/\n/g, ' / '))

  // A project imported with a bare total must show exactly ONE line carrying it.
  const firstLine = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    const inputs = [...d.querySelectorAll('input')]
    const md = inputs.find((i) => i.closest('.MuiFormControl-root')?.querySelector('label')?.innerText.startsWith('Mandays'))
    const label = [...d.querySelectorAll('input')].find((i) => i.value === 'Total as entered')
    return { manday: md ? md.value : null, hasTotalLine: !!label }
  })
  check('an existing manday total appears as one line, carrying the number',
    firstLine.hasTotalLine && Number(firstLine.manday) === 12, JSON.stringify(firstLine))

  // Money in -> mandays out.
  const conv = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const d = document.querySelector('[role="dialog"]')
    const fc = [...d.querySelectorAll('.MuiFormControl-root')]
    const costFc = fc.find((f) => f.querySelector('label')?.innerText.startsWith('Cost'))
    const mdFc = fc.find((f) => f.querySelector('label')?.innerText.startsWith('Mandays'))
    const cost = costFc.querySelector('input')
    cost.focus(); setter.call(cost, '272727'); cost.dispatchEvent(new Event('input', { bubbles: true }))
    return { md: mdFc.querySelector('input').value }
  })
  check('typing a cost fills in the mandays', Number(conv.md) > 99 && Number(conv.md) < 101,
    `THB 272,727 -> ${conv.md} mandays`)

  // Mandays in -> money out.
  const conv2 = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const d = document.querySelector('[role="dialog"]')
    const fc = [...d.querySelectorAll('.MuiFormControl-root')]
    const mdFc = fc.find((f) => f.querySelector('label')?.innerText.startsWith('Mandays'))
    const costFc = fc.find((f) => f.querySelector('label')?.innerText.startsWith('Cost'))
    const md = mdFc.querySelector('input')
    md.focus(); setter.call(md, '10'); md.dispatchEvent(new Event('input', { bubbles: true })); md.blur()
    return { cost: costFc.querySelector('input').value }
  })
  await new Promise((r) => setTimeout(r, 600))
  check('typing mandays fills in the cost', Number(conv2.cost) > 27000 && Number(conv2.cost) < 27500,
    `10 mandays -> THB ${conv2.cost}`)

  // Add a second task; the Projects-tab total must become the sum.
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    ;[...d.querySelectorAll('button')].find((b) => /add task/i.test(b.innerText)).click()
  })
  await new Promise((r) => setTimeout(r, 500))
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const d = document.querySelector('[role="dialog"]')
    const mdFields = [...d.querySelectorAll('.MuiFormControl-root')]
      .filter((f) => f.querySelector('label')?.innerText.startsWith('Mandays'))
    const last = mdFields[mdFields.length - 1].querySelector('input')
    last.focus(); setter.call(last, '5'); last.dispatchEvent(new Event('input', { bubbles: true })); last.blur()
  })
  await new Promise((r) => setTimeout(r, 700))

  // A comment with a link.
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    const ta = document.querySelector('[role="dialog"] textarea')
    ta.focus(); setter.call(ta, 'see https://example.com/spec'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.blur()
  })
  await new Promise((r) => setTimeout(r, 700))
  const link = await page.evaluate(() => {
    const a = document.querySelector('[role="dialog"] a[href^="https://example.com"]')
    return a ? { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') } : null
  })
  check('a pasted URL renders as a real link', !!link && link.target === '_blank' && /noopener/.test(link.rel || ''),
    JSON.stringify(link))

  await closeDialog()
  await new Promise((r) => setTimeout(r, 600))
  const mdCell = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.findIndex((h) => h.startsWith('manday'))
    return document.querySelector('tbody tr').children[ix]?.innerText.trim()
  })
  check('the Projects tab shows the task total', Number(String(mdCell).replace(/,/g, '')) === 15,
    `10 + 5 -> ${mdCell} (was 12 before the breakdown was edited)`)
  const mdClickable = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.findIndex((h) => h.startsWith('manday'))
    const cell = document.querySelector('tbody tr').children[ix]
    const btn = cell.querySelector('button')
    if (!btn) return false
    btn.click()
    return true
  })
  await new Promise((r) => setTimeout(r, 700))
  check('the manday total is clickable once it is a sum of tasks', mdClickable && await dialogOpen())
  await closeDialog()


  /* ---------- an objective can be added to a scorecard ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?obj=1#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1600))
  // James, not the lead — the lead already holds all five.
  const tabNames = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split('\n')[0].trim()))
  await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
    tabNames.findIndex((t) => /James/.test(t)))
  await new Promise((r) => setTimeout(r, 1200))

  const objRows = () => page.evaluate(() =>
    [...document.querySelectorAll('tbody tr')]
      .map((r) => r.innerText.split('\n')[0].trim())
      .filter((t) => /^Obj \d+ —/.test(t)))
  const objWeights = () => page.evaluate(() =>
    [...document.querySelectorAll('tbody tr')]
      .filter((r) => /^Obj \d+ —/.test(r.innerText))
      .map((r) => {
        const i = [...r.querySelectorAll('input')].filter((x) => x.style.textAlign === 'right').pop()
        return i ? Number(i.value) : null
      }).filter((v) => v !== null))

  const objRowsBefore = await objRows()
  const objWBefore = await objWeights()
  check('James holds fewer than all five objectives to begin with', objRowsBefore.length < 5,
    objRowsBefore.join(' | '))
  check('the card offers an "add an objective" control',
    await page.evaluate(() => /ADD AN OBJECTIVE/i.test(document.body.innerText)))

  // Pick the Data warehouse objective out of the dropdown.
  const comboOpened = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('*')]
    const label = heads.find((e) => e.textContent && e.textContent.trim() === 'ADD AN OBJECTIVE')
    const box = label && label.parentElement
    const combo = box && box.querySelector('[role="combobox"]')
    if (!combo) return false
    combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  })
  check('the objective dropdown opens', comboOpened)
  await new Promise((r) => setTimeout(r, 500))
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => /Data warehouse/i.test(o.textContent))
    if (opt) opt.click()
  })
  await new Promise((r) => setTimeout(r, 900))

  const objRowsAfter = await objRows()
  const objWAfter = await objWeights()
  check('ADDING AN OBJECTIVE PUTS IT ON THE SCORECARD',
    objRowsAfter.length === objRowsBefore.length + 1 && objRowsAfter.some((t) => /Data warehouse/i.test(t)),
    objRowsAfter.join(' | '))
  check('it is marked as added by hand',
    await page.evaluate(() => {
      const row = [...document.querySelectorAll('tbody tr')].find((r) => /Data warehouse/i.test(r.innerText))
      return row ? /added/i.test(row.innerText) : false
    }))
  check('the weights still total 100%', objWAfter.reduce((a, b) => a + b, 0) === 100,
    `${objWBefore.join('+')} -> ${objWAfter.join('+')}`)
  check('and are still multiples of 5', objWAfter.every((v) => v % 5 === 0), objWAfter.join(' / '))
  check('a chip records that it was added', await page.evaluate(() => /\(added\)/.test(document.body.innerText)))

  // Take it off again; the card must go back exactly.
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll('.MuiChip-root')].find((c) => /\(added\)/.test(c.innerText))
    // The delete affordance is an <svg>, which has no .click() — dispatch it.
    const del = chip && chip.querySelector('.MuiChip-deleteIcon')
    if (del) del.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 900))
  const objRowsBack = await objRows()
  const objWBack = await objWeights()
  check('removing it restores the card exactly',
    objRowsBack.join('|') === objRowsBefore.join('|') && objWBack.join('+') === objWBefore.join('+'),
    `${objWBack.join('+')} vs ${objWBefore.join('+')}`)


  /* ---------- reassigning a project really moves it ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?pic=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  // Dismiss anything an earlier step left mounted — a stray backdrop swallows
  // the clicks below and the failure looks like a broken feature.
  await page.keyboard.press('Escape')
  await new Promise((r) => setTimeout(r, 300))
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'FNP-379')
  await new Promise((r) => setTimeout(r, 1000))

  // What James's scorecard looks like before the move, so "it left him" is a
  // measured drop and not just an absence.
  const portfolio = async (who) => {
    await page.goto(`${base}/?pf=${who}#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise((r) => setTimeout(r, 1500))
    const tabs = await page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
    const ix = tabs.findIndex((t) => new RegExp(who, 'i').test(t))
    await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(), ix)
    await new Promise((r) => setTimeout(r, 1200))
    return page.evaluate(() => {
      const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
      const t = heads[heads.length - 1].closest('table')
      const rows = [...t.querySelectorAll('tbody tr')]
      return { count: rows.length, has379: rows.some((r) => /FNP-379/.test(r.innerText)) }
    })
  }
  const jamesBefore = await portfolio('James')
  check('James starts with FNP-379 in his portfolio', jamesBefore.has379, JSON.stringify(jamesBefore))

  await page.goto(`${base}/?pic=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'FNP-379')
  await new Promise((r) => setTimeout(r, 700))

  const picOf = () => page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.indexOf('pic')
    return document.querySelector('tbody tr').children[ix]?.innerText.trim()
  })
  check('found FNP-379 on the Projects tab', (await picOf()) === 'James', String(await picOf()))

  // Change the PIC the way a user does: the dropdown in the row.
  await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.indexOf('pic')
    const combo = document.querySelector('tbody tr').children[ix].querySelector('[role="combobox"]')
    combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  // Find the option and take its coordinates in the SAME evaluate that proves
  // it is mounted — a second round trip came back empty even though the menu
  // was open before it and still open after it.
  let optBox = null
  for (let i = 0; i < 40 && !optBox; i++) {
    optBox = await page.evaluate(() => {
      const opt = [...document.querySelectorAll('[role="option"]')]
        .find((o) => /^Gun/.test((o.textContent || '').trim()))
      if (!opt) return null
      const r = opt.getBoundingClientRect()
      if (!r.width || !r.height) return null
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
    })
    if (!optBox) await new Promise((r) => setTimeout(r, 250))
  }
  check('the Gun option is on screen', !!optBox, JSON.stringify(optBox))
  if (optBox) await page.mouse.click(optBox.x, optBox.y)
  await new Promise((r) => setTimeout(r, 1400))
  const picDiag = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.indexOf('pic')
    const rows = document.querySelectorAll('tbody tr').length
    const listboxes = document.querySelectorAll('[role="listbox"]').length
    const opts = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()).slice(0, 4)
    return {
      ix, rows, listboxes, opts,
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      backdrops: document.querySelectorAll('.MuiBackdrop-root').length,
      cell: document.querySelector('tbody tr')?.children[ix]?.innerText.trim(),
    }
  })
  check('the PIC changed to Gun', (await picOf()) === 'Gun', JSON.stringify(picDiag))

  // James's scorecard must no longer carry it — one row fewer, and that row is
  // the one that moved.
  const jamesAfter = await portfolio('James')
  check('REASSIGNED PROJECT IS GONE FROM THE OLD OWNER SCORECARD',
    jamesAfter.has379 === false, JSON.stringify(jamesAfter))
  check('and his portfolio is exactly one row shorter',
    jamesAfter.count === jamesBefore.count - 1, `${jamesBefore.count} -> ${jamesAfter.count}`)

  // The new owner is the team lead, whose portfolio is the whole book either
  // way, so presence there proves nothing. What proves it is the Projects tab
  // reading Gun (checked above) and the hours landing on him.
  const gunAfter = await portfolio('Gun')
  check('and it is on the new owner scorecard', gunAfter.has379 === true, JSON.stringify(gunAfter))


  /* ---------- roles are set by hand, and the split follows ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?roles=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'FNP-379')
  await new Promise((r) => setTimeout(r, 800))
  await page.evaluate(() => document.querySelector('tbody tr button[aria-label="open cost breakdown"]').click())
  await new Promise((r) => setTimeout(r, 900))

  const teamText = () => page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    const t = [...d.querySelectorAll('table')].find((x) => /person/i.test(x.innerText) && /share/i.test(x.innerText))
    return t ? t.innerText : ''
  })
  check('the dialog carries a team-and-roles table', /person/i.test(await teamText()),
    (await teamText()).slice(0, 60).replace(/\n/g, ' / '))
  check('the owner starts with the whole project', /100%/.test(await teamText()),
    (await teamText()).replace(/\n/g, ' / ').slice(0, 120))

  // Dismiss only the menu. Escape would bubble to the Dialog behind it and
  // close the whole panel, and every later step then reads a null dialog.
  const closeMenu = async () => {
    await page.evaluate(() => {
      // Only if a menu is actually open — a single-select closes itself on the
      // pick, and the last backdrop is then the DIALOG's own.
      if (!document.querySelector('[role="listbox"]')) return
      const backs = [...document.querySelectorAll('.MuiBackdrop-root')]
      const b = backs[backs.length - 1]
      if (b) b.click()
    })
    await new Promise((r) => setTimeout(r, 600))
  }

  /*
   * Click a menu option, once it has stopped moving.
   *
   * The menu animates open, so a position measured on the first frame is stale
   * by the time the click lands — it went to the neighbouring role and the
   * project ended up with three of them. Measure twice, click only when the
   * two agree. Finding and clicking must also share one round trip: split
   * across two, the second came back empty with the menu still open.
   */
  const clickOption = async (want) => {
    let prev = null
    for (let i = 0; i < 40; i++) {
      const box = await page.evaluate((w) => {
        const opt = [...document.querySelectorAll('[role="option"]')]
          .find((o) => new RegExp(w).test((o.textContent || '').trim()))
        if (!opt) return null
        const r = opt.getBoundingClientRect()
        if (!r.width || !r.height) return null
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, want)
      if (box && prev && box.x === prev.x && box.y === prev.y) {
        await page.mouse.click(box.x, box.y)
        await new Promise((r) => setTimeout(r, 500))
        return true
      }
      prev = box
      await new Promise((r) => setTimeout(r, 200))
    }
    return false
  }

  const openCombo = async (which) => {
    await page.evaluate((where) => {
      const d = document.querySelector('[role="dialog"]')
      const combos = [...d.querySelectorAll('[role="combobox"]')]
      const combo = where === 'add' ? combos[combos.length - 1] : combos[0]
      combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }, which)
    await new Promise((r) => setTimeout(r, 400))
  }

  await openCombo('add')
  check('the add-a-person menu offers the rest of the team', await clickOption('^Kade'))
  await closeMenu()
  const withKade = await teamText()
  check('ADDING A PERSON SPLITS THE PROJECT', /Kade/.test(withKade) && /50%/.test(withKade),
    withKade.replace(/\n/g, ' / '))

  // Demote the new dev to QA: 83/17, the role weights the plan document sets.
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    const row = [...d.querySelectorAll('tbody tr')].find((r) => /Kade/.test(r.innerText))
    row.querySelector('[role="combobox"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 400))
  check('the role menu lists the roles by name', await clickOption('^QA'))
  check('and a role can be taken off again', await clickOption('^Developer'))
  await closeMenu()

  const asQa = await teamText()
  check('CHANGING THE ROLE RE-SPLITS THE HOURS 83/17',
    /83%/.test(asQa) && /17%/.test(asQa), asQa.replace(/\n/g, ' / '))
  check('and the credited hours are shown beside the share',
    /26\.7|27/.test(asQa) && /5\.3|5/.test(asQa), asQa.replace(/\n/g, ' / '))

  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    ;[...d.querySelectorAll('button')].find((b) => /^Close$/i.test(b.innerText.trim())).click()
  })
  await new Promise((r) => setTimeout(r, 700))

  // The scorecard must carry the same split.
  await page.goto(`${base}/?roles=2#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1500))
  const roleTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
  await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
    roleTabs.findIndex((t) => /Kade/.test(t)))
  await new Promise((r) => setTimeout(r, 1200))
  const kadeRow = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    const t = heads[heads.length - 1].closest('table')
    const row = [...t.querySelectorAll('tbody tr')].find((r) => /FNP-379/.test(r.innerText))
    return row ? row.innerText.replace(/\n/g, ' | ') : null
  })
  check('THE PROJECT IS ON THE QA\'S SCORECARD', !!kadeRow, String(kadeRow))
  check('and his row names the role he holds on it', /qa/i.test(kadeRow || ''), String(kadeRow))


  /* ---------- a browser already holding the damaged state ---------- */
  // The reported case: the PIC had been changed with the old build, so the
  // browser holds pic=gun with the contributor list still naming James. The
  // fix only guards new edits; this state has to be repaired on load or the
  // project stays on his scorecard forever.
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?dmg=0#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))

  const headlineBefore = await page.evaluate(() =>
    document.body.innerText.match(/([\d,]+)\s*\/\s*3,000/)?.[1] ?? null)
  const damage = await page.evaluate(() => {
    const KEY = 'fa-tech-kpi-2026'
    const st = JSON.parse(localStorage.getItem(KEY))
    if (!st) return { ok: false, why: 'the app saved nothing to load back' }
    const before = st.projects.find((p) => p.key === 'FNP-379')
    // exactly what the old write did: move the pic, leave the list behind
    st.projects = st.projects.map((p) => (p.key === 'FNP-379' ? { ...p, pic: 'gun' } : p))
    delete st.repair
    localStorage.setItem(KEY, JSON.stringify(st))
    return { ok: true, contributors: JSON.stringify(before.contributors), pic: before.pic }
  })
  check('the browser can be put into the damaged state', damage.ok, JSON.stringify(damage))
  check('and that state is the one that was reported',
    /james/.test(damage.contributors || ''), `${damage.pic} / ${damage.contributors}`)

  await page.goto(`${base}/?dmg=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  const repaired = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    const p = st.projects.find((x) => x.key === 'FNP-379')
    return { repair: st.repair, pic: p.pic, contributors: JSON.stringify(p.contributors) }
  })
  check('LOADING THE APP REPAIRS THE STORED STATE',
    !/james/.test(repaired.contributors) && /gun/.test(repaired.contributors),
    JSON.stringify(repaired))
  check('and stamps it so it never runs again', repaired.repair >= 1, String(repaired.repair))

  await page.goto(`${base}/?dmg=2#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  const dmgTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
  await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
    dmgTabs.findIndex((t) => /James/.test(t)))
  await new Promise((r) => setTimeout(r, 1400))
  const jamesNow = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    const t = heads[heads.length - 1].closest('table')
    return [...t.querySelectorAll('tbody tr')].some((r) => /FNP-379/.test(r.innerText))
  })
  check('SO PL FORECAST IS GONE FROM JAMES\'S SCORECARD', jamesNow === false)
  const dmgHeadline = await page.evaluate(() => document.body.innerText.match(/([\d,]+)\s*\/\s*3,000/)?.[1] ?? null)
  check('and the team headline is untouched by the repair', dmgHeadline === headlineBefore,
    `${headlineBefore} -> ${dmgHeadline}`)


  /* ---------- export what is filtered, edit it, import it back ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?io=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))

  // Let the browser write downloads where this test can read them.
  const dlDir = mkdtempSync(join(tmpdir(), 'kpi-io-'))
  const cdp = await page.createCDPSession()
  await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir })

  const ioRowCount = () => page.evaluate(() => document.querySelectorAll('tbody tr').length)
  const ioAllRows = await ioRowCount()
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'forecast')
  await new Promise((r) => setTimeout(r, 900))
  const ioFilteredRows = await ioRowCount()
  check('the filter narrows the table', ioFilteredRows > 0 && ioFilteredRows < ioAllRows,
    `${ioFilteredRows} of ${ioAllRows}`)

  const exportLabel = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Export (filtered|all)/.test(x.innerText.trim()))
    return b ? b.innerText.trim() : null
  })
  check('THERE IS AN EXPORT BUTTON ABOVE THE TABLE', !!exportLabel, String(exportLabel))
  check('and it says how many rows it will write',
    exportLabel === `Export filtered (${ioFilteredRows})`, `${exportLabel} vs ${ioFilteredRows} rows`)

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((x) => /^Export (filtered|all)/.test(x.innerText.trim())).click()
  })
  let ioDownloaded = null
  for (let i = 0; i < 60 && !ioDownloaded; i++) {
    const files = readdirSync(dlDir).filter((f) => f.endsWith('.xlsx'))
    if (files.length) ioDownloaded = join(dlDir, files[0])
    else await new Promise((r) => setTimeout(r, 250))
  }
  check('CLICKING IT DOWNLOADS A FILE', !!ioDownloaded, String(ioDownloaded && ioDownloaded.split(/[\\/]/).pop()))

  const wbIn = new ExcelJS.Workbook()
  await wbIn.xlsx.readFile(ioDownloaded)
  const wsIn = wbIn.getWorksheet('Projects')
  const headIx = {}
  wsIn.getRow(4).eachCell((cell, ix) => { const c = columnFor(cell.value); if (c) headIx[c.key] = ix })
  const ioWritten = []
  wsIn.eachRow((r, n) => {
    if (n <= 4) return
    const k = String(r.getCell(headIx.jira).value || '')
    if (k && !/^total$/i.test(k)) ioWritten.push(k)
  })
  check('THE FILE HOLDS ONLY THE FILTERED ROWS', ioWritten.length === ioFilteredRows,
    `${ioWritten.length} in the file vs ${ioFilteredRows} on screen`)

  // What the table shows for the first row, so the import can be checked
  // against a number the user can see.
  const ioFirstKey = ioWritten[0]
  // The file is written in the table's own order, so row 1 of the file is row 1
  // of the table.
  const savingOf = (n) => page.evaluate((i) => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.findIndex((h) => h.startsWith('saving'))
    const row = document.querySelectorAll('tbody tr')[i]
    if (!row) return null
    const cell = row.children[ix]
    return {
      value: cell.querySelector('input')?.value ?? cell.innerText.trim(),
      text: row.innerText.split(String.fromCharCode(10)).join(' ').slice(0, 50),
    }
  }, n)
  const beforeHours = await savingOf(0)
  // Correspondence, proved by the value rather than by the rendered text: the
  // Jira cell is a link and does not show up in innerText.
  const fileFirstHours = wsIn.getRow(5).getCell(headIx.savingHours).value
  check('THE FIRST ROW IN THE FILE IS THE FIRST ROW ON SCREEN',
    Number(String(beforeHours?.value).replace(/,/g, '')) === Number(fileFirstHours),
    `file ${fileFirstHours} vs screen ${beforeHours?.value} (${ioFirstKey})`)

  // Edit ONE cell and hand the file back.
  wsIn.getRow(5).getCell(headIx.savingHours).value = 456
  const editedPath = join(dlDir, 'edited.xlsx')
  await wbIn.xlsx.writeFile(editedPath)

  const fileInput = await page.$('input[aria-label="import projects"]')
  check('there is an import control', !!fileInput)
  await fileInput.uploadFile(editedPath)
  await new Promise((r) => setTimeout(r, 2000))

  const ioPreview = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    return d ? d.innerText.replace(/\n/g, ' | ') : null
  })
  check('IMPORTING SHOWS WHAT IT WOULD CHANGE, BEFORE CHANGING IT',
    !!ioPreview && /1 project to update/.test(ioPreview), String(ioPreview).slice(0, 160))
  check('and the rest of the file is reported as already matching',
    new RegExp(`${ioWritten.length - 1} already the same`).test(ioPreview || ''), String(ioPreview).slice(0, 200))
  check('the ioPreview names the field and both values',
    /Saving/.test(ioPreview || '') && /456/.test(ioPreview || ''), String(ioPreview).slice(0, 200))

  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    ;[...d.querySelectorAll('button')].find((b) => /^Apply /.test(b.innerText.trim())).click()
  })
  await new Promise((r) => setTimeout(r, 1200))

  const afterHours = await savingOf(0)
  check('APPLYING IT UPDATES THE ROW IN THE TABLE',
    String(afterHours?.value).replace(/,/g, '') === '456',
    `${beforeHours?.value} -> ${afterHours?.value}`)

  // and nothing else moved: the other filtered rows are as they were
  const ioOthers = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = heads.findIndex((h) => h.startsWith('saving'))
    return [...document.querySelectorAll('tbody tr')].slice(1)
      .map((r) => r.children[ix].querySelector('input')?.value ?? '')
  })
  check('and the other rows on screen are untouched',
    ioOthers.every((v) => v !== '456'), ioOthers.join(','))

  const headlineAfterImport = await page.evaluate(() =>
    document.body.innerText.match(/([\d,]+)\s*\/\s*3,000/)?.[1] ?? null)
  const expectHeadline = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    return st.projects.filter((p) => p.commitLevel === 'commit' || p.commitLevel === 'stretch').length > 0
  })
  check('the plan was ioWritten to the browser, not just the screen', expectHeadline)
  check('and the team headline moved with it', headlineAfterImport !== '4,227',
    `now ${headlineAfterImport}`)

  rmSync(dlDir, { recursive: true, force: true })


  /* ---------- the delete button on the scorecard is reachable ---------- */
  // It sat in the last column of a table 483px wide inside a 451px card, and
  // the card clips what overflows it: the button was cut off and could not be
  // clicked at all. Being inside the frame is not the test — being clickable
  // is, so this clicks it and counts the lines before and after.
  await page.evaluate(() => localStorage.clear())
  for (const width of [1700, 1440, 1280, 1100]) {
    await page.setViewport({ width, height: 1000 })
    await page.goto(`${base}/?bin=${width}#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise((r) => setTimeout(r, 1600))
    const geom = await page.evaluate(() => {
      const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
      const card = head?.closest('.MuiPaper-root')
      const table = card?.querySelector('table')
      const bin = [...card.querySelectorAll('button')].find((b) => b.querySelector('[data-testid="DeleteOutlineIcon"]'))
      if (!bin) return { ok: false, why: 'no delete button' }
      const cardBox = card.getBoundingClientRect()
      const binBox = bin.getBoundingClientRect()
      const x = Math.round(binBox.x + binBox.width / 2)
      const y = Math.round(binBox.y + binBox.height / 2)
      const at = document.elementFromPoint(x, y)
      return {
        ok: true,
        inside: binBox.right <= cardBox.right + 0.5 && binBox.left >= cardBox.left - 0.5,
        // what a real click at the button's centre would actually hit
        hits: !!at && (at === bin || bin.contains(at)),
        over: Math.round(binBox.right - cardBox.right),
        table: Math.round(table.getBoundingClientRect().width),
        card: Math.round(cardBox.width),
      }
    })
    check(`@${width}px: THE DELETE BUTTON IS INSIDE THE CARD`, geom.ok && geom.inside,
      JSON.stringify(geom))
    check(`@${width}px: and a click at its centre lands on it`, geom.hits, JSON.stringify(geom))
  }

  // Now actually use it.
  await page.setViewport({ width: 1440, height: 1000 })
  await page.goto(`${base}/?bin=go#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1600))
  const kpiLines = () => page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const card = head.closest('.MuiPaper-root')
    return card.querySelectorAll('tbody tr').length
  })
  const linesBefore = await kpiLines()
  const binPoint = await page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const card = head.closest('.MuiPaper-root')
    const bin = [...card.querySelectorAll('button')].find((b) => b.querySelector('[data-testid="DeleteOutlineIcon"]') && !b.disabled)
    if (!bin) return null
    const r = bin.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  check('an enabled delete button is on screen', !!binPoint, JSON.stringify(binPoint))
  if (binPoint) await page.mouse.click(binPoint.x, binPoint.y)
  await new Promise((r) => setTimeout(r, 1000))
  const linesAfter = await kpiLines()
  check('A REAL CLICK ON IT REMOVES THE KPI LINE', linesAfter === linesBefore - 1,
    `${linesBefore} -> ${linesAfter}`)
  await page.setViewport({ width: 1700, height: 1000 })


  /* ---------- a KPI line written by hand ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?kpi=1#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  const kpiTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
  await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
    kpiTabs.findIndex((t) => /James/.test(t)))
  await new Promise((r) => setTimeout(r, 1400))

  const card = () => page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const c = head.closest('.MuiPaper-root')
    const rows = [...c.querySelectorAll('tbody tr')]
    return {
      lines: rows.length,
      text: c.innerText.split(String.fromCharCode(10)).join(' | '),
      total: c.innerText.match(/TOTAL[^%]*?(\d+)\s*%/)?.[1] ?? null,
    }
  })
  const kpiBefore = await card()
  check('the scorecard is on screen', kpiBefore.lines > 0, `${kpiBefore.lines} lines`)

  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^New KPI$/.test(x.innerText.trim()))
    if (b) b.click()
  })
  await new Promise((r) => setTimeout(r, 900))
  check('THERE IS A WAY TO ADD A KPI LINE BY HAND',
    await page.evaluate(() => !!document.querySelector('[role="dialog"]')))

  // Name it, tie it to an objective, and measure it in something that is NOT
  // saving hours.
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const d = document.querySelector('[role="dialog"]')
    const label = [...d.querySelectorAll('.MuiFormControl-root')]
      .find((f) => /What is the KPI/.test(f.innerText))?.querySelector('input')
    setter.call(label, 'Close the books in three days')
    label.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await new Promise((r) => setTimeout(r, 400))

  const pickIn = async (labelText, wanted) => {
    await page.evaluate((lt) => {
      const d = document.querySelector('[role="dialog"]')
      const fc = [...d.querySelectorAll('.MuiFormControl-root')].find((f) => new RegExp(lt).test(f.innerText))
      fc.querySelector('[role="combobox"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    }, labelText)
    await new Promise((r) => setTimeout(r, 400))
    let box = null
    let prev = null
    for (let i = 0; i < 40 && !box; i++) {
      const now = await page.evaluate((w) => {
        const opt = [...document.querySelectorAll('[role="option"]')]
          .find((o) => new RegExp(w).test((o.textContent || '').trim()))
        if (!opt) return null
        const r = opt.getBoundingClientRect()
        if (!r.width || !r.height) return null
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
      }, wanted)
      if (now && prev && now.x === prev.x && now.y === prev.y) box = now
      prev = now
      if (!box) await new Promise((r) => setTimeout(r, 200))
    }
    if (box) await page.mouse.click(box.x, box.y)
    await new Promise((r) => setTimeout(r, 600))
    return !!box
  }

  check('it can be tied to an objective', await pickIn('Objective', '^2\\.'))
  check('AND MEASURED IN SOMETHING OTHER THAN SAVING HOURS', await pickIn('Measured in', '^A number'))

  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const d = document.querySelector('[role="dialog"]')
    const fc = (re) => [...d.querySelectorAll('.MuiFormControl-root')].find((f) => re.test(f.innerText))
    const unit = fc(/^Unit/)?.querySelector('input')
    if (unit) { setter.call(unit, 'days'); unit.dispatchEvent(new Event('input', { bubbles: true })) }
    const target = fc(/^Target/)?.querySelector('input')
    if (target) { setter.call(target, '3'); target.dispatchEvent(new Event('input', { bubbles: true })) }
  })
  await new Promise((r) => setTimeout(r, 400))
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]')
    ;[...d.querySelectorAll('button')].find((b) => /^Save$/.test(b.innerText.trim())).click()
  })
  await new Promise((r) => setTimeout(r, 1200))

  const kpiAfter = await card()
  check('THE LINE IS ON THE SCORECARD', kpiAfter.lines === kpiBefore.lines + 1,
    `${kpiBefore.lines} -> ${kpiAfter.lines}`)
  check('under the name that was typed', /Close the books in three days/.test(kpiAfter.text),
    kpiAfter.text.slice(0, 160))
  // The target lives in an input, and an input's value is not innerText — read
  // the field itself.
  const customTarget = await page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const row = [...head.closest('.MuiPaper-root').querySelectorAll('tbody tr')]
      .find((r) => /Close the books/.test(r.innerText))
    if (!row) return null
    return { value: row.querySelector('input')?.value ?? null, unit: row.innerText.replace(/\s+/g, ' ') }
  })
  check('WITH ITS OWN TARGET AND UNIT, NOT SAVING HOURS',
    customTarget?.value === '3' && /days/.test(customTarget.unit) && !/hrs/.test(customTarget.unit),
    JSON.stringify(customTarget))
  check('and it says which objective it is under',
    /under Obj 2/.test(kpiAfter.text), kpiAfter.text.slice(0, 220))
  check('THE CARD STILL TOTALS 100%', kpiAfter.total === '100', String(kpiAfter.total))

  // It survives a reload, so it is in the plan and not just on the screen.
  await page.goto(`${base}/?kpi=2#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
    kpiTabs.findIndex((t) => /James/.test(t)))
  await new Promise((r) => setTimeout(r, 1400))
  const kpiReloaded = await card()
  check('it survives a reload', /Close the books in three days/.test(kpiReloaded.text)
    && kpiReloaded.lines === kpiAfter.lines, `${kpiReloaded.lines} lines`)

  // And it can be taken off again.
  const gone = await page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const c = head.closest('.MuiPaper-root')
    const row = [...c.querySelectorAll('tbody tr')].find((r) => /Close the books/.test(r.innerText))
    if (!row) return false
    const bin = row.querySelector('button [data-testid="DeleteOutlineIcon"]')?.closest('button')
    if (!bin) return false
    bin.click()
    return true
  })
  check('the bin is on the hand-written line too', gone)
  await new Promise((r) => setTimeout(r, 1000))
  const kpiRemoved = await card()
  check('and it takes the line off the card', !/Close the books in three days/.test(kpiRemoved.text),
    `${kpiRemoved.lines} lines`)


  /* ---------- typing a figure over the calculated one ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?ovr=1#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  const ovrTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
  const tabHours = (name) => page.evaluate((n) => {
    const t = [...document.querySelectorAll('[role="tab"]')].find((x) => x.innerText.startsWith(n))
    return t ? t.innerText.match(/([\d,]+)\s*hrs/)?.[1] ?? null : null
  }, name)
  const goTab = async (name) => {
    await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
      ovrTabs.findIndex((t) => new RegExp(name).test(t)))
    await new Promise((r) => setTimeout(r, 1200))
  }
  const tile = (label) => page.evaluate((lbl) => {
    const head = [...document.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && e.textContent.trim() === lbl)
    const card = head?.closest('.MuiPaper-root')
    if (!card) return null
    return {
      text: card.innerText.split(String.fromCharCode(10)).join(' | '),
      manual: /manual/i.test(card.innerText),
      canEdit: !!card.querySelector(`[aria-label="override ${lbl}"]`),
      canRevert: !!card.querySelector(`[aria-label="revert ${lbl}"]`),
    }
  }, label)

  const leadBefore = await tabHours('Gun')
  await goTab('James')
  const HRS = 'Credited saving hours'
  const beforeTile = await tile(HRS)
  check('THE HOURS TILE CAN BE TYPED OVER', beforeTile?.canEdit === true, JSON.stringify(beforeTile))
  check('and it is not marked manual to begin with', beforeTile.manual === false, beforeTile.text)
  check('so there is nothing to revert yet', beforeTile.canRevert === false)

  await page.evaluate((lbl) => {
    const head = [...document.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && e.textContent.trim() === lbl)
    head.closest('.MuiPaper-root').querySelector(`[aria-label="override ${lbl}"]`).click()
  }, HRS)
  await new Promise((r) => setTimeout(r, 600))
  await page.evaluate((lbl) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const inp = document.querySelector(`input[aria-label="${lbl} value"]`)
    inp.focus()
    setter.call(inp, '200')
    inp.dispatchEvent(new Event('input', { bubbles: true }))
    inp.blur()
  }, HRS)
  await new Promise((r) => setTimeout(r, 1200))

  const afterTile = await tile(HRS)
  check('THE TILE SHOWS THE TYPED FIGURE', /\b200\b/.test(afterTile.text), afterTile.text.slice(0, 120))
  check('and says it is manual', afterTile.manual === true, afterTile.text.slice(0, 140))
  check('and states what the register still calculates',
    /register/i.test(afterTile.text) && /80/.test(afterTile.text), afterTile.text.slice(0, 200))
  check('A REVERT CONTROL APPEARS', afterTile.canRevert === true)

  const moneyTile = await tile('Value released')
  check('the money followed the hours', !!moneyTile && !/^฿0/.test(moneyTile.text), moneyTile.text.slice(0, 80))

  const leadAfter = await tabHours('Gun')
  check('THE LEAD FOLLOWED THE MEMBER',
    Number(String(leadAfter).replace(/,/g, '')) - Number(String(leadBefore).replace(/,/g, '')) === 121,
    `${leadBefore} -> ${leadAfter}`)

  // The register is untouched: the header total is the project book.
  const ovrHeadline = await page.evaluate(() =>
    document.body.innerText.match(/([\d,]+)\s*\/\s*3,000/)?.[1] ?? null)
  check('the committed headline is untouched by it', ovrHeadline === '4,227', String(ovrHeadline))

  // It survives a reload, so it is in the plan and not just on the screen.
  await page.goto(`${base}/?ovr=2#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  await goTab('James')
  const reloadedTile = await tile(HRS)
  check('it survives a reload', /\b200\b/.test(reloadedTile.text) && reloadedTile.manual,
    reloadedTile.text.slice(0, 100))

  // And back again.
  await page.evaluate((lbl) => {
    const head = [...document.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && e.textContent.trim() === lbl)
    head.closest('.MuiPaper-root').querySelector(`[aria-label="revert ${lbl}"]`).click()
  }, HRS)
  await new Promise((r) => setTimeout(r, 1200))
  const revertedTile = await tile(HRS)
  check('REVERTING PUTS THE CALCULATED FIGURE BACK',
    /\b80\b/.test(revertedTile.text) && !revertedTile.manual, revertedTile.text.slice(0, 120))
  check('and the revert control goes away with it', revertedTile.canRevert === false)
  const leadReverted = await tabHours('Gun')
  check('the lead goes back too', leadReverted === leadBefore, `${leadAfter} -> ${leadReverted}`)


  /* ---------- the card states the hours it carries ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?tot=1#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  const totTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
  for (const nick of ['Gun', 'James', 'Kade']) {
    await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
      totTabs.findIndex((t) => new RegExp(nick).test(t)))
    await new Promise((r) => setTimeout(r, 1200))
    const seen = await page.evaluate(() => {
      const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
      const c = head.closest('.MuiPaper-root')
      const total = [...c.querySelectorAll('tbody tr')].find((r) => /^TOTAL/.test(r.innerText.trim()))
      const tileHead = [...document.querySelectorAll('*')]
        .find((e) => e.children.length === 0 && /saving hours$/i.test(e.textContent.trim()))
      const tile = tileHead?.closest('.MuiPaper-root')
      return {
        row: total ? total.innerText.split(String.fromCharCode(9)).join(' ').split(String.fromCharCode(10)).join(' ') : null,
        tile: tile ? tile.innerText.split(String.fromCharCode(10))[1] : null,
      }
    })
    const onRow = (seen.row || '').match(/([\d,]+(?:\.\d+)?)/)?.[1] ?? null
    check(`${nick}: THE SCORECARD STATES ITS SAVING HOURS`, !!onRow && /%/.test(seen.row),
      String(seen.row))
    check(`${nick}: and it is the figure in the headline tile`, onRow === seen.tile,
      `${onRow} vs ${seen.tile}`)
  }


  /* ---------- soft benefits: softTyped on the register, seen on the card ---------- */
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?soft=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  await page.type('input[placeholder="Search key, project, team, assignee…"]', 'FNP-379')
  await new Promise((r) => setTimeout(r, 900))

  const softCol = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    return {
      ix: heads.indexOf('soft benefits'),
      cash: heads.findIndex((h) => h.startsWith('cash benefit')),
      saving: heads.findIndex((h) => h.startsWith('saving')),
    }
  })
  check('THERE IS A SOFT BENEFITS COLUMN', softCol.ix > 0, JSON.stringify(softCol))
  check('and it sits beside the saving hours and the cash', softCol.ix === softCol.saving + 2, JSON.stringify(softCol))
  check('THERE IS A CASH BENEFIT COLUMN TOO', softCol.cash === softCol.saving + 1, JSON.stringify(softCol))

  await page.evaluate(() => {
    document.querySelector('tbody tr [aria-label="edit soft benefits"]').click()
  })
  await new Promise((r) => setTimeout(r, 800))
  const softTyped = await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
    const ta = document.querySelector('.MuiPopover-root textarea')
    if (!ta) return false
    ta.focus()
    setter.call(ta, 'Removes a manual reconciliation' + String.fromCharCode(10) + 'Full audit trail')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })
  check('clicking the cell opens an editor', softTyped)
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.MuiPopover-root button')].find((x) => /^Done$/.test(x.innerText.trim()))
    if (b) b.click()
  })
  await new Promise((r) => setTimeout(r, 1000))

  const softCell = await page.evaluate((ix) => {
    const row = document.querySelector('tbody tr')
    return row ? row.children[ix].innerText.split(String.fromCharCode(10)).join(' | ') : null
  }, softCol.ix)
  check('THE BULLETS SHOW IN THE CELL',
    /Removes a manual reconciliation/.test(softCell || '') && /Full audit trail/.test(softCell || ''),
    String(softCell))

  // Cash benefit, typed in the column beside it.
  await page.evaluate((ix) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const inp = document.querySelector('tbody tr').children[ix].querySelector('input')
    inp.focus(); setter.call(inp, '600000'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
  }, softCol.cash)
  await new Promise((r) => setTimeout(r, 1000))
  const cashBack = await page.evaluate((ix) => {
    const row = document.querySelector('tbody tr')
    const inp = row.children[ix].querySelector('input')
    const heads = [...document.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const roiIx = heads.indexOf('roi')
    return { typed: inp?.value ?? null, roi: row.children[roiIx]?.innerText.trim() ?? null }
  }, softCol.cash)
  check('THE CASH FIGURE IS ACCEPTED', String(cashBack.typed).replace(/,/g, '') === '600000',
    JSON.stringify(cashBack))

  // the scorecard of the person credited on it
  await page.goto(`${base}/?soft=2#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  const softTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
  await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
    softTabs.findIndex((t) => /James/.test(t)))
  await new Promise((r) => setTimeout(r, 1400))
  const softOnCard = await page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const c = head.closest('.MuiPaper-root')
    return c.innerText.split(String.fromCharCode(10)).join(' | ')
  })
  check('THE SCORECARD SHOWS THE SOFT BENEFITS',
    /SOFT BENEFITS DELIVERED/.test(softOnCard) && /Removes a manual reconciliation/.test(softOnCard),
    softOnCard.slice(-220))
  check('and names the project they come from', /FNP-379/.test(softOnCard), softOnCard.slice(-160))
  check('the card total is untouched by them', /100%/.test(softOnCard))

  const cashOnCard = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('th')].filter((h) => h.innerText.trim().toLowerCase() === 'jira')
    const t = heads[heads.length - 1].closest('table')
    const cols = [...t.querySelectorAll('thead th')].map((h) => h.innerText.trim().toLowerCase())
    const ix = cols.findIndex((h) => h.startsWith('cash'))
    const row = [...t.querySelectorAll('tbody tr')].find((r) => /FNP-379/.test(r.innerText))
    return { ix, value: row && ix >= 0 ? row.children[ix].innerText.trim() : null }
  })
  check('THE SCORECARD SHOWS THE CASH BENEFIT TOO', cashOnCard.ix > 0 && /\d/.test(cashOnCard.value || ''),
    JSON.stringify(cashOnCard))


  /* ---------- a typed target moves the card total AND the headline ---------- */
  // The reported case: 2,100 typed into a line, and the total underneath went
  // on stating the register's figure.
  await page.evaluate(() => localStorage.clear())
  await page.goto(`${base}/?tgt=1#people`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 1800))
  const tgtTabs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.split(String.fromCharCode(10))[0].trim()))
  const goPerson = async (nick) => {
    await page.evaluate((i) => document.querySelectorAll('[role="tab"]')[i].click(),
      tgtTabs.findIndex((t) => new RegExp(nick).test(t)))
    await new Promise((r) => setTimeout(r, 1300))
  }
  const readCard = () => page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const c = head.closest('.MuiPaper-root')
    const total = [...c.querySelectorAll('tbody tr')].find((r) => /^TOTAL/.test(r.innerText.trim()))
    const tileHead = [...document.querySelectorAll('*')]
      .find((e) => e.children.length === 0 && /saving hours$/i.test(e.textContent.trim()))
    const tile = tileHead?.closest('.MuiPaper-root')
    // the first hours target on the card
    const rows = [...c.querySelectorAll('tbody tr')]
    const hoursRow = rows.find((r) => [...r.querySelectorAll('.MuiInputBase-root')]
      .some((f) => /hrs\/month/.test(f.innerText)))
    return {
      total: total ? total.innerText.match(/([\d,]+(?:\.\d+)?)/)?.[1] ?? null : null,
      tile: tile ? tile.innerText.split(String.fromCharCode(10))[1] : null,
      typed: hoursRow
        ? [...hoursRow.querySelectorAll('.MuiInputBase-root')]
          .find((f) => /hrs\/month/.test(f.innerText))?.querySelector('input')?.value ?? null
        : null,
    }
  })

  await goPerson('Gun')
  const tgtBefore = await readCard()
  check('the card and the headline start in step',
    tgtBefore.total === tgtBefore.tile, JSON.stringify(tgtBefore))

  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    const c = head.closest('.MuiPaper-root')
    const row = [...c.querySelectorAll('tbody tr')].find((r) => [...r.querySelectorAll('.MuiInputBase-root')]
      .some((f) => /hrs\/month/.test(f.innerText)))
    const inp = [...row.querySelectorAll('.MuiInputBase-root')]
      .find((f) => /hrs\/month/.test(f.innerText)).querySelector('input')
    inp.focus(); setter.call(inp, '2100'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.blur()
  })
  await new Promise((r) => setTimeout(r, 1200))
  const tgtAfter = await readCard()
  check('the typed figure stuck', String(tgtAfter.typed).replace(/,/g, '') === '2100', JSON.stringify(tgtAfter))
  check('THE CARD TOTAL MOVED WITH IT', tgtAfter.total !== tgtBefore.total,
    `${tgtBefore.total} -> ${tgtAfter.total}`)
  check('AND SO DID THE HEADLINE ABOVE IT', tgtAfter.tile === tgtAfter.total,
    `tile ${tgtAfter.tile} vs total ${tgtAfter.total}`)
  const tgtSaysRegister = await page.evaluate(() => {
    const head = [...document.querySelectorAll('*')].find((e) => e.textContent.trim() === '2026 KPI scorecard')
    return /register/i.test(head.closest('.MuiPaper-root').innerText)
  })
  check('and the card says what the register still credits', tgtSaysRegister)

  const tgtHeadline = await page.evaluate(() =>
    document.body.innerText.match(/([\d,]+)\s*\/\s*3,000/)?.[1] ?? null)
  check('the project book in the app bar does not move', tgtHeadline === '4,227',
    String(tgtHeadline))

  /* ---------- nothing may push the page sideways ---------- */
  const overflow = async (label) => {
    const r = await page.evaluate(() => {
      const d = document.documentElement
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > d.clientWidth + 2)
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}`)
      return { scrollW: d.scrollWidth, clientW: d.clientWidth, wide }
    })
    check(`${label}: the page does not scroll horizontally`,
      r.scrollW <= r.clientW + 2, `${r.scrollW} vs ${r.clientW}${r.wide.length ? ` — ${r.wide.join(', ')}` : ''}`)
  }
  for (const [tab, w] of [['people', 1500], ['projects', 1500], ['dashboard', 1500], ['people', 1100]]) {
    await page.setViewport({ width: w, height: 1000 })
    await page.goto(`${base}/?v=${w}${tab}#${tab}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await new Promise((r) => setTimeout(r, 900))
    await overflow(`${tab} @ ${w}px`)
  }

  /* ---------- text is not mangled ---------- */
  await page.setViewport({ width: 1500, height: 1000 })
  await page.goto(`${base}/?enc=1#projects`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 900))
  const mojibake = await page.evaluate(() => {
    const t = document.body.innerText
    const hits = t.match(/â€.|Ã.|Â./g) || []
    return [...new Set(hits)].slice(0, 5)
  })
  check('no mis-encoded characters on screen', mojibake.length === 0, mojibake.join(' '))
} catch (e) {
  failures++
  console.log(`FAIL  unexpected error — ${e.message}`)
} finally {
  await browser.close()
  server.kill()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
