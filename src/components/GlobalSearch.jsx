import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete, TextField, InputAdornment, Box, Typography, IconButton, Dialog, Tooltip, createFilterOptions,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import CloseIcon from '@mui/icons-material/Close'
import FolderIcon from '@mui/icons-material/FolderOutlined'
import { IconTile } from './Brand.jsx'

/*
 * ONE BOX TO GET ANYWHERE.
 *
 * Type a page, a project (its key or its name) or a person, and go. A project
 * opens where this person can see it: the register for an administrator, the
 * Timeline for a team member — the register is not theirs to open. A person
 * opens their scorecard, which is an administrator's page, so team members are
 * offered pages and projects only.
 *
 * "/" puts the cursor in it from anywhere, as most search boxes on the web
 * have taught people to expect — except while somebody is typing in a field,
 * where "/" is just a slash.
 */

const filter = createFilterOptions({
  stringify: (o) => `${o.label} ${o.sub || ''} ${o.keys || ''}`,
  limit: 12,
})

const GROUP = { page: 'Pages', project: 'Projects', person: 'People' }

export default function GlobalSearch({
  tabs, plan, admin, onGo, phone,
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(null)
  const [text, setText] = useState('')
  const input = useRef(null)

  const options = useMemo(() => {
    const out = tabs.map((t) => ({
      type: 'page', id: `page:${t.id}`, label: t.label, sub: null, tab: t.id, icon: t.icon,
    }))
    const seen = new Set()
    const nick = Object.fromEntries((plan?.people || []).map((x) => [x.id, x.nick]))
    for (const p of plan?.projects || []) {
      if (p.deleted || seen.has(p.key)) continue
      seen.add(p.key)
      out.push({
        type: 'project',
        id: `project:${p.key}`,
        label: p.summary || p.key,
        sub: [p.jiraKey || p.key, nick[p.pic] || null].filter(Boolean).join(', '),
        keys: `${p.key} ${p.jiraKey || ''} ${p.program || ''}`,
        tab: admin ? 'projects' : 'timeline',
        q: p.jiraKey || p.key,
      })
    }
    if (admin) {
      for (const person of plan?.people || []) {
        out.push({
          type: 'person',
          id: `person:${person.id}`,
          label: person.name || person.nick,
          sub: [person.nick, person.role].filter(Boolean).join(', '),
          tab: 'people',
          person: person.id,
          initials: (person.nick || person.name || '?').slice(0, 2),
        })
      }
    }
    return out
  }, [tabs, plan, admin])

  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        if (phone) setOpen(true)
        else input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phone])

  const pick = (o) => {
    if (!o) return
    onGo(o)
    setValue(null)
    setText('')
    setOpen(false)
    input.current?.blur()
  }

  const box = (
    <Autocomplete
      size="small"
      options={options}
      value={value}
      inputValue={text}
      onInputChange={(_e, v) => setText(v)}
      onChange={(_e, v) => pick(v)}
      filterOptions={(opts, state) => (state.inputValue.trim() ? filter(opts, state) : opts.filter((o) => o.type === 'page'))}
      groupBy={(o) => GROUP[o.type]}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      openOnFocus
      forcePopupIcon={false}
      autoHighlight
      blurOnSelect
      clearOnBlur
      noOptionsText="Nothing matches. Try a project key, a name or a page."
      sx={{ width: '100%', maxWidth: phone ? 'none' : 360 }}
      slotProps={{ paper: { sx: { minWidth: 320 } }, listbox: { sx: { maxHeight: phone ? '70vh' : '60vh' } } }}
      renderOption={(props, o) => {
        const { key, ...rest } = props
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
            {o.type === 'person'
              ? <IconTile text={o.initials} size={24} />
              : <IconTile icon={o.icon || FolderIcon} size={24} />}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body1" noWrap>{o.label}</Typography>
              {o.sub && <Typography variant="caption" noWrap sx={{ color: 'text.secondary', display: 'block' }}>{o.sub}</Typography>}
            </Box>
          </Box>
        )
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={input}
          autoFocus={phone}
          placeholder={admin ? 'Search pages, projects, people' : 'Search pages and projects'}
          InputProps={{
            ...params.InputProps,
            startAdornment: (
              <InputAdornment position="start" sx={{ ml: 0.5, mr: 0 }}><SearchIcon fontSize="small" sx={{ color: 'text.tertiary' }} /></InputAdornment>
            ),
            endAdornment: phone ? params.InputProps.endAdornment : (
              <Box
                component="kbd"
                aria-hidden
                sx={{
                  fontSize: '0.75rem',
                  lineHeight: '18px',
                  minWidth: 20,
                  textAlign: 'center',
                  color: 'text.tertiary',
                  border: 1,
                  borderColor: 'border.strong',
                  borderRadius: '4px',
                  px: 1,
                  mr: 1,
                }}
              >
                /
              </Box>
            ),
          }}
          inputProps={{ ...params.inputProps, 'aria-label': 'Search' }}
        />
      )}
    />
  )

  if (!phone) return box
  return (
    <>
      <Tooltip title="Search">
        <IconButton onClick={() => setOpen(true)} aria-label="Search" sx={{ width: 40, height: 40 }}>
          <SearchIcon />
        </IconButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullScreen
        aria-label="Search"
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 3, borderBottom: 1, borderColor: 'border.subtle' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>{box}</Box>
          <IconButton onClick={() => setOpen(false)} aria-label="close search" sx={{ width: 40, height: 40 }}><CloseIcon /></IconButton>
        </Box>
      </Dialog>
    </>
  )
}
