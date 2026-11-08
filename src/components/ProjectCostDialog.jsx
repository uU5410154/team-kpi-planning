import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button, IconButton,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Select, MenuItem, Tooltip,
  Divider, Chip, Alert, InputAdornment, Link, Switch, FormControlLabel,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CloseIcon from '@mui/icons-material/Close'
import { STATUS } from '../lib/palette.js'
import {
  MONTH_LABELS, MONTHS_IN_YEAR, newOpexLine, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths, fmtHours,
  normalizeTasks, mandayToMoney, moneyToManday,
  ROLE_ORDER, ROLE_LABEL, setRolesPatch, creditRows, reassignPatch,
  pinFinishPatch, unpinFinishPatch,
} from '../lib/model.js'

/**
 * A number that commits on blur, shown in mandays and in money side by side.
 * Typing in either fills the other at the developer day rate. The MANDAY is
 * what gets stored — money is a view of it — so changing the developer salary
 * re-prices the plan instead of silently changing how much work a task is.
 */
function EffortField({ manday, onChange, rates, symbol }) {
  const asMd = (v) => (v ? String(v) : '')
  const asMoney = (v) => (v ? String(Math.round(mandayToMoney(v, rates) || 0)) : '')
  const [md, setMd] = useState(asMd(manday))
  const [money, setMoney] = useState(asMoney(manday))
  const [editing, setEditing] = useState(false)
  // Follow the stored value whenever the user is not mid-edit.
  if (!editing && md !== asMd(manday)) { setMd(asMd(manday)); setMoney(asMoney(manday)) }

  const num = (t) => Number(String(t).replace(/[,\s]/g, ''))
  const commit = (next) => {
    const v = Number.isFinite(next) && next > 0 ? Math.round(next * 100) / 100 : 0
    if (v !== manday) onChange(v)
    setMd(asMd(v))
    setMoney(asMoney(v))
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <TextField
        size="small"
        label="Mandays"
        value={md}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setMd(e.target.value)
          const n = num(e.target.value)
          setMoney(Number.isFinite(n) ? String(Math.round(mandayToMoney(n, rates) || 0)) : '')
        }}
        onBlur={() => { setEditing(false); commit(num(md)) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 68 } }}
      />
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>=</Typography>
      <TextField
        size="small"
        label="Cost"
        value={money}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setMoney(e.target.value)
          const n = num(e.target.value)
          const asDays = moneyToManday(n, rates)
          setMd(Number.isFinite(asDays) ? String(Math.round(asDays * 100) / 100) : '')
        }}
        onBlur={() => { setEditing(false); commit(moneyToManday(num(money), rates)) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        InputProps={{ startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> }}
        inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 96 } }}
      />
    </Box>
  )
}

/** Free text with any URL turned into a real link. */
export function LinkedText({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g)
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {parts.map((t, i) => (/^https?:\/\//.test(t)
        ? <Link key={i} href={t} target="_blank" rel="noopener noreferrer">{t}</Link>
        : <span key={i}>{t}</span>))}
    </Typography>
  )
}

/*
 * Anything a click can land on that is already a control. A click on one of
 * these must NOT open this dialog: the Projects table has editable cells,
 * dropdowns, a selection checkbox and a delete button in every row, and the
 * scorecard portfolio has four more. Everything else in a row — the derived
 * FTE, cost, ROI and payback cells — is inert text and opens the dialog.
 *
 * Kept here, exported, so both tables use one predicate and cannot drift apart.
 */
export const WIDGET_SELECTOR =
  'input,textarea,select,button,a,label,[role="combobox"],[role="button"],[role="option"],'
  + '.MuiCheckbox-root,.MuiSelect-root,.MuiInputBase-root'

export const isWidgetClick = (e) => {
  const t = e?.target
  return !!(t && typeof t.closest === 'function' && t.closest(WIDGET_SELECTOR))
}

/** onClick for a table row that opens the dialog, minus the control cells. */
export const rowOpenHandler = (open) => (e) => {
  if (isWidgetClick(e)) return
  open()
}

/** Money field that only commits on blur, so typing never fights React state. */
function MoneyField({ value, onChange, label, placeholder = '0', width = 150, symbol }) {
  const asStr = (v) => (v == null ? '' : String(v))
  const [draft, setDraft] = useState(asStr(value))
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== asStr(value)) setDraft(asStr(value))
  return (
    <TextField
      size="small"
      label={label}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false)
        const t = draft.trim()
        if (t === '') { if (value != null) onChange(null); return }
        const n = Number(t.replace(/,/g, ''))
        // Only a finite, non-negative number is money. Anything else snaps back
        // rather than being written, so junk can never reach the totals.
        if (Number.isFinite(n) && n >= 0) { if (n !== value) onChange(n) }
        else setDraft(asStr(value))
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      InputProps={{ startAdornment: <Typography variant="caption" sx={{ mr: 0.5, color: 'text.secondary' }}>{symbol}</Typography> }}
      inputProps={{ style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
      sx={{ width }}
    />
  )
}

/** Free-text field that commits on blur. */
function TextFieldOnBlur({ value, onChange, label, placeholder, sx }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== (value ?? '')) setDraft(value ?? '')
  return (
    <TextField
      size="small"
      label={label}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setFocused(false); if (draft.trim() !== (value ?? '')) onChange(draft.trim()) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      sx={sx}
    />
  )
}

const MonthSelect = ({ value, onChange, label }) => (
  <Select
    size="small"
    value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    inputProps={{ 'aria-label': label }}
    sx={{ width: 88, fontSize: '0.8125rem' }}
  >
    {MONTH_LABELS.map((m, i) => <MenuItem key={m} value={i + 1}>{m}</MenuItem>)}
  </Select>
)

/**
 * The whole cost picture for one project, opened by clicking its row on the
 * Projects tab or on any scorecard's portfolio.
 *
 * Everything here edits through the SAME `onUpdate(key, patch)` the tables
 * already use, so one code path drives the dashboard, the scorecards and the
 * exported workbook. The project handed in is looked up fresh out of the
 * computed plan on every render by the caller — holding onto the object would
 * leave the ROI in this header stale the moment a CAPEX is typed.
 */

/**
 * Who is credited on a project, and for what.
 *
 * Saving hours are split by role weight, so this table is where a shared
 * project's numbers are actually decided. It shows the resulting share and the
 * hours it carries next to each role, because a weight the user cannot see the
 * effect of is a weight they will set wrong.
 *
 * The PIC is shown even with no roles typed: they are worth the bare
 * `assignee` weight, and an owner with a share and no visible reason for it
 * looks like a bug.
 */
function TeamRoles({ p, people, onUpdate }) {
  const rows = creditRows(p, p.shares)
  const listed = new Set(rows.map((r) => r.person))
  const nameOf = (id) => people.find((x) => x.id === id)?.nick || id
  const spare = people.filter((x) => !listed.has(x.id))
  const hours = p.savingHours ?? 0
  const counted = p.commitLevel === 'commit' || p.commitLevel === 'stretch'

  const setRoles = (person, roles) => onUpdate(p.key, setRolesPatch(p, person, roles))

  return (
    <>
      <Divider sx={{ my: 3 }} />
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 0.5 }}>
        <Typography variant="h4">Team and roles</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          the split of this project&rsquo;s hours
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        Each person counts at their strongest role, not the sum of them — holding both PM and dev does not
        double a claim. Shares always add to 100%, so giving someone more takes it from the others. Clear
        every role to drop a person; the PIC keeps the project at the assignee weight.
      </Typography>

      <Table size="small" sx={{ mb: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 150 }}>Person</TableCell>
            <TableCell sx={{ minWidth: 260 }}>Roles</TableCell>
            <TableCell align="right" sx={{ width: 90 }}>Share</TableCell>
            <TableCell align="right" sx={{ width: 120 }}>Credited</TableCell>
            <TableCell align="center" sx={{ width: 90 }}>PIC</TableCell>
            <TableCell sx={{ width: 44 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.person} hover>
              <TableCell>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{nameOf(r.person)}</Typography>
                {r.implied ? (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>no role set</Typography>
                ) : null}
              </TableCell>
              <TableCell>
                <Select
                  multiple
                  size="small"
                  fullWidth
                  displayEmpty
                  value={r.implied ? [] : r.roles}
                  onChange={(e) => setRoles(r.person, e.target.value)}
                  renderValue={(sel) => (sel.length
                    ? (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {sel.map((v) => <Chip key={v} size="small" label={ROLE_LABEL[v] || v} />)}
                      </Box>
                    )
                    : <Typography variant="caption" sx={{ color: 'text.secondary' }}>assignee (implied)</Typography>)}
                >
                  {ROLE_ORDER.map((role) => (
                    <MenuItem key={role} value={role}>{ROLE_LABEL[role] || role}</MenuItem>
                  ))}
                </Select>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(r.share * 100)}%
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', color: counted ? 'text.primary' : 'text.disabled' }}>
                  {counted ? `${fmtHours(hours * r.share)}/mth` : '—'}
                </Typography>
              </TableCell>
              <TableCell align="center">
                {p.pic === r.person
                  ? <Chip size="small" label="PIC" color="primary" variant="outlined" />
                  : (
                    <Tooltip title="Make this person the PIC">
                      <Button size="small" onClick={() => onUpdate(p.key, reassignPatch(p, r.person))}>set</Button>
                    </Tooltip>
                  )}
              </TableCell>
              <TableCell>
                <Tooltip title="Remove from this project">
                  <span>
                    <IconButton size="small" disabled={r.implied} onClick={() => setRoles(r.person, [])}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Nobody is credited. The hours fall to the team lead, who is accountable for them.
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {spare.length ? (
        <Select
          size="small"
          displayEmpty
          value=""
          onChange={(e) => setRoles(e.target.value, ['dev'])}
          sx={{ minWidth: 240 }}
          renderValue={() => <Typography variant="body2" sx={{ color: 'text.secondary' }}>Add a person…</Typography>}
        >
          {spare.map((x) => <MenuItem key={x.id} value={x.id}>{x.nick} — {x.name}</MenuItem>)}
        </Select>
      ) : null}

      {p.fellBack ? (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          Nobody on the team holds a role here, so these hours sit with the team lead rather than vanishing.
        </Alert>
      ) : null}
    </>
  )
}


/**
 * The finish date, and whether the register is holding its own.
 *
 * Jira's resolution date is the moment somebody dragged the last card. On work
 * that was delivered months before anybody closed it off, that reads as drift
 * nobody caused — and Jira will not let the date be corrected. So the register
 * can hold this one field: the sync then leaves it alone and keeps everything
 * else about the project up to date.
 *
 * Deliberate and per project. Nothing is ever held automatically, because a
 * finish date that quietly stops following the board is worse than one that is
 * wrong in a way you can see.
 */
function FinishDate({ p, onUpdate }) {
  const held = p.actualEndPinned === true
  const tl = p.timeline || {}
  const due = tl.plannedEnd || p.due || null
  const finish = p.actualEnd || null
  // What the drift would be, said in the same words the scorecard uses.
  const lateBy = tl.lateBy
  return (
    <>
      <Divider sx={{ my: 3 }} />
      <Typography variant="h4" sx={{ mb: 0.5 }}>Finish date</Typography>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
        Committed to <strong>{due || 'no date'}</strong>
        {finish
          ? <> · finished <strong>{finish}</strong>{lateBy != null && lateBy > 0 ? ` — ${lateBy} days past the commitment` : lateBy != null ? ' — on or ahead of the commitment' : ''}</>
          : ' · not finished yet'}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          type="date"
          label="Finished on"
          disabled={!held}
          value={finish || ''}
          onChange={(e) => onUpdate(p.key, pinFinishPatch(p, e.target.value || null))}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 190 }}
        />
        <FormControlLabel
          control={(
            <Switch
              size="small"
              checked={held}
              onChange={(e) => onUpdate(p.key, e.target.checked
                // Holding with nothing to hold would be a project waiting on a
                // sync that will never come, so the commitment stands in.
                ? pinFinishPatch(p, finish || due)
                : unpinFinishPatch())}
            />
          )}
          label={(
            <Typography variant="caption">
              Hold this date — the Jira sync will not touch it
            </Typography>
          )}
        />
      </Box>
      <Alert severity={held ? 'warning' : 'info'} sx={{ mt: 1.5, py: 0.5 }}>
        <Typography variant="caption">
          {held
            ? <>Held. The daily sync updates everything else on this project — start date, name, tasks — but leaves
              the finish date exactly as it is above. Turn this off and the next sync takes it back from Jira.</>
            : <>Following Jira. The finish date is the resolution date of the last task under this epic, rewritten
              every morning. Hold it only where Jira&rsquo;s date is not the day the work actually landed.</>}
        </Typography>
      </Alert>
    </>
  )
}

export default function ProjectCostDialog({ project, plan, onUpdate, onClose }) {
  // No hooks in this component, so an early return is safe — and the caller
  // holds only a key, so there is nothing to keep mounted between openings.
  if (!project) return null

  const fin = plan.finance
  const sym = fin.symbol
  const horizon = fin.horizonMonths
  const p = project
  const opex = p.opex || []
  const grid = p.opexByMonth || new Array(MONTHS_IN_YEAR).fill(0)
  const patchOpex = (next) => onUpdate(p.key, { opex: next })
  const setLine = (id, patch) => patchOpex(opex.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  const addLine = () => patchOpex([...opex, newOpexLine(opex.length + 1)])
  const removeLine = (id) => patchOpex(opex.filter((l) => l.id !== id))

  /*
   * A project imported from the workbook has a manday total and no tasks. Show
   * that total as a single line rather than an empty table, so opening the
   * breakdown never loses the number and never changes it. It becomes a real
   * stored task the moment the user edits anything here.
   */
  const stored = normalizeTasks(p.tasks)
  const tasks = stored.length
    ? stored
    : (p.manday > 0 ? [{ id: 't1', label: 'Total as entered', manday: p.manday, note: '' }] : [])
  const taskTotal = tasks.reduce((a, t) => a + t.manday, 0)
  const patchTasks = (next) => onUpdate(p.key, { tasks: next, mandayEstimated: false })
  const setTask = (id, patch) => patchTasks(tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  const removeTask = (id) => patchTasks(tasks.filter((t) => t.id !== id))
  const addTask = () => patchTasks([...tasks, { id: 't' + Date.now().toString(36), label: '', manday: 0, note: '' }])

  const lineYear = (l) => l.monthly * (l.endMonth - l.startMonth + 1)
  const active = (l, m) => m + 1 >= l.startMonth && m + 1 <= l.endMonth

  const head = [
    { label: 'Saving hours', value: p.savingHours == null ? '—' : `${fmtHours(p.savingHours)}/mth` },
    { label: 'Benefit', value: p.monthlyBenefit == null ? '—' : `${fmtMoneyShort(p.monthlyBenefit, sym)}/mth` },
    { label: 'OPEX', value: p.opexRunRate > 0 ? `${fmtMoneyShort(p.opexRunRate, sym)}/mth` : '—' },
    { label: 'Investment', value: fmtMoneyShort(p.investment, sym) },
    {
      label: 'ROI',
      value: fmtRoi(p.roi),
      tone: p.roi == null ? undefined : p.gate === 'pass' ? STATUS.good : STATUS.critical,
    },
    {
      label: 'Payback',
      value: p.paybackMonths == null ? '—' : fmtMonths(p.paybackMonths),
      tone: p.netMonthly != null && p.netMonthly <= 0 ? STATUS.critical : undefined,
    },
  ]

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth scroll="paper">
      <DialogTitle sx={{ pr: 6 }}>
        <Typography variant="h4" component="div">{p.summary}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {p.jiraKey || p.key} · investment and running cost · {p.manday > 0 ? `${fmtHours(p.manday)} mandays` : 'no effort estimate'}
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }} aria-label="close">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {/* ---------- the headline ---------- */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', border: 1, borderColor: 'divider', borderRadius: 1, mb: 2.5 }}>
          {head.map((t, i) => (
            <Box key={t.label} sx={{ flex: '1 1 130px', px: 2, py: 1.25, borderLeft: i === 0 ? 'none' : 1, borderColor: 'divider', minWidth: 120 }}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', fontSize: '0.6875rem' }}>
                {t.label}
              </Typography>
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: t.tone || 'text.primary' }}>
                {t.value}
              </Typography>
            </Box>
          ))}
        </Box>

        {p.netMonthly != null && p.netMonthly <= 0 && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2.5 }}>
            The operating cost of {fmtMoney(p.opexRunRate, sym)} a month is at or above the{' '}
            {fmtMoney(p.monthlyBenefit, sym)} a month this project hands back, so it never repays what was
            invested in it. Payback is shown as blank rather than as a number — there isn't one.
          </Alert>
        )}

        {/* ---------- effort ---------- */}
        <Typography variant="h4" sx={{ mb: 0.5 }}>Effort — mandays by task</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
          Break the build into tasks and the project total becomes the sum of them. Type either the mandays
          or the cost — the other follows at {fmtMoney(fin.devDayRate, sym)} a manday. Mandays are what is
          stored, so changing the developer salary re-prices the plan rather than changing the work.
        </Typography>
        <Table size="small" sx={{ mb: 1, '& th, & td': { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell>Task</TableCell>
              <TableCell sx={{ width: 300 }}>Effort</TableCell>
              <TableCell>Note</TableCell>
              <TableCell padding="checkbox" />
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <TextFieldOnBlur
                    value={t.label}
                    placeholder="What this covers"
                    onChange={(v) => setTask(t.id, { label: v })}
                    sx={{ width: '100%' }}
                  />
                </TableCell>
                <TableCell>
                  <EffortField
                    manday={t.manday}
                    rates={fin}
                    symbol={sym}
                    onChange={(v) => setTask(t.id, { manday: v })}
                  />
                </TableCell>
                <TableCell>
                  <TextFieldOnBlur
                    value={t.note}
                    placeholder="optional"
                    onChange={(v) => setTask(t.id, { note: v })}
                    sx={{ width: '100%' }}
                  />
                </TableCell>
                <TableCell padding="checkbox">
                  <IconButton size="small" onClick={() => removeTask(t.id)} aria-label="remove task">
                    <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider' }}>TOTAL</TableCell>
              <TableCell sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', borderTop: 2, borderColor: 'divider' }}>
                {fmtHours(taskTotal)} mandays = {fmtMoney(mandayToMoney(taskTotal, fin), sym)}
              </TableCell>
              <TableCell colSpan={2} sx={{ borderTop: 2, borderColor: 'divider' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {stored.length
                    ? 'the project carries the sum of these lines'
                    : 'one line, carrying the total entered before this breakdown existed'}
                </Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Button size="small" startIcon={<AddIcon />} onClick={addTask} sx={{ mb: 3 }}>Add task</Button>

        {/* ---------- CAPEX ---------- */}
        <Typography variant="h4" sx={{ mb: 0.5 }}>CAPEX — one-off investment</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
          Servers, licences, hardware — anything bought once. Charged whole in the month it is spent: no
          depreciation is applied anywhere in this app.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center', mb: 3 }}>
          <MoneyField
            label={`CAPEX (${fin.currency})`}
            symbol={sym}
            value={p.capex}
            onChange={(v) => onUpdate(p.key, { capex: v })}
            width={180}
          />
          <TextFieldOnBlur
            label="What it buys"
            placeholder="e.g. servers, licences"
            value={p.capexNote}
            onChange={(v) => onUpdate(p.key, { capexNote: v })}
            sx={{ flex: '1 1 260px', minWidth: 220 }}
          />
          <Tooltip title={`Mandays x ${fmtMoney(fin.devDayRate, sym)} a day, from the Model tab. Edit the mandays on the Projects tab.`}>
            <Chip
              variant="outlined"
              label={`Build cost ${p.buildCost == null ? '—' : fmtMoney(p.buildCost, sym)}`}
              sx={{ cursor: 'help' }}
            />
          </Tooltip>
        </Box>

        {/* ---------- OPEX lines ---------- */}
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 1.5 }}>
          <Box>
            <Typography variant="h4" sx={{ mb: 0.5 }}>OPEX — monthly running cost</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Cloud, subscriptions, support — anything billed every month. Each line runs between the two months
              you set, exactly like the budget sheet, and the grid below is that spread month by month.
            </Typography>
          </Box>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={addLine}>
            Add OPEX line
          </Button>
        </Box>

        {opex.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.disabled', mb: 2.5 }}>
            No operating cost entered — this project's return is measured against its investment alone.
          </Typography>
        ) : (
          <Table size="small" sx={{ mb: 2.5 }}>
            <TableHead>
              <TableRow>
                <TableCell>Cost line</TableCell>
                <TableCell align="right" sx={{ width: 160 }}>{`Per month (${fin.currency})`}</TableCell>
                <TableCell sx={{ width: 104 }}>From</TableCell>
                <TableCell sx={{ width: 104 }}>To</TableCell>
                <TableCell align="right" sx={{ width: 120 }}>2026 total</TableCell>
                <TableCell padding="checkbox" />
              </TableRow>
            </TableHead>
            <TableBody>
              {opex.map((l) => (
                <TableRow key={l.id} hover>
                  <TableCell>
                    <TextFieldOnBlur
                      value={l.label}
                      placeholder="e.g. cloud hosting"
                      onChange={(v) => setLine(l.id, { label: v })}
                      sx={{ width: '100%' }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <MoneyField
                      symbol={sym}
                      value={l.monthly || null}
                      onChange={(v) => setLine(l.id, { monthly: v ?? 0 })}
                      width={140}
                    />
                  </TableCell>
                  <TableCell>
                    <MonthSelect value={l.startMonth} label="start month" onChange={(v) => setLine(l.id, { startMonth: v })} />
                  </TableCell>
                  <TableCell>
                    <MonthSelect value={l.endMonth} label="end month" onChange={(v) => setLine(l.id, { endMonth: v })} />
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {fmtMoney(lineYear(l), sym)}
                  </TableCell>
                  <TableCell padding="checkbox">
                    <Tooltip title="Remove this cost line">
                      <IconButton size="small" onClick={() => removeLine(l.id)}>
                        <DeleteOutlineIcon sx={{ fontSize: 17 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* ---------- the month grid, laid out like BG 2026 G..S ---------- */}
        <Divider sx={{ mb: 2 }} />
        <Typography variant="h4" sx={{ mb: 0.5 }}>Monthly cost — 2026</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
          Twelve months and an FY total, the shape of the budget sheet's own G..S columns. CAPEX sits on its own
          one-off row and is never spread across the months.
        </Typography>
        {/* Thirteen numeric columns: it scrolls inside this box rather than
            pushing the dialog — and the page — sideways. */}
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 900, '& th, & td': { px: 0.75, whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 150, position: 'sticky', left: 0, bgcolor: 'background.paper', zIndex: 1 }}>
                  Cost line
                </TableCell>
                {MONTH_LABELS.map((m) => (
                  <TableCell key={m} align="right" sx={{ fontSize: '0.6875rem' }}>{m}</TableCell>
                ))}
                <TableCell align="right" sx={{ fontWeight: 700 }}>FY2026</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {opex.map((l) => (
                <TableRow key={l.id} hover>
                  <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>{l.label}</Typography>
                  </TableCell>
                  {MONTH_LABELS.map((m, i) => (
                    <TableCell key={m} align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem', color: active(l, i) ? 'text.primary' : 'text.disabled' }}>
                      {active(l, i) ? Math.round(l.monthly).toLocaleString() : '—'}
                    </TableCell>
                  ))}
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.75rem' }}>
                    {Math.round(lineYear(l)).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider', position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                  OPEX total
                </TableCell>
                {grid.map((v, i) => (
                  <TableCell key={MONTH_LABELS[i]} align="right" sx={{ fontWeight: 700, borderTop: 2, borderColor: 'divider', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                    {v > 0 ? Math.round(v).toLocaleString() : '—'}
                  </TableCell>
                ))}
                <TableCell align="right" sx={{ fontWeight: 800, borderTop: 2, borderColor: 'divider', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {Math.round(p.opexYear || 0).toLocaleString()}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    CAPEX (one-off)
                  </Typography>
                </TableCell>
                <TableCell colSpan={MONTHS_IN_YEAR} sx={{ color: 'text.disabled' }}>
                  <Typography variant="caption">
                    {p.capexNote ? `${p.capexNote} — ` : ''}charged once, not spread — no depreciation
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {p.capex == null ? '—' : Math.round(p.capex).toLocaleString()}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    Build ({p.manday > 0 ? `${fmtHours(p.manday)} mandays` : 'no effort'})
                  </Typography>
                </TableCell>
                <TableCell colSpan={MONTHS_IN_YEAR} sx={{ color: 'text.disabled' }}>
                  <Typography variant="caption">
                    Mandays x {fmtMoney(fin.devDayRate, sym)} a day — edit the mandays on the Projects tab
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {p.buildCost == null ? '—' : Math.round(p.buildCost).toLocaleString()}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 800, borderTop: 2, borderColor: 'divider', position: 'sticky', left: 0, bgcolor: 'background.paper' }}>
                  TOTAL 2026
                </TableCell>
                <TableCell colSpan={MONTHS_IN_YEAR} sx={{ borderTop: 2, borderColor: 'divider' }} />
                <TableCell align="right" sx={{ fontWeight: 800, borderTop: 2, borderColor: 'divider', fontVariantNumeric: 'tabular-nums', fontSize: '0.75rem' }}>
                  {Math.round((p.investment ?? 0) + (p.opexYear || 0)).toLocaleString()}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Box>

        {/* ---------- how the ROI is built ---------- */}
        <Alert severity="info" variant="outlined" sx={{ mt: 2.5 }} icon={false}>
          <Typography variant="body2" sx={{ lineHeight: 1.6 }}>
            <strong>How this project's return is built.</strong>{' '}
            {p.investment == null ? (
              <>No mandays and no CAPEX, so the cost is unknown — not zero — and there is no return to state.
                Enter either one and every figure above fills in.</>
            ) : p.monthlyBenefit == null ? (
              <>Saving hours are still TBC, so there is no benefit to set against the{' '}
                {fmtMoney(p.investment, sym)} invested. The cost is real and is reported on the Summary sheet,
                but it cannot produce a return until the hours are quantified.</>
            ) : (
              <>
                Investment {fmtMoney(p.investment, sym)} = build {fmtMoney(p.buildCost ?? 0, sym)} + CAPEX{' '}
                {fmtMoney(p.capex ?? 0, sym)}. Benefit {fmtMoney(p.monthlyBenefit, sym)}/month − OPEX{' '}
                {fmtMoney(p.opexRunRate, sym)}/month = <strong>{fmtMoney(p.netMonthly, sym)} net a month</strong>.
                Over {horizon} months that is {fmtMoney(p.netHorizonBenefit, sym)}, less the investment ={' '}
                <strong>{fmtMoney(p.netBenefit, sym)}</strong> net, a return of <strong>{fmtRoi(p.roi)}</strong>{' '}
                against a gate of {fmtRoi(fin.roiGate)}
                {p.paybackMonths == null
                  ? ', and it never pays back.'
                  : `, paying back in ${fmtMonths(p.paybackMonths)}.`}
              </>
            )}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1 }}>
            The ROI uses the OPEX run-rate — every line's monthly amount, whatever months it starts and ends in —
            because a cost that starts in October still runs every month once it has started. The grid above is the
            2026 budget view, which is why its total can differ from twelve times the run-rate.
          </Typography>
        </Alert>
        {/* ---------- who is credited, and for what ---------- */}
        <TeamRoles p={p} people={plan.people} onUpdate={onUpdate} />

        {/* ---------- the finish date, and who owns it ---------- */}
        <FinishDate p={p} onUpdate={onUpdate} />

        {/* ---------- comments ---------- */}
        <Divider sx={{ my: 3 }} />
        <Typography variant="h4" sx={{ mb: 0.5 }}>Notes and links</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>
          Anything worth recording about this project — a decision, a caveat, a link to the spec or the
          ticket. Pasted addresses become clickable once saved.
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={3}
          size="small"
          placeholder="Type a note, or paste a link…"
          defaultValue={p.comment || ''}
          onBlur={(e) => {
            const v = e.target.value
            if (v !== (p.comment || '')) onUpdate(p.key, { comment: v })
          }}
        />
        {p.comment ? (
          <Box sx={{ mt: 1.5, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
              As it reads
            </Typography>
            <LinkedText text={p.comment} />
          </Box>
        ) : null}

      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
