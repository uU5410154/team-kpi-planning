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
    /*
     * The same rule the refresh applies: a start date is a plan, not an event.
     * An epic arriving from the backlog has not begun, whatever date it
     * carries — and an add path that disagreed with the refresh path would
     * flip the row back and forth on every sync.
     */
    actualStart: epic.started ? (epic.start || epic.created || null) : null,
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
export function mergeJira(state, { issues = [], epics = [], rollups = {} } = {}, { addNew = true } = {}) {
  const byKey = new Map(issues.map((i) => [String(i.key).toUpperCase(), i]))
  const under = (key) => rollups[String(key || '').toUpperCase()] || null

  let updated = 0
  // How many projects held their own finish date through this sync. Reported
  // so a morning run says what it did NOT do as well as what it did.
  let pinned = 0
  let fromCreated = 0
  const renamed = []
  const projects = (state.projects || []).map((p) => {
    const issue = byKey.get(String(p.jiraKey || '').trim().toUpperCase())
    if (!issue) return p
    if (issue.startSource === 'created') fromCreated += 1

    const patch = {}
    const tasks = under(issue.key)

    /*
     * NOTHING HAS ACTUALLY STARTED UNTIL SOMETHING IS IN FLIGHT.
     *
     * A start date is a plan, not an event: a Backlog task can carry one for a
     * sprint three weeks away, and a creation date only records that somebody
     * typed the ticket. Drawing an actual bar from either claimed work had
     * begun on projects nobody had touched.
     *
     * A project has begun when its epic is in flight or finished, OR when any
     * task under it has — an epic can sit in Selected for Development while
     * the first task is already being worked.
     */
    const begun = issue.started || !!tasks?.anyStarted
    const actualStart = begun ? (issue.start || issue.created || null) : null

    /*
     * A PROJECT IS FINISHED WHEN THE LAST THING UNDER IT IS.
     *
     * An epic can be dragged to Done while tasks are still open, and the
     * finish that matters is the last task's resolution date, not the moment
     * somebody moved a card. So where an epic has tasks, its finish is the
     * latest one they resolved, and only once every one of them is resolved.
     * An epic with no tasks has nothing to wait for and answers for itself.
     */
    const actualEnd = tasks && tasks.total > 0
      ? (tasks.allDone ? (tasks.latestResolved || issue.resolved || null) : null)
      : (issue.done ? (issue.resolved || null) : null)

    /*
     * THE ADJUSTED DATE, and it takes TWO things to move it.
     *
     * A task must run past the project's committed date, AND be labelled as
     * somebody else's delay — "it-delay" — for the adjustment to be drawn. A
     * task simply overrunning is this team's own slippage, and drawing that as
     * an adjustment would turn every overrun into somebody else's fault, which
     * is the one thing this bar must not become.
     *
     * Recorded beside the commitment, never instead of it: the plan stays as
     * agreed, and the delay is visible as a delay.
     */
    const delayDue = tasks?.latestDelayDue || null
    const adjustedDue = delayDue && p.due && delayDue > p.due ? delayDue : null

    /*
     * THE PLANNED START FOLLOWS JIRA.
     *
     * Not the due date — that is the commitment, and moving it is a re-plan
     * somebody has to own. The START is a fact about when the work is
     * scheduled to begin, Jira is where it is maintained, and the register's
     * copy had drifted badly: twenty-three rows had the day and month
     * transposed by an old spreadsheet import, which is why so many projects
     * appeared to begin in January.
     *
     * Only ever written when Jira HAS one. A blank in Jira is an absence of
     * information, not an instruction to delete what the register knows.
     */
    if (issue.start && issue.start !== (p.start || null)) patch.start = issue.start

    if (actualStart !== (p.actualStart || null)) patch.actualStart = actualStart
    /*
     * A HELD FINISH DATE IS NOT SYNCED.
     *
     * Jira's resolution date is when the last card was dragged, which on the
     * projects marked here is months after the work actually landed — and Jira
     * will not let it be corrected. Writing it back every morning would put
     * the drift straight back on somebody's objective, so where a person has
     * deliberately held this one field, the sync leaves it alone and touches
     * everything else about the project as usual.
     *
     * Deliberate, per project, and never inferred: a project is only held
     * because somebody said so.
     */
    if (p.actualEndPinned === true) {
      pinned += 1
    } else if (actualEnd !== (p.actualEnd || null)) {
      patch.actualEnd = actualEnd
    }
    if (adjustedDue !== (p.adjustedDue || null)) patch.adjustedDue = adjustedDue
    if (tasks) {
      if ((tasks.total || 0) !== (p.tasksTotal || 0)) patch.tasksTotal = tasks.total || 0
      if ((tasks.done || 0) !== (p.tasksDone || 0)) patch.tasksDone = tasks.done || 0
      /*
       * Which task claimed the delay, so a reader can go and check it.
       * NOT `adjustedBy` — the timeline already uses that name for the number
       * of days, and two meanings on one name is how a chart ends up drawing
       * a ticket key as a length.
       */
      const cause = adjustedDue ? (tasks.delayKey || null) : null
      if (cause !== (p.adjustedCause || null)) patch.adjustedCause = cause
    }

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
    // Projects whose finish date this sync deliberately left alone.
    pinned,
    added: addedKeys.length,
    addedKeys,
    renamed: renamed.length,
    renames: renamed.slice(0, 20),
    fromCreated,
    unchanged: updated === 0 && addedKeys.length === 0,
  }
}
