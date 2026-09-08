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

export {
  SETTING_APP_LOCK,
  SETTING_ASSISTANT_BUBBLE_POSITION,
  SETTING_ASSISTANT_ENABLED,
  SETTING_CURRENCY,
  SETTING_LAST_IMPORT_ACCOUNT,
  SETTING_LOCALE,
  SETTING_RETIRED_SHIPPED_RULES,
} from './settings-keys';
