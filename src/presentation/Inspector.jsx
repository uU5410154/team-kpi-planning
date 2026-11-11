import { useRef } from 'react'
import {
  Box, Typography, TextField, ToggleButton, ToggleButtonGroup, IconButton, Button, MenuItem, Select, Slider, Tooltip,
  Divider, Switch, FormControlLabel, Autocomplete, Stack,
} from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft'
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter'
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight'
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop'
import VerticalAlignCenterIcon from '@mui/icons-material/VerticalAlignCenter'
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom'
import FlipToFrontIcon from '@mui/icons-material/FlipToFront'
import FlipToBackIcon from '@mui/icons-material/FlipToBack'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ImageIcon from '@mui/icons-material/ImageOutlined'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import AlignHorizontalLeftIcon from '@mui/icons-material/AlignHorizontalLeft'
import AlignHorizontalCenterIcon from '@mui/icons-material/AlignHorizontalCenter'
import AlignHorizontalRightIcon from '@mui/icons-material/AlignHorizontalRight'
import AlignVerticalTopIcon from '@mui/icons-material/AlignVerticalTop'
import AlignVerticalCenterIcon from '@mui/icons-material/AlignVerticalCenter'
import AlignVerticalBottomIcon from '@mui/icons-material/AlignVerticalBottom'
import { SWATCHES, FILL_SWATCHES, STATUS_NAMES, BACKGROUNDS } from './theme.js'
import { newId } from './templates.js'

/*
 * THE RIGHT-HAND PANEL: what is selected, and every way to change it.
 *
 * Text: size in points as PowerPoint counts them, bold, italic, underline,
 * alignment, colour from the deck's palette. Any element: its exact position
 * and size. A project card, the roadmap and a task timeline also keep their
 * project — refreshed from the app, drafted by the AI, or opened.
 */

const Section = ({ title, children, right }) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.6, flex: 1 }}>{title}</Typography>
      {right}
    </Box>
    {children}
  </Box>
)

const Num = ({ label, value, onChange, step = 1, min, max, width = 72 }) => (
  <TextField
    size="small" label={label} type="number" value={Number.isFinite(value) ? Math.round(value * 100) / 100 : ''}
    onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(n)) onChange(n) }}
    inputProps={{ step, min, max }} sx={{ width }}
  />
)

function Swatches({ value, options, onPick, none = false, label }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }} role="group" aria-label={label}>
      {none && (
        <Tooltip title="None">
          <Box
            component="button" type="button" onClick={() => onPick(undefined)} aria-label="no colour"
            sx={{
              width: 22, height: 22, borderRadius: 0.75, border: 1, borderColor: !value ? 'primary.main' : 'divider', cursor: 'pointer',
              background: 'linear-gradient(135deg, transparent 45%, #e5484d 45%, #e5484d 55%, transparent 55%)', bgcolor: 'transparent',
            }}
          />
        </Tooltip>
      )}
      {options.map((c) => (
        <Box
          key={c} component="button" type="button" onClick={() => onPick(c)} aria-label={c} title={c}
          sx={{
            width: 22, height: 22, borderRadius: 0.75, bgcolor: c, cursor: 'pointer', p: 0,
            border: 2, borderColor: value?.toLowerCase() === c.toLowerCase() ? 'primary.main' : 'rgba(127,127,127,0.35)',
          }}
        />
      ))}
      <Box
        component="input" type="color" value={value || '#000000'} onChange={(e) => onPick(e.target.value.toUpperCase())}
        aria-label={`${label}: any colour`}
        sx={{ width: 26, height: 24, p: 0, border: 0, bgcolor: 'transparent', cursor: 'pointer' }}
      />
    </Box>
  )
}

const linesOf = (v) => (Array.isArray(v) ? v : String(v || '').split('\n')).join('\n')
const toLines = (s) => String(s).split('\n').map((x) => x.replace(/^•\s*/, ''))

/* -------------------------------------------------------------- the panel */

export default function Inspector({
  slide, selected, projects, onPatch, onSlide, onDelete, onDuplicate, onLayer, onAlign,
  onUpload, onRefreshCard, onDraft, onOpenProject, onAddRows, onReloadTasks, onRefreshRoadmap, aiOn,
}) {
  const els = slide.elements.filter((e) => selected.includes(e.id))
  const fileRef = useRef(null)
  const byKey = Object.fromEntries((projects || []).map((p) => [p.key, p]))

  if (!els.length) {
    return (
      <Box>
        <Section title="Slide">
          <TextField
            select size="small" fullWidth label="Background" value={slide.bg || 'light'}
            onChange={(e) => onSlide((s) => ({ ...s, bg: e.target.value }))} sx={{ mb: 1.5 }}
          >
            {Object.entries(BACKGROUNDS).map(([k, v]) => <MenuItem key={k} value={k}>{v.label}</MenuItem>)}
          </TextField>
          <FormControlLabel
            control={<Switch size="small" checked={!!slide.hidden} onChange={(e) => onSlide((s) => ({ ...s, hidden: e.target.checked }))} />}
            label={<Typography variant="body2">Hide when presenting</Typography>}
          />
        </Section>
        <Section title="Speaker notes">
          <TextField
            multiline minRows={4} maxRows={14} fullWidth size="small" placeholder="What to say on this slide — only you see it"
            value={slide.notes || ''} onChange={(e) => onSlide((s) => ({ ...s, notes: e.target.value }), 'notes')}
          />
        </Section>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.6 }}>
          Click anything on the slide to change it. Double-click text to type. Drag to move; pull a corner to resize.
          Paste a screenshot (Ctrl/⌘ V) to put it on the slide. Undo with Ctrl/⌘ Z.
        </Typography>
      </Box>
    )
  }

  const tools = (
    <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5, flexWrap: 'wrap' }}>
      <Tooltip title="Bring to front"><IconButton size="small" onClick={() => onLayer('front')} aria-label="bring to front"><FlipToFrontIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Send to back"><IconButton size="small" onClick={() => onLayer('back')} aria-label="send to back"><FlipToBackIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Duplicate (Ctrl/⌘ D)"><IconButton size="small" onClick={onDuplicate} aria-label="duplicate"><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
      <Tooltip title="Delete (Del)"><IconButton size="small" onClick={onDelete} aria-label="delete"><DeleteOutlineIcon fontSize="small" /></IconButton></Tooltip>
    </Box>
  )

  if (els.length > 1) {
    return (
      <Box>
        <Section title={`${els.length} selected`}>
          {tools}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Line up</Typography>
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
            {[
              ['left', AlignHorizontalLeftIcon], ['hcenter', AlignHorizontalCenterIcon], ['right', AlignHorizontalRightIcon],
              ['top', AlignVerticalTopIcon], ['vcenter', AlignVerticalCenterIcon], ['bottom', AlignVerticalBottomIcon],
            ].map(([k, Icon]) => (
              <Tooltip key={k} title={`Align ${k.replace('h', '').replace('v', '')}`}>
                <IconButton size="small" onClick={() => onAlign(k)} aria-label={`align ${k}`}><Icon fontSize="small" /></IconButton>
              </Tooltip>
            ))}
          </Box>
          {els.every((e) => e.type === 'text') && (
            <Box sx={{ mt: 1.5 }}>
              <Num
                label="Text size (pt)" width={120} step={0.5} value={els[0].style?.fontSize || 12}
                onChange={(n) => onPatch(els.map((e) => e.id), (e) => ({ ...e, style: { ...e.style, fontSize: n } }))}
              />
            </Box>
          )}
        </Section>
      </Box>
    )
  }

  const el = els[0]
  const s = el.style || {}
  const set = (fn) => onPatch([el.id], fn)
  const style = (patch) => set((e) => ({ ...e, style: { ...e.style, ...patch } }))
  const data = (patch) => set((e) => ({ ...e, data: { ...e.data, ...patch } }))

  const geometry = (
    <Section title="Position and size">
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Num label="X" value={el.x} onChange={(n) => set((e) => ({ ...e, x: n }))} />
        <Num label="Y" value={el.y} onChange={(n) => set((e) => ({ ...e, y: n }))} />
        <Num label="Width" value={el.w} onChange={(n) => set((e) => ({ ...e, w: Math.max(4, n) }))} />
        <Num label="Height" value={el.h} onChange={(n) => set((e) => ({ ...e, h: Math.max(4, n) }))} />
      </Box>
    </Section>
  )

  const textScale = (
    <Box sx={{ px: 1, mb: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Text size {Math.round((s.scale || 1) * 100)}%</Typography>
      <Slider size="small" min={0.5} max={1.8} step={0.05} value={s.scale || 1} onChange={(_e, v) => style({ scale: v })} aria-label="text size" />
    </Box>
  )

  const projectPick = (value, onPick, label = 'Project') => (
    <Autocomplete
      size="small"
      options={projects}
      value={byKey[value] || null}
      getOptionLabel={(p) => `${p.key} · ${p.summary || ''}`}
      onChange={(_e, p) => p && onPick(p)}
      renderInput={(params) => <TextField {...params} label={label} />}
      sx={{ mb: 1.5 }}
      isOptionEqualToValue={(a, b) => a.key === b.key}
    />
  )

  return (
    <Box>
      <Section title={{ text: 'Text box', rect: 'Shape', image: 'Picture', card: 'Project card', roadmap: 'Roadmap', tasks: 'Task timeline', pill: 'Status', thanks: 'Thank-you art' }[el.type] || 'Element'}>
        {tools}
      </Section>

      {el.type === 'text' && (
        <>
          <Section title="Text">
            <TextField multiline minRows={2} maxRows={10} fullWidth size="small" value={el.text || ''} onChange={(e) => set((x) => ({ ...x, text: e.target.value }), 'text')} sx={{ mb: 1.5 }} />
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 1.25 }}>
              <Num label="Size (pt)" width={92} step={0.5} min={4} value={s.fontSize || 12} onChange={(n) => style({ fontSize: n })} />
              <ToggleButtonGroup size="small" value={['bold', 'italic', 'underline'].filter((k) => s[k])} onChange={(_e, v) => style({ bold: v.includes('bold'), italic: v.includes('italic'), underline: v.includes('underline') })}>
                <ToggleButton value="bold" aria-label="bold"><FormatBoldIcon fontSize="small" /></ToggleButton>
                <ToggleButton value="italic" aria-label="italic"><FormatItalicIcon fontSize="small" /></ToggleButton>
                <ToggleButton value="underline" aria-label="underline"><FormatUnderlinedIcon fontSize="small" /></ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
              <ToggleButtonGroup size="small" exclusive value={s.align || 'left'} onChange={(_e, v) => v && style({ align: v })}>
                <ToggleButton value="left" aria-label="align left"><FormatAlignLeftIcon fontSize="small" /></ToggleButton>
                <ToggleButton value="center" aria-label="align centre"><FormatAlignCenterIcon fontSize="small" /></ToggleButton>
                <ToggleButton value="right" aria-label="align right"><FormatAlignRightIcon fontSize="small" /></ToggleButton>
              </ToggleButtonGroup>
              <ToggleButtonGroup size="small" exclusive value={s.valign || 'top'} onChange={(_e, v) => v && style({ valign: v })}>
                <ToggleButton value="top" aria-label="top"><VerticalAlignTopIcon fontSize="small" /></ToggleButton>
                <ToggleButton value="middle" aria-label="middle"><VerticalAlignCenterIcon fontSize="small" /></ToggleButton>
                <ToggleButton value="bottom" aria-label="bottom"><VerticalAlignBottomIcon fontSize="small" /></ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Colour</Typography>
            <Swatches label="text colour" value={s.color} options={SWATCHES} onPick={(c) => style({ color: c })} />
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>Fill</Typography>
            <Swatches label="fill" none value={s.fill} options={FILL_SWATCHES} onPick={(c) => style({ fill: c })} />
            <Box sx={{ px: 1, mt: 1 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>Line spacing {(s.lineHeight || 1.2).toFixed(2)}</Typography>
              <Slider size="small" min={0.9} max={2.6} step={0.05} value={s.lineHeight || 1.2} onChange={(_e, v) => style({ lineHeight: v })} aria-label="line spacing" />
            </Box>
          </Section>
        </>
      )}

      {el.type === 'rect' && (
        <Section title="Shape">
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Fill</Typography>
          <Swatches label="fill" none value={s.fill} options={FILL_SWATCHES} onPick={(c) => style({ fill: c })} />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>Border</Typography>
          <Swatches label="border" none value={s.border} options={SWATCHES} onPick={(c) => style({ border: c })} />
          <Box sx={{ display: 'flex', gap: 1, mt: 1.25, alignItems: 'center' }}>
            <Num label="Border px" value={s.borderWidth ?? 1} step={0.5} min={0} onChange={(n) => style({ borderWidth: n })} width={92} />
            <Num label="Corners" value={s.radius || 0} min={0} onChange={(n) => style({ radius: n })} width={84} />
            <FormControlLabel control={<Switch size="small" checked={!!s.dashed} onChange={(e) => style({ dashed: e.target.checked })} />} label={<Typography variant="body2">Dashed</Typography>} />
          </Box>
        </Section>
      )}

      {el.type === 'image' && (
        <Section title="Picture">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onUpload(f, el.id) }} />
          <Button size="small" variant="outlined" startIcon={<ImageIcon />} onClick={() => fileRef.current?.click()} sx={{ mb: 1.25 }}>
            {el.data?.asset || el.data?.brand ? 'Replace picture' : 'Choose picture'}
          </Button>
          <TextField select size="small" fullWidth label="Fit" value={el.data?.fit || 'contain'} onChange={(e) => data({ fit: e.target.value })} sx={{ mb: 1.25 }}>
            <MenuItem value="contain">Whole picture</MenuItem>
            <MenuItem value="cover">Fill the box (crop)</MenuItem>
          </TextField>
          <TextField select size="small" fullWidth label="Or a deck picture" value={el.data?.brand || ''} onChange={(e) => data({ brand: e.target.value || null, asset: e.target.value ? null : el.data?.asset })}>
            <MenuItem value="">—</MenuItem>
            <MenuItem value="logo">Company logo</MenuItem>
            <MenuItem value="cover">Cover illustration</MenuItem>
            <MenuItem value="finance">Finance divider</MenuItem>
            <MenuItem value="accounting">Accounting divider</MenuItem>
          </TextField>
        </Section>
      )}

      {el.type === 'pill' && (
        <Section title="Status">
          <TextField select size="small" fullWidth value={el.data?.status || 'On Track'} onChange={(e) => data({ status: e.target.value })} sx={{ mb: 1.25 }}>
            {STATUS_NAMES.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
          </TextField>
          <Num label="Size (pt)" width={92} step={0.5} value={s.fontSize || 6.75} onChange={(n) => style({ fontSize: n })} />
        </Section>
      )}

      {el.type === 'card' && (
        <Section title="Card">
          {projectPick(el.data?.projectKey, (p) => onRefreshCard(el, p))}
          <TextField size="small" fullWidth label="Project name" value={el.data?.title || ''} onChange={(e) => data({ title: e.target.value })} sx={{ mb: 1.25 }} />
          <Box sx={{ display: 'flex', gap: 1, mb: 1.25 }}>
            <TextField select size="small" label="Status" value={el.data?.status || ''} onChange={(e) => data({ status: e.target.value })} sx={{ flex: 1 }}>
              <MenuItem value="">(none)</MenuItem>
              {STATUS_NAMES.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
            </TextField>
            <ToggleButtonGroup size="small" exclusive value={s.tone || 'blue'} onChange={(_e, v) => v && style({ tone: v })} aria-label="card colour">
              <ToggleButton value="blue" sx={{ px: 1.25 }}><Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: '#0071CD' }} /></ToggleButton>
              <ToggleButton value="yellow" sx={{ px: 1.25 }}><Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: '#FFC01F' }} /></ToggleButton>
            </ToggleButtonGroup>
          </Box>
          {[['accomplishment', 'Accomplishment'], ['impact', 'Impact'], ['next', 'Next milestone']].map(([k, label]) => (
            <TextField
              key={k} multiline minRows={2} maxRows={6} size="small" fullWidth label={label} helperText={k === 'accomplishment' ? 'One point per line' : undefined}
              value={linesOf(el.data?.[k])} onChange={(e) => data({ [k]: toLines(e.target.value) })} sx={{ mb: 1.25 }}
            />
          ))}
          <TextField size="small" fullWidth label="Target date" value={el.data?.target || ''} onChange={(e) => data({ target: e.target.value })} sx={{ mb: 1 }} />
          {textScale}
          <Stack spacing={1}>
            <Button size="small" variant="outlined" startIcon={<RefreshIcon />} disabled={!el.data?.projectKey} onClick={() => onRefreshCard(el)}>
              Refresh from the app
            </Button>
            {aiOn && (
              <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} disabled={!el.data?.projectKey} onClick={() => onDraft([el.id])}>
                Draft the card with AI
              </Button>
            )}
            <Button size="small" startIcon={<OpenInNewIcon />} disabled={!el.data?.projectKey} onClick={() => onOpenProject(el.data.projectKey)}>
              Project details
            </Button>
          </Stack>
        </Section>
      )}

      {el.type === 'roadmap' && (
        <Section
          title="Roadmap rows"
          right={<Num label="Year" width={84} value={el.data?.year} onChange={(n) => data({ year: Math.round(n) })} />}
        >
          {(el.data?.rows || []).map((r, i) => (
            <Box key={r.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1, mb: 0.75 }}>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                <TextField
                  size="small" variant="standard" fullWidth placeholder={r.group ? 'Group heading' : 'Initiative'}
                  value={r.group != null ? r.group : r.label}
                  onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? (x.group != null ? { ...x, group: e.target.value } : { ...x, label: e.target.value }) : x)) })}
                  inputProps={{ style: { fontWeight: r.group != null ? 700 : 400 } }}
                />
                <IconButton size="small" aria-label="remove row" onClick={() => data({ rows: el.data.rows.filter((_x, j) => j !== i) })}><CloseIcon fontSize="small" /></IconButton>
              </Box>
              {r.group == null && (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.75, mt: 0.75 }}>
                  <Select size="small" value={r.status || ''} displayEmpty onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, status: e.target.value } : x)) })}>
                    <MenuItem value="">(no status)</MenuItem>
                    {STATUS_NAMES.map((n) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                  </Select>
                  <Select size="small" value={r.tone || 'blue'} onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, tone: e.target.value } : x)) })}>
                    <MenuItem value="blue">Blue bar</MenuItem>
                    <MenuItem value="yellow">Yellow bar</MenuItem>
                    <MenuItem value="green">Green bar</MenuItem>
                  </Select>
                  <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={r.start || ''} onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} />
                  <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={r.end || ''} onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} />
                  <TextField size="small" label="Bar text" value={r.bar || ''} onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, bar: e.target.value } : x)) })} sx={{ gridColumn: 'span 2' }} />
                </Box>
              )}
            </Box>
          ))}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <Button size="small" startIcon={<AddIcon />} onClick={() => onAddRows(el)}>Projects</Button>
            <Button size="small" startIcon={<AddIcon />} onClick={() => data({ rows: [...(el.data?.rows || []), { id: newId(), group: 'Group' }] })}>Heading</Button>
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => onRefreshRoadmap(el)}>Refresh dates</Button>
          </Box>
          <Divider sx={{ my: 1.5 }} />
          {textScale}
        </Section>
      )}

      {el.type === 'tasks' && (
        <Section title="Task timeline">
          {projectPick(el.data?.projectKey, (p) => onReloadTasks(el, p))}
          <Box sx={{ display: 'flex', gap: 1, mb: 1.25 }}>
            <TextField size="small" type="date" label="From" InputLabelProps={{ shrink: true }} value={el.data?.from || ''} onChange={(e) => data({ from: e.target.value })} />
            <TextField size="small" type="date" label="To" InputLabelProps={{ shrink: true }} value={el.data?.to || ''} onChange={(e) => data({ to: e.target.value })} />
          </Box>
          <FormControlLabel control={<Switch size="small" checked={el.data?.today !== false} onChange={(e) => data({ today: e.target.checked })} />} label={<Typography variant="body2">Show today</Typography>} />
          <Box sx={{ mt: 1 }}>
            {(el.data?.rows || []).map((r, i) => (
              <Box key={r.id} sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 0.5 }}>
                <TextField
                  size="small" variant="standard" sx={{ flex: 1 }} value={r.label}
                  inputProps={{ style: { fontWeight: r.group ? 700 : 400, fontSize: 13 } }}
                  onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
                />
                {!r.group && (
                  <>
                    <TextField size="small" variant="standard" type="date" value={r.start || ''} onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)) })} sx={{ width: 118 }} inputProps={{ style: { fontSize: 12 } }} />
                    <TextField size="small" variant="standard" type="date" value={r.end || ''} onChange={(e) => data({ rows: el.data.rows.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)) })} sx={{ width: 118 }} inputProps={{ style: { fontSize: 12 } }} />
                  </>
                )}
                <IconButton size="small" aria-label="remove row" onClick={() => data({ rows: el.data.rows.filter((_x, j) => j !== i) })}><CloseIcon fontSize="small" /></IconButton>
              </Box>
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            <Button size="small" startIcon={<AddIcon />} onClick={() => data({ rows: [...(el.data?.rows || []), { id: newId(), label: 'New task', start: el.data?.from, end: el.data?.from }] })}>Task</Button>
            <Button size="small" startIcon={<AddIcon />} onClick={() => data({ rows: [...(el.data?.rows || []), { id: newId(), group: true, label: 'Group' }] })}>Heading</Button>
            <Button size="small" startIcon={<RefreshIcon />} disabled={!el.data?.projectKey} onClick={() => onReloadTasks(el)}>Reload from Jira</Button>
          </Box>
          <Divider sx={{ my: 1.5 }} />
          {textScale}
        </Section>
      )}

      {geometry}
    </Box>
  )
}
