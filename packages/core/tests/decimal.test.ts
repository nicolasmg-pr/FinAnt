import { describe, expect, it } from 'vitest';
import {
  DECIMAL_MAX_UNITS,
  addDecimal,
  compareDecimal,
  decimal,
  decimalToNumber,
  formatDecimal,
  isZeroDecimal,
  negateDecimal,
  parseDecimalAt,
  rescale,
  SHARE_SCALE,
  sumDecimal,
  decimalToString as decimalString,
} from '../src/decimal';

describe('decimal', () => {
  it('rejects a non-integer scaled value', () => {
    expect(() => decimal(1.5, SHARE_SCALE)).toThrow(RangeError);
  });

  it('parses a ten-decimal share count exactly', () => {
    const d = parseDecimalAt('0.7618080000', SHARE_SCALE);
    expect(d).toEqual({ scaled: 7618080000, scale: 10 });
  });

  it('parses a six-decimal price into the ten-decimal scale', () => {
    expect(parseDecimalAt('17.742000', SHARE_SCALE)).toEqual({
      scaled: 177420000000,
      scale: 10,
    });
  });

  it('keeps a negative sign', () => {
    expect(parseDecimalAt('-0.8777240000', SHARE_SCALE)?.scaled).toBe(-8777240000);
  });

  it('returns null for an unreadable value rather than throwing', () => {
    expect(parseDecimalAt('', SHARE_SCALE)).toBeNull();
    expect(parseDecimalAt('n/a', SHARE_SCALE)).toBeNull();
  });

  it('returns null past the safe-integer ceiling instead of wrapping', () => {
    // 900_720 units at scale 10 exceeds Number.MAX_SAFE_INTEGER.
    expect(parseDecimalAt('900720', SHARE_SCALE)).toBeNull();
    expect(parseDecimalAt(`${DECIMAL_MAX_UNITS}`, SHARE_SCALE)).not.toBeNull();
  });

  it('refuses more decimals than the scale can hold', () => {
    expect(parseDecimalAt('0.12345678901', SHARE_SCALE)).toBeNull();
  });

  it('adds without floating point drift', () => {
    const a = parseDecimalAt('0.1', SHARE_SCALE)!;
    const b = parseDecimalAt('0.2', SHARE_SCALE)!;
    expect(decimalString(addDecimal(a, b))).toBe('0.3000000000');
  });

  it('sums a run of legs exactly', () => {
    const parts = ['2.0000000000', '0.7618080000', '-0.8777240000'].map(
      (s) => parseDecimalAt(s, SHARE_SCALE)!,
    );
    expect(decimalString(sumDecimal(parts, SHARE_SCALE))).toBe('1.8840840000');
  });

  it('negates and compares', () => {
    const a = parseDecimalAt('1.5', SHARE_SCALE)!;
    expect(negateDecimal(a).scaled).toBe(-15000000000);
    expect(compareDecimal(a, negateDecimal(a))).toBeGreaterThan(0);
    expect(isZeroDecimal(addDecimal(a, negateDecimal(a)))).toBe(true);
  });

  it('rescales down with half-up rounding', () => {
    const price = parseDecimalAt('17.7425000000', SHARE_SCALE)!;
    expect(decimalString(rescale(price, 2))).toBe('17.74');
    const up = parseDecimalAt('17.7450000000', SHARE_SCALE)!;
    expect(decimalString(rescale(up, 2))).toBe('17.75');
  });

  it('rescales up without losing the value', () => {
    expect(rescale({ scaled: 1774, scale: 2 }, 4)).toEqual({ scaled: 177400, scale: 4 });
  });

  it('converts to a number only at the display edge', () => {
    expect(decimalToNumber(parseDecimalAt('0.7618080000', SHARE_SCALE)!)).toBeCloseTo(0.761808, 9);
  });

  it('trims trailing zeros for display but keeps significant digits', () => {
    const d = parseDecimalAt('4.2103000000', SHARE_SCALE)!;
    expect(formatDecimal(d, 'en-GB', 4)).toBe('4.2103');
    expect(formatDecimal(parseDecimalAt('2.0000000000', SHARE_SCALE)!, 'en-GB', 4)).toBe('2');
  });
});
