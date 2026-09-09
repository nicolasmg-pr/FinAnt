# Bank Notification Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On Android, read the push notifications the owner's own bank apps post, turn the ones that describe money into provisional movements, and let the next statement import supersede them.

**Architecture:** A local Expo module holds a Kotlin `NotificationListenerService` that filters by package name before any notification text is read, then hands the text to a headless JS task which writes it straight into the SQLCipher database. Parsing and reconciliation are pure functions in `packages/core` and `packages/importers`, so the logic that can corrupt the ledger is unit-tested in plain node while the native layer stays thin enough to review by eye.

**Tech Stack:** TypeScript 6 strict, React 19.2, React Native 0.86.3, Expo SDK 57, expo-sqlite with SQLCipher, Kotlin (Expo Modules API), vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-notification-capture-design.md` — read it before Task 1. The plan argues from the spec; where they disagree, the spec wins and the plan is wrong.

## Global Constraints

- TypeScript strict, `noUncheckedIndexedAccess` on. A missing array element is `T | undefined` and must be handled.
- Relative imports inside packages are **extensionless**. Metro does not map `./money.js` onto `money.ts`.
- Money is signed integer minor units plus an ISO 4217 code. No float arithmetic on any balance, ever.
- A transaction carries `side` as well as a sign. A refund is a positive amount on the expense side. Aggregate by `side`, never by sign alone.
- Dates are plain `YYYY-MM-DD` / `YYYY-MM` strings. The single sanctioned timestamp-to-date conversion in this feature is `localCalendarDay()` in Task 2; nothing else may derive a date from a timestamp.
- Schema migrations are append-only. Migration 9 is the only new one; never edit migrations 1-8.
- Category ids are permanent. Rename a label, never an id.
- `packages/core` stays free of React and Expo imports.
- Never log a movement, narrative, IBAN, or any part of a statement or notification. No `console.log` of captured text at any point, not even temporarily while debugging.
- No network calls. This feature adds none.
- No auto-created entities: the owner names every notification source and picks the account every route points at.
- Never commit a real bank export or a real notification string. `fixtures/private/` is gitignored; test fixtures are hand-written from documented wording.
- Tests: `npm test` runs vitest over `packages/*` only. `apps/mobile` has no test harness; tasks touching it are verified by `npm run typecheck` plus the device checklist in Task 12.
- Format only what you touched: `npx prettier --write <paths>`. A bare `npm run lint:fix` reformats the whole repo and drowns the diff.
- Pinned versions are load-bearing: react-native 0.86.3, expo ~57.0.18. Do not upgrade anything.
- Branch is `notification-capture`. Commit after every task.

---

### Task 1: Core types, hash reuse, and the reconciliation matcher

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/dedupe.ts`
- Create: `packages/core/src/provisional.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/tests/factory.ts`
- Test: `packages/core/tests/provisional.test.ts`
- Test: `packages/core/tests/dedupe.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `TransactionSource` widened to `'file-import' | 'manual' | 'notification'`; `Transaction.provisional: boolean`; `Transaction.supersededById: string | null`; `fnv1aHash(payload: string): string`; `matchProvisionals(provisionals, booked): ProvisionalMatchResult`; `staleProvisionals(provisionals, coverage, today): readonly string[]`; constants `PROVISIONAL_DAY_WINDOW`, `PROVISIONAL_STALE_DAYS`.

- [ ] **Step 1: Capture the current import hash as a golden value**

`importHashOf` is about to be refactored to share its hash function. Its output must not change: every already-imported movement's `import_hash` is stored in the database and is the dedupe key. A changed hash silently re-imports the owner's entire history.

Run this and note the two strings it prints:

```bash
npx tsx -e "import {importHashOf} from './packages/core/src/dedupe'; console.log(importHashOf({accountId:'acc-1',bookingDate:'2026-01-15',amountMinor:-1299,description:'NETFLIX.COM'})); console.log(importHashOf({accountId:'acc-1',bookingDate:'2026-01-15',amountMinor:-1299,description:'NETFLIX.COM',discriminator:2}));"
```

- [ ] **Step 2: Write the failing golden test**

Create `packages/core/tests/dedupe.test.ts`, substituting the two strings printed in Step 1 for `PASTE_1` and `PASTE_2`:

```ts
import { describe, expect, it } from 'vitest';
import { fnv1aHash, importHashOf } from '../src/dedupe';

describe('importHashOf', () => {
  // Golden values. These hashes are stored in every existing database as
  // transactions.import_hash and are the dedupe key: if this test fails, the
  // change under it would re-import the owner's whole history as new rows.
  it('has not changed', () => {
    expect(
      importHashOf({
        accountId: 'acc-1',
        bookingDate: '2026-01-15',
        amountMinor: -1299,
        description: 'NETFLIX.COM',
      }),
    ).toBe('PASTE_1');
  });

  it('has not changed for a discriminated row', () => {
    expect(
      importHashOf({
        accountId: 'acc-1',
        bookingDate: '2026-01-15',
        amountMinor: -1299,
        description: 'NETFLIX.COM',
        discriminator: 2,
      }),
    ).toBe('PASTE_2');
  });
});

describe('fnv1aHash', () => {
  it('is stable and differs by input', () => {
    expect(fnv1aHash('abc')).toBe(fnv1aHash('abc'));
    expect(fnv1aHash('abc')).not.toBe(fnv1aHash('abd'));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run packages/core/tests/dedupe.test.ts`
Expected: FAIL — `fnv1aHash` is not exported yet.

- [ ] **Step 4: Extract the hash function in `packages/core/src/dedupe.ts`**

Replace the inline hashing at the bottom of `importHashOf` with a call to a named export, leaving the payload construction exactly as it is:

```ts
/**
 * FNV-1a over a payload string, suffixed with the payload length.
 *
 * Shared by `importHashOf` and by the notification capture hash, so the two
 * cannot drift apart. No crypto dependency, no async, and a collision here
 * only risks hiding one duplicate-looking row — it is not a security boundary.
 *
 * The output format is frozen: `transactions.import_hash` values already on
 * devices were produced by it, and they are the dedupe key.
 */
export function fnv1aHash(payload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `h${hash.toString(16).padStart(8, '0')}${payload.length.toString(16)}`;
}
```

Then in `importHashOf`, replace the loop and return with `return fnv1aHash(payload);`.

- [ ] **Step 5: Run the golden test**

Run: `npx vitest run packages/core/tests/dedupe.test.ts`
Expected: PASS. If either golden test fails, the refactor changed the hash — revert and try again; do not update the golden values.

- [ ] **Step 6: Widen the transaction types**

In `packages/core/src/types.ts`, change the source union and add two fields to `Transaction`:

```ts
export type TransactionSource = 'file-import' | 'manual' | 'notification';
```

Inside `interface Transaction`, after `transferPeerId`:

```ts
  /**
   * True while the only evidence for this movement is a push notification one
   * of the owner's bank apps posted. It counts in the month's totals and in
   * the account balance, and is replaced by the statement row that books it.
   *
   * The owner accepting a capture by hand does not clear this: agreeing with
   * what the notification said is not the bank having booked it.
   */
  readonly provisional: boolean;
  /**
   * Set on a provisional movement when reconciliation replaced it with the
   * statement row that booked it. The provisional is soft-deleted at the same
   * time, so this is the trail from what the owner saw to what the bank did.
   */
  readonly supersededById: string | null;
```

- [ ] **Step 7: Teach the test factory the new fields**

In `packages/core/tests/factory.ts`, add to the `partial` parameter type:

```ts
  provisional?: boolean;
  supersededById?: string | null;
  source?: 'file-import' | 'manual' | 'notification';
```

and to the returned object, replacing the existing `source: 'file-import',` line:

```ts
    source: partial.source ?? 'file-import',
    provisional: partial.provisional ?? false,
    supersededById: partial.supersededById ?? null,
```

- [ ] **Step 8: Run the whole suite to see what the widened type broke**

Run: `npm test`
Expected: PASS. The two new fields have defaults in the factory, so existing tests should be unaffected. If anything fails, it is a real gap — fix it before continuing.

- [ ] **Step 9: Write the failing matcher tests**

Create `packages/core/tests/provisional.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchProvisionals, staleProvisionals } from '../src/provisional';
import { tx } from './factory';

function provisional(partial: Parameters<typeof tx>[0]) {
  return tx({ ...partial, provisional: true, source: 'notification' });
}

describe('matchProvisionals', () => {
  it('matches an exact same-day pair', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -42.3, description: 'REWE SAGT DANKE' });
    const result = matchProvisionals([p], [b]);
    expect(result.matches).toEqual([{ provisionalId: 'p1', bookedId: 'b1' }]);
    expect(result.ambiguous).toEqual([]);
  });

  it('matches a card payment that books three days later for the same amount', () => {
    const p = provisional({
      id: 'p1',
      date: '2026-03-10',
      amount: -42.3,
      description: 'TRATTORIA',
    });
    const b = tx({
      id: 'b1',
      date: '2026-03-13',
      amount: -42.3,
      description: 'TRATTORIA DA MARIO',
    });
    expect(matchProvisionals([p], [b]).matches).toEqual([{ provisionalId: 'p1', bookedId: 'b1' }]);
  });

  it('refuses a pair four days apart', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-14', amount: -42.3, description: 'REWE' });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('refuses a pair whose amounts differ by a single cent', () => {
    // No tolerance, by decision: a booked figure that differs from the one the
    // notification announced is a different fact, not a rounding of the same
    // one. A tipped restaurant bill therefore stays unmatched — see the module
    // comment for what that costs and why it is the trade taken.
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -42.31, description: 'REWE' });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('never crosses currencies', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const foreign = { ...b, amount: { minor: b.amount.minor, currency: 'CHF' } };
    expect(matchProvisionals([p], [foreign]).matches).toEqual([]);
  });

  it('never crosses accounts', () => {
    const p = provisional({
      id: 'p1',
      date: '2026-03-10',
      amount: -42.3,
      description: 'REWE',
      accountId: 'acc-1',
    });
    const b = tx({
      id: 'b1',
      date: '2026-03-10',
      amount: -42.3,
      description: 'REWE',
      accountId: 'acc-2',
    });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('never crosses sides, so a refund does not consume a purchase', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -42.3, description: 'REWE' });
    const b = tx({
      id: 'b1',
      date: '2026-03-10',
      amount: 42.3,
      description: 'REWE',
      side: 'expense',
    });
    expect(matchProvisionals([p], [b]).matches).toEqual([]);
  });

  it('consumes each provisional at most once', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const b1 = tx({ id: 'b1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const b2 = tx({ id: 'b2', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const result = matchProvisionals([p], [b1, b2]);
    expect(result.matches).toHaveLength(1);
  });

  it('leaves two equally good provisionals alone rather than guessing', () => {
    const p1 = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const p2 = provisional({ id: 'p2', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const b = tx({ id: 'b1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const result = matchProvisionals([p1, p2], [b]);
    expect(result.matches).toEqual([]);
    expect([...result.ambiguous].sort()).toEqual(['p1', 'p2']);
  });

  it('ignores a booked row that is itself provisional', () => {
    const p = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const other = provisional({ id: 'p2', date: '2026-03-10', amount: -20, description: 'CAFE' });
    expect(matchProvisionals([p], [other]).matches).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const p1 = provisional({ id: 'p1', date: '2026-03-10', amount: -20, description: 'CAFE' });
    const p2 = provisional({ id: 'p2', date: '2026-03-12', amount: -20, description: 'CAFE' });
    const b = tx({ id: 'b1', date: '2026-03-12', amount: -20, description: 'CAFE' });
    const a = matchProvisionals([p1, p2], [b]);
    const c = matchProvisionals([p2, p1], [b]);
    expect(a.matches).toEqual(c.matches);
    expect(a.matches).toEqual([{ provisionalId: 'p2', bookedId: 'b1' }]);
  });
});

describe('staleProvisionals', () => {
  it('marks a provisional the statements have overtaken', () => {
    const p = provisional({ id: 'p1', date: '2026-01-10', amount: -20, description: 'CAFE' });
    const coverage = new Map([['acc-1', '2026-03-31']]);
    expect(staleProvisionals([p], coverage, '2026-04-01')).toEqual(['p1']);
  });

  it('leaves a young provisional alone', () => {
    const p = provisional({ id: 'p1', date: '2026-03-20', amount: -20, description: 'CAFE' });
    const coverage = new Map([['acc-1', '2026-03-31']]);
    expect(staleProvisionals([p], coverage, '2026-04-01')).toEqual([]);
  });

  it('leaves an old provisional alone when no statement covers its date', () => {
    const p = provisional({ id: 'p1', date: '2026-01-10', amount: -20, description: 'CAFE' });
    const coverage = new Map([['acc-1', '2025-12-31']]);
    expect(staleProvisionals([p], coverage, '2026-04-01')).toEqual([]);
  });

  it('leaves an old provisional alone when the account was never imported', () => {
    const p = provisional({ id: 'p1', date: '2026-01-10', amount: -20, description: 'CAFE' });
    expect(staleProvisionals([p], new Map(), '2026-04-01')).toEqual([]);
  });
});
```

- [ ] **Step 10: Run the tests and watch them fail**

Run: `npx vitest run packages/core/tests/provisional.test.ts`
Expected: FAIL — cannot resolve `../src/provisional`.

- [ ] **Step 11: Write `packages/core/src/provisional.ts`**

```ts
import { daysBetween } from './dates';
import type { ISODate, Transaction } from './types';

/**
 * Reconciling provisional movements against the statement rows that book them.
 *
 * A movement born from a push notification is an approximation: the text
 * carries no bank transaction id, and a card authorisation books days later,
 * sometimes for a different amount. So the unique indexes cannot catch the
 * duplicate — the two rows genuinely differ — and matching has to be explicit,
 * reviewed code. Everything here is pure and works on rows the caller read.
 *
 * **Amounts must match exactly.** There is no tolerance band. What the bank
 * booked is what the ledger shows, and a booked figure that differs from the
 * one the notification announced is a different fact, not a rounding of the
 * same one.
 *
 * The cost is explicit and accepted. A restaurant bill authorised at 42,30 and
 * booked at 43,50 with a tip does not reconcile, so the ledger holds both the
 * unconfirmed 42,30 and the booked 43,50 until the owner clears the leftover —
 * which `staleProvisionals` surfaces. The alternative buys tidiness by merging
 * two rows on a guess, and a wrong merge makes a real movement disappear.
 *
 * The other rule that must not be softened: an ambiguous match is never
 * resolved by guessing. Picking one of two equally plausible provisionals is
 * how a real movement disappears from someone's ledger.
 */

/** Booking dates this far apart can still be the same movement. */
export const PROVISIONAL_DAY_WINDOW = 3;
/**
 * A provisional older than this, on an account whose statements have already
 * been imported past its date, is treated as one the bank never booked: a
 * declined authorisation, or a hotel hold that was released.
 *
 * Deliberately longer than any settlement cycle the owner's banks use, so a
 * slow booking is never mistaken for a dead one.
 */
export const PROVISIONAL_STALE_DAYS = 45;

export interface ProvisionalMatch {
  readonly provisionalId: string;
  readonly bookedId: string;
}

export interface ProvisionalMatchResult {
  readonly matches: readonly ProvisionalMatch[];
  /**
   * Provisionals that a booked row matched equally well as another. Left
   * provisional and surfaced to the owner rather than resolved by coin toss.
   */
  readonly ambiguous: readonly string[];
}

interface Candidate {
  readonly provisional: Transaction;
  readonly dayDelta: number;
}

function isCandidate(provisional: Transaction, booked: Transaction): Candidate | null {
  if (provisional.accountId !== booked.accountId) return null;
  if (provisional.amount.currency !== booked.amount.currency) return null;
  if (provisional.side !== booked.side) return null;
  // Signed equality, which also settles the sign: a refund is a positive
  // amount on the expense side and a purchase a negative one, and side alone
  // does not separate them.
  if (provisional.amount.minor !== booked.amount.minor) return null;

  const dayDelta = Math.abs(daysBetween(provisional.bookingDate, booked.bookingDate));
  if (dayDelta > PROVISIONAL_DAY_WINDOW) return null;

  return { provisional, dayDelta };
}

/**
 * Closest date wins, then id so two runs agree. The amount plays no part in
 * the ordering: every candidate matched it exactly, or it would not be one.
 */
function betterFirst(a: Candidate, b: Candidate): number {
  if (a.dayDelta !== b.dayDelta) return a.dayDelta - b.dayDelta;
  return a.provisional.id < b.provisional.id ? -1 : 1;
}

function equallyGood(a: Candidate, b: Candidate): boolean {
  return a.dayDelta === b.dayDelta;
}

/**
 * Pairs provisional movements with the statement rows that book them.
 *
 * @param provisionals rows with `provisional === true`, not deleted.
 * @param booked candidate statement rows. Rows that are themselves provisional
 *   are ignored, so two notifications can never reconcile each other.
 */
export function matchProvisionals(
  provisionals: readonly Transaction[],
  booked: readonly Transaction[],
): ProvisionalMatchResult {
  const matches: ProvisionalMatch[] = [];
  const ambiguous = new Set<string>();
  const consumed = new Set<string>();

  // Deterministic order: the same inputs must always produce the same pairing,
  // whatever order the repository handed the rows over in.
  const targets = [...booked]
    .filter((row) => !row.provisional)
    .sort((a, b) =>
      a.bookingDate === b.bookingDate
        ? a.id < b.id
          ? -1
          : 1
        : a.bookingDate < b.bookingDate
          ? -1
          : 1,
    );

  for (const target of targets) {
    const candidates: Candidate[] = [];
    for (const provisional of provisionals) {
      if (consumed.has(provisional.id)) continue;
      const candidate = isCandidate(provisional, target);
      if (candidate) candidates.push(candidate);
    }
    if (candidates.length === 0) continue;

    candidates.sort(betterFirst);
    const best = candidates[0] as Candidate;
    const runnerUp = candidates[1];

    if (runnerUp && equallyGood(best, runnerUp)) {
      // Two provisionals fit this booked row equally well. Both stay, and the
      // owner decides. Marking them is the whole point: silence here loses a
      // movement or doubles one.
      for (const candidate of candidates) {
        if (equallyGood(best, candidate)) ambiguous.add(candidate.provisional.id);
      }
      continue;
    }

    consumed.add(best.provisional.id);
    matches.push({ provisionalId: best.provisional.id, bookedId: target.id });
  }

  return { matches, ambiguous: [...ambiguous].filter((id) => !consumed.has(id)) };
}

/**
 * Provisionals the bank appears never to have booked.
 *
 * @param coverage account id to the latest booking date imported for it. An
 *   account missing from the map has no statement coverage at all, so nothing
 *   on it can be called stale.
 */
export function staleProvisionals(
  provisionals: readonly Transaction[],
  coverage: ReadonlyMap<string, ISODate>,
  today: ISODate,
): readonly string[] {
  const stale: string[] = [];
  for (const provisional of provisionals) {
    if (daysBetween(provisional.bookingDate, today) < PROVISIONAL_STALE_DAYS) continue;
    const coveredTo = coverage.get(provisional.accountId);
    if (!coveredTo) continue;
    if (coveredTo < provisional.bookingDate) continue;
    stale.push(provisional.id);
  }
  return stale;
}
```

- [ ] **Step 12: Export it**

Add to `packages/core/src/index.ts`, after the `export * from './balance';` line:

```ts
export * from './provisional';
```

- [ ] **Step 13: Run the tests**

Run: `npx vitest run packages/core/tests/provisional.test.ts`
Expected: PASS, all 15 tests.

If `daysBetween` returns a negative number in the stale test, check its argument order in `packages/core/src/dates.ts` and fix the call, not the test.

- [ ] **Step 14: Full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: both PASS. `apps/mobile` will fail typecheck at this point because `toTransaction` in `mappers.ts` does not yet supply `provisional` and `supersededById`. That is Task 3's job — if the failure is only that, note it and continue.

- [ ] **Step 15: Commit**

```bash
npx prettier --write packages/core/src/provisional.ts packages/core/src/types.ts packages/core/src/dedupe.ts packages/core/src/index.ts packages/core/tests/provisional.test.ts packages/core/tests/dedupe.test.ts packages/core/tests/factory.ts
git add packages/core
git commit -m "feat(core): a movement can be provisional, and a statement can supersede it"
```

---

### Task 2: The notification parse contract and registry

**Files:**

- Create: `packages/importers/src/notifications/types.ts`
- Create: `packages/importers/src/notifications/registry.ts`
- Create: `packages/importers/src/notifications/index.ts`
- Modify: `packages/importers/src/index.ts`
- Test: `packages/importers/tests/notifications.test.ts`

**Interfaces:**

- Consumes: `fnv1aHash` from `@finant/core` (Task 1).
- Produces: `CapturedNotification`, `ParsedMovement`, `NotificationParseResult`, `NotificationParser`, `NOTIFICATION_PARSERS`, `parseNotification(input, parsers?)`, `captureHashOf(input)`, `localCalendarDay(millis, offsetMinutes)`.

This task ships **no bank parsers**. `NOTIFICATION_PARSERS` starts empty, and real templates arrive in Task 11 once the owner has supplied real notification strings. Nothing downstream is blocked: an allowlisted app with no parser produces an `unreadable` capture, which is exactly the state the inbox is designed to show.

- [ ] **Step 1: Write the failing tests**

Create `packages/importers/tests/notifications.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  captureHashOf,
  localCalendarDay,
  parseNotification,
  type CapturedNotification,
  type NotificationParser,
} from '../src/notifications/index';

const capture: CapturedNotification = {
  packageName: 'com.example.bank',
  title: 'Card payment',
  body: 'EUR 12.34 at REWE',
  bookingDate: '2026-03-10',
  postedAtMillis: 1772000000000,
};

const stub: NotificationParser = {
  id: 'example-card',
  packageName: 'com.example.bank',
  parse: (input) =>
    input.body?.includes('EUR')
      ? {
          kind: 'movement',
          parserId: 'example-card',
          movement: {
            amountMinor: -1234,
            currency: 'EUR',
            side: 'expense',
            description: 'REWE',
            counterparty: 'REWE',
          },
        }
      : { kind: 'ignored', parserId: 'example-card' },
};

describe('parseNotification', () => {
  it('reports an unreadable capture when no parser claims the package', () => {
    const result = parseNotification(capture, []);
    expect(result.kind).toBe('unreadable');
    expect(result.kind === 'unreadable' && result.reason).toBe('no-parser');
  });

  it('returns the movement a matching parser produced', () => {
    const result = parseNotification(capture, [stub]);
    expect(result.kind).toBe('movement');
    expect(result.kind === 'movement' && result.movement.amountMinor).toBe(-1234);
  });

  it('passes an ignored verdict through, so marketing does not raise an alarm', () => {
    const result = parseNotification({ ...capture, body: 'Your statement is ready' }, [stub]);
    expect(result.kind).toBe('ignored');
  });

  it('ignores parsers registered for another package', () => {
    const result = parseNotification({ ...capture, packageName: 'com.other.bank' }, [stub]);
    expect(result.kind).toBe('unreadable');
  });

  it('prefers a movement over an earlier parser that could not read it', () => {
    const blind: NotificationParser = {
      id: 'blind',
      packageName: 'com.example.bank',
      parse: () => ({ kind: 'unreadable', reason: 'wording-changed' }),
    };
    const result = parseNotification(capture, [blind, stub]);
    expect(result.kind).toBe('movement');
  });

  it('reports the first reason when every parser for the package fails', () => {
    const blind: NotificationParser = {
      id: 'blind',
      packageName: 'com.example.bank',
      parse: () => ({ kind: 'unreadable', reason: 'wording-changed' }),
    };
    const result = parseNotification(capture, [blind]);
    expect(result.kind === 'unreadable' && result.reason).toBe('wording-changed');
  });
});

describe('captureHashOf', () => {
  it('ignores the booking date, which is derived from the post time', () => {
    // Assigned to a typed variable first: passing the object literal inline
    // trips TypeScript's excess-property check, because captureHashOf's
    // parameter type deliberately has no bookingDate.
    const sameNotificationLaterDay: CapturedNotification = {
      ...capture,
      bookingDate: '2026-03-11',
    };
    expect(captureHashOf(capture)).toBe(captureHashOf(sameNotificationLaterDay));
  });

  it('differs when the text differs', () => {
    expect(captureHashOf(capture)).not.toBe(
      captureHashOf({ ...capture, body: 'EUR 12.35 at REWE' }),
    );
  });

  it('differs when the post time differs, so two identical coffees stay two', () => {
    expect(captureHashOf(capture)).not.toBe(
      captureHashOf({ ...capture, postedAtMillis: capture.postedAtMillis + 60_000 }),
    );
  });
});

describe('localCalendarDay', () => {
  it('keeps 1 March as 1 March in a zone ahead of UTC', () => {
    // 2026-03-01 00:30 in Madrid (UTC+1) is 2026-02-28 23:30 UTC.
    // getTimezoneOffset() reports -60 for UTC+1.
    expect(localCalendarDay(Date.UTC(2026, 1, 28, 23, 30), -60)).toBe('2026-03-01');
  });

  it('keeps 1 March as 1 March in a zone behind UTC', () => {
    // 2026-03-01 20:00 in New York (UTC-5) is 2026-03-02 01:00 UTC.
    expect(localCalendarDay(Date.UTC(2026, 2, 2, 1, 0), 300)).toBe('2026-03-01');
  });

  it('agrees with UTC when the offset is zero', () => {
    expect(localCalendarDay(Date.UTC(2026, 2, 10, 12, 0), 0)).toBe('2026-03-10');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/importers/tests/notifications.test.ts`
Expected: FAIL — cannot resolve `../src/notifications/index`.

- [ ] **Step 3: Write `packages/importers/src/notifications/types.ts`**

```ts
import { fnv1aHash, type CurrencyCode, type TransactionSide } from '@finant/core';

/**
 * One notification, as it reached JavaScript from the native listener.
 *
 * There is no `accountId` here: which account a notification is about is
 * decided by the routing rules in `@finant/core`, after parsing, because the
 * discriminator (a card's last four digits, an account nickname) lives in the
 * text a parser has to read first.
 */
export interface CapturedNotification {
  readonly packageName: string;
  readonly title: string | null;
  readonly body: string | null;
  /** Device-local calendar day, already derived. See `localCalendarDay`. */
  readonly bookingDate: string;
  /** Epoch millis as Android reported it. Display and dedupe only, never a date. */
  readonly postedAtMillis: number;
}

export interface ParsedMovement {
  /** Signed minor units. Negative for money out, as everywhere else. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /**
   * Set explicitly by the parser from the notification's own wording, never
   * inferred from the sign: a refund is a positive amount on the expense side.
   */
  readonly side: TransactionSide;
  readonly description: string;
  readonly counterparty: string | null;
}

/**
 * Three verdicts, and the difference between the last two is the point.
 *
 * `ignored` is a notification a parser recognised as deliberately not money —
 * "your statement is ready", a login alert — so the inbox stays clean.
 * `unreadable` is the alarm: a bank changed its wording, or none of our
 * templates has ever seen this shape. It is kept for the owner to look at,
 * because that text is the bug report.
 */
export type NotificationParseResult =
  | { readonly kind: 'movement'; readonly parserId: string; readonly movement: ParsedMovement }
  | { readonly kind: 'ignored'; readonly parserId: string }
  | { readonly kind: 'unreadable'; readonly reason: string };

export interface NotificationParser {
  /** Stable id, stored on the capture so a wording change can be traced. */
  readonly id: string;
  readonly packageName: string;
  parse(input: CapturedNotification): NotificationParseResult;
}

/**
 * Identity of a captured notification, so Android reposting an updated
 * notification cannot create a second movement.
 *
 * Deliberately excludes `bookingDate`, which is derived from `postedAtMillis`
 * and would add nothing, and deliberately includes `postedAtMillis`, so two
 * identical coffees bought an hour apart stay two movements.
 */
export function captureHashOf(input: {
  readonly packageName: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly postedAtMillis: number;
}): string {
  // Each field is length-prefixed before joining. The delimiter can legitimately
  // appear inside a notification's text, and an unprefixed join lets two
  // different notifications produce one payload — title "A" with body "B|C"
  // against title "A|B" with body "C" — which in a dedupe key silently drops
  // one of two real movements.
  const fields = [
    input.packageName,
    String(input.postedAtMillis),
    input.title ?? '',
    input.body ?? '',
  ];
  return fnv1aHash(fields.map((field) => `${field.length}:${field}`).join('|'));
}

/**
 * The one sanctioned timestamp-to-date conversion in this codebase.
 *
 * Android hands us `postTime` as epoch milliseconds and there is no way around
 * it. Everywhere else a booking date is a plain `YYYY-MM-DD` string precisely
 * because routing one through a Date moves 1 March into February west of UTC.
 * So the conversion happens once, here, at the edge, and nothing downstream
 * ever derives a date from a timestamp again.
 *
 * @param offsetMinutes the value of `new Date(millis).getTimezoneOffset()` —
 *   minutes behind UTC, positive west of it. Passed in rather than read here so
 *   this stays a pure function that can be tested without changing TZ.
 */
export function localCalendarDay(millis: number, offsetMinutes: number): string {
  const shifted = new Date(millis - offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

- [ ] **Step 4: Write `packages/importers/src/notifications/registry.ts`**

```ts
import type { CapturedNotification, NotificationParseResult, NotificationParser } from './types';

/**
 * Every shipped notification parser, one per bank per notification shape.
 *
 * Empty until a real notification string exists to write a template from. A
 * bank's push wording is unversioned and changes without notice, so guessing
 * one would be worse than having none: a wrong template files a movement under
 * a wrong amount, while a missing one just says "I could not read this".
 *
 * See `docs/notification-formats.md`.
 */
export const NOTIFICATION_PARSERS: readonly NotificationParser[] = [];

/**
 * Runs the parsers registered for a notification's package.
 *
 * A `movement` or an `ignored` verdict ends the search. If every parser for the
 * package fails, the first reason is reported, so the inbox can say what went
 * wrong rather than only that something did.
 */
export function parseNotification(
  input: CapturedNotification,
  parsers: readonly NotificationParser[] = NOTIFICATION_PARSERS,
): NotificationParseResult {
  let firstReason: string | null = null;

  for (const parser of parsers) {
    if (parser.packageName !== input.packageName) continue;
    const result = parser.parse(input);
    if (result.kind !== 'unreadable') return result;
    firstReason ??= result.reason;
  }

  return { kind: 'unreadable', reason: firstReason ?? 'no-parser' };
}
```

- [ ] **Step 5: Write `packages/importers/src/notifications/index.ts`**

```ts
export * from './types';
export * from './registry';
```

- [ ] **Step 6: Export from the package root**

Add to `packages/importers/src/index.ts`, at the end:

```ts
export * from './notifications/index';
```

- [ ] **Step 7: Run the tests**

Run: `npx vitest run packages/importers/tests/notifications.test.ts`
Expected: PASS, all 12 tests.

- [ ] **Step 8: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
npx prettier --write packages/importers/src/notifications packages/importers/src/index.ts packages/importers/tests/notifications.test.ts
git add packages/importers
git commit -m "feat(importers): a contract for reading a bank's notification, with no bank guessed yet"
```

---

### Task 3: Notification routing in the domain layer

**Files:**

- Create: `packages/core/src/notification-routing.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/tests/notification-routing.test.ts`

**Interfaces:**

- Consumes: `matches`, `targetOf` from `./categorise`; `money` from `./money`; `RuleMatch` from `./types`.
- Produces: `NotificationRoute`, `RouteResolution`, `resolveRoute(input, routes)`.

One bank app can notify about several accounts — DKB's Girokonto and its Visa, Trade Republic card spend and savings-plan executions — so routing matches a discriminator in the text. It reuses the existing `RuleMatch` tree and its evaluator rather than growing a second matcher that drifts from it.

- [ ] **Step 1: Write the failing tests**

Create `packages/core/tests/notification-routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveRoute, type NotificationRoute } from '../src/notification-routing';

const visa: NotificationRoute = {
  id: 'r-visa',
  sourceId: 's-dkb',
  accountId: 'acc-visa',
  match: { kind: 'word', field: 'any', value: 'visa' },
  priority: 100,
};

const giro: NotificationRoute = {
  id: 'r-giro',
  sourceId: 's-dkb',
  accountId: 'acc-giro',
  match: null,
  priority: 100,
};

describe('resolveRoute', () => {
  it('routes on a discriminator in the text', () => {
    const result = resolveRoute({ text: 'Visa payment of 12,34 EUR', amountMinor: -1234 }, [
      visa,
      giro,
    ]);
    expect(result).toEqual({ accountId: 'acc-visa', routeId: 'r-visa', viaFallback: false });
  });

  it('falls back when no discriminator matches', () => {
    const result = resolveRoute({ text: 'Zahlung 12,34 EUR', amountMinor: -1234 }, [visa, giro]);
    expect(result).toEqual({ accountId: 'acc-giro', routeId: 'r-giro', viaFallback: true });
  });

  it('returns null when nothing matches and there is no fallback', () => {
    expect(resolveRoute({ text: 'Zahlung', amountMinor: -1234 }, [visa])).toBeNull();
  });

  it('returns null for no routes at all', () => {
    expect(resolveRoute({ text: 'Zahlung', amountMinor: -1234 }, [])).toBeNull();
  });

  it('prefers the higher priority route', () => {
    const specific: NotificationRoute = {
      id: 'r-gold',
      sourceId: 's-dkb',
      accountId: 'acc-gold',
      match: { kind: 'word', field: 'any', value: 'visa' },
      priority: 500,
    };
    const result = resolveRoute({ text: 'Visa payment', amountMinor: -1234 }, [visa, specific]);
    expect(result?.accountId).toBe('acc-gold');
  });

  it('lets a matching discriminator outrank a fallback whatever the priorities say', () => {
    // Guards a specific regression: merging the two `best()` phases into one
    // pass over all routes would send every notification to the fallback
    // whenever the fallback carried the higher priority number, and every
    // other test here would still pass.
    const eagerFallback: NotificationRoute = { ...giro, priority: 500 };
    const result = resolveRoute({ text: 'Visa payment', amountMinor: -1234 }, [
      visa,
      eagerFallback,
    ]);
    expect(result).toEqual({ accountId: 'acc-visa', routeId: 'r-visa', viaFallback: false });
  });

  it('breaks a priority tie on route id, so two runs agree', () => {
    const other: NotificationRoute = { ...visa, id: 'r-aaa', accountId: 'acc-other' };
    const result = resolveRoute({ text: 'Visa payment', amountMinor: -1234 }, [visa, other]);
    expect(result?.routeId).toBe('r-aaa');
  });

  it('can route on the amount, for a savings plan of a known size', () => {
    const plan: NotificationRoute = {
      id: 'r-plan',
      sourceId: 's-tr',
      accountId: 'acc-depot',
      match: { kind: 'amountBetween', minMinor: -50000, maxMinor: -49999 },
      priority: 200,
    };
    const result = resolveRoute({ text: 'Sparplan ausgefuehrt', amountMinor: -50000 }, [
      plan,
      giro,
    ]);
    expect(result?.accountId).toBe('acc-depot');
  });

  it('ignores accents and case, like every other rule in the app', () => {
    const spanish: NotificationRoute = {
      id: 'r-es',
      sourceId: 's-open',
      accountId: 'acc-es',
      match: { kind: 'contains', field: 'any', value: 'nomina' },
      priority: 100,
    };
    const result = resolveRoute({ text: 'Ingreso de NÓMINA', amountMinor: 250000 }, [spanish]);
    expect(result?.accountId).toBe('acc-es');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run packages/core/tests/notification-routing.test.ts`
Expected: FAIL — cannot resolve `../src/notification-routing`.

- [ ] **Step 3: Write `packages/core/src/notification-routing.ts`**

```ts
import { matches, targetOf } from './categorise';
import { money } from './money';
import type { RuleMatch } from './types';

/**
 * Which of the owner's accounts a notification is about.
 *
 * A bank app is one notification channel for several accounts, so the account
 * cannot come from the package name alone. The discriminator lives in the text
 * — a card's last four digits, "Visa" against "Giro", an account nickname — and
 * is expressed as the same `RuleMatch` tree the categorisation and exclusion
 * rules use, evaluated by the same `matches()`. One matcher, three callers.
 */
export interface NotificationRoute {
  readonly id: string;
  readonly sourceId: string;
  readonly accountId: string;
  /** `null` marks the fallback: used only when no discriminator matched. */
  readonly match: RuleMatch | null;
  /** Higher wins. Ties break on route id for determinism. */
  readonly priority: number;
}

export interface RouteResolution {
  readonly accountId: string;
  readonly routeId: string;
  /**
   * True when no discriminator matched and the fallback took it. The inbox
   * flags these: the owner should either add a rule or move the movement.
   */
  readonly viaFallback: boolean;
}

function best(routes: readonly NotificationRoute[]): NotificationRoute | null {
  let winner: NotificationRoute | null = null;
  for (const route of routes) {
    if (
      winner === null ||
      route.priority > winner.priority ||
      (route.priority === winner.priority && route.id < winner.id)
    ) {
      winner = route;
    }
  }
  return winner;
}

/**
 * @param input the parsed notification's text and signed amount in minor units.
 *   The currency is irrelevant to routing and is not consulted.
 */
export function resolveRoute(
  input: { readonly text: string; readonly amountMinor: number },
  routes: readonly NotificationRoute[],
): RouteResolution | null {
  const target = targetOf({
    description: input.text,
    counterparty: null,
    reference: null,
    // Currency is not part of any routing decision; the matcher only reads
    // `amount.minor` for `amountBetween`.
    amount: money(input.amountMinor, 'EUR'),
  });

  const matched = routes.filter((route) => route.match !== null && matches(route.match, target));
  const winner = best(matched);
  if (winner) return { accountId: winner.accountId, routeId: winner.id, viaFallback: false };

  const fallback = best(routes.filter((route) => route.match === null));
  if (fallback) return { accountId: fallback.accountId, routeId: fallback.id, viaFallback: true };

  return null;
}
```

- [ ] **Step 4: Export it**

Add to `packages/core/src/index.ts`:

```ts
export * from './notification-routing';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/core/tests/notification-routing.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 6: Commit**

```bash
npx prettier --write packages/core/src/notification-routing.ts packages/core/src/index.ts packages/core/tests/notification-routing.test.ts
git add packages/core
git commit -m "feat(core): one bank app can notify about several accounts, so routing matches the text"
```

---

### Task 4: Migration 9, row mappers and repositories

**Files:**

- Modify: `apps/mobile/src/db/schema.ts`
- Modify: `apps/mobile/src/db/mappers.ts`
- Modify: `apps/mobile/src/db/transactions-repo.ts`
- Create: `apps/mobile/src/db/notification-sources-repo.ts`
- Create: `apps/mobile/src/db/notification-captures-repo.ts`

**Interfaces:**

- Consumes: `Transaction`, `NotificationRoute` from `@finant/core` (Tasks 1, 3).
- Produces:
  - `listNotificationSources()`, `getNotificationSourceByPackage(packageName)`, `createNotificationSource(input)`, `updateNotificationSource(id, patch)`, `deleteNotificationSource(id)`, `listNotificationRoutes(sourceId)`, `createNotificationRoute(input)`, `deleteNotificationRoute(id)`, `allowedPackageNames()`
  - `insertCapture(input)`, `listCaptures(statuses)`, `getCapture(id)`, `countOpenCaptures()`, `setCaptureStatus(id, status, transactionId)`, `repointCapture(provisionalTransactionId, bookedTransactionId)`, `deleteAllCaptures()`
  - `findTransactionByHash(accountId, importHash)`, `listProvisionalTransactions()`, `supersedeProvisionals(matches)`, `latestBookedDateByAccount()`
  - `NotificationSource`, `NotificationCapture`, `CaptureStatus`

- [ ] **Step 1: Append migration 9 to `apps/mobile/src/db/schema.ts`**

Add as the last element of the `MIGRATIONS` array, after the migration 8 object. Do not touch any earlier migration.

```ts
  {
    version: 9,
    sql: `
      -- Movements gain a second origin: a push notification one of the owner's
      -- own bank apps posted on this device, read by an Android notification
      -- listener. Android only, opt-in, and never a substitute for a statement.
      --
      -- One row per bank app the owner allows. The label is theirs: nothing
      -- here is auto-created, and a package name is not a bank's name.
      CREATE TABLE notification_sources (
        id TEXT PRIMARY KEY NOT NULL,
        package_name TEXT NOT NULL,
        label TEXT NOT NULL,
        institution_id TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        -- Per source, not global: the owner will trust one bank's wording long
        -- before another's, and one switch would force the weakest template to
        -- gate the strongest.
        auto_approve INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_notif_source_package ON notification_sources(package_name);

      -- A bank app is one channel for several accounts (a Girokonto and its
      -- Visa, card spend and savings-plan executions). match_json holds a
      -- RuleMatch tree, the same shape rules.match_json holds and evaluated by
      -- the same matcher. NULL marks the fallback route, used only when no
      -- discriminator matched, and there can be at most one per source.
      CREATE TABLE notification_routes (
        id TEXT PRIMARY KEY NOT NULL,
        source_id TEXT NOT NULL REFERENCES notification_sources(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        match_json TEXT,
        priority INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_notif_route_fallback ON notification_routes(source_id)
        WHERE match_json IS NULL;

      -- The inbox. This is the only place in FinAnt that holds a narrative the
      -- owner did not import deliberately, so it prunes itself: accepting or
      -- dismissing a capture NULLs title and body and keeps the row as a
      -- hash-only tombstone, which is what stops Android reposting the same
      -- notification from creating a second movement.
      --
      -- posted_at is a real timestamp, and the only one in this schema. Android
      -- reports postTime as epoch millis and there is no way around it, so it
      -- is converted to a local calendar day exactly once, at the edge, by
      -- localCalendarDay() in @finant/importers. Nothing downstream may derive
      -- a date from posted_at: that is how 1 March becomes February west of UTC.
      CREATE TABLE notification_captures (
        id TEXT PRIMARY KEY NOT NULL,
        source_id TEXT REFERENCES notification_sources(id) ON DELETE SET NULL,
        package_name TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        booking_date TEXT NOT NULL,
        title TEXT,
        body TEXT,
        android_key TEXT,
        capture_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        parser_id TEXT,
        parsed_json TEXT,
        transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_notif_capture_hash ON notification_captures(capture_hash);
      CREATE INDEX idx_notif_capture_status ON notification_captures(status);

      -- A notification-born movement counts in the month's totals and in the
      -- account balance immediately, and is replaced by the statement row that
      -- books it. The owner accepting one by hand does not clear the flag:
      -- agreeing with the notification is not the bank having booked it.
      ALTER TABLE transactions ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;

      -- Set when reconciliation replaced a provisional with the statement row
      -- that booked it. The provisional is soft-deleted at the same moment, so
      -- this is the trail from what the owner saw to what the bank did.
      ALTER TABLE transactions ADD COLUMN superseded_by_id TEXT;

      CREATE INDEX idx_tx_provisional ON transactions(provisional) WHERE provisional = 1;
    `,
  },
```

- [ ] **Step 2: Extend the transaction row mapper**

In `apps/mobile/src/db/mappers.ts`, add to `interface TransactionRow`, after `transfer_peer_id`:

```ts
/** 1 while a push notification is the only evidence for this movement. */
provisional: number;
/** The statement row that booked this provisional, once one did. */
superseded_by_id: string | null;
```

and to the object `toTransaction` returns, after `transferPeerId`:

```ts
    provisional: row.provisional === 1,
    supersededById: row.superseded_by_id,
```

- [ ] **Step 3: Add the mapper for the new tables**

Append to `apps/mobile/src/db/mappers.ts`:

```ts
export type CaptureStatus = 'pending' | 'unreadable' | 'accepted' | 'dismissed';

export interface NotificationSource {
  readonly id: string;
  readonly packageName: string;
  readonly label: string;
  readonly institutionId: string | null;
  readonly enabled: boolean;
  readonly autoApprove: boolean;
}

export interface NotificationSourceRow {
  id: string;
  package_name: string;
  label: string;
  institution_id: string | null;
  enabled: number;
  auto_approve: number;
}

export function toNotificationSource(row: NotificationSourceRow): NotificationSource {
  return {
    id: row.id,
    packageName: row.package_name,
    label: row.label,
    institutionId: row.institution_id,
    enabled: row.enabled === 1,
    autoApprove: row.auto_approve === 1,
  };
}

export interface NotificationRouteRow {
  id: string;
  source_id: string;
  account_id: string;
  match_json: string | null;
  priority: number;
}

export function toNotificationRoute(row: NotificationRouteRow): NotificationRoute {
  return {
    id: row.id,
    sourceId: row.source_id,
    accountId: row.account_id,
    match: row.match_json === null ? null : (JSON.parse(row.match_json) as RuleMatch),
    priority: row.priority,
  };
}

/**
 * A captured notification. `title` and `body` are null once the capture has
 * been accepted or dismissed: the row survives as a tombstone so the same
 * notification cannot be captured twice, without keeping the narrative.
 */
export interface NotificationCapture {
  readonly id: string;
  readonly sourceId: string | null;
  readonly packageName: string;
  readonly postedAt: string;
  readonly bookingDate: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly captureHash: string;
  readonly status: CaptureStatus;
  readonly parserId: string | null;
  readonly parsed: ParsedMovement | null;
  readonly transactionId: string | null;
}

export interface NotificationCaptureRow {
  id: string;
  source_id: string | null;
  package_name: string;
  posted_at: string;
  booking_date: string;
  title: string | null;
  body: string | null;
  android_key: string | null;
  capture_hash: string;
  status: string;
  parser_id: string | null;
  parsed_json: string | null;
  transaction_id: string | null;
}

export function toNotificationCapture(row: NotificationCaptureRow): NotificationCapture {
  return {
    id: row.id,
    sourceId: row.source_id,
    packageName: row.package_name,
    postedAt: row.posted_at,
    bookingDate: row.booking_date,
    title: row.title,
    body: row.body,
    captureHash: row.capture_hash,
    status: row.status as CaptureStatus,
    parserId: row.parser_id,
    parsed: row.parsed_json === null ? null : (JSON.parse(row.parsed_json) as ParsedMovement),
    transactionId: row.transaction_id,
  };
}
```

Add `type NotificationRoute` and `type RuleMatch` to the existing `@finant/core` import at the top of the file, and add a new import:

```ts
import type { ParsedMovement } from '@finant/importers';
```

- [ ] **Step 4: Create `apps/mobile/src/db/notification-sources-repo.ts`**

```ts
import type { NotificationRoute } from '@finant/core';
import { getDatabase } from './database';
import {
  toNotificationRoute,
  toNotificationSource,
  type NotificationRouteRow,
  type NotificationSource,
  type NotificationSourceRow,
} from './mappers';
import { newId } from './transactions-repo';

export async function listNotificationSources(): Promise<NotificationSource[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NotificationSourceRow>(
    'SELECT * FROM notification_sources ORDER BY label;',
  );
  return rows.map(toNotificationSource);
}

export async function getNotificationSourceByPackage(
  packageName: string,
): Promise<NotificationSource | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<NotificationSourceRow>(
    'SELECT * FROM notification_sources WHERE package_name = ?;',
    packageName,
  );
  return row ? toNotificationSource(row) : null;
}

export async function createNotificationSource(input: {
  packageName: string;
  label: string;
  institutionId: string | null;
}): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  await db.runAsync(
    `INSERT INTO notification_sources (id, package_name, label, institution_id, enabled, auto_approve, created_at)
       VALUES (?, ?, ?, ?, 1, 0, ?);`,
    id,
    input.packageName,
    input.label,
    input.institutionId,
    new Date().toISOString(),
  );
  return id;
}

export async function updateNotificationSource(
  id: string,
  patch: { label?: string; enabled?: boolean; autoApprove?: boolean },
): Promise<void> {
  const db = await getDatabase();
  if (patch.label !== undefined) {
    await db.runAsync('UPDATE notification_sources SET label = ? WHERE id = ?;', patch.label, id);
  }
  if (patch.enabled !== undefined) {
    await db.runAsync(
      'UPDATE notification_sources SET enabled = ? WHERE id = ?;',
      patch.enabled ? 1 : 0,
      id,
    );
  }
  if (patch.autoApprove !== undefined) {
    await db.runAsync(
      'UPDATE notification_sources SET auto_approve = ? WHERE id = ?;',
      patch.autoApprove ? 1 : 0,
      id,
    );
  }
}

export async function deleteNotificationSource(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notification_sources WHERE id = ?;', id);
}

export async function listNotificationRoutes(sourceId: string): Promise<NotificationRoute[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NotificationRouteRow>(
    'SELECT * FROM notification_routes WHERE source_id = ? ORDER BY priority DESC, id;',
    sourceId,
  );
  return rows.map(toNotificationRoute);
}

export async function createNotificationRoute(input: {
  sourceId: string;
  accountId: string;
  match: NotificationRoute['match'];
  priority?: number;
}): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  await db.runAsync(
    `INSERT INTO notification_routes (id, source_id, account_id, match_json, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
    id,
    input.sourceId,
    input.accountId,
    input.match === null ? null : JSON.stringify(input.match),
    input.priority ?? 100,
    new Date().toISOString(),
  );
  return id;
}

export async function deleteNotificationRoute(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notification_routes WHERE id = ?;', id);
}

/**
 * The package names the native listener is allowed to read, projected out of
 * the database so it can be pushed into SharedPreferences.
 *
 * The database is authoritative; the preferences copy exists only because the
 * listener runs while the app is closed and the SQLCipher connection is not
 * open.
 */
export async function allowedPackageNames(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ package_name: string }>(
    'SELECT package_name FROM notification_sources WHERE enabled = 1;',
  );
  return rows.map((row) => row.package_name);
}
```

- [ ] **Step 5: Create `apps/mobile/src/db/notification-captures-repo.ts`**

```ts
import type { ParsedMovement } from '@finant/importers';
import { getDatabase } from './database';
import {
  toNotificationCapture,
  type CaptureStatus,
  type NotificationCapture,
  type NotificationCaptureRow,
} from './mappers';
import { newId } from './transactions-repo';

export interface NewCapture {
  sourceId: string | null;
  packageName: string;
  postedAt: string;
  bookingDate: string;
  title: string | null;
  body: string | null;
  androidKey: string | null;
  captureHash: string;
  status: CaptureStatus;
  parserId: string | null;
  parsed: ParsedMovement | null;
}

/**
 * Records a capture, or does nothing if this notification was already seen.
 *
 * `INSERT OR IGNORE` against the unique capture hash is the whole dedupe
 * story: Android reposts an updated notification with the same post time and
 * text, and a tombstone from an accepted capture still holds its hash.
 *
 * @returns the new row's id, or null when it was a duplicate.
 */
export async function insertCapture(input: NewCapture): Promise<string | null> {
  const db = await getDatabase();
  const id = newId();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO notification_captures (
       id, source_id, package_name, posted_at, booking_date, title, body,
       android_key, capture_hash, status, parser_id, parsed_json, transaction_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`,
    id,
    input.sourceId,
    input.packageName,
    input.postedAt,
    input.bookingDate,
    input.title,
    input.body,
    input.androidKey,
    input.captureHash,
    input.status,
    input.parserId,
    input.parsed === null ? null : JSON.stringify(input.parsed),
    new Date().toISOString(),
  );
  return result.changes > 0 ? id : null;
}

export async function listCaptures(
  statuses: readonly CaptureStatus[],
): Promise<NotificationCapture[]> {
  if (statuses.length === 0) return [];
  const db = await getDatabase();
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = await db.getAllAsync<NotificationCaptureRow>(
    `SELECT * FROM notification_captures
      WHERE status IN (${placeholders})
      ORDER BY posted_at DESC;`,
    ...statuses,
  );
  return rows.map(toNotificationCapture);
}

export async function getCapture(id: string): Promise<NotificationCapture | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<NotificationCaptureRow>(
    'SELECT * FROM notification_captures WHERE id = ?;',
    id,
  );
  return row ? toNotificationCapture(row) : null;
}

/** Captures still waiting on the owner: the dashboard's review chip. */
export async function countOpenCaptures(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM notification_captures
      WHERE status IN ('pending', 'unreadable');`,
  );
  return row?.count ?? 0;
}

/**
 * Settles a capture and forgets its text in the same statement.
 *
 * The row stays so its hash keeps holding this notification's identity, but
 * the narrative goes: a capture the owner has dealt with has no reason to keep
 * sitting in the database.
 */
export async function setCaptureStatus(
  id: string,
  status: CaptureStatus,
  transactionId: string | null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE notification_captures
        SET status = ?, transaction_id = ?, title = NULL, body = NULL, parsed_json = NULL
      WHERE id = ?;`,
    status,
    transactionId,
    id,
  );
}

/** Repoints a capture at the statement row that superseded its provisional. */
export async function repointCapture(
  provisionalTransactionId: string,
  bookedTransactionId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE notification_captures SET transaction_id = ? WHERE transaction_id = ?;',
    bookedTransactionId,
    provisionalTransactionId,
  );
}

export async function deleteAllCaptures(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notification_captures;');
}
```

- [ ] **Step 6: Add the transaction queries reconciliation needs**

Append to `apps/mobile/src/db/transactions-repo.ts`:

```ts
/**
 * One movement by its dedupe identity. `insertTransactions` reports counts
 * rather than ids, and a capture needs the id of the row it produced.
 */
export async function findTransactionByHash(
  accountId: string,
  importHash: string,
): Promise<Transaction | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TransactionRow>(
    'SELECT * FROM transactions WHERE account_id = ? AND import_hash = ? AND deleted_at IS NULL;',
    accountId,
    importHash,
  );
  return row ? toTransaction(row) : null;
}

/** Live provisional movements, for reconciliation and for the inbox. */
export async function listProvisionalTransactions(): Promise<Transaction[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TransactionRow>(
    `SELECT * FROM transactions
      WHERE provisional = 1 AND deleted_at IS NULL
      ORDER BY booking_date DESC, created_at DESC;`,
  );
  return rows.map(toTransaction);
}

/**
 * Retires each provisional in favour of the statement row that booked it.
 *
 * Soft delete, not hard: the row's identity has to stay in the table so the
 * unique indexes keep holding it, exactly as for a movement the owner deleted.
 * `superseded_by_id` records which row won, so the trail from what the owner
 * saw to what the bank booked survives.
 */
export async function supersedeProvisionals(
  pairs: readonly { provisionalId: string; bookedId: string }[],
): Promise<number> {
  if (pairs.length === 0) return 0;
  const db = await getDatabase();
  const now = new Date().toISOString();
  let changed = 0;
  await db.withTransactionAsync(async () => {
    for (const pair of pairs) {
      const result = await db.runAsync(
        `UPDATE transactions
            SET deleted_at = ?, superseded_by_id = ?
          WHERE id = ? AND provisional = 1 AND deleted_at IS NULL;`,
        now,
        pair.bookedId,
        pair.provisionalId,
      );
      changed += result.changes;
    }
  });
  return changed;
}

/**
 * The latest booked date on record per account, which is how far statements
 * have covered it. A provisional older than that with no match is one the bank
 * never booked. Provisional rows are excluded: they are not coverage.
 */
export async function latestBookedDateByAccount(): Promise<Map<string, string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ account_id: string; latest: string }>(
    `SELECT account_id, MAX(booking_date) AS latest
       FROM transactions
      WHERE deleted_at IS NULL AND provisional = 0
      GROUP BY account_id;`,
  );
  return new Map(rows.map((row) => [row.account_id, row.latest]));
}
```

- [ ] **Step 7: Teach `insertTransactions` about provisional rows**

In `apps/mobile/src/db/transactions-repo.ts`, add to `interface NewTransaction`:

```ts
/** True only for a movement whose sole evidence is a push notification. */
provisional: boolean;
```

In the `INSERT OR IGNORE` statement, add `provisional` to the column list and one more `?` to the values list, then pass `tx.provisional ? 1 : 0` in the matching position (immediately after `tx.excludedFromStats ? 1 : 0` if you append the column at the end of the list, before `created_at`). Read the statement carefully: a misaligned parameter writes the wrong value into the wrong column and the types will not catch it.

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: FAIL, and only in `apps/mobile/src/services/ingest.ts`, which does not yet set `provisional` on the batch it builds. Task 5 fixes that. If anything else fails, fix it now.

- [ ] **Step 9: Commit**

```bash
npx prettier --write apps/mobile/src/db
git add apps/mobile/src/db
git commit -m "feat(db): migration 9 gives a movement a provisional flag and a notification an inbox"
```

---

### Task 5: The ingest path — provisional writes and reconciliation

**Files:**

- Modify: `apps/mobile/src/services/ingest.ts`
- Modify: `apps/mobile/src/services/transfers.ts`
- Create: `apps/mobile/src/services/reconcile.ts`

**Interfaces:**

- Consumes: `matchProvisionals` (Task 1), `supersedeProvisionals`, `listProvisionalTransactions`, `listTransactionsBetween`, `repointCapture` (Task 4).
- Produces: `ingest(drafts, options?)` with `options.provisional`; `IngestResult.superseded`; `reconcileProvisionals(): Promise<number>`.

- [ ] **Step 1: Write `apps/mobile/src/services/reconcile.ts`**

```ts
import { addDays, matchProvisionals, PROVISIONAL_DAY_WINDOW } from '@finant/core';
import { repointCapture } from '../db/notification-captures-repo';
import {
  listProvisionalTransactions,
  listTransactionsBetween,
  supersedeProvisionals,
} from '../db/transactions-repo';

/**
 * Retires provisional movements the statements have now booked.
 *
 * Runs after every import, over the whole set of live provisionals rather than
 * only the rows just inserted: the statement that books a notification from
 * three weeks ago arrives in one import, and the provisional it supersedes was
 * written in another.
 *
 * The unique indexes cannot do this job. A notification's import hash is built
 * over its own narrative and the statement's over the bank's, so the two rows
 * genuinely differ and no constraint sees a duplicate. That is why this is
 * explicit, tested code — `matchProvisionals` in `@finant/core` — and why an
 * ambiguous pairing is left alone instead of being guessed at.
 *
 * @returns how many provisionals were superseded on this run.
 */
export async function reconcileProvisionals(): Promise<number> {
  const provisionals = await listProvisionalTransactions();
  if (provisionals.length === 0) return 0;

  // Only the window around the provisionals can contain a match, so read that
  // rather than the whole ledger.
  const dates = provisionals.map((row) => row.bookingDate).sort();
  const from = addDays(dates[0] as string, -PROVISIONAL_DAY_WINDOW);
  const to = addDays(dates[dates.length - 1] as string, PROVISIONAL_DAY_WINDOW);
  const candidates = await listTransactionsBetween(from, to);

  const { matches } = matchProvisionals(provisionals, candidates);
  if (matches.length === 0) return 0;

  // supersedeProvisionals also repoints the capture, in the same transaction:
  // the two rows describe one fact — that this statement row booked what the
  // notification announced — and a partial commit would leave a capture
  // pointing at a movement that no longer exists, with nothing to retry it.
  return supersedeProvisionals(matches);
}
```

- [ ] **Step 2: Keep provisional rows out of transfer detection**

In `apps/mobile/src/services/transfers.ts`, change the body of `detectTransfers`:

```ts
export async function detectTransfers(): Promise<number> {
  const ledger = await listAllTransactions();
  // A provisional movement is one half of nothing: pairing it would link the
  // notification to the very statement row that is about to supersede it, and
  // both would end up categorised as an internal transfer and dropped from
  // every total.
  const pairs = matchTransfers(ledger.filter((row) => !row.provisional));
  await linkTransferPairs(pairs);
  return pairs.length;
}
```

- [ ] **Step 3: Wire provisional writes and reconciliation into `ingest`**

In `apps/mobile/src/services/ingest.ts`:

Add to the imports:

```ts
import { reconcileProvisionals } from './reconcile';
```

Add to `IngestResult`:

```ts
  /** Provisional movements a statement row in this import replaced. */
  readonly superseded: number;
```

Change the signature and add the option:

```ts
export interface IngestOptions {
  /**
   * Marks every row in this batch as provisional: its only evidence is a push
   * notification. Statement imports and manual entries never set it.
   */
  readonly provisional?: boolean;
}

export async function ingest(
  drafts: readonly DraftTransaction[],
  options: IngestOptions = {},
): Promise<IngestResult> {
```

Add `provisional: options.provisional ?? false,` to the object returned inside the `drafts.map` callback.

Replace the tail of the function:

```ts
  const { inserted, duplicates, excluded: autoExcluded } = await insertTransactions(batch);

  // Reconciliation runs before transfer detection: a provisional and the
  // statement row that books it must not be paired with each other, and the
  // provisional has to be retired before the matcher sees the ledger.
  // A statement's rows are durably inserted by this point, and reconciliation
  // is atomic per pair — so a failure here leaves the provisionals live and the
  // next import retries them. Failing the whole import over it would tell the
  // owner nothing was saved when almost everything was, and this codebase does
  // not throw away an import over one bad row.
  let superseded = 0;
  if (inserted > 0 && !options.provisional) {
    try {
      superseded = await reconcileProvisionals();
    } catch {
      superseded = 0;
    }
  }

  // Only a new row can complete a pair; a file full of duplicates changes nothing.
  const transfersMatched = inserted > 0 ? await detectTransfers() : 0;
  return {
    inserted,
    duplicates,
    autoCategorised,
    uncategorised,
    transfersMatched,
    autoExcluded,
    superseded,
  };
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS for packages. `apps/mobile` may still fail wherever `IngestResult` is destructured on the import screen — if the import screen does not read `superseded`, nothing breaks. Fix any error that appears.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/src/services
git add apps/mobile/src/services
git commit -m "feat(ingest): a statement import retires the notifications it has now booked"
```

---

### Task 6: The native module — the allowlist gate

**Files:**

- Create: `apps/mobile/modules/notification-capture/expo-module.config.json`
- Create: `apps/mobile/modules/notification-capture/index.ts`
- Create: `apps/mobile/modules/notification-capture/android/build.gradle`
- Create: `apps/mobile/modules/notification-capture/android/src/main/AndroidManifest.xml`
- Create: `apps/mobile/modules/notification-capture/android/src/main/java/expo/modules/notificationcapture/CaptureAllowlist.kt`
- Create: `apps/mobile/modules/notification-capture/android/src/main/java/expo/modules/notificationcapture/FinAntNotificationListenerService.kt`
- Create: `apps/mobile/modules/notification-capture/android/src/main/java/expo/modules/notificationcapture/NotificationCaptureModule.kt`
- Create: `apps/mobile/modules/notification-capture/ios/NotificationCaptureModule.swift`
- Create: `apps/mobile/modules/notification-capture/ios/NotificationCapture.podspec`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: the default export of `apps/mobile/modules/notification-capture/index.ts` with `isSupported()`, `isPermissionGranted()`, `openPermissionSettings()`, `setAllowedPackages(packages)`, `startLearning(seconds)`, `consumeLearnedPackages()`; the headless task key `FinAntNotificationCapture`.

- [ ] **Step 1: Scaffold the module**

```bash
cd apps/mobile
npx create-expo-module@latest --local
```

Answer the prompts with name `notification-capture`, and accept the defaults for the rest. This creates `apps/mobile/modules/notification-capture/` with `android/`, `ios/`, `src/`, `expo-module.config.json` and `index.ts`, autolinked from the project's modules directory.

Delete the scaffolded view component, the example `src/` files and the `*View*` sources — this module has no UI. Keep `expo-module.config.json`, `index.ts`, `android/build.gradle`, and the podspec.

- [ ] **Step 2: Write `expo-module.config.json`**

```json
{
  "platforms": ["android", "apple"],
  "android": {
    "modules": ["expo.modules.notificationcapture.NotificationCaptureModule"]
  },
  "apple": {
    "modules": ["NotificationCaptureModule"]
  }
}
```

- [ ] **Step 3: Declare the service in the module's own manifest**

Create `android/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <!--
    WAKE_LOCK is needed by acquireBoundedWakeLock() in the listener service:
    the device must not suspend between a notification arriving and the headless
    task finishing its database write. It is a normal permission, so declaring
    it is all there is to do — there is no prompt and nothing to request.
  -->
  <uses-permission android:name="android.permission.WAKE_LOCK" />

  <!--
    The listener lives in this module's manifest, which the Android manifest
    merger folds into the app. No Expo config plugin is involved, so there is
    nothing to re-apply after a prebuild.

    android:exported must be true and the permission must be
    BIND_NOTIFICATION_LISTENER_SERVICE: that permission is held by the system,
    which is what stops any other app from binding this service. The system
    binds and rebinds it on its own once the owner grants notification access,
    so the app does not need to start it and needs no BOOT_COMPLETED receiver.
  -->
  <application>
    <service
      android:name="expo.modules.notificationcapture.FinAntNotificationListenerService"
      android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE"
      android:exported="true">
      <intent-filter>
        <action android:name="android.service.notification.NotificationListenerService" />
      </intent-filter>
    </service>
  </application>
</manifest>
```

- [ ] **Step 4: Write the allowlist store**

Create `android/src/main/java/expo/modules/notificationcapture/CaptureAllowlist.kt`:

```kotlin
package expo.modules.notificationcapture

import android.content.Context

/**
 * The package names FinAnt is allowed to read, and the time-boxed learning flag.
 *
 * Plain SharedPreferences on purpose. The listener service runs while the app
 * is closed and the SQLCipher connection is not open, so the allowlist has to
 * be readable without the database. What is stored here is package names of
 * the owner's own bank apps: no amount, no narrative, no account, no IBAN, and
 * nothing that is not already obvious from the notifications themselves.
 *
 * The database is authoritative. This is a projection of it, rewritten by
 * setAllowedPackages whenever the owner changes a source.
 */
internal object CaptureAllowlist {
    private const val PREFS = "finant.capture"
    private const val KEY_PACKAGES = "packages"
    private const val KEY_LEARNING_UNTIL = "learning_until"
    private const val KEY_LEARNED = "learned"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun allowed(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet()

    fun setAllowed(context: Context, packages: List<String>) {
        prefs(context).edit().putStringSet(KEY_PACKAGES, packages.toSet()).apply()
    }

    fun startLearning(context: Context, seconds: Int) {
        prefs(context).edit()
            .putLong(KEY_LEARNING_UNTIL, System.currentTimeMillis() + seconds * 1000L)
            .putStringSet(KEY_LEARNED, emptySet())
            .apply()
    }

    fun isLearning(context: Context): Boolean =
        prefs(context).getLong(KEY_LEARNING_UNTIL, 0L) > System.currentTimeMillis()

    /**
     * Records a package name and nothing else — never a title, a text or a post
     * time. This is how the owner identifies their bank apps without the app
     * holding QUERY_ALL_PACKAGES and without anyone guessing a package id.
     */
    fun learn(context: Context, packageName: String) {
        val store = prefs(context)
        val seen = store.getStringSet(KEY_LEARNED, emptySet()) ?: emptySet()
        if (packageName in seen) return
        store.edit().putStringSet(KEY_LEARNED, seen + packageName).apply()
    }

    fun consumeLearned(context: Context): List<String> {
        val store = prefs(context)
        val seen = (store.getStringSet(KEY_LEARNED, emptySet()) ?: emptySet()).sorted()
        store.edit().putStringSet(KEY_LEARNED, emptySet()).putLong(KEY_LEARNING_UNTIL, 0L).apply()
        return seen
    }
}
```

- [ ] **Step 5: Write the listener service**

Create `android/src/main/java/expo/modules/notificationcapture/FinAntNotificationListenerService.kt`:

```kotlin
package expo.modules.notificationcapture

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.LinearCountingRetryPolicy

/**
 * Reads the notifications the owner's own bank apps post, and nothing else.
 *
 * Notification access is a broad grant: the system offers this service every
 * notification on the device. The allowlist check in onNotificationPosted is
 * therefore the security boundary of this entire feature, and it is kept short
 * enough to verify by reading. Nothing outside the allowlist is read, copied,
 * stored or logged — and no notification text is ever logged at all.
 */
class FinAntNotificationListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val packageName = sbn?.packageName ?: return

        // Learning mode: the package name, and only the package name.
        if (CaptureAllowlist.isLearning(this)) {
            CaptureAllowlist.learn(this, packageName)
        }

        // ── THE SECURITY BOUNDARY ────────────────────────────────────────────
        // A message from a person, a 2FA code, a health reminder: all of them
        // return here, before sbn.notification is ever dereferenced.
        if (packageName !in CaptureAllowlist.allowed(this)) return
        // ─────────────────────────────────────────────────────────────────────

        val extras: Bundle = sbn.notification?.extras ?: return
        val data = Arguments.createMap().apply {
            putString("packageName", packageName)
            putString("title", extras.getCharSequence(Notification.EXTRA_TITLE)?.toString())
            putString(
                "body",
                (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                    ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
            )
            putDouble("postedAtMillis", sbn.postTime.toDouble())
            putString("androidKey", sbn.key)
        }

        startCaptureTask(data)
    }

    /**
     * Hands the notification to JavaScript.
     *
     * This replicates the body of RN's own HeadlessJsTaskService.startTask
     * because this class cannot extend it — it already extends
     * NotificationListenerService — and must not call startForegroundService
     * either: Android 8+ restricts starting a service from the background, and
     * a foreground-service notification for every card payment is absurd.
     *
     * Doing it in place is sound because the process is already alive: the
     * system bound this listener.
     */
    private fun startCaptureTask(data: WritableMap) {
        // Our own lock, with a timeout, rather than
        // HeadlessJsTaskService.acquireWakeLockNow: that one is untimed and is
        // released only by HeadlessJsTaskService.onDestroy, which this app
        // never runs — this class extends NotificationListenerService, so the
        // lock would pin the CPU awake for the life of a process the system
        // keeps alive indefinitely. Acquired with the task's own timeout, it
        // releases itself even if the JS hop never finishes.
        (getSystemService(Context.POWER_SERVICE) as? PowerManager)
            ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FinAnt:notification-capture")
            ?.acquire(TASK_TIMEOUT_MS)

        val reactHost = (application as? ReactApplication)?.reactHost ?: return
        val config = HeadlessJsTaskConfig(
            TASK_KEY,
            data,
            TASK_TIMEOUT_MS,
            // The app may well be open when a payment notification lands, and
            // RN throws rather than running a foreground-disallowed task.
            true,
            LinearCountingRetryPolicy(RETRY_ATTEMPTS, RETRY_DELAY_MS),
        )

        UiThreadUtil.runOnUiThread {
            val current = reactHost.currentReactContext
            if (current != null) {
                HeadlessJsTaskContext.getInstance(current).startTask(config)
                return@runOnUiThread
            }
            reactHost.addReactInstanceEventListener(
                object : ReactInstanceEventListener {
                    override fun onReactContextInitialized(context: ReactContext) {
                        HeadlessJsTaskContext.getInstance(context).startTask(config)
                        reactHost.removeReactInstanceEventListener(this)
                    }
                },
            )
            reactHost.start()
        }
    }

    companion object {
        /** Must match the AppRegistry.registerHeadlessTask key in JavaScript. */
        const val TASK_KEY = "FinAntNotificationCapture"
        private const val TASK_TIMEOUT_MS = 15_000L
        private const val RETRY_ATTEMPTS = 3
        private const val RETRY_DELAY_MS = 1_000
    }
}
```

- [ ] **Step 6: Write the module**

Create `android/src/main/java/expo/modules/notificationcapture/NotificationCaptureModule.kt`:

```kotlin
package expo.modules.notificationcapture

import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationCaptureModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NotificationCapture")

        Function("isSupported") { true }

        Function("isPermissionGranted") {
            val context = appContext.reactContext ?: return@Function false
            context.packageName in NotificationManagerCompat.getEnabledListenerPackages(context)
        }

        Function("openPermissionSettings") {
            val context = appContext.reactContext ?: return@Function
            // There is no runtime permission dialog for notification access:
            // the owner has to switch it on in system settings themselves.
            context.startActivity(
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }

        Function("setAllowedPackages") { packages: List<String> ->
            val context = appContext.reactContext ?: return@Function
            CaptureAllowlist.setAllowed(context, packages)
        }

        Function("startLearning") { seconds: Int ->
            val context = appContext.reactContext ?: return@Function
            CaptureAllowlist.startLearning(context, seconds)
        }

        Function("consumeLearnedPackages") {
            val context = appContext.reactContext ?: return@Function emptyList<String>()
            CaptureAllowlist.consumeLearned(context)
        }
    }
}
```

- [ ] **Step 7: Write the iOS stub**

Replace `ios/NotificationCaptureModule.swift`:

```swift
import ExpoModulesCore

/// iOS has no API for reading other apps' notifications, and never has had.
/// The module exists with the same surface so screens branch on
/// `isSupported()` rather than scattering Platform.OS checks.
internal class UnsupportedException: Exception {
  override var reason: String {
    "Notification capture is Android-only: iOS exposes no API for reading notifications."
  }
}

public class NotificationCaptureModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NotificationCapture")

    Function("isSupported") { false }
    Function("isPermissionGranted") { false }
    Function("openPermissionSettings") { throw UnsupportedException() }
    Function("setAllowedPackages") { (_: [String]) in throw UnsupportedException() }
    Function("startLearning") { (_: Int) in throw UnsupportedException() }
    Function("consumeLearnedPackages") { [String]() }
  }
}
```

- [ ] **Step 8: Write the JS surface**

Replace `apps/mobile/modules/notification-capture/index.ts`:

```ts
import { requireNativeModule } from 'expo-modules-core';

export interface NotificationCaptureModule {
  /** False on iOS, which has no API for reading other apps' notifications. */
  isSupported(): boolean;
  /** Whether the owner has granted notification access in system settings. */
  isPermissionGranted(): boolean;
  /** Opens the system screen where notification access is granted. */
  openPermissionSettings(): void;
  /**
   * Replaces the package names the native listener may read. Everything else
   * returns from `onNotificationPosted` before its text is touched.
   */
  setAllowedPackages(packages: string[]): void;
  /** Records package names only, for this many seconds, so the owner can
   * identify their bank apps without the app enumerating installed packages. */
  startLearning(seconds: number): void;
  /** Reads and clears what learning mode collected. */
  consumeLearnedPackages(): string[];
}

/** Must match `FinAntNotificationListenerService.TASK_KEY`. */
export const CAPTURE_TASK_KEY = 'FinAntNotificationCapture';

export default requireNativeModule<NotificationCaptureModule>('NotificationCapture');
```

- [ ] **Step 8b: Declare React Native in the module's `android/build.gradle`**

`expo-module-gradle-plugin` contributes only `kotlin-stdlib-jdk7`, `org.jetbrains:annotations` and `expo-modules-core` (as `compileOnly`) — see `ProjectConfiguration.kt:53-65` in `node_modules/expo-modules-core/expo-module-gradle-plugin`. And expo-modules-core declares `com.facebook.react:react-android` as `implementation`, not `api` (`node_modules/expo-modules-core/android/build.gradle:223`), so React Native's classes are **not** exposed transitively. Without this block the service cannot resolve a single `com.facebook.react.*` import:

```gradle
dependencies {
  // No version: the React Native Gradle plugin resolves it for the app build,
  // which is how expo-modules-core declares it too.
  implementation 'com.facebook.react:react-android'
}
```

`androidx.core` needs no declaration — expo-modules-core exposes `androidx.core:core-ktx` as `api`, so `NotificationManagerCompat` resolves.

- [ ] **Step 9: Build it**

```bash
cd apps/mobile
npx expo prebuild --platform android --clean
npm run android
```

Expected: the app builds and launches. A Gradle failure naming `HeadlessJsTaskContext`, `ReactHost` or `LinearCountingRetryPolicy` means the module cannot see React Native's classes — check that `android/build.gradle` from the scaffold has the standard Expo module dependencies block, which pulls in `com.facebook.react:react-android` through the app.

- [ ] **Step 10: Verify the module answers**

Add a temporary check to any screen, or use the dev console:

```ts
import NotificationCapture from '../../modules/notification-capture';
console.log(NotificationCapture.isSupported(), NotificationCapture.isPermissionGranted());
```

Expected: `true false`. Then call `openPermissionSettings()` and confirm the Android notification-access screen appears. Remove the temporary check afterwards.

- [ ] **Step 11: Commit**

```bash
npx prettier --write apps/mobile/modules/notification-capture/index.ts
git add apps/mobile/modules apps/mobile/package.json
git commit -m "feat(android): a listener that reads four package names and returns on everything else"
```

---

### Task 7: The headless task — from notification to capture row

**Files:**

- Create: `apps/mobile/index.js`
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/src/notifications/headless-task.ts`
- Create: `apps/mobile/src/notifications/capture-service.ts`

**Interfaces:**

- Consumes: `CAPTURE_TASK_KEY` (Task 6); `parseNotification`, `captureHashOf`, `localCalendarDay` (Task 2); `insertCapture` (Task 4); `acceptCapture` (defined here).
- Produces: `recordCapture(raw)`, `acceptCapture(captureId)`, `dismissCapture(captureId)`, `syncAllowedPackages()`, `RawCapture`.

- [ ] **Step 1: Write the capture service**

Create `apps/mobile/src/notifications/capture-service.ts`:

```ts
import {
  captureHashOf,
  localCalendarDay,
  parseNotification,
  type ParsedMovement,
} from '@finant/importers';
import { importHashOf, resolveRoute, type DraftTransaction } from '@finant/core';
import NotificationCapture from '../../modules/notification-capture';
import { getCapture, insertCapture, setCaptureStatus } from '../db/notification-captures-repo';
import {
  allowedPackageNames,
  getNotificationSourceByPackage,
  listNotificationRoutes,
} from '../db/notification-sources-repo';
import { findTransactionByHash } from '../db/transactions-repo';
import { ingest } from '../services/ingest';

/** One notification, exactly as the native listener passes it. */
export interface RawCapture {
  readonly packageName: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly postedAtMillis: number;
  readonly androidKey: string | null;
}

/**
 * Writes a captured notification into the encrypted database.
 *
 * This is the whole background path: nothing is stored anywhere else on the
 * way, which is what keeps the security model's promise that a narrative rests
 * only inside SQLCipher. The cost is that a notification lost here — the
 * process killed mid-write — is lost silently. Nothing ends up wrong, because
 * the statement import still books the movement; it just does not appear early.
 *
 * Never logs any part of the notification.
 */
export async function recordCapture(raw: RawCapture): Promise<void> {
  const source = await getNotificationSourceByPackage(raw.packageName);
  // The native allowlist is a projection of the database, so a source the
  // owner disabled between the two can still reach here. The database decides.
  if (!source || !source.enabled) return;

  const postedAt = new Date(raw.postedAtMillis);
  const bookingDate = localCalendarDay(raw.postedAtMillis, postedAt.getTimezoneOffset());
  const captureHash = captureHashOf({
    packageName: raw.packageName,
    // An `ignored` notification is recognised as deliberately not money, so its
    // row exists only as a tombstone holding the hash. Keeping its text would
    // mean storing a bank's marketing indefinitely, and this table's contract
    // is that a settled capture forgets its narrative. `pending` keeps the text
    // because the owner is about to read it; `unreadable` keeps it because that
    // text is the bug report.
    title: parsed.kind === 'ignored' ? null : raw.title,
    body: parsed.kind === 'ignored' ? null : raw.body,
    postedAtMillis: raw.postedAtMillis,
  });

  const parsed = parseNotification({
    packageName: raw.packageName,
    title: raw.title,
    body: raw.body,
    bookingDate,
    postedAtMillis: raw.postedAtMillis,
  });

  const captureId = await insertCapture({
    sourceId: source.id,
    packageName: raw.packageName,
    postedAt: postedAt.toISOString(),
    bookingDate,
    title: raw.title,
    body: raw.body,
    androidKey: raw.androidKey,
    captureHash,
    status:
      parsed.kind === 'movement'
        ? 'pending'
        : parsed.kind === 'ignored'
          ? 'dismissed'
          : 'unreadable',
    parserId: parsed.kind === 'unreadable' ? null : parsed.parserId,
    parsed: parsed.kind === 'movement' ? parsed.movement : null,
  });

  // Already seen: Android reposts an updated notification, and an accepted
  // capture leaves a tombstone holding its hash.
  if (captureId === null) return;

  if (parsed.kind === 'movement' && source.autoApprove) {
    await acceptCapture(captureId);
  }
}

/**
 * Turns a pending capture into a provisional movement.
 *
 * The provisional flag stays set afterwards: the owner agreeing with what the
 * notification said is not the bank having booked it. Only a statement row can
 * settle that, through `reconcileProvisionals`.
 *
 * @returns the movement's id, or null when the capture could not be routed to
 *   an account — which leaves it pending, for the owner to fix the routes.
 */
export async function acceptCapture(captureId: string): Promise<string | null> {
  const capture = await getCapture(captureId);
  if (!capture || capture.parsed === null || capture.sourceId === null) return null;

  const routes = await listNotificationRoutes(capture.sourceId);
  const text = [capture.title, capture.body].filter(Boolean).join(' ');
  const route = resolveRoute({ text, amountMinor: capture.parsed.amountMinor }, routes);
  if (!route) return null;

  const draft = draftFrom(
    capture.parsed,
    route.accountId,
    capture.bookingDate,
    capture.captureHash,
  );
  await ingest([draft], { provisional: true });

  const written = await findTransactionByHash(route.accountId, draft.importHash);
  await setCaptureStatus(captureId, 'accepted', written?.id ?? null);
  return written?.id ?? null;
}

export async function dismissCapture(captureId: string): Promise<void> {
  await setCaptureStatus(captureId, 'dismissed', null);
}

function draftFrom(
  movement: ParsedMovement,
  accountId: string,
  bookingDate: string,
  captureHash: string,
): DraftTransaction {
  return {
    accountId,
    bookingDate,
    valueDate: null,
    amount: { minor: movement.amountMinor, currency: movement.currency },
    side: movement.side,
    description: movement.description,
    counterparty: movement.counterparty,
    reference: null,
    suggestedCategoryId: null,
    source: 'notification',
    // Push text carries no bank transaction id, ever.
    externalId: null,
    importHash: importHashOf({
      accountId,
      bookingDate,
      amountMinor: movement.amountMinor,
      description: movement.description,
      // Stable per notification, so two identical coffees an hour apart stay
      // two movements rather than collapsing into one.
      discriminator: captureHash,
    }),
    notes: null,
  };
}

/**
 * Pushes the database's allowlist into the native preferences the listener
 * reads while the app is closed. Call after any change to a source.
 */
export async function syncAllowedPackages(): Promise<void> {
  if (!NotificationCapture.isSupported()) return;
  NotificationCapture.setAllowedPackages(await allowedPackageNames());
}
```

Note: `amount` is built as an object literal rather than via `money()` to avoid importing a second helper here; if `money()` performs validation, prefer `money(movement.amountMinor, movement.currency)` and import it from `@finant/core`. Check `packages/core/src/money.ts` and use whichever is consistent — do not leave both.

- [ ] **Step 2: Register the headless task**

Create `apps/mobile/src/notifications/headless-task.ts`:

```ts
import { AppRegistry } from 'react-native';
import { CAPTURE_TASK_KEY } from '../../modules/notification-capture';
import { recordCapture, type RawCapture } from './capture-service';

/**
 * The entry point Android's notification listener wakes.
 *
 * Registered from `apps/mobile/index.js` rather than from a screen: expo-router
 * requires the `app/` tree lazily, so a registration inside a layout never
 * evaluates on a headless launch and Android's task start would find no task.
 *
 * Errors are swallowed deliberately. A crash here would take down a JS runtime
 * the owner cannot see, and the notification is not worth that: the statement
 * import remains the source of truth. Nothing is logged, because the only
 * thing there is to log is the notification's own text.
 */
AppRegistry.registerHeadlessTask(CAPTURE_TASK_KEY, () => async (data: RawCapture) => {
  try {
    await recordCapture(data);
  } catch {
    // Intentionally silent. See above.
  }
});
```

- [ ] **Step 3: Repoint the app entry**

Create `apps/mobile/index.js`:

```js
// expo-router's own entry, plus the headless task registration it cannot host.
// A task registered inside app/_layout.tsx never evaluates on a headless
// launch, because expo-router requires the app/ tree lazily.
import 'expo-router/entry';
import './src/notifications/headless-task';
```

In `apps/mobile/package.json`, change:

```json
  "main": "index.js",
```

- [ ] **Step 4: Confirm the app still starts normally**

Run: `cd apps/mobile && npm run android`
Expected: the app launches and routing works exactly as before. If the screen is blank, the entry file is wrong — `expo-router/entry` must be imported first.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/mobile/src/notifications apps/mobile/index.js apps/mobile/package.json
git add apps/mobile/src/notifications apps/mobile/index.js apps/mobile/package.json
git commit -m "feat(android): a notification wakes a headless task that writes straight into SQLCipher"
```

---

### Task 8: Translations

**Files:**

- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/de.ts`
- Modify: `packages/i18n/src/es.ts`

**Interfaces:**

- Produces: the `notifications.*` key group, typed against `Resources`, so a screen referencing a missing key fails to compile.

- [ ] **Step 1: Read the existing shape**

Run: `sed -n '1,60p' packages/i18n/src/en.ts`

Match the existing nesting and naming conventions exactly. `en.ts` is the shape `Resources` is derived from, so add keys there first.

- [ ] **Step 2: Add the group to `en.ts`**

Add a `notifications` group alongside the existing top-level groups:

```ts
  notifications: {
    title: 'Bank notifications',
    settingsRow: 'Bank notifications',
    androidOnly: 'Android only. iOS has no way for an app to read notifications.',
    explainer:
      'FinAnt can read the notifications your bank apps post on this phone and turn them into movements. Nothing is sent anywhere. A movement created this way is marked unconfirmed until the bank statement you import next confirms it.',
    permissionGranted: 'Notification access granted',
    permissionMissing: 'Notification access not granted',
    grant: 'Open Android settings',
    revokedHint: 'Some phones drop this permission when the app updates. Check here if movements stop arriving.',
    learn: 'Find my bank apps',
    learning: 'Listening for {{seconds}}s. Trigger a payment or open your bank app.',
    learnExplainer:
      'FinAnt records only the name of the app that notified you, never the text, so you can pick your banks from a list.',
    learnEmpty: 'No apps notified you during that time.',
    sources: 'Bank apps',
    addSource: 'Add bank app',
    sourceName: 'Name this bank',
    autoApprove: 'Add movements without asking',
    autoApproveHint:
      'Off: a notification waits in the inbox for you. On: it becomes an unconfirmed movement straight away.',
    routes: 'Accounts',
    addRoute: 'Add account rule',
    routeFallback: 'Anything else',
    routeMatch: 'When the notification mentions',
    deleteCaptures: 'Delete all captured notifications',
    inbox: 'Notification inbox',
    reviewChip: '{{count}} to review',
    pending: 'Waiting for you',
    unreadable: "Couldn't read this one",
    unreadableExplainer:
      'The wording changed, or FinAnt has no template for this notification yet. Copy the text if you want it supported.',
    copyText: 'Copy text',
    accept: 'Add movement',
    edit: 'Edit first',
    dismiss: 'Dismiss',
    noRoute: 'No account rule matches this notification. Add one to accept it.',
    viaFallback: 'Routed by the fallback rule. Check the account is right.',
    empty: 'Nothing waiting.',
    provisional: 'Unconfirmed',
    provisionalExplainer:
      'Seen in a notification from your bank, not yet confirmed by a statement.',
    provisionalStale:
      'No statement has confirmed this after {{days}} days, though later movements on this account have been imported. The payment may have been declined.',
    balanceIncluding: 'including {{count}} unconfirmed',
  },
```

- [ ] **Step 3: Add the same group to `de.ts` and `es.ts`**

Translate every key. Keep the placeholders (`{{seconds}}`, `{{count}}`, `{{days}}`) exactly as they are. Match the tone of the surrounding translations in each file — this app addresses the owner directly.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. A missing key in `de.ts` or `es.ts` is a compile error here, which is the point.

- [ ] **Step 5: Commit**

```bash
npx prettier --write packages/i18n/src
git add packages/i18n
git commit -m "feat(i18n): three languages for the notification inbox"
```

---

### Task 9: The bank notifications settings screen

**Files:**

- Create: `apps/mobile/app/notification-capture.tsx`
- Modify: `apps/mobile/app/(tabs)/settings.tsx`
- Create: `apps/mobile/src/hooks/use-notification-sources.ts`

**Interfaces:**

- Consumes: the native module (Task 6), the source and route repositories (Task 4), `syncAllowedPackages` (Task 7), the `notifications.*` keys (Task 8).
- Produces: a route at `/notification-capture`, reachable from Settings on Android only.

- [ ] **Step 1: Read two screens to copy the house style**

Run: `sed -n '1,80p' 'apps/mobile/app/(tabs)/settings.tsx'` and `sed -n '1,80p' apps/mobile/app/categories.tsx`

Reuse the existing `Card`, `ListRow`, `Touchable`, `FormSheet`, `AccountPicker` and `Empty` components and the `design` tokens (`radius`, `spacing`, `type`, `useTheme`). Do not introduce a new styling approach.

- [ ] **Step 2: Write the hook**

Create `apps/mobile/src/hooks/use-notification-sources.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import type { NotificationRoute } from '@finant/core';
import NotificationCapture from '../../modules/notification-capture';
import { listNotificationRoutes, listNotificationSources } from '../db/notification-sources-repo';
import type { NotificationSource } from '../db/mappers';

export interface SourceWithRoutes {
  readonly source: NotificationSource;
  readonly routes: readonly NotificationRoute[];
}

export function useNotificationSources() {
  const [sources, setSources] = useState<SourceWithRoutes[]>([]);
  const [granted, setGranted] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await listNotificationSources();
    const withRoutes = await Promise.all(
      rows.map(async (source) => ({ source, routes: await listNotificationRoutes(source.id) })),
    );
    setSources(withRoutes);
    setGranted(NotificationCapture.isSupported() && NotificationCapture.isPermissionGranted());
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { sources, granted, loading, reload };
}
```

- [ ] **Step 3: Write the screen**

Create `apps/mobile/app/notification-capture.tsx`. It renders, top to bottom:

1. The explainer text (`t('notifications.explainer')`).
2. A permission card: `granted` state, the `Open Android settings` button calling `NotificationCapture.openPermissionSettings()`, and `revokedHint` beneath. Re-check the grant on screen focus with `useFocusEffect`, because the owner grants it in another app and comes back.
3. A learning card: `Find my bank apps` calls `NotificationCapture.startLearning(300)` and starts a countdown; when it ends, or on a `Done` tap, `NotificationCapture.consumeLearnedPackages()` returns the package names. Render them as a list; tapping one opens a `FormSheet` asking for the bank's name (`sourceName`) — required, nothing is auto-created — then `createNotificationSource`, then `syncAllowedPackages`.
4. One card per source: its label, its `autoApprove` switch (`updateNotificationSource(id, { autoApprove })`), its routes, an `Add account rule` action opening a sheet with an `AccountPicker` and a text field for the discriminator (empty means the fallback route, stored as `match: null`; a non-empty value becomes `{ kind: 'word', field: 'any', value }`), and a delete action that calls `deleteNotificationSource` then `syncAllowedPackages`.
5. `Delete all captured notifications`, calling `deleteAllCaptures()` behind a confirmation.

Every write is followed by `reload()`. Every write that changes which packages are allowed is followed by `syncAllowedPackages()` — otherwise the native listener keeps reading a package the owner just removed.

Guard the whole screen: when `NotificationCapture.isSupported()` is false, render only `t('notifications.androidOnly')`.

- [ ] **Step 4: Link it from Settings**

In `apps/mobile/app/(tabs)/settings.tsx`, add a `ListRow` navigating to `/notification-capture`, labelled `t('notifications.settingsRow')`, rendered only when `NotificationCapture.isSupported()`.

- [ ] **Step 5: Verify on the device**

Run: `cd apps/mobile && npm run android`

Walk it: grant access, run learning mode, trigger a notification from any app, confirm its package appears in the learned list, name it, add a fallback route pointing at an account, and confirm the source card renders. Then check `sqlite3` is not needed — the screen itself is the evidence.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
npx prettier --write apps/mobile/app/notification-capture.tsx 'apps/mobile/app/(tabs)/settings.tsx' apps/mobile/src/hooks/use-notification-sources.ts
git add apps/mobile/app apps/mobile/src/hooks
git commit -m "feat(settings): the owner names their bank apps and says which account each notifies about"
```

---

### Task 10: The inbox, and marking provisional movements

**Files:**

- Create: `apps/mobile/app/notification-inbox.tsx`
- Create: `apps/mobile/src/hooks/use-capture-inbox.ts`
- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Modify: `apps/mobile/app/(tabs)/transactions.tsx`
- Modify: `apps/mobile/app/movement/[id].tsx`
- Modify: `apps/mobile/app/(tabs)/banks.tsx`

**Interfaces:**

- Consumes: `listCaptures`, `countOpenCaptures` (Task 4); `acceptCapture`, `dismissCapture` (Task 7); `staleProvisionals` (Task 1); the `notifications.*` keys (Task 8).
- Produces: a route at `/notification-inbox`.

- [ ] **Step 1: Write the inbox hook**

Create `apps/mobile/src/hooks/use-capture-inbox.ts`:

```ts
import { useCallback, useEffect, useState } from 'react';
import { staleProvisionals } from '@finant/core';
import { listCaptures } from '../db/notification-captures-repo';
import { latestBookedDateByAccount, listProvisionalTransactions } from '../db/transactions-repo';
import type { NotificationCapture } from '../db/mappers';
import type { Transaction } from '@finant/core';

export function useCaptureInbox() {
  const [captures, setCaptures] = useState<NotificationCapture[]>([]);
  const [provisionals, setProvisionals] = useState<Transaction[]>([]);
  const [stale, setStale] = useState<ReadonlySet<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    // try/catch/finally, not a bare await: the empty state is gated on
    // `!loading`, so a rejected read that never clears the flag leaves the
    // inbox showing no data, no empty state and no error — blank until the
    // app restarts. `error` is what lets the screen say something instead.
    setError(null);
    try {
      const [rows, pending, coverage] = await Promise.all([
        listCaptures(['pending', 'unreadable']),
        listProvisionalTransactions(),
        latestBookedDateByAccount(),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      setCaptures(rows);
      setProvisionals(pending);
      setStale(new Set(staleProvisionals(pending, coverage, today)));
    } catch (cause) {
      setError(cause as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { captures, provisionals, stale, loading, reload };
}
```

Staleness is derived, not stored: it is a function of the ledger's own coverage, and a column would need a job to keep it true.

- [ ] **Step 2: Write the inbox screen**

Create `apps/mobile/app/notification-inbox.tsx`, in three sections:

1. **Pending captures** (`status === 'pending'`): amount via the existing `Amount` component, the parsed description, the account the routes resolve to, and `Add movement` / `Edit first` / `Dismiss`. `Add movement` calls `acceptCapture(id)`; a `null` return means no route matched, so show `t('notifications.noRoute')` and leave it pending. `Edit first` navigates to `/movement/new` prefilled from the parsed movement **and carrying the capture's id**. Saving there must call `acceptEditedCapture(captureId, draft)` in `capture-service.ts`, not the ordinary `ingest([draft])`: the row is still provisional — editing what a notification said is not the bank booking it — and the capture must be settled against the row that was written. Saving it as an ordinary manual entry would produce a booked-looking row that reconciliation never retires, leaving a permanent duplicate once the statement arrives, and would leave the capture pending so the owner could accept it a second time.
2. **Unreadable captures** (`status === 'unreadable'`): the raw `title` and `body`, `t('notifications.unreadableExplainer')`, a `Copy text` button using `expo-clipboard` if already a dependency — if it is not, render the text selectable rather than adding a dependency for this — and `Dismiss`.
3. **Stale provisionals**: rows from `provisionals` whose id is in `stale`, each with `t('notifications.provisionalStale', { days: PROVISIONAL_STALE_DAYS })` and a link to the movement, where the owner can delete it. The inbox never deletes a movement itself.

Empty state uses the existing `Empty` component with `t('notifications.empty')`.

- [ ] **Step 3: Mark provisional movements in the list**

In `apps/mobile/app/(tabs)/transactions.tsx`, render a `Chip` reading `t('notifications.provisional')` on any row where `transaction.provisional` is true. Use the existing `Chip` component and a muted colour from the theme; this is a state, not an error.

- [ ] **Step 4: Explain it on the detail screen**

In `apps/mobile/app/movement/[id].tsx`, when `transaction.provisional` is true, render `t('notifications.provisionalExplainer')` near the amount.

- [ ] **Step 5: Label the balance**

In `apps/mobile/app/(tabs)/banks.tsx`, where an account balance is rendered, count that account's provisional movements and append `t('notifications.balanceIncluding', { count })` when the count is above zero. The balance figure itself does not change: provisional movements are movements since the asserted balance, like any other. The label is what stops the figure from claiming to be booked.

- [ ] **Step 6: Keep provisional rows out of the forecast**

In `apps/mobile/app/(tabs)/index.tsx`, add above the existing `forecastYear` memo:

```ts
// A forecast built on unconfirmed rows would double-count once the statement
// that books them lands, and a projection must never be dressed as a booked
// figure. The month's totals still include them; the projection does not.
const booked = useMemo(() => transactions.filter((row) => !row.provisional), [transactions]);
```

Then pass `booked` instead of `transactions` to both `forecastYear(...)` and `bookedYear(...)`. Leave `summarisePeriod`, `netWorthSeries` and `detectRecurring` reading the full set.

- [ ] **Step 7: Add the review chip**

In `apps/mobile/app/(tabs)/index.tsx`, when `countOpenCaptures()` returns more than zero, render a `Touchable` chip reading `t('notifications.reviewChip', { count })` that navigates to `/notification-inbox`. Read the count in the existing focus effect so it refreshes when the owner comes back.

- [ ] **Step 8: Verify on the device**

Trigger a real bank notification (or temporarily allowlist an app you can make notify on demand), then check: the capture appears as unreadable (no parsers exist yet), the review chip counts it, dismissing it clears the chip, and the inbox empty state renders.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
npx prettier --write apps/mobile/app apps/mobile/src/hooks
git add apps/mobile/app apps/mobile/src/hooks
git commit -m "feat(inbox): a captured notification waits to be looked at, and an unconfirmed movement says so"
```

---

### Task 11: Real bank parsers

**Files:**

- Create: `packages/importers/src/notifications/trade-republic.ts`
- Create: `packages/importers/src/notifications/ing.ts`
- Create: `packages/importers/src/notifications/dkb.ts`
- Create: `packages/importers/src/notifications/openbank.ts`
- Modify: `packages/importers/src/notifications/registry.ts`
- Test: `packages/importers/tests/notifications-trade-republic.test.ts` (one file per bank)
- Create: `docs/notification-formats.md`

**Interfaces:**

- Consumes: `NotificationParser`, `CapturedNotification`, `ParsedMovement` (Task 2); `parseAmount` from `../values`.
- Produces: entries in `NOTIFICATION_PARSERS`.

**This task is blocked until the owner supplies real notification strings.** Do not start it before then, and do not invent a bank's wording: a wrong template files a movement under a wrong amount, which is worse than the inbox saying it could not read something. Learning mode from Task 9 also gives the real package ids, which are equally not to be guessed.

Repeat the following per bank. Each bank is its own commit.

- [ ] **Step 1: Record the real wording**

Ask the owner for the exact notification title and text for each shape that bank posts — a card payment, an incoming transfer, a savings-plan execution, and one non-money notification to be ignored. Save the raw strings under `fixtures/private/notifications/<bank>.txt`, which is gitignored.

Add a section to `docs/notification-formats.md` describing the wording, its placeholders, its decimal convention and its language — the same way `docs/import-formats.md` documents a statement layout. This file is committed; the raw strings are not.

- [ ] **Step 2: Write the failing test from the documented wording**

Create `packages/importers/tests/notifications-<bank>.test.ts`. Hand-write the fixtures from the documented shape rather than pasting the owner's real notification, with a test per shape:

```ts
import { describe, expect, it } from 'vitest';
import { tradeRepublicParser } from '../src/notifications/trade-republic';

function capture(title: string, body: string) {
  return {
    packageName: tradeRepublicParser.packageName,
    title,
    body,
    bookingDate: '2026-03-10',
    postedAtMillis: Date.UTC(2026, 2, 10, 9, 0),
  };
}

describe('tradeRepublicParser', () => {
  it('reads a card payment as an expense', () => {
    const result = tradeRepublicParser.parse(capture('<real title shape>', '<real body shape>'));
    expect(result.kind).toBe('movement');
    if (result.kind !== 'movement') return;
    expect(result.movement.amountMinor).toBe(-1234);
    expect(result.movement.currency).toBe('EUR');
    expect(result.movement.side).toBe('expense');
    expect(result.movement.counterparty).toBe('<merchant>');
  });

  it('reads an incoming transfer as income', () => {
    // side comes from the wording, never from the sign
  });

  it('ignores a notification that is not about money', () => {
    expect(tradeRepublicParser.parse(capture('<marketing title>', '<marketing body>')).kind).toBe(
      'ignored',
    );
  });

  it('reports unreadable when the wording does not match', () => {
    const result = tradeRepublicParser.parse(capture('Something else', 'entirely'));
    expect(result.kind).toBe('unreadable');
  });
});
```

- [ ] **Step 2b: Run it and watch it fail**

Run: `npx vitest run packages/importers/tests/notifications-<bank>.test.ts`
Expected: FAIL — the parser module does not exist.

- [ ] **Step 3: Write the parser**

Shape, with the regexes filled in from the documented wording:

```ts
import { parseAmount } from '../values';
import type { CapturedNotification, NotificationParser, NotificationParseResult } from './types';

const PACKAGE = '<real package id from learning mode>';

/**
 * <Bank> posts <describe the shapes>. Documented in docs/notification-formats.md.
 *
 * `side` is taken from the wording, not from the sign: this bank writes a
 * refund as <describe>, which is a positive amount on the expense side.
 */
export const <bank>Parser: NotificationParser = {
  id: '<bank>-card',
  packageName: PACKAGE,
  parse(input: CapturedNotification): NotificationParseResult {
    const text = [input.title, input.body].filter(Boolean).join(' ');
    // ... match, then parseAmount with the right decimal separator
  },
};
```

Rules that are not negotiable in any parser:

- Amounts go through `parseAmount` from `../values`, never `parseFloat`.
- `side` is decided by the wording. Never by `Math.sign`.
- A shape the parser recognises as not-money returns `ignored`; anything else returns `unreadable` with a short machine-readable reason.
- No `console.log`.

- [ ] **Step 4: Run the test**

Run: `npx vitest run packages/importers/tests/notifications-<bank>.test.ts`
Expected: PASS.

- [ ] **Step 5: Register it**

Add the parser to `NOTIFICATION_PARSERS` in `packages/importers/src/notifications/registry.ts` and remove the "empty until" part of the comment once the array is no longer empty.

- [ ] **Step 6: Verify on the device**

Trigger the real notification with the app closed. Confirm a pending capture appears with the right amount, side, account and merchant. Accept it, confirm the movement appears marked unconfirmed, then import a statement covering that date and confirm the provisional disappears and the booked row remains.

- [ ] **Step 7: Commit**

```bash
npm test
npx prettier --write packages/importers docs/notification-formats.md
git add packages/importers docs/notification-formats.md
git commit -m "feat(importers): read <bank>'s card notification, from its real wording"
```

---

### Task 12: Documentation, and the device verification pass

**Files:**

- Modify: `docs/security-model.md`
- Modify: `docs/data-model.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:** none.

The docs currently promise the opposite of what the app now does. This is not bookkeeping: `docs/security-model.md` is what the owner reads to decide whether to trust this app with their statements.

- [ ] **Step 1: Rewrite the false sentence in `docs/security-model.md`**

Find "Movements enter the database only from a statement file the owner exports from their bank and picks from local storage, or from a manual entry." Replace it with the three real origins, and add a section covering:

- The feature is Android only, off by default, and needs notification access granted by hand in system settings.
- Notification access is a broad grant: the system offers the service every notification on the device. What narrows it is the package allowlist enforced in `onNotificationPosted` before `sbn.notification` is dereferenced. Name the file and the method so a reader can check it.
- Captured narratives live in `notification_captures` inside SQLCipher, and are NULLed on accept or dismiss, leaving a hash-only tombstone.
- The allowlist itself lives in plain `SharedPreferences` as package names only, because the listener runs while the database is closed. Say what that does and does not reveal.
- Learning mode records package names only and expires by timestamp.
- Nothing is stored outside SQLCipher, so a notification lost mid-write is lost silently — and why that was the chosen trade.
- Still zero network calls. This feature adds none.

Add a row to the "What is stored, and where" table for the allowlist preferences.

- [ ] **Step 2: Document the schema in `docs/data-model.md`**

Add the three tables to the table list with a sentence each, a `### Migration 9` section covering `provisional`, `superseded_by_id` and the reconciliation rules, and — under the existing date discipline — the `posted_at` exception and why it is confined to `localCalendarDay()`.

- [ ] **Step 3: Correct the README**

The intro says "No bank connection, no aggregator: every import is a file the owner picks by hand." Add the honest qualifier: on Android, if you turn it on, FinAnt can also read the notifications your own bank apps post on the phone. Say that it never leaves the device, that such a movement is marked unconfirmed until a statement confirms it, and that this permission means the app cannot be published to the Play Store.

- [ ] **Step 4: Note the platform asymmetry in `CLAUDE.md`**

Add one line under Conventions: notification capture is Android-only, its parsers live in `packages/importers/src/notifications/` and are documented in `docs/notification-formats.md` from real notification text the owner supplies — never guessed, exactly like a bank's column layout.

- [ ] **Step 5: Run the full device checklist**

On a real device — not an emulator, where the grant screen and the listener binding both misbehave:

1. Grant notification access. Confirm the settings screen reports it granted.
2. **Send yourself a message from a non-allowlisted app** (WhatsApp, Signal, SMS). Confirm zero new rows: the inbox stays empty and the review chip does not appear. This is the security boundary; if anything shows up, stop and fix the gate before going further.
3. Force-stop the app. Trigger a real bank notification. Reopen the app and confirm the capture is there — this is the only proof the headless path works.
4. Trigger a bank notification with the app open on the dashboard. Confirm no crash: `isAllowedInForeground` is what prevents it.
5. With `auto_approve` on for one source, trigger a notification and confirm the movement appears marked unconfirmed without a tap.
6. Import a statement covering that date. Confirm the provisional is gone, the booked row is there, exactly once, and the month's total did not double.
7. Revoke notification access in system settings. Confirm the settings screen reports it missing.
8. Run `Delete all captured notifications` and confirm the inbox empties.
9. Check `adb logcat` during all of the above for any notification text. There must be none.

- [ ] **Step 6: Commit**

```bash
npx prettier --write docs README.md CLAUDE.md
git add docs README.md CLAUDE.md
git commit -m "docs: the security model stops promising that only a file can become a movement"
```

- [ ] **Step 7: Finish the branch**

Use the superpowers:finishing-a-development-branch skill. Per this repo's flow: merge `notification-capture` into `main` with `--no-ff` and a `merge:` subject, keep the branch, and leave `git push` to the owner.

---

## Notes for the executor

- Tasks 1, 2, 3 are pure TypeScript with real tests and no device needed. Tasks 4, 5, 7 change the ledger and are verified by typecheck plus Task 12's checklist. Tasks 6, 9, 10 need a real Android device.
- Task 11 is blocked on the owner supplying real notification strings, and Task 12's checklist steps 3, 5 and 6 need at least one real parser. Everything else can be finished before either.
- If a task turns out to need a schema change beyond migration 9, do not edit migration 9 once it has run on the owner's phone — add migration 10.
- The one thing worth interrupting the owner over: if the allowlist gate in Task 6 cannot be made to work as written, stop. Do not fall back to filtering in JavaScript.
