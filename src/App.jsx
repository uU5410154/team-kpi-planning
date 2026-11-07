import WeekSwitcher from './components/WeekSwitcher.jsx'
import ViewAsBanner from './components/ViewAsBanner.jsx'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  ThemeProvider, CssBaseline, Box, Typography,
  Button, IconButton, Tooltip, Snackbar, Alert, Chip, Divider, Menu, MenuItem,
  CircularProgress, useMediaQuery,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import SpaceDashboardIcon from '@mui/icons-material/SpaceDashboardOutlined'
import FolderIcon from '@mui/icons-material/FolderOutlined'
import BadgeIcon from '@mui/icons-material/BadgeOutlined'
import EventNoteIcon from '@mui/icons-material/EventNoteOutlined'
import GroupsIcon from '@mui/icons-material/GroupsOutlined'
import TimelineIcon from '@mui/icons-material/ViewTimelineOutlined'
import AppsIcon from '@mui/icons-material/AppsOutlined'
import TuneIcon from '@mui/icons-material/TuneOutlined'
import AdminIcon from '@mui/icons-material/AdminPanelSettingsOutlined'
import Sidebar, { NAV_W, NAV_W_MINI } from './components/Sidebar.jsx'
import Loading from './components/Loading.jsx'
import GlobalSearch from './components/GlobalSearch.jsx'
import AiChat from './components/AiChat.jsx'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import { IconTile, PAGE_COLOR, displayName } from './components/Brand.jsx'
import { SURFACE } from './theme.js'
import DownloadIcon from '@mui/icons-material/Download'
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined'
import LightModeIcon from '@mui/icons-material/LightModeOutlined'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import DataObjectIcon from '@mui/icons-material/DataObject'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import ScenarioDialog from './components/ScenarioDialog.jsx'

import { buildTheme } from './theme.js'
import {
  computePlan, newProject, rebalanceWeights, reassignPatch, replanPatch,
} from './lib/model.js'
import { applyImport } from './lib/projectIO.js'
import * as api from './lib/api.js'
import {
  loadState, saveState, freshState, downloadScenario, readScenarioFile, loadWasReset, repairState, markSynced, syncStatus, hasNothingOfItsOwn, sharedPayload, applyShared, SHARED_KEYS,
} from './lib/storage.js'
import { exportWorkbook } from './lib/exportXlsx.js'

import Dashboard from './pages/Dashboard.jsx'
import Project from './pages/Project.jsx'
import Projects from './pages/Projects.jsx'
import People from './pages/People.jsx'
import Team from './pages/Team.jsx'
import Timeline from './pages/Timeline.jsx'
import Apps from './pages/Apps.jsx'
import Settings from './pages/Settings.jsx'
import SignIn from './pages/SignIn.jsx'
import Users from './pages/Users.jsx'
import Weekly from './pages/Weekly.jsx'
import * as authApi from './lib/authApi.js'
import { memberView, memberProgress } from './lib/memberView.js'

/*
 * WHAT EACH ROLE SEES.
 *
 * A team member gets the five tabs that describe the work: the register, the
 * scorecards, the team, the timeline and the home screen. An administrator
 * gets those and everything behind them — the dashboard, the model that prices
 * a manday, and the list of who may open the app at all.
 *
 * Written on the tabs themselves rather than as a list somewhere else, so a
 * tab added tomorrow has to say who it is for. `roles: undefined` would be a
 * tab nobody could reach, which is the safe way round for a mistake.
 */
const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: SpaceDashboardIcon, roles: ['admin'] },
  /*
   * The register and the individual scorecards are ADMIN ONLY.
   *
   * Both are edited in place: the register is where saving hours, effort and
   * commitment levels are typed, and a scorecard is what one person is
   * appraised on. A team member reads what the team is carrying and when it
   * lands — the Overall team page and the timeline — without the row-by-row
   * numbers behind somebody else's appraisal.
   */
  { id: 'projects', label: 'Projects', icon: FolderIcon, roles: ['admin'] },
  { id: 'people', label: 'Scorecards', icon: BadgeIcon, roles: ['admin'] },
  /*
   * The weekly check-in. Everybody's: a member fills in their own week and
   * reads the team's focus, an administrator reads every week in full. Ahead
   * of the team tab so it is the first thing a member lands on — it is the one
   * page they come to do something on.
   */
  { id: 'weekly', label: 'Weekly', icon: EventNoteIcon, roles: ['admin', 'user'] },
  // Beside the individual cards, not instead of them: one answers what a
  // person is measured on, the other whether the team adds up.
  // A member sees only their own card here, so the tab is named for that.
  { id: 'team', label: 'Overall team', memberLabel: 'My scorecard', icon: GroupsIcon, roles: ['admin', 'user'] },
  // Beside the register rather than inside it: the register answers what a
  // project is worth, this answers when it was supposed to land.
  { id: 'timeline', label: 'Timeline', icon: TimelineIcon, roles: ['admin', 'user'] },
  { id: 'apps', label: 'Apps', icon: AppsIcon, roles: ['admin', 'user'] },
  { id: 'settings', label: 'Model', icon: TuneIcon, roles: ['admin'] },
  { id: 'users', label: 'Access', icon: AdminIcon, roles: ['admin'] },
  /*
   * One project in full. Not in the menu — reached from a project's name on
   * the dashboard, or from the email saying a follow-up was answered — so it
   * is `hidden`, but guarded like every other page.
   */
  { id: 'project', label: 'Project', icon: FolderIcon, roles: ['admin'], hidden: true },
]

/*
 * Where the app opens: the Dashboard, for an administrator — the welcome, the
 * year against its target, and the way into the weekly check-in. A team
 * member cannot open the Dashboard and lands on the first page they can,
 * which is their week. A link that names a page still wins: the hash is what
 * a bookmark carries.
 */
const DEFAULT_TAB = 'dashboard'

/*
 * The hash is the page, and after a slash what on it: #project/FNP-88 is that
 * project's page, #weekly/FNP-88 is one's own week opened on that project's
 * task (the link in a follow-up email).
 */
const hashParts = () => {
  const [h, ...rest] = window.location.hash.replace('#', '').split('/')
  return [h, rest.length ? decodeURIComponent(rest.join('/')) : null]
}
const tabFromHash = () => {
  const [h] = hashParts()
  return TABS.some((t) => t.id === h) ? h : DEFAULT_TAB
}

export default function App() {
  // Dark unless this browser has been told otherwise. A choice already made
  // here is still honoured — the toggle would be pointless if a reload undid it.
  const [mode, setMode] = useState(() => localStorage.getItem('fa-kpi-mode') || 'dark')
  const [tab, setTab] = useState(tabFromHash)
  // The week the Dashboard shows, chosen in the top bar; null is this week.
  const [dashWeek, setDashWeek] = useState(null)
  // What the hash names on the page: a project key, numbered so the same link
  // followed twice still acts.
  // The page is kept with it: a key is only ever used on the page its link
  // named, so a #project link a member cannot open does not fall through to
  // their week and add a task there.
  const [hashArg, setHashArg] = useState(() => ({ page: hashParts()[0], key: hashParts()[1], n: 1 }))
  // Evaluate before the first save effect overwrites the cached copy.
  const [wasReset] = useState(loadWasReset)
  const [state, setState] = useState(loadState)
  const [toast, setToast] = useState(null)
  const shownNoAccess = useRef(false)
  const [menuEl, setMenuEl] = useState(null)
  /*
   * The side menu: folded to icons or open, remembered per browser — somebody
   * who folds it to give the Timeline room wants it folded tomorrow too. On a
   * phone it is closed until the ☰ opens it, every time.
   */
  const [navMini, setNavMini] = useState(() => {
    try { return localStorage.getItem('fa-kpi-nav-mini') === '1' } catch { return false }
  })
  const [navOpen, setNavOpen] = useState(false)
  /*
   * Where the header search sent somebody: a page, and on it a project to
   * filter to or a person to open. Numbered, so picking the same project twice
   * still moves the page — the second time is usually because the first was
   * filtered away.
   */
  const [jump, setJump] = useState(null)
  // The administrators' chatbot, and whether the AI is there at all.
  const [chatOpen, setChatOpen] = useState(false)
  // undefined until the server says; the dashboard's AI cards wait for it.
  const [aiOn, setAiOn] = useState(undefined)
  // A question asked from the Dashboard: opens the chat with it already sent.
  const [chatSeed, setChatSeed] = useState(null)
  const askAi = (q) => {
    if (q) setChatSeed({ q, n: Date.now() })
    setChatOpen(true)
  }
  useEffect(() => {
    try { localStorage.setItem('fa-kpi-nav-mini', navMini ? '1' : '0') } catch { /* private window */ }
  }, [navMini])
  const [scenario, setScenario] = useState(null) // 'save' | 'open' | null
  const [dirty, setDirty] = useState(false)
  /*
   * Who is signed in. `undefined` means the question has not been answered
   * yet — distinct from null, which means nobody is, and is what puts the
   * sign-in page up. Showing the app for a frame and then snatching it away
   * would be worse than a moment of nothing.
   */
  const [me, setMe] = useState(undefined)
  const [authConfig, setAuthConfig] = useState(null)
  /*
   * VIEW AS A TEAM MEMBER.
   *
   * An administrator who is also on the team — Gun submits a week like
   * everybody else — can switch the whole app to what a team member sees: the
   * same four pages, the Timeline read-only, the Weekly page without anybody
   * else's blockers. Not a costume in the browser: the server is asked to
   * answer the weekly pages by a member's rules too, so what shows is what a
   * member is actually sent. The account stays an administrator throughout;
   * nothing is written to the plan while previewing.
   *
   * Remembered per browser, and announced on every page while it is on, so
   * nobody forgets they are in it.
   */
  const [viewAsMember, setViewAsMember] = useState(() => {
    try { return localStorage.getItem('fa-kpi-view-as') === 'member' } catch { return false }
  })
  // WHICH member: any of the team, so the preview is somebody's real view.
  const [viewAsPerson, setViewAsPerson] = useState(() => {
    try { return localStorage.getItem('fa-kpi-view-as-person') || null } catch { return null }
  })
  const previewing = me?.role === 'admin' && viewAsMember
  const previewPerson = previewing ? (viewAsPerson || me?.person || null) : null
  const viewer = previewing ? { ...me, role: 'user', previewing: true, person: previewPerson } : me
  // Set before any page below asks the server for anything. Somebody else's
  // view is asked for by name (`as`); one's own needs no name.
  api.setViewAs(previewing ? 'member' : null, previewPerson && previewPerson !== me?.person ? previewPerson : null)
  const pickPreview = (id) => {
    setViewAsPerson(id || null)
    try { if (id) localStorage.setItem('fa-kpi-view-as-person', id); else localStorage.removeItem('fa-kpi-view-as-person') } catch { /* private window */ }
  }
  const toggleView = (on) => {
    setViewAsMember(on)
    try { localStorage.setItem('fa-kpi-view-as', on ? 'member' : 'admin') } catch { /* private window */ }
  }
  // The home screen writes itself to the shared plan on a short delay of its
  // own, apart from the register's save.
  const appsSaveTimer = useRef(null)
  const stateRef = useRef(null)
  const [saving, setSaving] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  // Whether THIS browser has saved an edit since it opened: what "Saved" in the header means.
  const [savedHere, setSavedHere] = useState(false)
  const fileRef = useRef(null)
  const firstRender = useRef(true)

  const theme = useMemo(() => buildTheme(mode), [mode])
  // A phone. Written as the raw query because this component sits OUTSIDE its
  // own ThemeProvider, so theme.breakpoints is not reachable from here; 600px
  // is MUI's `sm`, the same line every page below draws.
  const phone = useMediaQuery('(max-width:599.95px)')
  // A tablet: the menu is on screen, and beside it the header has no room
  // for the words on its buttons either. (MUI's `md`, written out likewise.)
  const narrow = useMediaQuery('(max-width:899.95px)')
  const plan = useMemo(() => computePlan(state), [state])

  /*
   * One write, one mark. The mark has to describe the bytes that just landed
   * in local storage, so it is taken here rather than wherever the sync
   * happened — anything else races the very write it is trying to describe.
   */
  const pendingSync = useRef(null)
  /*
   * A tab this role cannot open — from a bookmark, or from being demoted while
   * looking at it — becomes the first one they can.
   */
  useEffect(() => {
    if (!viewer) return
    const mine = TABS.filter((t) => (t.roles || []).includes(viewer.role))
    if (mine.length && !mine.some((t) => t.id === tab)) {
      // Named in the link (a bookmark, a forwarded email), not just the
      // default page: said once, quietly, rather than a silent jump.
      const [named] = hashParts()
      if (named && TABS.some((t) => t.id === named) && !shownNoAccess.current) {
        shownNoAccess.current = true
        setToast({ severity: 'info', muted: true, msg: 'That page is for administrators, so you are on your week instead.' })
      }
      setTab(mine[0].id)
    }
  }, [viewer?.role, me, tab])

  useEffect(() => {
    let stop = false
    Promise.all([authApi.me().catch(() => null), authApi.authConfig().catch(() => null)])
      .then(([who, cfg]) => {
        if (stop) return
        setMe(who)
        setAuthConfig(cfg)
      })
    // The server said this session is over: back to the sign-in page.
    const out = () => setMe(null)
    window.addEventListener(api.SIGNED_OUT, out)
    return () => { stop = true; window.removeEventListener(api.SIGNED_OUT, out) }
  }, [])

  /*
   * Signed in, and allowed to change the shared plan.
   *
   * The server refuses a team member's write to the plan, so their browser
   * must not try: an automatic save that can only fail would leave "unsaved
   * changes" hanging over a page they cannot save from.
   */
  const canWrite = viewer?.role === 'admin'
  /*
   * A TEAM MEMBER SEES THEIR OWN: their projects, their scorecard, their
   * progress. `shown` is the plan narrowed to that, and is what every page a
   * member can open is drawn from; `plan` stays whole underneath, for saving.
   */
  const member = viewer?.role === 'user'
  const myPerson = (previewing ? previewPerson : me?.person) || null
  const shown = useMemo(() => (member ? memberView(plan, myPerson) : plan), [member, plan, myPerson])
  useEffect(() => {
    if (!canWrite) { setAiOn(false); return }
    api.aiStatus().then((r) => setAiOn(!!r.configured)).catch(() => setAiOn(false))
  }, [canWrite])
  /*
   * The shared plan is only asked for once somebody is signed in. The server
   * refuses a stranger now, and a browser that signed in AFTER these effects
   * ran on mount would otherwise never fetch it at all. Keyed on the address
   * so signing in as somebody else asks again.
   */
  const signedInAs = me ? me.email : null

  useEffect(() => {
    stateRef.current = state
    saveState(state)
    if (pendingSync.current !== null) {
      markSynced(pendingSync.current)
      pendingSync.current = null
    }
  }, [state])

  /*
   * The shared home screen, taken on open.
   *
   * Independent of whether this browser takes the shared PLAN — it may be
   * holding edits it has not saved, and the notice for that is a decision for
   * a person. The icons are not: they are the same for everybody, they carry
   * no numbers, and a second machine should show them without anybody being
   * asked anything.
   *
   * A stored home screen wins over the local one, EXCEPT where the database
   * has none at all and this browser does — that is the machine the icons were
   * arranged on, before any of this synced, and its copy is the only one there
   * is. It goes up rather than being wiped.
   */
  // The home screen's icons are on their way: the Apps page waits for them.
  const [appsLoading, setAppsLoading] = useState(true)
  useEffect(() => {
    let stop = false
    if (!signedInAs) return undefined
    const name = (state.scenarioName || '').trim()
    if (!name) { setAppsLoading(false); return undefined }
    api.loadApps(name).then((r) => {
      if (stop || !r || !Array.isArray(r.apps)) return
      const mine = stateRef.current?.apps || []
      if (r.apps.length === 0 && mine.length > 0) {
        api.saveApps(name, mine).catch(() => {})
        return
      }
      setState((s) => (JSON.stringify(s.apps || []) === JSON.stringify(r.apps)
        ? s
        : { ...s, apps: r.apps }))
    }).catch(() => {}).finally(() => { if (!stop) setAppsLoading(false) })
    return () => { stop = true }
    // Once per sign-in: the name does not change without a reload.
  }, [signedInAs])
  useEffect(() => { localStorage.setItem('fa-kpi-mode', mode) }, [mode])

  /*
   * A browser that has never held a plan takes the shared one.
   *
   * The app boots from this browser, which is right for work in progress and
   * wrong on a second machine: with nothing in local storage it fell back to
   * the bundled seed and every manday, cost and return read empty, as though
   * the database were not connected at all.
   *
   * It only ever fills a BLANK browser. Work already here is never replaced —
   * that would throw away edits nobody had finished — so an existing plan gets
   * told the database has a newer one and is left alone.
   */
  const [dbNotice, setDbNotice] = useState(null)
  const [loadingShared, setLoadingShared] = useState(false)
  /*
   * Read during the FIRST RENDER, not inside the effect.
   *
   * The effect that mirrors state into local storage runs first, so by the
   * time this one asked, every browser looked like it already held a plan —
   * the seed it had just written a millisecond earlier — and none of them ever
   * took the shared one.
   */
  const startedBlank = useRef(hasNothingOfItsOwn())
  /*
   * Nothing is shown until the shared plan has been asked for.
   *
   * The app painted the bundled seed first and swapped the real plan in when
   * the fetch returned. On a cold instance that took fifteen seconds, and for
   * fifteen seconds every manday, cost and return on screen read zero — which
   * is exactly what somebody opening it in a new window reports as "all the
   * data is missing".
   *
   * Only a browser that has nothing of its own waits. One that already holds a
   * plan has something true to show immediately.
   */
  const [bootstrapping, setBootstrapping] = useState(startedBlank.current)
  /*
   * Past the loading screen's cap, a blank browser is showing the bundled seed
   * while the shared plan is still on its way: said in the header, so zeros on
   * screen are not taken for the real numbers.
   */
  const [sharedLoading, setSharedLoading] = useState(startedBlank.current)
  /*
   * Take the shared plan. One path, so the automatic case and the button can
   * never end up doing subtly different things.
   */
  const takeShared = useCallback(async (entry, how, { announce = false } = {}) => {
    const doc = await api.loadScenario(entry.name)
    if (!doc?.payload?.projects) throw new Error('That scenario has no projects in it.')
    let taken = null
    setState((s) => {
      const next = repairState({
        // The mirror of what was saved. Taking named fields back was the other
        // half of the same bug: even once the Apps page reached the database,
        // a list of four field names here would never have read it out again.
        ...applyShared(s, doc.payload),
        scenarioName: entry.name,
      })
      // Stamped as agreeing with the database, so the next visit can tell
      // "untouched since the last sync" from "somebody has been working".
      taken = next
      return taken
    })
    pendingSync.current = entry.updatedAt
    setLastSaved(entry.updatedAt)
    linkedToDb.current = true
    setDbNotice(null)
    setTimeout(() => setDirty(false), 0)
    /*
     * Said only when somebody pressed "Load it". The automatic load on every
     * visit is routine: a bright toast about "the shared database" covered the
     * page each time and told a member nothing they could use (QA, 2026-11-07).
     */
    if (announce) {
      setToast({
        severity: 'success',
        muted: true,
        msg: `${how} the latest shared plan — ${doc.payload.projects.length} projects.`,
      })
    }
  }, [])

  useEffect(() => {
    if (!signedInAs) return undefined
    let cancelled = false
    const blank = startedBlank.current
    // Never stuck on the spinner. Whatever happens to the request — a slow
    // instance, a proxy that swallows it, no database at all — the app shows
    // what it has after this, and the shared plan still lands when it arrives.
    const cap = setTimeout(() => { if (!cancelled) setBootstrapping(false) }, 2500)
    ;(async () => {
      try {
        // Ask whether there IS a database before waiting on one. Without this
        // the app sat on the loading screen for its whole timeout on any
        // deployment that has no store configured, which is every local run.
        const store = await api.storeStatus()
        if (cancelled) return
        if (!store.connected) { setBootstrapping(false); setSharedLoading(false); return }

        const list = await api.listScenarios()
        if (cancelled || !Array.isArray(list) || !list.length) return
        const latest = [...list].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))[0]
        if (!blank) {
          /*
           * This browser holds a plan — but holding one is not the same as
           * having work in it. If its content still matches the fingerprint
           * taken when it last agreed with the database, nobody has typed
           * anything since, and refusing the newer plan just leaves somebody
           * reading last week's register and reporting the app as broken.
           *
           * Only genuinely unsaved work stops it, and then it asks.
           */
          const sync = syncStatus()
          const isNewer = String(latest.updatedAt || '') !== String(sync.syncedAt || '')
          /*
           * Nothing to say. This browser is already holding what the database
           * holds — it took it, or it saved it. Warning here is how the notice
           * came back on every refresh after somebody had already answered it,
           * which teaches people to click past the one that matters.
           */
          if (!isNewer) return
          if (sync.untouched) {
            await takeShared(latest, 'Updated to')
            return
          }
          /*
           * Two different situations, and telling them apart matters: a
           * browser with real edits stands to lose them, while one that simply
           * has no fingerprint yet — every browser, the first time it opens a
           * build that has this — stands to lose nothing at all. Saying "your
           * unsaved edits" to the second is a warning about a danger that is
           * not there, and a warning nobody can verify is one people learn to
           * click through.
           */
          setDbNotice({ ...latest, knowsOfEdits: sync.marked })
          return
        }
        await takeShared(latest, 'Loaded')
      } catch {
        // No database reachable. The browser copy stands, which is the point of
        // keeping one.
      } finally {
        clearTimeout(cap)
        if (!cancelled) { setBootstrapping(false); setSharedLoading(false) }
      }
    })()
    return () => { cancelled = true; clearTimeout(cap) }
  }, [takeShared, signedInAs])

  useEffect(() => {
    if (wasReset) {
      setToast({
        severity: 'info',
        msg: 'Loaded the latest source data — your browser was holding an older version of the project register.',
      })
    }
  }, [wasReset])

  /*
   * Anything that changes the plan marks it unsaved.
   *
   * Watched field by field, off SHARED_KEYS, rather than by naming them here.
   * This was a hand-written list — projects, people, settings, scenarioName —
   * and the Apps page was not on it, so arranging the home screen never marked
   * the plan unsaved and the automatic save never ran for it. The page saved
   * nothing, on any machine, for the same reason the payload carried nothing:
   * somebody had to remember, twice, in two different files.
   *
   * Not the whole `state` object: a save deliberately replaces it with a copy
   * to force a re-render, and watching the object itself would read that as a
   * fresh edit and save again, forever.
   *
   * Skip the first render so simply opening the app is not a pending edit.
   */
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    setDirty(true)
  }, [...SHARED_KEYS.map((k) => state[k]), state.scenarioName])

  // Don't let a closing tab silently drop unsaved edits.
  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** Save the plan to the shared database under the current scenario name. */
  const saveToDb = useCallback(async () => {
    // Hard gate: a scorecard that does not total 100% must never reach the
    // database, or the export and the appraisal built from it are wrong.
    if (plan.invalid.length) {
      setTab('people')
      setToast({
        severity: 'error',
        msg: `Cannot save — ${plan.invalid.map((x) => `${x.nick} is at ${Math.round(x.sum * 100)}%`).join(', ')}. Every scorecard must total exactly 100%.`,
      })
      return
    }
    const name = (state.scenarioName || '').trim()
    if (!name) { setScenario('save'); return }
    /*
     * The other direction, and the one that actually destroys work: this
     * browser is showing an older plan it never took, and Save would put it
     * over the newer one — deleting whatever somebody else added in between,
     * with no copy of it anywhere. Nothing warned about that at all.
     */
    if (dbNotice && !window.confirm(
      `The shared "${name}" was saved ${new Date(dbNotice.updatedAt).toLocaleString()}, after this browser last had it, `
      + 'and this browser never loaded it. Saving now REPLACES that newer plan with what is on this screen, '
      + 'and whatever was added in between is gone.\n\nSave anyway?',
    )) return
    setSaving(true)
    try {
      const r = await api.saveScenario(
        name,
        // Everything that is the plan — see sharedPayload. Listing the fields
        // here by hand is what left the Apps page on one machine.
        sharedPayload(state),
        localStorage.getItem('fa-kpi-author') || '',
      )
      setDirty(false)
      setLastSaved(r.updatedAt)
      setSavedHere(true)
      linkedToDb.current = true
      // The browser and the database now hold the same thing; mark it so the
      // next visit can take a newer plan without asking.
      pendingSync.current = r.updatedAt
      setState((s) => ({ ...s }))
      setToast({ severity: 'success', msg: `Saved "${name}" to the database.` })
    } catch (e) {
      setToast({ severity: 'error', msg: `${e.message} Your work is still safe in this browser.` })
    } finally {
      setSaving(false)
    }
  }, [state, plan.invalid, dbNotice])

  /*
   * Work reaches the database on its own.
   *
   * It only ever reached it when somebody pressed Save, and nobody presses
   * Save every time they type a manday: a browser ended up holding 1,907
   * mandays against the 1,189 in the database, and the second machine showed
   * the old figure and looked broken.
   *
   * Three conditions, all of them about not making things worse:
   *   - this browser must already be working ON the shared plan, having loaded
   *     it or saved it. A browser that has only ever seen the bundled seed must
   *     never push that over the team's work;
   *   - the plan must be valid. The same gate the Save button applies: a
   *     scorecard that does not total 100% must not reach the database, or the
   *     appraisal built from it is wrong;
   *   - it waits for the typing to stop. Saving on every keystroke would write
   *     a document a second and store a half-typed number as though it were a
   *     decision.
   */
  const linkedToDb = useRef(false)
  const autoSaveTimer = useRef(null)
  useEffect(() => {
    if (!dirty || !linkedToDb.current) return undefined
    if (!canWrite) return undefined
    if (plan.invalid.length) return undefined
    const name = (state.scenarioName || '').trim()
    if (!name) return undefined
    /*
     * AND NOT WHEN THIS BROWSER IS BEHIND.
     *
     * The Save button asks before replacing a shared plan that has moved on;
     * this did not ask anything, because it does not ask anything at all. So a
     * browser showing yesterday's plan needed only one keystroke, and four
     * seconds later it had quietly overwritten everything saved since —
     * projects marked Excluded came back as Watch, promoted hours went back to
     * Watch, twice in one afternoon.
     *
     * Automatic saving is for keeping one person's own work safe. It has no
     * business resolving a disagreement between two plans: the change stays
     * here, `dirty` stays set, and the Save button — which explains what would
     * be lost and asks first — is how that gets settled.
     */
    if (dbNotice) return undefined

    autoSaveTimer.current = setTimeout(async () => {
      try {
        const r = await api.saveScenario(
          name,
          sharedPayload(state),
          localStorage.getItem('fa-kpi-author') || '',
        )
        setDirty(false)
        setLastSaved(r.updatedAt)
        setSavedHere(true)
        // The browser and the database agree again — mark it, exactly as the
        // Save button does. Without this the automatic save moved the
        // database on and left the browser's mark behind, so the next visit
        // read its own work as somebody else's and asked about it.
        pendingSync.current = r.updatedAt
        setState((cur) => ({ ...cur }))
      } catch {
        // Offline, or the database is down. The browser copy stands and the
        // Save button still says there is something to send.
      }
    }, 4000)
    return () => clearTimeout(autoSaveTimer.current)
  }, [dirty, state, plan.invalid.length, dbNotice, canWrite])

  // Keep the tab in the URL hash so a view can be linked or bookmarked.
  useEffect(() => {
    if (tabFromHash() !== tab) window.location.hash = tab
  }, [tab])
  useEffect(() => {
    const onHash = () => {
      setTab(tabFromHash())
      setHashArg((a) => ({ page: hashParts()[0], key: hashParts()[1], n: a.n + 1 }))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  /**
    * Apply an approved import: many projects, each with its own patch.
    *
    * Projects the import did not name come back as the SAME object, so a row
    * the file never mentioned cannot be re-created or quietly rebuilt.
    */
  const applyProjectImport = useCallback((result) => {
    setState((s) => ({ ...s, projects: applyImport(s.projects, result) }))
  }, [])

  /**
    * Patch one project by Jira key.
    *
    * A PIC change is special: credit comes from the contributor list, not from
    * the `pic` field, so writing `pic` alone leaves the previous owner holding
    * the project. reassignPatch moves their entry across.
    */
  const updateProject = useCallback((key, patch) => {
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (p.key !== key) return p
        let full = 'pic' in patch ? { ...patch, ...reassignPatch(p, patch.pic) } : patch
        /*
         * Moving a committed finish date is not a plain field write: the first
         * move after a date exists is the free re-plan everybody gets once the
         * requirement is known, and every move after it is counted. Recorded
         * on BOTH edit paths — one row or a hundred — because a rule enforced
         * in only some of them is not a rule.
         */
        if ('due' in patch) full = { ...full, ...replanPatch(p, patch.due) }
        return { ...p, ...full }
      }),
    }))
  }, [])

  /**
   * Replace the whole home screen.
   *
   * Whole, not patched: a drag reorders, folds and unfolds several items at
   * once, and applying that as a series of edits would leave the screen
   * half-arranged if one of them lost a race.
   */
  const updateApps = useCallback((apps) => {
    const next = Array.isArray(apps) ? apps : []
    setState((s) => ({ ...s, apps: next }))
    /*
     * AND STRAIGHT TO THE SHARED PLAN.
     *
     * Not through the register's save, which waits for this browser to have
     * linked to the database and stands down when it is behind — both right
     * for projects and hours, and both meant a home screen never left the
     * machine it was arranged on. This writes one field, server-side, so it
     * cannot overwrite anybody's register whatever state this browser is in.
     *
     * Debounced, because a drag is a hundred small changes and each one would
     * otherwise be a request.
     */
    const name = (stateRef.current?.scenarioName || '').trim()
    if (!name) return
    clearTimeout(appsSaveTimer.current)
    appsSaveTimer.current = setTimeout(() => {
      api.saveApps(name, next).catch(() => {
        // Offline, or no database. The browser copy stands and the next change
        // tries again; nothing is lost locally either way.
      })
    }, 800)
  }, [])

  const updateSettings = useCallback((patch) => {
    setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  }, [])

  const updatePerson = useCallback((id, patch) => {
    setState((s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }))
  }, [])

  /**
   * Override one KPI line's weight and/or target for one person.
   *
   * An override that equals the live computed value is discarded rather than
   * stored, so the line keeps tracking project assignments. Without this,
   * setting a target to the number it already shows would pin it, and later
   * edits to the project's saving hours would never reach the scorecard.
   */
  const updatePersonKpi = useCallback((id, lineId, patch) => {
    const line = plan.people.find((x) => x.id === id)?.kpiLines.find((l) => l.id === lineId)
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const kpi = { ...(p.kpi || {}) }
        const entry = { ...(kpi[lineId] || {}), ...patch }

        if ('target' in patch) {
          const cleared = patch.target == null || patch.target === ''
          if (cleared || (line && patch.target === line.defaultTarget)) delete entry.target
        }
        if ('weight' in patch && line && Math.abs(patch.weight - line.defaultWeight) < 1e-9) {
          delete entry.weight
        }

        // Only the edited line is written. scorecardWeights holds a typed weight
        // at exactly what was typed and shares the remainder across the lines
        // that have not been touched, so the siblings must NOT be pinned here —
        // pinning them all would leave nothing free to absorb the difference.
        if (Object.keys(entry).length) kpi[lineId] = entry
        else delete kpi[lineId]

        return { ...p, kpi }
      }),
    }))
  }, [plan.people])

  const resetPersonKpi = useCallback((id) => {
    setState((s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, kpi: {}, kpiHidden: [] } : p)) }))
    setToast({ severity: 'info', msg: 'Weights, targets and removed lines all reset to the defaults.' })
  }, [])

  /**
    * Remove a KPI line from someone's scorecard.
    *
    * A derived line is HIDDEN, so it can be restored — it still exists, it is
    * just off the card. A hand-added one is DELETED: there is nothing behind it
    * to come back to, and leaving it in a restore strip only invites somebody
    * to resurrect a line the author had finished with.
    */
  const removePersonKpiLine = useCallback((id, lineId) => {
    const custom = String(lineId).startsWith('custom-')
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        return custom
          ? { ...p, customLines: (p.customLines || []).filter((l) => l.id !== lineId) }
          : { ...p, kpiHidden: [...new Set([...(p.kpiHidden || []), lineId])] }
      }),
    }))
    setToast({
      severity: 'info',
      msg: custom
        ? 'KPI line deleted. Weights no longer total 100% — rebalance before saving.'
        : 'Line removed. Weights no longer total 100% — rebalance before saving.',
    })
  }, [])

  /**
    * Type a figure over the calculated one on somebody's scorecard, or take it
    * back off. Passing null for a key reverts THAT figure and leaves the other.
    */
  const setPersonOverride = useCallback((id, patch) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const next = { ...(p.overrides || {}), ...patch }
        for (const k of Object.keys(next)) if (next[k] == null) delete next[k]
        return { ...p, overrides: next }
      }),
    }))
    const reverting = Object.values(patch).every((v) => v == null)
    setToast({
      severity: reverting ? 'success' : 'warning',
      msg: reverting
        ? 'Back to the figure the project register calculates.'
        : 'Manual figure set. It shows on the scorecard and in the export; the project register is unchanged.',
    })
  }, [])

  /** Add or update a KPI line somebody writes by hand. */
  const savePersonKpiLine = useCallback((id, line) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const lines = p.customLines || []
        const at = lines.findIndex((l) => l.id === line.id)
        return {
          ...p,
          customLines: at < 0 ? [...lines, line] : lines.map((l) => (l.id === line.id ? line : l)),
          // Adding a line to a card that had one hidden must not bring the
          // hidden one back; nothing else about the card changes.
          kpiHidden: p.kpiHidden || [],
        }
      }),
    }))
  }, [])

  /*
   * Add an objective to someone's scorecard by hand. It carries no projects, so
   * its target starts at zero and the other lines give up weight to it — which
   * is the point: it commits the person to work that is not scoped yet.
   */
  const addPersonObjective = useCallback((id, objective) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => (p.id === id
        ? { ...p, extraObjectives: [...new Set([...(p.extraObjectives || []), objective])] }
        : p)),
    }))
  }, [])

  /*
   * Removing it only takes back the manual addition. If the person has since
   * been given a project on that objective, the line stays — it is derived at
   * that point, and hiding a derived line is what the bin icon is for.
   */
  const removePersonObjective = useCallback((id, objective) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) => (p.id === id
        ? { ...p, extraObjectives: (p.extraObjectives || []).filter((o) => o !== objective) }
        : p)),
    }))
  }, [])

  const restorePersonKpiLine = useCallback((id, lineId) => {
    setState((s) => ({
      ...s,
      people: s.people.map((p) =>
        p.id === id ? { ...p, kpiHidden: (p.kpiHidden || []).filter((x) => x !== lineId) } : p,
      ),
    }))
  }, [])

  /** Scale the remaining weights proportionally back to exactly 100%. */
  const rebalancePersonKpi = useCallback((id) => {
    const person = plan.people.find((p) => p.id === id)
    if (!person) return
    const next = rebalanceWeights(person.kpiLines)
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const kpi = { ...(p.kpi || {}) }
        for (const [lineId, w] of Object.entries(next)) kpi[lineId] = { ...(kpi[lineId] || {}), weight: w }
        return { ...p, kpi }
      }),
    }))
    setToast({ severity: 'success', msg: 'Weights rebalanced to 100%.' })
  }, [plan.people])

  /** Snap targets back to what the person actually carries right now. */
  const syncPersonTargets = useCallback((id) => {
    const person = plan.people.find((p) => p.id === id)
    if (!person) return
    const drifted = person.kpiLines.filter((l) => l.drifted)
    if (!drifted.length) return
    setState((s) => ({
      ...s,
      people: s.people.map((p) => {
        if (p.id !== id) return p
        const kpi = { ...(p.kpi || {}) }
        for (const l of drifted) {
          const { target, ...rest } = kpi[l.id] || {}
          if (Object.keys(rest).length) kpi[l.id] = rest
          else delete kpi[l.id]
        }
        return { ...p, kpi }
      }),
    }))
    setToast({ severity: 'success', msg: `${drifted.length} target${drifted.length === 1 ? '' : 's'} synced to current assignments.` })
  }, [plan.people])

  const addProject = useCallback(() => {
    let created
    setState((s) => {
      // keep NEW-n unique even after deletes
      const n = s.projects.filter((p) => p.key.startsWith('NEW-')).length + 1
      let p = newProject(n)
      let i = n
      while (s.projects.some((x) => x.key === p.key)) p = newProject(++i)
      created = p
      return { ...s, projects: [p, ...s.projects] }
    })
    setToast({ severity: 'success', msg: 'Project added at the top of the list — fill in its details.' })
    return created
  }, [])

  /**
   * Add several projects at once, from a source that already knows what they
   * are — the Jira epic import.
   *
   * Separate from addProject because that one exists to give somebody a blank
   * row to type into, and says so in a toast. This one is silent and returns
   * what it made, so the caller can report on its own terms.
   */
  const addProjects = useCallback((rows) => {
    if (!rows || !rows.length) return []
    let made = []
    setState((s) => {
      let i = s.projects.filter((p) => p.key.startsWith('NEW-')).length
      const taken = new Set(s.projects.map((p) => p.key))
      made = rows.map((row) => {
        let p = newProject(++i)
        while (taken.has(p.key)) p = newProject(++i)
        taken.add(p.key)
        return { ...p, ...row }
      })
      return { ...s, projects: [...made, ...s.projects] }
    })
    return made
  }, [])

  /**
   * Swap the whole register for one somebody has already computed.
   *
   * Used by the Jira sync, which works out the new list in one pass — dates
   * refreshed and new epics folded in — rather than through a hundred separate
   * edits that would each mark the plan dirty and each fire a save.
   */
  const replaceProjects = useCallback((projects) => {
    if (!Array.isArray(projects)) return
    setState((s) => ({ ...s, projects }))
  }, [])

  const deleteProjects = useCallback((keys) => {
    const set = new Set(keys)
    setState((s) => ({ ...s, projects: s.projects.filter((p) => !set.has(p.key)) }))
    setToast({ severity: 'info', msg: `Deleted ${keys.length} project${keys.length === 1 ? '' : 's'}.` })
  }, [])

  const bulkUpdate = useCallback((keys, patch) => {
    const set = new Set(keys)
    setState((s) => ({
      ...s,
      // Same rule as a single edit: assigning a PIC in bulk has to move the
      // contributor record too, or every project stays with its old owner.
      projects: s.projects.map((p) => {
        if (!set.has(p.key)) return p
        let full = 'pic' in patch ? { ...patch, ...reassignPatch(p, patch.pic) } : patch
        /*
         * Moving a committed finish date is not a plain field write: the first
         * move after a date exists is the free re-plan everybody gets once the
         * requirement is known, and every move after it is counted. Recorded
         * on BOTH edit paths — one row or a hundred — because a rule enforced
         * in only some of them is not a rule.
         */
        if ('due' in patch) full = { ...full, ...replanPatch(p, patch.due) }
        return { ...p, ...full }
      }),
    }))
    setToast({ severity: 'success', msg: `Updated ${keys.length} project${keys.length === 1 ? '' : 's'}.` })
  }, [])

  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    setExporting(true)
    try {
      // The check-ins as this person may see them; no sheet if the store is down.
      await exportWorkbook(plan, state, await api.weeklyForExport())
      setToast({ severity: 'success', msg: 'Excel workbook exported.' })
    } catch (e) {
      setToast({ severity: 'error', msg: `Export failed: ${e.message}` })
    } finally {
      setExporting(false)
    }
  }

  const handleReset = () => {
    if (!confirm('Discard all your edits and reload the original source workbook?')) return
    setState(freshState())
    setToast({ severity: 'info', msg: 'Reset to the source workbook.' })
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      setState(await readScenarioFile(file))
      setToast({ severity: 'success', msg: 'Scenario loaded.' })
    } catch (err) {
      setToast({ severity: 'error', msg: err.message })
    }
  }

  /*
   * The tabs this person may open, and nothing else.
   *
   * A hash in the address bar names a tab, so the list is also the guard: a
   * link to #settings from somebody who is not an administrator lands on the
   * first tab they DO have rather than on a page they should not see.
   */
  const visibleTabs = TABS.filter((t) => (t.roles || []).includes(viewer?.role))
    .map((t) => (member && t.memberLabel ? { ...t, label: t.memberLabel } : t))
  const allowed = visibleTabs.some((t) => t.id === tab)
  const menuTabs = visibleTabs.filter((t) => !t.hidden)

  const current = visibleTabs.find((t) => t.id === tab) || TABS.find((t) => t.id === tab)
  const CurrentIcon = current?.icon || null
  // What the welcome banner calls somebody: their nickname on the team when
  // the account is linked to one, otherwise the name in their address.
  const hello = (myPerson && state.people.find((p) => p.id === myPerson)?.nick)
    || (me?.local ? 'there' : displayName(me?.email))
  const goTo = (o) => {
    setJump({ ...o, n: Date.now() })
    setTab(o.tab)
    setNavOpen(false)
  }
  /*
   * An approval moved a project's due date on the SERVER. The same fields go
   * into this browser's copy exactly as the server saved them — not through
   * replanPatch again, which would count the re-plan a second time — so this
   * browser's next automatic save carries the new date instead of quietly
   * putting the old one back.
   */
  const applyServerProjects = (changed) => {
    const by = Object.fromEntries((changed || []).map((x) => [x.key, x]))
    if (!Object.keys(by).length) return
    setState((s) => ({
      ...s,
      projects: s.projects.map((p) => {
        if (!by[p.key]) return p
        const { key: _k, ...fields } = by[p.key]
        return { ...p, ...fields }
      }),
    }))
  }
  // A project a member created from their week (a new Jira epic), added to the
  // register on the server: added here too, so this browser's next automatic
  // save carries it instead of dropping it.
  const addServerProjects = (rows) => {
    setState((s) => {
      const have = new Set(s.projects.map((p) => p.key))
      const fresh = (rows || []).filter((p) => p?.key && !have.has(p.key))
      return fresh.length ? { ...s, projects: [...s.projects, ...fresh] } : s
    })
  }
  // A project's own page.
  const openProject = (key) => { window.location.hash = `project/${encodeURIComponent(key)}` }
  // From a weekly task to its project's bar on the Timeline, highlighted.
  const showOnTimeline = (projectKey) => {
    const p = state.projects.find((x) => x.key === projectKey)
    goTo({ tab: 'timeline', q: (p?.jiraKey || projectKey).trim(), focus: projectKey })
  }
  const signOut = async () => {
    try { await authApi.signOut() } finally { setMe(null) }
  }

  const cov = plan.totals.totalCoverage
  const covTone = cov >= 1 ? 'success' : cov >= 0.9 ? 'warning' : 'error'

  /*
   * NOTHING OF THE APP BEFORE WE KNOW WHO IS ASKING.
   *
   * Ahead of the loading screen on purpose: waking the server to fetch a plan
   * a stranger will never see is work for nobody, and a flash of somebody
   * else's appraisal data before the sign-in page appears would be worse than
   * either.
   */
  if (me === undefined) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{
          minHeight: '100vh', display: 'grid', placeItems: 'center',
        }}
        >
          <Loading variant="block" label="Loading…" />
        </Box>
      </ThemeProvider>
    )
  }

  if (!me) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SignIn config={authConfig} onSignedIn={setMe} />
      </ThemeProvider>
    )
  }

  if (bootstrapping) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <Loading variant="block" label="Loading the shared plan…" />
          <Typography variant="caption" sx={{ color: 'text.disabled', mt: -3 }}>
            first open of the day can take a moment while the server wakes
          </Typography>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ minHeight: '100vh' }}>
        <Sidebar
          tabs={menuTabs}
          tab={tab}
          onTab={(id) => { setTab(id); setNavOpen(false) }}
          mini={navMini}
          onFold={() => setNavMini((m) => !m)}
          phone={phone}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          me={me}
          onSignOut={signOut}
          previewing={previewing}
          onToggleView={me?.role === 'admin' ? toggleView : null}
          coverage={member ? memberProgress(shown) : {
            total: Math.round(plan.totals.totalHours),
            target: plan.totals.target,
            share: cov || 0,
            tone: covTone,
          }}
        />

        {/* Everything beside the menu: the header, then the page. */}
        {/*
          * THE STAGE: one large rounded panel holding the header and the page,
          * beside the menu, with the glow showing round its edges — the frame
          * of the reference. On a phone there is no room for a frame, and the
          * page runs edge to edge.
          */}
        <Box sx={{
          ml: phone ? 0 : `${(navMini ? NAV_W_MINI : NAV_W) + 24}px`,
          mr: phone ? 0 : '12px',
          my: phone ? 0 : '12px',
          minHeight: phone ? '100vh' : 'calc(100vh - 24px)',
          transition: 'margin-left .2s ease',
          ...(phone ? {} : {
            borderRadius: '24px',
            border: 1,
            borderColor: 'divider',
            bgcolor: SURFACE[mode].stage,
            backdropFilter: 'blur(18px)',
          }),
        }}
        >
          {/*
            * THE HEADER: which page this is, and the few things that apply to
            * every page — the export, the light/dark switch, the file menu.
            *
            * On a phone the ☰ opens the menu over the page; a computer has no
            * ☰, the menu folds from its own button. The export becomes an icon on a
            * phone, where a 390px row has no room for its words.
            */}
          <Box
            component="header"
            sx={{
              position: 'sticky',
              top: 0,
              zIndex: (t) => t.zIndex.appBar,
              pt: { xs: 1, sm: 0 },
              px: { xs: 1, sm: 0 },
            }}
          >
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: { xs: 0.75, sm: 1.5 },
              px: { xs: 0.75, sm: 2.5 },
              py: { xs: 0.75, sm: 1.75 },
              ...(phone
                ? { borderRadius: 4, border: 1, borderColor: 'divider' }
                : { borderTopLeftRadius: '24px', borderTopRightRadius: '24px', borderBottom: 1, borderColor: 'divider' }),
              bgcolor: (t) => alpha(t.palette.mode === 'dark' ? '#0a0c2e' : '#ffffff', 0.82),
              backdropFilter: 'blur(14px)',
            }}
            >
              {/* Only a phone needs ☰: there the menu is hidden. On a computer
                  the menu is always on screen and folds from its own button. */}
              {phone && (
                <Tooltip title="Menu">
                  <IconButton onClick={() => setNavOpen(true)} aria-label="menu">
                    <MenuIcon />
                  </IconButton>
                </Tooltip>
              )}
              {CurrentIcon && <IconTile icon={CurrentIcon} color={PAGE_COLOR[tab]} size={phone ? 32 : 38} />}
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h4" noWrap sx={{ fontWeight: 700, fontSize: { xs: '0.95rem', sm: '1.1rem' } }}>
                  {current?.label || 'F&A Tech'}
                </Typography>
                <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: { xs: 'none', md: 'block' } }}>
                  F&amp;A Tech · 2026 Objective &amp; KPI Planning
                </Typography>
              </Box>

              {canWrite && plan.invalid.length > 0 && (
                <Tooltip title={`${plan.invalid.map((x) => `${x.nick} ${Math.round(x.sum * 100)}%`).join(', ')} — saving is blocked until every scorecard totals 100%`}>
                  <Chip
                    size="small"
                    color="error"
                    label={phone ? `${plan.invalid.length} ≠ 100%` : `${plan.invalid.length} scorecard${plan.invalid.length === 1 ? '' : 's'} ≠ 100%`}
                    onClick={() => setTab('people')}
                    sx={{ cursor: 'pointer', minWidth: 0 }}
                  />
                </Tooltip>
              )}

              {sharedLoading && !phone && <Loading label="Loading the shared plan…" />}
              {/* An edit reaches the shared plan a few seconds later: said, so nobody wonders. */}
              {canWrite && !phone && !sharedLoading && linkedToDb.current && (dirty || saving) && (
                dbNotice || plan.invalid.length
                  ? <Typography variant="caption" data-save-status="unsaved" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>Not saved yet</Typography>
                  : <Box data-save-status="saving"><Loading label="Saving…" /></Box>
              )}
              {canWrite && !phone && !sharedLoading && linkedToDb.current && !dirty && !saving && savedHere && lastSaved && (
                <Typography variant="caption" data-save-status="saved" title={`Saved to the shared plan ${new Date(lastSaved).toLocaleString()}`} sx={{ color: 'text.disabled', whiteSpace: 'nowrap' }}>
                  Saved
                </Typography>
              )}

              <Box sx={{ flex: 1 }} />

              {/* The manager can look at any week from the top bar. */}
              {allowed && tab === 'dashboard' && canWrite && !phone && (
                <WeekSwitcher week={dashWeek} onChange={setDashWeek} compact={narrow} />
              )}

              <GlobalSearch tabs={menuTabs} plan={shown} admin={canWrite} onGo={goTo} phone={narrow} />

              {/* The chatbot: an administrator's, and only when the AI is there. */}
              {canWrite && aiOn && (narrow ? (
                <Tooltip title="Ask about the plan">
                  <IconButton onClick={() => setChatOpen(true)} aria-label="Ask about the plan">
                    <AutoAwesomeIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : (
                <Button
                  variant="outlined"
                  startIcon={<AutoAwesomeIcon />}
                  onClick={() => setChatOpen(true)}
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap', color: 'text.primary', borderColor: 'divider' }}
                >
                  Ask
                </Button>
              ))}

              {/* The workbook is the whole team's plan: an administrator's. */}
              {canWrite && (narrow ? (
                <Tooltip title="Export Excel">
                  <span>
                    <IconButton onClick={handleExport} disabled={exporting} aria-label="Export Excel">
                      {exporting ? <CircularProgress size={18} /> : <DownloadIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              ) : (
                <Button
                  variant="outlined"
                  startIcon={<DownloadIcon />}
                  onClick={handleExport}
                  disabled={exporting}
                  sx={{ flexShrink: 0, whiteSpace: 'nowrap', color: 'text.primary', borderColor: 'divider' }}
                >
                  {exporting ? 'Building…' : 'Export Excel'}
                </Button>
              ))}

              <Tooltip title={mode === 'dark' ? 'Light mode' : 'Dark mode'}>
                <IconButton size="small" onClick={() => setMode(mode === 'dark' ? 'light' : 'dark')}>
                  {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
                </IconButton>
              </Tooltip>

              {/* Scenario files are copies of the whole plan: an administrator's too. */}
              {canWrite && (
                <IconButton size="small" onClick={(e) => setMenuEl(e.currentTarget)} aria-label="More">
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              )}
              <Menu anchorEl={menuEl} open={!!menuEl} onClose={() => setMenuEl(null)}>
                {/* Writing the shared plan is an administrator's; the server refuses anybody else. */}
                {canWrite && (
                  <MenuItem onClick={() => { setScenario('save'); setMenuEl(null) }}>
                    <CloudUploadIcon fontSize="small" sx={{ mr: 1.5 }} /> Publish to shared store
                  </MenuItem>
                )}
                <MenuItem onClick={() => { setScenario('open'); setMenuEl(null) }}>
                  <CloudDownloadIcon fontSize="small" sx={{ mr: 1.5 }} /> Open shared scenario
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { downloadScenario(state); setMenuEl(null) }}>
                  <DataObjectIcon fontSize="small" sx={{ mr: 1.5 }} /> Save scenario file (.json)
                </MenuItem>
                <MenuItem onClick={() => { fileRef.current?.click(); setMenuEl(null) }}>
                  <UploadFileIcon fontSize="small" sx={{ mr: 1.5 }} /> Load scenario file (.json)
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => { handleReset(); setMenuEl(null) }}>
                  <RestartAltIcon fontSize="small" sx={{ mr: 1.5 }} /> Reset to source workbook
                </MenuItem>
              </Menu>
              <input ref={fileRef} type="file" accept="application/json" hidden onChange={handleImport} />
            </Box>
            {/* On a phone the week switcher has a row of its own, under the title. */}
            {phone && allowed && tab === 'dashboard' && canWrite && (
              <Box sx={{
                display: 'flex', justifyContent: 'center', mt: 0.5, py: 0.5, borderRadius: 4, border: 1, borderColor: 'divider',
                bgcolor: (t) => alpha(t.palette.mode === 'dark' ? '#0a0c2e' : '#ffffff', 0.82), backdropFilter: 'blur(14px)',
              }}
              >
                <WeekSwitcher week={dashWeek} onChange={setDashWeek} />
              </Box>
            )}
          </Box>

        {/* Keyed on the view, so switching it rebuilds the page and every page
            asks the server again under the new rules. */}
        <Box key={previewing ? `member:${previewPerson || ''}` : 'admin'} sx={{ maxWidth: 1440, mx: 'auto', px: { xs: 1.5, sm: 2.5 }, py: { xs: 2, sm: 2.5 } }}>
          {previewing && (
            <ViewAsBanner people={state.people} person={previewPerson} self={me?.person || null} onPick={pickPreview} onBack={() => toggleView(false)} />
          )}
          {/*
            * `allowed` gates every panel, not just the tab strip. The strip is
            * what somebody clicks; this is what a bookmarked hash reaches.
            */}
          {allowed && tab === 'users' && <Users me={me} people={state.people} />}
          {allowed && tab === 'dashboard' && (
            <Dashboard
              week={dashWeek}
              plan={plan}
              onGoTo={setTab}
              hello={hello}
              aiOn={canWrite && aiOn}
              onAsk={askAi}
              onOpenProject={openProject}
              planLoading={sharedLoading}
            />
          )}
          {allowed && tab === 'project' && (
            <Project
              key={hashArg.page === 'project' ? hashArg.key : ''}
              plan={plan}
              projectKey={hashArg.page === 'project' ? hashArg.key : null}
              canWrite={canWrite}
              onUpdate={updateProject}
              onBack={() => (window.history.length > 1 ? window.history.back() : setTab('dashboard'))}
              onShowTimeline={showOnTimeline}
            />
          )}
          {allowed && tab === 'projects' && (
            <Projects
              plan={plan}
              onUpdate={updateProject}
              onBulk={bulkUpdate}
              onImport={applyProjectImport}
            onAdd={addProject}
              onDelete={deleteProjects}
              onSave={saveToDb}
              dirty={dirty}
              saving={saving}
              lastSaved={lastSaved}
              scenarioName={state.scenarioName}
              blocked={plan.invalid}
              onGoTo={setTab}
              jump={jump?.tab === 'projects' ? jump : null}
              canWrite={canWrite}
              onShowTimeline={showOnTimeline}
            />
          )}
          {allowed && tab === 'weekly' && (
            <Weekly
              plan={plan}
              me={viewer}
              hello={hello}
              onProjectsChanged={applyServerProjects}
              onProjectsAdded={addServerProjects}
              onShowTimeline={showOnTimeline}
              focusProject={hashArg.page === 'weekly' && hashArg.key ? hashArg : null}
            />
          )}
          {allowed && tab === 'team' && <Team plan={shown} own={member} />}
          {allowed && tab === 'apps' && <Apps apps={state.apps || []} onChange={updateApps} loading={appsLoading || sharedLoading} />}
          {allowed && tab === 'timeline' && (
            <Timeline
              plan={shown}
              settings={plan.settings}
              onUpdate={updateProject}
              onAddProjects={addProjects}
              onReplaceProjects={replaceProjects}
              rawProjects={state.projects}
              // A team member reads the timeline. Moving a date is a re-plan
              // against somebody's scorecard, and goes through an administrator.
              readOnly={!canWrite}
              note={!member ? null : myPerson
                ? 'Only the projects you hold, as PIC or contributor, are shown.'
                : 'Your account is not linked to your name on the team yet, so no projects are shown. Ask an administrator to link it on the Access tab.'}
              jump={jump?.tab === 'timeline' ? jump : null}
              onOpenWeekly={() => setTab('weekly')}
            />
          )}

          {allowed && tab === 'people' && (
            <People
              plan={plan}
              onPersonKpi={updatePersonKpi}
              onResetKpi={resetPersonKpi}
              onRemoveLine={removePersonKpiLine}
              onSaveLine={savePersonKpiLine}
              onOverride={setPersonOverride}
              onRestoreLine={restorePersonKpiLine}
              onAddObjective={addPersonObjective}
              onRemoveObjective={removePersonObjective}
              onRebalance={rebalancePersonKpi}
              onSyncTargets={syncPersonTargets}
              onUpdate={updateProject}
              jump={jump?.tab === 'people' ? jump : null}
            />
          )}
          {allowed && tab === 'settings' && (
            <Settings
              plan={plan}
              state={state}
              onSettings={updateSettings}
              onPerson={updatePerson}
              scenarioName={state.scenarioName}
              onScenarioName={(v) => setState((s) => ({ ...s, scenarioName: v }))}
            />
          )}
        </Box>
        </Box>

        {canWrite && aiOn && <AiChat open={chatOpen} onClose={() => setChatOpen(false)} phone={phone} seed={chatSeed} />}

        <ScenarioDialog
          open={!!scenario}
          mode={scenario}
          onClose={() => setScenario(null)}
          state={state}
          onToast={setToast}
          onLoad={(payload, name) => {
            // A scenario saved before the reassignment fix carries the same
            // damage as a stale browser, so it gets the same repair.
            setState((s) => repairState({
              ...s,
              people: payload.people,
              projects: payload.projects,
              settings: { ...s.settings, ...payload.settings },
              repair: payload.repair,
              scenarioName: name,
            }))
            // a freshly loaded scenario matches the database
            linkedToDb.current = true
            setTimeout(() => setDirty(false), 0)
          }}
        />

        {/* Only reached when this browser holds UNSAVED work, so it is a
            question, not an announcement: it stays until it is answered.
            As a twelve-second toast it was simply missed, and the browser
            then showed a stale register indefinitely with no sign of it. */}
        <Snackbar
          open={!!dbNotice}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            severity="warning"
            onClose={() => setDbNotice(null)}
            action={(
              <>
                {/* The whole plan as a file, before anything replaces it. A
                    safety net nobody has to think about is worth more than a
                    warning telling them to think. */}
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    downloadScenario(state)
                    setToast({ severity: 'success', msg: 'Copy downloaded — open it again from the menu if you need it.' })
                  }}
                >
                  Keep a copy
                </Button>
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1 }}
                  disabled={loadingShared}
                  onClick={async () => {
                    setLoadingShared(true)
                    try { await takeShared(dbNotice, 'Loaded', { announce: true }) } catch (e) {
                      setToast({ severity: 'error', msg: e.message })
                    } finally { setLoadingShared(false) }
                  }}
                >
                  {loadingShared ? 'Loading…' : 'Load it'}
                </Button>
              </>
            )}
          >
            &ldquo;{dbNotice?.name}&rdquo; in the shared database was saved{' '}
            {dbNotice?.updatedAt ? new Date(dbNotice.updatedAt).toLocaleString() : ''}, and is newer than
            what this browser is showing.{' '}
            {dbNotice?.knowsOfEdits
              ? 'This browser holds edits that never reached the database; loading replaces them.'
              : 'This browser cannot tell whether it holds anything of its own, so it is asking rather than guessing. Keep a copy first if you are unsure — it downloads in a second and can be opened again from the menu.'}
          </Alert>
        </Snackbar>

        <Snackbar
          open={!!toast}
          autoHideDuration={4000}
          onClose={() => setToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          {toast ? (
            <Alert
              severity={toast.severity}
              variant={toast.muted ? 'outlined' : 'filled'}
              onClose={() => setToast(null)}
              sx={toast.muted ? { bgcolor: 'background.paper', color: 'text.primary' } : undefined}
            >
              {toast.msg}
            </Alert>
          ) : undefined}
        </Snackbar>
      </Box>
    </ThemeProvider>
  )
}
