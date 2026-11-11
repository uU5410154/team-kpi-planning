import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, IconButton, Tooltip, TextField, Autocomplete, Chip, Alert, Dialog, DialogTitle,
  DialogContent, DialogActions, FormControlLabel, Checkbox, Table, TableHead, TableBody, TableRow, TableCell,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import ContentPasteIcon from '@mui/icons-material/ContentPaste'
import LinkIcon from '@mui/icons-material/Link'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight'
import * as api from '../lib/api.js'
import Loading from '../components/Loading.jsx'
import { newId } from './templates.js'
import { parseInitiatives, linkAll, suggestLink, INITIATIVE_STATUSES, pillOf } from './initiatives.js'
import { statusStyle } from './theme.js'

/*
 * THE INITIATIVE LIST, EDITED: each initiative and its milestones, with a
 * status, the users it serves, a target, and — where there is one — the
 * register project it is. Pasting rows from Excel fills it; every change is
 * saved on its own a moment later, for the whole team.
 */

const blank = (team, parentId = null) => ({ id: newId(), parentId, name: '', status: 'In progress', users: '', target: '', team, projectKey: null, note: '' })

export default function InitiativesEditor({ projects }) {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)
  const [save, setSave] = useState('saved')
  const [conflict, setConflict] = useState(null)
  const [paste, setPaste] = useState(false)
  const rev = useRef(0)
  const ver = useRef(0)
  const savedVer = useRef(0)
  const itemsRef = useRef(null)
  itemsRef.current = items
  const byKey = Object.fromEntries(projects.map((p) => [p.key, p]))

  useEffect(() => {
    api.getInitiatives().then((r) => { setItems(r.items || []); rev.current = r.rev || 0 }).catch((e) => setError(api.plainError(e)))
  }, [])

  const doSave = useCallback(async () => {
    if (ver.current === savedVer.current) return
    const v = ver.current
    setSave('saving')
    try {
      const r = await api.saveInitiatives(itemsRef.current.filter((x) => x.name.trim()), rev.current)
      rev.current = r.rev
      savedVer.current = Math.max(savedVer.current, v)
      setSave(ver.current === savedVer.current ? 'saved' : 'saving')
    } catch (e) {
      if (e.status === 409 && e.list) { setConflict(e.list); setSave('conflict'); return }
      setSave('error')
      setError(api.plainError(e))
    }
  }, [])

  useEffect(() => {
    if (ver.current === savedVer.current || conflict) return undefined
    const t = setTimeout(doSave, 1000)
    return () => clearTimeout(t)
  })

  const change = (fn) => { setItems((xs) => fn(xs)); ver.current += 1 }
  const patch = (id, p) => change((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)))
  const remove = (id) => change((xs) => xs.filter((x) => x.id !== id && x.parentId !== id))
  const add = (team) => change((xs) => [...xs, blank(team)])
  const addMilestone = (parent) => change((xs) => {
    const at = xs.reduce((last, x, i) => (x.id === parent.id || x.parentId === parent.id ? i : last), -1)
    const next = [...xs]
    next.splice(at + 1, 0, { ...blank(parent.team, parent.id), users: parent.users })
    return next
  })
  /* Up or down among its siblings; an initiative takes its milestones with it. */
  const move = (it, dir) => change((xs) => {
    const sibs = xs.filter((x) => x.parentId === it.parentId && (it.parentId || x.team === it.team))
    const i = sibs.findIndex((x) => x.id === it.id)
    const other = sibs[i + dir]
    if (!other) return xs
    const block = (x) => xs.filter((y) => y.id === x.id || y.parentId === x.id)
    const a = block(it)
    const b = block(other)
    const rest = xs.filter((y) => !a.includes(y) && !b.includes(y))
    const anchor = xs.indexOf(dir < 0 ? b[0] : a[0])
    const before = rest.filter((y) => xs.indexOf(y) < anchor)
    const after = rest.filter((y) => xs.indexOf(y) >= anchor)
    return [...before, ...(dir < 0 ? [...a, ...b] : [...b, ...a]), ...after]
  })

  const linkUnlinked = () => change((xs) => linkAll(xs, projects))

  if (error && !items) return <Alert severity="error">{error}</Alert>
  if (!items) return <Loading label="Loading the initiative list…" />

  const top = items.filter((x) => !x.parentId)
  const unlinked = items.filter((x) => !x.projectKey && suggestLink(x.name, projects)).length

  const row = (it, depth, sibs, i) => {
    const pill = pillOf(it.status)
    const ps = statusStyle(pill)
    return (
      <TableRow key={it.id} hover sx={{ '& td': { py: 0.5, borderColor: 'divider' }, bgcolor: depth ? 'transparent' : 'action.hover' }}>
        <TableCell sx={{ pl: depth ? 4 : 1.5, minWidth: 260 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {depth ? <SubdirectoryArrowRightIcon sx={{ fontSize: 16, color: 'text.disabled' }} /> : null}
            <TextField
              variant="standard" fullWidth value={it.name} placeholder={depth ? 'Milestone' : 'Initiative'}
              onChange={(e) => patch(it.id, { name: e.target.value })}
              inputProps={{ style: { fontWeight: depth ? 400 : 700, fontSize: 14 }, 'aria-label': depth ? 'milestone' : 'initiative' }}
            />
          </Box>
        </TableCell>
        <TableCell sx={{ width: 190 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Autocomplete
              freeSolo size="small" options={INITIATIVE_STATUSES} value={it.status || ''} sx={{ flex: 1 }}
              onInputChange={(_e, v) => patch(it.id, { status: v })}
              renderInput={(params) => <TextField {...params} variant="standard" inputProps={{ ...params.inputProps, style: { fontSize: 13 }, 'aria-label': 'status' }} />}
            />
            {pill && <Box title={`On a slide: ${pill}`} sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: ps.fill, border: `1px solid ${ps.border}`, flexShrink: 0 }} />}
          </Box>
        </TableCell>
        <TableCell sx={{ width: 150 }}>
          <TextField variant="standard" fullWidth value={it.users} onChange={(e) => patch(it.id, { users: e.target.value })} inputProps={{ style: { fontSize: 13 }, 'aria-label': 'users' }} />
        </TableCell>
        <TableCell sx={{ width: 120 }}>
          <TextField variant="standard" fullWidth value={it.target} placeholder="Target" onChange={(e) => patch(it.id, { target: e.target.value })} inputProps={{ style: { fontSize: 13 }, 'aria-label': 'target' }} />
        </TableCell>
        <TableCell sx={{ width: 230 }}>
          <Autocomplete
            size="small" options={projects} value={byKey[it.projectKey] || null}
            getOptionLabel={(p) => `${p.key} · ${p.summary || ''}`}
            isOptionEqualToValue={(a, b) => a.key === b.key}
            onChange={(_e, p) => patch(it.id, { projectKey: p ? p.key : null })}
            renderInput={(params) => <TextField {...params} variant="standard" placeholder="—" inputProps={{ ...params.inputProps, style: { fontSize: 12 }, 'aria-label': 'register project' }} />}
          />
        </TableCell>
        <TableCell sx={{ width: 150, whiteSpace: 'nowrap' }} align="right">
          {!depth && <Tooltip title="Add a milestone"><IconButton size="small" onClick={() => addMilestone(it)} aria-label="add milestone"><AddIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>}
          <IconButton size="small" disabled={i === 0} onClick={() => move(it, -1)} aria-label="move up"><KeyboardArrowUpIcon sx={{ fontSize: 17 }} /></IconButton>
          <IconButton size="small" disabled={i === sibs.length - 1} onClick={() => move(it, 1)} aria-label="move down"><KeyboardArrowDownIcon sx={{ fontSize: 17 }} /></IconButton>
          <Tooltip title={depth ? 'Delete milestone' : 'Delete initiative and its milestones'}><IconButton size="small" onClick={() => remove(it.id)} aria-label="delete"><DeleteOutlineIcon sx={{ fontSize: 17 }} /></IconButton></Tooltip>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1, minWidth: 260 }}>
          What the team presents at IT governance: initiatives and their milestones. New presentations can be built from this list.
          The Projects register is not changed by it.
        </Typography>
        <Chip size="small" variant="outlined" label={{ saved: 'Saved', saving: 'Saving…', error: 'Not saved', conflict: 'Not saved' }[save]} color={save === 'error' || save === 'conflict' ? 'error' : 'default'} />
        {!!unlinked && <Button size="small" startIcon={<LinkIcon />} onClick={linkUnlinked}>Link {unlinked} to projects</Button>}
        <Button size="small" startIcon={<ContentPasteIcon />} onClick={() => setPaste(true)}>Paste from Excel</Button>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>{error}</Alert>}

      {['Finance', 'Accounting'].map((team) => {
        const parents = top.filter((x) => x.team === team)
        return (
          <Paper key={team} variant="outlined" sx={{ mb: 2, overflow: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 1 }}>
              <Typography variant="subtitle2" sx={{ flex: 1 }}>{team} · {parents.length} initiative{parents.length === 1 ? '' : 's'}</Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={() => add(team)}>Initiative</Button>
            </Box>
            <Table size="small" sx={{ minWidth: 980 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Initiative / milestone</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Users</TableCell>
                  <TableCell>Target</TableCell>
                  <TableCell>Register project</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {parents.flatMap((it, i) => {
                  const kids = items.filter((x) => x.parentId === it.id)
                  return [row(it, 0, parents, i), ...kids.map((k, j) => row(k, 1, kids, j))]
                })}
                {!parents.length && (
                  <TableRow><TableCell colSpan={6} sx={{ color: 'text.secondary' }}>None yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        )
      })}

      {paste && (
        <PasteDialog
          projects={projects}
          hasItems={!!items.length}
          onClose={() => setPaste(false)}
          onApply={(rows, mode) => { change((xs) => (mode === 'replace' ? rows : [...xs, ...rows])); setPaste(false) }}
        />
      )}

      <Dialog open={!!conflict}>
        <DialogTitle>Somebody else saved the list</DialogTitle>
        <DialogContent><Typography variant="body2">{conflict?.updatedBy || 'Somebody'} saved it after you opened it. Keep yours, or take theirs?</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => { setItems(conflict.items); rev.current = conflict.rev; savedVer.current = ver.current; setConflict(null); setSave('saved') }}>Take theirs</Button>
          <Button variant="contained" onClick={() => { rev.current = conflict.rev; setConflict(null); setSave('saving'); doSave() }}>Keep mine</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

/* Rows copied from Excel: Project, Milestone, Status, Users, Target. */
function PasteDialog({ projects, hasItems, onClose, onApply }) {
  const [raw, setRaw] = useState('')
  const [link, setLink] = useState(true)
  const parsed = parseInitiatives(raw)
  const rows = link ? linkAll(parsed, projects) : parsed
  const tops = rows.filter((x) => !x.parentId)
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Paste from Excel</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          Copy the rows from Excel — columns Project, Milestone, Status, Users, Target — and paste them here. A row with only a
          milestone belongs to the project above it. Users starting &ldquo;Acc&rdquo; are Accounting; the rest are Finance.
        </Typography>
        <TextField multiline minRows={8} maxRows={16} fullWidth value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={'Project\tMile Stone\tStatus\tUsers\tTarget'} inputProps={{ style: { fontFamily: 'monospace', fontSize: 12 } }} />
        <FormControlLabel sx={{ mt: 1 }} control={<Checkbox size="small" checked={link} onChange={(e) => setLink(e.target.checked)} />} label={<Typography variant="body2">Link to register projects whose name clearly matches</Typography>} />
        {!!rows.length && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {tops.filter((x) => x.team === 'Finance').length} Finance and {tops.filter((x) => x.team === 'Accounting').length} Accounting initiatives,
            {' '}{rows.length - tops.length} milestones; {rows.filter((x) => x.projectKey).length} linked to the register.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {hasItems && <Button disabled={!rows.length} onClick={() => onApply(rows, 'add')}>Add to the list</Button>}
        <Button variant="contained" disabled={!rows.length} onClick={() => onApply(rows, 'replace')}>{hasItems ? 'Replace the list' : 'Use these'}</Button>
      </DialogActions>
    </Dialog>
  )
}
