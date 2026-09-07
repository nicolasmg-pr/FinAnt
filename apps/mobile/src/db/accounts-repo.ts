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
  /** What the owner asserted the account holds, in minor units. Null until they say. */
  balance_minor: number | null;
  /** The day that assertion was made about, `YYYY-MM-DD`. */
  balance_date: string | null;
  /**
   * Legacy. Held a derived opening balance while balances were computed
   * forwards from one; the assertion above is now the only source of truth and
   * nothing reads this. Kept because migrations are append-only.
   */
  opening_balance_minor: number | null;
}

export async function listAccounts(): Promise<AccountRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<AccountRow>('SELECT * FROM accounts WHERE archived = 0 ORDER BY name;');
}

/** Exact match on the compact IBAN the camt.053 reader returns (no spaces, upper case). */
export async function findAccountByIban(iban: string): Promise<AccountRow | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AccountRow>(
    'SELECT * FROM accounts WHERE iban = ? AND archived = 0 ORDER BY created_at ASC LIMIT 1;',
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

/**
 * Records the balance the owner says the account holds on `balanceDate`.
 *
 * That claim is the whole truth about the account: every other figure is
 * measured from it, forwards for a later day and backwards for an earlier one.
 * Nothing is derived and stored alongside it, so importing history can never
 * contradict it. See packages/core/src/balance.ts.
 */
export async function setAccountBalance(
  accountId: string,
  balance: { assertedMinor: number; balanceDate: string },
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE accounts SET balance_minor = ?, balance_date = ? WHERE id = ?;',
    balance.assertedMinor,
    balance.balanceDate,
    accountId,
  );
}

/** Renames an account. The id is permanent: every import hash is built on it. */
export async function renameAccount(accountId: string, name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE accounts SET name = ? WHERE id = ?;', name, accountId);
}

/**
 * Deletes an account and every movement it owns.
 *
 * `transactions.account_id` cascades, so the rows go with the account rather
 * than being left pointing at an account that is not there. A transfer peer in
 * another account is unlinked first: the row it paired with is about to stop
 * existing, and a peer id pointing at nothing would survive the cascade.
 *
 * This is the one irreversible action on the Banks screen. The movements are
 * hard deleted, not flagged, so the statement they came from can be imported
 * again from scratch.
 */
export async function deleteAccountWithMovements(accountId: string): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE transactions
          SET transfer_peer_id = NULL
        WHERE transfer_peer_id IN (SELECT id FROM transactions WHERE account_id = ?);`,
      accountId,
    );
    await db.runAsync('DELETE FROM accounts WHERE id = ?;', accountId);
  });
}

/**
 * Moves an account into a bank, or out of every bank with `null`. The
 * free-text `institution_name` a camt.053 import may have left is kept in step
 * with the chosen bank so the two can never name different banks.
 */
export async function setAccountInstitution(
  accountId: string,
  institutionId: string | null,
): Promise<void> {
  const db = await getDatabase();
  const name = institutionId
    ? ((
        await db.getFirstAsync<{ name: string }>(
          'SELECT name FROM institutions WHERE id = ?;',
          institutionId,
        )
      )?.name ?? null)
    : null;
  await db.runAsync(
    'UPDATE accounts SET institution_id = ?, institution_name = ? WHERE id = ?;',
    institutionId,
    name,
    accountId,
  );
}
