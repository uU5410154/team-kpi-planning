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
import {
  computePlan, DEFAULT_SETTINGS, timelineOf, daysBetween, isDate, repairAsOfDate, STALE_AS_OF, asOfOf,
} from '../src/lib/model.js'

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

/* ---------------- the adjusted timeline, and when a project is finished ---- */
console.log(String.fromCharCode(10) + '--- the tasks underneath decide two things ---')
{
  const { mergeJira } = await import('../src/lib/jiraMerge.js')

  const plan = { projects: [{ key: 'P1', jiraKey: 'FNP-1', due: '2026-06-30', summary: 'x' }] }
  const issue = {
    key: 'FNP-1', summary: 'x', status: 'Done', done: true,
    created: '2026-01-01', start: '2026-01-01', resolved: '2026-06-01', startSource: 'start-date',
  }

  /*
   * 1. A task dated past the project's own date moves the adjusted date ONLY
   * when it is labelled as somebody else's delay. The rollup reports the two
   * separately for exactly this reason.
   */
  const delayed = mergeJira(plan, {
    issues: [issue],
    rollups: {
      'FNP-1': {
        total: 3,
        done: 3,
        allDone: true,
        latestDue: '2026-09-15',
        latestDelayDue: '2026-09-15',
        delayKey: 'FNP-99',
        latestResolved: '2026-09-10',
      },
    },
  }, { addNew: false }).projects[0]
  check('A LABELLED DELAY PAST THE PROJECT MOVES THE ADJUSTED DATE',
    delayed.adjustedDue === '2026-09-15', String(delayed.adjustedDue))
  check('  and it names the task that claimed it', delayed.adjustedCause === 'FNP-99')

  const unlabelled = mergeJira(plan, {
    issues: [issue],
    rollups: {
      'FNP-1': {
        total: 3,
        done: 3,
        allDone: true,
        latestDue: '2026-12-31',
        latestDelayDue: null,
        delayKey: null,
        latestResolved: '2026-09-10',
      },
    },
  }, { addNew: false }).projects[0]
  check('AN UNLABELLED OVERRUN MOVES NOTHING', unlabelled.adjustedDue == null,
    'this team’s own slippage is not an adjustment')
  check('  and the COMMITMENT is untouched', delayed.due === '2026-06-30',
    'the plan is what was agreed; the adjustment is drawn beside it')

  // 2. A task dated before it changes nothing.
  const early = mergeJira(plan, {
    issues: [issue],
    rollups: {
      'FNP-1': {
        total: 2, done: 2, allDone: true, latestDue: '2026-05-01', latestDelayDue: '2026-05-01', latestResolved: '2026-05-02',
      },
    },
  }, { addNew: false }).projects[0]
  // Never written rather than written as null: a merge that touches nothing
  // should leave the row untouched, which is what the drift checks rely on.
  check('a task due BEFORE the project date adjusts nothing', early.adjustedDue == null,
    `${JSON.stringify(early.adjustedDue)} — and the field was not written at all`)
  check('  but an adjustment that no longer applies IS cleared', (() => {
    const had = { projects: [{ key: 'P1', jiraKey: 'FNP-1', due: '2026-06-30', adjustedDue: '2026-09-15' }] }
    const now = mergeJira(had, {
      issues: [issue],
      rollups: {
        'FNP-1': {
          total: 1, done: 1, allDone: true, latestDue: '2026-05-01', latestDelayDue: null, latestResolved: '2026-05-01',
        },
      },
    }, { addNew: false }).projects[0]
    return now.adjustedDue === null
  })(), 'a delay that was resolved must stop being drawn')

  // 3. Finished only when every task is.
  const partly = mergeJira(plan, {
    issues: [issue],
    rollups: { 'FNP-1': { total: 4, done: 3, allDone: false, latestDue: null, latestResolved: '2026-06-20' } },
  }, { addNew: false }).projects[0]
  check('AN EPIC MARKED DONE WITH AN OPEN TASK HAS NOT FINISHED',
    partly.actualEnd == null,
    'a card moved to Done is not the last task being finished')

  const allDone = mergeJira(plan, {
    issues: [issue],
    rollups: { 'FNP-1': { total: 4, done: 4, allDone: true, latestDue: null, latestResolved: '2026-07-20' } },
  }, { addNew: false }).projects[0]
  check('AND IT FINISHES ON THE LAST TASK’S DATE, NOT THE EPIC’S',
    allDone.actualEnd === '2026-07-20',
    `epic said ${issue.resolved}, the last task said 2026-07-20`)

  // 4. An epic with no tasks answers for itself.
  const bare = mergeJira(plan, {
    issues: [issue],
    rollups: { 'FNP-1': { total: 0, done: 0, allDone: false, latestDue: null, latestResolved: null } },
  }, { addNew: false }).projects[0]
  check('an epic with no tasks at all still finishes on its own resolution',
    bare.actualEnd === '2026-06-01', String(bare.actualEnd))

  // 5. And the model turns the adjusted date into a bar with a length.
  const withAdj = computePlan({
    ...base,
    projects: [{
      ...base.projects[0], key: 'A1', pic: 'kade', start: '2026-01-01', due: '2026-06-30',
      adjustedDue: '2026-09-15', actualEnd: null, status: 'In Progress',
    }],
  }).projects[0]
  check('the timeline reports the adjustment and its size',
    withAdj.timeline.adjustedEnd === '2026-09-15' && withAdj.timeline.adjustedBy === 77,
    `${withAdj.timeline.adjustedBy} days past the commitment`)
  const noAdj = computePlan({
    ...base,
    projects: [{
      ...base.projects[0], key: 'A2', pic: 'kade', start: '2026-01-01', due: '2026-06-30',
      adjustedDue: '2026-05-01',
    }],
  }).projects[0]
  check('  and an "adjustment" that is earlier is not one',
    noAdj.timeline.adjustedEnd === null)
}

/* ---------------- an actual bar is a fact, not a stopwatch ---------------- */
console.log(String.fromCharCode(10) + '--- nothing unfinished draws an actual bar ---')
{
  const running = timelineOf({
    start: '2026-01-01', due: '2026-12-01', actualStart: '2026-02-01', status: 'In Progress',
  }, AS_OF)
  check('work under way has a start and NO finish',
    running.actualStart === '2026-02-01' && running.actualEnd === null && running.running === true)

  const done = timelineOf({
    start: '2026-01-01', due: '2026-12-01', actualStart: '2026-02-01', actualEnd: '2026-03-01', status: 'Done',
  }, AS_OF)
  check('  and a finished one has both', done.actualEnd === '2026-03-01' && done.running === false)

  /*
   * The as-of date is TODAY, not a string typed months ago. A stale one made
   * anything running measure to a date in the past — a task begun on the 16th
   * read as minus nine days — and delayed everything becoming overdue.
   */
  const today = new Date().toISOString().slice(0, 10)
  check('"AS OF TODAY" IS NOT STORED AT ALL', DEFAULT_SETTINGS.asOfDate === null,
    `default is ${JSON.stringify(DEFAULT_SETTINGS.asOfDate)} — a stored today is wrong tomorrow`)
  check('  it is DERIVED, every time it is asked', asOfOf({}) === today
    && asOfOf({ asOfDate: STALE_AS_OF }) === today,
    `${asOfOf({ asOfDate: STALE_AS_OF })} even when the plan holds ${STALE_AS_OF}`)
  check('  a stale stored date is un-pinned rather than rewritten', (() => {
    const { settings, moved } = repairAsOfDate({ asOfDate: STALE_AS_OF })
    // Nothing is written in its place: writing today would be stale tomorrow,
    // which is the bug this ends.
    return moved === true && settings.asOfDate === null && asOfOf(settings) === today
  })())
  check('  BUT A PINNED DATE IS HONOURED AND LEFT ALONE', (() => {
    const pinned = { asOfDate: '2026-03-31', asOfPinned: true }
    const { settings, moved } = repairAsOfDate(pinned)
    return moved === false && settings.asOfDate === '2026-03-31' && asOfOf(settings) === '2026-03-31'
  })(), 'how somebody reproduces a figure they reported last month')
  check('  and a plan computes against the derived date', (() => {
    const p2 = computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, asOfDate: STALE_AS_OF } })
    return p2.settings.asOfDate === today
  })(), 'the effective date travels with the plan, so every screen agrees')

  // No negative durations, whatever the dates say.
  const backwards = timelineOf({
    start: '2026-01-01', due: '2026-12-01', actualStart: '2026-08-16', status: 'In Progress',
  }, '2026-08-07')
  check('a start after the as-of date reports no duration, not a negative one',
    backwards.actualDays === null || backwards.actualDays >= 0,
    `${backwards.actualDays} days`)
}

/* ---------------- it draws ---------------- */
const exe = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p))

if (!exe) {
  console.log('\nSKIP — no Chromium-based browser found; the model checks above still ran')
} else {
  console.log('\n--- and it draws ---')
  // CHECK_PORT, like check-ui and check-jira, so two checkouts can run it at once.
  const PORT = Number(process.env.CHECK_PORT) || 5403
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

  const seen = await page.evaluate(async () => {
    // The long explanation lives behind "About this page" now: open it and read it.
    const about = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'About this page')
    about?.click()
    await new Promise((r) => setTimeout(r, 400))
    const help = document.querySelector('[role="dialog"][aria-label="About this page"]')?.innerText || ''
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const legend = document.querySelector('[data-timeline="legend"]')?.innerText || ''
    return {
      tab: [...document.querySelectorAll('button, [role="tab"]')].some((b) => b.innerText.trim() === 'Timeline'),
      heading: /Timeline/.test(document.body.innerText),
      // All three outcomes, not just that a legend exists: early, on the day
      // and late are the distinction the chart is for. Read from the legend
      // itself, under the chart, in the words it uses.
      legend: ['Plan', 'Running', 'Finished', 'On schedule', 'Ahead of schedule', 'Behind schedule']
        .every((w) => legend.includes(w)),
      warning: /never edited to match reality/i.test(help),
      bars: document.querySelectorAll('[class*="MuiPaper"] div').length,
      rows: (document.body.innerText.match(/(\d+) projects? on the chart/) || [])[1],
    }
  })
  await page.keyboard.press('Escape')
  check('THERE IS A TIMELINE TAB', seen.tab)
  check('it renders', seen.heading && seen.bars > 50, JSON.stringify({ bars: seen.bars }))
  check('it says how to read it', seen.legend)
  check('and warns against editing the plan to match reality', seen.warning)
  check('it puts projects on the chart', Number(seen.rows) > 0, `${seen.rows} rows`)

  /* ---- one bar per ticket ----
   *
   * The register is allowed more than one line for the same epic — FNP-1151 is
   * carried as three because it delivers three separate savings, costed and
   * credited apart. A timeline is about when one piece of work runs, and the
   * same work drawn three times is a chart that overstates how much is going
   * on. So the lines collapse onto the ticket, and the hours behind them add
   * up rather than being shown three times over.
   */
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    const donor = st.projects.filter((x) => x.start && x.due && x.jiraKey)[0]
    // Three lines, one ticket: the same shape the live register has.
    st.projects.push(
      { ...donor, key: `${donor.key}#2`, savingHours: 3, objective: 'efficiency' },
      // ...including one added by a sync before anybody matched it up: no
      // dates, no hours, nothing. It must not win the bar.
      {
        ...donor, key: `${donor.key}#3`, savingHours: null, objective: 'process_automation',
        start: null, due: null, actualStart: null, actualEnd: null, commitLevel: 'watch',
      },
    )
    localStorage.setItem('fa-tech-kpi-2026', JSON.stringify(st))
    localStorage.setItem('dup-key', donor.jiraKey)
    localStorage.setItem('dup-hours', String(donor.savingHours || 0))
    localStorage.setItem('dup-due', donor.due)
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 3500))

  const dup = await page.evaluate(() => {
    const key = localStorage.getItem('dup-key')
    // Leaf elements only, whatever tag the theme renders the sub-label as:
    // counting every ancestor too would report one bar as several.
    const labels = [...document.querySelectorAll('*')]
      .filter((el) => el.children.length === 0)
      .map((el) => el.textContent.trim())
      .filter((t) => t.startsWith(`${key},`) || t === key)
    return {
      key,
      count: labels.length,
      label: labels[0] || null,
      hours: Number(localStorage.getItem('dup-hours')),
      due: localStorage.getItem('dup-due'),
      onChart: (document.body.innerText.match(/(\d+) projects? on the chart/) || [])[1],
      lines: /register lines/.test(document.body.innerText),
    }
  })
  check('A TICKET APPEARS ONCE, NOT ONCE PER REGISTER LINE',
    dup.count === 1, `${dup.key} drawn ${dup.count} times`)
  check('  and the collapsed row says how many lines are behind it',
    dup.lines && /register lines/.test(dup.label || ''), String(dup.label))
  check('  and adds their hours up rather than showing one line\'s',
    new RegExp(`${(dup.hours + 3).toFixed(1)} hrs/mth`).test(dup.label || '')
    || new RegExp(`${Math.round(dup.hours + 3)} hrs/mth`).test(dup.label || ''),
    `${dup.hours} + 3 vs ${dup.label}`)
  check('  and lists every objective they serve',
    (dup.label.match(/Obj \d/g) || []).length >= 2, String(dup.label))
  check('  and the count is of bars, with the register lines said separately',
    Number(dup.onChart) > 0 && /register lines/.test(await page.evaluate(() => document.body.innerText)),
    `${dup.onChart} on the chart`)

  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 2500))

  /* ---- a bar is evidence of work, or it is not drawn ----
   *
   * The actual bar is drawn from the PLANNED start, so a project nobody has
   * touched still had two real dates to draw with — and drew a sliver whose
   * own tooltip read "Actually ran — to —". The model was right the whole
   * time; the drawing was inventing the bar. Checked here, in the browser,
   * because that is the only place the fault existed.
   */
  const labels = () => page.evaluate(() => [...document.querySelectorAll('[aria-label^="Actually ran"]')]
    .map((el) => el.getAttribute('aria-label')))

  const seedBars = await labels()
  check('NOTHING SAYS "Actually ran — to —"',
    !seedBars.some((t) => /Actually ran [—–] to [—–]/.test(t)),
    seedBars.filter((t) => /[—–] to [—–]/.test(t)).slice(0, 2).join(' | ') || `${seedBars.length} actual bars`)
  check('a register with no outcomes draws no actual bars at all',
    seedBars.length === 0, `${seedBars.length} drawn`)

  /*
   * And the other half: where there IS an outcome, the bar must appear. A rule
   * that draws nothing is not a fix, it is a blank chart.
   */
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
    const withDates = st.projects.filter((p) => p.start && p.due).slice(0, 3)
    // one finished, one still running, one untouched
    withDates[0].actualStart = withDates[0].start
    withDates[0].actualEnd = withDates[0].due
    withDates[0].status = 'Done'
    withDates[1].actualStart = withDates[1].start
    withDates[1].status = 'In Progress'
    delete withDates[2].actualStart
    delete withDates[2].actualEnd
    localStorage.setItem('fa-tech-kpi-2026', JSON.stringify(st))
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 3500))

  const after = await labels()
  check('a finished project DOES draw one',
    // Dates as the page writes them: "2 Nov 2026".
    after.some((t) => /Actually ran \d{1,2} [A-Z][a-z]{2} \d{4} to \d{1,2} [A-Z][a-z]{2} \d{4}/.test(t)),
    after.slice(0, 1).join('') || 'none')
  check('and one under way draws one, running to today',
    after.some((t) => /Actually ran \d{1,2} [A-Z][a-z]{2} \d{4} to still running/.test(t)),
    after.find((t) => /still running/.test(t)) || 'none')
  check('and the untouched one still draws nothing',
    after.length === 2, `${after.length} actual bars for 2 projects with outcomes`)
  check('STILL nothing says "— to —"', !after.some((t) => /[—–] to [—–]/.test(t)),
    after.filter((t) => /[—–] to [—–]/.test(t)).join(' | '))

  // Put the register back before the rest of the suite reads it.
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await new Promise((r) => setTimeout(r, 2500))

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
        // Sentence case now: "Project" and "Slip".
        return t.includes('Project') && t.includes('Slip') && d.children.length === 3
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

  /* ---- the chart is the page ----
   *
   * The figures and the filters used to be two tall cards, and on a laptop the
   * chart began two-thirds of the way down the screen with nine projects in
   * view. They are now one toolbar and one line of figures; the chart takes the
   * rest of the window and scrolls inside itself. Locked here at the sizes
   * people actually use, from a phone to a desktop.
   */
  console.log('\n--- the chart is the page ---')
  await scaleOf('Month')
  const layoutAt = async (width, height) => {
    await page.setViewport({ width, height })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[data-keys]', { timeout: 15000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 1500))
    return page.evaluate(() => {
      const H = window.innerHeight
      const box = (sel) => document.querySelector(sel)?.getBoundingClientRect()
      const rows = [...document.querySelectorAll('[data-keys]')]
      const seen = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.height > 0 && b.top >= 0 && b.bottom <= H })
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        summary: Math.round(box('[data-timeline="summary"]')?.height || 0),
        filters: Math.round(box('[data-timeline="filters"]')?.height || 0),
        rowH: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0,
        seen: seen.length,
        all: rows.length,
        // How many whole rows the chart's own window has room for, below its header row.
        room: (() => {
          const c = box('[data-timeline="chart"]')
          const r = rows[0]?.getBoundingClientRect()
          return c && r ? Math.floor((Math.min(c.bottom, H) - r.top) / r.height) : 0
        })(),
        chartBottom: Math.round(box('[data-timeline="chart"]')?.bottom || 0),
        H,
      }
    })
  }
  /*
   * What a reader sees at each size: on a phone a list, one line per name, the
   * due date and where it stands said in words; on a tablet a Gantt whose
   * words beside the bars are whole or absent, never cut at the chart's edge,
   * and whose Today tag sits inside the calendar.
   */
  const readAt = () => page.evaluate(() => {
    const first = document.querySelector('[data-keys]')
    const name = first?.querySelector('[title]')
    const today = document.querySelector('[aria-label^="Today,"]')
    const cut = []
    for (const el of document.querySelectorAll('[data-timeline="chart"] span')) {
      if (!el.innerText || el.children.length) continue
      const parent = el.parentElement
      if (getComputedStyle(parent).overflow !== 'hidden') continue
      const r = el.getBoundingClientRect()
      const box = parent.getBoundingClientRect()
      if (r.right > box.right + 0.5 || r.left < box.left - 0.5) cut.push(el.innerText)
    }
    // The month cells ("Jan", or "J" where every month is squeezed), not the year tier above them.
    const cells = today ? [...today.parentElement.children].filter((c) => /^[A-Z][a-z]{0,2}$/.test(c.innerText.trim())) : []
    const lefts = cells.map((c) => c.getBoundingClientRect().left)
    const steps = lefts.slice(1).map((x, i) => x - lefts[i]).sort((a, b) => a - b)
    const trackRight = today ? today.parentElement.getBoundingClientRect().right : 0
    return {
      gantt: !!today,
      text: first?.innerText || '',
      nameH: name ? Math.round(name.getBoundingClientRect().height) : 0,
      cut,
      todayIn: today ? (() => {
        const t = today.getBoundingClientRect()
        const track = today.parentElement.getBoundingClientRect()
        return t.left >= track.left && t.right <= track.right
      })() : null,
      // The last month: as wide as a month is, and labelled the way the others are.
      last: cells.length > 2 ? {
        label: cells[cells.length - 1].innerText.trim(),
        first: cells[0].innerText.trim(),
        width: Math.round(trackRight - lefts[lefts.length - 1]),
        month: Math.round(steps[Math.floor(steps.length / 2)]),
      } : null,
    }
  })
  for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]]) {
    const l = await layoutAt(w, h)
    check(`NO SIDEWAYS PAGE SCROLL AT ${w}px`, l.overflow <= 0, `${l.overflow}px too wide`)
    const r = await readAt()
    if (w === 390) {
      check('A PHONE GETS A LIST, NOT A GANTT SQUEEZED INTO 200px', !r.gantt && l.all > 0, `${l.all} rows`)
      check('  each name on one line', r.nameH > 0 && r.nameH <= 22, `${r.nameH}px`)
      check('  with its due date and where it stands, in words',
        /due \d{1,2} [A-Z][a-z]{2}|no due date/.test(r.text) && /Not started|Running|Finished|Past due|Started/.test(r.text),
        r.text.replace(/\n/g, ' | '))
    } else {
      check(`  AT ${w}px NO WORD BESIDE A BAR IS CUT AT THE CHART'S EDGE`, r.cut.length === 0, r.cut.slice(0, 3).join(' | '))
      check(`  and the Today tag sits inside the calendar`, r.todayIn === true)
      check('  and the calendar ends on a whole month, not a sliver with a lone letter',
        r.last && r.last.width >= r.last.month * 0.85 && r.last.label.length === r.last.first.length, JSON.stringify(r.last))
    }
  }
  const wide = await layoutAt(1440, 900)
  const wideRead = await readAt()
  check('  AT 1440px NO WORD BESIDE A BAR IS CUT, AND TODAY AND THE LAST MONTH ARE WHOLE',
    wideRead.cut.length === 0 && wideRead.todayIn === true && wideRead.last && wideRead.last.width >= wideRead.last.month * 0.85
    && wideRead.last.label.length === wideRead.last.first.length, JSON.stringify({ cut: wideRead.cut.slice(0, 3), last: wideRead.last }))
  check('NO SIDEWAYS PAGE SCROLL AT 1440px', wide.overflow <= 0, `${wide.overflow}px too wide`)
  check('THE FIGURES AND FILTERS TOGETHER TAKE UNDER 120px',
    wide.summary > 0 && wide.filters > 0 && wide.summary + wide.filters < 120,
    `figures ${wide.summary}px + filters ${wide.filters}px`)
  /*
   * Rows are 44px now (the design system's table row: a 14px name and a 13px
   * meta line, neither touching the borders), where they were 36px and two
   * lines crushed together. So fewer fit, and what is locked is that the chart
   * still takes the whole window and fills it with rows, not a fixed count
   * worked out for the old height.
   */
  check('THE CHART RUNS TO THE FOOT OF A 1440x900 SCREEN',
    wide.chartBottom >= wide.H - 24 && wide.chartBottom <= wide.H, `ends at ${wide.chartBottom}px of ${wide.H}`)
  check('  AND IS FULL OF PROJECTS, AT LEAST 11 IN VIEW WITHOUT SCROLLING',
    wide.seen >= 11 && wide.seen >= wide.room, `${wide.seen} of ${wide.all} rows in view, room for ${wide.room}, ${wide.rowH}px each`)
  check('  rows are 44px: readable, not crushed', wide.rowH === 44, `${wide.rowH}px`)

  await browser.close()
  srv.kill()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
