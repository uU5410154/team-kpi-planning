/**
 * The home screen's data, and the four things a drag can do to it.
 *
 * Kept apart from the page that draws it, because the interesting part of an
 * iOS home screen is not the animation — it is that dropping one icon onto
 * another makes a folder, dropping it between two makes a gap, and dragging
 * the last icon out of a folder makes the folder disappear. Those are rules,
 * they are worth testing without a browser, and they live here.
 */

/** A tile on the screen: either a shortcut or a folder of them. */
export const isFolder = (item) => !!item && item.type === 'folder'

let seq = 0
export const newId = (prefix = 'app') => {
  seq += 1
  // Not Math.random: two people adding an app in the same second should not be
  // able to collide, and a counter plus the clock is enough for a home screen.
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`
}

export function newApp({ name = 'New app', url = '', icon = null } = {}) {
  return {
    id: newId('app'), type: 'app', name, url, icon,
  }
}

export function newFolder(items, name = 'Folder') {
  return {
    id: newId('folder'), type: 'folder', name, items,
  }
}

/** Everything on the screen, folders opened out — for counting and searching. */
export function flatten(items) {
  return (items || []).flatMap((it) => (isFolder(it) ? it.items || [] : [it]))
}

/** Where an item is: its index on the screen, or inside which folder. */
export function locate(items, id) {
  const top = (items || []).findIndex((it) => it && it.id === id)
  if (top >= 0) return { top, folder: null, index: top }
  for (let i = 0; i < (items || []).length; i++) {
    const it = items[i]
    if (!isFolder(it)) continue
    const at = (it.items || []).findIndex((x) => x && x.id === id)
    if (at >= 0) return { top: i, folder: it.id, index: at }
  }
  return null
}

/** Take an item out of wherever it is, leaving the rest intact. */
export function pluck(items, id) {
  const where = locate(items, id)
  if (!where) return { items, item: null }
  if (!where.folder) {
    const item = items[where.top]
    return { items: items.filter((_, i) => i !== where.top), item }
  }
  const folder = items[where.top]
  const item = folder.items[where.index]
  const rest = folder.items.filter((_, i) => i !== where.index)
  /*
   * A folder holding one app is not a folder — it is an app with an extra tap
   * in front of it. iOS dissolves it, and so does this: the survivor takes the
   * folder's place rather than being orphaned.
   */
  const replacement = rest.length > 1
    ? [{ ...folder, items: rest }]
    : (rest.length === 1 ? [rest[0]] : [])
  return {
    items: items.flatMap((it, i) => (i === where.top ? replacement : [it])),
    item,
  }
}

/** Move an item to a position on the top level. */
export function moveTo(items, id, index) {
  const { items: without, item } = pluck(items, id)
  if (!item) return items
  const at = Math.max(0, Math.min(without.length, index))
  return [...without.slice(0, at), item, ...without.slice(at)]
}

/**
 * Drop one item onto another.
 *
 * Onto a folder, it joins it. Onto an app, the two become a new folder — which
 * is the gesture everybody knows, and the reason a home screen needs no "new
 * folder" button at all.
 */
export function dropOnto(items, dragId, targetId) {
  if (!dragId || !targetId || dragId === targetId) return items
  const target = (items || []).find((it) => it && it.id === targetId)
  if (!target) return items
  // A folder cannot go inside a folder: iOS does not nest them, and neither
  // does anybody's mental model of them.
  const dragged = (items || []).find((it) => it && it.id === dragId)
  if (isFolder(dragged)) return items

  const { items: without, item } = pluck(items, dragId)
  if (!item) return items
  const at = without.findIndex((it) => it && it.id === targetId)
  if (at < 0) return items

  const landing = without[at]
  const merged = isFolder(landing)
    ? { ...landing, items: [...(landing.items || []), item] }
    : newFolder([landing, item], suggestFolderName(landing, item))
  return without.map((it, i) => (i === at ? merged : it))
}

/** Put an item inside a named folder, at the end. */
export function dropIntoFolder(items, dragId, folderId) {
  if (dragId === folderId) return items
  const { items: without, item } = pluck(items, dragId)
  if (!item) return items
  return without.map((it) => (it && it.id === folderId && isFolder(it)
    ? { ...it, items: [...(it.items || []), item] }
    : it))
}

/**
 * A name for a folder nobody has named yet.
 *
 * The longest word the two apps share, if they share one — "Power BI Sales"
 * and "Power BI Margin" become "Power BI" rather than "Folder", which is the
 * small touch that makes the gesture feel like it understood you.
 */
export function suggestFolderName(a, b) {
  const words = (x) => String(x?.name || '').split(/[\s—–-]+/).filter(Boolean)
  const first = words(a)
  const second = new Set(words(b).map((w) => w.toLowerCase()))
  const shared = first.filter((w) => second.has(w.toLowerCase()))
  return shared.length ? shared.join(' ') : 'Folder'
}

/** Rename, re-link or re-ice an item wherever it lives. */
export function patchItem(items, id, patch) {
  return (items || []).map((it) => {
    if (!it) return it
    if (it.id === id) return { ...it, ...patch }
    if (isFolder(it)) return { ...it, items: (it.items || []).map((x) => (x.id === id ? { ...x, ...patch } : x)) }
    return it
  })
}

/** Remove an item, dissolving a folder left holding one app. */
export function removeItem(items, id) {
  const direct = (items || []).filter((it) => it && it.id !== id)
  if (direct.length !== (items || []).length) return direct
  return (items || []).flatMap((it) => {
    if (!isFolder(it)) return [it]
    const rest = (it.items || []).filter((x) => x && x.id !== id)
    if (rest.length === (it.items || []).length) return [it]
    if (rest.length > 1) return [{ ...it, items: rest }]
    return rest.length === 1 ? [rest[0]] : []
  })
}

/**
 * A link somebody typed, made safe to follow.
 *
 * Only http and https. A home screen is a list of links other people click,
 * and javascript: in one of them would be a stored cross-site script with a
 * friendly icon on it.
 */
export function safeUrl(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** A stable colour for an app with no picture, from its name. */
export function tintOf(name) {
  const text = String(name || '?')
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  const hues = [214, 262, 340, 12, 32, 152, 190]
  return hues[h % hues.length]
}

/** The letters shown when there is no picture. */
export function initialsOf(name) {
  const words = String(name || '').split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}
