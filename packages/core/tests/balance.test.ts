import { describe, expect, it } from 'vitest';
import { balanceAt, openingBalance, type BalanceAnchor } from '../src/balance';
import { money } from '../src/money';
import { tx } from './factory';

const EUR = 'EUR';

/** A movement in the account under test. Description is irrelevant to a balance. */
function mv(date: string, amount: number, extra: Partial<Parameters<typeof tx>[0]> = {}) {
  return tx({ date, amount, description: 'MOVEMENT', ...extra });
}

/** What the owner said the account held, and the day they said it of. */
function anchor(assertedMinor: number, asOf: string, currency = EUR): BalanceAnchor {
  return { assertedMinor, asOf, currency };
}

describe('balanceAt', () => {
  it('gives back the asserted figure on the day it was asserted of', () => {
    const rows = [mv('2026-08-01', 2_600), mv('2026-08-05', -950)];
    expect(balanceAt(rows, anchor(2_650_00, '2026-09-07'), '2026-09-07')).toEqual(
      money(2_650_00, EUR),
    );
  });

  it('is unmoved by history imported behind the anchor date', () => {
    // The whole point: the owner asserts what they hold today, then imports
    // this year. Today's figure is theirs, not the sum of the statements.
    const anchored = anchor(272_19, '2026-09-07');
    const imported = [mv('2026-01-15', -500), mv('2026-04-02', -350), mv('2026-07-30', -218.45)];
    expect(balanceAt(imported, anchored, '2026-09-07')).toEqual(money(272_19, EUR));
  });

  it('counts a movement dated on the anchor day as already inside the figure', () => {
    const rows = [mv('2026-09-07', -100)];
    expect(balanceAt(rows, anchor(500_00, '2026-09-07'), '2026-09-07')).toEqual(money(500_00, EUR));
  });

  it('carries movements after the anchor forward', () => {
    const rows = [mv('2026-09-10', -30), mv('2026-09-20', 100)];
    expect(balanceAt(rows, anchor(2_650_00, '2026-09-07'), '2026-09-30')).toEqual(
      money(2_720_00, EUR),
    );
  });

  it('runs the ledger backwards for a day before the anchor', () => {
    // Held 272,19 on 7 Sep; 218,45 went out on 30 Jul, so 30 Jul closed on
    // 490,64 and the day before it opened there too.
    const rows = [mv('2026-07-30', -218.45)];
    const anchored = anchor(272_19, '2026-09-07');
    expect(balanceAt(rows, anchored, '2026-07-30')).toEqual(money(272_19, EUR));
    expect(balanceAt(rows, anchored, '2026-07-29')).toEqual(money(490_64, EUR));
  });

  it('walks back through several movements in order', () => {
    const rows = [mv('2026-01-15', -500), mv('2026-04-02', -350), mv('2026-07-30', -218.45)];
    const anchored = anchor(272_19, '2026-09-07');
    expect(balanceAt(rows, anchored, '2026-06-30')).toEqual(money(490_64, EUR));
    expect(balanceAt(rows, anchored, '2026-02-01')).toEqual(money(840_64, EUR));
    expect(balanceAt(rows, anchored, '2026-01-14')).toEqual(money(1_340_64, EUR));
  });

  it('counts excluded rows and internal transfers: they moved real money', () => {
    const rows = [
      mv('2026-09-10', -200, { categoryId: 'transfer-internal', categorySource: 'auto' }),
      mv('2026-09-11', -50, { excludedFromStats: true }),
    ];
    expect(balanceAt(rows, anchor(1_000_00, '2026-09-07'), '2026-09-30')).toEqual(
      money(750_00, EUR),
    );
  });

  it('rejects a movement in another currency instead of summing it', () => {
    const rows = [{ ...mv('2026-09-10', -50), amount: money(-50_00, 'USD') }];
    expect(() => balanceAt(rows, anchor(100_00, '2026-09-07'), '2026-09-30')).toThrow(TypeError);
  });

  it('refuses a non-integer asserted amount', () => {
    expect(() => balanceAt([], anchor(100.5, '2026-09-07'), '2026-09-07')).toThrow(RangeError);
  });
});

describe('openingBalance', () => {
  it('is what the account held before its first movement', () => {
    const rows = [mv('2026-01-15', -500), mv('2026-07-30', -218.45)];
    // 272,19 held on 7 Sep, 718,45 spent since 15 Jan, so the year opened at 990,64.
    expect(openingBalance(rows, anchor(272_19, '2026-09-07'))).toEqual(money(990_64, EUR));
  });

  it('is the asserted figure itself when there are no movements', () => {
    expect(openingBalance([], anchor(272_19, '2026-09-07'))).toEqual(money(272_19, EUR));
  });

  it('ignores movements booked after the anchor when looking backwards', () => {
    const rows = [mv('2026-01-15', -500), mv('2026-09-20', -9_999)];
    expect(openingBalance(rows, anchor(272_19, '2026-09-07'))).toEqual(money(772_19, EUR));
  });
});
