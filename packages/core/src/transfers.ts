import { daysBetween } from './dates';
import type { Transaction } from './types';

/** A debit and its credit in another account book within this many days of each other. */
export const TRANSFER_MAX_DAYS = 3;

export interface TransferPair {
  /** The debit: negative amount, money leaving one account. */
  readonly outId: string;
  /** The credit: the same amount arriving in another account. */
  readonly inId: string;
}

/**
 * A row the matcher may claim. A manual category is the owner's word and must
 * stand; an excluded row is already out of every total; a linked row has been
 * paired on an earlier run.
 */
function eligible(tx: Transaction): boolean {
  return tx.categorySource !== 'manual' && tx.transferPeerId === null && !tx.excludedFromStats;
}

function byDateThenId(a: Transaction, b: Transaction): number {
  return a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id);
}

function amountKey(currency: string, minor: number): string {
  return `${currency}|${minor}`;
}

/**
 * Pairs each debit with the credit that cancels it out in another account.
 *
 * Deterministic and one-to-one: debits are visited by booking date then id,
 * and each takes the unmatched credit with the smallest day distance, ties
 * broken by the credit's date then id. Same currency, exact opposite amount,
 * different account, within `maxDays`. Rows a shipped rule already put in
 * `transfer-internal` are eligible, so they gain a peer link.
 */
export function matchTransfers(
  transactions: readonly Transaction[],
  options: { maxDays?: number } = {},
): TransferPair[] {
  const maxDays = options.maxDays ?? TRANSFER_MAX_DAYS;

  const debits = transactions
    .filter((tx) => eligible(tx) && tx.amount.minor < 0)
    .sort(byDateThenId);

  // Credits indexed by currency and amount, each bucket already in tie-break order.
  const credits = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!eligible(tx) || tx.amount.minor <= 0) continue;
    const key = amountKey(tx.amount.currency, tx.amount.minor);
    const bucket = credits.get(key) ?? [];
    bucket.push(tx);
    credits.set(key, bucket);
  }
  for (const bucket of credits.values()) bucket.sort(byDateThenId);

  const claimed = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const debit of debits) {
    const candidates = credits.get(amountKey(debit.amount.currency, -debit.amount.minor));
    if (!candidates) continue;

    let best: Transaction | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const credit of candidates) {
      if (claimed.has(credit.id) || credit.accountId === debit.accountId) continue;
      const distance = Math.abs(daysBetween(debit.bookingDate, credit.bookingDate));
      if (distance > maxDays) continue;
      // Strict `<`: at equal distance the earlier bucket entry (date, then id) stays.
      if (distance < bestDistance) {
        best = credit;
        bestDistance = distance;
      }
    }

    if (best) {
      claimed.add(best.id);
      pairs.push({ outId: debit.id, inId: best.id });
    }
  }

  return pairs;
}
