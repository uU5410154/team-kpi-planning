/**
 * The two changes P'Puu asked for, applied to the shared plan.
 *
 *   1. Objective 1 is no longer Financial. That is a code change — the
 *      objective itself was redefined — and needs nothing here except the
 *      stored targets from the old one cleared, which repairState does.
 *   2. Pol holds Objective 3, with the target being O2O and B2B on the data
 *      warehouse.
 *
 *   node scripts/apply-boss-kpi.mjs          # show what would change
 *   node scripts/apply-boss-kpi.mjs --write  # save it
 */
import { computePlan, repairState } from '../src/lib/model.js'

const BASE = process.env.KPI_BASE || 'https://team-kpi-planning.onrender.com'
const SCENARIO = process.env.KPI_SCENARIO || 'Baseline'
const WRITE = process.argv.includes('--write')
const DW_TARGET = 'O2O and B2B on the Data warehouse, by Nov 2026'

const doc = await (await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`)).json()
const state = doc.payload?.state || doc.payload
console.log(`plan "${doc.name}" saved ${doc.updatedAt} by ${doc.updatedBy}: ${state.projects.length} projects`)

const people = state.people.map((p) => {
  if (p.id !== 'pol') return p
  /*
   * `extraObjectives` is the register's way of saying "this person is measured
   * on something the project book does not already put on them". Pol carries
   * no data-warehouse project yet, and that is the point: the objective is
   * what he is being asked to deliver, not a description of what he has.
   */
  const extra = new Set([...(p.extraObjectives || []), 'datawarehouse'])
  return {
    ...p,
    extraObjectives: [...extra],
    kpi: {
      ...(p.kpi || {}),
      'obj-datawarehouse': { ...((p.kpi || {})['obj-datawarehouse'] || {}), target: DW_TARGET },
    },
  }
})

const next = repairState({ ...state, people })
const before = computePlan(repairState({ ...state }))
const after = computePlan(next)

const line = (plan, id, obj) => plan.people.find((x) => x.id === id)?.kpiLines.find((l) => l.objective === obj)

console.log('\nobjective 1 — was Financial, now Project management:')
for (const p of after.people) {
  const l = line(after, p.id, 'delivery')
  console.log(`  ${p.nick.padEnd(9)} target ${String(l.target).padStart(3)}%  now `
    + `${(l.creditedRatio == null ? '—' : `${Math.round(l.creditedRatio * 100)}%`).padStart(5)}`
    + `  (${l.onTime} of ${l.judged} landed within ${l.sprintDays} days)  ${l.meetsTarget ? 'meets' : 'below'}`)
}

console.log('\nobjective 3 — who holds it:')
for (const p of after.people) {
  const was = line(before, p.id, 'datawarehouse')
  const now = line(after, p.id, 'datawarehouse')
  console.log(`  ${p.nick.padEnd(9)} ${was ? 'held' : '—'.padEnd(4)} -> ${now ? `holds, target ${JSON.stringify(now.target)}` : '—'}`)
}

console.log('\nevery card still totals 100%:', after.invalid.length === 0)
for (const p of after.people) {
  const sum = p.kpiLines.reduce((a, l) => a + l.weight, 0)
  console.log(`  ${p.nick.padEnd(9)} ${(sum * 100).toFixed(0)}% across ${p.kpiLines.length} lines`)
}
console.log('saving hours unchanged:',
  JSON.stringify(before.people.map((p) => Math.round(p.kpiTotals.savingHours)))
  === JSON.stringify(after.people.map((p) => Math.round(p.kpiTotals.savingHours))))

if (!WRITE) { console.log('\nDRY RUN — pass --write to save it'); process.exit(0) }
const res = await fetch(`${BASE}/api/scenarios/${encodeURIComponent(SCENARIO)}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: next, updatedBy: 'KPI change from P’Puu' }),
})
if (!res.ok) throw new Error(`save failed: ${res.status} ${await res.text()}`)
console.log('\nSAVED')
