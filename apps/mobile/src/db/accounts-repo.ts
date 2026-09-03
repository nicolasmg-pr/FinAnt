import { getDatabase } from './database';
import { newId } from './transactions-repo';

export interface AccountRow {
  id: string;
  name: string;
  iban: string | null;
  currency: string;
  institution_id: string | null;
  institution_name: string | null;
  provider: string;
  archived: number;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<AccountRow>('SELECT * FROM accounts WHERE archived = 0 ORDER BY name;');
}

export async function createAccount(account: {
  name: string;
  currency: string;
  provider: string;
  iban?: string | null;
  institutionId?: string | null;
  institutionName?: string | null;
}): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  await db.runAsync(
    `INSERT INTO accounts (
       id, name, iban, currency, institution_id, institution_name, provider, archived, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?);`,
    id,
    account.name,
    account.iban ?? null,
    account.currency,
    account.institutionId ?? null,
    account.institutionName ?? null,
    account.provider,
    new Date().toISOString(),
  );
  return id;
}

/**
 * The account every manual entry and file import lands in. Created lazily so a
 * fresh install has no rows at all.
 */
export async function getOrCreateLocalAccount(currency = 'EUR'): Promise<string> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM accounts WHERE provider = 'file-import' LIMIT 1;`,
  );
  if (existing) return existing.id;
  return createAccount({ name: 'My records', currency, provider: 'file-import' });
}
