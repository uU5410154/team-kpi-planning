import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button,
  TextField, MenuItem, Select, FormControl, InputLabel, IconButton, Alert, InputAdornment,
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
export default function KpiLineDialog({ open, line, symbol = '฿', onSave, onClose }) {
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

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pr: 6 }}>
        {line?.label ? 'Edit KPI line' : 'Add a KPI line'}
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          It joins the same 100% as the rest of the card
        </Typography>
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 8, top: 8 }} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        <TextField
          autoFocus
          fullWidth
          size="small"
          label="What is the KPI"
          placeholder="Close the books within three working days"
          value={draft.label}
          error={labelBad}
          helperText={labelBad ? 'A KPI needs a name' : 'How it will read on the scorecard'}
          onChange={(e) => set({ label: e.target.value })}
          sx={{ mb: 2.5 }}
        />

        <FormControl fullWidth size="small" sx={{ mb: 2.5 }}>
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
        </FormControl>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: -2, mb: 2.5 }}>
          {draft.objective
            ? `Tied to ${OBJ_BY_ID[draft.objective]?.name} — clicking the line filters the portfolio to that objective, and it reports under it.`
            : 'Untied: it appears on the scorecard and carries weight, but belongs to no objective.'}
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 170 }}>
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
          </FormControl>

          {draft.targetKind === 'number' && (
            <TextField
              size="small"
              label="Unit"
              placeholder="days, %, reports"
              value={draft.unit || ''}
              onChange={(e) => set({ unit: e.target.value })}
              sx={{ width: 140 }}
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
              sx={{ width: 180 }}
            />
          ) : numeric ? (
            <TextField
              size="small"
              label="Target"
              value={draft.target ?? ''}
              onChange={(e) => set({ target: e.target.value.replace(/[^\d.-]/g, '') })}
              InputProps={unitFor()
                ? { endAdornment: <InputAdornment position="end"><Typography variant="caption">{unitFor()}</Typography></InputAdornment> }
                : undefined}
              sx={{ width: 200 }}
            />
          ) : (
            <TextField
              size="small"
              label="Target"
              placeholder="Live by November 2026"
              value={draft.target ?? ''}
              onChange={(e) => set({ target: e.target.value })}
              sx={{ minWidth: 240, flex: 1 }}
            />
          )}
        </Box>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
          {kind?.help}
        </Typography>

        <Alert severity="info" sx={{ mt: 2.5 }}>
          Adding a line takes weight from the others so the card still totals 100%. Set the weight itself on the
          scorecard, next to the target.
        </Alert>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
