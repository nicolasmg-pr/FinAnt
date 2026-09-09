import { addDays, matchProvisionals, PROVISIONAL_DAY_WINDOW } from '@finant/core';
import {
  listProvisionalTransactions,
  listTransactionsBetween,
  supersedeProvisionals,
} from '../db/transactions-repo';

export interface ReconcileResult {
  /** How many provisionals were retired on this run. */
  readonly superseded: number;
  /**
   * Provisionals a booked row matched as well as another one did. Nothing was
   * retired for them: the owner is told instead, because picking one of two
   * equally good candidates is how a real movement disappears.
   */
  readonly ambiguous: readonly string[];
}

/**
 * Reads the ledger and pairs what can be paired, without writing anything.
 *
 * Shared by the reconciliation `ingest()` runs and by the inbox, which needs
 * the ambiguous set without touching a row: an ambiguous pairing is not
 * recorded anywhere, so the only way to show it after the import screen has
 * gone is to recompute it from the same inputs.
 */
async function planReconciliation(): Promise<{
  matches: readonly { provisionalId: string; bookedId: string }[];
  ambiguous: readonly string[];
}> {
  const provisionals = await listProvisionalTransactions();
  if (provisionals.length === 0) return { matches: [], ambiguous: [] };

  // Only the window around the provisionals can contain a match, so read that
  // rather than the whole ledger.
  const dates = provisionals.map((row) => row.bookingDate).sort();
  const from = addDays(dates[0] as string, -PROVISIONAL_DAY_WINDOW);
  const to = addDays(dates[dates.length - 1] as string, PROVISIONAL_DAY_WINDOW);
  const candidates = await listTransactionsBetween(from, to);

  return matchProvisionals(provisionals, candidates);
}

/**
 * Retires provisional movements the statements have now booked.
 *
 * Runs after every import that inserted at least one row and was not itself
 * provisional, over the whole set of live provisionals rather than only the
 * rows just inserted: the statement that books a notification from three
 * weeks ago arrives in one import, and the provisional it supersedes was
 * written in another. It is skipped for a provisional batch (a notification
 * has nothing yet to reconcile against) and for an import that inserted
 * nothing (a file full of duplicates changes nothing to reconcile).
 *
 * The unique indexes cannot do this job. A notification's import hash is built
 * over its own narrative and the statement's over the bank's, so the two rows
 * genuinely differ and no constraint sees a duplicate. That is why this is
 * explicit, tested code — `matchProvisionals` in `@finant/core` — and why an
 * ambiguous pairing is left alone instead of being guessed at.
 */
export async function reconcileProvisionals(): Promise<ReconcileResult> {
  const { matches, ambiguous } = await planReconciliation();
  if (matches.length === 0) return { superseded: 0, ambiguous };

  // supersedeProvisionals repoints each pair's capture in the same
  // transaction as the soft delete, so this either fully commits or fully
  // rolls back per pair — there is no loop of separate writes here to fail
  // halfway through.
  return { superseded: await supersedeProvisionals(matches), ambiguous };
}

/**
 * The provisionals a statement row currently matches ambiguously, for the
 * inbox. Read-only: it retires nothing, so opening the inbox never changes
 * the ledger.
 */
export async function ambiguousProvisionals(): Promise<readonly string[]> {
  return (await planReconciliation()).ambiguous;
}
