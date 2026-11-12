import { useState } from 'react'
import { ButtonBase, Menu, MenuItem, ListItemIcon, ListItemText, CircularProgress, Typography, Divider } from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { Pill, statusTone } from './Brand.jsx'
import { projectOnHold } from '../lib/hold.js'
import { STATUS_CHOICES, statusChoice, heldInJira } from '../lib/projectStatus.js'

/*
 * A PROJECT'S STATUS PILL, AND THE WAY TO CHANGE IT.
 *
 * Reads exactly as the plain pill did — the register's or the workbook's
 * word — with a small arrow; clicking it offers Not Start, In Progress, On
 * Hold and Done. `onPick(choice)` may be async; the pill shows it is saving.
 * Without `onPick` it is the plain pill.
 */
export default function StatusPicker({ project, onPick, size = 'small' }) {
  const [el, setEl] = useState(null)
  const [busy, setBusy] = useState(false)
  const held = projectOnHold(project)
  const label = held ? 'On Hold' : (project?.srcStatus || project?.status || '—')
  const tone = held ? 'warn' : statusTone(project?.status || project?.srcStatus)
  if (!onPick) return <Pill label={label} tone={tone} />
  const now = statusChoice(project)
  const jiraHold = heldInJira(project)
  const pick = async (choice) => {
    setEl(null)
    if (choice === now) return
    setBusy(true)
    try { await onPick(choice) } finally { setBusy(false) }
  }
  return (
    <>
      <ButtonBase
        onClick={(e) => { e.stopPropagation(); setEl(e.currentTarget) }}
        aria-label={`status: ${label} — change`}
        data-status-picker
        sx={{ borderRadius: '6px', flexShrink: 0, '&:hover .MuiBox-root, &:focus-visible .MuiBox-root': { filter: 'brightness(1.25)' } }}
      >
        <Pill
          label={(
            <>
              {label}
              {busy ? <CircularProgress size={9} thickness={6} sx={{ ml: 0.5, color: 'inherit' }} /> : <ArrowDropDownIcon sx={{ fontSize: size === 'small' ? 14 : 16, ml: 0.1, mr: -0.5 }} />}
            </>
          )}
          tone={tone}
        />
      </ButtonBase>
      <Menu anchorEl={el} open={!!el} onClose={() => setEl(null)} onClick={(e) => e.stopPropagation()}>
        {STATUS_CHOICES.map((c) => (
          <MenuItem key={c} dense selected={c === now} onClick={() => pick(c)} disabled={jiraHold && c !== 'On Hold'}>
            <ListItemIcon sx={{ minWidth: 28 }}>{c === now ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
            <ListItemText>{c}</ListItemText>
          </MenuItem>
        ))}
        {jiraHold && <Divider />}
        {jiraHold && (
          <Typography variant="caption" sx={{ px: 2, py: 0.5, display: 'block', color: 'text.secondary', maxWidth: 240 }}>
            On hold in Jira ({project.jiraStatus}). Take it off hold there; the sync brings it back.
          </Typography>
        )}
      </Menu>
    </>
  )
}
