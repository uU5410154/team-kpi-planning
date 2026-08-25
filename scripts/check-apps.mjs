/**
 * The Apps tab: the home-screen rules, and then the same gestures done for
 * real in a browser.
 *
 * The rules are worth checking without a browser because they are where the
 * mistakes live — a folder left holding one app, a folder dropped inside a
 * folder, a javascript: link with a friendly icon on it. The browser half is
 * worth running because "drag one icon onto another" is not a function call,
 * and a page that computes the right answer while putting the icon in the
 * wrong place has still failed.
 *
 *   node scripts/check-apps.mjs
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import puppeteer from 'puppeteer-core'
import {
  newApp, newFolder, isFolder, flatten, locate, pluck, moveTo, dropOnto, dropIntoFolder,
  patchItem, removeItem, safeUrl, suggestFolderName, initialsOf, tintOf, newId,
} from '../src/lib/homeScreen.js'
import { repairState } from '../src/lib/model.js'

// storage.js imports the seed as JSON, which Vite allows and Node does not.
// Read the two ends separately rather than importing it: what matters here is
// that a fresh plan carries a home screen and that the repairs leave it alone.
const seed = JSON.parse(readFileSync(new URL('../src/data/seed.json', import.meta.url), 'utf8'))
const storageSrc = readFileSync(new URL('../src/lib/storage.js', import.meta.url), 'utf8')
const freshState = () => repairState(JSON.parse(JSON.stringify({ ...seed, apps: [] })))

let failures = 0
const check = (name, ok, detail = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}
const names = (items) => items.map((it) => (isFolder(it) ? `[${it.name}:${it.items.map((x) => x.name).join(',')}]` : it.name)).join(' ')

console.log('— the rules —')

const app = (n, url = `https://example.com/${n}`) => newApp({ name: n, url })
let s = [app('Jira'), app('Power BI Sales'), app('Power BI Margin'), app('Confluence')]

check('ids are unique', new Set([newId(), newId(), newId(), newId()]).size === 4)
check('flatten sees inside folders',
  flatten([app('a'), newFolder([app('b'), app('c')])]).length === 3)

/* Reordering. */
const moved = moveTo(s, s[3].id, 0)
check('drag to the front', names(moved) === 'Confluence Jira Power BI Sales Power BI Margin', names(moved))
check('drag to the end', names(moveTo(s, s[0].id, 4)).endsWith('Jira'), names(moveTo(s, s[0].id, 4)))
check('drag onto itself changes nothing', names(moveTo(s, s[1].id, 1)) === names(s))
check('an index past the end clamps', moveTo(s, s[0].id, 99).length === 4)
check('an unknown id is a no-op', moveTo(s, 'nope', 0) === s)

/* Folders. */
const folded = dropOnto(s, s[2].id, s[1].id)
const f = folded.find(isFolder)
check('dropping one app on another makes a folder', !!f && f.items.length === 2)
check('the folder takes the target\'s place', folded.indexOf(f) === 1, String(folded.indexOf(f)))
check('the folder is named from what they share', f.name === 'Power BI', f.name)
check('the screen is one shorter', folded.length === 3, names(folded))
check('nothing is lost', flatten(folded).length === 4)

const three = dropOnto(folded, folded[0].id, f.id)
const f3 = three.find(isFolder)
check('dropping onto a folder joins it', f3.items.length === 3, names(three))
check('it joins at the end', f3.items[2].name === 'Jira')

check('a folder cannot go inside a folder',
  dropOnto([...three, app('Loose')], f3.id, three.find(isFolder).id).filter(isFolder).length === 1)
const nested = dropOnto(
  [newFolder([app('a'), app('b')], 'A'), newFolder([app('c'), app('d')], 'B')],
  'x', 'y',
)
check('a bad drop is a no-op', nested.length === 2)

/* Dissolving. */
const two = newFolder([app('one'), app('two')], 'Pair')
const screen = [two, app('other')]
const out = moveTo(screen, two.items[0].id, 0)
check('taking the second-to-last app out dissolves the folder',
  out.filter(isFolder).length === 0 && out.length === 3, names(out))
check('the survivor keeps the folder\'s place', names(out) === 'one two other', names(out))
const big = newFolder([app('a'), app('b'), app('c')], 'Three')
check('a folder of three survives losing one',
  moveTo([big], big.items[0].id, 0).filter(isFolder).length === 1)
check('removing an app inside a folder can dissolve it',
  removeItem([two], two.items[0].id).filter(isFolder).length === 0)
check('removing a folder removes everything in it',
  removeItem([two, app('other')], two.id).length === 1)

check('dropIntoFolder puts it inside',
  dropIntoFolder([big, app('z')], 'z-not-real', big.id).length === 2)
const loose = [big, app('z')]
const joined = dropIntoFolder(loose, loose[1].id, big.id)
check('...at the end', joined.length === 1 && joined[0].items.length === 4, names(joined))

/* Naming and locating. */
check('no shared word means "Folder"', suggestFolderName(app('Jira'), app('Tableau')) === 'Folder')
check('a shared word wins', suggestFolderName(app('SAP GUI'), app('SAP Fiori')) === 'SAP')
check('locate finds the top level', locate(s, s[2].id).index === 2)
check('locate finds inside a folder', locate([app('x'), big], big.items[1].id).folder === big.id)
check('locate returns null for a stranger', locate(s, 'nope') === null)
check('pluck of a stranger leaves the list alone', pluck(s, 'nope').item === null)

/* Editing. */
const renamed = patchItem([big], big.items[0].id, { name: 'renamed' })
check('rename reaches inside a folder', renamed[0].items[0].name === 'renamed')
check('rename reaches the top level', patchItem(s, s[0].id, { name: 'J' })[0].name === 'J')

/* Links — the part that is security, not polish. */
check('a bare host gets https', safeUrl('lotusretails.atlassian.net') === 'https://lotusretails.atlassian.net/')
check('https is kept', safeUrl('https://a.test/x?y=1') === 'https://a.test/x?y=1')
check('http is allowed', safeUrl('http://a.test/') === 'http://a.test/')
check('javascript: is refused', safeUrl('javascript:alert(1)') === null)
check('JaVaScRiPt: is refused', safeUrl('  JaVaScRiPt:alert(1)  ') === null)
check('data: is refused', safeUrl('data:text/html,<script>x</script>') === null)
check('file: is refused', safeUrl('file:///c:/windows') === null)
check('vbscript: is refused', safeUrl('vbscript:msgbox') === null)
check('empty is refused', safeUrl('   ') === null && safeUrl(null) === null)

/* Icon fallbacks. */
check('initials of two words', initialsOf('Power BI') === 'PB')
check('initials of one word', initialsOf('Jira') === 'JI')
check('initials of nothing', initialsOf('') === '?')
check('the tint is stable', tintOf('Jira') === tintOf('Jira'))
check('the tint is a hue', Number.isFinite(tintOf('x')) && tintOf('x') >= 0 && tintOf('x') < 360)

/* The plan carries it. */
const fresh = freshState()
check('a fresh plan has a home screen', Array.isArray(fresh.apps) && fresh.apps.length === 0)
check('freshState declares it', /apps:\s*\[\]/.test(storageSrc))
const withApps = repairState({ ...fresh, apps: [app('Jira'), newFolder([app('a'), app('b')])] })
check('repairState keeps the home screen', withApps.apps.length === 2, JSON.stringify(withApps.apps?.length))
check('repairState leaves the numbers alone',
  JSON.stringify(repairState({ ...fresh }).projects) === JSON.stringify(withApps.projects))

/* Nothing on this page may touch a number. */
const before = repairState(freshState())
const after = repairState({ ...freshState(), apps: [app('x')] })
check('adding an app changes no project', JSON.stringify(before.projects) === JSON.stringify(after.projects))
check('adding an app changes no person', JSON.stringify(before.people) === JSON.stringify(after.people))

/* ---------- the same thing, in a browser ---------- */

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
]
const exe = BROWSERS.find((p) => existsSync(p))
if (!exe) {
  console.log('\nSKIP — no Chromium-based browser found')
  process.exit(failures ? 1 : 0)
}

console.log('\n— the gestures, in a real browser —')
const PORT = 5327
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), MONGODB_URI: '' },
  stdio: ['ignore', 'ignore', 'pipe'],
})
const base = `http://127.0.0.1:${PORT}`
for (let i = 0; i < 40; i++) {
  try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) })).ok) break } catch { /* wait */ }
  await new Promise((r) => setTimeout(r, 500))
}

const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 1500, height: 1000 })
page.on('dialog', (d) => d.accept().catch(() => {}))

const openTab = async (label) => {
  await page.evaluate((t) => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((b) => b.textContent.trim() === t)
    tab?.click()
  }, label)
  await new Promise((r) => setTimeout(r, 400))
}

/** Every tile on the screen, with where it sits. */
const tiles = () => page.evaluate(() => [...document.querySelectorAll('[data-app-id]')].map((el) => {
  const r = el.getBoundingClientRect()
  return {
    id: el.dataset.appId,
    kind: el.dataset.appKind,
    name: el.dataset.appName,
    x: r.left + r.width / 2,
    y: r.top + 34,
  }
}))

/** Add one app through the dialog, the way a person would. */
const addApp = async (name, url) => {
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === 'Add app')?.click())
  await page.waitForSelector('input[name="app-name"]', { timeout: 5000 })
  await page.type('input[name="app-name"]', name)
  await page.type('input[name="app-url"]', url)
  await page.evaluate(() => [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === 'Add')?.click())
  await new Promise((r) => setTimeout(r, 350))
}

/** Drag one tile onto another slowly enough for the folder timer to fire. */
const dragOnto = async (from, to, { hold = 700 } = {}) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 4, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await new Promise((r) => setTimeout(r, hold))
  await page.mouse.up()
  await new Promise((r) => setTimeout(r, 450))
}

await page.goto(`${base}/`, { waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 900))

await openTab('Apps')
check('the Apps tab opens',
  await page.evaluate(() => !!document.body.textContent.includes('Nothing here yet')))

await addApp('Power BI Sales', 'https://bi.test/sales')
await addApp('Power BI Margin', 'bi.test/margin')
await addApp('Jira', 'https://jira.test')
let t = await tiles()
check('three apps on the screen', t.length === 3, t.map((x) => x.name).join(' | '))
check('a link typed without a scheme is kept',
  await page.evaluate(() => JSON.parse(localStorage.getItem('fa-tech-kpi-2026') || '{}')?.apps?.[1]?.url === 'bi.test/margin'))

/* Drop the second onto the first: a folder. */
await dragOnto(t[1], t[0])
t = await tiles()
const folderTile = t.find((x) => x.kind === 'folder')
check('a drag makes a folder', !!folderTile, t.map((x) => `${x.kind}:${x.name}`).join(' | '))
check('the folder is named from the shared words', (folderTile?.name || '').startsWith('Power BI'), folderTile?.name)
check('the screen is now two tiles', t.length === 2, String(t.length))

/* Drag the third one in. */
await dragOnto(t.find((x) => x.kind !== 'folder'), folderTile)
t = await tiles()
check('a third app joins the folder', t.length === 1 && t[0].kind === 'folder', String(t.length))
check('the folder holds three', await page.evaluate(
  () => JSON.parse(localStorage.getItem('fa-tech-kpi-2026')).apps[0].items.length === 3,
))

/* Open it, take one out, and watch it not dissolve. */
await page.evaluate(() => document.querySelector('[data-app-id]')?.click())
await new Promise((r) => setTimeout(r, 500))
check('the folder opens', await page.evaluate(() => !!document.querySelector('[data-folder-open]')))
await page.evaluate(() => document.querySelector('[data-eject]')?.click())
await new Promise((r) => setTimeout(r, 500))
check('taking one out leaves a folder of two', await page.evaluate(() => {
  const apps = JSON.parse(localStorage.getItem('fa-tech-kpi-2026')).apps
  return apps.length === 2 && apps.some((a) => a.type === 'folder' && a.items.length === 2)
}))

/* And the one after that dissolves it. */
await page.evaluate(() => document.querySelector('[data-eject]')?.click())
await new Promise((r) => setTimeout(r, 500))
check('taking the next one out dissolves the folder', await page.evaluate(() => {
  const apps = JSON.parse(localStorage.getItem('fa-tech-kpi-2026')).apps
  return apps.length === 3 && !apps.some((a) => a.type === 'folder')
}))

/* Reordering survives a reload, because it is in the plan and not the page. */
const order = (await tiles()).map((x) => x.name)
await page.reload({ waitUntil: 'networkidle2' })
await new Promise((r) => setTimeout(r, 900))
await openTab('Apps')
check('the home screen survives a reload',
  JSON.stringify((await tiles()).map((x) => x.name)) === JSON.stringify(order),
  (await tiles()).map((x) => x.name).join(' | '))

/*
 * Reordering — the other half of the gesture, and the one with no folder in
 * it: a quick drag past the last icon should drop it at the end rather than
 * swallow anything on the way.
 */
t = await tiles()
await dragOnto(t[0], { x: t[2].x + 110, y: t[2].y }, { hold: 60 })
check('a quick drag past the end reorders rather than folders',
  (await tiles()).every((x) => x.kind === 'app'))
check('...and it lands at the end',
  (await tiles()).map((x) => x.name).join('|') === 'Power BI Sales|Power BI Margin|Jira',
  (await tiles()).map((x) => x.name).join('|'))

/* And back to the front. */
t = await tiles()
await dragOnto(t[2], { x: t[0].x - 40, y: t[0].y }, { hold: 60 })
check('...and back to the front',
  (await tiles()).map((x) => x.name).join('|') === 'Jira|Power BI Sales|Power BI Margin',
  (await tiles()).map((x) => x.name).join('|'))

/*
 * A drag leaves the screen in edit mode, and a tap there means "edit this",
 * not "launch this" — the same reason a phone does not open apps while they
 * are wiggling.
 */
await page.evaluate(() => [...document.querySelectorAll('[data-app-id]')]
  .find((el) => el.dataset.appName === 'Jira')?.click())
await new Promise((r) => setTimeout(r, 400))
check('a tap while arranging opens the editor, not the link',
  await page.evaluate(() => !!document.querySelector('input[name="app-url"]')))
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find((b) => b.textContent.trim() === 'Cancel')?.click())
await page.evaluate(() => [...document.querySelectorAll('button')]
  .find((b) => b.textContent.trim() === 'Done')?.click())
await new Promise((r) => setTimeout(r, 300))

/* A tap opens the link — in a new tab, and only if the link is a link. */
const opened = await page.evaluate(() => {
  window.__opened = null
  window.open = (u) => { window.__opened = u; return null }
  const tile = [...document.querySelectorAll('[data-app-id]')].find((el) => el.dataset.appName === 'Jira')
  tile.click()
  return window.__opened
})
check('a tap follows the link', opened === 'https://jira.test/', String(opened))

/* The numbers this page must not touch. */
const numbers = await page.evaluate(() => {
  const s2 = JSON.parse(localStorage.getItem('fa-tech-kpi-2026'))
  return { projects: s2.projects.length, people: s2.people.length }
})
check('the register is untouched by all of that',
  numbers.projects > 0 && numbers.people > 0, JSON.stringify(numbers))

await browser.close()
server.kill()
console.log(failures ? `\n${failures} failed` : '\nall good')
process.exit(failures ? 1 : 0)
