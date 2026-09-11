/**
 * A scaled integer, for the two quantities in a portfolio that `Money` cannot
 * hold: share counts and unit prices.
 *
 * `Money` is fixed at a currency's minor unit — two decimals for the euro. A
 * broker reports `0.7618080000` shares bought at `17.742000`, and rounding
 * either to cents would misstate a holding. So this is a second exact type
 * rather than a change to the first: same rule, no float ever touches a
 * quantity, only the scale differs.
 *
 * It is deliberately *not* used for money. Cost basis comes from the export's
 * own amount column, which is already exact `Money`; multiplying a share count
 * by a unit price would invent rounding error in the one figure that has to be
 * right. See docs/superpowers/specs/2026-09-11-investments-design.md.
 */
export interface Decimal {
  /** Exact integer. The value is `scaled / 10 ** scale`. */
  readonly scaled: number;
  readonly scale: number;
}

/** Share counts arrive with exactly ten decimals in every export we read. */
export const SHARE_SCALE = 10;

/** Unit prices arrive with six or ten; ten holds both without loss. */
export const PRICE_SCALE = 10;

/**
 * Largest whole number of units representable at `SHARE_SCALE`.
 *
 * `Number.MAX_SAFE_INTEGER / 1e10` is about 900,719. Beyond it integer
 * arithmetic stops being exact and a share count would silently drift, so
 * parsing refuses instead. The caller turns that refusal into an import issue
 * and keeps going, exactly as it does for an unreadable date.
 */
export const DECIMAL_MAX_UNITS = Math.floor(Number.MAX_SAFE_INTEGER / 10 ** SHARE_SCALE);

export function decimal(scaled: number, scale: number): Decimal {
  if (!Number.isSafeInteger(scaled)) {
    throw new RangeError(`decimal() requires an exact integer, received ${scaled}`);
  }
  if (!Number.isInteger(scale) || scale < 0) {
    throw new RangeError(`decimal() requires a non-negative integer scale, received ${scale}`);
  }
  return { scaled, scale };
}

export function zeroDecimal(scale: number): Decimal {
  return decimal(0, scale);
}

/**
 * Reads a plain decimal string at a fixed scale.
 *
 * Returns null rather than throwing for anything it cannot represent exactly —
 * a blank cell, a narrative in a numeric column, more decimals than the scale
 * holds, or a magnitude past `DECIMAL_MAX_UNITS`. A parser is expected to
 * report the row and carry on, not to lose an import over one cell.
 */
export function parseDecimalAt(input: string, scale: number): Decimal | null {
  const cleaned = input.trim().replace(/[\s  ]/g, '');
  const match = /^([+-]?)(\d*)(?:[.,](\d+))?$/.exec(cleaned);
  if (!match) return null;
  const [, sign, whole = '', frac = ''] = match;
  if (whole === '' && frac === '') return null;
  if (frac.length > scale) return null;

  const digits = `${whole || '0'}${frac.padEnd(scale, '0')}`;
  const scaled = Number(digits);
  if (!Number.isSafeInteger(scaled)) return null;
  return { scaled: sign === '-' ? -scaled : scaled, scale };
}

function assertSameScale(a: Decimal, b: Decimal): void {
  if (a.scale !== b.scale) {
    throw new TypeError(`Decimal scale mismatch: ${a.scale} vs ${b.scale}`);
  }
}

export function addDecimal(a: Decimal, b: Decimal): Decimal {
  assertSameScale(a, b);
  return decimal(a.scaled + b.scaled, a.scale);
}

export function subtractDecimal(a: Decimal, b: Decimal): Decimal {
  assertSameScale(a, b);
  return decimal(a.scaled - b.scaled, a.scale);
}

export function negateDecimal(a: Decimal): Decimal {
  return decimal(-a.scaled, a.scale);
}

export function absDecimal(a: Decimal): Decimal {
  return decimal(Math.abs(a.scaled), a.scale);
}

export function sumDecimal(items: readonly Decimal[], scale: number): Decimal {
  return items.reduce((acc, d) => addDecimal(acc, d), zeroDecimal(scale));
}

export function isZeroDecimal(a: Decimal): boolean {
  return a.scaled === 0;
}

export function isNegativeDecimal(a: Decimal): boolean {
  return a.scaled < 0;
}

export function compareDecimal(a: Decimal, b: Decimal): number {
  assertSameScale(a, b);
  return a.scaled === b.scaled ? 0 : a.scaled < b.scaled ? -1 : 1;
}

/** Half-up on the target scale, so a run of rescaled values keeps its total. */
export function rescale(a: Decimal, scale: number): Decimal {
  if (scale === a.scale) return a;
  if (scale > a.scale) return decimal(a.scaled * 10 ** (scale - a.scale), scale);
  const divisor = 10 ** (a.scale - scale);
  const sign = a.scaled < 0 ? -1 : 1;
  return decimal(sign * Math.round(Math.abs(a.scaled) / divisor), scale);
}

export function decimalToString(a: Decimal): string {
  const sign = a.scaled < 0 ? '-' : '';
  const digits = Math.abs(a.scaled)
    .toString()
    .padStart(a.scale + 1, '0');
  if (a.scale === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -a.scale)}.${digits.slice(-a.scale)}`;
}

/**
 * Only for display and for handing a quantity to a chart. Everything that
 * decides a figure stays on the integer.
 */
export function decimalToNumber(a: Decimal): number {
  return a.scaled / 10 ** a.scale;
}

/**
 * Locale-aware, trailing zeros dropped: a holding reads "4.2103" and "2"
 * rather than "4.2103000000" and "2.0000000000".
 */
export function formatDecimal(a: Decimal, locale: string, maximumFractionDigits = 6): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(decimalToNumber(a));
}
