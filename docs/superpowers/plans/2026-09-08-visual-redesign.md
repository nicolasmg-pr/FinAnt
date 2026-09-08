# Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FinAnt's flat, per-screen-invented styling with a shared token layer and primitive component layer, then restyle all nine screens against them — soft depth, teal accent, system typeface, restrained motion.

**Architecture:** Three layers, built bottom-up. `src/design/` holds colour, type, elevation, motion and spacing tokens, with `src/theme.ts` reduced to a re-export shim so screens keep compiling during migration. `src/components/ui/` holds nine primitives that every screen composes. Screens migrate one at a time, Dashboard first as an approval checkpoint.

**Tech Stack:** TypeScript 6 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), React 19.2, React Native 0.86, Expo SDK 57, expo-router, react-native-reanimated 4.5.1 (installed, currently unused), react-native-svg 15.15.4, vitest 3 (node, packages only today).

**Spec:** `docs/superpowers/specs/2026-09-08-visual-redesign-design.md`

## Global Constraints

- No new runtime dependency. Reanimated 4.5.1 and svg 15.15.4 are already installed; nothing else is added. No bundled font.
- No change to any route, to the five-tab structure, to `packages/core`, to the database schema, or to anything under `src/db/` or `src/security/`.
- No renamed or deleted i18n key. New keys only where a control needs copy that does not exist. Every new key goes into all three locales (`en`, `es`, `de`) in `packages/i18n`, or the build fails — translations are typed against `Resources`.
- Relative imports inside packages and inside `apps/mobile/src` are **extensionless**. Metro does not map `./money.js` onto `money.ts`.
- Money stays signed integer minor units. `Amount`'s tone logic is not touched: tone is decided independently of sign, because an expense total displays as a positive magnitude and must still read as money going out.
- Dates stay `YYYY-MM-DD` / `YYYY-MM` strings. No booking date goes through a `Date` for display purposes beyond the existing `Intl` label formatting, which already constructs UTC-anchored dates deliberately.
- Category ids are permanent. Category `color` values already in the database are owner data and are never rewritten.
- A forecast never renders in the same ink as a booked figure. Projected chart segments stay dashed, unfilled and reduced-opacity.
- Never log a movement, narrative, IBAN, or any part of a statement. No screenshot is committed.
- `npm run lint:fix` is scoped to changed paths only — a repo-wide run reformats everything and buries the diff. Use `npx prettier --write <paths>` and `npx eslint --fix <paths>`. Note: zsh does not word-split `$VAR`; pipe file lists through `xargs`.
- Every task ends with the tree compiling: `npm run typecheck` clean.
- Palette values are exact. Do not re-pick a hex "that looks close" — the light theme's 19 contrast pairs are asserted in a test and were tuned to pass at 4.5:1.

---

### Task 1: Palette tokens with an asserted contrast floor

**Files:**

- Create: `apps/mobile/src/design/palette.ts`
- Create: `apps/mobile/src/design/tests/palette.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type Palette` (a `Record` of the 19 role keys to `string`), `const lightPalette: Palette`, `const darkPalette: Palette`. `palette.ts` imports nothing from `react-native` so it runs under node.

- [ ] **Step 1: Widen the vitest include**

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/mobile/src/design/tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 2: Write the failing test**

```ts
// apps/mobile/src/design/tests/palette.test.ts
import { describe, expect, it } from 'vitest';
import { darkPalette, lightPalette, type Palette } from '../palette';

/** Relative luminance per WCAG 2.1. */
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every pair that puts ink on a ground. The AA body threshold is applied to
 * all of them rather than allowing large text 3:1, because amounts render at
 * both sizes and a token cannot know which one a caller will use.
 */
const PAIRS: ReadonlyArray<readonly [keyof Palette, keyof Palette]> = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceSunken'],
  ['text', 'surfaceAlt'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceSunken'],
  ['textMuted', 'surfaceAlt'],
  ['accent', 'background'],
  ['accent', 'surface'],
  ['accent', 'accentSoft'],
  ['onAccent', 'accent'],
  ['onAccent', 'accentPressed'],
  ['income', 'surface'],
  ['income', 'incomeSoft'],
  ['expense', 'surface'],
  ['expense', 'expenseSoft'],
  ['warning', 'surface'],
  ['warning', 'warningSoft'],
];

describe('palette', () => {
  it('gives both themes the same roles', () => {
    expect(Object.keys(darkPalette)).toEqual(Object.keys(lightPalette));
  });

  it('uses six-digit hex for every role', () => {
    for (const palette of [lightPalette, darkPalette]) {
      for (const [role, value] of Object.entries(palette)) {
        expect(value, role).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  for (const [name, palette] of [
    ['light', lightPalette],
    ['dark', darkPalette],
  ] as const) {
    for (const [ink, ground] of PAIRS) {
      it(`${name}: ${ink} on ${ground} reaches AA`, () => {
        expect(contrast(palette[ink], palette[ground])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  /**
   * accentInk is the stroke a chart draws over its own bars. It is not text,
   * so AA does not apply, but it must sit off the bars' lightness or the net
   * line disappears into whichever bar it crosses.
   */
  it('keeps the chart ink off the bar colours in lightness', () => {
    for (const palette of [lightPalette, darkPalette]) {
      expect(contrast(palette.accentInk, palette.income)).toBeGreaterThanOrEqual(1.4);
      expect(contrast(palette.accentInk, palette.expense)).toBeGreaterThanOrEqual(1.4);
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- palette`
Expected: FAIL — `Failed to resolve import "../palette"`.

- [ ] **Step 4: Write the palette**

```ts
// apps/mobile/src/design/palette.ts

/**
 * Soft depth, teal accent. Two roles the old palette lacked carry the look:
 * a tinted `background` so white cards read as floating rather than as the
 * page itself, and the raised/sunken surface pair so a card can sit inside a
 * card without a border.
 *
 * The light values are darker than a soft-depth palette would naively pick.
 * That is not an accident: the first pass failed nine AA pairs, so accent,
 * income, expense, warning and textMuted were all taken down until every pair
 * in palette.test.ts cleared 4.5:1. Do not lighten one without re-running it.
 *
 * No react-native import lives in this file. It is a plain data module so the
 * contrast test can run under node.
 */
export const lightPalette = {
  background: '#F2F6F5',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#E8EEED',
  surfaceAlt: '#E6EDEB',
  border: '#DDE5E3',
  text: '#0F1D1B',
  textMuted: '#556A66',
  accent: '#06695F',
  accentPressed: '#044F47',
  accentSoft: '#D3EEE9',
  accentInk: '#063F3A',
  onAccent: '#FFFFFF',
  income: '#26703C',
  incomeSoft: '#DBF0E0',
  expense: '#B32E3C',
  expenseSoft: '#FADFE2',
  warning: '#8A5411',
  warningSoft: '#F8E8D2',
} as const;

/** Both palettes share the same keys; values are plain strings so the dark
 * palette is assignable to the same type. */
export type Palette = Record<keyof typeof lightPalette, string>;

/**
 * Depth in the dark theme comes from lifting surface lightness, never from a
 * shadow: a shadow does not read on a near-black ground.
 */
export const darkPalette: Palette = {
  background: '#0B1413',
  surface: '#131F1E',
  surfaceRaised: '#1A2726',
  surfaceSunken: '#0E1817',
  surfaceAlt: '#1E2E2C',
  border: '#263634',
  text: '#E9F1EF',
  textMuted: '#93A8A4',
  accent: '#3FD0BE',
  accentPressed: '#2FB4A4',
  accentSoft: '#12332F',
  accentInk: '#9BF7E9',
  onAccent: '#04231F',
  income: '#6FD37A',
  incomeSoft: '#16301C',
  expense: '#F2777F',
  expenseSoft: '#33191C',
  warning: '#E9A84C',
  warningSoft: '#33260F',
};

/**
 * Default colours for categories the owner has never coloured. Existing
 * `color` values in the database are owner data and are never overwritten;
 * this ramp only fills a null, and seeds the swatch picker.
 */
export const categoryRamp = [
  '#3E8E7E',
  '#5B8DBE',
  '#8B7BC4',
  '#C4789B',
  '#C98A5E',
  '#7FA05C',
  '#4F9AA8',
  '#B0708C',
  '#9A8C5C',
  '#6E86B8',
] as const;
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npm test -- palette`
Expected: PASS, 42 tests.

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts apps/mobile/src/design/palette.ts apps/mobile/src/design/tests/palette.test.ts
git commit -m "feat(design): palette roles with an asserted contrast floor"
```

---

### Task 2: The rest of the token layer, and the theme shim

**Files:**

- Create: `apps/mobile/src/design/spacing.ts`, `apps/mobile/src/design/type.ts`, `apps/mobile/src/design/elevation.ts`, `apps/mobile/src/design/motion.ts`, `apps/mobile/src/design/index.ts`
- Modify: `apps/mobile/src/theme.ts` (becomes a shim)

**Interfaces:**

- Consumes: `Palette`, `lightPalette`, `darkPalette` from Task 1.
- Produces:
  - `spacing`, `radius` (same names as today, `radius` values changed)
  - `type: Record<TypeRole, TextStyle>` and `typeMoney: Record<TypeRole, TextStyle>`, `type TypeRole = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption'`
  - `useElevation(level: 0 | 1 | 2 | 3): ViewStyle`
  - `useTheme(): Palette`, `useIsDark(): boolean`
  - `useMotion(): { instant: number; quick: number; settle: number; pressScale: number; spring: WithSpringConfig; enabled: boolean }`

- [ ] **Step 1: Write the spacing and radius scale**

```ts
// apps/mobile/src/design/spacing.ts

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Grown from the old scale for the softer silhouette: cards move to `xl`. */
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
```

- [ ] **Step 2: Write the type scale**

```ts
// apps/mobile/src/design/type.ts
import type { TextStyle } from 'react-native';

export type TypeRole = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption';

/**
 * Six roles, each fixing size, weight, line height and tracking. Screens must
 * not write a `fontSize` literal: the sizes were scattered as 30/24/17/16/14/
 * 13/12/9 across every file, which is the main reason the app read templated.
 *
 * System face on both platforms (SF Pro, Roboto). No bundled font.
 */
export const type: Record<TypeRole, TextStyle> = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.1 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400', letterSpacing: 0 },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0 },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '500', letterSpacing: 0.3 },
};

/** Same roles with figures locked to one width, so a column of amounts lines
 * up and a changing total does not jitter. */
export const typeMoney: Record<TypeRole, TextStyle> = Object.fromEntries(
  Object.entries(type).map(([role, style]) => [
    role,
    { ...style, fontVariant: ['tabular-nums'] satisfies TextStyle['fontVariant'] },
  ]),
) as Record<TypeRole, TextStyle>;

/**
 * A row that cannot grow taller caps how far the OS text-size setting scales
 * it, rather than clipping. Anything that can absorb the growth passes no cap.
 */
export const MAX_FONT_SCALE = 1.4;
```

- [ ] **Step 3: Write elevation**

```ts
// apps/mobile/src/design/elevation.ts
import { Platform, useColorScheme, type ViewStyle } from 'react-native';
import { darkPalette, lightPalette } from './palette';

export type ElevationLevel = 0 | 1 | 2 | 3;

const shadows: Record<ElevationLevel, ViewStyle> = {
  0: {},
  1: {
    shadowColor: lightPalette.text,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  2: {
    shadowColor: lightPalette.text,
    shadowOpacity: 0.09,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  3: {
    shadowColor: lightPalette.text,
    shadowOpacity: 0.16,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
};

/** Dark theme lifts the surface instead of casting a shadow. */
const darkSurfaces: Record<ElevationLevel, string> = {
  0: darkPalette.background,
  1: darkPalette.surface,
  2: darkPalette.surfaceRaised,
  3: darkPalette.surfaceRaised,
};

/**
 * `elevation(2)` means the same thing to a caller in either theme: this thing
 * sits above the thing behind it. How that is drawn differs, because a shadow
 * is invisible on a near-black ground.
 *
 * Android composites a shadow per view, so this never goes on a list row —
 * depth there comes from the card containing the rows.
 */
export function useElevation(level: ElevationLevel): ViewStyle {
  const dark = useColorScheme() === 'dark';
  if (dark) return { backgroundColor: darkSurfaces[level] };
  const shadow = shadows[level];
  // Android's `elevation` needs an opaque background or it draws nothing.
  return Platform.OS === 'android' && level > 0
    ? { ...shadow, backgroundColor: lightPalette.surface }
    : shadow;
}
```

- [ ] **Step 4: Write motion**

```ts
// apps/mobile/src/design/motion.ts
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { Easing, type EasingFunction, type WithSpringConfig } from 'react-native-reanimated';

export type Motion = {
  instant: number;
  quick: number;
  settle: number;
  pressScale: number;
  easeOut: EasingFunction;
  spring: WithSpringConfig;
  enabled: boolean;
};

const full: Motion = {
  instant: 120,
  quick: 200,
  settle: 320,
  pressScale: 0.97,
  easeOut: Easing.out(Easing.cubic),
  spring: { damping: 22, stiffness: 260, mass: 0.9 },
  enabled: true,
};

const still: Motion = {
  ...full,
  instant: 0,
  quick: 0,
  settle: 0,
  pressScale: 1,
  spring: { damping: 100, stiffness: 1000, mass: 0.1 },
  enabled: false,
};

/**
 * Returns the motion tokens already flattened when the owner has asked the OS
 * for less motion, so no caller writes a conditional of its own and no
 * animation can escape the setting by being added later.
 */
export function useMotion(): Motion {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (alive) setReduced(value);
    });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);

  return reduced ? still : full;
}
```

- [ ] **Step 5: Write the barrel and the theme hook**

```ts
// apps/mobile/src/design/index.ts
import { useColorScheme } from 'react-native';
import { darkPalette, lightPalette, type Palette } from './palette';

export { categoryRamp, darkPalette, lightPalette, type Palette } from './palette';
export { radius, spacing } from './spacing';
export { MAX_FONT_SCALE, type, typeMoney, type TypeRole } from './type';
export { useElevation, type ElevationLevel } from './elevation';
export { useMotion, type Motion } from './motion';

export function useTheme(): Palette {
  return useColorScheme() === 'dark' ? darkPalette : lightPalette;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}
```

- [ ] **Step 6: Reduce the old theme file to a shim**

```ts
// apps/mobile/src/theme.ts

/**
 * Kept only so screens that have not migrated to `src/design` yet keep
 * compiling. Deleted in the cleanup task once nothing imports it.
 */
export { radius, spacing, useTheme, type Palette } from './design';
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. Every existing screen still imports `radius`/`spacing`/`useTheme` from `../theme` and gets the new values.

- [ ] **Step 8: Bundle check**

Run: `cd apps/mobile && npx expo export --platform ios`
Expected: exports without error. This is the first import of Reanimated in app code, so it is worth catching a bundling problem here rather than nine tasks later.

- [ ] **Step 9: Commit**

```bash
git add apps/mobile/src/design apps/mobile/src/theme.ts
git commit -m "feat(design): type, elevation and motion tokens behind a theme shim"
```

---

### Task 3: Touchable, and the Card / Chip restyle

**Files:**

- Create: `apps/mobile/src/components/ui/Touchable.tsx`
- Modify: `apps/mobile/src/components/Card.tsx`, `apps/mobile/src/components/Chip.tsx`, `apps/mobile/src/components/CategoryChip.tsx`

**Interfaces:**

- Consumes: `useTheme`, `useElevation`, `useMotion`, `radius`, `spacing`, `type` from `../design`.
- Produces:
  - `<Touchable onPress accessibilityRole accessibilityLabel accessibilityState accessibilityHint disabled hitSlop style children />` — a pressable that dips to `pressScale`.
  - `<Card title? subtitle? padded? onPress? children />`
  - `<Chip label selected onPress />`, `<CategoryChip category selected onPress />` — unchanged call sites.

- [ ] **Step 1: Write Touchable**

```tsx
// apps/mobile/src/components/ui/Touchable.tsx
import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotion } from '../../design';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The one place press feedback is defined. Everything tappable composes this,
 * so the feel cannot drift between a chip, a card and a button — which is
 * exactly what happened when each screen wrote its own Pressable.
 *
 * Scale only, no opacity change: a dimming amount reads as disabled.
 */
export function Touchable({
  children,
  style,
  disabled,
  ...rest
}: PressableProps & { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const motion = useMotion();
  const scale = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      hitSlop={rest.hitSlop ?? 8}
      onPressIn={(event) => {
        scale.value = withTiming(motion.pressScale, { duration: motion.instant });
        rest.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withTiming(1, { duration: motion.instant });
        rest.onPressOut?.(event);
      }}
      style={[style, animated, disabled ? { opacity: 0.4 } : null]}
    >
      {children}
    </AnimatedPressable>
  );
}
```

- [ ] **Step 2: Restyle Card**

```tsx
// apps/mobile/src/components/Card.tsx
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type, useElevation, useTheme } from '../design';
import { Touchable } from './ui/Touchable';

/**
 * The surface everything sits on. No border any more: separation comes from
 * elevation, which is what makes the soft-depth look work. `padded={false}`
 * is for a card whose child is a full-bleed chart or list.
 */
export function Card({
  title,
  subtitle,
  padded = true,
  onPress,
  children,
}: {
  title?: string;
  subtitle?: string;
  padded?: boolean;
  onPress?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const elevation = useElevation(1);

  const body = (
    <>
      {title ? <Text style={[type.heading, { color: theme.text }]}>{title}</Text> : null}
      {subtitle ? <Text style={[type.label, { color: theme.textMuted }]}>{subtitle}</Text> : null}
      {children}
    </>
  );

  const style = [
    styles.card,
    padded ? styles.padded : null,
    { backgroundColor: theme.surface },
    elevation,
  ];

  // A pressable card gets its feedback from Touchable rather than from a bare
  // Pressable wrapped around it, which is what banks and budgets did and which
  // gave no feedback at all.
  return onPress ? (
    <Touchable onPress={onPress} accessibilityRole="button" style={style}>
      {body}
    </Touchable>
  ) : (
    <View style={style}>{body}</View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    marginBottom: spacing.lg,
    gap: spacing.sm,
    overflow: 'visible',
  },
  padded: { padding: spacing.lg },
});
```

- [ ] **Step 3: Restyle Chip and CategoryChip**

`Chip` keeps its exact props. Selected state becomes a filled tint rather than an outline, and it composes `Touchable`:

```tsx
// apps/mobile/src/components/Chip.tsx
import { StyleSheet, Text } from 'react-native';
import { radius, spacing, type, useTheme } from '../design';
import { Touchable } from './ui/Touchable';

/** A selectable pill: filled with the soft accent when chosen, so selection
 * reads at a glance instead of hinging on a hairline border colour. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Touchable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? theme.accentSoft : theme.surfaceAlt }]}
    >
      <Text style={[type.label, { color: selected ? theme.accent : theme.text }]}>{label}</Text>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
});
```

`CategoryChip` gets the same treatment, keeping its 8px colour dot and its existing props.

- [ ] **Step 4: Typecheck and bundle**

Run: `npm run typecheck && cd apps/mobile && npx expo export --platform ios`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/components
git commit -m "feat(ui): one press-feedback wrapper, and cards that cast a shadow"
```

---

### Task 4: Button and Field

**Files:**

- Create: `apps/mobile/src/components/ui/Button.tsx`, `apps/mobile/src/components/ui/Field.tsx`

**Interfaces:**

- Consumes: `Touchable`, tokens.
- Produces:
  - `<Button label variant? size? icon? loading? disabled? onPress />`, `variant: 'primary' | 'secondary' | 'danger'` (default `primary`), `size: 'md' | 'lg'` (default `md`), `icon?: keyof typeof Feather.glyphMap`
  - `<Field label value onChangeText placeholder? hint? error? keyboardType? autoCapitalize? multiline? />`

- [ ] **Step 1: Write Button**

```tsx
// apps/mobile/src/components/ui/Button.tsx
import Feather from '@expo/vector-icons/Feather';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { radius, spacing, type, useTheme } from '../../design';
import { Touchable } from './Touchable';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

/**
 * Replaces four separate `addButton` implementations plus the bare
 * Pressable+Text actions that were scattered through settings, import and
 * transaction detail.
 */
export function Button({
  label,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  onPress,
}: {
  label: string;
  variant?: ButtonVariant;
  size?: 'md' | 'lg';
  icon?: keyof typeof Feather.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();

  const background =
    variant === 'primary'
      ? theme.accent
      : variant === 'secondary'
        ? theme.accentSoft
        : 'transparent';
  const foreground =
    variant === 'primary' ? theme.onAccent : variant === 'danger' ? theme.expense : theme.accent;

  return (
    <Touchable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        styles.button,
        size === 'lg' ? styles.lg : styles.md,
        { backgroundColor: background },
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={foreground} size="small" />
        ) : (
          <>
            {icon ? <Feather name={icon} size={16} color={foreground} /> : null}
            <Text style={[type.heading, { color: foreground }]}>{label}</Text>
          </>
        )}
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  md: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  lg: { paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
  content: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
```

- [ ] **Step 2: Write Field**

```tsx
// apps/mobile/src/components/ui/Field.tsx
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { radius, spacing, type, useTheme } from '../../design';

/**
 * Label + input + hint/error. The same three lines were written out by hand in
 * movement/new, categories, budgets, banks and AccountPicker, each with its
 * own padding.
 */
export function Field({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        {...input}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          input.onBlur?.(event);
        }}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          type.body,
          {
            backgroundColor: theme.surfaceSunken,
            color: theme.text,
            borderColor: error ? theme.expense : focused ? theme.accent : 'transparent',
          },
          style,
        ]}
      />
      {error ? (
        <Text style={[type.caption, { color: theme.expense }]}>{error}</Text>
      ) : hint ? (
        <Text style={[type.caption, { color: theme.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components/ui
git commit -m "feat(ui): Button and Field primitives"
```

---

### Task 5: Sheet, and FormSheet on top of it

**Files:**

- Create: `apps/mobile/src/components/ui/Sheet.tsx`
- Modify: `apps/mobile/src/components/FormSheet.tsx`

**Interfaces:**

- Consumes: `Button`, `Field`, tokens, `useMotion`.
- Produces: `<Sheet visible onDismiss title? children />` — backdrop fade, spring slide-up, drag handle, drag-to-dismiss past 25% of its height, safe-area bottom padding, `KeyboardAvoidingView` on iOS.

- [ ] **Step 1: Write Sheet**

Key requirements the implementer must hit:

- `Modal` with `transparent`, `animationType="none"` (the animation is ours), `onRequestClose={onDismiss}`, `statusBarTranslucent`.
- Backdrop is an `Animated.View` at `rgba(0,0,0,0.4)` fading over `motion.quick`, wrapped in a `Pressable` that calls `onDismiss`.
- Panel is an `Animated.View` on `theme.surface`, `borderTopLeftRadius`/`borderTopRightRadius` at `radius.xl`, `useElevation(3)`, entering with `withSpring(0, motion.spring)` from its measured height.
- A 36×4 `pill`-radius handle in `theme.border`, centred, with `spacing.sm` margin.
- Use `PanResponder` from `react-native` for the drag, driving a Reanimated shared value. `react-native-gesture-handler` does resolve (3.2.1, pulled in transitively by `react-native-screens`/`expo-router`) but is **not** declared in `apps/mobile/package.json`; reaching for it would mean declaring it, and the global constraints forbid that. If `PanResponder` fights the inner `ScrollView`, omit the drag rather than adding the dependency — backdrop tap and hardware back always dismiss, so the sheet is never a trap.
- `paddingBottom: useSafeAreaInsets().bottom + spacing.lg`.
- When `motion.enabled` is false, the panel appears with no translation and the backdrop with no fade.

- [ ] **Step 2: Rewrite FormSheet as a wrapper**

`FormSheet` keeps its current props exactly (`visible`, `title`, `subtitle`, `fields`, `error`, `onCancel`, `onSave`, `onDelete`). Internals become: `<Sheet>` containing the title, `Field` per entry in `fields`, the error line, and a row of `Button`s — cancel as `secondary`, delete as `danger`, save as `primary`. No caller changes.

- [ ] **Step 3: Typecheck and bundle**

Run: `npm run typecheck && cd apps/mobile && npx expo export --platform ios`
Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/components
git commit -m "feat(ui): one bottom sheet, with FormSheet built on it"
```

---

### Task 6: ListRow, StatTile, SegmentedControl, SectionHeader

**Files:**

- Create: `apps/mobile/src/components/ui/ListRow.tsx`, `apps/mobile/src/components/ui/StatTile.tsx`, `apps/mobile/src/components/ui/SegmentedControl.tsx`, `apps/mobile/src/components/ui/SectionHeader.tsx`

**Interfaces:**

- Produces:
  - `<ListRow title subtitle? leading? trailing? onPress? divider? />` — `leading`/`trailing` are `ReactNode`. Never carries its own elevation.
  - `<StatTile label tone children />`, `tone: 'income' | 'expense' | 'neutral'`
  - `<SegmentedControl<T> options={{ value: T; label: string }[]} value onChange />`
  - `<SectionHeader label action? />` — label rendered uppercase in `caption`.

- [ ] **Step 1: Write ListRow**

```tsx
// apps/mobile/src/components/ui/ListRow.tsx
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MAX_FONT_SCALE, spacing, type, useTheme } from '../../design';
import { Touchable } from './Touchable';

/**
 * The one row shape: transaction, recurring series, exclusion rule, account,
 * budget, settings entry, category. No shadow of its own — Android composites
 * a shadow per view and a list of them is expensive; depth comes from the card
 * around the rows.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  divider = false,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  divider?: boolean;
}) {
  const theme = useTheme();

  const body = (
    <View
      style={[
        styles.row,
        divider
          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }
          : null,
      ]}
    >
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.labels}>
        <Text
          style={[type.body, { color: theme.text }]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={[type.caption, { color: theme.textMuted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </View>
  );

  return onPress ? (
    <Touchable onPress={onPress} accessibilityRole="button">
      {body}
    </Touchable>
  ) : (
    body
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  leading: { width: 24, alignItems: 'center' },
  labels: { flex: 1, gap: 2 },
  trailing: { alignItems: 'flex-end' },
});
```

- [ ] **Step 2: Write StatTile**

Tinted background per tone (`incomeSoft` / `expenseSoft` / `surfaceAlt`), `radius.lg`, `spacing.md` padding, label in `caption` `textMuted`, children (an `Amount`) below. `flex: 1` so three sit in a row.

- [ ] **Step 3: Write SegmentedControl**

Trough in `surfaceAlt` at `radius.pill`, 3px padding. The selected segment is an absolutely-positioned `Animated.View` on `theme.surface` with `useElevation(1)`, its `left` animated with `withSpring(…, motion.spring)` as the selection changes; segment width is `1 / options.length` of the measured trough. Labels in `type.label`, selected `theme.text`, unselected `theme.textMuted`. `accessibilityRole="tablist"` on the trough, `"tab"` with `accessibilityState={{ selected }}` on each segment. Generic over the option value type so callers keep their unions (`'month' | 'year'`, `'projected' | 'booked'`).

- [ ] **Step 4: Write SectionHeader**

`caption` role, `textTransform: 'uppercase'`, `theme.textMuted`, `spacing.sm` bottom margin, optional right-aligned action node.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/components/ui
git commit -m "feat(ui): row, stat tile, segmented control and section header"
```

---

### Task 7: Amount, BudgetBar and CategoryBreakdown on the new tokens

**Files:**

- Modify: `apps/mobile/src/components/Amount.tsx`, `apps/mobile/src/components/BudgetBar.tsx`, `apps/mobile/src/components/CategoryBreakdown.tsx`

**Interfaces:**

- Produces: `<Amount value tone? size? style? />` where `size?: TypeRole` defaults to `'body'`. The `style` prop stays, for colour-neutral overrides, but no caller passes a `fontSize` through it any more.

- [ ] **Step 1: Give Amount a size role**

```tsx
// apps/mobile/src/components/Amount.tsx
import { Text, type TextStyle } from 'react-native';
import { formatMoney, type Money } from '@finant/core';
import { intlLocale } from '../i18n';
import { MAX_FONT_SCALE, typeMoney, useTheme, type TypeRole } from '../design';

/**
 * Renders a signed amount. `tone` decides the colour independently of the sign,
 * because an expense total is displayed as a positive magnitude but must still
 * read as money going out.
 *
 * `size` names a role in the type scale instead of letting each caller pass a
 * raw fontSize, which is how the app ended up with amounts at 30, 17, 14 and
 * 13 with no rule behind any of them.
 */
export function Amount({
  value,
  tone = 'auto',
  size = 'body',
  style,
}: {
  value: Money;
  tone?: 'auto' | 'income' | 'expense' | 'neutral';
  size?: TypeRole;
  style?: TextStyle;
}) {
  const theme = useTheme();
  const resolved =
    tone === 'auto' ? (value.minor > 0 ? 'income' : value.minor < 0 ? 'expense' : 'neutral') : tone;
  const color =
    resolved === 'income' ? theme.income : resolved === 'expense' ? theme.expense : theme.text;

  return (
    <Text style={[typeMoney[size], { color }, style]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      {formatMoney(value, intlLocale())}
    </Text>
  );
}
```

- [ ] **Step 2: Update every Amount call site to pass `size`**

Run: `grep -rn "<Amount" apps/mobile --include=*.tsx`

Replace each `style={styles.total}` / `styles.figureValue` / `styles.value` with the matching `size`: the dashboard hero total becomes `size="display"`, stat-tile figures `size="title"`, list-row and breakdown amounts `size="body"`, captions `size="label"`. Delete the now-unused style entries.

- [ ] **Step 3: Thicken BudgetBar and add the overflow segment**

Track height 8 → 10, `radius.pill`, track `surfaceSunken`. When `state === 'over'`, the bar fills completely in `theme.expense` and a 3px darker overflow cap draws at the right edge. The bar stays a limit bar, not a share bar, and its colour still comes from the domain's `BudgetState` so bar and caption cannot disagree.

- [ ] **Step 4: Restyle CategoryBreakdown**

Track `surfaceSunken`, height 6 → 8, fully rounded. Fill uses the category's own `color` when set, else a `categoryRamp` entry chosen by a stable hash of the category id (so a colourless category keeps the same colour between renders). Label in `type.body`, value via `<Amount size="label" />`.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add apps/mobile/src/components
git commit -m "feat(ui): amounts, budget bars and category bars on the type scale"
```

---

### Task 8: Charts — gradient, halo and draw-in

**Files:**

- Modify: `apps/mobile/src/components/BalanceChart.tsx`, `apps/mobile/src/components/ForecastChart.tsx`

- [ ] **Step 1: Give BalanceChart a gradient fill under the booked line**

Add `Defs` + `LinearGradient` from `react-native-svg`, `theme.accent` at 0.18 opacity fading to 0 at the bottom, filling a closed path that follows the booked line down to the zero baseline. The **projected tail gets no fill** — it stays dashed, unfilled and at 0.6 opacity. A projection drawn in the same ink as recorded fact is a lie by styling, and a filled area reads as more solid than a line, so the fill is the strongest possible version of that mistake.

Preserve exactly: zero always inside the vertical range; `MIN_SLOT` horizontal scrolling; `scrollToEnd` on content-size change so the newest end is what opens; the index-aligned `labels` contract where `''` means unlabelled.

- [ ] **Step 2: Animate the line once on mount**

Wrap the `Path` in Reanimated with an animated `strokeDashoffset` running from the path length to 0 over `motion.settle`. Guard on `motion.enabled` — when reduce-motion is on, render the final state directly with no animation. Do not re-run the animation on data change; a chart that redraws itself on every re-render is noise.

- [ ] **Step 3: Fix the ForecastChart net line**

The net line changes from `theme.accent` to `theme.accentInk`, and gains a halo: draw the same path twice, first at `strokeWidth={4}` in `theme.background`, then at `strokeWidth={2}` in `theme.accentInk`. Without the halo the line vanishes where it crosses a bar of similar lightness.

Bars keep `theme.income` / `theme.expense` and keep the `0.45` opacity on projected months. Bar `rx` 2 → 4.

- [ ] **Step 4: Animate the bars once on mount**

Bars grow from the axis over `motion.settle`, staggered by 15ms per month index. Same reduce-motion guard.

- [ ] **Step 5: Typecheck, bundle, commit**

```bash
npm run typecheck
cd apps/mobile && npx expo export --platform ios && cd ../..
git add apps/mobile/src/components
git commit -m "feat(ui): chart gradient, net-line halo and a single draw-in"
```

---

### Task 9: Dashboard — the approval checkpoint

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx`

**Interfaces:**

- Consumes: every primitive from Tasks 3–8.

- [ ] **Step 1: Replace the first card with a chrome-free hero**

The balance moves out of a `Card` and onto the tinted background: screen title in `type.title`, `<Amount value={netWorth.current} tone="neutral" size="display" />`, the as-of line in `caption`, then `BalanceChart` full-bleed (negative horizontal margin equal to the screen padding, so it reaches both edges).

- [ ] **Step 2: Swap the granularity chips for a SegmentedControl**

```tsx
<SegmentedControl
  options={[
    { value: 'month' as const, label: t('dashboard.byMonth') },
    { value: 'year' as const, label: t('dashboard.byYear') },
  ]}
  value={granularity}
  onChange={setGranularity}
/>
```

Keep the existing rule that this control outlives the chart: it renders whenever `transactions.length > 0`, even when a single year collapses the chart to one point, because hiding it with the chart left no way back to months.

- [ ] **Step 3: Keep both balance-state branches**

The `netWorth.accountsCounted === 0` branch (prompt to set balances) and the `accountsSkipped > 0` warning both stay, restyled: the warning becomes a tappable strip on `warningSoft` with `radius.md`, still routing to `/banks`. Copy unchanged.

- [ ] **Step 4: Turn the period figures into StatTiles**

The local `Figure` component is deleted. Income / expenses / net become three `StatTile`s in a row with tones `income` / `expense` / `neutral`, each holding `<Amount size="title" />`. Savings rate and the pay-period hint stay as captions beneath.

- [ ] **Step 5: Replace the year card's tap-toggle with a SegmentedControl**

The whole-card `Pressable` and the bottom hint line (`dashboard.showBooked` / `dashboard.showProjection`) are removed; a `SegmentedControl` with forecast/booked sits under the card title. Reuse the existing keys `dashboard.yearForecast` and `dashboard.yearBooked` as the segment labels — no new i18n key is needed. The forecast confidence subtitle and `dashboard.bookedMonths` caption stay exactly as they are: a projection must keep announcing what it was built from.

Cross-fade the two views over `motion.quick`.

- [ ] **Step 6: Recurring series become ListRows**

`<ListRow title={series.label} trailing={<Amount value={money(series.typicalAmount.minor, CURRENCY)} />} divider />`, still capped at six.

- [ ] **Step 7: Keep both empty states**

The "no transactions and no balances" early return and the "balances but no movements" branch both stay, with their existing copy. Restyle with a centred Feather icon in `textMuted` above the message. The comment explaining why the background colour goes on the `ScrollView` rather than its content container still applies — keep it and keep the behaviour.

- [ ] **Step 8: Typecheck and bundle**

Run: `npm run typecheck && cd apps/mobile && npx expo export --platform ios`
Expected: both clean.

- [ ] **Step 9: Screenshot both themes on the simulator**

Snapshot the simulator database first — its data is the only copy and the key dies with it. Launch, capture the dashboard in light and in dark, and capture it once with reduce-motion enabled to confirm nothing animates. Screenshots stay in the scratchpad; none is committed.

- [ ] **Step 10: STOP — owner approves the look**

This is the checkpoint the whole plan is built around. The palette, the elevation and the motion have been judged on paper until now. Present the screenshots and wait. If the accent is wrong, or the shadows are too heavy, or the hero is too large, it gets fixed here — once — before eight more screens adopt it.

- [ ] **Step 11: Commit**

```bash
git add apps/mobile/app/\(tabs\)/index.tsx
git commit -m "feat(dashboard): chrome-free hero, stat tiles and a discoverable year toggle"
```

---

### Task 10: Transactions

**Files:**

- Modify: `apps/mobile/app/(tabs)/transactions.tsx`

- [ ] **Step 1: Rebuild the search row**

Rounded `surfaceSunken` container at `radius.pill`, leading Feather `search` icon in `textMuted`, `TextInput` in `type.body`, trailing Feather `x` in a `Touchable` when the query is non-empty.

- [ ] **Step 2: Turn the filter toggle into a badged chip**

A `Touchable` chip showing Feather `sliders` plus, when `activeCount > 0`, a small `accent`-filled pill with the count in `caption` `onAccent`.

- [ ] **Step 3: Move the filter panel into a Sheet**

The inline expanding `View` (the `styles.panel` block) moves wholesale into `<Sheet visible={filtersOpen} onDismiss={…} title={…}>`. Every filter, the min/max pairs, the date pairs, the category chips and `clearAll` keep their current state and behaviour; only the container changes. Inputs become `Field`.

- [ ] **Step 4: Rows become ListRow**

Leading: an 8px dot in the category's colour (or its `categoryRamp` fallback). Title: counterparty. Subtitle: description. Trailing: `<Amount size="body" />`. Keep `numberOfLines={1}` on both text lines.

- [ ] **Step 5: Date headers become sticky SectionHeaders**

`SectionList`/`FlatList` sticky header props stay as they are; the header content becomes `<SectionHeader label={…} />` on a `background`-coloured strip so rows scroll under it cleanly.

- [ ] **Step 6: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/\(tabs\)/transactions.tsx
git commit -m "feat(transactions): search field, badged filter chip and a filter sheet"
```

---

### Task 11: Banks

**Files:**

- Modify: `apps/mobile/app/(tabs)/banks.tsx`

- [ ] **Step 1: One Card per institution**

Institution name in `type.heading` as the card title, tapping the title still opens the bank edit sheet.

- [ ] **Step 2: Accounts become ListRows**

Title: account name. Subtitle: the as-of date, or `banks.noBalance` when there is none. Trailing: `<Amount size="body" />`. `divider` on all but the last. "View movements" becomes the row's `onPress`.

- [ ] **Step 3: Buttons**

"Add account" → `<Button variant="secondary" icon="plus" />`. "Add bank" → `<Button variant="primary" icon="plus" />`. Delete the `addButton` / `addButtonText` styles.

- [ ] **Step 4: Unassigned card keeps its chip flow**, restyled by the new `Chip`.

- [ ] **Step 5: Confirm nothing is auto-created**

Re-read the create paths in this screen: the owner names every bank and every account, and a container carries a name only. This task must not introduce a default name or an implicit create.

- [ ] **Step 6: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/\(tabs\)/banks.tsx
git commit -m "feat(banks): institution cards with account rows"
```

---

### Task 12: Budgets

**Files:**

- Modify: `apps/mobile/app/(tabs)/budgets.tsx`

- [ ] **Step 1: Each budget becomes a pressable Card**

`<Card onPress={() => openExisting(entry)} padded={false}>` with padded content and the `BudgetBar` flush to the bottom edge, full card width, its bottom corners inheriting `radius.xl`.

- [ ] **Step 2: Replace the hand-built modal with Sheet**

The `Modal` + `sheetBackdrop` + `sheet` styles are deleted. The category chooser, the limit `Field` and the save/delete actions move into `<Sheet>`.

- [ ] **Step 3: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/\(tabs\)/budgets.tsx
git commit -m "feat(budgets): edge-to-edge limit bars and a shared sheet"
```

---

### Task 13: Settings

**Files:**

- Modify: `apps/mobile/app/(tabs)/settings.tsx`

- [ ] **Step 1: Language becomes a SegmentedControl** over the existing locale codes.
- [ ] **Step 2: Every action row becomes a ListRow** with a trailing chevron (`Feather` `chevron-right`) — categories, reapply rules, data location.
- [ ] **Step 3: Exclusion rules become ListRows** with a trailing `danger` icon button; the confirm dialog is unchanged.
- [ ] **Step 4: Erase all becomes `<Button variant="danger" />`.** The confirmation flow is unchanged — this is the one destructive action in the app and its guard must survive the restyle intact.
- [ ] **Step 5: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/\(tabs\)/settings.tsx
git commit -m "feat(settings): grouped rows and a language segmented control"
```

---

### Task 14: Import

**Files:**

- Modify: `apps/mobile/app/import.tsx`

- [ ] **Step 1: The file picker becomes a drop zone**

A tall `Touchable` with a 2px dashed `border` outline at `radius.lg`, a centred Feather `upload-cloud` at 32px in `accent`, the `import.pickFile` label in `heading`, and `import.supportedFormats` in `caption` beneath. Copy unchanged.

- [ ] **Step 2: Result counts become StatTiles**; issues become `ListRow`s in `caption`.

Issue text renders exactly what the parser produced. Do not enrich it with row content — parsers report unreadable rows as issues and keep going, and nothing about a movement is logged or displayed beyond what the existing copy shows.

- [ ] **Step 3: Confirm becomes a pinned primary Button** at the bottom of the scroll.

- [ ] **Step 4: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/import.tsx
git commit -m "feat(import): a drop zone, stat tiles and a pinned confirm"
```

---

### Task 15: Categories

**Files:**

- Modify: `apps/mobile/app/categories.tsx`

- [ ] **Step 1: A Card per kind, categories as ListRows** with an 8px colour dot leading and a chevron trailing.
- [ ] **Step 2: The swatch picker offers `categoryRamp`.** Existing `color` values are not migrated — a category already holding a colour keeps it, and the picker simply shows the new options.
- [ ] **Step 3: The hand-built modal moves to `Sheet`;** the name input becomes `Field`.
- [ ] **Step 4: Category ids stay permanent.** Only labels and colours are editable here, as today.
- [ ] **Step 5: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/categories.tsx
git commit -m "feat(categories): category rows and the pastel swatch ramp"
```

---

### Task 16: Transaction detail

**Files:**

- Modify: `apps/mobile/app/transaction/[id].tsx`

- [ ] **Step 1: Headline block** — `<Amount size="display" />` at the top, counterparty in `title`, description in `body` `textMuted`.
- [ ] **Step 2: Meta becomes Chips** — date, account, kind. The transfer-peer link keeps its behaviour, restyled as a `secondary` `Button`.
- [ ] **Step 3: Switch rows become ListRows** with a trailing `Switch` tinted `accent`. The local `SwitchRow` helper is deleted.
- [ ] **Step 4: Category chooser** keeps its chip grid on the new `CategoryChip`.
- [ ] **Step 5: Delete becomes `<Button variant="danger" />`** with its existing confirmation.
- [ ] **Step 6: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/transaction/\[id\].tsx
git commit -m "feat(transaction): headline amount and row-based toggles"
```

---

### Task 17: Manual movement

**Files:**

- Modify: `apps/mobile/app/movement/new.tsx`

- [ ] **Step 1: Every input becomes a `Field`,** including the date field, which keeps its `manual.dateInvalid` warning — now passed as `Field`'s `error` prop.
- [ ] **Step 2: Expense/income becomes a SegmentedControl.** The reversal `Switch` becomes a `ListRow` with a trailing `Switch`.

The side-plus-sign semantics are unchanged: a refund is a positive amount on the expense side, and the form must keep producing exactly the `side` and sign it produces today. This is a restyle of the controls, not a change to what they mean.

- [ ] **Step 3: Save becomes a pinned primary Button** with `loading` while the write is in flight.
- [ ] **Step 4: Typecheck, screenshot both themes, commit**

```bash
npm run typecheck
git add apps/mobile/app/movement/new.tsx
git commit -m "feat(manual): fields, a side segmented control and a pinned save"
```

---

### Task 18: Chrome — tab bar and headers

**Files:**

- Modify: `apps/mobile/app/(tabs)/_layout.tsx`, `apps/mobile/app/_layout.tsx`

- [ ] **Step 1: Transparent tab-screen headers**

`headerShown: false` on the tabs navigator; each tab screen already renders (or gains, in this task) its own `type.title` heading at the top of its scroll body. The `headerRight` "add manual movement" link on the transactions tab moves into that screen's own title row as a `Touchable` with the same `accessibilityLabel` (`transactions.addManual`) and the same `/movement/new` route.

- [ ] **Step 2: Restyle the tab bar**

`tabBarStyle` on `theme.surface` with `useElevation(2)`, no top border, height plus the safe-area bottom inset. `tabBarIcon` wraps the Feather glyph in a `pill`-radius view filled with `accentSoft` when focused, transparent otherwise. `tabBarActiveTintColor: theme.accent`, `tabBarInactiveTintColor: theme.textMuted`, label in `type.caption`. All five tabs and all five icons stay.

- [ ] **Step 3: Modal screens keep their navigator headers**

`import`, `transaction/[id]` and `movement/new` keep `headerShown: true` — they need the explicit dismiss affordance. Keep the `headerBackTitle: t('common.back')` workaround and its comment: without it the iOS back button reads `(tabs)`, because the label comes from the previous route's title and that route is a router group.

- [ ] **Step 4: Restyle the startup and error states** in `app/_layout.tsx` on the new type roles. The startup order comment stays — the encrypted database must be open before i18n, which reads the stored language from it.

- [ ] **Step 5: Typecheck, bundle, screenshot every tab in both themes, commit**

```bash
npm run typecheck
cd apps/mobile && npx expo export --platform ios && cd ../..
git add apps/mobile/app/_layout.tsx apps/mobile/app/\(tabs\)/_layout.tsx
git commit -m "feat(chrome): scrolling titles and a pill-marked tab bar"
```

---

### Task 19: Cleanup and full verification

**Files:**

- Delete: `apps/mobile/src/theme.ts`
- Modify: any file still importing from it

- [ ] **Step 1: Confirm nothing imports the shim**

Run: `grep -rn "from '.*theme'" apps/mobile --include=*.tsx --include=*.ts`
Expected: no hits outside `src/design/`. Repoint any stragglers at `../design`, then delete `src/theme.ts`.

- [ ] **Step 2: Confirm no fontSize literal survives**

Run: `grep -rn "fontSize" apps/mobile/src apps/mobile/app --include=*.tsx | grep -v "src/design"`
Expected: only the `react-native-svg` `Text` props in the two chart components, which cannot take a style role object and must read their number off `type.caption.fontSize` instead of writing `9`. Fix any others.

- [ ] **Step 3: Confirm the dead styles are gone**

Run: `grep -rn "addButton\|sheetBackdrop\|buttonText" apps/mobile/app apps/mobile/src`
Expected: no hits.

- [ ] **Step 4: Full test and typecheck**

Run: `npm test && npm run typecheck`
Expected: both green, palette contrast test included.

- [ ] **Step 5: Scoped lint**

```bash
git diff --name-only main...HEAD | grep -E '\.(ts|tsx)$' | xargs npx eslint --fix
git diff --name-only main...HEAD | grep -E '\.(ts|tsx|json|md)$' | xargs npx prettier --write
```

Scoped deliberately: `npm run lint:fix` reformats the whole repo and the diff drowns in churn. Note zsh does not word-split a variable, hence `xargs`.

- [ ] **Step 6: Bundle**

Run: `cd apps/mobile && npx expo export --platform ios`
Expected: clean.

- [ ] **Step 7: Accessibility sweep on the simulator**

- Reduce motion on: nothing animates anywhere, including the charts and the segmented controls.
- Largest OS text size: no row clips, no amount truncates, the hero total wraps rather than overflowing.
- Both themes: every screen.

- [ ] **Step 8: Commit and finish the branch**

```bash
git add -A
git commit -m "chore(design): delete the theme shim and the styles it kept alive"
```

Then follow the repo's flow: `git checkout main && git merge --no-ff visual-redesign -m "merge: <subject>"`, keeping the branch. The owner runs `git push`.

---

## Self-Review

**Spec coverage.** Token layer → Tasks 1–2. Primitives → Tasks 3–7. Charts → Task 8. Nine screens → Tasks 9–17 (dashboard, transactions, banks, budgets, settings, import, categories, transaction detail, manual movement). Chrome → Task 18. Cleanup and the spec's verification list → Task 19. The spec's category-ramp rule is carried in Task 1 (`categoryRamp`), applied in Task 7 (fallback colour) and Task 15 (picker). The accent/income collision mitigation is Task 1 (`accentInk` plus its asserted lightness gap) and Task 8 Step 3 (the halo). The two deliberate behaviour changes are Task 9 Step 5 (year toggle) and Task 10 Step 3 (filter sheet).

**Placeholders.** None. The two places that describe rather than show — `Sheet`'s panel mechanics (Task 5) and `SegmentedControl`'s slider (Task 6) — carry exact tokens, exact props and an explicit fallback for the missing gesture dependency.

**Type consistency.** `Palette` keys are fixed in Task 1 and every later reference (`accentInk`, `onAccent`, `surfaceSunken`) is in that list. `TypeRole` is defined in Task 2 and consumed by `Amount`'s `size` prop in Task 7. `useElevation(level)` takes the same `0 | 1 | 2 | 3` in Tasks 3, 5, 6 and 18. `useMotion()`'s fields (`instant`, `quick`, `settle`, `pressScale`, `spring`, `enabled`) are used exactly as defined in Tasks 3, 5, 6, 8 and 9.

**One risk the plan cannot remove.** `Sheet`'s drag-to-dismiss would be cleanest on `react-native-gesture-handler`. It resolves at 3.2.1 as a transitive dependency, but it is not declared in `apps/mobile/package.json`, and depending on a package you did not declare is how a working tree becomes a broken one at the next install. Task 5 uses `PanResponder` instead and allows dropping the drag entirely; dismissal never depends on it.
