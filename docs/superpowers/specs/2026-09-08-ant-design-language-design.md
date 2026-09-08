# Ant design language and app icon

**Date:** 2026-09-08
**Status:** Approved, ready for an implementation plan

## Why

FinAnt is named for the ant: work and save a little at a time, and the year
takes care of itself. Nothing in the app says so. The icon is still the Expo
placeholder — a blue chevron on pale blue, construction guides included — and
the interface, while coherent since the visual redesign, carries no idea of its
own beyond "a tidy finance app".

This adds the metaphor in the two places it can carry weight without turning a
statement viewer into a toy: the icon, which becomes an ant, and the interface,
which learns one new visual idea — accumulation drawn as a trail of grains
rather than as a smooth bar.

## Decisions taken

Four choices fix the shape of the work. They were made before the design and
are not revisited during implementation.

1. **The ant is structural in the interface, never illustrated.** No ant is
   drawn anywhere inside the app. The metaphor lives in the mechanics: a trail
   that fills, grains that accumulate, a projection that thins out. An
   illustrated ant next to a real bank balance reads as a toy.
2. **The icon is literal: an ant carrying a grain.** The icon is the one place
   the ant is drawn, so it is drawn plainly rather than abstracted into a
   monogram.
3. **The palette keeps its teal.** The shipped palette is contrast-tested and
   stays as it is, gaining exactly one semantic pair, `grain`/`grainSoft`.
4. **Four surfaces are in scope:** the dashboard, budgets, the two charts, and
   the import result.

## Non-goals

- No ant glyph, mascot, or illustration in any screen, empty state or header.
- No change to any existing palette value. New tokens only.
- No re-theming of the tab bar, navigation chrome, or typography.
- No animated parse progress on the import screen. See "Import result" below
  for why this is impossible rather than merely unwanted.

## Tokens

`apps/mobile/src/design/palette.ts` gains one pair in each theme:

| Role | Light | Dark |
| --- | --- | --- |
| `grain` | `#A8720E` | `#D9A441` |
| `grainSoft` | `#F6E7C6` | `#33280F` |

`grain` carries one meaning and only one: **value accumulated over time**. It is
not income (money that arrived), not accent (something you can touch), and not
warning (something needs attention).

`grain` (`#A8720E`) and the existing `warning` (`#8A5411`) are both browns. They
are never used inside the same component. If a screen is found showing both
close enough to be compared, `warning` moves further toward red — `grain` does
not move, because it is the newer token and the one whose meaning depends on
being warm.

`apps/mobile/src/design/tests/palette.test.ts` gains three pairs to its `PAIRS`
list: `['grain', 'surface']`, `['grain', 'background']`, `['grain', 'grainSoft']`.
Every pair clears 4.5:1 or the values change until it does. The rule from the
palette's own header comment holds: do not lighten one without re-running the
test.

## Primitives

The pure geometry lives in `apps/mobile/src/design/trail.ts`, a plain data
module with no React and no React Native import — the same arrangement
`palette.ts` uses, and for the same reason: `apps/mobile/src/design/tests/**`
is already inside the vitest include globs, so the maths is testable under
plain node.

```
src/design/trail.ts                  segmentsFor(), grainSpacing()
src/design/tests/trail.test.ts
src/components/trail/Trail.tsx       segmented fill bar
src/components/trail/GrainRow.tsx    discrete dot counter
src/components/trail/grain-bars.ts   rect geometry for the SVG charts
```

### `segmentsFor(width, ratio)`

Returns `{ total, filled, size, gap }` for a track of the given pixel width.

- Gaps are 2px. Segments are sized so no segment falls below 4px.
- Below six segments the function returns `total: 1` — a continuous fill. Three
  fat blocks read as a broken bar, not as a trail.
- `filled` rounds **down**. A trail shows what has been carried, never what has
  nearly been carried.
- A non-finite or out-of-range `ratio` clamps to `[0, 1]`, matching the
  defensive clamp `BudgetBar` already performs.

### `grainSpacing(confidence)`

Maps the forecast confidence already produced by `packages/core`
(`'high' | 'medium' | 'low'`) to the pixel gap between grains in a projected
region. Denser grains mean more history behind the projection. This is the
visual form of a rule the project already holds: a projection must never look
as solid as a booked figure.

### `Trail`

A segmented fill bar. Track is `surfaceSunken`; fill is drawn as discrete
segments per `segmentsFor`.

Props: `parts` (one or more `{ ratio, tone }`, drawn in order along the same
track), `state` (`BudgetState` from `@finant/core`: `'under' | 'near' | 'over'`,
defaulting to `'under'`), optional `label`. A single-part
trail is the common case; the import result is the only caller that passes
three. `tone` is a palette role or an explicit colour.

The parts share one segment grid computed once from the full track width, so
the boundary between two parts falls on a gap rather than splitting a grain.
Parts whose ratios sum above 1 clamp as a whole, in order — a later part is
truncated rather than every part being scaled down, so the first figure quoted
in the caption always matches the bar.

`state: 'over'` caps the fill at the track width and draws a break notch at the
end rather than letting the bar grow past its own track. This preserves the
honesty `BudgetBar` documents today — a full bar always means "nothing left" —
while making the excess visible in the bar rather than only in the caption.

Motion is one growth pass on mount, `withTiming(motion.settle)`, read from
`useMotion()`. No component in this family writes a reduce-motion conditional
of its own; the hook returns already-flattened tokens.

### `GrainRow`

A row of discrete dots: filled for achieved, hollow for remaining. Filled dots
are `grain`; hollow are `grainSoft` with a `border` outline.

Above twelve items the component renders a `Trail` instead. Thirteen dots on a
phone are a texture, not a count.

### Accessibility

Both components take an optional `label`. With it, they set
`accessibilityRole="progressbar"` and an `accessibilityValue`. Without it, they
set `accessible={false}`.

The default is `false` deliberately. Every placement in this design sits
directly beneath a caption that already states the figure in words, and a
screen reader announcing the same number twice is worse than announcing it
once.

## Surfaces

### Dashboard — `app/(tabs)/index.tsx`

Two additions, both to existing cards. The hero is untouched.

- A `Trail` inside the period card, below the three `StatTile`s: the period's
  expenses as a share of its income, in `accent`. The savings-rate caption
  already present states the figure.
- A `GrainRow` of twelve inside the year card: one grain per month of the
  current year, filled where that month's net is at or above zero. Data comes
  from `booked.months`, which the screen already computes — no new query, and
  no projected month is ever counted as a filled grain.

### Budgets — `src/components/BudgetBar.tsx`

The component's internals become a `Trail`. Its exported props (`ratio`,
`state`, `color`) do not change, so `app/(tabs)/budgets.tsx` and every other
caller stay as they are.

`grain` does not appear here. A budget measures spending against a limit, which
is not accumulation, so the existing colour logic is kept exactly: `expense`
when over, `warning` when near, the category's own colour or `accent`
otherwise.

### Charts — `src/components/ForecastChart.tsx`, `src/components/BalanceChart.tsx`

Projected regions are drawn as grains rather than as faded solids.

- `ForecastChart`: a projected month's bars become a vertical stack of grain
  segments in `grain`, spaced by `grainSpacing(forecast.confidence)`. Booked
  months keep their solid bars and their existing colours.
- `BalanceChart`: the projected tail of the net-worth line becomes a run of
  grains rather than a dashed, faded line.

The geometry is generated by `grain-bars.ts` as plain rect arrays. It does not
use `react-native-svg`'s `Pattern` element: an array of rects behaves
identically on both platforms and needs no feature check.

`dashboard.projectedTail` currently reads "Dashed: projected to the end of the
year." That sentence describes a dashed line that will no longer exist, so it
is rewritten in all three languages.

### Import result — `app/import.tsx`

The result card gains a `Trail` split three ways: rows carried in
(`income`), rows the unique indexes already held (`textMuted`), and rows the
parser set aside (`warning`). The counts beneath it already exist.

**There is no live carry-in progress, and none is added.** `stage` parses the
whole file synchronously and returns `{ transactions, issues }` in one step.
There is no stream to subscribe to, so any animated progress bar would be
animating work that had already finished — a decorative lie about a screen
whose whole job is to report exactly what happened to each row. The honest ant
surface here is the outcome, not the journey.

## Icon

The SVG is the source of truth and is committed. Every PNG is build output from
one script, so a change to the mark is a change to one file.

```
apps/mobile/assets/brand/icon.svg        full mark
apps/mobile/assets/brand/icon-mono.svg   simplified mark
scripts/render-icons.ts                  svg -> every png size
package.json                             "icons": "tsx scripts/render-icons.ts"
```

### The mark

A side-profile ant carrying a single round grain above its head. Three body
segments, antennae, six legs. Teal `#06695F` on cream `#F2F6F5`.

Legs are the first detail to disappear at small sizes, so `icon-mono.svg` drops
them entirely, thickens the body segments, and keeps the grain — the grain is
what makes the silhouette an ant *saving* rather than an ant. The simplified
mark is what the Android monochrome layer uses, and it is drawn inside the
central 66% of the canvas so the adaptive mask cannot crop it.

### Rendering

`scripts/render-icons.ts` needs a rasterizer. This machine has no
`rsvg-convert`, `inkscape`, or ImageMagick; the only one present is Chrome,
which is a poor build dependency. The script therefore uses `@resvg/resvg-js`,
added as a **root devDependency**. It is never imported by the app, so the
project's no-network-at-runtime rule is untouched.

| Output | Size | Notes |
| --- | --- | --- |
| `assets/icon.png` | 1024 | Opaque. Apple rejects an alpha channel. |
| `assets/android-icon-foreground.png` | 1024 | Alpha, inside the 66% circle |
| `assets/android-icon-background.png` | 1024 | Flat `#06695F` |
| `assets/android-icon-monochrome.png` | 1024 | Alpha silhouette, simplified mark |
| `assets/splash-icon.png` | 1024 | |
| `assets/favicon.png` | 48 | Simplified mark |

`app.json` moves `android.adaptiveIcon.backgroundColor` from `#0F172A` to
`#06695F`, so it agrees with the background image instead of holding a leftover
slate default from the template.

## Translations

New and changed keys go into `packages/i18n/src/en.ts` first, then `es.ts` and
`de.ts`. Every leaf is typed against `Resources`, so a missing key in Spanish
or German is a compile error rather than a blank label.

- `dashboard.monthsOnTrack` — the caption under the grain row, with a `{{count}}`
  of twelve.
- `dashboard.projectedTail` — rewritten; no longer describes a dashed line.
- `import.setAside` — the parser-set-aside portion of the result trail.

## Testing

| What | How |
| --- | --- |
| Segment geometry, clamping, the round-down rule, the below-six fallback | `src/design/tests/trail.test.ts` under `npm test` |
| Multi-part trails: boundaries land on gaps, an over-full set truncates the last part rather than scaling all of them | same file |
| `grainSpacing` covers all three confidence values | same file |
| Every `grain` pair clears AA in both themes | `palette.test.ts` under `npm test` |
| Types, including the three translation files | `npm run typecheck` |
| Bundle builds without a simulator | `cd apps/mobile && npx expo export --platform ios` |
| The mark reads at 1024, 180 and 48, and the Android monochrome layer survives its mask | Render and look at the output |

## Order of work

1. Tokens and their contrast tests.
2. `trail.ts` and its unit tests.
3. `Trail` and `GrainRow`.
4. `BudgetBar` on top of `Trail` — the smallest surface, and the one with
   existing behaviour to preserve, so it proves the primitive before three more
   screens depend on it.
5. Dashboard, charts, import result.
6. Translations.
7. Icon SVGs, render script, `app.json`.
