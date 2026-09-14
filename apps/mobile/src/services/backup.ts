import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import {
  attachBackupSql,
  BACKUP_FORMAT,
  BACKUP_META_TABLE,
  BACKUP_TABLES,
  createMetaTableSql,
  DEFAULT_RULES,
  deleteRetiredShippedRulesSql,
  detachBackupSql,
  EXCLUDED_TABLES,
  exportBackupSql,
  formatRecoveryCode,
  mergeTableSql,
  openBackupSql,
  parseRetiredShippedRules,
  pristineShippedRuleIds,
  reseedPristineCategoriesSql,
  reseedPristineRulesSql,
  type StoredRuleRow,
} from '@finant/core';
import * as SQLite from 'expo-sqlite';
import { DATABASE_NAME } from '../db/database';
import { getOrCreateDatabaseKey } from '../security/keys';
import { LATEST_VERSION, MIGRATIONS } from '../db/schema';
import { SETTING_LAST_BACKUP_AT, writeSetting } from '../db/settings-repo';
import { SETTING_RETIRED_SHIPPED_RULES } from '../db/settings-keys';
import { isOwnCopy } from './share-intake-files';

export type BackupErrorCode =
  'wrong-code' | 'not-a-backup' | 'too-new' | 'schema-mismatch' | 'sharing-unavailable';

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

/**
 * `finant-backup-YYYY-MM-DD.finantbackup`, dated in the owner's own time zone.
 *
 * `toISOString()` names the UTC day, which is the wrong day for half of every
 * evening in CET: a backup taken at 00:30 on the 4th would be filed as the 3rd,
 * and the owner looking for the file they made "last night" would find a date
 * that never matched what their phone showed them.
 */
function backupFileName(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `finant-backup-${year}-${month}-${day}.finantbackup`;
}

/**
 * Deletes a file the app itself put in cache, and never lets that failure
 * become the caller's problem.
 *
 * Cleanup runs in `finally` blocks that sit around work which has already
 * committed or already shared. `File.delete()` throws on a file that is
 * already gone or that the OS will not unlink, and an unguarded throw there
 * turns a restore that succeeded into "nothing was changed" on screen — a
 * false statement about the owner's only copy. The same guarded shape as the
 * DETACH cleanup below. Nothing is logged: the reason would carry the path.
 */
function discardCacheFile(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // Best-effort. A copy left in cache is swept at the next launch.
  }
}

/**
 * Mints the recovery code, and checks the device can share a file at all.
 *
 * Nothing is written anywhere: this exists so the screen can show the code and
 * take the owner's "I have saved this code" *before* `createBackup()` creates
 * the file and hands it to the share sheet. Doing it the other way round —
 * share first, show the code afterwards — meant any throw in between (a
 * failed setting write, a share-sheet rejection after the owner had already
 * picked "Save to Files", the process being killed) left a real backup sitting
 * in the owner's cloud storage with its only key never shown to anyone. The
 * spec's Export flow always required the confirmation to gate the share; this
 * is what makes the code the thing that cannot be lost.
 *
 * The availability check belongs here for the same reason: an owner should not
 * be asked to write down a code for a file this device could never hand over.
 */
export async function beginBackup(): Promise<string> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new BackupError('sharing-unavailable');
  }
  return formatRecoveryCode(Crypto.getRandomBytes(16));
}

/**
 * Writes an encrypted copy of the database and hands it to the share sheet.
 *
 * Called only once the owner has confirmed they saved the code `beginBackup()`
 * minted, so by the time a file exists its key is already written down. The
 * code is never stored on the device: one kept beside the backup it protects
 * would defeat the entire point of the file being portable.
 */
export async function createBackup(code: string): Promise<{ createdAt: string }> {
  const createdAt = new Date().toISOString();
  const file = new File(Paths.cache, backupFileName(new Date(createdAt)));
  // ATTACH creates the file; an existing one from an abandoned run would be
  // opened with the wrong key and fail as "file is not a database".
  if (file.exists) file.delete();

  const key = await getOrCreateDatabaseKey();
  const path = posixPath(file.uri);

  try {
    // Its own connection, never the app's. Without useNewConnection expo-sqlite
    // returns the cached handle the UI is reading through, and DETACH then fails
    // with "database is locked". Confirmed by the probe in Task 1.
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
    let attached = false;
    try {
      await db.execAsync(`PRAGMA key = "x'${key}'";`);
      await db.execAsync(attachBackupSql(path, code));
      attached = true;

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
      // A failed DETACH must not stop the connection from closing — closing
      // releases the attached file regardless of whether DETACH ran — and it
      // must not replace whatever error the block above was already
      // throwing, so it is caught and dropped here rather than left to
      // propagate. DETACH is skipped outright when ATTACH itself never
      // succeeded, since DETACHing a schema that was never attached is
      // itself an error that would mask the real one.
      if (attached) {
        try {
          await db.execAsync(detachBackupSql());
        } catch {
          // Best-effort only: closeAsync() below still releases the file.
        }
      }
      await db.closeAsync();
    }

    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/octet-stream',
      dialogTitle: 'FinAnt backup',
    });
    await writeSetting(SETTING_LAST_BACKUP_AT, createdAt);
    return { createdAt };
  } finally {
    // The cache copy is encrypted, but it is also the owner's whole financial
    // history sitting in a directory the OS may hand to anything that asks for
    // free space. It has no reason to outlive the share.
    //
    // Except on Android, where it does. `Sharing.shareAsync` resolves when the
    // chooser returns, not when the app the owner picked has finished reading:
    // Android hands the receiver a content:// stream it opens on its own
    // schedule, so Drive, Gmail or Nextcloud reading lazily would find a file
    // this line had already unlinked — and `lastBackupAt` would record a
    // backup that arrived truncated or not at all. There is no completion
    // callback to wait for, so the file stays and `sweepBackupCache()` removes
    // it at the next launch instead, by which time every reader is long done.
    // iOS has no such gap: UIActivityViewController reads the item while the
    // sheet is up and its completion fires afterwards.
    if (Platform.OS !== 'android') discardCacheFile(file);
  }
}

/**
 * Removes backup working files this app left in its own cache.
 *
 * Two things end up here. An Android export deliberately leaves its shared
 * file behind (see the `finally` above), and either platform can be killed
 * mid-export or mid-restore, stranding a file no code path will ever name
 * again. Both are the owner's whole ledger in a file a recovery code opens, so
 * they do not get to sit there until the OS feels like reclaiming space.
 *
 * Safe to run at launch: nothing else is in flight that early, and it only
 * ever matches the two name shapes this file creates.
 */
const BACKUP_CACHE_FILE = /^(finant-backup-|restore-).*\.finantbackup$/;

export async function sweepBackupCache(): Promise<void> {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && BACKUP_CACHE_FILE.test(entry.name)) {
        discardCacheFile(entry);
      }
    }
  } catch {
    // Best-effort, exactly like `sweepShareIntakeCache`: a sweep that cannot
    // run leaves a file in the app's own cache rather than breaking startup.
    // Not logged — the reason would carry a file name.
  }
  return Promise.resolve();
}

/**
 * Drops the copy `DocumentPicker` made of the file the owner picked.
 *
 * `copyToCacheDirectory: true` duplicates the chosen file into the app's cache
 * before `inspectBackup` ever sees it, and `inspectBackup` then copies *that*
 * into its own working file and only ever deletes its own. Left alone, every
 * restore stranded a complete, code-openable copy of the entire ledger in
 * cache, forever.
 *
 * `isOwnCopy` is the same check `discardShare` uses, for the same reason: only
 * a copy the app itself caused to exist may be deleted. A URI outside the
 * app's own directories is the owner's original file, in place, and deleting
 * that would be FinAnt removing a document it was only ever lent.
 */
export async function discardPickedBackup(uri: string): Promise<void> {
  if (!isOwnCopy(uri)) return;
  discardCacheFile(new File(uri));
  return Promise.resolve();
}

export type BackupPreview = {
  /**
   * POSIX path of the working copy in cache, ready for ATTACH — Task 7 merges
   * from this path.
   */
  readonly path: string;
  /**
   * `file://` form of the same working copy, for expo-file-system.
   * `discardBackup` needs this rather than rebuilding a URI from `path`:
   * `file://${path}` drops the percent-encoding a space or a non-ASCII
   * character in a cache path would carry, which would leave the copy
   * unresolvable and stranded in cache.
   */
  readonly uri: string;
  readonly appVersion: string;
  /**
   * The schema version the file itself declares — what it was exported at, not
   * what the working copy has since been migrated to. Reporting
   * `LATEST_VERSION` here made the field say only "this build's version",
   * which is a fact about the phone and tells a reader nothing about the file.
   */
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

  let db: SQLite.SQLiteDatabase | null = null;
  try {
    // copy() is a native, non-atomic file operation. It stays inside this try
    // so a throw partway through — disk full, permission revoked mid-copy —
    // still hits the catch below and deletes whatever partial file it left,
    // rather than stranding it under a name nothing else can ever find.
    await new File(uri).copy(working);

    db = await SQLite.openDatabaseAsync(working.name, {}, posixPath(Paths.cache.uri));
    // Must be the first statement on the connection: SQLCipher reads the
    // header with it, and any query before it fails on an encrypted file.
    let openSql: string;
    try {
      openSql = openBackupSql(code);
    } catch {
      // A malformed code fails the pattern check before SQLCipher ever sees
      // it. From the owner's side that is the same event as a code that
      // reaches SQLCipher and fails to decrypt: they typed it wrong, so it
      // gets the same BackupError and the same sentence on screen.
      throw new BackupError('wrong-code');
    }
    await db.execAsync(openSql);

    let meta: {
      format: string;
      app_version: string;
      schema_version: number;
      created_at: string;
    } | null;
    try {
      meta = await db.getFirstAsync(
        `SELECT format, app_version, schema_version, created_at FROM ${BACKUP_META_TABLE};`,
      );
    } catch {
      // Either the key is wrong (SQLCipher reports "file is not a database")
      // or the file opened but has no meta table. The first query is where
      // both surface, so they are told apart by a second, cheaper probe.
      throw (await opensAtAll(db))
        ? new BackupError('not-a-backup')
        : new BackupError('wrong-code');
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
      uri: working.uri,
      appVersion: meta.app_version,
      schemaVersion: meta.schema_version,
      createdAt: meta.created_at,
      counts,
    };
  } catch (error) {
    discardCacheFile(working);
    throw error;
  } finally {
    // Same reasoning as the DETACH guard in createBackup(): a failed close
    // must not replace whatever error (a wrong recovery code, most often)
    // the block above was already throwing.
    try {
      await db?.closeAsync();
    } catch {
      // Best-effort only.
    }
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

/**
 * Drops the working copy when the owner backs out of a preview, or once a
 * merge is over.
 *
 * Never throws. It is called from `finally` blocks on both sides of a merge
 * that has already committed, and a file that is already gone is the outcome
 * this function wanted anyway.
 */
export async function discardBackup(preview: BackupPreview): Promise<void> {
  discardCacheFile(new File(preview.uri));
  return Promise.resolve();
}

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
  const added: Record<string, number> = {};

  try {
    const key = await getOrCreateDatabaseKey();
    // Its own connection, never the app's, for the same reason as the export:
    // without useNewConnection expo-sqlite returns the cached handle the UI is
    // reading through, and DETACH then fails with "database is locked".
    // Confirmed by the probe in Task 1. Rows committed here are visible to the
    // app's connection immediately afterwards.
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME, { useNewConnection: true });
    let attached = false;
    try {
      await db.execAsync(`PRAGMA key = "x'${key}'";`);
      await db.execAsync(attachBackupSql(preview.path, code));
      attached = true;

      const columns = await assertColumnsMatch(db);
      // Both reads happen before the transaction opens, and both read the
      // *live* side: which shipped rules this phone is still holding exactly
      // as it seeded them, and which ones the backup's phone had deleted.
      // Neither is a decision the merge can make from inside the loop, since
      // the loop's own inserts would change the answer.
      const pristineRules = pristineShippedRuleIds(DEFAULT_RULES, await liveRules(db));
      const retiredRules = (await retiredShippedRulesFromBackup(db)).filter((id) =>
        pristineRules.includes(id),
      );
      // foreign_keys defaults OFF on a fresh connection — database.ts turns it
      // on for the app's own connection, once, and this is a different
      // connection entirely. defer_foreign_keys only changes *when* a foreign
      // key check runs; with enforcement itself off there is nothing to defer,
      // and an orphan row would insert silently instead of rolling back at
      // commit. Both statements must run here, before the transaction opens:
      // neither pragma may be changed once one is under way, and SQLite clears
      // defer_foreign_keys automatically at the end of every transaction.
      await db.execAsync('PRAGMA foreign_keys = ON;');
      await db.execAsync('PRAGMA defer_foreign_keys = ON;');
      await db.withTransactionAsync(async () => {
        for (const table of BACKUP_TABLES) {
          const before = await countRows(db, `main.${table}`);
          await db.execAsync(mergeTableSql(table));
          added[table] = (await countRows(db, `main.${table}`)) - before;
        }

        // `INSERT OR IGNORE` above skipped every row whose id this phone
        // already holds — which, on the fresh install a restore matters most
        // on, is every shipped category and every shipped rule, seeded by
        // `open()` before this screen could exist. Those rows are the app's
        // own work, not the owner's, so the backup's version replaces them
        // here. A row the owner has touched is excluded by the statements
        // themselves and keeps the phone's version, which is device-wins as
        // designed. Inside the same transaction, so a failure anywhere still
        // rolls the whole restore back.
        const categoryColumns = columns['categories'];
        if (categoryColumns) {
          await db.execAsync(reseedPristineCategoriesSql(categoryColumns));
        }
        const ruleColumns = columns['rules'];
        if (ruleColumns && pristineRules.length > 0) {
          await db.execAsync(reseedPristineRulesSql(ruleColumns, pristineRules));
        }
        if (retiredRules.length > 0) {
          await db.execAsync(deleteRetiredShippedRulesSql(retiredRules));
          added['rules'] = (added['rules'] ?? 0) - retiredRules.length;
        }
      });
    } finally {
      // Same shape as createBackup's cleanup: a failed DETACH must not stop
      // the connection from closing, and must not replace whatever error the
      // block above was already throwing, so it is caught and dropped here.
      // DETACH is skipped outright when ATTACH itself never succeeded.
      if (attached) {
        try {
          await db.execAsync(detachBackupSql());
        } catch {
          // Best-effort only: closeAsync() below still releases the file.
        }
      }
      await db.closeAsync();
    }
    return added;
  } finally {
    // The merge has committed by the time this runs, so cleanup here cannot be
    // allowed to fail the call: a throw would reject a restore that already
    // succeeded, and the screen would tell the owner nothing was changed about
    // the database that just changed. `discardBackup` swallows its own
    // failure for that reason; the leftover is swept at the next launch.
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
async function assertColumnsMatch(
  db: SQLite.SQLiteDatabase,
): Promise<Readonly<Record<string, readonly string[]>>> {
  const columns: Record<string, readonly string[]> = {};
  for (const table of BACKUP_TABLES) {
    const [mine, theirs] = await Promise.all([
      db.getAllAsync<{ name: string }>(`PRAGMA main.table_info(${table});`),
      db.getAllAsync<{ name: string }>(`PRAGMA backup.table_info(${table});`),
    ]);
    const names = mine.map((column) => column.name);
    const a = names.join(',');
    const b = theirs.map((column) => column.name).join(',');
    if (a !== b || a === '') {
      throw new BackupError('schema-mismatch');
    }
    columns[table] = names;
  }
  // Handed back rather than thrown away: the reseed statements are built from
  // the live column list, and this is the function that has just proved the
  // backup declares the same one. Reading the columns a second time would
  // reopen the window this check exists to close.
  return columns;
}

/**
 * The live `rules` rows, in the shape `pristineShippedRuleIds` compares.
 *
 * `match_json` is a pattern the owner may have typed, so it stays in memory
 * and never reaches a log — the Boundaries rule in CLAUDE.md.
 */
async function liveRules(db: SQLite.SQLiteDatabase): Promise<StoredRuleRow[]> {
  const rows = await db.getAllAsync<{
    id: string;
    category_id: string;
    priority: number;
    enabled: number;
    learned: number;
    match_json: string;
  }>('SELECT id, category_id, priority, enabled, learned, match_json FROM main.rules;');
  return rows.map((row) => ({
    id: row.id,
    categoryId: row.category_id,
    priority: row.priority,
    enabled: row.enabled === 1,
    learned: row.learned === 1,
    matchJson: row.match_json,
  }));
}

/**
 * The shipped rules the backup's phone had deleted.
 *
 * Read straight from the attached file rather than waiting for `settings` to
 * merge: by the time the tombstone lands in `main.settings` the rules it names
 * have already been reinstated by `syncDefaultRules()` at launch, and nothing
 * would ever look at it again.
 */
async function retiredShippedRulesFromBackup(db: SQLite.SQLiteDatabase): Promise<string[]> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM backup.settings WHERE key = ?;',
    SETTING_RETIRED_SHIPPED_RULES,
  );
  return parseRetiredShippedRules(row?.value ?? null);
}
