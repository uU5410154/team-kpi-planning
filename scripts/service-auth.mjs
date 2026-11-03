/**
 * The ops scripts' way through the server's sign-in.
 *
 * Every /api route needs somebody signed in now, and a script in a terminal
 * has no browser to hold a session cookie. Imported for its side effect: it
 * wraps the global fetch so every request carries the service token from
 * KPI_SERVICE_TOKEN — the same value set in the Render dashboard — and turns a
 * refusal into a sentence instead of a JSON parse error three lines later.
 *
 *   KPI_SERVICE_TOKEN=... node scripts/hold-finish.mjs --keys FNP-88
 *
 * The token is an administrator's key. It is read from the environment only,
 * never written into a script or committed.
 */

export const rawFetch = globalThis.fetch.bind(globalThis)

const token = () => process.env.KPI_SERVICE_TOKEN || ''

globalThis.fetch = async (url, init = {}) => {
  const headers = new Headers(init.headers || {})
  if (token() && !headers.has('authorization')) headers.set('authorization', `Bearer ${token()}`)
  const res = await rawFetch(url, { ...init, headers })
  if (res.status === 401 || res.status === 403) {
    const body = await res.clone().json().catch(() => ({}))
    throw new Error(
      `${res.status} from ${url}: ${body.error || res.statusText}. `
      + (token()
        ? 'KPI_SERVICE_TOKEN is set but the server refused it — check it matches the one on Render.'
        : 'Set KPI_SERVICE_TOKEN to the service token from the Render dashboard.'),
    )
  }
  return res
}
