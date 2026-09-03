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

/** Exact match on the compact IBAN the camt.053 reader returns (no spaces, upper case). */
export async function findAccountByIban(iban: string): Promise<AccountRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AccountRow>(
    'SELECT * FROM accounts WHERE iban = ? AND archived = 0 LIMIT 1;',
    iban,
  );
  return row ?? null;
}

export async function createAccount(account: {
  /** Chosen by the caller when rows were already hashed for it; generated otherwise. */
  id?: string;
  name: string;
  currency: string;
  provider: string;
  iban?: string | null;
  institutionId?: string | null;
  institutionName?: string | null;
}): Promise<string> {
  const db = await getDatabase();
  const id = account.id ?? newId();
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
 * The account every manual entry and untyped import lands in. Created lazily so
 * a fresh install has no rows at all.
 *
 * Accounts the owner adds on the import screen share `provider = 'file-import'`,
 * so "My records" is identified as the oldest: the import screen calls this
 * before it offers "New account", so nothing can be created ahead of it.
 */
export async function getOrCreateLocalAccount(currency = 'EUR'): Promise<string> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM accounts WHERE provider = 'file-import' ORDER BY created_at ASC LIMIT 1;`,
  );
  if (existing) return existing.id;
  return createAccount({ name: 'My records', currency, provider: 'file-import' });
}
