import { normalise } from './normalise';
import type { Transaction } from './types';

/**
 * Stable content hash for a movement, used to keep a re-imported CSV or an
 * overlapping GoCardless sync from doubling every figure. File imports have no
 * provider id, so identity has to come from the content itself.
 *
 * FNV-1a: no crypto dependency, no async, and collisions here only risk hiding
 * one duplicate-looking row, not a security boundary.
 */
export function importHashOf(input: {
  accountId: string;
  bookingDate: string;
  amountMinor: number;
  description: string;
}): string {
  const payload = [
    input.accountId,
    input.bookingDate,
    String(input.amountMinor),
    normalise(input.description),
  ].join('|');
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `h${hash.toString(16).padStart(8, '0')}${payload.length.toString(16)}`;
}

/**
 * Two movements are the same when the provider says so, or when account, date,
 * amount and narrative all agree. Same-day identical amounts to the same shop
 * are real (two coffees), so the caller keeps a per-hash counter rather than
 * collapsing blindly.
 */
export function dedupeKey(tx: Pick<Transaction, 'externalId' | 'importHash'>): string {
  return tx.externalId ? `ext:${tx.externalId}` : `hash:${tx.importHash}`;
}
