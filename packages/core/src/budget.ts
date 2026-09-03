import { countsTowardStats } from './aggregate';
import { inDateRange } from './dates';
import { money, subtract, type CurrencyCode, type Money } from './money';
import type { Period } from './period';
import type { Budget, ISODate, Transaction, YearMonth } from './types';

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

/** Figures shared by every budget report, whatever window they were computed over. */
export interface BudgetFigures {
  readonly totalLimit: Money;
  readonly totalSpent: Money;
  readonly totalRemaining: Money;
  /** Tightest budget first: the one closest to trouble is the one to act on. */
  readonly categories: readonly BudgetProgress[];
  /** Expense that fell outside every budget, so the totals cannot read as the whole period. */
  readonly unbudgetedSpent: Money;
}

export interface BudgetMonth extends BudgetFigures {
  readonly month: YearMonth;
}

export interface BudgetPeriod extends BudgetFigures {
  readonly period: Period;
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
 * Progress of every budget against the movements booked from `from` to `to`,
 * both inclusive; an open `to` runs to the end of the ledger.
 *
 * Only the expense side counts, and it is summed signed and then flipped to a
 * positive magnitude, so a refund lowers the period exactly as it does on a
 * card statement. Internal transfers and rows the owner flagged stay out, which
 * is what keeps a savings transfer from eating a grocery budget.
 */
function budgetRange(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  from: ISODate,
  to: ISODate | null,
  currency: CurrencyCode,
): BudgetFigures {
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
    if (!inDateRange(tx.bookingDate, from, to)) continue;
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
    totalLimit: money(totalLimitMinor, currency),
    totalSpent: money(totalSpentMinor, currency),
    totalRemaining: money(totalLimitMinor - totalSpentMinor, currency),
    categories,
    unbudgetedSpent: money(unbudgetedMinor, currency),
  };
}

export function budgetMonth(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  month: YearMonth,
  currency: CurrencyCode,
): BudgetMonth {
  // `-31` is a safe upper bound for every month; see summariseMonth.
  return { month, ...budgetRange(transactions, budgets, `${month}-01`, `${month}-31`, currency) };
}

/**
 * Budgets are monthly limits. Applied to a pay period they are read as-is: a
 * period is roughly a month long, and pro-rating a limit to 29 or 33 days
 * would only make the bar move for reasons the owner cannot see.
 */
export function budgetPeriod(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  period: Period,
  currency: CurrencyCode,
): BudgetPeriod {
  return { period, ...budgetRange(transactions, budgets, period.from, period.to, currency) };
}
