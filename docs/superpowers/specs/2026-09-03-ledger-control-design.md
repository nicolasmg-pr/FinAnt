# Ledger control: movement detail, pay period, accounts, transfer matching

Date: 2026-09-03
Status: approved in conversation, pending written review

## Why

The owner imports statements by hand and today can only look at the result.
Four things are missing, in the order they have to be built:

1. **Open a movement** and change its category, keep it out of the statistics,
   or delete it. Example: a Trade Republic saveback shows as an expense although
   no money left the owner's pocket.
2. **Pay period.** Salary arrives around the 28th; the natural month starts on
   the 1st. From the 1st to the 27th every "this month" figure reads as debt.
   The owner wants the month to run from payroll to payroll.
3. **Accounts at import time.** Every file currently lands in one account
   ("My records"). Transfer matching needs to know which account a row came
   from, so the import must ask.
4. **Transfer matching.** A move of 50 € from account A to account B appears as
   −50 € in A and +50 € in B. Neither is income or expense. Pair them and take
   both out of every total.

Re-import dedupe was also asked for. It already exists (unique indexes on
`(account_id, import_hash)` and `(account_id, external_id)` plus
`INSERT OR IGNORE`). What is missing is feedback: the import screen discards the
result. That is fixed in sub-project 1.

Each sub-project is one branch off `main`, merged back with a `merge:` commit,
then pushed. Later sub-projects assume the earlier ones are on `main`.

## Decisions taken

| Question | Decision |
|---|---|
| Delete a movement | Soft delete (`deleted_at`). A hard delete lets the next overlapping statement re-insert the row, because the unique index only guards rows that still exist. |
| Matched transfers | Categorise both sides `transfer-internal` and link them (`transfer_peer_id`). Not deleted: `countsTowardStats()` already drops that category, so totals are unaffected, and the evidence stays visible and reversible. |
| Payroll marker | The existing `income-salary` category. No new column. Learned rules make future payrolls land there automatically. |
| Account on CSV import | One picker per import, last-used account preselected. Spreadsheet imports stay in "My records". |
| Year forecast | Stays on calendar months. An annual projection has no pay date. |

## Sub-project 1 — `transaction-detail`

### Schema

Migration 4 (append-only):

```sql
ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
CREATE INDEX idx_tx_deleted ON transactions(deleted_at);
```

`deleted_at` is never exposed on the domain `Transaction` type. Deleted rows
are filtered in SQL and never reach `packages/core`.

### Repository (`apps/mobile/src/db/transactions-repo.ts`)

- `getTransaction(id): Promise<Transaction | null>` — `WHERE id = ? AND deleted_at IS NULL`.
- `listAllTransactions`, `listTransactionsBetween`, `countUncategorised`,
  `dataRange` add `deleted_at IS NULL`.
- `deleteTransaction(id)` becomes `UPDATE transactions SET deleted_at = ? WHERE id = ?`.
- `setCategory(id, categoryId)` unchanged (already records `category_source = 'manual'`).
- `insertTransactions` unchanged. A re-imported deleted row is ignored by the
  unique index and counted as a duplicate, which is the honest number.

### Detail screen (`apps/mobile/app/transaction/[id].tsx`)

Registered in the root `Stack` as a modal with a native header, like `import`.
Loads by id; if the row is gone (deleted elsewhere) it navigates back.

Shows: amount (large, `Amount` component), booking date, value date when
present, description, counterparty, reference, account name, current category
with its source (auto / manual / none), notes when present.

Actions:

- **Change category.** Chip grid using `CategoryChip` (extracted from the
  budgets screen into `src/components/CategoryChip.tsx`). Grouped: the row's own
  side first, then transfer, then the other side. Selecting a chip enables a
  Save button.
- **Also apply to similar movements from now on.** Switch under the chips. On
  save, `learnRuleFrom(tx, categoryId, newId)` builds a rule and `saveRule`
  stores it. The switch is hidden when `learnRuleFrom` returns null (merchant
  key shorter than 4 characters). Applies to future imports only, as the
  existing wording says.
- **Exclude from statistics.** Switch, applied immediately through
  `setExcludedFromStats`. Reversible.
- **Delete.** Destructive button. `Alert` confirm, then soft delete, then back.

### Movements list (`apps/mobile/app/(tabs)/transactions.tsx`)

- Row becomes a `Pressable` that pushes `/transaction/<id>`.
- A row that does not count toward stats (`!countsTowardStats(tx)`) renders
  muted, with a small tag: "Excluded" or the transfer category label.

### Import result

`confirm()` in `app/import.tsx` currently awaits `ingest()` and closes.
It now shows a result card in place of the preview:
"N movements imported · M duplicates skipped", with a Done button that closes.
Reuses `import.duplicatesSkipped_*`; adds `import.imported_*`.

### i18n (en, es, de)

New keys under `transactions`: `detailTitle`, `description`, `counterparty`,
`reference`, `bookingDate`, `valueDate`, `account`, `category`, `notes`,
`categorySource.auto`, `categorySource.manual`, `categorySource.none`,
`excludedTag`, `deleteConfirm`, `notFound`.
Under `import`: `imported_one`, `imported_other`.

### Docs

`docs/data-model.md`: a "Soft delete" paragraph under Dedupe explaining why a
deleted row stays in the table.

### Testing

Core untouched, so no new unit tests. Typecheck, `npx expo export --platform ios`
bundle check, then run in the simulator and screenshot the detail screen with a
category change, an exclusion and a deletion.

## Sub-project 2 — `pay-period`

### Domain (`packages/core/src/period.ts`)

```ts
export const PAYROLL_CATEGORY_ID = 'income-salary';
/** Two salary bookings this close together belong to one period (a bonus, two payers). */
export const PAYROLL_MERGE_DAYS = 14;

export interface Period {
  readonly from: ISODate;
  /** Inclusive. `null` while the period is still open (the current one). */
  readonly to: ISODate | null;
  /** True when `from` is a salary booking; false when it is a calendar fallback. */
  readonly anchored: boolean;
}

export function payPeriodStarts(transactions: readonly Transaction[]): ISODate[];
export function currentPeriod(transactions: readonly Transaction[], today: ISODate): Period;
export function inPeriod(date: ISODate, period: Period): boolean;
```

- `payPeriodStarts`: booking dates of movements with `categoryId ===
  PAYROLL_CATEGORY_ID` that pass `countsTowardStats`, sorted, deduplicated.
  A start within `PAYROLL_MERGE_DAYS` of the previous kept start is dropped.
- `currentPeriod`: the latest start `<= today` becomes `from`; `to` is `null`
  if no later start exists, else the day before the next start. If there is no
  start `<= today`, fall back to `{ from: first day of today's month, to: null,
  anchored: false }`.
- Salary dates drift (weekends, holidays). Using the actual booking dates as
  boundaries absorbs that with no configuration.
- Spreadsheet years book everything on the 1st, salary included, so history
  imported from the tracker yields calendar-month periods. Consistent.

### Aggregates

- `aggregate.ts`: `summarisePeriod(transactions, period, currency): PeriodSummary`
  with the same figures as `MonthlySummary` plus the `period`. `summariseMonth`
  becomes a wrapper over a shared internal summariser (`from = YYYY-MM-01`,
  `to = YYYY-MM-31`). Behaviour for existing callers is unchanged.
- `budget.ts`: `budgetPeriod(transactions, budgets, period, currency)`;
  `budgetMonth` wraps it. Same net-of-refunds, same exclusions.
- `forecast.ts` unchanged.
- `dates.ts`: `addDays(date, n)` and `firstOfMonth(date)` helpers, UTC only,
  string in, string out.

### UI

- Dashboard: first card title is `dashboard.sincePayroll` ("Since 28 Aug") when
  the period is anchored, `dashboard.thisMonth` otherwise. Figures come from
  `summarisePeriod`. A hint line under the figures when anchored:
  `dashboard.payPeriodHint` ("Counted from your last salary. Net is what is left
  of it."). Year forecast card unchanged.
- Budgets: progress from `budgetPeriod` on the same period; the "All budgets"
  card subtitle shows the same "Since …" label.
- Detail screen: when the Salary chip is selected, a hint
  `transactions.salaryHint` ("Salary movements start a new month on the
  dashboard.").

### Tests (`packages/core/tests/period.test.ts` and additions)

- Starts: sorted, deduplicated, merge within 14 days keeps the earliest.
- Current period: open end, closed end before a later salary, fallback to
  calendar month when no salary, salary exactly on `today`.
- `summarisePeriod` and `budgetPeriod`: boundaries inclusive at both ends,
  transfers and excluded rows dropped, `summariseMonth` still equals the old
  result on the synthetic year.

### Docs

`docs/pay-period.md` (short) linked from `docs/README.md`: what anchors a
period, the 14-day merge, the fallback, why the forecast ignores it.

## Sub-project 3 — `accounts-on-import`

### Repository (`apps/mobile/src/db/accounts-repo.ts`)

- `findAccountByIban(iban)`.
- New setting key `SETTING_LAST_IMPORT_ACCOUNT` in `settings-repo.ts`.
- `listAccounts` already exists; `createAccount` already exists.

### Importer

`parseCamt053` additionally returns `statementAccount: { iban: string | null;
name: string | null }` read from `Stmt/Acct/Id/IBAN` and `Stmt/Acct/Svcr/FinInstnId/Nm`.
Drafts still take `accountId` from the context, because `importHashOf` includes
the account id and the unique index is per account.

### Import screen

- After a CSV or camt file is parsed, an **Account** card appears above the
  preview: chips for existing non-archived accounts plus a "New account" chip
  that reveals a name field. Preselection order: account matching the camt IBAN,
  else last-used (setting), else "My records".
- Changing the selection re-runs the parse with the new account id (fast, in
  memory), so the preview and the hashes match what will be stored.
- Spreadsheet (`.xlsx`) imports show no picker and stay in "My records".
- On confirm: create the account if "New account", write the setting, ingest.

### Elsewhere

- Detail screen shows the account name (already reserved a slot in sub-project 1;
  it read from `listAccounts`).
- Movements list: when more than one account exists, the meta line appends the
  account name.

### i18n

`import.account`, `import.newAccount`, `import.accountName`,
`import.accountRequired`.

### Docs

`docs/import-formats.md`: account attribution section. `docs/data-model.md`:
accounts bullet updated.

### Testing

camt parser test for `statementAccount` (hand-written fixture, no real IBAN).
Manual: import two CSVs into two accounts, check the list meta and the detail.

## Sub-project 4 — `transfer-matching`

### Schema

Migration 5:

```sql
ALTER TABLE transactions ADD COLUMN transfer_peer_id TEXT;
CREATE INDEX idx_tx_transfer_peer ON transactions(transfer_peer_id);
```

`Transaction.transferPeerId: string | null` added to the core type, the row
mapper and the test factory.

### Domain (`packages/core/src/transfers.ts`)

```ts
export const TRANSFER_MAX_DAYS = 3;

export interface TransferPair { readonly outId: string; readonly inId: string }

export function matchTransfers(
  transactions: readonly Transaction[],
  options?: { maxDays?: number },
): TransferPair[];
```

A debit `d` and a credit `c` pair when all hold:

- `d.accountId !== c.accountId`
- same currency, `d.amount.minor === -c.amount.minor`, `d.amount.minor < 0`
- `|daysBetween(d.bookingDate, c.bookingDate)| <= maxDays`
- neither has `categorySource === 'manual'`
- neither has `transferPeerId`
- neither is `excludedFromStats`

Deterministic and one-to-one: debits are visited by date then id; each takes
the unmatched credit with the smallest day distance, ties broken by date then id.
Rows that a shipped rule already categorised `transfer-internal` (source
`auto`) are eligible, so they gain a peer link.

### Service (`apps/mobile/src/services/transfers.ts`)

`detectTransfers(): Promise<number>` loads the ledger, runs `matchTransfers`,
and for each pair calls `linkTransferPair(outId, inId)` in one DB transaction:
both rows get `category_id = 'transfer-internal'`, `category_source = 'auto'`,
and each other's id in `transfer_peer_id`. Idempotent: linked rows are skipped
by the matcher.

Runs at the end of `ingest()` (the counterpart may have been imported earlier
from the other bank) and once on app start after the database opens. The import
result card adds "K transfers between your accounts matched" when K > 0.

### Unlinking

When the owner changes the category of a linked row on the detail screen,
`setCategory` also clears `transfer_peer_id` on both rows. The other side keeps
`transfer-internal` (auto). It is not re-paired, because one side is now
manual. The owner fixes the other side by hand if it was wrong too.

### Detail screen

For a linked row: "Transfer between your accounts · matched with +50,00 € ·
DKB · 2 Sep", tappable, opens the peer.

### i18n

`transactions.transferMatched`, `import.transfersMatched_one/other`.

### Tests (`packages/core/tests/transfers.test.ts`)

Pairs across accounts; refuses same account; respects the day window; protects
manual rows, excluded rows and already-linked rows; one credit is used once
when two debits compete; deterministic order; a rule-categorised transfer
still gets linked.

### Docs

`docs/data-model.md`: "Transfers between own accounts" section.

## Out of scope

- Manual pairing UI for transfers the matcher misses.
- Account rename / archive UI.
- A calendar-month toggle for the dashboard.
- Re-categorising existing rows when a rule is learned.
- Translating the default account name "My records".
