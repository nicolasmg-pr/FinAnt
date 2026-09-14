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
`sqlcipher_export()` and named `finant-backup-YYYY-MM-DD.finantbackup`, dated in
the owner's own time zone rather than UTC — a backup taken at 00:30 in Madrid
belongs to the day the phone's clock showed, not to the one that had just ended
in London. It is keyed
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
— identification happens after decryption, never before. Telling a wrong recovery
code apart from a file that opens but isn't a FinAnt backup at all is restore's
job, not a property of the file format itself — see "Restore" below for how
`inspectBackup` does it.

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

## What "Last backup" actually records

`createBackup()` writes `lastBackupAt` once `Sharing.shareAsync()` resolves — and on
iOS that call is backed by `UIActivityViewController`, whose completion handler fires
when the sheet closes, not when the file has gone anywhere. An owner who picks "Save
to Files" and an owner who swipes the sheet away without picking anything produce the
same resolved promise. There is no other callback to reach for: `UIActivityViewController`
does not report which activity ran or whether it succeeded, only that presentation is
over, and that is true regardless of what FinAnt does with the result.

So the date on the backup screen is not proof that a backup file exists anywhere the
owner can find it again — it is a record of the last time they got as far as opening
the share sheet. Read plainly, "Last backup: today" can be true of an owner who has no
backup at all, because they dismissed the sheet the moment it appeared. That is a
property of the platform API, not a defect this feature could close by trying harder:
treat the date as a reminder of when the owner last attempted a backup, never as
confirmation that one is sitting somewhere safe.

## Recovery code

125 bits of randomness — `Crypto.getRandomBytes(16)` — rendered in Crockford
base32: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. Sixteen bytes carry 128 bits, and
twenty-five base32 characters hold 125 of them; the remaining three are dropped
rather than padded into a twenty-sixth character, because a code whose last
character could only ever take four of thirty-two possible values invites the
reader to wonder why. Four letters are missing from that alphabet on purpose. `I`, `L` and `O` are omitted because they are what a handwritten code gets
transcribed wrong — mistaken for `1` or `0` — and `U` is omitted so a run of random
characters can never spell something unfortunate. The result is five groups of
five, hyphen-separated: `K7F2M-9XQ4B-...`.

**The code exists before the file does.** `beginBackup()` mints the code and
checks the device can share at all; nothing is written anywhere. The screen shows
the code, the owner ticks "I have saved this code", and only that press calls
`createBackup(code)`, which creates the file and hands it to the share sheet.
The order is the whole point: with the share first and the code shown afterwards,
anything that threw in between — the `lastBackupAt` write, a share-sheet
rejection after the owner had already chosen "Save to Files", the process being
killed — left a real backup in the owner's cloud storage whose only key had never
been displayed, and a backup nobody can open is worse than no backup, because it
looks like one. The confirmation gating the share is what the design called for
from the start.

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

Almost the entirety of that policy is one statement, run once per table in the
manifest below:

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

`mergeTableSql()` builds that exact statement, and `mergeBackup()` in
`apps/mobile/src/services/backup.ts` runs it once per table, inside the
transaction described below — which is also where the foreign-key handling this
one statement depends on lives.

### The one thing the device does not win: a row it seeded to itself

"Device wins" is about the owner's work. A row the app wrote to _itself_ seconds
earlier is not the owner's work, and treating it as authoritative is a misreading
of the rule rather than an application of it.

This is not a corner case; it is the disaster the feature exists for.
`database.ts`'s `open()` runs `syncBuiltInCategories()` and `syncDefaultRules()`
on every launch, so a fresh install holds every shipped category and every
shipped rule before a restore can start. `INSERT OR IGNORE` alone then skipped
all of them, and an owner who had renamed "Groceries", recoloured it, archived a
category and disabled two rules got their movements back under the shipped names
and colours, with the archived category visible again and every rule edit gone —
permanently, because `syncBuiltInCategories()` only ever writes shipped values
back.

So where the live row is still provably in its seeded state, the backup wins;
where the owner has touched it, the device still does. Both statements are built
in `packages/core/src/backup.ts` and run inside the same transaction as the
merge, after the inserts:

- **`categories`** — `reseedPristineCategoriesSql()` overwrites a live row from
  the backup where `built_in = 1 AND customised = 0 AND archived = 0`.
  `customised` is the flag `editCategory()` sets and `syncBuiltInCategories()`
  already reads for exactly this question. `built_in` keeps a category the owner
  created out of it. `archived` is there because archiving is the one edit that
  leaves `customised` at 0 — `archiveCategory()` writes nothing else — so a
  hidden category would otherwise look pristine and be unhidden by an older
  backup. Naming it also settles `archived` in the other direction on purpose: a
  row that _is_ pristine takes the backup's `archived` along with everything
  else, which is what brings back a category the owner had archived on the phone
  they lost.
- **`rules`** — there is no `customised` column here, so "untouched" is
  established by comparison instead. `pristineShippedRuleIds()` calls a rule
  seeded-and-untouched only when its live row still equals this release's
  `DEFAULT_RULES` entry in category, priority, `enabled`, `learned` and the exact
  `match_json` string the seeder wrote. A rule the owner disabled, re-pointed,
  reprioritised or wrote themselves fails that comparison and keeps the phone's
  version. `created_at` is excluded: a seeded row carries the moment this phone
  first launched, which differs from the backup's for every rule and says nothing
  about whether anything was edited. The comparison errs the safe way — a match
  string that differs only in key order reads as edited, and an edited rule is
  one the device keeps.
- **`rules`, deleted ones** — a shipped rule the owner deleted leaves a tombstone
  in the `retiredShippedRules` setting, which only arrives _with_ the restore,
  by which time the launch-time install has already put the rule back. The merge
  reads that list straight out of the attached file and deletes the rules it
  names, but only those still in their seeded state. A rule the owner has since
  edited is theirs, whatever an older tombstone says.

An `UPDATE` from the attached file, never a `DELETE` and re-`INSERT`: deleting a
category would take the owner's own rows with it — `transactions.category_id` is
`ON DELETE SET NULL`, `rules` and `budgets` cascade — and no restore may ever
cost a categorisation. The column list comes from the live `PRAGMA table_info`
that `assertColumnsMatch` has just proved identical to the backup's, so a column
added by a future migration is carried across without anyone editing a list.

Restoring twice is still a no-op the second time: the first run has already made
the live row equal to the backup's, so the same `UPDATE` writes the same values.

## Restore

Restoring happens in two steps the owner can see the seam between:
`inspectBackup(uri, code)` builds a preview with nothing written anywhere, and
`mergeBackup(preview, code)` — called only once the owner confirms that preview —
does the writing. `discardBackup(preview)` is the third: it deletes the working
copy `inspectBackup` created, and it runs whether the owner backs out after
seeing the preview or the merge finishes.

### The preview writes nothing to the live database

`inspectBackup` copies the picked file into a working copy in cache and opens
_that_ on its own connection — the live database is never opened by this
function at all. Migrating the working copy forward (below) does write to that
disposable copy, but nothing about the live database changes until
`mergeBackup` runs afterwards, on the owner's explicit confirmation. That
ordering is the point: a restore that wrote before showing what it was about to
write would be a leap, and this is the one feature whose entire job is to be
trustworthy under stress.

### Telling a wrong code from a file that is not a backup

A code that fails the recovery-code pattern is rejected before it reaches
SQLCipher at all, and is reported the same way a code that reaches SQLCipher and
fails to decrypt is: from the owner's side, both mean "you typed it wrong."

Past that, SQLCipher cannot tell the two failure modes apart at the byte level.
`PRAGMA key` itself never fails, wrong code or right one — it accepts anything
unconditionally, and the wrongness only shows up on the first real read
afterwards. `inspectBackup`'s first read is the `SELECT` against `backup_meta`,
so that is where both a wrong code and a right code on a non-backup file surface
identically, as one thrown error. Telling them apart costs a second, cheaper
probe on the same connection — `SELECT count(*) FROM sqlite_master` — run only
when the first query fails. If the probe also fails, nothing on the connection is
readable — which happens with a wrong key, but just as well with a file that is
corrupt, truncated, or was never fully downloaded, and the two are
indistinguishable from here. That is reported as _wrong code_, but the message
itself names both possibilities, since there is no way to tell which one
actually happened. If the probe succeeds, the connection is readable and the key was
therefore right; the file just isn't a FinAnt backup, so that is reported as
_not a FinAnt backup_, never as corruption. A `backup_meta` row that reads back
fine but names a `format` other than `finant-backup-1` — or no format at all —
gets that same _not a backup_ answer, since the table existing is not the same
claim as the file being one of these.

### Migrating forward, refusing to go back

Once `backup_meta` reads back clean, its `schema_version` decides what happens
next. Newer than this build's `LATEST_VERSION` is refused outright — there is no
migration a build could run backwards, so that is reported as made by a newer
FinAnt. Older is brought forward by running the same `MIGRATIONS` array from
`src/db/schema.ts` against the working copy's own connection, one migration at a
time, each in its own transaction, exactly as it runs against the live database
on first launch after an update — there is no second migration list for restore
to drift out of sync with.

### `assertColumnsMatch`: the precondition that makes `SELECT *` safe

`INSERT OR IGNORE ... SELECT *` copies column 1 into column 1 and column 2 into
column 2; it has no idea one is called `amount` and the other `id`. That is only
safe once both sides agree on column order and count, and `assertColumnsMatch` is
what turns "the backup was just migrated to this schema, so it should agree"
from an assumption into a checked fact: for every manifest table, it reads
`PRAGMA main.table_info` and `PRAGMA backup.table_info`, joins each side's
ordered column names into one string, and refuses the whole restore — named
_schema mismatch_ — the moment the two strings differ. It also refuses when both
strings come back **empty**: two empty strings are equal, so without that
explicit check a table missing on both sides — a typo in the manifest, or an
attach that silently didn't happen — would pass the "they match" test by
trivially agreeing on nothing.

### One transaction, and why the connection needs two pragmas, not one

The merge runs table by table, in manifest order, inside one transaction, and
`mergeTableSql`'s `INSERT OR IGNORE` is the only statement any table gets. If a
single row anywhere in the manifest fails — an orphaned foreign key is the
realistic case — the whole transaction rolls back, every table included, not
only the one that failed: nothing about a restore applies partially. One bad row
fails the entire restore, on purpose, rather than leaving some tables merged and
others not.

That guarantee depends on foreign-key enforcement actually running, which took
two pragmas rather than the one the design called for. Foreign keys default
**off** on any new SQLite connection, and `apps/mobile/src/db/database.ts` turns
them on only for the connection the rest of the app already holds open.
`mergeBackup` opens its own connection — deliberately, for the same reason
`createBackup` does: sharing the app's connection leaves `DETACH` failing with
`database is locked` — and a fresh connection inherits none of that. `PRAGMA
defer_foreign_keys = ON` alone, which is as far as the design went, would
therefore have been a silent no-op: with enforcement itself off there is nothing
to defer, and an orphaned row would have inserted quietly instead of rolling
anything back. The implementation runs `PRAGMA foreign_keys = ON;` and then
`PRAGMA defer_foreign_keys = ON;`, in that order, before the transaction opens —
neither pragma can be changed once a transaction is under way, and SQLite clears
`defer_foreign_keys` automatically at every commit, so there is exactly one
window where either statement can run. It reads like a stray line of setup; it
is actually the difference between a restore that fails safely and one that
corrupts quietly without saying so.

### Cleanup

Three files are involved in a restore, and each one has an owner.

The **working copy** `inspectBackup` stages is deleted on every path out:
immediately, if `inspectBackup` throws before returning a preview; by
`discardBackup`, if the owner reviews the preview and backs out; and by
`mergeBackup`'s own `finally`, whether the merge commits or rolls back.

The **picker's copy** is the one that used to be missed. `app/backup.tsx` asks
`DocumentPicker` for `copyToCacheDirectory: true`, so the file the owner chooses
is duplicated into cache before FinAnt sees a URI at all, and `inspectBackup`
copies _that_ into its working file. `discardPickedBackup()` drops it when the
pick is replaced and when a restore finishes, through the same `isOwnCopy` check
`share-intake-files.ts` uses: only a copy the app itself caused to exist may be
deleted, and a file the owner opened in place is never touched.

The **exported file** is deleted as soon as the share sheet resolves — on iOS.
On Android it is deliberately left behind; see the limitation below.

Every one of those deletes is guarded. `File.delete()` throws on a file that is
already gone or that the OS will not unlink, and these run in `finally` blocks
that sit around work which has already committed or already been shared: an
unguarded throw there would reject a restore that succeeded and tell the owner
nothing was changed about the database that had just changed. Cleanup failing is
never allowed to become the caller's failure.

What that leaves behind is swept at the next launch. `sweepBackupCache()`, run
from `app/_layout.tsx` beside `sweepShareIntakeCache()`, removes anything in the
cache directory matching `finant-backup-*.finantbackup` or
`restore-*.finantbackup` — the Android export above, and whatever a process kill
mid-export or mid-restore stranded under a name no code path will ever say again.

### Known limitation: Android deletes the shared file at the next launch, not at the share

`Sharing.shareAsync` resolves when the Android chooser returns, not when the app
the owner picked has finished reading. Android hands the receiver a `content://`
stream it opens on its own schedule, so deleting the file the moment the promise
resolves could give Drive, Gmail or Nextcloud a truncated read — or nothing at
all — while `lastBackupAt` recorded a success. There is no completion callback to
wait for, and no way to ask the receiver whether it is done.

So on Android the file stays in the app's own cache until `sweepBackupCache()`
removes it at the next launch. The cost is stated rather than hidden: for that
window, an encrypted copy of the whole database sits in cache instead of being
gone within seconds. It is the app's private cache directory and the file is
SQLCipher-encrypted under the recovery code, which is the same protection it has
wherever the owner saves it — and a backup that arrives at the receiving app
intact is the entire point of the feature. iOS has no such gap:
`UIActivityViewController` reads the item while the sheet is up, so the file is
deleted the moment the sheet closes.

## Table manifest

```
institutions, accounts, categories, import_profiles, rules, budgets,
exclusion_rules, transactions, assets, investment_legs, quotes,
price_history, notification_sources, notification_routes, settings
```

`settings` merges the same way as every other table — `INSERT OR IGNORE`, no
seeded-row exception — which is why the phone's own locale, currency and app-lock
choice survive a restore instead of being overwritten by whatever the backup's
phone had set.

That is deliberate, and it was re-checked against the fresh-install problem
above, because a settings row the app wrote to itself would deserve the same
treatment as a seeded category. It writes none. Nothing in `open()` seeds
`settings`: `locale` is written only by `setLocale()`, when the owner picks a
language; there is no writer for `currency` at all; `appLock`,
`lastImportAccount`, `lastBackupAt` and the assistant's rows are all written by
an owner action. So every row present on a fresh install before a restore is one
the owner deliberately created on _this_ phone, minutes ago, and device-wins is
exactly right for it — the language they just chose should not be replaced by the
language their old phone was in.

The one settings row the merge does act on is `retiredShippedRules`, and not by
overwriting it: it is read out of the backup to find shipped rules the owner had
deleted, as described under the merge rule above.

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
