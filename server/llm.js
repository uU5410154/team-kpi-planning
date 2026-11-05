import { createHash } from 'node:crypto'

/**
 * THE LOTUS LLM: the company's own model, behind an OpenAI-compatible
 * chat-completions endpoint.
 *
 * Called from the server only. The key is LOTUS_API_KEY in the Render
 * dashboard and never reaches a browser, a log line or the repository — which
 * is public. There is deliberately no fallback key in this file: the one in
 * the internal reference document was committed to another repository and is
 * marked leaked, so it is recognised by its fingerprint and refused, rather
 * than quietly used.
 *
 * With no key set, every AI feature reports itself unavailable and the app
 * works exactly as it did without it.
 */

const LEAKED = '505eb6116928ab9ee43f0337bd5ed03440427cbd29b25fc9d7d1081f415b87e9'
const fingerprint = (k) => createHash('sha256').update(String(k || '')).digest('hex')

const cfg = () => ({
  url: process.env.LOTUS_LLM_URL || 'https://api-cpxis.lotuss.com/llm/v1/chat/completions',
  key: String(process.env.LOTUS_API_KEY || '').trim(),
  model: process.env.LOTUS_LLM_MODEL || 'default',
  timeout: Number(process.env.LOTUS_LLM_TIMEOUT_MS || 120_000),
})

/** Whether the AI can be used, and if not, why. Never the key. */
export function status() {
  const c = cfg()
  if (!c.key) return { configured: false, reason: 'LOTUS_API_KEY is not set on the server.' }
  if (fingerprint(c.key) === LEAKED) {
    return { configured: false, reason: 'LOTUS_API_KEY is the leaked key from the reference document. Ask the Lotus platform team for a new one.' }
  }
  return { configured: true, model: c.model }
}

export class LlmError extends Error {}

/*
 * ONE CHAT CALL.
 *
 * `enable_thinking: false` asks the model for the answer without its
 * reasoning preamble — what the reference document recommends, and what every
 * caller here wants. An empty answer is tried once more before giving up.
 */
export async function chat(messages, { temperature = 0.2, maxTokens = 1500 } = {}) {
  const s = status()
  if (!s.configured) throw new LlmError(s.reason)
  const c = cfg()
  let last = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res
    try {
      res = await fetch(c.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
        body: JSON.stringify({
          model: c.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: AbortSignal.timeout(c.timeout),
      })
    } catch (e) {
      throw new LlmError(e.name === 'TimeoutError'
        ? 'The AI took too long to answer. Try again in a moment.'
        : `Could not reach the AI: ${e.message}`)
    }
    if (res.status === 401 || res.status === 403) throw new LlmError('The AI refused the key. Check LOTUS_API_KEY in the Render dashboard.')
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new LlmError(`The AI answered ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = await res.json().catch(() => null)
    // Some models still wrap a preamble in <think> tags; never show it.
    const text = String(data?.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    if (text) return text
    last = 'The AI returned an empty answer.'
  }
  throw new LlmError(last)
}

/** Pull a JSON object out of an answer that may have text or fences around it. */
export function jsonFrom(text) {
  const t = String(text || '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(t.slice(start, end + 1)) } catch { return null }
}

/*
 * A small allowance per person, so a stuck key on somebody's keyboard cannot
 * spend the team's quota: twenty requests in any minute. In memory — a
 * restart forgives everybody, which is fine for this.
 */
const recent = new Map()
export function allow(who, perMinute = 20) {
  const now = Date.now()
  const list = (recent.get(who) || []).filter((t) => now - t < 60_000)
  if (list.length >= perMinute) { recent.set(who, list); return false }
  list.push(now)
  recent.set(who, list)
  return true
}
