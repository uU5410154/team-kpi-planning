import { FormControl, InputLabel, Select, MenuItem, Checkbox, ListItemText, ListSubheader, Divider, Typography } from '@mui/material'

/*
 * A FILTER DROPDOWN WITH A CHECKBOX PER CHOICE, so several can be ticked.
 *
 * `value` is the list ticked; an empty list means everything (nothing is cut).
 * `options` are { value, label, hint?, group? }; a change of `group` starts a
 * heading. `actions` are extra rows at the top ({ label, run }) — "Clear" is
 * always one of them. `summary(value)` may name the selection itself.
 *
 * The box reads "All…", the one name, two names, or "3 of 9".
 */
export default function CheckFilter({
  label, value, options, onChange, allLabel = 'All', actions = [], summary, minWidth = 140, sx, ...rest
}) {
  const id = `check-filter-${label.toLowerCase().replace(/\W+/g, '-')}`
  const nameOf = (v) => options.find((o) => o.value === v)?.label ?? v
  const shown = (sel) => {
    const own = summary?.(sel)
    if (own) return own
    if (!sel.length || sel.length === options.length) return allLabel
    if (sel.length <= 2) return sel.map(nameOf).join(', ')
    return `${sel.length} of ${options.length}`
  }
  const rows = [
    ...[{ label: 'Clear — show all', run: () => onChange([]) }, ...actions].map((a, i) => (
      <MenuItem key={`__act${i}`} value={`__act${i}`} dense sx={{ color: 'primary.main', fontSize: '0.8rem' }}>
        {a.label}
      </MenuItem>
    )),
    <Divider key="__div" />,
  ]
  let group
  for (const o of options) {
    if (o.group && o.group !== group) {
      group = o.group
      rows.push(<ListSubheader key={`__g${group}`} sx={{ lineHeight: '28px', fontSize: '0.72rem' }}>{group}</ListSubheader>)
    }
    rows.push(
      <MenuItem key={o.value} value={o.value} dense sx={{ py: 0 }}>
        <Checkbox size="small" checked={value.includes(o.value)} sx={{ p: 0.5, mr: 0.75 }} />
        <ListItemText primary={o.label} primaryTypographyProps={{ fontSize: '0.85rem' }} />
        {o.hint && <Typography component="span" variant="caption" sx={{ ml: 0.75, color: 'text.secondary' }}>{o.hint}</Typography>}
      </MenuItem>,
    )
  }
  const allActions = [{ run: () => onChange([]) }, ...actions]
  return (
    <FormControl size="small" sx={{ minWidth, ...sx }} {...rest}>
      {/* shrink + notched: with displayEmpty the box is never empty to the
          reader, but MUI reads the VALUE, so the label would sit on the text. */}
      <InputLabel shrink id={id}>{label}</InputLabel>
      <Select
        multiple
        notched
        displayEmpty
        labelId={id}
        label={label}
        value={value}
        renderValue={shown}
        MenuProps={{ PaperProps: { sx: { maxHeight: 440 } } }}
        onChange={(e) => {
          const next = typeof e.target.value === 'string' ? e.target.value.split(',') : e.target.value
          const act = next.find((v) => String(v).startsWith('__act'))
          if (act) { allActions[Number(act.slice(5))].run(); return }
          onChange(next)
        }}
      >
        {rows}
      </Select>
    </FormControl>
  )
}
