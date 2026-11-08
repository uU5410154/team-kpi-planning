import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button,
  Table, TableBody, TableCell, TableHead, TableRow, IconButton, Tooltip,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ArrowRightAltIcon from '@mui/icons-material/ArrowRightAlt'
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined'
import { ErrorState } from './ui.jsx'
import { Spinner } from './Loading.jsx'

/**
 * What an import would do, before it does any of it.
 *
 * Two steps in one dialog. First the file: dropped on the box or picked from
 * the disk. Then the preview: a file arriving from outside the app can carry
 * anything, so nothing is written until the user has read the list of
 * changes. Everything the import refused — a row the plan does not have, a
 * value it cannot accept, a calculated column somebody typed over — is stated
 * here rather than dropped silently, because a quiet refusal reads as a
 * change that worked.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The file step: a drop area that also opens the file picker. */
function Choose({ busy, onChoose, onPick }) {
  const [over, setOver] = useState(false)
  return (
    <>
      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 4, maxWidth: '72ch' }}>
        Export the register, edit the rows in Excel, then bring the file back here. You see every change
        before anything is saved.
      </Typography>
      <Box
        role="button"
        tabIndex={0}
        aria-label="choose an Excel file to import"
        onClick={() => !busy && onChoose()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); onChoose() } }}
        onDragOver={(e) => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const file = e.dataTransfer?.files?.[0]
          if (file && !busy) onPick(file)
        }}
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          minHeight: 168,
          px: 4,
          py: 6,
          textAlign: 'center',
          border: '1px dashed',
          borderColor: over ? 'primary.main' : 'border.strong',
          borderRadius: '8px',
          bgcolor: over ? 'primary.tint' : 'transparent',
          cursor: busy ? 'progress' : 'pointer',
          transition: 'border-color 120ms, background-color 120ms',
          '&:hover': { borderColor: busy ? 'border.strong' : 'text.tertiary' },
        }}
      >
        {busy ? <Spinner size={24} /> : <UploadFileOutlinedIcon sx={{ fontSize: 24, color: 'text.tertiary' }} />}
        <Typography variant="body1" sx={{ fontWeight: 500 }}>
          {busy ? 'Reading the file…' : 'Drop an Excel file here'}
        </Typography>
        {!busy && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            or <Box component="span" sx={{ color: 'primary.text', fontWeight: 500 }}>choose a file</Box> (.xlsx exported from this page)
          </Typography>
        )}
      </Box>
    </>
  )
}

/** The preview step: what changes, what is left alone, what was refused. */
function Preview({ result }) {
  const { changes = [], unknown = [], rejected = [], dupes = [], matched = 0, unchanged = 0, ignoredColumns = [] } = result
  const fieldCount = changes.reduce((a, c) => a + c.fields.length, 0)
  const nothing = changes.length === 0
  const refused = unknown.length || rejected.length || dupes.length || ignoredColumns.length

  return (
    <>
      {result.error ? (
        <Box sx={{ mb: 4 }}>
          <ErrorState title="This file cannot be imported." body={`${result.error} Export the register again and edit that copy.`} />
        </Box>
      ) : null}

      {/* What the import comes to, as plain counts: none of these is a state. */}
      <Typography variant="body1" sx={{ fontWeight: 500 }}>
        {plural(changes.length, 'project')} to update, {plural(fieldCount, 'field')}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
        {plural(matched, 'row')} matched, {unchanged} already the same.
      </Typography>

      <Box sx={{
        mt: 4, mb: 4, px: 3, py: 2.5, bgcolor: 'bg.subtle', borderRadius: '8px',
      }}
      >
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '72ch' }}>
          Only the projects listed below change, and only the fields shown. Every other project, and
          everything else on these ones (tasks, cost schedules, roles, notes), stays as it is.
        </Typography>
      </Box>

      {nothing && !result.error ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Nothing to import: every row in the file already matches the plan.
        </Typography>
      ) : null}

      {/* A phone: one row a change, the values under the name. */}
      {changes.length ? (
        <Box
          component="ul"
          sx={{
            display: { xs: 'block', sm: 'none' }, m: 0, p: 0, listStyle: 'none', border: 1, borderColor: 'border.subtle', borderRadius: '8px',
          }}
        >
          {changes.map((c, ci) => (
            <Box component="li" key={c.key} sx={{ px: 3, py: 2.5, borderTop: ci ? 1 : 0, borderColor: 'border.subtle' }}>
              <Typography variant="body1" sx={{ fontWeight: 500 }}>{c.key}, {c.summary}</Typography>
              {c.fields.map((f) => (
                <Typography key={f.label} variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                  {f.label}: {f.from} <Box component="span" aria-label="becomes" sx={{ color: 'text.tertiary' }}>&rarr;</Box>{' '}
                  <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>{f.to}</Box>
                </Typography>
              ))}
            </Box>
          ))}
        </Box>
      ) : null}

      {changes.length ? (
        <Box sx={{
          display: { xs: 'none', sm: 'block' }, border: 1, borderColor: 'border.subtle', borderRadius: '8px', overflowX: 'auto',
        }}
        >
          <Table size="small" sx={{ minWidth: 560, '& td, & th': { whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 104 }}>Jira</TableCell>
                <TableCell>Project</TableCell>
                <TableCell sx={{ width: 140 }}>Field</TableCell>
                <TableCell align="right" sx={{ width: 110 }}>From</TableCell>
                <TableCell sx={{ width: 32, px: 0 }} />
                <TableCell sx={{ width: 110 }}>To</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {changes.map((c) => c.fields.map((f, i) => (
                <TableRow key={`${c.key}-${f.label}`} hover>
                  <TableCell sx={{ fontWeight: 500, borderTop: i === 0 ? 0 : undefined }}>{i === 0 ? c.key : ''}</TableCell>
                  <TableCell sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={i === 0 ? c.summary : undefined}>
                    {i === 0 ? c.summary : ''}
                  </TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{f.label}</TableCell>
                  <TableCell align="right" className="tabular" sx={{ color: 'text.secondary' }}>{f.from}</TableCell>
                  <TableCell sx={{ px: 0 }}><ArrowRightAltIcon sx={{ fontSize: 18, color: 'text.tertiary', display: 'block' }} /></TableCell>
                  <TableCell className="tabular" sx={{ fontWeight: 500 }}>{f.to}</TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </Box>
      ) : null}

      {refused ? (
        <Box sx={{ mt: 5 }}>
          <Typography variant="h3" sx={{ mb: 2 }}>Not imported</Typography>
          <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none', '& > li + li': { borderTop: 1, borderColor: 'border.subtle' } }}>
            {unknown.length ? (
              <Line>
                {plural(unknown.length, 'row')} {unknown.length === 1 ? 'names a project' : 'name projects'} the plan does not have, so
                {unknown.length === 1 ? ' it was' : ' they were'} skipped rather than created: {unknown.slice(0, 12).join(', ')}
                {unknown.length > 12 ? ` and ${unknown.length - 12} more` : ''}.
              </Line>
            ) : null}
            {dupes.length ? (
              <Line>The same project appears more than once in the file; only the first was read: {dupes.join(', ')}.</Line>
            ) : null}
            {rejected.length ? (
              <Line>
                {plural(rejected.length, 'cell')} could not be used:
                {rejected.slice(0, 10).map((r, i) => (
                  <Typography key={i} variant="caption" component="span" sx={{ display: 'block', color: 'text.secondary' }}>
                    {r.key}, {r.label}: &ldquo;{r.raw}&rdquo;{r.why ? `. ${r.why}` : ''}
                  </Typography>
                ))}
                {rejected.length > 10 ? (
                  <Typography variant="caption" component="span" sx={{ display: 'block', color: 'text.secondary' }}>and {rejected.length - 10} more</Typography>
                ) : null}
              </Line>
            ) : null}
            {ignoredColumns.length ? (
              <Line muted>
                Calculated columns were read but not imported: {ignoredColumns.join(', ')}. They are worked out from
                the fields above, so importing them would let a stale copy overwrite the number it came from.
              </Line>
            ) : null}
          </Box>
        </Box>
      ) : null}
    </>
  )
}

function Line({ children, muted = false }) {
  return (
    <Box component="li" sx={{ display: 'flex', gap: 2, py: 2 }}>
      <Box
        aria-hidden
        sx={(t) => ({
          width: 6, height: 6, borderRadius: '50%', mt: '6px', flexShrink: 0, bgcolor: muted ? t.palette.tone.neutral.solid : t.palette.tone.warning.solid,
        })}
      />
      <Typography variant="body2" component="div" sx={{ color: muted ? 'text.secondary' : 'text.primary', minWidth: 0 }}>{children}</Typography>
    </Box>
  )
}

export default function ImportDialog({
  result, fileName, choosing = false, busy = false, onChoose, onPick, onApply, onClose,
}) {
  if (!result && !choosing) return null
  const changes = result?.changes || []
  const nothing = changes.length === 0

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth scroll="paper" aria-labelledby="import-title">
      <DialogTitle id="import-title" sx={{ pr: 14 }}>
        Import projects
        {result && fileName ? (
          <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.5, overflowWrap: 'anywhere' }}>
            {fileName}
          </Typography>
        ) : null}
        <Tooltip title="Close">
          <IconButton onClick={onClose} aria-label="close" sx={{ position: 'absolute', right: 12, top: 14, color: 'text.secondary' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers>
        {result ? <Preview result={result} /> : <Choose busy={busy} onChoose={onChoose} onPick={onPick} />}
      </DialogContent>

      <DialogActions>
        {result && !result.error && choosing ? (
          <Button onClick={onChoose} sx={{ mr: 'auto' }}>Choose another file</Button>
        ) : null}
        <Button onClick={onClose}>Cancel</Button>
        {result ? (
          <Button variant="contained" disabled={nothing} onClick={onApply}>
            {nothing ? 'Nothing to import' : `Import ${plural(changes.length, 'row')}`}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
