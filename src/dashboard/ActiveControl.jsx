import { useState } from 'react'
import {
  Box, ButtonBase, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip, Typography,
} from '@mui/material'
import CheckIcon from '@mui/icons-material/Check'
import { unitActive, unitSource, ACTIVE_WHY } from '../lib/manager.js'
import { weekOf, weekNo } from '../lib/weekly.js'

/*
 * WHETHER A PROJECT IS ACTIVE, AND WHO SAID SO.
 *
 * Active is automatic: a project whose dates cover this week, or with Jira
 * work covering it, an update sent on it, or an open decision, is active this
 * week (lib/manager.js activeSource; `signals` carries the last three). An
 * administrator can override that either way. Three choices, so the override
 * can be taken off again:
 *
 *   Automatic      the dates and the work decide (nothing stored)
 *   Always active  `active: true`
 *   Never active   `active: false`
 *
 * One control for every register line behind one bar or one page — the same
 * work, so the same answer. Shown as a dot (filled when active this week) and
 * a word for who decided it.
 */

const modeOf = (projects) => {
  if (projects.length && projects.every((p) => p.active === true)) return 'on'
  if (projects.length && projects.every((p) => p.active === false)) return 'off'
  return 'auto'
}

const WORD = { auto: 'Auto', on: 'Always', off: 'Never' }

export default function ActiveControl({
  projects = [], label, onSet, week = weekOf(), size = 'small', signals = null,
}) {
  const [at, setAt] = useState(null)
  const live = projects.filter(Boolean)
  const mode = modeOf(live)
  // The same answer as the dashboard: any line active makes the work active.
  const on = unitActive(live, week, signals)
  // What "Automatic" would say — dates, Jira work, an update, a decision — for its line of the menu.
  const autoWhy = unitSource(live.map((p) => ({ ...p, active: undefined })), week, signals)
  const byAuto = autoWhy !== 'none'
  const wk = `week ${weekNo(week)}`
  const tip = `${on ? 'Active' : 'Not active'} in ${wk} — ${mode === 'auto' ? (byAuto ? ACTIVE_WHY[autoWhy] : 'automatic: nothing covers it') : 'set by an administrator'}. Click to change.`
  const pick = (v) => { setAt(null); onSet?.(v) }
  // 'dot': just the dot, for a narrow column — the word is in the tooltip.
  const dot = size === 'dot'
  const big = size !== 'small' && !dot
  return (
    <>
      <Tooltip title={tip}>
        <ButtonBase
          onClick={(e) => { e.stopPropagation(); setAt(e.currentTarget) }}
          aria-label={label}
          aria-haspopup="menu"
          data-active={on ? 'on' : 'off'}
          data-active-mode={mode}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.6,
            flexShrink: 0,
            px: big ? 1.25 : dot ? 0.6 : 0.75,
            py: big ? 0.5 : dot ? 0.6 : 0.25,
            borderRadius: '999px',
            border: 1,
            borderColor: 'divider',
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Box sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            border: 1.5,
            borderColor: on ? 'primary.main' : 'text.disabled',
            bgcolor: on ? 'primary.main' : 'transparent',
          }}
          />
          {!dot && (
            <Typography component="span" sx={{ fontSize: big ? '0.8rem' : '0.66rem', fontWeight: 600, lineHeight: 1.4 }}>
              {big ? `${on ? 'Active' : 'Not active'} · ${WORD[mode]}` : WORD[mode]}
            </Typography>
          )}
        </ButtonBase>
      </Tooltip>
      <Menu anchorEl={at} open={!!at} onClose={() => setAt(null)} onClick={(e) => e.stopPropagation()}>
        <MenuItem onClick={() => pick(undefined)} selected={mode === 'auto'}>
          <ListItemIcon>{mode === 'auto' && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText
            primary="Automatic"
            secondaryTypographyProps={{ sx: { whiteSpace: 'normal', maxWidth: 300 } }}
            secondary={`${byAuto ? `Active in ${wk} — ${ACTIVE_WHY[autoWhy]}` : `Not active in ${wk}`}. Dates, Jira work, an update or an open decision make it active.`}
          />
        </MenuItem>
        <MenuItem onClick={() => pick(true)} selected={mode === 'on'}>
          <ListItemIcon>{mode === 'on' && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText primary="Always active" secondary="Whatever its dates say" />
        </MenuItem>
        <MenuItem onClick={() => pick(false)} selected={mode === 'off'}>
          <ListItemIcon>{mode === 'off' && <CheckIcon fontSize="small" />}</ListItemIcon>
          <ListItemText primary="Never active" secondary="Kept off the dashboard" />
        </MenuItem>
      </Menu>
    </>
  )
}
