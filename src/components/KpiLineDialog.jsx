import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button,
  TextField, MenuItem, Select, FormControl, InputLabel, FormHelperText, IconButton, InputAdornment, Tooltip,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { OBJECTIVES, OBJ_BY_ID } from '../lib/palette.js'
import { TARGET_KINDS, isNumericKind, newCustomLine } from '../lib/model.js'

/**
 * Add or edit a KPI line somebody sets by hand.
 *
 * Two things it exists for. A scorecard has to be able to carry work the
 * project register cannot count — a milestone, a service level, a number of
 * somethings — and that target has to be expressible in its own unit rather
 * than forced into saving hours. And it can be TIED to an objective, so the
 * line filters the portfolio and reports under the objective it belongs to,
 * the same as any derived line.
 */
export default function KpiLineDialog({
  open, line, symbol = '฿', onSave, onClose,
}) {
  const [draft, setDraft] = useState(() => line || newCustomLine())
  const [touched, setTouched] = useState(false)
  if (!open) return null

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }))
  const numeric = isNumericKind(draft.targetKind)
  const kind = TARGET_KINDS.find((k) => k.id === draft.targetKind)
  const labelBad = touched && !String(draft.label || '').trim()

  const unitFor = () => {
    if (draft.targetKind === 'thb') return `${symbol}/year`
    if (draft.targetKind === 'hours') return 'hrs/month'
    return draft.unit || ''
  }

  const save = () => {
    if (!String(draft.label || '').trim()) { setTouched(true); return }
    onSave({
      ...draft,
      label: draft.label.trim(),
      target: numeric ? Number(draft.target) || 0 : String(draft.target ?? '').trim(),
      unit: draft.targetKind === 'number' ? String(draft.unit || '').trim() : '',
    })
  }

  const editing = !!line?.label

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="kpi-line-title">
      <DialogTitle id="kpi-line-title" sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {editing ? 'Edit KPI line' : 'Add KPI line'}
          <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.5, fontWeight: 400 }}>
            It shares the card&rsquo;s 100% of weight with the other lines.
          </Typography>
        </Box>
        <Tooltip title="Close">
          <IconButton onClick={onClose} aria-label="Close" sx={{ width: 32, height: 32, mr: -1, color: 'text.secondary' }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent>
        <Box
          component="form"
          noValidate
          onSubmit={(e) => { e.preventDefault(); save() }}
          sx={{
            display: 'flex', flexDirection: 'column', gap: 3, pt: 1,
          }}
        >
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="What is the KPI"
            placeholder="Close the books within three working days"
            value={draft.label}
            error={labelBad}
            helperText={labelBad ? 'Give the KPI a name.' : 'How it reads on the scorecard'}
            onChange={(e) => set({ label: e.target.value })}
          />

          <FormControl fullWidth size="small">
            <InputLabel id="kpi-objective">Objective (optional)</InputLabel>
            <Select
              labelId="kpi-objective"
              label="Objective (optional)"
              value={draft.objective || ''}
              onChange={(e) => set({ objective: e.target.value || null })}
            >
              <MenuItem value="">
                <em>Stands on its own</em>
              </MenuItem>
              {OBJECTIVES.map((o) => (
                <MenuItem key={o.id} value={o.id}>{o.no}. {o.name}</MenuItem>
              ))}
            </Select>
            <FormHelperText>
              {draft.objective
                ? `Reports under ${OBJ_BY_ID[draft.objective]?.name}, and clicking the line filters the portfolio to it.`
                : 'Carries weight on the card but belongs to no objective.'}
            </FormHelperText>
          </FormControl>

          <Box sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: {
              xs: '1fr',
              sm: draft.targetKind === 'number' ? '1fr 120px 1fr' : '1fr 1fr',
            },
            alignItems: 'start',
          }}
          >
            <FormControl size="small" fullWidth>
              <InputLabel id="kpi-kind">Measured in</InputLabel>
              <Select
                labelId="kpi-kind"
                label="Measured in"
                value={draft.targetKind}
                onChange={(e) => {
                  const next = e.target.value
                  // Switching between a number and a sentence cannot carry the
                  // old value across without turning "by Nov 2026" into 0.
                  set({ targetKind: next, target: isNumericKind(next) === numeric ? draft.target : (isNumericKind(next) ? 0 : '') })
                }}
              >
                {TARGET_KINDS.map((k) => <MenuItem key={k.id} value={k.id}>{k.label}</MenuItem>)}
              </Select>
              <FormHelperText>{kind?.help}</FormHelperText>
            </FormControl>

            {draft.targetKind === 'number' && (
              <TextField
                size="small"
                label="Unit"
                placeholder="days"
                value={draft.unit || ''}
                onChange={(e) => set({ unit: e.target.value })}
              />
            )}

            {draft.targetKind === 'date' ? (
              <TextField
                size="small"
                type="date"
                label="Target"
                value={draft.target || ''}
                onChange={(e) => set({ target: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            ) : numeric ? (
              <TextField
                size="small"
                label="Target"
                value={draft.target ?? ''}
                onChange={(e) => set({ target: e.target.value.replace(/[^\d.-]/g, '') })}
                InputProps={unitFor()
                  ? {
                    endAdornment: (
                      <InputAdornment position="end">
                        <Typography variant="body2" component="span" sx={{ color: 'text.secondary' }}>{unitFor()}</Typography>
                      </InputAdornment>
                    ),
                  }
                  : undefined}
                inputProps={{ inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
              />
            ) : (
              <TextField
                size="small"
                label="Target"
                placeholder="Live by November 2026"
                value={draft.target ?? ''}
                onChange={(e) => set({ target: e.target.value })}
              />
            )}
          </Box>

          <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '72ch' }}>
            Adding a line takes weight from the others so the card still totals 100%. Set its weight on the
            scorecard, next to the target.
          </Typography>
          {/* Enter in any field submits, the same as the button. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </Box>
      </DialogContent>

      <DialogActions>
        {labelBad && (
          <Typography variant="body2" sx={(t) => ({ color: t.palette.tone.danger.fg, mr: 'auto' })}>
            Fill in the marked field.
          </Typography>
        )}
        <Button variant="text" onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
