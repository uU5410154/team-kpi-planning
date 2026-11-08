import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box, Button, Typography, Menu, MenuItem, ListSubheader, Alert, useMediaQuery, CircularProgress,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'
import EditIcon from '@mui/icons-material/DashboardCustomizeOutlined'
import AddIcon from '@mui/icons-material/Add'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import * as api from '../lib/api.js'
import { addWeeks } from '../lib/weekly.js'
import { CARDS, DEFAULT_LAYOUT, GROUPS } from '../dashboard/cards.js'
import { activitySignals } from '../lib/manager.js'
import CardFrame, { DRAG } from '../dashboard/CardFrame.jsx'
import { ago } from '../components/FollowUp.jsx'
import Loading from '../components/Loading.jsx'

const Grid = WidthProvider(GridLayout)

/**
 * THE MANAGER DASHBOARD.
 *
 * A board of cards: what is active and what has been updated this week, who
 * holds which project and where it stands, the weekly check-in, and the year
 * against its target. An administrator arranges it — adds and removes cards,
 * drags and resizes them — and saves; every administrator then sees that
 * arrangement. Until somebody saves one, everybody sees the default.
 *
 * On a narrow screen the cards stack in the board's order at their natural
 * height, and the board cannot be edited there.
 */

const known = (items) => (items || []).filter((it) => CARDS[it.type])

export default function Dashboard({
  plan, onGoTo, hello = 'there', aiOn = false, onAsk, onOpenProject, week = null, planLoading = false,
}) {
  const theme = useTheme()
  const mode = theme.palette.mode === 'dark' ? 'dark' : 'light'
  const stacked = useMediaQuery(theme.breakpoints.down('md'))

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

  const startEdit = () => { setDraft(known(saved?.items || DEFAULT_LAYOUT)); setEditing(true); setError(null) }
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
  if (saved === undefined && layoutWait) return <Loading variant="block" label="Loading the dashboard…" />
  const card = (type) => {
    const { C, title, group } = CARDS[type]
    const f = { editing, onRemove: () => remove(type), fill: !stacked }
    /*
     * Until the shared plan has arrived, the year's figures would be the
     * bundled copy's — numbers that then jump. A spinner instead.
     */
    if (planLoading && group === 'The year') {
      return <CardFrame {...f} title={title} label={title}><Loading variant="block" label="Loading the shared plan…" /></CardFrame>
    }
    return <C ctx={ctx} f={f} />
  }

  /* ------------------------------------------------------- the toolbar */
  const missing = Object.keys(CARDS).filter((t) => !onBoard.has(t))
  const toolbar = !stacked && saved !== undefined && (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end',
    }}
    >
      {!editing && (
        <>
          <Typography variant="caption" sx={{ color: 'text.secondary', mr: 'auto' }}>
            {saved === null
              ? 'The layout cannot be saved while the database is unavailable.'
              : saved.updatedBy ? `Layout arranged by ${saved.updatedBy}, ${ago(saved.updatedAt)} — the same for every administrator.`
                : 'The default layout — the same for every administrator.'}
          </Typography>
          {saved !== null && (
            <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={startEdit} sx={{ color: 'text.primary', borderColor: 'divider' }}>
              Edit layout
            </Button>
          )}
        </>
      )}
      {editing && (
        <>
          <Typography variant="caption" sx={{ color: 'text.secondary', mr: 'auto' }}>
            Drag a card by its title bar, resize it from its bottom-right corner, remove it with ×. Saved for every administrator.
          </Typography>
          <Button size="small" startIcon={<AddIcon />} onClick={(e) => setAddAt(e.currentTarget)} disabled={!missing.length}>Add card</Button>
          <Menu anchorEl={addAt} open={!!addAt} onClose={() => setAddAt(null)}>
            {GROUPS.flatMap((g) => {
              const list = missing.filter((t) => CARDS[t].group === g)
              return list.length ? [
                <ListSubheader key={`g:${g}`} sx={{ lineHeight: '32px' }}>{g}</ListSubheader>,
                ...list.map((t) => <MenuItem key={t} onClick={() => add(t)}>{CARDS[t].title}</MenuItem>),
              ] : []
            })}
          </Menu>
          <Button size="small" onClick={() => setDraft(known(DEFAULT_LAYOUT))}>Reset to default</Button>
          <Button size="small" onClick={cancel}>Cancel</Button>
          <Button size="small" variant="contained" onClick={save} disabled={busy} startIcon={busy ? <CircularProgress size={14} /> : null}>
            Save layout
          </Button>
        </>
      )}
    </Box>
  )

  /* ---------------------------------------------------------- the board */
  if (stacked) {
    const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x)
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {order.map((it) => <Box key={it.type} sx={{ minWidth: 0 }}>{card(it.type)}</Box>)}
      </Box>
    )
  }

  const rgl = items.map((it) => ({
    i: it.type, x: it.x, y: it.y, w: it.w, h: it.h, minW: CARDS[it.type].minW, minH: CARDS[it.type].minH,
  }))
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {toolbar}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Box sx={{
        mx: -1,
        '& .react-grid-item.react-grid-placeholder': {
          bgcolor: alpha(theme.palette.primary.main, 0.18), borderRadius: '16px', opacity: 1,
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
          rowHeight={30}
          margin={[16, 16]}
          containerPadding={[8, 0]}
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
