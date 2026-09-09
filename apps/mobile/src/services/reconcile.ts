import { addDays, matchProvisionals, PROVISIONAL_DAY_WINDOW } from '@finant/core';
import { repointCapture } from '../db/notification-captures-repo';
import {
  listProvisionalTransactions,
  listTransactionsBetween,
  supersedeProvisionals,
} from '../db/transactions-repo';

/**
 * Retires provisional movements the statements have now booked.
 *
 * Runs after every import, over the whole set of live provisionals rather than
 * only the rows just inserted: the statement that books a notification from
 * three weeks ago arrives in one import, and the provisional it supersedes was
 * written in another.
 *
 * The unique indexes cannot do this job. A notification's import hash is built
 * over its own narrative and the statement's over the bank's, so the two rows
 * genuinely differ and no constraint sees a duplicate. That is why this is
 * explicit, tested code — `matchProvisionals` in `@finant/core` — and why an
 * ambiguous pairing is left alone instead of being guessed at.
 *
 * @returns how many provisionals were superseded on this run.
 */
export async function reconcileProvisionals(): Promise<number> {
  const provisionals = await listProvisionalTransactions();
  if (provisionals.length === 0) return 0;

  // Only the window around the provisionals can contain a match, so read that
  // rather than the whole ledger.
  const dates = provisionals.map((row) => row.bookingDate).sort();
  const from = addDays(dates[0] as string, -PROVISIONAL_DAY_WINDOW);
  const to = addDays(dates[dates.length - 1] as string, PROVISIONAL_DAY_WINDOW);
  const candidates = await listTransactionsBetween(from, to);

  const { matches } = matchProvisionals(provisionals, candidates);
  if (matches.length === 0) return 0;

  const superseded = await supersedeProvisionals(matches);
  for (const match of matches) {
    await repointCapture(match.provisionalId, match.bookedId);
  }
  return superseded;
}
