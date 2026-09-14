# Backup format

A backup is a second, portable copy of the encrypted database the owner can carry to
another phone. This document is the reference for the file itself: what is inside it,
how the recovery code that opens it is generated and checked, and exactly what
restoring one does and does not do to the database it merges into. The design
reasoning lives in `docs/superpowers/specs/2026-09-14-backup-restore-design.md`; the
security consequences of a file that leaves the device live in `docs/security-model.md`.
The code is `packages/core/src/backup.ts` — format, recovery code, and the SQL
builders, free of any React or Expo import — and `apps/mobile/src/services/backup.ts`,
which owns expo-sqlite, expo-file-system and expo-sharing.

## The file

A backup is an ordinary SQLCipher database, produced by SQLCipher's own
`sqlcipher_export()` and named `finant-backup-YYYY-MM-DD.finantbackup`. It is keyed
with the recovery code in **passphrase form** — `PRAGMA key = 'CODE'` — rather than
the raw-hex form the live database uses (`PRAGMA key = "x'<hex>'"`, see
`docs/security-model.md`). Passphrase form makes SQLCipher run its own key
derivation — PBKDF2-HMAC-SHA512 at 256,000 iterations, with a random salt written
into the file's own header — which is exactly the property the live database does
not need (its key is already 256 random bits pulled from the keychain) and a file
that might sit in iCloud Drive for years does.

It carries one table the live schema never has:

```sql
CREATE TABLE backup_meta (
  format         TEXT    NOT NULL,  -- 'finant-backup-1'
  app_version    TEXT    NOT NULL,  -- expo.version at export time
  schema_version INTEGER NOT NULL,  -- LATEST_VERSION at export time
  created_at     TEXT    NOT NULL   -- ISO 8601
);
```

`backup_meta` is the only way to tell a FinAnt backup from any other file. A
SQLCipher database is indistinguishable from random bytes until something opens it
with the right key, so there is no header to sniff and no extension worth trusting
— identification happens after decryption, never before. A file that opens with the
typed code but has no `backup_meta` table is treated as not a FinAnt backup at all,
not as one that merely failed to read.

## The `sqlcipher_export()` / `user_version` gotcha

`sqlcipher_export()` clones schema and rows into the attached file — nothing else.
It does not carry over `user_version`, the pragma FinAnt's own migration runner
reads to know which migrations already ran. Left alone, every exported file would
claim schema version 0, and restoring it would replay all twelve migrations over a
database that already holds the rows those migrations expect to be creating tables
for. The export sets `PRAGMA backup.user_version` explicitly, in the same step that
writes `backup_meta`, right after the export call:

```sql
SELECT sqlcipher_export('backup');
DELETE FROM backup.notification_captures;
PRAGMA backup.user_version = <LATEST_VERSION>;
-- CREATE TABLE backup.backup_meta ...; INSERT ...;
```

Two more traps the same code path routes around, both found by hand against a real
simulator rather than guessed:

- **A stale file must be deleted before `ATTACH`.** `sqlcipher_export()` into a file
  that already holds the schema fails outright with `table accounts already exists`
  — it is an export into an empty attached database, not an upsert into an existing
  one. `createBackup()` deletes any leftover file from an abandoned run before
  attaching.
- **Export runs on its own connection**, opened with `useNewConnection: true` and
  keyed separately, never on the connection the rest of the app is reading through.
  Without that, expo-sqlite hands back the connection the UI already holds open
  reads against, and `DETACH` fails with `database is locked`. It is also the better
  shape independent of that bug: an export taken through a second connection cannot
  observe a change that is mid-write on the first one.

## Recovery code

125 bits of randomness — `Crypto.getRandomBytes(16)`, three of the 128 bits dropped
so the length comes out even — rendered in Crockford base32:
`0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Four letters are missing from that alphabet on
purpose. `I`, `L` and `O` are omitted because they are what a handwritten code gets
transcribed wrong — mistaken for `1` or `0` — and `U` is omitted so a run of random
characters can never spell something unfortunate. The result is five groups of
five, hyphen-separated: `K7F2M-9XQ4B-...`.

**The code is generated, never chosen.** An owner-picked passphrase is the usual
design for an encrypted export, and it was rejected here on purpose: the file may
end up in cloud storage, and a human-chosen secret is the weak link in that
picture, not the cipher around it. A generated code carries no memorable structure
to guess and no reuse from another account, at the cost of being a string the owner
has to keep rather than remember — the recovery-code screen states that bargain
before the file is created, and FinAnt keeps no copy of the code once it has been
shown once.

Before a typed or pasted code reaches any SQL, it is checked against:

```
/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/
```

`PRAGMA key` and `ATTACH ... KEY` cannot be parameterised — the code is
string-interpolated into the statement, the same shape as the raw-hex `PRAGMA key`
already in `src/db/database.ts`. That regex, not an escaping routine, is what
stands between typed input and a SQL statement: a code that fails it is rejected
before any file work happens, and is never quoted or passed through regardless. The
input is normalised first — uppercased, hyphens and whitespace stripped, `I`/`L`
read as `1` and `O` as `0` — so a code pasted in lowercase or without its groups
still matches. Normalisation only maps characters onto the alphabet; it never
deletes an invalid one, so it can turn a correctly-transcribed code into its
canonical form, but it can never turn a wrong code into one that passes.

## The merge rule

Restoring is always a merge, even into a brand-new database — restoring onto an
empty phone is simply the case where every row in the backup happens to be new,
not a separate code path. The policy is **device wins**: where a row exists on
both sides and the two disagree, the phone's own row stands, and the backup can
only fill in what the phone doesn't already have. That is what makes restoring
idempotent — running it a second time adds nothing the first run didn't — which
matters for a feature whose whole purpose is to be trusted under stress.

The entirety of that policy is one statement, run once per table in the manifest
below:

```sql
INSERT OR IGNORE INTO main.<table> SELECT * FROM backup.<table>;
```

There is no comparison of contents anywhere, and there could not be: no table in
the schema carries an `updated_at`, so "newest wins" was never an available design
and was never attempted. `INSERT OR IGNORE` skips a row whose primary key is
already taken on the phone, and it skips a movement caught by the same unique
indexes that already guard against importing the same statement row twice —
`idx_tx_external (account_id, external_id)` and `idx_tx_hash (account_id,
import_hash)`. A restore therefore reuses exactly the dedupe machinery an import
already needed; it does not add a second one.

The merge runs in one transaction with `PRAGMA defer_foreign_keys = ON`, table by
table in manifest order — foreign-key parents before children. Deferring
enforcement to commit, rather than turning it off, means a single orphaned row
anywhere in the backup rolls back the whole restore cleanly instead of leaving the
database half-merged. That guarantee assumes both sides of every table have the
same columns, which restore does not merely assume but asserts: `PRAGMA table_info`
is compared for `main` and `backup` on every manifest table before the merge
starts, which is what makes `SELECT *` — a positional copy — safe to use here at
all.

## Table manifest

```
institutions, accounts, categories, import_profiles, rules, budgets,
exclusion_rules, transactions, assets, investment_legs, quotes,
price_history, notification_sources, notification_routes, settings
```

`settings` merges the same way as every other table, which is why the phone's own
locale, currency and app-lock choice survive a restore instead of being
overwritten by whatever the backup's phone had set.

## What a merge cannot represent

`INSERT OR IGNORE` has no notion of "this row used to exist and was deliberately
removed" — a row absent from the live database looks exactly like a row that was
never created, and the merge cannot tell the two apart. For `accounts`,
`categories`, `budgets` and `exclusion_rules`, which are hard-deleted, this means a
hard delete does not survive a restore: restoring a backup taken before the owner
removed a mistaken account or category brings that row back, and it has to be
deleted again by hand.

`transactions` is the one table this does not apply to, and only because it is
deliberately soft-deleted: a removed movement gets `deleted_at` set (migration 4)
rather than being removed from the table. The row is still there to be copied by
`INSERT OR IGNORE`, `deleted_at` included, so a deleted movement is still deleted
after a restore. Soft deletion was not added for this feature, but it is the reason
movements behave differently from every other deletable table under one.

## Excluded from the backup

One table, `notification_captures`, and nothing else. It holds the raw title and
body text of a bank's own push notifications — the single most sensitive piece of
free text anywhere in the database, since it is the bank's own wording about a real
movement, not FinAnt's. It is also a transient inbox by design: anything the owner
has already accepted out of it exists as an ordinary `transactions` row, so leaving
it out of the backup costs only an in-flight, not-yet-decided capture, in exchange
for keeping that raw text out of a file whose entire purpose is to leave the
device.

`apps/mobile/src/services/tests/backup-coverage.test.ts` is what keeps this section
honest: it reads every `CREATE TABLE` out of the live migrations and asserts each
one is named in either the manifest above or here. A migration that adds a table
without anyone deciding which list it belongs on fails that test, rather than
shipping a table that is silently absent from every backup anyone takes until the
day it matters.
