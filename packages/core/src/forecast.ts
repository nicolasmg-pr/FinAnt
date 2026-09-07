import { summariseMonth } from './aggregate';
import { addMonths, monthsOfYear, yearMonth, yearMonthOf } from './dates';
import { money, type CurrencyCode, type Money } from './money';
import { merchantKey } from './normalise';
import { coefficientOfVariation, median } from './stats';
import { detectRecurring, type Cadence } from './recurring';
import type { Transaction, YearMonth } from './types';

/** How many times a cadence fires in an average month. A yearly insurance
 * premium is amortised across the year rather than dropped on one month: the
 * year total stays right, and no single month shows a false spike. */
const PER_MONTH: Record<Cadence, number> = {
  weekly: 30.44 / 7,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
};

export type MonthKind = 'actual' | 'current' | 'projected';

/** How much the projection should be trusted. Surfaced in the UI, never hidden. */
export type Confidence = 'high' | 'medium' | 'low';

export interface MonthForecast {
  readonly month: YearMonth;
  readonly kind: MonthKind;
  readonly income: Money;
  /** Positive magnitude. */
  readonly expenses: Money;
  readonly net: Money;
  readonly cumulativeNet: Money;
  readonly confidence: Confidence;
}

export interface YearForecast {
  readonly year: number;
  readonly currency: CurrencyCode;
  readonly months: readonly MonthForecast[];
  readonly totalIncome: Money;
  readonly totalExpenses: Money;
  readonly totalNet: Money;
  /** Complete months of history the projection was built from. */
  readonly historyMonths: number;
  readonly confidence: Confidence;
  /** Recurring commitments recognised, amortised to a monthly figure. */
  readonly recurringMonthlyExpenses: Money;
  readonly recurringMonthlyIncome: Money;
}

export interface ForecastOptions {
  /** Defaults to the system date. Injected so tests are deterministic. */
  readonly today?: string;
  /** Trailing complete months used for the variable-spend median. */
  readonly windowMonths?: number;
}

function gradeConfidence(sampleMonths: number, variation: number): Confidence {
  if (sampleMonths >= 6 && variation < 0.25) return 'high';
  if (sampleMonths >= 3 && variation < 0.6) return 'medium';
  return 'low';
}

/**
 * Projects the calendar year.
 *
 * The model is deliberately simple and explainable, because a forecast the
 * owner cannot reason about is worse than none:
 *   projected month = recurring commitments (amortised by cadence)
 *                   + median of the trailing months' non-recurring flow
 *
 * Median rather than mean, so one holiday or one bonus does not bend the year.
 * Months already booked are reported as actuals, never smoothed.
 */
export function forecastYear(
  transactions: readonly Transaction[],
  year: number,
  currency: CurrencyCode,
  options: ForecastOptions = {},
): YearForecast {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const windowMonths = options.windowMonths ?? 6;
  const currentMonth = yearMonthOf(today);

  const recurring = detectRecurring(transactions, currency);
  const recurringKeys = new Set(recurring.map((r) => r.key));

  let recurringIncomeMinor = 0;
  let recurringExpenseMinor = 0;
  for (const series of recurring) {
    const perMonth = series.typicalAmount.minor * PER_MONTH[series.cadence];
    if (perMonth > 0) recurringIncomeMinor += perMonth;
    else recurringExpenseMinor += -perMonth;
  }

  // Variable flow: everything that is not part of a recognised recurring series.
  const variable = transactions.filter(
    (tx) => !recurringKeys.has(merchantKey(tx.counterparty ?? tx.description)),
  );

  // Trailing complete months, ending with the month before the current one.
  const window: YearMonth[] = [];
  for (let i = windowMonths; i >= 1; i -= 1) window.push(addMonths(currentMonth, -i));
  const hasHistory = new Set(transactions.map((tx) => yearMonthOf(tx.bookingDate)));
  const sampled = window.filter((m) => hasHistory.has(m));

  const variableIncomes = sampled.map((m) => summariseMonth(variable, m, currency).income.minor);
  const variableExpenses = sampled.map((m) => summariseMonth(variable, m, currency).expenses.minor);

  const projectedIncomeMinor = Math.round(recurringIncomeMinor + median(variableIncomes));
  const projectedExpenseMinor = Math.round(recurringExpenseMinor + median(variableExpenses));

  const variation = Math.max(
    coefficientOfVariation(variableExpenses),
    coefficientOfVariation(variableIncomes),
  );
  const overall = gradeConfidence(sampled.length, variation);

  const months: MonthForecast[] = [];
  let cumulative = 0;

  for (const month of monthsOfYear(year)) {
    let income: number;
    let expenses: number;
    let kind: MonthKind;

    if (month < currentMonth) {
      const actual = summariseMonth(transactions, month, currency);
      income = actual.income.minor;
      expenses = actual.expenses.minor;
      kind = 'actual';
    } else if (month === currentMonth) {
      // Booked so far, topped up with the pro-rated remainder of the month.
      const actual = summariseMonth(transactions, month, currency);
      const dayOfMonth = Number(today.slice(8, 10));
      const daysInMonth = new Date(Date.UTC(year, Number(month.slice(5, 7)), 0)).getUTCDate();
      const remaining = Math.max(0, (daysInMonth - dayOfMonth) / daysInMonth);
      income = Math.round(actual.income.minor + projectedIncomeMinor * remaining);
      expenses = Math.round(actual.expenses.minor + projectedExpenseMinor * remaining);
      kind = 'current';
    } else {
      income = projectedIncomeMinor;
      expenses = projectedExpenseMinor;
      kind = 'projected';
    }

    const net = income - expenses;
    cumulative += net;
    months.push({
      month,
      kind,
      income: money(income, currency),
      expenses: money(expenses, currency),
      net: money(net, currency),
      cumulativeNet: money(cumulative, currency),
      confidence: kind === 'actual' ? 'high' : overall,
    });
  }

  const totalIncome = months.reduce((acc, m) => acc + m.income.minor, 0);
  const totalExpenses = months.reduce((acc, m) => acc + m.expenses.minor, 0);

  return {
    year,
    currency,
    months,
    totalIncome: money(totalIncome, currency),
    totalExpenses: money(totalExpenses, currency),
    totalNet: money(totalIncome - totalExpenses, currency),
    historyMonths: sampled.length,
    confidence: overall,
    recurringMonthlyExpenses: money(Math.round(recurringExpenseMinor), currency),
    recurringMonthlyIncome: money(Math.round(recurringIncomeMinor), currency),
  };
}

/** The booked half of a year: the same shape, with nothing projected in it. */
export interface YearActuals {
  readonly year: number;
  readonly currency: CurrencyCode;
  /** January through the month containing `today`; empty before the year starts. */
  readonly months: readonly MonthForecast[];
  readonly totalIncome: Money;
  readonly totalExpenses: Money;
  readonly totalNet: Money;
}

/**
 * The year as recorded, with no projection anywhere in it.
 *
 * `forecastYear()` answers "how will this year end"; this answers "what has
 * actually happened so far", which is the figure to check a projection
 * against. The current month is included and reported as the fact it is: what
 * is booked in it, with no pro-rated remainder added on.
 *
 * Months share `MonthForecast` so the same chart draws either view.
 */
export function bookedYear(
  transactions: readonly Transaction[],
  year: number,
  currency: CurrencyCode,
  options: ForecastOptions = {},
): YearActuals {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const currentMonth = yearMonthOf(today);

  const months: MonthForecast[] = [];
  let cumulative = 0;
  for (const month of monthsOfYear(year)) {
    // Nothing beyond the month we are living in: an empty December is not a
    // month in which nothing happened, it is a month that has not happened.
    if (month > currentMonth) break;
    const actual = summariseMonth(transactions, month, currency);
    cumulative += actual.net.minor;
    months.push({
      month,
      kind: 'actual',
      income: actual.income,
      expenses: actual.expenses,
      net: actual.net,
      cumulativeNet: money(cumulative, currency),
      confidence: 'high',
    });
  }

  const totalIncome = months.reduce((acc, m) => acc + m.income.minor, 0);
  const totalExpenses = months.reduce((acc, m) => acc + m.expenses.minor, 0);
  return {
    year,
    currency,
    months,
    totalIncome: money(totalIncome, currency),
    totalExpenses: money(totalExpenses, currency),
    totalNet: money(totalIncome - totalExpenses, currency),
  };
}

/** Convenience for the dashboard header: this month and the same month last year. */
export function monthOverYear(
  transactions: readonly Transaction[],
  month: YearMonth,
  currency: CurrencyCode,
) {
  const previous = yearMonth(Number(month.slice(0, 4)) - 1, Number(month.slice(5, 7)));
  return {
    current: summariseMonth(transactions, month, currency),
    yearAgo: summariseMonth(transactions, previous, currency),
  };
}
