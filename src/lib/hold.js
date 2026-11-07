/**
 * WHETHER AN UPDATE SAYS THE WORK IS ON HOLD.
 *
 * Read from what somebody wrote, in English or Thai, so that "this project is
 * hold" picks On hold for them; they see it picked and can pick otherwise.
 * "Not on hold any more", "resumed" and the like do not count.
 *
 * Only the word used as a STATUS counts — "on hold", "is hold", "put it on
 * hold", "holding it for now", "hold until…", "paused" — never the verb or a
 * longer word: "hold a review session", "the threshold", "household",
 * "account holder", "holding company". A bare "hold" moved Jira items on hold
 * that were nothing of the kind (QA, 2026-11-07).
 */

// Who or what is put on hold, when it is the work itself.
const SELF = '(?:it|this|that|everything|all(?:\\s+of\\s+it)?|(?:the|this|that|our|my)\\s+(?:whole\\s+)?(?:project|task|work|epic|item|ticket|one))'
// "put the threshold logic on hold" is about a part of it, not the work.
const PUT_OTHER = /\b(?:put|puts|putting|placed?|placing|kept|keeps?|keeping)\s+((?:[^\s.;:!?,]+\s+){1,5}?)on[\s-]*hold\b/gi
const SELF_ONLY = new RegExp(`^${SELF}\\s+$`, 'i')

const EN = [
  /\bon[\s-]*hold\b/i,
  /\bon\s+pause\b/i,
  // "this project is hold", "was hold last week"
  /\b(?:is|are|was|were|be|been|being|stays?|stayed|remains?|remained|still|now)\s+hold\b/i,
  // "hold it for now", "holding the project", "hold off until…"
  new RegExp(`\\bhold(?:ing)?\\s+(?:${SELF}|off\\b|for\\s+now\\b|until\\b|till\\b|pending\\b)`, 'i'),
  // "Hold." "Hold — waiting for the budget", at the start of a line or sentence
  /(?:^|[.;:!?\n(])\s*hold\s*(?:$|[.;:!?,\n)\-–—])/i,
  // "status: hold", "status is on hold"
  /\bstatus\s*(?:is\s*)?[:=\-–—]?\s*hold\b/i,
  /\b(?:paused|pausing|suspended|parked)\b/i,
  // English in a Thai sentence: "งานนี้ hold ไว้ก่อน"
  /\bhold\s*(?:ไว้|ก่อน)/i,
]
// "โฮลดิ้ง" is a holding company, not a hold.
const TH = /(โฮลด์(?!ดิ้ง)|โฮล(?!ดิ้ง|ดิง)|พักไว้|พักงาน|พักโปรเจ|ระงับ|หยุดชั่วคราว|หยุดไว้ก่อน|ชะลอไว้|แขวนไว้)/
const NOT = /\b(not|no\s+longer|un-?)\s*(on\s*)?hold\b|\bresum(e|ed|ing)\b|\boff\s+hold\b|\bunpaused\b|ไม่ได้โฮล|ไม่โฮล|กลับมาทำ/i

export const mentionsHold = (text) => {
  const raw = String(text || '')
  if (!raw.trim() || NOT.test(raw)) return false
  // A part of the work put on hold is not the work on hold: taken out first.
  const s = raw.replace(PUT_OTHER, (m, what) => (SELF_ONLY.test(what) ? m : ' '))
  return EN.some((re) => re.test(s)) || TH.test(s)
}

/** A Jira status, or the name of one, that means "on hold". */
export const isHoldStatus = (name) => /\b(on[\s-]*hold|hold|paused?|suspended|parked)\b/i.test(String(name || ''))

/**
 * A REGISTER PROJECT ON HOLD: its epic sits in a Hold status in Jira (as the
 * last sync or submit saw it), or its PIC put it on hold here when Jira had no
 * Hold status to move it to, or the register's own status says so.
 */
export const projectOnHold = (p) => !!p && (!!p.onHold || isHoldStatus(p.jiraStatus) || isHoldStatus(p.status) || isHoldStatus(p.srcStatus))
