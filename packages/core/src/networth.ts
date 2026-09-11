import { balanceAt, type BalanceAnchor } from './balance';
import { lastOfMonth, monthRange, yearMonthOf, yearOf } from './dates';
import { money, zero, type CurrencyCode, type Money } from './money';
import type { ValuePoint } from './investments';
import type { ISODate, Transaction, YearMonth } from './types';

/**
 * What the owner holds, and how it got there.
 *
 * The Banks screen answers "what is in this account"; this answers "what do I
 * have, and was there more of it last spring". Both stand on the same anchors:
 * an account is only ever placed on the timeline because the owner said what it
 * holds (see balance.ts). An account they never anchored is left out and
 * counted, never assumed to have opened at zero — that would report a total
 * lower than the truth, which is the one direction a money figure must not err.
 *
 * Pure, like the rest of core: the caller reads the accounts and hands them
 * over with their movements already split per account.
 */

/** One account as the dashboard reads it out of the database. */
export interface NetWorthAccount {
  readonly accountId: string;
  /** What the owner said this account holds, and when. Null when they never said. */
  readonly anchor: BalanceAnchor | null;
  readonly currency: CurrencyCode;
  /** This account's non-deleted movements. */
  readonly movements: readonly Transaction[];
}

/** A month of the forecast, as the tail of the line rather than a balance. */
export interface ProjectedNet {
  readonly period: YearMonth;
  readonly netMinor: number;
}

export type Granularity = 'month' | 'year';

export interface NetWorthPoint {
  /** `YYYY-MM` at month granularity, `YYYY` at year granularity. */
  readonly period: string;
  /** `projected` the moment any part of the period is a projection. */
  readonly kind: 'actual' | 'projected';
  readonly total: Money;
}

export interface NetWorthSeries {
  readonly granularity: Granularity;
  readonly points: readonly NetWorthPoint[];
  /** The total held today. Zero when nothing is anchored. */
  readonly current: Money;
  readonly accountsCounted: number;
  /** Anchored in no currency we can sum, or not anchored at all. */
  readonly accountsSkipped: number;
}

export interface NetWorthOptions {
  readonly today: ISODate;
  readonly granularity: Granularity;
  readonly currency: CurrencyCode;
  /**
   * Months after the current one, from the year forecast. Kept out of this
   * module deliberately: the projection model lives in forecast.ts, and this
   * only carries its running total forward from what is held today.
   */
  readonly projected?: readonly ProjectedNet[];
}

/** The total across the counted accounts on one day. */
function totalOn(
  accounts: readonly { anchor: BalanceAnchor; movements: readonly Transaction[] }[],
  asOf: ISODate,
  currency: CurrencyCode,
): Money {
  let total = zero(currency);
  for (const account of accounts) {
    total = money(total.minor + balanceAt(account.movements, account.anchor, asOf).minor, currency);
  }
  return total;
}

/**
 * The total held at the end of every period on record, plus the projected tail.
 *
 * A period closes on its last calendar day, except the one `today` falls in:
 * that one closes on `today`, so a movement already imported with a date later
 * this month does not show up as money the owner has now.
 */
export function netWorthSeries(
  accounts: readonly NetWorthAccount[],
  options: NetWorthOptions,
): NetWorthSeries {
  const { today, granularity, currency } = options;
  const projected = options.projected ?? [];

  // An account in another currency is not converted: FinAnt holds no rate, and
  // a made-up one would put an invented number on the owner's net worth.
  const counted = accounts.filter(
    (account) => account.anchor !== null && account.currency === currency,
  ) as readonly (NetWorthAccount & { anchor: BalanceAnchor })[];

  const series = {
    granularity,
    current: totalOn(counted, today, currency),
    accountsCounted: counted.length,
    accountsSkipped: accounts.length - counted.length,
  };

  const currentMonth = yearMonthOf(today);
  // Only the counted accounts set the axis: a month that exists because of an
  // account we skip is a month with no total to draw.
  const dates = counted.flatMap((account) => account.movements.map((tx) => tx.bookingDate));
  if (dates.length === 0) return { ...series, points: [] };

  const first = yearMonthOf(dates.reduce((min, date) => (date < min ? date : min)));
  // A movement dated in the future does not stretch the booked part of the line.
  const months = monthRange(first < currentMonth ? first : currentMonth, currentMonth);

  const actual: NetWorthPoint[] = months.map((month) => ({
    period: month,
    kind: 'actual',
    total: totalOn(counted, month === currentMonth ? today : lastOfMonth(month), currency),
  }));

  // The tail carries the projected monthly net forward from what is held today.
  let running = series.current.minor;
  const tail: NetWorthPoint[] = projected
    .filter((month) => month.period > currentMonth)
    .map((month) => {
      running += month.netMinor;
      return { period: month.period, kind: 'projected', total: money(running, currency) };
    });

  const points = [...actual, ...tail];
  return { ...series, points: granularity === 'year' ? byYear(points) : points };
}

/**
 * One point per calendar year: the last point of that year, which is the total
 * standing at its end. A year holding any projected month is itself projected —
 * the figure is a projection whatever the eleven months before it were.
 */
function byYear(points: readonly NetWorthPoint[]): NetWorthPoint[] {
  const out: NetWorthPoint[] = [];
  for (const point of points) {
    const year = String(yearOf(point.period));
    const last = out.at(-1);
    if (last?.period === year) {
      out[out.length - 1] = {
        period: year,
        kind: last.kind === 'projected' || point.kind === 'projected' ? 'projected' : 'actual',
        total: point.total,
      };
      continue;
    }
    out.push({ period: year, kind: point.kind, total: point.total });
  }
  return out;
}

/** Cash and holdings on one timeline, with each half still legible. */
export interface CombinedWorth {
  /** Booked months only. Never a projection — see below. */
  readonly points: readonly NetWorthPoint[];
  /** Everything held today: cash plus the portfolio's market value. */
  readonly current: Money;
  readonly cashCurrent: Money;
  readonly portfolioCurrent: Money;
}

/**
 * Adds what the portfolio is worth to what the accounts hold.
 *
 * The cash series is the spine: it reaches back to the first movement, which is
 * further than the first trade, and a period it does not cover is a period with
 * no total to draw. Before the first trade the portfolio contributes nothing,
 * which is not an approximation — the owner held none of it yet.
 *
 * **The projected tail is dropped.** The cash line can be projected because the
 * forecast is built from the owner's own recurring movements; a share price
 * cannot. The only way to extend the combined line would be to hold the
 * portfolio flat, and "flat" is a claim about the market dressed up as
 * arithmetic. The line stops where the facts do.
 *
 * At year granularity the portfolio is taken at that year's last month on record,
 * which is the holding standing at the year's end — the same rule the cash
 * series already uses for a year point.
 */
export function combineNetWorth(
  cash: readonly NetWorthPoint[],
  portfolio: readonly ValuePoint[],
  currency: CurrencyCode,
  /**
   * What the holdings are worth right now, when the caller knows it.
   *
   * The monthly series cannot answer that on its own: it is built from a
   * price history, and an asset whose history the provider will not serve is
   * missing from it while still being very much held. Passing today's real
   * figure keeps the headline honest — and keeps it equal to the one the
   * portfolio view shows, which is the same money.
   */
  portfolioNow?: Money,
): CombinedWorth {
  const booked = cash.filter((point) => point.kind === 'actual');
  const months = [...portfolio].sort((a, b) => a.period.localeCompare(b.period));

  const cashCurrent = booked[booked.length - 1]?.total ?? zero(currency);
  const portfolioCurrent = portfolioNow ?? months[months.length - 1]?.total ?? zero(currency);

  const lastPeriod = booked[booked.length - 1]?.period;
  const points = booked.map((point) => {
    // The final point is today, so it takes today's figure for the same reason
    // the headline does; every earlier one is a month close from the history.
    const holding =
      point.period === lastPeriod ? portfolioCurrent.minor : valueAt(months, point.period);
    return {
      period: point.period,
      kind: 'actual' as const,
      total: money(point.total.minor + holding, currency),
    };
  });

  return {
    points,
    current: money(cashCurrent.minor + portfolioCurrent.minor, currency),
    cashCurrent,
    portfolioCurrent,
  };
}

/**
 * The portfolio's value at the close of a period, in minor units.
 *
 * `period` is `YYYY-MM` at month granularity and `YYYY` at year granularity;
 * both are answered by the same prefix comparison, because a month string
 * sorts inside its own year. The last point at or before the period is carried
 * forward, so a month the provider has no close for keeps the previous one
 * rather than dropping the holding out of the line.
 */
function valueAt(months: readonly ValuePoint[], period: string): number {
  const end = period.length === 4 ? `${period}-12` : period;
  let found = 0;
  for (const point of months) {
    if (point.period > end) break;
    found = point.total.minor;
  }
  return found;
}
