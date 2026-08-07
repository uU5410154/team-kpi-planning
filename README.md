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
| `Summary` | Target bridge, efficiency gate, concentration risk, data-quality open items |
| `Overall_Objectives` | Per-person column blocks with a weight-total check row |
| `Breakdown Objectives` | All 101 projects with PIC, hours, mandays, ratio, gate, commit level |
| `Obj-<Name>` | One sheet per person: KPI weights, portfolio, contribution shares |

## Stack

React 18 · Vite 6 · MUI 6 · Express · SheetJS. Charts are hand-rolled SVG against a
CVD-validated palette (both light and dark modes pass adjacent-pair separation); every chart
carries direct value labels and a table view.
