/** Median is the default central estimate everywhere in this app: one holiday
 * month must not drag a whole year's forecast with it. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Coefficient of variation on magnitudes; used to grade forecast confidence. */
export function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const m = mean(values);
  if (m === 0) return Number.POSITIVE_INFINITY;
  const variance = mean(values.map((v) => (v - m) ** 2));
  return Math.sqrt(variance) / Math.abs(m);
}
