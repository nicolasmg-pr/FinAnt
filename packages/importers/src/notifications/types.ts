import { fnv1aHash, type CurrencyCode, type TransactionSide } from '@finant/core';

/**
 * One notification, as it reached JavaScript from the native listener.
 *
 * There is no `accountId` here: which account a notification is about is
 * decided by the routing rules in `@finant/core`, after parsing, because the
 * discriminator (a card's last four digits, an account nickname) lives in the
 * text a parser has to read first.
 */
export interface CapturedNotification {
  readonly packageName: string;
  readonly title: string | null;
  readonly body: string | null;
  /** Device-local calendar day, already derived. See `localCalendarDay`. */
  readonly bookingDate: string;
  /** Epoch millis as Android reported it. Display and dedupe only, never a date. */
  readonly postedAtMillis: number;
}

export interface ParsedMovement {
  /** Signed minor units. Negative for money out, as everywhere else. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /**
   * Set explicitly by the parser from the notification's own wording, never
   * inferred from the sign: a refund is a positive amount on the expense side.
   */
  readonly side: TransactionSide;
  readonly description: string;
  readonly counterparty: string | null;
}

/**
 * Three verdicts, and the difference between the last two is the point.
 *
 * `ignored` is a notification a parser recognised as deliberately not money —
 * "your statement is ready", a login alert — so the inbox stays clean.
 * `unreadable` is the alarm: a bank changed its wording, or none of our
 * templates has ever seen this shape. It is kept for the owner to look at,
 * because that text is the bug report.
 */
export type NotificationParseResult =
  | { readonly kind: 'movement'; readonly parserId: string; readonly movement: ParsedMovement }
  | { readonly kind: 'ignored'; readonly parserId: string }
  | { readonly kind: 'unreadable'; readonly reason: string };

export interface NotificationParser {
  /** Stable id, stored on the capture so a wording change can be traced. */
  readonly id: string;
  readonly packageName: string;
  parse(input: CapturedNotification): NotificationParseResult;
}

/**
 * Identity of a captured notification, so Android reposting an updated
 * notification cannot create a second movement.
 *
 * Deliberately excludes `bookingDate`, which is derived from `postedAtMillis`
 * and would add nothing, and deliberately includes `postedAtMillis`, so two
 * identical coffees bought an hour apart stay two movements.
 *
 * Fields are length-prefixed before joining because the delimiter can
 * legitimately appear inside a notification's text; without length prefixes,
 * two different notifications could produce the same payload.
 */
export function captureHashOf(input: {
  readonly packageName: string;
  readonly title: string | null;
  readonly body: string | null;
  readonly postedAtMillis: number;
}): string {
  const fields = [
    input.packageName,
    String(input.postedAtMillis),
    input.title ?? '',
    input.body ?? '',
  ];
  return fnv1aHash(fields.map((field) => `${field.length}:${field}`).join('|'));
}

/**
 * The one sanctioned timestamp-to-date conversion in this codebase.
 *
 * Android hands us `postTime` as epoch milliseconds and there is no way around
 * it. Everywhere else a booking date is a plain `YYYY-MM-DD` string precisely
 * because routing one through a Date moves 1 March into February west of UTC.
 * So the conversion happens once, here, at the edge, and nothing downstream
 * ever derives a date from a timestamp again.
 *
 * @param offsetMinutes the value of `new Date(millis).getTimezoneOffset()` —
 *   minutes behind UTC, positive west of it. Passed in rather than read here so
 *   this stays a pure function that can be tested without changing TZ.
 */
export function localCalendarDay(millis: number, offsetMinutes: number): string {
  const shifted = new Date(millis - offsetMinutes * 60_000);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
