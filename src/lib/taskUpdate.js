/**
 * ONE JIRA TASK'S WEEKLY UPDATE, ON THE MEMBER'S PAGE: when it still needs
 * doing, what is missing from it, and the unsent draft kept in this browser.
 *
 * Plain functions, so the page (components/JiraWeek.jsx), the Next step bar
 * (pages/Weekly.jsx) and the checks all agree.
 */

/** What Jira said when the update was posted: 'posted', 'failed', 'off', 'pending'. */
export const jiraState = (u) => u?.jira?.state || null

/**
 * An update kept here but NOT posted to Jira, when Jira takes writes: still
 * to do, with a Retry. (With writes switched off on the server nothing can
 * reach Jira, so the update kept here is all there is, and it counts.)
 */
export const failedPost = (u, writable = true) => !!u && !!writable && jiraState(u) !== 'posted'

/** Does this task still need its update this week? */
export const needsUpdate = (t, writable = true) => !t?.update || failedPost(t.update, writable)

/** The part of a posted update Jira did not take: description, Done, Hold. */
export function partialPost(u) {
  const j = u?.jira
  if (!j || j.state !== 'posted') return []
  const out = []
  const cut = (s, lead) => String(s).replace(lead, '')
  if (String(j.description || '').startsWith('not updated')) out.push(`the description was not updated — ${cut(j.description, /^not updated:\s*/)}`)
  if (String(j.done || '').startsWith('not moved')) out.push(`it was not moved to Done — ${cut(j.done, /^not moved:\s*/)}`)
  if (String(j.hold || '').startsWith('not moved')) out.push(`it was not put on hold — ${cut(j.hold, /^not moved:\s*/)}`)
  return out
}

/** The one-line confirmation after a post: "Posted to FNP-1 in Jira — comment, description, Done". */
export function postedSummary(key, j) {
  const parts = ['comment']
  if (j?.attachments?.length) parts.push(`${j.attachments.length} picture${j.attachments.length === 1 ? '' : 's'}`)
  if (j?.description === 'updated') parts.push(j.descriptionReplaced ? "today's description entry replaced" : 'description')
  if (j?.done && !String(j.done).startsWith('not moved')) parts.push(j.done)
  if (j?.hold && !String(j.hold).startsWith('not moved')) parts.push(j.hold)
  return `Posted to ${key} in Jira — ${parts.join(', ')}`
}

/*
 * WHAT IS MISSING, by field, checked here before anything is sent so the
 * member sees it at once beside the box it is about. The server checks the
 * same again and is the one that counts.
 */
export function updateProblems({
  progress, done, hold, reason, decision, decisionText,
}) {
  const p = {}
  if (!String(progress || '').trim()) p.progress = 'Write what happened on it this week.'
  if (done === null || done === undefined) p.status = 'Pick Finished, Not finished or On hold.'
  if (done === false && !hold && !String(reason || '').trim()) p.reason = 'Say why it is not finished.'
  if (decision && !String(decisionText || '').trim()) p.decisionText = 'Say what decision is needed, and from whom.'
  return p
}

/* ------------------------------------------------------------ drafts */

/*
 * AN UNSENT DRAFT survives a week switch, a page switch and a reload: kept in
 * this browser per person, week and Jira task, and cleared once it is
 * submitted. Pictures are not kept — too big for local storage. Storage that
 * is full or switched off simply keeps nothing.
 */
const DRAFT_PREFIX = 'kpi-jira-draft'
export const DRAFT_FIELDS = ['progress', 'done', 'hold', 'holdAuto', 'picked', 'reason', 'blocker', 'decision', 'decisionText']
export const draftKey = (person, week, key) => `${DRAFT_PREFIX}:${person || '-'}:${week}:${key}`

export function readDraft(person, week, key, base = null) {
  try {
    const raw = window.localStorage.getItem(draftKey(person, week, key))
    if (!raw) return null
    const d = JSON.parse(raw)
    // Typed over an update that has since changed (submitted from another
    // browser): the newer update wins, the stale draft goes.
    if ((d.base || null) !== (base || null)) {
      window.localStorage.removeItem(draftKey(person, week, key))
      return null
    }
    return d
  } catch {
    return null
  }
}

export function writeDraft(person, week, key, base, fields) {
  try {
    const d = { base: base || null, savedAt: new Date().toISOString() }
    for (const f of DRAFT_FIELDS) d[f] = fields[f]
    window.localStorage.setItem(draftKey(person, week, key), JSON.stringify(d))
  } catch { /* storage full or off: nothing kept */ }
}

export function clearDraft(person, week, key) {
  try { window.localStorage.removeItem(draftKey(person, week, key)) } catch { /* nothing to clear */ }
}

/** The Jira keys with an unsent draft for this person, in weeks from `fromWeek` on. */
export function unsentDrafts(person, fromWeek = '') {
  const out = []
  try {
    const lead = `${DRAFT_PREFIX}:${person || '-'}:`
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (!k || !k.startsWith(lead)) continue
      const [week, key] = k.slice(lead.length).split(':')
      if (week >= fromWeek) out.push({ week, key })
    }
  } catch { /* storage off: nothing kept, nothing to warn about */ }
  return out
}

/** The card's fields as the last update (or nothing) left them. */
export const baseFields = (u) => ({
  progress: u?.progress || '',
  done: u ? u.done : null,
  hold: !!u?.hold,
  reason: u?.reason || '',
  blocker: u?.blocker || '',
  decision: !!u?.decision,
  decisionText: u?.decisionText || '',
})

/** Has the member typed or picked anything the last update does not say? */
export function differs(fields, u) {
  const b = baseFields(u)
  return Object.keys(b).some((k) => (fields[k] ?? b[k]) !== b[k])
}
