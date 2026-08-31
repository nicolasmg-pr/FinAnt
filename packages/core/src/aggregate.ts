import { yearMonthOf } from './dates';
import { money, type CurrencyCode, type Money } from './money';
import { UNCATEGORISED_ID } from './categories';
import type { Transaction, YearMonth } from './types';

export interface CategoryTotal {
  readonly categoryId: string;
  /** Always positive: the magnitude spent or received in this category. */
  readonly total: Money;
  readonly count: number;
  /** Share of the month's total expense (or income) as a 0..1 fraction. */
  readonly share: number;
}

export interface MonthlySummary {
  readonly month: YearMonth;
  readonly income: Money;
  /** Positive magnitude. Subtract from income to get net. */
  readonly expenses: Money;
  readonly net: Money;
  readonly incomeByCategory: readonly CategoryTotal[];
  readonly expensesByCategory: readonly CategoryTotal[];
  readonly transactionCount: number;
}

/**
 * Transactions that must not reach any chart: internal moves between the
 * owner's own accounts, and anything they flagged by hand. Counting a
 * savings transfer as an expense makes every net figure a lie.
 */
export function countsTowardStats(tx: Transaction): boolean {
  return !tx.excludedFromStats && tx.categoryId !== 'transfer-internal';
}

function totals(
  txs: readonly Transaction[],
  currency: CurrencyCode,
): { total: Money; byCategory: CategoryTotal[] } {
  let totalMinor = 0;
  const buckets = new Map<string, { minor: number; count: number }>();
  for (const tx of txs) {
    const magnitude = Math.abs(tx.amount.minor);
    totalMinor += magnitude;
    const key = tx.categoryId ?? UNCATEGORISED_ID;
    const bucket = buckets.get(key) ?? { minor: 0, count: 0 };
    bucket.minor += magnitude;
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  const byCategory = [...buckets.entries()]
    .map(([categoryId, b]) => ({
      categoryId,
      total: money(b.minor, currency),
      count: b.count,
      share: totalMinor === 0 ? 0 : b.minor / totalMinor,
    }))
    .sort((a, b) => b.total.minor - a.total.minor || a.categoryId.localeCompare(b.categoryId));
  return { total: money(totalMinor, currency), byCategory };
}

export function summariseMonth(
  transactions: readonly Transaction[],
  month: YearMonth,
  currency: CurrencyCode,
): MonthlySummary {
  const inMonth = transactions.filter(
    (tx) => yearMonthOf(tx.bookingDate) === month && countsTowardStats(tx),
  );
  const income = totals(inMonth.filter((tx) => tx.amount.minor > 0), currency);
  const expenses = totals(inMonth.filter((tx) => tx.amount.minor < 0), currency);
  return {
    month,
    income: income.total,
    expenses: expenses.total,
    net: money(income.total.minor - expenses.total.minor, currency),
    incomeByCategory: income.byCategory,
    expensesByCategory: expenses.byCategory,
    transactionCount: inMonth.length,
  };
}

export function summariseMonths(
  transactions: readonly Transaction[],
  months: readonly YearMonth[],
  currency: CurrencyCode,
): MonthlySummary[] {
  return months.map((m) => summariseMonth(transactions, m, currency));
}
