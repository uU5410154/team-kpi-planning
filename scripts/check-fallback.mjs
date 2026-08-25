/**
 * Locks three rules, and the boundary between them:
 *   - IT and the business user are assignable as PIC but hold no scorecard.
 *   - A project THEY own is not the team's: nobody is credited, its hours are
 *     not in the commitment, and the lead does NOT absorb it. Claiming it
 *     would be claiming somebody else's work.
 *   - Saving hours on a project NOBODY is PIC of land on nobody. The lead used
 *     to absorb them, which put projects on the lead's card that the lead did
 *     not own — the same fault as crediting a contributor. They are not lost:
 *     the book still counts them and `totals.unownedHours` names them.
 *
 * Unowned and owned-by-someone-else are still not the same thing: one is a gap
 * to close, the other is work this team did not do.
 *
 * Run with: node scripts/check-fallback.mjs
 */
import { readFileSync } from 'node:fs'
import { computePlan, DEFAULT_SETTINGS, projectShares } from '../src/lib/model.js'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const base = { meta: seed.meta, people: seed.people, projects: seed.projects, settings: DEFAULT_SETTINGS }

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const plan = computePlan(base)

/* ---------------- IT as an assignable owner ---------------- */
console.log('--- IT as a PIC ---')
const it = seed.people.find((p) => p.id === 'it')
check('IT exists in the roster', !!it, it && `${it.nick} / ${it.role}`)
check('IT is flagged as holding no scorecard', it?.scorecard === false)
check('IT is offered as an assignee', plan.assignees.some((p) => p.id === 'it'))
check('IT has no scorecard tab', !plan.people.some((p) => p.id === 'it'),
  plan.people.map((p) => p.nick).join(', '))
check('IT owns projects in the register', seed.projects.filter((p) => p.pic === 'it').length > 0,
  `${seed.projects.filter((p) => p.pic === 'it').length} projects`)
check('IT is never credited any hours',
  plan.projects.every((p) => !('it' in p.shares)))

/* ---------------- the fallback rule ---------------- */
console.log('\n--- unowned hours fall to the team lead ---')
const lead = plan.people.find((p) => p.id === DEFAULT_SETTINGS.fallbackPic)
check('the fallback is the team lead', lead?.band === 'lead', `${lead?.nick} (${lead?.role})`)

const itProjects = plan.projects.filter((p) => p.pic === 'it')
check('NO IT-OWNED PROJECT IS CREDITED TO ANYONE',
  itProjects.every((p) => Object.keys(p.shares).length === 0),
  `${itProjects.length} projects`)
check('and none of it is treated as a fallback', itProjects.every((p) => p.fellBack !== true))
check('the lead does not absorb it',
  itProjects.every((p) => !(lead.id in p.shares)))
check('it is flagged as outside the team', itProjects.every((p) => p.outsideTeam === true))
check('and its hours are reported, not silently dropped',
  Math.abs(plan.totals.outsideHours
    - itProjects.filter((p) => p.commitLevel !== 'nextyear' && p.commitLevel !== 'excluded')
      .reduce((a, p) => a + (p.savingHours ?? 0), 0)) < 0.01,
  `${Math.round(plan.totals.outsideHours)} hrs over ${plan.totals.outsideCount} projects`)
check('none of it reaches the team commitment',
  itProjects.every((p) => p.poolHours === 0))

const unassigned = plan.projects.filter((p) => !p.pic)
check('NO UNASSIGNED PROJECT IS CREDITED TO ANYBODY',
  unassigned.every((p) => Object.keys(p.shares || {}).length === 0),
  unassigned.filter((p) => Object.keys(p.shares || {}).length)
    .slice(0, 3).map((p) => `${p.jiraKey || p.key} ${JSON.stringify(p.shares)}`).join(' | ')
  || `${unassigned.length} projects, none credited`)
check('  not even to the lead, who used to absorb them',
  unassigned.every((p) => !(p.shares || {})[lead.id]))
check('  and none of them claims to be a fallback',
  unassigned.every((p) => p.fellBack !== true))

/*
 * They are not lost, though. The hours are in the book and the difference has
 * a name, because a total that quietly stops matching the sum of its parts is
 * a total nobody can use.
 */
check('THE HOURS ARE STILL COUNTED, UNDER A NAME',
  plan.totals.unownedHours > 0 && plan.totals.unownedCount > 0,
  `${Math.round(plan.totals.unownedHours)} hrs across ${plan.totals.unownedCount} projects with no PIC`)
check('  and that name covers exactly the counted, in-plan, ours-to-do ones',
  Math.abs(plan.totals.unownedHours - unassigned
    .filter((p) => !p.outsideTeam && (p.commitLevel === 'commit' || p.commitLevel === 'stretch'))
    .reduce((a, p) => a + (p.savingHours ?? 0), 0)) < 0.01,
  String(Math.round(plan.totals.unownedHours)))
check('  the book, the cards and the unowned add back up',
  Math.abs((lead.scorecardHours + plan.totals.outsideHours + plan.totals.unownedHours)
    - plan.totals.totalHours) < 0.01,
  `${Math.round(lead.scorecardHours)} + ${Math.round(plan.totals.outsideHours)} + ${Math.round(plan.totals.unownedHours)} vs ${Math.round(plan.totals.totalHours)}`)

/* ---------------- naming somebody is what moves it ---------------- */
console.log('\n--- and naming a PIC is what puts it on a card ---')
const orphan = unassigned.find((p) => (p.savingHours ?? 0) > 0)
check('there is an unowned project carrying hours to test with', !!orphan,
  orphan && `${orphan.jiraKey || orphan.key} ${orphan.savingHours} hrs`)
if (orphan) {
  const named = computePlan({
    ...base,
    projects: base.projects.map((p) => (p.key === orphan.key ? { ...p, pic: 'kade' } : p)),
  })
  const was = plan.people.find((x) => x.id === 'kade')
  const now = named.people.find((x) => x.id === 'kade')
  check('naming a PIC puts it on THEIR card, and only theirs',
    now.hours > was.hours,
    `${Math.round(was.hours)} -> ${Math.round(now.hours)}`)
  check('  and takes it out of the unowned bucket',
    named.totals.unownedHours < plan.totals.unownedHours,
    `${Math.round(plan.totals.unownedHours)} -> ${Math.round(named.totals.unownedHours)}`)
  check('  while the book does not move',
    Math.abs(named.totals.totalHours - plan.totals.totalHours) < 0.01)
}

/* ---------------- totals stay sound ---------------- */
console.log('\n--- totals and shares stay sound ---')
const rawSum = seed.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)
check('the book total is unaffected', Math.abs(plan.totals.totalHours - rawSum) < 0.01,
  `${plan.totals.totalHours.toFixed(1)} vs ${rawSum.toFixed(1)}`)

const owners = new Set(plan.people.map((p) => p.id))
let bad = []
for (const p of seed.projects) {
  const { shares, partnerShare } = projectShares(p, DEFAULT_SETTINGS.roleWeights, false,
    { owners, fallbackPic: 'gun' })
  const sum = Object.values(shares).reduce((a, b) => a + b, 0) + partnerShare
  /*
   * A project is credited 100% or 0%: whole to its PIC, or to nobody at all
   * where it has none or its PIC holds no scorecard. What must never happen is
   * a fraction — that would be the split coming back.
   */
  const ok = Math.abs(sum - 1) < 1e-9 || sum === 0
  if (!ok) bad.push(`${p.key}=${sum.toFixed(4)}`)
}
check('EVERY PROJECT IS CREDITED WHOLE OR NOT AT ALL — never a fraction',
  bad.length === 0, bad.slice(0, 5).join(', '))
check('no credit ever lands on a non-scorecard id',
  plan.projects.every((p) => Object.keys(p.shares).every((k) => owners.has(k))))

/* ---------------- reassignment away from IT ---------------- */
console.log('\n--- reassigning off IT moves the credit ---')
// pick one with real hours — a TBC project would move nothing measurable
const first = itProjects.find((p) => (p.savingHours || 0) > 0)
const moved = computePlan({
  ...base,
  projects: base.projects.map((p) => (p.key === first.key ? { ...p, pic: 'kade', contributors: [{ person: 'kade', roles: ['dev'] }] } : p)),
})
check('the lead is unaffected — it was never on their card',
  Math.abs(moved.people.find((p) => p.id === lead.id).hours
    - plan.people.find((p) => p.id === lead.id).hours) < 1e-9)
check('the new owner gains it', moved.people.find((p) => p.id === 'kade').hours > plan.people.find((p) => p.id === 'kade').hours,
  `${first.key} ${first.savingHours}h`)
check('and the team commitment grows by exactly that project',
  Math.abs(moved.totals.committedHours - plan.totals.committedHours - first.savingHours) < 0.01,
  `${Math.round(plan.totals.committedHours)} -> ${Math.round(moved.totals.committedHours)} (+${first.savingHours})`)
check('while the book total does not move — the row was always on the register',
  Math.abs(moved.totals.totalHours - plan.totals.totalHours) < 0.01)

/* ---------------- and the old setting decides nothing ----------------
 *
 * `fallbackPic` used to name whoever absorbed unowned work. Nobody absorbs it
 * any more, so the setting must be inert — a stored value from an older plan
 * cannot be allowed to quietly put projects back on somebody's card.
 */
const toJames = computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, fallbackPic: 'james' } })
check('SETTING A FALLBACK OWNER MOVES NOTHING AT ALL',
  JSON.stringify(toJames.people.map((p) => Math.round(p.hours)))
  === JSON.stringify(plan.people.map((p) => Math.round(p.hours))),
  `${Math.round(toJames.people.find((p) => p.id === 'james').hours)} vs ${Math.round(plan.people.find((p) => p.id === 'james').hours)}`)
check('  and an unknown one is still ignored rather than crashing',
  Number.isFinite(computePlan({ ...base, settings: { ...DEFAULT_SETTINGS, fallbackPic: 'nope' } }).totals.unownedHours))

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
