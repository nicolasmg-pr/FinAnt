import * as SQLite from 'expo-sqlite';
import {
  BUILT_IN_CATEGORIES,
  DEFAULT_RULES,
  parseRetiredShippedRules,
  shippedRulesToInstall,
} from '@finant/core';
import NotificationCapture from '../../modules/notification-capture';
import { destroyDatabaseKey, getOrCreateDatabaseKey } from '../security/keys';
import { LATEST_VERSION, MIGRATIONS } from './schema';
import { SETTING_RETIRED_SHIPPED_RULES } from './settings-repo';

const DATABASE_NAME = 'finant.db';

let instance: SQLite.SQLiteDatabase | null = null;
let opening: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Opens the single encrypted database connection.
 *
 * `PRAGMA key` must be the first statement on the connection — SQLCipher reads
 * the header with it, and any query issued before it fails with "file is not a
 * database" on an already-encrypted file.
 */
async function open(): Promise<SQLite.SQLiteDatabase> {
  const key = await getOrCreateDatabaseKey();
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync(`PRAGMA key = "x'${key}'";`);
  await assertEncrypted(db);
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  await syncBuiltInCategories(db);
  await syncDefaultRules(db);
  return db;
}

/**
 * Refuses to continue on a build without SQLCipher.
 *
 * Plain SQLite ignores an unknown `PRAGMA key` silently — no error, no warning,
 * and every movement then lands in a plaintext file. `cipher_version` is the one
 * statement that answers only on a SQLCipher build, so it is the check that
 * separates an encrypted database from a convincing-looking accident.
 */
async function assertEncrypted(db: SQLite.SQLiteDatabase): Promise<void> {
  let version: string | undefined;
  try {
    const row = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version;');
    version = row?.cipher_version;
  } catch {
    version = undefined;
  }
  if (version) return;

  await db.closeAsync();
  throw new Error(
    'SQLCipher is unavailable in this build, so the database would be written in ' +
      'plaintext. Refusing to open it. Run a native build with the expo-sqlite ' +
      'useSQLCipher option enabled — Expo Go cannot provide it.',
  );
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const current = row?.user_version ?? 0;
  if (current >= LATEST_VERSION) return;

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
    });
    // PRAGMA cannot be parameterised, and version is an integer literal we own.
    await db.execAsync(`PRAGMA user_version = ${migration.version};`);
  }
}

/**
 * Brings the `categories` table in line with the shipped taxonomy, on every
 * launch rather than once on a fresh database.
 *
 * Seeding once was why a category added in a later release never reached a
 * device that had already been seeded: `seed()` returned early the moment the
 * table held a row. This upserts by id instead, so a new shipped category
 * arrives on the next launch and a relabelled one is relabelled.
 *
 * Three things it deliberately does not do:
 *
 * - it never writes `archived`, so a category the owner hid stays hidden;
 * - it never deletes, so a category the owner created is left alone (and a
 *   shipped id that disappeared from a future release keeps its history);
 * - it never overwrites the name, colour or icon of a row the owner has edited
 *   (`customised = 1`), which would otherwise undo that edit at every launch.
 *
 * `kind`, `position` and `built_in` are refreshed unconditionally: the first
 * two are ours to order and the third is what makes a category undeletable.
 */
export async function syncBuiltInCategories(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const [position, category] of BUILT_IN_CATEGORIES.entries()) {
      await db.runAsync(
        `INSERT INTO categories
           (id, label_key, name, kind, parent_id, color, icon, position, built_in, archived, customised)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0)
         ON CONFLICT(id) DO UPDATE SET
           label_key = CASE WHEN categories.customised = 1 THEN categories.label_key
                            ELSE excluded.label_key END,
           name      = CASE WHEN categories.customised = 1 THEN categories.name
                            ELSE excluded.name END,
           color     = CASE WHEN categories.customised = 1 THEN categories.color
                            ELSE excluded.color END,
           icon      = CASE WHEN categories.customised = 1 THEN categories.icon
                            ELSE excluded.icon END,
           kind      = excluded.kind,
           parent_id = excluded.parent_id,
           position  = excluded.position,
           built_in  = 1;`,
        category.id,
        category.labelKey ?? null,
        category.name,
        category.kind,
        category.parentId,
        category.color,
        category.icon,
        position,
      );
    }
  });
}

/**
 * Installs the shipped rules a database is missing, on every launch.
 *
 * Categories are handled by `syncBuiltInCategories()`, which runs first; this
 * is the same idea for rules and exists for the same reason. Installing once on
 * a fresh database meant a rule added in a later release never reached a device
 * that had already been seeded — the two insurance rules would have shipped
 * with no way of ever running.
 *
 * What it does not do matters as much:
 *
 * - an existing rule is never rewritten, so a shipped rule the owner disabled
 *   or re-pointed stays as they left it;
 * - a shipped rule the owner deleted is not reinstalled, because `deleteRule`
 *   records a tombstone and `shippedRulesToInstall` skips it. Without that, a
 *   plain `INSERT OR IGNORE` would bring it back on every launch, forever.
 */
async function syncDefaultRules(db: SQLite.SQLiteDatabase): Promise<void> {
  const rows = await db.getAllAsync<{ id: string }>('SELECT id FROM rules;');
  // Read off the handle being opened, not through the repositories: this runs
  // inside `open()`, and anything that called `getDatabase()` here would await
  // the very open it is part of.
  const setting = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?;',
    SETTING_RETIRED_SHIPPED_RULES,
  );
  const retired = parseRetiredShippedRules(setting?.value ?? null);
  const missing = shippedRulesToInstall(
    DEFAULT_RULES,
    rows.map((row) => row.id),
    retired,
  );
  if (missing.length === 0) return;

  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const rule of missing) {
      await db.runAsync(
        `INSERT OR IGNORE INTO rules (id, category_id, priority, enabled, learned, match_json, created_at)
         VALUES (?, ?, ?, 1, 0, ?, ?);`,
        rule.id,
        rule.categoryId,
        rule.priority,
        JSON.stringify(rule.match),
        now,
      );
    }
  });
}

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (instance) return Promise.resolve(instance);
  // Concurrent callers during startup must share one open, or SQLCipher gets
  // two connections and the second one races the PRAGMA key.
  opening ??= open().then((db) => {
    instance = db;
    opening = null;
    return db;
  });
  return opening;
}

/**
 * Deletes the database file and the encryption key. Used by Settings > Erase all
 * data.
 *
 * Row-by-row `DELETE` is not enough: the rows stay in the file's free pages
 * until something reuses them. Dropping the file and then the key leaves nothing
 * to recover and nothing to recover it with. The next `getDatabase()` mints a
 * fresh key and a seeded, empty database.
 */
export async function eraseEverything(): Promise<void> {
  if (instance) {
    await instance.closeAsync();
  }
  instance = null;
  opening = null;

  await SQLite.deleteDatabaseAsync(DATABASE_NAME);
  await destroyDatabaseKey();

  // The notification allowlist lives outside SQLCipher, in plain Android
  // preferences, because the listener runs while this connection is closed.
  // Deleting the database would otherwise leave a file behind that still names
  // the owner's banks, which is not what "erase all data" says.
  //
  // Imported straight from the native module rather than through
  // `capture-service`: this file sits near the bottom of the dependency graph,
  // and that module would drag `ingest` and the repositories back into it.
  if (NotificationCapture.isSupported()) {
    NotificationCapture.setAllowedPackages([]);
    // Discarded on purpose — reading is how the learned list is cleared.
    NotificationCapture.consumeLearnedPackages();
  }
}
