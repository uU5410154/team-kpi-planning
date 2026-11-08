/*
 * Draw the F&A app icons: one SVG per app in src/data/appCatalog.js, written
 * to public/app-icons/.
 *
 * Calm and consistent on purpose: a flat square in one muted colour per
 * department, the Material glyph for what the app does in white at 85%, no
 * gradient, no sheen. The square is drawn without corners; the page rounds it
 * in CSS, so one radius rule covers these icons and the pictures people upload.
 *
 *   node scripts/make-app-icons.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { APP_CATALOG, slugOf } from '../src/data/appCatalog.js'

const out = new URL('../public/app-icons/', import.meta.url)
mkdirSync(out, { recursive: true })

/** The path(s) of a Material icon, read from its module. */
function glyphPaths(name) {
  const src = readFileSync(new URL(`../node_modules/@mui/icons-material/${name}.js`, import.meta.url), 'utf8')
  const paths = [...src.matchAll(/jsx\)\("path", \{([^}]*)\}/g)].map((m) => {
    const d = (m[1].match(/d: "([^"]+)"/) || [])[1]
    const evenodd = /fillRule: "evenodd"/.test(m[1])
    const opacity = (m[1].match(/opacity: "?([\d.]+)"?/) || [])[1]
    return d ? `<path d="${d}"${evenodd ? ' fill-rule="evenodd"' : ''}${opacity ? ` opacity="${opacity}"` : ''}/>` : ''
  }).filter(Boolean)
  const circles = [...src.matchAll(/jsx\)\("circle", \{([^}]*)\}/g)].map((m) => {
    const g = (k) => (m[1].match(new RegExp(`${k}: "([^"]+)"`)) || [])[1]
    return `<circle cx="${g('cx')}" cy="${g('cy')}" r="${g('r')}"/>`
  })
  if (!paths.length && !circles.length) throw new Error(`No paths in ${name}`)
  return [...paths, ...circles].join('')
}

/** One muted colour per department; anything else is plain slate. */
const DEPARTMENT_COLOR = { Accounting: '#2B4A4F', Finance: '#2E3B57' }
const OTHER = '#353E4B'

const seen = new Set()
for (const a of APP_CATALOG) {
  // One glyph per app: two apps with the same picture defeat the point of one.
  if (seen.has(a.glyph)) throw new Error(`${a.name} reuses the ${a.glyph} glyph`)
  seen.add(a.glyph)
  // A 24-unit Material glyph drawn at 64px, centred on the 128px square.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" fill="${DEPARTMENT_COLOR[a.department] || OTHER}"/>
  <g transform="translate(32 32) scale(2.6667)" fill="#fff" fill-opacity=".85">${glyphPaths(a.glyph)}</g>
</svg>
`
  writeFileSync(new URL(`${slugOf(a.name)}.svg`, out), svg)
}
console.log(`${APP_CATALOG.length} icons written to public/app-icons/`)
