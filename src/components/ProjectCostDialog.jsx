import { useState } from 'react'
import { useTheme } from '@mui/material/styles'
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography, Button, IconButton,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Select, MenuItem, Tooltip,
  Chip, Alert, InputAdornment, Link, Switch, FormControlLabel, useMediaQuery,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CloseIcon from '@mui/icons-material/Close'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { AboutPage, FigureStrip, StatusPill } from './ui.jsx'
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
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <TextField
        size="small"
        label="Mandays"
        placeholder="0"
        InputLabelProps={{ shrink: true }}
        value={md}
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          setMd(e.target.value)
          const n = num(e.target.value)
          setMoney(Number.isFinite(n) ? String(Math.round(mandayToMoney(n, rates) || 0)) : '')
        }}
        onBlur={() => { setEditing(false); commit(num(md)) }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
        inputProps={{ inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 64 } }}
      />
      <Typography variant="body2" aria-hidden sx={{ color: 'text.tertiary' }}>=</Typography>
      <TextField
        size="small"
        label="Cost"
        placeholder="0"
        InputLabelProps={{ shrink: true }}
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
        inputProps={{ inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums', width: 88 } }}
      />
    </Box>
  )
}

/** Free text with any URL turned into a real link. */
export function LinkedText({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s]+)/g)
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6 }}>
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
      InputLabelProps={label ? { shrink: true } : undefined}
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
      InputProps={{ startAdornment: <InputAdornment position="start">{symbol}</InputAdornment> }}
      inputProps={{ inputMode: 'decimal', style: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}
      sx={{ width }}
    />
  )
}

/** Free-text field that commits on blur. */
function TextFieldOnBlur({ value, onChange, label, placeholder, sx, inputProps }) {
  const [draft, setDraft] = useState(value ?? '')
  const [focused, setFocused] = useState(false)
  if (!focused && draft !== (value ?? '')) setDraft(value ?? '')
  return (
    <TextField
      size="small"
      label={label}
      InputLabelProps={label ? { shrink: true } : undefined}
      value={draft}
      placeholder={placeholder}
      onFocus={() => setFocused(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setFocused(false); if (draft.trim() !== (value ?? '')) onChange(draft.trim()) }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
      inputProps={inputProps}
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
    sx={{ width: 92 }}
  >
    {MONTH_LABELS.map((m, i) => <MenuItem key={m} value={i + 1}>{m}</MenuItem>)}
  </Select>
)

/**
 * One part of the sheet: a small heading, one line on what it is, the long
 * explanation behind "How it works", and the part's own action at the right.
 * Parts are separated by space, not boxes.
 */
function Part({
  title, desc, help, action, first = false, children,
}) {
  return (
    <Box component="section" aria-label={typeof title === 'string' ? title : undefined} sx={{ mt: first ? 0 : 7 }}>
      <Box sx={{
        display: 'flex', alignItems: 'flex-start', gap: 3, mb: 3,
      }}
      >
        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
          <Typography variant="h3" component="h3">{title}</Typography>
          {(desc || help) && (
            <Box sx={{
              display: 'flex', alignItems: 'center', columnGap: 3, rowGap: 0.5, flexWrap: 'wrap', mt: 0.5,
            }}
            >
              {desc && <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '72ch' }}>{desc}</Typography>}
              {help && <AboutPage label="How it works">{help}</AboutPage>}
            </Box>
          )}
        </Box>
        {action && <Box sx={{ flexShrink: 0, mt: -1 }}>{action}</Box>}
      </Box>
      {children}
    </Box>
  )
}

/* Tables in the sheet: no outer box, a quiet header row, hairlines between rows. */
const sheetTable = {
  '& th': { whiteSpace: 'nowrap' },
  '& tbody tr:last-of-type td': { borderBottom: 0 },
}

/* A stacked row on a phone: one task or cost line, hairlines between them. */
const stackRow = {
  py: 3, borderBottom: 1, borderColor: 'border.subtle', '&:first-of-type': { pt: 1 },
}

/* The one tinted note a part may carry. */
const callout = {
  px: 3, py: 2.5, bgcolor: 'bg.subtle', borderRadius: '8px',
}

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
    <Part
      title="Team and roles"
      desc="How this project's saving hours are split between the people on it."
      help={(
        <>
          <p>Each person counts at their strongest role, not the sum of them: holding both PM and developer does not double a claim.</p>
          <p>Shares always add to 100%, so giving someone more takes it from the others. Clear every role to drop a person; the PIC keeps the project at the assignee weight.</p>
        </>
      )}
    >
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ ...sheetTable, minWidth: 620 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 150 }}>Person</TableCell>
              <TableCell sx={{ minWidth: 240 }}>Roles</TableCell>
              <TableCell align="right" sx={{ width: 80 }}>Share</TableCell>
              <TableCell align="right" sx={{ width: 110 }}>Credited hrs/mth</TableCell>
              <TableCell sx={{ width: 104 }}>PIC</TableCell>
              <TableCell sx={{ width: 44 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.person}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{nameOf(r.person)}</Typography>
                  {r.implied ? (
                    <Typography variant="caption" sx={{ color: 'text.tertiary' }}>No role set</Typography>
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
                        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                          {sel.map((v) => <Chip key={v} size="small" label={ROLE_LABEL[v] || v} />)}
                        </Box>
                      )
                      : <Typography variant="body2" sx={{ color: 'text.tertiary' }}>Assignee (implied)</Typography>)}
                  >
                    {ROLE_ORDER.map((role) => (
                      <MenuItem key={role} value={role}>{ROLE_LABEL[role] || role}</MenuItem>
                    ))}
                  </Select>
                </TableCell>
                <TableCell align="right">{Math.round(r.share * 100)}%</TableCell>
                <TableCell align="right" sx={{ color: counted ? 'text.primary' : 'text.tertiary' }}>
                  {counted ? `${fmtHours(hours * r.share)}/mth` : '—'}
                </TableCell>
                <TableCell>
                  {p.pic === r.person
                    ? <StatusPill tone="neutral">PIC</StatusPill>
                    : (
                      <Button size="small" variant="text" onClick={() => onUpdate(p.key, reassignPatch(p, r.person))} sx={{ ml: -2 }}>
                        Make PIC
                      </Button>
                    )}
                </TableCell>
                <TableCell padding="checkbox">
                  <Tooltip title="Remove from this project">
                    <span>
                      <IconButton size="small" disabled={r.implied} onClick={() => setRoles(r.person, [])} aria-label={`remove ${nameOf(r.person)}`} sx={{ color: 'text.secondary' }}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ color: 'text.secondary' }}>
                  Nobody is credited. The hours fall to the team lead, who is accountable for them.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </Box>

      {spare.length ? (
        <Select
          size="small"
          displayEmpty
          value=""
          onChange={(e) => setRoles(e.target.value, ['dev'])}
          inputProps={{ 'aria-label': 'add a person' }}
          sx={{ minWidth: 240, mt: 3 }}
          renderValue={() => <Typography variant="body1" sx={{ color: 'text.secondary' }}>Add a person…</Typography>}
        >
          {spare.map((x) => (
            <MenuItem key={x.id} value={x.id}>
              {x.nick}
              <Typography component="span" variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>{x.name}</Typography>
            </MenuItem>
          ))}
        </Select>
      ) : null}

      {p.fellBack ? (
        <Box sx={{ ...callout, mt: 3 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Nobody on the team holds a role here, so these hours sit with the team lead rather than vanishing.
          </Typography>
        </Box>
      ) : null}
    </Part>
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
  let state = 'not finished yet'
  if (finish) {
    state = `finished ${finish}`
    if (lateBy != null && lateBy > 0) state += `, ${lateBy} days past the commitment`
    else if (lateBy != null) state += ', on or ahead of the commitment'
  }
  return (
    <Part title="Finish date" desc={`Committed to ${due || 'no date'}; ${state}.`}>
      <Box sx={{
        display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap',
      }}
      >
        <TextField
          size="small"
          type="date"
          label="Finished on"
          disabled={!held}
          value={finish || ''}
          onChange={(e) => onUpdate(p.key, pinFinishPatch(p, e.target.value || null))}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 180 }}
        />
        <FormControlLabel
          sx={{ mr: 0 }}
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
          label="Hold this date so the Jira sync leaves it alone"
        />
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3, maxWidth: '72ch' }}>
        {held
          ? <>Held. The daily sync updates everything else on this project (start date, name, tasks) but leaves
            the finish date exactly as it is above. Turn this off and the next sync takes it back from Jira.</>
          : <>Following Jira. The finish date is the resolution date of the last task under this epic, rewritten
            every morning. Hold it only where Jira&rsquo;s date is not the day the work actually landed.</>}
      </Typography>
    </Part>
  )
}

export default function ProjectCostDialog({ project, plan, onUpdate, onClose }) {
  // A phone stacks each task and cost line instead of a table row of inputs.
  // The one hook runs before the early return, so the order never changes;
  // the caller holds only a key, so there is nothing to keep mounted.
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true })
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
  const neverPays = p.netMonthly != null && p.netMonthly <= 0

  let roiNote = 'Needs mandays or CAPEX'
  let roiTone
  if (p.roi != null) {
    roiNote = p.gate === 'pass' ? `Clears the ${fmtRoi(fin.roiGate)} gate` : `Below the ${fmtRoi(fin.roiGate)} gate`
    roiTone = p.gate === 'pass' ? 'success' : 'danger'
  }
  const figures = [
    { key: 'hours', label: 'Saving hrs/mth', value: p.savingHours == null ? '—' : fmtHours(p.savingHours), note: p.savingHours == null ? 'Still TBC' : undefined },
    { key: 'benefit', label: 'Benefit/mth', value: p.monthlyBenefit == null ? '—' : fmtMoneyShort(p.monthlyBenefit, sym) },
    { key: 'opex', label: 'OPEX/mth', value: p.opexRunRate > 0 ? fmtMoneyShort(p.opexRunRate, sym) : '—', note: p.opexRunRate > 0 ? undefined : 'None entered' },
    { key: 'investment', label: 'Investment', value: fmtMoneyShort(p.investment, sym), note: 'Build cost and CAPEX' },
    { key: 'roi', label: 'ROI', value: fmtRoi(p.roi), note: roiNote, tone: roiTone },
    {
      key: 'payback',
      label: 'Payback',
      value: p.paybackMonths == null ? '—' : fmtMonths(p.paybackMonths),
      note: neverPays ? 'Never pays back' : undefined,
      tone: neverPays ? 'danger' : undefined,
    },
  ]

  const cell = { whiteSpace: 'nowrap' }
  const stick = {
    position: 'sticky', left: 0, zIndex: 1, bgcolor: 'bg.raised', minWidth: 168, maxWidth: 220,
  }
  const totalRow = { '& td': { borderTop: 1, borderColor: 'border.strong', fontWeight: 600 } }

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth scroll="paper" aria-labelledby="cost-sheet-title">
      <DialogTitle id="cost-sheet-title" sx={{ pr: 14 }}>
        <Box component="span" sx={{ display: 'block', overflowWrap: 'anywhere' }}>Cost sheet: {p.summary}</Box>
        <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {p.jiraKey || p.key}, {p.manday > 0 ? `${fmtHours(p.manday)} mandays` : 'no effort estimate yet'}
        </Typography>
        <Tooltip title="Close">
          <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 14, color: 'text.secondary' }} aria-label="close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers>
        {/* ---------- the headline ---------- */}
        <FigureStrip items={figures} />

        {neverPays && (
          <Alert severity="error" variant="outlined" sx={{ mt: 4 }}>
            The running cost of {fmtMoney(p.opexRunRate, sym)} a month is at or above the{' '}
            {fmtMoney(p.monthlyBenefit, sym)} a month this project returns, so it never repays the investment.
            Lower the OPEX or raise the saving hours to give it a payback.
          </Alert>
        )}

        {/* ---------- effort ---------- */}
        <Part
          title="Effort by task"
          desc={`Type mandays or cost; the other follows at ${fmtMoney(fin.devDayRate, sym)} a manday.`}
          help={(
            <>
              <p>Break the build into tasks and the project total becomes the sum of them.</p>
              <p>Mandays are what is stored, so changing the developer salary on the Model page re-prices the plan rather than changing the work.</p>
            </>
          )}
          action={<Button size="small" startIcon={<AddIcon />} onClick={addTask}>Add task</Button>}
        >
          {phone ? (
            <Box>
              {tasks.map((t) => (
                <Box key={t.id} sx={{ ...stackRow, display: 'grid', gap: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextFieldOnBlur
                      label="Task"
                      value={t.label}
                      placeholder="What this covers"
                      onChange={(v) => setTask(t.id, { label: v })}
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                    <IconButton onClick={() => removeTask(t.id)} aria-label="remove task" sx={{ color: 'text.secondary', width: 40, height: 40 }}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <EffortField manday={t.manday} rates={fin} symbol={sym} onChange={(v) => setTask(t.id, { manday: v })} />
                  <TextFieldOnBlur
                    label="Note"
                    value={t.note}
                    placeholder="Optional"
                    onChange={(v) => setTask(t.id, { note: v })}
                    sx={{ width: '100%' }}
                  />
                </Box>
              ))}
              <Box sx={{ ...stackRow, display: 'flex', justifyContent: 'space-between', gap: 3 }}>
                <Typography variant="body1" sx={{ fontWeight: 600 }}>Total</Typography>
                <Typography variant="body1" className="tabular" sx={{ fontWeight: 600, textAlign: 'right' }}>
                  {fmtHours(taskTotal)} mandays, {fmtMoney(mandayToMoney(taskTotal, fin), sym)}
                </Typography>
              </Box>
            </Box>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ ...sheetTable, minWidth: 640 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Task</TableCell>
                    <TableCell sx={{ width: 280 }}>Effort</TableCell>
                    <TableCell>Note</TableCell>
                    <TableCell padding="checkbox" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tasks.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell sx={{ py: 2 }}>
                        <TextFieldOnBlur
                          value={t.label}
                          placeholder="What this covers"
                          onChange={(v) => setTask(t.id, { label: v })}
                          inputProps={{ 'aria-label': 'task' }}
                          sx={{ width: '100%', minWidth: 160 }}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 2 }}>
                        <EffortField
                          manday={t.manday}
                          rates={fin}
                          symbol={sym}
                          onChange={(v) => setTask(t.id, { manday: v })}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 2 }}>
                        <TextFieldOnBlur
                          value={t.note}
                          placeholder="Optional"
                          onChange={(v) => setTask(t.id, { note: v })}
                          inputProps={{ 'aria-label': 'note' }}
                          sx={{ width: '100%', minWidth: 140 }}
                        />
                      </TableCell>
                      <TableCell padding="checkbox">
                        <Tooltip title="Remove this task">
                          <IconButton size="small" onClick={() => removeTask(t.id)} aria-label="remove task" sx={{ color: 'text.secondary' }}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow sx={totalRow}>
                    <TableCell>Total</TableCell>
                    <TableCell className="tabular" sx={cell}>
                      {fmtHours(taskTotal)} mandays, {fmtMoney(mandayToMoney(taskTotal, fin), sym)}
                    </TableCell>
                    <TableCell colSpan={2} sx={{ '&&': { fontWeight: 400 }, color: 'text.secondary' }}>
                      {stored.length
                        ? 'The project carries the sum of these lines.'
                        : tasks.length ? 'One line, carrying the total entered before this breakdown existed.' : 'No tasks yet.'}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Box>
          )}
        </Part>

        {/* ---------- CAPEX ---------- */}
        <Part
          title="CAPEX"
          desc="One-off investment: servers, licences, hardware. Charged in full, with no depreciation."
        >
          <Box sx={{
            display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center',
          }}
          >
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
              sx={{ flex: '1 1 260px', minWidth: 200 }}
            />
            {/* Read only: it comes from the mandays above. */}
            <Box sx={{ minWidth: 140, pl: { sm: 2 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary' }}>Build cost</Typography>
                <Tooltip title={`Mandays x ${fmtMoney(fin.devDayRate, sym)} a day, from the Model page. Change the effort above to change it.`}>
                  <InfoOutlinedIcon tabIndex={0} aria-label="about build cost" sx={{ fontSize: 14, color: 'text.tertiary', cursor: 'help' }} />
                </Tooltip>
              </Box>
              <Typography variant="body1" className="tabular" sx={{ fontWeight: 500, mt: 0.5, color: p.buildCost == null ? 'text.tertiary' : 'text.primary' }}>
                {p.buildCost == null ? '—' : fmtMoney(p.buildCost, sym)}
              </Typography>
            </Box>
          </Box>
        </Part>

        {/* ---------- OPEX lines ---------- */}
        <Part
          title="OPEX"
          desc="Monthly running cost, such as cloud, subscriptions and support."
          action={<Button size="small" startIcon={<AddIcon />} onClick={addLine}>Add OPEX line</Button>}
        >
          {opex.length === 0 ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No running cost entered. The return is measured against the investment alone.
            </Typography>
          ) : phone ? (
            <Box>
              {opex.map((l) => (
                <Box key={l.id} sx={{ ...stackRow, display: 'grid', gap: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TextFieldOnBlur
                      label="Cost line"
                      value={l.label}
                      placeholder="e.g. cloud hosting"
                      onChange={(v) => setLine(l.id, { label: v })}
                      sx={{ flex: 1, minWidth: 0 }}
                    />
                    <IconButton onClick={() => removeLine(l.id)} aria-label="remove cost line" sx={{ color: 'text.secondary', width: 40, height: 40 }}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <MoneyField
                    label="Per month"
                    symbol={sym}
                    value={l.monthly || null}
                    onChange={(v) => setLine(l.id, { monthly: v ?? 0 })}
                    width="100%"
                  />
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Typography variant="body2" aria-hidden sx={{ color: 'text.tertiary' }}>From</Typography>
                    <MonthSelect value={l.startMonth} label="start month" onChange={(v) => setLine(l.id, { startMonth: v })} />
                    <Typography variant="body2" aria-hidden sx={{ color: 'text.tertiary' }}>to</Typography>
                    <MonthSelect value={l.endMonth} label="end month" onChange={(v) => setLine(l.id, { endMonth: v })} />
                  </Box>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    2026 total <Box component="span" className="tabular" sx={{ color: 'text.primary', fontWeight: 500 }}>{fmtMoney(lineYear(l), sym)}</Box>
                  </Typography>
                </Box>
              ))}
            </Box>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ ...sheetTable, minWidth: 640 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Cost line</TableCell>
                    <TableCell align="right" sx={{ width: 164 }}>{`Per month (${fin.currency})`}</TableCell>
                    <TableCell sx={{ width: 108 }}>From</TableCell>
                    <TableCell sx={{ width: 108 }}>To</TableCell>
                    <TableCell align="right" sx={{ width: 120 }}>2026 total</TableCell>
                    <TableCell padding="checkbox" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {opex.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell sx={{ py: 2 }}>
                        <TextFieldOnBlur
                          value={l.label}
                          placeholder="e.g. cloud hosting"
                          onChange={(v) => setLine(l.id, { label: v })}
                          inputProps={{ 'aria-label': 'cost line' }}
                          sx={{ width: '100%', minWidth: 160 }}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ py: 2 }}>
                        <MoneyField
                          symbol={sym}
                          value={l.monthly || null}
                          onChange={(v) => setLine(l.id, { monthly: v ?? 0 })}
                          width={144}
                        />
                      </TableCell>
                      <TableCell sx={{ py: 2 }}>
                        <MonthSelect value={l.startMonth} label="start month" onChange={(v) => setLine(l.id, { startMonth: v })} />
                      </TableCell>
                      <TableCell sx={{ py: 2 }}>
                        <MonthSelect value={l.endMonth} label="end month" onChange={(v) => setLine(l.id, { endMonth: v })} />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 500 }}>
                        {fmtMoney(lineYear(l), sym)}
                      </TableCell>
                      <TableCell padding="checkbox">
                        <Tooltip title="Remove this cost line">
                          <IconButton size="small" onClick={() => removeLine(l.id)} aria-label="remove cost line" sx={{ color: 'text.secondary' }}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Part>

        {/* ---------- the month grid, laid out like BG 2026 G..S ---------- */}
        <Part
          title="Monthly cost 2026"
          desc={`Twelve months and the FY total, as in the budget sheet. Amounts in ${fin.currency}.`}
          help={(
            <>
              <p>The grid has the shape of the budget sheet&rsquo;s own G..S columns. CAPEX sits on its own one-off row and is never spread across the months.</p>
              <p>The ROI uses the OPEX run-rate: every line&rsquo;s monthly amount, whatever month it starts in, because a cost that starts in October still runs every month once it has started. That is why this grid&rsquo;s total can differ from twelve times the run-rate.</p>
            </>
          )}
        >
          {/* Thirteen numeric columns: it scrolls inside this box rather than
              pushing the dialog — and the page — sideways. */}
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" sx={{ ...sheetTable, minWidth: 920, '& th, & td': { px: 2, whiteSpace: 'nowrap' } }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ ...stick, bgcolor: 'bg.subtle', zIndex: 2 }}>Cost line</TableCell>
                  {MONTH_LABELS.map((m) => (
                    <TableCell key={m} align="right">{m}</TableCell>
                  ))}
                  <TableCell align="right" sx={{ color: 'text.primary' }}>FY2026</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {opex.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell sx={{ ...stick, overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.label}>{l.label || 'Unnamed line'}</TableCell>
                    {MONTH_LABELS.map((m, i) => (
                      <TableCell key={m} align="right" sx={{ color: active(l, i) ? 'text.primary' : 'text.tertiary' }}>
                        {active(l, i) ? Math.round(l.monthly).toLocaleString() : '—'}
                      </TableCell>
                    ))}
                    <TableCell align="right" sx={{ fontWeight: 500 }}>
                      {Math.round(lineYear(l)).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow sx={totalRow}>
                  <TableCell sx={stick}>OPEX total</TableCell>
                  {grid.map((v, i) => (
                    <TableCell key={MONTH_LABELS[i]} align="right" sx={{ color: v > 0 ? 'text.primary' : 'text.tertiary' }}>
                      {v > 0 ? Math.round(v).toLocaleString() : '—'}
                    </TableCell>
                  ))}
                  <TableCell align="right">{Math.round(p.opexYear || 0).toLocaleString()}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={stick}>CAPEX (one-off)</TableCell>
                  <TableCell colSpan={MONTHS_IN_YEAR} sx={{ color: 'text.tertiary' }}>
                    {p.capexNote ? `${p.capexNote}. ` : ''}Charged once, not spread, no depreciation.
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500, color: p.capex == null ? 'text.tertiary' : 'text.primary' }}>
                    {p.capex == null ? '—' : Math.round(p.capex).toLocaleString()}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={stick}>
                    Build ({p.manday > 0 ? `${fmtHours(p.manday)} mandays` : 'no effort'})
                  </TableCell>
                  <TableCell colSpan={MONTHS_IN_YEAR} sx={{ color: 'text.tertiary' }}>
                    Mandays x {fmtMoney(fin.devDayRate, sym)} a day, from the effort above.
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500, color: p.buildCost == null ? 'text.tertiary' : 'text.primary' }}>
                    {p.buildCost == null ? '—' : Math.round(p.buildCost).toLocaleString()}
                  </TableCell>
                </TableRow>
                <TableRow sx={totalRow}>
                  <TableCell sx={stick}>Total 2026</TableCell>
                  <TableCell colSpan={MONTHS_IN_YEAR} />
                  <TableCell align="right">
                    {Math.round((p.investment ?? 0) + (p.opexYear || 0)).toLocaleString()}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Box>

          {/* ---------- how the ROI is built ---------- */}
          <Box sx={{ ...callout, mt: 4 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>How this project&rsquo;s return is built</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: '80ch' }}>
              {p.investment == null ? (
                <>No mandays and no CAPEX, so the cost is unknown, not zero, and there is no return to state.
                  Enter either one and every figure above fills in.</>
              ) : p.monthlyBenefit == null ? (
                <>Saving hours are still TBC, so there is no benefit to set against the{' '}
                  {fmtMoney(p.investment, sym)} invested. The cost is real and is reported on the Summary sheet,
                  but it cannot produce a return until the hours are quantified.</>
              ) : (
                <>
                  Investment {fmtMoney(p.investment, sym)} is build {fmtMoney(p.buildCost ?? 0, sym)} plus CAPEX{' '}
                  {fmtMoney(p.capex ?? 0, sym)}. Benefit {fmtMoney(p.monthlyBenefit, sym)} a month less OPEX{' '}
                  {fmtMoney(p.opexRunRate, sym)} a month leaves <strong>{fmtMoney(p.netMonthly, sym)} net a month</strong>.
                  Over {horizon} months that is {fmtMoney(p.netHorizonBenefit, sym)}; less the investment it is{' '}
                  <strong>{fmtMoney(p.netBenefit, sym)}</strong> net, a return of <strong>{fmtRoi(p.roi)}</strong>{' '}
                  against a gate of {fmtRoi(fin.roiGate)}
                  {p.paybackMonths == null
                    ? ', and it never pays back.'
                    : `, paying back in ${fmtMonths(p.paybackMonths)}.`}
                </>
              )}
            </Typography>
          </Box>
        </Part>

        {/* ---------- who is credited, and for what ---------- */}
        <TeamRoles p={p} people={plan.people} onUpdate={onUpdate} />

        {/* ---------- the finish date, and who owns it ---------- */}
        <FinishDate p={p} onUpdate={onUpdate} />

        {/* ---------- comments ---------- */}
        <Part title="Notes and links" desc="A decision, a caveat, a link to the spec. Pasted addresses become links once saved.">
          <TextField
            fullWidth
            multiline
            minRows={3}
            size="small"
            placeholder="Type a note, or paste a link…"
            defaultValue={p.comment || ''}
            inputProps={{ 'aria-label': 'notes and links' }}
            onBlur={(e) => {
              const v = e.target.value
              if (v !== (p.comment || '')) onUpdate(p.key, { comment: v })
            }}
          />
          {p.comment ? (
            <Box sx={{ ...callout, mt: 3 }}>
              <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mb: 1 }}>
                As it reads
              </Typography>
              <LinkedText text={p.comment} />
            </Box>
          ) : null}
        </Part>
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
