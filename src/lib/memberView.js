import { isInPlan, timelinessOf } from './model.js'

/*
 * WHAT A TEAM MEMBER IS SHOWN OF THE PLAN: their own.
 *
 * The projects they hold — as PIC, or named among the contributors — and
 * their own scorecard. Nobody else's projects, nobody else's appraisal, and
 * no team totals: the delivery figures on the Timeline are worked out again
 * over their projects only.
 *
 * An account not linked to anybody on the team holds nothing, so it is shown
 * nothing, and each page says why.
 *
 * Only what is DRAWN is narrowed. The plan in the browser stays whole, so an
 * administrator previewing the member view can switch back and save as before.
 */

/** Whether this person holds this project: its PIC, or one of its contributors. */
export const holds = (project, person) => !!person && (project.pic === person
  || (Array.isArray(project.contributors) && project.contributors.some((c) => c.person === person)))

export function memberView(plan, person) {
  const projects = plan.projects.filter((p) => holds(p, person))
  const people = plan.people.filter((p) => p.id === person)
  return {
    ...plan,
    projects,
    people,
    // The PIC filter offers the people on these projects, not the whole team.
    assignees: (plan.assignees || []).filter((a) => projects.some((p) => p.pic === a.id)),
    totals: { ...plan.totals, timeliness: timelinessOf(projects) },
    // Somebody else's scorecard not adding up is not theirs to see.
    invalid: plan.invalid.filter((x) => x.id === person),
  }
}

/**
 * The member's progress for the side menu: of their projects in this year's
 * plan, how many are finished.
 */
export function memberProgress(view) {
  const mine = view.projects.filter(isInPlan)
  const done = mine.filter((p) => p.timeline?.state === 'finished').length
  const share = mine.length ? done / mine.length : 0
  return {
    label: 'Your projects, finished',
    total: done,
    target: mine.length,
    unit: mine.length === 1 ? 'project' : 'projects',
    note: mine.length ? `${Math.round(share * 100)}% of your projects this year` : 'No projects in your name yet',
    share,
    tone: 'primary',
  }
}
