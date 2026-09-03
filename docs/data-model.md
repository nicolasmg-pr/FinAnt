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
- `categories` — shipped taxonomy plus any the owner adds. Ids are stable and
  never renamed; rules and history point at them.
- `rules` — categorisation rules, `match_json` holding a `RuleMatch` tree.
  Shipped rules sit at priority 100-400, rules learned from a manual correction
  at 1000, so a correction always wins.
- `budgets` — monthly limit per category.
- `import_profiles` — user-defined column mappings for file import.
- `settings` — key/value: locale, main currency, app lock, last import account.

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
