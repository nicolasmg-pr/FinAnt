import type { CurrencyCode, Money } from './money';

/** Calendar day, `YYYY-MM-DD`. Bank booking dates have no time zone; keep them as plain dates. */
export type ISODate = string;

/** Calendar month, `YYYY-MM`. */
export type YearMonth = string;

export type CategoryKind = 'income' | 'expense' | 'transfer';

export interface Category {
  readonly id: string;
  /** i18n key resolved by @finant/i18n; falls back to `name` for user-created categories. */
  readonly labelKey?: string;
  readonly name: string;
  readonly kind: CategoryKind;
  readonly parentId: string | null;
  /** Hex colour used by the dashboard. */
  readonly color: string;
  readonly icon: string;
  readonly builtIn: boolean;
  readonly archived: boolean;
}

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly iban: string | null;
  readonly currency: CurrencyCode;
  readonly institutionId: string | null;
  readonly institutionName: string | null;
  /** Where this account's transactions come from. */
  readonly provider: TransactionSource;
  /** GoCardless requisition/account ids, only for provider === 'gocardless'. */
  readonly externalAccountId: string | null;
  readonly lastSyncedAt: string | null;
  readonly archived: boolean;
}

export type TransactionSource = 'gocardless' | 'file-import' | 'manual';

export type CategorySource = 'auto' | 'manual' | 'none';

/**
 * Which side of the ledger a movement belongs to, independent of its sign.
 *
 * Sign alone cannot express a refund. A EUR 20 restaurant refund is a positive
 * amount that belongs on the expense side, where it *reduces* the month's
 * spending — which is how a hand-kept ledger and a card statement both treat
 * it. Counting it as income would leave the net right and both totals wrong.
 */
export type TransactionSide = 'income' | 'expense';

export interface Transaction {
  readonly id: string;
  readonly accountId: string;
  /** Date the bank booked it. Drives every monthly aggregate. */
  readonly bookingDate: ISODate;
  readonly valueDate: ISODate | null;
  /** Signed. Normally negative on the expense side, positive on the income
   * side; a refund is a positive amount that stays on the expense side. */
  readonly amount: Money;
  readonly side: TransactionSide;
  readonly description: string;
  readonly counterparty: string | null;
  readonly reference: string | null;
  readonly categoryId: string | null;
  readonly categorySource: CategorySource;
  readonly source: TransactionSource;
  /** Provider-side id (GoCardless `transactionId`). Primary dedupe key when present. */
  readonly externalId: string | null;
  /** Content hash used to dedupe file imports, which have no stable id. */
  readonly importHash: string;
  readonly notes: string | null;
  /** Internal moves between own accounts, and refunds, skew every chart. Keep them out of stats. */
  readonly excludedFromStats: boolean;
  readonly createdAt: string;
}

export type MatchField = 'description' | 'counterparty' | 'reference' | 'any';

export type RuleMatch =
  | { readonly kind: 'contains'; readonly field: MatchField; readonly value: string }
  | { readonly kind: 'startsWith'; readonly field: MatchField; readonly value: string }
  | { readonly kind: 'regex'; readonly field: MatchField; readonly pattern: string; readonly flags?: string }
  | { readonly kind: 'amountBetween'; readonly minMinor: number; readonly maxMinor: number }
  | { readonly kind: 'direction'; readonly value: 'income' | 'expense' }
  | { readonly kind: 'all'; readonly of: readonly RuleMatch[] }
  | { readonly kind: 'any'; readonly of: readonly RuleMatch[] }
  | { readonly kind: 'not'; readonly of: RuleMatch };

export interface CategoryRule {
  readonly id: string;
  readonly categoryId: string;
  /** Higher wins. Ties break on rule id for determinism. */
  readonly priority: number;
  readonly enabled: boolean;
  readonly match: RuleMatch;
  /** Set when the rule was learned from a user re-categorisation rather than shipped. */
  readonly learned: boolean;
}

export interface Budget {
  readonly categoryId: string;
  readonly monthlyLimit: Money;
}
