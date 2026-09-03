import { describe, expect, it } from 'vitest';
import {
  PAYROLL_MERGE_DAYS,
  currentPeriod,
  inPeriod,
  payPeriodStarts,
  type Period,
} from '../src/period';
import { tx } from './factory';

function salary(date: string, extra: { excludedFromStats?: boolean } = {}) {
  return tx({
    date,
    amount: 2600,
    description: 'NOMINA ACME SL',
    categoryId: 'income-salary',
    ...extra,
  });
}

describe('payPeriodStarts', () => {
  it('returns salary booking dates sorted and deduplicated', () => {
    const starts = payPeriodStarts([
      salary('2026-08-28'),
      salary('2026-06-26'),
      salary('2026-07-28'),
      salary('2026-07-28'),
    ]);
    expect(starts).toEqual(['2026-06-26', '2026-07-28', '2026-08-28']);
  });

  it('ignores movements that are not salary or do not count toward stats', () => {
    const starts = payPeriodStarts([
      tx({
        date: '2026-08-01',
        amount: 500,
        description: 'INVOICE 12',
        categoryId: 'income-freelance',
      }),
      salary('2026-08-28', { excludedFromStats: true }),
      salary('2026-07-28'),
    ]);
    expect(starts).toEqual(['2026-07-28']);
  });

  it('merges a second salary inside the window into the earlier one', () => {
    const starts = payPeriodStarts([
      salary('2026-08-28'),
      salary('2026-09-04'),
      salary('2026-09-28'),
    ]);
    expect(starts).toEqual(['2026-08-28', '2026-09-28']);
  });

  it('merges exactly at the window and keeps a start one day beyond it', () => {
    expect(PAYROLL_MERGE_DAYS).toBe(14);
    expect(payPeriodStarts([salary('2026-08-01'), salary('2026-08-15')])).toEqual(['2026-08-01']);
    expect(payPeriodStarts([salary('2026-08-01'), salary('2026-08-16')])).toEqual([
      '2026-08-01',
      '2026-08-16',
    ]);
  });

  it('returns nothing for a ledger without salary', () => {
    expect(payPeriodStarts([tx({ date: '2026-08-01', amount: -10, description: 'CAFE' })])).toEqual(
      [],
    );
  });
});

describe('currentPeriod', () => {
  const ledger = [salary('2026-06-26'), salary('2026-07-28'), salary('2026-08-28')];

  it('opens at the latest salary and stays open when no later one exists', () => {
    expect(currentPeriod(ledger, '2026-09-03')).toEqual<Period>({
      from: '2026-08-28',
      to: null,
      anchored: true,
    });
  });

  it('closes the day before the next salary', () => {
    expect(currentPeriod(ledger, '2026-08-10')).toEqual<Period>({
      from: '2026-07-28',
      to: '2026-08-27',
      anchored: true,
    });
  });

  it('starts a new period on the salary day itself', () => {
    expect(currentPeriod(ledger, '2026-08-28')).toEqual<Period>({
      from: '2026-08-28',
      to: null,
      anchored: true,
    });
  });

  it('falls back to the calendar month when no salary is booked on or before today', () => {
    expect(currentPeriod([], '2026-09-03')).toEqual<Period>({
      from: '2026-09-01',
      to: null,
      anchored: false,
    });
    expect(currentPeriod(ledger, '2026-06-01')).toEqual<Period>({
      from: '2026-06-01',
      to: null,
      anchored: false,
    });
  });
});

describe('inPeriod', () => {
  it('is inclusive at both ends and open when `to` is null', () => {
    const closed: Period = { from: '2026-07-28', to: '2026-08-27', anchored: true };
    expect(inPeriod('2026-07-28', closed)).toBe(true);
    expect(inPeriod('2026-08-27', closed)).toBe(true);
    expect(inPeriod('2026-08-28', closed)).toBe(false);
    expect(inPeriod('2026-07-27', closed)).toBe(false);

    const open: Period = { from: '2026-08-28', to: null, anchored: true };
    expect(inPeriod('2031-01-01', open)).toBe(true);
  });
});
