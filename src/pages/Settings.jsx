import { useState, useEffect } from 'react'
import {
  Box, Typography, TextField, Slider, Table, TableBody, TableCell,
  TableHead, TableRow, Select, MenuItem, Alert, FormControlLabel, Switch,
  InputAdornment, FormControl, InputLabel,
} from '@mui/material'
import { OBJECTIVES } from '../lib/palette.js'
import {
  fmtPct, fmtHours, fmtMoney, fmtMoneyShort, fmtRoi, fmtMonths, gateAsHoursPerManday, gateAsPaybackMonths, SAVING_BASIS,
} from '../lib/model.js'
import {
  PageHeader, Section, AboutPage, StatusPill, SectionSkeleton,
} from '../components/ui.jsx'

const BANDS = [
  { id: 'lead', label: 'Team lead' },
  { id: 'senior', label: 'Senior' },
  { id: 'analyst', label: 'Analyst' },
]

/**
 * A number field that can be emptied while it is being retyped.
 *
 * Held as text so a half-typed value is never written to the model, and
 * re-synced whenever the model moves underneath it — a slider drag, another
 * browser's save — so the two can never drift apart.
 */
function useDraft(value) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return [draft, setDraft]
}

/** A unit at the end of a field, in the label colour. */
const unitEnd = (u) => ({
  endAdornment: (
    <InputAdornment position="end">
      <Typography variant="body2" component="span" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{u}</Typography>
    </InputAdornment>
  ),
})

/** Numbers line up on the right, in tabular figures. */
const numInput = (extra) => ({ ...extra, style: { fontVariantNumeric: 'tabular-nums' } })

/**
 * A salary box, same discipline as the gate.
 *
 * `Number('') || 0` wrote a zero the moment somebody selected the figure and
 * pressed backspace to retype it — and a salary of zero prices every hour in
 * the plan at nothing, which takes the whole financial model with it.
 */
function MoneyField({
  label, value, sym, help, onCommit,
}) {
  const [draft, setDraft] = useDraft(value)
  return (
    <TextField
      fullWidth
      size="small"
      type="number"
      label={label}
      value={draft}
      helperText={help}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        if (raw.trim() === '') return
        const n = Number(raw)
        if (Number.isFinite(n)) onCommit(Math.max(0, n))
      }}
      onBlur={() => setDraft(String(value))}
      InputProps={unitEnd(`${sym}/month`)}
      inputProps={numInput({ step: 1000, min: 0 })}
    />
  )
}

/** One fact in a quiet row: a label over a figure. */
function Fact({ label, value, note }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="figureSm" component="div" sx={{ mt: 0.5, whiteSpace: 'nowrap' }}>{value}</Typography>
      {note && <Typography variant="caption" component="div" sx={{ color: 'text.tertiary', mt: 0.25 }}>{note}</Typography>}
    </Box>
  )
}

/** The fields of a section, in a responsive grid with the form gap. */
function Fields({ cols = 1, children }) {
  return (
    <Box sx={{
      display: 'grid',
      gap: 3,
      // Room above for the first row's floating labels.
      pt: 1,
      gridTemplateColumns: { xs: '1fr', sm: `repeat(${cols}, minmax(0, 1fr))` },
      alignItems: 'start',
    }}
    >
      {children}
    </Box>
  )
}

/** Why: a section's long explanation, behind a quiet text button. */
const Why = ({ children }) => <AboutPage label="Why">{children}</AboutPage>

export default function Settings({
  plan, state, onSettings, onPerson, scenarioName, onScenarioName, loading = false,
}) {
  const description = 'The rates and limits behind every figure. Changes save to the shared plan.'
  const [gateDraft, setGateDraft] = useDraft(Math.round((plan?.finance?.roiGate ?? 0) * 100))
  if (loading) {
    return (
      <Box>
        <PageHeader title="Model" description={description} />
        <SectionSkeleton rows={4} />
      </Box>
    )
  }
  void state
  const {
    settings, people, totals, finance: fin,
  } = plan
  const sym = fin.symbol

  const setFinance = (patch) => onSettings({ finance: { ...settings.finance, ...patch } })
  const money = (label, key, help) => (
    <MoneyField
      key={key}
      label={label}
      value={settings.finance[key]}
      sym={sym}
      help={help}
      onCommit={(n) => setFinance({ [key]: n })}
    />
  )
  const projectDrift = Math.round((settings.maxProjectDrift ?? 0.2) * 100)
  const bookDrift = Math.round((settings.maxDriftedShare ?? 0.15) * 100)

  /* ---------------------------------------------------------------- */
  const targets = (
    <Section title="Targets" meta="What the plan is measured against.">
      <Fields>
        <TextField
          fullWidth
          size="small"
          label="Scenario name"
          value={scenarioName}
          onChange={(e) => onScenarioName(e.target.value)}
        />
        <TextField
          fullWidth
          size="small"
          type="number"
          label="Management target, saving hours"
          value={settings.targetHours}
          onChange={(e) => onSettings({ targetHours: Math.max(0, Number(e.target.value) || 0) })}
          InputProps={unitEnd(settings.savingBasis === 'annual' ? 'hrs/year' : 'hrs/month')}
          inputProps={numInput({ min: 0 })}
        />
        <FormControlLabel
          sx={{ alignItems: 'flex-start', ml: 0, gap: 2 }}
          control={(
            <Switch
              checked={settings.includeStretchInHeadline}
              onChange={(e) => onSettings({ includeStretchInHeadline: e.target.checked })}
              sx={{ mt: -0.5, ml: -1.5 }}
            />
          )}
          label={(
            <Box>
              <Typography variant="body1">Count stretch projects in the headline</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Off is the conservative choice: commit to what is bankable, show stretch as upside.
              </Typography>
            </Box>
          )}
        />
      </Fields>
    </Section>
  )

  const basis = (
    <Section
      title="Saving-hours basis"
      meta="Whether each project's saving hours are a monthly or a yearly figure."
      actions={(
        <Why>
          <p>
            Jira does not label its Saving Hours column. The 2025 workbook counted hours per month; the 2026 target of
            3,000 is unlabelled.
          </p>
          <p>The choice changes the economics twelvefold, so confirm it with management before the gate is signed off.</p>
        </Why>
      )}
    >
      <FormControl fullWidth size="small" sx={{ mt: 1 }}>
        <InputLabel id="saving-basis">Each project&rsquo;s saving hours are</InputLabel>
        <Select
          labelId="saving-basis"
          label="Each project’s saving hours are"
          value={settings.savingBasis}
          onChange={(e) => onSettings({ savingBasis: e.target.value })}
        >
          {Object.values(SAVING_BASIS).map((b) => (
            <MenuItem key={b.id} value={b.id}>
              {b.id === 'annual' ? 'A yearly figure' : 'A monthly figure'}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Section>
  )

  const drift = (
    <Section
      title="Drift limits"
      meta="How far a committed date may move before it counts against objective 1."
      actions={(
        <Why>
          <p>
            Each person commits to a date for every project they are PIC of. Two limits then apply, and both are here
            because both are decisions.
          </p>
          <p>
            A single project may drift by a share of its own planned length: a fortnight lost on a three-week job is
            not the failure a fortnight lost on a nine-month one is, and on a quarter-long project 20% is about a sprint.
          </p>
          <p>
            Across everything a person holds, only so much may drift beyond that allowance at all. The denominator is
            what they hold rather than what they have finished, or somebody with one delivered project and nine
            untouched ones would read as perfect.
          </p>
          <p>
            A project still running with time left is not counted either way, and a plan whose start falls after its
            own due date is flagged as data to fix rather than scored.
          </p>
        </Why>
      )}
    >
      <Fields cols={3}>
        <TextField
          size="small"
          type="number"
          label="One project may drift"
          value={projectDrift}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onSettings({ maxProjectDrift: Math.min(200, Math.max(0, n)) / 100 })
          }}
          InputProps={unitEnd('%')}
          inputProps={numInput({ step: 5, min: 0, max: 200 })}
          helperText="Of its own planned length"
        />
        <TextField
          size="small"
          type="number"
          label="Of a person's book"
          value={bookDrift}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onSettings({ maxDriftedShare: Math.min(100, Math.max(0, n)) / 100 })
          }}
          InputProps={unitEnd('%')}
          inputProps={numInput({ step: 5, min: 0, max: 100 })}
          helperText="May drift beyond that"
        />
        <TextField
          size="small"
          type="number"
          label="A sprint is"
          value={settings.sprintDays ?? 14}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n) && n >= 0) onSettings({ sprintDays: Math.round(n) })
          }}
          InputProps={unitEnd('days')}
          inputProps={numInput({ step: 1, min: 0 })}
          helperText="Used where a plan has no length"
        />
      </Fields>
    </Section>
  )

  const rates = (
    <Section
      title="Salaries and rates"
      meta="Two salaries drive every money figure: a manday of build is a cost, an hour handed back is a benefit."
      actions={(
        <Why>
          <p>
            The developer salary prices the people who build the automation; the accountant salary prices the manual
            hours handed back.
          </p>
          <p>
            {fmtHours(totals.totalHours)} hrs/month ÷ {fin.hoursPerFteMonth} = {fin.fteReleased.toFixed(1)} FTE
            released. The source workbook&rsquo;s own FTE column sums to {totals.totalHC.toFixed(1)}.{' '}
            {fin.hoursPerFteMonth === 176
              ? `At the workbook's own ratio of 176 that is the same division, project by project; the ${Math.abs(fin.fteReleased - totals.totalHC).toFixed(1)} difference is rounding alone, because the workbook rounds each row to one decimal before adding them up.`
              : `That column was built at the workbook's ratio of 176 hours; you are dividing by ${fin.hoursPerFteMonth}, so this app and the source will not agree until you put it back.`}
          </p>
          <p>
            This is the value of capacity released, not cash removed from the payroll. Treating it as a headcount
            reduction is a separate management decision.
          </p>
        </Why>
      )}
    >
      <Fields>
        {money(
          'Developer monthly salary',
          'devMonthlySalary',
          `${fmtMoney(fin.devDayRate, sym)} per manday at ${fin.daysPerFteMonth.toFixed(2)} working days a month.`,
        )}
        {money(
          'Accountant monthly salary',
          'acctMonthlySalary',
          `${fmtMoney(fin.acctHourRate, sym)} per saved hour at ${fin.hoursPerFteMonth} hours a month.`,
        )}
      </Fields>
      {/* What the book is worth at these rates: one tinted block, three figures. */}
      <Box sx={{ mt: 4, p: 3, bgcolor: 'bg.subtle', borderRadius: '6px' }}>
        <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary', mb: 2 }}>
          What the book is worth at these rates
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 3 }}>
          <Fact label="FTE released" value={fin.fteReleased.toFixed(1)} note={`${fmtHours(totals.totalHours)} hrs ÷ ${fin.hoursPerFteMonth}`} />
          <Fact label="A month" value={fmtMoneyShort(fin.monthlyBenefit, sym)} />
          <Fact label="A year" value={fmtMoneyShort(fin.annualBenefit, sym)} />
        </Box>
      </Box>
    </Section>
  )

  const fte = (
    <Section
      title="FTE conversion"
      meta="The FTE ratio turns saving hours into FTE released and sets the accountant's hourly rate."
      actions={(
        <Why>
          <p>
            Hours per FTE a month is the FTE ratio, and it does two jobs at once: it turns saving hours into FTE
            released, and it divides the accountant&rsquo;s monthly salary into the hourly rate behind every baht
            figure in the app. Changing it moves both.
          </p>
          <p>
            The default of 176 is the source workbook&rsquo;s own divisor: it computes its FTE column as saving hrs ÷
            (22 × 8), 22 working days of 8 hours.
          </p>
          <p>
            Working days a month is derived, so a manday of cost and an hour of benefit are always quoted against the
            same month. On-cost covers social security, bonus and benefits: it multiplies both rates, so it moves every
            baht figure and leaves every ROI exactly unchanged.
          </p>
        </Why>
      )}
    >
      <Fields cols={3}>
        <TextField
          fullWidth
          size="small"
          type="number"
          label="Hours per FTE / month"
          value={settings.finance.hoursPerFteMonth}
          onChange={(e) => setFinance({ hoursPerFteMonth: Math.max(1, Number(e.target.value) || 1) })}
          InputProps={unitEnd('hrs')}
          inputProps={numInput({ step: 0.1, min: 1 })}
        />
        <TextField
          fullWidth
          size="small"
          type="number"
          label="Hours per manday"
          value={settings.finance.hoursPerManday}
          onChange={(e) => setFinance({ hoursPerManday: Math.max(1, Number(e.target.value) || 1) })}
          InputProps={unitEnd('hrs')}
          inputProps={numInput({ step: 0.5, min: 1 })}
        />
        <TextField
          fullWidth
          size="small"
          type="number"
          label="On-cost multiplier"
          value={settings.finance.loadFactor}
          onChange={(e) => setFinance({ loadFactor: Math.max(0.1, Number(e.target.value) || 1) })}
          InputProps={unitEnd('×')}
          inputProps={numInput({ step: 0.05, min: 0.1 })}
        />
      </Fields>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 3 }}>
        Working days a month: {fin.hoursPerFteMonth} ÷ {fin.hoursPerManday} ={' '}
        <Box component="span" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{fin.daysPerFteMonth.toFixed(2)}</Box>
      </Typography>
    </Section>
  )

  const horizon = (
    <Section
      title="Benefit horizon and return gate"
      meta="How long a delivered automation is credited, and the return it must clear in that time."
      actions={(
        <Why>
          <p>ROI, net benefit and the gate are all stated over the horizon.</p>
          <p>
            A project must return at least the gate on top of everything invested in it, mandays plus any
            infrastructure CAPEX, inside the horizon, counting the benefit net of its monthly OPEX. That is a payback
            of {fmtMonths(gateAsPaybackMonths(fin))}, which at these rates is{' '}
            {gateAsHoursPerManday(fin)?.toFixed(2) ?? '–'} saving hours per manday on a project carrying no CAPEX or
            OPEX, the same standard as the 4.0 hrs/manday gate this replaced. Change a salary and this equivalence
            moves with it.
          </p>
          <p>
            The gate no longer sets anybody&rsquo;s KPI, since objective 1 is on-time delivery now, but it still marks
            a project as failing on the Effort_Return sheet.
          </p>
        </Why>
      )}
    >
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary' }} id="horizon-label">Benefit horizon</Typography>
          <Typography variant="body1" sx={{ fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{fin.horizonMonths} months</Typography>
        </Box>
        <Box sx={{ px: 3 }}>
          <Slider
            aria-labelledby="horizon-label"
            value={fin.horizonMonths}
            min={6}
            max={60}
            step={6}
            marks={[{ value: 12, label: '1 yr' }, { value: 36, label: '3 yrs' }, { value: 60, label: '5 yrs' }]}
            valueLabelDisplay="auto"
            onChange={(_e, v) => setFinance({ horizonMonths: v })}
          />
        </Box>
      </Box>

      <Box sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="subtitle2" component="div" sx={{ color: 'text.secondary' }} id="gate-label">Return gate</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Payback within {fmtMonths(gateAsPaybackMonths(fin))}
          </Typography>
        </Box>
        {fin.roiGate === 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            The gate is 0%, so any project that merely gets its money back passes. That is almost always an
            accident rather than a decision.
          </Alert>
        )}
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 4, mt: 1,
        }}
        >
          <Box sx={{ flex: 1, px: 3, minWidth: 0 }}>
            <Slider
              aria-labelledby="gate-label"
              value={fin.roiGate}
              min={0}
              max={5}
              step={0.25}
              marks={[{ value: 0, label: '0%' }, { value: 1, label: '100%' }, { value: 2, label: '200%' }, { value: 5, label: '500%' }]}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => fmtRoi(v)}
              onChange={(_e, v) => setFinance({ roiGate: v })}
              // On a phone the track is too short for both 100% and 200%:
              // their labels run together, so 100% keeps its tick only.
              sx={{ '& .MuiSlider-markLabel[data-index="1"]': { display: { xs: 'none', sm: 'block' } } }}
            />
          </Box>
          {/* Typed entry beside the slider: the slider moves in 25% steps
              and stops at 500%, which is fine for a rough setting and no
              use at all for entering an exact standard. */}
          {/*
            * Typed into a DRAFT, committed only when it parses.
            *
            * It used to write straight through on every keystroke, and
            * Number('') is 0 — so selecting "200" and pressing backspace
            * to type a new figure set the gate to 0% instantly. Every
            * scorecard then showed a financial target of 0%, which reads
            * as the KPI having been deleted. An empty box means somebody
            * is mid-edit, not that they want no standard at all.
            */}
          <TextField
            size="small"
            type="number"
            label="Exact"
            value={gateDraft}
            onChange={(e) => {
              const raw = e.target.value
              setGateDraft(raw)
              if (raw.trim() === '') return
              const pct = Number(raw)
              if (Number.isFinite(pct)) setFinance({ roiGate: Math.max(0, pct) / 100 })
            }}
            onBlur={() => setGateDraft(String(Math.round(fin.roiGate * 100)))}
            InputProps={unitEnd('%')}
            inputProps={numInput({ step: 5, min: 0 })}
            sx={{ width: 120, flexShrink: 0 }}
          />
        </Box>
        <Box sx={{
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 4, rowGap: 1, mt: 2, typography: 'body2', color: 'text.secondary',
        }}
        >
          <span>
            Portfolio ROI{' '}
            <Box component="span" sx={{ color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{fin.roi == null ? '–' : fmtRoi(fin.roi)}</Box>
          </span>
          <StatusPill tone={totals.failingGate ? 'danger' : 'success'}>
            {totals.failingGate
              ? `${totals.failingGate} project${totals.failingGate === 1 ? '' : 's'} below the gate`
              : 'None below the gate'}
          </StatusPill>
          {fin.uncostedCount > 0 && <span>{fin.uncostedCount} with no cost at all</span>}
          {fin.planOpexYear > 0 && <span>OPEX {fmtMoney(fin.planOpexYear, fin.symbol)} in 2026</span>}
          {fin.planCapex > 0 && <span>CAPEX {fmtMoney(fin.planCapex, fin.symbol)}</span>}
        </Box>
      </Box>
    </Section>
  )

  const credit = (
    <Section
      title="Credit and ownership"
      meta="A project's saving hours go to its PIC, whole, and never to two cards."
      actions={(
        <Why>
          <p>
            A project&rsquo;s saving hours go to its PIC, whole. They are never split across the people recorded on it
            and never shared between two cards.
          </p>
          <p>
            The team roles on a project, PM, developer, QA and the rest, are still recorded and still shown beside it
            on the register and in the workbook. They say who did the work. They no longer move an hour between cards.
          </p>
          <p>
            The team lead is the one exception, and not really an exception: their card is the team&rsquo;s card and
            says so, so it carries everything the team is holding.
          </p>
          <p>
            Projects nobody is PIC of sit on nobody&rsquo;s card. The hours are not lost: they are still in the
            team&rsquo;s book. Filter the Projects page by missing PIC to find them.
          </p>
        </Why>
      )}
    >
      {/*
        * THIS USED TO BE A TABLE OF EDITABLE ROLE WEIGHTS.
        *
        * Credit was split across the contributor record by role weight, so a
        * developer recorded on somebody else's project carried a share of its
        * hours and appeared on their scorecard. A KPI that credits work to
        * somebody who does not own it is one nobody can defend in a review, so
        * the split is gone — and so is the editor for it, because a dial that
        * no longer turns anything is worse than no dial at all.
        */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        {totals.unownedHours > 0 ? (
          <>
            <StatusPill tone="warning" dot>No PIC</StatusPill>
            <Typography variant="body2">
              {fmtHours(totals.unownedHours)} hrs across {totals.unownedCount} project
              {totals.unownedCount === 1 ? '' : 's'} are on nobody&rsquo;s scorecard.
            </Typography>
          </>
        ) : (
          <>
            <StatusPill tone="success" dot>Every project owned</StatusPill>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Every project carrying hours has somebody named to it.
            </Typography>
          </>
        )}
      </Box>

      <FormControlLabel
        sx={{ alignItems: 'flex-start', ml: 0, gap: 2, mt: 3 }}
        control={(
          <Switch
            checked={settings.creditPartners}
            onChange={(e) => onSettings({ creditPartners: e.target.checked })}
            sx={{ mt: -0.5, ml: -1.5 }}
          />
        )}
        label={(
          <Box>
            <Typography variant="body1">Let partner developers dilute the team&rsquo;s share</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              35 projects are built partly or wholly by partner and outsource developers (tao, buzz, fah, luem, fia,
              central-it, finance-it).
            </Typography>
          </Box>
        )}
      />
      <Box sx={{
        mt: 3, p: 3, bgcolor: 'bg.subtle', borderRadius: '6px', typography: 'body2', color: 'text.secondary',
      }}
      >
        <Box>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>Off (gross):</Box> the six owners are
          credited the whole project. Right if the 3,000 hr target holds the team accountable for hours delivered,
          whoever writes the code.
        </Box>
        <Box sx={{ mt: 1 }}>
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 500 }}>On (net):</Box> partner developers enter
          the denominator, so the six can only bank their own share. Right if each person is scored on personal
          contribution.
        </Box>
        <Box sx={{ mt: 2, color: 'text.primary' }}>
          Bankable by the six now:{' '}
          <Box component="span" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(totals.bankableHours)} hrs</Box>,{' '}
          {fmtPct(totals.bankableCoverage)} of target
          {totals.partnerHours > 0 && `, with ${fmtHours(totals.partnerHours)} hrs sitting with partners`}.
        </Box>
        <Box sx={{ mt: 0.5 }}>
          The two readings differ by roughly 1,050 hrs. Settle which one management intends before any individual
          target is signed.
        </Box>
      </Box>
    </Section>
  )

  const inlineNum = (t) => ({
    '& .MuiOutlinedInput-root': { bgcolor: 'transparent' },
    '& .MuiOutlinedInput-root:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
    'tr:hover & .MuiOutlinedInput-root:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: t.palette.border.strong },
    '@media (hover: none)': {
      '& .MuiOutlinedInput-root:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: t.palette.border.subtle },
    },
  })

  const emphasis = (
    <Section
      title="Objective emphasis"
      meta="Relative weight inside the delivery block, normalised across the objectives a person holds."
      padded={false}
    >
      <Table size="small" aria-label="Objective emphasis">
        <TableHead>
          <TableRow>
            <TableCell sx={{ pl: 4 }}>Objective</TableCell>
            <TableCell align="right" sx={{ pr: 4, width: 132 }}>Priority</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {OBJECTIVES.map((o) => (
            <TableRow key={o.id} hover>
              <TableCell sx={{ pl: 4 }}>
                <Typography variant="body1">{o.no}. {o.name}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {o.target}{o.countsToPool ? '' : ', date-gated, no hour credit'}
                </Typography>
              </TableCell>
              <TableCell align="right" sx={{ pr: 3 }}>
                <TextField
                  size="small"
                  type="number"
                  value={settings.objectivePriority[o.id] ?? 1}
                  onChange={(e) => onSettings({
                    objectivePriority: {
                      ...settings.objectivePriority,
                      [o.id]: Math.max(0, Number(e.target.value) || 0),
                    },
                  })}
                  inputProps={{
                    step: 0.5,
                    min: 0,
                    'aria-label': `Priority of objective ${o.no}`,
                    style: { fontVariantNumeric: 'tabular-nums', textAlign: 'right', paddingRight: 4 },
                  }}
                  // A number lines up under its header: right-aligned, no spinner beside it.
                  sx={[inlineNum, {
                    width: 96,
                    '& input[type=number]': { MozAppearance: 'textfield' },
                    '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', m: 0 },
                  }]}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )

  const roster = (
    <Section title="Team roster and bands" meta="Each person's band, and the saving hours credited to them." padded={false}>
      <Table size="small" aria-label="Team roster">
        <TableHead>
          <TableRow>
            <TableCell sx={{ pl: 4 }}>Person</TableCell>
            <TableCell sx={{ width: 160 }}>Band</TableCell>
            <TableCell align="right" sx={{ pr: 4, width: 132 }}>Credited hrs</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {people.map((p) => (
            <TableRow key={p.id} hover>
              <TableCell sx={{ pl: 4 }}>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>{p.nick}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>{p.name}</Typography>
              </TableCell>
              <TableCell>
                <Select
                  size="small"
                  value={p.band}
                  onChange={(e) => onPerson(p.id, { band: e.target.value })}
                  inputProps={{ 'aria-label': `Band of ${p.nick}` }}
                  sx={[inlineNum, {
                    width: 136, bgcolor: 'transparent', '& .MuiSelect-select': { py: '6px', pl: 2 },
                    '&:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: 'transparent' },
                    'tr:hover &:not(.Mui-focused) .MuiOutlinedInput-notchedOutline': { borderColor: 'border.strong' },
                  }]}
                >
                  {BANDS.map((b) => <MenuItem key={b.id} value={b.id}>{b.label}</MenuItem>)}
                </Select>
              </TableCell>
              <TableCell align="right" sx={{ pr: 4, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmtHours(p.hours)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )

  const column = (children) => (
    <Box sx={{
      display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 }, minWidth: 0,
    }}
    >
      {children}
    </Box>
  )
  const grid = {
    display: 'grid',
    gap: { xs: 3, sm: 4 },
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
    alignItems: 'start',
  }

  return (
    <Box>
      <PageHeader title="Model" description={description} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: { xs: 3, sm: 4 } }}>
        <Box sx={grid}>
          {column(<>{targets}{basis}{drift}{credit}</>)}
          {column(<>{rates}{fte}{horizon}</>)}
        </Box>
        <Box sx={grid}>
          {emphasis}
          {roster}
        </Box>
      </Box>
    </Box>
  )
}
