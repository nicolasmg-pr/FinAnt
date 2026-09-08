import type {
  CurrencyCode,
  DateRangePreset,
  ISODate,
  TransactionFilter,
  TransactionSide,
  YearMonth,
} from '@finant/core';

/**
 * The contract between a local model and the movements list.
 *
 * The model's entire job is to pick a filter. It never states a figure, never
 * does date arithmetic and never scales euros to minor units: it names an
 * intent, and `@finant/core` resolves it. Every number the owner ends up
 * reading was computed by the same code the filter sheet uses.
 */

export type AggregateKind = 'sum' | 'count' | 'average' | 'none';

export const AGGREGATE_KINDS: readonly AggregateKind[] = ['sum', 'count', 'average', 'none'];

export const SIDE_VALUES: readonly (TransactionSide | 'all')[] = ['income', 'expense', 'all'];

/**
 * A date range as the model is allowed to express it.
 *
 * `preset` and `monthsBack` exist so "the last three months" never requires the
 * model to subtract anything from today's date — it says which window it means
 * and `resolve.ts` computes the bounds through `addMonths`, which is already
 * tested against year boundaries and leap years.
 */
export type RangeIntent =
  | { readonly kind: 'preset'; readonly preset: DateRangePreset }
  | { readonly kind: 'month'; readonly yearMonth: YearMonth }
  /** The last N months, this one included. */
  | { readonly kind: 'monthsBack'; readonly months: number }
  | { readonly kind: 'explicit'; readonly from: ISODate | null; readonly to: ISODate | null };

/**
 * One turn's change to the selection.
 *
 * A key the model omits means "leave this as it was", which is what makes
 * "and in July?" a one-key emission — a 1.7B model is far better at naming the
 * dimension it wants to change than at faithfully re-stating the seven it does
 * not. Clearing a dimension is said explicitly, with `null` or `[]`.
 */
export interface FilterPatch {
  readonly text?: string | null;
  readonly accountIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly range?: RangeIntent;
  readonly side?: TransactionSide | 'all';
  /** Decimal euros as written, e.g. "50" or "12.50". Converted by `money.ts`. */
  readonly minEuros?: string | null;
  readonly maxEuros?: string | null;
  readonly aggregate?: AggregateKind;
  /** Start from an empty filter before applying the rest of this patch. */
  readonly reset?: boolean;
}

/** What the conversation currently has selected. */
export interface AskState {
  readonly filter: TransactionFilter;
  readonly aggregate: AggregateKind;
}

/**
 * Everything the resolver needs that does not come from the model. The id lists
 * are what the owner actually has: an id outside them is dropped, whatever the
 * model said.
 */
export interface AskContext {
  readonly today: ISODate;
  readonly currency: CurrencyCode;
  readonly categoryIds: readonly string[];
  readonly accountIds: readonly string[];
}

/**
 * Something the turn could not honour. Issues are shown, not swallowed: a
 * dropped constraint the owner cannot see is worse than an error message.
 */
export type AskIssue =
  | { readonly kind: 'malformed-output' }
  | { readonly kind: 'bad-field'; readonly field: string }
  | { readonly kind: 'bad-date'; readonly value: string }
  | { readonly kind: 'bad-amount'; readonly value: string }
  | { readonly kind: 'unknown-category'; readonly id: string }
  | { readonly kind: 'unknown-account'; readonly id: string }
  /** Internal transfers and rows the owner flagged, listed but kept out of the total. */
  | { readonly kind: 'excluded-from-total'; readonly count: number };
