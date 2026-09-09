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
 * `INSERT OR IGNORE` against the unique capture hash catches a byte-identical
 * re-delivery, including the tombstone an accepted or dismissed capture leaves
 * behind. It does not catch a repost: AOSP builds a fresh
 * `StatusBarNotification` stamped with `System.currentTimeMillis()` every time
 * a notification is enqueued, updates included, so the same payment posted
 * twice hashes differently. `hasUnsettledCaptureFor` is what covers that case,
 * on Android's own notification key rather than on the post time.
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

/**
 * Whether this notification is a repost of one already on record under the
 * same Android key.
 *
 * `sbn.key` is stable across a repost of the same notification; its post time
 * is not, so a repost hashes differently and `INSERT OR IGNORE` would
 * otherwise let it through as a second row — and, with `auto_approve` on, a
 * second provisional movement for one payment.
 *
 * `pending` and `unreadable` rows still hold their text, so a repost of one of
 * those is recognised only when the title and body are identical too. A bank
 * genuinely re-wording a notification — "payment pending" becoming "payment
 * completed" — fails that comparison on purpose: it lands as a second,
 * distinct capture rather than being folded into the first, because treating
 * a re-worded notification as a repost risks silently absorbing a real second
 * payment into the old row.
 *
 * `accepted` rows have already had their title, body and parsed_json nulled by
 * `setCaptureStatus` — the retention promise — so there is no text left to
 * compare. Matching on `android_key` alone is what stops a repost arriving
 * after accept from slipping past this check and writing the duplicate
 * provisional movement this function exists to prevent.
 *
 * `dismissed` stays out of the key-only match, and not by oversight:
 * `android_key` names a notification slot, which a bank can reuse for a later,
 * unrelated payment. Matching a dismissed row on the key alone would drop that
 * later capture without a trace — the ledger's worst failure. Letting a repost
 * of an already-dismissed notification come back as a new capture is the
 * safer direction: at most it resurfaces something the owner dismisses again,
 * and the real movement still arrives through the next statement import
 * either way.
 *
 * `IS` rather than `=` so a null title or body compares equal to itself, which
 * `=` in SQL never does.
 */
export async function hasUnsettledCaptureFor(
  androidKey: string,
  title: string | null,
  body: string | null,
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM notification_captures
      WHERE android_key = ?
        AND (
          status = 'accepted'
          OR (status IN ('pending', 'unreadable') AND title IS ? AND body IS ?)
        );`,
    androidKey,
    title,
    body,
  );
  return (row?.count ?? 0) > 0;
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
