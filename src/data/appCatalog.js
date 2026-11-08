/**
 * THE F&A APP CATALOG: every app the team runs, with its department, where it
 * stands and where it lives. Merged once into the shared Apps screen (by name,
 * so an app somebody already added keeps its place and picks up the rest), and
 * the source of each app's icon in public/app-icons/.
 *
 * `glyph` is the Material icon drawn on the icon, chosen for what the app does;
 * scripts/make-app-icons.mjs turns this list into the SVG files.
 */

/**
 * Where an app stands. `id` is what is stored (and what the team's sheet
 * says); `label` is what the page shows; `tone` is a status tone of the design
 * system (success, info, neutral), drawn as a small pill or dot.
 */
export const APP_STATUSES = [
  { id: 'GO-LIVE', label: 'Live', tone: 'success' },
  { id: 'UAT', label: 'UAT', tone: 'info' },
  { id: 'POC', label: 'POC', tone: 'info' },
  { id: 'Under Development', label: 'In development', tone: 'neutral' },
]

/** The departments the catalog knows, offered first when adding an app. */
export const APP_DEPARTMENTS = ['Accounting', 'Finance']

export const statusOf = (id) => APP_STATUSES.find((s) => s.id === id) || null

export const slugOf = (name) => String(name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export const APP_CATALOG = [
  { name: 'LOI Autocheck', department: 'Accounting', status: 'GO-LIVE', url: 'https://THHOPVAPFAW02:5001', glyph: 'FactCheck' },
  { name: 'Invoice matching', department: 'Accounting', status: 'GO-LIVE', url: 'https://THHOPVAPFAW01:5005', glyph: 'CompareArrows' },
  { name: 'Banchee Chatbot', department: 'Accounting', status: 'GO-LIVE', url: 'https://cpxis.global.lotuss.org/compliance/chat/login', glyph: 'Forum' },
  { name: 'Fixed Asset Transfer', department: 'Accounting', status: 'GO-LIVE', url: 'https://thhopvapfaw01.global.lotuss.org:3004/', glyph: 'SwapHoriz' },
  { name: 'Lease Master', department: 'Accounting', status: 'GO-LIVE', url: 'https://THHOPVAPFAW01:5003', glyph: 'Apartment' },
  { name: 'P&L Webapp', department: 'Finance', status: 'UAT', url: 'https://thhopvapfaw02.global.lotuss.org:5010/', glyph: 'Insights' },
  { name: 'GCFO Platform', department: 'Finance', status: 'POC', url: 'https://gcfo-uat.cpaxtra.co.th/cfo', glyph: 'Dashboard' },
  { name: 'Lotus Analytic hub', department: 'Finance', status: 'POC', url: '', note: 'Upcoming — no link yet', glyph: 'Hub' },
  { name: 'AYP On-Demand (invoices/receipts)', department: 'Accounting', status: 'GO-LIVE', url: 'https://THHOPVAPFAW02:5011', glyph: 'ReceiptLong' },
  { name: 'OCR Service Hub', department: 'Accounting', status: 'GO-LIVE', url: 'https://THHOPVAPFAW02:5013', glyph: 'DocumentScanner' },
  { name: 'BRD Generator', department: 'Accounting', status: 'POC', url: 'https://THHOPVAPFAW02:5016/brdgenerator', glyph: 'EditNote' },
  { name: 'F&A AI Agents (chatbot)', department: 'Finance', status: 'POC', url: 'https://THHOPVAPFAW02:5014', note: 'API on port 8001', glyph: 'AutoAwesome' },
  { name: 'Reconcile Agents', department: 'Accounting', status: 'POC', url: 'https://THHOPVAPFAW02:5016/reconcile-agents', glyph: 'Balance' },
  { name: 'Supplier Inquiry', department: 'Accounting', status: 'POC', url: 'https://THHOPVAPFAW02:5016/supplier-inquiry', glyph: 'ContactSupport' },
  { name: 'Fixed Asset Addition', department: 'Accounting', status: 'Under Development', url: 'https://THHOPVAPFAW01:5013', glyph: 'AddBox' },
  { name: 'Fixed Asset Retirement', department: 'Accounting', status: 'Under Development', url: 'https://thhopvapfaw01.global.lotuss.org:5014/', glyph: 'Archive' },
  { name: 'Fixed Asset Portal', department: 'Accounting', status: 'Under Development', url: 'https://THHOPVAPFAW01:5015', glyph: 'Widgets' },
  { name: 'PO Information Query', department: 'Accounting', status: 'POC', url: 'https://THHOPVAPFAW01:5011', glyph: 'ManageSearch' },
].map((a) => ({ ...a, icon: `/app-icons/${slugOf(a.name)}.svg` }))

/** Bumped when the catalog changes, so the merge runs again once. */
export const APP_CATALOG_VERSION = 1

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

/**
 * The catalog merged into a home screen: an app already there (top level or in
 * a folder) gains its department, status, note and — only where it has none —
 * its link and icon; anything missing is added at the end. Nothing is removed
 * or moved.
 */
export function mergeCatalog(apps = []) {
  const items = Array.isArray(apps) ? apps.map((it) => (it.type === 'folder' ? { ...it, items: [...(it.items || [])] } : { ...it })) : []
  const patch = (app, c) => ({
    ...app,
    department: c.department,
    status: c.status,
    note: c.note || app.note || '',
    url: app.url || c.url,
    icon: app.icon || c.icon,
  })
  for (const c of APP_CATALOG) {
    let found = false
    for (let i = 0; i < items.length && !found; i++) {
      const it = items[i]
      if (it.type === 'folder') {
        const j = (it.items || []).findIndex((x) => sameName(x.name, c.name))
        if (j >= 0) { it.items[j] = patch(it.items[j], c); found = true }
      } else if (sameName(it.name, c.name)) {
        items[i] = patch(it, c)
        found = true
      }
    }
    if (!found) {
      items.push({
        id: `app-${slugOf(c.name)}`, type: 'app', name: c.name, url: c.url, icon: c.icon, department: c.department, status: c.status, note: c.note || '',
      })
    }
  }
  return items
}
