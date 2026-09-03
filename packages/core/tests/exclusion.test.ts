import { describe, expect, it } from 'vitest';
import { exclusionKeyOf, learnExclusionFrom, shouldExclude, similarTo } from '../src/exclusion';
import type { ExclusionRule } from '../src/exclusion';
import { tx } from './factory';

/** The rule the owner would get by excluding one Mercadona card payment. */
function mercadonaRule(): ExclusionRule {
  const learned = learnExclusionFrom(
    tx({
      date: '2026-01-08',
      amount: -42.15,
      description: 'COMPRA TARJ. 5401 MERCADONA MADRID 12/03',
      counterparty: 'MERCADONA',
    }),
    () => 'excl-1',
  );
  expect(learned).not.toBeNull();
  return learned as ExclusionRule;
}

describe('learnExclusionFrom', () => {
  it('learns a rule that covers the same merchant on another day for another amount', () => {
    const rule = mercadonaRule();
    const later = tx({
      date: '2026-03-19',
      amount: -8.4,
      description: 'COMPRA TARJ. 9911 MERCADONA SEVILLA 19/03',
      counterparty: 'MERCADONA',
    });
    expect(shouldExclude(later, [rule])).toBe(true);
  });

  it('does not cover an unrelated merchant', () => {
    const rule = mercadonaRule();
    const other = tx({ date: '2026-03-19', amount: -8.4, description: 'NETFLIX.COM' });
    expect(shouldExclude(other, [rule])).toBe(false);
  });

  it('declines to learn from a narrative with no merchant identity', () => {
    expect(
      learnExclusionFrom(tx({ date: '2026-01-05', amount: -5, description: '12 34' }), () => 'x'),
    ).toBeNull();
  });

  it('declines to learn when the key is under four characters', () => {
    // "pago" is noise and "4411" is a card fragment, so the key is just "zy".
    expect(
      learnExclusionFrom(
        tx({ date: '2026-01-05', amount: -5, description: 'PAGO ZY 4411' }),
        () => 'x',
      ),
    ).toBeNull();
  });

  it('is enabled and marked as learned', () => {
    const rule = mercadonaRule();
    expect(rule.enabled).toBe(true);
    expect(rule.learned).toBe(true);
    expect(rule.id).toBe('excl-1');
  });

  it('exposes the merchant key it was learned from, for the settings list', () => {
    expect(exclusionKeyOf(mercadonaRule())).toContain('mercadona');
  });
});

describe('shouldExclude', () => {
  it('ignores accents and case, because ES and DE statements are inconsistent about both', () => {
    const rule = learnExclusionFrom(
      tx({ date: '2026-01-05', amount: -18, description: 'CAFÉ MARÍA' }),
      () => 'excl-2',
    );
    expect(rule).not.toBeNull();
    expect(
      shouldExclude(tx({ date: '2026-02-05', amount: -3, description: 'cafe maria' }), [rule!]),
    ).toBe(true);
    expect(
      shouldExclude(tx({ date: '2026-02-06', amount: -3, description: 'CAFE  MARIA*ES' }), [rule!]),
    ).toBe(true);
  });

  it('a disabled rule matches nothing', () => {
    const rule: ExclusionRule = { ...mercadonaRule(), enabled: false };
    const later = tx({ date: '2026-03-19', amount: -8.4, description: 'MERCADONA SEVILLA' });
    expect(shouldExclude(later, [rule])).toBe(false);
    expect(similarTo([later], rule)).toEqual([]);
  });

  it('is false with no rules at all', () => {
    expect(
      shouldExclude(tx({ date: '2026-03-19', amount: -8.4, description: 'MERCADONA' }), []),
    ).toBe(false);
  });

  it('is true when any one of several rules matches', () => {
    const netflix = learnExclusionFrom(
      tx({ date: '2026-01-05', amount: -12.99, description: 'NETFLIX.COM' }),
      () => 'excl-3',
    );
    const rules = [mercadonaRule(), netflix!];
    expect(
      shouldExclude(tx({ date: '2026-04-05', amount: -12.99, description: 'NETFLIX.COM' }), rules),
    ).toBe(true);
  });
});

describe('similarTo', () => {
  it('includes the movement the rule was learned from', () => {
    const source = tx({
      date: '2026-01-08',
      amount: -42.15,
      description: 'COMPRA TARJ. 5401 MERCADONA MADRID 12/03',
      counterparty: 'MERCADONA',
      id: 'source',
    });
    const rule = learnExclusionFrom(source, () => 'excl-1');
    const matched = similarTo([source], rule!);
    expect(matched.map((m) => m.id)).toEqual(['source']);
  });

  it('returns every match and nothing else, preserving the given order', () => {
    const rule = mercadonaRule();
    const ledger = [
      tx({ date: '2026-01-08', amount: -42.15, description: 'MERCADONA MADRID', id: 'a' }),
      tx({ date: '2026-02-08', amount: -19, description: 'REWE SAGT DANKE', id: 'b' }),
      tx({ date: '2026-03-08', amount: -7.2, description: 'compra mercadona sevilla', id: 'c' }),
    ];
    expect(similarTo(ledger, rule).map((m) => m.id)).toEqual(['a', 'c']);
  });

  it('is pure over what it is given: filtering deleted rows is the caller job', () => {
    // The domain Transaction never carries `deleted_at`; the repository drops
    // soft-deleted rows before anything here sees them. So the contract is only
    // that similarTo adds nothing and reorders nothing.
    const rule = mercadonaRule();
    const ledger = [tx({ date: '2026-01-08', amount: -42.15, description: 'MERCADONA', id: 'a' })];
    const before = [...ledger];
    const matched = similarTo(ledger, rule);
    expect(ledger).toEqual(before);
    expect(matched).not.toBe(ledger);
    expect(matched.every((m) => ledger.includes(m))).toBe(true);
  });
});
