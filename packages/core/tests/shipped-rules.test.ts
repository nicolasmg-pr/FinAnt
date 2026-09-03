import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  isShippedRuleId,
  parseRetiredShippedRules,
  shippedRulesToInstall,
} from '../src/default-rules';
import type { CategoryRule } from '../src/types';

const rule = (id: string): CategoryRule => ({
  id,
  categoryId: 'shopping',
  priority: 100,
  enabled: true,
  learned: false,
  match: { kind: 'contains', field: 'any', value: 'x' },
});

const shipped = [rule('r-a'), rule('r-b'), rule('r-c')];

describe('shippedRulesToInstall', () => {
  it('installs everything on a database that holds no rules yet', () => {
    expect(shippedRulesToInstall(shipped, [], []).map((r) => r.id)).toEqual(['r-a', 'r-b', 'r-c']);
  });

  it('installs only what is missing, so an existing rule is never overwritten', () => {
    expect(shippedRulesToInstall(shipped, ['r-a'], []).map((r) => r.id)).toEqual(['r-b', 'r-c']);
  });

  it('never resurrects a shipped rule the owner deleted', () => {
    expect(shippedRulesToInstall(shipped, [], ['r-b']).map((r) => r.id)).toEqual(['r-a', 'r-c']);
  });

  it('has nothing to do once every shipped rule is present or retired', () => {
    expect(shippedRulesToInstall(shipped, ['r-a', 'r-c'], ['r-b'])).toEqual([]);
  });

  it('knows which ids are ours, so deleting a learned rule leaves no tombstone', () => {
    expect(isShippedRuleId('r-salary')).toBe(true);
    expect(isShippedRuleId('e2b1c0d4-0000-4000-8000-000000000000')).toBe(false);
  });

  it('ships rules for both halves of the insurance split', () => {
    const ids = DEFAULT_RULES.map((r) => r.id);
    expect(ids).toContain('r-insurance-health');
    expect(ids).toContain('r-insurance-car');
  });
});

describe('parseRetiredShippedRules', () => {
  it('reads a stored list of rule ids', () => {
    expect(parseRetiredShippedRules('["r-rent","r-taxes"]')).toEqual(['r-rent', 'r-taxes']);
  });

  it('reads an unset value as no tombstones', () => {
    expect(parseRetiredShippedRules(null)).toEqual([]);
  });

  it('reads a corrupt value as no tombstones rather than failing the open', () => {
    expect(parseRetiredShippedRules('{not json')).toEqual([]);
    expect(parseRetiredShippedRules('"r-rent"')).toEqual([]);
  });

  it('drops entries that are not ids', () => {
    expect(parseRetiredShippedRules('["r-rent",7,null]')).toEqual(['r-rent']);
  });
});
