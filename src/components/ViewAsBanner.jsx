import { useState } from 'react'
import {
  Box, Button, Menu, MenuItem, ListItemIcon, ListItemText, Tooltip, Typography,
} from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import CheckIcon from '@mui/icons-material/Check'
import PersonSearchIcon from '@mui/icons-material/PersonSearchOutlined'
import { EmptyState, PageHeader, Section } from './ui.jsx'

/*
 * "VIEWING AS A TEAM MEMBER" — and which one.
 *
 * A slim bar under the top bar (docs/DESIGN.md §2). An administrator picks
 * anybody on the team and sees exactly what that person is sent: their Weekly
 * page (their Jira week), their projects on the Timeline, their scorecard.
 * Read only: the server answers the preview's reads as that member, and the
 * week comes back not writable.
 */

const teamOf = (people) => people.filter((p) => p && p.id && !p.deleted)
const nameOf = (p) => p.nick || p.name || p.id

/*
 * WHO TO VIEW AS: a button naming the person, and the team in a menu. The
 * banner draws it as quiet text; the empty page below draws it as the page's
 * one action.
 */
export function ViewAsPicker({
  people = [], person = null, self = null, onPick, variant = 'text', label = null, sx,
}) {
  const [at, setAt] = useState(null)
  const team = teamOf(people)
  const nick = team.find((p) => p.id === person)?.nick || null
  return (
    <>
      <Button
        variant={variant}
        size="small"
        onClick={(e) => setAt(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={!!at}
        aria-label="view as which member"
        endIcon={<ArrowDropDownIcon />}
        sx={sx}
      >
        {label || nick || 'Choose a person'}
      </Button>
      <Menu
        anchorEl={at}
        open={!!at}
        onClose={() => setAt(null)}
        slotProps={{ paper: { sx: { minWidth: 200, maxHeight: 360 } } }}
      >
        {team.map((p) => (
          <MenuItem key={p.id} selected={p.id === person} onClick={() => { setAt(null); onPick?.(p.id) }}>
            {/* The tick column only once somebody is chosen: with nobody, the names sit flush. */}
            {person && <ListItemIcon>{p.id === person && <CheckIcon fontSize="small" />}</ListItemIcon>}
            <ListItemText primary={`${nameOf(p)}${p.id === self ? ' (you)' : ''}`} />
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/*
 * NOBODY CHOSEN YET: the administrator switched the view on with nobody
 * picked (and their own account is not on the team). Their week, scorecard and
 * Timeline would otherwise read as an unlinked account's, which is not what is
 * happening; this asks for the person instead.
 */
export function ViewAsChoose({
  title, people = [], self = null, onPick,
}) {
  return (
    <>
      {title && <PageHeader title={title} />}
      <Section data-view-as-empty>
        <EmptyState
          icon={PersonSearchIcon}
          title="Choose a team member"
          body="Pick someone to see their week, scorecard and projects exactly as they see them."
          action={(
            <ViewAsPicker people={people} self={self} onPick={onPick} variant="contained" label="Choose a person" />
          )}
        />
      </Section>
    </>
  )
}

export default function ViewAsBanner({
  people = [], person = null, self = null, onPick, onBack,
}) {
  const team = teamOf(people)
  const nick = team.find((p) => p.id === person)?.nick || null
  const tip = person
    ? `What ${person === self ? 'your team sees, with your own week' : `${nick || person} sees: their week and their projects`}. Read only: nothing you do here changes anything.`
    : 'Choose a person to see their week and their projects exactly as they do.'
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
      <Typography variant="body2" component="div" sx={{ flex: 1, minWidth: 0, color: 'text.secondary' }} noWrap>
        {/* The explanation hangs off the words alone, by hover. On the picker
            it would come back each time its menu hands focus back, and on a
            phone it would sit over the bar. */}
        <Tooltip title={tip} disableFocusListener disableTouchListener>
          <span>
            Viewing as
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> a team member</Box>
            {': '}
          </span>
        </Tooltip>
        <ViewAsPicker
          people={people}
          person={person}
          self={self}
          onPick={onPick}
          sx={{
            minHeight: 28, py: 0, px: 1, ml: -0.5, color: 'text.primary', fontWeight: 500, verticalAlign: 'baseline', '& .MuiButton-endIcon': { ml: 0 },
          }}
        />
      </Typography>
      <Button variant="text" size="small" onClick={onBack} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {/* One span, so the words read as one line ("Back to administrator"); a phone shows "Back". */}
        <span>
          Back
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}> to administrator</Box>
        </span>
      </Button>
    </Box>
  )
}
