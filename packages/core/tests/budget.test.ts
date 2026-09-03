import { describe, expect, it } from 'vitest';
import { money } from '../src/money';
import { budgetMonth, budgetPeriod, NEAR_LIMIT_RATIO } from '../src/budget';
import type { Period } from '../src/period';
import type { Budget } from '../src/types';
import { tx } from './factory';

const EUR = 'EUR';

function budget(categoryId: string, limit: number): Budget {
  return { categoryId, monthlyLimit: money(Math.round(limit * 100), EUR) };
}

describe('budgetMonth', () => {
  it('reports spend against a limit as a positive magnitude', () => {
    const txs = [
      tx({
        date: '2026-08-03',
        amount: -120,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
      tx({ date: '2026-08-19', amount: -80, description: 'LIDL', categoryId: 'food-groceries' }),
    ];
    const [progress] = budgetMonth(txs, [budget('food-groceries', 400)], '2026-08', EUR).categories;

    expect(progress?.spent).toEqual(money(20_000, EUR));
    expect(progress?.limit).toEqual(money(40_000, EUR));
    expect(progress?.remaining).toEqual(money(20_000, EUR));
    expect(progress?.ratio).toBeCloseTo(0.5);
    expect(progress?.state).toBe('under');
    expect(progress?.transactionCount).toBe(2);
  });

  it('ignores movements outside the month', () => {
    const txs = [
      tx({ date: '2026-07-31', amount: -100, description: 'JULY', categoryId: 'food-groceries' }),
      tx({ date: '2026-08-01', amount: -100, description: 'AUGUST', categoryId: 'food-groceries' }),
      tx({
        date: '2026-09-01',
        amount: -100,
        description: 'SEPTEMBER',
        categoryId: 'food-groceries',
      }),
    ];
    const [progress] = budgetMonth(txs, [budget('food-groceries', 400)], '2026-08', EUR).categories;

    expect(progress?.spent).toEqual(money(10_000, EUR));
  });

  it('lets a refund reduce the month it was booked in', () => {
    const txs = [
      tx({ date: '2026-08-03', amount: -200, description: 'ZARA', categoryId: 'shopping' }),
      tx({
        date: '2026-08-10',
        amount: 50,
        description: 'ZARA DEVOLUCION',
        categoryId: 'shopping',
        side: 'expense',
      }),
    ];
    const [progress] = budgetMonth(txs, [budget('shopping', 300)], '2026-08', EUR).categories;

    expect(progress?.spent).toEqual(money(15_000, EUR));
    expect(progress?.remaining).toEqual(money(15_000, EUR));
  });

  it('never counts income towards an expense budget', () => {
    const txs = [
      tx({ date: '2026-08-25', amount: 2600, description: 'NOMINA', categoryId: 'income-salary' }),
      tx({
        date: '2026-08-03',
        amount: -100,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
    ];
    const month = budgetMonth(txs, [budget('food-groceries', 400)], '2026-08', EUR);

    expect(month.categories[0]?.spent).toEqual(money(10_000, EUR));
    expect(month.unbudgetedSpent).toEqual(money(0, EUR));
  });

  it('excludes internal transfers and rows flagged by the owner', () => {
    const txs = [
      tx({
        date: '2026-08-02',
        amount: -500,
        description: 'AHORRO',
        categoryId: 'transfer-internal',
      }),
      tx({
        date: '2026-08-04',
        amount: -60,
        description: 'DUPLICADO',
        categoryId: 'food-groceries',
        excludedFromStats: true,
      }),
      tx({
        date: '2026-08-05',
        amount: -40,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
    ];
    const month = budgetMonth(
      txs,
      [budget('food-groceries', 400), budget('transfer-internal', 100)],
      '2026-08',
      EUR,
    );

    expect(month.categories.find((c) => c.categoryId === 'food-groceries')?.spent).toEqual(
      money(4_000, EUR),
    );
    expect(month.categories.find((c) => c.categoryId === 'transfer-internal')?.spent).toEqual(
      money(0, EUR),
    );
  });

  it('flags a category that crossed its limit', () => {
    const txs = [
      tx({
        date: '2026-08-03',
        amount: -450,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
    ];
    const [progress] = budgetMonth(txs, [budget('food-groceries', 400)], '2026-08', EUR).categories;

    expect(progress?.state).toBe('over');
    expect(progress?.remaining).toEqual(money(-5_000, EUR));
    expect(progress?.ratio).toBeCloseTo(1.125);
  });

  it('warns before the limit is reached', () => {
    const spent = Math.round(400 * NEAR_LIMIT_RATIO) + 1;
    const txs = [
      tx({
        date: '2026-08-03',
        amount: -spent,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
    ];
    const [progress] = budgetMonth(txs, [budget('food-groceries', 400)], '2026-08', EUR).categories;

    expect(progress?.state).toBe('near');
  });

  it('treats a category whose refunds outweigh its spending as unspent', () => {
    const txs = [
      tx({
        date: '2026-08-10',
        amount: 30,
        description: 'DEVOLUCION',
        categoryId: 'shopping',
        side: 'expense',
      }),
    ];
    const [progress] = budgetMonth(txs, [budget('shopping', 300)], '2026-08', EUR).categories;

    expect(progress?.spent).toEqual(money(-3_000, EUR));
    expect(progress?.ratio).toBe(0);
    expect(progress?.state).toBe('under');
  });

  it('sorts the tightest budget first', () => {
    const txs = [
      tx({
        date: '2026-08-03',
        amount: -390,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
      tx({ date: '2026-08-04', amount: -20, description: 'CINE', categoryId: 'leisure' }),
    ];
    const month = budgetMonth(
      txs,
      [budget('leisure', 200), budget('food-groceries', 400)],
      '2026-08',
      EUR,
    );

    expect(month.categories.map((c) => c.categoryId)).toEqual(['food-groceries', 'leisure']);
  });

  it('keeps a budget with no movements in the list', () => {
    const month = budgetMonth([], [budget('sport', 50)], '2026-08', EUR);

    expect(month.categories).toHaveLength(1);
    expect(month.categories[0]?.spent).toEqual(money(0, EUR));
    expect(month.categories[0]?.ratio).toBe(0);
  });

  it('totals limits, spend and the remainder across budgets', () => {
    const txs = [
      tx({
        date: '2026-08-03',
        amount: -450,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
      tx({ date: '2026-08-04', amount: -20, description: 'CINE', categoryId: 'leisure' }),
    ];
    const month = budgetMonth(
      txs,
      [budget('food-groceries', 400), budget('leisure', 200)],
      '2026-08',
      EUR,
    );

    expect(month.totalLimit).toEqual(money(60_000, EUR));
    expect(month.totalSpent).toEqual(money(47_000, EUR));
    expect(month.totalRemaining).toEqual(money(13_000, EUR));
  });

  it('reports expense outside any budget separately', () => {
    const txs = [
      tx({
        date: '2026-08-03',
        amount: -100,
        description: 'MERCADONA',
        categoryId: 'food-groceries',
      }),
      tx({ date: '2026-08-06', amount: -950, description: 'ALQUILER', categoryId: 'housing-rent' }),
      tx({ date: '2026-08-07', amount: -15, description: 'SIN CATEGORIA' }),
    ];
    const month = budgetMonth(txs, [budget('food-groceries', 400)], '2026-08', EUR);

    expect(month.unbudgetedSpent).toEqual(money(96_500, EUR));
  });

  it('marks a zero limit as over as soon as anything is spent', () => {
    const txs = [
      tx({ date: '2026-08-03', amount: -10, description: 'CINE', categoryId: 'leisure' }),
    ];
    const [progress] = budgetMonth(txs, [budget('leisure', 0)], '2026-08', EUR).categories;

    expect(progress?.state).toBe('over');
    expect(progress?.ratio).toBe(Number.POSITIVE_INFINITY);
  });

  it('refuses a budget denominated in another currency', () => {
    const foreign: Budget = { categoryId: 'leisure', monthlyLimit: money(5_000, 'USD') };

    expect(() => budgetMonth([], [foreign], '2026-08', EUR)).toThrow(TypeError);
  });

  it('ignores a duplicate budget for the same category', () => {
    const month = budgetMonth([], [budget('leisure', 200), budget('leisure', 300)], '2026-08', EUR);

    expect(month.categories).toHaveLength(1);
    expect(month.totalLimit).toEqual(money(20_000, EUR));
  });
});

describe('budgetPeriod', () => {
  const period: Period = { from: '2026-07-28', to: '2026-08-27', anchored: true };

  it('counts spend from the first to the last day of the period, both inclusive', () => {
    const txs = [
      tx({ date: '2026-07-27', amount: -10, description: 'BEFORE', categoryId: 'food-groceries' }),
      tx({
        date: '2026-07-28',
        amount: -20,
        description: 'FIRST DAY',
        categoryId: 'food-groceries',
      }),
      tx({
        date: '2026-08-27',
        amount: -30,
        description: 'LAST DAY',
        categoryId: 'food-groceries',
      }),
      tx({ date: '2026-08-28', amount: -40, description: 'AFTER', categoryId: 'food-groceries' }),
    ];
    const result = budgetPeriod(txs, [budget('food-groceries', 400)], period, EUR);

    expect(result.categories[0]?.spent).toEqual(money(5_000, EUR));
    expect(result.categories[0]?.transactionCount).toBe(2);
    expect(result.totalSpent).toEqual(money(5_000, EUR));
    expect(result.period).toEqual(period);
  });

  it('runs to the end of the ledger when the period is open', () => {
    const open: Period = { from: '2026-08-28', to: null, anchored: true };
    const txs = [
      tx({ date: '2026-08-28', amount: -20, description: 'DAY ONE', categoryId: 'food-groceries' }),
      tx({
        date: '2026-12-24',
        amount: -60,
        description: 'FAR AHEAD',
        categoryId: 'food-groceries',
      }),
    ];
    const result = budgetPeriod(txs, [budget('food-groceries', 400)], open, EUR);

    expect(result.categories[0]?.spent).toEqual(money(8_000, EUR));
  });

  it('keeps transfers and excluded rows out of every budget and out of unbudgeted spend', () => {
    const txs = [
      tx({ date: '2026-08-01', amount: -100, description: 'LIDL', categoryId: 'food-groceries' }),
      tx({
        date: '2026-08-02',
        amount: -500,
        description: 'TO SAVINGS',
        categoryId: 'transfer-internal',
      }),
      tx({ date: '2026-08-03', amount: -80, description: 'SAVEBACK', excludedFromStats: true }),
      tx({ date: '2026-08-04', amount: -15, description: 'CINEMA', categoryId: 'leisure' }),
    ];
    const result = budgetPeriod(txs, [budget('food-groceries', 400)], period, EUR);

    expect(result.categories[0]?.spent).toEqual(money(10_000, EUR));
    expect(result.unbudgetedSpent).toEqual(money(1_500, EUR));
  });
});
