import { add, money, zero, type CurrencyCode, type Money } from './money';
import type { ISODate, Transaction } from './types';

/**
 * Account balances anchored on what the owner says the account holds.
 *
 * FinAnt never talks to a bank, so no statement tells us the balance of an
 * account: the owner asserts "this account holds B today". That single claim,
 * plus the movements already on record, is enough to place the account on the
 * timeline — we derive the *opening* balance behind it and keep that, because
 * an opening balance is a fixed historical fact while a current balance is not.
 *
 * Every function here is pure and works on the movements of **one** account.
 * The caller passes that account's non-deleted rows; a deleted movement never
 * leaves the repository, so it can never reach a balance.
 *
 * Excluded rows and internal transfers are counted. `countsTowardStats()`
 * governs statistics, not balances: moving 200 € to a savings account leaves
 * the current account 200 € lighter whatever the charts decide to show.
 */

export interface BalanceAnchor {
  /** What the owner said the account holds, in signed minor units. */
  readonly assertedMinor: number;
  /** The day the claim was made about (`balance_date`), `YYYY-MM-DD`. */
  readonly asOf: ISODate;
  /** The opening balance derived at the moment of the assertion. */
  readonly openingMinor: number;
  readonly currency: CurrencyCode;
}

export interface AnchorReconciliation {
  /** The opening balance the ledger implies right now. */
  readonly expectedOpeningMinor: number;
  /** The opening balance stored when the owner asserted the balance. */
  readonly storedOpeningMinor: number;
  /**
   * `expected - stored`. Non-zero means movements dated on or before the
   * anchor date arrived after the anchor was set, so the anchor no longer
   * describes the history it claimed to account for. Its sign is the negation
   * of what arrived: 25 € of backfilled spending raises the opening balance
   * needed to still reach the asserted figure by 25 €.
   */
  readonly driftMinor: number;
}

/** Signed total of every movement booked on or before `asOf`. Throws on a currency mismatch. */
export function sumThrough(
  transactions: readonly Transaction[],
  asOf: ISODate,
  currency: CurrencyCode,
): Money {
  let total = zero(currency);
  for (const tx of transactions) {
    // Plain string comparison is exact on zero-padded YYYY-MM-DD, and `add`
    // refuses to sum two currencies rather than producing a wrong number.
    if (tx.bookingDate <= asOf) total = add(total, tx.amount);
  }
  return total;
}

/**
 * The balance the account must have held before its first movement, given that
 * it holds `assertedMinor` on `asOf`: `O = B - Σ(movements <= asOf)`.
 *
 * This is what gets stored, so a later movement — before, on or after the
 * anchor date — moves the derived balance instead of being contradicted by it.
 */
export function deriveOpeningBalance(
  transactions: readonly Transaction[],
  assertedMinor: number,
  asOf: ISODate,
  currency: CurrencyCode,
): Money {
  const asserted = money(assertedMinor, currency);
  return money(asserted.minor - sumThrough(transactions, asOf, currency).minor, currency);
}

/**
 * The balance on any day: `O + Σ(movements <= asOf)`. By construction this
 * returns the asserted figure on the anchor date itself.
 */
export function balanceAsOf(
  transactions: readonly Transaction[],
  openingMinor: number,
  asOf: ISODate,
  currency: CurrencyCode,
): Money {
  const opening = money(openingMinor, currency);
  return money(opening.minor + sumThrough(transactions, asOf, currency).minor, currency);
}

/**
 * Checks a stored anchor against the ledger as it stands now.
 *
 * A later import can insert movements dated on or before the anchor date —
 * history the anchor already claimed to account for. Re-deriving the opening
 * balance shows it: a non-zero drift means the two disagree. The owner is told;
 * nothing is re-anchored on their behalf, because only they know whether the
 * new rows are real or whether the figure they typed was wrong.
 */
export function reconcileAnchor(
  transactions: readonly Transaction[],
  anchor: BalanceAnchor,
): AnchorReconciliation {
  const expected = deriveOpeningBalance(
    transactions,
    anchor.assertedMinor,
    anchor.asOf,
    anchor.currency,
  );
  return {
    expectedOpeningMinor: expected.minor,
    storedOpeningMinor: anchor.openingMinor,
    driftMinor: expected.minor - anchor.openingMinor,
  };
}
