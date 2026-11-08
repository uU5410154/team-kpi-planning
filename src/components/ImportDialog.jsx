import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button,
  Table, TableBody, TableCell, TableHead, TableRow, Alert, Chip, IconButton, Divider,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ArrowRightAltIcon from '@mui/icons-material/ArrowRightAlt'

/**
 * What an import would do, before it does any of it.
 *
 * A file arriving from outside the app can carry anything, so nothing is
 * written until the user has read the list of changes. Everything the import
 * refused — a row the plan does not have, a value it cannot accept, a
 * calculated column somebody typed over — is stated here rather than dropped
 * silently, because a quiet refusal reads as a change that worked.
 */
export default function ImportDialog({ result, fileName, onApply, onClose }) {
  if (!result) return null

  const { changes = [], unknown = [], rejected = [], dupes = [], matched = 0, unchanged = 0, ignoredColumns = [] } = result
  const fieldCount = changes.reduce((a, c) => a + c.fields.length, 0)
  const nothing = changes.length === 0

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle sx={{ pr: 6 }}>
        Import projects
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          {fileName}
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {result.error ? <Alert severity="error">{result.error}</Alert> : null}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip size="small" color={nothing ? 'default' : 'primary'}
            label={`${changes.length} project${changes.length === 1 ? '' : 's'} to update`} />
          <Chip size="small" variant="outlined" label={`${fieldCount} field${fieldCount === 1 ? '' : 's'}`} />
          <Chip size="small" variant="outlined" label={`${matched} row${matched === 1 ? '' : 's'} matched`} />
          <Chip size="small" variant="outlined" label={`${unchanged} already the same`} />
        </Box>

        <Alert severity="info" sx={{ mb: 2 }}>
          Only the projects listed below change, and only the fields shown. Every other project, and
          everything else on these ones — tasks, cost schedules, roles, notes — is left as it is.
        </Alert>

        {nothing && !result.error ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Nothing to do — every row in the file already matches the plan.
          </Typography>
        ) : null}

        {changes.length ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 110 }}>Jira</TableCell>
                <TableCell>Project</TableCell>
                <TableCell sx={{ width: 150 }}>Field</TableCell>
                <TableCell align="right" sx={{ width: 110 }}>From</TableCell>
                <TableCell sx={{ width: 30 }} />
                <TableCell sx={{ width: 110 }}>To</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {changes.map((c) => c.fields.map((f, i) => (
                <TableRow key={`${c.key}-${f.label}`} hover>
                  <TableCell sx={{ fontWeight: 600 }}>{i === 0 ? c.key : ''}</TableCell>
                  <TableCell sx={{ color: i === 0 ? 'text.primary' : 'text.disabled' }}>
                    {i === 0 ? c.summary : ''}
                  </TableCell>
                  <TableCell>{f.label}</TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{f.from}</TableCell>
                  <TableCell><ArrowRightAltIcon fontSize="small" sx={{ color: 'text.disabled' }} /></TableCell>
                  <TableCell sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{f.to}</TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        ) : null}

        {(unknown.length || rejected.length || dupes.length || ignoredColumns.length) ? (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h4" sx={{ mb: 1 }}>Not imported</Typography>
          </>
        ) : null}

        {unknown.length ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {unknown.length} row{unknown.length === 1 ? '' : 's'} name a project the plan does not have, so
            {unknown.length === 1 ? ' it was' : ' they were'} skipped rather than created: {unknown.slice(0, 12).join(', ')}
            {unknown.length > 12 ? ` and ${unknown.length - 12} more` : ''}.
          </Alert>
        ) : null}

        {dupes.length ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            The same project appears more than once in the file; only the first was read: {dupes.join(', ')}.
          </Alert>
        ) : null}

        {rejected.length ? (
          <Alert severity="warning" sx={{ mb: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {rejected.length} cell{rejected.length === 1 ? '' : 's'} could not be used:
            </Typography>
            {rejected.slice(0, 10).map((r, i) => (
              <Typography key={i} variant="caption" sx={{ display: 'block' }}>
                {r.key} · {r.label} · &ldquo;{r.raw}&rdquo;{r.why ? ` — ${r.why}` : ''}
              </Typography>
            ))}
            {rejected.length > 10 ? (
              <Typography variant="caption" sx={{ display: 'block' }}>and {rejected.length - 10} more</Typography>
            ) : null}
          </Alert>
        ) : null}

        {ignoredColumns.length ? (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            Calculated columns in the file were read but not imported: {ignoredColumns.join(', ')}. They are worked
            out from the fields above, so importing them would let a stale copy overwrite the number it came from.
          </Typography>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={nothing} onClick={onApply}>
          {nothing ? 'Nothing to apply' : `Apply ${changes.length} update${changes.length === 1 ? '' : 's'}`}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
