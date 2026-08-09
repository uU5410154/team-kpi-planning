/**
 * KPI lines written by hand.
 *
 * A scorecard has to carry work the project register cannot count, and state
 * its target in the unit that work is actually measured in — not everything is
 * saving hours. What must hold:
 *   1. a hand-added line joins the SAME 100% as the derived ones, and the card
 *      still totals exactly 100%;
 *   2. it can be tied to an objective, and then behaves like any other line of
 *      that objective — it filters the portfolio and reports under it;
 *   3. its target keeps its own kind and unit everywhere: on the card, in the
 *      workbook, and after a save and reload;
 *   4. it never touches a number that belongs to the register — hours, ROI,
 *      the team total — because it carries no projects;
 *   5. nothing malformed can reach the card.
 *
 * Run with: node scripts/check-kpilines.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, TARGET_KINDS, isNumericKind, newCustomLine,
  normalizeCustomLines, fmtTarget, targetUnit, weightSum, weightsValid, WEIGHT_STEP,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'
import { OBJ_BY_ID } from '../src/lib/palette.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const withLines = (personId, lines) => ({
  ...base,
  people: base.people.map((p) => (p.id === personId ? { ...p, customLines: lines } : p)),
})

/* ---------------- 1. what can be written ---------------- */
console.log('--- the shape of a hand-written line ---')
{
  check('there is more than one way to state a target', TARGET_KINDS.length >= 5,
    TARGET_KINDS.map((k) => k.id).join(', '))
  check('and it is not only saving hours',
    TARGET_KINDS.some((k) => k.id !== 'hours' && k.numeric)
    && TARGET_KINDS.some((k) => !k.numeric), TARGET_KINDS.map((k) => `${k.id}:${k.numeric ? 'n' : 't'}`).join(' '))
  check('every kind says whether it is a number', TARGET_KINDS.every((k) => typeof k.numeric === 'boolean'))
  check('every kind has a label and an explanation',
    TARGET_KINDS.every((k) => k.label && k.help))
  check('a new line starts blank and untied',
    newCustomLine().label === '' && newCustomLine().objective === null)
  check('and two of them do not share an id', newCustomLine(1).id !== newCustomLine(2).id)

  const messy = normalizeCustomLines([
    { id: 'a', label: '  Spaced  ', targetKind: 'number', target: '12', unit: ' days ', objective: 'process_automation' },
    { id: 'b', label: '', targetKind: 'wizardry', target: 'x', objective: 'not-an-objective' },
    { id: 'c', label: 'Money', targetKind: 'thb', target: 'not a number' },
    null,
    'nonsense',
  ])
  check('a malformed list is cleaned rather than trusted', messy.length === 3, String(messy.length))
  check('labels and units are trimmed', messy[0].label === 'Spaced' && messy[0].unit === 'days')
  check('a number arrives as a number', messy[0].target === 12 && typeof messy[0].target === 'number')
  check('an unknown kind falls back to free text', messy[1].targetKind === 'text', messy[1].targetKind)
  check('an unknown objective becomes untied, not a dangling link', messy[1].objective === null)
  check('an unnamed line still gets a name', !!messy[1].label, messy[1].label)
  check('a number that is not a number becomes 0, never NaN',
    messy[2].target === 0, JSON.stringify(messy[2].target))
}

/* ---------------- 2. it joins the same 100% ---------------- */
console.log('\n--- it joins the card, and the card still totals 100% ---')
{
  const before = computePlan(base).people.find((p) => p.id === 'james')
  const one = { id: 'custom-1', label: 'Close the books in 3 days', objective: null, targetKind: 'number', target: 3, unit: 'days' }
  const after = computePlan(withLines('james', [one])).people.find((p) => p.id === 'james')

  check('the line is on the card', after.kpiLines.some((l) => l.id === 'custom-1'),
    after.kpiLines.map((l) => l.id).join(', '))
  check('it is marked as one somebody wrote', after.kpiLines.find((l) => l.id === 'custom-1').custom === true)
  check('THE CARD STILL TOTALS EXACTLY 100%', weightsValid(after.kpiLines),
    `${(weightSum(after.kpiLines) * 100).toFixed(2)}%`)
  check('and nothing is blocked from saving',
    computePlan(withLines('james', [one])).invalid.length === 0)
  check('it carries real weight, not zero',
    after.kpiLines.find((l) => l.id === 'custom-1').weight > 0,
    `${Math.round(after.kpiLines.find((l) => l.id === 'custom-1').weight * 100)}%`)
  check('the derived lines gave the weight up rather than the card growing past 100%',
    after.kpiLines.filter((l) => !l.custom).reduce((a, l) => a + l.weight, 0)
      < before.kpiLines.reduce((a, l) => a + l.weight, 0) + 1e-9)
  check('every weight is still on the 5-point grid',
    after.kpiLines.every((l) => Math.abs((l.weight * 100) % WEIGHT_STEP) < 1e-6),
    after.kpiLines.map((l) => `${Math.round(l.weight * 100)}%`).join(' '))

  // a lot of them
  const many = Array.from({ length: 6 }, (_, i) => ({
    id: `custom-${i}`, label: `KPI ${i}`, objective: null, targetKind: 'text', target: 'done',
  }))
  const loaded = computePlan(withLines('pol', many)).people.find((p) => p.id === 'pol')
  check('six hand-written lines still total 100%', weightsValid(loaded.kpiLines),
    `${(weightSum(loaded.kpiLines) * 100).toFixed(2)}% over ${loaded.kpiLines.length} lines`)

  // every person, every kind: the card never breaks
  let broke = 0
  for (const person of base.people.filter((p) => p.scorecard !== false)) {
    for (const kind of TARGET_KINDS) {
      const plan = computePlan(withLines(person.id, [{
        id: 'custom-x', label: 'x', objective: null, targetKind: kind.id, target: isNumericKind(kind.id) ? 5 : 'x',
      }]))
      if (plan.invalid.length) broke++
    }
  }
  check('NO PERSON AND NO KIND CAN BREAK A CARD', broke === 0, `${broke} broke`)
}

/* ---------------- 3. tied to an objective ---------------- */
console.log('\n--- tied to an objective, it behaves like one ---')
{
  const tied = { id: 'custom-t', label: 'Automation service level', objective: 'process_automation', targetKind: 'number', target: 99, unit: '%' }
  const plan = computePlan(withLines('james', [tied]))
  const james = plan.people.find((p) => p.id === 'james')
  const line = james.kpiLines.find((l) => l.id === 'custom-t')

  check('the line knows its objective', line.objective === 'process_automation', String(line.objective))
  // It must NOT be added to the objectives held: that would build a second,
  // derived line for the same objective and put the same thing on the card
  // twice.
  check('it does not silently grow a second line for that objective',
    james.kpiLines.filter((l) => l.objective === 'process_automation').length === 1,
    james.kpiLines.filter((l) => l.objective === 'process_automation').map((l) => l.id).join(', '))
  check('and where the person already holds the objective, the two sit side by side',
    computePlan(withLines('kade', [{ ...tied, objective: 'process_automation' }]))
      .people.find((p) => p.id === 'kade').kpiLines
      .filter((l) => l.objective === 'process_automation').length === 2)
  check('IT IS NOT OFFERED A SYNC IT HAS NOTHING TO SYNC TO', line.drifted === false)
  check('and it claims none of the register\'s credited hours',
    line.creditedHours === null && line.creditedMoney === null,
    `${line.creditedHours} / ${line.creditedMoney}`)

  const untied = computePlan(withLines('james', [{ ...tied, objective: null }]))
    .people.find((p) => p.id === 'james').kpiLines.find((l) => l.id === 'custom-t')
  check('untied, it belongs to no objective', untied.objective === null)
  check('but still carries weight', untied.weight > 0, `${Math.round(untied.weight * 100)}%`)
}

/* ---------------- 4. it must not move the register ---------------- */
console.log('\n--- it carries no projects, so it moves no project number ---')
{
  const before = computePlan(base)
  const plan = computePlan(withLines('james', [
    { id: 'c1', label: 'A', objective: 'process_automation', targetKind: 'hours', target: 9999 },
    { id: 'c2', label: 'B', objective: null, targetKind: 'thb', target: 5000000 },
  ]))
  check('THE TEAM TOTAL DOES NOT MOVE',
    Math.abs(before.totals.totalHours - plan.totals.totalHours) < 1e-9,
    `${before.totals.totalHours.toFixed(2)} vs ${plan.totals.totalHours.toFixed(2)}`)
  check('the committed total does not move',
    Math.abs(before.totals.committedHours - plan.totals.committedHours) < 1e-9)
  const jB = before.people.find((p) => p.id === 'james')
  const jA = plan.people.find((p) => p.id === 'james')
  check('the person\'s credited hours do not move', Math.abs(jB.hours - jA.hours) < 1e-9,
    `${jB.hours} vs ${jA.hours}`)
  check('and neither does their portfolio', jB.rows.length === jA.rows.length)
  check('a 9,999-hour hand-written target does not become 9,999 real hours',
    Math.abs(jA.hours - jB.hours) < 1e-9)
}

/* ---------------- 5. the target keeps its unit ---------------- */
console.log('\n--- the target keeps its own kind and unit ---')
{
  const cases = [
    [{ targetKind: 'hours', target: 120 }, '120 hrs/month', 'hrs/month'],
    [{ targetKind: 'thb', target: 250000 }, '฿250,000/year', '฿/year'],
    [{ targetKind: 'number', target: 3, unit: 'days' }, '3 days', 'days'],
    [{ targetKind: 'number', target: 99, unit: '%' }, '99 %', '%'],
    [{ targetKind: 'number', target: 12 }, '12', ''],
    [{ targetKind: 'date', target: '2026-11-30' }, '2026-11-30', 'hrs/month'],
    [{ targetKind: 'text', target: 'Live by November' }, 'Live by November', 'hrs/month'],
  ]
  for (const [line, shown, unit] of cases) {
    check(`${line.targetKind}${line.unit ? ` (${line.unit})` : ''} reads as "${shown}"`,
      fmtTarget(line) === shown, fmtTarget(line))
    check(`  and its unit label is "${unit}"`, targetUnit(line) === unit, targetUnit(line))
  }
  check('an empty free-text target reads as a dash, not as nothing',
    fmtTarget({ targetKind: 'text', target: '' }) === '—', fmtTarget({ targetKind: 'text', target: '' }))
}

/* ---------------- 6. the workbook says the same ---------------- */
console.log('\n--- the workbook says the same thing ---')
{
  const lines = [
    { id: 'c-num', label: 'Close in three days', objective: 'process_automation', targetKind: 'number', target: 3, unit: 'days' },
    { id: 'c-date', label: 'Warehouse live', objective: 'datawarehouse', targetKind: 'date', target: '2026-11-30' },
    { id: 'c-text', label: 'Coach the juniors', objective: null, targetKind: 'text', target: 'Two sessions a quarter' },
    { id: 'c-thb', label: 'Licence saving', objective: 'financial', targetKind: 'thb', target: 250000 },
  ]
  const state = withLines('james', lines)
  const plan = computePlan(state)
  const wb = await buildWorkbook(plan, state)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())
  const ws = back.getWorksheet('Obj-James')

  const rows = []
  ws.eachRow((r) => rows.push([r.getCell(2).value, r.getCell(3).value, r.getCell(4).value]))
  const textOf = (label) => rows.find((r) => String(r[0] || '').includes(label))

  const james = plan.people.find((p) => p.id === 'james')
  for (const l of lines) {
    const onCard = james.kpiLines.find((x) => x.id === l.id)
    check(`${l.label}: is on the scorecard`, !!onCard, String(onCard?.weight))
    const row = textOf(l.label)
    check(`${l.label}: IS ON THE EXPORTED SHEET`, !!row, JSON.stringify(row))
    if (!row) continue
    if (l.targetKind === 'number') {
      check(`${l.label}: the target is a NUMBER in the cell, not a string`,
        row[1] === 3 && typeof row[1] === 'number', JSON.stringify(row[1]))
    } else if (l.targetKind === 'thb') {
      check(`${l.label}: the money target is a number`, row[1] === 250000, JSON.stringify(row[1]))
    } else {
      check(`${l.label}: the target reads as written`, String(row[1]) === String(l.target),
        JSON.stringify(row[1]))
    }
  }

  // The weights in the KPI block — found by matching each line's own row, not
  // by sweeping the column, which also picks up the contribution shares below.
  const weightFor = (line) => {
    const want = line.custom ? line.label : null
    const row = rows.find((r) => {
      const text = String(r[0] || '')
      return want ? text.startsWith(want) : text.includes(`Obj ${OBJ_BY_ID[line.objective]?.no} —`)
    })
    return row ? row[2] : null
  }
  const paired = james.kpiLines.map((l) => ({ id: l.id, app: l.weight, sheet: weightFor(l) }))
  check('every line on the card has a row on the sheet',
    paired.every((x) => typeof x.sheet === 'number'),
    paired.filter((x) => typeof x.sheet !== 'number').map((x) => x.id).join(', '))
  check('AND ITS WEIGHT IS THE WEIGHT THE APP SHOWS',
    paired.every((x) => Math.abs(x.sheet - x.app) < 1e-9),
    paired.map((x) => `${x.id} ${x.sheet} vs ${x.app}`).join(' | '))
  check('THE EXPORTED WEIGHTS STILL TOTAL 100%',
    Math.abs(paired.reduce((a, x) => a + (x.sheet || 0), 0) - 1) < 1e-6,
    `${(paired.reduce((a, x) => a + (x.sheet || 0), 0) * 100).toFixed(2)}% over ${paired.length} lines`)

  // nothing on the team-wide sheets moved
  const summary = back.getWorksheet('Summary')
  let committed = null
  summary.eachRow((r) => {
    if (/^Committed . bankable/i.test(String(r.getCell(1).value || ''))) committed = r.getCell(2).value
  })
  check('the committed headline is untouched by a hand-written KPI',
    Math.abs(committed - computePlan(base).totals.committedHours) < 0.51,
    `${committed} vs ${computePlan(base).totals.committedHours.toFixed(1)}`)
}

/* ---------------- 7. editing and removing ---------------- */
console.log('\n--- editing it, and taking it off again ---')
{
  const one = { id: 'custom-1', label: 'First name', objective: null, targetKind: 'text', target: 'a' }
  const edited = { ...one, label: 'Second name', objective: 'efficiency', targetKind: 'number', target: 7, unit: 'reports' }
  const after = computePlan(withLines('james', [edited])).people.find((p) => p.id === 'james')
  const line = after.kpiLines.find((l) => l.id === 'custom-1')
  check('an edit replaces the line rather than adding a second one',
    after.kpiLines.filter((l) => l.id === 'custom-1').length === 1)
  check('the new name, objective, kind and unit all take', line.label === 'Second name'
    && line.objective === 'efficiency' && line.targetKind === 'number' && line.unit === 'reports',
    JSON.stringify({ label: line.label, objective: line.objective, kind: line.targetKind, unit: line.unit }))
  check('and the card still totals 100%', weightsValid(after.kpiLines))

  // a typed weight still lands exactly where it was typed
  const pinned = computePlan({
    ...withLines('james', [one]),
    people: withLines('james', [one]).people.map((p) => (p.id === 'james'
      ? { ...p, customLines: [one], kpi: { 'custom-1': { weight: 0.4 } } } : p)),
  }).people.find((p) => p.id === 'james')
  check('A TYPED WEIGHT ON A HAND-WRITTEN LINE IS HONOURED EXACTLY',
    Math.abs(pinned.kpiLines.find((l) => l.id === 'custom-1').weight - 0.4) < 1e-9,
    `${(pinned.kpiLines.find((l) => l.id === 'custom-1').weight * 100).toFixed(1)}%`)
  check('and the rest of the card still fills the other 60%', weightsValid(pinned.kpiLines),
    `${(weightSum(pinned.kpiLines) * 100).toFixed(2)}%`)

  // a typed TARGET overrides the one the line was created with
  const retargeted = computePlan({
    ...base,
    people: base.people.map((p) => (p.id === 'james'
      ? { ...p, customLines: [one], kpi: { 'custom-1': { target: 'typed on the card' } } } : p)),
  }).people.find((p) => p.id === 'james')
  check('a target typed on the card wins over the one it was created with',
    retargeted.kpiLines.find((l) => l.id === 'custom-1').target === 'typed on the card')

  // removing: the line goes, the card is short, and that is a real error
  const removed = computePlan(withLines('james', []))
  check('deleting it takes it off the card',
    !removed.people.find((p) => p.id === 'james').kpiLines.some((l) => l.id === 'custom-1'))
  check('and the card returns to 100% on its own',
    weightsValid(removed.people.find((p) => p.id === 'james').kpiLines))
}

/* ---------------- 8. what the card adds up to ---------------- */
console.log('\n--- the card states the saving hours it carries ---')
{
  const plan = computePlan(base)
  for (const p of plan.people) {
    check(`${p.nick}: THE CARD TOTAL IS THE HEADLINE ABOVE IT`,
      Math.abs(p.kpiTotals.savingHours - p.scorecardHours) < 1e-6,
      `${p.kpiTotals.savingHours.toFixed(2)} vs ${p.scorecardHours.toFixed(2)}`)
    check(`${p.nick}: and it is the sum of what is behind each line`,
      Math.abs(p.kpiLines.reduce((a, l) => a + (l.creditedHours ?? 0), 0) - p.kpiTotals.savingHours) < 1e-9)
  }

  // Adding only the hours-TYPED targets is the trap: objective 1 states baht
  // and objective 3 a date, so that sum is short of what the person carries.
  const james = plan.people.find((p) => p.id === 'james')
  check('the hours-typed targets alone are NOT the total',
    james.kpiTotals.hours < james.kpiTotals.savingHours,
    `${james.kpiTotals.hours} typed vs ${james.kpiTotals.savingHours.toFixed(1)} carried`)
  check('and the money-typed targets are reported separately',
    james.kpiTotals.money > 0, String(Math.round(james.kpiTotals.money)))

  // A hand-added line carries no hours of its own, so it cannot inflate it.
  const withCustom = computePlan({
    ...base,
    people: base.people.map((p) => (p.id === 'james'
      ? { ...p, customLines: [{ id: 'c1', label: 'x', objective: 'process_automation', targetKind: 'hours', target: 9999 }] }
      : p)),
  }).people.find((p) => p.id === 'james')
  check('A HAND-WRITTEN LINE DOES NOT INFLATE THE TOTAL',
    Math.abs(withCustom.kpiTotals.savingHours - james.kpiTotals.savingHours) < 1e-9,
    `${withCustom.kpiTotals.savingHours.toFixed(1)} vs ${james.kpiTotals.savingHours.toFixed(1)}`)

  // A typed TARGET is a target, not hours carried: the total stays the truth.
  const typed = computePlan({
    ...base,
    people: base.people.map((p) => (p.id === 'james'
      ? { ...p, kpi: { 'obj-efficiency': { target: 5000 } } } : p)),
  }).people.find((p) => p.id === 'james')
  check('typing a target over does not change what the card carries',
    Math.abs(typed.kpiTotals.savingHours - james.kpiTotals.savingHours) < 1e-9,
    `${typed.kpiTotals.savingHours.toFixed(1)} vs ${james.kpiTotals.savingHours.toFixed(1)}`)

  // An override does move it — that is the whole point of an override.
  const over = computePlan({
    ...base,
    people: base.people.map((p) => (p.id === 'james' ? { ...p, overrides: { hours: 200 } } : p)),
  })
  const overJames = over.people.find((p) => p.id === 'james')
  check('AN OVERRIDE MOVES IT, AND IT STILL EQUALS THE HEADLINE',
    Math.abs(overJames.kpiTotals.savingHours - 200) < 1e-6
    && Math.abs(overJames.kpiTotals.savingHours - overJames.scorecardHours) < 1e-6,
    `${overJames.kpiTotals.savingHours.toFixed(2)} vs ${overJames.scorecardHours}`)
  check('and the lead\'s card total follows it too',
    Math.abs(over.people.find((p) => p.id === 'gun').kpiTotals.savingHours
      - over.people.find((p) => p.id === 'gun').scorecardHours) < 1e-6)
}

/* ---------------- 9. and the workbook says the same ---------------- */
console.log('\n--- the workbook carries the same total ---')
{
  const plan = computePlan(base)
  const wb = await buildWorkbook(plan, base)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())

  for (const p of plan.people) {
    const ws = back.getWorksheet(`Obj-${p.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31))
    let total = null
    let lineSum = 0
    ws.eachRow((r) => {
      const isTotal = String(r.getCell(3).value || '') === 'TOTAL'
      const h = r.getCell(6).value
      if (isTotal && total == null) total = h
      else if (total == null && typeof h === 'number') lineSum += h
    })
    check(`${p.nick}: THE SHEET CARRIES THE CARD TOTAL`,
      typeof total === 'number' && Math.abs(total - p.kpiTotals.savingHours) < 0.06,
      `${total} vs ${p.kpiTotals.savingHours.toFixed(1)}`)
    check(`${p.nick}: and the lines on it add up to that total`,
      Math.abs(lineSum - total) < 0.06, `${lineSum.toFixed(1)} vs ${total}`)
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
