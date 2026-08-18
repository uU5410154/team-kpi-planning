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

  const fields = ['summary', 'status', 'created', 'updated', 'duedate', 'resolutiondate', c.startField]
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
      const f = raw.fields || {}
      const startField = day(f[c.startField])
      const issue = {
        key: raw.key,
        summary: f.summary || '',
        status: f.status?.name || '',
        // Done, in flight, or not begun — read from the CATEGORY, so a board
        // that renames its columns does not silently stop reporting finishes.
        done: f.status?.statusCategory?.key === 'done',
        created: day(f.created),
        updated: day(f.updated),
        due: day(f.duedate),
        resolved: day(f.resolutiondate),
        start: startField,
        /*
         * Where the start came from. Jira's Start date field is filled in on
         * a minority of these epics, and `created` is when the ticket was
         * raised rather than when work began — a usable stand-in, but not the
         * same claim, so the difference travels with the data instead of
         * being flattened into it.
         */
        startSource: startField ? 'start-date' : (day(f.created) ? 'created' : null),
      }
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
