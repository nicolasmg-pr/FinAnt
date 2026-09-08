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
 * `grain` is the one role added after that pass. It means value accumulated
 * over time and nothing else — not income, which is money that arrived, and
 * not warning, which is a brown of a similar family and is never placed beside
 * it. If a screen is ever found comparing the two, `warning` moves toward red;
 * `grain` does not move, because its meaning depends on being warm.
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
  grain: '#875C06',
  grainSoft: '#F6E7C6',
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
  grain: '#D9A441',
  grainSoft: '#33280F',
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

/**
 * A stable colour for a category that has none: the same id always lands on
 * the same ramp entry, so a colourless category does not change colour
 * between renders or between screens.
 */
export function rampColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return categoryRamp[Math.abs(hash) % categoryRamp.length] ?? categoryRamp[0];
}
