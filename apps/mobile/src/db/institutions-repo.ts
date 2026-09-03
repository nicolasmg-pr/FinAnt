import { getDatabase } from './database';
import { newId } from './transactions-repo';

export interface InstitutionRow {
  id: string;
  name: string;
  created_at: string;
}

export async function listInstitutions(): Promise<InstitutionRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<InstitutionRow>('SELECT * FROM institutions ORDER BY name;');
}

/**
 * Adds a bank, or returns the one already carrying that name.
 *
 * Names are matched case-insensitively on the trimmed value, the same rule the
 * migration 6 backfill used: two rows called "DKB" and "dkb " are one bank to
 * the owner, and splitting their accounts across both would split the balance.
 */
export async function createInstitution(institution: { name: string }): Promise<string> {
  const name = institution.name.trim();
  if (name === '') throw new RangeError('An institution needs a name');

  const db = await getDatabase();
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM institutions WHERE LOWER(name) = LOWER(?) LIMIT 1;',
    name,
  );
  if (existing) return existing.id;

  const id = newId();
  await db.runAsync(
    'INSERT INTO institutions (id, name, created_at) VALUES (?, ?, ?);',
    id,
    name,
    new Date().toISOString(),
  );
  return id;
}

/** Renames the bank and the free-text copy its accounts carry, so the two cannot disagree. */
export async function renameInstitution(institutionId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (trimmed === '') throw new RangeError('An institution needs a name');

  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE institutions SET name = ? WHERE id = ?;', trimmed, institutionId);
    await db.runAsync(
      'UPDATE accounts SET institution_name = ? WHERE institution_id = ?;',
      trimmed,
      institutionId,
    );
  });
}

/**
 * Removes the bank and unassigns its accounts. An account is never deleted with
 * it: it owns movements, and dropping a bank is a grouping decision, not a
 * statement that the money and its history never existed.
 */
export async function deleteInstitution(institutionId: string): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE accounts SET institution_id = NULL, institution_name = NULL WHERE institution_id = ?;',
      institutionId,
    );
    await db.runAsync('DELETE FROM institutions WHERE id = ?;', institutionId);
  });
}
