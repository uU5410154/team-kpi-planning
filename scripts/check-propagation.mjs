/**
 * Reproduces the reported bug and guards against it returning:
 *   change a project's saving hours on the Projects tab -> the Scorecard tab
 *   and the Excel export must both show the new number.
 *
 * Run with: node scripts/check-propagation.mjs
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS, fmtTarget, weightsValid } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'propagation' }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` โ€” ${detail}` : ''}`)
}

/** Mirrors App.updatePersonKpi, including the discard-if-equal-to-live rule. */
const applyKpiEdit = (state, plan, personId, lineId, patch) => {
  const line = plan.people.find((x) => x.id === personId)?.kpiLines.find((l) => l.id === lineId)
  return {
    ...state,
    people: state.people.map((p) => {
      if (p.id !== personId) return p
      const kpi = { ...(p.kpi || {}) }
      const entry = { ...(kpi[lineId] || {}), ...patch }
      if ('target' in patch) {
        const cleared = patch.target == null || patch.target === ''
        if (cleared || (line && patch.target === line.defaultTarget)) delete entry.target
      }
      if ('weight' in patch && line && Math.abs(patch.weight - line.defaultWeight) < 1e-9) delete entry.weight
      if (Object.keys(entry).length) kpi[lineId] = entry
      else delete kpi[lineId]
      return { ...p, kpi }
    }),
  }
}

const setSaving = (state, key, hours) => ({
  ...state,
  projects: state.projects.map((p) => (p.key === key ? { ...p, savingHours: hours, savingEstimated: false } : p)),
})

const lineFor = (plan, personId, objective) =>
  plan.people.find((p) => p.id === personId)?.kpiLines.find((l) => l.objective === objective)

const OBJ_LABEL = {
  financial: 'Financial',
  process_automation: 'F&A process automation',
  datawarehouse: 'F&A Data warehouse',
  efficiency: 'Efficiency and integration',
  ai_automation: 'Automation E2E, AI development',
}

/**
 * Reads a target back out of the workbook, from BOTH places it is printed:
 * the per-person sheet (col 2 = "Obj N โ€” Name", col 3 = target) and the
 * Overall_Objectives grid (that person's block). They must agree.
 */
const exportedTarget = async (plan, state, personId, objective) => {
  const file = `prop-${personId}-${objective}.xlsx`
  if (existsSync(file)) unlinkSync(file)
  const wb = await buildWorkbook(plan, state)
  await wb.xlsx.writeFile(file)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(file)

  const person = plan.people.find((p) => p.id === personId)
  const label = OBJ_LABEL[objective]

  // per-person sheet
  const sheetName = `Obj-${person.nick}`.replace(/[:\\/?*[\]]/g, '').slice(0, 31)
  const ws = back.getWorksheet(sheetName)
  let perPerson = null
  ws.eachRow((row) => {
    if (String(row.getCell(2).value || '').includes(label)) perPerson = String(row.getCell(3).value)
  })

  // Overall_Objectives grid โ€” 3 columns per person starting at col 4
  const ov = back.getWorksheet('Overall_Objectives')
  const ix = plan.people.findIndex((p) => p.id === personId)
  let overall = null
  ov.eachRow((row) => {
    if (String(row.getCell(3).value || '').includes(label)) overall = String(row.getCell(4 + ix * 3).value)
  })

  unlinkSync(file)
  return { perPerson, overall, agree: perPerson === overall }
}

/* ------------------------------------------------------------------ */
/* 1. the exact reported scenario                                      */
/* ------------------------------------------------------------------ */
console.log('--- FNP-1431 Sales Forecast: 32 -> 33 (the reported bug) ---')
const KEY = 'FNP-1431'
const proj0 = base.projects.find((p) => p.key === KEY)
check('the project exists and is Gun\'s objective 1', !!proj0 && proj0.pic === 'gun' && proj0.objective === 'financial',
  `${proj0?.pic} / ${proj0?.objective} / ${proj0?.savingHours}h`)

let state = base
let plan = computePlan(state)
const before = lineFor(plan, 'gun', 'financial')
// Gun is the team lead, so his objective-1 line carries the TEAM's objective-1
// total, not just his own project. Assert the delta, not a hardcoded constant.
const start = before.target
check('scorecard starts at a live figure', typeof start === 'number' && start >= 32, String(start))

// user edits the project on the Projects tab
state = setSaving(state, KEY, 33)
plan = computePlan(state)
const after = lineFor(plan, 'gun', 'financial')
check('scorecard target follows the edit', after.target === start + 1, `${start} -> ${after.target}`)
check('it is not flagged as drifted', after.drifted === false)
check('credited hours follow too', after.creditedHours === start + 1, String(after.creditedHours))
check('rendered with the fixed unit', fmtTarget(after) === `${start + 1} hrs/month`, fmtTarget(after))

let xl = await exportedTarget(plan, state, 'gun', 'financial')
check('Excel per-person sheet follows', xl.perPerson === `${start + 1} hrs/month`, String(xl.perPerson))
check('Excel Overall_Objectives follows', xl.overall === `${start + 1} hrs/month`, String(xl.overall))
check('both Excel sheets agree', xl.agree)

/* ------------------------------------------------------------------ */
/* 2. the mechanism that caused it: a no-op blur must not pin          */
/* ------------------------------------------------------------------ */
console.log('\n--- focusing a target and leaving it unchanged must not pin it ---')
let s2 = setSaving(base, KEY, 32)
let p2 = computePlan(s2)
// simulate blurring the field with the value it already displayed
const shown = lineFor(p2, 'gun', 'financial').target
s2 = applyKpiEdit(s2, p2, 'gun', 'obj-financial', { target: shown })
p2 = computePlan(s2)
check('no override was stored', !(s2.people.find((p) => p.id === 'gun').kpi || {})['obj-financial'],
  JSON.stringify((s2.people.find((p) => p.id === 'gun').kpi || {})['obj-financial']))
s2 = setSaving(s2, KEY, 33)
p2 = computePlan(s2)
check('the later project edit still reaches the scorecard',
  lineFor(p2, 'gun', 'financial').target === shown + 1,
  `${shown} -> ${lineFor(p2, 'gun', 'financial').target}`)

/* ------------------------------------------------------------------ */
/* 3. a deliberate override still pins, and can be released           */
/* ------------------------------------------------------------------ */
console.log('\n--- a deliberate override pins, and syncing releases it ---')
let s3 = computePlan(base) && base
let p3 = computePlan(s3)
s3 = applyKpiEdit(s3, p3, 'gun', 'obj-financial', { target: 500 })
p3 = computePlan(s3)
check('deliberate override applies', lineFor(p3, 'gun', 'financial').target === 500)
s3 = setSaving(s3, KEY, 33)
p3 = computePlan(s3)
const pinned = lineFor(p3, 'gun', 'financial')
check('pinned target holds against a project edit', pinned.target === 500, String(pinned.target))
check('and is flagged as drifted', pinned.drifted === true)
check('while exposing the live figure', pinned.defaultTarget === start + 1, String(pinned.defaultTarget))
xl = await exportedTarget(p3, s3, 'gun', 'financial')
check('Excel exports the pinned value in both sheets', xl.perPerson === '500 hrs/month' && xl.agree, JSON.stringify(xl))

// clearing it returns to live
s3 = applyKpiEdit(s3, p3, 'gun', 'obj-financial', { target: null })
p3 = computePlan(s3)
check('clearing the override returns to live', lineFor(p3, 'gun', 'financial').target === start + 1)
xl = await exportedTarget(p3, s3, 'gun', 'financial')
check('Excel follows back to live in both sheets', xl.perPerson === `${start + 1} hrs/month` && xl.agree, JSON.stringify(xl))

/* ------------------------------------------------------------------ */
/* 4. propagation across every person, objective and edit             */
/* ------------------------------------------------------------------ */
console.log('\n--- exhaustive: every hour-based line tracks its projects ---')
const basePlan = computePlan(base)
let mismatches = 0
let checked = 0
for (const person of basePlan.people) {
  for (const line of person.kpiLines.filter((l) => l.targetKind === 'hours')) {
    // bump every one of this person's projects on that objective by +7
    const affected = base.projects.filter(
      (pr) => pr.objective === line.objective && (pr.pic === person.id || (pr.contributors || []).some((c) => c.person === person.id)),
    )
    if (!affected.length) continue
    const bumped = {
      ...base,
      projects: base.projects.map((pr) =>
        affected.some((a) => a.key === pr.key) && pr.savingHours != null
          ? { ...pr, savingHours: pr.savingHours + 7 }
          : pr),
    }
    const bp = computePlan(bumped)
    const nl = bp.people.find((x) => x.id === person.id).kpiLines.find((l) => l.objective === line.objective)
    checked++
    if (!nl || nl.target <= line.target) {
      // only a problem when at least one affected project actually had hours
      const movable = affected.some((a) => a.savingHours != null && a.savingHours > 0)
      if (movable) { mismatches++; console.log(`     ${person.nick}/${line.objective}: ${line.target} -> ${nl?.target}`) }
    }
  }
}
check('every hour line moved when its projects moved', mismatches === 0, `${checked} lines exercised`)

/* ------------------------------------------------------------------ */
/* 5. reassignment, deletion and addition all propagate               */
/* ------------------------------------------------------------------ */
console.log('\n--- structural edits propagate ---')
// Gun aggregates the team, so a transfer between members leaves HIS figure
// unchanged — it is the receiving member's card that has to move.
const reassigned = { ...base, projects: base.projects.map((p) => (p.key === KEY ? { ...p, pic: 'james', contributors: [{ person: 'james', roles: ['dev'] }] } : p)) }
const rp = computePlan(reassigned)
const jamesBefore = lineFor(computePlan(base), 'james', 'financial')?.target ?? 0
check('the team figure is unchanged by an internal transfer',
  (lineFor(rp, 'gun', 'financial')?.target ?? 0) === start, String(lineFor(rp, 'gun', 'financial')?.target))
check('the receiving member gains the hours',
  (lineFor(rp, 'james', 'financial')?.target ?? 0) === jamesBefore + 32,
  `${jamesBefore} -> ${lineFor(rp, 'james', 'financial')?.target}`)

const removed = { ...base, projects: base.projects.filter((p) => p.key !== KEY) }
check('deleting a project removes its hours',
  (lineFor(computePlan(removed), 'gun', 'financial')?.target ?? 0) === start - 32,
  String(lineFor(computePlan(removed), 'gun', 'financial')?.target))

const added = {
  ...base,
  projects: [{ ...proj0, key: 'NEW-TEST', jiraKey: null, savingHours: 100 }, ...base.projects],
}
check('adding a project adds its hours',
  lineFor(computePlan(added), 'gun', 'financial').target === start + 100,
  String(lineFor(computePlan(added), 'gun', 'financial').target))

/* ------------------------------------------------------------------ */
/* 6. team totals and scorecards stay reconciled                       */
/* ------------------------------------------------------------------ */
console.log('\n--- totals stay reconciled after the edit ---')
const edited = computePlan(setSaving(base, KEY, 33))
check('team total rises by exactly 1', Math.abs(edited.totals.totalHours - basePlan.totals.totalHours - 1) < 1e-9,
  `${basePlan.totals.totalHours} -> ${edited.totals.totalHours}`)
check('all scorecards still total 100%', edited.people.every((p) => weightsValid(p.kpiLines)))
check('no scorecard is invalid', edited.invalid.length === 0)

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)

