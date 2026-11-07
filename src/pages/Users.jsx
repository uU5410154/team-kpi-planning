import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl,
  IconButton, InputLabel, ListItemIcon, ListItemText, Menu, MenuItem, Select, Skeleton, Snackbar, Tab,
  Table, TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import PersonOutlineIcon from '@mui/icons-material/PersonOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import TuneIcon from '@mui/icons-material/Tune'
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOffOutlined'
import * as auth from '../lib/authApi.js'
import * as api from '../lib/api.js'
import { Spinner } from '../components/Loading.jsx'
import {
  EmptyState, ErrorState, PageHeader, Section, StatusPill,
} from '../components/ui.jsx'
import { defaultSubmitters } from '../lib/weekly.js'
import MailSettings from '../components/MailSettings.jsx'
import AiSettings from '../components/AiSettings.jsx'

const ROLE_LABEL = { admin: 'Administrator', user: 'Team member' }
const STATUS = {
  active: { label: 'Active', tone: 'success' },
  pending: { label: 'Waiting', tone: 'warning' },
  inactive: { label: 'Switched off', tone: 'neutral' },
}

/* The sections the tab row jumps between, in page order. */
const PARTS = [
  { id: 'access-people', label: 'People' },
  { id: 'access-weekly', label: 'Weekly check-in' },
  { id: 'access-ai', label: 'AI' },
]

/* "7 Nov 2026, 19:37", Bangkok time, whatever the browser's locale. */
const dateTime = (iso) => new Date(iso).toLocaleString('en-GB', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
})

/* "7 Nov 2026": when somebody registered, the time of day is noise. */
const dateOnly = (iso) => new Date(iso).toLocaleDateString('en-GB', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
})

/*
 * A select that reads as plain text in its row: no edge at rest, a quiet
 * edge when the row is hovered, the blue edge when it has focus. The text
 * lines up with the column heading above it.
 */
const inlineSelect = (t) => ({
  ml: '-8px',
  width: 'calc(100% + 8px)',
  fontSize: '0.875rem',
  backgroundColor: 'transparent',
  '& .MuiSelect-select': {
    py: '6px', pl: '8px', pr: '28px !important', minHeight: 0, display: 'flex', alignItems: 'center',
  },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
  '.MuiTableRow-root:hover & .MuiOutlinedInput-notchedOutline': { borderColor: t.palette.border.strong },
  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: t.palette.primary.main },
  '&.Mui-disabled .MuiSelect-icon': { display: 'none' },
})

/*
 * Who may open this app, and what each of them can see.
 *
 * Registering puts somebody in this list and nowhere else. Everything that
 * follows (the role, whether the account works at all) is decided here, by a
 * person, which is the point: a work address proves employment, not that
 * somebody should see what their colleagues are appraised on.
 */
export default function Users({ me, people = [], onToast }) {
  const phone = useMediaQuery((t) => t.breakpoints.down('sm'))
  const [rows, setRows] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [shown, setShown] = useState(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [reset, setReset] = useState(null)
  const [editing, setEditing] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [localToast, setLocalToast] = useState(null)
  const toast = useCallback((t) => (onToast ? onToast(t) : setLocalToast(t)), [onToast])

  /*
   * The team, as the weekly check-in knows it: the people who hold a
   * scorecard. IT and the business users are assignable in the register but
   * are not anybody's login.
   */
  const team = people.filter((p) => defaultSubmitters([p]).length)
  // undefined while it loads, null when it could not be read.
  const [weekly, setWeekly] = useState(undefined)

  const load = useCallback(async () => {
    try {
      const [users, ws] = await Promise.all([auth.listUsers(), api.weeklySettings().catch(() => null)])
      setRows(users)
      setWeekly(ws)
      setLoadError(null)
    } catch (e) {
      setLoadError(e.message)
      setWeekly((w) => (w === undefined ? null : w))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    setReloadKey((k) => k + 1)
    try { await load() } finally { setRefreshing(false) }
  }

  const toggleSubmitter = async (id) => {
    if (!weekly) return
    const next = weekly.submitters.includes(id)
      ? weekly.submitters.filter((x) => x !== id)
      : [...weekly.submitters, id]
    setBusy(`weekly:${id}`)
    try {
      setWeekly({ ...weekly, ...(await api.saveWeeklySettings(next)) })
    } catch (e) {
      toast({ severity: 'error', msg: `The submit list was not saved: ${e.message}` })
    } finally {
      setBusy(null)
    }
  }

  const patch = async (email, body, done) => {
    setBusy(email)
    try {
      await auth.updateUser(email, body)
      await load()
      if (done) toast({ severity: 'success', msg: done })
      return true
    } catch (e) {
      toast({ severity: 'error', msg: e.message })
      return false
    } finally {
      setBusy(null)
    }
  }

  const approve = async (list) => {
    for (const u of list) {
      // One at a time, so a refusal names the account it was about.
      const ok = await patch(u.email, { status: 'active' })
      if (!ok) return
    }
    toast({ severity: 'success', msg: list.length === 1 ? `${list[0].email} approved` : `${list.length} accounts approved` })
  }

  const remove = async (email) => {
    setConfirmDelete(null)
    setBusy(email)
    try {
      await auth.deleteUser(email)
      await load()
      toast({ severity: 'success', msg: `${email} deleted` })
    } catch (e) {
      toast({ severity: 'error', msg: e.message })
    } finally {
      setBusy(null)
    }
  }

  const toggleShown = (email) => setShown((s) => {
    const n = new Set(s)
    if (n.has(email)) n.delete(email); else n.add(email)
    return n
  })

  const pending = (rows || []).filter((u) => u.status === 'pending')
  const editRow = editing && (rows || []).find((u) => u.email === editing)

  const rowProps = {
    me, team, rows: rows || [], busy, shown, patch, toggleShown, setReset, setConfirmDelete,
  }

  const refreshButton = (
    <Tooltip title="Refresh">
      <span>
        <IconButton aria-label="Refresh" onClick={refresh} disabled={refreshing} sx={{ width: { xs: 40, sm: 32 }, height: { xs: 40, sm: 32 } }}>
          {refreshing ? <Spinner size={16} /> : <RefreshIcon fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
  )

  return (
    <Box>
      <PageHeader
        title="Access"
        description="Who can open the app, what they see, and who gets weekly reminders."
        help={<AccessHelp />}
        actions={phone ? null : refreshButton}
      />

      <JumpTabs counts={{ 'access-people': rows ? rows.length : null }} end={phone ? refreshButton : null} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 }, mt: { xs: 3, sm: 4 } }}>
        <Section
          id="access-people"
          title="People"
          meta="Link each account to its person, so the weekly check-in opens the right week."
          padded={false}
          sx={{ scrollMarginTop: { xs: 104, sm: 112 } }}
          data-access-people
        >
          {pending.length > 0 && (
            <Box sx={{ px: { xs: 3, sm: 4 }, py: 3 }}>
              <Alert
                severity="warning"
                data-access-pending
                action={(
                  <Tooltip title="Switches the account on as a team member. Change the role in the table if needed.">
                    <span>
                      <Button
                        variant="outlined"
                        color="inherit"
                        onClick={() => approve(pending)}
                        disabled={!!busy}
                        sx={{ color: 'text.primary', whiteSpace: 'nowrap' }}
                      >
                        {pending.length === 1 ? 'Approve' : `Approve all ${pending.length}`}
                      </Button>
                    </span>
                  </Tooltip>
                )}
              >
                <Box component="span" sx={{ color: 'text.primary' }}>
                  {pending.length === 1
                    ? <><strong>{pending[0].email}</strong> is waiting for approval and cannot sign in yet.</>
                    : <>{pending.length} accounts are waiting for approval: <strong>{pending.map((u) => u.email).join(', ')}</strong>.</>}
                </Box>
              </Alert>
            </Box>
          )}

          {rows === null && loadError && (
            <Box sx={{ px: { xs: 3, sm: 4 }, pb: 4 }}>
              <ErrorState
                title="The accounts did not load."
                body={`${loadError} Check your connection and try again.`}
                onRetry={refresh}
              />
            </Box>
          )}
          {rows === null && !loadError && <TableSkeleton phone={phone} />}
          {rows && rows.length === 0 && (
            <EmptyState
              icon={PersonOutlineIcon}
              title="Nobody has registered yet."
              body="People register on the sign-in page with their work email, then appear here for you to approve."
            />
          )}
          {rows && rows.length > 0 && (phone ? (
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {rows.map((u) => (
                <PhoneUserRow
                  key={u.email}
                  u={u}
                  {...rowProps}
                  onOpen={() => setEditing(u.email)}
                />
              ))}
            </Box>
          ) : (
            <HScroll>
              <Table sx={{ minWidth: 990, tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 170 }} />
                  <col style={{ width: 128 }} />
                  <col style={{ width: 152 }} />
                  <col style={{ width: 108 }} />
                  <col style={{ width: 152 }} />
                  <col style={{ width: 104 }} />
                  <col style={{ width: 144 }} />
                  <col style={{ width: 40 }} />
                </colgroup>
                <TableHead>
                  <TableRow>
                    <TableCell sx={stickyHead}>Email</TableCell>
                    <TableCell>Person</TableCell>
                    <TableCell>Role</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Password</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Registered</TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>Last signed in</TableCell>
                    <TableCell aria-label="Actions" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((u) => <UserRow key={u.email} u={u} {...rowProps} />)}
                </TableBody>
              </Table>
            </HScroll>
          ))}
        </Section>

        <Box
          id="access-weekly"
          sx={{
            display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 }, scrollMarginTop: { xs: 104, sm: 112 },
          }}
        >
          <Section
            title="Weekly check-in: who has to submit"
            meta="Ticked people send a plan every Monday and a report every Friday, and get the reminders."
            data-access-submitters
          >
            {weekly === undefined && <SubmitterSkeleton />}
            {weekly === null && (
              <ErrorState
                title="The submit list did not load."
                body="Nothing has changed on it. Try again in a moment."
                onRetry={refresh}
              />
            )}
            {weekly && (
              <>
                <Box
                  component="ul"
                  sx={{
                    listStyle: 'none',
                    m: 0,
                    p: 0,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(220px, 1fr))' },
                    columnGap: 4,
                    rowGap: 1,
                  }}
                >
                  {team.map((p) => {
                    const on = weekly.submitters.includes(p.id)
                    const linked = (rows || []).find((x) => x.person === p.id)
                    const saving = busy === `weekly:${p.id}`
                    return (
                      <Box component="li" key={p.id} sx={{ minWidth: 0 }}>
                        <Box
                          component="label"
                          sx={{
                            display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0, cursor: saving ? 'default' : 'pointer',
                          }}
                        >
                          <Checkbox
                            checked={on}
                            disabled={saving}
                            onChange={() => toggleSubmitter(p.id)}
                            inputProps={{ 'aria-label': `${p.nick} has to submit` }}
                            sx={{ p: 2, m: -1, mr: 0 }}
                          />
                          <Box sx={{ minWidth: 0, py: 1 }}>
                            <Typography variant="body1" sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                              {p.nick}
                              {saving && <Spinner size={12} />}
                            </Typography>
                            <Typography variant="body2" noWrap sx={{ color: linked ? 'text.secondary' : 'text.tertiary' }} title={linked?.email}>
                              {linked ? linked.email : 'No account linked, so not reminded'}
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
                {weekly.isDefault && (
                  <Typography variant="caption" component="p" sx={{ color: 'text.tertiary', mt: 3, mb: 0 }}>
                    Nobody has changed this list yet, so it is everybody with a scorecard.
                  </Typography>
                )}
              </>
            )}
          </Section>

          <MailSettings weekly={weekly} onWeekly={(w) => setWeekly((cur) => ({ ...cur, ...w }))} reloadKey={reloadKey} />
        </Box>

        <Box id="access-ai" sx={{ scrollMarginTop: { xs: 104, sm: 112 } }}>
          <AiSettings reloadKey={reloadKey} />
        </Box>
      </Box>

      {/* A phone edits one account at a time, in a sheet. */}
      <Dialog open={!!editRow} onClose={() => setEditing(null)} fullScreen={phone} fullWidth maxWidth="xs">
        {editRow && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 2, pr: 2 }}>
              <Box component="span" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{editRow.email}</Box>
              <IconButton aria-label="Close" onClick={() => setEditing(null)} sx={{ width: 40, height: 40 }}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 4, pt: '8px !important' }}>
              <AccountFields u={editRow} {...rowProps} />
            </DialogContent>
            <DialogActions>
              <Button variant="contained" onClick={() => setEditing(null)}>Done</Button>
            </DialogActions>
          </>
        )}
      </Dialog>

      <Dialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)} fullScreen={phone} fullWidth maxWidth="xs">
        <DialogTitle>Delete this account?</DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
            <strong>{confirmDelete}</strong> is removed and can register again from scratch.
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
            Nothing they entered in the plan changes: the register does not belong to an account.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => remove(confirmDelete)}>Delete account</Button>
        </DialogActions>
      </Dialog>

      <SetPasswordDialog
        reset={reset}
        phone={phone}
        onClose={() => setReset(null)}
        onSave={async (email, value) => {
          setReset(null)
          await patch(email, { password: value }, `New password set for ${email}`)
        }}
      />

      {!onToast && (
        <Snackbar
          open={!!localToast}
          autoHideDuration={localToast?.severity === 'error' ? null : 4000}
          onClose={(_e, why) => { if (why !== 'clickaway') setLocalToast(null) }}
          anchorOrigin={{ vertical: 'bottom', horizontal: phone ? 'center' : 'left' }}
          sx={phone ? undefined : { left: { sm: `${(document.querySelector('main')?.getBoundingClientRect().left || 0) + 24}px` } }}
        >
          {localToast ? (
            <Alert severity={localToast.severity} variant="filled" onClose={() => setLocalToast(null)} sx={{ minWidth: { sm: 320 }, maxWidth: 520 }}>
              {localToast.msg}
            </Alert>
          ) : undefined}
        </Snackbar>
      )}
    </Box>
  )
}

/* ------------------------------------------------------------------ */

function AccessHelp() {
  const h = { color: 'text.primary', fontWeight: 600, mb: 1 }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box>
        <Typography variant="h3" sx={h}>Who sees what</Typography>
        <p>
          Registering adds somebody to this list and does nothing else. You decide whether the account works and
          what it can see.
        </p>
        <p>
          A <strong>team member</strong> gets their weekly check-in, their scorecard, the timeline and the apps. An
          <strong> administrator</strong> gets everything, including the register, the scorecards and this page.
        </p>
      </Box>
      <Box>
        <Typography variant="h3" sx={h}>Weekly reminders</Typography>
        <p>
          Reminders go to the account linked to each person on the submit list. Somebody with no linked account
          cannot be reminded and is named in the 23:00 email instead. Times are Bangkok time, with no exceptions
          for leave.
        </p>
      </Box>
      <Box>
        <Typography variant="h3" sx={h}>About the passwords</Typography>
        <p>
          Each password is stored twice: as a one-way hash, which is all a sign-in is checked against, and as an
          encrypted copy, which is what the Password column reads. The key lives in the server&rsquo;s environment,
          never in the database, so a copy of the database alone gives up no passwords.
        </p>
        <p>
          Anybody holding both the database and the server&rsquo;s environment could read every password, and people
          reuse passwords. If reading them stops being useful, the encrypted copy can be dropped and sign-in carries
          on unchanged.
        </p>
      </Box>
    </Box>
  )
}

/*
 * The row of tabs under the header: each jumps to its part of the page, and
 * the one in view is underlined as you scroll.
 */
function JumpTabs({ counts = {}, end = null }) {
  const [active, setActive] = useState(PARTS[0].id)
  const lock = useRef(0)

  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < lock.current) return
      const line = 140
      let cur = PARTS[0].id
      for (const p of PARTS) {
        const el = document.getElementById(p.id)
        if (el && el.getBoundingClientRect().top <= line) cur = p.id
      }
      // At the very bottom the last part is the one being read, however short.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = PARTS[PARTS.length - 1].id
      setActive(cur)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const go = (_e, id) => {
    setActive(id)
    lock.current = Date.now() + 700
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  return (
    <Box
      component="nav"
      aria-label="Parts of this page"
      sx={{
        position: 'sticky',
        top: { xs: 52, sm: 56 },
        zIndex: 2,
        bgcolor: 'bg.page',
        borderBottom: 1,
        borderColor: 'border.subtle',
        mt: { xs: -1, sm: -1 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Tabs value={active} onChange={go} variant="scrollable" scrollButtons={false} aria-label="Parts of this page" sx={{ flex: 1, minWidth: 0 }}>
        {PARTS.map((p) => (
          <Tab
            key={p.id}
            value={p.id}
            sx={{ px: 0, mr: 6 }}
            label={(
              <Box component="span" sx={{ display: 'inline-flex', gap: 1.5 }}>
                {p.label}
                {counts[p.id] != null && <Box component="span" sx={{ color: 'text.tertiary', fontWeight: 400 }}>{counts[p.id]}</Box>}
              </Box>
            )}
          />
        ))}
      </Tabs>
      {end}
      </Box>
    </Box>
  )
}

/*
 * Sideways scroll inside the section, never the page. The email stays put
 * on the left, and a short fade says there is more to the right.
 */
function HScroll({ children }) {
  const ref = useRef(null)
  const [edge, setEdge] = useState({ left: false, right: false })
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdge({ left: el.scrollLeft > 0, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
  }, [])
  useLayoutEffect(() => {
    update()
    const ro = new ResizeObserver(update)
    if (ref.current) {
      ro.observe(ref.current)
      if (ref.current.firstElementChild) ro.observe(ref.current.firstElementChild)
    }
    return () => ro.disconnect()
  }, [update])
  return (
    <Box sx={{ position: 'relative' }} data-scrolled={edge.left || undefined}>
      <Box
        ref={ref}
        onScroll={update}
        sx={(t) => ({
          overflowX: 'auto',
          '& .sticky-col': { boxShadow: edge.left ? `1px 0 0 ${t.palette.border.subtle}` : 'none' },
          '& .MuiTableRow-root:last-of-type .MuiTableCell-body': { borderBottom: 0 },
        })}
      >
        {children}
      </Box>
      {edge.right && (
        <Box
          aria-hidden
          sx={(t) => ({
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            width: 12,
            pointerEvents: 'none',
            background: `linear-gradient(to right, transparent, ${t.palette.bg.surface})`,
          })}
        />
      )}
    </Box>
  )
}

const stickyHead = {
  position: 'sticky', left: 0, zIndex: 2, bgcolor: 'bg.subtle',
}
const stickyBody = {
  position: 'sticky',
  left: 0,
  zIndex: 1,
  bgcolor: 'bg.surface',
  '.MuiTableRow-hover:hover > &': { bgcolor: 'bg.subtle' },
}

function TableSkeleton({ phone }) {
  const W = ['58%', '46%', '64%', '40%', '52%']
  return (
    <Box role="status" aria-label="Loading accounts…" data-loading>
      {!phone && <Box sx={{ height: 36, bgcolor: 'bg.subtle', borderBottom: 1, borderColor: 'border.subtle' }} />}
      {W.map((w, i) => (
        <Box
          key={w}
          sx={{
            height: phone ? 64 : 44,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            px: phone ? 3 : 3,
            borderTop: i ? 1 : 0,
            borderColor: 'border.subtle',
          }}
        >
          <Skeleton variant="text" height={16} sx={{ flex: `0 0 ${phone ? w : '200px'}` }} />
          {!phone && (
            <>
              <Skeleton variant="text" height={16} width={80} />
              <Skeleton variant="text" height={16} width={100} />
              <Skeleton variant="rounded" height={20} width={56} />
              <Box sx={{ flex: 1 }} />
              <Skeleton variant="text" height={16} width={120} />
            </>
          )}
          {phone && <><Box sx={{ flex: 1 }} /><Skeleton variant="rounded" height={20} width={52} /></>}
        </Box>
      ))}
    </Box>
  )
}

function SubmitterSkeleton() {
  return (
    <Box
      role="status"
      aria-label="Loading the submit list…"
      data-loading
      sx={{
        display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(220px, 1fr))' }, columnGap: 4, rowGap: 3,
      }}
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Box key={i} sx={{ display: 'flex', gap: 3, alignItems: 'flex-start' }}>
          <Skeleton variant="rounded" width={18} height={18} sx={{ mt: 0.5 }} />
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width={70} height={18} />
            <Skeleton variant="text" width="70%" height={16} />
          </Box>
        </Box>
      ))}
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* One account: a table row on a computer, a list row on a phone.        */
/* ------------------------------------------------------------------ */

function PersonSelect({
  u, team, rows, busy, patch, sx, label,
}) {
  return (
    <Select
      size="small"
      fullWidth
      displayEmpty
      label={label}
      value={u.person || ''}
      disabled={busy === u.email}
      onChange={(e) => patch(u.email, { person: e.target.value || null })}
      sx={sx}
      SelectDisplayProps={{ 'aria-label': `team member for ${u.email}` }}
      renderValue={(v) => {
        const p = team.find((x) => x.id === v)
        if (!v) return <Box component="span" sx={{ color: 'text.tertiary' }}>Not linked</Box>
        return p ? p.nick : v
      }}
    >
      <MenuItem value=""><Box component="span" sx={{ color: 'text.secondary' }}>Not linked</Box></MenuItem>
      {team.map((p) => {
        const taken = rows.find((x) => x.person === p.id && x.email !== u.email)
        return (
          <MenuItem key={p.id} value={p.id} disabled={!!taken}>
            {p.nick}
            {taken && <Box component="span" sx={{ color: 'text.tertiary', ml: 2 }}>{`linked to ${taken.email.split('@')[0]}`}</Box>}
          </MenuItem>
        )
      })}
    </Select>
  )
}

function RoleSelect({
  u, busy, patch, sx, label,
}) {
  return (
    <Select
      size="small"
      fullWidth
      label={label}
      value={u.role}
      disabled={busy === u.email}
      onChange={(e) => patch(u.email, { role: e.target.value })}
      sx={sx}
      SelectDisplayProps={{ 'aria-label': `role for ${u.email}` }}
    >
      {Object.entries(ROLE_LABEL).map(([id, l]) => <MenuItem key={id} value={id}>{l}</MenuItem>)}
    </Select>
  )
}

function StatusSelect({
  u, busy, patch, sx, label,
}) {
  return (
    <Select
      size="small"
      fullWidth
      label={label}
      value={u.status}
      disabled={busy === u.email}
      onChange={(e) => patch(u.email, { status: e.target.value })}
      sx={sx}
      SelectDisplayProps={{ 'aria-label': `status for ${u.email}` }}
      renderValue={(v) => <StatusPill tone={STATUS[v]?.tone || 'neutral'}>{STATUS[v]?.label || v}</StatusPill>}
    >
      {Object.entries(STATUS).map(([id, s]) => <MenuItem key={id} value={id}>{s.label}</MenuItem>)}
    </Select>
  )
}

function PasswordCell({
  u, shown, toggleShown, setReset,
}) {
  const open = shown.has(u.email)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      {/*
        * Hidden until asked for. It is on screen for whoever walks past
        * otherwise, and this is the one screen in the app where that matters.
        */}
      <Box
        component="span"
        sx={{
          flex: open ? '0 1 auto' : '0 0 auto',
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: open && !u.password ? 'text.tertiary' : 'text.primary',
        }}
        title={open && u.password ? u.password : undefined}
      >
        {open ? (u.password || 'Not readable') : '••••••••'}
      </Box>
      <Tooltip title={open ? 'Hide password' : 'Show password'}>
        <IconButton
          onClick={() => toggleShown(u.email)}
          aria-label={`${open ? 'hide' : 'show'} password for ${u.email}`}
          sx={{ width: { xs: 40, sm: 28 }, height: { xs: 40, sm: 28 }, color: 'text.secondary' }}
        >
          {open ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Tooltip>
      <Button
        variant="text"
        onClick={() => setReset({ email: u.email, value: '' })}
        aria-label={`Set a new password for ${u.email}`}
        sx={{ minWidth: 0, px: 1.5 }}
      >
        Set
      </Button>
    </Box>
  )
}

function UserRow(props) {
  const {
    u, me, busy, setConfirmDelete,
  } = props
  const isMe = u.email === me?.email
  return (
    <TableRow hover data-user-row={u.email}>
      <TableCell className="sticky-col" sx={stickyBody}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 }}>
          <Tooltip title={u.email} placement="top-start" disableInteractive>
            <Box component="span" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {u.email}
            </Box>
          </Tooltip>
          {isMe && <StatusPill tone="neutral">You</StatusPill>}
          {busy === u.email && <Spinner size={12} />}
        </Box>
      </TableCell>
      <TableCell>
        {/*
          * Which person on the team this login is. The weekly check-in needs
          * it to know whose week to open, and the reminders whom to chase.
          */}
        <PersonSelect {...props} sx={inlineSelect} />
      </TableCell>
      <TableCell><RoleSelect {...props} sx={inlineSelect} /></TableCell>
      <TableCell><StatusSelect {...props} sx={inlineSelect} /></TableCell>
      <TableCell><PasswordCell {...props} /></TableCell>
      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }} title={u.createdAt ? dateTime(u.createdAt) : undefined}>
        {u.createdAt ? dateOnly(u.createdAt) : <Box component="span" sx={{ color: 'text.tertiary' }}>–</Box>}
      </TableCell>
      <TableCell sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {u.lastLoginAt ? dateTime(u.lastLoginAt) : <Box component="span" sx={{ color: 'text.tertiary' }}>Never</Box>}
      </TableCell>
      <TableCell sx={{ px: 0.5, textAlign: 'right' }}>
        <Tooltip title={isMe ? 'You cannot delete your own account' : 'Delete this account'}>
          <span>
            <IconButton
              disabled={isMe || busy === u.email}
              onClick={() => setConfirmDelete(u.email)}
              aria-label={`delete ${u.email}`}
              sx={{ width: 32, height: 32, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
            >
              <DeleteOutlineIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </TableCell>
    </TableRow>
  )
}

function PhoneUserRow(props) {
  const {
    u, me, team, busy, onOpen, shown, toggleShown, setReset, setConfirmDelete,
  } = props
  const [menu, setMenu] = useState(null)
  const isMe = u.email === me?.email
  const person = team.find((p) => p.id === u.person)
  const st = STATUS[u.status] || STATUS.inactive
  return (
    <Box
      component="li"
      data-user-row={u.email}
      sx={{
        display: 'flex', alignItems: 'center', gap: 2, pl: 3, pr: 1, minHeight: 64, borderBottom: 1, borderColor: 'border.subtle',
        '&:last-of-type': { borderBottom: 0 },
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        aria-label={`Edit access for ${u.email}`}
        sx={{
          flex: 1, minWidth: 0, py: 2.5, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body1" noWrap sx={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</Box>
            {isMe && <StatusPill tone="neutral">You</StatusPill>}
          </Typography>
          <Typography variant="body2" noWrap sx={{ color: 'text.secondary', mt: 0.5 }}>
            {ROLE_LABEL[u.role] || u.role}
            {', '}
            {person ? person.nick : 'not linked'}
            {shown.has(u.email) && `, password ${u.password || 'not readable'}`}
          </Typography>
        </Box>
        {busy === u.email ? <Spinner size={14} /> : <StatusPill tone={st.tone}>{st.label}</StatusPill>}
      </Box>
      <IconButton aria-label={`More for ${u.email}`} onClick={(e) => setMenu(e.currentTarget)} sx={{ width: 40, height: 40, color: 'text.secondary' }}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <MenuItem onClick={() => { setMenu(null); onOpen() }}>
          <ListItemIcon><TuneIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Edit access" />
        </MenuItem>
        <MenuItem onClick={() => { setMenu(null); toggleShown(u.email) }} aria-label={`${shown.has(u.email) ? 'hide' : 'show'} password for ${u.email}`}>
          <ListItemIcon>{shown.has(u.email) ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}</ListItemIcon>
          <ListItemText primary={shown.has(u.email) ? 'Hide password' : 'Show password'} />
        </MenuItem>
        <MenuItem onClick={() => { setMenu(null); setReset({ email: u.email, value: '' }) }}>
          <ListItemIcon><KeyOutlinedIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="Set a new password" />
        </MenuItem>
        <Divider />
        <MenuItem disabled={isMe} onClick={() => { setMenu(null); setConfirmDelete(u.email) }} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}><DeleteOutlineIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary={isMe ? 'You cannot delete your own account' : 'Delete account'} />
        </MenuItem>
      </Menu>
    </Box>
  )
}

/* The same three choices as the table's, as ordinary labelled fields. */
function AccountFields(props) {
  const { u, me, setConfirmDelete } = props
  const isMe = u.email === me?.email
  const field = (id, label, Comp) => (
    <FormControl fullWidth size="small">
      <InputLabel id={`${id}-${u.email}`} shrink>{label}</InputLabel>
      <Comp {...props} label={label} sx={{ '& .MuiSelect-select': { minHeight: 20 } }} />
    </FormControl>
  )
  return (
    <>
      {field('person', 'Person', PersonSelect)}
      {field('role', 'Role', RoleSelect)}
      {field('status', 'Status', StatusSelect)}
      <Box>
        <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mb: 1 }}>Password</Typography>
        <PasswordCell {...props} />
      </Box>
      <Box>
        <Typography variant="body2" component="div" sx={{ color: 'text.secondary' }}>
          {`Registered ${u.createdAt ? dateTime(u.createdAt) : '–'}. Last signed in ${u.lastLoginAt ? dateTime(u.lastLoginAt) : 'never'}.`}
        </Typography>
      </Box>
      <Divider />
      <Box>
        <Button
          color="error"
          variant="text"
          startIcon={<DeleteOutlineIcon />}
          disabled={isMe}
          onClick={() => setConfirmDelete(u.email)}
          sx={{ ml: -2 }}
        >
          Delete account
        </Button>
        {isMe && <Typography variant="caption" component="div" sx={{ color: 'text.tertiary' }}>You cannot delete your own account.</Typography>}
      </Box>
    </>
  )
}

function SetPasswordDialog({
  reset, phone, onClose, onSave,
}) {
  const [value, setValue] = useState('')
  const [tried, setTried] = useState(false)
  const [show, setShow] = useState(true)
  useEffect(() => { if (reset) { setValue(''); setTried(false); setShow(true) } }, [reset])
  const short = value.length < 8
  const submit = (e) => {
    e?.preventDefault?.()
    setTried(true)
    if (short) return
    onSave(reset.email, value)
  }
  return (
    <Dialog open={!!reset} onClose={onClose} fullScreen={phone} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={submit} noValidate sx={{ display: 'contents' }}>
        <DialogTitle>Set a new password</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4, overflowWrap: 'anywhere' }}>
            {`For ${reset?.email || ''}. They are not emailed, so tell them yourself.`}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="New password"
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            error={tried && short}
            helperText={tried && short ? 'Use at least 8 characters.' : 'At least 8 characters.'}
            autoFocus
            autoComplete="new-password"
            InputProps={{
              endAdornment: (
                <Tooltip title={show ? 'Hide password' : 'Show password'}>
                  <IconButton onClick={() => setShow((v) => !v)} edge="end" aria-label={show ? 'hide new password' : 'show new password'} sx={{ width: 32, height: 32 }}>
                    {show ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                  </IconButton>
                </Tooltip>
              ),
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">Set password</Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
