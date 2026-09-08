import { countsTowardStats, filterTransactions, money, scale } from '@finant/core';
import type { Money, Transaction } from '@finant/core';
import type { AskContext, AskIssue, AskState } from './schema';

export interface Answer {
  readonly state: AskState;
  readonly matches: readonly Transaction[];
  /** How many movements the filter selected, exclusions included. */
  readonly count: number;
  /**
   * Oriented the way the ledger reads: a positive magnitude on the expense
   * side, so a refund reduces it; the signed net when no side was asked for.
   */
  readonly total: Money;
  /** Over the movements that counted. `null` when none did. */
  readonly average: Money | null;
  readonly issues: readonly AskIssue[];
}

/**
 * What the sheet renders for one turn.
 *
 * The list shows everything the filter matched, but the total is computed over
 * `countsTowardStats` only: an internal transfer inside the window would
 * otherwise turn a EUR 500 move between the owner's own accounts into EUR 500
 * of spending. Those rows stay visible and the exclusion is reported, because a
 * total that quietly disagrees with the list above it is worse than either.
 */
export function answer(
  transactions: readonly Transaction[],
  state: AskState,
  ctx: AskContext,
): Answer {
  const matches = filterTransactions(transactions, state.filter);
  const counted = matches.filter(countsTowardStats);
  const issues: AskIssue[] = [];

  const excluded = matches.length - counted.length;
  if (excluded > 0) issues.push({ kind: 'excluded-from-total', count: excluded });

  // Sum signed, then flip the expense side to a magnitude — the same
  // orientation `core/aggregate` uses, so a figure here and a figure on the
  // dashboard never disagree about what a refund did.
  const orient = state.filter.side === 'expense' ? -1 : 1;
  const totalMinor = counted.reduce((acc, tx) => acc + tx.amount.minor, 0) * orient;
  const total = money(totalMinor, ctx.currency);

  return {
    state,
    matches,
    count: matches.length,
    total,
    average: counted.length > 0 ? scale(total, 1 / counted.length) : null,
    issues,
  };
}
