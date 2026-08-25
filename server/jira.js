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
const day = (v) => (typeof v === 'string' && v.length >= 10 ? v.slice(0, 10) : null)

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

  const fields = ['summary', 'status', 'created', 'updated', 'duedate', 'resolutiondate', c.startField, c.sprintField]
  for (let i = 0; i < stillWanted.length; i += 50) {
    const batch = stillWanted.slice(i, i + 50)
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
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`Jira ${res.status}: ${text.slice(0, 200)}`)
      err.statusCode = res.status
      throw err
    }
    const data = await res.json()
    for (const raw of data.issues || []) {
      const issue = shape(raw, c)
      cache.set(issue.key, { at: Date.now(), value: issue })
      out.push(issue)
    }
  }

  const found = new Set(out.map((i) => i.key))
  return {
    issues: out,
    fetched: stillWanted.length,
    cached: wanted.length - stillWanted.length,
    // Keys the register holds that Jira does not: a deleted ticket, a typo, or
    // a project this account cannot see. Reported rather than silently missing.
    missing: wanted.filter((k) => !found.has(k)),
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

  for (let i = 0; i < parents.length; i += 20) {
    const batch = parents.slice(i, i + 20)
    let res = await ask(batch, ordering)
    if (!res.ok && res.status === 400 && ordering !== 'created ASC') {
      ordering = 'created ASC'
      res = await ask(batch, ordering)
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`Jira ${res.status}: ${text.slice(0, 200)}`)
      err.statusCode = res.status
      throw err
    }
    const data = await res.json()
    // Pushed in the order Jira answered in, and never sorted afterwards: the
    // order IS the data here.
    for (const raw of data.issues || []) {
      const parent = raw.fields?.parent?.key
      if (!parent || !byParent[parent]) continue
      byParent[parent].push({ ...shape(raw, c), type: raw.fields?.issuetype?.name || '' })
    }
  }
  return {
    byParent,
    total: Object.values(byParent).reduce((a, v) => a + v.length, 0),
    ordering,
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

  for (let i = 0; i < parents.length; i += 20) {
    const batch = parents.slice(i, i + 20)
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
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        const err = new Error(`Jira ${res.status}: ${text.slice(0, 200)}`)
        err.statusCode = res.status
        throw err
      }
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
  }

  let tasks = 0
  for (const k of parents) {
    const agg = byParent[k]
    tasks += agg.total
    // An epic with no tasks at all has not "finished everything" — there was
    // nothing to finish, and the project's own status is the better answer.
    agg.allDone = agg.total > 0 && agg.done === agg.total
    agg.anyStarted = agg.started > 0
  }
  return { byParent, parents: parents.length, tasks, delayLabel: c.delayLabel }
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
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`Jira ${res.status}: ${text.slice(0, 300)}`)
    err.statusCode = res.status
    throw err
  }
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
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error(`Jira ${res.status}: ${text.slice(0, 300)}`)
      err.statusCode = res.status
      throw err
    }
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
