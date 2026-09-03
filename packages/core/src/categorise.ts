import { UNCATEGORISED_ID } from './categories';
import { merchantKey, normalise } from './normalise';
import type { CategoryRule, MatchField, RuleMatch, Transaction } from './types';

export interface MatchTarget {
  readonly description: string;
  readonly counterparty: string;
  readonly reference: string;
  readonly any: string;
  readonly amountMinor: number;
}

/**
 * The normalised shape every `RuleMatch` is evaluated against. Exported so
 * other rule engines (exclusion rules) reuse this matcher instead of growing a
 * second one that drifts from it.
 */
export function targetOf(
  tx: Pick<Transaction, 'description' | 'counterparty' | 'reference' | 'amount'>,
): MatchTarget {
  const description = normalise(tx.description);
  const counterparty = normalise(tx.counterparty ?? '');
  const reference = normalise(tx.reference ?? '');
  return {
    description,
    counterparty,
    reference,
    any: `${description} ${counterparty} ${reference}`.trim(),
    amountMinor: tx.amount.minor,
  };
}

function fieldValue(target: MatchTarget, field: MatchField): string {
  return target[field];
}

export function matches(rule: RuleMatch, target: MatchTarget): boolean {
  switch (rule.kind) {
    case 'contains':
      return fieldValue(target, rule.field).includes(normalise(rule.value));
    case 'startsWith':
      return fieldValue(target, rule.field).startsWith(normalise(rule.value));
    case 'regex':
      // Rules are authored by us or by the device owner; there is no untrusted
      // author, but a bad pattern must not take the import down.
      try {
        return new RegExp(rule.pattern, rule.flags ?? 'i').test(fieldValue(target, rule.field));
      } catch {
        return false;
      }
    case 'amountBetween':
      return target.amountMinor >= rule.minMinor && target.amountMinor <= rule.maxMinor;
    case 'direction':
      return rule.value === 'income' ? target.amountMinor > 0 : target.amountMinor < 0;
    case 'all':
      return rule.of.every((r) => matches(r, target));
    case 'any':
      return rule.of.some((r) => matches(r, target));
    case 'not':
      return !matches(rule.of, target);
  }
}

export interface CategorisationResult {
  readonly categoryId: string;
  readonly ruleId: string | null;
}

/**
 * Resolves one transaction against the rule set. Highest priority wins; ties
 * break on rule id so two runs over the same data always agree.
 */
export function categorise(
  tx: Pick<Transaction, 'description' | 'counterparty' | 'reference' | 'amount'>,
  rules: readonly CategoryRule[],
): CategorisationResult {
  const target = targetOf(tx);
  let best: CategoryRule | null = null;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (!matches(rule.match, target)) continue;
    if (
      best === null ||
      rule.priority > best.priority ||
      (rule.priority === best.priority && rule.id < best.id)
    ) {
      best = rule;
    }
  }
  return best
    ? { categoryId: best.categoryId, ruleId: best.id }
    : { categoryId: UNCATEGORISED_ID, ruleId: null };
}

/**
 * Builds a rule from a manual re-categorisation, so the same merchant is
 * classified automatically next month. Learned rules sit above shipped rules.
 * Returns null when the narrative yields no usable merchant key — guessing from
 * two characters would mis-file half the statement.
 */
export function learnRuleFrom(
  tx: Pick<Transaction, 'description' | 'counterparty'>,
  categoryId: string,
  idFactory: () => string,
): CategoryRule | null {
  const key = merchantKey(tx.counterparty ?? tx.description);
  if (key.length < 4) return null;
  return {
    id: idFactory(),
    categoryId,
    priority: 1000,
    enabled: true,
    learned: true,
    match: { kind: 'contains', field: 'any', value: key },
  };
}
