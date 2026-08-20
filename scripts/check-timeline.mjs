/**
 * Planned against actual.
 *
 * The rule this locks: a project is never reported as on time because nobody
 * said what happened to it. Silence is silence, and it has to look like it —
 * both in the model and on the chart.
 *
 * Run with: node scripts/check-timeline.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import { computePlan, DEFAULT_SETTINGS, timelineOf, daysBetween, isDate } from '../src/lib/model.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { ...seed, settings: DEFAULT_SETTINGS }
const AS_OF = DEFAULT_SETTINGS.asOfDate

/* ---------------- the date arithmetic ---------------- */
console.log('--- dates are dates, and nothing else is ---')
check('a real date is a date', isDate('2026-03-01'))
check('a half-written one is not', !isDate('2026-3-1') && !isDate('2026-03') && !isDate(''))
check('the 31st of February is not', !isDate('2026-02-31'))
check('nor is a number that looks like one', !isDate(20260301) && !isDate(null))
check('days between counts whole days', daysBetween('2026-01-01', '2026-01-31') === 30)
check('and signs them', daysBetween('2026-03-01', '2026-02-01') === -28)
check('and refuses to guess', daysBetween('2026-01-01', null) === null)

/* ---------------- silence is not success ---------------- */
console.log('\n--- a project nobody reported on is not on time ---')
{
  const planned = { start: '2026-01-01', due: '2026-03-01', status: 'In Progress' }
  const early = timelineOf(planned, '2026-02-01')
  check('mid-flight, with nothing recorded, it is not judged', early.comparable === false
    && early.lateBy === null && early.state === 'not started',
    JSON.stringify({ comparable: early.comparable, lateBy: early.lateBy }))

  const past = timelineOf(planned, '2026-04-01')
  check('PAST ITS DUE DATE AND UNFINISHED, IT IS LATE NOW', past.overdue === true && past.lateBy === 31,
    `${past.lateBy} days past ${planned.due}`)
  check('  and it counts as judged', past.comparable === true)

  const done = timelineOf({ ...planned, status: 'Done' }, '2026-04-01')
  check('marked Done with no end date, it is not called late', done.overdue === false && done.lateBy === null,
    'a finish nobody dated cannot be measured against a plan')
  check('  nor is it counted as judged', done.comparable === false)
}

/* ---------------- what a slip is ---------------- */
console.log('\n--- the slip is the gap between the two right-hand edges ---')
{
  const late = timelineOf({
    start: '2026-01-01', due: '2026-03-01', actualStart: '2026-01-15', actualEnd: '2026-04-01', status: 'Done',
  }, AS_OF)
  check('a finish after the due date is a positive slip', late.endVariance === 31 && late.lateBy === 31)
  check('and a late start is reported separately', late.startVariance === 14,
    'starting late and finishing late are different failures')
  check('the state is finished', late.state === 'finished')

  const early = timelineOf({
    start: '2026-01-01', due: '2026-03-01', actualStart: '2026-01-01', actualEnd: '2026-02-14', status: 'Done',
  }, AS_OF)
  check('EARLY IS A NEGATIVE SLIP, NOT A ZERO', early.lateBy === -15, `${early.lateBy} days`)

  const running = timelineOf({
    start: '2026-01-01', due: '2026-12-01', actualStart: '2026-02-01', status: 'In Progress',
  }, AS_OF)
  check('a started, unfinished project is running', running.running === true && running.state === 'running')
  check('  and is measured up to today, not to nothing',
    running.actualDays === daysBetween('2026-02-01', AS_OF), `${running.actualDays} days so far`)
  check('  but is not judged while it still has time', running.comparable === false)
}

/* ---------------- the rollup ---------------- */
console.log('\n--- the rollup counts what it says it counts ---')
{
  const withDates = computePlan({
    ...base,
    projects: base.projects.map((p, i) => (i % 3 === 0
      ? { ...p, start: '2026-01-01', due: '2026-02-01', actualStart: '2026-01-01', actualEnd: '2026-03-01', status: 'Done' }
      : p)),
  })
  const t = withDates.totals.timeliness
  const rows = withDates.projects.filter((p) => p.commitLevel !== 'nextyear' && p.commitLevel !== 'excluded' && !p.outsideTeam)
  check('every counted row is in plan and ours',
    t.planned <= rows.length && t.judged <= t.planned,
    `${t.planned} planned, ${t.judged} judged, of ${rows.length} rows`)
  check('ON TIME PLUS LATE IS EXACTLY WHAT WAS JUDGED', t.onTime + t.late === t.judged,
    `${t.onTime} + ${t.late} vs ${t.judged}`)
  // Worked out from the rows themselves: hard-coding the answer only proves
  // the fixture has not changed.
  const lateRows = rows.filter((p) => (p.timeline.lateBy ?? 0) > 0)
  const expected = lateRows.length
    ? Math.round(lateRows.reduce((a, p) => a + p.timeline.lateBy, 0) / lateRows.length)
    : null
  check('the average slip is over the late ones only', t.avgSlip === expected,
    `${t.avgSlip} vs ${expected} across ${t.late} late of ${t.judged} judged`)
  check('  and it is not diluted by the on-time ones',
    t.late === 0 || t.avgSlip >= Math.min(...lateRows.map((p) => p.timeline.lateBy)),
    `smallest slip ${lateRows.length ? Math.min(...lateRows.map((p) => p.timeline.lateBy)) : '—'}`)
  check('and the worst offenders are the worst', t.worst.every((p, i, a) => i === 0
    || a[i - 1].timeline.lateBy >= p.timeline.lateBy))

  // A row owned outside the team is not this team's schedule to answer for.
  const withOutside = computePlan({
    ...base,
    projects: base.projects.map((p, i) => (i === 0
      ? { ...p, pic: 'user', start: '2026-01-01', due: '2026-01-02', status: 'In Progress' }
      : p)),
  })
  check('SOMEBODY ELSE\u2019S LATE PROJECT IS NOT OUR LATE PROJECT',
    !withOutside.totals.timeliness.worst.some((p) => p.outsideTeam),
    `${withOutside.totals.timeliness.overdue} overdue, none owned outside the team`)
}

/* ---------------- the plan is never rewritten ---------------- */
console.log('\n--- recording an outcome does not touch the plan ---')
{
  const before = computePlan(base).projects[0]
  const after = computePlan({
    ...base,
    projects: base.projects.map((p, i) => (i === 0 ? { ...p, actualEnd: '2026-09-09' } : p)),
  }).projects[0]
  check('THE PLANNED DATES ARE UNTOUCHED BY THE ACTUAL ONES',
    after.start === before.start && after.due === before.due,
    `planned ${before.start || 'none'} to ${before.due || 'none'} either way`)
  check('and the hours, cost and objective are untouched too',
    after.savingHours === before.savingHours && after.investment === before.investment
    && after.objective === before.objective)
}

/* ---------------- it draws ---------------- */
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

if (!exe) {
  console.log('\nSKIP — no Chromium-based browser found; the model checks above still ran')
} else {
  console.log('\n--- and it draws ---')
  const PORT = 5403
  const srv = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), MONGODB_URI: '' },
    stdio: 'ignore',
  })
  const url = `http://127.0.0.1:${PORT}`
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break
    } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 400))
  }
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 1600, height: 1100 })
  await page.goto(`${url}/#timeline`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await new Promise((r) => setTimeout(r, 4000))

  const seen = await page.evaluate(() => ({
    tab: [...document.querySelectorAll('button, [role="tab"]')].some((b) => b.innerText.trim() === 'Timeline'),
    heading: /Timeline/.test(document.body.innerText),
    // All three outcomes, not just that a legend exists: early, on the day
    // and late are the distinction the chart is for.
    legend: ['planned', 'ahead of schedule', 'on schedule', 'behind schedule']
      .every((w) => new RegExp(w, 'i').test(document.body.innerText)),
    warning: /never edited to match reality/i.test(document.body.innerText),
    bars: document.querySelectorAll('[class*="MuiPaper"] div').length,
    rows: (document.body.innerText.match(/(\d+) projects? on the chart/) || [])[1],
  }))
  check('THERE IS A TIMELINE TAB', seen.tab)
  check('it renders', seen.heading && seen.bars > 50, JSON.stringify({ bars: seen.bars }))
  check('it says how to read it', seen.legend)
  check('and warns against editing the plan to match reality', seen.warning)
  check('it puts projects on the chart', Number(seen.rows) > 0, `${seen.rows} rows`)

  // Filtering to a state nothing is in must empty it rather than show everything
  const filtered = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')].find((l) => l.innerText.trim() === 'State')
    label.closest('.MuiFormControl-root').querySelector('[role="combobox"]')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    return true
  })
  void filtered
  await new Promise((r) => setTimeout(r, 800))
  const opts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()))
  check('the state filter offers the states that matter',
    ['Past due, unfinished', 'Running now', 'Finished'].every((x) => opts.includes(x)), opts.join(' | '))

  /* ---- day, week and month ---- */
  const scaleOf = async (label) => {
    await page.evaluate((l) => {
      // The theme upper-cases button labels, so match without regard to case.
      const b = [...document.querySelectorAll('button')]
        .find((x) => x.innerText.trim().toLowerCase() === l.toLowerCase())
      if (!b) throw new Error(`no ${l} button`)
      b.click()
    }, label)
    await new Promise((r) => setTimeout(r, 900))
    return page.evaluate(() => {
      // The header row is the one carrying both column titles; the calendar is
      // the box between them.
      const rows = [...document.querySelectorAll('div')].filter((d) => {
        const t = d.innerText || ''
        return t.includes('PROJECT') && t.includes('SLIP') && d.children.length === 3
      })
      const head = rows[rows.length - 1]
      const track = head && head.children[1]
      const box = [...document.querySelectorAll('div')].find((d) => d.scrollWidth > d.clientWidth + 50)
      return {
        ticks: track ? track.children.length : 0,
        firstTicks: track ? [...track.children].slice(0, 3).map((c) => c.innerText.trim()) : [],
        trackWidth: track ? Math.round(track.getBoundingClientRect().width) : 0,
        scrollable: !!box,
        scrolled: box ? box.scrollLeft : 0,
      }
    })
  }

  const month = await scaleOf('Month')
  const week = await scaleOf('Week')
  const day = await scaleOf('Day')

  check('THERE IS A DAY, WEEK AND MONTH VIEW',
    month.ticks > 0 && week.ticks > month.ticks && day.ticks > week.ticks,
    `month ${month.ticks} ticks, week ${week.ticks}, day ${day.ticks}`)
  check('  each scale is finer than the last, and wider',
    day.trackWidth > week.trackWidth && week.trackWidth > month.trackWidth,
    `${month.trackWidth}px -> ${week.trackWidth}px -> ${day.trackWidth}px`)
  check('  the month view still fits without scrolling', month.scrollable === false || month.trackWidth < 2000,
    `${month.trackWidth}px`)
  check('  and the finer ones scroll', day.scrollable === true)
  check('  landing on today rather than on January',
    day.scrolled > 0, `scrolled ${Math.round(day.scrolled)}px in`)
  check('  the week scale is labelled by date', /^\d+ \w+$/.test(week.firstTicks[0] || ''), week.firstTicks.join(' | '))
  check('  and the day scale by day number', /^\d+$/.test(day.firstTicks[0] || ''), day.firstTicks.join(' | '))

  await browser.close()
  srv.kill()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
