import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, dateRangePreset } from '@finant/core';
import type { ISODate } from '@finant/core';
import { INITIAL_STATE, applyPatch, parsePatch } from '../src/resolve';
import type { AskContext, AskState } from '../src/schema';

const TODAY = '2026-09-08' as ISODate;

const ctx: AskContext = {
  today: TODAY,
  currency: 'EUR',
  categoryIds: ['groceries', 'rent', 'salary'],
  accountIds: ['acc-current', 'acc-savings'],
};

function state(overrides: Partial<AskState> = {}): AskState {
  return { ...INITIAL_STATE, ...overrides };
}

describe('applyPatch — patch semantics', () => {
  it('leaves every dimension the patch omits untouched', () => {
    const previous = state({
      filter: { ...EMPTY_FILTER, categoryIds: ['groceries'], side: 'expense' },
      aggregate: 'sum',
    });

    const { state: next } = applyPatch(
      previous,
      { range: { kind: 'month', yearMonth: '2026-07' } },
      ctx,
    );

    expect(next.filter.categoryIds).toEqual(['groceries']);
    expect(next.filter.side).toBe('expense');
    expect(next.aggregate).toBe('sum');
    expect(next.filter.from).toBe('2026-07-01');
  });

  it('an explicit null clears a dimension, which an omission never does', () => {
    const previous = state({ filter: { ...EMPTY_FILTER, text: 'lidl' } });

    expect(applyPatch(previous, {}, ctx).state.filter.text).toBe('lidl');
    expect(applyPatch(previous, { text: null }, ctx).state.filter.text).toBe('');
  });

  it('reset drops back to the empty filter before applying the rest of the patch', () => {
    const previous = state({
      filter: { ...EMPTY_FILTER, categoryIds: ['groceries'], text: 'lidl' },
      aggregate: 'sum',
    });

    const { state: next } = applyPatch(previous, { reset: true, side: 'income' }, ctx);

    expect(next.filter.categoryIds).toEqual([]);
    expect(next.filter.text).toBe('');
    expect(next.filter.side).toBe('income');
    expect(next.aggregate).toBe('none');
  });
});

describe('applyPatch — the model never does date arithmetic', () => {
  it('resolves a preset through core, so the bounds are the ones the filter sheet uses', () => {
    const { state: next } = applyPatch(
      state(),
      { range: { kind: 'preset', preset: 'last-3-months' } },
      ctx,
    );

    expect({ from: next.filter.from, to: next.filter.to }).toEqual(
      dateRangePreset('last-3-months', TODAY),
    );
  });

  it('treats monthsBack as inclusive of the current month', () => {
    const { state: next } = applyPatch(state(), { range: { kind: 'monthsBack', months: 3 } }, ctx);

    expect({ from: next.filter.from, to: next.filter.to }).toEqual(
      dateRangePreset('last-3-months', TODAY),
    );
  });

  it('bounds a named month by its real last day, leap years included', () => {
    const feb = applyPatch(state(), { range: { kind: 'month', yearMonth: '2028-02' } }, ctx);
    expect(feb.state.filter.from).toBe('2028-02-01');
    expect(feb.state.filter.to).toBe('2028-02-29');

    const jul = applyPatch(state(), { range: { kind: 'month', yearMonth: '2026-07' } }, ctx);
    expect(jul.state.filter.to).toBe('2026-07-31');
  });

  it('crosses a year boundary without the model subtracting anything', () => {
    const january = { ...ctx, today: '2026-01-15' as ISODate };
    const { state: next } = applyPatch(
      state(),
      { range: { kind: 'monthsBack', months: 3 } },
      january,
    );

    expect(next.filter.from).toBe('2025-11-01');
  });

  it('rejects an unparseable explicit date and leaves the range alone', () => {
    const previous = state({ filter: { ...EMPTY_FILTER, from: '2026-01-01', to: '2026-03-31' } });

    const { state: next, issues } = applyPatch(
      previous,
      { range: { kind: 'explicit', from: '2026-13-45' as ISODate, to: null } },
      ctx,
    );

    expect(next.filter.from).toBe('2026-01-01');
    expect(next.filter.to).toBe('2026-03-31');
    expect(issues).toContainEqual({ kind: 'bad-date', value: '2026-13-45' });
  });

  it('accepts an open-ended explicit range', () => {
    const { state: next } = applyPatch(
      state(),
      { range: { kind: 'explicit', from: '2026-05-01' as ISODate, to: null } },
      ctx,
    );

    expect(next.filter.from).toBe('2026-05-01');
    expect(next.filter.to).toBeNull();
  });
});

describe('applyPatch — the model never scales euros to minor units', () => {
  it('converts a whole-euro string', () => {
    const { state: next } = applyPatch(state(), { minEuros: '50' }, ctx);
    expect(next.filter.minMinor).toBe(5000);
  });

  it('converts a decimal string, comma or point', () => {
    expect(applyPatch(state(), { maxEuros: '12.50' }, ctx).state.filter.maxMinor).toBe(1250);
    expect(applyPatch(state(), { maxEuros: '12,50' }, ctx).state.filter.maxMinor).toBe(1250);
  });

  it('stores a magnitude, so a model that signs the bound cannot invert it', () => {
    expect(applyPatch(state(), { minEuros: '-50' }, ctx).state.filter.minMinor).toBe(5000);
  });

  it('clears a bound on an explicit null', () => {
    const previous = state({ filter: { ...EMPTY_FILTER, minMinor: 5000 } });
    expect(applyPatch(previous, { minEuros: null }, ctx).state.filter.minMinor).toBeNull();
  });

  it('reports an unparseable amount and leaves the bound alone', () => {
    const previous = state({ filter: { ...EMPTY_FILTER, minMinor: 5000 } });
    const { state: next, issues } = applyPatch(previous, { minEuros: 'a lot' }, ctx);

    expect(next.filter.minMinor).toBe(5000);
    expect(issues).toContainEqual({ kind: 'bad-amount', value: 'a lot' });
  });
});

describe('applyPatch — ids the owner does not have', () => {
  it('keeps the known ids and reports the invented one', () => {
    const { state: next, issues } = applyPatch(
      state(),
      { categoryIds: ['groceries', 'yachts'] },
      ctx,
    );

    expect(next.filter.categoryIds).toEqual(['groceries']);
    expect(issues).toContainEqual({ kind: 'unknown-category', id: 'yachts' });
  });

  it('leaves the dimension untouched when every id was invented', () => {
    const previous = state({ filter: { ...EMPTY_FILTER, categoryIds: ['rent'] } });
    const { state: next } = applyPatch(previous, { categoryIds: ['yachts'] }, ctx);

    expect(next.filter.categoryIds).toEqual(['rent']);
  });

  it('applies the same rule to accounts', () => {
    const { state: next, issues } = applyPatch(
      state(),
      { accountIds: ['acc-savings', 'acc-cayman'] },
      ctx,
    );

    expect(next.filter.accountIds).toEqual(['acc-savings']);
    expect(issues).toContainEqual({ kind: 'unknown-account', id: 'acc-cayman' });
  });

  it('clears a dimension on an empty array, which is how "all accounts" is said', () => {
    const previous = state({ filter: { ...EMPTY_FILTER, accountIds: ['acc-current'] } });
    expect(applyPatch(previous, { accountIds: [] }, ctx).state.filter.accountIds).toEqual([]);
  });
});

describe('parsePatch', () => {
  it('reads a well-formed patch', () => {
    const { patch, issues } = parsePatch('{"categoryIds":["groceries"],"aggregate":"sum"}');

    expect(patch).toEqual({ categoryIds: ['groceries'], aggregate: 'sum' });
    expect(issues).toEqual([]);
  });

  it('drops keys the contract does not define rather than failing the turn', () => {
    const { patch } = parsePatch('{"categoryIds":["rent"],"vibes":"good"}');
    expect(patch).toEqual({ categoryIds: ['rent'] });
  });

  it('drops a key whose type is wrong and says so', () => {
    const { patch, issues } = parsePatch('{"side":"sideways","text":"lidl"}');

    expect(patch).toEqual({ text: 'lidl' });
    expect(issues).toContainEqual({ kind: 'bad-field', field: 'side' });
  });

  it('reports malformed output instead of throwing', () => {
    expect(parsePatch('not json').issues).toEqual([{ kind: 'malformed-output' }]);
    expect(parsePatch('[1,2,3]').issues).toEqual([{ kind: 'malformed-output' }]);
  });

  it('tolerates the prose a model sometimes wraps around its JSON', () => {
    const { patch } = parsePatch('Sure! ```json\n{"aggregate":"count"}\n```');
    expect(patch).toEqual({ aggregate: 'count' });
  });
});

describe('applyPatch — "last month" has its own intent', () => {
  it('resolves the single month before this one', () => {
    const { state: next } = applyPatch(state(), { range: { kind: 'monthAgo', months: 1 } }, ctx);

    expect(next.filter.from).toBe('2026-08-01');
    expect(next.filter.to).toBe('2026-08-31');
  });

  it('crosses a year boundary', () => {
    const january = { ...ctx, today: '2026-01-20' as ISODate };
    const { state: next } = applyPatch(
      state(),
      { range: { kind: 'monthAgo', months: 1 } },
      january,
    );

    expect(next.filter.from).toBe('2025-12-01');
    expect(next.filter.to).toBe('2025-12-31');
  });

  it('is not the same window as monthsBack, which is a span', () => {
    const single = applyPatch(state(), { range: { kind: 'monthAgo', months: 1 } }, ctx);
    const span = applyPatch(state(), { range: { kind: 'monthsBack', months: 2 } }, ctx);

    expect(single.state.filter.from).toBe('2026-08-01');
    expect(span.state.filter.from).toBe('2026-08-01');
    expect(single.state.filter.to).toBe('2026-08-31');
    expect(span.state.filter.to).toBe('2026-09-31');
  });
});
