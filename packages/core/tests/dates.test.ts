import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysBetween,
  firstOfMonth,
  inDateRange,
  lastOfMonth,
  monthRange,
  monthsBetween,
  yearMonthOf,
} from '../src/dates';

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

  it('adds days across month, year and leap-day ends without touching local time', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-09-28', -1)).toBe('2026-09-27');
  });

  it("finds the first day of a booking date's month", () => {
    expect(firstOfMonth('2026-09-03')).toBe('2026-09-01');
    expect(firstOfMonth('2026-12-31')).toBe('2026-12-01');
  });

  it('checks an inclusive date range with an optional open upper bound', () => {
    expect(inDateRange('2026-07-28', '2026-07-28', '2026-08-27')).toBe(true);
    expect(inDateRange('2026-08-27', '2026-07-28', '2026-08-27')).toBe(true);
    expect(inDateRange('2026-08-28', '2026-07-28', '2026-08-27')).toBe(false);
    expect(inDateRange('2026-07-27', '2026-07-28', '2026-08-27')).toBe(false);
    expect(inDateRange('2031-01-01', '2026-07-28', null)).toBe(true);
    expect(inDateRange('2026-07-27', '2026-07-28', null)).toBe(false);
  });
});

describe('lastOfMonth', () => {
  it('closes a 31-day month', () => {
    expect(lastOfMonth('2026-01')).toBe('2026-01-31');
  });

  it('closes a 30-day month', () => {
    expect(lastOfMonth('2026-04')).toBe('2026-04-30');
  });

  it('knows February in a common year', () => {
    expect(lastOfMonth('2026-02')).toBe('2026-02-28');
  });

  it('knows February in a leap year', () => {
    expect(lastOfMonth('2028-02')).toBe('2028-02-29');
  });

  it('knows 1900 was not a leap year', () => {
    expect(lastOfMonth('1900-02')).toBe('1900-02-28');
  });
});
