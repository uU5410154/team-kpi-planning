/**
 * WHETHER AN UPDATE SAYS THE WORK IS ON HOLD.
 *
 * Read from what somebody wrote, in English or Thai, so that "this project is
 * hold" picks On hold for them; they see it picked and can pick otherwise.
 * "Not on hold any more", "resumed" and the like do not count.
 */
const EN = /\b(on[\s-]*hold|hold|put\s+(it\s+)?on\s+hold|paused|suspended|parked)\b/i
const TH = /(โฮลด์|โฮล|พักไว้|พักงาน|พักโปรเจ|ระงับ|หยุดชั่วคราว|ชะลอไว้)/
const NOT = /\b(not|no\s+longer|un-?)\s*(on\s*)?hold\b|\bresum(e|ed|ing)\b|\boff\s+hold\b|ไม่ได้โฮล|ไม่โฮล|กลับมาทำ/i

export const mentionsHold = (text) => {
  const s = String(text || '')
  if (!s.trim() || NOT.test(s)) return false
  return EN.test(s) || TH.test(s)
}

/** A Jira status, or the name of one, that means "on hold". */
export const isHoldStatus = (name) => /\b(on[\s-]*hold|hold|paused?|suspended|parked)\b/i.test(String(name || ''))

/**
 * A REGISTER PROJECT ON HOLD: its epic sits in a Hold status in Jira (as the
 * last sync or submit saw it), or its PIC put it on hold here when Jira had no
 * Hold status to move it to, or the register's own status says so.
 */
export const projectOnHold = (p) => !!p && (!!p.onHold || isHoldStatus(p.jiraStatus) || isHoldStatus(p.status) || isHoldStatus(p.srcStatus))
