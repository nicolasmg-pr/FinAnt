import { inDateRange } from './dates';
import { money, type CurrencyCode, type Money } from './money';
import { INTERNAL_TRANSFER_ID, INVESTMENT_TRADE_ID, UNCATEGORISED_ID } from './categories';
import type { Period } from './period';
import type { ISODate, Transaction, TransactionSide, YearMonth } from './types';

export interface CategoryTotal {
  readonly categoryId: string;
  /**
   * Net magnitude for the category on its side of the ledger: refunds subtract.
   * Normally positive, but a category whose only rows are refunds can be
   * negative, and reporting that honestly beats hiding it behind an abs().
   */
  readonly total: Money;
  readonly count: number;
  /** Share of the side's total, 0..1. Clamped at 0 for a net-negative category. */
  readonly share: number;
}

/** Figures shared by every summary, whatever window they were computed over. */
export interface SummaryFigures {
  readonly income: Money;
  /** Positive magnitude, net of refunds. Subtract from income to get net. */
  readonly expenses: Money;
  readonly net: Money;
  readonly incomeByCategory: readonly CategoryTotal[];
  readonly expensesByCategory: readonly CategoryTotal[];
  readonly transactionCount: number;
}

export interface MonthlySummary extends SummaryFigures {
  readonly month: YearMonth;
}

export interface PeriodSummary extends SummaryFigures {
  readonly period: Period;
}

/**
 * Transactions that must not reach any chart: internal moves between the
 * owner's own accounts, purchases and disposals of securities, and anything
 * they flagged by hand. Counting a savings transfer as an expense makes every
 * net figure a lie.
 *
 * A share purchase is the same lie in a different costume. The cash leaves the
 * account, so it looks like spending, but net worth has not moved — it is the
 * same money in a different form, and the holding it bought is counted on the
 * portfolio side. A month with EUR 2,000 of purchases would otherwise read as a
 * EUR 2,000 spending blowout, and the forecast would learn from it.
 *
 * Dividends, savebacks and stockperks are not excluded. They are genuinely new
 * money and belong in income.
 */
export function countsTowardStats(tx: Transaction): boolean {
  return (
    !tx.excludedFromStats &&
    tx.categoryId !== INTERNAL_TRANSFER_ID &&
    tx.categoryId !== INVESTMENT_TRADE_ID
  );
}

/**
 * Totals one side of the ledger. Amounts are summed signed and the expense side
 * is then flipped to a positive magnitude, so a refund reduces its month and its
 * category exactly as it does in the source ledger.
 */
function totals(
  txs: readonly Transaction[],
  side: TransactionSide,
  currency: CurrencyCode,
): { total: Money; byCategory: CategoryTotal[] } {
  const orient = side === 'expense' ? -1 : 1;
  let totalMinor = 0;
  const buckets = new Map<string, { minor: number; count: number }>();

  for (const tx of txs) {
    const oriented = tx.amount.minor * orient;
    totalMinor += oriented;
    const key = tx.categoryId ?? UNCATEGORISED_ID;
    const bucket = buckets.get(key) ?? { minor: 0, count: 0 };
    bucket.minor += oriented;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const byCategory = [...buckets.entries()]
    .map(([categoryId, b]) => ({
      categoryId,
      total: money(b.minor, currency),
      count: b.count,
      share: totalMinor <= 0 ? 0 : Math.max(0, b.minor / totalMinor),
    }))
    .sort((a, b) => b.total.minor - a.total.minor || a.categoryId.localeCompare(b.categoryId));

  return { total: money(totalMinor, currency), byCategory };
}

/**
 * Totals every movement booked from `from` to `to`, both inclusive; an open
 * `to` runs to the end of the ledger. Every public summary is this with a
 * different window, so a month and a pay period can never disagree on what
 * counts.
 */
function summariseRange(
  transactions: readonly Transaction[],
  from: ISODate,
  to: ISODate | null,
  currency: CurrencyCode,
): SummaryFigures {
  const inRange = transactions.filter(
    (tx) => inDateRange(tx.bookingDate, from, to) && countsTowardStats(tx),
  );
  const income = totals(
    inRange.filter((tx) => tx.side === 'income'),
    'income',
    currency,
  );
  const expenses = totals(
    inRange.filter((tx) => tx.side === 'expense'),
    'expense',
    currency,
  );

  return {
    income: income.total,
    expenses: expenses.total,
    net: money(income.total.minor - expenses.total.minor, currency),
    incomeByCategory: income.byCategory,
    expensesByCategory: expenses.byCategory,
    transactionCount: inRange.length,
  };
}

export function summariseMonth(
  transactions: readonly Transaction[],
  month: YearMonth,
  currency: CurrencyCode,
): MonthlySummary {
  // `-31` is a safe upper bound for every month: no booking date falls between
  // a month's real last day and the 31st, and string comparison needs no calendar.
  return { month, ...summariseRange(transactions, `${month}-01`, `${month}-31`, currency) };
}

export function summarisePeriod(
  transactions: readonly Transaction[],
  period: Period,
  currency: CurrencyCode,
): PeriodSummary {
  return { period, ...summariseRange(transactions, period.from, period.to, currency) };
}

export function summariseMonths(
  transactions: readonly Transaction[],
  months: readonly YearMonth[],
  currency: CurrencyCode,
): MonthlySummary[] {
  return months.map((m) => summariseMonth(transactions, m, currency));
}
