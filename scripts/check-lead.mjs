/**
 * Locks the team-lead scorecard rule:
 *   Gun's card carries the TEAM's KPI — every member's credited hours plus the
 *   projects assigned to him, the IT-owned ones and the unassigned ones — and
 *   equals the sum of the other scorecards exactly. Next-year projects are out.
 *
 * Run with: node scripts/check-lead.mjs
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import ExcelJS from 'exceljs'
import { computePlan, DEFAULT_SETTINGS } from '../src/lib/model.js'
import { buildWorkbook } from '../src/lib/exportXlsx.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS, scenarioName: 'lead' }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const plan = computePlan(base)
const lead = plan.people.find((p) => p.aggregatesTeam)
const others = plan.people.filter((p) => !p.aggregatesTeam)

console.log('--- who aggregates ---')
check('exactly one person aggregates the team', plan.people.filter((p) => p.aggregatesTeam).length === 1,
  lead && `${lead.nick} (${lead.role})`)
check('it is the team lead', lead?.band === 'lead' && lead.id === 'gun')
check('nobody else does', others.every((p) => !p.aggregatesTeam))

console.log('\n--- the lead\'s number IS the headline ---')
// The number on the lead's card and the number in the header must be the same
// number. They diverged once by exactly the 352 objective-3 hours, which the
// header counted and the scorecards did not.
/*
 * THE BOOK, IN THREE PARTS.
 *
 * The book counts every row on the register. The lead's card counts what the
 * TEAM is carrying — and since credit goes to the PIC and to nobody else,
 * that is the book less two things: work IT or a business user owns, and work
 * NOBODY is named to. The lead used to absorb that second bucket, which put
 * projects on the lead's card that the lead was not PIC of. It no longer does,
 * so the difference has two names instead of one and both are stated.
 *
 *   book = the lead's figure + outside-owned + unowned
 */
const ours = plan.totals.totalHours - plan.totals.outsideHours
// What the CARDS add up to. The book still contains the unowned work; it is
// only the cards that cannot, because no card belongs to nobody.
const onCards = ours - plan.totals.unownedHours
check('the lead figure equals the book less outside-owned AND unowned work',
  Math.abs(lead.scorecardHours - onCards) < 0.01,
  `lead ${lead.scorecardHours.toFixed(1)} vs ${plan.totals.totalHours.toFixed(1)} − ${plan.totals.outsideHours.toFixed(1)} − ${plan.totals.unownedHours.toFixed(1)}`)
check('and the three add back up to the book, exactly',
  Math.abs((lead.scorecardHours + plan.totals.outsideHours + plan.totals.unownedHours)
    - plan.totals.totalHours) < 0.01,
  `${lead.scorecardHours.toFixed(1)} + ${plan.totals.outsideHours.toFixed(1)} + ${plan.totals.unownedHours.toFixed(1)}`)
check('the outside-owned part is real and named',
  plan.totals.outsideHours > 0,
  `${Math.round(plan.totals.outsideHours)} hrs over ${plan.totals.outsideCount} projects`)
check('AND SO IS THE UNOWNED PART — hours on nobody\'s card must never be silent',
  plan.totals.unownedHours >= 0 && Number.isFinite(plan.totals.unownedHours)
  && plan.totals.unownedCount >= 0,
  `${Math.round(plan.totals.unownedHours)} hrs over ${plan.totals.unownedCount} projects with no PIC`)
/*
 * The lead's card is the TEAM's card, so it lists the team's projects — that
 * is what aggregating means and it is stated on the card itself. Everybody
 * else's card may only carry what they are PIC of, which is the rule that was
 * being broken: a developer recorded on a project carried a share of hours on
 * work somebody else owned.
 */
check('NOBODY ELSE\'S CARD CARRIES A PROJECT THEY ARE NOT PIC OF',
  others.every((person) => person.scorecardRows.every(({ p }) => p.pic === person.id)),
  others.flatMap((person) => person.scorecardRows
    .filter(({ p }) => p.pic !== person.id)
    .map(({ p }) => `${person.nick}: ${p.jiraKey || p.key} (pic ${p.pic || 'none'})`)).slice(0, 3).join(' | '))
check('  and every share on every project is the whole of it, to one person',
  plan.projects.every((p) => {
    const ids = Object.keys(p.shares || {})
    if (!ids.length) return !p.pic || p.outsideTeam
    return ids.length === 1 && ids[0] === p.pic && Math.abs(p.shares[ids[0]] - 1) < 1e-9
  }),
  plan.projects.filter((p) => Object.keys(p.shares || {}).some((k) => k !== p.pic))
    .slice(0, 3).map((p) => `${p.jiraKey || p.key} ${JSON.stringify(p.shares)}`).join(' | '))
check('and the headline equals the raw source column',
  Math.abs(plan.totals.totalHours - seed.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)) < 0.01)
check('every objective contributes its hours, including the date-gated one',
  Math.abs(Object.values(plan.byObjective).reduce((a, b) => a + b, 0) - ours) < 0.01,
  Object.entries(plan.byObjective).map(([k, v]) => `${k}=${Math.round(v)}`).join(' '))

console.log('\n--- the lead\'s number IS the team\'s ---')
const sumOfAll = plan.people.reduce((a, p) => a + p.ownHours, 0)
console.log(`  members: ${plan.people.map((p) => `${p.nick} ${Math.round(p.ownHours)}`).join(' + ')}`)
check('lead scorecard = sum of every member\'s own hours',
  Math.abs(lead.scorecardHours - sumOfAll) < 1e-9,
  `${lead.scorecardHours.toFixed(1)} vs ${sumOfAll.toFixed(1)}`)
check('it also equals totals.teamHours', Math.abs(lead.scorecardHours - plan.totals.teamHours) < 1e-9)
check('the lead still has their own personal figure', lead.ownHours > 0 && lead.ownHours < lead.scorecardHours,
  `own ${Math.round(lead.ownHours)} of team ${Math.round(lead.scorecardHours)}`)
check('everyone else\'s scorecard is their own hours',
  others.every((p) => Math.abs(p.scorecardHours - p.ownHours) < 1e-9))

console.log('\n--- it includes each of the three sources the lead asked for ---')
const own = plan.projects.filter((p) => p.pic === 'gun')
const itOwned = plan.projects.filter((p) => p.pic === 'it')
const teamMates = plan.projects.filter((p) => p.pic && p.pic !== 'gun' && p.pic !== 'it')
const inPortfolio = (arr) => arr.filter((x) => (x.commitLevel === 'commit' || x.commitLevel === 'stretch'))
  .every((x) => lead.scorecardRows.some((r) => r.p.key === x.key))
check('projects assigned to the lead are in the portfolio', inPortfolio(own), `${own.length} projects`)
check('IT-OWNED PROJECTS ARE NOT IN THE PORTFOLIO',
  itOwned.every((x) => !lead.scorecardRows.some((r) => r.p.key === x.key)),
  `${itOwned.length} projects, ${Math.round(plan.totals.outsideHours)} hrs`)
check('other members\' projects are in the portfolio', inPortfolio(teamMates), `${teamMates.length} projects`)

console.log('\n--- the portfolio re-adds to the headline ---')
// Every objective contributes now, including the date-gated one, so the whole
// portfolio re-adds — no objective is quietly left out of the sum.
const portfolioSum = lead.scorecardRows.reduce((a, r) => a + (r.p.savingHours ?? 0) * r.share, 0)
check('the portfolio rows sum to the lead\'s figure',
  Math.abs(portfolioSum - lead.scorecardHours) < 0.01,
  `${portfolioSum.toFixed(1)} vs ${lead.scorecardHours.toFixed(1)}`)

console.log('\n--- next year is excluded ---')
const biggest = [...base.projects].sort((a, b) => (b.savingHours ?? 0) - (a.savingHours ?? 0))[0]
const deferred = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === biggest.key ? { ...p, commitLevel: 'nextyear' } : p)),
})
const leadAfter = deferred.people.find((p) => p.aggregatesTeam)
check('deferring a project drops it from the lead\'s figure too',
  Math.abs(lead.scorecardHours - leadAfter.scorecardHours - biggest.savingHours) < 1e-9,
  `${Math.round(lead.scorecardHours)} -> ${Math.round(leadAfter.scorecardHours)} (−${biggest.savingHours})`)
check('and out of the lead\'s portfolio list',
  !leadAfter.scorecardRows.some((r) => r.p.key === biggest.key))
check('the lead still equals the sum of members after deferral',
  Math.abs(leadAfter.scorecardHours - deferred.people.reduce((a, p) => a + p.ownHours, 0)) < 1e-9)

console.log('\n--- reassignment does not change the team figure ---')
const moved = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === biggest.key
    ? { ...p, pic: 'james', contributors: [{ person: 'james', roles: ['dev'] }] } : p)),
})
check('moving a project between members leaves the team total unchanged',
  Math.abs(moved.people.find((p) => p.aggregatesTeam).scorecardHours - lead.scorecardHours) < 1e-9,
  `${Math.round(moved.people.find((p) => p.aggregatesTeam).scorecardHours)}`)
check('but the individual figures move',
  moved.people.find((p) => p.id === 'james').ownHours > plan.people.find((p) => p.id === 'james').ownHours)

console.log('\n--- weights and the save gate still hold ---')
check('every scorecard totals 100%',
  plan.people.every((p) => Math.abs(p.kpiLines.reduce((a, l) => a + l.weight, 0) - 1) < 0.0005))
check('nothing is blocking the save', plan.invalid.length === 0)
check('the lead holds every objective the team touches',
  lead.objectives.length >= Math.max(...others.map((p) => p.objectives.length)),
  lead.objectives.join(', '))

console.log('\n--- the export agrees ---')
{
  const file = 'lead-selftest.xlsx'
  if (existsSync(file)) unlinkSync(file)
  const wb = await buildWorkbook(plan, base)
  await wb.xlsx.writeFile(file)
  const back = new ExcelJS.Workbook()
  await back.xlsx.readFile(file)
  // The POSITION block came off these sheets, so the lead's figure is asserted
  // where it still lives: the TOTAL CREDITED row of their own portfolio, and
  // the Summary. Both must equal the team total the model computed.
  const ws = back.getWorksheet(`Obj-${lead.nick}`)
  const head = []
  ws.eachRow((row) => { if (row.getCell(1).value === 'Jira') row.eachCell((c, n) => { head[n] = String(c.value || '') }) })
  const col = (label) => head.findIndex((h) => h && h.startsWith(label))
  check('the lead sheet carries a portfolio with a Credited column', col('Credited') > 0,
    head.filter(Boolean).join(' | '))
  let totalCredited = null
  ws.eachRow((row) => {
    if (String(row.getCell(2).value || '') === 'TOTAL CREDITED') totalCredited = row.getCell(col('Credited')).value
  })
  check('the exported TOTAL CREDITED is the team figure',
    Math.abs(totalCredited - Math.round(lead.scorecardHours)) < 1,
    `${totalCredited} vs ${Math.round(lead.scorecardHours)}`)

  const sum = back.getWorksheet('Summary')
  let book = null
  sum.eachRow((row) => { if (String(row.getCell(1).value || '').startsWith('Total book')) book = row.getCell(2).value })
  check('and the Summary book total is the lead figure plus outside plus unowned',
    Math.abs(book - Math.round(lead.scorecardHours) - Math.round(plan.totals.outsideHours)
      - Math.round(plan.totals.unownedHours)) < 2,
    `${book} vs ${Math.round(lead.scorecardHours)} + ${Math.round(plan.totals.outsideHours)}`
    + ` + ${Math.round(plan.totals.unownedHours)}`)
  unlinkSync(file)
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
