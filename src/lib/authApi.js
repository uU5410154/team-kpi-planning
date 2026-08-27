/**
 * The account endpoints, as the browser sees them.
 *
 * The session is an httpOnly cookie, so nothing here handles a token: the
 * browser sends it, this code never reads it, and a script running on the page
 * cannot steal what it cannot see.
 */
const j = async (res) => {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`)
  return body
}

export const authConfig = async () => j(await fetch('/api/auth/config'))

export const register = async (email, password) =>
  j(await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))

export const signIn = async (email, password) =>
  j(await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))

export const signOut = async () => j(await fetch('/api/auth/logout', { method: 'POST' }))

/** Who the server thinks is asking. Null when nobody is signed in. */
export const me = async () => (await j(await fetch('/api/auth/me'))).user

export const listUsers = async () => (await j(await fetch('/api/auth/users'))).users

export const updateUser = async (email, patch) =>
  j(await fetch(`/api/auth/users/${encodeURIComponent(email)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  }))

export const deleteUser = async (email) =>
  j(await fetch(`/api/auth/users/${encodeURIComponent(email)}`, { method: 'DELETE' }))
