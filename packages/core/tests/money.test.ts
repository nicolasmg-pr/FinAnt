import { describe, expect, it } from 'vitest';
import { add, formatMoney, money, parseDecimal, sum, toDecimalString } from '../src/money';
import { importHashOf } from '../src/dedupe';

describe('money', () => {
  it('parses decimal strings without float drift', () => {
    expect(parseDecimal('1234.56', 'EUR').minor).toBe(123456);
    expect(parseDecimal('-1.234,50'.replace('.', ''), 'EUR').minor).toBe(-123450);
    expect(parseDecimal('0.1', 'EUR').minor).toBe(10);
  });

  it('accepts comma decimal separators used across the EU', () => {
    expect(parseDecimal('45,90', 'EUR').minor).toBe(4590);
  });

  it('keeps 0.1 + 0.2 exact', () => {
    const total = add(parseDecimal('0.1', 'EUR'), parseDecimal('0.2', 'EUR'));
    expect(toDecimalString(total)).toBe('0.30');
  });

  it('rejects more decimals than the currency allows', () => {
    expect(() => parseDecimal('1.234', 'EUR')).toThrow(RangeError);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(100, 'EUR'), money(100, 'CHF'))).toThrow(TypeError);
  });

  it('sums an empty list to zero of the given currency', () => {
    expect(sum([], 'EUR')).toEqual({ minor: 0, currency: 'EUR' });
  });

  it('formats per locale', () => {
    expect(formatMoney(money(-123456, 'EUR'), 'de-DE')).toContain('1.234,56');
    expect(formatMoney(money(-123456, 'EUR'), 'en-GB')).toContain('1,234.56');
  });
});

describe('importHashOf', () => {
  const base = { accountId: 'a', bookingDate: '2025-01-01', amountMinor: -2000, description: 'comida fuera' };

  it('is stable across runs for the same input', () => {
    expect(importHashOf(base)).toBe(importHashOf(base));
  });

  it('separates rows a source repeats verbatim', () => {
    const first = importHashOf({ ...base, discriminator: 0 });
    const second = importHashOf({ ...base, discriminator: 1 });
    expect(first).not.toBe(second);
  });

  it('keeps a discriminated hash distinct from an undiscriminated one', () => {
    expect(importHashOf(base)).not.toBe(importHashOf({ ...base, discriminator: 0 }));
  });
});
