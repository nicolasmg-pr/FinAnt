# Visual redesign — design

Date: 2026-09-08
Status: approved for planning

## Goal

Replace FinAnt's generic slate-and-hairline look with a deliberate visual
system: a token layer, a primitive component layer, and a per-screen layout
pass. The app keeps every feature, every route and every domain rule it has
today; only how it looks and how its controls are composed changes.

Direction, chosen by the owner: **soft depth** — light, airy, high-radius
surfaces floating on a tinted background, soft multi-layer shadows, pastel
category colours, calm teal accent. System typeface. Restrained motion.

## Non-goals

- No change to the five-tab structure or to any route.
- No new features, no removed features, no new screens.
- No change to domain logic in `packages/core`, to the database schema, or to
  any repository under `src/db/`.
- No renamed or deleted i18n keys. New keys only where a control needs copy
  that does not exist yet.
- No new runtime dependency. `react-native-reanimated` 4.5.1 and
  `react-native-svg` 15.15.4 are already installed; nothing else is added.
- No bundled font.

## Why the app reads templated today

`src/theme.ts` is 44 lines: ten colours, a spacing scale, a radius scale. There
is no typography scale, no elevation, no motion vocabulary. The consequence is
visible in the screens:

- Font sizes appear as raw literals — 30, 24, 17, 16, 14, 13, 12, 9 — chosen
  per file.
- The "add" button is re-implemented in `banks.tsx`, `budgets.tsx`,
  `categories.tsx` and `import.tsx`, each with its own `addButton` /
  `addButtonText` style pair.
- Bottom sheets are hand-built twice (`budgets.tsx`, `categories.tsx`) with
  their own `sheetBackdrop` / `sheet` styles, alongside the existing
  `FormSheet` component that does the same job.
- A label-plus-`TextInput` pair is written out five times (`movement/new.tsx`,
  `categories.tsx`, `budgets.tsx`, `banks.tsx`, `AccountPicker.tsx`).
- Nothing casts a shadow. Every card is a white rectangle with a hairline
  border, so the whole app is flat at one depth.
- Nothing animates. Reanimated is installed and unused.

The redesign therefore has to move the styling decisions out of the screens and
into a shared layer, or the new look decays back into per-file invention.

## Token layer

`src/theme.ts` is replaced by `src/design/`:

```
src/design/
  palette.ts     colour roles, light and dark
  type.ts        six named text roles
  elevation.ts   three depth levels, per-platform
  motion.ts      durations, easings, spring, reduce-motion gate
  spacing.ts     spacing + radius scales
  index.ts       re-exports; useTheme(), useType(), useMotion()
```

`useTheme()` keeps its name and returns a superset of today's `Palette`, so the
existing screens compile untouched while migration proceeds. `src/theme.ts`
remains as a re-export shim until the last screen is migrated, then is deleted.

### Colour

Two roles the current palette lacks: a _tinted_ background so white cards read
as floating rather than as the page itself, and a raised/sunken surface pair so
a card can sit inside a card without a border.

Light:

| Role            | Value     | Use                                           |
| --------------- | --------- | --------------------------------------------- |
| `background`    | `#F2F6F5` | page behind everything                        |
| `surface`       | `#FFFFFF` | cards, sheets                                 |
| `surfaceRaised` | `#FFFFFF` | card inside a card (separated by shadow)      |
| `surfaceSunken` | `#E8EEED` | inputs, progress tracks, inset wells          |
| `surfaceAlt`    | `#E6EDEB` | segmented-control trough, unselected chip     |
| `border`        | `#DDE5E3` | hairlines, kept for dividers only             |
| `text`          | `#0F1D1B` | primary text                                  |
| `textMuted`     | `#556A66` | captions, labels, subtitles                   |
| `accent`        | `#06695F` | interactive, balance line                     |
| `accentPressed` | `#044F47` | pressed fill                                  |
| `accentSoft`    | `#D3EEE9` | tinted button, selected chip, active tab pill |
| `accentInk`     | `#063F3A` | chart strokes drawn over other fills          |
| `onAccent`      | `#FFFFFF` | text on an accent fill                        |
| `income`        | `#26703C` | income figures, income bars                   |
| `incomeSoft`    | `#DBF0E0` | income stat tile background                   |
| `expense`       | `#B32E3C` | expense figures, expense bars, danger         |
| `expenseSoft`   | `#FADFE2` | expense stat tile background                  |
| `warning`       | `#8A5411` | missing balance, invalid date                 |
| `warningSoft`   | `#F8E8D2` | warning banner background                     |

Dark, derived from the same hue anchors. Soft depth in the dark theme comes
from lifting surface lightness, not from shadows — a shadow does not read on a
near-black ground:

| Role            | Value     |
| --------------- | --------- |
| `background`    | `#0B1413` |
| `surface`       | `#131F1E` |
| `surfaceRaised` | `#1A2726` |
| `surfaceSunken` | `#0E1817` |
| `surfaceAlt`    | `#1E2E2C` |
| `border`        | `#263634` |
| `text`          | `#E9F1EF` |
| `textMuted`     | `#93A8A4` |
| `accent`        | `#3FD0BE` |
| `accentPressed` | `#2FB4A4` |
| `accentSoft`    | `#12332F` |
| `accentInk`     | `#9BF7E9` |
| `onAccent`      | `#04231F` |
| `income`        | `#6FD37A` |
| `incomeSoft`    | `#16301C` |
| `expense`       | `#F2777F` |
| `expenseSoft`   | `#33191C` |
| `warning`       | `#E9A84C` |
| `warningSoft`   | `#33260F` |

Both palettes share the same keys, as today, so the dark palette stays
assignable to the light one's type.

**Hue separation constraint.** The accent is teal (≈174°) and income is green
(≈140°). Side by side that is enough; it is not enough when one is a 2px line
drawn over the other as a fill. `ForecastChart` does exactly that: green income
bars, rose expense bars, net line over both. The net line therefore does not
use `accent` at all — it uses `accentInk`, which is deliberately off the
lightness of both bar colours (light theme 1.95:1 against income, 1.89:1
against expense; dark theme 1.50:1 and 2.19:1) — and it carries a 1px
`background`-coloured halo, which is what actually guarantees separation where
it crosses a bar. No chart may place `accent` and `income` as adjacent _fills_.

**Contrast.** Every text-on-surface pair must reach WCAG AA 4.5:1 — the body
threshold, applied to all of them rather than allowing large text 3:1, because
amounts appear at both sizes and a token cannot know which. Nineteen pairs are
asserted per theme, in a test, not by eye. The values above are the tuned
result: the first pass failed nine light-theme pairs (accent on surface 4.24,
income on surface 3.03, warning on warningSoft 3.04), which is why the light
accent, income, expense, warning and textMuted are all darker than a soft-depth
palette would naively pick. Tightest surviving pair is `textMuted` on
`surfaceAlt` at 4.86:1.

**Category colours.** Categories carry a `color` in the database. Those values
are owner data and are not rewritten. What changes: a pastel default ramp
supplies a colour for any category that has none, and the swatch picker in
`categories.tsx` offers the pastel ramp instead of its current saturated set.
Existing rows keep whatever they hold.

### Typography

Six roles. System face (SF Pro on iOS, Roboto on Android) — no bundled font.
Every role fixes size, weight, line height and letter spacing, so no screen
writes a `fontSize` literal again.

| Role      | Size / line | Weight | Tracking | Use                                              |
| --------- | ----------- | ------ | -------- | ------------------------------------------------ |
| `display` | 34 / 40     | 700    | −0.6     | the balance, transaction-detail headline         |
| `title`   | 24 / 30     | 700    | −0.3     | large scrolling screen title                     |
| `heading` | 17 / 22     | 600    | −0.1     | card titles, institution names                   |
| `body`    | 15 / 21     | 400    | 0        | rows, descriptions, paragraphs                   |
| `label`   | 13 / 18     | 500    | 0        | field labels, chips, stat-tile labels            |
| `caption` | 11 / 15     | 500    | +0.3     | axis labels, hints, section headers (uppercased) |

Every role has a `…Money` variant that adds `fontVariant: ['tabular-nums']`.
`Amount` picks its role by a `size` prop instead of accepting a raw style with
a font size in it.

Text roles must respect the OS text-size setting: sizes are multiplied by
`PixelRatio.getFontScale()` where the layout can absorb it, and rows that
cannot absorb it cap at `maxFontSizeMultiplier` rather than clipping.

### Elevation

Three levels, each a ready-made style object carrying iOS `shadowColor` /
`shadowOpacity` / `shadowRadius` / `shadowOffset` **and** Android `elevation`.

| Level | iOS                        | Android | Use                                    |
| ----- | -------------------------- | ------- | -------------------------------------- |
| 1     | `#0F1D1B` @ 0.06, r12, y+4 | 2       | cards                                  |
| 2     | `#0F1D1B` @ 0.09, r20, y+8 | 6       | pressed card, floating action, tab bar |
| 3     | `#0F1D1B` @ 0.16, r32, y−4 | 16      | sheets                                 |

In dark theme the shadow values collapse to none and the level maps to a
surface step instead (`surface` → `surfaceRaised`), so `elevation(2)` means the
same thing to a caller in both themes.

Radius grows for the softer silhouette: `sm` 10, `md` 14, `lg` 20, `xl` 28,
`pill` 999. Spacing keeps its current values (`xs` 4, `sm` 8, `md` 12, `lg` 16,
`xl` 24, `xxl` 32).

### Motion

Minimal, and every piece of it gated on reduce-motion.

| Token         | Value                               | Use                                 |
| ------------- | ----------------------------------- | ----------------------------------- |
| `instant`     | 120 ms, ease-out                    | press dip                           |
| `quick`       | 200 ms, ease-in-out                 | cross-fade between toggled views    |
| `settle`      | 320 ms, ease-out                    | chart draw-in, content fade on load |
| `sheetSpring` | damping 22, stiffness 260, mass 0.9 | sheet slide, sheet dismiss          |

Press feedback is a scale to 0.97 plus no opacity change. Charts draw once on
mount (line stroke reveal, bars growing from the axis) and do not re-animate on
every re-render. Toggling forecast/booked and month/year cross-fades. Nothing
else moves.

`useMotion()` returns the tokens with all durations zeroed and the press scale
at 1 when `AccessibilityInfo.isReduceMotionEnabled()` is true, so callers need
no conditional of their own.

## Primitive layer

New folder `src/components/ui/`. Nine primitives. Existing `Card`, `Chip`,
`Amount` keep working throughout the migration; they are moved and restyled,
not replaced by differently named things.

**`Touchable`** — the single press-feedback wrapper (0.97 dip via Reanimated,
reduce-motion aware, `hitSlop` default 8). Every other interactive primitive
composes it, so press feel cannot drift between components.

**`Card`** — same API (`title`, `subtitle`, `children`), now: no border,
`elevation(1)`, radius `xl`. Adds `padded?: boolean` (a card whose child is a
full-bleed chart or list) and `onPress?: () => void` (so `budgets.tsx` and
`banks.tsx` stop wrapping a Card in a bare `Pressable` that gives no feedback).

**`Button`** — variants `primary` (filled accent), `secondary` (accentSoft
fill, accent text), `danger` (expense text, no fill), plus `size` `md` | `lg`,
`loading`, `disabled`, optional leading Feather icon. Replaces the four
`addButton` implementations and the bare `Pressable`+`Text` actions in
`settings.tsx`, `import.tsx` and `transaction/[id].tsx`.

**`Field`** — label, `TextInput`, optional hint and error. Surface is
`surfaceSunken`, border lifts to `accent` on focus, error state recolours the
border and shows the message. Replaces the five hand-rolled label+input pairs.

**`Sheet`** — one bottom sheet: fading backdrop, spring slide-up, drag handle
with drag-to-dismiss, safe-area padding, keyboard avoidance. `FormSheet`
becomes a thin wrapper over it. The hand-built `Modal` blocks in `budgets.tsx`
and `categories.tsx` are deleted and re-pointed at it.

**`ListRow`** — leading slot (icon or colour dot), title, optional subtitle,
trailing slot (`Amount`, `Switch`, chevron), optional divider, optional
`onPress`. Used by the transaction list, recurring rows, exclusion rules, bank
accounts, budget rows, settings rows, category rows.

**`StatTile`** — a labelled figure on a tone-tinted background (`incomeSoft` /
`expenseSoft` / `surfaceAlt`). Replaces the local `Figure` in the dashboard and
gives the income/expenses/net triple a shared visual identity.

**`SegmentedControl`** — trough in `surfaceAlt`, selected segment a raised
`surface` pill that slides between positions. Used for month/year granularity,
forecast/booked, expense/income on the manual-movement form, and language in
settings.

**`SectionHeader`** — uppercased `caption` label plus optional trailing action.
Replaces the ad-hoc heading `Text`s and the transaction list's date headers.

**`Chip` / `CategoryChip`** — filled-tint when selected (`accentSoft`) instead
of outlined; `CategoryChip` keeps its colour dot. Both compose `Touchable`.

**`Amount`** — logic unchanged (tone still decided independently of sign; the
`side`/sign distinction the domain enforces is untouched). Takes `size`
(`display` | `title` | `body` | `label`) from the type scale rather than a raw
`fontSize` from the caller.

## Screens

### Chrome

Tab-screen headers become transparent; each tab screen renders its own large
`title` in the scroll body so it scrolls away with the content. The tab bar
keeps all five tabs and their icons; the active tab gains a filled `accentSoft`
pill behind its icon instead of a tint-only icon, and the bar sits on `surface`
with `elevation(2)` and a safe-area bottom inset.

Modal stack screens (`import`, `transaction/[id]`, `movement/new`) keep their
navigator headers — they need the explicit dismiss affordance.

### Dashboard (`app/(tabs)/index.tsx`)

The screen that changes most. Today it is five equal-weight bordered cards.

- **Hero**, no card chrome: the balance in `displayMoney` directly on the
  tinted background, the as-of / account-count line beneath it in `caption`,
  then `BalanceChart` full-bleed under it.
- `BalanceChart` gains a soft accent gradient fill under the booked line. The
  projected tail stays dashed, stays unfilled and keeps its reduced opacity —
  a projection must never carry the same visual weight as recorded fact. The
  zero-inside-range rule, the horizontal scroll behaviour and the
  scroll-to-newest behaviour are all preserved exactly.
- The month/year chips become a `SegmentedControl` that keeps the existing
  "outlives the chart" rule: it stays reachable when a single year collapses
  the chart to one point.
- The missing-balance warning and the "set balances" prompt keep their current
  behaviour, restyled as a tappable warning strip on `warningSoft`.
- **Period card**: three `StatTile`s in a row (income, expenses, net), savings
  rate as a caption beneath, pay-period hint unchanged.
- **Top categories**: same ranked bars, pastel-filled, fully rounded track.
- **Year card**: the current tap-the-whole-card toggle is replaced by a
  `SegmentedControl` with forecast / booked. The existing behaviour is
  preserved but made discoverable — today the only affordance is a hint line at
  the bottom of the card. Forecast confidence and the history-months caption
  stay exactly as they are: a projection continues to announce what it was
  built from. The two views cross-fade at `quick`.
- **Recurring**: `ListRow`s.
- Both empty states (no data at all; balances but no movements) keep their
  current copy and their current logic, restyled with a centred icon.

### Transactions (`app/(tabs)/transactions.tsx`)

- Search becomes a rounded `surfaceSunken` field with a leading search icon and
  an inline clear button.
- The filter toggle becomes a chip carrying the active-filter count as a badge.
- The inline expanding filter panel moves into a `Sheet`. Same filters, same
  clear-all, same state.
- Rows become `ListRow`: leading category colour dot, counterparty as title,
  description as subtitle, `Amount` trailing. Density tightens.
- Date group headers become sticky `SectionHeader`s.

### Banks (`app/(tabs)/banks.tsx`)

One `Card` per institution: name as `heading`, each account a `ListRow` with
its balance trailing and its as-of date as subtitle. "Add account" becomes a
`secondary` `Button`, "Add bank" a `primary` one. The unassigned-accounts card
keeps its chip flow, restyled. The rule that the owner names every bank and
account is untouched — nothing is auto-created here.

### Budgets (`app/(tabs)/budgets.tsx`)

Each budget is a pressable `Card` whose `BudgetBar` runs the full width of the
card's bottom edge, thickened 8 → 10 and fully rounded. Over-budget draws a
rose overflow segment; the bar remains a limit bar, not a share bar, and colour
still comes from the domain's `BudgetState` so bar and caption cannot disagree.
The hand-built modal moves to `Sheet`.

### Settings (`app/(tabs)/settings.tsx`)

Grouped `ListRow`s inside cards. Language becomes a `SegmentedControl`. Erase
all becomes a `danger` `Button`. Exclusion-rule rows become `ListRow`s with a
trailing delete action.

### Import (`app/import.tsx`)

The pick-file target becomes a large dashed-border drop zone with an icon and
the supported-formats line inside it. Result counts become `StatTile`s, issues
become `ListRow`s in `caption`. The confirm action is a `primary` `Button`
pinned at the bottom of the scroll. Issue text is rendered exactly as the
parser produced it — no row content is added to it.

### Categories (`app/categories.tsx`)

A card per kind, each category a `ListRow` with its colour dot leading. The
swatch picker offers the pastel ramp. The hand-built modal moves to `Sheet`.
Category ids stay permanent; only labels and colours are editable, as today.

### Transaction detail (`app/transaction/[id].tsx`)

Headline `Amount` at `display` size at the top of the screen, meta (date,
account, kind) as `Chip`s beneath it, then field cards. Switch rows become
`ListRow`s with a trailing `Switch`. Delete becomes a `danger` `Button`.

### Manual movement (`app/movement/new.tsx`)

`Field` throughout. Expense/income becomes a `SegmentedControl`; the reversal
switch becomes a `ListRow`. Save is a pinned `primary` `Button`. The
side-plus-sign semantics the form encodes are unchanged.

## Migration order

Each phase must leave the tree compiling and the app launchable.

1. **Tokens.** Add `src/design/`, make `src/theme.ts` a re-export shim. No
   visual change yet beyond the new palette values.
2. **Primitives.** Add `src/components/ui/`. Restyle `Card`, `Chip`, `Amount`,
   `BudgetBar`, `CategoryBreakdown` in place. The app already looks different
   here, without a single screen being rewritten.
3. **Dashboard slice.** Rebuild `app/(tabs)/index.tsx` and both charts against
   the new primitives. **Checkpoint: screenshot on the simulator, owner
   approves the look before anything else migrates.** If the palette or the
   elevation is wrong, this is where it gets fixed — once, not nine times.
4. **Transactions**, then **Banks**, then **Budgets** — the three list-heavy
   screens, in that order.
5. **Settings**, **Import**, **Categories**, **Transaction detail**, **Manual
   movement**.
6. **Chrome**: tab bar and header treatment.
7. **Cleanup**: delete `src/theme.ts`, delete the dead `sheetBackdrop` /
   `addButton` style blocks, confirm no `fontSize` literal survives in a
   screen or component style sheet. The one exception is the `fontSize` prop
   on `react-native-svg`'s `Text`, which cannot take a style role object; the
   charts read the number off `type.caption` instead of writing `9`.

## Verification

The mobile app has no test runner and this work adds none: a test asserting a
shadow radius is a tautology. One part of the token layer _is_ worth testing,
because it has an objective right answer — `palette.ts` is a pure module with
no React Native import, so its light/dark key parity and all 19 contrast pairs
per theme are asserted in node. `vitest.config.ts`'s `include` gains
`apps/mobile/src/design/tests/**/*.test.ts` for it. Everything else is
verified by:

- `npm run typecheck` clean after every phase.
- `npm run lint:fix` scoped to the changed paths (a repo-wide run reformats
  everything and buries the diff).
- `cd apps/mobile && npx expo export --platform ios` bundles without error.
- Simulator screenshots of every migrated screen in **both** light and dark,
  compared against the previous phase.
- Reduce-motion enabled in simulator settings: confirm no animation runs.
- Largest OS text size: confirm no row clips and no figure truncates.
- `npm test` green, including the palette contrast test.

Screenshots are for review in-session only. None is committed, and the
simulator database is snapshotted before the app is driven, because its data is
the only copy and the key dies with it.

## Risks

- **Palette judged on paper.** The hex values above are a proposal; the
  dashboard checkpoint in phase 3 exists precisely so they get judged on a real
  screen before eight more screens adopt them.
- **Accent/income hue proximity.** Mitigated by the lightness-gap and halo rule
  above, and specifically re-checked on `ForecastChart` at phase 3.
- **Shadow cost on Android.** `elevation` on many list rows is expensive.
  `ListRow` therefore carries no shadow of its own — depth comes from the card
  containing it.
- **Scope creep into behaviour.** Two changes in this spec alter interaction,
  not just appearance: the year card's tap-toggle becomes a segmented control,
  and the transactions filter panel becomes a sheet. Both are called out
  deliberately; nothing else changes what a control does.

## Boundaries respected

No movement, narrative, IBAN or statement content is logged, rendered anywhere
it is not already rendered, or captured into a committed file. No network call
is introduced. No analytics, no crash reporting. Nothing under `src/security/`
or `src/db/database.ts` is touched.
