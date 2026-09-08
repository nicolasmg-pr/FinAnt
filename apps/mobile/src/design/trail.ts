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
