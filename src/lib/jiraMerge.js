import { newProject, replanPatch, reassignPatch, personForJiraName } from './model.js'

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
 *   2. and its PLANNED dates — start and committed finish — because the board
 *      is where they are maintained: this server cannot write to Jira, so a
 *      date changed there is the only date anybody actually changed. A moved
 *      commitment is recorded as a re-plan, the same as one typed in the app;
 *   3. and its NAME, because the ticket is where that is decided — an epic
 *      renamed in Jira left the register showing a title nobody uses;
 *   4. every epic on the board that the register has never seen is added.
 *
 * The saving hours, the effort, the objective and the owner are the register's
 * own and are never restated from Jira — none of them exists there. Nor is a
 * finish date a project has been told to hold: see actualEndPinned below.
 *
 * Nothing is ever DELETED from here. A ticket removed in Jira is reported as
 * missing and left alone: the row may carry saving hours, effort and a place
 * in somebody's KPI, none of which live in Jira, and none of which should
 * vanish because a ticket was tidied up.
 */
export const JIRA_KEY = /^[A-Za-z][A-Za-z0-9_]+-\d+$/

/** A Jira epic, as a project the register can hold. */
export function projectFromEpic(epic, seq, people = []) {
  return {
    ...newProject(seq),
    jiraKey: epic.key,
    summary: epic.summary || epic.key,
    /*
     * On whoever holds the ticket, where the roster knows the name. It arrives
     * as WATCH and counts toward nothing either way, but arriving on the right
     * person's list is the difference between somebody seeing it and nobody
     * seeing it.
     */
    pic: personForJiraName(people, epic.assignee),
    /*
     * Jira's dates ARE the plan for a project the register is meeting for the
     * first time — there is no earlier commitment for them to overwrite. It is
     * the only moment at which no re-plan needs recording, which is why the
     * refresh below routes a moved date through replanPatch and this does not.
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
  // The roster, for turning a Jira display name into somebody on this plan.
  const people = Array.isArray(state?.people) ? state.people : []
  const byKey = new Map(issues.map((i) => [String(i.key).toUpperCase(), i]))
  const under = (key) => rollups[String(key || '').toUpperCase()] || null

  let updated = 0
  // How many projects held their own finish date through this sync. Reported
  // so a morning run says what it did NOT do as well as what it did.
  let pinned = 0
  // Commitments the board moved. Reported by name: a date that changed under
  // somebody's objective is the last thing that should arrive as a number.
  const replanned = []
  // Projects that changed hands. Reported by name: a project moving between
  // two people's objectives is the last thing that should arrive as a number.
  const reassigned = []
  // Where the board and the register name different people. Reported so it can
  // be settled by somebody, and never settled by this.
  const disagreed = []
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
     * A fact about when the work is scheduled to begin, maintained on the
     * board, and the register's
     * copy had drifted badly: twenty-three rows had the day and month
     * transposed by an old spreadsheet import, which is why so many projects
     * appeared to begin in January.
     *
     * Only ever written when Jira HAS one. A blank in Jira is an absence of
     * information, not an instruction to delete what the register knows.
     */
    if (issue.start && issue.start !== (p.start || null)) patch.start = issue.start

    /*
     * AND SO DOES THE COMMITTED FINISH.
     *
     * This one was deliberately left alone for a long time, because the due
     * date is the commitment objective 1 is measured against and a sync that
     * quietly rewrites it would be marking its own homework. What settled it
     * is that the register cannot write to Jira — JIRA_ALLOW_WRITES is off on
     * this server — so the board is where these dates are actually maintained,
     * and twenty-nine of them had drifted apart. A project due in November on
     * the board and in July in the register is not a commitment anybody is
     * managing to; it is two systems disagreeing.
     *
     * Recorded as a RE-PLAN, not as a silent overwrite: the first move
     * re-baselines free — that is everybody's one re-plan after requirement
     * gathering — and every move after it counts as drift, exactly as it would
     * had somebody typed the new date here. replanPatch is the same door the
     * timeline editor uses, so a date moved on the board and a date moved in
     * the app are accounted for identically.
     *
     * The epic's OWN due date, never a sprint's: sprints belong to the tasks
     * underneath and a project does not finish because a fortnight ended.
     * Only ever written when Jira has one — a blank there is an absence of
     * information, not an instruction to drop the commitment.
     */
    /*
     * THE EPIC'S OWN DATE, OR THE SPRINT IT IS IN.
     *
     * An epic scheduled into a sprint has been committed to a fortnight even
     * where nobody filled in the due date field, and that sprint's end IS the
     * date it is expected by. It stands in only where the due date is missing:
     * a dated epic has been committed to deliberately, and a sprint it happens
     * to sit in does not overrule that.
     *
     * Where the epic is in no sprint either, the sprints the work UNDER it is
     * booked into answer for it: FNP-1691 carries no due date and no sprint,
     * and its last task sits in Sprint 11 Week 1, which ends on 13 September.
     * That is a scheduled date somebody set, not an inference.
     *
     * NOT the latest DUE DATE on those tasks. That was tried and taken back: a
     * deadline typed on a task is not a commitment made for the project, and
     * rolling those up moved six live commitments on the strength of undated
     * tickets. A sprint is a fortnight the work is actually booked into.
     */
    const jiraDue = issue.due || issue.sprintEnd || tasks?.latestSprintEnd || null
    if (jiraDue && jiraDue !== (p.due || null)) {
      Object.assign(patch, replanPatch(p, jiraDue))
      replanned.push({
        key: issue.key,
        from: p.due || null,
        to: jiraDue,
        fromSprint: !issue.due,
        // Which sprint answered for it: the epic's own, or the work under it.
        fromTaskSprint: !issue.due && !issue.sprintEnd,
      })
    }

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

    /*
     * AND WHO RUNS IT.
     *
     * Jira says "Nakittapon Imjaijaroenying" and the register says "Pol", and
     * for as long as those were kept apart by nothing but an unfetched field,
     * a project reassigned on the board stayed on the wrong person's objective
     * here. The PIC is who objective 1 measures, so it follows the ticket.
     *
     * Only where the name is one the roster CLAIMS. An unrecognised assignee
     * leaves the PIC exactly as it is — a guess at who somebody is would put a
     * project on the wrong person's KPI, which is worse than not knowing. And
     * an unassigned ticket says nothing at all: a blank in Jira is an absence
     * of information, never an instruction to clear the register, the same
     * rule the dates already follow.
     *
     * Through reassignPatch, the same door the Projects tab uses, so the
     * credited share moves with the ownership instead of being left behind on
     * whoever used to hold it.
     */
    const owner = personForJiraName(people, issue.assignee)
    /*
     * ONLY WHERE THE REGISTER HAS NOBODY.
     *
     * A sync that overrides an existing PIC moves a project between two
     * people's objectives on the strength of whoever a ticket happens to be
     * assigned to — and a Jira assignee is often the person doing the current
     * task, not the person accountable for the project. Where the register
     * already names somebody, that stands: it was decided by a person, and
     * disagreeing with the board is not the same as being wrong.
     *
     * Filling a blank is different. That is not overruling anybody.
     */
    if (owner && !p.pic) {
      Object.assign(patch, reassignPatch(p, owner))
      reassigned.push({ key: issue.key, from: null, to: owner, name: issue.assignee })
    } else if (owner && owner !== p.pic) {
      // Worth reporting, never worth applying: the two systems disagree about
      // who runs this, and somebody should decide which is right.
      disagreed.push({ key: issue.key, register: p.pic, jira: owner, name: issue.assignee })
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
      let made = projectFromEpic(epic, ++seq, people)
      while (taken.has(made.key)) made = projectFromEpic(epic, ++seq, people)
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
    replanned: replanned.length,
    replans: replanned.slice(0, 20),
    reassigned: reassigned.length,
    reassignments: reassigned.slice(0, 20),
    picDisagreements: disagreed.length,
    picConflicts: disagreed.slice(0, 20),
    added: addedKeys.length,
    addedKeys,
    renamed: renamed.length,
    renames: renamed.slice(0, 20),
    fromCreated,
    unchanged: updated === 0 && addedKeys.length === 0,
  }
}
