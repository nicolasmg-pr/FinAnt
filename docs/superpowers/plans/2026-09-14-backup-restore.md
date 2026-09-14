# Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner an encrypted, portable backup file they can restore onto a different phone, so a lost or wiped device no longer destroys every movement they have ever imported.

**Architecture:** Export attaches a second SQLCipher database keyed by a generated recovery code and clones the live database into it with `sqlcipher_export()`. Restore opens that file, migrates it forward to the current schema, then merges it into the live database with one `INSERT OR IGNORE ... SELECT` per table — which makes the device authoritative and the restore idempotent. All rules, table ordering and SQL construction live in `packages/core` as pure functions; the device service only supplies connections and files.

**Tech Stack:** TypeScript 6 (strict, `noUncheckedIndexedAccess`), expo-sqlite with SQLCipher, expo-file-system, expo-document-picker, expo-sharing (new), expo-router, vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-backup-restore-design.md` — read it before Task 1. The plan argues from it and does not repeat its reasoning.

## Global Constraints

- Branch: `backup-restore`. Already created.
- Money stays signed integer minor units; this feature copies rows verbatim and must never arithmetic on them.
- `packages/core` stays free of React and Expo imports. Random bytes are passed *into* the code generator, never read from `expo-crypto` inside it.
- Relative imports inside packages are **extensionless** (`./money`, not `./money.js`).
- TypeScript strict with `noUncheckedIndexedAccess`: every indexed read is `T | undefined`. Do not reach for `!` — the repo does not use it. Use `?? fallback`, `.charAt()`, or an explicit guard.
- **Never** log or put into an error message a movement, a narrative, an amount or an IBAN. Table names and counts only.
- `PRAGMA` cannot be parameterised. Every value interpolated into a `PRAGMA` or `ATTACH` statement is validated against a whitelist or a regex first, and a value that fails is rejected — never escaped and passed through.
- The migration list in `apps/mobile/src/db/schema.ts` is append-only. This feature adds **no** migration.
- Verify with `npm test` and `npm run typecheck` from the repo root.
- `npm run lint:fix` reformats the entire repository. Scope prettier to the files you touched instead: `npx prettier --write <paths>` then `npx eslint --fix <paths>`. zsh does not word-split a variable, so write the paths out literally rather than expanding a `$FILES` variable.
- Commit after every task. Commit messages end with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Probe — does expo-sqlite's SQLCipher expose keyed ATTACH and `sqlcipher_export`?

This is a **throwaway spike**, not shipped code. Everything after it depends on the answer. Do not start Task 2 until this passes.

**Files:**
- Create: `apps/mobile/app/probe-backup.tsx` (deleted again at the end of this task)

**Interfaces:**
- Consumes: nothing.
- Produces: a yes/no answer. If no, STOP and report — the file format changes and the spec's "Verify first" fallback applies.

- [ ] **Step 1: Write the probe screen**

It runs on mount and reports through `console.log`, which Metro prints in the
terminal running `expo run:ios`. Scripted taps do not work on this machine, so a
probe behind a button would need a human; this one does not. It logs markers
only — never a row, an amount or a narrative.

```tsx
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import * as SQLite from 'expo-sqlite';
import { Paths } from 'expo-file-system';
import { getDatabase } from '../src/db/database';

/** THROWAWAY. Delete once the result is recorded in the spec. */
export default function ProbeBackupScreen() {
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    const say = (line: string) => {
      console.log(`PROBE ${line}`);
      setLog((all) => [...all, line]);
    };

    const run = async () => {
      // expo-file-system hands out file:// URIs; SQLite's ATTACH wants a POSIX
      // path. Which form works is one of the things this probe settles.
      const dir = decodeURIComponent(Paths.cache.uri.replace('file://', ''));
      const path = `${dir}probe.finantbackup`;
      const code = 'K7F2M-9XQ4B-3HTZW-5PRND-8YCJV';
      try {
        const db = await getDatabase();
        await db.execAsync(`ATTACH DATABASE '${path}' AS probe KEY '${code}';`);
        say('ATTACH ok');
        await db.execAsync(`SELECT sqlcipher_export('probe');`);
        say('sqlcipher_export ok');
        await db.execAsync(`PRAGMA probe.user_version = 12;`);
        say('attached user_version ok');
        await db.execAsync('DETACH DATABASE probe;');
        say('DETACH ok');

        const reopened = await SQLite.openDatabaseAsync('probe.finantbackup', {}, dir);
        await reopened.execAsync(`PRAGMA key = '${code}';`);
        const row = await reopened.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
        say(`reopened user_version=${row?.user_version ?? 'null'}`);
        const tables = await reopened.getAllAsync<{ name: string }>(
          `SELECT name FROM sqlite_master WHERE type = 'table';`,
        );
        say(`tables=${tables.length}`);

        // A wrong code must fail, or the file is not actually protected.
        const wrong = await SQLite.openDatabaseAsync('probe.finantbackup', {}, dir);
        try {
          await wrong.execAsync(`PRAGMA key = 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX';`);
          await wrong.getFirstAsync('SELECT count(*) FROM sqlite_master;');
          say('FAIL: a wrong code opened the file');
        } catch {
          say('wrong code rejected ok');
        }
        await reopened.closeAsync();
        say('PASS');
      } catch (error) {
        say(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    void run();
  }, []);

  return (
    <ScrollView contentContainerStyle={{ padding: 24, gap: 12 }}>
      {log.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Run it and read the Metro output**

```bash
cd apps/mobile && npx expo run:ios
```

Then open the route without tapping anything:

```bash
xcrun simctl openurl booted finant://probe-backup
```

Expected in the terminal:

```
PROBE ATTACH ok
PROBE sqlcipher_export ok
PROBE attached user_version ok
PROBE DETACH ok
PROBE reopened user_version=12
PROBE tables=17
PROBE wrong code rejected ok
PROBE PASS
```

Four assumptions are settled here: keyed `ATTACH`, `sqlcipher_export()`,
`PRAGMA <schema>.user_version` on an attached database, and that a wrong code
is actually refused. Note also which path form SQLite accepted — Task 5's
`posixPath()` depends on the answer.

- [ ] **Step 3: Delete the probe**

```bash
rm apps/mobile/app/probe-backup.tsx
```

- [ ] **Step 4: Record the result**

Append a short "Probe result" note under "Verify first" in the spec, saying which calls worked and which path form SQLite accepted. Commit:

```bash
git add docs/superpowers/specs/2026-09-14-backup-restore-design.md
git commit -m "docs(backup): record SQLCipher probe result

ATTACH ... KEY, sqlcipher_export() and PRAGMA <schema>.user_version are the
three assumptions the whole file format rests on. Recorded here so a later
reader does not have to re-run the probe to find out they hold.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**If the probe failed:** stop and report. Do not improvise around it.

---

### Task 2: Recovery code — generation, normalisation, validation

**Files:**
- Create: `packages/core/src/backup.ts`
- Create: `packages/core/tests/backup.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './backup';`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RECOVERY_CODE_PATTERN: RegExp`
  - `formatRecoveryCode(bytes: Uint8Array): string` — 16 bytes in, `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX` out
  - `normaliseRecoveryCode(input: string): string`
  - `isValidRecoveryCode(input: string): boolean`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  formatRecoveryCode,
  isValidRecoveryCode,
  normaliseRecoveryCode,
} from '../src/backup';

const BYTES = Uint8Array.from([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

describe('formatRecoveryCode', () => {
  it('produces five groups of five', () => {
    const code = formatRecoveryCode(BYTES);
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
  });

  it('is deterministic for the same bytes', () => {
    expect(formatRecoveryCode(BYTES)).toBe(formatRecoveryCode(BYTES));
  });

  it('differs when the bytes differ', () => {
    const other = Uint8Array.from(BYTES);
    other[0] = 0x01;
    expect(formatRecoveryCode(other)).not.toBe(formatRecoveryCode(BYTES));
  });

  // I, L, O and U are absent from Crockford base32 so a handwritten code
  // cannot be transcribed into a different one.
  it('never emits an ambiguous letter', () => {
    for (let seed = 0; seed < 64; seed += 1) {
      const bytes = Uint8Array.from({ length: 16 }, (_, i) => (seed * 31 + i * 7) % 256);
      expect(formatRecoveryCode(bytes)).not.toMatch(/[ILOU]/);
    }
  });

  it('refuses fewer than sixteen bytes', () => {
    expect(() => formatRecoveryCode(Uint8Array.from([1, 2, 3]))).toThrow();
  });
});

describe('normaliseRecoveryCode', () => {
  const code = formatRecoveryCode(BYTES);

  it('accepts the code it produced', () => {
    expect(normaliseRecoveryCode(code)).toBe(code);
  });

  it('accepts lowercase', () => {
    expect(normaliseRecoveryCode(code.toLowerCase())).toBe(code);
  });

  it('accepts an ungrouped paste with stray whitespace', () => {
    const ungrouped = ` ${code.replace(/-/g, '')} `;
    expect(normaliseRecoveryCode(ungrouped)).toBe(code);
  });

  // Crockford's own decoding rule. The alphabet has no I, L or O, so mapping
  // them is unambiguous and saves a transcription from being rejected.
  it('maps the letters the alphabet omits onto their digits', () => {
    expect(normaliseRecoveryCode('IL0OO-00000-00000-00000-00000')).toBe(
      '11000-00000-00000-00000-00000',
    );
  });
});

describe('isValidRecoveryCode', () => {
  it('accepts a generated code in any casing or grouping', () => {
    const code = formatRecoveryCode(BYTES);
    expect(isValidRecoveryCode(code)).toBe(true);
    expect(isValidRecoveryCode(code.toLowerCase())).toBe(true);
    expect(isValidRecoveryCode(code.replace(/-/g, ''))).toBe(true);
  });

  it('rejects the wrong length', () => {
    expect(isValidRecoveryCode('K7F2M-9XQ4B-3HTZW-5PRND')).toBe(false);
    expect(isValidRecoveryCode('K7F2M-9XQ4B-3HTZW-5PRND-8YCJV-X')).toBe(false);
  });

  it('rejects U, which the alphabet deliberately omits and does not remap', () => {
    expect(isValidRecoveryCode('UUUUU-UUUUU-UUUUU-UUUUU-UUUUU')).toBe(false);
  });

  // The code is interpolated into a PRAGMA, which cannot be parameterised.
  // These must never survive validation.
  it('rejects anything that could end a SQL string', () => {
    expect(isValidRecoveryCode("K7F2M-9XQ4B-3HTZW-5PRND-8YC'V")).toBe(false);
    expect(isValidRecoveryCode('K7F2M-9XQ4B-3HTZW-5PRND-8YC;V')).toBe(false);
    expect(isValidRecoveryCode("'; DROP TABLE transactions; --")).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidRecoveryCode('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- backup
```

Expected: FAIL — `Failed to resolve import "../src/backup"`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/backup.ts`:

```ts
/**
 * Crockford base32. `I`, `L`, `O` and `U` are absent on purpose: the first
 * three are the ones a handwritten code gets transcribed wrong, and `U` is
 * left out so a random code cannot spell something unfortunate.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const GROUP = 5;
const GROUPS = 5;
const LENGTH = GROUP * GROUPS;

/**
 * The shape a recovery code must have before it is allowed anywhere near a
 * statement. `PRAGMA key` cannot be parameterised, so this pattern — not an
 * escaping routine — is what stands between a typed string and the database.
 */
export const RECOVERY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/;

/**
 * Renders 125 bits of the caller's randomness as a grouped code.
 *
 * The bytes come from the caller because this package stays free of Expo: the
 * device passes `Crypto.getRandomBytes(16)` in. Sixteen bytes carry 128 bits
 * and twenty-five base32 characters hold 125; the remaining three are dropped
 * rather than padded, because a code whose last character only ever takes four
 * of thirty-two values invites the reader to wonder why.
 */
export function formatRecoveryCode(bytes: Uint8Array): string {
  if (bytes.length < 16) {
    throw new Error('a recovery code needs 16 random bytes');
  }

  let chars = '';
  let accumulator = 0;
  let bits = 0;
  for (let i = 0; i < 16 && chars.length < LENGTH; i += 1) {
    accumulator = (accumulator << 8) | (bytes[i] ?? 0);
    bits += 8;
    while (bits >= 5 && chars.length < LENGTH) {
      bits -= 5;
      chars += ALPHABET.charAt((accumulator >>> bits) & 31);
    }
  }

  const groups: string[] = [];
  for (let i = 0; i < LENGTH; i += GROUP) {
    groups.push(chars.slice(i, i + GROUP));
  }
  return groups.join('-');
}

/**
 * Puts a typed or pasted code into canonical form so that a correct code is
 * not rejected over casing, grouping or a transcription of `O` for `0`.
 *
 * It never *adds* validity: characters outside the alphabet are left in place
 * rather than stripped, so `isValidRecoveryCode` still sees them and still
 * refuses. Stripping would quietly turn a wrong code into a valid-looking one.
 */
export function normaliseRecoveryCode(input: string): string {
  const compact = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[IL]/g, '1')
    .replace(/O/g, '0');

  const groups: string[] = [];
  for (let i = 0; i < compact.length; i += GROUP) {
    groups.push(compact.slice(i, i + GROUP));
  }
  return groups.join('-');
}

/** True only for a code that is safe to interpolate into a `PRAGMA key`. */
export function isValidRecoveryCode(input: string): boolean {
  return RECOVERY_CODE_PATTERN.test(normaliseRecoveryCode(input));
}
```

Add to `packages/core/src/index.ts`, keeping the file's existing order (append at the end):

```ts
export * from './backup';
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test -- backup
```

Expected: PASS, 16 tests.

- [ ] **Step 5: Typecheck, format, commit**

```bash
npm run typecheck
npx prettier --write packages/core/src/backup.ts packages/core/tests/backup.test.ts packages/core/src/index.ts
npx eslint --fix packages/core/src/backup.ts packages/core/tests/backup.test.ts
git add packages/core/src/backup.ts packages/core/tests/backup.test.ts packages/core/src/index.ts
git commit -m "feat(backup): recovery codes in Crockford base32

The backup file cannot lean on the device keychain, so it carries its own
secret. It is generated rather than chosen: the file may end up in iCloud
Drive, where a human-picked passphrase is the weakest thing in the design.

The alphabet drops I, L, O and U so a handwritten code cannot be transcribed
into a different one, and normalisation maps the first three back rather than
rejecting a careful reader's transcription.

Validation is a whitelist pattern, not an escaping routine, because PRAGMA key
cannot be parameterised and the code is interpolated into it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Table manifest and SQL builders

**Files:**
- Modify: `packages/core/src/backup.ts`
- Modify: `packages/core/tests/backup.test.ts`
- Create: `apps/mobile/src/services/tests/backup-coverage.test.ts`

**Interfaces:**
- Consumes: `isValidRecoveryCode` from Task 2.
- Produces:
  - `BACKUP_FORMAT: 'finant-backup-1'`
  - `BACKUP_TABLES: readonly string[]` — foreign-key parents first
  - `EXCLUDED_TABLES: readonly string[]`
  - `BACKUP_META_TABLE = 'backup_meta'`
  - `attachBackupSql(path: string, code: string): string`
  - `exportBackupSql(): string`
  - `createMetaTableSql(): string`
  - `mergeTableSql(table: string): string`
  - `detachBackupSql(): string`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/tests/backup.test.ts`:

```ts
import {
  attachBackupSql,
  BACKUP_TABLES,
  detachBackupSql,
  EXCLUDED_TABLES,
  exportBackupSql,
  mergeTableSql,
} from '../src/backup';

describe('BACKUP_TABLES', () => {
  // INSERT OR IGNORE runs with foreign keys on, so a child inserted before its
  // parent fails the whole restore.
  const PARENTS: Readonly<Record<string, readonly string[]>> = {
    accounts: ['institutions'],
    transactions: ['accounts', 'categories'],
    investment_legs: ['transactions', 'assets'],
    quotes: ['assets'],
    price_history: ['assets'],
    notification_routes: ['notification_sources'],
    rules: ['categories'],
    budgets: ['categories'],
  };

  it('lists every parent before its children', () => {
    for (const [child, parents] of Object.entries(PARENTS)) {
      const childIndex = BACKUP_TABLES.indexOf(child);
      expect(childIndex, `${child} is missing from the manifest`).toBeGreaterThanOrEqual(0);
      for (const parent of parents) {
        expect(BACKUP_TABLES.indexOf(parent), `${parent} must precede ${child}`).toBeGreaterThanOrEqual(0);
        expect(BACKUP_TABLES.indexOf(parent)).toBeLessThan(childIndex);
      }
    }
  });

  it('holds no duplicates', () => {
    expect(new Set(BACKUP_TABLES).size).toBe(BACKUP_TABLES.length);
  });

  it('shares nothing with the exclusion list', () => {
    for (const table of EXCLUDED_TABLES) {
      expect(BACKUP_TABLES).not.toContain(table);
    }
  });

  // Raw notification text is the most sensitive free text in the database and
  // the inbox is transient; anything accepted from it is already a transaction.
  it('excludes the notification inbox', () => {
    expect(EXCLUDED_TABLES).toContain('notification_captures');
  });
});

describe('SQL builders', () => {
  const CODE = 'K7F2M-9XQ4B-3HTZW-5PRND-8YCJV';

  it('attaches with the code as a passphrase', () => {
    expect(attachBackupSql('/tmp/b.finantbackup', CODE)).toBe(
      `ATTACH DATABASE '/tmp/b.finantbackup' AS backup KEY '${CODE}';`,
    );
  });

  it('normalises the code before interpolating it', () => {
    expect(attachBackupSql('/tmp/b.finantbackup', CODE.toLowerCase())).toContain(CODE);
  });

  it('refuses a code that failed validation', () => {
    expect(() => attachBackupSql('/tmp/b.finantbackup', "x'; DROP TABLE transactions; --")).toThrow();
  });

  it('escapes a quote in the path rather than trusting it', () => {
    expect(attachBackupSql("/tmp/o'brien.finantbackup", CODE)).toContain("'/tmp/o''brien.finantbackup'");
  });

  it('exports into the attached schema', () => {
    expect(exportBackupSql()).toBe("SELECT sqlcipher_export('backup');");
  });

  it('merges a manifest table insert-only', () => {
    expect(mergeTableSql('transactions')).toBe(
      'INSERT OR IGNORE INTO main.transactions SELECT * FROM backup.transactions;',
    );
  });

  // The table name is interpolated, so it comes from the manifest or not at all.
  it('refuses a table outside the manifest', () => {
    expect(() => mergeTableSql('notification_captures')).toThrow();
    expect(() => mergeTableSql('sqlite_master; DROP TABLE accounts; --')).toThrow();
  });

  it('detaches', () => {
    expect(detachBackupSql()).toBe('DETACH DATABASE backup;');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- backup
```

Expected: FAIL — `attachBackupSql is not a function` and friends.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/backup.ts`:

```ts
/** Written into every exported file so a future reader can tell what it is. */
export const BACKUP_FORMAT = 'finant-backup-1';

/** The one table that exists inside a backup file and not in the live schema. */
export const BACKUP_META_TABLE = 'backup_meta';

/** The schema name an exported database is attached under, on both sides. */
const ATTACHED = 'backup';

/**
 * Every table a backup carries, foreign-key parents first.
 *
 * The order is the merge order and it is load-bearing: the restore runs with
 * foreign keys on, so a child row inserted before its parent fails the whole
 * transaction. `backup-coverage.test.ts` asserts that this list plus
 * `EXCLUDED_TABLES` accounts for every table the migrations create, so a table
 * added later cannot be silently left out of the backup.
 */
export const BACKUP_TABLES: readonly string[] = [
  'institutions',
  'accounts',
  'categories',
  'import_profiles',
  'rules',
  'budgets',
  'exclusion_rules',
  'transactions',
  'assets',
  'investment_legs',
  'quotes',
  'price_history',
  'notification_sources',
  'notification_routes',
  'settings',
];

/**
 * Left out of the backup on purpose.
 *
 * `notification_captures` holds the raw title and body of a bank's own
 * notifications — real movement text, and the most sensitive free text in the
 * database. It is also a transient inbox: anything the owner accepted from it
 * is already a `transactions` row, so excluding it costs an unreviewed queue
 * and keeps that text out of a file that leaves the device.
 */
export const EXCLUDED_TABLES: readonly string[] = ['notification_captures'];

/** Doubles the single quotes SQLite uses to escape them inside a string literal. */
function quote(literal: string): string {
  return literal.replace(/'/g, "''");
}

/**
 * Attaches the backup file with the recovery code as a **passphrase**.
 *
 * Passphrase form, not the `x'...'` raw-key form the live database uses, so
 * SQLCipher runs its own KDF — PBKDF2-HMAC-SHA512, 256k iterations, random
 * per-file salt. The live key is already 256 random bits and needs none of
 * that; a file that may sit in cloud storage does.
 *
 * The code is validated, not escaped. `PRAGMA`/`ATTACH ... KEY` cannot be
 * parameterised, so a code that does not match the pattern is refused here
 * rather than quoted and hoped for.
 */
export function attachBackupSql(path: string, code: string): string {
  if (!isValidRecoveryCode(code)) {
    throw new Error('refusing to attach with a malformed recovery code');
  }
  return `ATTACH DATABASE '${quote(path)}' AS ${ATTACHED} KEY '${normaliseRecoveryCode(code)}';`;
}

/** Clones schema and rows into the attached file. Does **not** copy `user_version`. */
export function exportBackupSql(): string {
  return `SELECT sqlcipher_export('${ATTACHED}');`;
}

/** The metadata table, created inside the exported file after the export. */
export function createMetaTableSql(): string {
  return (
    `CREATE TABLE ${ATTACHED}.${BACKUP_META_TABLE} (` +
    'format TEXT NOT NULL, app_version TEXT NOT NULL, ' +
    'schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);'
  );
}

/**
 * The merge, for one table.
 *
 * `INSERT OR IGNORE` **is** the device-wins rule: it skips a row whose primary
 * key is taken, and it skips a movement the unique indexes already cover —
 * `idx_tx_external (account_id, external_id)` and
 * `idx_tx_hash (account_id, import_hash)`, the same indexes that guard an
 * overlapping import. Restoring therefore cannot overwrite a recategorisation
 * made on the phone, and running it twice adds nothing the first run did not.
 *
 * `SELECT *` is safe only because the caller has migrated the backup to the
 * current schema and asserted both sides' columns agree. The table name is
 * whitelisted because it is interpolated.
 */
export function mergeTableSql(table: string): string {
  if (!BACKUP_TABLES.includes(table)) {
    throw new Error('refusing to merge a table outside the backup manifest');
  }
  return `INSERT OR IGNORE INTO main.${table} SELECT * FROM ${ATTACHED}.${table};`;
}

export function detachBackupSql(): string {
  return `DETACH DATABASE ${ATTACHED};`;
}
```

- [ ] **Step 4: Write the coverage guard**

Create `apps/mobile/src/services/tests/backup-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BACKUP_TABLES, EXCLUDED_TABLES } from '@finant/core';
import { MIGRATIONS } from '../../db/schema';

/**
 * The guard that makes the backup manifest maintainable.
 *
 * A table added by a future migration and forgotten here would simply not be
 * backed up, and nobody would find out until a restore came up short — on the
 * one day that matters. This fails the suite instead, and the fix is a
 * deliberate choice between the manifest and the exclusion list.
 */
function tablesCreatedByMigrations(): string[] {
  const names: string[] = [];
  for (const migration of MIGRATIONS) {
    for (const match of migration.sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
      const name = match[1];
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

describe('backup manifest coverage', () => {
  it('accounts for every table the migrations create', () => {
    const known = new Set([...BACKUP_TABLES, ...EXCLUDED_TABLES]);
    const missing = tablesCreatedByMigrations().filter((name) => !known.has(name));
    expect(
      missing,
      'add each of these to BACKUP_TABLES or EXCLUDED_TABLES in packages/core/src/backup.ts',
    ).toEqual([]);
  });

  it('names no table the schema does not create', () => {
    const created = new Set(tablesCreatedByMigrations());
    const stale = [...BACKUP_TABLES, ...EXCLUDED_TABLES].filter((name) => !created.has(name));
    expect(stale, 'these are in the manifest but no migration creates them').toEqual([]);
  });

  it('found the tables at all, so a regex change cannot silently pass the guard', () => {
    expect(tablesCreatedByMigrations().length).toBeGreaterThanOrEqual(15);
  });
});
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm test -- backup
```

Expected: PASS. If "accounts for every table" fails, the manifest is wrong — fix the manifest, not the test.

- [ ] **Step 6: Typecheck, format, commit**

```bash
npm run typecheck
npx prettier --write packages/core/src/backup.ts packages/core/tests/backup.test.ts apps/mobile/src/services/tests/backup-coverage.test.ts
npx eslint --fix packages/core/src/backup.ts packages/core/tests/backup.test.ts apps/mobile/src/services/tests/backup-coverage.test.ts
git add packages/core/src/backup.ts packages/core/tests/backup.test.ts apps/mobile/src/services/tests/backup-coverage.test.ts
git commit -m "feat(backup): table manifest and SQL builders

The manifest doubles as the merge order, which is load-bearing: the restore
runs with foreign keys on, so a child inserted before its parent fails the
whole transaction.

A coverage test reads the table names back out of MIGRATIONS and fails if one
is in neither the manifest nor the exclusion list. A table quietly left out of
a backup is invisible until a restore comes up short, which is the one moment
it must not be.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The `lastBackupAt` setting

**Files:**
- Modify: `apps/mobile/src/db/settings-keys.ts`
- Modify: `apps/mobile/src/db/settings-repo.ts` (re-export list)

**Interfaces:**
- Consumes: nothing.
- Produces: `SETTING_LAST_BACKUP_AT = 'lastBackupAt'`, importable from `../db/settings-repo`.

- [ ] **Step 1: Add the key**

Append to `apps/mobile/src/db/settings-keys.ts`:

```ts
/**
 * When the last backup was written, ISO 8601. Shown on the backup screen so
 * the owner can see at a glance how stale their safety net is — the only
 * prompt this feature gives them, since it takes no backups on its own.
 */
export const SETTING_LAST_BACKUP_AT = 'lastBackupAt';
```

Add `SETTING_LAST_BACKUP_AT,` to the re-export block in `apps/mobile/src/db/settings-repo.ts`, keeping it alphabetical (after `SETTING_CURRENCY`, before `SETTING_LAST_IMPORT_ACCOUNT`).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
npx prettier --write apps/mobile/src/db/settings-keys.ts apps/mobile/src/db/settings-repo.ts
git add apps/mobile/src/db/settings-keys.ts apps/mobile/src/db/settings-repo.ts
git commit -m "feat(backup): record when the last backup was taken

No migration: settings is a key-value table, and the append-only migration
list stays untouched.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `createBackup()`

**Files:**
- Create: `apps/mobile/src/services/backup.ts`
- Modify: `apps/mobile/package.json` (via `npx expo install`)

**Interfaces:**
- Consumes: `attachBackupSql`, `exportBackupSql`, `createMetaTableSql`, `detachBackupSql`, `formatRecoveryCode`, `BACKUP_FORMAT`, `EXCLUDED_TABLES` (Tasks 2-3); `SETTING_LAST_BACKUP_AT` (Task 4); `getDatabase` from `../db/database`; `LATEST_VERSION` from `../db/schema`.
- Produces:
  - `class BackupError extends Error { readonly code: BackupErrorCode }`
  - `type BackupErrorCode = 'wrong-code' | 'not-a-backup' | 'too-new' | 'schema-mismatch' | 'sharing-unavailable'`
  - `createBackup(): Promise<{ code: string; createdAt: string }>`

- [ ] **Step 1: Add the dependency**

```bash
cd apps/mobile && npx expo install expo-sharing
```

Expected: `expo-sharing` at `~57.x` in `apps/mobile/package.json`.

- [ ] **Step 2: Export the database name**

`DATABASE_NAME` is module-private in `apps/mobile/src/db/database.ts:14`. The backup
service opens its own connection to the same file, so it needs the name. Change the
declaration to:

```ts
/** Exported because the backup service opens its own connection to this file. */
export const DATABASE_NAME = 'finant.db';
```

Nothing else in that file changes.

- [ ] **Step 3: Write the service**

Create `apps/mobile/src/services/backup.ts`:

```ts
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import {
  attachBackupSql,
  BACKUP_FORMAT,
  BACKUP_META_TABLE,
  createMetaTableSql,
  detachBackupSql,
  EXCLUDED_TABLES,
  exportBackupSql,
  formatRecoveryCode,
} from '@finant/core';
import * as SQLite from 'expo-sqlite';
import { DATABASE_NAME } from '../db/database';
import { getOrCreateDatabaseKey } from '../security/keys';
import { LATEST_VERSION } from '../db/schema';
import { SETTING_LAST_BACKUP_AT, writeSetting } from '../db/settings-repo';

export type BackupErrorCode =
  | 'wrong-code'
  | 'not-a-backup'
  | 'too-new'
  | 'schema-mismatch'
  | 'sharing-unavailable';

/**
 * A named failure. The screen turns the code into a translated sentence; the
 * message here is for a developer reading a stack trace and carries no row,
 * amount or narrative, per the Boundaries rule in CLAUDE.md.
 */
export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode) {
    super(`backup: ${code}`);
    this.name = 'BackupError';
  }
}

/**
 * expo-file-system hands out `file://` URIs; SQLite's ATTACH wants a POSIX
 * path. Confirmed by the probe in Task 1 of the implementation plan.
 */
export function posixPath(uri: string): string {
  return decodeURIComponent(uri.replace(/^file:\/\//, ''));
}

function backupFileName(now: Date): string {
  return `finant-backup-${now.toISOString().slice(0, 10)}.finantbackup`;
}

/**
 * Writes an encrypted copy of the database and hands it to the share sheet.
 *
 * The recovery code is returned so the screen can show it exactly once. It is
 * never stored: a code kept on the device it protects a backup of would defeat
 * the entire point of the file being portable.
 */
export async function createBackup(): Promise<{ code: string; createdAt: string }> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new BackupError('sharing-unavailable');
  }

  const code = formatRecoveryCode(Crypto.getRandomBytes(16));
  const createdAt = new Date().toISOString();
  const file = new File(Paths.cache, backupFileName(new Date(createdAt)));
  // ATTACH creates the file; an existing one from an abandoned run would be
  // opened with the wrong key and fail as "file is not a database".
  if (file.exists) file.delete();

  // Its own connection, never the app's. Without useNewConnection expo-sqlite
  // returns the cached handle the UI is reading through, and DETACH then fails
  // with "database is locked". Confirmed by the probe in Task 1.
  const key = await getOrCreateDatabaseKey();
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const path = posixPath(file.uri);

  try {
    await db.execAsync(attachBackupSql(path, code));
    try {
      await db.execAsync(exportBackupSql());
      for (const table of EXCLUDED_TABLES) {
        await db.execAsync(`DELETE FROM backup.${table};`);
      }
      // sqlcipher_export copies schema and rows but not user_version. Without
      // this the file claims version 0 and a restore would re-run every
      // migration over populated tables.
      await db.execAsync(`PRAGMA backup.user_version = ${LATEST_VERSION};`);
      await db.execAsync(createMetaTableSql());
      await db.runAsync(
        `INSERT INTO backup.${BACKUP_META_TABLE} (format, app_version, schema_version, created_at)
         VALUES (?, ?, ?, ?);`,
        BACKUP_FORMAT,
        Constants.expoConfig?.version ?? 'unknown',
        LATEST_VERSION,
        createdAt,
      );
    } finally {
      await db.execAsync(detachBackupSql());
      await db.closeAsync();
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/octet-stream',
      dialogTitle: 'FinAnt backup',
    });
    await writeSetting(SETTING_LAST_BACKUP_AT, createdAt);
    return { code, createdAt };
  } finally {
    // The cache copy is encrypted, but it is also the owner's whole financial
    // history sitting in a directory the OS may hand to anything that asks for
    // free space. It has been shared by now; it has no reason to stay.
    if (file.exists) file.delete();
  }
}
```

`EXCLUDED_TABLES` is interpolated into a `DELETE`. It is a module constant in `@finant/core`, never user input — the whitelist is the constant itself.

- [ ] **Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: clean. If `Constants.expoConfig` is typed as possibly undefined, the `?? 'unknown'` above already covers it.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/src/services/backup.ts apps/mobile/src/db/database.ts
npx eslint --fix apps/mobile/src/services/backup.ts
git add apps/mobile/src/services/backup.ts apps/mobile/src/db/database.ts apps/mobile/package.json package-lock.json
git commit -m "feat(backup): write an encrypted backup and share it

sqlcipher_export copies schema and rows but not user_version, so it is set by
hand — without it every file claims schema version 0 and a restore would
re-run all twelve migrations over populated tables.

The recovery code is returned, never stored. A code kept on the device whose
backup it unlocks would defeat the point of the file being portable.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `inspectBackup()` — open, migrate, preview, write nothing

**Files:**
- Modify: `apps/mobile/src/services/backup.ts`

**Interfaces:**
- Consumes: `BackupError`, `posixPath` (Task 5); `MIGRATIONS`, `LATEST_VERSION` from `../db/schema`.
- Produces:
  - `type BackupPreview = { path: string; appVersion: string; schemaVersion: number; createdAt: string; counts: Readonly<Record<string, number>> }`
  - `inspectBackup(uri: string, code: string): Promise<BackupPreview>`
  - `discardBackup(preview: BackupPreview): Promise<void>`

- [ ] **Step 1: Add `openBackupSql` to core**

A backup file is opened on its own connection, not attached, so it needs a plain
`PRAGMA key` rather than `ATTACH ... KEY`. Add to `packages/core/src/backup.ts`:

```ts
/**
 * `PRAGMA key` in passphrase form, for opening a backup file on its own
 * connection. Must be the first statement on that connection: SQLCipher reads
 * the header with it, and any query issued before it fails with "file is not a
 * database" on an encrypted file.
 */
export function openBackupSql(code: string): string {
  if (!isValidRecoveryCode(code)) {
    throw new Error('refusing to open with a malformed recovery code');
  }
  return `PRAGMA key = '${normaliseRecoveryCode(code)}';`;
}
```

- [ ] **Step 2: Write the service function**

Append to `apps/mobile/src/services/backup.ts`. Add to the imports at the top:
`import * as SQLite from 'expo-sqlite';` and, from `@finant/core`, `BACKUP_TABLES`
and `openBackupSql`; from `../db/schema`, `MIGRATIONS`.

```ts
export type BackupPreview = {
  /** POSIX path of the working copy in cache, ready for ATTACH. */
  readonly path: string;
  readonly appVersion: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly counts: Readonly<Record<string, number>>;
};

/**
 * Opens a picked file, brings it up to the current schema, and reports what is
 * in it — without touching the live database.
 *
 * Nothing is written until `mergeBackup` runs, which is the whole point: a
 * restore that writes before showing what it is about to write is a leap, and
 * this is the one feature whose entire job is to be trustworthy under stress.
 */
export async function inspectBackup(uri: string, code: string): Promise<BackupPreview> {
  const working = new File(Paths.cache, `restore-${Date.now()}.finantbackup`);
  // File.copy() returns a promise: without the await, SQLite can open the
  // working file while the copy is still in flight.
  await new File(uri).copy(working);

  let db: SQLite.SQLiteDatabase | null = null;
  try {
    db = await SQLite.openDatabaseAsync(working.name, {}, posixPath(Paths.cache.uri));
    // Must be the first statement on the connection: SQLCipher reads the
    // header with it, and any query before it fails on an encrypted file.
    // Must be the first statement on the connection.
    await db.execAsync(openBackupSql(code));

    let meta: { format: string; app_version: string; schema_version: number; created_at: string } | null;
    try {
      meta = await db.getFirstAsync(
        `SELECT format, app_version, schema_version, created_at FROM ${BACKUP_META_TABLE};`,
      );
    } catch {
      // Either the key is wrong (SQLCipher reports "file is not a database")
      // or the file opened but has no meta table. The first query is where
      // both surface, so they are told apart by a second, cheaper probe.
      throw (await opensAtAll(db)) ? new BackupError('not-a-backup') : new BackupError('wrong-code');
    }
    if (!meta || meta.format !== BACKUP_FORMAT) throw new BackupError('not-a-backup');
    if (meta.schema_version > LATEST_VERSION) throw new BackupError('too-new');

    for (const migration of MIGRATIONS) {
      if (migration.version <= meta.schema_version) continue;
      const sql = migration.sql;
      await db.withTransactionAsync(async () => {
        await db?.execAsync(sql);
      });
      await db.execAsync(`PRAGMA user_version = ${migration.version};`);
    }

    const counts: Record<string, number> = {};
    for (const table of BACKUP_TABLES) {
      const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table};`);
      counts[table] = row?.n ?? 0;
    }

    return {
      path: posixPath(working.uri),
      appVersion: meta.app_version,
      schemaVersion: LATEST_VERSION,
      createdAt: meta.created_at,
      counts,
    };
  } catch (error) {
    if (working.exists) working.delete();
    throw error;
  } finally {
    await db?.closeAsync();
  }
}

/** True if the connection is readable at all — i.e. the key was right. */
async function opensAtAll(db: SQLite.SQLiteDatabase): Promise<boolean> {
  try {
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master;');
    return true;
  } catch {
    return false;
  }
}

/** Drops the working copy when the owner backs out of a preview. */
export async function discardBackup(preview: BackupPreview): Promise<void> {
  const file = new File(`file://${preview.path}`);
  if (file.exists) file.delete();
}
```

- [ ] **Step 3: Add a test for `openBackupSql`**

Append to `packages/core/tests/backup.test.ts`, inside the `SQL builders` describe:

```ts
  it('opens a backup file with the code as a passphrase', () => {
    expect(openBackupSql(CODE)).toBe(`PRAGMA key = '${CODE}';`);
  });

  it('refuses to open with a malformed code', () => {
    expect(() => openBackupSql("'; DROP TABLE accounts; --")).toThrow();
  });
```

Add `openBackupSql` to that file's import list.

- [ ] **Step 4: Run the tests**

```bash
npm test -- backup
npm run typecheck
```

Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/mobile/src/services/backup.ts packages/core/src/backup.ts packages/core/tests/backup.test.ts
npx eslint --fix apps/mobile/src/services/backup.ts packages/core/src/backup.ts
git add apps/mobile/src/services/backup.ts packages/core/src/backup.ts packages/core/tests/backup.test.ts
git commit -m "feat(backup): inspect a backup without writing anything

A wrong recovery code and a file that is not a backup both surface on the same
first query, so they are told apart by a second probe and reported separately.
Showing a wrong key as corruption would send the owner looking for a problem
with their file at the worst possible moment.

An older backup is migrated forward on its own connection using the existing
migration list, so the merge can rely on both schemas being identical.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `mergeBackup()`

**Files:**
- Modify: `apps/mobile/src/services/backup.ts`

**Interfaces:**
- Consumes: `BackupPreview` (Task 6); `attachBackupSql`, `mergeTableSql`, `detachBackupSql`, `BACKUP_TABLES` (Task 3).
- Produces: `mergeBackup(preview: BackupPreview, code: string): Promise<Readonly<Record<string, number>>>` — rows actually added, per table.

- [ ] **Step 1: Write the implementation**

Append to `apps/mobile/src/services/backup.ts`:

```ts
/**
 * Merges a previewed backup into the live database, insert-only.
 *
 * Runs as one transaction with deferred foreign keys, so an orphan row in the
 * backup produces a single clean rollback at commit rather than aborting
 * halfway down the manifest and leaving a partial restore behind.
 *
 * Returns rows added per table. A second run of the same file returns zeroes,
 * which is the cheapest evidence that "device wins" holds.
 */
export async function mergeBackup(
  preview: BackupPreview,
  code: string,
): Promise<Readonly<Record<string, number>>> {
  // Its own connection, for the same reason as the export: DETACH against the
  // handle the UI is reading through fails with "database is locked". Rows
  // committed here are visible to the app's connection immediately afterwards.
  const key = await getOrCreateDatabaseKey();
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  const added: Record<string, number> = {};

  try {
    await db.execAsync(attachBackupSql(preview.path, code));
    try {
      await assertColumnsMatch(db);
      // foreign_keys defaults OFF on every new connection — database.ts turns it
      // on only for the app's own cached handle. Without this line
      // defer_foreign_keys is a no-op: enforcement is off entirely and an orphan
      // row inserts silently instead of rolling the restore back.
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await db.execAsync('PRAGMA defer_foreign_keys = ON;');
      await db.withTransactionAsync(async () => {
        for (const table of BACKUP_TABLES) {
          const before = await countRows(db, `main.${table}`);
          await db.execAsync(mergeTableSql(table));
          added[table] = (await countRows(db, `main.${table}`)) - before;
        }
      });
    } finally {
      await db.execAsync(detachBackupSql());
      await db.closeAsync();
    }
    return added;
  } finally {
    await discardBackup(preview);
  }
}

async function countRows(db: SQLite.SQLiteDatabase, qualified: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${qualified};`);
  return row?.n ?? 0;
}

/**
 * Refuses the merge unless both sides declare identical columns for every
 * manifest table.
 *
 * `inspectBackup` migrated the file to the current schema, so this should
 * always hold — which is exactly why it is asserted rather than assumed. It is
 * the precondition that lets the merge use `SELECT *`, and `SELECT *` across
 * mismatched columns would write values into the wrong fields silently.
 */
async function assertColumnsMatch(db: SQLite.SQLiteDatabase): Promise<void> {
  for (const table of BACKUP_TABLES) {
    const [mine, theirs] = await Promise.all([
      db.getAllAsync<{ name: string }>(`PRAGMA main.table_info(${table});`),
      db.getAllAsync<{ name: string }>(`PRAGMA backup.table_info(${table});`),
    ]);
    const a = mine.map((column) => column.name).join(',');
    const b = theirs.map((column) => column.name).join(',');
    if (a !== b || a === '') {
      throw new BackupError('schema-mismatch');
    }
  }
}
```

`countRows` before and after is used rather than `changes()` because the merge runs several statements inside one transaction and `changes()` reports only the most recent one.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck && npm test
```

Expected: clean, all tests pass.

- [ ] **Step 3: Commit**

```bash
npx prettier --write apps/mobile/src/services/backup.ts
npx eslint --fix apps/mobile/src/services/backup.ts
git add apps/mobile/src/services/backup.ts
git commit -m "feat(backup): merge a backup into the live database

INSERT OR IGNORE is the device-wins rule rather than an implementation of it:
it skips on the primary key and on the unique indexes that already guard an
overlapping import, so a restore cannot undo a recategorisation made on the
phone and running it twice adds nothing.

Deferred foreign keys turn an orphan row in the backup into one clean rollback
at commit instead of a half-applied restore.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Translations

**Files:**
- Modify: `packages/i18n/src/en.ts`, `packages/i18n/src/es.ts`, `packages/i18n/src/de.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `backup` block. `Translations` is `Stringify<Resources>`, so a key missing from `es`/`de` is a compile error, not a blank label.

- [ ] **Step 1: Add the English block**

Add to `packages/i18n/src/en.ts`, as a sibling of `settings`:

```ts
  backup: {
    title: 'Backup',
    subtitle:
      'An encrypted copy of everything in FinAnt, in a file you keep. Your phone is the only place this data exists — a backup is the only way to survive losing it.',
    lastBackup: 'Last backup: {{date}}',
    never: 'You have never made a backup.',
    create: 'Create backup',
    creating: 'Preparing your backup…',
    codeTitle: 'Your recovery code',
    codeBody:
      'Write this down or save it in your password manager now. It is the only thing that opens the backup, FinAnt does not keep a copy, and without it the file is worthless.',
    codeCopied: 'Copied.',
    codeConfirm: 'I have saved this code',
    share: 'Save the file',
    restore: 'Restore from a backup',
    pickFile: 'Choose a backup file',
    enterCode: 'Recovery code',
    enterCodeHint: 'The code shown when the backup was made.',
    previewTitle: 'This backup',
    previewMade: 'Made {{date}} with FinAnt {{version}}',
    previewRows_one: '{{count}} row',
    previewRows_other: '{{count}} rows',
    previewBody:
      'Restoring adds what your phone is missing. Nothing already here is changed or removed, so it is safe to run twice.',
    confirmRestore: 'Restore',
    restoring: 'Restoring…',
    doneTitle: 'Restored',
    doneNothing: 'Everything in that backup was already here.',
    doneAdded_one: '{{count}} row added.',
    doneAdded_other: '{{count}} rows added.',
    errorWrongCode: 'That recovery code does not match this file.',
    errorNotABackup: 'That file is not a FinAnt backup.',
    errorTooNew: 'That backup was made by a newer version of FinAnt. Update the app and try again.',
    errorSchemaMismatch: 'That backup does not match this version of FinAnt. Nothing was changed.',
    errorSharingUnavailable: 'This device cannot share files, so the backup cannot be saved.',
    errorFailed: 'The backup could not be completed. Nothing was changed.',
  },
```

- [ ] **Step 2: Mirror into Spanish and German**

Same keys in `packages/i18n/src/es.ts` and `packages/i18n/src/de.ts`. Translate the meaning, not the words — in particular keep the bargain explicit in `codeBody`: the code is the only thing that opens the file and FinAnt keeps no copy.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean. A missing or misspelled key in `es`/`de` fails here — that is what the typing is for.

- [ ] **Step 4: Commit**

```bash
npx prettier --write packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git add packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git commit -m "feat(backup): English, Spanish and German strings

Every failure gets its own sentence. 'Backup failed' on the one feature whose
job is to work during a disaster tells the owner nothing they can act on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The backup screen

**Files:**
- Create: `apps/mobile/app/backup.tsx`
- Modify: `apps/mobile/app/(tabs)/settings.tsx`

**Interfaces:**
- Consumes: `createBackup`, `inspectBackup`, `mergeBackup`, `discardBackup`, `BackupError` (Tasks 5-7); `SETTING_LAST_BACKUP_AT`, `readSetting` (Task 4); the `backup` translation block (Task 8).
- Produces: the route `/backup`.

- [ ] **Step 1: Add the clipboard dependency**

The recovery code is 25 characters of high-entropy text that the owner must
transfer into a password manager without a typo. Retyping it is the one step
where this feature most plausibly fails in practice, so it gets a copy button.

```bash
cd apps/mobile && npx expo install expo-clipboard
```

- [ ] **Step 2: Write the create half of the screen**

Create `apps/mobile/app/backup.tsx`, following the idiom in `app/categories.tsx`
(a `Stack.Screen` title, `Card` sections, `Sheet` for modals):

```tsx
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { INTL_LOCALE } from '@finant/i18n';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/ui/Button';
import { Field } from '../src/components/ui/Field';
import { ListRow } from '../src/components/ui/ListRow';
import { Sheet } from '../src/components/ui/Sheet';
import { Touchable } from '../src/components/ui/Touchable';
import {
  BackupError,
  createBackup,
  discardBackup,
  inspectBackup,
  mergeBackup,
  type BackupPreview,
} from '../src/services/backup';
import { readSetting, SETTING_LAST_BACKUP_AT } from '../src/db/settings-repo';
import { currentLocale } from '../src/i18n';
import { radius, spacing, type, useTheme } from '../src/design';

export default function BackupScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const message = (thrown: unknown): string => {
    if (thrown instanceof BackupError) {
      switch (thrown.code) {
        case 'wrong-code':
          return t('backup.errorWrongCode');
        case 'not-a-backup':
          return t('backup.errorNotABackup');
        case 'too-new':
          return t('backup.errorTooNew');
        case 'schema-mismatch':
          return t('backup.errorSchemaMismatch');
        case 'sharing-unavailable':
          return t('backup.errorSharingUnavailable');
      }
    }
    // Never surface a raw message: it can carry a file path, and a path can
    // carry a name. See the Boundaries rule in CLAUDE.md.
    return t('backup.errorFailed');
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(INTL_LOCALE[currentLocale()], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await createBackup();
      setCode(result.code);
      setSaved(false);
      setCopied(false);
      setLastBackup(result.createdAt);
    } catch (thrown) {
      setError(message(thrown));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <Stack.Screen options={{ title: t('backup.title') }} />

      <Card title={t('backup.title')}>
        <Text style={[type.body, { color: theme.textMuted }]}>{t('backup.subtitle')}</Text>
        <Text style={[type.label, { color: theme.textMuted }]}>
          {lastBackup ? t('backup.lastBackup', { date: formatDate(lastBackup) }) : t('backup.never')}
        </Text>
        <Button
          label={busy ? t('backup.creating') : t('backup.create')}
          loading={busy}
          onPress={() => void create()}
        />
      </Card>

      {error ? <Text style={[type.body, { color: theme.expense }]}>{error}</Text> : null}

      {/* Dismissal is gated on `saved`, not just the Done button: Sheet wires
          onDismiss to the backdrop, the Android back button and the drag-down
          gesture too, and losing the code while a real backup file exists is
          the precise failure this screen is here to prevent. */}
      <Sheet
        visible={code !== null}
        onDismiss={() => {
          if (saved) setCode(null);
        }}
        title={t('backup.codeTitle')}
      >
        <Touchable
          onPress={() => {
            if (code) void Clipboard.setStringAsync(code).then(() => setCopied(true));
          }}
          accessibilityRole="button"
        >
          <View style={[styles.code, { backgroundColor: theme.accentSoft, borderRadius: radius.md }]}>
            <Text selectable style={[type.title, { color: theme.text, letterSpacing: 2 }]}>
              {code}
            </Text>
          </View>
        </Touchable>
        {copied ? (
          <Text style={[type.label, { color: theme.textMuted }]}>{t('backup.codeCopied')}</Text>
        ) : null}
        <Text style={[type.body, { color: theme.textMuted }]}>{t('backup.codeBody')}</Text>
        <Touchable onPress={() => setSaved((was) => !was)} accessibilityRole="checkbox">
          <Text style={[type.body, { color: saved ? theme.accent : theme.textMuted }]}>
            {saved ? '☑ ' : '☐ '}
            {t('backup.codeConfirm')}
          </Text>
        </Touchable>
        <Button label={t('common.done')} disabled={!saved} onPress={() => setCode(null)} />
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  code: { padding: spacing.md, alignItems: 'center' },
});
```

The share sheet is presented inside `createBackup()` before the code sheet
opens, so the file is already saved by the time the owner reads the code. The
"I have saved this code" checkbox gates dismissal rather than the share, because
a file saved without its code is the failure this screen exists to prevent.

Reuse `t('common.done')` if it exists; otherwise add `done: 'Done'` to the
`common` block in all three locale files.

- [ ] **Step 3: Write the restore half**

Add to the same screen, below the create card:

- a secondary `Button` opening
  `DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true })`,
  storing `picked.assets[0].uri` in state;
- a `Field` for the code with `autoCapitalize="characters"`, `autoCorrect={false}`,
  `autoComplete="off"`, label `t('backup.enterCode')`, hint `t('backup.enterCodeHint')`;
- a `Button` running `inspectBackup(uri, typed)` into a `BackupPreview` state,
  catching with the same `message()` helper;
- a preview `Sheet`: `t('backup.previewMade', { date: formatDate(preview.createdAt), version: preview.appVersion })`,
  one `ListRow` per table whose count is above zero (title = the table's own
  translated label if one exists, else the table name; subtitle =
  `t('backup.previewRows', { count })`), then `t('backup.previewBody')`, then
  `t('backup.confirmRestore')` calling `mergeBackup(preview, typed)` and a cancel
  that calls `discardBackup(preview)`;
- the result: sum the returned counts, then show `t('backup.doneAdded', { count })`
  or `t('backup.doneNothing')` when the sum is zero.

The `message()` helper above is the only place a failure becomes text:

```tsx
const message = (error: unknown): string => {
  if (error instanceof BackupError) {
    switch (error.code) {
      case 'wrong-code':
        return t('backup.errorWrongCode');
      case 'not-a-backup':
        return t('backup.errorNotABackup');
      case 'too-new':
        return t('backup.errorTooNew');
      case 'schema-mismatch':
        return t('backup.errorSchemaMismatch');
      case 'sharing-unavailable':
        return t('backup.errorSharingUnavailable');
    }
  }
  // A raw message could carry a file path, and a path can carry a name.
  return t('backup.errorFailed');
};
```

- [ ] **Step 4: Link it from Settings**

In `apps/mobile/app/(tabs)/settings.tsx`, inside the existing `<Card title={t('settings.data')}>`, **above** the erase button:

```tsx
        <ListRow
          title={t('backup.title')}
          subtitle={lastBackup ? t('backup.lastBackup', { date: lastBackup }) : t('backup.never')}
          onPress={() => router.push('/backup')}
          divider
        />
```

`lastBackup` comes from `readSetting(SETTING_LAST_BACKUP_AT)` in the existing `useFocusEffect`, formatted with `INTL_LOCALE`. `ListRow` and `router` are already imported in that file.

- [ ] **Step 5: Typecheck and build**

```bash
npm run typecheck
cd apps/mobile && npx expo export --platform ios
```

Expected: clean typecheck, bundle succeeds.

- [ ] **Step 6: Commit**

```bash
npx prettier --write apps/mobile/app/backup.tsx "apps/mobile/app/(tabs)/settings.tsx"
npx eslint --fix apps/mobile/app/backup.tsx "apps/mobile/app/(tabs)/settings.tsx"
git add apps/mobile/app/backup.tsx "apps/mobile/app/(tabs)/settings.tsx" apps/mobile/package.json package-lock.json
git commit -m "feat(backup): the backup and restore screen

Restore previews before it writes. Counting the rows first costs nothing —
the file is already open and decrypted by then — and it is the difference
between a confident restore and a leap.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Documentation

**Files:**
- Create: `docs/backup-format.md`
- Modify: `docs/security-model.md`
- Modify: `docs/distribution.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on. This task is not optional — the feature weakens a guarantee the security model states, and shipping that undocumented is the actual defect.

- [ ] **Step 1: Write `docs/backup-format.md`**

Cover: the file format and `backup_meta`; the recovery code, its alphabet and why it is generated rather than chosen; the `sqlcipher_export`/`user_version` gotcha; the merge rule and why `INSERT OR IGNORE` is the whole of it; what a merge cannot represent (hard deletes of accounts, categories, budgets, exclusion rules — movements are soft-deleted and survive); and the excluded table with its reason.

- [ ] **Step 2: Amend `docs/security-model.md`**

In **"What is stored, and where"**, add a row: a backup file, wherever the owner put it, encrypted by SQLCipher with a key derived from the recovery code.

Then state plainly that `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `allowBackup: false` and the iCloud exclusion do **not** extend to a backup file. It is a deliberate, owner-created copy that leaves the device, and the recovery code is the only thing protecting it.

In **"Not defended against"**, add: a recovery code stored beside the file it unlocks. The code and the backup in the same cloud folder is one compromise, not two.

- [ ] **Step 3: Amend `docs/distribution.md`**

In the **iOS** section, after the 7-day free-Apple-ID bullet: deleting the app destroys the database, and a backup is the answer. Note the same applies to moving from a free personal team to a paid one — the Team ID changes, the keychain entry becomes unreachable, and the database is unreadable even though the file is intact. Export before that switch.

- [ ] **Step 4: Commit**

```bash
npx prettier --write docs/backup-format.md docs/security-model.md docs/distribution.md
git add docs/backup-format.md docs/security-model.md docs/distribution.md
git commit -m "docs(backup): file format, and the guarantee this trades away

A backup file is a readable copy that leaves the device. THIS_DEVICE_ONLY,
allowBackup:false and the iCloud exclusion do not reach it, and the recovery
code is the only thing that does. Saying so is part of the feature.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Manual verification

The attach/export/merge path needs real SQLCipher and cannot run under vitest. Nothing before this proves the feature works.

**Snapshot the simulator database first — its data is the only copy.**

- [ ] **Step 1: Snapshot**

```bash
xcrun simctl get_app_container booted com.finant.app data
```

Copy the `Documents`/`Library` SQLite files out of that container before going further.

- [ ] **Step 2: Export**

Run the app on a simulator holding real imported data. Settings → Backup → Create backup. Save the code. Save the file somewhere reachable.

- [ ] **Step 3: Restore into a fresh install**

Erase the app's data (or use a second simulator), then Restore. Confirm the preview counts match the source, and that after the merge the dashboard, portfolio, budgets, categories and rules all look as they did.

- [ ] **Step 4: Restore the same file again**

Expected: `t('backup.doneNothing')` — zero rows added. This is the cheapest proof that "device wins" holds and that restore is idempotent.

- [ ] **Step 5: Wrong code, and a file that is not a backup**

Expected: *That recovery code does not match this file* and *That file is not a FinAnt backup* respectively. Neither must be reported as corruption, and neither must leave a working copy behind in the cache.

- [ ] **Step 6: Record the result**

```bash
git commit --allow-empty -m "test(backup): verified export and restore on the simulator

Export, restore into a fresh install, restore again (zero rows added), wrong
code, and a non-backup file. The idempotent second restore is the evidence
that INSERT OR IGNORE is doing what the design claims.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `npm test` and `npm run typecheck` pass.
- A backup exported on one simulator restores onto another, and a second restore of the same file adds nothing.
- A wrong code and a non-backup file each produce their own named message.
- `docs/security-model.md` states that a backup file leaves the device and what protects it.
