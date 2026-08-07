import { OBJ_BY_ID, OBJECTIVES } from './palette.js'

const OBJECTIVE_ORDER = OBJECTIVES.map((o) => o.id)

/**
 * Default contribution weights by Jira role label.
 *
 * These are RAW weights, not final shares. For each project the raw weights of
 * everyone credited are normalised so the project's total credited contribution
 * is exactly 1.0 — which is what stops the same saving hour being banked twice
 * across two people's scorecards (the flaw that made the 2025 sheet's totals
 * un-addable).
 */
/**
 * The role-point model recommended in the 2026 KPI plan (decision 9),
 * expressed on a 0-1 scale: dev 10 / lead 6 / pm 3 / assignee 3 / qa 2 /
 * support 2. Keep these in step with the plan document — the app and the
 * paper have to produce the same numbers or neither is trusted.
 */
export const DEFAULT_ROLE_WEIGHTS = {
  dev: 1.0,
  lead: 0.6,
  pm: 0.3,
  assignee: 0.3, // a bare assignee with no explicit role label
  qa: 0.2,
  support: 0.2,
}

/**
 * Scorecard weight bands. Each band's three blocks sum to exactly 1.0, so a
 * person's total weight is 100% by construction regardless of how many
 * objectives they hold — the 2025 sheet's most visible defect (Gun totalled
 * 80%, James 75%) cannot recur.
 */
export const DEFAULT_BANDS = {
  lead: { corporate: 0.3, delivery: 0.45, people: 0.25 },
  senior: { corporate: 0.3, delivery: 0.6, people: 0.1 },
  analyst: { corporate: 0.3, delivery: 0.55, people: 0.15 },
}

/** Relative emphasis inside the delivery block, normalised over objectives held. */
export const DEFAULT_OBJECTIVE_PRIORITY = {
  financial: 1,
  process_automation: 3,
  datawarehouse: 1.5,
  efficiency: 1.5,
  ai_automation: 1.5,
}

/**
 * Are the "Saving Hours" in Jira an annual figure or a per-month figure?
 * Jira does not say, and it changes the economics by 12x — the 2025 workbook
 * counted hours per MONTH, while the 2026 target of 3,000 hrs is unlabelled.
 * The app carries the assumption explicitly rather than burying it.
 */
export const SAVING_BASIS = {
  annual: { id: 'annual', label: 'Per year', monthsPerUnit: 12 },
  monthly: { id: 'monthly', label: 'Per month', monthsPerUnit: 1 },
}

/**
 * Months to repay the build effort, given a saving-hours-per-manday ratio.
 * One manday = 8 hours of build.
 */
export function paybackMonths(ratio, basis = 'annual') {
  if (!ratio || ratio <= 0) return null
  const hoursSavedPerMonthPerManday = basis === 'monthly' ? ratio : ratio / 12
  return 8 / hoursSavedPerMonthPerManday
}

export const DEFAULT_SETTINGS = {
  targetHours: 3000,
  // The source workbook's column is "Saving hrs/mth", and the 2025 plan was
  // also stated per month (1,823 hrs/month), so monthly is the right basis.
  savingBasis: 'monthly',
  // Objective 1 gate: minimum saving hours returned per manday invested.
  // 4.0 on an annual basis is a 24-month payback — a deliberately permissive
  // provisional floor. It cannot be set responsibly until real effort data
  // exists and the hours basis is confirmed with management.
  ratioGate: 4.0,
  roleWeights: { ...DEFAULT_ROLE_WEIGHTS },
  // Whether "stretch" projects are shown inside the headline number.
  includeStretchInHeadline: false,
  bands: JSON.parse(JSON.stringify(DEFAULT_BANDS)),
  objectivePriority: { ...DEFAULT_OBJECTIVE_PRIORITY },
  // false = GROSS: the six owners are credited the whole project.
  // true  = NET: partner/outsource devs dilute the core shares.
  creditPartners: false,
  // Anything due before this and not Done is flagged past due.
  asOfDate: '2026-08-07',
}

/**
 * Build the KPI lines for one person: a computed default weight and target,
 * with any manual override applied on top.
 *
 * Overrides live on `person.kpi = { [lineId]: { weight, target } }` so they
 * travel with the scenario into Mongo and out to Excel — the dashboard, the
 * scorecard and the export all read these same lines, so they cannot disagree.
 *
 * The DEFAULTS always total 1.0. Overrides can break that on purpose while
 * someone is mid-edit; `weightsValid` is what gates saving.
 */
export function scorecardWeights(person, settings, credited = {}) {
  const band = settings.bands[person.band] || settings.bands.senior
  const held = person.objectives || []
  const prio = settings.objectivePriority
  const totalPrio = held.reduce((a, id) => a + (prio[id] ?? 1), 0)
  const unit = settings.savingBasis === 'monthly' ? 'hrs/month' : 'hrs/year'

  const lines = [
    { id: 'corp-sales', block: 'Corporate', label: 'CP AXTRA Sales', weight: band.corporate / 2, target: 'Per corporate scorecard' },
    { id: 'corp-eat', block: 'Corporate', label: 'CP AXTRA EAT', weight: band.corporate / 2, target: 'Per corporate scorecard' },
  ]

  if (totalPrio > 0) {
    held.forEach((id) => {
      // Default target = what this person is actually carrying on that
      // objective, so the number starts realistic rather than at the team's.
      const hrs = Math.round(credited[id] || 0)
      lines.push({
        id: `obj-${id}`,
        block: 'Delivery',
        objective: id,
        weight: (band.delivery * (prio[id] ?? 1)) / totalPrio,
        target: OBJ_BY_ID[id]?.countsToPool ? `${hrs.toLocaleString()} ${unit}` : (OBJ_BY_ID[id]?.target || '—'),
      })
    })
  } else {
    // Nobody should hold zero objectives; if it happens, park the delivery
    // block on the pool objective rather than silently losing the weight.
    lines.push({ id: 'obj-none', block: 'Delivery', objective: 'process_automation', weight: band.delivery, target: '—' })
  }

  lines.push({
    id: 'people',
    block: 'Capability',
    label:
      person.band === 'lead'
        ? 'Team capability — GuRus delivered, digital-skill uplift, bench depth'
        : person.band === 'analyst'
          ? 'Own capability — new tech skill certified, GuRu contribution'
          : 'Capability — 1 new tech skill, GuRu coaching',
    weight: band.people,
    target: person.band === 'lead' ? '2 GuRus · 60% at medium+' : '1 new tech skill',
  })

  const ov = person.kpi || {}
  const hidden = new Set(person.kpiHidden || [])

  return lines
    .filter((l) => !hidden.has(l.id))
    .map((l) => {
      const o = ov[l.id] || {}
      const target = o.target != null && o.target !== '' ? o.target : l.target
      return {
        ...l,
        weight: typeof o.weight === 'number' ? o.weight : l.weight,
        target,
        defaultWeight: l.weight,
        // The live figure straight from current project assignments. Reassign a
        // project on the Projects tab and this moves immediately.
        defaultTarget: l.target,
        creditedHours: l.objective ? (credited[l.objective] || 0) : null,
        // A manual target that no longer matches what the person actually
        // carries — surfaced so it can be re-synced rather than silently drift.
        drifted: !!l.objective && target !== l.target,
        overridden: typeof o.weight === 'number' || (o.target != null && o.target !== ''),
      }
    })
}

/** Lines removed from a scorecard, so they can be listed and restored. */
export function hiddenLines(person, settings, credited = {}) {
  const hidden = new Set(person.kpiHidden || [])
  if (!hidden.size) return []
  const all = scorecardWeights({ ...person, kpiHidden: [] }, settings, credited)
  return all.filter((l) => hidden.has(l.id))
}

/**
 * Scale weights proportionally so they total exactly 1.0 — what you want after
 * deleting a line, rather than hand-patching the remainder.
 */
export function rebalanceWeights(lines) {
  const total = weightSum(lines)
  if (total <= 0) {
    const even = 1 / (lines.length || 1)
    return Object.fromEntries(lines.map((l) => [l.id, even]))
  }
  const out = {}
  let acc = 0
  lines.forEach((l, i) => {
    if (i === lines.length - 1) out[l.id] = Math.round((1 - acc) * 10000) / 10000
    else {
      const w = Math.round((l.weight / total) * 10000) / 10000
      out[l.id] = w
      acc += w
    }
  })
  return out
}

export const weightSum = (lines) => lines.reduce((a, l) => a + (l.weight || 0), 0)

/** A scorecard is only saveable when its weights total exactly 100%. */
export const weightsValid = (lines) => Math.abs(weightSum(lines) - 1) < 0.0005

/** Everyone whose weights do not total 100% — the save gate reads this. */
export const invalidScorecards = (people) =>
  people.filter((p) => !weightsValid(p.kpiLines)).map((p) => ({
    id: p.id,
    nick: p.nick,
    sum: weightSum(p.kpiLines),
  }))

export const ROLE_ORDER = ['pm', 'lead', 'dev', 'support', 'qa', 'assignee']

/** Blank row for the "add project" action. */
export function newProject(seq) {
  return {
    key: `NEW-${seq}`,
    jiraKey: null,
    summary: 'New project',
    program: '',
    team: 'Accounting',
    subTeam: '',
    objective: 'process_automation',
    savingHours: null,
    hc: null,
    savingEstimated: true,
    manday: 0,
    mandayEstimated: true,
    status: 'Not Start',
    srcStatus: null,
    start: null,
    due: null,
    assignee: null,
    pic: null,
    contributors: [],
    partners: [],
    deleted: false,
    commitLevel: 'watch',
    notes: '',
  }
}

/* ------------------------------------------------------------------ */
/* contribution                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve each contributor's share of one project.
 *
 * GROSS (creditPartners = false, the default): only the six scorecard owners
 * enter the denominator, so their shares sum to 1.0 and the team is credited
 * with the whole project. This is the right reading if the 3,000 hr target
 * holds the team accountable for delivered hours regardless of who writes the
 * code — partner devs are then a resource, not a claimant.
 *
 * NET (creditPartners = true): partner-team and outsource devs
 * (tao, buzz, fah, luem, fia, central-it, finance-it) enter the denominator
 * too, diluting the core shares. Core shares then sum to LESS than 1.0 and the
 * difference is hours the team cannot personally bank.
 *
 * The two readings differ by roughly 1,900 gross hours across 35 projects, so
 * which one management intends has to be settled explicitly rather than
 * assumed. Returns { shares, partnerShare }.
 */
export function projectShares(project, roleWeights = DEFAULT_ROLE_WEIGHTS, creditPartners = false) {
  const raw = {}
  for (const c of project.contributors || []) {
    if (!c.person) continue
    // A person's raw weight is their single strongest role on the project,
    // not the sum — holding both pm and dev does not double the claim.
    const best = Math.max(...c.roles.map((r) => roleWeights[r] ?? 0), 0)
    if (best > 0) raw[c.person] = Math.max(raw[c.person] ?? 0, best)
  }
  // A PIC with no contributor record still owns the project outright.
  if (project.pic && raw[project.pic] === undefined) {
    raw[project.pic] = roleWeights.assignee ?? 0.6
  }

  let partnerRaw = 0
  if (creditPartners) {
    for (const p of project.partners || []) {
      const roles = Array.isArray(p) ? [] : p.roles || []
      partnerRaw += Math.max(...roles.map((r) => roleWeights[r] ?? 0), 0)
    }
  }

  const coreTotal = Object.values(raw).reduce((a, b) => a + b, 0)
  const total = coreTotal + partnerRaw
  if (total <= 0) return { shares: {}, partnerShare: 0 }
  return {
    shares: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v / total])),
    partnerShare: partnerRaw / total,
  }
}

/* ------------------------------------------------------------------ */
/* per-project derived values                                          */
/* ------------------------------------------------------------------ */

export const isCounted = (p) => p.commitLevel === 'commit' || p.commitLevel === 'stretch'

/** Does this project's objective contribute hours to the 3,000 pool? */
export const countsToPool = (p) => {
  const o = OBJ_BY_ID[p.objective]
  return !!o?.countsToPool
}

export function projectRatio(p) {
  if (!p.manday || p.savingHours == null) return null
  return p.savingHours / p.manday
}

export function gateStatus(p, gate) {
  const r = projectRatio(p)
  if (r == null) return 'unknown'
  return r >= gate ? 'pass' : 'fail'
}

/* ------------------------------------------------------------------ */
/* rollups                                                             */
/* ------------------------------------------------------------------ */

/**
 * Full derived state for the whole plan. Everything the UI renders is computed
 * here so the dashboard, the people view and the export can never disagree.
 */
export function computePlan(state) {
  const s = { ...DEFAULT_SETTINGS, ...(state.settings || {}) }
  const projects = state.projects || []
  const people = state.people || []

  const perProject = projects.map((p) => {
    const { shares, partnerShare } = projectShares(p, s.roleWeights, s.creditPartners)
    return {
      ...p,
      shares,
      partnerShare,
      ratio: projectRatio(p),
      gate: gateStatus(p, s.ratioGate),
      poolHours: countsToPool(p) && isCounted(p) ? (p.savingHours ?? 0) : 0,
      pastDue: !!p.due && p.due < s.asOfDate && p.status !== 'Done',
    }
  })

  // ---- team totals -------------------------------------------------
  const commit = perProject.filter((p) => p.commitLevel === 'commit')
  const stretch = perProject.filter((p) => p.commitLevel === 'stretch')
  const watch = perProject.filter((p) => p.commitLevel === 'watch')

  const sumHours = (arr, poolOnly = true) =>
    arr.reduce((a, p) => a + ((poolOnly ? countsToPool(p) : true) ? (p.savingHours ?? 0) : 0), 0)

  const committedHours = sumHours(commit)
  const stretchHours = sumHours(stretch)
  const watchHours = sumHours(watch)
  const headlineHours = committedHours + (s.includeStretchInHeadline ? stretchHours : 0)

  const sumHC = (arr) => arr.reduce((a, p) => a + (p.hc || 0), 0)
  const committedHC = sumHC(commit)
  const totalHC = sumHC(perProject.filter((p) => p.commitLevel !== 'excluded'))

  // The book total — every project's saving hours, with no objective or
  // commit-level filtering applied. This must always reconcile to the source
  // workbook's own column sum, so it is what the dashboard leads with.
  const active = perProject.filter((p) => p.commitLevel !== 'excluded')
  const totalHours = active.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  const byStatus = {}
  for (const p of active) {
    const k = p.status || 'Unknown'
    byStatus[k] = (byStatus[k] || 0) + (p.savingHours ?? 0)
  }
  const doneHours = byStatus.Done || 0

  const totalManday = perProject
    .filter(isCounted)
    .reduce((a, p) => a + (p.manday || 0), 0)
  const teamRatio = totalManday > 0 ? headlineHours / totalManday : null

  // ---- per-person --------------------------------------------------
  const byPerson = people.map((person) => {
    const rows = perProject
      .map((p) => ({ p, share: p.shares[person.id] || 0 }))
      .filter((r) => r.share > 0)

    const counted = rows.filter((r) => isCounted(r.p))
    const hours = counted.reduce(
      (a, r) => a + (countsToPool(r.p) ? (r.p.savingHours ?? 0) * r.share : 0),
      0,
    )
    const commitHours = counted
      .filter((r) => r.p.commitLevel === 'commit')
      .reduce((a, r) => a + (countsToPool(r.p) ? (r.p.savingHours ?? 0) * r.share : 0), 0)
    const manday = counted.reduce((a, r) => a + (r.p.manday || 0) * r.share, 0)

    const byObjective = {}
    for (const r of counted) {
      const id = r.p.objective
      byObjective[id] = (byObjective[id] || 0) + (r.p.savingHours ?? 0) * r.share
    }

    // keep objective order stable (by guideline number), not by discovery order
    const objectives = OBJECTIVE_ORDER.filter((id) => counted.some((r) => r.p.objective === id))
    const withObjectives = { ...person, objectives }

    return {
      ...withObjectives,
      projectCount: rows.length,
      countedCount: counted.length,
      missingSaving: rows.filter((r) => r.p.savingHours == null).length,
      hours,
      commitHours,
      manday,
      ratio: manday > 0 ? hours / manday : null,
      byObjective,
      rows,
      kpiLines: scorecardWeights(withObjectives, s, byObjective),
      kpiHiddenLines: hiddenLines(withObjectives, s, byObjective),
    }
  })

  // ---- partner leakage ---------------------------------------------
  // Hours inside the committed pool that the six owners cannot personally
  // bank because a partner/outsource dev builds them.
  const partnerHours = perProject
    .filter((p) => isCounted(p) && countsToPool(p))
    .reduce((a, p) => a + (p.savingHours ?? 0) * (p.partnerShare || 0), 0)
  const bankableHours = byPerson.reduce((a, p) => a + p.hours, 0)
  // Hours on counted, pool-eligible projects with nobody credited at all.
  const orphanHours = perProject
    .filter((p) => isCounted(p) && countsToPool(p) && Object.keys(p.shares).length === 0)
    .reduce((a, p) => a + (p.savingHours ?? 0), 0)

  // ---- data-quality ------------------------------------------------
  const quality = {
    total: projects.length,
    missingSaving: projects.filter((p) => p.savingHours == null).length,
    missingPic: projects.filter((p) => !p.pic).length,
    estimatedManday: projects.filter((p) => p.mandayEstimated).length,
    deleted: projects.filter((p) => p.deleted).length,
    pastDue: perProject.filter((p) => p.pastDue).length,
    pastDueHours: perProject
      .filter((p) => p.pastDue && isCounted(p) && countsToPool(p))
      .reduce((a, p) => a + (p.savingHours ?? 0), 0),
  }

  // ---- objective mix ------------------------------------------------
  const byObjective = {}
  for (const p of perProject.filter(isCounted)) {
    byObjective[p.objective] = (byObjective[p.objective] || 0) + (p.savingHours ?? 0)
  }

  // ---- concentration ------------------------------------------------
  const ranked = [...perProject]
    .filter((p) => isCounted(p) && countsToPool(p))
    .sort((a, b) => (b.savingHours ?? 0) - (a.savingHours ?? 0))
  const top2 = ranked.slice(0, 2).reduce((a, p) => a + (p.savingHours ?? 0), 0)

  return {
    settings: s,
    projects: perProject,
    people: byPerson,
    totals: {
      committedHours,
      stretchHours,
      watchHours,
      headlineHours,
      target: s.targetHours,
      coverage: s.targetHours > 0 ? headlineHours / s.targetHours : 0,
      gap: headlineHours - s.targetHours,
      totalManday,
      teamRatio,
      failingGate: perProject.filter((p) => isCounted(p) && p.gate === 'fail').length,
      top2Share: headlineHours > 0 ? top2 / headlineHours : 0,
      top2,
      topProjects: ranked.slice(0, 5),
      // The gross-to-bankable bridge — the gap between what the team is
      // targeted on and what its six scorecards can actually add up to.
      partnerHours,
      orphanHours,
      bankableHours,
      bankableCoverage: s.targetHours > 0 ? bankableHours / s.targetHours : 0,
      committedHC,
      totalHC,
      totalHours,
      totalCoverage: s.targetHours > 0 ? totalHours / s.targetHours : 0,
      byStatus,
      doneHours,
      doneCoverage: s.targetHours > 0 ? doneHours / s.targetHours : 0,
    },
    byObjective,
    quality,
    // Blocks saving while any scorecard is off 100%.
    invalid: invalidScorecards(byPerson),
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

export const fmtHours = (n) =>
  n == null ? '—' : Math.abs(n) >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1)

export const fmtRatio = (n) => (n == null ? '—' : n.toFixed(1))

export const fmtPct = (n) => (n == null ? '—' : `${Math.round(n * 100)}%`)

export const personById = (people, id) => people.find((p) => p.id === id)
