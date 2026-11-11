import { useMemo, useRef, useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Box, Typography, Checkbox, List, ListItemButton,
  ListItemIcon, ListItemText, ToggleButton, ToggleButtonGroup, FormControlLabel, Switch, Chip, Alert, Radio, RadioGroup,
  CircularProgress, Tabs, Tab, InputAdornment,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import { isActive } from '../lib/manager.js'
import { deckStatus } from './templates.js'
import { statusStyle } from './theme.js'
import { assetUrl } from './render.jsx'

/* ----------------------------------------------------------- project picker */

/**
 * Pick projects for a slide: searchable, by team, active-this-week by default.
 * `single` picks one (a task timeline).
 */
export function ProjectPicker({ open, projects, title = 'Choose projects', single = false, initial = null, onClose, onPick, confirm = 'Add' }) {
  const [q, setQ] = useState('')
  const [team, setTeam] = useState('all')
  const [activeOnly, setActiveOnly] = useState(true)
  const [chosen, setChosen] = useState(() => new Set(initial || []))
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return projects.filter((p) => (team === 'all' || (team === 'Accounting' ? p.team === 'Accounting' : p.team !== 'Accounting'))
      && (!activeOnly || isActive(p) || chosen.has(p.key))
      && (!needle || `${p.key} ${p.summary} ${p.program || ''}`.toLowerCase().includes(needle)))
  }, [projects, q, team, activeOnly, chosen])
  const toggle = (k) => {
    if (single) { onPick([k]); return }
    setChosen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers sx={{ pt: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
          <TextField
            size="small" autoFocus placeholder="Search projects" value={q} onChange={(e) => setQ(e.target.value)} sx={{ flex: 1, minWidth: 180 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <ToggleButtonGroup size="small" exclusive value={team} onChange={(_e, v) => v && setTeam(v)}>
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="Finance">Finance</ToggleButton>
            <ToggleButton value="Accounting">Accounting</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <FormControlLabel control={<Switch size="small" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />} label={<Typography variant="body2">Active this week only</Typography>} />
          {!single && (
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button size="small" onClick={() => setChosen((s) => new Set([...s, ...list.map((p) => p.key)]))}>Select all shown</Button>
              <Button size="small" onClick={() => setChosen(new Set())}>Clear</Button>
            </Box>
          )}
        </Box>
        <List dense sx={{ maxHeight: 420, overflow: 'auto' }}>
          {list.map((p) => {
            const st = deckStatus(p)
            const ss = statusStyle(st)
            return (
              <ListItemButton key={p.key} onClick={() => toggle(p.key)} dense>
                {!single && <ListItemIcon sx={{ minWidth: 36 }}><Checkbox edge="start" size="small" checked={chosen.has(p.key)} tabIndex={-1} disableRipple /></ListItemIcon>}
                <ListItemText primary={p.summary || p.key} secondary={`${p.key} · ${p.team || ''}${p.due ? ` · due ${p.due}` : ''}`} />
                <Chip size="small" label={st} sx={{ bgcolor: ss.fill, color: ss.text, fontWeight: 700, height: 20, fontSize: 11 }} />
              </ListItemButton>
            )
          })}
          {!list.length && <Typography variant="body2" sx={{ color: 'text.secondary', p: 2 }}>No projects match.</Typography>}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        {!single && <Button variant="contained" disabled={!chosen.size} onClick={() => onPick(projects.filter((p) => chosen.has(p.key)).map((p) => p.key))}>{confirm} {chosen.size || ''}</Button>}
      </DialogActions>
    </Dialog>
  )
}

/* --------------------------------------------------------------- new deck */

export function NewDeckDialog({ open, projects, initiatives = [], aiOn, onClose, onCreate }) {
  const today = new Date().toISOString().slice(0, 10)
  const [title, setTitle] = useState('IT Finance Governance')
  const [date, setDate] = useState(today)
  const tops = initiatives.filter((x) => !x.parentId)
  const [kind, setKind] = useState(tops.length ? 'initiatives' : 'standard')
  const [ask, setAsk] = useState('')
  const [picking, setPicking] = useState(false)
  const [keys, setKeys] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const active = useMemo(() => projects.filter((p) => isActive(p)).map((p) => p.key), [projects])
  const chosen = keys || active

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await onCreate({ title, date, kind, keys: chosen, ask })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New presentation</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
          <TextField size="small" label="Title" value={title} onChange={(e) => setTitle(e.target.value)} sx={{ flex: 1, minWidth: 220 }} />
          <TextField size="small" type="date" label="Meeting date" InputLabelProps={{ shrink: true }} value={date} onChange={(e) => setDate(e.target.value)} />
        </Box>
        <RadioGroup value={kind} onChange={(e) => setKind(e.target.value)}>
          {!!tops.length && (
            <FormControlLabel
              value="initiatives" control={<Radio size="small" />}
              label={(
                <Box sx={{ py: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Meeting deck from the initiative list</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Cover, agenda, a card for each of the {tops.length} initiatives (Finance, then Accounting), the roadmap and thank you.
                  </Typography>
                </Box>
              )}
            />
          )}
          <FormControlLabel
            value="standard" control={<Radio size="small" />}
            label={(
              <Box sx={{ py: 0.5 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Meeting deck from the register&rsquo;s projects</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Cover, agenda, Finance and Accounting project updates, the roadmap and thank you — in the IT Gov format.
                </Typography>
              </Box>
            )}
          />
          {kind === 'standard' && (
            <Box sx={{ ml: 4, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">{chosen.length} project{chosen.length === 1 ? '' : 's'}{keys ? '' : ' (active this week)'}</Typography>
              <Button size="small" onClick={() => setPicking(true)}>Change</Button>
            </Box>
          )}
          {aiOn && (
            <FormControlLabel
              value="ai" control={<Radio size="small" />}
              label={(
                <Box sx={{ py: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>Build it with AI</Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>Say what the meeting is for; the AI picks the slides and projects, and you edit from there.</Typography>
                </Box>
              )}
            />
          )}
          {kind === 'ai' && (
            <TextField
              multiline minRows={2} size="small" fullWidth sx={{ ml: 4, width: 'calc(100% - 32px)', mb: 1 }}
              placeholder="e.g. IT governance update for 13 Nov: Finance and Accounting projects going live this quarter, with a roadmap"
              value={ask} onChange={(e) => setAsk(e.target.value)}
            />
          )}
          <FormControlLabel
            value="blank" control={<Radio size="small" />}
            label={<Typography variant="body2" sx={{ fontWeight: 600, py: 0.5 }}>Start from a cover slide only</Typography>}
          />
        </RadioGroup>
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={go} disabled={busy || !title.trim() || (kind === 'ai' && !ask.trim()) || (kind === 'standard' && !chosen.length)}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
        >
          {busy ? (kind === 'ai' ? 'The AI is planning…' : 'Creating…') : 'Create'}
        </Button>
      </DialogActions>
      {picking && (
        <ProjectPicker
          open projects={projects} initial={chosen} title="Projects in this deck" confirm="Use"
          onClose={() => setPicking(false)} onPick={(k) => { setKeys(k); setPicking(false) }}
        />
      )}
    </Dialog>
  )
}

/* -------------------------------------------------------------------- AI */

const QUICK = ['Shorter', 'More formal', 'Fix the grammar', 'Two bullets each', 'Translate to Thai', 'Translate to English']

/**
 * THE AI, on what is on screen: rewrite the selection, this slide or the
 * whole deck; or draft project cards from the weekly updates.
 */
export function AiDialog({ open, onClose, hasSelection, cardsHere, cardsInDeck, onRewrite, onDraft }) {
  const [tab, setTab] = useState('rewrite')
  const [scope, setScope] = useState(hasSelection ? 'selection' : 'slide')
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null)
  const run = async (fn) => {
    setBusy(true); setError(null); setDone(null)
    try { setDone(await fn()) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0 }}>AI</DialogTitle>
      <Tabs value={tab} onChange={(_e, v) => { setTab(v); setDone(null); setError(null) }} sx={{ px: 2 }}>
        <Tab value="rewrite" label="Rewrite" />
        <Tab value="draft" label="Draft project cards" />
      </Tabs>
      <DialogContent dividers>
        {tab === 'rewrite' && (
          <>
            <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_e, v) => v && setScope(v)} sx={{ mb: 1.5 }}>
              <ToggleButton value="selection" disabled={!hasSelection}>Selected</ToggleButton>
              <ToggleButton value="slide">This slide</ToggleButton>
              <ToggleButton value="deck">Whole deck</ToggleButton>
            </ToggleButtonGroup>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
              {QUICK.map((qk) => <Chip key={qk} label={qk} size="small" onClick={() => setInstruction(qk)} variant={instruction === qk ? 'filled' : 'outlined'} />)}
            </Box>
            <TextField
              multiline minRows={2} fullWidth size="small" label="What to change" value={instruction} onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. make the accomplishments sound like business results"
            />
          </>
        )}
        {tab === 'draft' && (
          <>
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              Writes Accomplishment, Impact and Next milestone on each card from the project&rsquo;s weekly updates, blockers and Jira tasks.
              The text on those cards is replaced — undo brings it back.
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={scope} onChange={(_e, v) => v && setScope(v)} sx={{ mb: 1.5 }}>
              <ToggleButton value="selection" disabled={!hasSelection}>Selected</ToggleButton>
              <ToggleButton value="slide" disabled={!cardsHere}>This slide ({cardsHere})</ToggleButton>
              <ToggleButton value="deck" disabled={!cardsInDeck}>Whole deck ({cardsInDeck})</ToggleButton>
            </ToggleButtonGroup>
            <TextField multiline minRows={2} fullWidth size="small" label="Anything to add (optional)" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. in Thai; stress the hours saved" />
          </>
        )}
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
        {done && <Alert severity="success" sx={{ mt: 1.5 }}>{done}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>Close</Button>
        <Button
          variant="contained" disabled={busy || (tab === 'rewrite' && !instruction.trim())}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
          onClick={() => run(() => (tab === 'rewrite' ? onRewrite(scope, instruction) : onDraft(scope, instruction)))}
        >
          {busy ? 'Working…' : tab === 'rewrite' ? 'Rewrite' : 'Draft'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* ------------------------------------------------------------ deck pictures */

const BRAND = [
  ['logo', 'Company logo', 'Top-right of the cover and roadmap slides'],
  ['cover', 'Cover illustration', 'The cover slide\'s background'],
  ['finance', 'Finance divider', 'The "Finance Tech Initiative" section slide'],
  ['accounting', 'Accounting divider', 'The "Accounting Tech Initiative" section slide'],
]

/** The deck's own pictures, uploaded once by an administrator and used by everyone. */
export function BrandDialog({ open, brand, isAdmin, onClose, onUpload, onClear }) {
  const refs = useRef({})
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Deck pictures</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
          The logo and illustrations of the deck&rsquo;s format, shared by every presentation.
          {!isAdmin && ' Only an administrator can change them.'}
        </Typography>
        {error && <Alert severity="error" sx={{ mb: 1.5 }}>{error}</Alert>}
        {BRAND.map(([k, label, hint]) => (
          <Box key={k} sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 1.5 }}>
            <Box sx={{ width: 160, height: 90, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
              {brand?.[k] ? <img src={assetUrl(brand[k])} alt={label} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <Typography variant="caption" sx={{ color: '#8899AA' }}>None</Typography>}
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>{hint}</Typography>
              {isAdmin && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <input
                    ref={(r) => { refs.current[k] = r }} type="file" accept="image/png,image/jpeg,image/webp" hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      e.target.value = ''
                      if (!f) return
                      setBusy(k); setError(null)
                      try { await onUpload(k, f) } catch (err) { setError(err.message) } finally { setBusy(null) }
                    }}
                  />
                  <Button size="small" variant="outlined" disabled={!!busy} onClick={() => refs.current[k]?.click()}>
                    {busy === k ? 'Uploading…' : brand?.[k] ? 'Replace' : 'Upload'}
                  </Button>
                  {brand?.[k] && <Button size="small" disabled={!!busy} onClick={() => onClear(k)}>Remove</Button>}
                </Box>
              )}
            </Box>
          </Box>
        ))}
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  )
}

/* ------------------------------------------------------- initiative picker */

/** Pick initiatives from the list (top level), for cards or a roadmap. */
export function InitiativePicker({ open, initiatives, title = 'Choose initiatives', onClose, onPick }) {
  const tops = initiatives.filter((x) => !x.parentId)
  const [chosen, setChosen] = useState(() => new Set(tops.map((x) => x.id)))
  const toggle = (id) => setChosen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {!tops.length && <Typography variant="body2">The initiative list is empty. Fill it on the Initiatives tab first.</Typography>}
        {['Finance', 'Accounting'].map((team) => {
          const xs = tops.filter((x) => x.team === team)
          if (!xs.length) return null
          return (
            <Box key={team} sx={{ mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Typography variant="overline" sx={{ flex: 1 }}>{team}</Typography>
                <Button size="small" onClick={() => setChosen((s) => new Set([...s, ...xs.map((x) => x.id)]))}>All</Button>
                <Button size="small" onClick={() => setChosen((s) => new Set([...s].filter((id) => !xs.some((x) => x.id === id))))}>None</Button>
              </Box>
              <List dense disablePadding>
                {xs.map((x) => (
                  <ListItemButton key={x.id} dense onClick={() => toggle(x.id)}>
                    <ListItemIcon sx={{ minWidth: 36 }}><Checkbox edge="start" size="small" checked={chosen.has(x.id)} tabIndex={-1} disableRipple /></ListItemIcon>
                    <ListItemText primary={x.name} secondary={[x.status, x.users, x.target].filter(Boolean).join(' · ')} />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          )
        })}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!chosen.size} onClick={() => onPick(tops.filter((x) => chosen.has(x.id)))}>Add {chosen.size}</Button>
      </DialogActions>
    </Dialog>
  )
}
