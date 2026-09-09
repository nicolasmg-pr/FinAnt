# Data model

SQLite (SQLCipher), schema in `apps/mobile/src/db/schema.ts`. Migrations are
append-only and applied in order on launch; `PRAGMA user_version` tracks state.

## Money

Amounts are **signed integer minor units** (`amount_minor`) plus an ISO 4217
`currency`. Negative is money out. No float ever touches a balance: `0.1 + 0.2`
is not an acceptable rounding story for someone's rent. Conversion and formatting
live in `packages/core/src/money.ts`.

## Ledger side

Every transaction carries `side` (`income` | `expense`) as well as its signed
`amount_minor`. Sign alone cannot express a refund: a EUR 20 restaurant refund
is a **positive** amount that belongs on the **expense** side, where it reduces
the month's spending. A hand-kept ledger and a card statement both treat it that
way, and counting it as income leaves the net right while making both totals
wrong.

`summariseMonth()` therefore groups by `side` and sums signed within it, flipping
the expense side to a positive magnitude at the end. A source that states the
side explicitly passes its own value (the ledger block in a workbook import,
`CdtDbtInd` in camt.053, a debit/credit column pair in a CSV); a source that
only gives a signed amount uses `sideFromAmount()`.

## Tables

- `accounts` — one row per bank account the owner imports statements for, plus
  one local "My records" account that owns manual entries and the tracker
  workbook. Every one of them has `provider = 'file-import'`; "My records" is
  the oldest, created before the import screen can offer "New account". `iban`
  is set when the account was created from a camt.053 statement and is how the
  next statement from that bank preselects it. Migration 3 dropped the
  aggregator consent columns; `provider` now only ever holds a
  `TransactionSource`.
- `institutions` — the banks the owner holds accounts with. See banks and
  balances below.
- `transactions` — the ledger. See dedupe, soft delete and transfers below.
- `categories` — shipped taxonomy plus any the owner adds. **This table is what
  the screens render**, not the `BUILT_IN_CATEGORIES` constant. Ids are stable
  and never renamed; rules and history point at them. See below.
- `rules` — categorisation rules, `match_json` holding a `RuleMatch` tree.
  Shipped rules sit at priority 100-400, rules learned from a manual correction
  at 1000, so a correction always wins.
- `exclusion_rules` (migration 7) — standing instructions to keep a kind of
  movement out of the statistics. See below.
- `budgets` — monthly limit per category.
- `import_profiles` — user-defined column mappings for file import.
- `settings` — key/value: locale, main currency, app lock, last import account.
- `notification_sources` (migration 9) — one row per bank app the owner has
  allowed to feed the ledger: its package name, the label the owner gave it,
  and whether it auto-approves what it sends.
- `notification_routes` (migration 9) — which account a source's notifications
  book to, keyed by the same `RuleMatch` discriminator `rules.match_json`
  uses, with at most one nullable fallback route per source.
- `notification_captures` (migration 9) — the inbox: one row per notification
  read from an allowed source, from first sight through parsing to acceptance
  or dismissal, deduplicated by a hash of its own text and post time. See
  Migration 9 below.

## Categories

`BUILT_IN_CATEGORIES` in `packages/core/src/categories.ts` is the shipped seed
and the fallback the launch sync writes from. Everything on screen comes from
the `categories` table, so the owner can add a category, rename one, recolour
one and hide the ones they never use.

**Ids are permanent.** `insurance` was relabelled "Other insurance" when
`insurance-health` and `insurance-car` were split out of it, and it kept its id:
shipped rules, budgets and years of movements point at it, and renaming it would
either orphan them or silently merge two different buckets of money. Rename the
label, never the id. Nothing reclassifies history either — movements already
filed under `insurance` stay there until the owner moves them.

### Migration 8

`position INTEGER NOT NULL DEFAULT 0` is the render order. The shipped taxonomy
is grouped by meaning rather than alphabetically, and a category the owner adds
has to be able to sit somewhere in that order. The backfill spells out the ids
as literals instead of generating them from `BUILT_IN_CATEGORIES`: a migration
has to produce the same result on a device replaying it three releases late, and
a generated one would change under it.

`customised INTEGER NOT NULL DEFAULT 0` marks a shipped category whose name,
colour or icon the owner has edited. Without it the launch sync would put the
shipped values straight back the next time the app opened.

### `syncBuiltInCategories()`

Runs on every launch, straight after the migrations, and upserts each shipped
category by id. It replaces the category half of `seed()`, which returned early
the moment the table held a row — which is why a category shipped in a later
release never reached a device that had already been seeded.

It refreshes `kind`, `parent_id`, `position` and `built_in` unconditionally, and
`label_key`, `name`, `color`, `icon` only while `customised = 0`. Three things it
deliberately never does:

- it never writes `archived`, so a category the owner hid stays hidden;
- it never deletes, so a category the owner created is left alone, and a shipped
  id dropped from a future release keeps its history;
- it never overwrites an edit of the owner's, per `customised` above.

Rules keep the once-only seeding. A shipped rule the owner disabled, or a
learned rule that now outranks it, must not be re-installed behind them — so a
rule added in a later release, unlike a category, still only reaches a fresh
install.

### Ids of categories the owner creates

Every one is `user-` plus a UUID, and no shipped id starts with `user-`. That
reservation is what guarantees a category the owner adds today can never collide
with a category a future release ships — a collision would merge two unrelated
buckets on the next launch, and there would be no way to tell them apart
afterwards, because ids are never renamed.

A category the owner created has no `label_key`: its name _is_ its label, in
every language. `useCategoryLabel` falls back to the stored name. Renaming a
shipped category clears its `label_key` for the same reason; recolouring one
does not.

### Hiding, deleting and reassigning

A **built-in** category can only be hidden. `rules.category_id` is
`ON DELETE CASCADE`, so deleting one would take the shipped rules that classify
half the statement with it, and orphan the history filed under it. The screen
offers "Hide", not "Delete", and says why. A hidden category leaves every picker
and still renders on the movements that carry it.

A **user** category with no movements is deleted outright.

A **user** category with movements makes the owner pick a replacement first. The
reassignment and the delete run in one `withTransactionAsync`, reassignment
first. `transactions.category_id` is `ON DELETE SET NULL`: deleting the category
out from under its movements would silently uncategorise every one of them,
which is exactly what this flow exists to prevent. Soft-deleted movements are
reassigned too. Rules pointing at the category go with it, and the confirmation
says how many.

### Shipped rules reach an existing device too

`syncDefaultRules()` runs alongside `syncBuiltInCategories()` on every launch
and inserts the shipped rules the database does not already hold. Installing
them once, on a fresh database, was why the two insurance rules would have
arrived on an already-seeded device with no rule able to fire.

It never rewrites an existing rule: a shipped rule the owner disabled or
re-pointed stays as they left it. And it never brings a deleted one back —
`deleteRule` writes the id into the `retiredShippedRules` setting when it
belongs to the shipped set, and the install skips anything tombstoned. Without
that, a plain `INSERT OR IGNORE` over `DEFAULT_RULES` would resurrect a deleted
rule on every launch, forever. A learned rule leaves no tombstone, because
nothing would ever reinstall it.

The tombstones are read straight off the handle being opened rather than
through `settings-repo`: the sync runs inside `open()`, and anything calling
`getDatabase()` from there would await the very open it is part of.

## Banks and balances

A **bank groups accounts**; the balance itself lives on the account, because
that is where the movements are. The bank view sums its accounts.

`institutions` (migration 6) is `id`, `name`, `created_at`. `accounts.institution_id`
has existed as a plain TEXT column since migration 1 and now holds an
`institutions.id`. It stays a plain column: SQLite cannot add a `REFERENCES`
clause to an existing column without rebuilding the table, and rebuilding the
accounts table — which the whole ledger points at — is not worth it for a
constraint `institutions-repo.ts` already enforces. Deleting a bank unassigns
its accounts; an account is never deleted with it, because it owns movements.
Migration 6 backfills one institution per distinct `institution_name` and points
those accounts at it; accounts with no name stay unassigned.

Migration 6 also adds three nullable columns to `accounts`:

- `balance_minor` — what the owner asserted the account holds, in minor units.
- `balance_date` — the day `YYYY-MM-DD` that claim was made about.
- `opening_balance_minor` — legacy, unread. It held a derived opening balance
  while balances were computed forwards from one; nothing writes or reads it
  now, and it stays because migrations are append-only.

`balance_minor` and `balance_date` are null for an account whose balance was
never asserted; it shows no figure rather than a wrong zero.

### The anchor is the truth

FinAnt talks to no bank, so nothing tells it what an account holds. The owner
asserts "this account holds `B` on `D`", once, when they add the account. That
assertion is the whole truth about the account, and every other figure is
measured from it:

```
balance as of X, X >= D:  B + Σ(movements with D < bookingDate <= X)
balance as of X, X <  D:  B - Σ(movements with X < bookingDate <= D)
```

A movement dated on or before `D` is therefore _already inside_ `B`. Asking for
an earlier day runs the ledger backwards, which is how an account anchored once
— today — still reports what it held in January. `openingBalance()` is that
walk taken all the way to the first movement: the figure that makes the imported
statements add up to what the owner says they have.

**Nothing derived is stored, and the assertion is never recomputed.** An
earlier version stored the derived opening balance and added every movement on
top of it:

```
O = B - Σ(movements <= D)          # computed once, at the moment of assertion
balance as of X = O + Σ(movements <= X)
```

That is wrong the moment history arrives after the assertion. An owner asserted
272,19 € held today and then imported the year's statements — 1068,45 € of net
spending, all dated before today — and the account reported **-796,26 €**. The
app then showed a "drift" warning asking them to re-anchor, which is the app
arguing with the one fact it was given. The owner's rule, and now the model's:
_if I write a balance for today, that is the balance I have today._ The drift
concept and `reconcileAnchor()` are gone with it.

**Excluded rows and internal transfers are counted.** `countsTowardStats()`
governs statistics, not balances: moving 200 € to a savings account leaves the
current account 200 € lighter whatever the charts decide to show.

### The total, and how it moves

`packages/core/src/networth.ts` sums the anchored accounts into one figure and
one line. `netWorthSeries()` takes every account with its anchor and its own
movements and reports the total standing at the end of each period, at month or
year granularity — forwards from the anchor for a later period, backwards for
an earlier one.

Two rules keep the figure honest:

- **An account with no anchor is skipped, not counted from zero.** It is
  reported in `accountsSkipped` and the dashboard names how many were left out.
  Counting it from zero would understate the total by whatever it opened with,
  and understating is the one direction a balance must not err in.
- **An account in another currency is skipped too.** FinAnt holds no exchange
  rate and will not invent one.

The period `today` falls in closes on `today`, not on its last calendar day: a
movement already imported with a later date this month is real, but it is not
money the owner has now.

The projected tail is not computed here. The dashboard passes the whole future
months of `forecastYear()` in as `projected`, and this module runs their net
forward from the total held today, marking those points `projected`; the chart
draws them as a run of grains rather than a solid line. The current month is
never passed in — its remainder is already inside the balance held today, and
adding it again would count it twice.

## How a rule matches

`RuleMatch` has three text kinds, and the difference between two of them cost a
year of statements their classification.

- **`word`** — whole-word containment against the normalised narrative, which
  is what a merchant token wants. This is what `contains()` in
  `default-rules.ts` builds, despite its name.
- **`contains`** — substring. Correct only for German compound nouns:
  `Hausratversicherung`, `Stromabschlag` and `Gehaltsabrechnung` are single
  words that a match on `versicherung`, `strom` or `gehalt` must still find.
  Built by `compound()`, and only long, unambiguous nouns belong in it.
- **`startsWith`** — anchored prefix, unused by shipped rules.

The rule that made the distinction matter: `rwe` was a substring token for the
energy supplier, and `Überweisung` normalises to `uberweisung`, which contains
it. Every German transfer in the owner's statement — 66 movements, EUR 34,046 —
was filed as electricity. Short tokens as substrings are the trap; `eon`, `gas`,
`bar` and `dia` were all one narrative away from the same thing.

`recategorise()` carries a correction like that to movements already imported;
Settings offers it as "Re-apply the rules". It skips anything the owner
classified by hand and anything the transfer matcher paired, because neither
got its category from a rule.

## Adding a movement by hand

`app/movement/new.tsx`, reached from the **+** in the movements tab header. It
writes nothing directly: the draft goes through `ingest()`, the same door a
statement uses, so a manual movement is categorised by the same rules, matched
against the same internal transfers and filtered by the same exclusion rules as
an imported one.

Two details worth knowing:

- **Direction is chosen, not derived.** The form asks for income or expense and
  `signedAmountFor()` produces the signed amount from it. A "refund or
  repayment" switch is what makes the awkward half of the model reachable: a
  positive amount that stays on the _expense_ side, where it reduces the
  month's spending instead of inflating its income. Its income-side mirror is
  money taken back off a salary — negative, still income.
- **A manual row is never deduplicated against another.** Its `import_hash`
  carries a fresh discriminator, so two identical coffees entered on the same
  day are two movements. Typing a movement is a deliberate act; a statement
  re-import is not, which is why only the latter needs collapsing.

A category picked on the form is the owner's own classification and is trusted
over the rule engine, exactly as a category that arrived with a file is.
Leaving it blank lets the rules decide.

## Dedupe

Enforced by the database, not by application discipline:

```sql
CREATE UNIQUE INDEX idx_tx_external ON transactions(account_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX idx_tx_hash ON transactions(account_id, import_hash);
```

- `external_id` is the bank's own transaction id when the statement carries one
  (camt.053 `EndToEndId`) — the reliable key when present.
- `import_hash` is an FNV-1a hash of `account | booking date | amount | normalised
description | discriminator`, for file imports, which have no stable id.
- The **discriminator** separates rows a source repeats verbatim. A hand-kept
  sheet can legitimately list `comida fuera 20.00` three times in one month;
  without it all three collapse to one hash and two real movements are swallowed.
  It is an occurrence counter among identical rows, not a row number — a row
  number shifts when a row is inserted above, which would make every row below
  re-import as new.

Inserts use `INSERT OR IGNORE` and count `changes` to report what was new. A
re-imported statement, or two exports whose date ranges overlap, therefore cannot
double a figure.

## Deleting a movement

`deleted_at` (migration 4) marks a movement the owner removed. The row stays in
the table so `idx_tx_hash` and `idx_tx_external` keep holding its identity: the
next overlapping statement import hits `INSERT OR IGNORE` and reports it as a
duplicate instead of bringing it back. Every read in
`apps/mobile/src/db/transactions-repo.ts` filters `deleted_at IS NULL`, and the
domain `Transaction` type never carries the column.

## Transfers between own accounts

A move of 50 € from one of the owner's accounts to another books as −50 € in
the first and +50 € in the second. Neither is income or expense.
`matchTransfers()` in `packages/core/src/transfers.ts` pairs them: different
accounts, same currency, exactly opposite amounts, booked within
`TRANSFER_MAX_DAYS` (3) of each other, neither categorised by hand, neither
excluded, neither already paired. Debits are visited by date then id and each
takes the closest unmatched credit, so the result is deterministic and
one-to-one.

`transfer_peer_id` (migration 5) holds the other half's id on both rows, and
both rows are set to `transfer-internal` with `category_source = 'auto'`. That
category already fails `countsTowardStats()`, so totals need no new rule; the
link is what lets the detail screen show the counterpart.

`detectTransfers()` (`apps/mobile/src/services/transfers.ts`) runs the matcher
over the whole ledger after every import and once on app start: the second
half usually arrives later, in a statement from the other bank. It is
idempotent because linked rows are never candidates again.

Changing the category of a linked row by hand clears `transfer_peer_id` on
both rows. The other side keeps `transfer-internal` and is not re-paired,
because the row the owner touched is now `manual` and off limits to the
matcher. If the other side was wrong too, the owner fixes it by hand. There is
no manual pairing UI for transfers the matcher misses.

## What is excluded from statistics

`countsTowardStats()` in `packages/core/src/aggregate.ts` drops:

- rows with `excluded_from_stats = 1` (the owner's own call), and
- anything categorised `transfer-internal`.

Counting a transfer to one's own savings account as an expense makes every net
figure and every forecast wrong.

## Exclusion rules

```sql
CREATE TABLE exclusion_rules (
  id TEXT PRIMARY KEY NOT NULL,
  match_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  learned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Excluding one movement flips `excluded_from_stats` on that row and nothing
else. "Apply to all similar" additionally records an **exclusion rule**, so the
movements already on record are flagged in one pass and the ones a future
import brings in are flagged on arrival.

**Exclusion affects statistics only.** It never changes an amount, a side, a
category or an account balance: the movement stays in the ledger exactly as the
bank booked it, and only `countsTowardStats()` looks away.

### Why its own table, not a `rules` row

A `CategoryRule` answers "what is this"; an `ExclusionRule` answers "does this
count". Fitting the second into `rules` would mean making `category_id`
nullable — and that column is `NOT NULL` with a foreign key onto `categories`,
which is what stops a categorisation rule from pointing at a category that no
longer exists. Weakening it for every shipped rule to store a different kind of
row is a bad trade, and every read of `rules` would then have to remember to
filter out the rows that are not categorisations at all. There is no `priority`
either: exclusion is not a contest between rules, so any enabled rule that
matches is enough.

Both kinds share the same `RuleMatch` tree and the same matcher (`matches()` in
`packages/core/src/categorise.ts`), so a narrative is normalised — diacritics
stripped, case folded — identically for both.

### Learning, matching, undoing

`packages/core/src/exclusion.ts`:

- `learnExclusionFrom(tx, idFactory)` builds a `contains` rule on the
  `merchantKey` of the counterparty (or the description). It returns `null`
  when that key is under four characters — the same gate as `learnRuleFrom`,
  because an exclusion learned from two characters silently swallows unrelated
  movements and is harder to notice than a wrong category.
- `shouldExclude(tx, rules)` is what `ingest()` runs over every draft before
  insert, so a covered movement never spends a month inside a total. The import
  result reports the count as `autoExcluded`.
- `similarTo(txs, rule)` lists what a rule covers, so the movement screen can
  show the count _before_ the owner commits and again before they take it back.
  It is pure over what it is handed; the repository has already dropped
  soft-deleted rows.

Turning the switch back off deletes the rule **and** un-excludes its matches,
in that order, from the same screen. A rule left behind would silently
re-exclude the movement on the next import, however many times the owner
un-excluded the row by hand. Settings > Automatic exclusions lists every rule
with the merchant key it was learned from and can delete it; deleting there
stops future imports but deliberately leaves history alone.

## Migration 9: notification capture

Android only. A push notification from one of the owner's own bank apps is
parsed into a **provisional** movement — written immediately if the owner
turned on `auto_approve` for that source, or held in `notification_captures`
until the owner accepts it. Either way it is never the movement of record:
only a statement import or a manual entry produces one of those. See
`docs/security-model.md` for what the native listener can and cannot see.

`transactions` gains two nullable columns:

- `provisional` — `1` on a row written from a notification, `0` on every row a
  statement import or a manual entry produces. It stays `1` even after the
  owner accepts a pending capture by hand: agreeing with what a notification
  said is not the bank having booked it. Only reconciliation, below, clears
  it — by replacing the row, not by flipping the flag.
- `superseded_by_id` — set on a provisional the moment reconciliation replaces
  it, pointing at the row that won. The provisional is soft-deleted
  (`deleted_at`) in the same write, so the trail survives from "notification
  seen on Tuesday" to "row the bank actually booked" without a second table.

### Reconciliation

`packages/core/src/provisional.ts`, run from
`apps/mobile/src/services/reconcile.ts` inside `ingest()`, after insertion and
before `detectTransfers()` — a provisional and the statement row that later
books it would otherwise look like a transfer to that matcher.

A provisional and a booked row are candidates only if they share an account, a
currency and a `side`, and their `booking_date`s fall within 3 days of each
other. **The amount must match exactly; there is no tolerance band.** What the
bank booked is what the ledger shows, and a booked figure that differs from
the one the notification announced is a different fact, not a rounding of the
same one. The cost is explicit: a restaurant bill authorised at 42,30 and
booked at 43,50 with a tip added never reconciles, and both rows sit in the
ledger — the unconfirmed 42,30 and the booked 43,50 — until the owner clears
the leftover by hand, which the staleness check below eventually surfaces. A
tolerance band was considered and rejected: it buys tidiness by merging two
rows on a guess, and a wrong merge makes a real movement disappear, which is
worse than a visible leftover.

Assignment is greedy and one-to-one: each booked row takes the closest
matching provisional, ordered by date delta then by id, and each provisional
is consumed at most once. **An ambiguous match is never resolved by
guessing.** If two provisionals fit one booked row equally well, both stay
provisional and are left for the owner — picking one is how a real movement
quietly disappears.

There is no unique index behind any of this: a notification's `import_hash` is
built over its own narrative and a statement's over the bank's, so the two
rows never collide and no constraint can catch the pairing. That is why
reconciliation is explicit, reviewed code instead of a database rule, and why
`packages/core/tests/provisional.test.ts` is the most heavily tested file this
feature added.

### Stale provisionals

A declined authorisation, a released hotel hold, a notification accepted for a
payment that then failed — these leave a provisional no statement will ever
book. Left alone it would count in the totals forever, which is the one way
this feature could quietly make the ledger wrong.

Staleness is **derived, never stored**: `staleProvisionals()` in
`packages/core/src/provisional.ts` is recomputed from the ledger's own
coverage every time the inbox loads, over each account's latest imported
booking date and today's date — there is no `stale` column. A provisional
older than 45 days, on an account whose statements now reach past its own
booking date, is flagged; nothing deletes it, because a bank booking something
six weeks late is not impossible, and that is the owner's call to make. 45
days is deliberately longer than any card settlement cycle the owner's banks
use, so a slow booking is never mistaken for a dead one.

### The `posted_at` exception

`CLAUDE.md` forbids routing a booking date through a `Date`/timestamp, because
it moves 1 March into February west of UTC. `notification_captures.posted_at`
is the one column in this schema that touches a real timestamp, because
Android reports a notification's post time as epoch milliseconds and there is
no way to receive it as anything else.

The rule is honoured by converting exactly once, at the edge:
`localCalendarDay()` in `@finant/importers` derives the device's local
calendar day from that millisecond value the moment a notification is
captured, and it is that string — never `posted_at` — that is written to
`booking_date` and carried everywhere downstream. `posted_at` itself is kept
only for display and for the capture's dedupe hash, so that two identical
coffees bought an hour apart stay two captures; nothing downstream may ever
derive a date from it.
