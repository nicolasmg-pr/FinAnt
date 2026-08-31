import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, monthRange, monthsBetween, yearMonthOf } from '../src/dates';

describe('dates', () => {
  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2025-12', 1)).toBe('2026-01');
    expect(addMonths('2026-03', -14)).toBe('2025-01');
  });

  it('counts months between', () => {
    expect(monthsBetween('2025-01', '2026-03')).toBe(14);
  });

  it('builds inclusive ranges', () => {
    expect(monthRange('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('reads the month of a booking date without time-zone shifting it', () => {
    expect(yearMonthOf('2026-03-01')).toBe('2026-03');
  });

  it('counts days across a leap day', () => {
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });
});
