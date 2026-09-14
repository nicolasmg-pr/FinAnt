import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Constants from 'expo-constants';
import {
  attachBackupSql,
  BACKUP_FORMAT,
  BACKUP_META_TABLE,
  BACKUP_TABLES,
  createMetaTableSql,
  detachBackupSql,
  EXCLUDED_TABLES,
  exportBackupSql,
  formatRecoveryCode,
  openBackupSql,
} from '@finant/core';
import * as SQLite from 'expo-sqlite';
import { DATABASE_NAME } from '../db/database';
import { getOrCreateDatabaseKey } from '../security/keys';
import { LATEST_VERSION, MIGRATIONS } from '../db/schema';
import { SETTING_LAST_BACKUP_AT, writeSetting } from '../db/settings-repo';

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
    return { code, createdAt };
  } finally {
    // The cache copy is encrypted, but it is also the owner's whole financial
    // history sitting in a directory the OS may hand to anything that asks for
    // free space. It has been shared by now; it has no reason to stay.
    if (file.exists) file.delete();
  }
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
  await new File(uri).copy(working);

  let db: SQLite.SQLiteDatabase | null = null;
  try {
    db = await SQLite.openDatabaseAsync(working.name, {}, posixPath(Paths.cache.uri));
    // Must be the first statement on the connection: SQLCipher reads the
    // header with it, and any query before it fails on an encrypted file.
    await db.execAsync(openBackupSql(code));

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
  const file = new File(preview.uri);
  if (file.exists) file.delete();
}
