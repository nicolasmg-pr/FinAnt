import { describe, expect, it } from 'vitest';
import { formatAxisAmount, money, niceTicks } from '../src';

describe('niceTicks', () => {
  it('lands on round numbers rather than on the data extremes', () => {
    // A balance of 10.845,90 € reads against 0, 5.000 and 10.000 — not
    // against 10.845,90 divided into four.
    expect(niceTicks(0, 1_084_590)).toEqual([0, 500_000, 1_000_000]);
  });

  it('always includes zero when the range spans it', () => {
    const ticks = niceTicks(-50_000, 150_000);
    expect(ticks).toContain(0);
  });

  it('keeps every tick inside the range', () => {
    for (const [min, max] of [
      [0, 1],
      [-999, 12_345],
      [0, 250],
      [-1_000_000, 1_000_000],
    ] as const) {
      for (const tick of niceTicks(min, max)) {
        expect(tick).toBeGreaterThanOrEqual(min);
        expect(tick).toBeLessThanOrEqual(max);
      }
    }
  });

  it('returns whole minor units, never a fraction of a cent', () => {
    for (const tick of niceTicks(0, 137)) {
      expect(Number.isInteger(tick)).toBe(true);
    }
  });

  it('never produces negative zero', () => {
    // Math.ceil(-0.01) is -0, which survives the multiplication and the round
    // and reaches Intl, which renders it as "-0" on the axis.
    const ticks = niceTicks(-5_000, 2_000_000);
    expect(ticks).toContain(0);
    for (const tick of ticks) expect(Object.is(tick, -0)).toBe(false);
  });

  it('gives a single tick when there is no range to divide', () => {
    expect(niceTicks(500, 500)).toEqual([500]);
    expect(niceTicks(700, 300)).toEqual([700]);
  });

  it('honours the requested tick count without overshooting it badly', () => {
    const ticks = niceTicks(0, 1_000_000, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(6);
  });
});

describe('formatAxisAmount', () => {
  it('shortens a large figure', () => {
    expect(formatAxisAmount(money(1_000_000, 'EUR'), 'en-IE')).toBe('10K');
  });

  it('leaves a small figure alone', () => {
    expect(formatAxisAmount(money(25_000, 'EUR'), 'en-IE')).toBe('250');
  });

  it('carries the sign', () => {
    expect(formatAxisAmount(money(-320_000, 'EUR'), 'en-IE')).toBe('-3.2K');
  });

  it('omits the currency symbol, because an axis repeats every tick', () => {
    expect(formatAxisAmount(money(1_000_000, 'EUR'), 'en-IE')).not.toContain('€');
  });

  it('respects the locale', () => {
    // Spanish separates the compact suffix with a non-breaking space.
    expect(formatAxisAmount(money(1_084_590, 'EUR'), 'es-ES')).toBe('10,8\u00a0mil');
  });
});
