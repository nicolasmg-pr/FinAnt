import { describe, expect, it } from 'vitest';
import { combineNetWorth } from '../src/networth';
import { money } from '../src/money';
import type { NetWorthPoint } from '../src/networth';
import type { ValuePoint } from '../src/investments';

const cash = (
  period: string,
  minor: number,
  kind: NetWorthPoint['kind'] = 'actual',
): NetWorthPoint => ({
  period,
  kind,
  total: money(minor, 'EUR'),
});

const held = (period: string, minor: number): ValuePoint => ({
  period,
  kind: 'actual',
  total: money(minor, 'EUR'),
  invested: money(minor, 'EUR'),
  partial: false,
});

describe('combineNetWorth', () => {
  it('adds the portfolio to the cash held in the same month', () => {
    const out = combineNetWorth(
      [cash('2024-04', 100_000), cash('2024-05', 90_000)],
      [held('2024-04', 5_000), held('2024-05', 12_000)],
      'EUR',
    );
    expect(out.points.map((p) => p.total.minor)).toEqual([105_000, 102_000]);
  });

  it('counts the portfolio as nothing before the first trade', () => {
    const out = combineNetWorth(
      [cash('2024-01', 100_000), cash('2024-04', 90_000)],
      [held('2024-04', 5_000)],
      'EUR',
    );
    expect(out.points[0]!.total.minor).toBe(100_000);
    expect(out.points[1]!.total.minor).toBe(95_000);
  });

  it('drops the projected tail rather than holding the market flat through it', () => {
    const out = combineNetWorth(
      [cash('2024-04', 100_000), cash('2024-05', 90_000, 'projected')],
      [held('2024-04', 5_000)],
      'EUR',
    );
    expect(out.points).toHaveLength(1);
    expect(out.points.every((p) => p.kind === 'actual')).toBe(true);
  });

  it('reports the two halves of today separately as well as their sum', () => {
    const out = combineNetWorth(
      [cash('2024-04', 100_000), cash('2024-05', 90_000)],
      [held('2024-04', 5_000), held('2024-05', 12_000)],
      'EUR',
    );
    expect(out.cashCurrent).toEqual(money(90_000, 'EUR'));
    expect(out.portfolioCurrent).toEqual(money(12_000, 'EUR'));
    expect(out.current).toEqual(money(102_000, 'EUR'));
  });

  it('values a year against the portfolio at that year end', () => {
    const out = combineNetWorth(
      [cash('2024', 100_000), cash('2025', 120_000)],
      [held('2024-06', 5_000), held('2024-12', 8_000), held('2025-11', 20_000)],
      'EUR',
    );
    expect(out.points.map((p) => p.total.minor)).toEqual([108_000, 140_000]);
  });

  it('carries the last close forward into a month the portfolio has no point for', () => {
    const out = combineNetWorth(
      [cash('2024-04', 100_000), cash('2024-05', 100_000), cash('2024-06', 100_000)],
      [held('2024-04', 5_000)],
      'EUR',
    );
    expect(out.points.map((p) => p.total.minor)).toEqual([105_000, 105_000, 105_000]);
  });

  it('is just the cash when nothing was ever invested', () => {
    const out = combineNetWorth([cash('2024-04', 100_000)], [], 'EUR');
    expect(out.points.map((p) => p.total.minor)).toEqual([100_000]);
    expect(out.portfolioCurrent).toEqual(money(0, 'EUR'));
  });

  it('is empty when there is no cash history to hang the line on', () => {
    const out = combineNetWorth([], [held('2024-04', 5_000)], 'EUR');
    expect(out.points).toEqual([]);
    // The holding is still real, and still reported.
    expect(out.portfolioCurrent).toEqual(money(5_000, 'EUR'));
    expect(out.current).toEqual(money(5_000, 'EUR'));
  });
});

describe('combineNetWorth with a known current value', () => {
  it('trusts the caller today rather than the history series', () => {
    // The series knows nothing about one holding — its provider serves no
    // history for it — but the holding is real and priced right now.
    const out = combineNetWorth(
      [cash('2024-04', 100_000), cash('2024-05', 90_000)],
      [held('2024-04', 5_000), held('2024-05', 12_000)],
      'EUR',
      money(20_000, 'EUR'),
    );
    expect(out.portfolioCurrent).toEqual(money(20_000, 'EUR'));
    expect(out.current).toEqual(money(110_000, 'EUR'));
    // The line ends where the headline says it does.
    expect(out.points[1]!.total.minor).toBe(110_000);
    // Earlier months still come from the history.
    expect(out.points[0]!.total.minor).toBe(105_000);
  });

  it('falls back to the series when the caller passes nothing', () => {
    const out = combineNetWorth([cash('2024-04', 100_000)], [held('2024-04', 5_000)], 'EUR');
    expect(out.portfolioCurrent).toEqual(money(5_000, 'EUR'));
  });
});
