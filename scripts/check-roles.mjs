/**
 * Roles are set by hand, and every number in the app follows them.
 *
 * A project's saving hours are split by role weight, so this is the one dial
 * that decides how a shared project lands on two scorecards. What must hold:
 * the split always sums to 1, a person counts at their strongest role and not
 * the sum of them, the team total never moves when a split changes, and the
 * workbook says exactly what the app says.
 *
 * Run with: node scripts/check-roles.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, DEFAULT_ROLE_WEIGHTS, ROLE_ORDER, ROLE_LABEL,
  setRolesPatch, creditRows, creditSummary, projectShares, weightsValid,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const apply = (state, key, patch) => ({
  ...state,
  projects: state.projects.map((p) => (p.key === key ? { ...p, ...patch } : p)),
})

/* ---------------- 1. the patch itself ---------------- */
console.log('--- setting a role by hand ---')
{
  const p = { key: 'X', pic: 'gun', contributors: [{ person: 'gun', roles: ['dev'] }, { person: 'kade', roles: ['qa'] }] }

  check('a typed role is stored', setRolesPatch(p, 'kade', ['lead']).contributors
    .find((c) => c.person === 'kade').roles.join('/') === 'lead')
  check('roles come back in a fixed order, whatever order they were picked in',
    setRolesPatch(p, 'kade', ['qa', 'pm', 'dev']).contributors.find((c) => c.person === 'kade').roles.join('/') === 'pm/dev/qa')
  check('duplicates collapse',
    setRolesPatch(p, 'kade', ['dev', 'dev']).contributors.find((c) => c.person === 'kade').roles.join('/') === 'dev')
  check('an unknown role name is dropped, not stored',
    setRolesPatch(p, 'kade', ['dev', 'wizard']).contributors.find((c) => c.person === 'kade').roles.join('/') === 'dev')
  check('clearing every role removes the person',
    !setRolesPatch(p, 'kade', []).contributors.some((c) => c.person === 'kade'))
  check('editing a role does not move the row',
    setRolesPatch(p, 'gun', ['lead']).contributors.map((c) => c.person).join(',') === 'gun,kade')
  check('a new person is appended',
    setRolesPatch(p, 'pol', ['qa']).contributors.map((c) => c.person).join(',') === 'gun,kade,pol')
  check('the original project is not mutated',
    p.contributors.find((c) => c.person === 'kade').roles.join('/') === 'qa')
  check('every role in ROLE_ORDER can actually be set',
    ROLE_ORDER.every((r) => setRolesPatch(p, 'pol', [r]).contributors.find((c) => c.person === 'pol').roles[0] === r))
  check('every role has a label to show', ROLE_ORDER.every((r) => !!ROLE_LABEL[r]),
    ROLE_ORDER.filter((r) => !ROLE_LABEL[r]).join(','))
}

/* ---------------- 2. the split the roles produce ---------------- */
console.log('\n--- the split those roles produce ---')
{
  const two = (a, b) => ({ key: 'X', pic: 'gun', contributors: [{ person: 'gun', roles: a }, { person: 'kade', roles: b }] })

  const devQa = projectShares(two(['dev'], ['qa'])).shares
  check('dev 1.0 against qa 0.2 splits 83/17',
    Math.abs(devQa.gun - 1 / 1.2) < 1e-9 && Math.abs(devQa.kade - 0.2 / 1.2) < 1e-9,
    JSON.stringify(devQa))
  const devDev = projectShares(two(['dev'], ['dev'])).shares
  check('two devs split it evenly', Math.abs(devDev.gun - 0.5) < 1e-9 && Math.abs(devDev.kade - 0.5) < 1e-9,
    JSON.stringify(devDev))
  const both = projectShares(two(['pm', 'dev'], ['dev'])).shares
  check('HOLDING TWO ROLES COUNTS THE STRONGEST, NOT THE SUM',
    Math.abs(both.gun - 0.5) < 1e-9, JSON.stringify(both))

  // every pair of roles, on every ordering: the split is always a whole 1.
  let worst = 0
  let combos = 0
  for (const a of ROLE_ORDER) {
    for (const b of ROLE_ORDER) {
      const { shares } = projectShares(two([a], [b]))
      const sum = Object.values(shares).reduce((x, y) => x + y, 0)
      worst = Math.max(worst, Math.abs(sum - 1))
      combos++
      const ra = DEFAULT_ROLE_WEIGHTS[a]
      const rb = DEFAULT_ROLE_WEIGHTS[b]
      if (Math.abs(shares.gun - ra / (ra + rb)) > 1e-9) worst = 1
    }
  }
  check('every pair of roles splits to exactly 100% at the right ratio',
    worst < 1e-9, `${combos} combinations, worst error ${worst.toExponential(1)}`)

  const orphan = projectShares({ key: 'X', pic: 'james', contributors: [] })
  check('a PIC with no role typed still owns the whole project',
    Math.abs(orphan.shares.james - 1) < 1e-9, JSON.stringify(orphan.shares))
  const stripped = projectShares({ key: 'X', pic: 'gun', contributors: [{ person: 'kade', roles: ['dev'] }] })
  check('the PIC counts as a bare assignee against a listed dev',
    Math.abs(stripped.shares.gun - 0.3 / 1.3) < 1e-9, JSON.stringify(stripped.shares))
}

/* ---------------- 3. what the panel shows ---------------- */
console.log('\n--- what the panel shows matches the split ---')
{
  const p = { key: 'X', pic: 'gun', contributors: [{ person: 'gun', roles: ['dev'] }, { person: 'kade', roles: ['qa'] }] }
  const { shares } = projectShares(p)
  const rows = creditRows(p, shares)
  check('one row per credited person', rows.length === 2, String(rows.length))
  check('the rows are ordered by share, biggest first', rows[0].person === 'gun')
  check('the shares on the rows are the model\'s own',
    rows.every((r) => r.share === shares[r.person]))
  check('the rows add to exactly 100%',
    Math.abs(rows.reduce((a, r) => a + r.share, 0) - 1) < 1e-9)

  const implied = creditRows({ key: 'X', pic: 'james', contributors: [] }, projectShares({ key: 'X', pic: 'james', contributors: [] }).shares)
  check('an unlabelled PIC is shown as the assignee they are worth',
    implied[0].implied === true && implied[0].roles.join('') === 'assignee' && implied[0].share === 1,
    JSON.stringify(implied))
  check('the summary line reads as the split does',
    creditSummary(p, shares) === 'gun dev 83% · kade qa 17%', creditSummary(p, shares))
}

/* ---------------- 4. the whole app follows ---------------- */
console.log('\n--- the numbers across the app follow the roles ---')
{
  const KEY = 'FNP-379'
  const before = computePlan(base)
  const proj = base.projects.find((p) => p.key === KEY)
  const hrs = proj.savingHours
  const jB = before.people.find((p) => p.id === 'james')
  const kB = before.people.find((p) => p.id === 'kade')

  // Give Kade a QA role alongside James's dev: 83/17.
  const shared = computePlan(apply(base, KEY, setRolesPatch(proj, 'kade', ['qa'])))
  const pr = shared.projects.find((p) => p.key === KEY)
  const jA = shared.people.find((p) => p.id === 'james')
  const kA = shared.people.find((p) => p.id === 'kade')

  check('the project now splits 83/17',
    Math.abs(pr.shares.james - 1 / 1.2) < 1e-9 && Math.abs(pr.shares.kade - 0.2 / 1.2) < 1e-9,
    JSON.stringify(pr.shares))
  check('THE OLD OWNER LOSES EXACTLY THE QA SHARE',
    Math.abs((jB.hours - jA.hours) - hrs * (0.2 / 1.2)) < 1e-6,
    `${jB.hours.toFixed(2)} -> ${jA.hours.toFixed(2)} of ${hrs}h`)
  check('and the new contributor gains exactly it',
    Math.abs((kA.hours - kB.hours) - hrs * (0.2 / 1.2)) < 1e-6,
    `${kB.hours.toFixed(2)} -> ${kA.hours.toFixed(2)}`)
  check('the team total does not move',
    Math.abs(before.totals.totalHours - shared.totals.totalHours) < 1e-9,
    `${before.totals.totalHours.toFixed(2)} vs ${shared.totals.totalHours.toFixed(2)}`)
  check('the committed total does not move either',
    Math.abs(before.totals.committedHours - shared.totals.committedHours) < 1e-9)
  check('every scorecard still totals 100%',
    shared.people.every((p) => weightsValid(p.kpiLines)) && shared.invalid.length === 0)
  check('the project appears on the new contributor\'s portfolio',
    kA.rows.some((r) => r.p.key === KEY))

  // Promote Kade to dev: an even split, and the hours move again.
  const even = computePlan(apply(base, KEY, setRolesPatch(proj, 'kade', ['dev'])))
  const evenPr = even.projects.find((p) => p.key === KEY)
  check('promoting QA to dev makes it an even split',
    Math.abs(evenPr.shares.james - 0.5) < 1e-9 && Math.abs(evenPr.shares.kade - 0.5) < 1e-9,
    JSON.stringify(evenPr.shares))
  check('and the hours follow the promotion',
    Math.abs(even.people.find((p) => p.id === 'kade').hours - kB.hours - hrs * 0.5) < 1e-6)
  check('the team total STILL does not move',
    Math.abs(before.totals.totalHours - even.totals.totalHours) < 1e-9)

  // Dropping everyone leaves the PIC holding it alone.
  const dropped = computePlan(apply(base, KEY, setRolesPatch(proj, 'james', [])))
  const dpr = dropped.projects.find((p) => p.key === KEY)
  check('clearing the only contributor leaves the PIC owning it whole',
    Math.abs(dpr.shares.james - 1) < 1e-9, JSON.stringify(dpr.shares))
  check('so the totals are untouched by that too',
    Math.abs(before.totals.totalHours - dropped.totals.totalHours) < 1e-9)
}

/* ---------------- 5. every project, every role ---------------- */
console.log('\n--- every project, every role, nothing leaks ---')
{
  const before = computePlan(base)
  const owners = before.people.map((p) => p.id)
  let broke = 0
  let notWhole = 0
  let leaked = 0
  let tried = 0
  for (const proj of base.projects.filter((p) => p.savingHours > 0)) {
    for (const role of ROLE_ORDER) {
      const who = owners.find((id) => id !== proj.pic)
      const plan = computePlan(apply(base, proj.key, setRolesPatch(proj, who, [role])))
      const pr = plan.projects.find((p) => p.key === proj.key)
      const sum = Object.values(pr.shares).reduce((a, b) => a + b, 0) + (pr.partnerShare || 0)
      tried++
      if (Math.abs(sum - 1) > 1e-9) notWhole++
      if (plan.invalid.length) broke++
      if (Math.abs(plan.totals.totalHours - before.totals.totalHours) > 1e-6) leaked++
    }
  }
  check('every split is a whole 100%', notWhole === 0, `${tried} edits, ${notWhole} off`)
  check('no role edit anywhere blocks saving', broke === 0, `${broke} blocked`)
  check('NO ROLE EDIT ANYWHERE CHANGES THE TEAM TOTAL', leaked === 0, `${leaked} leaked`)
}

/* ---------------- 6. the workbook says the same ---------------- */
console.log('\n--- the workbook says the same thing ---')
{
  const KEY = 'FNP-379'
  const proj = base.projects.find((p) => p.key === KEY)
  const state = apply(base, KEY, setRolesPatch(proj, 'kade', ['qa']))
  const plan = computePlan(state)
  const wb = await buildWorkbook(plan, state)
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(await wb.xlsx.writeBuffer())

  const ws = back.getWorksheet('Projects')
  let teamCol = -1
  let cell = null
  ws.eachRow((r) => {
    const vals = r.values.map((v) => String(v || '').trim())
    if (teamCol < 0 && vals.indexOf('Team (roles, share)') > 0) teamCol = vals.indexOf('Team (roles, share)')
    if (teamCol > 0 && String(r.getCell(1).value || '') === KEY) cell = String(r.getCell(teamCol).value || '')
  })
  const pr = plan.projects.find((p) => p.key === KEY)
  const expected = creditSummary(pr, pr.shares, (id) => plan.people.find((x) => x.id === id)?.nick || id)
  check('the register carries the credit split', teamCol > 0, `column ${teamCol}`)
  check('AND IT IS THE SAME STRING THE APP SHOWS', cell === expected, `${cell} vs ${expected}`)
  check('it names both people and their roles',
    /James dev 83%/.test(cell) && /Kade qa 17%/.test(cell), cell)

  // The per-person sheets must carry the hours that split implies.
  const sheetOf = (nick) => back.getWorksheet(`Obj-${nick}`)
  const creditedOn = (nick) => {
    const sh = sheetOf(nick)
    let col = -1
    let v = null
    sh.eachRow((r) => {
      const vals = r.values.map((x) => String(x || '').trim())
      if (col < 0 && vals.indexOf('Credited') > 0) col = vals.indexOf('Credited')
      if (col > 0 && String(r.getCell(1).value || '') === KEY) v = r.getCell(col).value
    })
    return v
  }
  const jamesCredited = creditedOn('James')
  const kadeCredited = creditedOn('Kade')
  check('the old owner\'s sheet shows the reduced hours',
    Math.abs(jamesCredited - proj.savingHours * (1 / 1.2)) < 0.51,
    `${jamesCredited} vs ${(proj.savingHours * (1 / 1.2)).toFixed(1)}`)
  check('the QA\'s sheet shows the rest',
    Math.abs(kadeCredited - proj.savingHours * (0.2 / 1.2)) < 0.51,
    `${kadeCredited} vs ${(proj.savingHours * (0.2 / 1.2)).toFixed(1)}`)
  check('AND THE TWO ADD BACK UP TO THE PROJECT',
    Math.abs(jamesCredited + kadeCredited - proj.savingHours) < 1.01,
    `${jamesCredited} + ${kadeCredited} vs ${proj.savingHours}`)

  // Nothing on the team-wide sheets moved.
  const summary = back.getWorksheet('Summary')
  let committed = null
  summary.eachRow((r) => {
    if (/^Committed . bankable/i.test(String(r.getCell(1).value || ''))) committed = r.getCell(2).value
  })
  check('the committed headline is unchanged by the split',
    Math.abs(committed - computePlan(base).totals.committedHours) < 0.51,
    `${committed} vs ${computePlan(base).totals.committedHours.toFixed(1)}`)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
