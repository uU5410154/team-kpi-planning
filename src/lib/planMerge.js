/*
 * TWO COPIES OF THE PLAN, FIELD BY FIELD (management design summary:
 * "conflicting browser and server values must be resolved field by field;
 * newer shared data must never be silently replaced").
 *
 * `planDiff(mine, theirs)` lists every field where this browser's plan and
 * the newer shared one disagree: per project (by key), per person (by id),
 * per setting, and any other part of the plan as a whole. `mergePlan` starts
 * from the shared plan and takes this browser's value only for the fields
 * somebody chose "mine" for.
 */

const canon = (v) => JSON.stringify(v ?? null, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
  : x))
const same = (a, b) => canon(a) === canon(b)
const SKIP = new Set(['updatedAt', 'scenarioName'])
const LISTS = { projects: (p) => p.key, people: (p) => p.id }

export const diffId = (d) => `${d.area}|${d.id ?? ''}|${d.field}`

export function planDiff(mine = {}, theirs = {}) {
  const out = []
  for (const [area, keyOf] of Object.entries(LISTS)) {
    const A = new Map((mine[area] || []).map((x) => [keyOf(x), x]))
    const B = new Map((theirs[area] || []).map((x) => [keyOf(x), x]))
    for (const id of new Set([...A.keys(), ...B.keys()])) {
      const a = A.get(id)
      const b = B.get(id)
      const label = (a || b)?.summary || (a || b)?.name || (a || b)?.nick || id
      if (!a || !b) { out.push({ area, id, label, field: '(whole record)', mine: a ?? null, theirs: b ?? null }); continue }
      for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (SKIP.has(f) || same(a[f], b[f])) continue
        out.push({ area, id, label, field: f, mine: a[f] ?? null, theirs: b[f] ?? null })
      }
    }
  }
  const sa = mine.settings || {}
  const sb = theirs.settings || {}
  for (const f of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (!same(sa[f], sb[f])) out.push({ area: 'settings', id: null, label: 'Model settings', field: f, mine: sa[f] ?? null, theirs: sb[f] ?? null })
  }
  for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (k in LISTS || k === 'settings' || SKIP.has(k)) continue
    if (!same(mine[k], theirs[k])) out.push({ area: k, id: null, label: k, field: '(all)', mine: mine[k] ?? null, theirs: theirs[k] ?? null })
  }
  return out
}

/** The shared plan, with this browser's value for every diff chosen "mine". */
export function mergePlan(theirs, diffs, choices) {
  const out = JSON.parse(JSON.stringify(theirs || {}))
  for (const d of diffs) {
    if (choices[diffId(d)] !== 'mine') continue
    if (d.area in LISTS) {
      const keyOf = LISTS[d.area]
      const list = out[d.area] || (out[d.area] = [])
      const i = list.findIndex((x) => keyOf(x) === d.id)
      if (d.field === '(whole record)') {
        if (d.mine == null && i >= 0) list.splice(i, 1)
        else if (d.mine != null && i < 0) list.push(JSON.parse(JSON.stringify(d.mine)))
        else if (d.mine != null) list[i] = JSON.parse(JSON.stringify(d.mine))
      } else if (i >= 0) {
        if (d.mine === null) delete list[i][d.field]
        else list[i][d.field] = JSON.parse(JSON.stringify(d.mine))
      }
    } else if (d.area === 'settings') {
      out.settings = { ...(out.settings || {}) }
      if (d.mine === null) delete out.settings[d.field]
      else out.settings[d.field] = JSON.parse(JSON.stringify(d.mine))
    } else if (d.mine === null) delete out[d.area]
    else out[d.area] = JSON.parse(JSON.stringify(d.mine))
  }
  return out
}

export const showValue = (v) => {
  if (v == null || v === '') return '(empty)'
  if (typeof v === 'object') {
    if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? '' : 's'}`
    const s = JSON.stringify(v)
    return s.length > 120 ? `${s.slice(0, 120)}…` : s
  }
  return String(v)
}

/**
 * THREE-WAY: two saves from the same starting version. `base` is what this
 * browser started from, `theirs` what the shared plan has become since, and
 * `mine` what this browser wants to save. Every field only one side changed
 * is kept as that side has it; a field both changed to different values is a
 * conflict, and so is deleting a record the other side edited. Returns the
 * merged plan (theirs, with my changes applied) and the conflicts.
 */
export function merge3(base = {}, theirs = {}, mine = {}) {
  const mineCh = planDiff(mine, base)
  const theirsCh = new Map(planDiff(theirs, base).map((d) => [diffId(d), d]))
  const theirsIds = new Set([...theirsCh.values()].map((d) => `${d.area}|${d.id ?? ''}`))
  const theirsWhole = new Set([...theirsCh.values()].filter((d) => d.field === '(whole record)').map((d) => `${d.area}|${d.id ?? ''}`))
  const conflicts = []
  const apply = []
  for (const d of mineCh) {
    const rec = `${d.area}|${d.id ?? ''}`
    const t = theirsCh.get(diffId(d))
    const clash = (t && !same(t.mine, d.mine))
      || (d.field === '(whole record)' && !t && theirsIds.has(rec))
      || (d.field !== '(whole record)' && theirsWhole.has(rec))
    if (clash) conflicts.push({ area: d.area, id: d.id, label: d.label, field: d.field, mine: d.mine, theirs: t ? t.mine : null })
    else apply.push(d)
  }
  const merged = mergePlan(theirs, apply, Object.fromEntries(apply.map((d) => [diffId(d), 'mine'])))
  return { merged, conflicts, applied: apply.length }
}
