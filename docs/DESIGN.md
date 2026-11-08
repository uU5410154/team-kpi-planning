# F&A Tech KPI Planning: design system (v2, "Ledger")

A calm, dark-first tool for a finance team. Professional here means:
- quiet surfaces
- one clear action per area
- numbers that line up
- colour only where it means something (status)
- short plain copy

The owner's standing direction wins over any taste call: **dark, muted, professional, no bright fills, no glows, clear calls to action, works on a phone, spinners or skeletons while loading, never an "empty" message while loading.**

Evolve the existing MUI v5 theme (src/theme.js); do not rewrite the component library. Every `data-*` attribute in the code is a test hook. Keep each one on an element with the same meaning.

---
## 1. Tokens

### 1.1 Colour roles
Remove the violet/indigo navy (#070818, #0d0f26, rgba violet glows) and replace it with a cool slate neutral.
- No radial gradients, no `backdropFilter`, no `sheen`, no gradient backgrounds anywhere (one exception: chart fills defined in lib/palette.js).
- Brand colour exists only as the primary action/link colour.

| Role | Dark | Light | Use |
|---|---|---|---|
| bg.page | #0F1318 | #F5F6F8 | app background, behind everything |
| bg.sidebar | #0F1318 | #FFFFFF | side navigation (same as page in dark; divided by border) |
| bg.surface | #151A21 | #FFFFFF | sections, cards, tables |
| bg.subtle | #1A2029 | #F0F2F5 | table header row, hovered row, group rows, segmented-control track |
| bg.raised | #1E2530 | #FFFFFF | menus, popovers, dialogs, toasts (with shadow) |
| border.subtle | #252D38 | #E3E6EB | default 1px border and dividers |
| border.strong | #344050 | #CBD1D9 | input outline, outlined button, focused containers |
| text.primary | #E6E9EE | #161B22 | body, values |
| text.secondary | #A2AAB7 | #4F5866 | labels, meta, descriptions |
| text.tertiary | #7A8491 | #6B7482 | placeholder, hints, disabled-ish (must stay ≥4.5:1 on surface for text ≥12px: use only for non-essential text) |
| text.disabled | #555E6B | #A3AAB5 | disabled controls only |
| primary.main | #3D6FD9 | #2F5FC4 | primary button fill, selected tab indicator, focus ring, checkbox |
| primary.hover | #3563C4 | #284FA6 | hover of primary fill |
| primary.text | #82A7F2 | #2F5FC4 | links, text buttons, selected nav icon |
| primary.tint | rgba(61,111,217,0.14) | rgba(47,95,196,0.08) | selected nav item, selected row |

Status (meaning only; always paired with a word):

| Tone | Dark fg (text on tint) | Dark solid | Light fg | Light solid | Tint bg (dark / light) |
|---|---|---|---|---|---|
| success | #6CC495 | #3FA672 | #1F7A4D | #2E9461 | α .14 / α .10 of solid |
| warning | #E0A955 | #C98A2E | #8F5A0B | #B87A1E | same |
| danger | #EC8A8F | #D0545B | #B3343B | #C8454C | same |
| info | #8DB3F0 | #4F86D9 | #2C5FB3 | #3F74CC | same |
| neutral | #A2AAB7 | #6B7482 | #4F5866 | #8A93A3 | rgba(162,170,183,.12) / rgba(79,88,102,.08) |

Rules:
- Big numbers are always text.primary. Show status beside the number (pill, or delta text in the tone fg), never by colouring the figure.
- Solid status colours are used only for small marks: a 6px dot, a 2px progress bar fill, chart bars. A status never fills a button or a large area.
- Chart series colours stay in src/lib/palette.js (colour-blind checked). Foundation only re-tunes STATUS there to the table above.
- Person avatars use neutral initials (bg.subtle, text.secondary). There is no per-person colour except inside charts.

### 1.2 Typography
- Family: `"Inter", "Noto Sans Thai", system-ui, -apple-system, "Segoe UI", sans-serif`.
  - Reason for the addition: Inter has no Thai glyphs, so Thai currently falls back to whatever the OS has (Thonburi/Leelawadee/Tahoma) with mismatched x-height and line spacing. Noto Sans Thai matches Inter's proportions.
  - Load it with Inter in index.html: `family=Inter:wght@400;500;600&family=Noto+Sans+Thai:wght@400;500;600`.
- Weights: **400, 500, 600 only.** No 650/700/800.
- `font-variant-numeric: tabular-nums` on body (global). Numbers in tables and figures must align.
- Letter-spacing 0 everywhere except display sizes (−0.01em). **No uppercase transforms anywhere.** Acronyms the team writes in caps (FTE, ROI, CAPEX, OPEX, POC, UAT, PIC) stay as written.

| Token | MUI variant | Size / line | Weight | Use |
|---|---|---|---|---|
| display | h1 | 22 / 28 (phone 20/26) | 600, −0.01em | page title (one per page) |
| title | h2 | 16 / 24 | 600 | section/card title, dialog title (18/26 in dialogs) |
| subtitle | h3 | 14 / 20 | 600 | sub-group heading, table group row, task title |
| body | body1 | 14 / 20 | 400 | default text, inputs, buttons, table cells |
| body-sm | body2 | 13 / 18 | 400 | meta lines, descriptions under titles, helper text |
| label | subtitle2 | 12 / 16 | 500 | field labels, table headers, figure labels, pill text (sentence case) |
| caption | caption | 12 / 16 | 400 | timestamps, footnotes |
| figure-lg | (custom `figure`) | 28 / 32 | 600 | headline figure in a figure strip (max 1 row per page) |
| figure-md | (custom `figureSm`) | 20 / 28 | 600 | secondary figures, stat values in cards |

Line length: paragraphs max 72ch (`maxWidth: '72ch'`).

### 1.3 Spacing
- Base unit 4px (theme.spacing stays 4: `sx p: 4` = 16px).
- Scale: 4, 8, 12, 16, 20, 24, 32, 40, 48.

| Context | Desktop ≥900 | Tablet 600–899 | Phone <600 |
|---|---|---|---|
| page padding (x) | 24 | 20 | 12 |
| page header → content | 20 | 16 | 12 |
| gap between sections | 16 | 16 | 12 |
| section inner padding | 16 (header 16/16/12) | 16 | 12 |
| form field gap | 12 | 12 | 12 |
| table cell padding | 8 × 12 | 8 × 12 | 8 × 8 |

### 1.4 Radii

| Element | Radius |
|---|---|
| pill, kbd, small tag | 4 |
| button, input, select, toggle, icon button, tooltip | 6 |
| section / card / table container / menu / popover | 8 |
| dialog, drawer edge, toast | 12 |
| avatar, status dot | 50% |

There is one radius per level. Never put 14/16/20/24px corners on in-page surfaces.

### 1.5 Elevation and borders
- In-page surfaces are flat: `bg.surface` plus a 1px `border.subtle`. No box-shadow, no gradient, no backgroundImage.
- Overlays (menu, popover, select list, dialog, toast, chat drawer) use `bg.raised`, a 1px border.subtle, and a shadow: dark `0 8px 24px rgba(0,0,0,.45)`, light `0 8px 24px rgba(16,24,40,.12)`.
- Dialog backdrop: dark rgba(5,8,12,.6), light rgba(16,24,40,.35). No blur.
- **No nested bordered boxes.** Inside a section, list items are rows separated by 1px dividers, not cards inside the card. A tinted inner block (bg.subtle, no border) is allowed for one callout per section.

### 1.6 Focus and motion
- Focus: `outline: 2px solid primary.main; outline-offset: 2px` on `:focus-visible` for every interactive element. Set it globally in MuiCssBaseline (focus.js `focusRingSx` follows the token).
- Motion: 120ms for hover/press colour, 180ms ease-out for expand/collapse, drawer 200ms.
- No entrance animations, no pulsing, no animated gradients. pulse.js (scroll-to-target highlight) becomes a single 1.2s fade of primary.tint on the target row.
- Respect `prefers-reduced-motion: reduce`, which turns all transitions off.

---
## 2. App shell

```
desktop ≥900px (sidebar 232 / mini 64)
┌──────────────┬──────────────────────────────────────────────────────────────┐
│ ▣ F&A Tech   │ [⌕ Search pages, projects, people   /]      Ask  Export  ◐  ⋮ │ 56px top bar, sticky,
│   KPI 2026   ├──────────────────────────────────────────────────────────────┤ bg.page, border-bottom
│              │                                                              │
│ ▢ Dashboard  │  PAGE HEADER (see §3)                                        │
│ ▢ Projects   │                                                              │
│ ▢ Scorecards │  SECTION                                                     │
│ ▢ Weekly     │  SECTION                                                     │
│ ▢ Overall    │                                                              │
│ ▢ Timeline   │  content max-width 1440, centred, padding 24                 │
│ ▢ Apps       │                                                              │
│ ─────────    │                                                              │
│ ▢ Model      │                                                              │
│ ▢ Access     │                                                              │
│              │                                                              │
│ 4,227/3,000  │                                                              │
│ ▔▔▔▔▔▔▔▔▔▔   │                                                              │
│ (B) Boss   ⋯ │  ← user row: menu = View as a team member, Theme, Sign out   │
└──────────────┴──────────────────────────────────────────────────────────────┘
phone <600px
┌──────────────────────────────────────┐
│ ☰  Projects                    ⌕  ⋮ │ 52px, sticky. ⋮ holds Ask, Export, theme, scenario items
├──────────────────────────────────────┤
│ PAGE HEADER (title, actions wrap)    │
│ content, padding 12                  │
└──────────────────────────────────────┘
```

- **Sidebar**: full height, flush to the left edge (no floating rounded panel, no 12px outer margin), `bg.sidebar`, 1px border-right.
  - Top: a 24px neutral app mark plus "F&A Tech KPI" (14/600) and "2026 plan" (12, secondary).
  - Nav items: 36px tall, radius 6, 20px **monochrome outlined icons** (text.secondary; selected = primary.text), label 14/500.
  - Selected item: bg primary.tint, text.primary. No inset bar, no coloured icon tiles (drop PAGE_COLOR from navigation).
  - Admin-only pages (Model, Access) sit under a divider.
  - Coverage meter: a compact block (label 12 secondary, value 14/600 tabular, 4px bar in success/warning/danger solid, one caption line), no border box.
  - User row at the bottom: 28px neutral avatar, name 13/500, role 12 secondary in sentence case ("Administrator", "Team member", "Admin viewing as member"), and a ⋯ menu.
    - The menu holds: "View as a team member" (switch), "Light mode"/"Dark mode", and "Sign out".
    - This replaces the large View-as card and the separate Sign out button. The `aria-label`s "view as a team member", "Sign out", "collapse menu" and "expand menu" remain.
  - The fold control is a 28px icon button in the sidebar header.
- **Tablet 600–899**: the sidebar defaults to the 64px mini rail (icons with tooltips), and the user can expand it as an overlay. This is not remembered as the desktop preference.
- **Top bar** (≥600):
  - Global search on the left (max 360px, `/` hint as a 4-radius kbd).
  - Right: Ask (outlined, admin, AI on), Export Excel (outlined, admin), theme icon button, ⋮ (scenario/publish/reset).
  - No page title, page icon or product subtitle in the top bar: the page header owns the title. The save status ("Saving…", "Saved", "Not saved yet") sits at the left of the right-hand group as caption text.
  - Phone: ☰, current page name (16/600, truncates with ellipsis), search icon, ⋮ (Ask, Export Excel, theme, scenario items).
- **Week switcher**: lives in the Dashboard's page header, not the top bar. App.jsx passes `week` and `onWeekChange` to Dashboard.
- **View-as banner**: a slim 40px bar under the top bar, bg.subtle, with an info dot, "Viewing as a team member: <name select>" and a "Back to administrator" text button. It has no bright outline.

## 3. Page header

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ‹ Back (optional, text button, only on drill-down pages)                  │
│ Projects                                     [Secondary] [Secondary] [Primary] ⋮ │
│ 86 projects in the 2026 register.  (one line, body-sm, secondary)  ⓘ About │
├───────────────────────────────────────────────────────────────────────────┤
│ optional tabs row (underline tabs) or toolbar row (search + filters)      │
└───────────────────────────────────────────────────────────────────────────┘
```

- Component: `<PageHeader title description actions back help>{tabsOrToolbar}</PageHeader>` from src/components/ui.jsx.
- Title h1 22/600. Description: at most one sentence, ≤ 110 characters, body-sm secondary.
- Actions are right-aligned: at most **one** contained primary, up to two outlined/text secondaries, everything else in a ⋮ menu. On a phone the actions wrap under the title, and the primary goes full width only if it is the page's main task.
- `help`: optional content shown in a popover from an "About this page" text button (ⓘ). All long explanations move here: How it works, How to read it, the drift rule essay, About the passwords, the projects how-to note. **No info Alerts used as page introductions.**
- No header background, no border. Separation from content is 20px of space.

## 4. Section (card)

```
┌─ bg.surface, 1px border.subtle, radius 8 ────────────────────────────────┐
│ Who holds what                                  [All | Not updated]  ⋮   │ title 16/600 + actions
│ 17 active projects, this week and last          (meta: body-sm secondary)│
├──────────────────────────────────────────────────────────────────────────┤ divider only before tables/lists
│ body: rows separated by dividers, or a table, or a form                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

- Component: `<Section title meta actions dense padded={true} {...dataProps}>`. `dense` gives 12px padding, and `padded={false}` lets a table run edge to edge. CardFrame (dashboard) renders the same visual.
- The section title is required unless the section is the only content of the page. At most one meta line under the title.
- Never put a Section inside a Section. Never stack an Alert, then a Section, then an Alert: one callout per section, at its top, as a tinted block.
- Equal-height rows on dashboards are allowed, but a card must not be more than about 30% empty. Size cards to content, and put "nothing yet" states in one line (see §9).

## 5. Tables

- Container: Section with `padded={false}`. The header row uses bg.subtle with label typography (12/500, **sentence case**, text.secondary) and is 36px tall. Rows are 44px (dense 36px) and have a hover of bg.subtle.
- Numeric columns are right-aligned and tabular. Units go in the header ("Saving hrs/mth"), not in every cell. Missing values are an en dash in text.tertiary.
- Text that does not fit truncates with an ellipsis on a whole word and shows the full text in a tooltip. **Never clip mid-glyph** (fix `Accountir`). Use min-widths so a column never shrinks below its header.
- Wide tables scroll horizontally inside their container, with the first column (key/name) sticky and a 12px fade on the scrolling edge. A table must never be cut off by the page edge.
- Inline-editable cells look like plain text at rest. On row hover they show a 1px border.strong box (radius 6), and on focus they become the input with a primary outline. **No permanent underlines (MUI `standard` variant) in tables.** Selects at rest show value plus a caret in text.tertiary.
- Group rows (owner, objective) use bg.subtle and h3, with the count in body-sm secondary.
- Sort indicator: 14px arrow beside the header label. The sorted column header goes text.primary.
- Phone: tables with more than 4 columns become row lists. Each row shows its name (14/500), one meta line (body-sm secondary), a right-aligned key figure and a status pill, and opens the detail on tap.

## 6. Figures and stat display

```
┌─ one Section, columns split by 1px dividers ──────────────────────────────┐
│ Projects in view   │ Saving hrs/month │ Delivered   │ FTE released │ … │
│ 86                 │ 4,227            │ 1,868       │ 23.9         │   │ figure-md (20/600) or -lg once per page
│ 2 still TBC        │ 141% of target   │ status Done │              │   │ caption tertiary
└──────────────────────────────────────────────────────────────────────────┘
```

- `<FigureStrip items={[{label, value, unit, note, info, tone, 'data-stat': …}]} />`. The label is 12/500 sentence case secondary, with an optional ⓘ tooltip. `tone` colours only a small pill or note, never the value.
- StatTile (dashboard) keeps its API with the same visual: label, value with unit, note. A dash "—" in tertiary means not entered.
- At most 6 figures in one row on desktop, 3 on tablet, and 2 per row on a phone. A phone shows the first 4 and a "Show all figures" text button.
- No big figures inside a gradient hero. The Dashboard's welcome becomes a plain summary section (see the Dashboard brief).

## 7. Status pills

- `<StatusPill tone="success|warning|danger|info|neutral" dot?>Plan late</StatusPill>` (Brand.jsx `Pill` keeps working: its tones map high→danger, medium→warning, low→info, good→success, bad→danger, warn→warning, info→info, violet→info, neutral→neutral).
- Pills are 20px tall, padding 0 8, radius 4, label 12/500, **sentence case**, with tint bg and tone fg, and no border.
- Use them for state only (Done, In progress, Past due, On hold, Plan late, Report missing, Waiting, Sent, Live, UAT, POC, In development). Show at most two per row. Write them as states: "Plan late", not "PLAN: LATE".
- Counts that are not states ("1 to update", "2 projects") are plain body-sm secondary text, not pills.

## 8. Buttons and actions

| Kind | MUI | Look | When |
|---|---|---|---|
| Primary | contained, color primary | primary fill, white text, no shadow | the one main action of a page/section/dialog (Submit, Save layout, Add project, Send email) |
| Secondary | outlined | border.strong, text.primary, transparent | other actions (Export Excel, Columns, Edit layout, Import) |
| Tertiary | text | primary.text, no bg | low-emphasis and inline (Show all 10, Add task, About this page, Cancel) |
| Danger | outlined/text color error | danger fg; confirm dialog before destructive | Delete, Remove |
| Icon | IconButton 32px (40 on phone) | text.secondary → text.primary on hover, bg.subtle hover | toolbars, row actions; always with Tooltip + aria-label |

- Height 32 (size small) by default. A page-header primary is 36, and phone buttons are 40.
- Labels are verb first, in sentence case, and say exactly what happens: "Add project", "Save layout", "Send follow-up", "Submit update". No arrows (→, ↗) in labels, and no emoji.
- Loading: the button keeps its width and shows a 14px spinner in place of the start icon with the label "Saving…". It is disabled while busy.
- Never two contained buttons side by side.

## 9. Forms, empty, loading, error

- Inputs: MUI outlined, `size="small"` (36px), radius 6, bg transparent (dark) / #FFF (light), border.strong.
  - Labels use the MUI floating label everywhere (consistent). Helper text is 12 secondary. Required-field errors show on submit, inline under the field in danger fg, plus one summary line next to the submit button ("Fill in the 2 marked fields.").
- Choice groups (Finished / Not finished / On hold): a ToggleButtonGroup 36px tall with a neutral selected state (bg.subtle plus a check icon plus text.primary). Tone colour may appear on the selected button's icon only.
- **Loading**: when content takes over 300ms, show a skeleton that matches the layout (header bar, figure strip, 5 table rows) using MUI Skeleton (wave off, bg.subtle). The whole-app boot shows a centred 24px spinner with one line. Inline refresh shows a 14px spinner beside the section title. Never show "No …" text before data has loaded.
- **Empty**: `<EmptyState icon title body action />`. It is centred in its section with 24px vertical padding: a 24px icon in text.tertiary, a 14/500 line saying what is empty, a 13 secondary line on how to fill it, and an optional single action. Inside small dashboard cards it is a one-line row.
- **Error**: `<ErrorState title body onRetry />` uses an outlined danger Alert (radius 8, no fill).
  - It says what failed and what to do: "Jira did not answer. Your text is kept; try again." It carries a "Try again" button.
  - The DB-down and AI-off cases each say their consequence in one line, and AI buttons are hidden, not shown disabled without reason.

## 10. Dialogs, drawers, menus, toasts

- Dialog: bg.raised, radius 12, max widths: sm 480 (confirm, follow-up, add app), md 720 (import, columns), lg 1040 (project detail, cost sheet).
  - Title 18/600 left with a close icon right. Body padding 20 with sections separated by 20px of space, not boxes. The actions bar on the right is Cancel (text) then primary.
  - Phone (<600): full-screen (`fullScreen`), sticky title bar and sticky actions.
- Popover confirmations (follow-up) follow the dialog type rules: a title in sentence case, not an ALL-CAPS eyebrow.
- Drawer (Ask chat): right side, 440px (phone full width), bg.raised, header 56px. Suggestions are text rows with dividers, not bordered chips.
- Menus: bg.raised, radius 8, item height 36, 20px icon in text.secondary, and dividers between groups.
- Toasts: bottom-left on desktop and bottom-centre on phone. bg.raised with a 3px left bar in the tone solid, 14 text, an optional action. Success auto-hides at 4s; errors stay until dismissed. Never a filled colour toast.

## 11. Tabs, segmented controls, filters

- Page-level sections use **underline tabs** (MUI Tabs): 40px tall, label 14/500 sentence case, selected text.primary with a 2px primary indicator, unselected secondary. Counts go after the label in text.tertiary ("Live 7").
- View/filter switches inside a section (All / Not updated, Day / Week / Month) use a **segmented control**: ToggleButtonGroup 32px with a bg.subtle track and the selected item on bg.surface with text.primary. Labels are sentence case.
- Filter toolbar: one row of `size="small"` selects (min-width 140) after a search field (flex 1, max 360), then a "Clear filters" text button when any filter is set. The result count ("Showing 86 of 86") is caption text at the right end of the row.
  - Phone: search plus a "Filters" button opening a bottom sheet dialog, with the active filter count in the button ("Filters (2)").

## 12. Layout grid and responsive rules

- Breakpoints (MUI): xs <600 phone, sm 600–899 tablet, md 900–1199 laptop, lg ≥1200 desktop.
- Content container: max-width 1440, centred. Full-bleed data pages (Projects table, Timeline chart) may use the full width.
- Grid: 12 columns with a 16px gutter. Dashboard cards snap to it.
- Alignment: everything left-aligned. Numbers right-aligned in tables and figures. No centred text except empty states and the sign-in card.
- At 1280 and 1440 nothing is clipped, and wide tables scroll inside their section. At 768 the sidebar is a mini rail and two-column sections stack. At 390 everything is one column, there is no horizontal page scroll, and tap targets are at least 40px.

## 13. Copy rules

- Sentence case everywhere: titles, buttons, tabs, headers, pills.
- Plain active verbs. The button "Send follow-up" leads to the toast "Follow-up sent".
- One job per line. Descriptions are at most one sentence. Explanations go into the About popover.
- No middle-dot meta strings ("FNP-939 · due 30 Jun · has Jira work this week"). Write them as short labelled fragments separated by commas or as separate columns: "FNP-939, due 30 Jun", with a separate "Jira this week" pill or icon if the fact matters.
- No em-dash chains in UI chrome. No "Hello Boss" or marketing tone. Errors never apologise and always say what to do next.
- Formats: dates "2 Nov 2026" (short "2 Nov"), time "08:00", money "฿8.6M" / "฿170", hours "4,227 hrs/mth", percentages "141%".
- Thai content is rendered as typed. Never uppercase or letter-space it, and give it line-height ≥ 1.5 in paragraphs.

## 14. Accessibility floor

- Body text contrast ≥ 4.5:1, large text and UI borders ≥ 3:1, in both modes (check text.tertiary on bg.surface).
- A visible focus ring on every control (§1.6). Keyboard reachable: nav, tabs, table row open (Enter), dialogs trap focus, Esc closes.
- Icon-only buttons have an aria-label and a Tooltip. Status is never colour alone (always a word).
- `role="status"` on loaders (Loading keeps `data-loading`). Live region for toasts.
- Tap targets 40px on phone. Respect reduced motion.

## 15. Shared primitives (src/components/ui.jsx; foundation creates, pages use)

```js
export function PageHeader({ title, description, actions, back /* {label,onClick} */, help /* node */, children })
export function Section({ title, meta, actions, children, dense=false, padded=true, sx, ...rest /* data-* passthrough */ })
export function FigureStrip({ items /* [{label, value, unit, note, info, tone, key, dataAttr}] */, max })
export function StatusPill({ tone='neutral', dot=false, children, title, sx })
export function EmptyState({ icon, title, body, action })
export function ErrorState({ title, body, onRetry, retryLabel='Try again' })
export function SectionSkeleton({ rows=5, figures=0, header=true })
export function Toolbar({ children, count /* node at right */ })
export function AboutPage({ children, label='About this page' })   // text button + popover
```

Existing exports keep their names and signatures and are restyled centrally: Brand.jsx (`Pill`, `IconTile`, `PILL`, `PAGE_COLOR`, `personColor`, `displayName`, `statusTone`, `WelcomeBanner`), Loading, StatTile, CardFrame, WeekSwitcher, FollowUp, ActiveControl.
- `WelcomeBanner` becomes a plain Section-style summary: no gradient, no arcs, no glow.
- `IconTile` becomes neutral: bg.subtle, text.secondary icon, radius 6.
