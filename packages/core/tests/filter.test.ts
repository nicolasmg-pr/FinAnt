import { describe, expect, it } from 'vitest';
import { UNCATEGORISED_ID } from '../src/categories';
import {
  EMPTY_FILTER,
  activeFilterCount,
  dateRangePreset,
  filterTransactions,
  matchesFilter,
  presetOf,
  usedCategoryIds,
  type TransactionFilter,
} from '../src/filter';
import { tx } from './factory';

const filter = (partial: Partial<TransactionFilter>): TransactionFilter => ({
  ...EMPTY_FILTER,
  ...partial,
});

const cafe = tx({
  date: '2026-03-02',
  amount: -3.2,
  description: 'CAFÉ MARÍA',
  counterparty: 'Cafe Maria SL',
  categoryId: 'food-restaurants',
});
const salary = tx({
  date: '2026-03-01',
  amount: 2400,
  description: 'Gehalt Februar',
  counterparty: 'ARBEITGEBER AG',
  categoryId: 'income-salary',
  accountId: 'acc-2',
});
const unknown = tx({ date: '2026-02-10', amount: -80, description: 'ROSSMANN 4711' });

const all = [cafe, salary, unknown];

describe('EMPTY_FILTER', () => {
  it('matches every movement', () => {
    expect(filterTransactions(all, EMPTY_FILTER)).toEqual(all);
  });

  it('counts as no active filters', () => {
    expect(activeFilterCount(EMPTY_FILTER)).toBe(0);
  });
});

describe('text search', () => {
  it('ignores case and accents', () => {
    expect(matchesFilter(cafe, filter({ text: 'cafe maria' }))).toBe(true);
    expect(matchesFilter(cafe, filter({ text: 'CAFÉ' }))).toBe(true);
  });

  it('searches the counterparty as well as the description', () => {
    expect(matchesFilter(salary, filter({ text: 'arbeitgeber' }))).toBe(true);
  });

  it('searches the reference', () => {
    const withReference = tx({ date: '2026-03-04', amount: -12, description: 'Lastschrift' });
    const referenced = { ...withReference, reference: 'RG-Nr. 151168750' };
    expect(matchesFilter(referenced, filter({ text: '151168750' }))).toBe(true);
  });

  it('does not match an unrelated narrative', () => {
    expect(matchesFilter(salary, filter({ text: 'cafe' }))).toBe(false);
  });

  it('treats whitespace-only text as no filter at all', () => {
    expect(activeFilterCount(filter({ text: '   ' }))).toBe(0);
    expect(filterTransactions(all, filter({ text: '   ' }))).toEqual(all);
  });
});

describe('account filter', () => {
  it('keeps only the chosen accounts', () => {
    expect(filterTransactions(all, filter({ accountIds: ['acc-2'] }))).toEqual([salary]);
  });

  it('treats an empty list as every account', () => {
    expect(filterTransactions(all, filter({ accountIds: [] }))).toEqual(all);
  });
});

describe('category filter', () => {
  it('keeps only the chosen categories', () => {
    expect(filterTransactions(all, filter({ categoryIds: ['income-salary'] }))).toEqual([salary]);
  });

  it('matches a movement with no category at all under "uncategorised"', () => {
    expect(filterTransactions(all, filter({ categoryIds: [UNCATEGORISED_ID] }))).toEqual([unknown]);
  });
});

describe('date range', () => {
  it('includes both ends', () => {
    expect(filterTransactions(all, filter({ from: '2026-03-01', to: '2026-03-02' }))).toEqual([
      cafe,
      salary,
    ]);
  });

  it('accepts an open end', () => {
    expect(filterTransactions(all, filter({ from: '2026-03-02', to: null }))).toEqual([cafe]);
    expect(filterTransactions(all, filter({ from: null, to: '2026-02-28' }))).toEqual([unknown]);
  });
});

describe('side filter', () => {
  it('keeps one side of the ledger', () => {
    expect(filterTransactions(all, filter({ side: 'income' }))).toEqual([salary]);
    expect(filterTransactions(all, filter({ side: 'expense' }))).toEqual([cafe, unknown]);
  });

  it('keeps a refund on the expense side despite its positive sign', () => {
    const refund = tx({
      date: '2026-03-03',
      amount: 20,
      description: 'Erstattung',
      side: 'expense',
    });
    expect(matchesFilter(refund, filter({ side: 'expense' }))).toBe(true);
    expect(matchesFilter(refund, filter({ side: 'income' }))).toBe(false);
  });
});

describe('amount range', () => {
  it('compares the magnitude, so a range finds both an 80 charge and an 80 credit', () => {
    expect(filterTransactions(all, filter({ minMinor: 5000, maxMinor: 10000 }))).toEqual([unknown]);
    const credit = tx({ date: '2026-03-05', amount: 80, description: 'Erstattung' });
    expect(matchesFilter(credit, filter({ minMinor: 5000, maxMinor: 10000 }))).toBe(true);
  });

  it('accepts an open end', () => {
    expect(filterTransactions(all, filter({ minMinor: 100000, maxMinor: null }))).toEqual([salary]);
  });
});

describe('combining filters', () => {
  it('requires every active filter to match', () => {
    expect(filterTransactions(all, filter({ text: 'cafe', side: 'income' }))).toEqual([]);
    expect(filterTransactions(all, filter({ text: 'cafe', side: 'expense' }))).toEqual([cafe]);
  });

  it('counts each active dimension once', () => {
    expect(activeFilterCount(filter({ text: 'cafe', side: 'expense', from: '2026-01-01' }))).toBe(
      3,
    );
    expect(activeFilterCount(filter({ from: '2026-01-01', to: '2026-12-31' }))).toBe(1);
    expect(activeFilterCount(filter({ minMinor: 100, maxMinor: 200 }))).toBe(1);
  });
});

describe('dateRangePreset', () => {
  it('covers the whole calendar month, including days still to come', () => {
    expect(dateRangePreset('this-month', '2026-03-09')).toEqual({
      from: '2026-03-01',
      to: '2026-03-31',
    });
  });

  it('spans three calendar months back to the first of the earliest', () => {
    expect(dateRangePreset('last-3-months', '2026-03-09')).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('crosses the year boundary backwards', () => {
    expect(dateRangePreset('last-3-months', '2026-01-15')).toEqual({
      from: '2025-11-01',
      to: '2026-01-31',
    });
  });

  it('covers the calendar year', () => {
    expect(dateRangePreset('this-year', '2026-03-09')).toEqual({
      from: '2026-01-01',
      to: '2026-12-31',
    });
  });

  it('returns no bounds at all for "all"', () => {
    expect(dateRangePreset('all', '2026-03-09')).toEqual({ from: null, to: null });
  });

  it('names the preset a filter currently matches, so a chip can read as selected', () => {
    expect(presetOf(filter({ from: '2026-03-01', to: '2026-03-31' }), '2026-03-09')).toBe(
      'this-month',
    );
    expect(presetOf(EMPTY_FILTER, '2026-03-09')).toBe('all');
    expect(presetOf(filter({ from: '2026-02-07', to: null }), '2026-03-09')).toBe(null);
  });
});

describe('usedCategoryIds', () => {
  it('never repeats an id, even though "uncategorised" is itself a built-in category', () => {
    const ids = usedCategoryIds(all);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists uncategorised once, first, so the chip for it leads the row', () => {
    const ids = usedCategoryIds(all);
    expect(ids[0]).toBe(UNCATEGORISED_ID);
    expect(ids.filter((id) => id === UNCATEGORISED_ID)).toEqual([UNCATEGORISED_ID]);
  });

  it('treats an explicit uncategorised id and a null category as the same chip', () => {
    const explicit = tx({
      date: '2026-03-06',
      amount: -9,
      description: 'X',
      categoryId: UNCATEGORISED_ID,
    });
    const ids = usedCategoryIds([...all, explicit]);
    expect(ids.filter((id) => id === UNCATEGORISED_ID)).toEqual([UNCATEGORISED_ID]);
  });

  it('offers only the categories the ledger actually uses', () => {
    expect(usedCategoryIds([salary])).toEqual(['income-salary']);
  });

  it('has nothing to offer for an empty ledger', () => {
    expect(usedCategoryIds([])).toEqual([]);
  });
});
