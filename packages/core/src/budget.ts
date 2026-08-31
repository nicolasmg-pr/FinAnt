import { countsTowardStats } from './aggregate';
import { yearMonthOf } from './dates';
import { money, subtract, type CurrencyCode, type Money } from './money';
import type { Budget, Transaction, YearMonth } from './types';

/**
 * Share of a limit at which a budget starts reading as a warning rather than as
 * headroom. Exported so the UI colours a bar on the same threshold the domain
 * used to label it, instead of picking a second number of its own.
 */
export const NEAR_LIMIT_RATIO = 0.8;

export type BudgetState = 'under' | 'near' | 'over';

export interface BudgetProgress {
  readonly categoryId: string;
  readonly limit: Money;
  /**
   * Positive magnitude spent this month, net of refunds. Negative when a
   * category's refunds outweigh its spending, which is worth showing as-is.
   */
  readonly spent: Money;
  /** `limit - spent`. Negative once the limit is crossed. */
  readonly remaining: Money;
  /** `spent / limit`, clamped at 0. Infinite against a zero limit. */
  readonly ratio: number;
  readonly state: BudgetState;
  readonly transactionCount: number;
}

export interface BudgetMonth {
  readonly month: YearMonth;
  readonly totalLimit: Money;
  readonly totalSpent: Money;
  readonly totalRemaining: Money;
  /** Tightest budget first: the one closest to trouble is the one to act on. */
  readonly categories: readonly BudgetProgress[];
  /** Expense that fell outside every budget, so the totals cannot read as the whole month. */
  readonly unbudgetedSpent: Money;
}

function ratioOf(spentMinor: number, limitMinor: number): number {
  if (spentMinor <= 0) return 0;
  if (limitMinor <= 0) return Number.POSITIVE_INFINITY;
  return spentMinor / limitMinor;
}

function stateOf(ratio: number): BudgetState {
  if (ratio >= 1) return 'over';
  if (ratio >= NEAR_LIMIT_RATIO) return 'near';
  return 'under';
}

/**
 * Progress of every budget against one month.
 *
 * Only the expense side counts, and it is summed signed and then flipped to a
 * positive magnitude, so a refund lowers the month exactly as it does on a card
 * statement. Internal transfers and rows the owner flagged stay out, which is
 * what keeps a savings transfer from eating a grocery budget.
 */
export function budgetMonth(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  month: YearMonth,
  currency: CurrencyCode,
): BudgetMonth {
  const limits = new Map<string, Money>();
  for (const b of budgets) {
    // First one wins: a second row for the same category would otherwise double
    // the total limit, and the table holds one budget per category anyway.
    if (!limits.has(b.categoryId)) limits.set(b.categoryId, b.monthlyLimit);
  }

  const spentByCategory = new Map<string, { minor: number; count: number }>();
  let unbudgetedMinor = 0;

  for (const tx of transactions) {
    if (tx.side !== 'expense') continue;
    if (yearMonthOf(tx.bookingDate) !== month) continue;
    if (!countsTowardStats(tx)) continue;

    const oriented = -tx.amount.minor;
    const categoryId = tx.categoryId ?? '';
    if (!limits.has(categoryId)) {
      unbudgetedMinor += oriented;
      continue;
    }
    const bucket = spentByCategory.get(categoryId) ?? { minor: 0, count: 0 };
    bucket.minor += oriented;
    bucket.count += 1;
    spentByCategory.set(categoryId, bucket);
  }

  const categories = [...limits.entries()]
    .map(([categoryId, limit]) => {
      const bucket = spentByCategory.get(categoryId) ?? { minor: 0, count: 0 };
      const spent = money(bucket.minor, currency);
      const ratio = ratioOf(bucket.minor, limit.minor);
      return {
        categoryId,
        limit,
        spent,
        // Throws on a currency mismatch, which is the only sane outcome: a USD
        // limit tells us nothing about what a EUR month has left.
        remaining: subtract(limit, spent),
        ratio,
        state: stateOf(ratio),
        transactionCount: bucket.count,
      };
    })
    .sort((a, b) => b.ratio - a.ratio || a.categoryId.localeCompare(b.categoryId));

  const totalLimitMinor = categories.reduce((acc, c) => acc + c.limit.minor, 0);
  const totalSpentMinor = categories.reduce((acc, c) => acc + c.spent.minor, 0);

  return {
    month,
    totalLimit: money(totalLimitMinor, currency),
    totalSpent: money(totalSpentMinor, currency),
    totalRemaining: money(totalLimitMinor - totalSpentMinor, currency),
    categories,
    unbudgetedSpent: money(unbudgetedMinor, currency),
  };
}
