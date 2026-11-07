/**
 * THE PROJECTS REGISTER'S COLUMNS, as an administrator can hide them.
 *
 * One list for the page and the server: the page draws the "Columns" menu
 * from it, and the server keeps only ids it names, so a bad client cannot
 * store something the page then chokes on.
 *
 * Not listed, so never hidden: the select box, the cost-sheet button and the
 * project's name. Without the name a row means nothing, and the cost sheet
 * is the only way into a project's CAPEX and monthly costs.
 */
export const PROJECT_COLUMNS = [
  { id: 'jiraKey', label: 'Jira' },
  { id: 'objective', label: 'Objective' },
  { id: 'pic', label: 'PIC' },
  { id: 'savingHours', label: 'Saving hrs/mth' },
  { id: 'cashBenefit', label: 'Cash benefit/yr' },
  { id: 'softBenefits', label: 'Soft benefits' },
  { id: 'fte', label: 'FTE' },
  { id: 'manday', label: 'Mandays' },
  { id: 'investment', label: 'Investment' },
  { id: 'roi', label: 'ROI' },
  { id: 'payback', label: 'Payback' },
  { id: 'commit', label: 'Commit' },
  { id: 'status', label: 'Status' },
  { id: 'delete', label: 'Delete' },
]

const KNOWN = new Set(PROJECT_COLUMNS.map((c) => c.id))

/**
 * The hidden columns as a client sent them, cut down to known ids, each once.
 * null when it is not a list at all.
 */
export function cleanHiddenColumns(list) {
  if (!Array.isArray(list)) return null
  const out = []
  for (const id of list.slice(0, 50)) {
    const s = String(id ?? '')
    if (KNOWN.has(s) && !out.includes(s)) out.push(s)
  }
  return out
}
