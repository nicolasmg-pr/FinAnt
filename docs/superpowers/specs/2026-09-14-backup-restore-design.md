# Backup and restore — design

Status: approved, not yet implemented
Branch: `backup-restore`

## Why

FinAnt has no way to get data out. The database is the only copy: SQLCipher-encrypted,
keyed from the device keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, deliberately
excluded from iCloud and Google backup. A lost, wiped or stolen phone loses every
movement the owner ever imported, permanently.

On iOS the exposure is sharper. Sideloading with a free Apple ID expires the signature
every 7 days, and the only recovery gesture most people reach for — delete and
reinstall — destroys the database. Changing signing team (free to paid Apple Developer
Program) changes the Team ID, which makes the keychain entry unreachable and the
database unreadable even though the file is still on disk.

This feature creates an encrypted, portable copy that the owner controls.

## What this deliberately trades away

The current security model states that no readable copy of the data exists off the
device. A backup file breaks that on purpose. The file is protected by its recovery
code and by nothing else: `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, `allowBackup: false` and
the iCloud exclusion do not extend to it. `docs/security-model.md` changes as part of
this work — see "Documentation" below. A feature that weakens a documented guarantee
without amending the document is not finished.

## Decisions

Settled during brainstorming; recorded here so implementation does not relitigate them.

| Question | Decision |
|---|---|
| What must a backup survive? | A lost, wiped or stolen phone. The file must restore onto a **different** device, so it cannot depend on this device's keychain. |
| Restore into a database that already has data? | **Merge.** Restoring into an empty database is the disaster case and is just a merge where every row is new. |
| Row present on both sides, contents differ? | **Device wins.** The backup fills gaps only. Restore can never undo work done on the phone, and is therefore idempotent. |
| How is the file unlocked? | An **app-generated recovery code**. No owner-chosen passphrase: the file may live in cloud storage, where a human-chosen secret is the weak link. |
| What is left out of the backup? | `notification_captures` only. Everything else is included, cached quotes and monthly price history included. |

### Consequences the owner should understand

- A merge cannot represent a hard delete. `transactions` are soft-deleted
  (`deleted_at`, migration 4), so a deleted movement stays deleted across a restore.
  Accounts, categories, budgets and exclusion rules are hard-deleted; restoring a
  backup taken before such a deletion brings the row back.
- No table carries `updated_at`, so "newest wins" was never available. "Device wins"
  is a policy, not a timestamp comparison.
- Losing the recovery code makes the file scrap. Same bargain as the Android release
  keystore in `docs/distribution.md`.

## File format

A SQLCipher database file, `finant-backup-YYYY-MM-DD.finantbackup`, keyed by the
recovery code in **passphrase form** — `PRAGMA key = 'CODE'`, not the raw-hex
`PRAGMA key = "x'...'"` form the live database uses. Passphrase form makes SQLCipher
run its own KDF: PBKDF2-HMAC-SHA512, 256k iterations, with a random per-file salt in
the header. That is the property the live database does not need (its key is already
256 random bits) and a file in iCloud Drive does.

It carries one table the live schema does not have:

```sql
CREATE TABLE backup_meta (
  format         TEXT    NOT NULL,  -- 'finant-backup-1'
  app_version    TEXT    NOT NULL,  -- expo.version at export time
  schema_version INTEGER NOT NULL,  -- LATEST_VERSION at export time
  created_at     TEXT    NOT NULL   -- ISO 8601
);
```

`backup_meta` is the only way to recognise a valid backup. A SQLCipher file is
indistinguishable from random bytes until it opens, so identification happens after
decryption and never before. There is no magic-number sniff to write.

### Gotcha: `sqlcipher_export()` does not copy `user_version`

It copies schema and rows only. The target's `user_version` must be set explicitly or
every exported file claims schema version 0, and restore would then re-run all twelve
migrations over populated tables. Set it in the same step as writing `backup_meta`.

## Recovery code

125 bits from `Crypto.getRandomBytes(16)` (the low 3 bits of the last byte discarded),
rendered in Crockford base32 — alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, which
omits `I`, `L`, `O` and `U` so a handwritten code cannot be transcribed wrong. Five
groups of five, hyphen-separated: `K7F2M-9XQ4B-...`.

Validation, applied to every code before it reaches a statement:

```
/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/
```

**`PRAGMA` cannot be parameterised.** The code is string-interpolated into SQL, the
same shape as the existing `PRAGMA key = "x'${key}'"` in `src/db/database.ts`. A typed
code that fails the regex is rejected at the input and never escaped, never quoted,
never passed through. Input is uppercased and hyphens are normalised before matching,
so the owner may paste lowercase or ungrouped text; anything still not matching after
normalisation is refused.

## Export

1. Generate the code. Show it once, in large monospace type, with a copy button and an
   explicit "I have saved this code" confirmation that gates step 3.
2. On the live connection:
   ```sql
   ATTACH DATABASE '<cache>/finant-backup-YYYY-MM-DD.finantbackup' AS backup KEY '<code>';
   SELECT sqlcipher_export('backup');
   DELETE FROM backup.notification_captures;
   PRAGMA backup.user_version = <LATEST_VERSION>;
   -- CREATE TABLE backup.backup_meta ...; INSERT ...;
   DETACH DATABASE backup;
   ```
3. Hand the file to the system share sheet (`expo-sharing`): Files, iCloud Drive,
   AirDrop. Delete the cache copy once the sheet dismisses, in a `finally`.
4. Write `lastBackupAt` to `settings`.

A cancelled share sheet is not an error. The file is still deleted.

## Restore

1. `DocumentPicker.getDocumentAsync` with type `*/*` — a custom extension has no
   registered UTI and one is not being registered for this. Copy the pick into cache.
2. Open the copy as its own `SQLiteDatabase` connection, keyed with the typed code.
3. Read `backup_meta`.
   - `schema_version > LATEST_VERSION` — refuse, the file was written by a newer FinAnt.
   - `schema_version < LATEST_VERSION` — run the existing `MIGRATIONS` on this
     connection up to `LATEST_VERSION`. The migration list is reused verbatim; there is
     no second copy of it.
4. Count rows per table and show the **preview**: the backup's date, the app version
   that wrote it, and what it contains. Nothing has been written to the live database
   at this point. The owner confirms here.
5. Close the temp connection. On the live connection:
   ```sql
   ATTACH DATABASE '<temp>' AS backup KEY '<code>';
   ```
   Assert that `PRAGMA main.table_info(<t>)` and `PRAGMA backup.table_info(<t>)` agree
   for every table in the manifest. Step 3 makes the schemas identical by construction;
   this assertion is what makes that enforced rather than assumed, and it is the
   precondition that lets the merge use `SELECT *`.
6. In one transaction, with `PRAGMA defer_foreign_keys = ON`, for each table in manifest
   order:
   ```sql
   INSERT OR IGNORE INTO main.<table> SELECT * FROM backup.<table>;
   ```
   Collect `changes()` per table for the result summary.
7. `DETACH`, delete the temp copy in a `finally`, show the summary.

`defer_foreign_keys` moves foreign-key enforcement to commit, so an orphan row in the
backup produces one clean rollback instead of aborting halfway through the manifest.

`INSERT OR IGNORE` **is** the device-wins rule. It skips on primary key and on the
existing unique indexes — `idx_tx_external (account_id, external_id)` and
`idx_tx_hash (account_id, import_hash)` — so a movement already present under a
different id is deduped by the same indexes that already guard imports. The `settings`
table merges the same way, so the phone's own locale, currency and app-lock setting
survive a restore.

## Table manifest

Foreign-key parents before children:

```
institutions, accounts, categories, import_profiles, rules, budgets,
exclusion_rules, transactions, assets, investment_legs, quotes,
price_history, notification_sources, notification_routes, settings
```

Excluded: `notification_captures` — it holds the raw title and body of bank
notifications, which is real movement text, and it is a transient inbox. Anything the
owner accepted from it is already a `transactions` row.

## Code layout

| File | Contents |
|---|---|
| `packages/core/src/backup.ts` | Pure and React-free: `BACKUP_TABLES` (ordered), `EXCLUDED_TABLES`, `BACKUP_FORMAT`, recovery-code generation, normalisation and validation, and the statement builders that emit attach/export/merge SQL as strings. |
| `apps/mobile/src/services/backup.ts` | `createBackup()` and `restoreBackup()`. Owns expo-sqlite, expo-file-system and expo-sharing. Takes every rule and every statement from `@finant/core`. |
| `apps/mobile/app/backup.tsx` | The screen. Both flows. |

`packages/core` must stay free of React and Expo imports, so random bytes are passed
into the code generator rather than read from `expo-crypto` inside it.

New dependency: `expo-sharing` (~57.x), in `apps/mobile` only.

**No migration.** `backup_meta` exists only inside exported files, and `lastBackupAt`
is a `settings` row. The append-only migration list is untouched.

New setting key in `src/db/settings-keys.ts`: `SETTING_LAST_BACKUP_AT = 'lastBackupAt'`.

## UI

Settings → Data gains one row, *Backup*, pushing `/backup`.

**Create.** A card showing the last backup date, or *Never*. "Create backup" runs the
export flow above. The recovery-code sheet states the bargain in plain words: this code
is the only thing that opens the file, FinAnt does not keep a copy, and losing it makes
the backup worthless.

**Restore.** Pick file → enter code → preview → confirm → summary. The preview exists
because a restore that writes before showing what it is about to write is a leap, and
this is the one feature whose whole purpose is to be trustworthy under stress.

## Errors

Each failure is named. "Restore failed" on a disaster-recovery feature is worthless.

| Condition | Message |
|---|---|
| Code fails the regex | Rejected at the input, before any file work |
| SQLCipher reports `file is not a database` | *That recovery code doesn't match this file* — a wrong key, **never** presented as corruption |
| Opens, no `backup_meta` | Not a FinAnt backup |
| `schema_version > LATEST_VERSION` | Made by a newer version of FinAnt |
| `table_info` mismatch | Refuse the merge; nothing is written |
| Anything during the merge | One rollback, database untouched, temp file deleted |

Per the Boundaries rule in `CLAUDE.md`, no message and no log line carries a row, a
narrative, an amount or an IBAN. Table names and counts only.

## Internationalisation

A new `backup` block in `packages/i18n/src/en.ts`, mirrored in `es.ts` and `de.ts`.
`Translations` is typed against `Resources`, so a missing key is a compile error.

## Testing

`packages/core/tests/backup.test.ts`

- Recovery-code generation: correct length, grouping, and alphabet; never emits
  `I`, `L`, `O` or `U`.
- Validation: accepts a good code in lowercase and ungrouped; rejects wrong grouping,
  wrong length, ambiguous characters, and anything carrying a quote or a semicolon.
- Manifest ordering: every foreign-key parent precedes its children.
- Statement builders: expected SQL for attach, export and merge.

`apps/mobile/src/services/tests/backup-coverage.test.ts`

- The guard. Extracts every `CREATE TABLE` name from `MIGRATIONS` in
  `src/db/schema.ts` and asserts each appears in `BACKUP_TABLES` or `EXCLUDED_TABLES`.
  A future migration that adds a table fails the suite until someone decides which it
  is. This is the point: a table silently left out of the backup is invisible until the
  day it matters.

`schema.ts` is plain SQL strings with no Expo imports, and
`apps/mobile/src/services/tests/**` is already in `vitest.config.ts`, so this runs
under `npm test` with no new configuration.

### Manual verification

The attach/export/merge path needs real SQLCipher and cannot run under vitest. Verify
by hand:

1. Export on a simulator holding data.
2. Restore into a second, fresh simulator. Confirm counts match and the portfolio,
   budgets and rules survive.
3. Restore the same file a second time. Confirm it adds nothing — idempotence is what
   "device wins" buys, and it is the cheapest evidence that the merge is correct.
4. Restore with a wrong code, and with a file that is not a backup. Confirm both are
   named correctly.

Snapshot the simulator database before driving the app: its data is the only copy.

## Documentation

- **New** `docs/backup-format.md` — the file format, the recovery code, and the merge
  rules, following the repo's doc-per-subsystem habit.
- **`docs/security-model.md`** — a backup file is a deliberate, owner-created copy that
  leaves the device, protected by the recovery code alone. Add it to "What is stored,
  and where", and add to "Not defended against": a recovery code stored beside the file
  it unlocks.
- **`docs/distribution.md`** — the iOS section points at backup as the answer to the
  delete-the-app hazard and to a Team ID change.

## Out of scope

- Dated snapshot history, a restore picker, or rolling back a bad import.
- Automatic or scheduled backups, and any reminder to take one.
- Plain CSV or spreadsheet export for reading elsewhere. Different feature, different
  threat model.
- Owner-chosen passphrases.
- Registering a UTI or file association for `.finantbackup`.

## Verify first

`ATTACH DATABASE ... KEY` and `sqlcipher_export()` are core SQLCipher, but their
availability through expo-sqlite's build is **unverified**. The first implementation
task is a throwaway probe on a simulator that attaches a keyed file, exports into it,
detaches, and reopens it with the same code.

If the probe fails, stop and revisit the design. The fallback is the approach rejected
during brainstorming: an encrypted JSONL document using `@noble/hashes` for Argon2id
and a new `@noble/ciphers` dependency for XChaCha20-Poly1305, with a hand-written
serializer per table. Everything above except the file format survives that change.

### Probe result (2026-09-14)

Ran on an iOS 26.5 simulator against a populated database. All four assumptions hold:

```
dedicated connection keyed ok
ATTACH ok
sqlcipher_export ok
attached user_version ok
DETACH ok
closed dedicated connection ok
reopened user_version=12
tables=16
wrong code rejected ok: Error code 26: file is not a database
PASS
```

Three things the probe settled that the design above did not know:

1. **Export and merge must open their own connection**, with
   `SQLite.openDatabaseAsync('finant.db', { useNewConnection: true })` and
   `PRAGMA key = "x'<key>'"` on it. Without `useNewConnection`, expo-sqlite returns the
   handle the app is already using, the running UI holds reads against it, and `DETACH`
   fails with `database probe is locked`. This is also the better shape on its own
   terms: an export cannot observe a half-written change on another connection.
2. **A stale backup file must be deleted before `ATTACH`.** `sqlcipher_export()` into a
   file that already holds the schema fails with `table accounts already exists`.
3. **A wrong recovery code surfaces on the first query, not on `PRAGMA key`** — as
   `SQLiteErrorException: Error code 26: file is not a database`. `PRAGMA key` itself
   succeeds regardless. This confirms the restore flow's decision to detect a wrong key
   at the first read of `backup_meta` and report it as a wrong code rather than as
   corruption.

`tables=16` is 15 manifest tables plus `notification_captures`, which cross-checks the
manifest against a real database.
