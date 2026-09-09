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
  /**
   * `contentHashOf({ packageName, title, body })` — a fingerprint of the text
   * alone, with no post time mixed in. Written once here and never touched
   * again, including by `setCaptureStatus`, so it survives the moment `title`
   * and `body` are NULLed on settle. That is what lets `hasUnsettledCaptureFor`
   * recognise a repost of an already-`accepted` capture with no text left to
   * compare it against.
   */
  contentHash: string;
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
 * on Android's own notification key and `content_hash` rather than on the
 * post time.
 *
 * @returns the new row's id, or null when it was a duplicate.
 */
export async function insertCapture(input: NewCapture): Promise<string | null> {
  const db = await getDatabase();
  const id = newId();
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO notification_captures (
       id, source_id, package_name, posted_at, booking_date, title, body,
       android_key, capture_hash, content_hash, status, parser_id, parsed_json,
       transaction_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?);`,
    id,
    input.sourceId,
    input.packageName,
    input.postedAt,
    input.bookingDate,
    input.title,
    input.body,
    input.androidKey,
    input.captureHash,
    input.contentHash,
    input.status,
    input.parserId,
    input.parsed === null ? null : JSON.stringify(input.parsed),
    new Date().toISOString(),
  );
  return result.changes > 0 ? id : null;
}

/**
 * Whether this notification is a repost of one already on record under the
 * same Android key and the same content fingerprint.
 *
 * `sbn.key` is stable across a repost of the same notification; its post time
 * is not, so a repost hashes differently in `capture_hash` and `INSERT OR
 * IGNORE` would otherwise let it through as a second row — and, with
 * `auto_approve` on, a second provisional movement for one payment.
 *
 * The caller passes `contentHashOf({ packageName, title, body })` — the same
 * fingerprint `insertCapture` wrote into `content_hash` when the row was
 * first created, computed from the notification's own text and never from
 * anything that changes on a repost. Matching on it, rather than on `title`
 * and `body` directly, is what makes `pending`, `unreadable` and `accepted`
 * work alike: a `pending` or `unreadable` row still has its text, but an
 * `accepted` row does not — `setCaptureStatus` NULLs it on settle, the
 * retention promise — and `content_hash` is the one thing that survives that
 * to be compared against. Without it, an accepted row could only be matched
 * on `android_key` alone, and a repost arriving after accept would slip
 * straight past into a duplicate provisional movement.
 *
 * The same fingerprint is what keeps that match safe rather than trading one
 * silent failure for another: `android_key` alone names a notification slot,
 * which a bank can legitimately reuse for a later, unrelated payment, but
 * that payment's wording differs, so its content hash differs too, and it is
 * never mistaken for a repost of the old one — status of the earlier row
 * notwithstanding.
 *
 * `dismissed` still stays out, by choice rather than by this necessity: a
 * repost of a notification the owner already dismissed is let back in as a
 * new capture rather than silently re-suppressed, since dismissing one
 * notification's text is not evidence about whatever the same slot carries
 * next, and the cost of letting it back in is only a capture the owner
 * dismisses again.
 */
export async function hasUnsettledCaptureFor(
  androidKey: string,
  contentHash: string,
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM notification_captures
      WHERE android_key = ?
        AND content_hash = ?
        AND status IN ('pending', 'unreadable', 'accepted');`,
    androidKey,
    contentHash,
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
