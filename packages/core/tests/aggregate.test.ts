import { describe, expect, it } from 'vitest';
import { summariseMonth, summarisePeriod } from '../src/aggregate';
import type { Period } from '../src/period';
import { syntheticYear, tx } from './factory';

const EUR = 'EUR';

describe('summariseMonth', () => {
  it('reports the synthetic year month by month, unchanged by the range refactor', () => {
    const txs = syntheticYear();
    for (let m = 1; m <= 12; m += 1) {
      const s = summariseMonth(txs, `2025-${String(m).padStart(2, '0')}`, EUR);
      // Rent 950 + Netflix 12.99 + groceries (180 + m) + restaurant 45.
      const expenses = 118_799 + m * 100;
      expect(s.income.minor).toBe(260_000);
      expect(s.expenses.minor).toBe(expenses);
      expect(s.net.minor).toBe(260_000 - expenses);
      expect(s.transactionCount).toBe(5);
    }
  });

  it('keeps a 31st-of-month booking inside its month and out of the next', () => {
    const txs = [
      tx({ date: '2026-08-31', amount: -10, description: 'LAST OF AUGUST' }),
      tx({ date: '2026-09-01', amount: -20, description: 'FIRST OF SEPTEMBER' }),
    ];
    expect(summariseMonth(txs, '2026-08', EUR).expenses.minor).toBe(1_000);
    expect(summariseMonth(txs, '2026-09', EUR).expenses.minor).toBe(2_000);
  });
});

describe('summarisePeriod', () => {
  const period: Period = { from: '2026-07-28', to: '2026-08-27', anchored: true };

  it('includes both boundary days and nothing beyond them', () => {
    const txs = [
      tx({ date: '2026-07-27', amount: -10, description: 'BEFORE' }),
      tx({ date: '2026-07-28', amount: 2600, description: 'SALARY', categoryId: 'income-salary' }),
      tx({ date: '2026-08-27', amount: -40, description: 'LAST DAY' }),
      tx({ date: '2026-08-28', amount: -50, description: 'AFTER' }),
    ];
    const s = summarisePeriod(txs, period, EUR);
    expect(s.income.minor).toBe(260_000);
    expect(s.expenses.minor).toBe(4_000);
    expect(s.net.minor).toBe(256_000);
    expect(s.transactionCount).toBe(2);
    expect(s.period).toEqual(period);
  });

  it('runs to the end of the ledger when the period is open', () => {
    const open: Period = { from: '2026-08-28', to: null, anchored: true };
    const txs = [
      tx({ date: '2026-08-28', amount: 2600, description: 'SALARY', categoryId: 'income-salary' }),
      tx({ date: '2026-11-30', amount: -20, description: 'FAR AHEAD' }),
    ];
    expect(summarisePeriod(txs, open, EUR).expenses.minor).toBe(2_000);
  });

  it('drops internal transfers and rows the owner excluded', () => {
    const txs = [
      tx({
        date: '2026-08-01',
        amount: -100,
        description: 'GROCERIES',
        categoryId: 'food-groceries',
      }),
      tx({
        date: '2026-08-02',
        amount: -500,
        description: 'TO SAVINGS',
        categoryId: 'transfer-internal',
      }),
      tx({ date: '2026-08-03', amount: -80, description: 'SAVEBACK', excludedFromStats: true }),
    ];
    const s = summarisePeriod(txs, period, EUR);
    expect(s.expenses.minor).toBe(10_000);
    expect(s.transactionCount).toBe(1);
  });
});
