import type { ParsedMovement } from '@finant/importers';
import { getDatabase } from './database';
import {
  toNotificationCapture,
  type CaptureStatus,
  type NotificationCapture,
  type NotificationCaptureRow,
} from './mappers';
import { newId } from './transactions-repo';

export interface NewCapture {
  sourceId: string | null;
  packageName: string;
  postedAt: string;
  bookingDate: string;
  title: string | null;
  body: string | null;
  androidKey: string | null;
  captureHash: string;
  status: CaptureStatus;
  parserId: string | null;
  parsed: ParsedMovement | null;
}

/**
 * Records a capture, or does nothing if this notification was already seen.
 *
 * `INSERT OR IGNORE` against the unique capture hash is the whole dedupe
 * story: Android reposts an updated notification with the same post time and
 * text, and a tombstone from an accepted capture still holds its hash.
 *
 * @returns the new row's id, or null when it was a duplicate.
 */
export async function insertCapture(input: NewCapture): Promise<string | null> {
  const db = await getDatabase();
  const id = newId();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO notification_captures (
       id, source_id, package_name, posted_at, booking_date, title, body,
       android_key, capture_hash, status, parser_id, parsed_json, transaction_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`,
    id,
    input.sourceId,
    input.packageName,
    input.postedAt,
    input.bookingDate,
    input.title,
    input.body,
    input.androidKey,
    input.captureHash,
    input.status,
    input.parserId,
    input.parsed === null ? null : JSON.stringify(input.parsed),
    new Date().toISOString(),
  );
  return result.changes > 0 ? id : null;
}

export async function listCaptures(
  statuses: readonly CaptureStatus[],
): Promise<NotificationCapture[]> {
  if (statuses.length === 0) return [];
  const db = await getDatabase();
  const placeholders = statuses.map(() => '?').join(', ');
  const rows = await db.getAllAsync<NotificationCaptureRow>(
    `SELECT * FROM notification_captures
      WHERE status IN (${placeholders})
      ORDER BY posted_at DESC;`,
    ...statuses,
  );
  return rows.map(toNotificationCapture);
}

export async function getCapture(id: string): Promise<NotificationCapture | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<NotificationCaptureRow>(
    'SELECT * FROM notification_captures WHERE id = ?;',
    id,
  );
  return row ? toNotificationCapture(row) : null;
}

/** Captures still waiting on the owner: the dashboard's review chip. */
export async function countOpenCaptures(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM notification_captures
      WHERE status IN ('pending', 'unreadable');`,
  );
  return row?.count ?? 0;
}

/**
 * Settles a capture and forgets its text in the same statement.
 *
 * The row stays so its hash keeps holding this notification's identity, but
 * the narrative goes: a capture the owner has dealt with has no reason to keep
 * sitting in the database.
 */
export async function setCaptureStatus(
  id: string,
  status: CaptureStatus,
  transactionId: string | null,
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE notification_captures
        SET status = ?, transaction_id = ?, title = NULL, body = NULL, parsed_json = NULL
      WHERE id = ?;`,
    status,
    transactionId,
    id,
  );
}

export async function deleteAllCaptures(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notification_captures;');
}
