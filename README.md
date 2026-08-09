# F&A Tech Team — 2026 Objective & KPI Planning

A planning workbench for the F&A Tech team's 2026 objectives. Reassign PICs, adjust saving hours
and mandays, re-grade what is committed vs stretch, and export a workbook laid out like the
existing "F&A Tech Team Objective" file.

**Live:** deployed on Render from the `main` branch (auto-deploy on push).

## Why this exists

The 2026 project base comes from a Jira export of 101 epics. It has real gaps:

- **41 of 101 epics have no saving-hours value.**
- **No epic has any effort data.** Jira's *Original Estimate*, *Estimated MD* and *Σ Original Estimate*
  fields are empty across the board — so Objective 1 (the manday : saving-hours ratio) has no real
  denominator. Every manday in the seed is a duration-anchored estimate, flagged in italics.
- **21 epics have no resolvable PIC.**
- **The saving-hours basis is unlabelled.** The 2025 workbook counted hours *per month*; the 2026
  target of 3,000 is unlabelled. That is a 12× swing in the economics, so it is an explicit setting.
- **35 epics carrying 1,919 gross hours are built by partner or outsource devs** (`tao`, `buzz`,
  `fah`, `luem`, `fia`, `central-it`, `finance-it`). Whether those hours belong to the six
  scorecard owners is the single largest open question in the plan — see *gross vs net* below.
- **65 of 101 epics are already past their Jira due date**, 40 of them not Done.

Rather than freezing one interpretation into a spreadsheet, this app makes every one of those a
dial you can move in front of your manager and re-export.

## The model

**The 3,000 hr pool.** Objectives 2, 4 (dashboard portion) and 5 all feed one pool. Objective 3
(Data warehouse) is date-gated to Nov 2026 and carries no hour credit. Objective 1 is a gate
applied across everything, not a separate pot of hours.

**Contribution shares.** Jira encodes roles as `pm-`, `lead-`, `dev-`, `qa-`, `support-` labels.
Each role has a raw weight; on every project those weights are **normalised to sum to exactly
100%**. That is what stops a saving hour being banked twice across two scorecards — the flaw that
made the 2025 sheet's per-person totals un-addable. A person holding two roles on one project
counts once, at their strongest role.

**Scorecard weights.** Each role band (Lead / Senior / Analyst) splits into three blocks —
corporate, delivery, capability — that always sum to 1.0. The delivery block is shared across
whichever objectives the person actually holds, in proportion to a configurable priority. A
scorecard therefore totals 100% by construction, regardless of how many objectives someone holds.
(The 2025 sheet totalled 80% for Gun and 75% for James.)

**Gross vs net.** The most consequential dial in the app (Model tab → *Let partner devs dilute the
team's share*).

- **Gross (default)** — the six owners are credited whole projects. Right if the 3,000 hr target
  holds the team accountable for hours delivered, whoever writes the code. The six bank ~3,079 hrs.
- **Net** — partner devs enter the contribution denominator, so the six bank only their own share:
  ~1,804 hrs, with ~1,309 hrs sitting with partners. Kade drops from 1,581 to 455 because
  FNP-1151 (1,262 hrs, 42% of the target) is built entirely by outsource dev `tao`.

The two readings differ by roughly 1,300 hrs and cannot both be true. Settle which one management
intends before any individual target is signed, and never add the six individual targets together
and compare the sum to 3,000 — they are in different units.

Role weights default to the model recommended in the KPI plan (dev 10 / lead 6 / pm 3 /
assignee 3 / qa 2 / support 2, on a 0–1 scale). Under it the app reproduces the plan's
independently-computed per-person figures: P'Phen 472, Kade 455, James 71, Pol 37, Thapanee 5.

**What a project costs.** Three separate things, and the app keeps them separate:

- **Build cost** — mandays × the developer day rate. One-off.
- **CAPEX** — infrastructure, licences, hardware. One-off, entered per project with a free-text
  note. **No depreciation is applied anywhere**: the whole amount is charged against the project,
  by decision, unlike the source `BG 2026` sheet's `D/120` straight-line rows.
- **OPEX** — a list of monthly running-cost lines, each with a start and end month. The Jan–Dec
  grid and its FY total mirror `BG 2026` columns G..R and S.

**Investment** = build cost + CAPEX, where either side may be unknown. Both unknown is `null`, not
zero — a project with no estimate has an *unknown* cost, not a cost of nothing — but either one
present makes the project costed, so a project bought outright with CAPEX and no build effort does
get a return.

The return is then **net monthly** = monthly benefit − the OPEX *run-rate*, over the horizon, less
the investment. The run-rate deliberately ignores each line's start and end months: a licence that
starts in October still costs that much every month for as long as the automation runs, and
charging the horizon only three months of it would flatter the return. The month grid exists for
the 2026 budget, which is why its total and twelve times the run-rate can differ.

When the OPEX is at or above the benefit, **payback is `null`, not a number** — the project never
repays, and rendering that as a fast or negative payback would be a lie.

Click any project row — on the Projects tab or on any scorecard's portfolio — to open its cost
sheet and edit all of it. Cost and benefit are always summed over the *same* set of projects, and
credited to a person on the *same* share as their hours.

**Commit levels.** `commit` is bankable and counts toward the headline; `stretch` is upside shown
separately; `watch` is at-risk and excluded; `excluded` is out of scope. Nothing without a saving-hours
figure is seeded as `commit`.

## Running it

```bash
npm install
npm run dev            # vite dev server on :5173
npm run build && npm start   # production build, express on :5000
node scripts/check-model.mjs # sanity checks on the calculation engine
```

## Data

State lives in the browser (`localStorage`) so the app works on Render's free tier without a
database. Use **⋮ → Save scenario** to download a `.json` you can keep, share, or reload later.
**⋮ → Reset to Jira baseline** discards edits and reloads `src/data/seed.json`.

To regenerate the seed from a fresh Jira export, re-run the extraction that produced
`src/data/seed.json` against the new `JIRA-F&A-Tech-team.xlsx`.

## Export

**Export Excel** produces a workbook mirroring the 2025 layout:

| Sheet | Contents |
|---|---|
| `Summary` | Target bridge, the money gate (build / CAPEX / OPEX / investment / ROI), concentration risk, data-quality open items |
| `Overall_Objectives` | Per-person column blocks with a weight-total check row |
| `Projects` | Every project with PIC, hours, FTE, mandays, build cost, CAPEX, investment, OPEX, benefit, net, ROI, payback, gate, commit level |
| `Costs` | The monthly cost grid: months in G..R and the FY total in S, as in `BG 2026`, with CAPEX and build cost on their own one-off rows |
| `Obj-<Name>` | One sheet per person: KPI weights, portfolio, contribution shares, credited investment and OPEX |

Every figure is written as a **number with a number format**, never a pre-formatted string, so the
workbook can still be sorted, summed and charted.

## Stack

React 18 · Vite 6 · MUI 6 · Express · SheetJS. Charts are hand-rolled SVG against a
CVD-validated palette (both light and dark modes pass adjacent-pair separation); every chart
carries direct value labels and a table view.
