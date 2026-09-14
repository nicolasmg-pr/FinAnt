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
