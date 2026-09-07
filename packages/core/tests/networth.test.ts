import { describe, expect, it } from 'vitest';
import { money } from '../src/money';
import { netWorthSeries, type NetWorthAccount } from '../src/networth';
import { tx } from './factory';

const EUR = 'EUR';
/** Every test treats this as today, and anchors every account on it. */
const TODAY = '2026-09-07';

function mv(date: string, amount: number, accountId = 'acc-1') {
  return tx({ date, amount, description: 'MOVEMENT', accountId });
}

/**
 * An account the owner has anchored: `assertedMinor` is what it holds on
 * TODAY, so a movement dated on or before TODAY is already inside that figure
 * and an earlier point is reached by running the ledger backwards.
 */
function anchored(
  accountId: string,
  assertedMinor: number | null,
  movements: ReturnType<typeof mv>[],
  currency = EUR,
): NetWorthAccount {
  return {
    accountId,
    anchor: assertedMinor === null ? null : { assertedMinor, asOf: TODAY, currency },
    currency,
    movements,
  };
}

const options = { today: TODAY, granularity: 'month' as const, currency: EUR };

describe('netWorthSeries', () => {
  it('has no points and a zero total when nothing is anchored', () => {
    const series = netWorthSeries([], options);
    expect(series.points).toEqual([]);
    expect(series.current).toEqual(money(0, EUR));
    expect(series.accountsCounted).toBe(0);
    expect(series.accountsSkipped).toBe(0);
  });

  it('states the total as the sum of what the owner asserted', () => {
    // The movements are history behind the assertions, so they cannot move it.
    const series = netWorthSeries(
      [
        anchored('acc-1', 1_000_00, [mv('2026-09-01', -100)]),
        anchored('acc-2', 500_00, [mv('2026-09-02', 250, 'acc-2')]),
      ],
      options,
    );
    expect(series.current).toEqual(money(1_500_00, EUR));
    expect(series.accountsCounted).toBe(2);
  });

  it('runs one point per month from the first movement to the current month', () => {
    const series = netWorthSeries([anchored('acc-1', 0, [mv('2026-06-15', 100)])], options);
    expect(series.points.map((point) => point.period)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('walks each month back from the assertion', () => {
    const series = netWorthSeries(
      [anchored('acc-1', 1_000_00, [mv('2026-07-10', 50), mv('2026-08-10', -20)])],
      options,
    );
    // Holds 1000 today. The 20 that left in August was still there on 31 July,
    // so July closed on 1020; nothing moved after 31 August.
    expect(series.points.map((point) => point.total.minor)).toEqual([102_000, 100_000, 100_000]);
  });

  it('closes the current month on today, so a later date this month is not money in hand', () => {
    const series = netWorthSeries(
      [anchored('acc-1', 100_00, [mv('2026-09-01', 10), mv('2026-09-30', 1_000)])],
      options,
    );
    const last = series.points.at(-1);
    expect(last?.period).toBe('2026-09');
    expect(last?.total).toEqual(money(100_00, EUR));
    expect(last?.kind).toBe('actual');
  });

  it('collapses to one point per year when asked for years', () => {
    const series = netWorthSeries(
      [anchored('acc-1', 1_000_00, [mv('2025-03-01', 1_000), mv('2026-02-01', 500)])],
      { ...options, granularity: 'year' },
    );
    // 500 arrived in February 2026, so 2025 closed 500 lighter than today.
    expect(series.points.map((point) => point.period)).toEqual(['2025', '2026']);
    expect(series.points.map((point) => point.total.minor)).toEqual([50_000, 100_000]);
  });

  it('skips an account with no anchor rather than treating it as empty', () => {
    const series = netWorthSeries(
      [
        anchored('acc-1', 100_00, [mv('2026-09-01', -10)]),
        // Movements, but the owner never said what it holds: counting it from
        // zero would understate the total by whatever it opened with.
        anchored('acc-2', null, [mv('2026-09-01', -400, 'acc-2')]),
      ],
      options,
    );
    expect(series.accountsCounted).toBe(1);
    expect(series.accountsSkipped).toBe(1);
    expect(series.current).toEqual(money(100_00, EUR));
  });

  it('skips an account held in another currency instead of summing it', () => {
    const series = netWorthSeries(
      [anchored('acc-1', 100_00, [mv('2026-09-01', -10)]), anchored('acc-2', 900_00, [], 'CHF')],
      options,
    );
    expect(series.accountsCounted).toBe(1);
    expect(series.accountsSkipped).toBe(1);
    expect(series.current).toEqual(money(100_00, EUR));
  });

  it('counts excluded rows and internal transfers: they moved real money', () => {
    const rows = [
      // An ordinary movement, only so the axis reaches back past September.
      mv('2026-07-15', 100),
      tx({
        date: '2026-09-01',
        amount: -50,
        description: 'MOVEMENT',
        excludedFromStats: true,
      }),
      tx({
        date: '2026-09-02',
        amount: -200,
        description: 'MOVEMENT',
        categoryId: 'transfer-internal',
        categorySource: 'auto',
      }),
    ];
    const series = netWorthSeries([anchored('acc-1', 1_000_00, rows)], options);
    // Both left the account in September, so July and August closed 250 higher
    // even though neither row is allowed near a statistic.
    expect(series.points.map((point) => point.total.minor)).toEqual([125_000, 125_000, 100_000]);
  });

  it('extends the line with the projected months it is handed', () => {
    const series = netWorthSeries([anchored('acc-1', 1_000_00, [mv('2026-09-01', -100)])], {
      ...options,
      projected: [
        { period: '2026-10', netMinor: 20_000 },
        { period: '2026-11', netMinor: -5_000 },
      ],
    });
    expect(series.points.map((point) => [point.period, point.kind, point.total.minor])).toEqual([
      ['2026-09', 'actual', 100_000],
      ['2026-10', 'projected', 120_000],
      ['2026-11', 'projected', 115_000],
    ]);
  });

  it('folds a projected tail into the year it belongs to', () => {
    const series = netWorthSeries([anchored('acc-1', 1_000_00, [mv('2026-09-01', -100)])], {
      ...options,
      granularity: 'year',
      projected: [
        { period: '2026-10', netMinor: 20_000 },
        { period: '2026-11', netMinor: 10_000 },
      ],
    });
    // One point for 2026, carrying the projected end of the year and saying so.
    expect(series.points).toEqual([
      { period: '2026', kind: 'projected', total: money(130_000, EUR) },
    ]);
  });

  it('leaves a skipped account out of the months as well as the axis', () => {
    const series = netWorthSeries(
      [
        anchored('acc-1', 100_00, [mv('2026-08-01', -10)]),
        anchored('acc-2', null, [mv('2026-02-01', 9_999, 'acc-2')]),
      ],
      options,
    );
    // February belongs to the skipped account alone, so it opens no month the
    // chart cannot state a total for.
    expect(series.points.map((point) => [point.period, point.total.minor])).toEqual([
      ['2026-08', 100_00],
      ['2026-09', 100_00],
    ]);
  });
});
