import { describe, expect, it } from 'vitest';
import { matchProvisionals, staleProvisionals } from '../src/provisional';
import { tx } from './factory';

function provisional(partial: Parameters<typeof tx>[0]) {
  return tx({ ...partial, provisional: true, source: 'notification' });
}

describe('matchProvisionals', () => {
  it('matches an exact same-day pair', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -42.3, description: 'REWE SAGT DANKE' });
    const result = matchProvisionals([p], [b]);
    expect(result.matches).toEqual([{ provisionalId: 'p1', bookedId: 'b1' }]);
    expect(result.ambiguous).toEqual([]);
  });

  it('matches a card payment that books three days later for the same amount', () => {
    const p = provisional({
      id: 'p1',
      date: '2026-03-10',
      amount: -42.3,
      description: 'TRATTORIA',
    });
    const b = tx({
      id: 'b1',
      date: '2026-03-13',
      amount: -42.3,
      description: 'TRATTORIA DA MARIO',
    });
    expect(matchProvisionals([p], [b]).matches).toEqual([{ provisionalId: 'p1', bookedId: 'b1' }]);
  });

  it('refuses a pair four days apart', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-14', amount: -42.3, description: 'REWE' });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('refuses a pair whose amounts differ by a single cent', () => {
    // No tolerance, by decision: a booked figure that differs from the one the
    // notification announced is a different fact, not a rounding of the same
    // one. A tipped restaurant bill therefore stays unmatched — see the module
    // comment for what that costs and why it is the trade taken.
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -42.31, description: 'REWE' });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('never crosses currencies', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const foreign = { ...b, amount: { minor: b.amount.minor, currency: 'CHF' } };
    expect(matchProvisionals([p], [foreign]).matches).toEqual([]);
  });

  it('never crosses accounts', () => {
    const p = provisional({
      id: 'p1',
      date: '2026-03-10',
      amount: -42.3,
      description: 'REWE',
      accountId: 'acc-1',
    });
    const b = tx({
      id: 'b1',
      date: '2026-03-10',
      amount: -42.3,
      description: 'REWE',
      accountId: 'acc-2',
    });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('never crosses sides, so a refund does not consume a purchase', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({
      id: 'b1',
      date: '2026-03-10',
      amount: 42.3,
      description: 'REWE',
      side: 'expense',
    });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('consumes each provisional at most once', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const b1 = tx({ id: 'b1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const b2 = tx({ id: 'b2', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const result = matchProvisionals([p], [b1, b2]);
    expect(result.matches).toHaveLength(1);
  });

  it('leaves two equally good provisionals alone rather than guessing', () => {
    const p1 = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const p2 = provisional({ id: 'p2', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const result = matchProvisionals([p1, p2], [b]);
    expect(result.matches).toEqual([]);
    expect([...result.ambiguous].sort()).toEqual(['p1', 'p2']);
  });

  it('ignores a booked row that is itself provisional', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const other = provisional({ id: 'p2', date: '2026-03-10', amount: -20, description: 'CAFE' });
    expect(matchProvisionals([p], [other]).matches).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const p1 = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const p2 = provisional({ id: 'p2', date: '2026-03-12', amount: -20, description: 'CAFE' });
    const b = tx({ id: 'b1', date: '2026-03-12', amount: -20, description: 'CAFE' });
    const a = matchProvisionals([p1, p2], [b]);
    const c = matchProvisionals([p2, p1], [b]);
    expect(a.matches).toEqual(c.matches);
    expect(a.matches).toEqual([{ provisionalId: 'p2', bookedId: 'b1' }]);
  });

  it('lets a later unique match consume a provisional an earlier tie left ambiguous', () => {
    // b1 sits one day from both p1 and p2, so it ties and marks both
    // ambiguous without consuming either. b2 then matches p2 exactly
    // (dayDelta 0) while p1 is two days off, so b2 uniquely consumes p2. A
    // provisional flagged ambiguous for one booked row can still be
    // legitimately consumed by another, and the final ambiguous list must not
    // report a provisional a later iteration went on to consume.
    const p1 = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const p2 = provisional({ id: 'p2', date: '2026-03-12', amount: -20, description: 'CAFE' });
    const b1 = tx({ id: 'b1', date: '2026-03-11', amount: -20, description: 'CAFE' });
    const b2 = tx({ id: 'b2', date: '2026-03-12', amount: -20, description: 'CAFE' });
    const result = matchProvisionals([p1, p2], [b1, b2]);
    expect(result.matches).toEqual([{ provisionalId: 'p2', bookedId: 'b2' }]);
    expect(result.ambiguous).toEqual(['p1']);
  });
});

describe('staleProvisionals', () => {
  it('marks a provisional the statements have overtaken', () => {
    const p = provisional({ id: 'p1', date: '2026-01-10', amount: -20, description: 'CAFE' });
    const coverage = new Map([['acc-1', '2026-03-31']]);
    expect(staleProvisionals([p], coverage, '2026-04-01')).toEqual(['p1']);
  });

  it('leaves a young provisional alone', () => {
    const p = provisional({ id: 'p1', date: '2026-03-20', amount: -20, description: 'CAFE' });
    const coverage = new Map([['acc-1', '2026-03-31']]);
    expect(staleProvisionals([p], coverage, '2026-04-01')).toEqual([]);
  });

  it('leaves an old provisional alone when no statement covers its date', () => {
    const p = provisional({ id: 'p1', date: '2026-01-10', amount: -20, description: 'CAFE' });
    const coverage = new Map([['acc-1', '2025-12-31']]);
    expect(staleProvisionals([p], coverage, '2026-04-01')).toEqual([]);
  });

  it('leaves an old provisional alone when the account was never imported', () => {
    const p = provisional({ id: 'p1', date: '2026-01-10', amount: -20, description: 'CAFE' });
    expect(staleProvisionals([p], new Map(), '2026-04-01')).toEqual([]);
  });
});
