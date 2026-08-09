/**
 * End-to-end read/write test of the scenario store against a REAL MongoDB
 * server (mongodb-memory-server downloads and runs an actual mongod, so this
 * exercises the genuine driver and wire protocol, not a mock).
 *
 * Run with: node scripts/check-db.mjs
 */
import { MongoMemoryServer } from 'mongodb-memory-server'
import { readFileSync } from 'node:fs'

const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

console.log('starting a real mongod…')
const mongod = await MongoMemoryServer.create()
const uri = mongod.getUri()
console.log(`mongod up on ${uri.replace(/\/\/.*@/, '//')}\n`)

// Point the store at it BEFORE importing, since db.js reads env lazily.
process.env.MONGODB_URI = uri
process.env.MONGODB_DB = 'team_kpi_planning'
process.env.MONGODB_COLLECTION = 'kpi_scenarios'

const store = await import('../server/db.js')

try {
  // ---- connect ----
  const st = await store.status()
  check('connects to the server', st.connected === true, JSON.stringify(st))
  check('targets the right db and collection', st.db === 'team_kpi_planning' && st.collection === 'kpi_scenarios')

  // ---- empty state ----
  check('lists empty before any write', (await store.listScenarios()).length === 0)
  // null must mean "not found"; UNAVAILABLE is reserved for an outage, so a
  // missing scenario can never be mistaken for the store being down
  const missing = await store.getScenario('nope')
  check('unknown scenario returns null, not UNAVAILABLE',
    missing === null && missing !== store.UNAVAILABLE)

  // ---- write ----
  const payload = { people: seed.people, projects: seed.projects, settings: { targetHours: 3000, savingBasis: 'monthly' } }
  const saved = await store.saveScenario('Baseline', payload, 'Gun')
  check('writes a scenario', saved?.name === 'Baseline', JSON.stringify(saved))
  check('records who saved it', saved.updatedBy === 'Gun')
  check('records a timestamp', !!Date.parse(saved.updatedAt))

  // ---- read back, byte for byte ----
  const back = await store.getScenario('Baseline')
  check('reads the scenario back', !!back)
  check('project count survives the round trip', back.payload.projects.length === seed.projects.length,
    `${back.payload.projects.length} vs ${seed.projects.length}`)
  check('people survive the round trip', back.payload.people.length === seed.people.length)
  check('settings survive the round trip', back.payload.settings.targetHours === 3000)

  const sumIn = seed.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  const sumOut = back.payload.projects.reduce((a, p) => a + (p.savingHours ?? 0), 0)
  check('saving hours survive exactly', Math.abs(sumIn - sumOut) < 1e-9, `${sumOut.toFixed(1)} vs ${sumIn.toFixed(1)}`)

  const deep = JSON.stringify(back.payload.projects) === JSON.stringify(seed.projects)
  check('every project field is identical after the round trip', deep)

  // nulls must not become undefined/0 — TBC saving hours depend on it
  const tbcIn = seed.projects.filter((p) => p.savingHours === null).length
  const tbcOut = back.payload.projects.filter((p) => p.savingHours === null).length
  check('null saving hours stay null', tbcIn === tbcOut, `${tbcOut} vs ${tbcIn}`)

  // ---- KPI overrides (nested objects) ----
  const withKpi = {
    ...payload,
    people: payload.people.map((p) =>
      p.id === 'gun' ? { ...p, kpi: { 'obj-financial': { weight: 0.2, target: '5% growth' } } } : p),
  }
  await store.saveScenario('Baseline', withKpi, 'Gun')
  const k = (await store.getScenario('Baseline')).payload.people.find((p) => p.id === 'gun')
  check('nested KPI overrides survive', k.kpi['obj-financial'].weight === 0.2 && k.kpi['obj-financial'].target === '5% growth',
    JSON.stringify(k.kpi))

  // ---- CAPEX and OPEX (a number, a null and a nested array) ----
  // These are stored fields, so they have to survive Mongo untouched: a null
  // CAPEX must not come back as 0, and an OPEX line's start/end months must not
  // come back as strings, or every cost in the app moves on the next load.
  const withCosts = {
    ...payload,
    projects: payload.projects.map((p, i) => (i === 0
      ? {
        ...p,
        capex: 250000,
        capexNote: 'servers, licences',
        opex: [
          { id: 'o1', label: 'Cloud hosting', monthly: 12000, startMonth: 3, endMonth: 9 },
          { id: 'o2', label: 'Support', monthly: 4500, startMonth: 1, endMonth: 12 },
        ],
      }
      : { ...p, capex: null, capexNote: '', opex: [] })),
  }
  await store.saveScenario('Baseline', withCosts, 'Gun')
  const costed = (await store.getScenario('Baseline')).payload.projects
  check('CAPEX survives the round trip as a number',
    costed[0].capex === 250000 && costed[0].capexNote === 'servers, licences', JSON.stringify(costed[0].capex))
  check('an unset CAPEX stays null rather than becoming 0',
    costed[1].capex === null, JSON.stringify(costed[1].capex))
  check('the OPEX lines survive with their months intact',
    costed[0].opex.length === 2
    && costed[0].opex[0].monthly === 12000
    && costed[0].opex[0].startMonth === 3 && costed[0].opex[0].endMonth === 9
    && costed[0].opex[1].label === 'Support',
    JSON.stringify(costed[0].opex))
  check('an empty OPEX list stays an empty array',
    Array.isArray(costed[1].opex) && costed[1].opex.length === 0)
  await store.saveScenario('Baseline', payload, 'Gun')

  // ---- tasks and comments ----
  // Tasks carry the effort now, so a manday coming back as a string, or a task
  // list coming back as an object, would move every cost on the next load.
  const withTasks = {
    ...payload,
    projects: payload.projects.map((p, i) => (i === 0
      ? {
        ...p,
        tasks: [
          { id: 't1', label: 'Design', manday: 4, note: 'incl. review' },
          { id: 't2', label: 'Build', manday: 11.5, note: '' },
        ],
        comment: 'spec: https://example.com/a\nsecond line',
      }
      : { ...p, tasks: [], comment: '' })),
  }
  await store.saveScenario('Baseline', withTasks, 'Gun')
  const tk = (await store.getScenario('Baseline')).payload.projects
  check('tasks survive the round trip with their numbers intact',
    tk[0].tasks.length === 2 && tk[0].tasks[0].manday === 4 && tk[0].tasks[1].manday === 11.5
    && tk[0].tasks[0].label === 'Design', JSON.stringify(tk[0].tasks))
  check('an empty task list stays an empty array',
    Array.isArray(tk[1].tasks) && tk[1].tasks.length === 0)
  check('a multi-line comment with a link survives byte for byte',
    tk[0].comment === 'spec: https://example.com/a\nsecond line', JSON.stringify(tk[0].comment))
  await store.saveScenario('Baseline', payload, 'Gun')

  // ---- objectives added by hand ----
  const withExtra = {
    ...payload,
    people: payload.people.map((p) => (p.id === 'james' ? { ...p, extraObjectives: ['datawarehouse'] } : p)),
  }
  await store.saveScenario('Baseline', withExtra, 'Gun')
  const ex = (await store.getScenario('Baseline')).payload.people.find((p) => p.id === 'james')
  check('a hand-added objective survives the round trip',
    Array.isArray(ex.extraObjectives) && ex.extraObjectives[0] === 'datawarehouse',
    JSON.stringify(ex.extraObjectives))
  await store.saveScenario('Baseline', payload, 'Gun')

  // ---- update in place, not duplicate ----
  check('re-saving the same name updates rather than duplicates', (await store.listScenarios()).length === 1)

  // ---- second scenario + ordering ----
  await new Promise((r) => setTimeout(r, 15))
  await store.saveScenario('Aggressive case', payload, 'Kade')
  const list = await store.listScenarios()
  check('lists both scenarios', list.length === 2, list.map((x) => x.name).join(', '))
  check('most recently updated comes first', list[0].name === 'Aggressive case', list[0].name)
  check('listing omits the heavy payload', list[0].payload === undefined)

  // ---- unicode / awkward names ----
  await store.saveScenario('บัญชี 2026 · v2', payload, 'ป้อ')
  const uni = await store.getScenario('บัญชี 2026 · v2')
  check('handles Thai text in names and authors', !!uni && uni.updatedBy === 'ป้อ')

  // ---- delete ----
  check('deletes a scenario', (await store.deleteScenario('Aggressive case')).deleted === 1)
  check('deleted scenario is gone', (await store.getScenario('Aggressive case')) === null)
  check('the others are untouched', (await store.listScenarios()).length === 2)

  // ---- reconnect: data persists across a client restart ----
  await store.close()
  const again = await store.status()
  check('reconnects after close', again.connected === true)
  const persisted = await store.getScenario('Baseline')
  check('data survives a reconnect', persisted?.payload.projects.length === seed.projects.length)

  // ---- payload size sanity (Mongo caps documents at 16MB) ----
  const bytes = Buffer.byteLength(JSON.stringify({ payload }))
  check('payload is well under the 16MB document cap', bytes < 16 * 1024 * 1024,
    `${(bytes / 1024).toFixed(0)} KB`)
} finally {
  await store.close()
  await mongod.stop()
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
