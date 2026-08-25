import * as store from './db.js'
import * as jira from './jira.js'
import { repairState } from '../src/lib/model.js'
import { mergeJira, JIRA_KEY } from '../src/lib/jiraMerge.js'

/**
 * The sync, run by the server against the SHARED plan.
 *
 * The button in the browser updates one person's copy and relies on them
 * leaving the tab open long enough to save. This runs whether or not anybody
 * is looking, which is the point of a schedule: the register is up to date on
 * Monday morning because a machine did it at seven, not because somebody
 * remembered.
 *
 * It uses the same merge as the button — one rule, two callers — so a nightly
 * job and a person clicking cannot end up disagreeing about the register.
 */

let last = null
export const lastRun = () => last

export async function runSync({ trigger = 'manual', scenario = null } = {}) {
  const started = new Date().toISOString()
  const name = scenario || process.env.JIRA_SYNC_SCENARIO || 'Baseline'

  if (!jira.status().configured) {
    last = { at: started, trigger, ok: false, error: 'Jira is not configured.' }
    return last
  }
  if (!store.isConfigured()) {
    last = { at: started, trigger, ok: false, error: 'No database configured, so there is no shared plan to sync.' }
    return last
  }

  const doc = await store.getScenario(name)
  if (!doc || doc === store.UNAVAILABLE || !doc.payload?.projects) {
    last = { at: started, trigger, ok: false, error: `No scenario "${name}" to sync.` }
    return last
  }
  const state = doc.payload

  const keys = state.projects
    .map((p) => String(p.jiraKey || '').trim())
    .filter((k) => JIRA_KEY.test(k))

  const fetched = keys.length ? await jira.issuesByKey(keys) : { issues: [], missing: [] }
  const board = await jira.epics()
  /*
   * And what the work UNDER each of them adds up to: a project finishes when
   * its last task does, and a task dated past the epic's own date is the
   * delay somebody else caused.
   */
  const rolled = keys.length ? await jira.rollupOf(keys) : { byParent: {} }
  if (fetched === jira.UNAVAILABLE || board === jira.UNAVAILABLE || rolled === jira.UNAVAILABLE) {
    last = { at: started, trigger, ok: false, error: 'Jira became unavailable mid-sync.' }
    return last
  }

  const merged = mergeJira(
    state,
    { issues: fetched.issues, epics: board.epics, rollups: rolled.byParent },
    { addNew: true },
  )

  const report = {
    at: started,
    trigger,
    ok: true,
    scenario: name,
    projectsBefore: state.projects.length,
    projectsAfter: merged.projects.length,
    updated: merged.updated,
    added: merged.added,
    addedKeys: merged.addedKeys.slice(0, 20),
    fromCreated: merged.fromCreated,
    missingInJira: fetched.missing || [],
    epicsOnBoard: board.epics.length,
    tasksSeen: rolled.tasks || 0,
    adjusted: merged.projects.filter((p) => p.adjustedDue).length,
  }

  if (merged.unchanged) {
    last = { ...report, wrote: false }
    return last
  }

  /*
   * Saved through repairState, the same door every other write uses, so a plan
   * a machine touched is indistinguishable from one a person touched.
   */
  const next = repairState({ ...state, projects: merged.projects })
  const saved = await store.saveScenario(name, next, `Jira sync (${trigger})`)
  last = { ...report, wrote: saved !== store.UNAVAILABLE, savedAt: saved?.updatedAt || null }
  return last
}

/**
 * Wake up once a day at the hour asked for, in the timezone asked for.
 *
 * A plain timer rather than a Render cron service: this app is one web service
 * and adding a second one to run a five-second job is more moving parts than
 * the job. Recomputed after every run rather than set to a fixed 24 hours, so
 * a daylight-saving change or a restart cannot walk the schedule off the hour.
 */
export function startSchedule() {
  const enabled = String(process.env.JIRA_SYNC_ENABLED ?? 'true').toLowerCase() !== 'false'
  if (!enabled) return null
  const hour = Number(process.env.JIRA_SYNC_HOUR ?? 7)
  const tz = process.env.JIRA_SYNC_TZ || 'Asia/Bangkok'
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null

  /** What the clock says in `tz`, right now. */
  const localParts = (d) => {
    const f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const [h, m, s] = f.format(d).split(':').map(Number)
    return { h, m, s }
  }

  const msUntilNext = () => {
    const now = new Date()
    const { h, m, s } = localParts(now)
    const secondsNow = h * 3600 + m * 60 + s
    const target = hour * 3600
    // Strictly ahead: landing exactly on the hour must wait for tomorrow
    // rather than firing in a loop.
    const wait = target > secondsNow ? target - secondsNow : 86400 - secondsNow + target
    return wait * 1000
  }

  let timer = null
  const arm = () => {
    const wait = msUntilNext()
    timer = setTimeout(async () => {
      try {
        const r = await runSync({ trigger: 'schedule' })
        console.log(`[jira] scheduled sync: ${r.ok ? `${r.updated} updated, ${r.added} added` : r.error}`)
      } catch (e) {
        console.log(`[jira] scheduled sync failed: ${e.message}`)
      }
      arm()
    }, wait)
    // Never hold the process open on its own account: a web service should
    // exit when it is told to, not when its next timer happens to fire.
    if (timer.unref) timer.unref()
    return wait
  }

  const wait = arm()
  console.log(`[jira] daily sync armed for ${String(hour).padStart(2, '0')}:00 ${tz}, next in ${Math.round(wait / 60000)} min`)
  return { stop: () => clearTimeout(timer), nextInMs: wait, hour, tz }
}
