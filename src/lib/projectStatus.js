import { projectOnHold, isHoldStatus } from './hold.js'

/*
 * A PROJECT'S STATUS, AS A PERSON SETS IT.
 *
 * Four choices: Not Start, In Progress, On Hold and Done — the register's own
 * words, plus on hold, which the register keeps as a flag beside the status
 * (so resuming puts back the status it had).
 *
 * Setting one clears `srcStatus`, the source workbook's wording ("Live",
 * "UAT"…), which is shown in preference to the status: a choice made here
 * would otherwise be hidden behind the old text. The Jira sync sets a status
 * only when it first adds a project, so a choice made here stays.
 *
 * Shared by the browser and the server, so both write the same thing.
 */

export const STATUS_CHOICES = ['Not Start', 'In Progress', 'On Hold', 'Done']

/** What the picker shows for a project now. */
export function statusChoice(p) {
  if (!p) return 'Not Start'
  if (projectOnHold(p)) return 'On Hold'
  if (p.status === 'Done') return 'Done'
  if (/progress/i.test(String(p.status || ''))) return 'In Progress'
  return 'Not Start'
}

/** On hold because Jira says so: only Jira can take it off hold. */
export const heldInJira = (p) => !!p && isHoldStatus(p.jiraStatus)

/** The fields a choice writes. `by` is who chose it, for an On Hold. */
export function statusPatch(choice, by = null, at = new Date().toISOString()) {
  if (!STATUS_CHOICES.includes(choice)) return null
  if (choice === 'On Hold') return { onHold: { at, by }, srcStatus: null }
  return { status: choice, onHold: null, srcStatus: null }
}
