import { UNCATEGORISED_ID } from './categories';
import { addMonths, yearMonthOf, yearOf } from './dates';
import { normalise } from './normalise';
import type { Category, ISODate, Transaction, TransactionSide } from './types';

/**
 * What the movements list is currently showing.
 *
 * Kept here rather than in the screen so it can be unit-tested against real
 * movements, and so the bank view can hand the list a filter without the two
 * screens growing two different ideas of what "this account, this month" means.
 *
 * Every dimension is inactive in its empty form — no text, no ids, no bounds —
 * and active dimensions are combined with AND.
 */
export interface TransactionFilter {
  /** Free text over description, counterparty and reference. */
  readonly text: string;
  /** Empty means every account. */
  readonly accountIds: readonly string[];
  /** Empty means every category. `UNCATEGORISED_ID` also matches a null category. */
  readonly categoryIds: readonly string[];
  readonly from: ISODate | null;
  readonly to: ISODate | null;
  readonly side: TransactionSide | 'all';
  /** Bounds on the magnitude in minor units, so they read as the owner typed them. */
  readonly minMinor: number | null;
  readonly maxMinor: number | null;
}

export const EMPTY_FILTER: TransactionFilter = {
  text: '',
  accountIds: [],
  categoryIds: [],
  from: null,
  to: null,
  side: 'all',
  minMinor: null,
  maxMinor: null,
};

/** Description, counterparty and reference as one normalised haystack. */
function haystack(tx: Transaction): string {
  return normalise(`${tx.description} ${tx.counterparty ?? ''} ${tx.reference ?? ''}`);
}

export function matchesFilter(tx: Transaction, filter: TransactionFilter): boolean {
  const needle = normalise(filter.text);
  if (needle !== '' && !haystack(tx).includes(needle)) return false;

  if (filter.accountIds.length > 0 && !filter.accountIds.includes(tx.accountId)) return false;

  if (filter.categoryIds.length > 0) {
    // A movement with no category at all is what "uncategorised" means to the
    // owner, whether the column is null or holds the placeholder id.
    const id = tx.categoryId ?? UNCATEGORISED_ID;
    if (!filter.categoryIds.includes(id)) return false;
  }

  // Plain string comparison: booking dates are `YYYY-MM-DD`, which sorts
  // lexicographically, and routing one through a Date would move 1 March into
  // February west of UTC.
  if (filter.from !== null && tx.bookingDate < filter.from) return false;
  if (filter.to !== null && tx.bookingDate > filter.to) return false;

  // Side, never sign: a refund is a positive amount on the expense side.
  if (filter.side !== 'all' && tx.side !== filter.side) return false;

  const magnitude = Math.abs(tx.amount.minor);
  if (filter.minMinor !== null && magnitude < filter.minMinor) return false;
  if (filter.maxMinor !== null && magnitude > filter.maxMinor) return false;

  return true;
}

export function filterTransactions(
  transactions: readonly Transaction[],
  filter: TransactionFilter,
): Transaction[] {
  return transactions.filter((tx) => matchesFilter(tx, filter));
}

/**
 * How many dimensions are narrowing the list, for the badge on the filter
 * button. A date range and an amount range each count once, however many of
 * their two bounds are set — the owner set one constraint, not two.
 */
export function activeFilterCount(filter: TransactionFilter): number {
  let count = 0;
  if (normalise(filter.text) !== '') count += 1;
  if (filter.accountIds.length > 0) count += 1;
  if (filter.categoryIds.length > 0) count += 1;
  if (filter.from !== null || filter.to !== null) count += 1;
  if (filter.side !== 'all') count += 1;
  if (filter.minMinor !== null || filter.maxMinor !== null) count += 1;
  return count;
}

/** The date ranges worth one tap. Anything else is typed as two dates. */
export type DateRangePreset = 'this-month' | 'last-3-months' | 'this-year' | 'all';

export const DATE_RANGE_PRESETS: readonly DateRangePreset[] = [
  'all',
  'this-month',
  'last-3-months',
  'this-year',
];

/**
 * Bounds for a preset, relative to the day the owner is looking at the screen.
 *
 * The upper bound is the end of the period, not today: a standing order booked
 * later this month is already on record and belongs in "this month". `-31` as a
 * month end is deliberate and matches `listTransactionsForMonth` — booking
 * dates are compared as strings, so it is an upper bound no real date exceeds,
 * and it never needs to know how long February is.
 */
export function dateRangePreset(
  preset: DateRangePreset,
  today: ISODate,
): { from: ISODate | null; to: ISODate | null } {
  const month = yearMonthOf(today);
  switch (preset) {
    case 'this-month':
      return { from: `${month}-01`, to: `${month}-31` };
    case 'last-3-months':
      return { from: `${addMonths(month, -2)}-01`, to: `${month}-31` };
    case 'this-year': {
      const year = yearOf(today);
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    }
    case 'all':
      return { from: null, to: null };
  }
}

/** Which preset a filter's range corresponds to, or null for a custom range. */
export function presetOf(filter: TransactionFilter, today: ISODate): DateRangePreset | null {
  for (const preset of DATE_RANGE_PRESETS) {
    const range = dateRangePreset(preset, today);
    if (range.from === filter.from && range.to === filter.to) return preset;
  }
  return null;
}

/**
 * The category ids worth offering as filter chips: the ones the ledger actually
 * uses, in the order of the category list it is handed, with "uncategorised"
 * pulled to the front.
 *
 * The list is a parameter rather than the shipped constant because categories
 * are rows the owner can add to, hide and reorder; this stays pure over what
 * the screen loaded. `UNCATEGORISED_ID` is itself a category in that list, so
 * it has to be dropped from the ordered pass before being prepended — listing
 * it from both sources renders two chips with the same key.
 */
export function usedCategoryIds(
  transactions: readonly Transaction[],
  categories: readonly Category[],
): string[] {
  const present = new Set(transactions.map((tx) => tx.categoryId ?? UNCATEGORISED_ID));
  const ordered = categories
    .filter((category) => category.id !== UNCATEGORISED_ID && present.has(category.id))
    .map((category) => category.id);
  return present.has(UNCATEGORISED_ID) ? [UNCATEGORISED_ID, ...ordered] : ordered;
}
