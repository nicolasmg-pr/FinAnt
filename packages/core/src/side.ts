import { money, type Money } from './money';
import type { TransactionSide } from './types';

/**
 * Default side for a source that only gives a signed amount — bank feeds and
 * most CSV exports. A source that states the side explicitly (a ledger with
 * separate income and expense blocks, or camt.053's `CdtDbtInd`) must pass its
 * own value instead of deriving it here.
 */
export function sideFromAmount(amount: Money): TransactionSide {
  return amount.minor > 0 ? 'income' : 'expense';
}

/**
 * Turns what the owner typed into a signed amount for a side they chose.
 *
 * Manual entry is the one source that states the side outright, so the sign
 * has to be derived from it rather than the other way round. `reversal` is what
 * makes the awkward half of the model reachable: a EUR 20 restaurant refund is
 * a positive amount that stays on the *expense* side, where it reduces the
 * month's spending — counting it as income would leave the net right and both
 * totals wrong. The income-side mirror is a clawback: money taken back off a
 * salary, negative but still income.
 *
 * The input is read as a magnitude, so a minus sign the owner typed into the
 * amount field on top of choosing "expense" cannot flip the result twice.
 */
export function signedAmountFor(side: TransactionSide, amount: Money, reversal: boolean): Money {
  const magnitude = Math.abs(amount.minor);
  const positive = reversal ? side === 'expense' : side === 'income';
  // `-0` is not 0 to Object.is or to a deep comparison, and it would travel
  // through JSON and back as a different value than it went in as.
  return money(positive || magnitude === 0 ? magnitude : -magnitude, amount.currency);
}
