import { newId, slide, titleBlock, text, rect, image, updatesSlides, shortName } from './templates.js'
import { C } from './theme.js'
import { toneFor } from './layout.js'

/*
 * THE INITIATIVE LIST, AND SLIDES MADE FROM IT.
 *
 * The list is the team's own account of what it presents at IT governance:
 * initiatives, each with milestones, a status ("GO LIVE", "in-progress",
 * "UAT", "Planning", "Requirement Gathering"), the users it serves
 * ("Fin - Channel", "Acc - AP") and a target ("Dec 2026", "TBC (2027)").
 */

/* ------------------------------------------------------- reading a paste */

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
const placeholder = (v) => !clean(v) || /^[.…\s-]+$/.test(clean(v))

/** Which side of the house: the users say it ("Acc - AP" is Accounting). */
export const teamOf = (users) => (/^\s*acc/i.test(String(users || '')) ? 'Accounting' : 'Finance')

/**
 * ROWS COPIED FROM EXCEL (tab-separated): Project, Milestone, Status, Users,
 * Target. A row with a project starts an initiative; a row with only a
 * milestone belongs to the initiative above it. A name Excel wrapped onto its
 * own line ("LOI Autocheck" ⏎ "\t\tGO LIVE\tAcc - AR") is put back together.
 * The header, empty rows and "...." placeholders are skipped.
 */
export function parseInitiatives(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n')
  const joined = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('\t') && line.trim() && lines[i + 1]?.startsWith('\t')) {
      joined.push(`${line.trim()}${lines[i + 1]}`)
      i += 1
    } else joined.push(line)
  }
  const items = []
  let parent = null
  for (const line of joined) {
    const cols = line.split('\t')
    const [project, milestone, status, users, target] = [0, 1, 2, 3, 4].map((i) => clean(cols[i]))
    if (!project && !milestone) continue
    if (/^project$/i.test(project) && /^mile\s*stone$/i.test(milestone)) continue
    if (project) {
      parent = { id: newId(), parentId: null, name: project, status, users, target, team: teamOf(users), projectKey: null, note: '' }
      items.push(parent)
      // A project row that also names a milestone: the milestone goes under it.
      if (milestone && !placeholder(milestone)) items.push({ id: newId(), parentId: parent.id, name: milestone, status, users, target, team: parent.team, projectKey: null, note: '' })
      continue
    }
    if (placeholder(milestone)) continue
    items.push({
      id: newId(), parentId: parent ? parent.id : null, name: milestone, status, users: users || parent?.users || '', target,
      team: parent ? parent.team : teamOf(users), projectKey: null, note: '',
    })
  }
  return items
}

/* ------------------------------------------------- linking to the register */

const norm = (s) => String(s || '').toLowerCase().replace(/\[[^\]]*\]/g, '').replace(/[^a-z0-9ก-๙]+/g, '')

/* The name a register line goes by, before "(Dashboard)", "[2027]", "/ Gross margin" or "— Actual". */
const baseName = (summary) => String(summary || '').split(/\s+[([/:—–]|\s+-\s+/)[0]

/**
 * The register project an initiative IS, when its name says so plainly: the
 * same name, or the same name before a bracket, a slash or a dash ("Shrinkage
 * Automation (Dashboard) — Actual & Forecast"), with only one such project.
 * "Lease Master" is not "Lease Master Phase 2", and deleted lines never match.
 * Anything looser is left for a person to link — a wrong link would show the
 * wrong project's details in a meeting.
 */
export function suggestLink(name, projects) {
  const n = norm(name)
  if (n.length < 6) return null
  const live = projects.filter((p) => !p.deleted && p.key && !/deleted/i.test(String(p.summary || '')))
  const same = live.filter((p) => norm(p.summary) === n)
  if (same.length) return same.length === 1 ? same[0].key : null
  const base = live.filter((p) => norm(baseName(p.summary)) === n)
  return base.length === 1 ? base[0].key : null
}

/* Links for every unlinked line; a project is linked to one line at most. */
export function linkAll(items, projects) {
  const used = new Set(items.map((x) => x.projectKey).filter(Boolean))
  return items.map((it) => {
    if (it.projectKey) return it
    const k = suggestLink(it.name, projects)
    if (!k || used.has(k)) return it
    used.add(k)
    return { ...it, projectKey: k }
  })
}

/* ---------------------------------------------------------- status words */

export const INITIATIVE_STATUSES = ['GO LIVE', 'In progress', 'UAT', 'Planning', 'Requirement Gathering', 'On hold', 'Delayed']

/** The deck's pill for a status as the list writes it. */
export function pillOf(status) {
  const s = String(status || '').toLowerCase().replace(/[-_]/g, ' ').trim()
  if (!s) return ''
  if (/go ?live|live|done/.test(s)) return 'GO LIVE'
  if (/uat/.test(s)) return 'UAT'
  if (/requirement|brd/.test(s)) return 'Req. Gathering'
  if (/plan/.test(s)) return 'Planning'
  if (/hold/.test(s)) return 'On Hold'
  if (/delay|late/.test(s)) return 'Delayed'
  return 'On Track'
}

const MONTH = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }

/** "Dec 2026" → 2026-12-31; "TBC (2027)" → the year after; anything else → null. */
export function targetDate(target) {
  const t = String(target || '')
  const m = t.match(/\b([A-Za-z]{3})[a-z]*\.?\s*(\d{4})\b/)
  if (m && MONTH[m[1].toLowerCase()]) {
    const y = Number(m[2])
    const mo = MONTH[m[1].toLowerCase()]
    return `${y}-${String(mo).padStart(2, '0')}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`
  }
  const y = t.match(/\b(20\d{2})\b/)
  if (y) return `${y[1]}-12-31`
  return null
}

/* ---------------------------------------------------------------- slides */

export const childrenOf = (items, id) => items.filter((x) => x.parentId === id)
export const topLevel = (items) => items.filter((x) => !x.parentId)

const withTarget = (m) => `${m.name}${m.target ? ` (${m.target})` : ''}`

/**
 * AN INITIATIVE AS A PROJECT CARD: delivered milestones are the
 * accomplishment, the rest the next milestones. Impact is not in the list; it
 * comes from the linked project when there is one, or is written on the slide.
 */
export function cardFromInitiative(it, items, project = null) {
  const kids = childrenOf(items, it.id)
  const live = kids.filter((k) => pillOf(k.status) === 'GO LIVE')
  const open = kids.filter((k) => pillOf(k.status) !== 'GO LIVE')
  const impact = project
    ? [
      ...(Number(project.savingHours) > 0 ? [`Saves ${Math.round(project.savingHours).toLocaleString('en-US')} hours a month`] : []),
      ...(Array.isArray(project.softBenefits) ? project.softBenefits.slice(0, 1) : []),
    ].slice(0, 2)
    : []
  return {
    projectKey: it.projectKey || null,
    initiativeId: it.id,
    title: it.name,
    status: pillOf(it.status) || (open.length ? 'On Track' : live.length ? 'GO LIVE' : ''),
    accomplishment: live.length ? live.slice(0, 3).map((k) => k.name) : (pillOf(it.status) === 'GO LIVE' ? ['Live and in use'] : []),
    impact: impact.length ? impact : (it.users ? [`For ${it.users}`] : []),
    next: open.slice(0, 3).map(withTarget),
    target: it.target || (open.find((k) => k.target)?.target) || 'TBC',
  }
}

export function initiativeCardsSlides(items, chosen, byKey = {}, team = null) {
  const title = team ? `${team} Initiatives – Project Update` : 'Initiatives – Project Update'
  return updatesSlides(title, chosen.map((it) => cardFromInitiative(it, items, it.projectKey ? byKey[it.projectKey] : null)))
}

export function initiativeAgenda(items, chosen = topLevel(items)) {
  const fin = chosen.filter((x) => x.team !== 'Accounting').slice(0, 10)
  const acc = chosen.filter((x) => x.team === 'Accounting').slice(0, 12)
  const list = (xs) => xs.map((x, i) => `${String(i + 1).padStart(2, '0')}   ${shortName(x.name, 34)}`).join('\n')
  const size = (n) => (n <= 5 ? 12.75 : n <= 7 ? 11.5 : n <= 9 ? 10 : 8.5)
  const lh = (n) => (n <= 5 ? 2.05 : n <= 7 ? 1.8 : n <= 9 ? 1.55 : 1.45)
  return slide('agenda', [
    text(38, 18, 520, 34, 'Agenda', { fontSize: 20, bold: true, color: C.blue, valign: 'middle' }, { role: 'title' }),
    rect(39, 58, 111, 6, { fill: C.yellow, radius: 3 }, { role: 'titlebar' }),
    rect(48, 108, 410, 356, { fill: '#F2F8FD', border: C.blue, borderWidth: 1.5, radius: 6 }),
    rect(48, 108, 410, 70, { fill: C.blue, radius: 6 }),
    text(76, 108, 360, 70, 'Finance Initiatives', { fontSize: 18, bold: true, color: C.white, valign: 'middle' }),
    text(76, 192, 360, 262, list(fin), { fontSize: size(fin.length), color: '#15324B', lineHeight: lh(fin.length) }),
    rect(502, 108, 410, 356, { fill: '#FFF9E8', border: C.yellow, borderWidth: 1.5, radius: 6 }),
    rect(502, 108, 410, 70, { fill: C.yellow, radius: 6 }),
    text(530, 108, 360, 70, 'Accounting Initiatives', { fontSize: 18, bold: true, color: C.blue, valign: 'middle' }),
    text(530, 192, 360, 262, list(acc), { fontSize: size(acc.length), color: '#15324B', lineHeight: lh(acc.length) }),
  ], { bg: 'white' })
}

/*
 * THE ROADMAP FROM THE LIST: one row per initiative under FINANCE and
 * ACCOUNTING. The bar runs from the linked project's start (or its milestones'
 * earliest, or January) to the target; "TBC (2027)" runs to the end of the year and says so. Live work with
 * no dates shows its status and no bar — a bar would claim dates nobody gave.
 */
export function initiativeRoadmap(items, chosen, { byKey = {}, year, hasBrand = false } = {}) {
  const yr = year || new Date().getFullYear()
  const rows = []
  for (const team of ['Finance', 'Accounting']) {
    const xs = chosen.filter((x) => (x.team === 'Accounting') === (team === 'Accounting'))
    if (!xs.length) continue
    rows.push({ id: newId(), group: team })
    xs.forEach((it, i) => {
      const p = it.projectKey ? byKey[it.projectKey] : null
      const pill = pillOf(it.status) || 'On Track'
      const t = targetDate(it.target) || targetDate(childrenOf(items, it.id).map((k) => k.target).filter(Boolean).sort().pop())
      const later = t && Number(t.slice(0, 4)) > yr
      const end = later ? `${yr}-12-31` : (t || (p && (p.actualEnd || p.adjustedDue || p.due)) || '')
      // When it began: its own project's start, else the earliest of its milestones' projects, else January.
      const starts = [p, ...childrenOf(items, it.id).map((k) => (k.projectKey ? byKey[k.projectKey] : null))]
        .map((x) => x && x.start).filter((d) => d && d.startsWith(String(yr))).sort()
      const start = end ? (starts[0] || `${yr}-01-01`) : ''
      rows.push({
        id: newId(), projectKey: it.projectKey || null, initiativeId: it.id, label: shortName(it.name, 34), status: pill,
        bar: later ? `→ ${t.slice(0, 4)}` : pill === 'GO LIVE' ? 'Live' : '', start, end, tone: toneFor(pill, i),
      })
    })
  }
  return slide('roadmap', [
    ...titleBlock('F&A Tech Team – Key Initiatives'),
    text(640, 70, 290, 18, `${yr} DELIVERY ROADMAP`, { fontSize: 8, bold: true, color: C.blue, align: 'right', valign: 'middle' }),
    ...(hasBrand ? [image(800, 18, 128, 46, { brand: 'logo' })] : []),
    { id: newId(), type: 'roadmap', x: 26, y: 96, w: 908, h: 428, style: {}, data: { year: yr, rows } },
  ], { bg: 'white' })
}
