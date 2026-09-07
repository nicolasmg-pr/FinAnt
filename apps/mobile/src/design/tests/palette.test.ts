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
