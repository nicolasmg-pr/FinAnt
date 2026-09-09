import {
  captureHashOf,
  contentHashOf,
  localCalendarDay,
  parseNotification,
  type DraftTransaction,
  type ParsedMovement,
} from '@finant/importers';
import { importHashOf, money, resolveRoute } from '@finant/core';
import NotificationCapture from '../../modules/notification-capture';
import {
  getCapture,
  hasUnsettledCaptureFor,
  insertCapture,
  setCaptureStatus,
} from '../db/notification-captures-repo';
import {
  allowedPackageNames,
  getNotificationSourceByPackage,
  listNotificationRoutes,
} from '../db/notification-sources-repo';
import { resolveTransactionIdByHash } from '../db/transactions-repo';
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
 * Four other exits besides the plain write: a notification from a disabled
 * source is dropped before anything is read; a repost — Android's own key
 * together with the same content fingerprint, already on a `pending`,
 * `unreadable` or `accepted` row — is dropped before the insert; a duplicate
 * (same hash already stored) is dropped after the `INSERT OR IGNORE` reports
 * no row; and a `movement` verdict on a source with `autoApprove` set goes
 * straight on into `acceptCapture`.
 *
 * Never logs any part of the notification.
 */
export async function recordCapture(raw: RawCapture): Promise<void> {
  const source = await getNotificationSourceByPackage(raw.packageName);
  // The native allowlist is a projection of the database, so a source the
  // owner disabled between the two can still reach here. The database decides.
  if (!source || !source.enabled) return;

  // contentHashOf ignores post time entirely, unlike captureHash below, which
  // is exactly what a repost changes and what captureHash cannot see past.
  // Computed here, before anything is written, and passed to
  // hasUnsettledCaptureFor rather than the raw title/body: an `accepted` row
  // has already had its own title and body NULLed by setCaptureStatus, so the
  // stored content_hash is the only thing left to compare a repost against.
  const contentHash = contentHashOf({
    packageName: raw.packageName,
    title: raw.title,
    body: raw.body,
  });

  // Checked before anything is written, because with `autoApprove` on the
  // insert is one step from a duplicate movement. `pending`, `unreadable` and
  // `accepted` rows all match the same way — same key, same content hash —
  // which is also what keeps the match safe: a bank reusing this notification
  // slot for a later, unrelated payment writes different wording, so a
  // different content hash, so it is never mistaken for a repost regardless
  // of the earlier row's status. A genuinely re-worded notification ("payment
  // pending" becoming "payment completed") differs the same way and lands as
  // a second, distinct capture on purpose.
  if (raw.androidKey !== null && (await hasUnsettledCaptureFor(raw.androidKey, contentHash)))
    return;

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
    contentHash,
    status:
      parsed.kind === 'movement'
        ? 'pending'
        : parsed.kind === 'ignored'
          ? 'dismissed'
          : 'unreadable',
    parserId: parsed.kind === 'unreadable' ? null : parsed.parserId,
    parsed: parsed.kind === 'movement' ? parsed.movement : null,
  });

  // Already seen: a byte-identical re-delivery, or a settled capture —
  // accepted, or dismissed, including every `ignored` one — whose tombstone
  // still holds this hash. A repost is a different hash and was caught above.
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
 * The insert and the status update are two writes, not one transaction:
 * `ingest` opens its own `withTransactionAsync` inside `insertTransactions`,
 * and SQLite has no nested transaction to wrap that in. What makes the gap
 * safe is that the recovery is exact rather than that the window is closed.
 * If the process dies between them the capture stays `pending` with a null
 * `transaction_id`, and the next accept re-runs the same draft: the unique
 * import hash makes the insert a no-op, `resolveTransactionIdByHash` finds the
 * row that was already written — following `superseded_by_id` if a statement
 * has since retired it — and the status update completes. No second movement
 * can be written, because the hash is deterministic in the capture.
 *
 * @returns the movement's id, or null when the capture could not be routed to
 *   an account — which leaves it pending, for the owner to fix the routes.
 */
export async function acceptCapture(captureId: string): Promise<string | null> {
  const capture = await getCapture(captureId);
  if (!capture || capture.parsed === null || capture.sourceId === null) return null;
  // Settled already: nothing to accept a second time.
  if (capture.status !== 'pending' || capture.transactionId !== null) return null;

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

  const writtenId = await resolveTransactionIdByHash(route.accountId, draft.importHash);
  await setCaptureStatus(captureId, 'accepted', writtenId);
  return writtenId;
}

/**
 * Accepts a capture the owner edited before saving.
 *
 * Same contract as `acceptCapture`, but the draft comes from the movement
 * form rather than from the parser: the owner may have corrected the amount,
 * the date or the account. The movement is still provisional — editing what a
 * notification said is not the bank booking it — and the capture is still
 * settled against the row that was written, so it cannot be accepted twice.
 *
 * The pre-check matters more here than in `acceptCapture`. An edit may change
 * a hashed field — the amount, the date, the account — while the capture-hash
 * discriminator stays the same, so a second run of an already-settled capture
 * would produce a *different* import hash and therefore a second provisional
 * movement for one notification. Re-reading the capture and refusing anything
 * but a still-pending, unsettled row is what stops that.
 *
 * The insert and the status update are two writes for the same reason as in
 * `acceptCapture`, with the same recovery.
 */
export async function acceptEditedCapture(
  captureId: string,
  draft: DraftTransaction,
): Promise<string | null> {
  const capture = await getCapture(captureId);
  if (!capture) return null;
  if (capture.status !== 'pending' || capture.transactionId !== null) return null;

  await ingest([draft], { provisional: true });

  const writtenId = await resolveTransactionIdByHash(draft.accountId, draft.importHash);
  await setCaptureStatus(captureId, 'accepted', writtenId);
  return writtenId;
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
