import { add, money, zero, type CurrencyCode, type Money } from './money';
import type { ISODate, Transaction } from './types';

/**
 * Account balances, anchored on what the owner says the account holds.
 *
 * FinAnt never talks to a bank, so no statement tells us the balance of an
 * account: the owner asserts "this account holds B on D". That assertion is
 * the truth about D, and everything else is measured from it.
 *
 * **The assertion is never recomputed and never contradicted.** Importing this
 * year's statements under a balance asserted today cannot move today's figure —
 * the statements describe how the account arrived there, not where it is. So a
 * movement dated on or before D is already inside B, and one dated after D is
 * added to it. Asking for a day before D runs the ledger *backwards*: that is
 * how an account anchored once, today, still reports what it held in January.
 *
 * An earlier version stored a derived opening balance instead and added every
 * movement on top of it. Importing a year of history then pushed a real 272,19 €
 * balance to -796,26 €, and the app asked the owner to re-anchor rather than
 * believing what they had already told it. There is nothing to re-anchor now.
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
  readonly currency: CurrencyCode;
}

/**
 * Signed total of the movements in `(after, through]` — the lower bound
 * exclusive, the upper inclusive. Plain string comparison is exact on
 * zero-padded `YYYY-MM-DD`, and `add` refuses to sum two currencies rather
 * than producing a wrong number.
 */
function sumBetween(
  transactions: readonly Transaction[],
  after: ISODate,
  through: ISODate,
  currency: CurrencyCode,
): Money {
  let total = zero(currency);
  for (const tx of transactions) {
    if (tx.bookingDate > after && tx.bookingDate <= through) total = add(total, tx.amount);
  }
  return total;
}

/**
 * The balance on any day, measured from the anchor.
 *
 * On the anchor date it is the asserted figure, exactly. After it, the
 * movements booked since are added. Before it, the movements booked in between
 * are taken back off.
 */
export function balanceAt(
  transactions: readonly Transaction[],
  anchor: BalanceAnchor,
  asOf: ISODate,
): Money {
  const asserted = money(anchor.assertedMinor, anchor.currency);
  if (asOf >= anchor.asOf) {
    return add(asserted, sumBetween(transactions, anchor.asOf, asOf, anchor.currency));
  }
  const since = sumBetween(transactions, asOf, anchor.asOf, anchor.currency);
  return money(asserted.minor - since.minor, anchor.currency);
}

/**
 * What the account held before its first movement — the figure that makes the
 * imported history add up to the balance the owner asserted.
 *
 * With no movements it is the asserted figure itself. Movements dated after
 * the anchor are not part of it: they happened after the assertion, so they
 * say nothing about where the history started.
 */
export function openingBalance(transactions: readonly Transaction[], anchor: BalanceAnchor): Money {
  const asserted = money(anchor.assertedMinor, anchor.currency);
  let earliest: ISODate | null = null;
  for (const tx of transactions) {
    if (tx.bookingDate > anchor.asOf) continue;
    if (earliest === null || tx.bookingDate < earliest) earliest = tx.bookingDate;
  }
  if (earliest === null) return asserted;
  const since = sumBetween(transactions, '', anchor.asOf, anchor.currency);
  return money(asserted.minor - since.minor, anchor.currency);
}
