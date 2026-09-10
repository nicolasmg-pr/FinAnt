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

**No parser exists yet for any bank.** `NOTIFICATION_PARSERS` in
`packages/importers/src/notifications/registry.ts` is deliberately empty, so
every notification from an allowed source currently lands in the inbox as
`unreadable`, with its text kept for the owner to read. The banks expected to
fill this file are Trade Republic, ING Deutschland, DKB and Openbank España;
Raisin posts no amount-bearing notification and is out of scope.

Trade Republic is the first with any wording confirmed by the owner — recorded
below — but it is still partial: one kind of notification has a confirmed type
line and no confirmed body, and the package name every parser is keyed on is
still unknown. No parser is written from a partial record;
`NOTIFICATION_PARSERS` stays empty until a bank's section is complete enough
to test against.

### Trade Republic

Confirmed by the owner from real notifications on their own device. The real
strings live in `fixtures/private/` (gitignored); what follows shows the shape
only — no real amount and no real name is recorded here.

- Language: Spanish.
- Amount format: decimal comma, `€` suffixed with no separating space (e.g.
  `12,34€` — that figure is illustrative, not from a real notification).
- Shape: not uniform across kinds. A transfer received and a plan execution
  carry the movement type on its own line, then a second line — one sentence —
  with the amount and the counterparty. A card purchase carries no movement
  type at all: the merchant stands on the first line, and the sentence follows
  it. Which of those lines Android reports as the title is an open question
  below.
- No notification carries a date. `bookingDate` therefore comes from
  `postedAtMillis` through `localCalendarDay` — the day the notification
  arrived on the device, which the owner confirms is the day of the movement.

**Incoming transfer** — confirmed

- Type line: `Transferencia recibida`
- Body shape: `Has recibido <amount>€ de <sender>`
  (the owner's real example filled in both `<amount>` and `<sender>`; neither
  is reproduced here, per this repo's rule against committing a real amount or
  a real name)

**Investment plan execution** — partially confirmed

- Type line: `Plan de inversión ejecutado`, confirmed verbatim.
- Body: not yet confirmed. Known only that it carries the amount spent and
  which instrument the plan bought — usually an ETF or Bitcoin.

**Card purchase** — confirmed

- Type line: none. Where the other two kinds name the movement, a card
  purchase names the merchant: `<merchant>`, alone on its own line.
- Body shape: `Gastaste <amount>€ en <merchant>` — the merchant repeated
  inside the sentence, so the same name is available whichever line turns out
  to be the title.
  (the owner's real example filled in `<amount>` and `<merchant>`; neither is
  reproduced here, per this repo's rule against committing a real amount or a
  real name)
- Sets `side` `expense` and a negative `amountMinor`, from the verb
  `Gastaste`. Never from the sign — a card refund, if this bank posts one,
  will be a positive amount on the same side, under wording not yet seen.
- `counterparty` is `<merchant>`.

**Open questions**

- Whether `Transferencia recibida` / `Plan de inversión ejecutado` is the
  whole title (`EXTRA_TITLE`), or whether "Trade Republic" is Android's own
  app label rendered ahead of it and not part of the extra at all — the
  owner's transcription began with "Trade Republic", which is exactly what a
  device-rendered label looks like, so this is not settled without checking
  the raw extra on a real device.
- Which line a card purchase reports as `EXTRA_TITLE`: the merchant, with
  "Trade Republic" being Android's own app label ahead of it, or "Trade
  Republic" itself, with the merchant and the sentence both inside
  `EXTRA_TEXT` separated by a newline. The owner's transcription carries all
  three lines and cannot settle the split; the raw extras on a real device
  can. A parser must not assume either until then.
- The Android package name. Unknown, and not to be guessed — this file's own
  rule, and the one `docs/import-formats.md` states for a bank's column
  layout. It has to come from `adb shell pm list packages` with the app
  installed, or from learning mode
  (`docs/superpowers/specs/2026-09-09-notification-capture-design.md`) on a
  real device.

**Routing note.** A transfer received and a plan execution plausibly post to
different accounts — cash versus the investment depot — so once a parser
exists, the type line `Plan de inversión ejecutado` (before the body is even
parsed) is a natural discriminator for a `notification_routes` rule that sends
plan executions to the depot and everything else to cash. It is not a
universal discriminator, though: a card purchase has no type line, so what
routes it is the absence of one, together with `Gastaste`. A rule keyed on the
type line alone would leave card purchases unrouted.

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
