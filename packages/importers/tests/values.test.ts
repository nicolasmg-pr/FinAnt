import { describe, expect, it } from 'vitest';
import { parseAmount, parseDate } from '../src/values';

describe('parseAmount', () => {
  it('reads Spanish and German thousands formatting', () => {
    expect(parseAmount('1.234,56', 'EUR')?.minor).toBe(123456);
    expect(parseAmount('-1.234,56 €', 'EUR')?.minor).toBe(-123456);
  });

  it('reads English formatting', () => {
    expect(parseAmount('1,234.56', 'EUR')?.minor).toBe(123456);
  });

  it('reads a bare comma decimal', () => {
    expect(parseAmount('45,90', 'EUR')?.minor).toBe(4590);
  });

  it('treats a lone three-digit group as thousands, not cents', () => {
    expect(parseAmount('1.234', 'EUR')?.minor).toBe(123400);
    expect(parseAmount('1,234', 'EUR')?.minor).toBe(123400);
  });

  it('honours an explicit separator over the heuristic', () => {
    // With '.' declared as the decimal separator, "1.234" is one euro twenty-three,
    // not one thousand two hundred. Extra decimals are truncated, never rounded up.
    expect(parseAmount('1.234', 'EUR', '.')?.minor).toBe(123);
    expect(parseAmount('12.34', 'EUR', '.')?.minor).toBe(1234);
    expect(parseAmount('1.234', 'EUR', ',')?.minor).toBe(123400);
  });

  it('reads accounting parentheses as negative', () => {
    expect(parseAmount('(89,00)', 'EUR')?.minor).toBe(-8900);
  });

  it('returns null for empty and non-numeric cells', () => {
    expect(parseAmount('', 'EUR')).toBeNull();
    expect(parseAmount('n/a', 'EUR')).toBeNull();
  });
});

describe('parseDate', () => {
  it('defaults to day-first, the European convention', () => {
    expect(parseDate('03/04/2026')).toBe('2026-04-03');
    expect(parseDate('03.04.2026')).toBe('2026-04-03');
  });

  it('honours an explicit US format', () => {
    expect(parseDate('03/04/2026', 'MM/DD/YYYY')).toBe('2026-03-04');
  });

  it('passes ISO through', () => {
    expect(parseDate('2026-04-03')).toBe('2026-04-03');
  });

  it('expands two-digit years into this century', () => {
    expect(parseDate('03/04/26')).toBe('2026-04-03');
  });

  it('reads a spreadsheet serial date', () => {
    expect(parseDate('45000')).toBe('2023-03-15');
  });

  it('returns null rather than a wrong date', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate('sin fecha')).toBeNull();
  });
});

describe('parseDate with month names', () => {
  it('reads a German abbreviated month, with or without its full stop', () => {
    expect(parseDate('05 Sep. 2025')).toBe('2025-09-05');
    expect(parseDate('1 Mai 2026')).toBe('2026-05-01');
    expect(parseDate('17 Dez 2025')).toBe('2025-12-17');
  });

  it('reads the German months that are spelled differently from English', () => {
    expect(parseDate('03 Mär 2026')).toBe('2026-03-03');
    expect(parseDate('03 Maerz 2026')).toBe('2026-03-03');
    expect(parseDate('09 Okt. 2025')).toBe('2025-10-09');
  });

  it('reads a Spanish abbreviated month', () => {
    expect(parseDate('05 sept. 2025')).toBe('2025-09-05');
    expect(parseDate('20 dic. 2025')).toBe('2025-12-20');
    expect(parseDate('02 ene 2026')).toBe('2026-01-02');
  });

  it('reads an English month', () => {
    expect(parseDate('7 Jun 2026')).toBe('2026-06-07');
  });

  it('tolerates the extra whitespace a two-line table cell leaves behind', () => {
    expect(parseDate('05 Sep.   2025')).toBe('2025-09-05');
  });

  it('refuses a month it does not recognise rather than guessing one', () => {
    expect(parseDate('05 Xyz 2025')).toBe(null);
  });

  it('does not let a month name override an explicit numeric format', () => {
    expect(parseDate('05/09/2025', 'DD/MM/YYYY')).toBe('2025-09-05');
  });
});
