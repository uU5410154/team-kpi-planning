import { METRICS, dataQuality, deliveryOf, inBook, overviewOf } from './governance.js'
import { portfolioCosts, capacityOf, VALIDATED } from './costs.js'

/*
 * THE MANAGEMENT PACK (management design summary, Priority 2).
 *
 * One report a steering meeting can be run from, built from the same figures
 * as every other page, so nobody consolidates anything by hand:
 *
 *   executive summary    the eight Management overview headlines
 *   material changes     what moved since the previous issued pack, and only
 *                        what moved enough to matter (thresholds below)
 *   strategic outcomes   saving hours in the plan against the year's target
 *   roadmap              what is due in the next 90 days, with its forecast
 *   delivery             the largest slips, with what is being done about them
 *   finance              budget, actual, EAC, and ROI forecast / projected /
 *                        validated
 *   benefits, capacity   validated benefits; people over capacity
 *   decisions            what management is asked to decide
 *   data confidence      what the figures cannot be trusted for yet
 *
 * Plain data only, so an issued pack can be kept as a snapshot and a later
 * pack compared with it. Every pack carries its reporting period, filters,
 * refresh times and the metric definitions it was built on.
 */

/**
 * WHAT COUNTS AS MATERIAL. A change below these is not reported as a change.
 *
 *   ratio      a share or a return moving by at least this many points
 *              (0.05 = 5 percentage points; ROI uses 10 points)
 *   money      at least this share of the earlier figure AND at least
 *              `moneyFloor` baht — a 50% swing on ฿2,000 is not news
 *   md         capacity variance moving by at least this many man-days
 *   count      the active portfolio changing by at least this many projects
 *   slip       a project's slip growing by more than the delivery tolerance
 *              (the Model page's sprint days), so ordinary noise is not news
 */
export const MATERIAL = {
  ratio: 0.05,
  roi: 0.10,
  money: 0.10,
  moneyFloor: 100000,
  md: 10,
  count: 1,
}

/** How each headline is measured, for comparing and for showing. */
export const HEADLINE_KIND = {
  active: 'count',
  reliability: 'ratio',
  capacity: 'md',
  eac: 'money',
  budget: 'money',
  projectedRoi: 'roi',
  actualRoi: 'roi',
  confidence: 'ratio',
}
export const HEADLINE_IDS = Object.keys(HEADLINE_KIND)

/** The days a roadmap looks ahead. */
export const ROADMAP_DAYS = 90

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const r2 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 100) / 100)

/** Did a headline move enough to report? `a` is before, `b` after. */
export function materialMove(kind, a, b) {
  if (a == null && b == null) return false
  if (a == null || b == null) return true // appeared, or can no longer be stated
  const d = b - a
  if (kind === 'count') return Math.abs(d) >= MATERIAL.count
  if (kind === 'ratio') return Math.abs(d) >= MATERIAL.ratio - 1e-9
  if (kind === 'roi') return Math.abs(d) >= MATERIAL.roi - 1e-9
  if (kind === 'md') return Math.abs(d) >= MATERIAL.md
  if (kind === 'money') return Math.abs(d) >= MATERIAL.moneyFloor && (a === 0 || Math.abs(d) / Math.abs(a) >= MATERIAL.money - 1e-9)
  return d !== 0
}

/** The pack, from the computed plan and the administrator's records. */
export function packOf(plan, gov, {
  quality = null, raid = null, previous = null, period = '', filters = {}, refreshed = {}, now = new Date().toISOString(),
} = {}) {
  const s = plan?.settings || {}
  const asOf = s.asOfDate || now.slice(0, 10)
  const tolerance = s.sprintDays ?? 14
  const q = quality || dataQuality(plan, { gov })
  const money = portfolioCosts(plan, gov)
  const cap = capacityOf(plan, gov)
  const o = overviewOf(plan, q, money, cap)
  const gate = plan?.finance?.roiGate ?? 2
  const book = (plan?.projects || []).filter(inBook)
  const costBy = Object.fromEntries(money.rows.map((r) => [r.key, r]))
  const capBy = Object.fromEntries(cap.projects.map((r) => [r.key, r]))
  const raidItems = raid?.items || []
  const openRaid = raidItems.filter((x) => x.status === 'open' || x.status === 'in_progress')

  // ---- executive summary: the eight headlines, as plain values
  const headline = {}
  for (const id of HEADLINE_IDS) {
    const h = o.headline[id] || {}
    headline[id] = { value: h.value ?? null, note: h.note || null, gap: h.gap || null, scored: h.scored ?? null }
  }

  // ---- each project, as it stands (what a later pack compares with)
  const projects = {}
  for (const p of book) {
    const d = deliveryOf(p, asOf, tolerance)
    const c = costBy[p.key] || {}
    const k = capBy[p.key] || {}
    projects[p.key] = {
      name: p.summary || p.name || p.key,
      pic: p.pic || null,
      status: p.status || null,
      done: d.done,
      baseline: d.baseline,
      forecast: d.forecast,
      slip: d.slip,
      onHold: !!p.onHold,
      budget: c.budget ?? null,
      eac: r2(c.eac),
      variance: r2(c.variance),
      projectedRoi: r2(c.projectedRoi),
      benefitState: c.benefitState || 'estimated',
      blockedDays: k.blockedDays || 0,
      lastBlocker: k.lastBlocker || '',
    }
  }

  // ---- strategic outcomes
  const t = plan?.totals || {}
  const strategic = {
    target: t.target ?? s.targetHours ?? null,
    committedHours: t.committedHours ?? null,
    stretchHours: t.stretchHours ?? null,
    totalHours: t.totalHours ?? null,
    coverage: t.target > 0 && t.totalHours != null ? t.totalHours / t.target : (t.totalCoverage ?? null),
    delivered: book.filter((p) => p.status === 'Done').length,
    inProgress: book.filter((p) => /progress/i.test(p.status || '')).length,
    projects: book.length,
  }

  // ---- roadmap: forecast to land in the next 90 days
  const horizon = addDays(asOf, ROADMAP_DAYS)
  const roadmap = book
    .map((p) => ({ key: p.key, ...projects[p.key] }))
    .filter((x) => !x.done && x.forecast && x.forecast >= asOf && x.forecast <= horizon)
    .sort((a, b) => a.forecast.localeCompare(b.forecast))
    .map((x) => ({ key: x.key, name: x.name, pic: x.pic, baseline: x.baseline, forecast: x.forecast, slip: x.slip, status: x.status }))

  // ---- delivery: the biggest slips, with what is being done about them
  const recoveryOf = (key) => openRaid.filter((x) => x.projectKey === key && x.action).map((x) => x.action)
  const delays = o.delivery.delays.map(({ p, d }) => ({
    key: p.key,
    name: p.summary || p.name || p.key,
    pic: p.pic || null,
    baseline: d.baseline,
    forecast: d.forecast,
    actual: d.actual,
    slip: d.slip,
    done: d.done,
    recovery: recoveryOf(p.key),
    blocker: capBy[p.key]?.lastBlocker || '',
  }))
  const delivery = {
    scored: o.delivery.scored,
    onTime: o.delivery.onTime,
    late: o.delivery.late,
    slipping: o.delivery.slipping,
    medianSlip: o.delivery.medianSlip,
    repeatReplans: o.delivery.repeatReplans.map((p) => ({ key: p.key, name: p.summary || p.key, replans: Number(p.replanCount) || 0 })),
    delays,
    tolerance,
  }

  // ---- finance
  const finance = {
    totals: Object.fromEntries(Object.entries(money.totals).map(([k, v]) => [k, r2(v)])),
    coverage: { ...money.coverage },
    byCategory: money.byCategory,
    horizon: money.horizon,
    gate,
    overBudget: money.rows.filter((r) => r.variance > 0).sort((a, b) => b.variance - a.variance)
      .map((r) => ({ key: r.key, name: r.name, budget: r.budget, eac: r2(r.eac), variance: r2(r.variance) })),
    belowGate: money.rows.filter((r) => r.projectedRoi != null && r.projectedRoi < gate).sort((a, b) => a.projectedRoi - b.projectedRoi)
      .map((r) => ({ key: r.key, name: r.name, projectedRoi: r2(r.projectedRoi), eac: r2(r.eac) })),
  }

  // ---- benefits and capacity
  const byState = {}
  for (const r of money.rows) byState[r.benefitState] = (byState[r.benefitState] || 0) + 1
  const benefits = {
    byState,
    validated: money.rows.filter((r) => VALIDATED.has(r.benefitState) && r.validatedBenefit != null)
      .map((r) => ({ key: r.key, name: r.name, state: r.benefitState, validatedBenefit: r2(r.validatedBenefit), actualRoi: r2(r.actualRoi) })),
    validatedTotal: r2(money.totals.validatedBenefit),
  }
  const capacity = {
    over: cap.people.filter((x) => x.warning === 'over').map((x) => ({ id: x.id, nick: x.nick, peak: r2(x.peak), remaining: Math.round(x.remaining), projects: x.projects })),
    high: cap.people.filter((x) => x.warning === 'high').map((x) => ({ id: x.id, nick: x.nick, peak: r2(x.peak) })),
    totals: { planned: Math.round(cap.totals.planned), actual: cap.totals.actual == null ? null : Math.round(cap.totals.actual), remaining: Math.round(cap.totals.remaining), blockedDays: cap.totals.blockedDays },
  }

  // ---- decisions required
  const decisions = [
    ...raidItems.filter((x) => x.type === 'decision' && (x.status === 'open' || x.status === 'in_progress')).map((x) => ({
      source: 'raid', id: x.id, title: x.title, projectKey: x.projectKey, owner: x.owner, due: x.due, approver: x.approver,
      recommendation: x.recommendation, exposure: x.exposure || null, severity: x.severity,
    })),
    ...(raid?.weekly || []).filter((x) => x.status === 'open').map((x) => ({
      source: 'weekly', id: x.id, title: x.text, projectKey: x.projectKey, owner: x.nick, due: null, approver: null,
      recommendation: '', exposure: null, severity: null, jiraKey: x.jiraKey, askedAt: x.askedAt,
    })),
  ]

  // ---- what the data cannot support
  const confidence = {
    score: q.confidence.score,
    verdict: q.confidence.verdict,
    parts: q.confidence.parts,
    failing: q.checks.filter((c) => c.rows.length && c.id !== 'deleted')
      .map((c) => ({ id: c.id, label: c.label, severity: c.severity, count: c.rows.length }))
      .sort((a, b) => b.count - a.count),
    sources: q.global.filter((g) => !g.ok).map((g) => ({ id: g.id, label: g.label, text: g.text })),
  }

  // ---- the watchlist
  const watch = new Map()
  const flag = (key, why) => {
    const x = projects[key]
    if (!x || x.done) return
    if (!watch.has(key)) watch.set(key, { key, name: x.name, pic: x.pic, reasons: [] })
    watch.get(key).reasons.push(why)
  }
  for (const r of finance.overBudget) flag(r.key, 'over budget')
  for (const r of finance.belowGate) flag(r.key, 'below the return gate')
  for (const [key, x] of Object.entries(projects)) {
    if (x.slip != null && x.slip > tolerance) flag(key, `${x.slip} days late`)
    if (x.blockedDays > 0) flag(key, 'blocked')
  }
  const watchlist = [...watch.values()].sort((a, b) => b.reasons.length - a.reasons.length)

  const pack = {
    meta: {
      period: period || '',
      generatedAt: now,
      asOf,
      filters: { scope: "The team's own projects: in the plan, not deleted, not delivered by IT or the business.", ...filters },
      refreshed: {
        plan: refreshed.plan || null,
        jira: refreshed.jira || null,
        worklogs: refreshed.worklogs || gov?.worklogs?.at || null,
      },
      material: { ...MATERIAL, slipDays: tolerance },
      definitions: METRICS.map((m) => ({ id: m.id, label: m.label, definition: m.definition, formula: m.formula, includes: m.includes, source: m.source })),
      previous: previous?.meta ? { period: previous.meta.period, generatedAt: previous.meta.generatedAt } : null,
    },
    headline,
    projects,
    strategic,
    roadmap,
    delivery,
    finance,
    benefits,
    capacity,
    decisions,
    confidence,
    watchlist,
  }
  pack.changes = changesSince(previous, pack)
  return pack
}

/**
 * What changed, materially, between two packs. Null when there is no earlier
 * pack to compare with.
 */
export function changesSince(prev, pack) {
  if (!prev?.headline || !prev?.projects) return null
  const tolerance = pack.meta.material.slipDays
  const headline = []
  for (const id of HEADLINE_IDS) {
    const a = prev.headline[id]?.value ?? null
    const b = pack.headline[id]?.value ?? null
    if (materialMove(HEADLINE_KIND[id], a, b)) headline.push({ id, kind: HEADLINE_KIND[id], from: a, to: b })
  }
  const projects = []
  const add = (key, x, what, from, to) => projects.push({ key, name: x.name, what, from: from ?? null, to: to ?? null })
  for (const [key, b] of Object.entries(pack.projects)) {
    const a = prev.projects[key]
    if (!a) { add(key, b, 'added', null, b.status); continue }
    if (a.status !== b.status) add(key, b, 'status', a.status, b.status)
    if (b.slip != null && (b.slip - (a.slip ?? 0)) > tolerance) add(key, b, 'slipped', a.slip, b.slip)
    if (b.variance > 0 && !(a.variance > 0)) add(key, b, 'over budget', a.variance, b.variance)
    if (a.benefitState !== b.benefitState) add(key, b, 'benefit', a.benefitState, b.benefitState)
    if (b.blockedDays > (a.blockedDays || 0)) add(key, b, 'blocked', a.blockedDays || 0, b.blockedDays)
  }
  for (const [key, a] of Object.entries(prev.projects)) if (!pack.projects[key]) add(key, a, 'removed', a.status, null)
  const money = (k) => {
    const a = prev.finance?.totals?.[k] ?? null
    const b = pack.finance?.totals?.[k] ?? null
    return materialMove('money', a, b) ? { id: k, from: a, to: b } : null
  }
  const financial = ['budget', 'actualTotal', 'eac', 'variance'].map(money).filter(Boolean)
  return { since: prev.meta || null, headline, projects, financial, count: headline.length + projects.length + financial.length }
}

/**
 * The board's version: material changes, strategic outcomes, the major
 * financial movements, the decisions it must take, the roadmap and the
 * watchlist. Nothing else.
 */
export function boardSummary(pack) {
  return {
    meta: pack.meta,
    changes: pack.changes,
    strategic: pack.strategic,
    financial: {
      totals: pack.finance.totals,
      moves: pack.changes?.financial || [],
      overBudget: pack.finance.overBudget,
      belowGate: pack.finance.belowGate,
      horizon: pack.finance.horizon,
      gate: pack.finance.gate,
    },
    decisions: pack.decisions,
    roadmap: pack.roadmap,
    watchlist: pack.watchlist,
  }
}
