import { describe, expect, it } from 'vitest';
import {
  captureHashOf,
  localCalendarDay,
  parseNotification,
  type CapturedNotification,
  type NotificationParser,
} from '../src/notifications/index';

const capture: CapturedNotification = {
  packageName: 'com.example.bank',
  title: 'Card payment',
  body: 'EUR 12.34 at REWE',
  bookingDate: '2026-03-10',
  postedAtMillis: 1772000000000,
};

const stub: NotificationParser = {
  id: 'example-card',
  packageName: 'com.example.bank',
  parse: (input) =>
    input.body?.includes('EUR')
      ? {
          kind: 'movement',
          parserId: 'example-card',
          movement: {
            amountMinor: -1234,
            currency: 'EUR',
            side: 'expense',
            description: 'REWE',
            counterparty: 'REWE',
          },
        }
      : { kind: 'ignored', parserId: 'example-card' },
};

describe('parseNotification', () => {
  it('reports an unreadable capture when no parser claims the package', () => {
    const result = parseNotification(capture, []);
    expect(result.kind).toBe('unreadable');
    expect(result.kind === 'unreadable' && result.reason).toBe('no-parser');
  });

  it('returns the movement a matching parser produced', () => {
    const result = parseNotification(capture, [stub]);
    expect(result.kind).toBe('movement');
    expect(result.kind === 'movement' && result.movement.amountMinor).toBe(-1234);
  });

  it('passes an ignored verdict through, so marketing does not raise an alarm', () => {
    const result = parseNotification({ ...capture, body: 'Your statement is ready' }, [stub]);
    expect(result.kind).toBe('ignored');
  });

  it('ignores parsers registered for another package', () => {
    const result = parseNotification({ ...capture, packageName: 'com.other.bank' }, [stub]);
    expect(result.kind).toBe('unreadable');
  });

  it('prefers a movement over an earlier parser that could not read it', () => {
    const blind: NotificationParser = {
      id: 'blind',
      packageName: 'com.example.bank',
      parse: () => ({ kind: 'unreadable', reason: 'wording-changed' }),
    };
    const result = parseNotification(capture, [blind, stub]);
    expect(result.kind).toBe('movement');
  });

  it('reports the first reason when every parser for the package fails', () => {
    const blind: NotificationParser = {
      id: 'blind',
      packageName: 'com.example.bank',
      parse: () => ({ kind: 'unreadable', reason: 'wording-changed' }),
    };
    const result = parseNotification(capture, [blind]);
    expect(result.kind === 'unreadable' && result.reason).toBe('wording-changed');
  });
});

describe('captureHashOf', () => {
  it('ignores the booking date, which is derived from the post time', () => {
    // Assigned to a typed variable first: passing the object literal inline
    // trips TypeScript's excess-property check, because captureHashOf's
    // parameter type deliberately has no bookingDate.
    const sameNotificationLaterDay: CapturedNotification = {
      ...capture,
      bookingDate: '2026-03-11',
    };
    expect(captureHashOf(capture)).toBe(captureHashOf(sameNotificationLaterDay));
  });

  it('differs when the text differs', () => {
    expect(captureHashOf(capture)).not.toBe(
      captureHashOf({ ...capture, body: 'EUR 12.35 at REWE' }),
    );
  });

  it('differs when the post time differs, so two identical coffees stay two', () => {
    expect(captureHashOf(capture)).not.toBe(
      captureHashOf({ ...capture, postedAtMillis: capture.postedAtMillis + 60_000 }),
    );
  });

  it('prevents collision when the delimiter falls at different places in title and body', () => {
    // Without length prefixes, these two would collide:
    // title "A", body "B|C" -> "com.example.bank|1772000000000|A|B|C"
    // title "A|B", body "C" -> "com.example.bank|1772000000000|A|B|C"
    const capture1 = {
      packageName: 'com.example.bank',
      title: 'A',
      body: 'B|C',
      postedAtMillis: 1772000000000,
    };
    const capture2 = {
      packageName: 'com.example.bank',
      title: 'A|B',
      body: 'C',
      postedAtMillis: 1772000000000,
    };
    expect(captureHashOf(capture1)).not.toBe(captureHashOf(capture2));
  });
});

describe('localCalendarDay', () => {
  it('keeps 1 March as 1 March in a zone ahead of UTC', () => {
    // 2026-03-01 00:30 in Madrid (UTC+1) is 2026-02-28 23:30 UTC.
    // getTimezoneOffset() reports -60 for UTC+1.
    expect(localCalendarDay(Date.UTC(2026, 1, 28, 23, 30), -60)).toBe('2026-03-01');
  });

  it('keeps 1 March as 1 March in a zone behind UTC', () => {
    // 2026-03-01 20:00 in New York (UTC-5) is 2026-03-02 01:00 UTC.
    expect(localCalendarDay(Date.UTC(2026, 2, 2, 1, 0), 300)).toBe('2026-03-01');
  });

  it('agrees with UTC when the offset is zero', () => {
    expect(localCalendarDay(Date.UTC(2026, 2, 10, 12, 0), 0)).toBe('2026-03-10');
  });
});
