import { describe, expect, it } from 'vitest';
import { summariseMonth } from '../src/aggregate';
import { detectRecurring } from '../src/recurring';
import { bookedYear, forecastYear } from '../src/forecast';
import { syntheticYear, tx } from './factory';

describe('summariseMonth', () => {
  const txs = [
    tx({ date: '2026-01-25', amount: 2600, description: 'NOMINA' }),
    tx({ date: '2026-01-01', amount: -950, description: 'ALQUILER' }),
    tx({ date: '2026-01-10', amount: -50, description: 'MERCADONA' }),
    tx({ date: '2026-02-01', amount: -950, description: 'ALQUILER' }),
  ];

  it('nets only the requested month', () => {
    const s = summariseMonth(txs, '2026-01', 'EUR');
    expect(s.income.minor).toBe(260000);
    expect(s.expenses.minor).toBe(100000);
    expect(s.net.minor).toBe(160000);
    expect(s.transactionCount).toBe(3);
  });

  it('excludes internal transfers and flagged rows from every total', () => {
    const withTransfer = [
      ...txs,
      tx({
        date: '2026-01-15',
        amount: -500,
        description: 'TRASPASO',
        categoryId: 'transfer-internal',
      }),
      tx({ date: '2026-01-16', amount: -70, description: 'REEMBOLSO', excludedFromStats: true }),
    ];
    expect(summariseMonth(withTransfer, '2026-01', 'EUR').expenses.minor).toBe(100000);
  });

  it('returns zeros rather than throwing for a month with no data', () => {
    expect(summariseMonth(txs, '2026-07', 'EUR').net.minor).toBe(0);
  });
});

describe('detectRecurring', () => {
  const year = syntheticYear();

  it('finds the monthly salary, rent and subscription', () => {
    const keys = detectRecurring(year, 'EUR').map((r) => r.key);
    expect(keys.some((k) => k.includes('acme'))).toBe(true);
    expect(keys.some((k) => k.includes('inmobiliaria'))).toBe(true);
    expect(keys.some((k) => k.includes('netflix'))).toBe(true);
  });

  it('reports the signed typical amount and cadence', () => {
    const netflix = detectRecurring(year, 'EUR').find((r) => r.key.includes('netflix'));
    expect(netflix?.cadence).toBe('monthly');
    expect(netflix?.typicalAmount.minor).toBe(-1299);
  });

  it('ignores a merchant seen only twice', () => {
    const sparse = [
      tx({ date: '2025-01-05', amount: -30, description: 'LIBRERIA CENTRAL' }),
      tx({ date: '2025-02-05', amount: -30, description: 'LIBRERIA CENTRAL' }),
    ];
    expect(detectRecurring(sparse, 'EUR')).toHaveLength(0);
  });
});

describe('forecastYear', () => {
  const history = syntheticYear(1, 2025);

  it('reports booked months as actuals and projects the rest', () => {
    const f = forecastYear(history, 2026, 'EUR', { today: '2026-01-15' });
    expect(f.months).toHaveLength(12);
    expect(f.months[0]!.kind).toBe('current');
    expect(f.months[11]!.kind).toBe('projected');
  });

  it('carries recurring commitments into every projected month', () => {
    const f = forecastYear(history, 2026, 'EUR', { today: '2026-01-15' });
    // Rent 950 + Netflix 12.99 are recurring; the projection must not lose them.
    expect(f.recurringMonthlyExpenses.minor).toBeGreaterThan(96000);
    expect(f.recurringMonthlyIncome.minor).toBeGreaterThan(250000);
  });

  it('accumulates net across the year', () => {
    const f = forecastYear(history, 2026, 'EUR', { today: '2026-01-15' });
    const last = f.months[11]!;
    expect(last.cumulativeNet.minor).toBe(f.totalNet.minor);
  });

  it('grades confidence low when there is almost no history', () => {
    const thin = [tx({ date: '2025-12-01', amount: -20, description: 'ALGO' })];
    expect(forecastYear(thin, 2026, 'EUR', { today: '2026-01-15' }).confidence).toBe('low');
  });

  it('produces a zeroed but valid year when there is no data at all', () => {
    const f = forecastYear([], 2026, 'EUR', { today: '2026-01-15' });
    expect(f.totalNet.minor).toBe(0);
    expect(f.months).toHaveLength(12);
  });
});

describe('refunds on the expense side', () => {
  // A hand-kept ledger writes a refund as a negative row inside the expense
  // block: it reduces that month's spending rather than counting as income.
  const txs = [
    tx({ date: '2026-01-25', amount: 2000, description: 'NOMINA' }),
    tx({ date: '2026-01-10', amount: -100, description: 'COMIDA FUERA' }),
    tx({ date: '2026-01-11', amount: 20, description: 'COMIDA FUERA', side: 'expense' }),
  ];

  it('reduces the expense total instead of inflating income', () => {
    const s = summariseMonth(txs, '2026-01', 'EUR');
    expect(s.income.minor).toBe(200000);
    expect(s.expenses.minor).toBe(8000);
    expect(s.net.minor).toBe(192000);
  });

  it('reduces the category the refund belongs to', () => {
    const s = summariseMonth(
      txs.map((t) => ({ ...t, categoryId: 'food-restaurants' })),
      '2026-01',
      'EUR',
    );
    const food = s.expensesByCategory.find((c) => c.categoryId === 'food-restaurants');
    expect(food?.total.minor).toBe(8000);
    expect(food?.count).toBe(2);
  });

  it('never reports a negative share', () => {
    const onlyRefund = [tx({ date: '2026-02-11', amount: 20, description: 'X', side: 'expense' })];
    const s = summariseMonth(onlyRefund, '2026-02', 'EUR');
    expect(s.expenses.minor).toBe(-2000);
    expect(s.expensesByCategory[0]?.share).toBe(0);
  });
});

describe('bookedYear', () => {
  const txs = [
    tx({ date: '2026-01-25', amount: 2600, description: 'NOMINA' }),
    tx({ date: '2026-01-01', amount: -950, description: 'ALQUILER' }),
    tx({ date: '2026-02-25', amount: 2600, description: 'NOMINA' }),
    tx({ date: '2026-02-01', amount: -950, description: 'ALQUILER' }),
    // Dated inside the current month, so it is booked and must be counted.
    tx({ date: '2026-03-01', amount: -950, description: 'ALQUILER' }),
    // Next year: no business in this year's totals whatever the toggle says.
    tx({ date: '2027-01-01', amount: -950, description: 'ALQUILER' }),
  ];

  it('stops at the month containing today, current month included', () => {
    const booked = bookedYear(txs, 2026, 'EUR', { today: '2026-03-15' });
    expect(booked.months.map((month) => month.month)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('reports every month as booked fact, never as a projection', () => {
    const booked = bookedYear(txs, 2026, 'EUR', { today: '2026-03-15' });
    expect(booked.months.every((month) => month.kind === 'actual')).toBe(true);
    expect(booked.months.every((month) => month.confidence === 'high')).toBe(true);
  });

  it('totals only the months it reports', () => {
    const booked = bookedYear(txs, 2026, 'EUR', { today: '2026-03-15' });
    expect(booked.totalIncome.minor).toBe(520000);
    expect(booked.totalExpenses.minor).toBe(285000);
    expect(booked.totalNet.minor).toBe(235000);
  });

  it('runs the cumulative net through the months in order', () => {
    const booked = bookedYear(txs, 2026, 'EUR', { today: '2026-03-15' });
    expect(booked.months.map((month) => month.cumulativeNet.minor)).toEqual([
      165000, 330000, 235000,
    ]);
  });

  it('covers all twelve months of a year that is already over', () => {
    const booked = bookedYear(txs, 2026, 'EUR', { today: '2027-04-01' });
    expect(booked.months).toHaveLength(12);
    expect(booked.totalIncome.minor).toBe(520000);
  });

  it('reports no month of a year that has not started', () => {
    const booked = bookedYear(txs, 2028, 'EUR', { today: '2026-03-15' });
    expect(booked.months).toEqual([]);
    expect(booked.totalNet.minor).toBe(0);
  });
});
