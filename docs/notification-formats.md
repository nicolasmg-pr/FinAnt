# Notification formats

Android only, and permanently so: iOS has no API that lets an app read another
app's notifications. What is documented here is the wording of the push
notifications the owner's own bank apps post on their phone, one section per
bank, and the parser in `packages/importers/src/notifications/` that reads it.

Each section is written from real notification text the owner supplies, placed
in `fixtures/private/` (gitignored), and never from a guess — the same rule
`docs/import-formats.md` applies to a bank's column layout, and it matters more
here. A statement file at least announces its own header row; notification text
is unversioned, changes without notice, and a parser written from an imagined
string quietly turns a payment into the wrong amount, the wrong side, or a row
in the wrong account. Test fixtures are hand-written from the wording recorded
in this file, so a template can be tested in plain node without a real
notification ever entering the repository.

A parser that no longer recognises a notification must report it `unreadable`
rather than fall back to a guess: the capture keeps its text in the inbox, and
that text is the bug report the next fix is written from.

## Documented formats

**No formats are documented yet.** `NOTIFICATION_PARSERS` in
`packages/importers/src/notifications/registry.ts` is deliberately empty, so
every notification from an allowed source currently lands in the inbox as
`unreadable`, with its text kept for the owner to read. The banks expected to
fill this file are Trade Republic, ING Deutschland, DKB and Openbank España;
Raisin posts no amount-bearing notification and is out of scope.

## What a section records, once a bank has one

- The Android package name of the app, as learning mode reported it — never
  guessed from the bank's domain.
- The notification title and body, verbatim, for each kind the bank posts: a
  card payment, an incoming transfer, a direct debit, and whatever the bank
  sends that is deliberately not money (a login alert, "your statement is
  ready") so the parser can return `ignored` instead of filling the inbox.
- Which wording sets `side`, stated per template. It is never inferred from the
  sign: a refund is a positive amount on the expense side.
- The decimal and thousands convention, and the currency symbol or code, as
  they appear in the text.
- The discriminator a notification carries when one app covers several accounts
  — a card's last four digits, an account nickname, the word "Visa" — which is
  what `notification_routes.match_json` matches on.
