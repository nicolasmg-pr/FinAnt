import { describe, expect, it } from 'vitest';
import { TRANSFER_MAX_DAYS, matchTransfers } from '../src/transfers';
import { tx } from './factory';

/** One leg of a transfer: a debit in one account or the credit in another. */
function leg(
  id: string,
  accountId: string,
  date: string,
  amount: number,
  extra: {
    categoryId?: string | null;
    categorySource?: 'auto' | 'manual' | 'none';
    transferPeerId?: string | null;
    excludedFromStats?: boolean;
  } = {},
) {
  return tx({ id, accountId, date, amount, description: 'TRANSFER', ...extra });
}

describe('matchTransfers', () => {
  it('pairs a debit with the opposite credit in another account', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-02', 50),
    ]);
    expect(pairs).toEqual([{ outId: 'out', inId: 'in' }]);
  });

  it('refuses to pair rows from the same account', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'ing', '2026-09-01', 50),
    ]);
    expect(pairs).toEqual([]);
  });

  it('refuses amounts that do not cancel out exactly', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-01', 50.01),
    ]);
    expect(pairs).toEqual([]);
  });

  it('respects the day window on both sides', () => {
    const inside = matchTransfers([
      leg('out', 'ing', '2026-09-04', -50),
      leg('in', 'dkb', '2026-09-01', 50),
    ]);
    expect(inside).toEqual([{ outId: 'out', inId: 'in' }]);

    const outside = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-05', 50),
    ]);
    expect(outside).toEqual([]);
  });

  it('exposes the default window and honours an override', () => {
    expect(TRANSFER_MAX_DAYS).toBe(3);
    const rows = [leg('out', 'ing', '2026-09-01', -50), leg('in', 'dkb', '2026-09-08', 50)];
    expect(matchTransfers(rows)).toEqual([]);
    expect(matchTransfers(rows, { maxDays: 7 })).toEqual([{ outId: 'out', inId: 'in' }]);
  });

  it('never touches a row the owner categorised by hand', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50, { categoryId: 'savings', categorySource: 'manual' }),
      leg('in', 'dkb', '2026-09-01', 50),
    ]);
    expect(pairs).toEqual([]);
  });

  it('never touches an excluded row', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-01', 50, { excludedFromStats: true }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('skips rows that are already linked, so a second run is a no-op', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50, {
        categoryId: 'transfer-internal',
        categorySource: 'auto',
        transferPeerId: 'in',
      }),
      leg('in', 'dkb', '2026-09-01', 50, {
        categoryId: 'transfer-internal',
        categorySource: 'auto',
        transferPeerId: 'out',
      }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('uses a credit once when two debits compete', () => {
    const pairs = matchTransfers([
      leg('far', 'ing', '2026-09-01', -50),
      leg('near', 'raisin', '2026-09-03', -50),
      leg('in', 'dkb', '2026-09-03', 50),
    ]);
    // Debits are visited by date: `far` (1 Sep) is inside the window and
    // claims the only credit; `near` finds nothing left.
    expect(pairs).toEqual([{ outId: 'far', inId: 'in' }]);
  });

  it('gives each debit the closest unmatched credit', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-03', -50),
      leg('early', 'dkb', '2026-09-01', 50),
      leg('same-day', 'dkb', '2026-09-03', 50),
    ]);
    expect(pairs).toEqual([{ outId: 'out', inId: 'same-day' }]);
  });

  it('breaks a distance tie by date then id', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-02', -50),
      leg('b', 'dkb', '2026-09-03', 50),
      leg('a', 'dkb', '2026-09-01', 50),
    ]);
    // Both credits are one day away; the earlier one wins.
    expect(pairs).toEqual([{ outId: 'out', inId: 'a' }]);

    const sameDate = matchTransfers([
      leg('out', 'ing', '2026-09-02', -50),
      leg('b', 'dkb', '2026-09-02', 50),
      leg('a', 'dkb', '2026-09-02', 50),
    ]);
    expect(sameDate).toEqual([{ outId: 'out', inId: 'a' }]);
  });

  it('returns pairs in debit order regardless of input order', () => {
    const rows = [
      leg('in-2', 'dkb', '2026-09-10', 20),
      leg('out-2', 'ing', '2026-09-10', -20),
      leg('in-1', 'dkb', '2026-09-01', 50),
      leg('out-1', 'ing', '2026-09-01', -50),
    ];
    const expected = [
      { outId: 'out-1', inId: 'in-1' },
      { outId: 'out-2', inId: 'in-2' },
    ];
    expect(matchTransfers(rows)).toEqual(expected);
    expect(matchTransfers([...rows].reverse())).toEqual(expected);
  });

  it('still links a transfer a shipped rule already categorised', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50, {
        categoryId: 'transfer-internal',
        categorySource: 'auto',
      }),
      leg('in', 'dkb', '2026-09-01', 50),
    ]);
    expect(pairs).toEqual([{ outId: 'out', inId: 'in' }]);
  });

  it('ignores zero amounts and unrelated movements', () => {
    const pairs = matchTransfers([
      leg('zero-a', 'ing', '2026-09-01', 0),
      leg('zero-b', 'dkb', '2026-09-01', 0),
      leg('rent', 'ing', '2026-09-01', -950),
      leg('salary', 'dkb', '2026-09-01', 2600),
    ]);
    expect(pairs).toEqual([]);
  });
});
