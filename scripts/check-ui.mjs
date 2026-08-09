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
import { financeRates, DEFAULT_SETTINGS } from '../src/lib/model.js'

// Objective 1 is measured in baht, so one extra saving hour per month moves its
// target by a year of that hour's value. Taken from the model rather than
// hardcoded, so the test cannot drift away from the app's own arithmetic.
const RATES = financeRates(DEFAULT_SETTINGS)
const PER_HOUR = 12 * RATES.acctHourRate

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
  check('SCORECARD FOLLOWED THE +1 EDIT', Math.abs(after - before - PER_HOUR) <= 1,
    `${before} -> ${after} (one saved hour is worth ${Math.round(PER_HOUR)} a year)`)

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
    Math.abs(Number(await scorecardTarget('Obj 1 — Financial')) - before - 9 * PER_HOUR) <= 1,
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
  await new Promise((r) => setTimeout(r, 1500))

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
    const row = [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('Obj 2 — F&A process automation'))
    // The KPI-line cell, found by content rather than by index — dropping the
    // Block column shifted every position by one, and nth-child(2) then landed
    // on the Target cell, which deliberately stops the click.
    ;[...row.querySelectorAll('td')].find((c) => /^Obj \d+/.test(c.innerText.trim())).click()
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
    // The KPI-line cell, found by content rather than by index — dropping the
    // Block column shifted every position by one, and nth-child(2) then landed
    // on the Target cell, which deliberately stops the click.
    ;[...row.querySelectorAll('td')].find((c) => /^Obj \d+/.test(c.innerText.trim())).click()
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
