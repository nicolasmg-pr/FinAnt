import type { ISODate, YearMonth } from './types';

/**
 * Plain calendar arithmetic on `YYYY-MM-DD` / `YYYY-MM` strings. No Date object
 * crosses a boundary: a booking date is a calendar day, and running it through
 * a timestamp is how a 1 March expense lands in February for anyone west of UTC.
 */
export function yearMonthOf(date: ISODate): YearMonth {
  return date.slice(0, 7);
}

export function yearOf(value: ISODate | YearMonth): number {
  return Number(value.slice(0, 4));
}

export function monthOf(value: ISODate | YearMonth): number {
  return Number(value.slice(5, 7));
}

export function yearMonth(year: number, month: number): YearMonth {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

export function addMonths(ym: YearMonth, delta: number): YearMonth {
  const total = yearOf(ym) * 12 + (monthOf(ym) - 1) + delta;
  return yearMonth(Math.floor(total / 12), (((total % 12) + 12) % 12) + 1);
}

export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return (yearOf(to) - yearOf(from)) * 12 + (monthOf(to) - monthOf(from));
}

export function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
  const out: YearMonth[] = [];
  for (let i = 0; i <= monthsBetween(from, to); i += 1) out.push(addMonths(from, i));
  return out;
}

export function monthsOfYear(year: number): YearMonth[] {
  return Array.from({ length: 12 }, (_, i) => yearMonth(year, i + 1));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * `date` shifted by `delta` calendar days. Built and read back in UTC so a DST
 * change on the device can never move the result by an hour and thus a day.
 */
export function addDays(date: ISODate, delta: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function firstOfMonth(date: ISODate): ISODate {
  return `${yearMonthOf(date)}-01`;
}

/**
 * Inclusive at both ends; a `null` upper bound is open. Plain string comparison
 * is exact on zero-padded `YYYY-MM-DD`, which is why the format is fixed.
 */
export function inDateRange(date: ISODate, from: ISODate, to: ISODate | null): boolean {
  return date >= from && (to === null || date <= to);
}
