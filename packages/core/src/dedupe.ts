import { normalise } from './normalise';
import type { Transaction } from './types';

/**
 * Stable content hash for a movement, used to keep a re-imported statement or
 * two overlapping exports from doubling every figure. Most bank exports carry
 * no stable row id, so identity has to come from the content itself.
 *
 * FNV-1a: no crypto dependency, no async, and collisions here only risk hiding
 * one duplicate-looking row, not a security boundary.
 */
export function importHashOf(input: {
  accountId: string;
  bookingDate: string;
  amountMinor: number;
  description: string;
  /**
   * Distinguishes rows a source repeats verbatim. A hand-kept spreadsheet can
   * legitimately list "comida fuera 20.00" three times in one month; without a
   * discriminator all three collapse to one hash and two real movements are
   * silently swallowed as duplicates.
   *
   * Pass a value that is stable across re-imports of the same file. An
   * occurrence counter among identical rows is stable; a row number is not,
   * because inserting a row above shifts every one below it.
   */
  discriminator?: string | number;
}): string {
  const payload = [
    input.accountId,
    input.bookingDate,
    String(input.amountMinor),
    normalise(input.description),
    input.discriminator === undefined ? '' : String(input.discriminator),
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
