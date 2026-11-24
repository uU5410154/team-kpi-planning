import * as llm from './llm.js'
import * as store from './db.js'
import { UNAVAILABLE } from './db.js'
import { OBJECTIVES } from '../src/lib/palette.js'

/*
 * A NEW PROJECT, DESCRIBED IN PLAIN WORDS (owner, 2026-11-24).
 *
 * Somebody writes what the project is — "automate AP invoice matching for
 * Non-Trade, Gun leads it, December to February, saves about 40 hours a
 * month" — and the Lotus LLM turns it into the fields of the new-project
 * form. NOTHING IS CREATED HERE: the form comes back filled in, the person
 * checks it and presses Create, and only then do the usual routes write the
 * Jira epic and the register row.
 *
 * The answer is checked against the register before it is returned: a PIC
 * must be somebody on the team, a team one the register uses, an objective
 * one of the four, a date a real date. What the model could not tell from
 * the words comes back empty and is named in `missing`, so the form can ask
 * for it rather than guess.
 */

const cfg = () => ({ scenario: process.env.JIRA_SYNC_SCENARIO || 'Baseline' })
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s

/** Today in Bangkok, as YYYY-MM-DD: what "next month" is measured from. */
export const bangkokToday = (ms = Date.now()) => new Date(ms + 7 * 3600_000).toISOString().slice(0, 10)

export const KINDS = {
  project: 'Project',
  adhoc: 'Adhoc work',
  cr: 'Change Request',
}
// A member raises adhoc work or a change request; a planned project is an administrator's.
export const kindsFor = (admin) => (admin ? ['project', 'adhoc', 'cr'] : ['adhoc', 'cr'])

/** The teams and sub teams the register uses, each sub team under its team. */
export function teamTree(projects = []) {
  const live = projects.filter((p) => !p.deleted)
  const teams = [...new Set(live.map((p) => p.team).filter(Boolean))].sort()
  return teams.map((team) => ({
    team,
    subs: [...new Set(live.filter((p) => p.team === team).map((p) => p.subTeam).filter(Boolean))].sort(),
  }))
}

/** What the form offers: the same lists the draft is checked against. */
export function optionsFor({ people = [], projects = [], me = {}, admin = false }) {
  const team = people.filter((p) => !p.deleted)
  return {
    kinds: kindsFor(admin).map((id) => ({ id, name: KINDS[id] })),
    teams: teamTree(projects),
    people: (admin ? team : team.filter((p) => p.id === me.person))
      .map((p) => ({ id: p.id, nick: p.nick || p.name || p.id, name: p.name || p.nick || p.id })),
    objectives: OBJECTIVES.map((o) => ({ id: o.id, name: o.name })),
  }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

/*
 * THE MODEL'S ANSWER, CHECKED. Pure, so the tests can feed it anything the
 * model might say. A member's project is always their own: the PIC is them,
 * whatever the words said.
 */
export function normalizeDraft(raw, { options, me = {}, admin = false, today = bangkokToday() } = {}) {
  const j = raw && typeof raw === 'object' ? raw : {}
  const missing = []
  const kinds = options.kinds.map((k) => k.id)
  const kind = kinds.includes(j.kind) ? j.kind : (admin ? 'project' : 'adhoc')

  const summary = clip(j.summary, 250)
  if (summary.length < 3) missing.push('summary')

  // The PIC: an id, a nickname or a full name the roster knows.
  let pic = null
  if (!admin) pic = me.person || null
  else if (j.pic) {
    const want = norm(j.pic)
    const hit = options.people.find((p) => norm(p.id) === want || norm(p.nick) === want || norm(p.name) === want)
      || options.people.find((p) => want && (norm(p.name).startsWith(want) || norm(p.nick).startsWith(want)))
    pic = hit?.id || null
  }
  if (!pic) missing.push('pic')

  // The team: one the register uses, matched without regard to case.
  const teamHit = options.teams.find((t) => norm(t.team) === norm(j.team))
  const team = teamHit?.team || null
  if (!team) missing.push('team')
  // A sub team the register knows under that team; else what was said, for the person to confirm.
  const subWant = clip(j.subTeam, 80)
  const subHit = teamHit?.subs.find((s) => norm(s) === norm(subWant))
  const subTeam = subHit || subWant || ''

  const objective = options.objectives.some((o) => o.id === j.objective) ? j.objective : null
  if (!objective) missing.push('objective')

  let start = isDay(j.start) ? j.start : null
  let due = isDay(j.due) ? j.due : null
  if (start && due && start > due) [start, due] = [due, start]
  if (!start) missing.push('start')
  if (!due) missing.push('due')

  const h = Number(j.savingHours)
  const savingHours = j.savingHours != null && j.savingHours !== '' && Number.isFinite(h) && h >= 0 && h < 100000 ? Math.round(h * 10) / 10 : null
  if (savingHours == null) missing.push('savingHours')

  return {
    draft: {
      kind, summary, pic, team, subTeam, objective, start, due, savingHours,
      description: String(j.description || '').trim().slice(0, 4000),
    },
    missing,
    today,
  }
}

const PROMPT = ({ options, admin, today }) => [
  'You turn a plain-language description of a new piece of work for a finance technology team into the fields of their new-project form.',
  'Answer with JSON only, no other text:',
  '{"summary": "a short project name, 3 to 12 words, in the words given — no ticket keys",',
  ` "kind": ${options.kinds.map((k) => `"${k.id}"`).join(' | ')},`,
  admin ? ' "pic": "the person in charge, exactly as an id from the people list, or null",' : '',
  ' "team": "exactly one team from the list, or null",',
  ' "subTeam": "a sub team from the list under that team, or the sub team named in the text, or empty",',
  ' "objective": "exactly one objective id from the list, or null",',
  ' "start": "YYYY-MM-DD or null", "due": "YYYY-MM-DD or null",',
  ' "savingHours": "the hours saved PER MONTH as a number, or null",',
  ' "description": "two to five plain sentences: what it is, who it is for, what changes, and any figures given"}',
  `Today is ${today}. Turn relative dates ("next month", "end of Q1", "December to February") into real dates after today: a month alone starts on its 1st and ends on its last day.`,
  'Saving hours are per month: convert a yearly or weekly figure, and leave null when no saving is stated. Never invent a saving, a date, a person or a team that the text does not support.',
  `Kinds: ${options.kinds.map((k) => `${k.id} = ${k.name}`).join('; ')}.${admin ? ' Use "project" unless the text calls it adhoc work or a change request.' : ' Use "cr" when it changes an existing system or report, otherwise "adhoc".'}`,
  admin ? `People (id: nickname, full name): ${options.people.map((p) => `${p.id}: ${p.nick}, ${p.name}`).join('; ')}.` : '',
  `Teams and their sub teams: ${options.teams.map((t) => `${t.team} [${t.subs.join(', ')}]`).join('; ')}.`,
  `Objectives (id: name): ${options.objectives.map((o) => `${o.id}: ${o.name}`).join('; ')}.`,
  'Write the summary and description in the same language as the text you are given (Thai or English). Never translate.',
].filter(Boolean).join('\n')

/** The draft for a description. `me` is the signed-in user ({ role, person }). */
export async function draft(me, body) {
  const text = String(body?.text || '').trim().slice(0, 3000)
  if (text.length < 8) return { status: 400, error: 'Describe the project in a sentence or two first.' }
  const admin = me?.role === 'admin'
  const doc = await store.getScenario(cfg().scenario)
  if (doc === UNAVAILABLE) return UNAVAILABLE
  const options = optionsFor({ people: doc?.payload?.people || [], projects: doc?.payload?.projects || [], me, admin })
  const today = bangkokToday()
  const out = await llm.chat([
    { role: 'system', content: PROMPT({ options, admin, today }) },
    { role: 'user', content: `Description:\n---\n${text}` },
  ], { temperature: 0.1, maxTokens: 900 })
  const j = llm.jsonFrom(out)
  if (!j) return { status: 502, error: 'The AI did not return the project in a form the page can use. Try again, or fill the form in yourself.' }
  return { ...normalizeDraft(j, { options, me, admin, today }), options }
}

/** The form's lists with nothing drafted: for filling it in by hand when the AI is off. */
export async function blank(me) {
  const admin = me?.role === 'admin'
  const doc = await store.getScenario(cfg().scenario)
  if (doc === UNAVAILABLE) return UNAVAILABLE
  return { options: optionsFor({ people: doc?.payload?.people || [], projects: doc?.payload?.projects || [], me, admin }), today: bangkokToday() }
}
