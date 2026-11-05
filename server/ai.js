import * as llm from './llm.js'
import * as weekly from './weekly.js'
import * as store from './db.js'
import * as auth from './auth.js'
import * as mail from './mail.js'
import { connect, UNAVAILABLE } from './db.js'
import {
  weekOf, addWeeks, weekLabel, deadlines, stageStatus, STATUS_LABEL, BLOCKER_CATEGORIES, PRIORITIES,
} from '../src/lib/weekly.js'
import { repairState, computePlan } from '../src/lib/model.js'

/**
 * WHAT THE AI DOES HERE, as agreed:
 *
 *   - helps a member write: rough notes into an update, polishing what is
 *     written, and suggesting what a blocker is waiting on and whether it
 *     moves the deadline. In the member's own language.
 *   - writes the week's summary for the administrators, by itself, once each
 *     deadline has passed — Monday 08:00, Friday 15:00, Sunday 15:00 — keeps
 *     it, and emails it to them. In English.
 *   - answers an administrator's questions about anything in the app,
 *     money included, in the language they ask in; each administrator's
 *     conversations are kept for them.
 *
 * Every prompt is built here, on the server, from data the asker is allowed
 * to see. The browser sends a question or a piece of its own text, never a
 * prompt.
 */

const cfg = () => ({
  summaries: process.env.MONGODB_AI_SUMMARIES_COLLECTION || 'kpi_weekly_summaries',
  chats: process.env.MONGODB_AI_CHATS_COLLECTION || 'kpi_ai_chats',
  scenario: process.env.JIRA_SYNC_SCENARIO || 'Baseline',
  // How much of the app's data a chat may carry, in characters. The model's
  // window is not documented; this keeps a conversation well inside a modest one.
  contextChars: Number(process.env.LOTUS_LLM_CONTEXT_CHARS || 60_000),
})

let colls = null
async function c() {
  const base = await connect()
  if (!base) return null
  if (!colls) {
    const db = base.s.db
    colls = { summaries: db.collection(cfg().summaries), chats: db.collection(cfg().chats) }
    await colls.chats.createIndex({ owner: 1, updatedAt: -1 })
  }
  return colls
}

const CATEGORY = Object.fromEntries(BLOCKER_CATEGORIES.map((x) => [x.id, x.label]))
const PRIORITY = Object.fromEntries(PRIORITIES.map((x) => [x.id, x.label]))
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)

/* ------------------------------------------------------------- writing */

const SAME_LANGUAGE = 'Write in the same language as the text you are given (Thai or English). Never translate.'

/*
 * HELP WITH ONE FIELD.
 *
 *   notes    rough notes → a clear, short update
 *   polish   fix the grammar and tighten, same meaning
 *   blocker  suggest what the blocker is waiting on, and whether it moves the deadline
 *
 * `field` says which box the text came from: 'focus' (the week's focus) or
 * 'blocker' (what is in the way of a task). `task` carries that task's title
 * and dates, for the blocker suggestion.
 */
export async function write({ kind, field, text, task } = {}) {
  const body = String(text || '').trim().slice(0, 3000)
  if (!body) return { status: 400, error: 'There is nothing written to work from yet.' }
  if (kind === 'notes' || kind === 'polish') {
    const what = field === 'blocker'
      ? 'what is blocking a task, and what is needed to unblock it'
      : 'what this person is focused on this week'
    const instruction = kind === 'notes'
      ? `Turn these rough notes into a clear, short update about ${what}, for a manager to read. Keep every fact and name; add nothing that is not in the notes. Plain sentences or a few short bullets, at most 80 words. No heading, no greeting, no preamble.`
      : `Fix the grammar and make this tighter and clearer, keeping exactly the same meaning and every fact. It is about ${what}. Return only the improved text, no preamble.`
    const out = await llm.chat([
      { role: 'system', content: `You help members of a finance technology team write their weekly check-in. ${SAME_LANGUAGE}` },
      { role: 'user', content: `${instruction}\n\n---\n${body}` },
    ], { temperature: 0.2, maxTokens: 400 })
    return { text: out.replace(/^["“]|["”]$/g, '').trim().slice(0, 2000) }
  }
  if (kind === 'blocker') {
    const out = await llm.chat([
      {
        role: 'system',
        content: 'You classify blockers in a weekly check-in. Answer with JSON only, no other text: '
          + '{"category": "business" | "it" | "data" | "other", "affects": true | false, "why": "one short sentence"}. '
          + '"business" = waiting on a business user; "it" = waiting on the IT team or a system change; "data" = missing or wrong data; '
          + `"other" = anything else. "affects" = whether this is likely to push the project's own deadline. Write "why" ${SAME_LANGUAGE.toLowerCase()}`,
      },
      {
        role: 'user',
        content: [
          task?.title && `Task: ${clip(task.title, 200)}`,
          task?.newDate && `New expected date: ${task.newDate}`,
          task?.projectDue && `Project due: ${task.projectDue}`,
          `Blocker: ${body}`,
        ].filter(Boolean).join('\n'),
      },
    ], { temperature: 0, maxTokens: 200 })
    const j = llm.jsonFrom(out)
    if (!j || !CATEGORY[j.category]) return { status: 502, error: 'The AI did not give a usable suggestion. Pick it yourself, or try again.' }
    return {
      category: j.category,
      affects: j.affects === true ? true : j.affects === false ? false : null,
      why: clip(j.why, 240),
    }
  }
  return { status: 400, error: 'Unknown kind of help.' }
}

/* --------------------------------------------------------- the summary */

/*
 * One week, as text for the model: who must submit, where each stands, their
 * focus, every task with its outcome, and the date proposals. Names, not ids.
 */
async function weekDigest(week, now = Date.now()) {
  const [settings, entries, roster, proposals] = await Promise.all([
    weekly.getSettings(), weekly.entriesFor(week), weekly.roster(), weekly.listProposals({ week, status: 'all' }),
  ])
  if ([settings, entries, roster, proposals].includes(UNAVAILABLE)) return UNAVAILABLE
  const nick = Object.fromEntries(roster.people.map((p) => [p.id, p.nick]))
  const project = Object.fromEntries(roster.projects.map((p) => [p.key, p]))
  const d = deadlines(week)
  const people = [...new Set([...settings.submitters, ...Object.keys(entries)])]
  const lines = [`WEEK OF ${weekLabel(week)} (plan due ${new Date(d.planDue).toISOString().slice(0, 16)}Z, report due ${new Date(d.reportDue).toISOString().slice(0, 16)}Z)`]
  for (const p of people) {
    const e = entries[p]
    const plan = STATUS_LABEL[stageStatus(e?.planSubmittedAt, d.planDue, now)]
    const report = STATUS_LABEL[stageStatus(e?.reportSubmittedAt, d.reportDue, now)]
    lines.push('', `PERSON: ${nick[p] || p}${settings.submitters.includes(p) ? '' : ' (not required to submit)'} — plan: ${plan}; report: ${report}`)
    if (!e) continue
    if (e.focus) lines.push(`  Focus: ${clip(e.focus, 600)}`)
    for (const t of e.tasks || []) {
      const pr = t.projectKey ? project[t.projectKey] : null
      const outcome = t.done === true ? 'FINISHED'
        : t.done === false
          ? `NOT FINISHED (${t.pct ?? '?'}% done, new date ${t.newDate || '?'}${t.blockerCategory ? `, waiting on: ${CATEGORY[t.blockerCategory]}` : ''}${t.blocker ? `, blocker: ${clip(t.blocker, 300)}` : ''}${t.affects === true ? ', member says it pushes the deadline' : ''})`
          : 'not reported yet'
      lines.push(`  - ${clip(t.title, 160)}${pr ? ` [${pr.key}: ${clip(pr.summary, 60)}, project due ${pr.due || 'none'}]` : ''}`
        + `${t.priority ? ` · ${PRIORITY[t.priority]}` : ''}${t.expected ? ` · expected ${t.expected}` : ''}${t.effort != null ? ` · ${t.effort} d` : ''}`
        + `${t.carriedFrom ? ` · carried over since week of ${t.carriedFrom}` : ''} → ${outcome}`)
    }
    for (const u of e.unplanned || []) lines.push(`  - unplanned: ${clip(u.title, 160)}${u.effort != null ? ` · ${u.effort} d` : ''}`)
  }
  const props = proposals.filter((x) => x.status !== 'withdrawn')
  if (props.length) {
    lines.push('', 'DATE CHANGE REQUESTS:')
    for (const x of props) {
      lines.push(`  - ${nick[x.person] || x.person} asks to move ${x.projectKey} from ${x.currentDue || 'no date'} to ${x.proposedDue || '(no date proposed)'} — ${x.status}${x.reason ? ` (reason: ${clip(x.reason, 200)})` : ''}`)
    }
  }
  return lines.join('\n')
}

const SUMMARY_PROMPT = `You write the weekly summary of a finance technology team's check-in for their manager.
Write in English, whatever language the members wrote in. Use only the data given; never invent.
Format, in Markdown, short and scannable:
**Headline** — one or two sentences on how the week stands.
### Focus
One bullet per person: their focus in a few words.
### Done and slipping
Bullets: what finished; what slipped, by how much, and why.
### Blockers and risks
Bullets: each blocker, who it is waiting on, and which project deadline it threatens. Say which are worth the manager's attention first.
### Date changes
Requests waiting for a decision. Omit the section if there are none.
### Missing
Who has not sent their plan or report. Omit if nobody.
At most 300 words.`

/** The moments a summary is written, and the window in which it may still be. */
export function summarySlot(ms) {
  const d = new Date(Number(ms) + 7 * 3600_000)
  const dow = d.getUTCDay()
  const hour = d.getUTCHours()
  if (dow === 1 && hour >= 8) return 'plan'
  if (dow === 5 && hour >= 15) return 'report'
  if (dow === 0 && hour >= 15) return 'second'
  return null
}
const TRIGGER_LABEL = { plan: 'after Monday’s 08:00 plan deadline', report: 'after Friday’s 15:00 report deadline', second: 'after Sunday’s 15:00 second chance' }

/*
 * WRITE THE SUMMARY FOR THIS MOMENT, ONCE.
 *
 * Named by week and deadline and claimed in the database before the model is
 * asked, like the emails, so a restart or a second server cannot write two.
 * A failure is kept with its reason and tried again on the next pass, up to
 * three times. Once written it is emailed to the administrators.
 */
export async function summaryTick(ms = Date.now()) {
  if (!llm.status().configured) return { skipped: 'the AI is not configured' }
  const trigger = summarySlot(ms)
  if (!trigger) return { skipped: 'no summary due' }
  const week = weekOf(ms)
  const k = await c()
  if (!k) return { skipped: 'database unavailable' }
  const _id = `${week}:${trigger}`
  const now = new Date().toISOString()
  try {
    await k.summaries.insertOne({ _id, week, trigger, status: 'writing', attempts: 1, at: now })
  } catch (e) {
    if (e.code !== 11000) throw e
    const retry = await k.summaries.updateOne(
      { _id, status: 'failed', attempts: { $lt: 3 } },
      { $set: { status: 'writing', at: now }, $inc: { attempts: 1 } },
    )
    if (!retry.modifiedCount) return { skipped: 'already written' }
  }
  try {
    const digest = await weekDigest(week, ms)
    if (digest === UNAVAILABLE) throw new Error('database unavailable')
    const text = await llm.chat([
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: digest },
    ], { temperature: 0.3, maxTokens: 900 })
    await k.summaries.updateOne({ _id }, { $set: { status: 'written', text, writtenAt: new Date().toISOString() } })
    await emailSummary({ _id, week, trigger, text })
    return { written: _id }
  } catch (e) {
    await k.summaries.updateOne({ _id }, { $set: { status: 'failed', error: String(e.message).slice(0, 400) } })
    return { failed: _id, error: e.message }
  }
}

async function emailSummary(s) {
  if (!mail.status().configured) return
  const accounts = await auth.listUsers()
  if (accounts === UNAVAILABLE) return
  const to = accounts.filter((a) => a.status === 'active' && a.role === 'admin').map((a) => a.email)
  if (!to.length) return
  // The Markdown, read as plain text in the plain part and lightly shaped in the HTML.
  const html = s.text.split('\n').map((line) => {
    const t = mail.esc(line).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    if (/^#{1,6}\s/.test(line)) return { html: `<b>${t.replace(/^#+\s*/, '')}</b>`, text: line.replace(/^#+\s*/, '').toUpperCase() }
    if (/^\s*[-*]\s/.test(line)) return { html: `&bull; ${t.replace(/^\s*[-*]\s/, '')}`, text: line }
    return line.trim() ? { html: t, text: line } : null
  }).filter(Boolean)
  const { html: body, text } = mail.layout({
    heading: `The week of ${weekLabel(s.week)}`,
    lines: [`Written by the AI ${TRIGGER_LABEL[s.trigger]}.`, ...html],
    button: { label: 'Open the team’s week', href: `${mail.appUrl()}/#weekly` },
    foot: 'An AI summary of what the team submitted. Check anything you act on against the week itself.',
  })
  await mail.sendOnce(`summary:${s._id}`, {
    to, kind: 'summary', subject: `Weekly summary: week of ${weekLabel(s.week)} (${s.trigger === 'plan' ? 'plans' : 'reports'})`, html: body, text,
  })
}

/** The summaries of one week, newest first. */
export async function summaries(week) {
  const k = await c()
  if (!k) return UNAVAILABLE
  return k.summaries.find({ week, status: 'written' }).sort({ writtenAt: -1 }).toArray()
}

/* --------------------------------------------------------- the chatbot */

const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Math.round(Number(v)).toLocaleString('en-US'))
const n1 = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : (Math.round(Number(v) * 10) / 10).toLocaleString('en-US'))

/*
 * EVERYTHING AN ADMINISTRATOR CAN SEE, as compact text: the year's totals and
 * money, each person, each project with its dates, drift and money, and the
 * last four weeks of check-ins. Cut to the allowance from the oldest week
 * backwards, so the register itself always fits.
 */
async function appDigest(now = Date.now()) {
  const doc = await store.getScenario(cfg().scenario)
  if (doc === store.UNAVAILABLE) return UNAVAILABLE
  if (!doc?.payload?.projects) return 'There is no shared plan yet.'
  const plan = computePlan(repairState(doc.payload))
  const { totals: t, finance: f } = plan
  const nick = Object.fromEntries(plan.people.map((p) => [p.id, p.nick]))
  const sym = f.currency || 'THB'
  const out = []
  out.push(`TODAY: ${new Date(now + 7 * 3600_000).toISOString().slice(0, 10)} (Bangkok). Money in ${sym}. Saving hours are per month.`)
  out.push(`TEAM: ${n0(t.totalHours)} saving hrs/month in the register vs target ${n0(t.target)} (${Math.round((t.totalCoverage || 0) * 100)}%); `
    + `committed ${n0(t.committedHours)}, stretch ${n0(t.stretchHours)}, watch ${n0(t.watchHours)}; delivered (Done) ${n0(t.doneHours)}; `
    + `FTE released ${n1(f.fteReleased)}; annual benefit ${n0(f.annualBenefit)} ${sym}; build cost ${n0(f.buildCost)}; capex ${n0(f.capex)}; `
    + `opex/yr ${n0(f.opexYear)}; ROI ${f.roi == null ? 'not computable (uncosted)' : `${n1(f.roi)}x`} vs gate ${n1(f.roiGate)}x; `
    + `payback ${f.paybackMonths == null ? '—' : `${n1(f.paybackMonths)} months`}; ${plan.quality.pastDue} of ${plan.quality.total} projects past due and not done.`)
  out.push('', 'PEOPLE (name · role · own saving hrs/month · projects · on-time share · projects drifted past their allowance):')
  for (const p of plan.people) {
    const dr = p.drift
    out.push(`- ${p.name} (${p.nick}) · ${p.role || ''} · ${n0(p.ownHours)} hrs · ${p.ownCount ?? p.projectCount} projects · `
      + `on time ${p.onTimeShare == null ? '—' : `${Math.round(p.onTimeShare * 100)}%`} · `
      + `${dr ? `${dr.drifted} of ${dr.held} drifted (team allows ${Math.round((dr.limit || 0) * 100)}%)` : 'drift —'}`)
  }
  out.push('', 'PROJECTS (key | Jira | name | PIC | status | commitment | saving hrs/mth | planned start→due | baseline due, re-plans | actual start→end | late by days | mandays | build cost | capex | opex/yr | annual benefit | ROI as a multiple | payback months):')
  for (const p of plan.projects.filter((x) => !x.deleted)) {
    const tl = p.timeline || {}
    out.push([
      p.key, p.jiraKey || '-', clip(p.summary, 70), nick[p.pic] || p.pic || '-', p.srcStatus || p.status || '-', p.commitLevel || '-',
      n0(p.savingHours), `${tl.plannedStart || '-'}→${tl.plannedEnd || '-'}`, `${p.baselineDue || '-'}, ${p.replanCount || 0}`,
      `${tl.actualStart || '-'}→${tl.actualEnd || (tl.running ? 'running' : '-')}`, tl.lateBy ?? '-', n1(p.manday),
      n0(p.buildCost), n0(p.capex), n0(p.opexYear), n0(p.annualBenefit), p.roi == null ? '-' : `${n1(p.roi)}x`,
      p.paybackMonths == null ? '-' : n1(p.paybackMonths),
    ].join(' | '))
  }
  const fixed = out.join('\n')
  const weeks = []
  for (let i = 0; i < 4; i++) {
    const w = addWeeks(weekOf(now), -i)
    const dg = await weekDigest(w, now)
    if (dg === UNAVAILABLE) break
    weeks.push(dg)
  }
  let room = cfg().contextChars - fixed.length - 200
  const kept = []
  for (const w of weeks) {
    if (w.length > room) break
    kept.push(w)
    room -= w.length
  }
  return `${fixed}\n\nWEEKLY CHECK-INS (newest first):\n\n${kept.join('\n\n') || '(none)'}`
}

const CHAT_PROMPT = (data) => `You are the assistant inside the F&A Tech team's KPI planning app, answering the team's manager.
Answer in the language of the question: Thai if asked in Thai, English if asked in English.
Answer only from the DATA below. If the answer is not in it, say so plainly — never guess or invent.
Be concise and specific: name projects by key and name, give numbers with units, give dates.
When asked for a judgement (who needs help, what is at risk), say what in the data supports it.

DATA
${data}`

const strip = ({ _id, ...rest }) => ({ id: _id, ...rest })

export async function listChats(owner) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const rows = await k.chats.find({ owner }, { projection: { messages: 0 } }).sort({ updatedAt: -1 }).limit(50).toArray()
  return rows.map(strip)
}

export async function getChat(owner, id) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const doc = await k.chats.findOne({ _id: id, owner })
  return doc ? strip(doc) : null
}

export async function deleteChat(owner, id) {
  const k = await c()
  if (!k) return UNAVAILABLE
  return { deleted: (await k.chats.deleteOne({ _id: id, owner })).deletedCount }
}

/*
 * ASK. A new conversation when there is no id. The question and the answer
 * are both kept; the model is given the app's data afresh every time, so an
 * answer is about the plan as it stands now, and the last twelve turns so a
 * follow-up ("and his late ones?") makes sense.
 */
export async function ask(owner, { chatId, message } = {}) {
  const q = String(message || '').trim().slice(0, 2000)
  if (!q) return { status: 400, error: 'Ask a question.' }
  const k = await c()
  if (!k) return UNAVAILABLE
  let chat = chatId ? await k.chats.findOne({ _id: chatId, owner }) : null
  if (chatId && !chat) return { status: 404, error: 'No such conversation.' }
  const data = await appDigest()
  if (data === UNAVAILABLE) return UNAVAILABLE
  const history = (chat?.messages || []).slice(-12).map((m) => ({ role: m.role, content: m.content }))
  const answer = await llm.chat([
    { role: 'system', content: CHAT_PROMPT(data) },
    ...history,
    { role: 'user', content: q },
  ], { temperature: 0.2, maxTokens: 1200 })
  const now = new Date().toISOString()
  const add = [{ role: 'user', content: q, at: now }, { role: 'assistant', content: answer, at: new Date().toISOString() }]
  if (!chat) {
    chat = {
      _id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      owner,
      title: clip(q, 80),
      messages: add,
      createdAt: now,
      updatedAt: now,
    }
    await k.chats.insertOne(chat)
  } else {
    await k.chats.updateOne({ _id: chat._id }, { $push: { messages: { $each: add } }, $set: { updatedAt: now } })
    chat = await k.chats.findOne({ _id: chat._id })
  }
  return { chat: strip(chat) }
}

/** Is the AI reachable with this key? One tiny request, for the Access tab. */
export async function test() {
  const t0 = Date.now()
  const out = await llm.chat([{ role: 'user', content: 'Reply with the single word: ok' }], { temperature: 0, maxTokens: 8 })
  return { reply: out.slice(0, 40), ms: Date.now() - t0 }
}
