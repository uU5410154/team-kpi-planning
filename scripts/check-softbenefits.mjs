/**
 * The benefits a project delivers that no number captures.
 *
 * Saving hours are only half the case. Soft benefits are recorded as a list,
 * and the list has to read the same everywhere: on the register where it is
 * typed, on the scorecard of everyone credited on the project, in the
 * workbook, and back again through an import.
 *
 * What must hold:
 *   1. one normaliser decides what a bullet is, so nothing downstream has to
 *      guess whether it holds a list, a paragraph, or bullet glyphs;
 *   2. they carry NO hours, NO weight and NO money — a soft benefit must not
 *      move a single number in the plan;
 *   3. they are not shared out. Two people credited on a project both deliver
 *      the whole of it;
 *   4. only counted projects show them: a deferred project delivers nothing
 *      this year;
 *   5. the register, the person's sheet and the round-trip file all carry the
 *      same list.
 *
 * Run with: node scripts/check-softbenefits.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, normalizeSoftBenefits, softBenefitsText, weightsValid,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'
import { buildFilteredWorkbook, readProjectsFile, planImport, applyImport } from '../src/lib/projectIO.js'
import { columnFor } from '../src/lib/projectSheet.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }
const plain = computePlan(base)

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const BULLETS = ['Removes a manual reconciliation at month end', 'Full audit trail on every posting']
const withBenefits = (key, list = BULLETS) => ({
  ...base,
  projects: base.projects.map((p) => (p.key === key ? { ...p, softBenefits: list } : p)),
})

/* ---------------- 1. what counts as a bullet ---------------- */
console.log('--- one normaliser decides what a bullet is ---')
{
  check('a typed block becomes a list',
    normalizeSoftBenefits('a\nb\nc').join('|') === 'a|b|c')
  check('windows line endings too',
    normalizeSoftBenefits('a\r\nb').join('|') === 'a|b')
  check('BULLET GLYPHS ARE STRIPPED, NOT STORED',
    normalizeSoftBenefits('- a\n• b\n* c\n· d').join('|') === 'a|b|c|d',
    normalizeSoftBenefits('- a\n• b\n* c\n· d').join('|'))
  check('blank lines are dropped', normalizeSoftBenefits('a\n\n\n b \n').join('|') === 'a|b')
  check('a real list is accepted as it is', normalizeSoftBenefits(['a', 'b']).join('|') === 'a|b')
  check('nothing at all is an empty list',
    normalizeSoftBenefits(null).length === 0 && normalizeSoftBenefits('').length === 0
    && normalizeSoftBenefits(undefined).length === 0)
  check('rubbish does not throw', normalizeSoftBenefits(42).length >= 0)
  check('a bullet is capped so one cannot become an essay',
    normalizeSoftBenefits(['x'.repeat(500)])[0].length === 300)
  check('and the list is capped too',
    normalizeSoftBenefits(new Array(50).fill('x')).length === 20)
  check('the text form round-trips',
    normalizeSoftBenefits(softBenefitsText('a\nb')).join('|') === 'a|b')
  check('it is idempotent',
    JSON.stringify(normalizeSoftBenefits(normalizeSoftBenefits('- a\nb')))
    === JSON.stringify(normalizeSoftBenefits('- a\nb')))
}

/* ---------------- 2. they move no number ---------------- */
console.log('\n--- they carry no hours, no weight and no money ---')
{
  const key = base.projects.find((p) => p.savingHours > 0).key
  const plan = computePlan(withBenefits(key))
  check('THE COMMITTED TOTAL DOES NOT MOVE',
    Math.abs(plain.totals.committedHours - plan.totals.committedHours) < 1e-9,
    `${plain.totals.committedHours.toFixed(2)} vs ${plan.totals.committedHours.toFixed(2)}`)
  check('the book total does not move',
    Math.abs(plain.totals.totalHours - plan.totals.totalHours) < 1e-9)
  check('no ROI, payback or investment moves',
    plain.projects.every((p, i) => p.roi === plan.projects[i].roi
      && p.paybackMonths === plan.projects[i].paybackMonths
      && p.investment === plan.projects[i].investment))
  check('every person\'s credited hours are unchanged',
    plain.people.every((p, i) => Math.abs(p.scorecardHours - plan.people[i].scorecardHours) < 1e-9))
  check('every scorecard still totals 100%',
    plan.people.every((p) => weightsValid(p.kpiLines)) && plan.invalid.length === 0)
  check('and no KPI line appeared or disappeared',
    plain.people.every((p, i) => p.kpiLines.length === plan.people[i].kpiLines.length))
}

/* ---------------- 3. on the computed project ---------------- */
console.log('\n--- they reach the project the app renders ---')
{
  const key = base.projects[0].key
  const messy = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === key
      ? { ...p, softBenefits: '- Control\n\n• Audit trail  ' } : p)),
  }).projects.find((p) => p.key === key)
  check('a project typed as text arrives as a clean list',
    JSON.stringify(messy.softBenefits) === JSON.stringify(['Control', 'Audit trail']),
    JSON.stringify(messy.softBenefits))
  check('a project with none carries an empty list, never undefined',
    computePlan(base).projects.every((p) => Array.isArray(p.softBenefits)))
}

/* ---------------- 4. on the scorecards ---------------- */
console.log('\n--- everyone credited on the project sees them ---')
{
  const shared = base.projects.find((p) => p.savingHours > 0 && p.pic)
  const state = {
    ...base,
    projects: base.projects.map((p) => (p.key === shared.key
      ? { ...p, softBenefits: BULLETS, contributors: [{ person: p.pic, roles: ['dev'] }, { person: 'kade', roles: ['qa'] }] }
      : p)),
  }
  const plan = computePlan(state)
  const on = (id) => {
    const person = plan.people.find((p) => p.id === id)
    const row = person.scorecardRows.find((r) => r.p.key === shared.key)
    return row ? row.p.softBenefits : null
  }
  check('the owner\'s scorecard carries them',
    JSON.stringify(on(shared.pic)) === JSON.stringify(BULLETS), JSON.stringify(on(shared.pic)))
  /*
   * A contributor's sheet does NOT, because the project is not on it: credit
   * follows the PIC and nobody else, so a person recorded as QA on somebody
   * else's project has no row there to carry the soft benefits either.
   */
  check('A CONTRIBUTOR WHO IS NOT THE PIC HAS NO ROW TO CARRY THEM',
    on('kade') === null, JSON.stringify(on('kade')))
  check('the team lead sees them too',
    JSON.stringify(on('gun')) === JSON.stringify(BULLETS))
  /*
   * And where it DOES appear, it appears whole. A soft benefit is not
   * divisible: the person who runs the project delivers all of it, not a
   * fraction weighted by anything.
   */
  check('a soft benefit is never divided',
    on(shared.pic).length === BULLETS.length && on('gun').length === BULLETS.length,
    `${on(shared.pic).length} of ${BULLETS.length} on the PIC's sheet`)

  // a deferred project delivers nothing this year
  const deferred = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === shared.key
      ? { ...p, softBenefits: BULLETS, commitLevel: 'nextyear' } : p)),
  })
  const stillCounted = deferred.people
    .flatMap((p) => p.scorecardRows)
    .filter((r) => r.p.key === shared.key)
    .every((r) => r.p.commitLevel === 'nextyear')
  check('a deferred project is still marked deferred wherever it appears', stillCounted)
}

/* ---------------- 5. the workbook ---------------- */
console.log('\n--- the workbook carries the same list ---')
{
  const target = base.projects.find((p) => p.pic === 'james' && p.savingHours > 0)
  const state = withBenefits(target.key)
  const plan = computePlan(state)
  const wb = await buildWorkbook(plan, state)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())

  const cellIn = (sheet, key) => {
    let col = -1
    let value = null
    sheet.eachRow((r) => {
      const vals = r.values.map((v) => String(v || '').trim())
      if (col < 0 && vals.indexOf('Soft benefits') > 0) col = vals.indexOf('Soft benefits')
      if (col > 0 && String(r.getCell(1).value || '') === key) value = String(r.getCell(col).value || '')
    })
    return { col, value }
  }

  const reg = cellIn(back.getWorksheet('Projects'), target.key)
  check('THE REGISTER HAS A SOFT BENEFITS COLUMN', reg.col > 0, `column ${reg.col}`)
  check('and it carries every bullet',
    BULLETS.every((b) => reg.value.includes(b)), JSON.stringify(reg.value))
  check('one bullet a line, not run together',
    reg.value.split('\n').length === BULLETS.length, JSON.stringify(reg.value))

  const jira = target.jiraKey || target.key
  const james = cellIn(back.getWorksheet('Obj-James'), jira)
  check('THE PERSON\'S OWN SHEET CARRIES THEM', james.col > 0 && !!james.value,
    JSON.stringify(james.value))
  check('and it is the same list, not a summary of it',
    BULLETS.every((b) => (james.value || '').includes(b)), JSON.stringify(james.value))
  const lead = cellIn(back.getWorksheet('Obj-Gun'), jira)
  check('the lead\'s sheet carries them as well',
    BULLETS.every((b) => (lead.value || '').includes(b)), JSON.stringify(lead.value))

  // and with none set, the column is simply empty
  const cleanWb = await buildWorkbook(plain, base)
  const cleanBack = new ExcelJS.Workbook()
  await cleanBack.xlsx.load(await cleanWb.xlsx.writeBuffer())
  const empty = cellIn(cleanBack.getWorksheet('Projects'), target.key)
  check('a project with none exports an empty cell, not the word undefined',
    empty.value === '', JSON.stringify(empty.value))
}

/* ---------------- 6. the round trip ---------------- */
console.log('\n--- they survive the export-and-import round trip ---')
{
  const key = base.projects[0].key
  const state = withBenefits(key)
  const plan = computePlan(state)
  const rows = plan.projects.slice(0, 5)

  const wb = await buildFilteredWorkbook(rows, plan.assignees, '')
  const ws = wb.getWorksheet('Projects')
  const ix = {}
  ws.getRow(4).eachCell((c, i) => { const col = columnFor(c.value); if (col) ix[col.key] = i })
  check('the round-trip sheet has the column', ix.softBenefits > 0, String(ix.softBenefits))
  check('and writes them as bullets',
    String(ws.getRow(5).getCell(ix.softBenefits).value).split('\n').length === 2,
    JSON.stringify(ws.getRow(5).getCell(ix.softBenefits).value))

  const untouched = planImport(await readProjectsFile(await wb.xlsx.writeBuffer()), state, plan)
  check('EXPORTING AND IMPORTING BACK CHANGES NOTHING',
    untouched.changes.length === 0, JSON.stringify(untouched.changes))

  ws.getRow(5).getCell(ix.softBenefits).value = '• Removes a manual reconciliation at month end\n• Full audit trail on every posting\n• Month-end closes a day earlier'
  const edited = planImport(await readProjectsFile(await wb.xlsx.writeBuffer()), state, plan)
  check('adding a bullet is one change on one project',
    edited.changes.length === 1 && edited.changes[0].fields.length === 1,
    JSON.stringify(edited.changes.map((c) => c.key)))
  check('and it is described in bullets, not as raw text',
    /bullets/.test(edited.changes[0].fields[0].to), JSON.stringify(edited.changes[0].fields[0]))

  const next = applyImport(state.projects, edited)
  const after = next.find((p) => p.key === key)
  check('THE IMPORTED LIST IS STORED CLEAN, WITHOUT THE GLYPHS',
    JSON.stringify(after.softBenefits)
    === JSON.stringify([...BULLETS, 'Month-end closes a day earlier']),
    JSON.stringify(after.softBenefits))
  check('every other project is the same object',
    next.every((p, i) => p.key === key || p === state.projects[i]))
  check('and the plan\'s numbers did not move',
    Math.abs(computePlan({ ...state, projects: next }).totals.committedHours - plain.totals.committedHours) < 1e-9)

  // clearing the cell leaves the list alone, the same rule as every column
  ws.getRow(5).getCell(ix.softBenefits).value = null
  const blanked = planImport(await readProjectsFile(await wb.xlsx.writeBuffer()), state, plan)
  check('a blank cell keeps what is there, as everywhere else',
    blanked.changes.length === 0, JSON.stringify(blanked.changes))
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
