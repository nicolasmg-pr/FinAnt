import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, money } from '@finant/core';
import type { ISODate } from '@finant/core';
import { answer } from '../src/answer';
import { INITIAL_STATE } from '../src/resolve';
import type { AskContext, AskState } from '../src/schema';
import { tx } from './factory';

const ctx: AskContext = {
  today: '2026-09-08' as ISODate,
  currency: 'EUR',
  categoryIds: ['groceries', 'salary', 'transfer-internal'],
  accountIds: ['acc-current', 'acc-savings'],
};

function state(overrides: Partial<AskState> = {}): AskState {
  return { ...INITIAL_STATE, ...overrides };
}

describe('answer', () => {
  it('returns the movements the filter selects', () => {
    const rows = [
      tx({ categoryId: 'groceries', amount: money(-6740, 'EUR') }),
      tx({ categoryId: 'salary', side: 'income', amount: money(240000, 'EUR') }),
    ];

    const result = answer(
      rows,
      state({ filter: { ...EMPTY_FILTER, categoryIds: ['groceries'] } }),
      ctx,
    );

    expect(result.matches).toHaveLength(1);
    expect(result.count).toBe(1);
  });

  it('totals the expense side as a positive magnitude, so a refund reduces it', () => {
    const rows = [
      tx({ categoryId: 'groceries', amount: money(-6740, 'EUR') }),
      tx({ categoryId: 'groceries', amount: money(-5210, 'EUR') }),
      // A refund: positive amount, still on the expense side.
      tx({ categoryId: 'groceries', amount: money(2000, 'EUR') }),
    ];

    const result = answer(
      rows,
      state({ filter: { ...EMPTY_FILTER, categoryIds: ['groceries'], side: 'expense' } }),
      ctx,
    );

    expect(result.total).toEqual(money(9950, 'EUR'));
  });

  it('totals the income side without flipping it', () => {
    const rows = [tx({ side: 'income', categoryId: 'salary', amount: money(240000, 'EUR') })];

    const result = answer(rows, state({ filter: { ...EMPTY_FILTER, side: 'income' } }), ctx);

    expect(result.total).toEqual(money(240000, 'EUR'));
  });

  it('gives the signed net when no side was asked for', () => {
    const rows = [
      tx({ side: 'income', amount: money(240000, 'EUR') }),
      tx({ side: 'expense', amount: money(-6740, 'EUR') }),
    ];

    const result = answer(rows, state(), ctx);

    expect(result.total).toEqual(money(233260, 'EUR'));
  });

  it('keeps internal transfers and flagged rows out of the total but still lists them', () => {
    const rows = [
      tx({ categoryId: 'groceries', amount: money(-1000, 'EUR') }),
      tx({ categoryId: 'transfer-internal', amount: money(-50000, 'EUR') }),
      tx({ categoryId: 'groceries', amount: money(-2000, 'EUR'), excludedFromStats: true }),
    ];

    const result = answer(rows, state({ filter: { ...EMPTY_FILTER, side: 'expense' } }), ctx);

    expect(result.matches).toHaveLength(3);
    expect(result.total).toEqual(money(1000, 'EUR'));
    expect(result.issues).toContainEqual({ kind: 'excluded-from-total', count: 2 });
  });

  it('averages over the rows that counted, rounding on the minor unit', () => {
    const rows = [
      tx({ categoryId: 'groceries', amount: money(-1000, 'EUR') }),
      tx({ categoryId: 'groceries', amount: money(-1000, 'EUR') }),
      tx({ categoryId: 'groceries', amount: money(-1000, 'EUR') }),
    ];

    const result = answer(rows, state({ filter: { ...EMPTY_FILTER, side: 'expense' } }), ctx);

    expect(result.total).toEqual(money(3000, 'EUR'));
    expect(result.average).toEqual(money(1000, 'EUR'));
  });

  it('has no average to report when nothing matched', () => {
    const result = answer([], state(), ctx);

    expect(result.count).toBe(0);
    expect(result.total).toEqual(money(0, 'EUR'));
    expect(result.average).toBeNull();
  });

  it('does not report an exclusion issue when nothing was excluded', () => {
    const rows = [tx({ categoryId: 'groceries', amount: money(-1000, 'EUR') })];

    const result = answer(rows, state(), ctx);

    expect(result.issues).toEqual([]);
  });
});
