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
which learns one new visual idea — a fill made of discrete, countable units
rather than a smooth bar. That single visual form carries two distinct
meanings depending on what it draws, and the two are not interchangeable (see
"What the forms mean" below).

## Decisions taken

Four choices fix the shape of the work. They were made before the design and
are not revisited during implementation.

1. **The ant is structural in the interface, never illustrated.** No ant is
   drawn anywhere inside the app. The metaphor lives in the mechanics: a trail
   that fills segment by segment, a chart that thins its projection into
   grains, a row that counts months one dot at a time. An illustrated ant next
   to a real bank balance reads as a toy.
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

| Role        | Light     | Dark      |
| ----------- | --------- | --------- |
| `grain`     | `#A8720E` | `#D9A441` |
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

## What the forms mean

The branch draws three distinct things with the grain vocabulary, and they are
not synonyms:

- **The segmented trail form** (`Trail`, and `BudgetBar` on top of it) means _a
  share of a bounded quantity_ — a budget against its limit, a period's spend
  against its income, a category against the period's expenses, an import's
  rows against the file's rows. None of these are accumulation; they are all
  proportions of something with a fixed size.
- **The `grain` colour** means _value accumulated over time_, and nothing
  else. Its only user is the dashboard's `GrainRow` of months — a count that
  only grows, one booked month at a time, and never resets or gets spent
  against a limit.
- **Grains inside a chart** (`ForecastChart`, `BalanceChart`) mean _projected,
  not booked_. This is carried by shape alone — discrete marks instead of a
  continuous fill or line — and each chart keeps its own colours (`income`,
  `expense`, `accent`) so a projection and a booked figure differ in exactly
  one way, not two.

## Primitives

The pure geometry lives in `apps/mobile/src/design/trail.ts`, a plain data
module with no React and no React Native import — the same arrangement
`palette.ts` uses, and for the same reason: `apps/mobile/src/design/tests/**`
is already inside the vitest include globs, so the maths is testable under
plain node.

```
src/design/trail.ts                  segmentsFor(), grainSpacing(), grainStack(), grainsAlong()
src/design/tests/trail.test.ts
src/components/trail/Trail.tsx       segmented fill bar
src/components/trail/GrainRow.tsx    discrete dot counter
```

### `segmentsFor(width: number, ratios: readonly number[]): TrailGeometry`

Returns a discriminated union: `{ mode: 'continuous', widths }` or
`{ mode: 'segmented', size, gap, total, filled }`, for a track of the given
pixel width carrying one or more ratios in order.

- Gaps are 2px. Segments are sized so no segment falls below 4px.
- Below six segments the track is too narrow for a trail to read as one:
  three fat blocks look like a broken bar, so the function returns
  `mode: 'continuous'` instead of a segment count.
- `filled` rounds **down**. A trail shows what has been carried, never what has
  nearly been carried. A part that carried anything at all still gets at least
  one grain.
- A non-finite or out-of-range ratio clamps to `[0, 1]`, matching the
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
- A `GrainRow` inside the year card, under the booked view only: one grain per
  month already booked this year (`booked.months`, which the screen already
  computes — no new query), filled where that month's net is at or above zero.
  Never twelve until December: a month that has not happened yet is not a
  month that failed, so it is not counted at all, filled or hollow.

### Budgets — `src/components/BudgetBar.tsx`

The component's internals become a `Trail`. Its exported props (`ratio`,
`state`, `color`) do not change, so `app/(tabs)/budgets.tsx` and every other
caller stay as they are.

`grain` does not appear here. A budget measures spending against a limit, which
is not accumulation, so the existing colour logic is kept exactly: `expense`
when over, `warning` when near, the category's own colour or `accent`
otherwise.

### Charts — `src/components/ForecastChart.tsx`, `src/components/BalanceChart.tsx`

Projected regions are drawn as grains rather than as faded solids. In both
charts the projected mark keeps the same colour as the booked one next to it —
`income`/`expense` in `ForecastChart`, `accent` in `BalanceChart` — and the
grains change only the shape. `grain` itself does not appear in either chart:
it names a colour, not a shape, and both charts already have colours that mean
something (see "What the forms mean").

- `ForecastChart`: a projected month's income and expense bars become a
  vertical stack of grain segments, in `theme.income` and `theme.expense`
  respectively, spaced by `grainSpacing(month.confidence)`. Deliberately not
  `grain`: two grain-coloured bars side by side, one for income and one for
  expense, would be indistinguishable. Booked months keep their solid bars and
  the same colours.
- `BalanceChart`: the projected tail of the net-worth line becomes a run of
  grains in `theme.accent` — the same colour as the booked line — rather than
  a dashed, faded line.

The geometry lives in `src/design/trail.ts`, alongside `segmentsFor`:
`grainStack()` returns the rects for `ForecastChart`'s vertical bars, and
`grainsAlong()` returns the points `BalanceChart` draws as circles along its
polyline. Neither chart uses `react-native-svg`'s `Pattern` element: plain
rects and circles behave identically on both platforms and need no feature
check.

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
apps/mobile/assets/brand/icon-mark.svg   full mark, transparent ground
apps/mobile/assets/brand/icon-mono.svg   simplified mark
scripts/render-icons.ts                  svg -> every png size
package.json                             "icons": "tsx scripts/render-icons.ts"
```

An earlier draft of this section also listed an `icon.svg` holding the full mark
on its cream ground. It was dropped during implementation: two files carrying
the same mark geometry are two files that can drift, which defeats the whole
point of committing the SVG. The cream ground is now applied at render time by
a `withBackground` helper, so `icon-mark.svg` is the only place the mark is
drawn.

### The mark

A side-profile ant walking right, carrying a gold coin on its back. Leaf-shaped
gaster, two petiole nodes, head with a closed happy eye and a wide smile, two
antennae, six legs. Redrawn as vector from reference artwork the owner supplied,
in the app's palette rather than the reference's emerald and light gold.

Colour roles: ochre `#A8720E` is `grain` and fills the coin, the nodes and the
head — the coin is the same colour the interface uses for value that has been
accumulated, so what the ant carries is literally the app's grain. `#F6E7C6` is
`grainSoft`, the coin's inner ring and its glint. The gaster is `#3FD0BE`, the
dark theme's `accent`.

`#08302C` is the mark's ink and belongs to the mark alone: an outline has to
hold against the light teal gaster, the ochre head and the cream ground at once,
and no palette role is dark enough for all three.

Three choices in the drawing are load-bearing, and each was arrived at by
rendering the alternative and looking at it:

- **The head is ochre, not teal.** An all-teal body merges into a single mass at
  favicon size; the warm head is what keeps the front of the ant separate from
  the back at 48px.
- **The gaster is the light teal, not `#06695F`.** It reads as a distinct body
  part against the ochre head and the ink outline. This began as a fix for the
  rearmost leg, which was then drawn across the gaster; that leg now sits behind
  it, so the light fill is a free choice rather than a forced one.
- **The eye and the smile are set well forward on the head.** The ant is in
  profile and looking where it is walking, so one eye is correct. Set further
  back the same two arcs read as a face turned towards the viewer, and a
  viewer-facing face with one eye looks like a face missing an eye.

The legs split across the z-order, and the split matters. The three middle legs
are drawn **on top** of the gaster and the nodes, so the upper part of each one
shows crossing the segment it hangs from — the one place the reference does show
the joint.

The other three are drawn **behind** the body, each emerging from under a segment
whose outline stays unbroken. The rearmost leg has its knee raised high inside
the gaster; drawn on top, that knee and the gaster's own lower edge close into a
triangle that reads as a letter A sitting on the ant. The two front legs drawn on
top instead poke their stubs into the head's fill and cut through its bottom
edge, and the head stops reading as a head.

Each leg is a right-angle knee and a horizontal foot; the rear feet point
backwards and the front feet forwards, so the ant reads as walking rather than
standing.

Stroke weights are floored at 22 on the 1024 canvas — 2.1% — because anything
thinner closes up at favicon size. The artwork is offset by `translate(-16 -54)`
so it sits on the optical centre rather than the geometric one, and the coin is
scaled to 0.84 so the ant, not its load, is the subject.

`icon-mono.svg` is the same mark for Android's monochrome layer, which keeps
only the alpha channel and tints it a single system colour. The colour mark is
built from outlined shapes, and an outline is the one thing a single flat colour
cannot express: filled in, the coin, the segments, the legs and the face all
fuse into one lump. So in the monochrome file the ink becomes a gap. Every shape
is filled solid out to the outer edge of its stroke, then the ink is cut back
out as holes in a mask, in three kinds of cut:

- A full ring at the coin's edge and a second at its inner ring. Outside the
  overlap these fall on transparent ground and cost nothing.
- A left-facing arc on each node and on the head, where it meets the segment
  behind it. Partial on purpose: a full ring would also cut the legs passing
  underneath and leave them floating.
- The three middle legs, clipped to the body, so the part of each one that
  crosses its segment reads as a groove while the part below it stays solid —
  which is what the outlined colour mark does. The rearmost leg and the two front
  legs are not cut: they sit behind the body in the colour mark, so there is no
  groove for them to leave.

The coin's glint is dropped and every stroke is thicker, because this layer is
composited at launcher size where both would close up.

`icon-mono.svg` is drawn full-canvas, like `icon-mark.svg`; `insetForAdaptive`
in `render-icons.ts` scales both marks down to 0.62 at render time so the
content sits inside the central 66% Android's adaptive mask can crop to, rather
than the SVG being authored inset itself.

### Rendering

`scripts/render-icons.ts` needs a rasterizer. This machine has no
`rsvg-convert`, `inkscape`, or ImageMagick; the only one present is Chrome,
which is a poor build dependency. The script therefore uses `@resvg/resvg-js`,
added as a **root devDependency**. It is never imported by the app, so the
project's no-network-at-runtime rule is untouched.

| Output                               | Size | Notes                                           |
| ------------------------------------ | ---- | ----------------------------------------------- |
| `assets/icon.png`                    | 1024 | Opaque. Apple rejects an alpha channel.         |
| `assets/android-icon-foreground.png` | 1024 | Alpha, inset to 0.62 by `insetForAdaptive`      |
| `assets/android-icon-background.png` | 1024 | Flat cream `#F2F6F5`                            |
| `assets/android-icon-monochrome.png` | 1024 | Alpha silhouette, simplified mark, same inset   |
| `assets/splash-icon.png`             | 1024 |                                                 |
| `assets/favicon.png`                 | 48   | Full mark on cream, same as `icon.png`, smaller |

`app.json` sets `android.adaptiveIcon.backgroundColor` to the same cream the
app icon uses, `#F2F6F5`, so the composited adaptive icon reads as the mark on
its own ground rather than as a solid colour with one shape floating in it — a
teal-on-teal composite made the mark unreadable.

## Translations

New and changed keys go into `packages/i18n/src/en.ts` first, then `es.ts` and
`de.ts`. Every leaf is typed against `Resources`, so a missing key in Spanish
or German is a compile error rather than a blank label.

- `dashboard.monthsInBlack` — the caption under the grain row, with a
  `{{count}}` and a `{{total}}`. Not twelve: it counts `booked.months.length`
  only, because a month that has not happened yet is not a month that failed.
- `dashboard.projectedTail` — rewritten; no longer describes a dashed line.
- `import.setAside` — the parser-set-aside portion of the result trail.

## Testing

| What                                                                                                                 | How                                                |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Segment geometry, clamping, the round-down rule, the below-six fallback                                              | `src/design/tests/trail.test.ts` under `npm test`  |
| Multi-part trails: boundaries land on gaps, an over-full set truncates the last part rather than scaling all of them | same file                                          |
| `grainSpacing` covers all three confidence values                                                                    | same file                                          |
| Every `grain` pair clears AA in both themes                                                                          | `palette.test.ts` under `npm test`                 |
| Types, including the three translation files                                                                         | `npm run typecheck`                                |
| Bundle builds without a simulator                                                                                    | `cd apps/mobile && npx expo export --platform ios` |
| The mark reads at 1024, 180 and 48, and the Android monochrome layer survives its mask                               | Render and look at the output                      |

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
