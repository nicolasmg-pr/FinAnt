import { describe, expect, it } from 'vitest';
import { balanceAsOf, deriveOpeningBalance, reconcileAnchor } from '../src/balance';
import { money } from '../src/money';
import { tx } from './factory';

const EUR = 'EUR';

/** A movement in the account under test. Description is irrelevant to a balance. */
function mv(date: string, amount: number, extra: Partial<Parameters<typeof tx>[0]> = {}) {
  return tx({ date, amount, description: 'MOVEMENT', ...extra });
}

describe('deriveOpeningBalance', () => {
  it('is the asserted balance itself when the account has no movements', () => {
    expect(deriveOpeningBalance([], 100_00, '2026-09-01', EUR)).toEqual(money(100_00, EUR));
  });

  it('subtracts everything booked up to the anchor date', () => {
    const rows = [mv('2026-08-01', 2_600), mv('2026-08-05', -950)];
    // 1650,00 of movements, so the account opened at 1000,00 to hold 2650,00.
    expect(deriveOpeningBalance(rows, 2_650_00, '2026-09-01', EUR)).toEqual(money(1_000_00, EUR));
  });

  it('ignores movements booked after the anchor date', () => {
    const rows = [mv('2026-09-01', -50), mv('2026-09-02', -1_000_000)];
    expect(deriveOpeningBalance(rows, 100_00, '2026-09-01', EUR)).toEqual(money(150_00, EUR));
  });

  it('includes a movement booked exactly on the anchor date', () => {
    const rows = [mv('2026-09-01', -50)];
    expect(deriveOpeningBalance(rows, 100_00, '2026-09-01', EUR)).toEqual(money(150_00, EUR));
  });

  it('counts excluded rows and internal transfers: they moved real money', () => {
    const rows = [
      mv('2026-08-10', -50, { excludedFromStats: true }),
      mv('2026-08-11', -200, { categoryId: 'transfer-internal', categorySource: 'auto' }),
    ];
    expect(deriveOpeningBalance(rows, 100_00, '2026-09-01', EUR)).toEqual(money(350_00, EUR));
  });

  it('rejects a movement in another currency instead of summing it', () => {
    const rows = [{ ...mv('2026-08-01', -50), amount: money(-50_00, 'USD') }];
    expect(() => deriveOpeningBalance(rows, 100_00, '2026-09-01', EUR)).toThrow(TypeError);
  });

  it('refuses a non-integer asserted amount', () => {
    expect(() => deriveOpeningBalance([], 100.5, '2026-09-01', EUR)).toThrow(RangeError);
  });
});

describe('balanceAsOf', () => {
  it('returns the opening balance when nothing has been booked yet', () => {
    const rows = [mv('2026-09-02', -50)];
    expect(balanceAsOf(rows, 1_000_00, '2026-09-01', EUR)).toEqual(money(1_000_00, EUR));
  });

  it('gives back the asserted balance on the anchor date', () => {
    const rows = [mv('2026-08-01', 2_600), mv('2026-08-05', -950), mv('2026-09-10', -30)];
    const opening = deriveOpeningBalance(rows, 2_650_00, '2026-09-01', EUR);
    expect(balanceAsOf(rows, opening.minor, '2026-09-01', EUR)).toEqual(money(2_650_00, EUR));
  });

  it('carries later movements forward', () => {
    const rows = [mv('2026-08-01', 2_600), mv('2026-08-05', -950), mv('2026-09-10', -30)];
    const opening = deriveOpeningBalance(rows, 2_650_00, '2026-09-01', EUR);
    expect(balanceAsOf(rows, opening.minor, '2026-09-30', EUR)).toEqual(money(2_620_00, EUR));
  });

  it('counts excluded rows and internal transfers', () => {
    const rows = [
      mv('2026-09-05', -200, { categoryId: 'transfer-internal', categorySource: 'auto' }),
    ];
    expect(balanceAsOf(rows, 1_000_00, '2026-09-30', EUR)).toEqual(money(800_00, EUR));
  });

  it('rejects a movement in another currency', () => {
    const rows = [{ ...mv('2026-08-01', -50), amount: money(-50_00, 'USD') }];
    expect(() => balanceAsOf(rows, 100_00, '2026-09-01', EUR)).toThrow(TypeError);
  });
});

describe('reconcileAnchor', () => {
  const rows = [mv('2026-08-01', 2_600), mv('2026-08-05', -950)];
  const anchor = {
    assertedMinor: 2_650_00,
    asOf: '2026-09-01',
    openingMinor: 1_000_00,
    currency: EUR,
  };

  it('reports no drift while the history behind the anchor is unchanged', () => {
    expect(reconcileAnchor(rows, anchor)).toEqual({
      expectedOpeningMinor: 1_000_00,
      storedOpeningMinor: 1_000_00,
      driftMinor: 0,
    });
  });

  it('reports no drift for movements booked after the anchor date', () => {
    const later = [...rows, mv('2026-09-02', -500)];
    expect(reconcileAnchor(later, anchor).driftMinor).toBe(0);
  });

  it('reports the drift when history is backfilled behind the anchor', () => {
    const backfilled = [...rows, mv('2026-08-30', -25)];
    // The opening has to rise by 25,00 for the asserted 2650,00 to still hold
    // on 1 Sep, so the drift is the negation of what arrived.
    expect(reconcileAnchor(backfilled, anchor)).toEqual({
      expectedOpeningMinor: 1_025_00,
      storedOpeningMinor: 1_000_00,
      driftMinor: 25_00,
    });
  });

  it('counts a backfilled internal transfer, which moved real money', () => {
    const backfilled = [
      ...rows,
      mv('2026-08-30', -200, { categoryId: 'transfer-internal', categorySource: 'auto' }),
    ];
    expect(reconcileAnchor(backfilled, anchor).driftMinor).toBe(200_00);
  });

  it('rejects a movement in another currency', () => {
    const mixed = [...rows, { ...mv('2026-08-02', -50), amount: money(-50_00, 'USD') }];
    expect(() => reconcileAnchor(mixed, anchor)).toThrow(TypeError);
  });
});
