import { connect, UNAVAILABLE } from './db.js'
import * as weekly from './weekly.js'
import * as jira from './jira.js'

/**
 * THE GOVERNANCE RECORDS (management design summary, November 2026).
 *
 * What the register does not hold and management asked for, entered by an
 * administrator and kept on the server, never in the shared plan: the plan is
 * readable by every signed-in member, and role rates and budgets are
 * confidential.
 *
 *   records   one document per thing: `rates` (the role-rate table, each
 *             member's role and allocation), `project:<key>` (approved
 *             budget, cost lines, labour forecast, benefit validation),
 *             `worklogs` (the last read of Jira's time logs)
 *   raid      risks, assumptions, issues, dependencies and decisions
 *   audit     every field anybody changed, from what to what, by whom, when —
 *             here and in the shared plan
 *   snapshots a Management Pack or a review period, frozen as it was issued
 *
 * EDITS ARE FIELD BY FIELD. A change says what the field was when the editor
 * saw it and what it should be; if somebody else has changed that field in
 * between, the save is refused for that field and both values are handed back
 * to be chosen between. Newer shared data is never silently replaced.
 */

const cfg = () => ({
  records: process.env.MONGODB_GOV_COLLECTION || 'kpi_governance',
  raid: process.env.MONGODB_RAID_COLLECTION || 'kpi_raid',
  audit: process.env.MONGODB_AUDIT_COLLECTION || 'kpi_audit',
  snapshots: process.env.MONGODB_SNAPSHOT_COLLECTION || 'kpi_snapshots',
  updates: process.env.MONGODB_TASK_UPDATES_COLLECTION || 'kpi_task_updates',
  decisions: process.env.MONGODB_DECISIONS_COLLECTION || 'kpi_decisions',
})

let colls = null
async function c() {
  const db = await connect()
  if (!db) return null
  if (!colls) {
    const d = db.s.db
    const k = cfg()
    colls = {
      records: d.collection(k.records),
      raid: d.collection(k.raid),
      audit: d.collection(k.audit),
      snapshots: d.collection(k.snapshots),
      updates: d.collection(k.updates),
      decisions: d.collection(k.decisions),
    }
    await colls.audit.createIndex({ at: -1 })
    await colls.audit.createIndex({ kind: 1, key: 1, at: -1 })
    await colls.snapshots.createIndex({ kind: 1, at: -1 })
  }
  return colls
}

const fail = (status, error, extra = {}) => ({ status, error, ...extra })

/* ------------------------------------------------------------ cleaning */

const str = (v, n = 300) => String(v ?? '').trim().slice(0, n)
const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const x = Number(String(v).replace(/[,\s฿]/g, ''))
  return Number.isFinite(x) ? x : null
}
const pos = (v) => { const x = num(v); return x == null ? null : Math.max(0, x) }
const pct = (v) => { const x = num(v); return x == null ? null : Math.min(100, Math.max(0, x)) }
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null)
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt)
const slug = (v, i) => (str(v, 40).replace(/[^A-Za-z0-9_-]/g, '') || `r${i + 1}`)

export const RATE_TYPES = ['internal', 'it', 'partner', 'external']
export const RATE_STATUS = ['draft', 'approved', 'superseded', 'inactive']
export const COST_CATEGORIES = ['vendor', 'software', 'infrastructure', 'other']
export const BENEFIT_STATES = ['estimated', 'approved', 'implemented', 'validated', 'realized']
export const RAID_TYPES = ['risk', 'assumption', 'issue', 'dependency', 'decision']

export function cleanRates(r = {}) {
  const roles = (Array.isArray(r.roles) ? r.roles : []).slice(0, 60).map((x, i) => ({
    id: slug(x?.id, i),
    name: str(x?.name, 80) || `Role ${i + 1}`,
    rateType: oneOf(x?.rateType, RATE_TYPES, 'internal'),
    hourlyRate: pos(x?.hourlyRate),
    effectiveFrom: day(x?.effectiveFrom),
    effectiveTo: day(x?.effectiveTo),
    inclusions: str(x?.inclusions, 400),
    status: oneOf(x?.status, RATE_STATUS, 'draft'),
  }))
  const people = {}
  for (const [id, v] of Object.entries(r.people && typeof r.people === 'object' ? r.people : {}).slice(0, 200)) {
    const k = str(id, 60)
    if (!k) continue
    people[k] = {
      role: str(v?.role, 40) || null,
      level: str(v?.level, 40) || null,
      project: pct(v?.project),
      bau: pct(v?.bau),
      support: pct(v?.support),
      unplanned: pct(v?.unplanned),
    }
  }
  const overrides = (Array.isArray(r.overrides) ? r.overrides : []).slice(0, 200).map((x, i) => ({
    id: slug(x?.id, i),
    projectKey: str(x?.projectKey, 40),
    role: str(x?.role, 40),
    hourlyRate: pos(x?.hourlyRate),
    reason: str(x?.reason, 400),
    approvedBy: str(x?.approvedBy, 120),
    status: oneOf(x?.status, ['pending', 'approved', 'rejected'], 'pending'),
  })).filter((x) => x.projectKey && x.role)
  return { roles, people, overrides, defaultRole: str(r.defaultRole, 40) || null }
}

export function cleanProject(p = {}) {
  const b = p.budget || {}
  const ben = p.benefit || {}
  const costs = (Array.isArray(p.costs) ? p.costs : []).slice(0, 80).map((x, i) => ({
    id: slug(x?.id, i),
    category: oneOf(x?.category, COST_CATEGORIES, 'other'),
    label: str(x?.label, 160) || 'Cost',
    supplier: str(x?.supplier, 160),
    ref: str(x?.ref, 160),
    kind: oneOf(x?.kind, ['capex', 'opex'], 'opex'),
    recurring: x?.recurring === true,
    forecast: pos(x?.forecast),
    actual: pos(x?.actual),
    monthly: pos(x?.monthly),
  }))
  const labour = (Array.isArray(p.labour) ? p.labour : []).slice(0, 30).map((x) => ({
    role: str(x?.role, 40),
    forecastHours: pos(x?.forecastHours),
  })).filter((x) => x.role)
  return {
    budget: {
      approved: pos(b.approved),
      // The first approved figure, kept for good: the baseline budget.
      original: pos(b.original),
      approvedBy: str(b.approvedBy, 120),
      approvedAt: day(b.approvedAt),
      note: str(b.note, 600),
    },
    costs,
    labour,
    remainingHours: pos(p.remainingHours),
    benefit: {
      state: oneOf(ben.state, BENEFIT_STATES, 'estimated'),
      baselineProcess: str(ben.baselineProcess, 1000),
      expectedHours: pos(ben.expectedHours),
      actualHours: pos(ben.actualHours),
      monetary: pos(ben.monetary),
      owner: str(ben.owner, 120),
      validator: str(ben.validator, 120),
      validatedAt: day(ben.validatedAt),
      startDate: day(ben.startDate),
      recurringCost: pos(ben.recurringCost),
      confidence: oneOf(ben.confidence, ['low', 'medium', 'high'], null),
      evidence: str(ben.evidence, 2000),
      soft: str(ben.soft, 1000),
      softMethod: str(ben.softMethod, 600),
    },
  }
}

const RECORD_KIND = { rates: cleanRates, project: cleanProject }
const kindOf = (id) => (id === 'rates' ? 'rates' : id.startsWith('project:') ? 'project' : null)

/* -------------------------------------------------------- field paths */

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
function setPath(obj, path, value) {
  const keys = path.split('.')
  let o = obj
  for (const k of keys.slice(0, -1)) {
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {}
    o = o[k]
  }
  o[keys[keys.length - 1]] = value
}
/** Two values the same, whatever order an object's keys came in. */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
  : x)) ?? 'null'
const same = (a, b) => canon(a ?? null) === canon(b ?? null)
const PATH = /^[A-Za-z][A-Za-z0-9_-]{0,40}(\.[A-Za-z0-9_-]{1,60}){0,2}$/
const short = (v) => {
  const s = canon(v ?? null)
  return s.length > 400 ? `${s.slice(0, 400)}…` : s
}

/* -------------------------------------------------------------- audit */

async function record(k, entries) {
  if (!entries.length) return
  await k.audit.insertMany(entries.slice(0, 1000).map((e) => ({ ...e, at: e.at || new Date().toISOString() })))
}

export async function auditLog({ kind = null, key = null, limit = 200, before = null } = {}) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const q = {}
  if (kind) q.kind = kind
  if (key) q.key = key
  if (before) q.at = { $lt: before }
  const rows = await k.audit.find(q, { projection: { _id: 0 } }).sort({ at: -1 }).limit(Math.min(1000, Math.max(1, Number(limit) || 200))).toArray()
  return { rows }
}

/* ------------------------------------------------------------ records */

export async function all() {
  const k = await c()
  if (!k) return UNAVAILABLE
  const docs = await k.records.find({}).toArray()
  const out = { rates: { ...cleanRates({}), version: 0 }, projects: {}, worklogs: null }
  for (const d of docs) {
    if (d._id === 'rates') out.rates = { ...cleanRates(d.data), version: d.version || 0, updatedAt: d.updatedAt, updatedBy: d.updatedBy }
    else if (d._id === 'worklogs') out.worklogs = d.data
    else if (String(d._id).startsWith('project:')) {
      out.projects[d._id.slice(8)] = { ...cleanProject(d.data), version: d.version || 0, updatedAt: d.updatedAt, updatedBy: d.updatedBy }
    }
  }
  out.blocked = await blockedWeeks(k)
  return out
}

/**
 * Change one record, field by field.
 *
 * `changes` is [{ path, from, to }]: `from` is what the editor saw. A field
 * somebody else changed since is a CONFLICT, and nothing is written; the
 * answer lists each one with both values. `force` names the paths the editor
 * has looked at and chosen to overwrite anyway.
 */
export async function save(id, changes, by, { force = [], reason = '' } = {}) {
  const kind = kindOf(String(id || ''))
  if (!kind) return fail(400, 'Unknown record.')
  if (kind === 'project' && !/^project:[A-Za-z0-9_-]{1,40}$/.test(id)) return fail(400, 'Unknown project.')
  if (!Array.isArray(changes) || !changes.length) return fail(400, 'Nothing to change.')
  const k = await c()
  if (!k) return UNAVAILABLE

  const doc = await k.records.findOne({ _id: id })
  const current = RECORD_KIND[kind](doc?.data || {})
  const next = JSON.parse(JSON.stringify(current))
  const conflicts = []
  const applied = []
  for (const ch of changes.slice(0, 100)) {
    const path = String(ch?.path || '')
    if (!PATH.test(path)) return fail(400, `Cannot change "${path}".`)
    const theirs = getPath(current, path)
    if (!same(theirs, ch.from) && !same(theirs, ch.to) && !force.includes(path)) {
      conflicts.push({ path, yours: ch.to ?? null, theirs: theirs ?? null, was: ch.from ?? null })
      continue
    }
    setPath(next, path, ch.to)
    applied.push(path)
  }
  if (conflicts.length) {
    return fail(409, 'Somebody else changed this since you opened it. Choose which value to keep.', {
      conflicts, updatedBy: doc?.updatedBy || null, updatedAt: doc?.updatedAt || null,
    })
  }
  const clean = RECORD_KIND[kind](next)
  // The baseline budget is set once, by the first approval, and never moves.
  if (kind === 'project') {
    if (current.budget.original != null) clean.budget.original = current.budget.original
    else if (clean.budget.approved != null) clean.budget.original = clean.budget.approved
  }
  const at = new Date().toISOString()
  const version = (doc?.version || 0) + 1
  await k.records.updateOne({ _id: id }, { $set: { data: clean, version, updatedAt: at, updatedBy: by } }, { upsert: true })
  const key = kind === 'project' ? id.slice(8) : 'rates'
  await record(k, applied
    .filter((p) => !same(getPath(current, p), getPath(clean, p)))
    .map((p) => ({ kind, key, field: p, from: short(getPath(current, p)), to: short(getPath(clean, p)), by, at, reason: str(reason, 300) })))
  return { record: { ...clean, version, updatedAt: at, updatedBy: by } }
}

/* --------------------------------------------------------------- raid */

export function cleanRaid(x = {}) {
  return {
    type: oneOf(x.type, RAID_TYPES, 'risk'),
    title: str(x.title, 240),
    detail: str(x.detail, 3000),
    projectKey: str(x.projectKey, 40) || null,
    owner: str(x.owner, 120),
    due: day(x.due),
    severity: oneOf(x.severity, ['low', 'medium', 'high', 'critical'], 'medium'),
    likelihood: oneOf(x.likelihood, ['low', 'medium', 'high'], null),
    status: oneOf(x.status, ['open', 'in_progress', 'decided', 'closed'], 'open'),
    action: str(x.action, 2000),
    recommendation: str(x.recommendation, 2000),
    approver: str(x.approver, 120),
    decision: str(x.decision, 2000),
    decidedAt: day(x.decidedAt),
    exposure: {
      cost: pos(x.exposure?.cost),
      days: pos(x.exposure?.days),
      benefit: pos(x.exposure?.benefit),
      resource: str(x.exposure?.resource, 300),
    },
  }
}

export async function raidList() {
  const k = await c()
  if (!k) return UNAVAILABLE
  const items = await k.raid.find({}).sort({ createdAt: -1 }).limit(1000).toArray()
  // Decisions asked for in the weekly check-in are on the list too, read only.
  const asked = await k.decisions.find({}).sort({ createdAt: -1 }).limit(300).toArray().catch(() => [])
  return {
    items: items.map(({ _id, ...x }) => ({ id: String(_id), ...x })),
    weekly: asked.map((d) => ({
      id: String(d._id),
      projectKey: d.projectKey || null,
      jiraKey: d.jiraKey || null,
      summary: d.summary || '',
      week: d.week || null,
      text: d.text || '',
      nick: d.nick || d.person || '',
      askedAt: d.createdAt || null,
      status: d.status || 'open',
      decidedBy: d.decidedBy || null,
      note: d.note || '',
      decidedAt: d.decidedAt || null,
    })),
  }
}

export async function raidSave(id, body, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const clean = cleanRaid(body?.item || {})
  if (!clean.title) return fail(400, 'Give it a title.')
  const at = new Date().toISOString()
  if (!id) {
    const _id = `raid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    await k.raid.insertOne({ _id, ...clean, version: 1, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by })
    await record(k, [{ kind: 'raid', key: _id, field: 'created', from: 'null', to: short(clean.title), by, at }])
    return { item: { id: _id, ...clean, version: 1, createdAt: at, createdBy: by, updatedAt: at, updatedBy: by } }
  }
  const doc = await k.raid.findOne({ _id: id })
  if (!doc) return fail(404, 'That item is gone.')
  // Field by field against what the editor saw.
  const seen = body?.seen ? cleanRaid(body.seen) : null
  const force = Array.isArray(body?.force) ? body.force : []
  const cur = cleanRaid(doc)
  const conflicts = []
  if (seen) {
    for (const f of Object.keys(clean)) {
      if (!same(cur[f], seen[f]) && !same(cur[f], clean[f]) && !force.includes(f)) {
        conflicts.push({ path: f, yours: clean[f], theirs: cur[f], was: seen[f] })
      }
    }
  }
  if (conflicts.length) return fail(409, 'Somebody else changed this since you opened it. Choose which value to keep.', { conflicts, updatedBy: doc.updatedBy, updatedAt: doc.updatedAt })
  const version = (doc.version || 0) + 1
  await k.raid.updateOne({ _id: id }, { $set: { ...clean, version, updatedAt: at, updatedBy: by } })
  await record(k, Object.keys(clean).filter((f) => !same(cur[f], clean[f]))
    .map((f) => ({ kind: 'raid', key: id, field: f, from: short(cur[f]), to: short(clean[f]), by, at })))
  return { item: { id, ...clean, version, createdAt: doc.createdAt, createdBy: doc.createdBy, updatedAt: at, updatedBy: by } }
}

/* ---------------------------------------------------------- snapshots */

export async function snapshotSave(kind, body, by) {
  const k = await c()
  if (!k) return UNAVAILABLE
  if (!['pack', 'review'].includes(kind)) return fail(400, 'Unknown snapshot.')
  const data = body?.data
  const size = JSON.stringify(data || null).length
  if (!data || size > 3_000_000) return fail(400, 'Nothing to keep, or too much.')
  const at = new Date().toISOString()
  const _id = `${kind}-${at}`
  await k.snapshots.insertOne({ _id, kind, label: str(body?.label, 160), period: str(body?.period, 80), at, by, data })
  await record(k, [{ kind: 'snapshot', key: _id, field: kind, from: 'null', to: short(body?.label || kind), by, at }])
  return { snapshot: { id: _id, kind, label: str(body?.label, 160), period: str(body?.period, 80), at, by } }
}

export async function snapshotList(kind) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const rows = await k.snapshots.find({ kind }, { projection: { data: 0 } }).sort({ at: -1 }).limit(100).toArray()
  return { snapshots: rows.map(({ _id, ...x }) => ({ id: _id, ...x })) }
}

export async function snapshotGet(id) {
  const k = await c()
  if (!k) return UNAVAILABLE
  const d = await k.snapshots.findOne({ _id: String(id) })
  if (!d) return fail(404, 'No such snapshot.')
  const { _id, ...x } = d
  return { snapshot: { id: _id, ...x } }
}

/* ----------------------------------------------- blocked, from the week */

/**
 * The weeks somebody reported a project blocked or on hold, from the weekly
 * check-in: counted per project as distinct weeks, and as working days at
 * five a week. An approximation, and named as one on the page: the check-in
 * says a week was blocked, not for how many of its days.
 */
async function blockedWeeks(k) {
  const rows = await k.updates.find(
    { $or: [{ blocker: { $nin: [null, ''] } }, { hold: true }] },
    { projection: { week: 1, projectKey: 1, epicKey: 1, jiraKey: 1, blocker: 1, hold: 1 } },
  ).limit(20000).toArray().catch(() => [])
  const by = {}
  for (const r of rows) {
    for (const key of new Set([r.projectKey, r.epicKey].filter(Boolean))) {
      by[key] ||= { weeks: new Set(), last: null, lastBlocker: '' }
      by[key].weeks.add(r.week)
      if (!by[key].last || r.week > by[key].last) { by[key].last = r.week; by[key].lastBlocker = r.blocker || (r.hold ? 'On hold' : '') }
    }
  }
  return Object.fromEntries(Object.entries(by).map(([key, v]) => [key, { weeks: v.weeks.size, days: v.weeks.size * 5, last: v.last, lastBlocker: v.lastBlocker }]))
}

/* ------------------------------------------------------------ worklogs */

let running = null
/**
 * Read every keyed project's worklogs from Jira and keep the totals. One run
 * at a time; a second call while one runs waits for that one.
 */
export async function syncWorklogs({ trigger = 'manual' } = {}) {
  if (running) return running
  running = (async () => {
    const k = await c()
    if (!k) return UNAVAILABLE
    const r = await weekly.roster()
    if (r === UNAVAILABLE) return UNAVAILABLE
    const keys = r.projects.map((p) => p.jiraKey).filter(Boolean)
    let data
    try {
      const got = await jira.worklogsOf(keys)
      if (got === jira.UNAVAILABLE) return fail(409, 'Jira is not connected on the server.')
      data = { ...got, ok: true, trigger, projects: keys.length }
    } catch (e) {
      const prev = await k.records.findOne({ _id: 'worklogs' })
      data = { ...(prev?.data || {}), ok: false, error: e.message, failedAt: new Date().toISOString(), trigger }
    }
    await k.records.updateOne({ _id: 'worklogs' }, { $set: { data, updatedAt: new Date().toISOString() } }, { upsert: true })
    return { worklogs: data }
  })()
  try { return await running } finally { running = null }
}

/* -------------------------------------------- audit of the shared plan */

const PLAN_SKIP = new Set(['updatedAt', '_derived'])
/**
 * What changed between two saves of the shared plan, field by field: per
 * project (by key) and per person (by id), plus the settings. Kept in the
 * audit trail, so "who moved this date" has an answer.
 */
export function diffPlan(before, after, by) {
  const at = new Date().toISOString()
  const out = []
  const side = (list, keyOf) => new Map((Array.isArray(list) ? list : []).map((x) => [keyOf(x), x]))
  const walk = (kind, a, b, keyOf) => {
    const A = side(a, keyOf)
    const B = side(b, keyOf)
    for (const [key, nb] of B) {
      const na = A.get(key)
      if (!na) { out.push({ kind, key, field: 'added', from: 'null', to: short(nb.name || nb.summary || nb.nick || key), by, at }); continue }
      for (const f of new Set([...Object.keys(na), ...Object.keys(nb)])) {
        if (PLAN_SKIP.has(f)) continue
        if (!same(na[f], nb[f])) out.push({ kind, key, field: f, from: short(na[f]), to: short(nb[f]), by, at })
      }
    }
    for (const [key, na] of A) if (!B.has(key)) out.push({ kind, key, field: 'removed', from: short(na.name || na.summary || na.nick || key), to: 'null', by, at })
  }
  walk('plan.project', before?.projects, after?.projects, (p) => p.key)
  walk('plan.person', before?.people, after?.people, (p) => p.id)
  const sa = before?.settings || {}
  const sb = after?.settings || {}
  for (const f of new Set([...Object.keys(sa), ...Object.keys(sb)])) {
    if (!same(sa[f], sb[f])) out.push({ kind: 'plan.settings', key: 'settings', field: f, from: short(sa[f]), to: short(sb[f]), by, at })
  }
  return out
}

export async function auditPlan(before, after, by) {
  const k = await c()
  if (!k || !before) return
  try { await record(k, diffPlan(before, after, by)) } catch (e) { console.warn(`[audit] ${e.message}`) }
}
