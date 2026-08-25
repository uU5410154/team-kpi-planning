/**
 * Roles say who worked on a project. They do NOT decide whose hours it is.
 *
 * This file used to assert the opposite, and that was the defect: a project's
 * saving hours were split across the contributor record by role weight, so a
 * developer recorded on somebody else's project carried a share of its hours
 * and appeared on their scorecard — "AP Trade Invoice Matching has TBC on the
 * webapp, why is it under P'Phen in Excel?". A KPI that credits work to
 * somebody who does not own it is one nobody can defend in a review.
 *
 * The rule now is one line: THE PIC TAKES THE PROJECT, WHOLE. The contributor
 * record survives, it is still edited by hand and still printed beside the
 * project, because who did the work is worth knowing — it just cannot move an
 * hour any more. That is what this checks, from both ends: that the credit
 * always lands on exactly one person, and that no amount of editing roles ever
 * changes a single number.
 *
 * Run with: node scripts/check-roles.mjs
 */
import { readFileSync } from 'node:fs'
import ExcelJS from 'exceljs'
import {
  computePlan, DEFAULT_SETTINGS, DEFAULT_ROLE_WEIGHTS, ROLE_ORDER, ROLE_LABEL,
  setRolesPatch, creditRows, creditSummary, projectShares, repairOwnership,
} from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const w = DEFAULT_ROLE_WEIGHTS
const shares = (project, opts = {}) => projectShares(project, w, false, opts).shares
const owners = new Set(seed.people.filter((p) => p.scorecard !== false).map((p) => p.id))
const withOwners = (project) => shares(project, { owners })

console.log('— the share is the PIC\'s, whole —')

const solo = { pic: 'gun', contributors: [{ person: 'gun', roles: ['dev'] }] }
check('the PIC takes all of it', JSON.stringify(withOwners(solo)) === '{"gun":1}', JSON.stringify(withOwners(solo)))

const shared = { pic: 'gun', contributors: [{ person: 'gun', roles: ['dev'] }, { person: 'kade', roles: ['qa'] }] }
check('A CONTRIBUTOR TAKES NONE OF IT', JSON.stringify(withOwners(shared)) === '{"gun":1}',
  JSON.stringify(withOwners(shared)))
check('  not even a second developer',
  JSON.stringify(withOwners({ pic: 'gun', contributors: [{ person: 'gun', roles: ['dev'] }, { person: 'kade', roles: ['dev'] }] })) === '{"gun":1}')
check('  and not a PM either',
  JSON.stringify(withOwners({ pic: 'gun', contributors: [{ person: 'kade', roles: ['pm'] }] })) === '{"gun":1}')
check('a PIC with no contributor record still owns it outright',
  JSON.stringify(withOwners({ pic: 'kade', contributors: [] })) === '{"kade":1}')

/*
 * NO COMBINATION OF ROLES CHANGES ANYTHING. The old model had 36 pairs to get
 * right; this one has to get the same answer 36 times.
 */
let moved = 0
for (const a of ROLE_ORDER) {
  for (const b of ROLE_ORDER) {
    const got = withOwners({ pic: 'gun', contributors: [{ person: 'gun', roles: [a] }, { person: 'kade', roles: [b] }] })
    if (JSON.stringify(got) !== '{"gun":1}') moved += 1
  }
}
check('NOT ONE OF THE 36 ROLE PAIRS MOVES AN HOUR', moved === 0, `${moved} of ${ROLE_ORDER.length ** 2} moved it`)

check('holding two roles is the same as holding one',
  JSON.stringify(withOwners({ pic: 'gun', contributors: [{ person: 'gun', roles: ['pm', 'dev'] }] })) === '{"gun":1}')
check('every share is exactly 1, never 0.9999999',
  Object.values(withOwners(shared)).every((v) => v === 1))

console.log('\n— and where there is no PIC, there is no share —')
check('nobody is PIC: nobody is credited',
  JSON.stringify(withOwners({ pic: null, contributors: [{ person: 'gun', roles: ['dev'] }] })) === '{}',
  JSON.stringify(withOwners({ pic: null, contributors: [{ person: 'gun', roles: ['dev'] }] })))
check('  the team lead does NOT absorb it any more',
  JSON.stringify(projectShares({ pic: null, contributors: [] }, w, false, { owners, fallbackPic: 'gun' }).shares) === '{}',
  'a project the lead is not PIC of must not appear on the lead\'s own row')
check('  and it is never reported as a fallback',
  projectShares({ pic: null, contributors: [] }, w, false, { owners, fallbackPic: 'gun' }).fellBack === false)
check('a PIC who holds no scorecard is credited to nobody',
  JSON.stringify(withOwners({ pic: 'it', contributors: [] })) === '{}',
  'IT and the business carry no KPI')

console.log('\n— the record itself still works —')
const project = { key: 'X', pic: 'james', contributors: [{ person: 'james', roles: ['dev'] }] }
const added = { ...project, ...setRolesPatch(project, 'kade', ['qa']) }
check('a role can be added by hand',
  added.contributors.some((c) => c.person === 'kade' && c.roles.join() === 'qa'))
check('  and it changes NO number',
  JSON.stringify(withOwners(added)) === JSON.stringify(withOwners(project)),
  `${JSON.stringify(withOwners(project))} -> ${JSON.stringify(withOwners(added))}`)
const promoted = { ...added, ...setRolesPatch(added, 'kade', ['dev']) }
check('a role can be changed',
  promoted.contributors.find((c) => c.person === 'kade').roles.join() === 'dev')
check('  and that changes no number either',
  JSON.stringify(withOwners(promoted)) === '{"james":1}')
const removed = { ...promoted, ...setRolesPatch(promoted, 'kade', []) }
check('a person can be taken off', !removed.contributors.some((c) => c.person === 'kade'))
check('  without moving anything', JSON.stringify(withOwners(removed)) === '{"james":1}')

const nick = (id) => seed.people.find((p) => p.id === id)?.nick || id
check('the credit rows still name everybody who worked on it',
  creditRows(added, w, { owners }).some((r) => r.person === 'kade'),
  creditRows(added, w, { owners }).map((r) => `${nick(r.person)} ${r.roles.join('/')}`).join(' · '))
check('  and the summary line reads as who did what',
  /james/i.test(creditSummary(added, withOwners(added), nick)),
  creditSummary(added, withOwners(added), nick))

console.log('\n— nothing in the plan is credited to a non-PIC —')
const plan = computePlan(base)
const strays = plan.projects.filter((p) => Object.keys(p.shares || {}).some((k) => k !== p.pic))
check('NOT ONE PROJECT IN THE WHOLE REGISTER', strays.length === 0,
  strays.slice(0, 3).map((p) => `${p.jiraKey || p.key} pic=${p.pic} ${JSON.stringify(p.shares)}`).join(' | '))
const split = plan.projects.filter((p) => Object.keys(p.shares || {}).length > 1)
check('and not one is split between two people', split.length === 0,
  split.slice(0, 3).map((p) => `${p.jiraKey || p.key} ${JSON.stringify(p.shares)}`).join(' | '))
check('every credited row on every card belongs to that card\'s owner',
  plan.people.filter((p) => !p.aggregatesTeam)
    .every((person) => person.scorecardRows.every(({ p }) => p.pic === person.id)),
  'the lead aggregates the team by design and is checked in check-lead')

/* Editing roles across the whole register must not move the team total. */
const before = Math.round(plan.totals.committedHours)
const churned = computePlan({
  ...base,
  projects: base.projects.map((p) => ({
    ...p,
    contributors: [...(p.contributors || []), { person: p.pic === 'kade' ? 'gun' : 'kade', roles: ['qa'] }],
  })),
})
check('ADDING A QA TO EVERY PROJECT MOVES NOTHING AT ALL',
  Math.round(churned.totals.committedHours) === before
  && JSON.stringify(churned.people.map((p) => Math.round(p.kpiTotals.savingHours)))
  === JSON.stringify(plan.people.map((p) => Math.round(p.kpiTotals.savingHours))),
  `${before} -> ${Math.round(churned.totals.committedHours)}`)

/* And so must changing the weights, which no longer decide anything. */
const reweighted = computePlan({
  ...base,
  settings: { ...DEFAULT_SETTINGS, roleWeights: Object.fromEntries(ROLE_ORDER.map((r) => [r, 0.5])) },
})
check('FLATTENING EVERY ROLE WEIGHT MOVES NOTHING EITHER',
  JSON.stringify(reweighted.people.map((p) => Math.round(p.kpiTotals.savingHours)))
  === JSON.stringify(plan.people.map((p) => Math.round(p.kpiTotals.savingHours))),
  'role weights no longer decide credit, and the Model tab says so')
check('every role still has a label to print', ROLE_ORDER.every((r) => !!ROLE_LABEL[r]))

/* The repair that fixed damaged ownership must still leave a valid shape. */
const repaired = repairOwnership(base.projects, base.people)
check('the ownership repair still runs clean',
  repaired.projects.length === base.projects.length)

console.log('\n— and the workbook says the same —')
{
  const wb = await buildWorkbook(plan, base)
  const buf = await wb.xlsx.writeBuffer()
  const back = new ExcelJS.Workbook()
  await back.xlsx.load(buf)
  const ws = back.getWorksheet('Projects')
  let col = null
  ws.getRow(4).eachCell((c, n) => { if (String(c.value || '').startsWith('Team (roles')) col = n })
  check('the register still prints who worked on each project', !!col, String(col))

  /*
   * The person sheets: every row on a member's sheet is a project they are
   * PIC of. This is the check that would have caught the original complaint.
   */
  let wrong = []
  for (const person of seed.people.filter((p) => p.scorecard !== false)) {
    const pp = plan.people.find((x) => x.id === person.id)
    if (!pp || pp.aggregatesTeam) continue
    const sheet = back.getWorksheet(`Obj-${person.nick}`)
    if (!sheet) continue
    const keys = new Set(plan.projects.filter((p) => p.pic === person.id).map((p) => p.summary))
    sheet.eachRow((row, n) => {
      if (n < 6) return
      const name = String(row.getCell(2).value || '')
      const known = plan.projects.find((p) => p.summary === name)
      if (known && !keys.has(name)) wrong.push(`${person.nick}: ${name} (pic ${known.pic || 'none'})`)
    })
  }
  check('NO SHEET LISTS A PROJECT ITS OWNER IS NOT PIC OF', wrong.length === 0,
    wrong.slice(0, 3).join(' | '))
}

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
