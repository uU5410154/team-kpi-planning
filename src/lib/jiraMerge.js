import { newProject } from './model.js'

/**
 * Fold what Jira knows into a plan.
 *
 * ONE implementation, used by the Sync button in the browser and by the
 * scheduled job on the server. Two copies of a merge rule is how a nightly job
 * and a person clicking a button end up disagreeing about the register, and
 * the disagreement is always found weeks later.
 *
 * Three things happen here and nothing else:
 *
 *   1. every project with a Jira key has its ACTUAL dates refreshed;
 *   2. and its NAME, because the ticket is where that is decided — an epic
 *      renamed in Jira left the register showing a title nobody uses;
 *   3. every epic on the board that the register has never seen is added.
 *
 * The plan, the saving hours, the effort, the objective and the owner are the
 * register's own and are never restated from Jira. The one exception is an
 * epic arriving for the first time, which has no plan here to overwrite.
 *
 * Nothing is ever DELETED from here. A ticket removed in Jira is reported as
 * missing and left alone: the row may carry saving hours, effort and a place
 * in somebody's KPI, none of which live in Jira, and none of which should
 * vanish because a ticket was tidied up.
 */
export const JIRA_KEY = /^[A-Za-z][A-Za-z0-9_]+-\d+$/

/** A Jira epic, as a project the register can hold. */
export function projectFromEpic(epic, seq) {
  return {
    ...newProject(seq),
    jiraKey: epic.key,
    summary: epic.summary || epic.key,
    /*
     * Jira's dates ARE the plan for a project the register is meeting for the
     * first time — there is no earlier commitment for them to overwrite. It is
     * the only moment that is true, which is why refreshing an existing row
     * never touches its plan.
     */
    start: epic.start || null,
    due: epic.due || null,
    // Its first committed date, so a later move is measured from here.
    baselineDue: epic.due || null,
    actualStart: epic.start || epic.created || null,
    actualEnd: epic.done ? (epic.resolved || null) : null,
    status: epic.done ? 'Done' : (/progress/i.test(epic.status || '') ? 'In Progress' : 'Not Start'),
    /*
     * WATCH. An epic somebody raised in Jira has not been costed, sized or
     * agreed as part of this team's year, and letting it into the committed
     * total on arrival would move the KPI by accident. A person promotes it.
     */
    commitLevel: 'watch',
    comment: [
      epic.assignee ? `Jira assignee: ${epic.assignee}` : null,
      `Added automatically from ${epic.key}.`,
    ].filter(Boolean).join('\n'),
  }
}

/**
 * @param {object} state    the stored plan
 * @param {object} data     { issues, epics } as the Jira endpoints return them
 * @param {object} opts     { addNew: boolean }
 * @returns {{ projects, updated, added, fromCreated, unchanged, addedKeys }}
 */
export function mergeJira(state, { issues = [], epics = [] } = {}, { addNew = true } = {}) {
  const byKey = new Map(issues.map((i) => [String(i.key).toUpperCase(), i]))

  let updated = 0
  let fromCreated = 0
  const renamed = []
  const projects = (state.projects || []).map((p) => {
    const issue = byKey.get(String(p.jiraKey || '').trim().toUpperCase())
    if (!issue) return p
    if (issue.startSource === 'created') fromCreated += 1

    const patch = {}
    const actualStart = issue.start || issue.created || null
    // Not done in Jira means not finished here either: a ticket reopened after
    // being resolved has to be able to take its finish back.
    const actualEnd = issue.done ? (issue.resolved || null) : null
    if (actualStart !== (p.actualStart || null)) patch.actualStart = actualStart
    if (actualEnd !== (p.actualEnd || null)) patch.actualEnd = actualEnd

    /*
     * The name follows the ticket. What a piece of work is called is settled
     * in Jira — it gets renamed there as scope becomes clear — and a register
     * still showing the old title is a register people stop trusting.
     */
    const title = String(issue.summary || '').trim()
    if (title && title !== String(p.summary || '').trim()) {
      patch.summary = title
      renamed.push({ key: issue.key, from: p.summary, to: title })
    }

    if (!Object.keys(patch).length) return p
    updated += 1
    return { ...p, ...patch }
  })

  const addedKeys = []
  if (addNew && epics.length) {
    const have = new Set(projects
      .map((p) => String(p.jiraKey || '').trim().toUpperCase())
      .filter(Boolean))
    let seq = projects.filter((p) => String(p.key).startsWith('NEW-')).length
    const taken = new Set(projects.map((p) => p.key))
    const fresh = []
    for (const epic of epics) {
      const key = String(epic.key || '').toUpperCase()
      if (!key || have.has(key)) continue
      have.add(key)
      let made = projectFromEpic(epic, ++seq)
      while (taken.has(made.key)) made = projectFromEpic(epic, ++seq)
      taken.add(made.key)
      fresh.push(made)
      addedKeys.push(key)
    }
    // Newest at the top, where the register puts anything new.
    if (fresh.length) projects.unshift(...fresh)
  }

  return {
    projects,
    updated,
    added: addedKeys.length,
    addedKeys,
    renamed: renamed.length,
    renames: renamed.slice(0, 20),
    fromCreated,
    unchanged: updated === 0 && addedKeys.length === 0,
  }
}
