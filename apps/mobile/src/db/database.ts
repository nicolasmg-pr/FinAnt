import * as SQLite from 'expo-sqlite';
import { BUILT_IN_CATEGORIES, DEFAULT_RULES } from '@finant/core';
import { getOrCreateDatabaseKey } from '../security/keys';
import { LATEST_VERSION, MIGRATIONS } from './schema';

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
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  await seed(db);
  return db;
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

/** Installs the shipped categories and rules on a fresh database. */
async function seed(db: SQLite.SQLiteDatabase): Promise<void> {
  const existing = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM categories;',
  );
  if ((existing?.count ?? 0) > 0) return;

  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const category of BUILT_IN_CATEGORIES) {
      await db.runAsync(
        `INSERT INTO categories (id, label_key, name, kind, parent_id, color, icon, built_in, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0);`,
        category.id,
        category.labelKey ?? null,
        category.name,
        category.kind,
        category.parentId,
        category.color,
        category.icon,
      );
    }
    for (const rule of DEFAULT_RULES) {
      await db.runAsync(
        `INSERT INTO rules (id, category_id, priority, enabled, learned, match_json, created_at)
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

/** Drops every row and the encryption key. Used by Settings > Erase all data. */
export async function eraseEverything(): Promise<void> {
  const db = await getDatabase();
  await db.execAsync(`
    DELETE FROM transactions;
    DELETE FROM budgets;
    DELETE FROM rules;
    DELETE FROM categories;
    DELETE FROM accounts;
    DELETE FROM import_profiles;
    DELETE FROM settings;
  `);
  await db.closeAsync();
  instance = null;
}
