import { describe, expect, it } from 'vitest';
import { money } from '../src/money';
import { netWorthSeries, type NetWorthAccount } from '../src/networth';
import { tx } from './factory';

const EUR = 'EUR';

function mv(date: string, amount: number, accountId = 'acc-1') {
  return tx({ date, amount, description: 'MOVEMENT', accountId });
}

/** An account the owner has anchored: opening balance plus its own movements. */
function anchored(
  accountId: string,
  openingMinor: number | null,
  movements: ReturnType<typeof mv>[],
  currency = EUR,
): NetWorthAccount {
  return { accountId, openingMinor, currency, movements };
}

describe('netWorthSeries', () => {
  it('has no points and a zero total when nothing is anchored', () => {
    const series = netWorthSeries([], { today: '2026-09-07', granularity: 'month', currency: EUR });
    expect(series.points).toEqual([]);
    expect(series.current).toEqual(money(0, EUR));
    expect(series.accountsCounted).toBe(0);
    expect(series.accountsSkipped).toBe(0);
  });

  it('states the total held today across every anchored account', () => {
    const series = netWorthSeries(
      [
        anchored('acc-1', 1_000_00, [mv('2026-09-01', -100)]),
        anchored('acc-2', 500_00, [mv('2026-09-02', 250, 'acc-2')]),
      ],
      { today: '2026-09-07', granularity: 'month', currency: EUR },
    );
    expect(series.current).toEqual(money(1_650_00, EUR));
    expect(series.accountsCounted).toBe(2);
  });

  it('runs one point per month from the first movement to the current month', () => {
    const series = netWorthSeries([anchored('acc-1', 0, [mv('2026-06-15', 100)])], {
      today: '2026-09-07',
      granularity: 'month',
      currency: EUR,
    });
    expect(series.points.map((point) => point.period)).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('reports each month at its own month end, not at the year end', () => {
    const series = netWorthSeries(
      [anchored('acc-1', 100_00, [mv('2026-07-10', 50), mv('2026-08-10', -20)])],
      { today: '2026-09-07', granularity: 'month', currency: EUR },
    );
    expect(series.points.map((point) => point.total.minor)).toEqual([150_00, 130_00, 130_00]);
  });

  it('closes the current month on today, not on a month end that has not happened', () => {
    // The 30 September movement is real but not yet booked history on 7 September.
    const series = netWorthSeries(
      [anchored('acc-1', 100_00, [mv('2026-09-01', 10), mv('2026-09-30', 1_000)])],
      { today: '2026-09-07', granularity: 'month', currency: EUR },
    );
    const last = series.points.at(-1);
    expect(last?.period).toBe('2026-09');
    expect(last?.total).toEqual(money(110_00, EUR));
    expect(last?.kind).toBe('actual');
  });

  it('collapses to one point per year when asked for years', () => {
    const series = netWorthSeries(
      [anchored('acc-1', 0, [mv('2025-03-01', 1_000), mv('2026-02-01', 500)])],
      { today: '2026-09-07', granularity: 'year', currency: EUR },
    );
    expect(series.points.map((point) => point.period)).toEqual(['2025', '2026']);
    expect(series.points.map((point) => point.total.minor)).toEqual([100_000, 150_000]);
  });

  it('skips an account with no anchor rather than treating it as empty', () => {
    const series = netWorthSeries(
      [
        anchored('acc-1', 100_00, [mv('2026-09-01', -10)]),
        // Movements, but the owner never said what it holds: counting it from
        // zero would understate the total by whatever it opened with.
        anchored('acc-2', null, [mv('2026-09-01', -400, 'acc-2')]),
      ],
      { today: '2026-09-07', granularity: 'month', currency: EUR },
    );
    expect(series.accountsCounted).toBe(1);
    expect(series.accountsSkipped).toBe(1);
    expect(series.current).toEqual(money(90_00, EUR));
  });

  it('skips an account held in another currency instead of summing it', () => {
    const series = netWorthSeries(
      [anchored('acc-1', 100_00, [mv('2026-09-01', -10)]), anchored('acc-2', 900_00, [], 'CHF')],
      { today: '2026-09-07', granularity: 'month', currency: EUR },
    );
    expect(series.accountsCounted).toBe(1);
    expect(series.accountsSkipped).toBe(1);
    expect(series.current).toEqual(money(90_00, EUR));
  });

  it('counts excluded rows and internal transfers: they moved real money', () => {
    const rows = [
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
    const series = netWorthSeries([anchored('acc-1', 1_000_00, rows)], {
      today: '2026-09-07',
      granularity: 'month',
      currency: EUR,
    });
    expect(series.current).toEqual(money(750_00, EUR));
  });

  it('extends the line with the projected months it is handed', () => {
    const series = netWorthSeries([anchored('acc-1', 1_000_00, [mv('2026-09-01', -100)])], {
      today: '2026-09-07',
      granularity: 'month',
      currency: EUR,
      projected: [
        { period: '2026-10', netMinor: 20_000 },
        { period: '2026-11', netMinor: -5_000 },
      ],
    });
    expect(series.points.map((point) => [point.period, point.kind, point.total.minor])).toEqual([
      ['2026-09', 'actual', 90_000],
      ['2026-10', 'projected', 110_000],
      ['2026-11', 'projected', 105_000],
    ]);
  });

  it('folds a projected tail into the year it belongs to', () => {
    const series = netWorthSeries([anchored('acc-1', 1_000_00, [mv('2026-09-01', -100)])], {
      today: '2026-09-07',
      granularity: 'year',
      currency: EUR,
      projected: [
        { period: '2026-10', netMinor: 20_000 },
        { period: '2026-11', netMinor: 10_000 },
      ],
    });
    // One point for 2026, carrying the projected end of the year and saying so.
    expect(series.points).toEqual([
      { period: '2026', kind: 'projected', total: money(120_000, EUR) },
    ]);
  });

  it('leaves a skipped account out of the months as well as the axis', () => {
    const series = netWorthSeries(
      [
        anchored('acc-1', 100_00, [mv('2026-08-01', -10)]),
        anchored('acc-2', null, [mv('2026-02-01', 9_999, 'acc-2')]),
      ],
      { today: '2026-09-07', granularity: 'month', currency: EUR },
    );
    // February belongs to the skipped account alone, so it opens no month the
    // chart cannot state a total for.
    expect(series.points.map((point) => [point.period, point.total.minor])).toEqual([
      ['2026-08', 90_00],
      ['2026-09', 90_00],
    ]);
  });
});
