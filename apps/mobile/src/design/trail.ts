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
