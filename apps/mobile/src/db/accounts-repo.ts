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
  external_account_id: string | null;
  requisition_id: string | null;
  consent_expires_at: string | null;
  last_synced_at: string | null;
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
  externalAccountId?: string | null;
  requisitionId?: string | null;
  consentExpiresAt?: string | null;
}): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  await db.runAsync(
    `INSERT INTO accounts (
       id, name, iban, currency, institution_id, institution_name, provider,
       external_account_id, requisition_id, consent_expires_at, last_synced_at, archived, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?);`,
    id,
    account.name,
    account.iban ?? null,
    account.currency,
    account.institutionId ?? null,
    account.institutionName ?? null,
    account.provider,
    account.externalAccountId ?? null,
    account.requisitionId ?? null,
    account.consentExpiresAt ?? null,
    new Date().toISOString(),
  );
  return id;
}

export async function markSynced(accountId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE accounts SET last_synced_at = ? WHERE id = ?;',
    new Date().toISOString(),
    accountId,
  );
}

/**
 * The account every manual entry and file import lands in when no bank account
 * has been connected yet. Created lazily so a fresh install has no rows at all.
 */
export async function getOrCreateLocalAccount(currency = 'EUR'): Promise<string> {
  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM accounts WHERE provider = 'file-import' LIMIT 1;`,
  );
  if (existing) return existing.id;
  return createAccount({ name: 'My records', currency, provider: 'file-import' });
}
