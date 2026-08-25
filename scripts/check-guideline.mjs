/**
 * Pins the management KPI guideline wording. The app is read alongside that
 * document, so any drift between the two invites an argument about which is
 * authoritative. If the guideline is reissued, update EXPECTED here on purpose.
 *
 * Run with: node scripts/check-guideline.mjs
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { OBJECTIVES } from '../src/lib/palette.js'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/*
 * Transcribed from KPI_Guideline_FA Tech_2026.xlsx, columns:
 *   Objective | Objective detail | F&A Tech
 *
 * Row 1 is NOT the original. Objective 1 was Financial — the average return on
 * whatever work the team was handed — and P'Puu replaced it with project
 * management: commit a delivery date and hold to it. The wording below is the
 * replacement as agreed, and the rest of the sheet is still the guideline
 * verbatim.
 */
const EXPECTED = [
  ['Project management',
    'Commit a timeline and deliver against it',
    'Commit timeline ของตนเอง: ปรับ timeline ได้ไม่เกิน 1 sprint และไม่เกินสัดส่วนที่ตกลงไว้ ของจำนวน report + project ที่ถืออยู่'],
  ['F&A process automation',
    'to transform all manual work to automation',
    '3,000 hrs.'],
  ['F&A Data warehouse*',
    'To create reporting for own division operation by link F&A datawarehouse (Acct data cube)',
    'by Nov 2026'],
  ['Efficiency and integration',
    'Developing reporting to enhance efficiency and productivity',
    'propose'],
  ['',
    'Automation E2E, AI development',
    'propose'],
]

console.log('--- wording matches the guideline verbatim ---')
check('all five objectives are present', OBJECTIVES.length === 5, String(OBJECTIVES.length))
EXPECTED.forEach(([name, detail, target], i) => {
  const o = OBJECTIVES[i]
  check(`row ${i + 1} objective name`, o.guidelineName === name, `"${o.guidelineName}"`)
  check(`row ${i + 1} objective detail`, o.guidelineDetail === detail, `"${o.guidelineDetail}"`)
  check(`row ${i + 1} F&A Tech target`, o.guidelineTarget === target, `"${o.guidelineTarget}"`)
})

console.log('\n--- structural details the source carries ---')
check('the asterisk on Data warehouse is kept',
  OBJECTIVES[2].guidelineName.endsWith('*'), OBJECTIVES[2].guidelineName)
check('objective 5 has no objective name of its own',
  OBJECTIVES[4].guidelineName === '')
check('the Thai text is intact, not transliterated',
  /[฀-๿]/.test(OBJECTIVES[0].guidelineTarget))
check('the 3,000 hr target is stated as in the document',
  OBJECTIVES[1].guidelineTarget === '3,000 hrs.')

console.log('\n--- the export reproduces it too ---')
{
  const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
  const state = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'guideline' }
  const file = 'guideline-selftest.xlsx'
  if (existsSync(file)) unlinkSync(file)
  const wb = await buildWorkbook(computePlan(state), state)
  await wb.xlsx.writeFile(file)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(file)
  const ws = back.getWorksheet('Summary')

  const rows = []
  ws.eachRow((row) => rows.push([1, 2, 3].map((c) => String(row.getCell(c).value ?? ''))))
  const flat = rows.map((r) => r.join('')).join('\n')

  check('the guideline section is present', flat.includes('MANAGEMENT KPI GUIDELINE'))
  EXPECTED.forEach(([, detail, target], i) => {
    check(`export row ${i + 1} detail`, rows.some((r) => r[1] === detail), detail.slice(0, 44))
    check(`export row ${i + 1} target`, rows.some((r) => r[2] === target), target.slice(0, 44))
  })
  unlinkSync(file)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
