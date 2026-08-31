/**
 * Money is stored as an integer number of minor units (cents) plus an ISO 4217
 * code. Floating point never touches a balance: 0.1 + 0.2 !== 0.3 is not an
 * acceptable rounding story for someone's rent.
 */
export type CurrencyCode = string;

export interface Money {
  /** Signed integer minor units. Negative = money out. */
  readonly minor: number;
  readonly currency: CurrencyCode;
}

/** Minor-unit exponent per currency. Defaults to 2; listed here are the exceptions we may meet in the EEA. */
const EXPONENTS: Record<string, number> = {
  ISK: 0,
  HUF: 2, // HUF has 2 in ISO 4217 even though fillér is out of circulation
  JPY: 0,
  KRW: 0,
};

export function exponentOf(currency: CurrencyCode): number {
  return EXPONENTS[currency.toUpperCase()] ?? 2;
}

export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`money() requires integer minor units, received ${minor}`);
  }
  return { minor, currency: currency.toUpperCase() };
}

export function zero(currency: CurrencyCode): Money {
  return money(0, currency);
}

/** Parses a decimal string such as "-1234.56" into minor units. No float arithmetic on the way. */
export function parseDecimal(input: string, currency: CurrencyCode): Money {
  const cleaned = input.trim().replace(/[\s\u00a0\u202f]/g, '');
  const match = /^([+-]?)(\d*)(?:[.,](\d+))?$/.exec(cleaned);
  if (!match) throw new SyntaxError(`Cannot parse amount: ${JSON.stringify(input)}`);
  const [, sign, whole = '', frac = ''] = match;
  if (whole === '' && frac === '') throw new SyntaxError(`Cannot parse amount: ${JSON.stringify(input)}`);
  const exp = exponentOf(currency);
  const fracPadded = frac.padEnd(exp, '0');
  if (fracPadded.length > exp) {
    throw new RangeError(`Amount ${input} has more decimals than ${currency} allows (${exp})`);
  }
  const minor = Number(`${whole || '0'}${fracPadded}`);
  return money(sign === '-' ? -minor : minor, currency);
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor + b.minor, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.minor - b.minor, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.minor, a.currency);
}

export function abs(a: Money): Money {
  return money(Math.abs(a.minor), a.currency);
}

export function sum(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => add(acc, m), zero(currency));
}

/** Half-up rounding on the minor unit, so a 1/3 split of 100 cents stays 100 cents in total. */
export function scale(a: Money, factor: number): Money {
  return money(Math.round(a.minor * factor), a.currency);
}

export function isIncome(a: Money): boolean {
  return a.minor > 0;
}

export function isExpense(a: Money): boolean {
  return a.minor < 0;
}

export function toDecimalString(a: Money): string {
  const exp = exponentOf(a.currency);
  const sign = a.minor < 0 ? '-' : '';
  const digits = Math.abs(a.minor).toString().padStart(exp + 1, '0');
  if (exp === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

/** Locale-aware display string. `locale` is a BCP 47 tag: en-GB, es-ES, de-DE. */
export function formatMoney(a: Money, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: a.currency,
    minimumFractionDigits: exponentOf(a.currency),
  }).format(a.minor / 10 ** exponentOf(a.currency));
}
