import { computePlan, repairState, fmtRoi, DEFAULT_FINANCE } from '../src/lib/model.js'
const BASE = 'https://team-kpi-planning.onrender.com'
const doc = await (await fetch(`${BASE}/api/scenarios/Baseline`)).json()
const state = doc.payload?.state || doc.payload
const before = computePlan(repairState(state))
const next = {
  ...state,
  settings: { ...state.settings, finance: { ...state.settings.finance, roiGate: DEFAULT_FINANCE.roiGate } },
}
const after = computePlan(repairState(next))
console.log('gate      :', fmtRoi(before.finance.roiGate), '->', fmtRoi(after.finance.roiGate))
console.log('portfolio :', fmtRoi(after.finance.roi), after.finance.roi >= after.finance.roiGate ? '(clears it)' : '(BELOW the gate)')
for (const p of after.people) {
  const l = p.kpiLines.find((x) => x.objective === 'financial')
  const b = before.people.find((x) => x.id === p.id).kpiLines.find((x) => x.objective === 'financial')
  console.log(`  ${p.nick.padEnd(9)} target ${String(b.target).padStart(4)}% -> ${String(l.target).padStart(4)}%   now ${l.creditedRatio == null ? '—' : fmtRoi(l.creditedRatio).padStart(6)}  ${l.meetsTarget ? 'meets' : 'BELOW'}`)
}
console.log('saving hours unchanged:', JSON.stringify(before.people.map((p) => Math.round(p.kpiTotals.savingHours))) === JSON.stringify(after.people.map((p) => Math.round(p.kpiTotals.savingHours))))
console.log('scorecards valid      :', after.invalid.length === 0)
if (!process.argv.includes('--write')) { console.log('\nDRY RUN'); process.exit(0) }
const r = await fetch(`${BASE}/api/scenarios/Baseline`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ payload: next, updatedBy: 'restore ROI gate' }),
})
if (!r.ok) throw new Error(await r.text())
const back = await (await fetch(`${BASE}/api/scenarios/Baseline`)).json()
console.log('\nSAVED — gate in the database is now', (back.payload.settings.finance.roiGate * 100).toFixed(0) + '%')
