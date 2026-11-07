import {
  Alert, Box, Button, FormControl, InputLabel, MenuItem, Select, Typography,
} from '@mui/material'

/*
 * "VIEWING AS A TEAM MEMBER" — and which one.
 *
 * An administrator picks anybody on the team and sees exactly what that
 * person is sent: their Weekly page (their Jira week), their projects on the
 * Timeline, their scorecard. Read only: the server answers the preview's reads
 * as that member and refuses nothing it would not refuse the administrator,
 * and the week comes back not writable.
 */
export default function ViewAsBanner({
  people = [], person = null, self = null, onPick, onBack,
}) {
  const team = people.filter((p) => p && p.id && !p.deleted)
  const nick = team.find((p) => p.id === person)?.nick || null
  return (
    <Alert
      severity="info"
      variant="outlined"
      data-view-as={person || ''}
      sx={{ mb: 2.5, alignItems: 'center', '& .MuiAlert-message': { flex: 1, minWidth: 0 } }}
      action={<Button color="inherit" size="small" onClick={onBack}>Back to administrator</Button>}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <strong>Viewing as {nick ? `${nick}, a team member` : 'a team member'}.</strong>{' '}
          {person
            ? `This is what ${person === self ? 'your team sees, with your own week' : `${nick || person} sees — their week and their projects`}. Read only: nothing you do here changes anything.`
            : 'Pick somebody to see their week and their projects exactly as they do.'}
        </Typography>
        <FormControl size="small" sx={{ minWidth: 170 }}>
          <InputLabel id="view-as-label">View as</InputLabel>
          <Select
            labelId="view-as-label"
            label="View as"
            value={person || ''}
            onChange={(e) => onPick?.(e.target.value || null)}
            inputProps={{ 'aria-label': 'view as which member' }}
          >
            {team.map((p) => (
              <MenuItem key={p.id} value={p.id}>{p.nick || p.name || p.id}{p.id === self ? ' (you)' : ''}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>
    </Alert>
  )
}
