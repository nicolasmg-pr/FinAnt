import { describe, expect, it } from 'vitest';
import { recategorise } from '../src/categorise';
import type { CategoryRule } from '../src/types';
import { tx } from './factory';

const rentRule: CategoryRule = {
  id: 'r-rent',
  categoryId: 'housing-rent',
  priority: 300,
  enabled: true,
  learned: false,
  match: { kind: 'contains', field: 'any', value: 'miete' },
};

describe('recategorise', () => {
  it('proposes the category a rule now gives a row the rules once got wrong', () => {
    const row = tx({
      date: '2026-03-02',
      amount: -945,
      description: 'Miete',
      categoryId: 'housing-utilities',
      categorySource: 'auto',
      id: 't-1',
    });
    expect(recategorise([row], [rentRule])).toEqual([
      { id: 't-1', categoryId: 'housing-rent', ruleId: 'r-rent' },
    ]);
  });

  it('leaves a row the owner classified by hand completely alone', () => {
    const row = tx({
      date: '2026-03-02',
      amount: -945,
      description: 'Miete',
      categoryId: 'shopping',
      categorySource: 'manual',
    });
    expect(recategorise([row], [rentRule])).toEqual([]);
  });

  it('leaves a matched internal transfer alone, or the matcher would be undone', () => {
    const row = tx({
      date: '2026-03-02',
      amount: -500,
      description: 'Miete',
      categoryId: 'transfer-internal',
      categorySource: 'auto',
      transferPeerId: 't-other',
    });
    expect(recategorise([row], [rentRule])).toEqual([]);
  });

  it('proposes nothing for a row whose category is already right', () => {
    const row = tx({
      date: '2026-03-02',
      amount: -945,
      description: 'Miete',
      categoryId: 'housing-rent',
      categorySource: 'auto',
    });
    expect(recategorise([row], [rentRule])).toEqual([]);
  });

  it('re-files a row no rule matches any more back to uncategorised', () => {
    const row = tx({
      date: '2026-03-02',
      amount: -50,
      description: 'Echtzeitüberweisung',
      categoryId: 'housing-utilities',
      categorySource: 'auto',
      id: 't-2',
    });
    expect(recategorise([row], [rentRule])).toEqual([
      { id: 't-2', categoryId: 'uncategorised', ruleId: null },
    ]);
  });

  it('picks up a row that was never classified at all', () => {
    const row = tx({
      date: '2026-03-02',
      amount: -945,
      description: 'Miete',
      categoryId: null,
      categorySource: 'none',
      id: 't-3',
    });
    expect(recategorise([row], [rentRule])).toEqual([
      { id: 't-3', categoryId: 'housing-rent', ruleId: 'r-rent' },
    ]);
  });
});
