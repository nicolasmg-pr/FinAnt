import {
  captureHashOf,
  localCalendarDay,
  parseNotification,
  type DraftTransaction,
  type ParsedMovement,
} from '@finant/importers';
import { importHashOf, money, resolveRoute } from '@finant/core';
import NotificationCapture from '../../modules/notification-capture';
import { getCapture, insertCapture, setCaptureStatus } from '../db/notification-captures-repo';
import {
  allowedPackageNames,
  getNotificationSourceByPackage,
  listNotificationRoutes,
} from '../db/notification-sources-repo';
import { findTransactionByHash } from '../db/transactions-repo';
import { ingest } from '../services/ingest';

/** One notification, exactly as the native listener passes it. */
export interface RawCapture {
  readonly packageName: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly postedAtMillis: number;
  readonly androidKey: string | null;
}

/**
 * Writes a captured notification into the encrypted database.
 *
 * This is the whole background path: nothing is stored anywhere else on the
 * way, which is what keeps the security model's promise that a narrative rests
 * only inside SQLCipher. The cost is that a notification lost here — the
 * process killed mid-write — is lost silently. Nothing ends up wrong, because
 * the statement import still books the movement; it just does not appear early.
 *
 * Three other exits besides the plain write: a notification from a disabled
 * source is dropped before anything is read; a duplicate (same hash already
 * stored) is dropped after the `INSERT OR IGNORE` reports no row; and a
 * `movement` verdict on a source with `autoApprove` set goes straight on into
 * `acceptCapture`.
 *
 * Never logs any part of the notification.
 */
export async function recordCapture(raw: RawCapture): Promise<void> {
  const source = await getNotificationSourceByPackage(raw.packageName);
  // The native allowlist is a projection of the database, so a source the
  // owner disabled between the two can still reach here. The database decides.
  if (!source || !source.enabled) return;

  const postedAt = new Date(raw.postedAtMillis);
  const bookingDate = localCalendarDay(raw.postedAtMillis, postedAt.getTimezoneOffset());
  const captureHash = captureHashOf({
    packageName: raw.packageName,
    title: raw.title,
    body: raw.body,
    postedAtMillis: raw.postedAtMillis,
  });

  const parsed = parseNotification({
    packageName: raw.packageName,
    title: raw.title,
    body: raw.body,
    bookingDate,
    postedAtMillis: raw.postedAtMillis,
  });

  const captureId = await insertCapture({
    sourceId: source.id,
    packageName: raw.packageName,
    postedAt: postedAt.toISOString(),
    bookingDate,
    // An `ignored` notification is recognised as deliberately not money, so
    // its row exists only as a tombstone holding the hash: keeping its text
    // would mean storing a bank's marketing indefinitely, and the table's
    // contract is that a settled capture forgets its narrative. `pending` and
    // `unreadable` keep their text — the owner is about to review the former,
    // and the latter's text *is* the bug report — until `setCaptureStatus`
    // nulls it on accept or dismiss.
    title: parsed.kind === 'ignored' ? null : raw.title,
    body: parsed.kind === 'ignored' ? null : raw.body,
    androidKey: raw.androidKey,
    captureHash,
    status:
      parsed.kind === 'movement'
        ? 'pending'
        : parsed.kind === 'ignored'
          ? 'dismissed'
          : 'unreadable',
    parserId: parsed.kind === 'unreadable' ? null : parsed.parserId,
    parsed: parsed.kind === 'movement' ? parsed.movement : null,
  });

  // Already seen: Android reposts an updated notification, and a settled
  // capture — accepted, or dismissed, including every `ignored` one — leaves
  // a tombstone holding its hash.
  if (captureId === null) return;

  if (parsed.kind === 'movement' && source.autoApprove) {
    await acceptCapture(captureId);
  }
}

/**
 * Turns a pending capture into a provisional movement.
 *
 * The provisional flag stays set afterwards: the owner agreeing with what the
 * notification said is not the bank having booked it. Only a statement row can
 * settle that, through `reconcileProvisionals`.
 *
 * @returns the movement's id, or null when the capture could not be routed to
 *   an account — which leaves it pending, for the owner to fix the routes.
 */
export async function acceptCapture(captureId: string): Promise<string | null> {
  const capture = await getCapture(captureId);
  if (!capture || capture.parsed === null || capture.sourceId === null) return null;

  const routes = await listNotificationRoutes(capture.sourceId);
  const text = [capture.title, capture.body].filter(Boolean).join(' ');
  const route = resolveRoute({ text, amountMinor: capture.parsed.amountMinor }, routes);
  if (!route) return null;

  const draft = draftFrom(
    capture.parsed,
    route.accountId,
    capture.bookingDate,
    capture.captureHash,
  );
  await ingest([draft], { provisional: true });

  const written = await findTransactionByHash(route.accountId, draft.importHash);
  await setCaptureStatus(captureId, 'accepted', written?.id ?? null);
  return written?.id ?? null;
}

export async function dismissCapture(captureId: string): Promise<void> {
  await setCaptureStatus(captureId, 'dismissed', null);
}

function draftFrom(
  movement: ParsedMovement,
  accountId: string,
  bookingDate: string,
  captureHash: string,
): DraftTransaction {
  return {
    accountId,
    bookingDate,
    valueDate: null,
    amount: money(movement.amountMinor, movement.currency),
    side: movement.side,
    description: movement.description,
    counterparty: movement.counterparty,
    reference: null,
    suggestedCategoryId: null,
    source: 'notification',
    // Push text carries no bank transaction id, ever.
    externalId: null,
    importHash: importHashOf({
      accountId,
      bookingDate,
      amountMinor: movement.amountMinor,
      description: movement.description,
      // Stable per notification, so two identical coffees an hour apart stay
      // two movements rather than collapsing into one.
      discriminator: captureHash,
    }),
    notes: null,
  };
}

/**
 * Pushes the database's allowlist into the native preferences the listener
 * reads while the app is closed. Call after any change to a source.
 */
export async function syncAllowedPackages(): Promise<void> {
  if (!NotificationCapture.isSupported()) return;
  NotificationCapture.setAllowedPackages(await allowedPackageNames());
}
