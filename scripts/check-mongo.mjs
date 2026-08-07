/**
 * Connectivity probe for the scenario store. Never prints the URI.
 * Run with: node scripts/check-mongo.mjs
 */
import { MongoClient } from 'mongodb'
import { readFileSync } from 'node:fs'

let uri = process.env.MONGODB_URI
if (!uri) {
  // dev convenience: fall back to the sibling project's .env
  try {
    const env = readFileSync('c:/Users/th40184213/Downloads/property-investment/.env', 'utf8')
    uri = env.split('\n').find((l) => l.startsWith('MONGODB_URI='))?.slice('MONGODB_URI='.length).trim()
  } catch { /* ignore */ }
}
if (!uri) {
  console.log('MONGODB_URI not set — nothing to probe')
  process.exit(1)
}

const DB = process.env.MONGODB_DB || 'team_kpi_planning'
const COLL = process.env.MONGODB_COLLECTION || 'kpi_scenarios'

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 })
try {
  await client.connect()
  const admin = client.db().admin()
  const { databases } = await admin.listDatabases()
  console.log('connected OK')
  console.log('databases on the cluster:', databases.map((d) => d.name).join(', '))

  const db = client.db(DB)
  const existing = await db.listCollections().toArray()
  console.log(`target db "${DB}" collections:`, existing.map((c) => c.name).join(', ') || '(none yet)')

  // round-trip a probe document in the project's own collection
  const coll = db.collection(COLL)
  const id = '__probe__'
  await coll.updateOne({ _id: id }, { $set: { ok: true, at: new Date().toISOString() } }, { upsert: true })
  const back = await coll.findOne({ _id: id })
  console.log('write+read round trip:', back?.ok === true ? 'OK' : 'FAILED')
  await coll.deleteOne({ _id: id })
  console.log(`probe cleaned up; "${DB}.${COLL}" is writable`)
} catch (e) {
  console.error('connection failed:', e.message)
  process.exitCode = 1
} finally {
  await client.close()
}
