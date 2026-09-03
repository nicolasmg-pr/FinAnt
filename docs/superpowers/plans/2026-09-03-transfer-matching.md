# Transfer Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A move of money between two of the owner's own accounts shows up as a debit in one and a credit in the other; pair them automatically, categorise both `transfer-internal`, link them, and so keep both out of every total.

**Architecture:** A pure matcher in `packages/core/src/transfers.ts` takes the ledger and returns `TransferPair`s (debit id, credit id) under strict rules: different accounts, same currency, opposite equal amounts, within 3 days, neither manual, neither already linked, neither excluded. A mobile service `detectTransfers()` runs the matcher over the whole ledger and writes every pair in one database transaction (migration 5 adds `transfer_peer_id`). It runs at the end of every import and once on app start, so a counterpart imported later from the other bank is still found. Changing a linked row's category by hand breaks the link on both rows. The detail screen shows the peer and opens it on tap.

**Tech Stack:** TypeScript 6 strict, vitest for `packages/core`, React Native 0.86, Expo SDK 57, expo-router, react-i18next, expo-sqlite (SQLCipher). The mobile app has no test runner: verification there is typecheck + bundle export + simulator.

**Spec:** `docs/superpowers/specs/2026-09-03-ledger-control-design.md`, section "Sub-project 4 — transfer-matching".

## Global Constraints

- Money is signed integer minor units plus an ISO 4217 code; never do float arithmetic on a balance. Amount equality is `d.amount.minor === -c.amount.minor` on integers.
- Dates are plain `YYYY-MM-DD` strings. The day distance comes from the existing `daysBetween(a, b)` in `packages/core/src/dates.ts`, which parses in UTC on both ends; never build a `Date` from a booking date anywhere else.
- Domain logic stays in `packages/core` with no React or Expo imports. The matcher is pure and deterministic: same input, same output, no clock, no randomness.
- Relative imports inside packages are extensionless (`'./dates'`, never `'./dates.js'`).
- Category ids are permanent. The transfer category id is `'transfer-internal'`, exported as `INTERNAL_TRANSFER_ID` from `packages/core/src/categories.ts`. Use the constant in TypeScript; SQL may spell the literal.
- Schema migrations are append-only. This sub-project adds migration 5 and nothing else touches migrations 1–4.
- `deleted_at` never reaches `packages/core`; every repository read filters `deleted_at IS NULL`, and every new write guards on it too.
- Aggregates already exclude `transfer-internal` through `countsTowardStats()`. Matching therefore changes nothing in `aggregate.ts`, `budget.ts`, `forecast.ts` or `period.ts`. Do not touch them.
- Translations are typed against `Resources`: every new key must land in `en.ts`, `es.ts` and `de.ts` or typecheck fails.
- `npm run lint:fix` reformats the whole repo. Run `npx prettier --write` and `npx eslint` only on the files you changed.
- Never log a movement, narrative, IBAN or any part of a statement. A startup failure of the matcher may log its error message, nothing about rows.
- Never commit a real bank export. `fixtures/private/` is gitignored. Test data is hand-written in the test file through the factory.
- Branch: `transfer-matching` (already created off `main`). Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Baseline before this branch: `npm test` reports 129 tests passing in 11 files; `npm run typecheck` exits 0.

## File map

| File                                      | Responsibility in this plan                                               |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| `packages/core/src/types.ts`              | `Transaction.transferPeerId: string \| null`                              |
| `packages/core/tests/factory.ts`          | `tx()` accepts `id`, `accountId`, `categorySource`, `transferPeerId`      |
| `packages/core/src/transfers.ts`          | `TRANSFER_MAX_DAYS`, `TransferPair`, `matchTransfers()`                   |
| `packages/core/src/index.ts`              | `export * from './transfers'`                                             |
| `packages/core/tests/transfers.test.ts`   | Matcher tests                                                             |
| `apps/mobile/src/db/schema.ts`            | Migration 5: `transfer_peer_id` column and index                          |
| `apps/mobile/src/db/mappers.ts`           | `TransactionRow.transfer_peer_id`, mapped to `transferPeerId`             |
| `apps/mobile/src/db/transactions-repo.ts` | `linkTransferPairs(pairs)`; `setCategory` clears the link on both rows    |
| `apps/mobile/src/services/transfers.ts`   | `detectTransfers(): Promise<number>`                                      |
| `apps/mobile/src/services/ingest.ts`      | Runs `detectTransfers()` after inserting; `IngestResult.transfersMatched` |
| `apps/mobile/app/_layout.tsx`             | Runs `detectTransfers()` once after the database opens                    |
| `apps/mobile/app/import.tsx`              | Result card line "K transfers between your accounts matched"              |
| `apps/mobile/app/transaction/[id].tsx`    | Linked row shows its peer; tap opens the peer                             |
| `packages/i18n/src/{en,es,de}.ts`         | `transactions.transferMatched`, `import.transfersMatched_one/other`       |
| `docs/data-model.md`                      | "Transfers between own accounts" section                                  |

---

### Task 1: `transferPeerId` on the domain type and the test factory

**Files:**

- Modify: `packages/core/src/types.ts` (the `Transaction` interface, after `excludedFromStats`)
- Modify: `packages/core/tests/factory.ts`

**Interfaces:**

- Produces: `Transaction.transferPeerId: string | null`. Every later task reads it. The factory `tx()` gains optional `id`, `accountId`, `categorySource`, `transferPeerId` so the matcher tests can build both sides of a transfer.

- [ ] **Step 1: Add the field to `Transaction`**

In `packages/core/src/types.ts`, inside `interface Transaction`, directly after the `excludedFromStats` line, add:

```ts
  /** Id of the other half of a matched transfer between the owner's own
   * accounts, set by the matcher. `null` for every other movement. */
  readonly transferPeerId: string | null;
```

- [ ] **Step 2: Run typecheck to see what breaks**

Run: `npm run typecheck`
Expected: FAIL. `packages/core/tests/factory.ts` (property missing) and `apps/mobile/src/db/mappers.ts` (`toTransaction` return misses `transferPeerId`). The mapper is fixed in Task 3; the factory now.

- [ ] **Step 3: Extend the factory**

Replace the whole of `packages/core/tests/factory.ts` `tx()` (the function only; leave `syntheticYear` untouched) with:

```ts
export function tx(partial: {
  date: string;
  amount: number;
  description: string;
  counterparty?: string;
  categoryId?: string | null;
  excludedFromStats?: boolean;
  /** Overrides the sign-derived side, for refund cases. */
  side?: 'income' | 'expense';
  /** Explicit id when a test asserts on ordering; defaults to `t<n>`. */
  id?: string;
  /** Defaults to `acc-1`. Transfer tests need two accounts. */
  accountId?: string;
  categorySource?: 'auto' | 'manual' | 'none';
  transferPeerId?: string | null;
}): Transaction {
  seq += 1;
  const amountMinor = Math.round(partial.amount * 100);
  const accountId = partial.accountId ?? 'acc-1';
  return {
    id: partial.id ?? `t${seq}`,
    accountId,
    bookingDate: partial.date,
    valueDate: null,
    amount: money(amountMinor, 'EUR'),
    side: partial.side ?? sideFromAmount(money(amountMinor, 'EUR')),
    description: partial.description,
    counterparty: partial.counterparty ?? null,
    reference: null,
    categoryId: partial.categoryId ?? null,
    categorySource: partial.categorySource ?? 'none',
    source: 'file-import',
    externalId: null,
    importHash: importHashOf({
      accountId,
      bookingDate: partial.date,
      amountMinor,
      description: partial.description,
    }),
    notes: null,
    excludedFromStats: partial.excludedFromStats ?? false,
    transferPeerId: partial.transferPeerId ?? null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
```

- [ ] **Step 4: Run the core tests**

Run: `npm test`
Expected: 129 tests pass (nothing behavioural changed). `npm run typecheck` still fails only in `apps/mobile/src/db/mappers.ts`; that is expected until Task 3.

- [ ] **Step 5: Format and commit**

```bash
npx prettier --write packages/core/src/types.ts packages/core/tests/factory.ts
git add packages/core/src/types.ts packages/core/tests/factory.ts
git commit -m "feat(core): transactions carry the id of their matched transfer peer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The matcher (`matchTransfers`) with tests

**Files:**

- Create: `packages/core/src/transfers.ts`
- Create: `packages/core/tests/transfers.test.ts`
- Modify: `packages/core/src/index.ts` (add one export line)

**Interfaces:**

- Consumes: `Transaction` (with `transferPeerId`) from Task 1, `daysBetween` from `./dates`.
- Produces:

  ```ts
  export const TRANSFER_MAX_DAYS = 3;
  export interface TransferPair {
    readonly outId: string;
    readonly inId: string;
  }
  export function matchTransfers(
    transactions: readonly Transaction[],
    options?: { maxDays?: number },
  ): TransferPair[];
  ```

  `outId` is the debit (negative amount), `inId` the credit. The mobile service in Task 4 consumes this.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/transfers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TRANSFER_MAX_DAYS, matchTransfers } from '../src/transfers';
import { tx } from './factory';

/** A debit in account A and the matching credit in account B. */
function leg(
  id: string,
  accountId: string,
  date: string,
  amount: number,
  extra: {
    categoryId?: string | null;
    categorySource?: 'auto' | 'manual' | 'none';
    transferPeerId?: string | null;
    excludedFromStats?: boolean;
  } = {},
) {
  return tx({ id, accountId, date, amount, description: 'TRANSFER', ...extra });
}

describe('matchTransfers', () => {
  it('pairs a debit with the opposite credit in another account', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-02', 50),
    ]);
    expect(pairs).toEqual([{ outId: 'out', inId: 'in' }]);
  });

  it('refuses to pair rows from the same account', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'ing', '2026-09-01', 50),
    ]);
    expect(pairs).toEqual([]);
  });

  it('refuses amounts that do not cancel out exactly', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-01', 50.01),
    ]);
    expect(pairs).toEqual([]);
  });

  it('respects the day window on both sides', () => {
    const inside = matchTransfers([
      leg('out', 'ing', '2026-09-04', -50),
      leg('in', 'dkb', '2026-09-01', 50),
    ]);
    expect(inside).toEqual([{ outId: 'out', inId: 'in' }]);

    const outside = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-05', 50),
    ]);
    expect(outside).toEqual([]);
  });

  it('exposes the default window and honours an override', () => {
    expect(TRANSFER_MAX_DAYS).toBe(3);
    const rows = [leg('out', 'ing', '2026-09-01', -50), leg('in', 'dkb', '2026-09-08', 50)];
    expect(matchTransfers(rows)).toEqual([]);
    expect(matchTransfers(rows, { maxDays: 7 })).toEqual([{ outId: 'out', inId: 'in' }]);
  });

  it('never touches a row the owner categorised by hand', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50, { categoryId: 'savings', categorySource: 'manual' }),
      leg('in', 'dkb', '2026-09-01', 50),
    ]);
    expect(pairs).toEqual([]);
  });

  it('never touches an excluded row', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50),
      leg('in', 'dkb', '2026-09-01', 50, { excludedFromStats: true }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('skips rows that are already linked, so a second run is a no-op', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50, {
        categoryId: 'transfer-internal',
        categorySource: 'auto',
        transferPeerId: 'in',
      }),
      leg('in', 'dkb', '2026-09-01', 50, {
        categoryId: 'transfer-internal',
        categorySource: 'auto',
        transferPeerId: 'out',
      }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('uses a credit once when two debits compete, giving it to the closer one', () => {
    const pairs = matchTransfers([
      leg('far', 'ing', '2026-09-01', -50),
      leg('near', 'raisin', '2026-09-03', -50),
      leg('in', 'dkb', '2026-09-03', 50),
    ]);
    // Debits are visited by date: `far` (1 Sep) claims the only credit first,
    // because it is within the window and no other credit exists for it.
    expect(pairs).toEqual([{ outId: 'far', inId: 'in' }]);
  });

  it('gives each debit the closest unmatched credit', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-03', -50),
      leg('early', 'dkb', '2026-09-01', 50),
      leg('same-day', 'dkb', '2026-09-03', 50),
    ]);
    expect(pairs).toEqual([{ outId: 'out', inId: 'same-day' }]);
  });

  it('breaks a distance tie by date then id', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-02', -50),
      leg('b', 'dkb', '2026-09-03', 50),
      leg('a', 'dkb', '2026-09-01', 50),
    ]);
    // Both credits are one day away; the earlier one wins.
    expect(pairs).toEqual([{ outId: 'out', inId: 'a' }]);

    const sameDate = matchTransfers([
      leg('out', 'ing', '2026-09-02', -50),
      leg('b', 'dkb', '2026-09-02', 50),
      leg('a', 'dkb', '2026-09-02', 50),
    ]);
    expect(sameDate).toEqual([{ outId: 'out', inId: 'a' }]);
  });

  it('returns pairs in debit order regardless of input order', () => {
    const rows = [
      leg('in-2', 'dkb', '2026-09-10', 20),
      leg('out-2', 'ing', '2026-09-10', -20),
      leg('in-1', 'dkb', '2026-09-01', 50),
      leg('out-1', 'ing', '2026-09-01', -50),
    ];
    const expected = [
      { outId: 'out-1', inId: 'in-1' },
      { outId: 'out-2', inId: 'in-2' },
    ];
    expect(matchTransfers(rows)).toEqual(expected);
    expect(matchTransfers([...rows].reverse())).toEqual(expected);
  });

  it('still links a transfer a shipped rule already categorised', () => {
    const pairs = matchTransfers([
      leg('out', 'ing', '2026-09-01', -50, {
        categoryId: 'transfer-internal',
        categorySource: 'auto',
      }),
      leg('in', 'dkb', '2026-09-01', 50),
    ]);
    expect(pairs).toEqual([{ outId: 'out', inId: 'in' }]);
  });

  it('ignores zero amounts and unrelated movements', () => {
    const pairs = matchTransfers([
      leg('zero-a', 'ing', '2026-09-01', 0),
      leg('zero-b', 'dkb', '2026-09-01', 0),
      leg('rent', 'ing', '2026-09-01', -950),
      leg('salary', 'dkb', '2026-09-01', 2600),
    ]);
    expect(pairs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test file to verify it fails**

Run: `npx vitest run packages/core/tests/transfers.test.ts`
Expected: FAIL — cannot resolve `../src/transfers`.

- [ ] **Step 3: Implement the matcher**

Create `packages/core/src/transfers.ts`:

```ts
import { daysBetween } from './dates';
import type { Transaction } from './types';

/** A debit and its credit in another account book within this many days of each other. */
export const TRANSFER_MAX_DAYS = 3;

export interface TransferPair {
  /** The debit: negative amount, money leaving one account. */
  readonly outId: string;
  /** The credit: the same amount arriving in another account. */
  readonly inId: string;
}

/**
 * A row the matcher may claim. A manual category is the owner's word and must
 * stand; an excluded row is already out of every total; a linked row has been
 * paired on an earlier run.
 */
function eligible(tx: Transaction): boolean {
  return tx.categorySource !== 'manual' && tx.transferPeerId === null && !tx.excludedFromStats;
}

function byDateThenId(a: Transaction, b: Transaction): number {
  return a.bookingDate.localeCompare(b.bookingDate) || a.id.localeCompare(b.id);
}

function amountKey(currency: string, minor: number): string {
  return `${currency}|${minor}`;
}

/**
 * Pairs each debit with the credit that cancels it out in another account.
 *
 * Deterministic and one-to-one: debits are visited by booking date then id,
 * and each takes the unmatched credit with the smallest day distance, ties
 * broken by the credit's date then id. Same currency, exact opposite amount,
 * different account, within `maxDays`. Rows a shipped rule already put in
 * `transfer-internal` are eligible, so they gain a peer link.
 */
export function matchTransfers(
  transactions: readonly Transaction[],
  options: { maxDays?: number } = {},
): TransferPair[] {
  const maxDays = options.maxDays ?? TRANSFER_MAX_DAYS;

  const debits = transactions
    .filter((tx) => eligible(tx) && tx.amount.minor < 0)
    .sort(byDateThenId);

  // Credits indexed by currency and amount, each bucket already in tie-break order.
  const credits = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (!eligible(tx) || tx.amount.minor <= 0) continue;
    const key = amountKey(tx.amount.currency, tx.amount.minor);
    const bucket = credits.get(key) ?? [];
    bucket.push(tx);
    credits.set(key, bucket);
  }
  for (const bucket of credits.values()) bucket.sort(byDateThenId);

  const claimed = new Set<string>();
  const pairs: TransferPair[] = [];

  for (const debit of debits) {
    const candidates = credits.get(amountKey(debit.amount.currency, -debit.amount.minor));
    if (!candidates) continue;

    let best: Transaction | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const credit of candidates) {
      if (claimed.has(credit.id) || credit.accountId === debit.accountId) continue;
      const distance = Math.abs(daysBetween(debit.bookingDate, credit.bookingDate));
      if (distance > maxDays) continue;
      // Strict `<`: at equal distance the earlier bucket entry (date, then id) stays.
      if (distance < bestDistance) {
        best = credit;
        bestDistance = distance;
      }
    }

    if (best) {
      claimed.add(best.id);
      pairs.push({ outId: debit.id, inId: best.id });
    }
  }

  return pairs;
}
```

- [ ] **Step 4: Export it from the package**

In `packages/core/src/index.ts`, after `export * from './period';`, add:

```ts
export * from './transfers';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/core/tests/transfers.test.ts`
Expected: 14 tests pass.

Run: `npm test`
Expected: 143 tests pass in 12 files.

- [ ] **Step 6: Format, lint and commit**

```bash
npx prettier --write packages/core/src/transfers.ts packages/core/tests/transfers.test.ts packages/core/src/index.ts
npx eslint packages/core/src/transfers.ts packages/core/tests/transfers.test.ts
git add packages/core/src/transfers.ts packages/core/tests/transfers.test.ts packages/core/src/index.ts
git commit -m "feat(core): match debits and credits across accounts as internal transfers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Migration 5, row mapper, and the repository writes

**Files:**

- Modify: `apps/mobile/src/db/schema.ts` (append migration 5)
- Modify: `apps/mobile/src/db/mappers.ts` (`TransactionRow`, `toTransaction`)
- Modify: `apps/mobile/src/db/transactions-repo.ts` (`setCategory`; new `linkTransferPairs`)

**Interfaces:**

- Consumes: `TransferPair`, `INTERNAL_TRANSFER_ID` from `@finant/core`.
- Produces: `linkTransferPairs(pairs: readonly TransferPair[]): Promise<void>` (Task 4 calls it). `setCategory(transactionId, categoryId)` keeps its signature and additionally clears `transfer_peer_id` on the row and on whichever row pointed at it.

- [ ] **Step 1: Append migration 5**

In `apps/mobile/src/db/schema.ts`, after the `version: 4` entry (inside the `MIGRATIONS` array, before the closing `];`), add:

```ts
  {
    version: 5,
    sql: `
      -- Two halves of a move between the owner's own accounts point at each
      -- other. Both are categorised transfer-internal, which already keeps them
      -- out of every total; the link is what lets the detail screen show the
      -- counterpart and lets a manual re-categorisation undo the pairing.
      ALTER TABLE transactions ADD COLUMN transfer_peer_id TEXT;
      CREATE INDEX idx_tx_transfer_peer ON transactions(transfer_peer_id);
    `,
  },
```

`LATEST_VERSION` is derived from the array; nothing else to change.

- [ ] **Step 2: Map the column**

In `apps/mobile/src/db/mappers.ts`, in `interface TransactionRow`, after `excluded_from_stats: number;`, add:

```ts
/** Other half of a matched internal transfer; null otherwise. */
transfer_peer_id: string | null;
```

In `toTransaction`, after `excludedFromStats: row.excluded_from_stats === 1,`, add:

```ts
    transferPeerId: row.transfer_peer_id,
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 (the Task 1 breakage is now resolved).

- [ ] **Step 4: Teach `setCategory` to break a link**

In `apps/mobile/src/db/transactions-repo.ts`, replace the existing `setCategory` function (doc comment included) with:

```ts
/**
 * A manual choice is recorded as such so a later re-run of the rules cannot
 * overwrite it. It also ends any transfer pairing: the owner has said what
 * this row is, so the link is cleared on both sides. The other side keeps its
 * `transfer-internal` category and is not re-paired, because this row is now
 * manual and therefore off limits to the matcher.
 */
export async function setCategory(transactionId: string, categoryId: string): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE transactions SET transfer_peer_id = NULL WHERE transfer_peer_id = ?;',
      transactionId,
    );
    await db.runAsync(
      `UPDATE transactions
          SET category_id = ?, category_source = 'manual', transfer_peer_id = NULL
        WHERE id = ?;`,
      categoryId,
      transactionId,
    );
  });
}
```

- [ ] **Step 5: Add `linkTransferPairs`**

In the same file, change the import line to bring in the pair type and the category constant:

```ts
import {
  INTERNAL_TRANSFER_ID,
  type Transaction,
  type TransactionSide,
  type TransferPair,
  type YearMonth,
} from '@finant/core';
```

Then, directly after `setExcludedFromStats`, add:

```ts
/**
 * Records every matched pair in one transaction: both rows become
 * `transfer-internal` (source `auto`) and point at each other. The WHERE
 * guards repeat the matcher's own rules, so a row the owner categorised or
 * a row linked by a concurrent run is left alone rather than overwritten.
 */
export async function linkTransferPairs(pairs: readonly TransferPair[]): Promise<void> {
  if (pairs.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const pair of pairs) {
      for (const [id, peerId] of [
        [pair.outId, pair.inId],
        [pair.inId, pair.outId],
      ] as const) {
        await db.runAsync(
          `UPDATE transactions
              SET category_id = ?, category_source = 'auto', transfer_peer_id = ?
            WHERE id = ?
              AND deleted_at IS NULL
              AND transfer_peer_id IS NULL
              AND category_source != 'manual';`,
          INTERNAL_TRANSFER_ID,
          peerId,
          id,
        );
      }
    }
  });
}
```

- [ ] **Step 6: Typecheck, format and commit**

Run: `npm run typecheck`
Expected: exit 0.

```bash
npx prettier --write apps/mobile/src/db/schema.ts apps/mobile/src/db/mappers.ts apps/mobile/src/db/transactions-repo.ts
npx eslint apps/mobile/src/db/schema.ts apps/mobile/src/db/mappers.ts apps/mobile/src/db/transactions-repo.ts
git add apps/mobile/src/db/schema.ts apps/mobile/src/db/mappers.ts apps/mobile/src/db/transactions-repo.ts
git commit -m "feat(db): link the two halves of an internal transfer, unlink on manual category

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `detectTransfers()` service, run after import and on app start

**Files:**

- Create: `apps/mobile/src/services/transfers.ts`
- Modify: `apps/mobile/src/services/ingest.ts`
- Modify: `apps/mobile/app/_layout.tsx`

**Interfaces:**

- Consumes: `matchTransfers` (Task 2), `listAllTransactions` and `linkTransferPairs` (Task 3).
- Produces: `detectTransfers(): Promise<number>` returning the number of pairs linked on this run. `IngestResult` gains `readonly transfersMatched: number` (Task 5 shows it).

- [ ] **Step 1: Create the service**

Create `apps/mobile/src/services/transfers.ts`:

```ts
import { matchTransfers } from '@finant/core';
import { linkTransferPairs, listAllTransactions } from '../db/transactions-repo';

/**
 * Pairs debits and credits across the owner's accounts and records the links.
 *
 * Runs over the whole ledger, not just a fresh import: the counterpart of a
 * transfer usually arrives later, in a statement from the other bank. Cheap
 * enough for a personal ledger (one pass, a map lookup per debit). Idempotent:
 * rows already linked are skipped by the matcher, so a second run finds nothing.
 *
 * @returns how many pairs were linked on this run.
 */
export async function detectTransfers(): Promise<number> {
  const ledger = await listAllTransactions();
  const pairs = matchTransfers(ledger);
  await linkTransferPairs(pairs);
  return pairs.length;
}
```

- [ ] **Step 2: Run it at the end of `ingest()`**

In `apps/mobile/src/services/ingest.ts`:

Add the import after the `insertTransactions` import line:

```ts
import { detectTransfers } from './transfers';
```

Extend `IngestResult`:

```ts
export interface IngestResult {
  readonly inserted: number;
  readonly duplicates: number;
  readonly autoCategorised: number;
  readonly uncategorised: number;
  /** Transfers between the owner's accounts paired by this import. */
  readonly transfersMatched: number;
}
```

Replace the last two lines of `ingest()`:

```ts
const { inserted, duplicates } = await insertTransactions(batch);
// Only a new row can complete a pair; a file full of duplicates changes nothing.
const transfersMatched = inserted > 0 ? await detectTransfers() : 0;
return { inserted, duplicates, autoCategorised, uncategorised, transfersMatched };
```

- [ ] **Step 3: Run it once on app start**

In `apps/mobile/app/_layout.tsx`:

Add the import after the `initI18n` import:

```ts
import { detectTransfers } from '../src/services/transfers';
```

Replace the startup effect body:

```ts
useEffect(() => {
  (async () => {
    try {
      await getDatabase();
      await initI18n();
    } catch (cause) {
      setError(cause as Error);
      return;
    }
    // A statement imported before this version may hold unpaired transfers.
    // Matching must never keep the app from starting, so its failure is
    // reported, not raised. Nothing about a row is logged.
    try {
      await detectTransfers();
    } catch (cause) {
      console.warn('Transfer matching failed at startup:', (cause as Error).message);
    }
    setReady(true);
  })();
}, []);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (`import.tsx` reads `result.inserted` and `result.duplicates` only, so the added field breaks nothing yet.)

- [ ] **Step 5: Format, lint and commit**

```bash
npx prettier --write apps/mobile/src/services/transfers.ts apps/mobile/src/services/ingest.ts apps/mobile/app/_layout.tsx
npx eslint apps/mobile/src/services/transfers.ts apps/mobile/src/services/ingest.ts apps/mobile/app/_layout.tsx
git add apps/mobile/src/services/transfers.ts apps/mobile/src/services/ingest.ts apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): detect internal transfers after every import and on app start

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Strings, import result line, and the peer on the detail screen

**Files:**

- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/es.ts`, `packages/i18n/src/de.ts`
- Modify: `apps/mobile/app/import.tsx`
- Modify: `apps/mobile/app/transaction/[id].tsx`

**Interfaces:**

- Consumes: `IngestResult.transfersMatched` (Task 4), `Transaction.transferPeerId` (Task 1), `getTransaction`, `listAccounts`.
- Produces: keys `transactions.transferMatched` (interpolates `amount`, `account`, `date`), `import.transfersMatched_one`, `import.transfersMatched_other`.

- [ ] **Step 1: Add the strings**

`packages/i18n/src/en.ts`, in `transactions`, after the `excludedTag` line:

```ts
    transferMatched: 'Transfer between your accounts · matched with {{amount}} · {{account}} · {{date}}',
```

and in `import`, after the `accountRequired` line:

```ts
    transfersMatched_one: '{{count}} transfer between your accounts matched',
    transfersMatched_other: '{{count}} transfers between your accounts matched',
```

`packages/i18n/src/es.ts`, same positions:

```ts
    transferMatched: 'Traspaso entre tus cuentas · emparejado con {{amount}} · {{account}} · {{date}}',
```

```ts
    transfersMatched_one: '{{count}} traspaso entre tus cuentas emparejado',
    transfersMatched_other: '{{count}} traspasos entre tus cuentas emparejados',
```

`packages/i18n/src/de.ts`, same positions:

```ts
    transferMatched: 'Umbuchung zwischen deinen Konten · zugeordnet zu {{amount}} · {{account}} · {{date}}',
```

```ts
    transfersMatched_one: '{{count}} Umbuchung zwischen deinen Konten zugeordnet',
    transfersMatched_other: '{{count}} Umbuchungen zwischen deinen Konten zugeordnet',
```

Run: `npm run typecheck`
Expected: exit 0 (all three locales carry the same keys).

- [ ] **Step 2: Show the count on the import result card**

In `apps/mobile/app/import.tsx`, inside the `result ? (<Card …>)` block, directly after the `result.duplicates > 0 ? … : null` expression and before the Done `Pressable`, add:

```tsx
{
  result.transfersMatched > 0 ? (
    <Text style={{ color: theme.textMuted }}>
      {t('import.transfersMatched', { count: result.transfersMatched })}
    </Text>
  ) : null;
}
```

- [ ] **Step 3: Load the peer on the detail screen**

In `apps/mobile/app/transaction/[id].tsx`:

Change the `formatBookingDate` import to also bring `intlLocale`, and import `formatMoney`:

```ts
import {
  BUILT_IN_CATEGORIES,
  PAYROLL_CATEGORY_ID,
  UNCATEGORISED_ID,
  countsTowardStats,
  formatMoney,
  learnRuleFrom,
  type Category,
  type Transaction,
} from '@finant/core';
```

```ts
import { formatBookingDate, intlLocale } from '../../src/i18n';
```

Add state after `accountName`:

```ts
/** The other half of a matched transfer, with the name of its account. */
const [peer, setPeer] = useState<{ tx: Transaction; accountName: string | null } | null>(null);
```

Replace the load effect body so it also fetches the peer:

```ts
useEffect(() => {
  if (!id) return;
  (async () => {
    const row = await getTransaction(id);
    if (!row) {
      // Deleted elsewhere or a stale link: nothing to show, so leave.
      router.back();
      return;
    }
    setTx(row);
    setSelected(row.categoryId);
    const accounts = await listAccounts();
    const nameOf = (accountId: string) => accounts.find((a) => a.id === accountId)?.name ?? null;
    setAccountName(nameOf(row.accountId));
    const other = row.transferPeerId ? await getTransaction(row.transferPeerId) : null;
    setPeer(other ? { tx: other, accountName: nameOf(other.accountId) } : null);
  })().catch((cause: unknown) => setError((cause as Error).message));
}, [id, router]);
```

- [ ] **Step 4: Render the peer line**

In the first `<Card>` of the returned JSX, directly after the `excludedFromTotals ? … : null` expression, add:

```tsx
{
  peer ? (
    <Pressable
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: peer.tx.id } })}
      accessibilityRole="link"
    >
      <Text style={[styles.peer, { color: theme.accent }]}>
        {t('transactions.transferMatched', {
          amount: formatMoney(peer.tx.amount, intlLocale()),
          account: peer.accountName ?? '',
          date: formatBookingDate(peer.tx.bookingDate, { day: 'numeric', month: 'short' }),
        })}
      </Text>
    </Pressable>
  ) : null;
}
```

Add to the `styles` object, after `tag`:

```ts
  peer: { fontSize: 13, marginTop: spacing.xs },
```

- [ ] **Step 5: Typecheck, bundle, format, commit**

Run: `npm run typecheck`
Expected: exit 0.

Run:

```bash
cd apps/mobile && npx expo export --platform ios --output-dir /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/7e6b7fe0-2595-4880-b3f2-cf37eeef63ea/scratchpad/export && cd ../..
```

Expected: "Exported" summary, no error.

```bash
npx prettier --write packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts apps/mobile/app/import.tsx "apps/mobile/app/transaction/[id].tsx"
npx eslint apps/mobile/app/import.tsx "apps/mobile/app/transaction/[id].tsx"
git add packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts apps/mobile/app/import.tsx "apps/mobile/app/transaction/[id].tsx"
git commit -m "feat(mobile): show matched transfers on the import result and the movement detail

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Document the model

**Files:**

- Modify: `docs/data-model.md`

- [ ] **Step 1: Add the section**

In `docs/data-model.md`, after the "Deleting a movement" section and before "What is excluded from statistics", add:

```markdown
## Transfers between own accounts

A move of 50 € from one of the owner's accounts to another books as −50 € in
the first and +50 € in the second. Neither is income or expense.
`matchTransfers()` in `packages/core/src/transfers.ts` pairs them: different
accounts, same currency, exactly opposite amounts, booked within
`TRANSFER_MAX_DAYS` (3) of each other, neither categorised by hand, neither
excluded, neither already paired. Debits are visited by date then id and each
takes the closest unmatched credit, so the result is deterministic and
one-to-one.

`transfer_peer_id` (migration 5) holds the other half's id on both rows, and
both rows are set to `transfer-internal` with `category_source = 'auto'`. That
category already fails `countsTowardStats()`, so totals need no new rule; the
link is what lets the detail screen show the counterpart.

`detectTransfers()` (`apps/mobile/src/services/transfers.ts`) runs the matcher
over the whole ledger after every import and once on app start: the second
half usually arrives later, in a statement from the other bank. It is
idempotent because linked rows are never candidates again.

Changing the category of a linked row by hand clears `transfer_peer_id` on
both rows. The other side keeps `transfer-internal` and is not re-paired,
because the row the owner touched is now `manual` and off limits to the
matcher. If the other side was wrong too, the owner fixes it by hand. There is
no manual pairing UI for transfers the matcher misses.
```

Also update the `transactions` bullet under "Tables":

```markdown
- `transactions` — the ledger. See dedupe, soft delete and transfers below.
```

- [ ] **Step 2: Format and commit**

```bash
npx prettier --write docs/data-model.md
git add docs/data-model.md
git commit -m "docs: how transfers between own accounts are paired and unpaired

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Verify on device and finish the branch

**Files:** none new.

- [ ] **Step 1: Full checks**

Run:

```bash
npm run typecheck && npm test
```

Expected: typecheck exit 0; vitest reports 143 tests passing in 12 files (129 before this branch plus the 14 matcher tests from Task 2).

- [ ] **Step 2: Bundle check**

Run:

```bash
cd apps/mobile && npx expo export --platform ios --output-dir /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/7e6b7fe0-2595-4880-b3f2-cf37eeef63ea/scratchpad/export && cd ../..
```

Expected: "Exported" summary, no error.

- [ ] **Step 3: Run in the simulator**

Run (background, it takes minutes):

```bash
cd apps/mobile && npx expo run:ios
```

Scripted taps are not available on this Mac (Accessibility denied for osascript), so the owner verifies by hand. The simulator database migrates from version 4 to 5 on first launch; if the app shows "FinAnt could not start", the migration is the first suspect.

1. Import a CSV into account A that contains a −50,00 € outgoing transfer. Import a second CSV into account B with the +50,00 € arrival within three days. The result card of the second import reads "1 transfer between your accounts matched".
2. Open the Movements tab: both rows render muted with the "Internal transfer" tag. The dashboard's income and expenses did not move by 50 €.
3. Open either row. Under the headline, a line in the accent colour reads "Transfer between your accounts · matched with +50,00 € · <account B> · <date>". Tap it: the peer opens, with its own line pointing back.
4. On the peer, change the category to anything else and save. Reopen the first row: the transfer line is gone, and its category still reads "Internal transfer · set by a rule".
5. Kill and relaunch the app: nothing is re-paired (the changed row is manual now).
6. Import the first CSV again: every row reports as a duplicate and "transfers matched" is not shown.

Take a screenshot of the detail screen showing the peer line:

```bash
xcrun simctl io booted screenshot /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/7e6b7fe0-2595-4880-b3f2-cf37eeef63ea/scratchpad/transfer-detail.png
```

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch`. The agreed flow is: merge `transfer-matching` into `main` with a `--no-ff` merge commit whose subject starts with `merge:`, keep the branch, then the owner pushes. Pushing from this session is blocked by the permission classifier; the owner runs:

```bash
git push origin main transfer-matching
```
