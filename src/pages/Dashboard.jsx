import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import {
  Box, Button, Menu, MenuItem, ListSubheader, useMediaQuery, Tooltip, Skeleton,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import EditIcon from '@mui/icons-material/DashboardCustomizeOutlined'
import AddIcon from '@mui/icons-material/Add'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import * as api from '../lib/api.js'
import {
  addWeeks, weekNo, weekLabel, weekOf,
} from '../lib/weekly.js'
import { CARDS, DEFAULT_LAYOUT, GROUPS } from '../dashboard/cards.js'
import { activitySignals } from '../lib/manager.js'
import CardFrame, { DRAG } from '../dashboard/CardFrame.jsx'
import { RowsSkeleton } from '../dashboard/planCards.jsx'
import { ago } from '../components/FollowUp.jsx'
import WeekSwitcher from '../components/WeekSwitcher.jsx'
import { Spinner } from '../components/Loading.jsx'
import { PageHeader, ErrorState } from '../components/ui.jsx'

const Grid = WidthProvider(GridLayout)

/**
 * THE MANAGER DASHBOARD.
 *
 * A board of cards: where the year stands, what is waiting for a decision,
 * who holds which project and whether it has been updated, the weekly
 * check-in, and the year against its target. An administrator arranges it
 * (adds and removes cards, drags and resizes them) and saves; every
 * administrator then sees that arrangement. Until somebody saves one,
 * everybody sees the default.
 *
 * The page header carries the week switcher and the layout controls. On the
 * board each card is as tall as its content, so none stands half empty: the
 * saved height (or 18 rows, if more) is the most it takes before it scrolls
 * inside itself. On a narrow screen the cards stack in a fixed reading order
 * (the year, the figures, decisions, who holds what) at their natural height,
 * and the board cannot be edited there.
 */

// The grid: twelve columns, rows of 30px with 16px between.
const ROW = 30
const GAP = 16
// A card's bottom padding and edge, below its last line of content.
const PAD = 17
/*
 * A card is never cut off for want of a few rows: below this height it grows
 * to show all its content even past its saved size. Above it, a long card
 * (who holds what, with every project) scrolls inside itself.
 */
const GROW_TO = 18
/*
 * Arranging, the board snaps to rows of 30px. Reading it, every card is cut
 * to its content to the pixel: the grid runs in 1px rows with no gap between
 * them, and each cell keeps its 16px gap as padding under the card.
 */
const UNIT = ROW + GAP

/*
 * How tall a card's content really is, whatever height the grid gives it:
 * the lowest line of text (or chart) in it, plus the scroll it is hiding.
 * Containers stretch to fill the card, so only the leaves are read.
 */
function contentHeight(section) {
  const top = section.getBoundingClientRect().top
  let bottom = top
  let hidden = 0
  const walk = (el) => {
    for (const c of el.children) {
      const tag = c.tagName.toLowerCase()
      const leaf = tag === 'svg' || !c.children.length
        || [...c.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      if (leaf) {
        const r = c.getBoundingClientRect()
        if (r.height > 0) bottom = Math.max(bottom, r.bottom)
      } else {
        if (c.scrollTop) hidden = Math.max(hidden, c.scrollTop)
        walk(c)
      }
    }
  }
  walk(section)
  return bottom - top + hidden + PAD
}

/*
 * The order cards stack in on a narrow screen: the year, its two figures,
 * what needs a decision, who holds what; then the rest as arranged.
 */
const STACK_FIRST = ['welcome', 'active', 'updated', 'decisions', 'owners', 'teamWeek', 'summary', 'ask', 'headline']
// Small enough to sit two to a row when stacked.
const HALF = new Set(['active', 'updated'])

const known = (items) => (items || []).filter((it) => CARDS[it.type])

export default function Dashboard({
  plan, onGoTo, hello = 'there', aiOn = false, onAsk, onOpenProject, week = null, onWeekChange, planLoading = false,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const stacked = useMediaQuery(theme.breakpoints.down('md'))
  const phone = useMediaQuery(theme.breakpoints.down('sm'))

  /* ---------------------------------------------------------- the data */
  // undefined: still loading; null: not available.
  const [now, setNow] = useState(undefined)
  const [prev, setPrev] = useState(undefined)
  // Each project's Jira work whose timeline covers last week: undefined while
  // it loads, null when Jira cannot say.
  const [prevJira, setPrevJira] = useState(undefined)
  // Why it could not, said on the card rather than quietly showing nothing.
  const [prevJiraError, setPrevJiraError] = useState(null)
  // The same for the week shown: Jira work covering it makes a project active.
  const [nowJira, setNowJira] = useState(undefined)
  const [nowJiraError, setNowJiraError] = useState(null)
  // Keys on the register that Jira does not know, from either week's answer.
  const [unknownKeys, setUnknownKeys] = useState([])
  // The decision just taken, said on the card (it leaves the list).
  const [decided, setDecided] = useState(null)
  // Both undefined while they load, null when they could not be read.
  const [pending, setPending] = useState(undefined)
  // "A decision is needed" raised on a Jira task in somebody's weekly update.
  const [decisions, setDecisions] = useState(undefined)
  const [followups, setFollowups] = useState([])
  // undefined: still loading; null: could not be read.
  const [summary, setSummary] = useState(undefined)
  // Last week's, asked for only when this week has none: undefined while that is pending.
  const [prevSummary, setPrevSummary] = useState(undefined)
  const [trend, setTrend] = useState(null)

  // The week in the top bar: everything below is about it and the one before.
  useEffect(() => {
    let stop = false
    setNow(undefined)
    setPrev(undefined)
    setPrevJira(undefined)
    setPrevJiraError(null)
    setNowJira(undefined)
    setNowJiraError(null)
    setTrend(null)
    setSummary(undefined)
    setPrevSummary(undefined)
    api.loadWeek(week || 'current')
      .then(async (w) => {
        if (stop) return
        setNow(w)
        setUnknownKeys([])
        api.jiraCoverage(w.week)
          .then((r) => {
            if (stop) return
            if (r?.skipped?.length) setUnknownKeys((k) => [...new Set([...k, ...r.skipped])])
            if (r?.jira === 'on') setNowJira(r.byProject || {})
            else {
              setNowJira(null)
              if (r?.jira === 'error') setNowJiraError(r.error || 'Jira could not be read.')
            }
          })
          .catch((e) => { if (!stop) { setNowJira(null); setNowJiraError(e.message) } })
        try { const p = await api.loadWeek(addWeeks(w.week, -1)); if (!stop) setPrev(p) } catch { if (!stop) setPrev(null) }
        api.jiraCoverage(addWeeks(w.week, -1))
          .then((r) => {
            if (stop) return
            if (r?.skipped?.length) setUnknownKeys((k) => [...new Set([...k, ...r.skipped])])
            if (r?.jira === 'on') setPrevJira(r.byProject || {})
            else {
              setPrevJira(null)
              if (r?.jira === 'error') setPrevJiraError(r.error || 'Jira could not be read.')
            }
          })
          .catch((e) => { if (!stop) { setPrevJira(null); setPrevJiraError(e.message) } })
      })
      .catch(() => { if (!stop) { setNow(null); setPrev(null); setPrevJira(null); setNowJira(null) } })
    api.followups(week || 'current').then((r) => { if (!stop) setFollowups(r.followups || []) }).catch(() => {})
    return () => { stop = true }
  }, [week])
  useEffect(() => {
    let stop = false
    api.proposals('pending').then((r) => { if (!stop) setPending(r.proposals || []) }).catch(() => { if (!stop) setPending(null) })
    api.decisions('open').then((r) => { if (!stop) setDecisions(r.decisions || []) }).catch(() => { if (!stop) setDecisions(null) })
    return () => { stop = true }
  }, [])
  useEffect(() => {
    if (!aiOn || !now?.week) return undefined
    let stop = false
    api.aiSummary(now.week)
      .then(async (r) => {
        if (stop) return
        setSummary(r)
        // Nothing written for this week yet: last week's, said as such, rather than a blank card.
        if (!r?.summaries?.length) {
          const p = await api.aiSummary(addWeeks(now.week, -1)).catch(() => null)
          if (!stop) setPrevSummary(p)
        } else setPrevSummary(null)
      })
      .catch(() => { if (!stop) { setSummary(null); setPrevSummary(null) } })
    return () => { stop = true }
  }, [aiOn, now?.week])

  /* -------------------------------------------------------- the layout */
  const [saved, setSaved] = useState(undefined) // { items, updatedBy, updatedAt } | null (no store)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [addAt, setAddAt] = useState(null)
  useEffect(() => {
    api.dashboardLayout().then(setSaved).catch(() => setSaved(null))
  }, [])
  /*
   * The board waits for the shared layout rather than drawing the default and
   * rearranging itself a moment later — but only for a few seconds, so a slow
   * database still gets the default board.
   */
  const [layoutWait, setLayoutWait] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setLayoutWait(false), 3000)
    return () => clearTimeout(t)
  }, [])
  const items = useMemo(
    () => known(editing ? draft : (saved?.items || DEFAULT_LAYOUT)),
    [editing, draft, saved],
  )
  const onBoard = new Set(items.map((it) => it.type))

  // The eight weeks for the trend card, only when that card is on the board.
  const wantsTrend = onBoard.has('trend')
  useEffect(() => {
    if (!wantsTrend || !now || prev === undefined || trend) return
    let stop = false
    Promise.all([2, 3, 4, 5, 6, 7].map((n) => api.loadWeek(addWeeks(now.week, -n)).catch(() => null)))
      .then((rest) => { if (!stop) setTrend([now, prev, ...rest].filter(Boolean)) })
    return () => { stop = true }
  }, [wantsTrend, now, prev, trend])

  /*
   * Arranging starts from the board as it reads: each card at the rows its
   * content took (measured below), up to GROW_TO, so none opens half empty.
   * It can then be dragged taller or shorter as before; a card whose content
   * is shorter than its usual minimum is not made to stand taller than that.
   */
  const fitted = (list) => known(list).map((it) => {
    const px = fit[it.type]
    if (!px) return it
    const rows = Math.ceil(Math.min(Math.max(it.h, GROW_TO) * UNIT, px) / UNIT)
    return { ...it, h: Math.max(2, rows) }
  })
  const startEdit = () => { setDraft(fitted(saved?.items || DEFAULT_LAYOUT)); setEditing(true); setError(null) }
  const cancel = () => { setEditing(false); setDraft(null); setError(null) }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.saveDashboardLayout(draft)
      setSaved(r)
      setEditing(false)
      setDraft(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const remove = useCallback((type) => setDraft((d) => d.filter((it) => it.type !== type)), [])
  const add = (type) => {
    setAddAt(null)
    setDraft((d) => {
      const bottom = d.reduce((a, it) => Math.max(a, it.y + it.h), 0)
      return [...d, { type, x: 0, y: bottom, w: CARDS[type].w, h: CARDS[type].h }]
    })
  }
  const onLayoutChange = (l) => {
    if (!editing) return
    const at = Object.fromEntries(l.map((x) => [x.i, x]))
    setDraft((d) => d.map((it) => (at[it.type] ? {
      ...it, x: at[it.type].x, y: at[it.type].y, w: at[it.type].w, h: at[it.type].h,
    } : it)))
  }

  // The week on screen is this week (and not one picked from the switcher).
  const isCurrent = now ? now.week === now.current : !week
  /*
   * WHAT MAKES A PROJECT ACTIVE, beside its dates: Jira work covering the week,
   * an update sent that week, an open decision. One set of signals for every
   * card, so the tiles, "Who holds what" and the project page agree. An open
   * decision is about now, so it only counts on this week's dashboard.
   */
  const signals = useMemo(() => activitySignals({
    projects: plan.projects,
    week: now || null,
    jira: nowJira || null,
    decisions: isCurrent ? decisions || null : null,
  }), [plan.projects, now, nowJira, decisions, isCurrent])
  // Until each signal has answered (or failed), the counts would change under the reader.
  const signalsReady = now !== undefined && nowJira !== undefined && (!isCurrent || decisions !== undefined)
  const ctx = {
    plan,
    planLoading,
    mode,
    hello,
    now,
    prev,
    prevJira,
    prevJiraError,
    nowJira,
    nowJiraError,
    signals,
    signalsReady,
    unknownKeys,
    isCurrent,
    pending,
    decisions,
    decided,
    onDecide: async (id, note) => {
      const d = (decisions || []).find((x) => x.id === id)
      const r = await api.decide(id, note)
      setDecisions((list) => (list || []).filter((x) => x.id !== id))
      setDecided({ key: d?.jiraKey || '', note, jira: r?.jira || r?.decision?.jira || null, at: Date.now() })
    },
    followups,
    summary,
    prevSummary,
    trend,
    aiOn,
    onAsk,
    onGoTo,
    onOpenProject,
    onFollowSent: (f) => setFollowups((list) => [f, ...list]),
  }
  /* ------------------------------------------------- fit to the content */
  // Rows each card's content needs, measured on the board; capped by its saved height.
  const gridRef = useRef(null)
  const [fit, setFit] = useState({})
  const showBoard = !stacked && !(saved === undefined && layoutWait)
  useLayoutEffect(() => {
    if (!showBoard || editing) return undefined
    const root = gridRef.current
    if (!root) return undefined
    let frame = 0
    const measure = () => {
      frame = 0
      const next = {}
      root.querySelectorAll('[data-card]').forEach((cell) => {
        const sec = cell.querySelector('section')
        if (sec) next[cell.getAttribute('data-card')] = Math.max(64, Math.ceil(contentHeight(sec))) + GAP
      })
      setFit((was) => {
        const keys = Object.keys(next)
        return keys.length === Object.keys(was).length && keys.every((k) => was[k] === next[k]) ? was : next
      })
    }
    const later = () => { if (!frame) frame = requestAnimationFrame(measure) }
    const mo = new MutationObserver(later)
    mo.observe(root, { subtree: true, childList: true, characterData: true })
    const ro = new ResizeObserver(later)
    ro.observe(root)
    later()
    return () => { mo.disconnect(); ro.disconnect(); if (frame) cancelAnimationFrame(frame) }
  }, [showBoard, editing])

  const card = (type) => {
    const { C, title, group } = CARDS[type]
    const f = {
      editing, onRemove: () => remove(type), fill: !stacked, compact: stacked, phone,
    }
    /*
     * Until the shared plan has arrived, the year's figures would be the
     * bundled copy's: numbers that then jump. The shape of the card instead.
     */
    if (planLoading && group === 'The year') {
      return <CardFrame {...f} title={title} label={title}><RowsSkeleton rows={3} label="Loading the shared plan…" /></CardFrame>
    }
    return <C ctx={ctx} f={f} />
  }

  /* -------------------------------------------------------- the header */
  const shownWeek = now?.week || week || weekOf()
  const missing = Object.keys(CARDS).filter((t) => !onBoard.has(t))
  const canArrange = !stacked && saved !== undefined
  const arranged = saved?.updatedBy
    ? `Saved for every administrator; last arranged by ${saved.updatedBy}, ${ago(saved.updatedAt)}.`
    : 'Saved for every administrator; this is the default layout.'
  const viewActions = (
    <>
      <WeekSwitcher week={week} onChange={onWeekChange} compact={phone} />
      {canArrange && (saved === null ? (
        <Tooltip title="The layout cannot be saved while the database is unavailable.">
          <span>
            <Button variant="outlined" startIcon={<EditIcon />} disabled data-edit-layout>Edit layout</Button>
          </span>
        </Tooltip>
      ) : (
        <Button variant="outlined" startIcon={<EditIcon />} onClick={startEdit} data-edit-layout>Edit layout</Button>
      ))}
    </>
  )
  const editActions = (
    <Box
      data-layout-toolbar
      sx={{
        display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
      }}
    >
      <Button variant="text" startIcon={<AddIcon />} onClick={(e) => setAddAt(e.currentTarget)} disabled={!missing.length} aria-haspopup="menu">Add card</Button>
      <Menu anchorEl={addAt} open={!!addAt} onClose={() => setAddAt(null)}>
        {GROUPS.flatMap((g) => {
          const list = missing.filter((t) => CARDS[t].group === g)
          return list.length ? [
            <ListSubheader
              key={`g:${g}`}
              sx={{
                lineHeight: '32px', bgcolor: 'transparent', color: 'text.secondary', fontSize: '0.75rem', fontWeight: 500,
              }}
            >
              {g}
            </ListSubheader>,
            ...list.map((t) => <MenuItem key={t} onClick={() => add(t)}>{CARDS[t].title}</MenuItem>),
          ] : []
        })}
      </Menu>
      <Button variant="text" onClick={() => setDraft(fitted(DEFAULT_LAYOUT))}>Reset to default</Button>
      <Button variant="text" onClick={cancel} disabled={busy}>Cancel</Button>
      <Button
        variant="contained"
        onClick={save}
        disabled={busy}
        data-save-layout
        startIcon={busy ? <Spinner size={14} /> : null}
        sx={{ minWidth: 112 }}
      >
        {busy ? 'Saving…' : 'Save layout'}
      </Button>
    </Box>
  )
  const weekLine = now === undefined
    ? `Week ${weekNo(shownWeek)}`
    : `Week ${weekNo(shownWeek)}, ${weekLabel(shownWeek)}`
  const header = (
    <PageHeader
      title="Dashboard"
      description={editing
        ? `Drag a card to move it, resize it from its corner, or remove it with ×. ${arranged}`
        : weekLine}
      actions={editing ? editActions : viewActions}
    />
  )

  /* ------------------------------------------------- waiting for layout */
  if (saved === undefined && layoutWait) {
    return (
      <Box>
        {header}
        <Box
          role="status"
          aria-label="Loading the dashboard…"
          data-loading
          sx={{
            display: 'grid', gap: 4, gridTemplateColumns: { xs: '1fr', md: 'repeat(12, minmax(0, 1fr))' },
          }}
        >
          {[['a', 6, 180], ['b', 3, 120], ['c', 3, 120], ['d', 12, 320]].map(([k, w, h]) => (
            <Box
              key={k}
              sx={{
                gridColumn: { xs: 'auto', md: `span ${w}` }, height: h, p: 4, bgcolor: 'bg.surface', border: 1, borderColor: 'border.subtle', borderRadius: '8px',
              }}
            >
              <Skeleton variant="text" width={140} height={22} />
              <Skeleton variant="text" width="60%" height={16} sx={{ mt: 1 }} />
              <Skeleton variant="text" width="40%" height={16} sx={{ mt: 1 }} />
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  /* ---------------------------------------------------------- the board */
  if (stacked) {
    const rank = (t) => {
      const i = STACK_FIRST.indexOf(t)
      return i < 0 ? STACK_FIRST.length : i
    }
    const order = [...items].sort((a, b) => rank(a.type) - rank(b.type) || a.y - b.y || a.x - b.x)
    return (
      <Box>
        {header}
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: { xs: 3, sm: 4 } }}>
          {order.map((it) => (
            <Box key={it.type} data-card={it.type} sx={{ minWidth: 0, gridColumn: HALF.has(it.type) ? 'span 1' : 'span 2' }}>
              {card(it.type)}
            </Box>
          ))}
        </Box>
      </Box>
    )
  }

  // Each card's reading height: its content, up to its saved size (or GROW_TO rows).
  const natural = Object.fromEntries(items.map((it) => [it.type,
    fit[it.type] ? Math.min(Math.max(it.h, GROW_TO) * UNIT, fit[it.type]) : it.h * UNIT]))
  /*
   * Cards arranged side by side at the same row and height stay one row: the
   * shorter takes the taller one's height, so the next row starts level. Not
   * when that would leave it more than ~30% empty; it then stays at its
   * content (still top-aligned with its neighbour).
   */
  const level = { ...natural }
  const rows = new Map()
  items.forEach((it) => {
    const k = `${it.y}:${it.h}`
    rows.set(k, [...(rows.get(k) || []), it.type])
  })
  rows.forEach((types) => {
    if (types.length < 2) return
    const tallest = Math.max(...types.map((t) => natural[t]))
    types.forEach((t) => { if (natural[t] >= tallest * 0.7) level[t] = tallest })
  })
  const rgl = items.map((it) => (editing ? {
    i: it.type, x: it.x, y: it.y, w: it.w, h: it.h, minW: CARDS[it.type].minW, minH: Math.min(CARDS[it.type].minH, it.h),
  } : {
    i: it.type,
    x: it.x,
    y: it.y * UNIT,
    w: it.w,
    h: level[it.type],
  }))
  return (
    <Box>
      {header}
      {error && (
        <Box sx={{ mb: 4 }}>
          <ErrorState title="The layout was not saved." body={`${error} Your arrangement is still on screen; try again.`} onRetry={save} />
        </Box>
      )}
      <Box
        ref={gridRef}
        sx={{
          mx: `-${GAP / 2}px`,
          mt: `-${GAP / 2}px`,
          // Cards stand still as their content arrives; they only glide while being arranged.
          '& .react-grid-item': editing ? {} : { transition: 'none', boxSizing: 'border-box', pb: `${GAP}px` },
          '& .react-grid-item.react-grid-placeholder': {
            bgcolor: 'primary.main', opacity: 0.14, borderRadius: '8px',
          },
          '& .react-grid-item > .react-resizable-handle': { zIndex: 4 },
          '& .react-grid-item > .react-resizable-handle::after': {
            borderRightColor: theme.palette.text.secondary, borderBottomColor: theme.palette.text.secondary,
          },
          '& .react-grid-item.resizing, & .react-grid-item.react-draggable-dragging': { zIndex: 5 },
        }}
      >
        <Grid
          layout={rgl}
          cols={12}
          rowHeight={editing ? ROW : 1}
          margin={editing ? [GAP, GAP] : [GAP, 0]}
          containerPadding={[GAP / 2, GAP / 2]}
          isDraggable={editing}
          isResizable={editing}
          draggableHandle={`.${DRAG}`}
          onLayoutChange={onLayoutChange}
          compactType="vertical"
          useCSSTransforms
        >
          {items.map((it) => <div key={it.type} data-card={it.type}>{card(it.type)}</div>)}
        </Grid>
      </Box>
    </Box>
  )
}

// App.jsx asks: the week switcher is drawn in this page's header, not the top bar.
Dashboard.ownsWeekSwitcher = true
