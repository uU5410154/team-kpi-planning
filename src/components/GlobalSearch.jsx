import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Autocomplete, TextField, InputAdornment, Box, Typography, IconButton, Dialog, createFilterOptions,
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import FolderIcon from '@mui/icons-material/FolderOutlined'
import { IconTile, PAGE_COLOR, personColor } from './Brand.jsx'

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
      type: 'page', id: `page:${t.id}`, label: t.label, sub: 'Page', tab: t.id, icon: t.icon, color: PAGE_COLOR[t.id],
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
        sub: [p.jiraKey || p.key, nick[p.pic] || null].filter(Boolean).join(' · '),
        keys: `${p.key} ${p.jiraKey || ''} ${p.program || ''}`,
        tab: admin ? 'projects' : 'timeline',
        q: p.jiraKey || p.key,
        color: PAGE_COLOR.projects,
      })
    }
    if (admin) {
      for (const person of plan?.people || []) {
        out.push({
          type: 'person',
          id: `person:${person.id}`,
          label: person.name || person.nick,
          sub: [person.nick, person.role].filter(Boolean).join(' · '),
          tab: 'people',
          person: person.id,
          color: personColor(plan.people, person.id),
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
      autoHighlight
      blurOnSelect
      clearOnBlur
      noOptionsText="Nothing by that name"
      sx={{ width: phone ? '100%' : { md: 240, lg: 300 } }}
      slotProps={{ paper: { sx: { minWidth: 320 } } }}
      renderOption={(props, o) => {
        const { key, ...rest } = props
        return (
          <Box component="li" key={key} {...rest} sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            {o.type === 'person'
              ? <IconTile text={o.initials} color={o.color} size={26} />
              : <IconTile icon={o.icon || FolderIcon} color={o.color} size={26} />}
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>{o.label}</Typography>
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
              <InputAdornment position="start"><SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} /></InputAdornment>
            ),
            endAdornment: phone ? params.InputProps.endAdornment : (
              <Typography
                component="kbd"
                sx={{
                  fontSize: '0.68rem', color: 'text.disabled', border: 1, borderColor: 'divider', borderRadius: '5px', px: 0.6, mr: 0.5,
                }}
              >
                /
              </Typography>
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
      <IconButton onClick={() => setOpen(true)} aria-label="Search">
        <SearchIcon fontSize="small" />
      </IconButton>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        PaperProps={{ sx: { alignSelf: 'flex-start', mt: 2, p: 1.5 } }}
      >
        {box}
      </Dialog>
    </>
  )
}
