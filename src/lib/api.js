/**
 * Shared-scenario API. Every call degrades gracefully: if the store is not
 * configured or the cluster is unreachable the app keeps working against
 * browser-local storage, so a Mongo outage can never block planning work.
 */

const j = async (res) => {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body
}

export async function storeStatus() {
  try {
    const h = await j(await fetch('/api/health'))
    return h.store || { configured: false, connected: false }
  } catch {
    return { configured: false, connected: false, reason: 'server unreachable' }
  }
}

export const listScenarios = async () => j(await fetch('/api/scenarios'))

export const loadScenario = async (name) =>
  j(await fetch(`/api/scenarios/${encodeURIComponent(name)}`))

export const saveScenario = async (name, payload, updatedBy) =>
  j(
    await fetch(`/api/scenarios/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, updatedBy }),
    }),
  )

export const deleteScenario = async (name) =>
  j(await fetch(`/api/scenarios/${encodeURIComponent(name)}`, { method: 'DELETE' }))

/* ---------------------------- jira ---------------------------- */

/** Is the server able to reach Jira at all, and as whom. */
export const jiraStatus = async () => j(await fetch('/api/jira/status'))

/**
 * Live issues for the keys the register holds.
 *
 * The keys go up, the token never comes down: the browser has no credential
 * of its own and cannot query Jira directly even if it wanted to.
 */
export const jiraIssues = async (keys) =>
  j(await fetch('/api/jira/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  }))

/** The tasks under an epic, or the epics under an initiative. */
export const jiraChildren = async (keys) =>
  j(await fetch('/api/jira/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  }))

/**
 * Push the plan back to a ticket: the start date, the due date, or both.
 *
 * Not the resolution date. Jira stamps that itself when an issue transitions
 * into a resolved status and refuses to accept it as a field, so outcomes flow
 * one way — out of Jira — and only the plan flows both.
 */
export const jiraUpdate = async (key, patch) =>
  j(await fetch(`/api/jira/issue/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))
