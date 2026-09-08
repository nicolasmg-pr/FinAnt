import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER } from '@finant/core';
import type { ISODate } from '@finant/core';
import { buildOutputSchema, buildPrompt } from '../src/prompt';
import { INITIAL_STATE } from '../src/resolve';
import type { PromptInput } from '../src/prompt';

const input: PromptInput = {
  today: '2026-09-08' as ISODate,
  locale: 'de-DE',
  categories: [
    { id: 'groceries', name: 'Lebensmittel' },
    { id: 'rent', name: 'Miete' },
  ],
  accounts: [{ id: 'acc-current', name: 'Girokonto' }],
  state: INITIAL_STATE,
  message: 'wie viel für Lebensmittel in den letzten drei Monaten?',
};

describe('buildPrompt', () => {
  it("hands the model today's date, so it never has to know it", () => {
    expect(buildPrompt(input).system).toContain('2026-09-08');
  });

  it('lists the ids the owner actually has, with their own labels', () => {
    const { system } = buildPrompt(input);

    expect(system).toContain('groceries');
    expect(system).toContain('Lebensmittel');
    expect(system).toContain('acc-current');
    expect(system).toContain('Girokonto');
  });

  it('carries the previous filter so a follow-up can patch it', () => {
    const { system } = buildPrompt({
      ...input,
      state: { filter: { ...EMPTY_FILTER, categoryIds: ['groceries'] }, aggregate: 'sum' },
    });

    expect(system).toContain('"categoryIds":["groceries"]');
  });

  it('passes the typed message through untranslated', () => {
    expect(buildPrompt(input).user).toBe(input.message);
  });
});

describe('buildPrompt — nothing from a statement reaches the model', () => {
  it('reads only the id and the name off an account, never an IBAN', () => {
    // The parameter type has no `iban`, but an object carrying one is
    // structurally assignable, which is exactly how a leak would arrive.
    const withIban = { id: 'acc-current', name: 'Girokonto', iban: 'DE89370400440532013000' };

    const { system } = buildPrompt({ ...input, accounts: [withIban] });

    expect(system).not.toContain('DE89370400440532013000');
  });

  it('reads only the id and the name off a category', () => {
    const withExtras = { id: 'groceries', name: 'Lebensmittel', color: '#ff0000', icon: 'cart' };

    const { system } = buildPrompt({ ...input, categories: [withExtras] });

    expect(system).not.toContain('#ff0000');
  });

  it('never mentions a movement, because it is never given one', () => {
    const { system, user } = buildPrompt(input);
    const everything = `${system}\n${user}`;

    for (const leak of ['counterparty', 'bookingDate', 'importHash', 'externalId']) {
      expect(everything).not.toContain(leak);
    }
  });
});

describe('buildOutputSchema', () => {
  it('enumerates the owner’s category ids, so an invented one is unrepresentable', () => {
    const schema = buildOutputSchema({
      categoryIds: ['groceries', 'rent'],
      accountIds: ['acc-current'],
    });

    expect(schema.properties.categoryIds.items.enum).toEqual(['groceries', 'rent']);
    expect(schema.properties.accountIds.items.enum).toEqual(['acc-current']);
  });

  it('constrains the aggregate and the side to the values the resolver knows', () => {
    const schema = buildOutputSchema({ categoryIds: [], accountIds: [] });

    expect(schema.properties.aggregate.enum).toEqual(['sum', 'count', 'average', 'none']);
    expect(schema.properties.side.enum).toEqual(['income', 'expense', 'all']);
  });

  it('allows no key the patch contract does not define', () => {
    const schema = buildOutputSchema({ categoryIds: [], accountIds: [] });

    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual([
      'accountIds',
      'aggregate',
      'categoryIds',
      'maxEuros',
      'minEuros',
      'range',
      'side',
      'text',
    ]);
  });
});
