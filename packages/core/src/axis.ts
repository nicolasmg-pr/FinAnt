/**
 * Vertical-axis ticks for the charts. A reader estimates a bar's value by
 * comparing it against a round number, so the gridlines have to land on round
 * numbers — 0, 5.000, 10.000 — rather than on the data's own extremes divided
 * into equal parts.
 */

/** The nearest 1 / 2 / 5 × 10ⁿ at or above `raw`, and never below one minor unit. */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const factor = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return Math.max(1, magnitude * factor);
}

/**
 * Round tick values in minor units, covering `[minMinor, maxMinor]` and never
 * leaving it. Zero always falls on a tick when the range spans it, because
 * every tick is a multiple of the step — which is the one gridline that always
 * earns its place on a chart of money.
 *
 * `target` is a wish, not a promise: rounding the step to something readable
 * can return one tick fewer or more.
 */
export function niceTicks(minMinor: number, maxMinor: number, target = 4): number[] {
  if (!Number.isFinite(minMinor) || !Number.isFinite(maxMinor)) return [];
  if (maxMinor <= minMinor) return [Math.round(minMinor)];

  const step = niceStep((maxMinor - minMinor) / Math.max(1, target));
  const first = Math.ceil(minMinor / step) * step;

  const ticks: number[] = [];
  for (let value = first; value <= maxMinor; value += step) {
    // `|| 0` collapses negative zero, which Math.ceil produces for any small
    // negative minimum and which Intl renders as "-0" on the axis.
    ticks.push(Math.round(value) || 0);
  }
  return ticks;
}
