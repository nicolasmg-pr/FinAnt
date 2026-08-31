import type { Money } from './money';
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
