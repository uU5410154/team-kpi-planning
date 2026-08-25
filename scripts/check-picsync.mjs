/**
 * Who runs a project, and the ticket it follows.
 *
 * Jira says "Nakittapon Imjaijaroenying" and the register says "Pol". For as
 * long as those were kept apart by nothing but an unfetched field, a project
 * reassigned on the board stayed on the wrong person's objective here — and
 * the PIC is exactly what objective 1 measures.
 *
 * The whole feature rests on one rule: a name the roster CLAIMS moves the
 * project, and any other name changes nothing. A guess at who somebody is
 * would put a project on the wrong person's KPI, which is worse than not
 * knowing.
 *
 *   node scripts/check-picsync.mjs
 */
import { readFileSync } from 'node:fs'
import { mergeJira } from '../src/lib/jiraMerge.js'
import {
  computePlan, repairState, personForJiraName, jiraNameKey, DEFAULT_JIRA_NAMES,
} from '../src/lib/model.js'

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const people = seed.people

console.log('— who is who —')
const cases = [
  ['Wisarut Gunjarueg', 'gun'],
  ['Ronnatouch Pomee', 'gun'],
  ['pipat.singhasiri', 'james'],
  ['Pipat Singhasiri', 'james'],
  ['chanphen', 'pphen'],
  ['Chanphen Manu', 'pphen'],
  ['Jarinya Phosri', 'kade'],
  ['THAPANEE', 'tha'],
  ['Panadda', 'tha'],
  ['Nakittapon Imjaijaroenying', 'pol'],
]
for (const [name, id] of cases) {
  check(`${name} is ${id}`, personForJiraName(people, name) === id, String(personForJiraName(people, name)))
}
check('a name nobody claims is nobody',
  personForJiraName(people, 'Somebody Else') === null)
check('an empty name is nobody',
  personForJiraName(people, null) === null && personForJiraName(people, '  ') === null)
check('spelling it differently still finds them',
  personForJiraName(people, '  nakittapon   imjaijaroenying ') === 'pol'
  && personForJiraName(people, 'wisarut gunjarueg') === 'gun')
check('every mapped id is somebody on the roster',
  Object.keys(DEFAULT_JIRA_NAMES).every((id) => people.some((p) => p.id === id)),
  Object.keys(DEFAULT_JIRA_NAMES).filter((id) => !people.some((p) => p.id === id)).join(', ') || 'all present')
check('NO NAME IS CLAIMED BY TWO PEOPLE', (() => {
  const seen = new Map()
  for (const [id, names] of Object.entries(DEFAULT_JIRA_NAMES)) {
    for (const n of names) {
      const k = jiraNameKey(n)
      if (seen.has(k) && seen.get(k) !== id) return false
      seen.set(k, id)
    }
  }
  return true
})(), 'a name on two lists would put a project on whichever person was read first')
check('the roster can override the built-in list', (() => {
  const custom = people.map((p) => (p.id === 'kade' ? { ...p, jiraNames: ['Someone New'] } : p))
  return personForJiraName(custom, 'Someone New') === 'kade'
})())

console.log('\n— what a sync does with it —')
const project = {
  key: 'P1',
  jiraKey: 'FNP-440',
  summary: 'PL Chatbot',
  pic: 'gun',
  objective: 'efficiency',
  commitLevel: 'commit',
  savingHours: 20,
  due: '2026-09-28',
  contributors: [{ person: 'gun', roles: ['pm'] }],
}
const state = (projects) => ({ projects, people, settings: {} })
const issue = (over = {}) => ({ key: 'FNP-440', summary: 'PL Chatbot', due: '2026-09-28', ...over })
const run = (over, projects = [project]) =>
  mergeJira(state(projects), { issues: [issue(over)], epics: [], rollups: {} }, { addNew: false })

/*
 * A SYNC FILLS A BLANK. IT DOES NOT OVERRULE A PERSON.
 *
 * A Jira assignee is often whoever is doing the current task, not the person
 * accountable for the project, so a sync that overwrote the PIC moved projects
 * between two people's objectives on the strength of a ticket assignment.
 * Where the register already names somebody, that name stands — it was decided
 * by a person, and disagreeing with the board is not the same as being wrong.
 */
const held = run({ assignee: 'Nakittapon Imjaijaroenying' })
check('A NAMED PIC IS NEVER OVERRULED BY THE BOARD',
  held.projects[0].pic === 'gun', String(held.projects[0].pic))
check('  and nothing is reported as moved', held.reassigned === 0)
check('  but the disagreement IS reported, so somebody can settle it',
  held.picDisagreements === 1
  && held.picConflicts[0].register === 'gun' && held.picConflicts[0].jira === 'pol'
  && held.picConflicts[0].name === 'Nakittapon Imjaijaroenying',
  JSON.stringify(held.picConflicts))

const moved = run({ assignee: 'Nakittapon Imjaijaroenying' }, [{ ...project, pic: null, contributors: [] }])
check('A BLANK PIC IS FILLED FROM THE TICKET', moved.projects[0].pic === 'pol', String(moved.projects[0].pic))
check('  and that one is reported as a move, from nobody',
  moved.reassigned === 1 && moved.reassignments[0].from === null
  && moved.reassignments[0].to === 'pol' && moved.reassignments[0].name === 'Nakittapon Imjaijaroenying',
  JSON.stringify(moved.reassignments))
check('  and it is not counted as a disagreement', moved.picDisagreements === 0)

check('AN UNRECOGNISED NAME CHANGES NOTHING',
  run({ assignee: 'Somebody Else' }).projects[0].pic === 'gun')
check('  and is not reported as a move, nor as a disagreement',
  run({ assignee: 'Somebody Else' }).reassigned === 0
  && run({ assignee: 'Somebody Else' }).picDisagreements === 0)
check('AN UNASSIGNED TICKET CHANGES NOTHING',
  run({ assignee: null }).projects[0].pic === 'gun'
  && run({}).projects[0].pic === 'gun')
check('  a blank never clears the PIC the register holds',
  run({ assignee: null }).projects[0].pic !== null)
check('the same assignee twice is a no-op',
  run({ assignee: 'Wisarut Gunjarueg' }).updated === 0)
check('a project with no PIC at all gets one',
  run({ assignee: 'Nakittapon Imjaijaroenying' }, [{ ...project, pic: null, contributors: [] }])
    .projects[0].pic === 'pol')

console.log('\n— and what it does NOT touch —')
const after = run({ assignee: 'Nakittapon Imjaijaroenying' }, [{ ...project, pic: null, contributors: [] }]).projects[0]
check('the saving hours are not Jira\'s business', after.savingHours === 20)
check('nor the objective', after.objective === 'efficiency')
check('nor the commitment level', after.commitLevel === 'commit')
check('nor the committed date', after.due === '2026-09-28')

/*
 * The hours move with the person, because that is what a PIC change means.
 *
 * Measured between two people who are NOT the lead. The lead's card carries
 * the whole team by design, so it holds the same total whoever runs the
 * project — which makes it the one card that cannot show this.
 */
const onJames = { ...project, pic: null, contributors: [] }
const handed = mergeJira(
  state([onJames]),
  { issues: [issue({ assignee: 'Nakittapon Imjaijaroenying' })], epics: [], rollups: {} },
  { addNew: false },
).projects[0]
const before = computePlan(repairState(state([{ ...project, pic: 'james', contributors: [{ person: 'james', roles: ['pm'] }] }])))
const now = computePlan(repairState(state([handed])))
const hoursOf = (plan, id) => Math.round(plan.people.find((p) => p.id === id)?.kpiTotals.savingHours || 0)
check('the hours leave the person who no longer runs it',
  hoursOf(now, 'james') < hoursOf(before, 'james'), `${hoursOf(before, 'james')} -> ${hoursOf(now, 'james')}`)
check('and land on the person who does',
  hoursOf(now, 'pol') > hoursOf(before, 'pol'), `${hoursOf(before, 'pol')} -> ${hoursOf(now, 'pol')}`)
check('THE TEAM TOTAL IS UNCHANGED — the work did not grow by changing hands',
  Math.round(before.totals.committedHours) === Math.round(now.totals.committedHours),
  `${Math.round(before.totals.committedHours)} -> ${Math.round(now.totals.committedHours)}`)

/* A new epic arrives on whoever holds it. */
const fresh = mergeJira(
  state([]),
  { issues: [], epics: [{ key: 'FNP-999', summary: 'Brand new', assignee: 'Panadda' }], rollups: {} },
  { addNew: true },
)
check('a new epic arrives on whoever holds the ticket',
  fresh.projects[0].pic === 'tha', String(fresh.projects[0].pic))
check('  and still arrives as WATCH, counting toward nothing',
  fresh.projects[0].commitLevel === 'watch')
check('  while an epic nobody holds arrives with no PIC', mergeJira(
  state([]),
  { issues: [], epics: [{ key: 'FNP-998', summary: 'Nobody', assignee: null }], rollups: {} },
  { addNew: true },
).projects[0].pic === null)

console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
