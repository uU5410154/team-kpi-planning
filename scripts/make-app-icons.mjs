/*
 * Draw the F&A app icons: one SVG per app in src/data/appCatalog.js, written
 * to public/app-icons/. A rounded square in a muted tone of its department
 * (teal to blue for Accounting, indigo to violet for Finance), each app its
 * own shade, with the Material glyph for what it does on top.
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

const RANGE = { Accounting: [168, 214], Finance: [228, 272] }
const byDept = {}
for (const a of APP_CATALOG) (byDept[a.department] = byDept[a.department] || []).push(a)

for (const a of APP_CATALOG) {
  const list = byDept[a.department]
  const [lo, hi] = RANGE[a.department] || [200, 240]
  const hue = Math.round(lo + ((hi - lo) * list.indexOf(a)) / Math.max(1, list.length - 1))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 46% 44%)"/>
      <stop offset="1" stop-color="hsl(${hue + 8} 50% 27%)"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".16"/>
      <stop offset=".55" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#bg)"/>
  <rect width="128" height="128" rx="28" fill="url(#sheen)"/>
  <rect x=".75" y=".75" width="126.5" height="126.5" rx="27.25" fill="none" stroke="#fff" stroke-opacity=".12" stroke-width="1.5"/>
  <g transform="translate(30 30) scale(2.8333)" fill="#fff" fill-opacity=".94">${glyphPaths(a.glyph)}</g>
</svg>
`
  writeFileSync(new URL(`${slugOf(a.name)}.svg`, out), svg)
}
console.log(`${APP_CATALOG.length} icons written to public/app-icons/`)
