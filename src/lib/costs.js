import { personForJiraName, isDate, daysBetween } from './model.js'
import { inBook } from './governance.js'

/*
 * COST, RETURN AND CAPACITY (management design summary, Priority 1).
 *
 * Pure arithmetic over three inputs, so the Cost & ROI page, the Capacity
 * page, the Management overview and the Management Pack always agree:
 *
 *   plan   the computed register (lib/model computePlan): projects with their
 *          mandays, CAPEX, OPEX and estimated benefit, the people, the rates
 *   gov    the administrator's records from the server: the role-rate table,
 *          each member's role and allocation, each project's approved budget,
 *          cost lines, labour forecast and benefit validation; Jira's worklogs
 *   asOf   today, as the register reckons it
 *
 * A figure that cannot be worked out is null, with the reason in `gaps` —
 * never a zero standing in for "not known".
 */

export const COST_CATEGORY_LABEL = {
  labour: 'Labour', vendor: 'Vendor', software: 'Software and cloud', infrastructure: 'Infrastructure', other: 'Other',
}
export const BENEFIT_STATE_LABEL = {
  estimated: 'Estimated',
  approved: 'Business case approved',
  implemented: 'Implementation confirmed',
  validated: 'Post-stabilisation validated',
  realized: 'Realised',
}
export const BENEFIT_STATES = Object.keys(BENEFIT_STATE_LABEL)
/** States whose benefit has been checked after go-live, and so counts as validated. */
export const VALIDATED = new Set(['validated', 'realized'])
export const RATE_TYPE_LABEL = { internal: 'Internal', it: 'IT', partner: 'Partner', external: 'External' }
export const RATE_STATUS_LABEL = { draft: 'Draft', approved: 'Approved', superseded: 'Superseded', inactive: 'Inactive' }

const sum = (xs) => xs.reduce((a, x) => a + (x || 0), 0)
const known = (...xs) => xs.some((x) => x != null)

/* ---------------------------------------------------------- the rates */

/**
 * The hourly rate for a role on a date (and a project, for an approved
 * override). Approved rates first; a draft is used only when there is no
 * approved one, and says so.
 */
export function rateFor(rates, roleId, date = null, projectKey = null) {
  if (!rates || !roleId) return null
  const ov = (rates.overrides || []).find((o) => o.status === 'approved' && o.projectKey === projectKey && o.role === roleId && o.hourlyRate != null)
  if (ov) return { rate: ov.hourlyRate, role: roleId, approved: true, source: 'project override' }
  const live = (r) => r.id === roleId && r.hourlyRate != null
    && (!date || ((!r.effectiveFrom || r.effectiveFrom <= date) && (!r.effectiveTo || r.effectiveTo >= date)))
  const approved = (rates.roles || []).find((r) => live(r) && r.status === 'approved')
  if (approved) return { rate: approved.hourlyRate, role: roleId, approved: true, source: 'role rate' }
  const draft = (rates.roles || []).find((r) => live(r) && r.status === 'draft')
  if (draft) return { rate: draft.hourlyRate, role: roleId, approved: false, source: 'draft role rate' }
  return null
}

export const roleOf = (rates, personId) => rates?.people?.[personId]?.role || null
export const roleName = (rates, roleId) => (rates?.roles || []).find((r) => r.id === roleId)?.name || roleId || '—'

/**
 * The rate a person's hours are costed at: their role's, else the default
 * role's, else the Model page's developer rate (flagged — it is a salary
 * assumption, not an approved rate).
 */
function hourRate(ctx, personId, date, projectKey) {
  const role = roleOf(ctx.rates, personId)
  const r = (role && rateFor(ctx.rates, role, date, projectKey))
    || (ctx.rates?.defaultRole && rateFor(ctx.rates, ctx.rates.defaultRole, date, projectKey))
  if (r) return r
  const fin = ctx.fin
  const model = fin?.devDayRate > 0 && fin?.hoursPerManday > 0 ? fin.devDayRate / fin.hoursPerManday : null
  return model == null ? null : { rate: model, role: null, approved: false, source: 'Model page developer salary' }
}

/* ------------------------------------------------------- one project */

export function costContext(plan, gov) {
  return {
    rates: gov?.rates || null,
    records: gov?.projects || {},
    worklogs: gov?.worklogs || null,
    blocked: gov?.blocked || {},
    people: plan?.people || [],
    fin: plan?.finance || {},
    asOf: plan?.settings?.asOfDate || new Date().toISOString().slice(0, 10),
  }
}

/** The worklog totals for a project, or null when Jira has none for it. */
export const worklogOf = (ctx, p) => (p.jiraKey && ctx.worklogs?.byProject?.[String(p.jiraKey).toUpperCase()]) || null

export function projectCostOf(p, ctx) {
  const rec = ctx.records[p.key] || null
  const fin = ctx.fin
  const H = fin.horizonMonths || 12
  const hpd = fin.hoursPerManday || 8
  const gaps = []
  const wl = worklogOf(ctx, p)

  // ---- labour, forecast
  const picRate = hourRate(ctx, p.pic, ctx.asOf, p.key)
  const lines = (rec?.labour || []).filter((l) => l.forecastHours > 0)
  let forecastHours
  let forecastLabour
  const labourLines = []
  if (lines.length) {
    forecastHours = sum(lines.map((l) => l.forecastHours))
    for (const l of lines) {
      const r = rateFor(ctx.rates, l.role, ctx.asOf, p.key)
      labourLines.push({ role: l.role, hours: l.forecastHours, rate: r?.rate ?? null, cost: r ? l.forecastHours * r.rate : null, approved: !!r?.approved })
      if (!r) gaps.push(`No rate for ${roleName(ctx.rates, l.role)}`)
    }
    forecastLabour = labourLines.some((l) => l.cost == null) ? null : sum(labourLines.map((l) => l.cost))
  } else {
    forecastHours = p.manday > 0 ? p.manday * hpd : null
    forecastLabour = forecastHours != null && picRate ? forecastHours * picRate.rate : null
    if (forecastHours == null) gaps.push('No planned effort')
  }
  const avgRate = forecastLabour != null && forecastHours > 0 ? forecastLabour / forecastHours : picRate?.rate ?? null

  // ---- labour, actual: every logged hour at its logger's rate that week
  let actualHours = null
  let actualLabour = null
  const unmapped = new Set()
  if (wl) {
    actualHours = wl.hours || 0
    let cost = 0
    let priced = true
    for (const [week, who] of Object.entries(wl.byWeek || {})) {
      for (const [name, h] of Object.entries(who)) {
        const pid = personForJiraName(ctx.people, name)
        if (!pid) unmapped.add(name)
        const r = hourRate(ctx, pid, week === 'unknown' ? ctx.asOf : week, p.key)
        if (!r) { priced = false; continue }
        cost += h * r.rate
      }
    }
    actualLabour = priced ? cost : null
  } else if (p.jiraKey) gaps.push('No worklogs read from Jira yet')
  else gaps.push('No Jira key, so no actual effort')

  // ---- remaining
  const done = p.status === 'Done'
  let remainingHours
  if (done) remainingHours = 0
  else if (rec?.remainingHours != null) remainingHours = rec.remainingHours
  else if (wl?.remainingHours > 0) remainingHours = wl.remainingHours
  else if (forecastHours != null) remainingHours = Math.max(0, forecastHours - (actualHours || 0))
  else remainingHours = null
  const remainingLabour = remainingHours != null && avgRate != null ? remainingHours * avgRate : null

  // ---- other cost: the register's CAPEX and OPEX, then the lines entered here
  const other = []
  if (p.capex != null) other.push({ category: 'infrastructure', label: 'CAPEX (register)', kind: 'capex', forecast: p.capex, actual: null, fromRegister: true })
  if (p.opexRunRate > 0) other.push({ category: 'software', label: `OPEX (register), ${H} months`, kind: 'opex', recurring: true, forecast: p.opexRunRate * H, actual: null, fromRegister: true })
  for (const l of rec?.costs || []) {
    const fc = l.recurring && l.monthly != null ? l.monthly * H : l.forecast
    other.push({ ...l, forecast: fc ?? null })
  }
  const otherForecast = sum(other.map((l) => l.forecast))
  const otherActual = sum(other.map((l) => l.actual))
  const otherRemaining = sum(other.map((l) => Math.max(0, (l.forecast || 0) - (l.actual || 0))))

  const forecastTotal = forecastLabour == null && !other.length ? null : (forecastLabour || 0) + otherForecast
  const actualTotal = actualLabour == null && !other.some((l) => l.actual != null) ? null : (actualLabour || 0) + otherActual
  const eac = !known(actualLabour, remainingLabour) && !other.length
    ? null
    : (actualLabour || 0) + otherActual + (remainingLabour || 0) + otherRemaining

  // ---- budget
  const budget = rec?.budget?.approved ?? null
  const variance = budget != null && eac != null ? eac - budget : null
  if (budget == null) gaps.push('No approved budget')

  // ---- benefit, in money over the horizon
  const b = rec?.benefit || {}
  const state = b.state || 'estimated'
  const acct = fin.acctHourRate || 0
  const recurring = (b.recurringCost || 0) * H
  const monetaryH = (m) => (m > 0 ? (m / 12) * H : 0)
  const forecastBenefit = p.horizonBenefit ?? null
  const expectedBenefit = b.expectedHours != null || b.monetary != null
    ? (b.expectedHours || 0) * acct * H + monetaryH(b.monetary ?? p.monetaryBenefit) - recurring
    : forecastBenefit == null ? null : forecastBenefit - recurring
  const validated = VALIDATED.has(state) && (b.actualHours != null || b.monetary != null)
  const validatedBenefit = validated ? (b.actualHours || 0) * acct * H + monetaryH(b.monetary) - recurring : null
  if (!VALIDATED.has(state)) gaps.push('Benefit not validated')

  const ratio = (benefit, cost) => (benefit != null && cost > 0 ? (benefit - cost) / cost : null)
  const forecastRoi = ratio(forecastBenefit, forecastTotal)
  const projectedRoi = ratio(expectedBenefit, eac)
  const actualRoi = ratio(validatedBenefit, actualTotal)
  const monthly = expectedBenefit != null ? expectedBenefit / H : null
  const payback = monthly > 0 && eac > 0 ? eac / monthly : null

  return {
    key: p.key,
    name: p.summary || p.name || p.key,
    pic: p.pic,
    status: p.status,
    jiraKey: p.jiraKey || null,
    rec,
    rate: picRate,
    forecastHours,
    forecastLabour,
    labourLines,
    actualHours,
    actualLabour,
    remainingHours,
    remainingLabour,
    other,
    otherForecast,
    otherActual,
    forecastTotal,
    actualTotal,
    eac,
    budget,
    originalBudget: rec?.budget?.original ?? null,
    variance,
    benefitState: state,
    forecastBenefit,
    expectedBenefit,
    validatedBenefit,
    forecastRoi,
    projectedRoi,
    actualRoi,
    payback,
    horizon: H,
    unmapped: [...unmapped],
    unapprovedRate: !!picRate && !picRate.approved,
    gaps,
  }
}

/* ----------------------------------------------------- the portfolio */

export function portfolioCosts(plan, gov) {
  const ctx = costContext(plan, gov)
  const book = (plan?.projects || []).filter(inBook)
  const rows = book.map((p) => projectCostOf(p, ctx))
  const t = (f) => {
    const xs = rows.map(f).filter((x) => x != null)
    return xs.length ? sum(xs) : null
  }
  const budgeted = rows.filter((r) => r.budget != null)
  const withActual = rows.filter((r) => r.actualHours > 0)
  const validated = rows.filter((r) => r.validatedBenefit != null && r.actualTotal > 0)
  const costed = rows.filter((r) => r.eac > 0 && r.expectedBenefit != null)
  const byCategory = { labour: { forecast: t((r) => r.forecastLabour), actual: t((r) => r.actualLabour) } }
  for (const cat of ['vendor', 'software', 'infrastructure', 'other']) {
    const lines = rows.flatMap((r) => r.other.filter((l) => l.category === cat))
    byCategory[cat] = { forecast: lines.length ? sum(lines.map((l) => l.forecast)) : null, actual: lines.some((l) => l.actual != null) ? sum(lines.map((l) => l.actual)) : null }
  }
  const eacBudgeted = sum(budgeted.map((r) => r.eac || 0))
  const budgetTotal = sum(budgeted.map((r) => r.budget))
  const ratio = (b, c) => (c > 0 ? (b - c) / c : null)
  return {
    ctx,
    rows,
    totals: {
      forecastTotal: t((r) => r.forecastTotal),
      actualTotal: t((r) => r.actualTotal),
      eac: t((r) => r.eac),
      budget: budgeted.length ? budgetTotal : null,
      variance: budgeted.length ? eacBudgeted - budgetTotal : null,
      forecastHours: t((r) => r.forecastHours),
      actualHours: t((r) => r.actualHours),
      remainingHours: t((r) => r.remainingHours),
      projectedRoi: costed.length ? ratio(sum(costed.map((r) => r.expectedBenefit)), sum(costed.map((r) => r.eac))) : null,
      forecastRoi: ratio(sum(rows.filter((r) => r.forecastBenefit != null && r.forecastTotal > 0).map((r) => r.forecastBenefit)), sum(rows.filter((r) => r.forecastBenefit != null && r.forecastTotal > 0).map((r) => r.forecastTotal))),
      actualRoi: validated.length ? ratio(sum(validated.map((r) => r.validatedBenefit)), sum(validated.map((r) => r.actualTotal))) : null,
      validatedBenefit: validated.length ? sum(validated.map((r) => r.validatedBenefit)) : null,
    },
    coverage: {
      projects: rows.length,
      budgeted: budgeted.length,
      withActual: withActual.length,
      validated: validated.length,
      overBudget: budgeted.filter((r) => r.variance > 0).length,
      unmapped: [...new Set(rows.flatMap((r) => r.unmapped))],
      draftRates: rows.filter((r) => r.unapprovedRate).length,
    },
    byCategory,
    horizon: plan?.finance?.horizonMonths || 12,
  }
}

/* ------------------------------------------------------------ capacity */

const mondayOf = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Above this share of a person's project capacity, the load is flagged. */
export const LOAD_HIGH = 0.85
export const LOAD_OVER = 1.0

/**
 * Capacity and sprint execution. Per person: what they have for projects
 * (their allocation of a full-time month), what is planned on them, what they
 * logged, and the next twelve weeks' load. Per project: planned against
 * actual effort, what is left, carry-over, replans, blocked days and work in
 * progress.
 */
export function capacityOf(plan, gov, { weeks = 12 } = {}) {
  const ctx = costContext(plan, gov)
  const fin = ctx.fin
  const hpm = fin.hoursPerFteMonth || 176
  const weekHours = (hpm * 12) / 52
  const asOf = ctx.asOf
  const thisWeek = mondayOf(asOf)
  const ahead = Array.from({ length: weeks }, (_, i) => addDays(thisWeek, i * 7))
  const book = (plan?.projects || []).filter(inBook)
  const costs = book.map((p) => projectCostOf(p, ctx))
  const costByKey = Object.fromEntries(costs.map((c) => [c.key, c]))

  // ---- projects
  const projects = book.map((p) => {
    const c = costByKey[p.key]
    const wl = worklogOf(ctx, p)
    const blocked = ctx.blocked[p.key] || (p.jiraKey ? ctx.blocked[String(p.jiraKey).toUpperCase()] : null) || null
    const fac = c.actualHours != null || c.remainingHours != null ? (c.actualHours || 0) + (c.remainingHours || 0) : null
    return {
      key: p.key,
      name: c.name,
      pic: p.pic,
      status: p.status,
      planned: c.forecastHours,
      actual: c.actualHours,
      remaining: c.remainingHours,
      fac,
      variance: fac != null && c.forecastHours != null ? fac - c.forecastHours : null,
      carried: wl ? wl.carried : null,
      replans: Number(p.replanCount) || 0,
      blockedDays: blocked?.days ?? 0,
      lastBlocker: blocked?.lastBlocker || '',
      wip: wl ? wl.inProgress : null,
      issues: wl ? wl.issues : null,
      due: isDate(p.due) ? p.due : null,
      start: isDate(p.start) ? p.start : null,
    }
  })

  // ---- people
  const team = (plan?.people || []).filter((x) => x && x.id && !x.deleted && x.scorecard !== false && !['it', 'user'].includes(x.id))
  const loggedBy = {}
  const loggedWeek = {}
  for (const p of book) {
    const wl = worklogOf(ctx, p)
    if (!wl) continue
    for (const [week, who] of Object.entries(wl.byWeek || {})) {
      for (const [name, h] of Object.entries(who)) {
        const pid = personForJiraName(ctx.people, name) || `jira:${name}`
        loggedBy[pid] = (loggedBy[pid] || 0) + h
        loggedWeek[pid] ||= {}
        loggedWeek[pid][week] = (loggedWeek[pid][week] || 0) + h
      }
    }
  }
  const people = team.map((person) => {
    const a = ctx.rates?.people?.[person.id] || {}
    const share = a.project != null ? a.project / 100 : 1
    const mine = projects.filter((x) => x.pic === person.id && x.status !== 'Done')
    // What is left on each of their projects, spread evenly to its due date;
    // past due, it all falls in the next four weeks.
    const load = ahead.map((wk) => {
      let h = 0
      for (const x of mine) {
        if (!(x.remaining > 0)) continue
        const end = x.due && x.due > asOf ? x.due : addDays(thisWeek, 27)
        const span = Math.max(1, Math.ceil((daysBetween(thisWeek, end) + 1) / 7))
        if (wk <= end) h += x.remaining / span
      }
      return { week: wk, hours: h, available: weekHours * share, load: share > 0 ? h / (weekHours * share) : null }
    })
    const peak = load.reduce((m, w) => (w.load != null && w.load > m ? w.load : m), 0)
    return {
      id: person.id,
      nick: person.nick || person.name || person.id,
      role: a.role || null,
      level: a.level || null,
      allocation: { project: a.project, bau: a.bau, support: a.support, unplanned: a.unplanned },
      allocationSet: a.project != null,
      monthHours: hpm * share,
      planned: sum(mine.map((x) => x.planned || 0)),
      remaining: sum(mine.map((x) => x.remaining || 0)),
      logged: loggedBy[person.id] || 0,
      loggedWeek: loggedWeek[person.id] || {},
      projects: mine.length,
      wip: sum(projects.filter((x) => x.pic === person.id).map((x) => x.wip || 0)),
      load,
      peak,
      warning: peak > LOAD_OVER ? 'over' : peak > LOAD_HIGH ? 'high' : null,
    }
  })
  const strangers = Object.keys(loggedBy).filter((k) => k.startsWith('jira:')).map((k) => ({ name: k.slice(5), hours: loggedBy[k] }))

  return {
    ctx,
    weeks: ahead,
    weekHours,
    projects,
    people,
    strangers,
    totals: {
      planned: sum(projects.map((x) => x.planned || 0)),
      actual: projects.some((x) => x.actual != null) ? sum(projects.map((x) => x.actual || 0)) : null,
      remaining: sum(projects.map((x) => x.remaining || 0)),
      // Only where both sides are known: a project with no plan has no variance.
      variance: projects.some((x) => x.variance != null && x.actual != null) ? sum(projects.filter((x) => x.variance != null && x.actual != null).map((x) => x.variance)) : null,
      varianceProjects: projects.filter((x) => x.variance != null && x.actual != null).length,
      carried: projects.some((x) => x.carried != null) ? sum(projects.map((x) => x.carried || 0)) : null,
      replans: sum(projects.map((x) => x.replans)),
      repeatReplans: projects.filter((x) => x.replans >= 2).length,
      blockedDays: sum(projects.map((x) => x.blockedDays)),
      wip: projects.some((x) => x.wip != null) ? sum(projects.map((x) => x.wip || 0)) : null,
      available: sum(people.map((x) => x.monthHours * 12)),
    },
    worklogs: ctx.worklogs ? { at: ctx.worklogs.at, ok: ctx.worklogs.ok, error: ctx.worklogs.error || null, entries: ctx.worklogs.entries || 0 } : null,
  }
}

/* -------------------------------------------------------- formatting */

export const fmtH = (n) => (n == null ? '—' : `${Math.round(n).toLocaleString()} h`)
export const fmtMd = (h, hpd = 8) => (h == null ? '—' : `${(Math.round((h / hpd) * 10) / 10).toLocaleString()} md`)
