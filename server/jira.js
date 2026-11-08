import { isHoldStatus } from '../src/lib/hold.js'

/**
 * Jira, read-only, from the server.
 *
 * NOT over MCP. The Atlassian MCP server authenticates a PERSON through an
 * interactive OAuth consent and issues a token for that session — there is no
 * headless credential to hand a web server, so it cannot be a dependency of a
 * page anybody else opens. The Cloud REST API with an API token is the
 * supported path for a service, and it is what this uses.
 *
 * The token lives here and only here. It is never sent to the browser, and the
 * browser can only ask for the issues this file agrees to fetch — the client
 * cannot pass arbitrary JQL, so a bug or a bored user in the console cannot
 * turn the app into a general-purpose window onto Jira.
 *
 * Environment (Render dashboard → Environment):
 *   JIRA_BASE_URL   https://lotusretails.atlassian.net
 *   JIRA_EMAIL      the account the token belongs to
 *   JIRA_API_TOKEN  from id.atlassian.com/manage-profile/security/api-tokens
 *   JIRA_START_FIELD  optional, default customfield_10015 (Jira's "Start date")
 */

const conf = () => ({
  base: String(process.env.JIRA_BASE_URL || '').replace(/\/+$/, ''),
  email: process.env.JIRA_EMAIL || '',
  token: process.env.JIRA_API_TOKEN || '',
  startField: process.env.JIRA_START_FIELD || 'customfield_10015',
  // Which project the register is drawn from, and what counts as a top-level
  // piece of work in it. Both configurable, because neither is universal.
  project: String(process.env.JIRA_PROJECT || 'FNP').trim().toUpperCase(),
  epicType: process.env.JIRA_EPIC_TYPE || 'Epic',
  // Jira Software's Sprint field. The id differs per site, so it is a setting.
  sprintField: process.env.JIRA_SPRINT_FIELD || 'customfield_10020',
  /*
   * The label a task carries when the delay was somebody else's.
   *
   * Only a task marked with it may move a project's adjusted date. A task
   * simply running past the project's date is ordinary slippage — this team's
   * own — and drawing that as an adjustment would turn every overrun into
   * somebody else's fault.
   */
  delayLabel: String(process.env.JIRA_DELAY_LABEL || 'it-delay').toLowerCase(),
})

export const UNAVAILABLE = Symbol('jira-unavailable')

export function status() {
  const c = conf()
  return {
    configured: !!(c.base && c.email && c.token),
    site: c.base || null,
    // The account, not the token. Useful for "who is this app acting as",
    // which is a question worth being able to answer out loud.
    account: c.email || null,
    startField: c.startField,
  }
}

const auth = () => {
  const c = conf()
  return `Basic ${Buffer.from(`${c.email}:${c.token}`).toString('base64')}`
}

/*
 * JIRA'S REFUSAL, IN PLAIN WORDS.
 *
 * Its own message when it gave one ("An issue with key 'FNP-1446' does not
 * exist"), never a page of HTML from a proxy in front of it, and for the
 * answers that mean "not now" or "not allowed" a line somebody can act on.
 */
export function jiraError(status, text = '') {
  let msg = ''
  try {
    const j = JSON.parse(text)
    msg = [...(j.errorMessages || []), ...Object.values(j.errors || {})].filter((x) => typeof x === 'string').join(' ')
  } catch { /* not JSON */ }
  if (!msg && !/<\s*(!doctype|html|head|body|title)\b/i.test(text)) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim()
    if (flat && flat.length <= 200) msg = flat
  }
  const why = status === 401 ? 'Jira did not accept the app’s sign-in — the API token may have expired.'
    : status === 403 ? 'Jira refused: the app’s account is not allowed to do that.'
      : status === 429 ? 'Jira is busy (too many requests). Try again in a minute.'
        : status >= 500 ? 'Jira is not answering just now. Try again in a few minutes.'
          : null
  const e = new Error(why ? `${why}${msg ? ` Jira said: ${msg}` : ''} (Jira ${status})` : `Jira ${status}: ${msg || 'the request was refused.'}`)
  e.statusCode = status
  return e
}

/*
 * ONE KEY JIRA DOES NOT KNOW must not sink a whole batch. A deleted epic, a
 * typo in the register, a project this account cannot see: any of them fails
 * the whole `key IN (...)` / `parent IN (...)` query with a 400. So a batch
 * that fails with a 400 is split in two and each half tried again, down to the
 * one bad key, which is left out and reported in `skipped`.
 */
async function eachBatch(keys, size, ask, skipped) {
  const run = async (batch) => {
    try {
      await ask(batch)
    } catch (e) {
      if (e.statusCode !== 400) throw e
      if (batch.length === 1) { skipped.push(batch[0]); return }
      const mid = Math.ceil(batch.length / 2)
      await run(batch.slice(0, mid))
      await run(batch.slice(mid))
    }
  }
  for (let i = 0; i < keys.length; i += size) await run(keys.slice(i, i + size))
  if (skipped.length) console.warn(`[jira] Jira does not know ${skipped.length} key(s): ${skipped.slice(0, 10).join(', ')}`)
}

/** What to tell a person about keys Jira does not know, or null. */
export const skippedNote = (skipped = []) => (skipped.length
  ? `Jira does not know ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ` and ${skipped.length - 5} more` : ''} — check ${skipped.length === 1 ? 'the key' : 'those keys'} on the Projects page.`
  : null)

/*
 * A small cache, because the Timeline asks for the same seventy keys every
 * time somebody opens the tab, and Jira rate-limits per account — one slow
 * page should not become a rate limit for everybody.
 */
const TTL_MS = 5 * 60 * 1000
const cache = new Map()

const fresh = (key) => {
  const hit = cache.get(key)
  return hit && Date.now() - hit.at < TTL_MS ? hit.value : null
}

/** A Jira timestamp to the plain date the register speaks. */
/*
 * WHICH DAY A JIRA TIMESTAMP FALLS ON, WHERE THE BOARD IS.
 *
 * Sprint dates come back in UTC: "Sprint 11 Week 1" ends at
 * 2026-09-12T23:59:59.000Z, which in Bangkok is seven hours later — the 13th.
 * Jira's own board renders it in the viewer's timezone and says the 13th, and
 * for months this took the first ten characters of the UTC string and said the
 * 12th. Every sprint on the board was reported a day early.
 *
 * A plain date — a due date, a start date — has no time in it and belongs to
 * no timezone, so it is returned exactly as it was written. Only a real
 * timestamp is converted, and it is converted to the timezone the board is run
 * in rather than to wherever this server happens to be.
 */
const TZ = process.env.JIRA_TZ || process.env.JIRA_SYNC_TZ || 'Asia/Bangkok'
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
})
const day = (v) => {
  if (typeof v !== 'string' || v.length < 10) return null
  // No time part: a calendar date somebody typed, not an instant.
  if (!/[T ]\d{2}:/.test(v)) return v.slice(0, 10)
  const t = Date.parse(v)
  // Unparseable but date-shaped: the leading ten characters are still the best
  // answer available, and better than dropping the date on the floor.
  if (Number.isNaN(t)) return v.slice(0, 10)
  return dayFmt.format(new Date(t))
}

/**
 * The window a task is actually scheduled in.
 *
 * A task carried across sprints belongs to several, so the span is the
 * EARLIEST start to the LATEST end: that is the stretch of calendar the work
 * has actually occupied, which is what a carry-over means and what a bar
 * should show.
 */
function sprintWindow(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : [])
  let start = null
  let end = null
  let name = null
  for (const sp of list) {
    if (!sp || typeof sp !== 'object') continue
    const s0 = day(sp.startDate)
    const e0 = day(sp.endDate || sp.completeDate)
    if (s0 && (!start || s0 < start)) start = s0
    if (e0 && (!end || e0 > end)) { end = e0; name = sp.name || name }
    if (!name && sp.name) name = sp.name
  }
  return { start, end, name, count: list.length }
}

/**
 * Fetch issues by key.
 *
 * Batched into JQL `key IN (...)` rather than one request per issue: seventy
 * round trips to Atlassian would take longer than the page is worth, and Jira
 * counts them separately against the rate limit.
 */
export async function issuesByKey(keys) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE

  const wanted = [...new Set((keys || [])
    .map((k) => String(k || '').trim().toUpperCase())
    // A key, not free text. Anything else is dropped rather than sent, so a
    // typo in the register cannot become part of a query.
    .filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)))]
  if (!wanted.length) return { issues: [], fetched: 0, cached: 0, missing: [] }

  const out = []
  const stillWanted = []
  for (const k of wanted) {
    const hit = fresh(k)
    if (hit) out.push(hit)
    else stillWanted.push(k)
  }

  // The assignee comes down too: whoever a ticket is on in Jira is who the
  // register should say runs it, and the two had been kept apart by nothing
  // more than this field never being asked for.
  const fields = ['summary', 'status', 'created', 'updated', 'duedate', 'resolutiondate', 'assignee', c.startField, c.sprintField]
  const skipped = []
  await eachBatch(stillWanted, 50, async (batch) => {
    const body = {
      jql: `key IN (${batch.join(',')})`,
      fields,
      maxResults: batch.length,
    }
    const res = await fetch(`${c.base}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: auth(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw jiraError(res.status, await res.text().catch(() => ''))
    const data = await res.json()
    for (const raw of data.issues || []) {
      const issue = shape(raw, c)
      cache.set(issue.key, { at: Date.now(), value: issue })
      out.push(issue)
    }
  }, skipped)

  const found = new Set(out.map((i) => i.key))
  return {
    issues: out,
    fetched: stillWanted.length,
    cached: wanted.length - stillWanted.length,
    // Keys the register holds that Jira does not: a deleted ticket, a typo, or
    // a project this account cannot see. Reported rather than silently missing.
    missing: wanted.filter((k) => !found.has(k)),
    // The ones Jira refused outright (it says the key does not exist).
    skipped,
  }
}

/**
 * The work UNDER an issue: an epic's stories and tasks, an initiative's epics.
 *
 * One level, by `parent`, which Jira Cloud now honours for company-managed and
 * team-managed projects alike. Deeper levels come from expanding a child in
 * turn rather than from a recursive query — a register of 159 rows would
 * otherwise pull thousands of issues nobody has looked at.
 */
export async function childrenOf(keys) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE

  const parents = [...new Set((keys || [])
    .map((k) => String(k || '').trim().toUpperCase())
    .filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)))]
  if (!parents.length) return { byParent: {}, total: 0 }

  const fields = ['summary', 'status', 'created', 'updated', 'duedate', 'resolutiondate', 'parent', 'issuetype', c.startField, c.sprintField]
  const byParent = {}
  for (const k of parents) byParent[k] = []

  /*
   * BY RANK, which is the order Jira itself shows.
   *
   * Ordered by creation date, the list here disagreed with the board on screen
   * the moment anybody dragged a card — and dragging cards is how a backlog is
   * kept. Rank is that drag order; it is what "the same order as in Jira"
   * means, and it is not derivable from any other field.
   *
   * Not every Jira has the field: it comes with Jira Software and a site
   * without it answers 400. That is worth falling back from rather than
   * failing on, so the order degrades to creation date and the caller is told
   * which one it got.
   */
  let ordering = 'Rank ASC'
  const ask = async (batch, orderBy) => {
    const res = await fetch(`${c.base}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: auth(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jql: `parent IN (${batch.join(',')}) ORDER BY ${orderBy}`,
        fields,
        maxResults: 100,
      }),
      signal: AbortSignal.timeout(20000),
    })
    return res
  }

  const skipped = []
  await eachBatch(parents, 20, async (batch) => {
    let res = await ask(batch, ordering)
    if (!res.ok && res.status === 400 && ordering !== 'created ASC') {
      // Could be no Rank field — or a key Jira does not know. Try without Rank;
      // a 400 again is about the keys, and the batch is split.
      const retry = await ask(batch, 'created ASC')
      if (retry.ok) ordering = 'created ASC'
      res = retry
    }
    if (!res.ok) throw jiraError(res.status, await res.text().catch(() => ''))
    const data = await res.json()
    // Pushed in the order Jira answered in, and never sorted afterwards: the
    // order IS the data here.
    for (const raw of data.issues || []) {
      const parent = raw.fields?.parent?.key
      if (!parent || !byParent[parent]) continue
      byParent[parent].push({ ...shape(raw, c), type: raw.fields?.issuetype?.name || '' })
    }
  }, skipped)
  return {
    byParent,
    total: Object.values(byParent).reduce((a, v) => a + v.length, 0),
    ordering,
    skipped,
  }
}

/**
 * What the work UNDER each epic adds up to.
 *
 * Two questions the project row cannot answer on its own:
 *
 *   - the LATEST due date among its tasks. When another team causes a delay,
 *     a task is raised for it with a date past the epic's own — that later
 *     date is what the project will actually now finish by, and it is worth
 *     drawing rather than discovering.
 *   - whether every task is resolved, and the latest date one was. An epic
 *     marked Done with tasks still open has not finished; a project has
 *     finished when the last thing under it has.
 *
 * Aggregates only. The Timeline needs this for every keyed project at once —
 * a hundred and fifty of them — and shipping thousands of task records to a
 * browser that will draw two dates from them is a waste of everybody's time.
 *
 * Paged properly, unlike a plain children fetch: twenty epics can easily hold
 * more than the hundred issues one page returns, and a rollup that silently
 * saw two thirds of the tasks would be worse than no rollup at all.
 */
export async function rollupOf(keys) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE

  const parents = [...new Set((keys || [])
    .map((k) => String(k || '').trim().toUpperCase())
    .filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)))]
  if (!parents.length) return { byParent: {}, parents: 0, tasks: 0 }

  const byParent = {}
  for (const k of parents) {
    byParent[k] = {
      total: 0,
      done: 0,
      latestDue: null,
      /*
       * The end of the LAST SPRINT any of this work is scheduled into, kept
       * apart from latestDue. A task's due date is a deadline somebody typed;
       * a sprint end is when the fortnight it is booked into finishes, and for
       * an epic carrying no date of its own that is the only scheduled date
       * that exists.
       */
      latestSprintEnd: null,
      latestResolved: null,
      // The latest date among the tasks LABELLED as somebody else's delay, and
      // which task said so. Kept apart from latestDue: one is what the work
      // now needs, the other is a claim about whose fault that is.
      latestDelayDue: null,
      delayKey: null,
      delayCount: 0,
      // Whether any task underneath has actually begun. A project has started
      // when its first task has, whatever the epic's own column says.
      started: 0,
      anyStarted: false,
      allDone: false,
      truncated: false,
    }
  }

  const later = (a, b) => (!a ? b : (!b ? a : (a > b ? a : b)))
  const fields = ['status', 'duedate', 'resolutiondate', 'parent', 'labels', c.sprintField]

  const skipped = []
  await eachBatch(parents, 20, async (batch) => {
    let token = null
    for (let page = 0; page < 25; page++) {
      const res = await fetch(`${c.base}/rest/api/3/search/jql`, {
        method: 'POST',
        headers: {
          Authorization: auth(),
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jql: `parent IN (${batch.join(',')})`,
          fields,
          maxResults: 100,
          ...(token ? { nextPageToken: token } : {}),
        }),
        signal: AbortSignal.timeout(25000),
      })
      if (!res.ok) throw jiraError(res.status, await res.text().catch(() => ''))
      const data = await res.json()
      for (const raw of data.issues || []) {
        const parent = raw.fields?.parent?.key
        const agg = parent && byParent[parent]
        if (!agg) continue
        agg.total += 1
        // The sprint the task sits in, where it has one: that is the window
        // the team committed to, and a task carried into a later sprint is
        // exactly the delay this rollup exists to surface.
        const sp = sprintWindow(raw.fields?.[c.sprintField])
        const when = sp.end || day(raw.fields?.duedate)
        agg.latestDue = later(agg.latestDue, when)
        agg.latestSprintEnd = later(agg.latestSprintEnd, sp.end)

        if (['indeterminate', 'done'].includes(raw.fields?.status?.statusCategory?.key)) agg.started += 1

        const labels = (raw.fields?.labels || []).map((x) => String(x).toLowerCase())
        if (labels.includes(c.delayLabel)) {
          agg.delayCount += 1
          if (when && (!agg.latestDelayDue || when > agg.latestDelayDue)) {
            agg.latestDelayDue = when
            agg.delayKey = raw.key
          }
        }
        const resolved = day(raw.fields?.resolutiondate)
        const isDone = raw.fields?.status?.statusCategory?.key === 'done'
        if (isDone) {
          agg.done += 1
          agg.latestResolved = later(agg.latestResolved, resolved)
        }
      }
      token = data.nextPageToken || null
      if (!token) break
      // A parent with more than 2,500 tasks is not a project, and pretending
      // to have counted them all would be the lie this guard exists to avoid.
      if (page === 24) for (const k of batch) byParent[k].truncated = true
    }
  }, skipped)

  let tasks = 0
  for (const k of parents) {
    const agg = byParent[k]
    tasks += agg.total
    // An epic with no tasks at all has not "finished everything" — there was
    // nothing to finish, and the project's own status is the better answer.
    agg.allDone = agg.total > 0 && agg.done === agg.total
    agg.anyStarted = agg.started > 0
  }
  return {
    byParent, parents: parents.length, tasks, delayLabel: c.delayLabel, skipped,
  }
}

/**
 * Write the PLAN back to Jira: the start date and the due date, and nothing
 * else.
 *
 * Those two are the only dates Jira will accept. Its own edit metadata lists
 * `duedate` and the Start date custom field as settable and does not list
 * `resolutiondate` at all — a resolution date is stamped by Jira when an issue
 * transitions into a resolved status, so it cannot be typed, here or there.
 * That is why the sync runs one way for outcomes and both ways for the plan.
 *
 * The whitelist is the security boundary. This endpoint edits real tickets
 * under a real account, so it accepts two named dates and refuses to pass
 * anything else through — no summary, no status, no assignee, whatever the
 * request body happens to contain.
 */
export async function updateIssue(key, patch) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE

  const k = String(key || '').trim().toUpperCase()
  if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(k)) {
    const err = new Error('Not an issue key.')
    err.statusCode = 400
    throw err
  }

  // Null is a legitimate value — it clears the date. Undefined means "leave it
  // alone", and the two must not be confused, or saving a start date would
  // silently wipe a due date.
  const ok = (v) => v === null || (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
  const fields = {}
  if ('due' in patch) {
    if (!ok(patch.due)) { const e = new Error('Due date must be YYYY-MM-DD or null.'); e.statusCode = 400; throw e }
    fields.duedate = patch.due
  }
  if ('start' in patch) {
    if (!ok(patch.start)) { const e = new Error('Start date must be YYYY-MM-DD or null.'); e.statusCode = 400; throw e }
    fields[c.startField] = patch.start
  }
  if (!Object.keys(fields).length) {
    const e = new Error('Nothing to write: send start, due, or both.')
    e.statusCode = 400
    throw e
  }

  const res = await fetch(`${c.base}/rest/api/3/issue/${encodeURIComponent(k)}`, {
    method: 'PUT',
    headers: {
      Authorization: auth(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
    signal: AbortSignal.timeout(20000),
  })
  if (!res.ok) throw jiraError(res.status, await res.text().catch(() => ''))
  // What was just written is what Jira now holds, so the cached copy is stale
  // by definition — drop it rather than serve a five-minute-old contradiction.
  cache.delete(k)
  return { key: k, written: Object.keys(fields) }
}

/**
 * Every top-level piece of work in the Jira project.
 *
 * The JQL is built here from an environment variable and never from the
 * request, for the same reason the other two endpoints take keys: this is
 * reachable by anyone who can open the app.
 *
 * Returns everything and lets the caller work out what is new. The comparison
 * belongs on the client, which is the only side that knows what the register
 * already holds — and a server that decided would have to be told the register
 * on every call.
 */
export async function epics({ since = null } = {}) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE

  const clauses = [`project = ${c.project}`, `issuetype = "${c.epicType.replace(/"/g, '')}"`]
  // Optional window, as a number of days. Parsed as a number so nothing from
  // the request can reach the query as text.
  const days = Number(since)
  if (Number.isFinite(days) && days > 0) clauses.push(`created >= -${Math.floor(days)}d`)
  const jql = `${clauses.join(' AND ')} ORDER BY created DESC`

  const fields = ['summary', 'status', 'created', 'updated', 'duedate', 'resolutiondate', 'assignee', 'issuetype', c.startField, c.sprintField]
  const out = []
  let token = null
  // Paged, because a project accumulates epics forever and the page size is
  // capped at 100 whatever we ask for.
  for (let page = 0; page < 12; page++) {
    const res = await fetch(`${c.base}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: {
        Authorization: auth(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jql, fields, maxResults: 100, ...(token ? { nextPageToken: token } : {}) }),
      signal: AbortSignal.timeout(25000),
    })
    if (!res.ok) throw jiraError(res.status, await res.text().catch(() => ''))
    const data = await res.json()
    for (const raw of data.issues || []) {
      out.push({ ...shape(raw, c), assignee: raw.fields?.assignee?.displayName || null })
    }
    token = data.nextPageToken || null
    if (!token) break
  }
  return { epics: out, jql, project: c.project }
}

/** One issue, read the same way wherever it came from. */
function shape(raw, c) {
  const f = raw.fields || {}
  const startField = day(f[c.startField])
  const sprint = sprintWindow(f[c.sprintField])
  return {
    key: raw.key,
    summary: f.summary || '',
    status: f.status?.name || '',
    // Done, in flight, or not begun — read from the CATEGORY, so a board that
    // renames its columns does not silently stop reporting finishes.
    done: f.status?.statusCategory?.key === 'done',
    /*
     * HAS IT ACTUALLY STARTED.
     *
     * Not "does it have a start date" — a Backlog task can carry a start date
     * for a sprint three weeks away, and a creation date only says somebody
     * typed the ticket. Only the status can say work has begun: in flight, or
     * finished. Everything in To Do, Backlog or Selected for Development has
     * not started, whatever dates it carries.
     */
    started: ['indeterminate', 'done'].includes(f.status?.statusCategory?.key),
    statusCategory: f.status?.statusCategory?.key || null,
    created: day(f.created),
    updated: day(f.updated),
    due: day(f.duedate),
    resolved: day(f.resolutiondate),
    start: startField,
    /*
     * THE SPRINT WINS, where there is one.
     *
     * A task's own dates describe when somebody meant to touch it; the sprint
     * is what the team actually committed to in planning, and it is the window
     * the work is scheduled in. Both are carried so the difference is visible,
     * and the choice is made once, where the dates are used.
     */
    sprintStart: sprint.start,
    sprintEnd: sprint.end,
    sprintName: sprint.name,
    sprintCount: sprint.count,
    // What the app should draw and measure: the sprint if there is one, the
    // issue's own dates otherwise.
    // Whoever holds the ticket, by display name. Never the email or the
    // account id: a display name is what a person recognises, and the roster
    // is matched against it by hand rather than guessed.
    assignee: f.assignee?.displayName || null,
    planStart: sprint.start || startField || null,
    planEnd: sprint.end || day(f.duedate) || null,
    /*
     * Where the start came from. Jira's Start date field is filled in on a
     * minority of these issues, and `created` is when the ticket was raised
     * rather than when work began — a usable stand-in, but not the same claim,
     * so the difference travels with the data instead of being flattened into
     * it.
     */
    startSource: startField ? 'start-date' : (day(f.created) ? 'created' : null),
  }
}

/* ======================================================================
 * THE WEEKLY CHECK-IN, IN JIRA.
 *
 * A member's week is their Jira tasks: the ones assigned to them whose dates
 * cover the week. Their update on a task goes back onto that task — a
 * comment, the screenshot as an attachment, and Done when it is finished —
 * and a task or a project they add is created in Jira.
 *
 * Everything is written under the one account this app runs as (JIRA_EMAIL),
 * so a comment names the member in its text. Writing is refused unless
 * JIRA_ALLOW_WRITES is true, like the date edits above.
 * ====================================================================== */

export const writable = () => String(process.env.JIRA_ALLOW_WRITES || '').toLowerCase() === 'true'

const KEY = /^[A-Z][A-Z0-9_]+-\d+$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

/** One call to Jira, as this app's account. Throws with Jira's own words. */
async function call(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const c = conf()
  const res = await fetch(`${c.base}${path}`, {
    method,
    headers: {
      Authorization: auth(),
      Accept: 'application/json',
      ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body)),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw jiraError(res.status, await res.text().catch(() => ''))
  if (res.status === 204) return null
  return res.json().catch(() => null)
}

const refuseWrites = () => {
  const e = new Error('Writing to Jira is switched off. Set JIRA_ALLOW_WRITES=true in the Render dashboard.')
  e.statusCode = 409
  e.writesOff = true
  return e
}

/*
 * WHO A PERSON IS IN JIRA.
 *
 * Found by the names the roster already matches Jira assignees on, then by
 * their email; the first active Atlassian account whose display name or email
 * matches exactly. Kept for a day: people do not change Jira accounts.
 */
const users = new Map()
const DAY_MS = 24 * 3600 * 1000
export async function accountFor({ names = [], email = null } = {}) {
  if (!status().configured) return UNAVAILABLE
  const tries = [...new Set([...names, email].filter(Boolean).map((x) => String(x).trim()))]
  const cacheKey = tries.join('|').toLowerCase()
  const hit = users.get(cacheKey)
  if (hit && Date.now() - hit.at < DAY_MS) return hit.value
  const fold = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
  let found = null
  for (const q of tries) {
    const list = await call(`/rest/api/3/user/search?query=${encodeURIComponent(q)}&maxResults=20`)
    const people = (Array.isArray(list) ? list : []).filter((u) => u.accountType === 'atlassian' && u.active !== false)
    found = people.find((u) => fold(u.displayName) === fold(q) || fold(u.emailAddress) === fold(q))
      || (people.length === 1 && q.includes('@') ? people[0] : null)
    if (found) break
  }
  const value = found ? { accountId: found.accountId, displayName: found.displayName } : null
  users.set(cacheKey, { at: Date.now(), value })
  return value
}

/** Monday..Sunday of a week named by its Monday. */
const weekEnd = (week) => {
  const d = new Date(`${week}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 6)
  return d.toISOString().slice(0, 10)
}

/*
 * The span a task occupies for the weekly check-in: its OWN start and due
 * dates first — those are what a member sets when they plan a week — and the
 * sprint only where the task carries no date of its own.
 */
const isWeekDate = (w) => /^\d{4}-\d{2}-\d{2}$/.test(String(w || ''))

export function taskSpan(t) {
  const start = t.start || t.sprintStart || null
  const end = t.due || t.sprintEnd || null
  return { start: start || end, end: end || start }
}

/** Whether a task belongs in a week: its span overlaps Monday..Sunday. */
export function coversWeek(t, week) {
  const { start, end } = taskSpan(t)
  if (!start) return false
  return start <= weekEnd(week) && end >= week
}

/*
 * A MEMBER'S WORK FOR A WEEK: the Jira issues they are PIC of (assignee).
 *
 *   week     whose dates cover it (finished ones too, so the week reads whole)
 *   overdue  not done, due before the week began
 *   undated  not done and no date at all: shown so they can be planned
 *
 * With withEpics, their epics come too, marked epic: true — an epic they are
 * PIC of is theirs to update like a task. Only what is due on or after the
 * week's Monday, or has no due date, is asked for, so a long tail of old
 * open tasks never crowds the page out.
 */
export async function tasksForWeek(accountId, week, { withEpics = false } = {}) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE
  if (!/^[A-Za-z0-9:_-]{6,128}$/.test(String(accountId || ''))) return { week: [], overdue: [], undated: [] }
  if (!isWeekDate(week)) return { week: [], overdue: [], undated: [] }
  const since = new Date(`${week}T00:00:00Z`)
  since.setUTCDate(since.getUTCDate() - 7)
  const epicType = c.epicType.replace(/"/g, '')
  const jql = `assignee = "${accountId}" ${withEpics ? '' : `AND issuetype != "${epicType}" `}`
    + `AND (duedate >= "${week}" OR duedate IS EMPTY) `
    + `AND (statusCategory != Done OR resolutiondate >= "${since.toISOString().slice(0, 10)}") ORDER BY duedate ASC`
  const fields = ['summary', 'status', 'created', 'updated', 'duedate', 'resolutiondate', 'assignee', 'issuetype', 'parent', c.startField, c.sprintField]
  const all = []
  let token = null
  for (let page = 0; page < 5; page++) {
    const data = await call('/rest/api/3/search/jql', {
      method: 'POST',
      body: { jql, fields, maxResults: 100, ...(token ? { nextPageToken: token } : {}) },
    })
    for (const raw of data?.issues || []) {
      const f = raw.fields || {}
      all.push({
        ...shape(raw, c),
        type: f.issuetype?.name || '',
        epic: (f.issuetype?.name || '').toLowerCase() === epicType.toLowerCase(),
        parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '', status: f.parent.fields?.status?.name || '' } : null,
        url: `${c.base}/browse/${raw.key}`,
      })
    }
    token = data?.nextPageToken || null
    if (!token) break
  }
  const out = { week: [], overdue: [], undated: [] }
  for (const t of all) {
    const { start, end } = taskSpan(t)
    if (coversWeek(t, week)) out.week.push(t)
    else if (!t.done && end && end < week) out.overdue.push(t)
    else if (!t.done && !start) out.undated.push(t)
  }
  return out
}

/*
 * WHAT WAS ON EACH PROJECT IN A WEEK: the epics given, and every task under
 * them, whose timeline covers that week — whoever holds them. For the
 * manager's "last week" column. Finished ones count when they finished in or
 * after that week.
 */
export async function coveringWeek(epicKeys, week) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE
  if (!isWeekDate(week)) return []
  const keys = [...new Set((epicKeys || []).map((k) => String(k || '').trim().toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]+-\d+$/.test(k)))]
  const epicType = c.epicType.replace(/"/g, '')
  const fields = ['summary', 'status', 'created', 'updated', 'duedate', 'resolutiondate', 'assignee', 'issuetype', 'parent', c.startField, c.sprintField]
  const all = []
  const skipped = []
  const search = async (batch) => {
    const list = batch.join(',')
    const jql = `(key IN (${list}) OR parent IN (${list})) AND (duedate >= "${week}" OR duedate IS EMPTY) `
      + `AND (statusCategory != Done OR resolutiondate >= "${week}") ORDER BY duedate ASC`
    const out = []
    let token = null
    for (let page = 0; page < 5; page++) {
      const data = await call('/rest/api/3/search/jql', {
        method: 'POST',
        body: { jql, fields, maxResults: 100, ...(token ? { nextPageToken: token } : {}) },
      })
      for (const raw of data?.issues || []) {
        const f = raw.fields || {}
        out.push({
          ...shape(raw, c),
          accountId: f.assignee?.accountId || null,
          epic: (f.issuetype?.name || '').toLowerCase() === epicType.toLowerCase(),
          parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '' } : null,
        })
      }
      token = data?.nextPageToken || null
      if (!token) break
    }
    return out
  }
  /*
   * One key Jira does not know — a deleted epic, a typo in the register, a
   * project this account cannot see — fails the whole query with a 400. So a
   * batch that fails is split in two and tried again, down to the one bad
   * key, which is left out and reported.
   */
  await eachBatch(keys, 40, async (batch) => { all.push(...await search(batch)) }, skipped)
  const items = all.filter((t) => coversWeek(t, week))
  items.skipped = skipped
  return items
}

/** One issue, with who it is assigned to by account id — for checking ownership. */
export async function issueOwner(key) {
  const k = String(key || '').trim().toUpperCase()
  if (!KEY.test(k)) return null
  const c = conf()
  const raw = await call(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=summary,assignee,status,parent,issuetype,duedate,${c.startField}`)
  const f = raw?.fields || {}
  return {
    key: raw.key,
    summary: f.summary || '',
    accountId: f.assignee?.accountId || null,
    done: f.status?.statusCategory?.key === 'done',
    status: f.status?.name || '',
    type: f.issuetype?.name || '',
    parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || '' } : null,
  }
}

/** The issue type to create a task as in a project: "Task" if it has one. */
const typeCache = new Map()
async function issueTypeFor(projectKey, want) {
  const k = `${projectKey}:${want}`
  if (typeCache.has(k)) return typeCache.get(k)
  const data = await call(`/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes?maxResults=100`)
  const types = data?.issueTypes || data?.values || []
  const fold = (s) => String(s || '').toLowerCase()
  const pick = types.find((t) => fold(t.name) === fold(want))
    || (want === 'Task' ? types.find((t) => !t.subtask && fold(t.name) !== 'epic' && t.hierarchyLevel === 0) : null)
  if (!pick) {
    const e = new Error(`Jira project ${projectKey} has no "${want}" issue type.`)
    e.statusCode = 400
    throw e
  }
  typeCache.set(k, pick.id)
  return pick.id
}

const checkDates = (start, due) => {
  if (!ISO_DAY.test(String(start || '')) || !ISO_DAY.test(String(due || ''))) {
    const e = new Error('Give a start date and a due date.'); e.statusCode = 400; throw e
  }
  if (start > due) { const e = new Error('The start date is after the due date.'); e.statusCode = 400; throw e }
}

/** A new task under an epic, assigned to the member, with both dates. */
export async function createTask({ epicKey, summary, start, due, accountId }) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE
  if (!writable()) throw refuseWrites()
  const epic = String(epicKey || '').trim().toUpperCase()
  if (!KEY.test(epic)) { const e = new Error('Pick a project that has a Jira epic.'); e.statusCode = 400; throw e }
  const title = String(summary || '').trim().slice(0, 250)
  if (title.length < 3) { const e = new Error('Say what the task is.'); e.statusCode = 400; throw e }
  checkDates(start, due)
  const projectKey = epic.split('-')[0]
  const fields = {
    project: { key: projectKey },
    issuetype: { id: await issueTypeFor(projectKey, 'Task') },
    summary: title,
    parent: { key: epic },
    duedate: due,
    [c.startField]: start,
    ...(accountId ? { assignee: { accountId } } : {}),
  }
  const r = await call('/rest/api/3/issue', { method: 'POST', body: { fields } })
  return { key: r.key, url: `${c.base}/browse/${r.key}` }
}

/** The labels a new project carries in Jira, by its kind. */
export const PROJECT_KINDS = { adhoc: { label: 'adhoc-work', name: 'Adhoc work' }, cr: { label: 'change-request', name: 'Change Request' } }

/** A new project: an epic in the register's Jira project, labelled by kind. */
export async function createEpic({ summary, kind, start, due, accountId, description = '' }) {
  const c = conf()
  if (!status().configured) return UNAVAILABLE
  if (!writable()) throw refuseWrites()
  const title = String(summary || '').trim().slice(0, 250)
  if (title.length < 3) { const e = new Error('Name the project.'); e.statusCode = 400; throw e }
  if (!PROJECT_KINDS[kind]) { const e = new Error('Pick Adhoc work or Change Request.'); e.statusCode = 400; throw e }
  checkDates(start, due)
  const fields = {
    project: { key: c.project },
    issuetype: { id: await issueTypeFor(c.project, c.epicType) },
    summary: title,
    labels: [PROJECT_KINDS[kind].label],
    duedate: due,
    [c.startField]: start,
    ...(accountId ? { assignee: { accountId } } : {}),
    ...(description.trim() ? { description: adf(description.trim()) } : {}),
  }
  const r = await call('/rest/api/3/issue', { method: 'POST', body: { fields } })
  return { key: r.key, url: `${c.base}/browse/${r.key}` }
}

/*
 * Plain text to Atlassian Document Format: one paragraph per line, a bold
 * lead where a line starts "**Label:**", and bare links made clickable.
 */
export function adf(text) {
  const para = (line) => {
    const content = []
    let rest = line
    const bold = rest.match(/^\*\*(.+?)\*\*\s?/)
    if (bold) {
      content.push({ type: 'text', text: bold[1], marks: [{ type: 'strong' }] })
      rest = rest.slice(bold[0].length)
      if (rest) content.push({ type: 'text', text: ' ' })
    }
    for (const part of rest.split(/(https?:\/\/[^\s]+)/)) {
      if (!part) continue
      if (/^https?:\/\//.test(part)) content.push({ type: 'text', text: part, marks: [{ type: 'link', attrs: { href: part } }] })
      else content.push({ type: 'text', text: part })
    }
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
  }
  return { type: 'doc', version: 1, content: String(text).split('\n').map(para) }
}

/*
 * EACH WEEKLY UPDATE, ADDED TO THE ISSUE'S DESCRIPTION.
 *
 * The owner's rule (2026-11-06): appended to the end, its first line starting
 * with the date as dd-mm-yyyy. What is already in the description is never
 * changed; an empty description becomes the entry.
 *
 * Submitted again the same day (`replace`: the text of that day's entry, as
 * it was posted), the day's entry is REPLACED rather than a second one added
 * under the same date — two contradicting entries for one day read as a
 * mistake (QA, 2026-11-07). Only an entry found exactly as it was written is
 * replaced; anything else, an edit somebody made in Jira included, is left
 * alone and the new entry is appended as before.
 */
const plainOf = (node) => (node?.text || '') + (node?.content || []).map(plainOf).join('')

export function appendWeeklyEntry(doc, text, replace = null) {
  const old = doc && doc.type === 'doc' && Array.isArray(doc.content) ? doc.content : []
  const entry = adf(text).content
  if (replace && old.length) {
    const was = adf(replace).content.map(plainOf)
    for (let i = old.length - was.length; i >= 0; i--) {
      if (was.every((t, j) => plainOf(old[i + j]) === t)) {
        return { type: 'doc', version: 1, content: [...old.slice(0, i), ...entry, ...old.slice(i + was.length)], replaced: true }
      }
    }
  }
  return { type: 'doc', version: 1, content: old.length ? [...old, { type: 'paragraph' }, ...entry] : entry }
}

/** dd-mm-yyyy, in Bangkok. */
export function ddmmyyyy(at = Date.now()) {
  const d = new Date(new Date(at).getTime() + 7 * 3600_000)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getUTCDate())}-${p(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`
}

/** The update into the description; `replace` is the same day's earlier entry, if any. */
export async function addToDescription(key, text, { replace = null } = {}) {
  if (!status().configured) return UNAVAILABLE
  if (!writable()) throw refuseWrites()
  const k = String(key || '').trim().toUpperCase()
  const raw = await call(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=description`)
  const { replaced, ...doc } = appendWeeklyEntry(raw?.fields?.description || null, text, replace)
  await call(`/rest/api/3/issue/${encodeURIComponent(k)}`, { method: 'PUT', body: { fields: { description: doc } } })
  cache.delete(k)
  return { updated: true, replaced: !!replaced }
}

/** A comment on an issue, from plain text. */
export async function addComment(key, text) {
  if (!status().configured) return UNAVAILABLE
  if (!writable()) throw refuseWrites()
  const k = String(key || '').trim().toUpperCase()
  const r = await call(`/rest/api/3/issue/${encodeURIComponent(k)}/comment`, { method: 'POST', body: { body: adf(text) } })
  return { id: r?.id || null }
}

/** Files onto an issue: [{ name, type, buffer }]. Returns the stored file names. */
export async function attach(key, files) {
  if (!status().configured) return UNAVAILABLE
  if (!writable()) throw refuseWrites()
  if (!files?.length) return []
  const k = String(key || '').trim().toUpperCase()
  const form = new FormData()
  for (const f of files) form.append('file', new Blob([f.buffer], { type: f.type }), f.name)
  const r = await call(`/rest/api/3/issue/${encodeURIComponent(k)}/attachments`, {
    method: 'POST', body: form, raw: true, headers: { 'X-Atlassian-Token': 'no-check' },
  })
  return (Array.isArray(r) ? r : []).map((a) => a.filename)
}

/** Move an issue to whichever status its workflow calls done. */
/*
 * ON HOLD: through the transition whose status reads as on hold ("On Hold",
 * "Hold", "Paused"…). A workflow without one says so, and nothing moves.
 */
export async function markHold(key) {
  if (!status().configured) return UNAVAILABLE
  if (!writable()) throw refuseWrites()
  const k = String(key || '').trim().toUpperCase()
  const data = await call(`/rest/api/3/issue/${encodeURIComponent(k)}/transitions`)
  const to = (data?.transitions || []).find((t) => isHoldStatus(t.to?.name) || isHoldStatus(t.name))
  if (!to) return { moved: false, reason: 'its Jira workflow has no Hold status to move it to.' }
  await call(`/rest/api/3/issue/${encodeURIComponent(k)}/transitions`, { method: 'POST', body: { transition: { id: to.id } } })
  cache.delete(k)
  return { moved: true, status: to.to?.name || 'On hold' }
}

export async function markDone(key) {
  if (!status().configured) return UNAVAILABLE
  if (!writable()) throw refuseWrites()
  const k = String(key || '').trim().toUpperCase()
  const data = await call(`/rest/api/3/issue/${encodeURIComponent(k)}/transitions`)
  const to = (data?.transitions || []).find((t) => t.to?.statusCategory?.key === 'done')
  if (!to) return { moved: false, reason: 'No transition to a done status from where it is now.' }
  await call(`/rest/api/3/issue/${encodeURIComponent(k)}/transitions`, { method: 'POST', body: { transition: { id: to.id } } })
  cache.delete(k)
  return { moved: true, status: to.to?.name || 'Done' }
}
