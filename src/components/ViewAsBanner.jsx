import { useState } from 'react'
import {
  Box, Button, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip, Typography,
} from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import CheckIcon from '@mui/icons-material/Check'

/*
 * "VIEWING AS A TEAM MEMBER" — and which one.
 *
 * A slim bar under the top bar (docs/DESIGN.md §2). An administrator picks
 * anybody on the team and sees exactly what that person is sent: their Weekly
 * page (their Jira week), their projects on the Timeline, their scorecard.
 * Read only: the server answers the preview's reads as that member, and the
 * week comes back not writable.
 */
export default function ViewAsBanner({
  people = [], person = null, self = null, onPick, onBack,
}) {
  const [at, setAt] = useState(null)
  const team = people.filter((p) => p && p.id && !p.deleted)
  const nick = team.find((p) => p.id === person)?.nick || null
  const name = (p) => p.nick || p.name || p.id
  const tip = person
    ? `What ${person === self ? 'your team sees, with your own week' : `${nick || person} sees: their week and their projects`}. Read only: nothing you do here changes anything.`
    : 'Pick somebody to see their week and their projects exactly as they do.'
  return (
    <Box
      data-view-as={person || ''}
      role="region"
      aria-label="viewing as a team member"
      sx={{
        position: 'sticky',
        top: { xs: 52, sm: 56 },
        zIndex: (t) => t.zIndex.appBar - 1,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        minHeight: 40,
        px: { xs: 3, sm: 5, md: 6 },
        bgcolor: 'bg.subtle',
        borderBottom: 1,
        borderColor: 'border.subtle',
      }}
    >
      <Box
        aria-hidden
        sx={(t) => ({
          width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: t.palette.tone.info.solid,
        })}
      />
      <Tooltip title={tip}>
        <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }} noWrap>
          Viewing as
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> a team member</Box>
          {': '}
          <Button
            variant="text"
            size="small"
            onClick={(e) => setAt(e.currentTarget)}
            aria-haspopup="menu"
            aria-label="view as which member"
            endIcon={<ArrowDropDownIcon />}
            sx={{
              minHeight: 28, py: 0, px: 1, ml: -0.5, color: 'text.primary', fontWeight: 500, verticalAlign: 'baseline', '& .MuiButton-endIcon': { ml: 0 },
            }}
          >
            {nick || 'pick someone'}
          </Button>
        </Typography>
      </Tooltip>
      <Menu anchorEl={at} open={!!at} onClose={() => setAt(null)}>
        {team.map((p) => (
          <MenuItem key={p.id} selected={p.id === person} onClick={() => { setAt(null); onPick?.(p.id) }}>
            <ListItemIcon>{p.id === person && <CheckIcon fontSize="small" />}</ListItemIcon>
            <ListItemText primary={`${name(p)}${p.id === self ? ' (you)' : ''}`} />
          </MenuItem>
        ))}
      </Menu>
      <Button variant="text" size="small" onClick={onBack} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        Back
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' }, whiteSpace: 'pre' }}>{' to administrator'}</Box>
      </Button>
    </Box>
  )
}
