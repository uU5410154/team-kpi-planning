import * as weekly from './weekly.js'
import * as auth from './auth.js'
import * as mail from './mail.js'
import { UNAVAILABLE } from './db.js'
import { weekOf, weekLabel, weekNo, bangkokTime, deadlines } from '../src/lib/weekly.js'

/**
 * THE WEEKLY EMAILS.
 *
 * As agreed, all in Bangkok time, and with no exceptions for leave or
 * holidays:
 *
 *   Mon 07:00        heads-up: the plan is due at 08:00
 *   Mon 08:00–23:00  every hour, to anybody whose plan is not in
 *   Fri 10:00        heads-up: the report is due at 15:00
 *   Fri 15:00–23:00  every hour, to anybody whose report is not in
 *   Sun 15:00–23:00  every hour, the second chance, same
 *   23:00 Mon/Fri/Sun  the list of who is still missing, to the escalation list
 *
 * Plus, as they happen: a new date proposal to the administrators, and the
 * decision on it to the member who asked.
 *
 * Only the CURRENT hour is ever sent. A server that was down at 15:00 does
 * not, on waking at 17:40, send the 15:00 and 16:00 reminders as well — three
 * emails in a minute about one missing report reads as the app malfunctioning,
 * and the 17:00 one says everything they did.
 */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The Bangkok wall clock at `ms`: weekday 0–6 (Sunday 0), hour, and the date. */
export function bangkokClock(ms) {
  const d = new Date(Number(ms) + 7 * 3600_000)
  return { dow: d.getUTCDay(), hour: d.getUTCHours(), day: d.toISOString().slice(0, 10), name: DAY_NAMES[d.getUTCDay()] }
}

/*
 * WHAT IS DUE THIS HOUR — pure, so the calendar can be checked without a clock.
 *
 * `stage` is which half of the week it is about; `kind` is what sort of email.
 */
export function slotsAt(ms) {
  const { dow, hour } = bangkokClock(ms)
  const out = []
  if (dow === 1) {
    if (hour === 7) out.push({ kind: 'headsup', stage: 'plan' })
    if (hour >= 8) out.push({ kind: 'reminder', stage: 'plan' })
    if (hour === 23) out.push({ kind: 'digest', stage: 'plan' })
  }
  if (dow === 5) {
    if (hour === 10) out.push({ kind: 'headsup', stage: 'report' })
    if (hour >= 15) out.push({ kind: 'reminder', stage: 'report' })
    if (hour === 23) out.push({ kind: 'digest', stage: 'report' })
  }
  if (dow === 0) {
    if (hour >= 15) out.push({ kind: 'reminder', stage: 'report', second: true })
    if (hour === 23) out.push({ kind: 'digest', stage: 'report', second: true })
  }
  return out.map((s) => ({ ...s, week: weekOf(ms) }))
}

const isIn = (e, stage) => !!(stage === 'plan' ? e?.planSubmittedAt : e?.reportSubmittedAt)

/*
 * THE EMAILS FOR ONE MOMENT, built from what the database says — also pure.
 *
 *   ctx.submitters  who has to submit (person ids)
 *   ctx.entries     this week's entries, by person
 *   ctx.accounts    every account: { email, role, status, person }
 *   ctx.nick        person id → nickname
 *   ctx.escalation  addresses for the 23:00 list, or null for the administrators
 *
 * Each email comes with its name, which is what stops it going twice.
 */
export function emailsAt(ms, ctx) {
  const { day, hour } = bangkokClock(ms)
  const hh = String(hour).padStart(2, '0')
  const active = (ctx.accounts || []).filter((a) => a.status === 'active')
  const emailOf = Object.fromEntries(active.filter((a) => a.person).map((a) => [a.person, a.email]))
  const admins = active.filter((a) => a.role === 'admin').map((a) => a.email)
  const link = `${mail.appUrl()}/#weekly`
  const out = []

  for (const slot of slotsAt(ms)) {
    const d = deadlines(slot.week)
    const missing = (ctx.submitters || []).filter((p) => !isIn(ctx.entries?.[p], slot.stage))
    const what = slot.stage === 'plan' ? 'plan' : 'report'
    // "week 45, 2 Nov 2026": the number people say, and the date that pins it down.
    const wk = `${weekNo(slot.week)}, ${weekLabel(slot.week)}`

    if (slot.kind === 'digest') {
      if (!missing.length) continue
      const to = ctx.escalation && ctx.escalation.length ? ctx.escalation : admins
      const lines = missing.map((p) => `${ctx.nick?.[p] || p}${emailOf[p] ? '' : ' — no account linked, so not reminded'}`)
      const { html, text } = mail.layout({
        heading: `Still missing at 23:00: ${missing.length} ${what}${missing.length === 1 ? '' : 's'}`,
        lines: [
          `For week ${wk}, ${slot.second ? 'after the Sunday 15:00 second chance' : `due ${bangkokTime(slot.stage === 'plan' ? d.planDue : d.reportDue)}`}:`,
          { html: `<b>${lines.map(mail.esc).join('<br>')}</b>`, text: lines.map((l) => `  • ${l}`).join('\n') },
          slot.stage === 'plan'
            ? 'They were reminded every hour from 08:00.'
            : slot.second ? 'The week locks at 08:00 tomorrow and becomes the record.' : 'They get another chance until Sunday 15:00.',
        ],
        button: { label: 'Open the team’s week', href: link },
        foot: 'You get this because you are on the weekly check-in escalation list.',
      })
      out.push({
        id: `digest:${slot.stage}:${slot.week}:${day}`,
        kind: 'digest',
        to,
        subject: `Weekly check-in: ${missing.length} ${what}${missing.length === 1 ? '' : 's'} still missing (week ${wk})`,
        html,
        text,
        meta: { week: slot.week, stage: slot.stage, missing },
      })
      continue
    }

    for (const p of missing) {
      const to = emailOf[p]
      if (!to) continue
      const nick = ctx.nick?.[p] || p
      let heading
      let lines
      let subject
      let id
      if (slot.kind === 'headsup') {
        id = `headsup:${slot.stage}:${slot.week}:${p}`
        subject = slot.stage === 'plan'
          ? `Your plan for the week is due at 08:00 today`
          : `Your weekly report is due at 15:00 today`
        heading = slot.stage === 'plan' ? `Good morning, ${nick}` : `Hello ${nick}`
        lines = slot.stage === 'plan'
          ? [`Your plan for week ${wk} is due today at 08:00 Bangkok time: what you are focused on, and the tasks with their dates, effort and priority.`,
            'Last week’s unfinished tasks are already carried over for you.']
          : [`Your report for week ${wk} is due today at 15:00 Bangkok time: for each task, finished or not — and if not, what is blocking it and the new date.`]
      } else {
        id = `remind:${slot.stage}:${slot.week}:${day}T${hh}:${p}`
        subject = slot.stage === 'plan'
          ? `Reminder: your weekly plan is not in yet`
          : slot.second ? `Second chance: your weekly report is still missing` : `Reminder: your weekly report is not in yet`
        heading = slot.stage === 'plan' ? 'Your plan for the week is not in yet' : 'Your weekly report is not in yet'
        lines = [
          slot.stage === 'plan'
            ? `It was due at 08:00 today for week ${wk}.`
            : slot.second
              ? `The second chance for week ${wk} was 15:00 today. The week locks at 08:00 tomorrow.`
              : `It was due at 15:00 today for week ${wk}. Sunday 15:00 is the second chance.`,
          `You will get this every hour until 23:00, until it is in.`,
        ]
      }
      const { html, text } = mail.layout({
        heading,
        lines,
        button: { label: slot.stage === 'plan' ? 'Write my plan' : 'Report my week', href: link },
        foot: 'Sent by the F&A Tech KPI Planning app. Bangkok time.',
      })
      out.push({
        id, kind: slot.kind, to, subject, html, text, meta: { week: slot.week, stage: slot.stage, person: p },
      })
    }
  }
  return out
}

/** Everything `emailsAt` needs, read from the database. UNAVAILABLE if it is down. */
async function context(ms) {
  const week = weekOf(ms)
  const [settings, entries, accounts, roster] = await Promise.all([
    weekly.getSettings(), weekly.entriesFor(week), auth.listUsers(), weekly.roster(),
  ])
  if ([settings, entries, accounts, roster].includes(UNAVAILABLE)) return UNAVAILABLE
  return {
    settings,
    submitters: settings.submitters,
    entries,
    accounts,
    nick: Object.fromEntries(roster.people.map((p) => [p.id, p.nick])),
    escalation: settings.escalation,
  }
}

/*
 * ONE PASS: work out what is due this hour and send what has not gone yet.
 * Safe to call as often as anybody likes — the names in the mail log are what
 * make a second call send nothing.
 */
export async function tick(ms = Date.now()) {
  if (!mail.status().configured) return { skipped: 'email is not configured' }
  if (!slotsAt(ms).length) return { sent: 0, due: 0 }
  const ctx = await context(ms)
  if (ctx === UNAVAILABLE) return { skipped: 'database unavailable' }
  if (!ctx.settings.remindersOn) return { skipped: 'reminders are paused' }
  const due = emailsAt(ms, ctx)
  const results = []
  for (const e of due) {
    results.push({ id: e.id, result: await mail.sendOnce(e.id, e) })
  }
  return { due: due.length, sent: results.filter((r) => r.result === 'sent').length, results }
}

let timer = null
/** Once a minute, from the moment the server is up. */
export function startSchedule() {
  if (timer) return
  const run = () => {
    tick().catch((e) => console.warn(`[mail] reminder pass failed: ${e.message}`))
    // The AI's weekly summary, due at the same deadlines and independent of
    // email: it is written and kept even when nothing can be sent.
    import('./ai.js').then((ai) => ai.summaryTick()).catch((e) => console.warn(`[ai] summary pass failed: ${e.message}`))
  }
  timer = setInterval(run, 60_000)
  if (timer.unref) timer.unref()
  setTimeout(run, 5_000).unref?.()
  console.log(`[mail] weekly reminders armed — ${mail.status().configured ? `sending as ${mail.status().from}` : 'but email is not configured'}`)
}

/* ------------------------------------------------- as things happen */

const activeAccounts = async () => {
  const rows = await auth.listUsers()
  return rows === UNAVAILABLE ? [] : rows.filter((a) => a.status === 'active')
}

/** A slipped task asks to move its project: tell the administrators. */
export async function proposalsRaised(list, nickOf = {}) {
  if (!list?.length || !mail.status().configured) return
  const accounts = await activeAccounts()
  for (const p of list) {
    const asker = accounts.find((a) => a.person === p.person)?.email
    // Not the person who asked, if they are an administrator themselves.
    const to = accounts.filter((a) => a.role === 'admin' && a.email !== asker).map((a) => a.email)
    if (!to.length) continue
    const nick = nickOf[p.person] || p.person
    const { html, text } = mail.layout({
      heading: `${nick} asks to move ${p.projectKey}`,
      lines: [
        p.proposedDue
          ? `From ${p.currentDue || 'no date'} to ${p.proposedDue}${p.byDate ? ` — ${p.byDate} days later` : ''}, because “${p.taskTitle}” now lands ${p.newDate}.`
          : `${nick} says the deadline (${p.currentDue}) moves, though “${p.taskTitle}” now lands ${p.newDate}, inside it. You pick the new date.`,
        p.blocker ? `In the way: ${p.blocker}` : null,
        p.disagree ? 'The dates and the member disagree on whether the deadline moves.' : null,
      ].filter(Boolean),
      button: { label: 'Decide', href: `${mail.appUrl()}/#weekly` },
      foot: 'Approving moves the project’s due date here and in Jira. It counts as a re-plan.',
    })
    await mail.sendOnce(`proposal:${p._id || p.id}:${p.createdAt}`, {
      to, kind: 'proposal', subject: `Date change: ${nick} asks to move ${p.projectKey}`, html, text, meta: { proposal: p._id || p.id },
    })
  }
}

/** A decision was made: tell the member who asked, with the reason if it was no. */
export async function decided(p) {
  if (!p || !mail.status().configured) return
  const accounts = await activeAccounts()
  const to = accounts.find((a) => a.person === p.person)?.email
  if (!to || to === p.decidedBy) return
  const ok = p.status === 'approved'
  const { html, text } = mail.layout({
    heading: ok ? `${p.projectKey} now runs to ${p.decidedDue}` : `${p.projectKey} stays due ${p.currentDue}`,
    lines: ok
      ? [`${p.decidedBy} approved moving it from ${p.fromDue || 'no date'} to ${p.decidedDue}, for “${p.taskTitle}”.`,
        p.jira?.written ? `The epic ${p.jira.key} has the new date in Jira too.` : null].filter(Boolean)
      : [`${p.decidedBy} did not approve moving it to ${p.proposedDue || p.newDate}, for “${p.taskTitle}”.`, `Why: ${p.reason}`],
    button: { label: 'Open my week', href: `${mail.appUrl()}/#weekly` },
  })
  await mail.sendOnce(`decision:${p._id || p.id}:${p.decidedAt}`, {
    to, kind: 'decision', subject: ok ? `Approved: ${p.projectKey} moves to ${p.decidedDue}` : `Not approved: ${p.projectKey} keeps its date`,
    html, text, meta: { proposal: p._id || p.id },
  })
}

/** A test email to whoever asked, so delivery can be checked before Monday. */
export async function test(to) {
  const { html, text } = mail.layout({
    heading: 'This is a test',
    lines: [
      'If you are reading this in your work inbox, the weekly reminders will reach it too.',
      'If it landed in junk, mark it as not junk so Monday’s reminders do not.',
    ],
    button: { label: 'Open the app', href: mail.appUrl() },
  })
  return mail.sendOnce(`test:${to}:${Date.now()}`, { to, kind: 'test', subject: 'Test email from F&A KPI Planning', html, text })
}
