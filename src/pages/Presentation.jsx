import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, IconButton, Tooltip, Menu, MenuItem, ListItemIcon, ListItemText, Divider, TextField, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Chip, CircularProgress, Snackbar, Tabs, Tab,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SlideshowIcon from '@mui/icons-material/Slideshow'
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined'
import UndoIcon from '@mui/icons-material/Undo'
import RedoIcon from '@mui/icons-material/Redo'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import ImageIcon from '@mui/icons-material/ImageOutlined'
import ViewModuleIcon from '@mui/icons-material/ViewModuleOutlined'
import LabelIcon from '@mui/icons-material/LabelOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'
import PaletteIcon from '@mui/icons-material/PaletteOutlined'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import * as api from '../lib/api.js'
import Loading from '../components/Loading.jsx'
import { SlideView } from '../presentation/render.jsx'
import Canvas from '../presentation/Canvas.jsx'
import Inspector from '../presentation/Inspector.jsx'
import Present from '../presentation/Present.jsx'
import ProjectDrill from '../presentation/ProjectDrill.jsx'
import { ProjectPicker, NewDeckDialog, AiDialog, BrandDialog, InitiativePicker } from '../presentation/Dialogs.jsx'
import InitiativesEditor from '../presentation/InitiativesEditor.jsx'
import {
  initiativeAgenda, initiativeCardsSlides, initiativeRoadmap, cardFromInitiative, pillOf, targetDate,
} from '../presentation/initiatives.js'
import { downloadPptx } from '../presentation/exportPptx.js'
import { W, H, C } from '../presentation/theme.js'
import {
  newId, text, rect, image, coverSlide, agendaSlide, updatesSlides, roadmapSlide, tasksSlide, sectionSlide, imageSlide, thanksSlide,
  blankSlide, standardDeck, cardFromProject, cardFromFacts, deckStatus,
} from '../presentation/templates.js'
import { toneFor } from '../presentation/layout.js'

/*
 * PRESENTATION: the team's decks for meetings, in the IT governance format.
 *
 * Two halves. The list of the team's decks — one shared list, anybody may
 * open any of them. And a deck open for editing: slides down the left, the
 * slide in the middle, what is selected on the right. Every change is saved
 * on its own a moment later; two people saving the same deck are told rather
 * than one silently undoing the other.
 *
 * A deck's address is #presentation/<id>, so a link opens it.
 */

const reId = (el) => ({ ...el, id: newId() })
const copySlide = (s) => ({ ...s, id: newId(), elements: s.elements.map(reId) })
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)

/* A picture made small enough to keep: at most 1920 wide, JPEG unless it needs to be clear. */
async function shrink(file) {
  const url = await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('That picture could not be read.'))
    r.readAsDataURL(file)
  })
  if (file.size < 1_200_000 && file.type !== 'image/gif') return url
  const im = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('That is not a picture.')); i.src = url })
  const s = Math.min(1, 1920 / im.naturalWidth)
  const cv = document.createElement('canvas')
  cv.width = Math.round(im.naturalWidth * s)
  cv.height = Math.round(im.naturalHeight * s)
  cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height)
  return file.type === 'image/png' && s === 1 ? cv.toDataURL('image/png') : cv.toDataURL('image/jpeg', 0.86)
}

const pictureSize = (dataUrl) => new Promise((resolve) => {
  const i = new Image()
  i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight })
  i.onerror = () => resolve({ w: 16, h: 9 })
  i.src = dataUrl
})

/* ======================================================================= */

export default function Presentation({ plan, me }) {
  // The AI is for everybody here, members included — asked for on its own.
  const [aiOn, setAiOn] = useState(false)
  useEffect(() => { api.aiStatus().then((r) => setAiOn(!!r.configured)).catch(() => setAiOn(false)) }, [])
  const projects = useMemo(() => (plan?.projects || []).filter((p) => !p.deleted && p.key), [plan])
  const byKey = useMemo(() => Object.fromEntries(projects.map((p) => [p.key, p])), [projects])
  const isAdmin = me?.role === 'admin'

  const [decks, setDecks] = useState(null)
  const [listError, setListError] = useState(null)
  const [brand, setBrand] = useState({})
  const [deck, setDeck] = useState(null)
  const [opening, setOpening] = useState(false)
  const [toast, setToast] = useState(null)
  const [newOpen, setNewOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [view, setView] = useState('decks')
  const [initiatives, setInitiatives] = useState([])

  const loadList = useCallback(async () => {
    try { setDecks(await api.listDecks()); setListError(null) } catch (e) { setListError(api.plainError(e)) }
  }, [])

  useEffect(() => {
    loadList()
    api.deckBrand().then(setBrand).catch(() => {})
  }, [loadList])
  // The initiative list, for "new deck from the list" — read again after editing it.
  useEffect(() => {
    if (view === 'decks') api.getInitiatives().then((r) => setInitiatives(r.items || [])).catch(() => {})
  }, [view])

  const open = useCallback(async (id) => {
    setOpening(true)
    try {
      const d = await api.getDeck(id)
      setDeck(d)
      if (window.location.hash !== `#presentation/${id}`) window.history.replaceState(null, '', `#presentation/${id}`)
    } catch (e) {
      setToast({ severity: 'error', msg: api.plainError(e) })
      window.history.replaceState(null, '', '#presentation')
    } finally {
      setOpening(false)
    }
  }, [])

  // A link to a deck opens it.
  useEffect(() => {
    const read = () => {
      const m = window.location.hash.match(/^#presentation\/([A-Za-z0-9_-]+)/)
      if (m && m[1] !== deck?.id) open(m[1])
      if (!m && deck) setDeck(null)
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [open, deck])

  const close = () => {
    setDeck(null)
    window.history.replaceState(null, '', '#presentation')
    loadList()
  }

  /* ----------------------------------------------------------- new deck */

  const create = async ({ title, date, kind, keys, ask }) => {
    let slides
    const chosen = projects.filter((p) => keys.includes(p.key))
    if (kind === 'initiatives') {
      const tops = initiatives.filter((x) => !x.parentId)
      const fin = tops.filter((x) => x.team !== 'Accounting')
      const acc = tops.filter((x) => x.team === 'Accounting')
      slides = [
        coverSlide({ title, date, hasBrand: !!brand.logo }),
        initiativeAgenda(initiatives, tops),
        ...(fin.length ? initiativeCardsSlides(initiatives, fin, byKey, 'Finance') : []),
        ...(acc.length ? initiativeCardsSlides(initiatives, acc, byKey, 'Accounting') : []),
        initiativeRoadmap(initiatives, tops, { byKey, year: Number(String(date || '').slice(0, 4)) || undefined, hasBrand: !!brand.logo }),
        thanksSlide(),
      ]
    } else if (kind === 'blank') {
      slides = [coverSlide({ title, date, hasBrand: !!brand.logo })]
    } else if (kind === 'ai') {
      const r = await api.deckAi({ mode: 'plan', request: ask, projects: projects.map((p) => ({ key: p.key, summary: p.summary, team: p.team, status: p.status, start: p.start, due: p.due })) })
      slides = await fromPlan(r, { title: title || r.title, date })
    } else {
      slides = standardDeck(chosen, { title, date, hasBrand: brand })
      slides = await withFacts(slides)
    }
    const d = await api.createDeck({ title, date, slides })
    setNewOpen(false)
    setDeck(d)
    window.history.replaceState(null, '', `#presentation/${d.id}`)
  }

  /* Fill every card in these slides from the projects' weekly updates. */
  const withFacts = async (slides) => {
    const keys = [...new Set(slides.flatMap((s) => s.elements.filter((e) => e.type === 'card' && e.data?.projectKey).map((e) => e.data.projectKey)))]
    if (!keys.length) return slides
    let facts = {}
    try { facts = await api.deckFacts(keys) } catch { return slides }
    return slides.map((s) => ({
      ...s,
      elements: s.elements.map((e) => (e.type === 'card' && facts[e.data?.projectKey]
        ? { ...e, data: { ...e.data, ...cardFromFacts(byKey[e.data.projectKey], facts[e.data.projectKey]) } }
        : e)),
    }))
  }

  /* The AI's plan of a deck, laid out in the deck's format. */
  const fromPlan = async (r, { title, date }) => {
    const out = []
    const pick = (ks) => ks.map((k) => byKey[k]).filter(Boolean)
    for (const s of r.slides) {
      if (s.kind === 'cover') out.push(coverSlide({ title: s.title || title, subtitle: s.subtitle || r.subtitle || 'by F&A Tech Solution Team', date, hasBrand: !!brand.logo }))
      else if (s.kind === 'agenda') out.push(agendaSlide(pick(s.projectKeys.length ? s.projectKeys : r.slides.flatMap((x) => x.projectKeys))))
      else if (s.kind === 'updates') out.push(...updatesSlides(s.title || 'Project Update', pick(s.projectKeys).map(cardFromProject)))
      else if (s.kind === 'roadmap') out.push(roadmapSlide(pick(s.projectKeys), { hasBrand: !!brand.logo, title: s.title || undefined }))
      else if (s.kind === 'tasks' && s.projectKeys[0] && byKey[s.projectKeys[0]]) out.push(await tasksFor(byKey[s.projectKeys[0]]))
      else if (s.kind === 'section') out.push(sectionSlide(/account/i.test(s.title) ? 'Accounting' : 'Finance', { hasBrand: !!brand[/account/i.test(s.title) ? 'accounting' : 'finance'] }))
      else if (s.kind === 'image') out.push(imageSlide(s.title || 'Screenshot'))
      else if (s.kind === 'thanks') out.push(thanksSlide())
    }
    if (!out.length || out[0].kind !== 'cover') out.unshift(coverSlide({ title, date, hasBrand: !!brand.logo }))
    return withFacts(out)
  }

  const tasksFor = async (p) => {
    let issues = []
    if (p.jiraKey) {
      try {
        const r = await api.jiraChildren([p.jiraKey])
        issues = (r.byParent && r.byParent[String(p.jiraKey).toUpperCase()]) || []
      } catch { /* an empty timeline, to fill in by hand */ }
    }
    return tasksSlide(p, issues)
  }

  /* ---------------------------------------------------------- the list */

  if (!deck) {
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flex: 1, minWidth: 220 }}>
            <Typography variant="h3">Presentations</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The team&rsquo;s decks for meetings, in the IT governance format. Anybody on the team can open and edit any of them.
            </Typography>
          </Box>
          <Button startIcon={<PaletteIcon />} onClick={() => setBrandOpen(true)}>Deck pictures</Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>New presentation</Button>
        </Box>
        <Tabs value={view} onChange={(_e, v) => setView(v)} sx={{ mb: 2, minHeight: 36 }}>
          <Tab value="decks" label="Decks" sx={{ minHeight: 36 }} />
          <Tab value="initiatives" label="Initiatives" sx={{ minHeight: 36 }} />
        </Tabs>
        {view === 'initiatives' && <InitiativesEditor projects={projects} />}
        {view === 'decks' && (
        <>
        {listError && <Alert severity="error" sx={{ mb: 2 }}>{listError}</Alert>}
        {(!decks || opening) && !listError && <Loading label={opening ? 'Opening the deck…' : 'Loading the decks…'} />}
        {decks && !opening && !decks.length && (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body1" sx={{ mb: 1.5 }}>No presentations yet.</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNewOpen(true)}>Make the first one</Button>
          </Paper>
        )}
        {decks && !opening && !!decks.length && (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 2 }}>
            {decks.map((d) => (
              <Paper
                key={d.id} variant="outlined" onClick={() => open(d.id)}
                sx={{ cursor: 'pointer', overflow: 'hidden', '&:hover': { borderColor: 'primary.main' } }}
              >
                <Box sx={{ bgcolor: '#fff', aspectRatio: '16 / 9', overflow: 'hidden' }}>
                  {d.first ? <DeckThumb slide={d.first} brand={brand} /> : null}
                </Box>
                <Box sx={{ p: 1.5 }}>
                  <Typography variant="subtitle2" noWrap>{d.title}</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {d.slideCount} slide{d.slideCount === 1 ? '' : 's'}{d.date ? ` · ${d.date}` : ''} · edited by {String(d.updatedBy || '').split('@')[0]} {new Date(d.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </Box>
        )}
        </>
        )}
        {newOpen && <NewDeckDialog open projects={projects} initiatives={initiatives} aiOn={aiOn} onClose={() => setNewOpen(false)} onCreate={create} />}
        {brandOpen && <BrandEditor brand={brand} isAdmin={isAdmin} onBrand={setBrand} onClose={() => setBrandOpen(false)} />}
        <Snackbar open={!!toast} autoHideDuration={5000} onClose={() => setToast(null)}>
          {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
        </Snackbar>
      </Box>
    )
  }

  return (
    <Editor
      key={deck.id}
      initial={deck}
      brand={brand}
      onBrand={setBrand}
      projects={projects}
      byKey={byKey}
      me={me}
      aiOn={aiOn}
      onClose={close}
      tasksFor={tasksFor}
      withFacts={withFacts}
    />
  )
}

/* A deck's first slide, sized to its card in the list. */
function DeckThumb({ slide, brand }) {
  const ref = useRef(null)
  const [w, setW] = useState(260)
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return <Box ref={ref} sx={{ width: '100%', height: '100%' }}><SlideView slide={slide} brand={brand} width={w} /></Box>
}

/* The deck pictures dialog, with its uploads. */
function BrandEditor({ brand, isAdmin, onBrand, onClose }) {
  const upload = async (key, file) => {
    const dataUrl = await shrink(file)
    const a = await api.addDeckAsset(dataUrl, file.name)
    onBrand(await api.setDeckBrand({ [key]: a.id }))
  }
  const clear = async (key) => onBrand(await api.setDeckBrand({ [key]: null }))
  return <BrandDialog open brand={brand} isAdmin={isAdmin} onClose={onClose} onUpload={upload} onClear={clear} />
}

/* ======================================================================= */
/*                                 THE EDITOR                              */
/* ======================================================================= */

function Editor({ initial, brand, onBrand, projects, byKey, me, aiOn, onClose, tasksFor, withFacts }) {
  const [deck, setDeck] = useState(initial)
  const [cur, setCur] = useState(initial.slides[0]?.id || null)
  const [selected, setSelected] = useState([])
  const [save, setSave] = useState({ state: 'saved', at: initial.updatedAt })
  const [conflict, setConflict] = useState(null)
  const [toast, setToast] = useState(null)
  const [picker, setPicker] = useState(null) // { title, single, onPick }
  const [initPicker, setInitPicker] = useState(null) // { title, items, resolve }
  const [aiOpen, setAiOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [present, setPresent] = useState(null)
  const [drill, setDrill] = useState(null)
  const [menus, setMenus] = useState({})
  const [exporting, setExporting] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [, setTick] = useState(0)

  const deckRef = useRef(deck)
  deckRef.current = deck
  const rev = useRef(initial.rev)
  const ver = useRef(0)
  const savedVer = useRef(0)
  const past = useRef([])
  const future = useRef([])
  const lastPush = useRef({ key: null, at: 0 })
  const clip = useRef(null)
  const timer = useRef(null)
  const center = useRef(null)
  const [cw, setCw] = useState(760)

  const slide = deck.slides.find((s) => s.id === cur) || deck.slides[0] || null
  const index = slide ? deck.slides.indexOf(slide) : -1

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setCw(Math.max(320, Math.floor(e.contentRect.width))))
    if (center.current) ro.observe(center.current)
    return () => ro.disconnect()
  }, [])

  /* ------------------------------------------------------- history, saving */

  const snapshot = (d) => ({ title: d.title, date: d.date, slides: d.slides })

  /*
   * Every change goes through here. One undo step per change — except that
   * changes to the same thing within a second (typing, a slider) are one step.
   */
  const apply = useCallback((fn, key = null) => {
    const now = Date.now()
    const merge = key && lastPush.current.key === key && now - lastPush.current.at < 1000
    if (!merge) {
      past.current.push(snapshot(deckRef.current))
      if (past.current.length > 80) past.current.shift()
      future.current = []
    }
    lastPush.current = { key, at: now }
    setDeck((d) => fn(d))
    ver.current += 1
    setTick((t) => t + 1)
  }, [])

  /* Called once at the start of a drag or a typed edit on the canvas. */
  const begin = useCallback(() => {
    past.current.push(snapshot(deckRef.current))
    future.current = []
    lastPush.current = { key: null, at: 0 }
  }, [])
  const slideId = slide?.id
  const changeSlide = useCallback((fn) => {
    setDeck((d) => ({ ...d, slides: d.slides.map((s) => (s.id === slideId ? fn(s) : s)) }))
    ver.current += 1
    setTick((t) => t + 1)
  }, [slideId])

  const undo = () => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(snapshot(deckRef.current))
    setDeck((d) => ({ ...d, ...prev }))
    ver.current += 1
    setTick((t) => t + 1)
  }
  const redo = () => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(snapshot(deckRef.current))
    setDeck((d) => ({ ...d, ...next }))
    ver.current += 1
    setTick((t) => t + 1)
  }

  const conflictRef = useRef(null)
  conflictRef.current = conflict
  const doSave = useCallback(async () => {
    if (ver.current === savedVer.current || conflictRef.current) return
    const v = ver.current
    const d = deckRef.current
    setSave({ state: 'saving' })
    try {
      const out = await api.saveDeck(d.id, { ...snapshot(d), rev: rev.current })
      rev.current = out.rev
      savedVer.current = Math.max(savedVer.current, v)
      setSave({ state: ver.current === savedVer.current ? 'saved' : 'dirty', at: out.updatedAt })
    } catch (e) {
      if (e.status === 409 && e.deck) { setConflict(e.deck); setSave({ state: 'conflict' }); return }
      setSave({ state: 'error', error: api.plainError(e) })
    }
  }, [])

  useEffect(() => {
    if (ver.current === savedVer.current) return undefined
    clearTimeout(timer.current)
    timer.current = setTimeout(doSave, 1200)
    return () => clearTimeout(timer.current)
  })

  // Leaving with changes not yet saved: save them, and warn if the tab closes first.
  useEffect(() => {
    const warn = (e) => { if (ver.current !== savedVer.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  const leave = async () => { clearTimeout(timer.current); await doSave(); onClose() }

  /* ------------------------------------------------------------- slides */

  const insertSlides = (slides) => {
    if (!slides.length) return
    apply((d) => {
      const at = d.slides.findIndex((s) => s.id === cur)
      const next = [...d.slides]
      next.splice(at + 1, 0, ...slides)
      return { ...d, slides: next }
    })
    setCur(slides[0].id)
    setSelected([])
  }

  const pick = (opts) => new Promise((resolve) => setPicker({ ...opts, resolve }))
  const pickInitiatives = async (title) => {
    const r = await api.getInitiatives()
    const items = r.items || []
    const chosen = await new Promise((resolve) => setInitPicker({ title, items, resolve }))
    return chosen ? { items, chosen } : null
  }

  const addSlide = async (kind) => {
    closeMenus()
    const hasLogo = !!brand.logo
    if (kind === 'initCards') {
      const r = await pickInitiatives('Initiatives to put on cards')
      if (r) {
        const fin = r.chosen.filter((x) => x.team !== 'Accounting')
        const acc = r.chosen.filter((x) => x.team === 'Accounting')
        insertSlides([
          ...(fin.length ? initiativeCardsSlides(r.items, fin, byKey, 'Finance') : []),
          ...(acc.length ? initiativeCardsSlides(r.items, acc, byKey, 'Accounting') : []),
        ])
      }
    } else if (kind === 'initRoadmap') {
      const r = await pickInitiatives('Initiatives on the roadmap')
      if (r) insertSlides([initiativeRoadmap(r.items, r.chosen, { byKey, year: Number(String(deck.date || '').slice(0, 4)) || undefined, hasBrand: !!brand.logo })])
    } else if (kind === 'initAgenda') {
      const r = await pickInitiatives('Initiatives on the agenda')
      if (r) insertSlides([initiativeAgenda(r.items, r.chosen)])
    } else if (kind === 'updates') {
      const keys = await pick({ title: 'Projects for the update cards (six to a slide)' })
      if (keys) insertSlides(await withFacts(updatesSlides(projectsTeam(keys), keys.map((k) => cardFromProject(byKey[k])))))
    } else if (kind === 'roadmap') {
      const keys = await pick({ title: 'Projects on the roadmap' })
      if (keys) insertSlides([roadmapSlide(keys.map((k) => byKey[k]), { hasBrand: hasLogo })])
    } else if (kind === 'agenda') {
      const keys = await pick({ title: 'Projects on the agenda' })
      if (keys) insertSlides([agendaSlide(keys.map((k) => byKey[k]))])
    } else if (kind === 'tasks') {
      const keys = await pick({ title: 'Which project\'s tasks?', single: true })
      if (keys?.[0]) insertSlides([await tasksFor(byKey[keys[0]])])
    } else if (kind === 'cover') insertSlides([coverSlide({ title: deck.title, date: deck.date, hasBrand: hasLogo })])
    else if (kind === 'finance' || kind === 'accounting') insertSlides([sectionSlide(kind === 'accounting' ? 'Accounting' : 'Finance', { hasBrand: !!brand[kind] })])
    else if (kind === 'image') insertSlides([imageSlide('Screenshot')])
    else if (kind === 'thanks') insertSlides([thanksSlide()])
    else insertSlides([blankSlide('Title')])
  }

  const projectsTeam = (keys) => {
    const teams = new Set(keys.map((k) => (byKey[k]?.team === 'Accounting' ? 'Accounting' : 'Finance')))
    return teams.size === 1 ? `${[...teams][0]} Initiatives – Project Update` : 'Initiatives – Project Update'
  }

  const moveSlide = (from, to) => {
    if (to < 0 || to >= deck.slides.length || from === to) return
    apply((d) => {
      const next = [...d.slides]
      const [s] = next.splice(from, 1)
      next.splice(to, 0, s)
      return { ...d, slides: next }
    })
  }
  const duplicateSlide = (s) => {
    const c = copySlide(s)
    apply((d) => { const next = [...d.slides]; next.splice(d.slides.indexOf(s) + 1, 0, c); return { ...d, slides: next } })
    setCur(c.id)
  }
  const deleteSlide = (s) => {
    const i = deck.slides.indexOf(s)
    apply((d) => ({ ...d, slides: d.slides.filter((x) => x.id !== s.id) }))
    const nextCur = deck.slides[i + 1] || deck.slides[i - 1]
    setCur(nextCur?.id || null)
    setSelected([])
  }

  /* ----------------------------------------------------------- elements */

  const patchSlide = (fn, key) => apply((d) => ({ ...d, slides: d.slides.map((s) => (s.id === slide.id ? fn(s) : s)) }), key)
  const patchEls = (ids, fn, key) => patchSlide((s) => ({ ...s, elements: s.elements.map((e) => (ids.includes(e.id) ? fn(e) : e)) }), key || `els:${ids.join(',')}`)

  const addEls = (els) => {
    if (!slide) return
    patchSlide((s) => ({ ...s, elements: [...s.elements, ...els] }))
    setSelected(els.map((e) => e.id))
  }
  const deleteSel = () => {
    if (!selected.length) return
    patchSlide((s) => ({ ...s, elements: s.elements.filter((e) => !selected.includes(e.id)) }))
    setSelected([])
  }
  const duplicateSel = () => {
    const copies = slide.elements.filter((e) => selected.includes(e.id)).map((e) => ({ ...reId(e), x: e.x + 16, y: e.y + 16 }))
    addEls(copies)
  }
  const layer = (where) => patchSlide((s) => {
    const sel = s.elements.filter((e) => selected.includes(e.id))
    const rest = s.elements.filter((e) => !selected.includes(e.id))
    return { ...s, elements: where === 'front' ? [...rest, ...sel] : [...sel, ...rest] }
  })
  const align = (how) => {
    const els = slide.elements.filter((e) => selected.includes(e.id))
    const L = Math.min(...els.map((e) => e.x))
    const R = Math.max(...els.map((e) => e.x + e.w))
    const T = Math.min(...els.map((e) => e.y))
    const B = Math.max(...els.map((e) => e.y + e.h))
    patchEls(selected, (e) => {
      if (how === 'left') return { ...e, x: L }
      if (how === 'right') return { ...e, x: R - e.w }
      if (how === 'hcenter') return { ...e, x: Math.round((L + R) / 2 - e.w / 2) }
      if (how === 'top') return { ...e, y: T }
      if (how === 'bottom') return { ...e, y: B - e.h }
      return { ...e, y: Math.round((T + B) / 2 - e.h / 2) }
    })
  }

  const insert = async (what) => {
    closeMenus()
    if (what === 'text') addEls([text(W / 2 - 160, H / 2 - 30, 320, 60, 'Text', { fontSize: 14, color: C.ink })])
    else if (what === 'heading') addEls([text(38, 18, 640, 40, 'Heading', { fontSize: 20, bold: true, color: C.navy, valign: 'middle' })])
    else if (what === 'rect') addEls([rect(W / 2 - 120, H / 2 - 60, 240, 120, { fill: C.cardBlue, border: C.blue, borderWidth: 1.5, radius: 6 })])
    else if (what === 'bar') addEls([rect(39, 59, 111, 6, { fill: C.yellow, radius: 3 })])
    else if (what === 'image') addEls([image(W / 2 - 240, H / 2 - 135, 480, 270, {})])
    else if (what === 'pill') addEls([{ id: newId(), type: 'pill', x: W - 170, y: 26, w: 120, h: 26, style: { fontSize: 9 }, data: { status: 'On Track' } }])
    else if (what === 'card') {
      const keys = await pick({ title: 'Project cards to add' })
      if (!keys) return
      const facts = await api.deckFacts(keys).catch(() => ({}))
      addEls(keys.map((k, i) => ({
        id: newId(), type: 'card', x: 47 + (i % 2) * 446, y: 96 + (Math.floor(i / 2) % 2) * 214, w: 420, h: 200,
        style: { tone: i % 2 ? 'yellow' : 'blue' }, data: facts[k] ? cardFromFacts(byKey[k], facts[k]) : cardFromProject(byKey[k]),
      })))
    }
  }

  /* A picture: uploaded, then put into the selected empty picture or a new one. */
  const uploadPicture = async (file, targetId = null) => {
    try {
      setToast({ severity: 'info', msg: 'Adding the picture…' })
      const dataUrl = await shrink(file)
      const a = await api.addDeckAsset(dataUrl, file.name)
      const { w, h } = await pictureSize(dataUrl)
      const target = targetId || selected.find((id) => slide.elements.find((e) => e.id === id && e.type === 'image'))
      if (target) patchEls([target], (e) => ({ ...e, data: { ...e.data, asset: a.id, brand: null } }))
      else {
        const s = Math.min(720 / w, 400 / h, 1)
        addEls([image(Math.round(W / 2 - (w * s) / 2), Math.round(H / 2 - (h * s) / 2 + 20), Math.round(w * s), Math.round(h * s), { asset: a.id })])
      }
      setToast(null)
    } catch (e) {
      setToast({ severity: 'error', msg: api.plainError(e) })
    }
  }

  /* ------------------------------------------------------- project data */

  const refreshCard = async (el, p = null) => {
    if (!p && el.data?.initiativeId) {
      try {
        const r = await api.getInitiatives()
        const it = (r.items || []).find((x) => x.id === el.data.initiativeId)
        if (!it) { setToast({ severity: 'info', msg: 'That initiative is no longer on the list.' }); return }
        const fresh = cardFromInitiative(it, r.items, it.projectKey ? byKey[it.projectKey] : null)
        patchEls([el.id], (e) => ({ ...e, data: { ...e.data, ...fresh, impact: (e.data.impact || []).filter(Boolean).length ? e.data.impact : fresh.impact } }))
        setToast({ severity: 'success', msg: `Refreshed from the initiative list: ${it.name}.` })
      } catch (e) { setToast({ severity: 'error', msg: api.plainError(e) }) }
      return
    }
    const proj = p || byKey[el.data?.projectKey]
    if (!proj) return
    if (p) patchEls([el.id], (e) => ({ ...e, data: { ...e.data, ...cardFromProject(p) } }))
    try {
      const facts = await api.deckFacts([proj.key])
      const fresh = cardFromFacts(proj, facts[proj.key])
      patchEls([el.id], (e) => ({
        ...e,
        data: {
          ...e.data, projectKey: proj.key, title: fresh.title, status: fresh.status, target: fresh.target,
          accomplishment: fresh.accomplishment.length ? fresh.accomplishment : e.data.accomplishment,
          next: fresh.next.length ? fresh.next : e.data.next,
          impact: (e.data.impact || []).filter(Boolean).length && !p ? e.data.impact : fresh.impact,
        },
      }))
      setToast({ severity: 'success', msg: `Refreshed from the app: ${proj.summary || proj.key}.` })
    } catch (e) {
      setToast({ severity: 'error', msg: api.plainError(e) })
    }
  }

  const addRoadmapRows = async (el) => {
    const keys = await pick({ title: 'Projects to add to the roadmap', initial: [] })
    if (!keys) return
    patchEls([el.id], (e) => {
      const rows = [...(e.data.rows || [])]
      keys.forEach((k, i) => {
        const p = byKey[k]
        if (!p || rows.some((r) => r.projectKey === k)) return
        const status = deckStatus(p)
        const team = p.team === 'Accounting' ? 'Accounting' : 'Finance'
        const row = { id: newId(), projectKey: k, label: p.summary || k, status, bar: status === 'GO LIVE' ? 'Live' : '', start: p.start || '', end: p.actualEnd || p.adjustedDue || p.due || '', tone: toneFor(status, rows.length + i) }
        // Under its team's heading, when there is one.
        const g = rows.findIndex((r) => r.group != null && String(r.group).toLowerCase() === team.toLowerCase())
        if (g < 0) { rows.push(row); return }
        let at = g + 1
        while (at < rows.length && rows[at].group == null) at += 1
        rows.splice(at, 0, row)
      })
      return { ...e, data: { ...e.data, rows } }
    })
  }

  const refreshRoadmap = async (el) => {
    let list = []
    if ((el.data?.rows || []).some((r) => r.initiativeId)) list = (await api.getInitiatives().catch(() => ({ items: [] }))).items || []
    const byId = Object.fromEntries(list.map((x) => [x.id, x]))
    patchEls([el.id], (e) => ({
      ...e,
      data: {
        ...e.data,
        rows: (e.data.rows || []).map((r) => {
          const it = r.initiativeId && byId[r.initiativeId]
          if (it) {
            const t = targetDate(it.target)
            return { ...r, status: pillOf(it.status) || r.status, end: t && t.slice(0, 4) === String(e.data.year) ? t : r.end }
          }
          const p = r.projectKey && byKey[r.projectKey]
          if (!p) return r
          return { ...r, status: deckStatus(p), start: p.start || r.start, end: p.actualEnd || p.adjustedDue || p.due || r.end }
        }),
      },
    }))
  }
  const reloadTasks = async (el, p = null) => {
    const proj = p || byKey[el.data?.projectKey]
    if (!proj) return
    const fresh = await tasksFor(proj)
    const t = fresh.elements.find((x) => x.type === 'tasks')
    patchEls([el.id], (e) => ({ ...e, data: { ...t.data } }))
    setToast({ severity: t.data.rows.length ? 'success' : 'info', msg: t.data.rows.length ? `${t.data.rows.length} tasks from Jira.` : `No Jira tasks found for ${proj.key} — add rows by hand.` })
  }

  /* ------------------------------------------------------------------- AI */

  const scopeSlides = (scope) => (scope === 'deck' ? deck.slides : [slide])
  const scopeEls = (scope) => scopeSlides(scope).flatMap((s) => s.elements.filter((e) => scope !== 'selection' || selected.includes(e.id)))

  const rewrite = async (scope, instruction) => {
    const els = scopeEls(scope)
    const items = []
    for (const e of els) {
      if (e.type === 'text' && String(e.text || '').trim()) items.push({ id: e.id, text: e.text })
      if (e.type === 'card') {
        for (const f of ['accomplishment', 'impact', 'next']) {
          const v = (e.data?.[f] || []).filter(Boolean)
          if (v.length) items.push({ id: `${e.id}|${f}`, text: v.join('\n') })
        }
      }
    }
    if (!items.length) throw new Error('There is no text there to rewrite.')
    const r = await api.deckAi({ mode: 'rewrite', instruction, items: items.slice(0, 40) })
    const got = Object.fromEntries(r.items.map((x) => [x.id, x.text]))
    apply((d) => ({
      ...d,
      slides: d.slides.map((s) => ({
        ...s,
        elements: s.elements.map((e) => {
          if (e.type === 'text' && got[e.id] != null) return { ...e, text: got[e.id] }
          if (e.type === 'card') {
            const data = { ...e.data }
            let hit = false
            for (const f of ['accomplishment', 'impact', 'next']) {
              if (got[`${e.id}|${f}`] != null) { data[f] = got[`${e.id}|${f}`].split('\n').map((x) => x.replace(/^•\s*/, '')).filter(Boolean); hit = true }
            }
            return hit ? { ...e, data } : e
          }
          return e
        }),
      })),
    }))
    return `Rewrote ${r.items.length} piece${r.items.length === 1 ? '' : 's'} of text. Undo (Ctrl/⌘ Z) puts them back.`
  }

  const draft = async (scope, instruction) => {
    const cards = (Array.isArray(scope) ? slide.elements.filter((e) => scope.includes(e.id)) : scopeEls(scope)).filter((e) => e.type === 'card' && e.data?.projectKey)
    if (!cards.length) throw new Error('There are no project cards there.')
    const keys = [...new Set(cards.map((e) => e.data.projectKey))]
    // The Jira tasks under each project, as more to write from.
    const tasks = {}
    const jk = keys.map((k) => byKey[k]?.jiraKey).filter(Boolean)
    if (jk.length) {
      try {
        const r = await api.jiraChildren(jk.slice(0, 40))
        for (const k of keys) {
          const list = r.byParent?.[String(byKey[k]?.jiraKey || '').toUpperCase()] || []
          tasks[k] = list.slice(0, 20).map((t) => `${t.summary} (${t.status}${t.due ? `, due ${t.due}` : ''})`)
        }
      } catch { /* drafted from the weekly updates alone */ }
    }
    let done = 0
    for (let i = 0; i < keys.length; i += 6) {
      const batch = keys.slice(i, i + 6)
      setToast({ severity: 'info', msg: `The AI is writing cards ${i + 1}–${i + batch.length} of ${keys.length}…` })
      const r = await api.deckAi({ mode: 'draft', keys: batch, tasks, instruction })
      const byK = Object.fromEntries(r.cards.map((c) => [c.key, c]))
      const ids = new Set(cards.filter((e) => byK[e.data.projectKey]).map((e) => e.id))
      apply((d) => ({
        ...d,
        slides: d.slides.map((s) => ({
          ...s,
          elements: s.elements.map((e) => (ids.has(e.id)
            ? { ...e, data: { ...e.data, accomplishment: byK[e.data.projectKey].accomplishment, impact: byK[e.data.projectKey].impact, next: byK[e.data.projectKey].next } }
            : e)),
        })),
      }))
      done += r.cards.length
    }
    setToast(null)
    return `Drafted ${done} card${done === 1 ? '' : 's'}. Check them before the meeting; undo puts the old text back.`
  }

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const k = (e) => {
      if (present || picker || aiOpen || brandOpen || conflict || drill || typing(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return }
      if (!slide) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) { e.preventDefault(); deleteSel(); return }
      if (mod && e.key.toLowerCase() === 'd' && selected.length) { e.preventDefault(); duplicateSel(); return }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(slide.elements.filter((x) => !x.locked).map((x) => x.id)); return }
      if (mod && e.key.toLowerCase() === 'c' && selected.length) { clip.current = slide.elements.filter((x) => selected.includes(x.id)); return }
      if (e.key === 'Escape') { setSelected([]); return }
      if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault()
        const n = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0
        const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0
        patchEls(selected, (x) => ({ ...x, x: x.x + dx, y: x.y + dy }), `nudge:${selected.join(',')}`)
        return
      }
      if (!selected.length && (e.key === 'PageDown' || e.key === 'ArrowDown')) { e.preventDefault(); const s = deck.slides[index + 1]; if (s) { setCur(s.id); setSelected([]) } }
      if (!selected.length && (e.key === 'PageUp' || e.key === 'ArrowUp')) { e.preventDefault(); const s = deck.slides[index - 1]; if (s) { setCur(s.id); setSelected([]) } }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  // Paste: a screenshot becomes a picture on the slide; copied elements come back.
  useEffect(() => {
    const p = (e) => {
      if (present || picker || aiOpen || typing(e.target) || !slide) return
      const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'))
      if (file) { e.preventDefault(); uploadPicture(file); return }
      if (clip.current?.length) { e.preventDefault(); addEls(clip.current.map((x) => ({ ...reId(x), x: x.x + 16, y: x.y + 16 }))) }
    }
    window.addEventListener('paste', p)
    return () => window.removeEventListener('paste', p)
  })

  /* --------------------------------------------------------------- export */

  const exportPptx = async () => {
    setExporting('Starting…')
    try {
      const name = await downloadPptx(deck, brand, { onProgress: (i, n) => setExporting(`Slide ${i} of ${n}…`) })
      setToast({ severity: 'success', msg: `Downloaded ${name}.` })
    } catch (e) {
      setToast({ severity: 'error', msg: `The PowerPoint could not be made: ${e.message}` })
    } finally {
      setExporting(null)
    }
  }

  const deleteDeck = async () => {
    try { await api.deleteDeck(deck.id); clearTimeout(timer.current); savedVer.current = ver.current; onClose() } catch (e) { setToast({ severity: 'error', msg: api.plainError(e) }) }
  }

  const openMenu = (k) => (e) => setMenus({ [k]: e.currentTarget })
  const closeMenus = () => setMenus({})

  const saveLabel = {
    saved: 'Saved', saving: 'Saving…', dirty: 'Saving…', error: 'Not saved', conflict: 'Not saved',
  }[ver.current !== savedVer.current && save.state === 'saved' ? 'dirty' : save.state]

  const thumbW = 168
  const inspectorW = 320
  const canvasW = Math.max(320, Math.min(cw - 8, 1100))

  const cardsHere = slide ? slide.elements.filter((e) => e.type === 'card').length : 0
  const cardsInDeck = deck.slides.reduce((a, s) => a + s.elements.filter((e) => e.type === 'card').length, 0)

  return (
    <Box>
      {/* ---------------------------------------------------- top bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Tooltip title="All presentations"><IconButton onClick={leave} aria-label="back to presentations"><ArrowBackIcon /></IconButton></Tooltip>
        <TextField
          size="small" value={deck.title} onChange={(e) => apply((d) => ({ ...d, title: e.target.value }), 'title')}
          inputProps={{ 'aria-label': 'deck title', style: { fontWeight: 600 } }} sx={{ minWidth: 220, flex: '1 1 260px', maxWidth: 420 }}
        />
        <TextField size="small" type="date" value={deck.date || ''} onChange={(e) => apply((d) => ({ ...d, date: e.target.value }), 'date')} inputProps={{ 'aria-label': 'meeting date' }} />
        <Chip
          size="small" variant="outlined" label={saveLabel}
          color={save.state === 'error' || save.state === 'conflict' ? 'error' : 'default'}
          title={save.error || undefined}
          onClick={save.state === 'error' ? doSave : undefined}
        />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Undo (Ctrl/⌘ Z)"><span><IconButton size="small" onClick={undo} disabled={!past.current.length} aria-label="undo"><UndoIcon fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Redo (Ctrl/⌘ Shift Z)"><span><IconButton size="small" onClick={redo} disabled={!future.current.length} aria-label="redo"><RedoIcon fontSize="small" /></IconButton></span></Tooltip>
        <Button size="small" startIcon={<AddIcon />} onClick={openMenu('slide')}>Slide</Button>
        <Button size="small" startIcon={<AddIcon />} onClick={openMenu('insert')} disabled={!slide}>Insert</Button>
        {aiOn && <Button size="small" startIcon={<AutoAwesomeIcon />} onClick={() => setAiOpen(true)} disabled={!slide}>AI</Button>}
        <Button size="small" startIcon={exporting ? <CircularProgress size={14} /> : <DownloadIcon />} onClick={exportPptx} disabled={!!exporting || !deck.slides.length}>
          {exporting || 'PowerPoint'}
        </Button>
        <Button variant="contained" size="small" startIcon={<SlideshowIcon />} onClick={() => setPresent({ start: Math.max(0, deck.slides.filter((s) => !s.hidden).indexOf(slide)) })} disabled={!deck.slides.length}>
          Present
        </Button>
        <IconButton size="small" onClick={openMenu('more')} aria-label="more"><MoreVertIcon fontSize="small" /></IconButton>
      </Box>

      <Menu anchorEl={menus.slide} open={!!menus.slide} onClose={closeMenus}>
        {[
          ['initCards', 'Initiative cards (from the list)'], ['initRoadmap', 'Initiative roadmap (from the list)'], ['initAgenda', 'Initiative agenda (from the list)'],
          null,
          ['updates', 'Project update cards'], ['roadmap', 'Roadmap of the year'], ['tasks', 'Project task timeline'], ['agenda', 'Agenda'],
          null, ['cover', 'Cover'], ['finance', 'Section: Finance'], ['accounting', 'Section: Accounting'], ['image', 'Screenshot'], ['blank', 'Title only'], ['thanks', 'Thank you'],
        ].map((m, i) => (m ? <MenuItem key={m[0]} onClick={() => addSlide(m[0])}>{m[1]}</MenuItem> : <Divider key={i} />))}
      </Menu>
      <Menu anchorEl={menus.insert} open={!!menus.insert} onClose={closeMenus}>
        <MenuItem onClick={() => insert('text')}><ListItemIcon><TextFieldsIcon fontSize="small" /></ListItemIcon><ListItemText>Text box</ListItemText></MenuItem>
        <MenuItem onClick={() => insert('heading')}><ListItemIcon><TextFieldsIcon fontSize="small" /></ListItemIcon><ListItemText>Slide title</ListItemText></MenuItem>
        <MenuItem onClick={() => insert('card')}><ListItemIcon><ViewModuleIcon fontSize="small" /></ListItemIcon><ListItemText>Project card</ListItemText></MenuItem>
        <MenuItem onClick={() => insert('pill')}><ListItemIcon><LabelIcon fontSize="small" /></ListItemIcon><ListItemText>Status</ListItemText></MenuItem>
        <MenuItem onClick={() => insert('image')}><ListItemIcon><ImageIcon fontSize="small" /></ListItemIcon><ListItemText>Picture</ListItemText></MenuItem>
        <MenuItem onClick={() => insert('rect')}><ListItemIcon><CropSquareIcon fontSize="small" /></ListItemIcon><ListItemText>Box</ListItemText></MenuItem>
        <MenuItem onClick={() => insert('bar')}><ListItemIcon><CropSquareIcon fontSize="small" /></ListItemIcon><ListItemText>Yellow title bar</ListItemText></MenuItem>
      </Menu>
      <Menu anchorEl={menus.more} open={!!menus.more} onClose={closeMenus}>
        <MenuItem onClick={() => { closeMenus(); setPresent({ start: 0 }) }}><ListItemIcon><SlideshowIcon fontSize="small" /></ListItemIcon><ListItemText>Present from the start</ListItemText></MenuItem>
        <MenuItem onClick={() => { closeMenus(); setBrandOpen(true) }}><ListItemIcon><PaletteIcon fontSize="small" /></ListItemIcon><ListItemText>Deck pictures</ListItemText></MenuItem>
        <Divider />
        <MenuItem
          onClick={() => { closeMenus(); setConfirmDelete(true) }}
          disabled={me?.role !== 'admin' && deck.createdBy !== me?.email}
        >
          <ListItemIcon><DeleteOutlineIcon fontSize="small" /></ListItemIcon><ListItemText>Delete this presentation</ListItemText>
        </MenuItem>
      </Menu>

      {save.state === 'error' && <Alert severity="error" sx={{ mb: 1.5 }} action={<Button color="inherit" size="small" onClick={doSave}>Try again</Button>}>Not saved: {save.error}</Alert>}

      {/* ------------------------------------------------- three columns */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: `${thumbW + 28}px minmax(0, 1fr) ${inspectorW}px` }, gap: 2, alignItems: 'start' }}>
        <Paper variant="outlined" sx={{ p: 1, maxHeight: { lg: 'calc(100vh - 180px)' }, overflow: 'auto', display: { xs: 'flex', lg: 'block' }, gap: 1 }}>
          {deck.slides.map((s, i) => (
            <Box
              key={s.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/slide', String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { const from = Number(e.dataTransfer.getData('text/slide')); if (Number.isFinite(from)) moveSlide(from, i) }}
              onClick={() => { setCur(s.id); setSelected([]) }}
              sx={{ mb: 1, cursor: 'pointer', flexShrink: 0 }}
            >
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start' }}>
                <Typography variant="caption" sx={{ width: 16, textAlign: 'right', color: 'text.secondary', pt: 0.25 }}>{i + 1}</Typography>
                <Box sx={{
                  outline: s.id === slide?.id ? '2px solid' : '1px solid', outlineColor: s.id === slide?.id ? 'primary.main' : 'divider',
                  borderRadius: 0.5, overflow: 'hidden', opacity: s.hidden ? 0.4 : 1, position: 'relative', pointerEvents: 'none',
                }}
                >
                  <SlideView slide={s} brand={brand} width={thumbW} />
                </Box>
              </Box>
              {s.id === slide?.id && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.25, mt: 0.25 }}>
                  <Tooltip title="Move up"><span><IconButton size="small" disabled={i === 0} onClick={(e) => { e.stopPropagation(); moveSlide(i, i - 1) }} aria-label="move slide up"><KeyboardArrowUpIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                  <Tooltip title="Move down"><span><IconButton size="small" disabled={i === deck.slides.length - 1} onClick={(e) => { e.stopPropagation(); moveSlide(i, i + 1) }} aria-label="move slide down"><KeyboardArrowDownIcon sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
                  <Tooltip title={s.hidden ? 'Show when presenting' : 'Hide when presenting'}><IconButton size="small" onClick={(e) => { e.stopPropagation(); apply((d) => ({ ...d, slides: d.slides.map((x) => (x.id === s.id ? { ...x, hidden: !x.hidden } : x)) })) }} aria-label="hide slide">{s.hidden ? <VisibilityIcon sx={{ fontSize: 16 }} /> : <VisibilityOffIcon sx={{ fontSize: 16 }} />}</IconButton></Tooltip>
                  <Tooltip title="Duplicate slide"><IconButton size="small" onClick={(e) => { e.stopPropagation(); duplicateSlide(s) }} aria-label="duplicate slide"><ContentCopyIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                  <Tooltip title="Delete slide"><IconButton size="small" onClick={(e) => { e.stopPropagation(); deleteSlide(s) }} aria-label="delete slide"><DeleteOutlineIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                </Box>
              )}
            </Box>
          ))}
          <Button fullWidth size="small" startIcon={<AddIcon />} onClick={openMenu('slide')} sx={{ flexShrink: 0 }}>Slide</Button>
        </Paper>

        <Box ref={center} sx={{ minWidth: 0 }}>
          {slide ? (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Canvas
                slide={slide} brand={brand} width={canvasW} selected={selected} onSelect={setSelected}
                onBegin={begin} onChange={changeSlide}
              />
            </Box>
          ) : (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <Typography sx={{ mb: 1.5 }}>This deck has no slides.</Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openMenu('slide')}>Add a slide</Button>
            </Paper>
          )}
          {slide && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center', mt: 1 }}>
              Slide {index + 1} of {deck.slides.length}{slide.hidden ? ' · hidden when presenting' : ''} · double-click text to type · paste a screenshot to add it
            </Typography>
          )}
        </Box>

        <Paper variant="outlined" sx={{ p: 2, maxHeight: { lg: 'calc(100vh - 180px)' }, overflow: 'auto' }}>
          {slide && (
            <Inspector
              slide={slide}
              selected={selected}
              projects={projects}
              aiOn={aiOn}
              onPatch={patchEls}
              onSlide={(fn, key) => patchSlide(fn, key ? `slide:${key}` : null)}
              onDelete={deleteSel}
              onDuplicate={duplicateSel}
              onLayer={layer}
              onAlign={align}
              onUpload={uploadPicture}
              onRefreshCard={refreshCard}
              onDraft={(ids) => { draft(ids, '').then((m) => setToast({ severity: 'success', msg: m })).catch((e) => setToast({ severity: 'error', msg: api.plainError(e) })) }}
              onOpenProject={setDrill}
              onAddRows={addRoadmapRows}
              onRefreshRoadmap={refreshRoadmap}
              onReloadTasks={(el, p) => reloadTasks(el, p).catch((e) => setToast({ severity: 'error', msg: api.plainError(e) }))}
            />
          )}
        </Paper>
      </Box>

      {/* ------------------------------------------------------- overlays */}
      {picker && (
        <ProjectPicker
          open projects={projects} title={picker.title} single={picker.single} initial={picker.initial}
          onClose={() => { picker.resolve(null); setPicker(null) }}
          onPick={(keys) => { picker.resolve(keys); setPicker(null) }}
        />
      )}
      {initPicker && (
        <InitiativePicker
          open initiatives={initPicker.items} title={initPicker.title}
          onClose={() => { initPicker.resolve(null); setInitPicker(null) }}
          onPick={(xs) => { initPicker.resolve(xs); setInitPicker(null) }}
        />
      )}
      {aiOpen && (
        <AiDialog
          open hasSelection={selected.length > 0} cardsHere={cardsHere} cardsInDeck={cardsInDeck}
          onClose={() => setAiOpen(false)} onRewrite={rewrite} onDraft={draft}
        />
      )}
      {brandOpen && <BrandEditor brand={brand} isAdmin={me?.role === 'admin'} onBrand={onBrand} onClose={() => setBrandOpen(false)} />}
      {present && <Present deck={deck} brand={brand} start={present.start} projects={projects} onClose={() => setPresent(null)} />}
      {drill && <ProjectDrill projectKey={drill} project={byKey[drill]} onClose={() => setDrill(null)} />}

      <Dialog open={!!conflict} onClose={() => {}}>
        <DialogTitle>Somebody else saved this deck</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {conflict?.updatedBy || 'Somebody'} saved it after you opened it. Keep yours and replace theirs, or take theirs and lose your latest changes?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeck((d) => ({ ...d, ...snapshot(conflict) })); rev.current = conflict.rev; savedVer.current = ver.current; past.current = []; future.current = []; setConflict(null); setSave({ state: 'saved', at: conflict.updatedAt }) }}>
            Take theirs
          </Button>
          <Button variant="contained" onClick={() => { rev.current = conflict.rev; conflictRef.current = null; setConflict(null); setSave({ state: 'dirty' }); doSave() }}>
            Keep mine
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Delete &ldquo;{deck.title}&rdquo;?</DialogTitle>
        <DialogContent><Typography variant="body2">The deck is deleted for everybody. This cannot be undone.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={deleteDeck}>Delete</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!toast} autoHideDuration={toast?.severity === 'info' ? null : 5000} onClose={() => setToast(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {toast ? <Alert severity={toast.severity} onClose={() => setToast(null)}>{toast.msg}</Alert> : undefined}
      </Snackbar>
    </Box>
  )
}
