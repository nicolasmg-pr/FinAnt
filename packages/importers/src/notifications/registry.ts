import type { CapturedNotification, NotificationParseResult, NotificationParser } from './types';

/**
 * Every shipped notification parser, one per bank per notification shape.
 *
 * Empty until a real notification string exists to write a template from. A
 * bank's push wording is unversioned and changes without notice, so guessing
 * one would be worse than having none: a wrong template files a movement under
 * a wrong amount, while a missing one just says "I could not read this".
 *
 * See `docs/notification-formats.md`.
 */
export const NOTIFICATION_PARSERS: readonly NotificationParser[] = [];

/**
 * Runs the parsers registered for a notification's package.
 *
 * A `movement` or an `ignored` verdict ends the search. If every parser for the
 * package fails, the first reason is reported, so the inbox can say what went
 * wrong rather than only that something did.
 */
export function parseNotification(
  input: CapturedNotification,
  parsers: readonly NotificationParser[] = NOTIFICATION_PARSERS,
): NotificationParseResult {
  let firstReason: string | null = null;

  for (const parser of parsers) {
    if (parser.packageName !== input.packageName) continue;
    const result = parser.parse(input);
    if (result.kind !== 'unreadable') return result;
    firstReason ??= result.reason;
  }

  return { kind: 'unreadable', reason: firstReason ?? 'no-parser' };
}
