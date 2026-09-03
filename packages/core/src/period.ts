import { countsTowardStats } from './aggregate';
import { addDays, daysBetween, firstOfMonth, inDateRange } from './dates';
import type { ISODate, Transaction } from './types';

/**
 * Category whose bookings open a new pay period. The owner marks payroll by
 * categorising it, and learned rules keep future payrolls landing there, so no
 * extra flag or setting is needed.
 */
export const PAYROLL_CATEGORY_ID = 'income-salary';

/** Two salary bookings this close together belong to one period (a bonus, two payers). */
export const PAYROLL_MERGE_DAYS = 14;

export interface Period {
  readonly from: ISODate;
  /** Inclusive. `null` while the period is still open (the current one). */
  readonly to: ISODate | null;
  /** True when `from` is a salary booking; false when it is a calendar fallback. */
  readonly anchored: boolean;
}

/**
 * Booking dates that open a pay period: every salary that counts toward
 * statistics, sorted, deduplicated, and thinned so that a booking within
 * PAYROLL_MERGE_DAYS of the previous kept one is dropped. The real booking
 * dates are the boundaries: salary drifts around weekends and holidays, and
 * using the actual date absorbs that with no configuration.
 */
export function payPeriodStarts(transactions: readonly Transaction[]): ISODate[] {
  const dates = transactions
    .filter((tx) => tx.categoryId === PAYROLL_CATEGORY_ID && countsTowardStats(tx))
    .map((tx) => tx.bookingDate)
    .sort();

  const starts: ISODate[] = [];
  for (const date of dates) {
    const last = starts[starts.length - 1];
    if (last !== undefined && daysBetween(last, date) <= PAYROLL_MERGE_DAYS) continue;
    starts.push(date);
  }
  return starts;
}

/**
 * The period `today` falls in: from the latest salary on or before today to the
 * day before the next one, open-ended while there is none. Without any salary
 * on or before today the calendar month stands in, flagged unanchored so the
 * UI can say "This month" instead of "Since …".
 */
export function currentPeriod(transactions: readonly Transaction[], today: ISODate): Period {
  let from: ISODate | null = null;
  let next: ISODate | null = null;
  for (const start of payPeriodStarts(transactions)) {
    if (start <= today) {
      from = start;
    } else {
      next = start;
      break;
    }
  }
  if (from === null) return { from: firstOfMonth(today), to: null, anchored: false };
  return { from, to: next === null ? null : addDays(next, -1), anchored: true };
}

export function inPeriod(date: ISODate, period: Period): boolean {
  return inDateRange(date, period.from, period.to);
}
