import { describe, expect, it } from 'vitest';
import { categorise, learnRuleFrom } from '../src/categorise';
import { DEFAULT_RULES } from '../src/default-rules';
import { merchantKey, normalise } from '../src/normalise';
import type { CategoryRule } from '../src/types';
import { tx } from './factory';

describe('normalise', () => {
  it('strips diacritics and punctuation so ES/DE narratives collapse', () => {
    expect(normalise('CAFÉ MARÍA*ES')).toBe('cafe maria es');
    expect(normalise('Straße 12')).toBe('strasse 12');
  });

  it('extracts a merchant key free of card and reference noise', () => {
    expect(merchantKey('COMPRA TARJ. 5401 MERCADONA MADRID 12/03')).toContain('mercadona');
    expect(merchantKey('COMPRA TARJ. 5401 MERCADONA MADRID 12/03')).not.toContain('5401');
  });
});

describe('categorise', () => {
  it('files Spanish, German and English narratives into the same category', () => {
    for (const description of ['COMPRA TARJ MERCADONA', 'REWE SAGT DANKE', 'LIDL GMBH']) {
      expect(
        categorise(tx({ date: '2026-01-05', amount: -42, description }), DEFAULT_RULES).categoryId,
      ).toBe('food-groceries');
    }
  });

  it('only treats a salary narrative as income when money came in', () => {
    const incoming = tx({ date: '2026-01-25', amount: 2600, description: 'NOMINA ENERO' });
    const outgoing = tx({
      date: '2026-01-26',
      amount: -2600,
      description: 'DEVOLUCION NOMINA ENERO',
    });
    expect(categorise(incoming, DEFAULT_RULES).categoryId).toBe('income-salary');
    expect(categorise(outgoing, DEFAULT_RULES).categoryId).not.toBe('income-salary');
  });

  it('keeps cash withdrawals and taxes out of discretionary buckets', () => {
    expect(
      categorise(
        tx({ date: '2026-01-05', amount: -100, description: 'REINTEGRO CAJERO' }),
        DEFAULT_RULES,
      ).categoryId,
    ).toBe('cash');
    expect(
      categorise(
        tx({ date: '2026-01-05', amount: -300, description: 'FINANZAMT MUENCHEN STEUER' }),
        DEFAULT_RULES,
      ).categoryId,
    ).toBe('taxes');
  });

  it('falls back to uncategorised rather than guessing', () => {
    const result = categorise(
      tx({ date: '2026-01-05', amount: -20, description: 'XJ4 998211' }),
      DEFAULT_RULES,
    );
    expect(result.categoryId).toBe('uncategorised');
    expect(result.ruleId).toBeNull();
  });

  it('is deterministic when two rules tie on priority', () => {
    const t = tx({ date: '2026-01-05', amount: -10, description: 'AMAZON PRIME' });
    const first = categorise(t, DEFAULT_RULES);
    const second = categorise(t, [...DEFAULT_RULES].reverse());
    expect(first).toEqual(second);
  });

  it('learns a rule from a manual correction that outranks shipped rules', () => {
    const t = tx({
      date: '2026-01-05',
      amount: -35,
      description: 'AMAZON MKTPL',
      counterparty: 'AMAZON MKTPL',
    });
    const learned = learnRuleFrom(t, 'shopping', () => 'learned-1');
    expect(learned).not.toBeNull();
    expect(learned!.priority).toBeGreaterThan(400);
    expect(categorise(t, [...DEFAULT_RULES, learned!]).categoryId).toBe('shopping');
  });

  it('declines to learn from a narrative with no merchant identity', () => {
    expect(
      learnRuleFrom(
        tx({ date: '2026-01-05', amount: -5, description: '12 34' }),
        'shopping',
        () => 'x',
      ),
    ).toBeNull();
  });
});

describe('insurance', () => {
  const at = (description: string) =>
    categorise(tx({ date: '2026-02-03', amount: -89.4, description }), DEFAULT_RULES).categoryId;

  it('files health insurance under its own category in all three languages', () => {
    expect(at('BEITRAG KRANKENVERSICHERUNG FEBRUAR')).toBe('insurance-health');
    expect(at('LASTSCHRIFT KRANKENKASSE')).toBe('insurance-health');
    expect(at('RECIBO SEGURO DE SALUD')).toBe('insurance-health');
    expect(at('HEALTH INSURANCE PREMIUM')).toBe('insurance-health');
  });

  it('files car insurance under its own category in all three languages', () => {
    expect(at('KFZ-VERSICHERUNG JAHRESBEITRAG')).toBe('insurance-car');
    expect(at('AUTOVERSICHERUNG RATE')).toBe('insurance-car');
    expect(at('RECIBO SEGURO DE COCHE')).toBe('insurance-car');
    expect(at('CAR INSURANCE RENEWAL')).toBe('insurance-car');
  });

  it('leaves every other insurance in the general bucket, which keeps its id', () => {
    expect(at('HAUSRATVERSICHERUNG BEITRAG')).toBe('insurance');
    expect(at('RECIBO SEGURO DEL HOGAR')).toBe('insurance');
  });
});

describe('whole-word matching', () => {
  const wordRule = (value: string): CategoryRule => ({
    id: 'r-probe',
    categoryId: 'housing-utilities',
    priority: 100,
    enabled: true,
    learned: false,
    match: { kind: 'word', field: 'any', value },
  });

  const narrative = (description: string) => tx({ date: '2026-03-02', amount: -10, description });

  it('matches a token standing on its own', () => {
    expect(categorise(narrative('RWE Vertrieb AG'), [wordRule('rwe')]).ruleId).toBe('r-probe');
  });

  it('matches a token at the very end of a narrative', () => {
    expect(categorise(narrative('Abschlag RWE'), [wordRule('rwe')]).ruleId).toBe('r-probe');
  });

  it('does not match a token buried inside a longer word', () => {
    // "Überweisung" normalises to "uberweisung", which contains "rwe". This is
    // the false positive that filed every German transfer as a utility bill.
    expect(categorise(narrative('Echtzeitüberweisung'), [wordRule('rwe')]).ruleId).toBe(null);
    expect(
      categorise(narrative('Dauerauftrag / Terminueberweisung'), [wordRule('rwe')]).ruleId,
    ).toBe(null);
  });

  it('matches a multi-word token as a phrase', () => {
    expect(categorise(narrative('E ON Energie Deutschland'), [wordRule('e on')]).ruleId).toBe(
      'r-probe',
    );
    expect(categorise(narrative('Leone Ristorante'), [wordRule('e on')]).ruleId).toBe(null);
  });

  it('ignores case and diacritics like every other matcher', () => {
    expect(categorise(narrative('AOK Bayern'), [wordRule('aok')]).ruleId).toBe('r-probe');
  });
});

describe('shipped rules against ordinary German and Spanish narratives', () => {
  /** Narratives that carry no merchant at all must stay uncategorised. */
  const NEUTRAL = [
    'Echtzeitüberweisung',
    'Dauerauftrag / Terminueberweisung',
    'Gutschrift Echtzeitüberweisung',
    'Überweisung',
    'Lastschrift',
    'Transferencia recibida',
  ];

  it.each(NEUTRAL)('leaves %s uncategorised', (description) => {
    const result = categorise(tx({ date: '2026-03-02', amount: -100, description }), DEFAULT_RULES);
    expect(result.ruleId).toBe(null);
  });
});
