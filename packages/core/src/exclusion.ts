import { matches, targetOf } from './categorise';
import { merchantKey } from './normalise';
import type { RuleMatch, Transaction } from './types';

/**
 * A standing instruction to keep a kind of movement out of the statistics.
 *
 * It carries no category, which is exactly why it is not a `CategoryRule`: a
 * category rule always files a movement somewhere, an exclusion rule only says
 * "this does not count". Excluding never touches an amount or a balance — the
 * movement stays in the ledger, in its account, with its own category; it is
 * only dropped by `countsTowardStats()` when the totals and the forecast are
 * computed.
 *
 * There is no priority: exclusion is not a contest between rules. Any enabled
 * rule that matches is enough.
 */
export interface ExclusionRule {
  readonly id: string;
  readonly match: RuleMatch;
  readonly enabled: boolean;
  /** Set when the rule came from the owner excluding one movement by hand. */
  readonly learned: boolean;
}

/** The narrative fields a rule is evaluated against. */
type Matchable = Pick<Transaction, 'description' | 'counterparty' | 'reference' | 'amount'>;

/**
 * Builds an exclusion rule from one movement the owner just excluded, so the
 * same merchant is kept out of the statistics next month and on the next
 * import.
 *
 * Returns null when the narrative yields no usable merchant key. The gate is
 * the same as `learnRuleFrom`'s and for the same reason: guessing from two
 * characters would quietly swallow half a statement, and an exclusion is harder
 * to notice than a wrong category because the movement simply stops counting.
 */
export function learnExclusionFrom(tx: Matchable, idFactory: () => string): ExclusionRule | null {
  const key = merchantKey(tx.counterparty ?? tx.description);
  if (key.length < 4) return null;
  return {
    id: idFactory(),
    match: { kind: 'contains', field: 'any', value: key },
    enabled: true,
    learned: true,
  };
}

/** True when any enabled rule covers this movement. */
export function shouldExclude(tx: Matchable, rules: readonly ExclusionRule[]): boolean {
  if (rules.length === 0) return false;
  const target = targetOf(tx);
  return rules.some((rule) => rule.enabled && matches(rule.match, target));
}

/**
 * Every movement one rule covers, in the order given.
 *
 * The screen calls this before the owner commits, so it can say how many
 * movements the switch is about to change, and again on the undo path to say
 * how many it is about to bring back.
 *
 * Pure over what it is handed: it adds nothing, reorders nothing and reads no
 * storage. A disabled rule covers nothing, and soft-deleted rows never reach
 * here — the repository filters `deleted_at` before any caller sees a
 * `Transaction`.
 */
export function similarTo(txs: readonly Transaction[], rule: ExclusionRule): Transaction[] {
  if (!rule.enabled) return [];
  return txs.filter((tx) => matches(rule.match, targetOf(tx)));
}

/**
 * The merchant key a learned rule was built from, for the settings list. A rule
 * the owner cannot read is a rule that quietly eats their statistics. Returns
 * null for a shape that has no single key to show.
 */
export function exclusionKeyOf(rule: ExclusionRule): string | null {
  const { match } = rule;
  return match.kind === 'contains' || match.kind === 'startsWith' ? match.value : null;
}
