/**
 * Objective 1's commitment rule, as a person actually reads it.
 *
 * The rule is two limits and an exception — 20% of each project's own planned
 * length, no more than 15% of everything held, one free re-plan — and it is
 * only a KPI if the person being measured can read it off their own card and
 * check the arithmetic. So this drives the real page and asserts the words AND
 * the numbers, then does the same to the exported sheet, and finally checks the
 * one thing this card has got wrong twice: content wide enough to push the
 * delete button out through the side of the frame.
 *
 *   node scripts/check-commitment.mjs
 */
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { computePlan, repairState, DEFAULT_MAX_PROJECT_DRIFT, DEFAULT_MAX_DRIFTED_SHARE } from '../src/lib/model.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const plan = computePlan(repairState(seed))

console.log('— the arithmetic, before anybody has to read it —')
for (const p of plan.people) {
  const d = p.drift || {}
  if (!d.held) continue
  /*
   * The limit said in projects has to BE the limit said in percent — the whole
   * reason for printing it as a count is that somebody will hold themselves to
   * the count, so the two must not be able to disagree.
   */
  check(`${p.nick}: ${d.allowedCount} of ${d.held} is within ${Math.round(d.limit * 100)}%`,
    d.allowedCount / d.held <= d.limit + 1e-9)
  check(`${p.nick}: one more would break it`,
    (d.allowedCount + 1) / d.held > d.limit,
    `${d.allowedCount + 1}/${d.held} = ${Math.round((d.allowedCount + 1) / d.held * 100)}%`)
  check(`${p.nick}: headroom is the count less what has drifted`,
    d.headroom === d.allowedCount - d.drifted, `${d.headroom}`)
  check(`${p.nick}: the verdict follows the counts`,
    d.within === (d.drifted <= d.allowedCount))

  // Every allowance is 20% of that project's own planned length, floored at a
  // whole day — computed here from the plan, not read back from the model.
  const wrong = (p.commitments || []).filter((c) => {
    const want = c.plannedDays && c.plannedDays > 0
      ? Math.max(1, c.plannedDays * DEFAULT_MAX_PROJECT_DRIFT)
      : null
    return Math.abs((c.driftAllowance ?? -1) - (want ?? -1)) > 1e-9
  })
  check(`${p.nick}: every allowance is ${Math.round(DEFAULT_MAX_PROJECT_DRIFT * 100)}% of its own length`,
    wrong.length === 0, wrong.map((c) => `${c.jiraKey}:${c.plannedDays}d→${c.driftAllowance}`).join(' '))

  // The allowance is knowable from the plan alone, so it must be there before
  // anything has finished — it was missing on every running project once, and
  // the number you need before a date slips is not much use after it.
  const running = (p.commitments || []).filter((c) => c.drifted === null && c.plannedDays > 0)
  check(`${p.nick}: unfinished projects still state their allowance`,
    running.every((c) => c.driftAllowance != null),
    `${running.filter((c) => c.driftAllowance != null).length} of ${running.length}`)

  // And a drifted project is one that spent more than it was allowed.
  const mismatched = (p.commitments || []).filter((c) => {
    if (c.drifted === null || c.overReplanned) return false
    const over = c.driftAllowance != null
      ? c.driftDays > c.driftAllowance + 1e-9
      : c.driftDays > 14
    return over !== c.drifted
  })
  check(`${p.nick}: OVER means it spent more than its allowance`, mismatched.length === 0,
    mismatched.map((c) => `${c.jiraKey}: ${c.driftDays}d of ${c.driftAllowance}d → ${c.drifted}`).join(' '))
}

check('the defaults are the two numbers agreed',
  DEFAULT_MAX_PROJECT_DRIFT === 0.2 && DEFAULT_MAX_DRIFTED_SHARE === 0.15,
  `${DEFAULT_MAX_PROJECT_DRIFT} / ${DEFAULT_MAX_DRIFTED_SHARE}`)

/* ---------- and now on the card, in a real browser ---------- */

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const exe = BROWSERS.find((x) => existsSync(x))
if (!exe) {
  console.log('\nSKIP — no Chromium-based browser found')
  process.exit(failures ? 1 : 0)
}

console.log('\n— the card —')
const PORT = 5329
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
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
await page.setViewport({ width: 1600, height: 1000 })
page.on('dialog', (d) => d.accept().catch(() => {}))
await page.goto(`${base}/#people`, { waitUntil: 'networkidle2' })
await page.evaluate(() => localStorage.clear())
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 1200))

/**
 * Open one person's scorecard and read it.
 *
 * The page shows one person at a time, so the card has to be selected before
 * it can be checked — reading whatever happens to be on screen would have
 * checked the lead's card six times and called it a pass.
 */
const openCard = async (nick) => {
  const clicked = await page.evaluate((n) => {
    const tab = [...document.querySelectorAll('[role="tab"], button')]
      .find((b) => b.innerText.trim().split('\n')[0].trim() === n
        || b.innerText.trim().startsWith(`${n} ·`))
    if (!tab) return false
    tab.click()
    return true
  }, nick)
  await new Promise((r) => setTimeout(r, 700))
  return clicked
}

/** The text of the card now on screen. */
const cardText = async (nick) => {
  const ok = await openCard(nick)
  if (!ok) return null
  return page.evaluate(() => {
    const card = [...document.querySelectorAll('.MuiPaper-root')]
      .find((el) => el.innerText.includes('My commitment'))
    return card ? card.innerText : null
  })
}

/*
 * Two cards, because they state two different books. The lead's objective 1
 * aggregates the whole team; everybody else's is their own. The words on each
 * card have to match the numbers on that same card — a card that says "of the
 * 39 projects" and then quotes an allowance drawn from 15 is worse than one
 * that says nothing.
 */
for (const nick of ['Gun', 'Kade']) {
  const person = plan.people.find((x) => x.nick === nick)
  const line = person.kpiLines.find((l) => l.objective === 'delivery')
  const text = await cardText(nick)
  check(`${nick}: the commitment is on the card`, !!text && text.includes('My commitment'))
  if (!text) continue

  const perPct = Math.round(line.perProjectLimit * 100)
  check(`${nick}: rule 1 states the per-project percentage`,
    text.includes(`Per project — ${perPct}%`))
  check(`${nick}: rule 1 works the percentage into days`,
    new RegExp(`90-day project may move ${Math.round(90 * line.perProjectLimit)} days`).test(text))
  check(`${nick}: rule 2 states the overall percentage`,
    text.includes(`— ${line.target}%.`))
  check(`${nick}: rule 2 says it in PROJECTS, not only percent`,
    line.allowedCount === 0
      ? text.includes('not one')
      : new RegExp(`at most\\s+${line.allowedCount}\\s+may drift`).test(text),
    `${line.allowedCount} of ${line.held}`)
  check(`${nick}: rule 2 counts the same book as the figure beside it`,
    new RegExp(`Of the\\s+${line.held}\\s+projects?`).test(text),
    `held ${line.held}, allowed ${line.allowedCount}`)
  check(`${nick}: and that allowance IS ${Math.round(line.target)}% of that same held count`,
    line.allowedCount === Math.floor(line.held * (line.target / 100) + 1e-9),
    `${line.allowedCount} vs floor(${line.held} × ${line.target}%)`)
  check(`${nick}: rule 3 states the free re-plan`, text.includes('One free re-plan'))
  check(`${nick}: the running count matches the register`,
    text.includes(`${line.driftedCount} of ${line.held} drifted`),
    `${line.driftedCount} of ${line.held}`)
  check(`${nick}: the card says how far over or under the limit it is`,
    line.headroom < 0
      ? text.includes(`${Math.abs(line.headroom)} over the ${line.allowedCount} allowed`)
      : line.headroom === 0
        ? text.includes('one more breaks it')
        : text.includes('may drift before'),
    `headroom ${line.headroom}`)
  // The lead's card aggregates: it must say so, or the list of dates under it
  // reads as a contradiction of the count above it.
  check(`${nick}: whose book it is, is stated`,
    line.aggregatesTeam
      ? text.includes('Those figures are the whole team') && text.includes('the team is PIC of')
      : text.includes('I am PIC of') && !text.includes('whole team'),
    line.aggregatesTeam ? 'aggregates the team' : 'own book')

  // Every project's own allowance, beside it.
  const withDays = (person.commitments || []).filter((c) => c.driftAllowance != null && c.driftDays > 0)
  check(`${nick}: a drifted project shows what it spent AND what it was allowed`,
    withDays.every((c) => text.includes(`+${c.driftDays}d of ${Math.round(c.driftAllowance)}d`)),
    withDays.slice(0, 3).map((c) => `+${c.driftDays}d of ${Math.round(c.driftAllowance)}d`).join(' · ') || 'none drifted')
}

await openCard('Gun')
/*
 * The fault this card has had twice: content that sizes itself to its own text
 * widens the frame, and the delete button ends up outside it. Measured, not
 * eyeballed.
 */
const overflow = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.MuiPaper-root')]
    .filter((el) => el.innerText.includes('My commitment'))
  return cards.map((card) => {
    const box = card.getBoundingClientRect()
    let worst = 0
    for (const el of card.querySelectorAll('*')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      worst = Math.max(worst, Math.round(r.right - box.right))
    }
    const buttons = [...card.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
    return {
      width: Math.round(box.width),
      worst,
      buttonsOutside: buttons.filter((b) => b.right > box.right + 1 || b.left < box.left - 1).length,
      scroll: card.scrollWidth - card.clientWidth,
    }
  })
})
check('cards are found to measure', overflow.length > 0, String(overflow.length))
check('NOTHING on the card reaches past its own frame',
  overflow.every((o) => o.worst <= 1), JSON.stringify(overflow.map((o) => o.worst)))
check('every button — the delete included — is inside the card',
  overflow.every((o) => o.buttonsOutside === 0), JSON.stringify(overflow.map((o) => o.buttonsOutside)))
check('no card scrolls sideways',
  overflow.every((o) => o.scroll <= 1), JSON.stringify(overflow.map((o) => o.scroll)))

/* The tooltip carries the working: planned length, allowance, what was spent. */
const tip = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.MuiPaper-root')].find((el) => el.innerText.includes('My commitment'))
  const span = [...card.querySelectorAll('span')].find((el) => /^\+\d+d of \d+d$/.test(el.textContent.trim()))
  return span ? span.parentElement?.getAttribute('aria-label') || span.getAttribute('aria-label') : null
})
check('the allowance cell carries its working',
  !tip || (/Planned to take \d+ days/.test(tip) && /allows \d+ days/.test(tip)), String(tip).slice(0, 120))

await browser.close()
server.kill()
console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
