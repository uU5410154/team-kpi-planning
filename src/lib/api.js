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
