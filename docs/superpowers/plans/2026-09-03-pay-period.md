# Pay Period Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The dashboard's first card and the budgets screen report on the period since the owner's last salary booking instead of the calendar month, falling back to the month when no salary has been booked yet.

**Architecture:** A new pure module `packages/core/src/period.ts` derives pay-period boundaries from salary bookings (`income-salary`) with a 14-day merge window. `summariseMonth` and `budgetMonth` become thin wrappers over new range-based summarisers (`summarisePeriod`, `budgetPeriod`) so a month and a pay period can never disagree on what counts. One small hook `usePayPeriod` gives the dashboard and budgets screens the same period and the same "Since 28 Aug" title. The year forecast stays on calendar months.

**Tech Stack:** TypeScript 6 strict, vitest for `packages/core`, React Native 0.86, Expo SDK 57, expo-router, react-i18next. The mobile app has no test runner: verification there is typecheck + bundle export + simulator.

**Spec:** `docs/superpowers/specs/2026-09-03-ledger-control-design.md`, section "Sub-project 2 — pay-period".

## Global Constraints

- Money is signed integer minor units plus an ISO 4217 code; never do float arithmetic on a balance.
- Dates are plain `YYYY-MM-DD` / `YYYY-MM` strings. Any `Date` used for arithmetic is constructed from `${date}T00:00:00Z` and read back with UTC accessors; a booking date never touches local time.
- Domain logic stays in `packages/core` with no React or Expo imports.
- Relative imports inside packages are extensionless (`'./dates'`, never `'./dates.js'`).
- No runtime import cycle between `aggregate.ts` and `period.ts`: `period.ts` imports `countsTowardStats` from `aggregate.ts`; `aggregate.ts` and `budget.ts` import only the `Period` _type_ from `period.ts` and use `inDateRange` from `dates.ts` for the range check.
- Category ids are permanent: the payroll marker is the existing `income-salary` id.
- Aggregates exclude internal transfers and rows flagged by the owner (`countsTowardStats`), in every window.
- Translations are typed against `Resources`: every new key must land in `en.ts`, `es.ts` and `de.ts` or typecheck fails.
- `npm run lint:fix` reformats the whole repo. Run `npx prettier --write` and `npx eslint` only on the files you changed.
- Never log a movement, narrative, IBAN or any part of a statement. No network calls, no telemetry.
- Branch: `pay-period` (already created off `main`). Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Forecast (`packages/core/src/forecast.ts`) is not touched.

---

### Task 1: Day arithmetic in `dates.ts`

**Files:**

- Modify: `packages/core/src/dates.ts` (append after `daysBetween`)
- Test: `packages/core/tests/dates.test.ts`

**Interfaces:**

- Produces: `addDays(date: ISODate, delta: number): ISODate`, `firstOfMonth(date: ISODate): ISODate`, `inDateRange(date: ISODate, from: ISODate, to: ISODate | null): boolean`.

- [ ] **Step 1: Write the failing tests**

In `packages/core/tests/dates.test.ts`, extend the import line and add three cases inside the existing `describe('dates', …)` block:

```ts
import {
  addDays,
  addMonths,
  daysBetween,
  firstOfMonth,
  inDateRange,
  monthRange,
  monthsBetween,
  yearMonthOf,
} from '../src/dates';
```

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/tests/dates.test.ts`
Expected: FAIL — `addDays`, `firstOfMonth`, `inDateRange` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/core/src/dates.ts`, after `daysBetween`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/core/tests/dates.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write packages/core/src/dates.ts packages/core/tests/dates.test.ts
npx eslint packages/core/src/dates.ts packages/core/tests/dates.test.ts
git add packages/core/src/dates.ts packages/core/tests/dates.test.ts
git commit -m "feat(core): day arithmetic and inclusive range check on ISO dates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Pay-period domain module

**Files:**

- Create: `packages/core/src/period.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './period';`)
- Test: `packages/core/tests/period.test.ts`

**Interfaces:**

- Consumes: `countsTowardStats` from `./aggregate`; `addDays`, `daysBetween`, `firstOfMonth`, `inDateRange` from `./dates` (Task 1).
- Produces:
  - `PAYROLL_CATEGORY_ID = 'income-salary'`, `PAYROLL_MERGE_DAYS = 14`
  - `interface Period { readonly from: ISODate; readonly to: ISODate | null; readonly anchored: boolean }`
  - `payPeriodStarts(transactions: readonly Transaction[]): ISODate[]`
  - `currentPeriod(transactions: readonly Transaction[], today: ISODate): Period`
  - `inPeriod(date: ISODate, period: Period): boolean`

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/period.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/tests/period.test.ts`
Expected: FAIL — cannot resolve `../src/period`.

- [ ] **Step 3: Create the module**

Create `packages/core/src/period.ts`:

```ts
import { countsTowardStats } from './aggregate';
import { addDays, daysBetween, firstOfMonth, inDateRange } from './dates';
import type { ISODate, Transaction } from './types';

/**
 * Category whose bookings open a new pay period. The owner marks payroll by
 * categorising it, and learned rules keep future payrolls landing there, so no
 * extra flag or setting is needed.
 */
export const PAYROLL_CATEGORY_ID = 'income-salary';

/** Two salary bookings this close together belong to one period (a bonus, two payers). */
export const PAYROLL_MERGE_DAYS = 14;

export interface Period {
  readonly from: ISODate;
  /** Inclusive. `null` while the period is still open (the current one). */
  readonly to: ISODate | null;
  /** True when `from` is a salary booking; false when it is a calendar fallback. */
  readonly anchored: boolean;
}

/**
 * Booking dates that open a pay period: every salary that counts toward
 * statistics, sorted, deduplicated, and thinned so that a booking within
 * PAYROLL_MERGE_DAYS of the previous kept one is dropped. The real booking
 * dates are the boundaries: salary drifts around weekends and holidays, and
 * using the actual date absorbs that with no configuration.
 */
export function payPeriodStarts(transactions: readonly Transaction[]): ISODate[] {
  const dates = transactions
    .filter((tx) => tx.categoryId === PAYROLL_CATEGORY_ID && countsTowardStats(tx))
    .map((tx) => tx.bookingDate)
    .sort();

  const starts: ISODate[] = [];
  for (const date of dates) {
    const last = starts[starts.length - 1];
    if (last !== undefined && daysBetween(last, date) <= PAYROLL_MERGE_DAYS) continue;
    starts.push(date);
  }
  return starts;
}

/**
 * The period `today` falls in: from the latest salary on or before today to the
 * day before the next one, open-ended while there is none. Without any salary
 * on or before today the calendar month stands in, flagged unanchored so the
 * UI can say "This month" instead of "Since …".
 */
export function currentPeriod(transactions: readonly Transaction[], today: ISODate): Period {
  let from: ISODate | null = null;
  let next: ISODate | null = null;
  for (const start of payPeriodStarts(transactions)) {
    if (start <= today) {
      from = start;
    } else {
      next = start;
      break;
    }
  }
  if (from === null) return { from: firstOfMonth(today), to: null, anchored: false };
  return { from, to: next === null ? null : addDays(next, -1), anchored: true };
}

export function inPeriod(date: ISODate, period: Period): boolean {
  return inDateRange(date, period.from, period.to);
}
```

- [ ] **Step 4: Export it from the package**

In `packages/core/src/index.ts`, add after `export * from './budget';`:

```ts
export * from './period';
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/core/tests/period.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Format and commit**

```bash
npx prettier --write packages/core/src/period.ts packages/core/src/index.ts packages/core/tests/period.test.ts
npx eslint packages/core/src/period.ts packages/core/tests/period.test.ts
git add packages/core/src/period.ts packages/core/src/index.ts packages/core/tests/period.test.ts
git commit -m "feat(core): derive pay periods from salary bookings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `summarisePeriod` with `summariseMonth` as a wrapper

**Files:**

- Modify: `packages/core/src/aggregate.ts`
- Test: `packages/core/tests/aggregate.test.ts` (new)

**Interfaces:**

- Consumes: `inDateRange` from `./dates` (Task 1); `type Period` from `./period` (Task 2).
- Produces:
  - `interface SummaryFigures { income; expenses; net; incomeByCategory; expensesByCategory; transactionCount }`
  - `interface MonthlySummary extends SummaryFigures { readonly month: YearMonth }` (same shape as before for existing callers)
  - `interface PeriodSummary extends SummaryFigures { readonly period: Period }`
  - `summarisePeriod(transactions: readonly Transaction[], period: Period, currency: CurrencyCode): PeriodSummary`
  - `summariseMonth` and `summariseMonths` unchanged in signature and result.

- [ ] **Step 1: Write the regression test first, against the current code**

Create `packages/core/tests/aggregate.test.ts`. The first `describe` pins the current `summariseMonth` output on the synthetic year so the refactor cannot move it; the second describes the new function.

```ts
import { describe, expect, it } from 'vitest';
import { summariseMonth, summarisePeriod } from '../src/aggregate';
import type { Period } from '../src/period';
import { syntheticYear, tx } from './factory';

const EUR = 'EUR';

describe('summariseMonth', () => {
  it('reports the synthetic year month by month, unchanged by the range refactor', () => {
    const txs = syntheticYear();
    for (let m = 1; m <= 12; m += 1) {
      const s = summariseMonth(txs, `2025-${String(m).padStart(2, '0')}`, EUR);
      // Rent 950 + Netflix 12.99 + groceries (180 + m) + restaurant 45.
      const expenses = 118_799 + m * 100;
      expect(s.income.minor).toBe(260_000);
      expect(s.expenses.minor).toBe(expenses);
      expect(s.net.minor).toBe(260_000 - expenses);
      expect(s.transactionCount).toBe(5);
    }
  });

  it('keeps a 31st-of-month booking inside its month and out of the next', () => {
    const txs = [
      tx({ date: '2026-08-31', amount: -10, description: 'LAST OF AUGUST' }),
      tx({ date: '2026-09-01', amount: -20, description: 'FIRST OF SEPTEMBER' }),
    ];
    expect(summariseMonth(txs, '2026-08', EUR).expenses.minor).toBe(1_000);
    expect(summariseMonth(txs, '2026-09', EUR).expenses.minor).toBe(2_000);
  });
});

describe('summarisePeriod', () => {
  const period: Period = { from: '2026-07-28', to: '2026-08-27', anchored: true };

  it('includes both boundary days and nothing beyond them', () => {
    const txs = [
      tx({ date: '2026-07-27', amount: -10, description: 'BEFORE' }),
      tx({ date: '2026-07-28', amount: 2600, description: 'SALARY', categoryId: 'income-salary' }),
      tx({ date: '2026-08-27', amount: -40, description: 'LAST DAY' }),
      tx({ date: '2026-08-28', amount: -50, description: 'AFTER' }),
    ];
    const s = summarisePeriod(txs, period, EUR);
    expect(s.income.minor).toBe(260_000);
    expect(s.expenses.minor).toBe(4_000);
    expect(s.net.minor).toBe(256_000);
    expect(s.transactionCount).toBe(2);
    expect(s.period).toEqual(period);
  });

  it('runs to the end of the ledger when the period is open', () => {
    const open: Period = { from: '2026-08-28', to: null, anchored: true };
    const txs = [
      tx({ date: '2026-08-28', amount: 2600, description: 'SALARY', categoryId: 'income-salary' }),
      tx({ date: '2026-11-30', amount: -20, description: 'FAR AHEAD' }),
    ];
    expect(summarisePeriod(txs, open, EUR).expenses.minor).toBe(2_000);
  });

  it('drops internal transfers and rows the owner excluded', () => {
    const txs = [
      tx({
        date: '2026-08-01',
        amount: -100,
        description: 'GROCERIES',
        categoryId: 'food-groceries',
      }),
      tx({
        date: '2026-08-02',
        amount: -500,
        description: 'TO SAVINGS',
        categoryId: 'transfer-internal',
      }),
      tx({ date: '2026-08-03', amount: -80, description: 'SAVEBACK', excludedFromStats: true }),
    ];
    const s = summarisePeriod(txs, period, EUR);
    expect(s.expenses.minor).toBe(10_000);
    expect(s.transactionCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify the split**

Run: `npx vitest run packages/core/tests/aggregate.test.ts`
Expected: the two `summariseMonth` tests PASS against the current code; the three `summarisePeriod` tests FAIL with `summarisePeriod is not a function`.

- [ ] **Step 3: Refactor `aggregate.ts`**

Replace the import block, the `MonthlySummary` interface, and `summariseMonth` in `packages/core/src/aggregate.ts`. `CategoryTotal`, `countsTowardStats`, `totals` and `summariseMonths` stay as they are.

Imports (replace the existing four lines):

```ts
import { inDateRange } from './dates';
import { money, type CurrencyCode, type Money } from './money';
import { UNCATEGORISED_ID } from './categories';
import type { Period } from './period';
import type { ISODate, Transaction, TransactionSide, YearMonth } from './types';
```

Replace `export interface MonthlySummary { … }` with:

```ts
/** Figures shared by every summary, whatever window they were computed over. */
export interface SummaryFigures {
  readonly income: Money;
  /** Positive magnitude, net of refunds. Subtract from income to get net. */
  readonly expenses: Money;
  readonly net: Money;
  readonly incomeByCategory: readonly CategoryTotal[];
  readonly expensesByCategory: readonly CategoryTotal[];
  readonly transactionCount: number;
}

export interface MonthlySummary extends SummaryFigures {
  readonly month: YearMonth;
}

export interface PeriodSummary extends SummaryFigures {
  readonly period: Period;
}
```

Replace `export function summariseMonth(…) { … }` with:

```ts
/**
 * Totals every movement booked from `from` to `to`, both inclusive; an open
 * `to` runs to the end of the ledger. Every public summary is this with a
 * different window, so a month and a pay period can never disagree on what
 * counts.
 */
function summariseRange(
  transactions: readonly Transaction[],
  from: ISODate,
  to: ISODate | null,
  currency: CurrencyCode,
): SummaryFigures {
  const inRange = transactions.filter(
    (tx) => inDateRange(tx.bookingDate, from, to) && countsTowardStats(tx),
  );
  const income = totals(
    inRange.filter((tx) => tx.side === 'income'),
    'income',
    currency,
  );
  const expenses = totals(
    inRange.filter((tx) => tx.side === 'expense'),
    'expense',
    currency,
  );

  return {
    income: income.total,
    expenses: expenses.total,
    net: money(income.total.minor - expenses.total.minor, currency),
    incomeByCategory: income.byCategory,
    expensesByCategory: expenses.byCategory,
    transactionCount: inRange.length,
  };
}

export function summariseMonth(
  transactions: readonly Transaction[],
  month: YearMonth,
  currency: CurrencyCode,
): MonthlySummary {
  // `-31` is a safe upper bound for every month: no booking date falls between
  // a month's real last day and the 31st, and string comparison needs no calendar.
  return { month, ...summariseRange(transactions, `${month}-01`, `${month}-31`, currency) };
}

export function summarisePeriod(
  transactions: readonly Transaction[],
  period: Period,
  currency: CurrencyCode,
): PeriodSummary {
  return { period, ...summariseRange(transactions, period.from, period.to, currency) };
}
```

`yearMonthOf` is no longer used in this file; the new import block already drops it.

- [ ] **Step 4: Run the whole core suite**

Run: `npm test`
Expected: PASS. `forecast.test.ts` exercises `summariseMonth` heavily and must be green untouched.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write packages/core/src/aggregate.ts packages/core/tests/aggregate.test.ts
npx eslint packages/core/src/aggregate.ts packages/core/tests/aggregate.test.ts
git add packages/core/src/aggregate.ts packages/core/tests/aggregate.test.ts
git commit -m "feat(core): summarise an arbitrary period, month becomes a wrapper

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `budgetPeriod` with `budgetMonth` as a wrapper

**Files:**

- Modify: `packages/core/src/budget.ts`
- Test: `packages/core/tests/budget.test.ts` (append a `describe`)

**Interfaces:**

- Consumes: `inDateRange` from `./dates` (Task 1); `type Period` from `./period` (Task 2).
- Produces:
  - `interface BudgetFigures { totalLimit; totalSpent; totalRemaining; categories; unbudgetedSpent }`
  - `interface BudgetMonth extends BudgetFigures { readonly month: YearMonth }` (same shape as before)
  - `interface BudgetPeriod extends BudgetFigures { readonly period: Period }`
  - `budgetPeriod(transactions: readonly Transaction[], budgets: readonly Budget[], period: Period, currency: CurrencyCode): BudgetPeriod`
  - `budgetMonth` unchanged in signature and result.

- [ ] **Step 1: Write the failing tests**

In `packages/core/tests/budget.test.ts`, extend the imports:

```ts
import { budgetMonth, budgetPeriod, NEAR_LIMIT_RATIO } from '../src/budget';
import type { Period } from '../src/period';
```

Append at the end of the file:

```ts
describe('budgetPeriod', () => {
  const period: Period = { from: '2026-07-28', to: '2026-08-27', anchored: true };

  it('counts spend from the first to the last day of the period, both inclusive', () => {
    const txs = [
      tx({ date: '2026-07-27', amount: -10, description: 'BEFORE', categoryId: 'food-groceries' }),
      tx({
        date: '2026-07-28',
        amount: -20,
        description: 'FIRST DAY',
        categoryId: 'food-groceries',
      }),
      tx({
        date: '2026-08-27',
        amount: -30,
        description: 'LAST DAY',
        categoryId: 'food-groceries',
      }),
      tx({ date: '2026-08-28', amount: -40, description: 'AFTER', categoryId: 'food-groceries' }),
    ];
    const result = budgetPeriod(txs, [budget('food-groceries', 400)], period, EUR);

    expect(result.categories[0]?.spent).toEqual(money(5_000, EUR));
    expect(result.categories[0]?.transactionCount).toBe(2);
    expect(result.totalSpent).toEqual(money(5_000, EUR));
    expect(result.period).toEqual(period);
  });

  it('runs to the end of the ledger when the period is open', () => {
    const open: Period = { from: '2026-08-28', to: null, anchored: true };
    const txs = [
      tx({ date: '2026-08-28', amount: -20, description: 'DAY ONE', categoryId: 'food-groceries' }),
      tx({
        date: '2026-12-24',
        amount: -60,
        description: 'FAR AHEAD',
        categoryId: 'food-groceries',
      }),
    ];
    const result = budgetPeriod(txs, [budget('food-groceries', 400)], open, EUR);

    expect(result.categories[0]?.spent).toEqual(money(8_000, EUR));
  });

  it('keeps transfers and excluded rows out of every budget and out of unbudgeted spend', () => {
    const txs = [
      tx({ date: '2026-08-01', amount: -100, description: 'LIDL', categoryId: 'food-groceries' }),
      tx({
        date: '2026-08-02',
        amount: -500,
        description: 'TO SAVINGS',
        categoryId: 'transfer-internal',
      }),
      tx({ date: '2026-08-03', amount: -80, description: 'SAVEBACK', excludedFromStats: true }),
      tx({ date: '2026-08-04', amount: -15, description: 'CINEMA', categoryId: 'leisure' }),
    ];
    const result = budgetPeriod(txs, [budget('food-groceries', 400)], period, EUR);

    expect(result.categories[0]?.spent).toEqual(money(10_000, EUR));
    expect(result.unbudgetedSpent).toEqual(money(1_500, EUR));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/core/tests/budget.test.ts`
Expected: FAIL — `budgetPeriod` is not exported; existing `budgetMonth` tests still pass.

- [ ] **Step 3: Refactor `budget.ts`**

Replace the import block in `packages/core/src/budget.ts`:

```ts
import { countsTowardStats } from './aggregate';
import { inDateRange } from './dates';
import { money, subtract, type CurrencyCode, type Money } from './money';
import type { Period } from './period';
import type { Budget, ISODate, Transaction, YearMonth } from './types';
```

Replace `export interface BudgetMonth { … }` with:

```ts
/** Figures shared by every budget report, whatever window they were computed over. */
export interface BudgetFigures {
  readonly totalLimit: Money;
  readonly totalSpent: Money;
  readonly totalRemaining: Money;
  /** Tightest budget first: the one closest to trouble is the one to act on. */
  readonly categories: readonly BudgetProgress[];
  /** Expense that fell outside every budget, so the totals cannot read as the whole period. */
  readonly unbudgetedSpent: Money;
}

export interface BudgetMonth extends BudgetFigures {
  readonly month: YearMonth;
}

export interface BudgetPeriod extends BudgetFigures {
  readonly period: Period;
}
```

Replace the `budgetMonth` doc comment and function with:

```ts
/**
 * Progress of every budget against the movements booked from `from` to `to`,
 * both inclusive; an open `to` runs to the end of the ledger.
 *
 * Only the expense side counts, and it is summed signed and then flipped to a
 * positive magnitude, so a refund lowers the period exactly as it does on a
 * card statement. Internal transfers and rows the owner flagged stay out, which
 * is what keeps a savings transfer from eating a grocery budget.
 */
function budgetRange(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  from: ISODate,
  to: ISODate | null,
  currency: CurrencyCode,
): BudgetFigures {
  const limits = new Map<string, Money>();
  for (const b of budgets) {
    // First one wins: a second row for the same category would otherwise double
    // the total limit, and the table holds one budget per category anyway.
    if (!limits.has(b.categoryId)) limits.set(b.categoryId, b.monthlyLimit);
  }

  const spentByCategory = new Map<string, { minor: number; count: number }>();
  let unbudgetedMinor = 0;

  for (const tx of transactions) {
    if (tx.side !== 'expense') continue;
    if (!inDateRange(tx.bookingDate, from, to)) continue;
    if (!countsTowardStats(tx)) continue;

    const oriented = -tx.amount.minor;
    const categoryId = tx.categoryId ?? '';
    if (!limits.has(categoryId)) {
      unbudgetedMinor += oriented;
      continue;
    }
    const bucket = spentByCategory.get(categoryId) ?? { minor: 0, count: 0 };
    bucket.minor += oriented;
    bucket.count += 1;
    spentByCategory.set(categoryId, bucket);
  }

  const categories = [...limits.entries()]
    .map(([categoryId, limit]) => {
      const bucket = spentByCategory.get(categoryId) ?? { minor: 0, count: 0 };
      const spent = money(bucket.minor, currency);
      const ratio = ratioOf(bucket.minor, limit.minor);
      return {
        categoryId,
        limit,
        spent,
        // Throws on a currency mismatch, which is the only sane outcome: a USD
        // limit tells us nothing about what a EUR month has left.
        remaining: subtract(limit, spent),
        ratio,
        state: stateOf(ratio),
        transactionCount: bucket.count,
      };
    })
    .sort((a, b) => b.ratio - a.ratio || a.categoryId.localeCompare(b.categoryId));

  const totalLimitMinor = categories.reduce((acc, c) => acc + c.limit.minor, 0);
  const totalSpentMinor = categories.reduce((acc, c) => acc + c.spent.minor, 0);

  return {
    totalLimit: money(totalLimitMinor, currency),
    totalSpent: money(totalSpentMinor, currency),
    totalRemaining: money(totalLimitMinor - totalSpentMinor, currency),
    categories,
    unbudgetedSpent: money(unbudgetedMinor, currency),
  };
}

export function budgetMonth(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  month: YearMonth,
  currency: CurrencyCode,
): BudgetMonth {
  // `-31` is a safe upper bound for every month; see summariseMonth.
  return { month, ...budgetRange(transactions, budgets, `${month}-01`, `${month}-31`, currency) };
}

/**
 * Budgets are monthly limits. Applied to a pay period they are read as-is: a
 * period is roughly a month long, and pro-rating a limit to 29 or 33 days
 * would only make the bar move for reasons the owner cannot see.
 */
export function budgetPeriod(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  period: Period,
  currency: CurrencyCode,
): BudgetPeriod {
  return { period, ...budgetRange(transactions, budgets, period.from, period.to, currency) };
}
```

`yearMonthOf` is no longer used in this file; the new import block already drops it.

- [ ] **Step 4: Run the whole core suite**

Run: `npm test`
Expected: PASS, including every pre-existing `budgetMonth` test.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write packages/core/src/budget.ts packages/core/tests/budget.test.ts
npx eslint packages/core/src/budget.ts packages/core/tests/budget.test.ts
git add packages/core/src/budget.ts packages/core/tests/budget.test.ts
git commit -m "feat(core): budget progress over an arbitrary period

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Translations and the `usePayPeriod` hook

**Files:**

- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/es.ts`, `packages/i18n/src/de.ts`
- Create: `apps/mobile/src/hooks/use-pay-period.ts`

**Interfaces:**

- Consumes: `currentPeriod`, `type Period`, `type Transaction` from `@finant/core` (Task 2); `formatBookingDate` from `apps/mobile/src/i18n`.
- Produces:
  - i18n keys `dashboard.sincePayroll` (`{{date}}`), `dashboard.payPeriodHint`, `transactions.salaryHint`.
  - `usePayPeriod(transactions: readonly Transaction[], today: string): { period: Period; title: string }`.

- [ ] **Step 1: Add the English keys**

In `packages/i18n/src/en.ts`, inside `dashboard`, after `thisMonth: 'This month',`:

```ts
    sincePayroll: 'Since {{date}}',
    payPeriodHint: 'Counted from your last salary. Net is what is left of it.',
```

Inside `transactions`, after `applyToSimilar: …,`:

```ts
    salaryHint: 'Salary movements start a new month on the dashboard.',
```

- [ ] **Step 2: Add the Spanish keys**

In `packages/i18n/src/es.ts`, inside `dashboard`, after `thisMonth: 'Este mes',`:

```ts
    sincePayroll: 'Desde el {{date}}',
    payPeriodHint: 'Contado desde tu última nómina. El balance es lo que queda de ella.',
```

Inside `transactions`, after `applyToSimilar: …,`:

```ts
    salaryHint: 'Los movimientos de nómina abren un nuevo mes en el resumen.',
```

- [ ] **Step 3: Add the German keys**

In `packages/i18n/src/de.ts`, inside `dashboard`, after `thisMonth: 'Dieser Monat',`:

```ts
    sincePayroll: 'Seit {{date}}',
    payPeriodHint: 'Gezählt seit deinem letzten Gehalt. Der Saldo ist, was davon übrig ist.',
```

Inside `transactions`, after `applyToSimilar: …,`:

```ts
    salaryHint: 'Gehaltsumsätze beginnen in der Übersicht einen neuen Monat.',
```

- [ ] **Step 4: Typecheck the i18n package**

Run: `npx tsc -b packages/i18n --pretty`
Expected: no output (clean). A missing key in `es` or `de` fails here with `Property 'sincePayroll' is missing`.

- [ ] **Step 5: Create the hook**

Create `apps/mobile/src/hooks/use-pay-period.ts`:

```ts
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { currentPeriod, type Period, type Transaction } from '@finant/core';
import { formatBookingDate } from '../i18n';

export interface PayPeriod {
  readonly period: Period;
  /** Card title: "Since 28 Aug" when anchored on a salary, "This month" otherwise. */
  readonly title: string;
}

/**
 * The window the dashboard and the budgets screen report on: from the owner's
 * last salary booking to today, or the calendar month while no salary has been
 * booked yet. Both screens derive it from the same ledger and the same `today`,
 * so their figures agree.
 */
export function usePayPeriod(transactions: readonly Transaction[], today: string): PayPeriod {
  const { t } = useTranslation();
  return useMemo(() => {
    const period = currentPeriod(transactions, today);
    const title = period.anchored
      ? t('dashboard.sincePayroll', {
          date: formatBookingDate(period.from, { day: 'numeric', month: 'short' }),
        })
      : t('dashboard.thisMonth');
    return { period, title };
  }, [transactions, today, t]);
}
```

- [ ] **Step 6: Typecheck the app**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts apps/mobile/src/hooks/use-pay-period.ts
npx eslint apps/mobile/src/hooks/use-pay-period.ts
git add packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts apps/mobile/src/hooks/use-pay-period.ts
git commit -m "feat(mobile): pay-period labels and a shared usePayPeriod hook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Dashboard reports on the pay period

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx`

**Interfaces:**

- Consumes: `summarisePeriod` from `@finant/core` (Task 3); `usePayPeriod` (Task 5); keys `dashboard.payPeriodHint`.

- [ ] **Step 1: Swap the month summary for the period summary**

In `apps/mobile/app/(tabs)/index.tsx`:

Change the `@finant/core` import so `summariseMonth` becomes `summarisePeriod`:

```ts
import {
  detectRecurring,
  forecastYear,
  money,
  monthsOfYear,
  summarisePeriod,
  yearMonthOf,
} from '@finant/core';
```

Add the hook import after `useAppData`:

```ts
import { usePayPeriod } from '../../src/hooks/use-pay-period';
```

Replace the `summary` memo:

```ts
const { period, title: periodTitle } = usePayPeriod(transactions, today);
const summary = useMemo(
  () => summarisePeriod(transactions, period, CURRENCY),
  [transactions, period],
);
```

`month` and `year` stay: the forecast still runs on the calendar year.

- [ ] **Step 2: Retitle the first card and add the hint**

Replace `<Card title={t('dashboard.thisMonth')}>` with `<Card title={periodTitle}>`.

Directly after the savings-rate block (the `{savingsRate !== null ? (…) : null}` expression) and before the card's closing `</Card>`, add:

```tsx
{
  period.anchored ? (
    <Text style={[styles.hint, { color: theme.textMuted }]}>{t('dashboard.payPeriodHint')}</Text>
  ) : null;
}
```

Add to the `styles` object:

```ts
  hint: { fontSize: 13 },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `summariseMonth` is still referenced anywhere in this file, the unused-import lint will say so in the next step.

- [ ] **Step 4: Format, lint and commit**

```bash
npx prettier --write "apps/mobile/app/(tabs)/index.tsx"
npx eslint "apps/mobile/app/(tabs)/index.tsx"
git add "apps/mobile/app/(tabs)/index.tsx"
git commit -m "feat(mobile): dashboard counts from the last salary

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Budgets screen reports on the pay period

**Files:**

- Modify: `apps/mobile/app/(tabs)/budgets.tsx`

**Interfaces:**

- Consumes: `budgetPeriod` from `@finant/core` (Task 4); `usePayPeriod` (Task 5).

- [ ] **Step 1: Swap `budgetMonth` for `budgetPeriod`**

In `apps/mobile/app/(tabs)/budgets.tsx`, in the `@finant/core` import replace `budgetMonth,` with `budgetPeriod,` and delete the `yearMonthOf,` line. Add the hook import after `useAppData`:

```ts
import { usePayPeriod } from '../../src/hooks/use-pay-period';
```

Replace:

```ts
const month = yearMonthOf(new Date().toISOString().slice(0, 10));
const progress = useMemo(
  () => budgetMonth(transactions, budgets, month, CURRENCY),
  [transactions, budgets, month],
);
```

with:

```ts
const today = new Date().toISOString().slice(0, 10);
const { period, title: periodTitle } = usePayPeriod(transactions, today);
const progress = useMemo(
  () => budgetPeriod(transactions, budgets, period, CURRENCY),
  [transactions, budgets, period],
);
```

- [ ] **Step 2: Subtitle the "All budgets" card with the period**

Replace `<Card title={t('budgets.allBudgets')}>` with:

```tsx
            <Card title={t('budgets.allBudgets')} subtitle={periodTitle}>
```

- [ ] **Step 3: Typecheck, format, lint**

Run: `npm run typecheck`
Expected: clean.

```bash
npx prettier --write "apps/mobile/app/(tabs)/budgets.tsx"
npx eslint "apps/mobile/app/(tabs)/budgets.tsx"
```

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(tabs)/budgets.tsx"
git commit -m "feat(mobile): budgets track the current pay period

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Salary hint on the movement detail screen

**Files:**

- Modify: `apps/mobile/app/transaction/[id].tsx`

**Interfaces:**

- Consumes: `PAYROLL_CATEGORY_ID` from `@finant/core` (Task 2); key `transactions.salaryHint` (Task 5).

- [ ] **Step 1: Import the constant**

In the `@finant/core` import of `apps/mobile/app/transaction/[id].tsx`, add `PAYROLL_CATEGORY_ID,` before `UNCATEGORISED_ID,`.

- [ ] **Step 2: Show the hint when Salary is selected**

Inside the `<Card title={t('transactions.changeCategory')}>`, directly after the `{groups.map(…)}` expression and before the `{categoryChanged && canLearn ? (…) : null}` switch, add:

```tsx
{
  selected === PAYROLL_CATEGORY_ID ? (
    <Text style={[styles.hint, { color: theme.textMuted }]}>{t('transactions.salaryHint')}</Text>
  ) : null;
}
```

Add to the `styles` object:

```ts
  hint: { fontSize: 13 },
```

- [ ] **Step 3: Typecheck, format, lint**

Run: `npm run typecheck`
Expected: clean.

```bash
npx prettier --write "apps/mobile/app/transaction/[id].tsx"
npx eslint "apps/mobile/app/transaction/[id].tsx"
```

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/transaction/[id].tsx"
git commit -m "feat(mobile): explain that a salary opens a new dashboard month

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Docs and end-to-end verification

**Files:**

- Create: `docs/pay-period.md`
- Modify: `docs/README.md` (contents table)

- [ ] **Step 1: Write the doc**

Create `docs/pay-period.md`:

```markdown
# Pay period

The dashboard's first card and the budgets screen report on a _pay period_,
not a calendar month: from the owner's last salary booking up to today.
Salary lands around the 28th; on a calendar month every figure from the 1st to
the 27th reads as debt.

Code: `packages/core/src/period.ts`; `summarisePeriod` in `aggregate.ts`;
`budgetPeriod` in `budget.ts`; `apps/mobile/src/hooks/use-pay-period.ts`.

## What anchors a period

A movement opens a period when its category is `income-salary` and it counts
toward statistics (not excluded by the owner, not an internal transfer). The
booking date is the boundary. Salary drifts with weekends and holidays; using
the real booking date absorbs that with no setting to maintain. There is no
payroll flag or column: categorising a movement as Salary is the marker, and a
learned rule keeps future payrolls landing there.

## Merge window

Two salary bookings within `PAYROLL_MERGE_DAYS` (14 days, inclusive) of each
other count as one: the earlier one opens the period and the later one is
dropped. A bonus paid a week after payroll, or two employers paying days apart,
must not split the month in two.

## Open and closed ends

`Period.to` is `null` while the period is open (no later salary yet), so the
current period runs to the end of the ledger. Once a later salary exists, `to`
is the day before it. Both ends are inclusive.

## Fallback

With no salary booked on or before today, the period is the calendar month:
`from` is the first of the month, `to` is open, `anchored` is `false`, and the
card title reads "This month" instead of "Since 28 Aug".

## Spreadsheet history

Years imported from the tracker workbook book every row on the 1st, salary
included, so their periods are calendar months. Consistent with the fallback.

## Why the forecast ignores it

The year forecast stays on calendar months. An annual projection has no pay
date, and its history is sampled month by month.

## Budgets

Budget limits are monthly and are applied to a pay period as-is. Pro-rating to
29 or 33 days would move the bar for reasons the owner cannot see.
```

- [ ] **Step 2: Link it from the docs index**

In `docs/README.md`, add a row to the contents table after the `import-formats.md` row:

```markdown
| `pay-period.md` | How the dashboard month is anchored on salary bookings, the merge window, the fallback |
```

- [ ] **Step 3: Full verification**

Run each and record the outcome:

```bash
npm test
npm run typecheck
cd apps/mobile && npx expo export --platform ios && cd ../..
```

Expected: all tests pass; typecheck clean; export finishes with a bundle and no red output.

- [ ] **Step 4: Simulator check**

Build and launch on the iOS simulator (`npm run ios` from the repo root, or `cd apps/mobile && npx expo run:ios`). Scripted taps are not available on this Mac (Accessibility denied), so:

- Take a screenshot of the dashboard as it opens: `xcrun simctl io booted screenshot <scratchpad>/dashboard.png`. Confirm the first card reads "Since <day month>" when the ledger has a Salary-categorised movement, "This month" otherwise, and the hint line appears only in the anchored case.
- Ask the owner to open Budgets and a movement, select Salary, and confirm the "All budgets" subtitle and the salary hint by eye.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write docs/pay-period.md docs/README.md
git add docs/pay-period.md docs/README.md
git commit -m "docs: how the dashboard month is anchored on salary bookings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- **Domain** (`period.ts`: constants, `Period`, `payPeriodStarts`, `currentPeriod`, `inPeriod`) — Task 2. Spec's `dates.ts` helpers `addDays`, `firstOfMonth` — Task 1, plus `inDateRange` so `aggregate.ts` and `budget.ts` share the range check without importing `period.ts` at runtime.
- **Aggregates** (`summarisePeriod`, `summariseMonth` wrapper, `budgetPeriod`, `budgetMonth` wrapper, forecast untouched) — Tasks 3 and 4.
- **UI** (dashboard title/figures/hint, budgets progress and subtitle, detail-screen salary hint) — Tasks 6, 7, 8. Year forecast card is untouched.
- **Tests** (starts sorted/deduped/merged; current period open, closed, fallback, salary on today; `summarisePeriod` and `budgetPeriod` inclusive at both ends, transfers and excluded rows dropped; `summariseMonth` still equals the old result on the synthetic year) — Tasks 2, 3, 4.
- **Docs** (`docs/pay-period.md` linked from `docs/README.md`) — Task 9.
- Types line up: `Period` is defined once (Task 2) and imported as a type by Tasks 3, 4, 5; `usePayPeriod` returns `{ period, title }` and Tasks 6 and 7 destructure exactly those names.
