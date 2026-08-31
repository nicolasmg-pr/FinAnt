import { exponentOf, money, type CurrencyCode, type Money } from '@finant/core';

/**
 * Explicit formats beat guessing. 03/04/2026 is 3 April in Madrid and Berlin,
 * and 4 March in a US-locale spreadsheet — there is no way to tell from the
 * value alone, so a profile states the format and 'auto' is only a fallback.
 */
export type DateFormat =
  | 'auto'
  | 'YYYY-MM-DD'
  | 'DD/MM/YYYY'
  | 'MM/DD/YYYY'
  | 'DD.MM.YYYY'
  | 'DD-MM-YYYY'
  | 'YYYY/MM/DD';

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  // Two-digit years in bank exports are always recent, never 19xx.
  return y >= 70 ? 1900 + y : 2000 + y;
}

export function parseDate(raw: string, format: DateFormat = 'auto'): string | null {
  const value = raw.trim();
  if (value === '') return null;

  // Spreadsheet serial dates (Google Sheets / Excel epoch 1899-12-30).
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    const days = Math.floor(Number(value));
    const ms = Date.UTC(1899, 11, 30) + days * 86_400_000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const m = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(value);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);

  switch (format) {
    case 'YYYY-MM-DD':
    case 'YYYY/MM/DD':
      return iso(a, b, c);
    case 'MM/DD/YYYY':
      return iso(expandYear(c), a, b);
    case 'DD/MM/YYYY':
    case 'DD.MM.YYYY':
    case 'DD-MM-YYYY':
      return iso(expandYear(c), b, a);
    case 'auto':
      if (String(m[1]).length === 4) return iso(a, b, c);
      // Day-first is the European default; only an impossible day forces month-first.
      if (a > 12 || b <= 12) return iso(expandYear(c), b, a);
      return iso(expandYear(c), a, b);
  }
}

export type DecimalSeparator = 'auto' | ',' | '.';

/**
 * Parses an amount cell into minor units. Handles "1.234,56" (ES/DE),
 * "1,234.56" (EN), bare "45,90", parentheses for negatives, and a trailing or
 * leading currency symbol.
 */
export function parseAmount(
  raw: string,
  currency: CurrencyCode,
  separator: DecimalSeparator = 'auto',
): Money | null {
  let value = raw.trim();
  if (value === '') return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/[^\d,.\-+]/g, '');
  if (value === '' || value === '-' || value === '+') return null;
  if (value.startsWith('-')) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith('+')) {
    value = value.slice(1);
  }

  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let decimalAt = -1;
  if (separator === ',') decimalAt = lastComma;
  else if (separator === '.') decimalAt = lastDot;
  else if (lastComma >= 0 && lastDot >= 0) decimalAt = Math.max(lastComma, lastDot);
  else if (lastComma >= 0 || lastDot >= 0) {
    const only = Math.max(lastComma, lastDot);
    const tail = value.length - only - 1;
    // Exactly three trailing digits with no other separator is a thousands
    // group ("1.234"), not a fractional part — unless the value is short.
    decimalAt = tail === 3 && only > 0 ? -1 : only;
  }

  const digitsOnly = (s: string) => s.replace(/[^\d]/g, '');
  const whole = decimalAt >= 0 ? digitsOnly(value.slice(0, decimalAt)) : digitsOnly(value);
  const frac = decimalAt >= 0 ? digitsOnly(value.slice(decimalAt + 1)) : '';
  if (whole === '' && frac === '') return null;

  const exp = exponentOf(currency);
  const minor = Number(`${whole || '0'}${frac.padEnd(exp, '0').slice(0, exp)}`);
  if (!Number.isSafeInteger(minor)) return null;
  return money(negative ? -minor : minor, currency);
}
