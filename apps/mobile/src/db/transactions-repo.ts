import * as Crypto from 'expo-crypto';
import {
  INTERNAL_TRANSFER_ID,
  type Recategorisation,
  type Transaction,
  type TransactionSide,
  type TransferPair,
  type YearMonth,
} from '@finant/core';
import { getDatabase } from './database';
import { toTransaction, type TransactionRow } from './mappers';

/** Ids per `IN (...)`. Well under SQLCipher's compiled variable limit, with
 * room for the parameters that travel alongside them. */
const BULK_CHUNK = 400;

export function newId(): string {
  return Crypto.randomUUID();
}

export interface NewTransaction {
  accountId: string;
  bookingDate: string;
  valueDate: string | null;
  amountMinor: number;
  currency: string;
  side: TransactionSide;
  description: string;
  counterparty: string | null;
  reference: string | null;
  categoryId: string | null;
  categorySource: Transaction['categorySource'];
  source: Transaction['source'];
  externalId: string | null;
  importHash: string;
  notes: string | null;
  /** Set by the exclusion rules at ingest, so a covered movement never counts
   * towards a single monthly total, not even for the minute before the owner
   * next opens the app. */
  excludedFromStats: boolean;
}

/**
 * Inserts a batch, skipping anything the unique indexes already hold.
 * Returns how many rows were new — the number the import screen reports.
 * `excluded` counts only the rows that were actually inserted with the flag
 * set, so a re-imported statement does not report the same exclusions twice.
 */
export async function insertTransactions(batch: readonly NewTransaction[]): Promise<{
  inserted: number;
  duplicates: number;
  excluded: number;
}> {
  const db = await getDatabase();
  let inserted = 0;
  let excluded = 0;
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    for (const tx of batch) {
      const result = await db.runAsync(
        `INSERT OR IGNORE INTO transactions (
           id, account_id, booking_date, value_date, amount_minor, currency, side,
           description, counterparty, reference, category_id, category_source,
           source, external_id, import_hash, notes, excluded_from_stats, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        newId(),
        tx.accountId,
        tx.bookingDate,
        tx.valueDate,
        tx.amountMinor,
        tx.currency,
        tx.side,
        tx.description,
        tx.counterparty,
        tx.reference,
        tx.categoryId,
        tx.categorySource,
        tx.source,
        tx.externalId,
        tx.importHash,
        tx.notes,
        tx.excludedFromStats ? 1 : 0,
        now,
      );
      if (result.changes > 0) {
        inserted += 1;
        if (tx.excludedFromStats) excluded += 1;
      }
    }
  });

  return { inserted, duplicates: batch.length - inserted, excluded };
}

/** Every movement in a closed date range, newest first. */
export async function listTransactionsBetween(from: string, to: string): Promise<Transaction[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<TransactionRow>(
    `SELECT * FROM transactions
      WHERE booking_date >= ? AND booking_date <= ? AND deleted_at IS NULL
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
    'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY booking_date DESC, created_at DESC;',
  );
  return rows.map(toTransaction);
}

/** One movement by id, or null when it never existed or has been deleted. */
export async function getTransaction(id: string): Promise<Transaction | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TransactionRow>(
    'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL;',
    id,
  );
  return row ? toTransaction(row) : null;
}

export async function countUncategorised(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM transactions
      WHERE deleted_at IS NULL
        AND (category_id IS NULL OR category_id = 'uncategorised');`,
  );
  return row?.count ?? 0;
}

/**
 * A manual choice is recorded as such so a later re-run of the rules cannot
 * overwrite it. It also ends any transfer pairing: the owner has said what
 * this row is, so the link is cleared on both sides. The other side keeps its
 * `transfer-internal` category and is not re-paired, because this row is now
 * manual and therefore off limits to the matcher.
 */
export async function setCategory(transactionId: string, categoryId: string): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE transactions SET transfer_peer_id = NULL WHERE transfer_peer_id = ?;',
      transactionId,
    );
    await db.runAsync(
      `UPDATE transactions
          SET category_id = ?, category_source = 'manual', transfer_peer_id = NULL
        WHERE id = ?;`,
      categoryId,
      transactionId,
    );
  });
}

export async function setExcludedFromStats(
  transactionId: string,
  excluded: boolean,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE transactions SET excluded_from_stats = ? WHERE id = ?;',
    excluded ? 1 : 0,
    transactionId,
  );
}

/**
 * The same flag over many rows at once, for "apply to all similar".
 *
 * One database transaction, so the ledger is never half-excluded, and the ids
 * go in chunks: a single `IN (...)` with a few thousand placeholders would run
 * into SQLite's variable limit, and a personal ledger can easily reach that
 * many rows for one supermarket.
 */
export async function setExcludedFromStatsBulk(
  ids: readonly string[],
  excluded: boolean,
): Promise<number> {
  if (ids.length === 0) return 0;
  const db = await getDatabase();
  let changed = 0;
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i += BULK_CHUNK) {
      const chunk = ids.slice(i, i + BULK_CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      const result = await db.runAsync(
        `UPDATE transactions
            SET excluded_from_stats = ?
          WHERE deleted_at IS NULL AND id IN (${placeholders});`,
        excluded ? 1 : 0,
        ...chunk,
      );
      changed += result.changes;
    }
  });
  return changed;
}

/**
 * Records every matched pair in one transaction: both rows become
 * `transfer-internal` (source `auto`) and point at each other. The WHERE
 * guards repeat the matcher's own rules, so a row the owner categorised or
 * a row linked by a concurrent run is left alone rather than overwritten.
 */
export async function linkTransferPairs(pairs: readonly TransferPair[]): Promise<void> {
  if (pairs.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const pair of pairs) {
      for (const [id, peerId] of [
        [pair.outId, pair.inId],
        [pair.inId, pair.outId],
      ] as const) {
        await db.runAsync(
          `UPDATE transactions
              SET category_id = ?, category_source = 'auto', transfer_peer_id = ?
            WHERE id = ?
              AND deleted_at IS NULL
              AND transfer_peer_id IS NULL
              AND category_source != 'manual';`,
          INTERNAL_TRANSFER_ID,
          peerId,
          id,
        );
      }
    }
  });
}

/**
 * Soft delete. The row stays in the table so the unique indexes keep holding
 * its identity: the next overlapping statement import then skips it as a
 * duplicate instead of bringing it back. Every read filters `deleted_at`.
 */
export async function deleteTransaction(transactionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE transactions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL;',
    new Date().toISOString(),
    transactionId,
  );
}

/** Earliest and latest booking dates on record, for the year picker. */
export async function dataRange(): Promise<{ from: string; to: string } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ from: string | null; to: string | null }>(
    'SELECT MIN(booking_date) AS "from", MAX(booking_date) AS "to" FROM transactions WHERE deleted_at IS NULL;',
  );
  return row?.from && row.to ? { from: row.from, to: row.to } : null;
}

/**
 * Writes the changes `recategorise()` proposed, in one transaction.
 *
 * The `category_source` a row ends up with says how it got its category, so a
 * row a rule now matches becomes `auto` and one no rule matches any more
 * becomes `none`. The WHERE repeats the guards the pure function already
 * applied, so a row the owner classified by hand between reading and writing
 * is left alone rather than overwritten.
 */
export async function applyRecategorisations(
  changes: readonly Recategorisation[],
): Promise<number> {
  if (changes.length === 0) return 0;
  const db = await getDatabase();
  let changed = 0;
  await db.withTransactionAsync(async () => {
    for (const change of changes) {
      const result = await db.runAsync(
        `UPDATE transactions
            SET category_id = ?, category_source = ?
          WHERE id = ?
            AND deleted_at IS NULL
            AND category_source != 'manual'
            AND transfer_peer_id IS NULL;`,
        change.categoryId,
        change.ruleId ? 'auto' : 'none',
        change.id,
      );
      changed += result.changes;
    }
  });
  return changed;
}
