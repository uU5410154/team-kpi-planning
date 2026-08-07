import { MongoClient } from 'mongodb'

/**
 * Scenario store. The app stays fully usable without Mongo — if no
 * MONGODB_URI is configured, or the cluster is unreachable, every call here
 * reports unavailable and the client falls back to browser-local storage.
 */

// Read lazily, not at module scope: ES imports are hoisted above the .env
// loading in index.js, so anything captured at import time would be empty.
const cfg = () => ({
  uri: process.env.MONGODB_URI || '',
  db: process.env.MONGODB_DB || 'team_kpi_planning',
  collection: process.env.MONGODB_COLLECTION || 'kpi_scenarios',
})

let client = null
let collection = null
let lastError = null

export const isConfigured = () => !!cfg().uri

export async function connect() {
  const { uri: URI, db: DB, collection: COLLECTION } = cfg()
  if (!URI) return null
  if (collection) return collection
  try {
    client = new MongoClient(URI, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      maxPoolSize: 5,
    })
    await client.connect()
    const db = client.db(DB)
    collection = db.collection(COLLECTION)
    // One scenario per name; updatedAt drives the "most recent" listing.
    await collection.createIndex({ name: 1 }, { unique: true })
    await collection.createIndex({ updatedAt: -1 })
    lastError = null
    console.log(`mongo connected — ${DB}.${COLLECTION}`)
    return collection
  } catch (e) {
    lastError = e.message
    collection = null
    console.warn(`mongo unavailable: ${e.message}`)
    return null
  }
}

export async function status() {
  const { uri, db, collection: coll } = cfg()
  if (!uri) return { configured: false, connected: false, reason: 'MONGODB_URI not set' }
  const c = await connect()
  return c
    ? { configured: true, connected: true, db, collection: coll }
    : { configured: true, connected: false, reason: lastError }
}

export async function listScenarios() {
  const c = await connect()
  if (!c) return null
  return c
    .find({}, { projection: { name: 1, updatedAt: 1, updatedBy: 1, _id: 0 } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray()
}

export async function getScenario(name) {
  const c = await connect()
  if (!c) return null
  return c.findOne({ name }, { projection: { _id: 0 } })
}

export async function saveScenario(name, payload, updatedBy) {
  const c = await connect()
  if (!c) return null
  const doc = {
    name,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || 'unknown',
    payload,
  }
  await c.updateOne({ name }, { $set: doc }, { upsert: true })
  return { name: doc.name, updatedAt: doc.updatedAt, updatedBy: doc.updatedBy }
}

export async function deleteScenario(name) {
  const c = await connect()
  if (!c) return null
  const r = await c.deleteOne({ name })
  return { deleted: r.deletedCount }
}

export async function close() {
  if (client) await client.close()
  client = null
  collection = null
}
