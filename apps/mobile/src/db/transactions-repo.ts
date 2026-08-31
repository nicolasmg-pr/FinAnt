import * as Crypto from 'expo-crypto';
import type { Transaction, YearMonth } from '@finant/core';
import { getDatabase } from './database';
import { toTransaction, type TransactionRow } from './mappers';

export function newId(): string {
  return Crypto.randomUUID();
}

export interface NewTransaction {
  accountId: string;
  bookingDate: string;
  valueDate: string | null;
  amountMinor: number;
  currency: string;
  description: string;
  counterparty: string | null;
  reference: string | null;
  categoryId: string | null;
  categorySource: Transaction['categorySource'];
  source: Transaction['source'];
  externalId: string | null;
  importHash: string;
  notes: string | null;
}

/**
 * Inserts a batch, skipping anything the unique indexes already hold.
 * Returns how many rows were new — the number the import screen reports.
 */
export async function insertTransactions(batch: readonly NewTransaction[]): Promise<{
  inserted: number;
  duplicates: number;
}> {
  const db = await getDatabase();
  let inserted = 0;
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const tx of batch) {
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO transactions (
           id, account_id, booking_date, value_date, amount_minor, currency,
           description, counterparty, reference, category_id, category_source,
           source, external_id, import_hash, notes, excluded_from_stats, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?);`,
        newId(),
        tx.accountId,
        tx.bookingDate,
        tx.valueDate,
        tx.amountMinor,
        tx.currency,
        tx.description,
        tx.counterparty,
        tx.reference,
        tx.categoryId,
        tx.categorySource,
        tx.source,
        tx.externalId,
        tx.importHash,
        tx.notes,
        now,
      );
      if (result.changes > 0) inserted += 1;
    }
  });

  return { inserted, duplicates: batch.length - inserted };
}

/** Every movement in a closed date range, newest first. */
export async function listTransactionsBetween(from: string, to: string): Promise<Transaction[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TransactionRow>(
    `SELECT * FROM transactions
      WHERE booking_date >= ? AND booking_date <= ?
      ORDER BY booking_date DESC, created_at DESC;`,
    from,
    to,
  );
  return rows.map(toTransaction);
}

export async function listTransactionsForMonth(month: YearMonth): Promise<Transaction[]> {
  return listTransactionsBetween(`${month}-01`, `${month}-31`);
}

/**
 * Everything on record. The dashboard's forecast needs the full history, and a
 * personal ledger is thousands of rows, not millions — paging it would add
 * complexity for no measurable gain.
 */
export async function listAllTransactions(): Promise<Transaction[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TransactionRow>(
    'SELECT * FROM transactions ORDER BY booking_date DESC, created_at DESC;',
  );
  return rows.map(toTransaction);
}

export async function countUncategorised(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM transactions
      WHERE category_id IS NULL OR category_id = 'uncategorised';`,
  );
  return row?.count ?? 0;
}

/** A manual choice is recorded as such so a later re-run of the rules cannot overwrite it. */
export async function setCategory(transactionId: string, categoryId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE transactions SET category_id = ?, category_source = 'manual' WHERE id = ?;`,
    categoryId,
    transactionId,
  );
}

export async function setExcludedFromStats(transactionId: string, excluded: boolean): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE transactions SET excluded_from_stats = ? WHERE id = ?;',
    excluded ? 1 : 0,
    transactionId,
  );
}

export async function deleteTransaction(transactionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM transactions WHERE id = ?;', transactionId);
}

/** Earliest and latest booking dates on record, for the year picker. */
export async function dataRange(): Promise<{ from: string; to: string } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ from: string | null; to: string | null }>(
    'SELECT MIN(booking_date) AS "from", MAX(booking_date) AS "to" FROM transactions;',
  );
  return row?.from && row.to ? { from: row.from, to: row.to } : null;
}
