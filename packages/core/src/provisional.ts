import { daysBetween } from './dates';
import type { ISODate, Transaction } from './types';

/**
 * Reconciling provisional movements against the statement rows that book them.
 *
 * A movement born from a push notification is an approximation: the text
 * carries no bank transaction id, and a card authorisation books days later,
 * sometimes for a different amount. So the unique indexes cannot catch the
 * duplicate — the two rows genuinely differ — and matching has to be explicit,
 * reviewed code. Everything here is pure and works on rows the caller read.
 *
 * **Amounts must match exactly.** There is no tolerance band. What the bank
 * booked is what the ledger shows, and a booked figure that differs from the
 * one the notification announced is a different fact, not a rounding of the
 * same one.
 *
 * The cost is explicit and accepted. A restaurant bill authorised at 42,30 and
 * booked at 43,50 with a tip does not reconcile, so the ledger holds both the
 * unconfirmed 42,30 and the booked 43,50 until the owner clears the leftover —
 * which `staleProvisionals` surfaces. The alternative buys tidiness by merging
 * two rows on a guess, and a wrong merge makes a real movement disappear.
 *
 * The other rule that must not be softened: an ambiguous match is never
 * resolved by guessing. Picking one of two equally plausible provisionals is
 * how a real movement disappears from someone's ledger.
 */

/** Booking dates this far apart can still be the same movement. */
export const PROVISIONAL_DAY_WINDOW = 3;
/**
 * A provisional older than this, on an account whose statements have already
 * been imported past its date, is treated as one the bank never booked: a
 * declined authorisation, or a hotel hold that was released.
 *
 * Deliberately longer than any settlement cycle the owner's banks use, so a
 * slow booking is never mistaken for a dead one.
 */
export const PROVISIONAL_STALE_DAYS = 45;

export interface ProvisionalMatch {
  readonly provisionalId: string;
  readonly bookedId: string;
}

export interface ProvisionalMatchResult {
  readonly matches: readonly ProvisionalMatch[];
  /**
   * Provisionals that a booked row matched equally well as another. Left
   * provisional and surfaced to the owner rather than resolved by coin toss.
   */
  readonly ambiguous: readonly string[];
}

interface Candidate {
  readonly provisional: Transaction;
  readonly dayDelta: number;
}

function isCandidate(provisional: Transaction, booked: Transaction): Candidate | null {
  if (provisional.accountId !== booked.accountId) return null;
  if (provisional.amount.currency !== booked.amount.currency) return null;
  if (provisional.side !== booked.side) return null;
  // Signed equality, which also settles the sign: a refund is a positive
  // amount on the expense side and a purchase a negative one, and side alone
  // does not separate them.
  if (provisional.amount.minor !== booked.amount.minor) return null;

  const dayDelta = Math.abs(daysBetween(provisional.bookingDate, booked.bookingDate));
  if (dayDelta > PROVISIONAL_DAY_WINDOW) return null;

  return { provisional, dayDelta };
}

/**
 * Closest date wins, then id so two runs agree. The amount plays no part in
 * the ordering: every candidate matched it exactly, or it would not be one.
 */
function betterFirst(a: Candidate, b: Candidate): number {
  if (a.dayDelta !== b.dayDelta) return a.dayDelta - b.dayDelta;
  return a.provisional.id < b.provisional.id ? -1 : 1;
}

function equallyGood(a: Candidate, b: Candidate): boolean {
  return a.dayDelta === b.dayDelta;
}

/**
 * Pairs provisional movements with the statement rows that book them.
 *
 * @param provisionals rows with `provisional === true`, not deleted.
 * @param booked candidate statement rows. Rows that are themselves provisional
 *   are ignored, so two notifications can never reconcile each other.
 */
export function matchProvisionals(
  provisionals: readonly Transaction[],
  booked: readonly Transaction[],
): ProvisionalMatchResult {
  const matches: ProvisionalMatch[] = [];
  const ambiguous = new Set<string>();
  const consumed = new Set<string>();

  // Deterministic order: the same inputs must always produce the same pairing,
  // whatever order the repository handed the rows over in.
  const targets = [...booked]
    .filter((row) => !row.provisional)
    .sort((a, b) =>
      a.bookingDate === b.bookingDate
        ? a.id < b.id
          ? -1
          : 1
        : a.bookingDate < b.bookingDate
          ? -1
          : 1,
    );

  for (const target of targets) {
    const candidates: Candidate[] = [];
    for (const provisional of provisionals) {
      if (consumed.has(provisional.id)) continue;
      const candidate = isCandidate(provisional, target);
      if (candidate) candidates.push(candidate);
    }
    if (candidates.length === 0) continue;

    candidates.sort(betterFirst);
    const best = candidates[0] as Candidate;
    const runnerUp = candidates[1];

    if (runnerUp && equallyGood(best, runnerUp)) {
      // Two provisionals fit this booked row equally well. Both stay, and the
      // owner decides. Marking them is the whole point: silence here loses a
      // movement or doubles one.
      for (const candidate of candidates) {
        if (equallyGood(best, candidate)) ambiguous.add(candidate.provisional.id);
      }
      continue;
    }

    consumed.add(best.provisional.id);
    matches.push({ provisionalId: best.provisional.id, bookedId: target.id });
  }

  return { matches, ambiguous: [...ambiguous].filter((id) => !consumed.has(id)) };
}

/**
 * Provisionals the bank appears never to have booked.
 *
 * @param coverage account id to the latest booking date imported for it. An
 *   account missing from the map has no statement coverage at all, so nothing
 *   on it can be called stale.
 */
export function staleProvisionals(
  provisionals: readonly Transaction[],
  coverage: ReadonlyMap<string, ISODate>,
  today: ISODate,
): readonly string[] {
  const stale: string[] = [];
  for (const provisional of provisionals) {
    if (daysBetween(provisional.bookingDate, today) < PROVISIONAL_STALE_DAYS) continue;
    const coveredTo = coverage.get(provisional.accountId);
    if (!coveredTo) continue;
    if (coveredTo < provisional.bookingDate) continue;
    stale.push(provisional.id);
  }
  return stale;
}
