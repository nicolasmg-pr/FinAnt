import { getDatabase } from './database';

export async function readSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?;',
    key,
  );
  return row?.value ?? null;
}

export async function writeSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
    key,
    value,
  );
}

export const SETTING_LOCALE = 'locale';
export const SETTING_CURRENCY = 'currency';
export const SETTING_APP_LOCK = 'appLock';
/** Account id preselected on the import screen: the one the last import went to. */
export const SETTING_LAST_IMPORT_ACCOUNT = 'lastImportAccount';
