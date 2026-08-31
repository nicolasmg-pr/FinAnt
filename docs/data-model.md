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

- `accounts` — one row per connected bank account, plus one local "My records"
  account that owns manual entries and file imports.
- `transactions` — the ledger. See dedupe below.
- `categories` — shipped taxonomy plus any the owner adds. Ids are stable and
  never renamed; rules and history point at them.
- `rules` — categorisation rules, `match_json` holding a `RuleMatch` tree.
  Shipped rules sit at priority 100-400, rules learned from a manual correction
  at 1000, so a correction always wins.
- `budgets` — monthly limit per category.
- `import_profiles` — user-defined column mappings for file import.
- `settings` — key/value: locale, main currency, app lock.

## Dedupe

Enforced by the database, not by application discipline:

```sql
CREATE UNIQUE INDEX idx_tx_external ON transactions(account_id, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX idx_tx_hash ON transactions(account_id, import_hash);
```

- `external_id` is the provider's `transactionId` — the reliable key when a bank
  supplies one.
- `import_hash` is an FNV-1a hash of `account | booking date | amount | normalised
  description | discriminator`, for file imports, which have no stable id.
- The **discriminator** separates rows a source repeats verbatim. A hand-kept
  sheet can legitimately list `comida fuera 20.00` three times in one month;
  without it all three collapse to one hash and two real movements are swallowed.
  It is an occurrence counter among identical rows, not a row number — a row
  number shifts when a row is inserted above, which would make every row below
  re-import as new.

Inserts use `INSERT OR IGNORE` and count `changes` to report what was new. A
re-imported CSV or an overlapping bank sync therefore cannot double a figure.

## What is excluded from statistics

`countsTowardStats()` in `packages/core/src/aggregate.ts` drops:
- rows with `excluded_from_stats = 1` (the owner's own call), and
- anything categorised `transfer-internal`.

Counting a transfer to one's own savings account as an expense makes every net
figure and every forecast wrong.
