# Ant Design Language Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give FinAnt the ant its name promises — an icon of an ant carrying a grain, and one new interface idea, accumulation drawn as a trail of grains rather than a smooth bar.

**Architecture:** All trail and grain geometry is pure arithmetic in `apps/mobile/src/design/trail.ts`, a plain data module with no React or React Native import, so it is unit-testable under plain node like `palette.ts` already is. Two presentational components (`Trail`, `GrainRow`) consume that maths and the palette; four surfaces consume the components. The icon is committed as SVG and every PNG is build output from one script.

**Tech Stack:** TypeScript 6 strict with `noUncheckedIndexedAccess`, React 19.2, React Native 0.86, Expo SDK 57, `react-native-svg`, `react-native-reanimated`, vitest, `@resvg/resvg-js` (dev-only, added by Task 10).

**Spec:** `docs/superpowers/specs/2026-09-08-ant-design-language-design.md`

## Global Constraints

- **No ant is drawn anywhere inside the app.** No glyph, mascot, illustration, or emoji in any screen, empty state, or header. The icon is the only place an ant appears.
- **No existing palette value changes.** New tokens only: `grain` `#A8720E` light / `#D9A441` dark, `grainSoft` `#F6E7C6` light / `#33280F` dark.
- **`grain` means value accumulated over time and nothing else.** Not income, not accent, not warning.
- Relative imports inside packages and inside `apps/mobile/src` are **extensionless**. Metro does not map `./trail.js` onto `trail.ts`.
- Money stays signed integer minor units. No float arithmetic on a balance. Ratios computed for drawing are display-only and never written back.
- Every new user-facing string is added to `packages/i18n/src/en.ts`, `es.ts` **and** `de.ts`. A missing key in one of them is a compile error, not a blank label.
- Motion goes through `useMotion()`. No component writes its own reduce-motion conditional.
- Never log a movement, narrative, IBAN, or any part of a statement. No `console.log` of parsed data in any task.
- Before each commit, format only the paths you touched. `npm run lint:fix` reformats the whole repo and drowns the diff:
  ```bash
  npx prettier --write <the files you changed>
  npx eslint <the files you changed> --fix
  ```
- Run `npm test` and `npm run typecheck` from the repo root, not from `apps/mobile`.

## File Structure

**Created:**

| Path | Responsibility |
| --- | --- |
| `apps/mobile/src/design/trail.ts` | All trail and grain geometry. Pure functions, no RN import. |
| `apps/mobile/src/design/tests/trail.test.ts` | Unit tests for the above. |
| `apps/mobile/src/components/trail/Trail.tsx` | Segmented fill bar, one or more parts on one track. |
| `apps/mobile/src/components/trail/GrainRow.tsx` | Discrete dot counter, falls back to `Trail` above twelve. |
| `apps/mobile/assets/brand/icon.svg` | Full mark on its cream ground. |
| `apps/mobile/assets/brand/icon-mark.svg` | Full mark, transparent ground. |
| `apps/mobile/assets/brand/icon-mono.svg` | Simplified silhouette for the Android monochrome layer. |
| `scripts/render-icons.ts` | Renders every PNG from the SVGs. |

**Modified:**

| Path | Change |
| --- | --- |
| `apps/mobile/src/design/palette.ts` | `grain` / `grainSoft` in both themes. |
| `apps/mobile/src/design/tests/palette.test.ts` | Three new contrast pairs. |
| `apps/mobile/src/design/index.ts` | Re-export the trail geometry. |
| `apps/mobile/src/components/BudgetBar.tsx` | Internals become `Trail`; exported props unchanged. |
| `apps/mobile/app/(tabs)/index.tsx` | Spend trail in the period card, grain row in the year card. |
| `apps/mobile/src/components/ForecastChart.tsx` | Projected bars drawn as grains. |
| `apps/mobile/src/components/BalanceChart.tsx` | Projected tail drawn as grains; new `confidence` prop. |
| `apps/mobile/app/import.tsx` | Outcome trail on the result card; `setAside` state. |
| `packages/i18n/src/{en,es,de}.ts` | Two new keys, one rewritten. |
| `apps/mobile/app.json` | `adaptiveIcon.backgroundColor` → `#06695F`. |
| `package.json` | `icons` script, `@resvg/resvg-js` devDependency. |

## Deviations from the spec

Three, all decided before implementation starts. Do not re-litigate them mid-task.

1. **The chart geometry lives in `src/design/trail.ts`, not `src/components/trail/grain-bars.ts`.** The vitest include globs cover `apps/mobile/src/design/tests/**` and nothing else under `apps/mobile`. Pure geometry that is not testable is the thing this plan is trying to avoid, so it goes where the tests can reach it.
2. **Projected chart bars keep their income/expense colours; only their form becomes grains.** The spec says projected bars are drawn "in `grain`". Taken literally that paints a month's income bar and its expense bar the same colour and makes the chart unreadable. The grain *form* already says "projected"; the colour goes on carrying income versus expense. `grain` still colours the dashboard grain row and the balance chart's projected tail.
3. **`ForecastChart`'s projected grain stacks do not animate.** Booked bars keep their growth pass. A projection that grows into place with the same gesture as a recorded fact is exactly the equivalence the project's forecast rules forbid.

---

### Task 1: Grain tokens

**Files:**
- Modify: `apps/mobile/src/design/palette.ts`
- Test: `apps/mobile/src/design/tests/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `lightPalette.grain`, `lightPalette.grainSoft`, `darkPalette.grain`, `darkPalette.grainSoft`. Because `Palette` is `Record<keyof typeof lightPalette, string>`, `'grain' | 'grainSoft'` become valid `keyof Palette` values for every later task.

- [ ] **Step 1: Write the failing test**

In `apps/mobile/src/design/tests/palette.test.ts`, add three entries to the end of the `PAIRS` array:

```ts
  ['warning', 'warningSoft'],
  ['grain', 'surface'],
  ['grain', 'background'],
  ['grain', 'grainSoft'],
];
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- palette`
Expected: FAIL. vitest transpiles without typechecking, so this surfaces at runtime as a `TypeError` inside `luminance` — `lightPalette.grain` is `undefined` and `undefined.slice` throws. `npm run typecheck` would report the same thing as "not assignable to `keyof Palette`"; either failure is the right one to see here.

- [ ] **Step 3: Add the tokens**

In `apps/mobile/src/design/palette.ts`, add to `lightPalette`, after `warningSoft`:

```ts
  grain: '#A8720E',
  grainSoft: '#F6E7C6',
```

and to `darkPalette`, after `warningSoft`:

```ts
  grain: '#D9A441',
  grainSoft: '#33280F',
};
```

Then extend the file's header comment, which currently explains why the light values are darker than they look like they should be. Add a paragraph:

```ts
 * `grain` is the one role added after that pass. It means value accumulated
 * over time and nothing else — not income, which is money that arrived, and
 * not warning, which is a brown of a similar family and is never placed beside
 * it. If a screen is ever found comparing the two, `warning` moves toward red;
 * `grain` does not move, because its meaning depends on being warm.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- palette`
Expected: PASS, including "gives both themes the same roles" — both palettes gained the same two keys.

If a new pair falls below 4.5:1, darken `grain` in the light theme (toward `#8F6209`) or lighten it in the dark theme (toward `#E3B45C`) until it clears. Do not touch any other token.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/src/design/palette.ts apps/mobile/src/design/tests/palette.test.ts
git add apps/mobile/src/design/palette.ts apps/mobile/src/design/tests/palette.test.ts
git commit -m "feat(design): a colour that only ever means accumulated"
```

---

### Task 2: Trail geometry

**Files:**
- Create: `apps/mobile/src/design/trail.ts`
- Create: `apps/mobile/src/design/tests/trail.test.ts`
- Modify: `apps/mobile/src/design/index.ts`

**Interfaces:**
- Consumes: `Confidence` from `@finant/core` (`'high' | 'medium' | 'low'`).
- Produces:
  - `segmentsFor(width: number, ratios: readonly number[]): TrailGeometry`
  - `type TrailGeometry = { mode: 'continuous'; widths: readonly number[] } | { mode: 'segmented'; size: number; gap: number; total: number; filled: readonly number[] }`
  - `grainSpacing(confidence: Confidence): number`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/design/tests/trail.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { grainSpacing, segmentsFor } from '../trail';

describe('segmentsFor', () => {
  it('splits a wide track into grains no thinner than 4px', () => {
    const geometry = segmentsFor(300, [1]);
    expect(geometry.mode).toBe('segmented');
    if (geometry.mode !== 'segmented') return;
    expect(geometry.total).toBe(24);
    expect(geometry.size).toBeGreaterThanOrEqual(4);
    expect(geometry.filled).toEqual([24]);
  });

  it('falls back to a continuous fill when six grains would not fit', () => {
    const geometry = segmentsFor(20, [0.5]);
    expect(geometry.mode).toBe('continuous');
    if (geometry.mode !== 'continuous') return;
    expect(geometry.widths).toEqual([10]);
  });

  it('rounds a partial grain down', () => {
    const geometry = segmentsFor(300, [0.5]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    // 0.5 * 24 = 12 exactly; 0.54 * 24 = 12.96 must still be twelve.
    expect(geometry.filled).toEqual([12]);
    const nearly = segmentsFor(300, [0.54]);
    if (nearly.mode !== 'segmented') throw new Error('expected segments');
    expect(nearly.filled).toEqual([12]);
  });

  it('never hides a part that carried something', () => {
    const geometry = segmentsFor(300, [0.001]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([1]);
  });

  it('draws nothing for a part that carried nothing', () => {
    const geometry = segmentsFor(300, [0]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([0]);
  });

  it('truncates the last part rather than scaling every part down', () => {
    const geometry = segmentsFor(300, [0.8, 0.8]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([19, 5]);
    expect(geometry.filled.reduce((sum, n) => sum + n, 0)).toBe(geometry.total);
  });

  it('treats a broken ratio as nothing and an impossible one as everything', () => {
    // NaN and Infinity are broken and carry nothing; a finite 5 is merely a
    // full bar; a negative is nothing. The 5 takes the whole track, so the
    // negative would be truncated to zero even if it were not already zero.
    const geometry = segmentsFor(300, [Number.NaN, 5, -1, Number.POSITIVE_INFINITY]);
    if (geometry.mode !== 'segmented') throw new Error('expected segments');
    expect(geometry.filled).toEqual([0, 24, 0, 0]);
  });

  it('survives a zero width', () => {
    const geometry = segmentsFor(0, [0.5]);
    expect(geometry.mode).toBe('continuous');
    if (geometry.mode !== 'continuous') return;
    expect(geometry.widths).toEqual([0]);
  });
});

describe('grainSpacing', () => {
  it('spaces grains further apart the less history there is', () => {
    expect(grainSpacing('high')).toBeLessThan(grainSpacing('medium'));
    expect(grainSpacing('medium')).toBeLessThan(grainSpacing('low'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- trail`
Expected: FAIL, "Cannot find module '../trail'".

- [ ] **Step 3: Write the implementation**

Create `apps/mobile/src/design/trail.ts`:

```ts
import type { Confidence } from '@finant/core';

/**
 * How a trail is drawn at a given width. A trail is a bar made of discrete
 * grains rather than one smooth fill, because the thing it describes —
 * spending a month, carrying rows into the database, months that ended in the
 * black — accumulates one countable unit at a time.
 *
 * Below six grains the bar stops pretending: three fat blocks read as a broken
 * bar, not as a trail, so a narrow track returns a continuous fill instead.
 *
 * No react-native import lives in this file. It is a plain data module so the
 * geometry can be tested under node, the same arrangement palette.ts uses.
 */
export type TrailGeometry =
  | { readonly mode: 'continuous'; readonly widths: readonly number[] }
  | {
      readonly mode: 'segmented';
      readonly size: number;
      readonly gap: number;
      readonly total: number;
      readonly filled: readonly number[];
    };

const GAP = 2;
const MIN_SEGMENT = 4;
const MIN_SEGMENTS = 6;
const MAX_SEGMENTS = 24;

function clamp(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/**
 * The grain grid for a track `width` px wide carrying `ratios` in order.
 *
 * A part that carried anything at all gets at least one grain, so a single
 * unreadable row in an import of two thousand is still visible. Beyond that
 * first grain the count rounds **down**: a trail says what has been carried,
 * never what has nearly been carried.
 *
 * Parts summing past a full track truncate in order rather than every part
 * being scaled to fit, so the first figure quoted in the caption underneath
 * always matches the bar.
 */
export function segmentsFor(width: number, ratios: readonly number[]): TrailGeometry {
  const usable = Number.isFinite(width) ? Math.max(0, width) : 0;
  const clamped = ratios.map(clamp);

  let total = 0;
  for (let n = MAX_SEGMENTS; n >= MIN_SEGMENTS; n -= 1) {
    if ((usable - (n - 1) * GAP) / n >= MIN_SEGMENT) {
      total = n;
      break;
    }
  }

  if (total === 0) {
    let left = usable;
    const widths = clamped.map((ratio) => {
      // A hairline is still a statement that something was carried.
      const want = ratio === 0 ? 0 : Math.max(2, ratio * usable);
      const take = Math.min(want, left);
      left -= take;
      return take;
    });
    return { mode: 'continuous', widths };
  }

  let left = total;
  const filled = clamped.map((ratio) => {
    const want = ratio === 0 ? 0 : Math.max(1, Math.floor(ratio * total));
    const take = Math.min(want, left);
    left -= take;
    return take;
  });

  return { mode: 'segmented', size: (usable - (total - 1) * GAP) / total, gap: GAP, total, filled };
}

/**
 * Pixels between grains in a projected region. Denser grains mean more history
 * behind the projection — the visual form of the rule that a forecast must
 * never look as solid as a booked figure.
 */
export function grainSpacing(confidence: Confidence): number {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 6;
  return 10;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- trail`
Expected: PASS, nine assertions across two suites.

- [ ] **Step 5: Re-export from the design barrel**

In `apps/mobile/src/design/index.ts`, add alongside the other re-exports:

```ts
export { grainSpacing, segmentsFor, type TrailGeometry } from './trail';
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/mobile/src/design/trail.ts apps/mobile/src/design/tests/trail.test.ts apps/mobile/src/design/index.ts
git add apps/mobile/src/design/trail.ts apps/mobile/src/design/tests/trail.test.ts apps/mobile/src/design/index.ts
git commit -m "feat(design): a bar that counts instead of sliding"
```

---

### Task 3: Chart grain geometry

**Files:**
- Modify: `apps/mobile/src/design/trail.ts`
- Modify: `apps/mobile/src/design/tests/trail.test.ts`
- Modify: `apps/mobile/src/design/index.ts`

**Interfaces:**
- Consumes: `grainSpacing` from Task 2.
- Produces:
  - `grainStack(baseline: number, full: number, spacing: number, size?: number): readonly Grain[]` where `interface Grain { readonly y: number; readonly height: number }`
  - `grainsAlong(points: readonly Point[], spacing: number): readonly Point[]` where `interface Point { readonly x: number; readonly y: number }`

Both return SVG coordinates directly: `y` grows downward, `baseline` is the axis the bar stands on.

- [ ] **Step 1: Write the failing test**

Append to `apps/mobile/src/design/tests/trail.test.ts`:

```ts
import { grainsAlong, grainStack } from '../trail';

describe('grainStack', () => {
  it('stacks grains upward from the baseline', () => {
    const grains = grainStack(100, 20, 6, 4);
    expect(grains).toEqual([
      { y: 96, height: 4 },
      { y: 86, height: 4 },
    ]);
  });

  it('draws nothing for a bar shorter than one grain', () => {
    expect(grainStack(100, 3, 6, 4)).toEqual([]);
    expect(grainStack(100, 0, 6, 4)).toEqual([]);
  });

  it('draws fewer grains as the spacing widens', () => {
    expect(grainStack(100, 60, 3, 4).length).toBeGreaterThan(grainStack(100, 60, 10, 4).length);
  });
});

describe('grainsAlong', () => {
  it('starts one spacing in, so a grain never sits on the last booked point', () => {
    expect(grainsAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 5)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]);
  });

  it('keeps the spacing even across a corner', () => {
    const grains = grainsAlong(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      6,
    );
    expect(grains).toEqual([
      { x: 6, y: 0 },
      { x: 12, y: 0 },
      { x: 18, y: 0 },
    ]);
  });

  it('needs two points and a positive spacing', () => {
    expect(grainsAlong([{ x: 0, y: 0 }], 5)).toEqual([]);
    expect(grainsAlong([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0)).toEqual([]);
  });
});
```

Merge the new import into the existing one at the top of the file rather than adding a second `from '../trail'` line.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- trail`
Expected: FAIL, `grainStack is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `apps/mobile/src/design/trail.ts`:

```ts
export interface Grain {
  readonly y: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A projected bar as a column of grains standing on `baseline`, in SVG
 * coordinates. A partial grain at the top is dropped rather than clipped: the
 * column counts, and half a grain counts as nothing.
 */
export function grainStack(
  baseline: number,
  full: number,
  spacing: number,
  size = 4,
): readonly Grain[] {
  const height = Number.isFinite(full) ? Math.max(0, full) : 0;
  const step = size + Math.max(0, spacing);
  const grains: Grain[] = [];
  for (let offset = 0; offset + size <= height; offset += step) {
    grains.push({ y: baseline - offset - size, height: size });
  }
  return grains;
}

/**
 * Points spaced evenly along a polyline, for a projected run drawn as a trail
 * of grains rather than as a line. The first grain sits one full spacing in, so
 * the projection starts *after* the last booked point instead of on top of it.
 */
export function grainsAlong(points: readonly Point[], spacing: number): readonly Point[] {
  if (points.length < 2 || !Number.isFinite(spacing) || spacing <= 0) return [];

  const out: Point[] = [];
  // Distance still owed from the previous segment, so the spacing does not
  // reset at every corner.
  let carried = spacing;

  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;

    let travelled = carried;
    while (travelled <= length) {
      out.push({ x: from.x + (dx * travelled) / length, y: from.y + (dy * travelled) / length });
      travelled += spacing;
    }
    carried = travelled - length;
  }

  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- trail`
Expected: PASS. If a `grainsAlong` assertion fails on a value like `5.999999999999999`, the maths is right and the expectation is too strict — switch that case to `toBeCloseTo` per coordinate rather than changing the implementation.

- [ ] **Step 5: Re-export from the design barrel**

In `apps/mobile/src/design/index.ts`, replace the line added in Task 2 with:

```ts
export {
  grainSpacing,
  grainsAlong,
  grainStack,
  segmentsFor,
  type Grain,
  type Point,
  type TrailGeometry,
} from './trail';
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/mobile/src/design/trail.ts apps/mobile/src/design/tests/trail.test.ts apps/mobile/src/design/index.ts
git add apps/mobile/src/design/trail.ts apps/mobile/src/design/tests/trail.test.ts apps/mobile/src/design/index.ts
git commit -m "feat(design): grains for the part of a chart that is a guess"
```

---

### Task 4: Trail and GrainRow components

**Files:**
- Create: `apps/mobile/src/components/trail/Trail.tsx`
- Create: `apps/mobile/src/components/trail/GrainRow.tsx`

**Interfaces:**
- Consumes: `segmentsFor` (Task 2), `grain` / `grainSoft` tokens (Task 1), `useTheme`, `useMotion`, `radius`, `spacing`, `type Palette`.
- Produces:
  - `<Trail parts={TrailPart[]} state?={BudgetState} label?={string} />` where `interface TrailPart { readonly ratio: number; readonly tone: keyof Palette; readonly color?: string }`
  - `<GrainRow total={number} filled={number} label?={string} />`

There is no React Native renderer in this repo's test setup — vitest runs in a node environment over `packages/*` and two `apps/mobile/src` directories only. These components are therefore verified by `npm run typecheck` and by the bundle build, and their arithmetic is already covered by Task 2. Do not add a renderer to test them; that is a separate decision, not part of this plan.

- [ ] **Step 1: Write `Trail`**

Create `apps/mobile/src/components/trail/Trail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { BudgetState } from '@finant/core';
import { radius, segmentsFor, useMotion, useTheme, type Palette } from '../../design';

/** One run of the same colour along a shared track. */
export interface TrailPart {
  readonly ratio: number;
  readonly tone: keyof Palette;
  /** Overrides the tone, for a colour the owner chose themselves. */
  readonly color?: string;
}

const HEIGHT = 10;

/**
 * A bar made of grains. The parts share one grain grid computed from the whole
 * track, so the boundary between two of them falls on a gap rather than
 * splitting a grain in half.
 *
 * `state: 'over'` caps the fill at the track and marks the end, rather than
 * letting the bar grow past its own track: a full bar has to keep meaning
 * "nothing left", and the caption underneath carries the excess.
 *
 * Without a `label` the bar is hidden from screen readers on purpose. Every
 * placement of it sits under a caption that already states the figure, and
 * hearing the same number twice is worse than hearing it once.
 */
export function Trail({
  parts,
  state = 'under',
  label,
}: {
  parts: readonly TrailPart[];
  state?: BudgetState;
  label?: string;
}) {
  const theme = useTheme();
  const motion = useMotion();
  const [width, setWidth] = useState(0);

  const grow = useSharedValue(motion.enabled ? 0 : 1);
  useEffect(() => {
    grow.value = motion.enabled ? withTiming(1, { duration: motion.settle }) : 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion.enabled]);

  const reveal = useAnimatedStyle(() => ({ width: width * grow.value }));

  const geometry = segmentsFor(
    width,
    parts.map((part) => part.ratio),
  );

  const carried = parts.reduce(
    (sum, part) => sum + (Number.isFinite(part.ratio) ? Math.min(1, Math.max(0, part.ratio)) : 0),
    0,
  );

  const reader = label
    ? {
        accessible: true,
        accessibilityRole: 'progressbar' as const,
        accessibilityLabel: label,
        accessibilityValue: { min: 0, max: 100, now: Math.round(Math.min(1, carried) * 100) },
      }
    : { accessible: false };

  return (
    <View
      {...reader}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: theme.surfaceSunken }]}
    >
      <Animated.View style={[styles.fill, reveal]}>
        {parts.map((part, index) => {
          const color = part.color ?? theme[part.tone];

          if (geometry.mode === 'continuous') {
            const runWidth = geometry.widths[index] ?? 0;
            return runWidth > 0 ? (
              <View
                key={`run-${index}`}
                style={[styles.run, { width: runWidth, backgroundColor: color }]}
              />
            ) : null;
          }

          return Array.from({ length: geometry.filled[index] ?? 0 }, (_, grain) => (
            <View
              key={`grain-${index}-${grain}`}
              style={[
                styles.grain,
                { width: geometry.size, marginRight: geometry.gap, backgroundColor: color },
              ]}
            />
          ));
        })}
      </Animated.View>
      {state === 'over' ? (
        <View style={[styles.break, { backgroundColor: theme.expenseSoft }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: HEIGHT, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row' },
  run: { height: HEIGHT, borderRadius: radius.pill },
  grain: { height: HEIGHT, borderRadius: radius.pill },
  break: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 3 },
});
```

- [ ] **Step 2: Write `GrainRow`**

Create `apps/mobile/src/components/trail/GrainRow.tsx`:

```tsx
import { StyleSheet, View } from 'react-native';
import { spacing, useTheme } from '../../design';
import { Trail } from './Trail';

/** Past this a row of dots is a texture, not a count. */
const MAX_DOTS = 12;
const SIZE = 8;

/**
 * A countable row: one grain per unit, filled for carried and hollow for not.
 * Above twelve units it hands over to `Trail`, because nobody counts thirteen
 * dots on a phone.
 */
export function GrainRow({
  total,
  filled,
  label,
}: {
  total: number;
  filled: number;
  label?: string;
}) {
  const theme = useTheme();
  const units = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const carried = Number.isFinite(filled) ? Math.min(units, Math.max(0, Math.floor(filled))) : 0;

  if (units > MAX_DOTS) {
    return <Trail parts={[{ ratio: carried / units, tone: 'grain' }]} label={label} />;
  }

  return (
    <View
      style={styles.row}
      accessible={label !== undefined}
      accessibilityLabel={label}
      importantForAccessibility={label === undefined ? 'no-hide-descendants' : 'yes'}
    >
      {Array.from({ length: units }, (_, index) => (
        <View
          key={index}
          style={[
            styles.grain,
            index < carried
              ? { backgroundColor: theme.grain }
              : { backgroundColor: theme.grainSoft, borderWidth: 1, borderColor: theme.border },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  grain: { width: SIZE, height: SIZE, borderRadius: SIZE / 2 },
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `spacing` is not exported from `../../design`, check the barrel — it re-exports `radius` and `spacing` together from `./spacing`.

- [ ] **Step 4: Lint**

Run: `npx eslint apps/mobile/src/components/trail --fix`
Expected: clean. The one `eslint-disable-next-line react-hooks/exhaustive-deps` in `Trail` matches the pattern `ForecastChart` and `BalanceChart` already use for a mount-only animation.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/src/components/trail
git add apps/mobile/src/components/trail
git commit -m "feat(design): two ways to draw a thing that accumulates"
```

---

### Task 5: BudgetBar on top of Trail

**Files:**
- Modify: `apps/mobile/src/components/BudgetBar.tsx`

**Interfaces:**
- Consumes: `Trail` (Task 4).
- Produces: `BudgetBar` with its existing props unchanged — `{ ratio: number; state: BudgetState; color?: string }`. `app/(tabs)/budgets.tsx` is not touched by this task and must not need to be.

This is the smallest surface and the only one with behaviour already in the repo to preserve, which is why it goes first: it proves the primitive before three more screens depend on it.

- [ ] **Step 1: Replace the implementation**

Rewrite `apps/mobile/src/components/BudgetBar.tsx` completely:

```tsx
import type { BudgetState } from '@finant/core';
import { Trail, type TrailPart } from './trail/Trail';

/**
 * A limit bar, not a share bar: the track is the monthly limit, so a full bar
 * always means "nothing left" regardless of the amounts involved. Colour comes
 * from the state the domain assigned, so the bar and the caption can never
 * disagree about whether a budget is in trouble.
 *
 * The grains are the app's accumulation form, but the colour is not `grain`:
 * a budget measures spending against a limit, which is not accumulation.
 */
export function BudgetBar({
  ratio,
  state,
  color,
}: {
  ratio: number;
  state: BudgetState;
  color?: string;
}) {
  const part: TrailPart =
    state === 'over'
      ? { ratio, tone: 'expense' }
      : state === 'near'
        ? { ratio, tone: 'warning' }
        : // The owner's own category colour when they have chosen one.
          { ratio, tone: 'accent', color };

  return <Trail parts={[part]} state={state} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors, and no change needed in `app/(tabs)/budgets.tsx`.

- [ ] **Step 3: Confirm the caller is untouched**

Run: `git status --short`
Expected: `apps/mobile/src/components/BudgetBar.tsx` is the only modified file. If `budgets.tsx` also changed, the props drifted — put them back.

- [ ] **Step 4: Build the bundle**

Run: `cd apps/mobile && npx expo export --platform ios`
Expected: the export completes. This is the first build with the new components in the graph, so a bad import path surfaces here rather than three tasks later.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/src/components/BudgetBar.tsx
git add apps/mobile/src/components/BudgetBar.tsx
git commit -m "feat(budgets): the limit bar learns to count"
```

---

### Task 6: Dashboard trail and grain row

**Files:**
- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/es.ts`
- Modify: `packages/i18n/src/de.ts`

**Interfaces:**
- Consumes: `Trail` and `GrainRow` (Task 4).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the translation keys**

In `packages/i18n/src/en.ts`, inside the `dashboard` object, after `savingsRate`:

```ts
    monthsInBlack_one: '{{count}} of {{total}} months so far ended in the black',
    monthsInBlack_other: '{{count}} of {{total}} months so far ended in the black',
```

In `packages/i18n/src/es.ts`, in the same position inside `dashboard`:

```ts
    monthsInBlack_one: '{{count}} de {{total}} meses hasta ahora terminaron en positivo',
    monthsInBlack_other: '{{count}} de {{total}} meses hasta ahora terminaron en positivo',
```

In `packages/i18n/src/de.ts`, in the same position inside `dashboard`:

```ts
    monthsInBlack_one: '{{count}} von {{total}} Monaten bisher endeten im Plus',
    monthsInBlack_other: '{{count}} von {{total}} Monaten bisher endeten im Plus',
```

- [ ] **Step 2: Typecheck to confirm all three files agree**

Run: `npm run typecheck`
Expected: no errors. If one language is missing a key, `Stringify<Resources>` reports it here — that is the mechanism working, not a problem to route around.

- [ ] **Step 3: Add the imports and the derived figures**

In `apps/mobile/app/(tabs)/index.tsx`, add to the component imports, keeping them in the existing alphabetical run:

```tsx
import { GrainRow } from '../../src/components/trail/GrainRow';
import { Trail } from '../../src/components/trail/Trail';
```

After the existing `savingsRate` const, add:

```tsx
  // Display only. The bar answers "how much of what came in went out", which
  // the savings-rate caption states as a figure underneath it.
  const spendRatio =
    summary.income.minor > 0 ? summary.expenses.minor / summary.income.minor : null;

  // Booked months only. A month that has not happened yet is not a month that
  // failed, so the row counts what is known and stops there.
  const monthsInBlack = useMemo(
    () => booked.months.filter((month) => month.net.minor >= 0).length,
    [booked],
  );
```

- [ ] **Step 4: Add the spend trail to the period card**

In the period `Card`, between the `styles.figures` `View` and the `savingsRate` block, insert:

```tsx
            {spendRatio !== null ? <Trail parts={[{ ratio: spendRatio, tone: 'accent' }]} /> : null}
```

- [ ] **Step 5: Add the grain row to the year card**

Inside the `Animated.View` in the year card, after the closing tag of the `styles.figures` `View`, insert:

```tsx
              {/* Only under the booked view: the row is a claim about months
                  that have happened, and next to a projection it would read as
                  a claim about months that have not. */}
              {yearView === 'booked' && booked.months.length > 0 ? (
                <>
                  <GrainRow total={booked.months.length} filled={monthsInBlack} />
                  <Text style={[type.label, { color: theme.textMuted }]}>
                    {t('dashboard.monthsInBlack', {
                      count: monthsInBlack,
                      total: booked.months.length,
                    })}
                  </Text>
                </>
              ) : null}
```

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck && cd apps/mobile && npx expo export --platform ios`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
npx prettier --write "apps/mobile/app/(tabs)/index.tsx" packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git add "apps/mobile/app/(tabs)/index.tsx" packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git commit -m "feat(dashboard): a month you can count and a year you can count twice"
```

---

### Task 7: Projected bars as grains

**Files:**
- Modify: `apps/mobile/src/components/ForecastChart.tsx`

**Interfaces:**
- Consumes: `grainSpacing`, `grainStack` (Task 3).
- Produces: nothing later tasks depend on.

Remember deviation 2: the grains keep the bar's income or expense colour. And deviation 3: they do not animate, while booked bars still do.

- [ ] **Step 1: Extend the imports**

In `apps/mobile/src/components/ForecastChart.tsx`, change the design import to:

```tsx
import { grainSpacing, grainStack, type as typeScale, useMotion, useTheme } from '../design';
```

- [ ] **Step 2: Branch the two bar rows**

Replace the two `months.map(...)` blocks that render income and expense `Bar`s with:

```tsx
        {months.map((month, i) =>
          month.kind === 'projected' ? (
            <GrainBar
              key={`${month.month}-income`}
              x={GUTTER + slot * i}
              width={barWidth}
              baseline={baseline}
              full={baseline - y(month.income.minor)}
              fill={theme.income}
              spacing={grainSpacing(month.confidence)}
            />
          ) : (
            <Bar
              key={`${month.month}-income`}
              x={GUTTER + slot * i}
              width={barWidth}
              baseline={baseline}
              full={baseline - y(month.income.minor)}
              fill={theme.income}
              opacity={1}
              grow={grow}
            />
          ),
        )}
        {months.map((month, i) =>
          month.kind === 'projected' ? (
            <GrainBar
              key={`${month.month}-expense`}
              x={GUTTER + slot * i + barWidth + 2}
              width={barWidth}
              baseline={baseline}
              full={baseline - y(month.expenses.minor)}
              fill={theme.expense}
              spacing={grainSpacing(month.confidence)}
            />
          ) : (
            <Bar
              key={`${month.month}-expense`}
              x={GUTTER + slot * i + barWidth + 2}
              width={barWidth}
              baseline={baseline}
              full={baseline - y(month.expenses.minor)}
              fill={theme.expense}
              opacity={1}
              grow={grow}
            />
          ),
        )}
```

The `opacity` prop on `Bar` is now always `1`. Leave the prop in place — `Bar` is used nowhere else and removing it is churn this task does not need.

- [ ] **Step 3: Add the `GrainBar` component**

At the bottom of the file, after the existing `Bar` function:

```tsx
/**
 * A projected month: the same bar, drawn as a column of grains. The grains are
 * spaced by the month's own confidence, so a projection built on two months of
 * history looks thinner than one built on twelve.
 *
 * It does not animate, while a booked bar does. A projection that grows into
 * place with the same gesture as a recorded fact is exactly the equivalence
 * the forecast rules exist to prevent.
 */
function GrainBar({
  x,
  width,
  baseline,
  full,
  fill,
  spacing,
}: {
  x: number;
  width: number;
  baseline: number;
  full: number;
  fill: string;
  spacing: number;
}) {
  return (
    <>
      {grainStack(baseline, full, spacing).map((grain) => (
        <Rect
          key={`${x}-${grain.y}`}
          x={x}
          y={grain.y}
          width={width}
          height={grain.height}
          rx={grain.height / 2}
          fill={fill}
        />
      ))}
    </>
  );
}
```

`Rect` is already imported at the top of the file for `AnimatedRect`.

- [ ] **Step 4: Update the component's doc comment**

The header comment says "Projected months are faded against booked ones". Replace that sentence with:

```tsx
 * Projected months are drawn as grains rather than as solid bars, spaced by
 * the confidence of the month they describe — a forecast that looks identical
 * to recorded fact invites the wrong decision, and one that looks identical
 * whatever its history behind it invites it twice.
```

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && cd apps/mobile && npx expo export --platform ios`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/mobile/src/components/ForecastChart.tsx
git add apps/mobile/src/components/ForecastChart.tsx
git commit -m "feat(charts): a projected month stops pretending to be solid"
```

---

### Task 8: Projected balance tail as grains

**Files:**
- Modify: `apps/mobile/src/components/BalanceChart.tsx`
- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/es.ts`
- Modify: `packages/i18n/src/de.ts`

**Interfaces:**
- Consumes: `grainSpacing`, `grainsAlong` (Task 3).
- Produces: `BalanceChart` gains an optional prop — `confidence?: Confidence`, defaulting to `'medium'`.

- [ ] **Step 1: Rewrite the copy that describes a dashed line**

`dashboard.projectedTail` currently reads "Dashed: projected to the end of the year." No dashed tail will exist after this task.

In `packages/i18n/src/en.ts`:

```ts
    projectedTail: 'Grains ahead: projected to the end of the year, not booked.',
```

In `packages/i18n/src/es.ts`:

```ts
    projectedTail: 'Granos por delante: proyección hasta fin de año, no contabilizado.',
```

In `packages/i18n/src/de.ts`:

```ts
    projectedTail: 'Körner voraus: bis Jahresende projiziert, nicht gebucht.',
```

- [ ] **Step 2: Extend the chart's imports and signature**

In `apps/mobile/src/components/BalanceChart.tsx`, change the core import to include `Confidence`:

```tsx
import {
  formatAxisAmount,
  money,
  niceTicks,
  type Confidence,
  type NetWorthPoint,
} from '@finant/core';
```

and the design import to:

```tsx
import { grainSpacing, grainsAlong, type as typeScale, useMotion, useTheme } from '../design';
```

Change the component signature to:

```tsx
export function BalanceChart({
  points,
  labels,
  confidence = 'medium',
}: {
  points: readonly NetWorthPoint[];
  labels: readonly string[];
  confidence?: Confidence;
}) {
```

- [ ] **Step 3: Replace the projected path with grains**

Delete the `const projected = ...` line and put in its place:

```tsx
  // The projected run as points, then as grains along it. It starts on the last
  // booked point so the two meet, and `grainsAlong` puts the first grain one
  // spacing further on so no grain sits on top of a booked figure.
  const projectedPoints =
    firstProjected === -1
      ? []
      : points.slice(Math.max(0, lastActual)).map((point, i) => ({
          x: x(Math.max(0, lastActual) + i),
          y: y(point.total.minor),
        }));
  const grains = grainsAlong(projectedPoints, grainSpacing(confidence) + 5);
```

Then replace the `{projected ? (<Path ... />) : null}` block inside the chart's `<Svg>` with:

```tsx
      {grains.map((grain) => (
        <Circle
          key={`grain-${grain.x.toFixed(1)}-${grain.y.toFixed(1)}`}
          cx={grain.x}
          cy={grain.y}
          r={2.5}
          fill={theme.grain}
        />
      ))}
```

`Circle` is already imported for the last-booked-point marker.

- [ ] **Step 4: Update the component's doc comment**

Replace the paragraph beginning "The projected tail is dashed, stroked separately" with:

```tsx
 * The projected tail is a run of grains rather than a line, carries no gradient
 * underneath it, and is spaced by the confidence the forecast reported. A
 * projection drawn in the same ink as recorded fact is a lie by styling; a
 * filled area reads as more solid still, so the fill stops where fact stops.
```

- [ ] **Step 5: Pass the confidence from the dashboard**

In `apps/mobile/app/(tabs)/index.tsx`, change the `BalanceChart` usage to:

```tsx
                <BalanceChart
                  points={netWorth.points}
                  labels={netWorthLabels}
                  confidence={forecast.confidence}
                />
```

- [ ] **Step 6: Typecheck and build**

Run: `npm run typecheck && cd apps/mobile && npx expo export --platform ios`
Expected: both clean. `DASH_SPAN` is still used by the booked line's reveal animation; if the linter reports it unused, the wrong `Path` was deleted.

- [ ] **Step 7: Commit**

```bash
npx prettier --write apps/mobile/src/components/BalanceChart.tsx "apps/mobile/app/(tabs)/index.tsx" packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git add apps/mobile/src/components/BalanceChart.tsx "apps/mobile/app/(tabs)/index.tsx" packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git commit -m "feat(charts): the line ahead becomes grains, and says so"
```

---

### Task 9: The import outcome trail

**Files:**
- Modify: `apps/mobile/app/import.tsx`
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/es.ts`
- Modify: `packages/i18n/src/de.ts`

**Interfaces:**
- Consumes: `Trail` (Task 4).
- Produces: nothing later tasks depend on.

There is no live carry-in progress here and none is being added. `stage` parses the whole file synchronously; a progress bar would be animating work that had already finished.

The count of set-aside rows must be captured at confirm time. `staged` is a `useMemo` over `file` and `choice`, and `confirm` sets both to `null`, so by the time the result card renders `staged` is gone.

- [ ] **Step 1: Add the translation key**

In `packages/i18n/src/en.ts`, inside the `import` object, after `issues_other`:

```ts
    setAside_one: '{{count}} row set aside as unreadable',
    setAside_other: '{{count}} rows set aside as unreadable',
```

In `packages/i18n/src/es.ts`, same position:

```ts
    setAside_one: '{{count}} fila apartada por ilegible',
    setAside_other: '{{count}} filas apartadas por ilegibles',
```

In `packages/i18n/src/de.ts`, same position:

```ts
    setAside_one: '{{count}} Zeile beiseitegelegt, nicht lesbar',
    setAside_other: '{{count}} Zeilen beiseitegelegt, nicht lesbar',
```

- [ ] **Step 2: Capture the set-aside count before the staged rows are dropped**

In `apps/mobile/app/import.tsx`, add the import:

```tsx
import { Trail } from '../src/components/trail/Trail';
```

Add the state, next to `const [result, setResult] = useState<IngestResult | null>(null);`:

```tsx
  // Captured at confirm time: `staged` is a memo over `file` and `choice`, and
  // confirm clears both, so the issue count is gone by the time the result card
  // renders. Rows the parser could not read are part of the outcome and have to
  // survive the screen changing state.
  const [setAside, setSetAside] = useState(0);
```

In `confirm`, immediately before `setResult(await ingest(staged.transactions));`:

```tsx
      setSetAside(staged.issues.length);
```

- [ ] **Step 3: Add the trail to the result card**

Add above the `return`, next to the other derived values:

```tsx
  // Every row the file offered, however it ended up.
  const carried = result ? result.inserted + result.duplicates + setAside : 0;
```

In the result `Card`, immediately after the opening tag and before the `import.imported` `Text`:

```tsx
          {carried > 0 ? (
            <Trail
              parts={[
                { ratio: result.inserted / carried, tone: 'income' },
                { ratio: result.duplicates / carried, tone: 'textMuted' },
                { ratio: setAside / carried, tone: 'warning' },
              ]}
            />
          ) : null}
```

And after the `autoExcluded` block, before the `Button`:

```tsx
          {setAside > 0 ? (
            <Text style={[type.label, { color: theme.textMuted }]}>
              {t('import.setAside', { count: setAside })}
            </Text>
          ) : null}
```

- [ ] **Step 4: Reset the count when a new file is picked**

In `pick`, alongside `setResult(null)`:

```tsx
    setSetAside(0);
```

Without this a second import shows the first import's unreadable rows.

- [ ] **Step 5: Typecheck and build**

Run: `npm run typecheck && cd apps/mobile && npx expo export --platform ios`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/mobile/app/import.tsx packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git add apps/mobile/app/import.tsx packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git commit -m "feat(import): what was carried, what was already there, what was set aside"
```

---

### Task 10: The icon

**Files:**
- Create: `apps/mobile/assets/brand/icon.svg`
- Create: `apps/mobile/assets/brand/icon-mark.svg`
- Create: `apps/mobile/assets/brand/icon-mono.svg`
- Create: `scripts/render-icons.ts`
- Modify: `package.json`
- Modify: `apps/mobile/app.json`
- Overwrite: `apps/mobile/assets/{icon,favicon,splash-icon,android-icon-foreground,android-icon-background,android-icon-monochrome}.png`

**Interfaces:**
- Consumes: `grain` `#A8720E` from Task 1 — the grain the ant carries is the same ochre the interface uses for accumulation.
- Produces: `npm run icons`.

The existing PNGs are the Expo template placeholder. Nothing in them is worth preserving.

- [ ] **Step 1: Add the rasterizer**

Run: `npm install --save-dev --workspace-root @resvg/resvg-js`

Expected: `@resvg/resvg-js` lands in the root `devDependencies`. It is never imported by the app, so the project's no-network-at-runtime rule is untouched.

- [ ] **Step 2: Write the full mark**

Create `apps/mobile/assets/brand/icon-mark.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g transform="translate(-39 25)">
    <g fill="none" stroke="#06695F" stroke-width="26" stroke-linecap="round">
      <path d="M596 566 L648 664 L716 700"/>
      <path d="M524 596 L536 700 L596 752"/>
      <path d="M452 592 L428 704 L474 764"/>
      <path d="M676 452 C724 372 772 340 812 330"/>
      <path d="M700 486 C764 452 820 448 862 462"/>
    </g>
    <g fill="#06695F">
      <ellipse cx="372" cy="566" rx="132" ry="112"/>
      <circle cx="470" cy="558" r="30"/>
      <ellipse cx="556" cy="542" rx="76" ry="70"/>
      <ellipse cx="674" cy="510" rx="86" ry="80"/>
    </g>
    <ellipse cx="744" cy="286" rx="98" ry="76" fill="#A8720E" transform="rotate(-14 744 286)"/>
  </g>
</svg>
```

Create `apps/mobile/assets/brand/icon.svg` — the same file with a ground behind it:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#F2F6F5"/>
  <g transform="translate(-39 25)">
    <g fill="none" stroke="#06695F" stroke-width="26" stroke-linecap="round">
      <path d="M596 566 L648 664 L716 700"/>
      <path d="M524 596 L536 700 L596 752"/>
      <path d="M452 592 L428 704 L474 764"/>
      <path d="M676 452 C724 372 772 340 812 330"/>
      <path d="M700 486 C764 452 820 448 862 462"/>
    </g>
    <g fill="#06695F">
      <ellipse cx="372" cy="566" rx="132" ry="112"/>
      <circle cx="470" cy="558" r="30"/>
      <ellipse cx="556" cy="542" rx="76" ry="70"/>
      <ellipse cx="674" cy="510" rx="86" ry="80"/>
    </g>
    <ellipse cx="744" cy="286" rx="98" ry="76" fill="#A8720E" transform="rotate(-14 744 286)"/>
  </g>
</svg>
```

- [ ] **Step 3: Write the simplified mark**

Create `apps/mobile/assets/brand/icon-mono.svg`. No legs and no antennae — a 26px stroke is a hairline at 48px and disappears entirely under the Android monochrome tint. The body segments are thickened to compensate, and the grain stays, because the grain is what makes the silhouette an ant *saving* rather than an ant:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g fill="#000000" transform="translate(-28 67)">
    <ellipse cx="372" cy="566" rx="140" ry="120"/>
    <circle cx="470" cy="558" r="38"/>
    <ellipse cx="556" cy="542" rx="84" ry="78"/>
    <ellipse cx="674" cy="510" rx="94" ry="88"/>
    <ellipse cx="744" cy="286" rx="104" ry="82" transform="rotate(-14 744 286)"/>
  </g>
</svg>
```

- [ ] **Step 4: Write the render script**

Create `scripts/render-icons.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

/**
 * Every icon PNG in the app is build output. The SVGs under assets/brand are
 * the only place the mark is drawn, so changing it is one edit rather than six
 * exports that drift apart.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'apps/mobile/assets/brand');
const assets = join(root, 'apps/mobile/assets');

const TEAL = '#06695F';

function render(svg: string, size: number, out: string): void {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(assets, out), png);
  console.log(`${out} — ${size}px`);
}

function read(name: string): string {
  return readFileSync(join(brand, name), 'utf8');
}

/**
 * Android's adaptive mask can crop anything outside the central 66% of the
 * canvas, and a round mask on a square mark takes the antennae first.
 */
function insetForAdaptive(svg: string): string {
  const body = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">',
    '<g transform="translate(512 512) scale(0.62) translate(-512 -512)">',
    body,
    '</g></svg>',
  ].join('');
}

const icon = read('icon.svg');
const mark = read('icon-mark.svg');
const mono = read('icon-mono.svg');

// Opaque: Apple rejects an alpha channel on the app icon.
render(icon, 1024, 'icon.png');
render(icon, 48, 'favicon.png');
render(mark, 1024, 'splash-icon.png');
render(insetForAdaptive(mark), 1024, 'android-icon-foreground.png');
render(insetForAdaptive(mono), 1024, 'android-icon-monochrome.png');
render(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><rect width="1024" height="1024" fill="${TEAL}"/></svg>`,
  1024,
  'android-icon-background.png',
);
```

- [ ] **Step 5: Add the script entry**

In the root `package.json`, in `scripts`, after `inspect:csv`:

```json
    "icons": "tsx scripts/render-icons.ts",
```

- [ ] **Step 6: Render**

Run: `npm run icons`
Expected: six lines of output, one per file.

- [ ] **Step 7: Look at what came out**

Open `apps/mobile/assets/icon.png` and check, in this order:

1. It reads as an ant carrying something, at full size.
2. The mark is centred — the `translate(-39 25)` in the SVG is a calculated guess at the bounding box, not a measurement. If the mark sits high, low, or off to one side, adjust that translate in **both** `icon.svg` and `icon-mark.svg` and re-run.
3. At 48px (`favicon.png`) the silhouette still reads. Legs will be nearly gone; the body and grain must not be.
4. `android-icon-monochrome.png` reads as a single shape with the grain separate from the head, with nothing touching the edges of the central circle.

- [ ] **Step 8: Point `app.json` at the right background**

In `apps/mobile/app.json`, change `android.adaptiveIcon.backgroundColor`:

```json
        "backgroundColor": "#06695F",
```

It was `#0F172A`, a slate left over from the Expo template that agreed with neither the palette nor the background image beside it.

- [ ] **Step 9: Build**

Run: `cd apps/mobile && npx expo export --platform ios`
Expected: clean, with the new icon in the export.

- [ ] **Step 10: Commit**

```bash
npx prettier --write scripts/render-icons.ts package.json apps/mobile/app.json
git add apps/mobile/assets scripts/render-icons.ts package.json package-lock.json apps/mobile/app.json
git commit -m "feat(brand): an ant, a grain, and six PNGs that come from one file"
```

---

## Finishing

- [ ] Run the full suite once more from the repo root: `npm test && npm run typecheck && npm run lint`
- [ ] Confirm the working tree holds nothing unintended: `git status --short`. `apps/mobile/src/db/database.ts` and `apps/mobile/src/i18n/index.ts` were already modified before this work began and are not part of it.
- [ ] Merge the branch per the project's flow: `git checkout main && git merge --no-ff ant-design-language -m "merge: <subject>"`. The owner runs `git push`.
