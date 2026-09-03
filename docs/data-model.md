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
- `opening_balance_minor` — the opening balance derived from that claim.

All three are null for an account whose balance was never asserted; it shows no
figure rather than a wrong zero.

### The anchor

FinAnt talks to no bank, so nothing tells it what an account holds. The owner
asserts "this account holds `B` on `D`". `packages/core/src/balance.ts` turns
that into a fixed historical fact:

```
O = B - Σ(amount of every movement in the account with bookingDate <= D)
balance as of X = O + Σ(movements with bookingDate <= X)
```

The opening balance `O` is stored, not `B`: an opening balance does not change
when the next statement is imported, while a current balance does. By
construction the second line gives back exactly `B` for `X = D`.

**Excluded rows and internal transfers are counted.** `countsTowardStats()`
governs statistics, not balances: moving 200 € to a savings account leaves the
current account 200 € lighter whatever the charts decide to show.

### Drift

A later import can insert movements dated on or before `D` — history the anchor
already claimed to account for. `reconcileAnchor()` re-derives
`O' = B - Σ(movements <= D)` from the current ledger and reports
`driftMinor = O' - O`. Non-zero means the anchor no longer matches its history;
the sign is the negation of what arrived, so 25 € of backfilled spending shows
as a drift of +25 €.

The banks screen shows that as a warning on the account, naming the total that
turned up, and offers "Re-anchor to my current balance", which re-opens the
balance form. Nothing is corrected automatically: only the owner knows whether
the new rows are real or the figure they typed was wrong.

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
