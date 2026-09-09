import { matchTransfers } from '@finant/core';
import { linkTransferPairs, listAllTransactions } from '../db/transactions-repo';

/**
 * Pairs debits and credits across the owner's accounts and records the links.
 *
 * Runs over the whole ledger, not just a fresh import: the counterpart of a
 * transfer usually arrives later, in a statement from the other bank. Cheap
 * enough for a personal ledger (one pass, a map lookup per debit). Idempotent:
 * rows already linked are skipped by the matcher, so a second run finds nothing.
 *
 * @returns how many pairs were linked on this run.
 */
export async function detectTransfers(): Promise<number> {
  const ledger = await listAllTransactions();
  // A provisional movement is one half of nothing: pairing it would link the
  // notification to the very statement row that is about to supersede it, and
  // both would end up categorised as an internal transfer and dropped from
  // every total.
  const pairs = matchTransfers(ledger.filter((row) => !row.provisional));
  await linkTransferPairs(pairs);
  return pairs.length;
}
