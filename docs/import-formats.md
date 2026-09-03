# Import formats

Three readers (CSV, xlsx, camt.053), all entirely on-device: nothing is
uploaded, and the app has no network access. Every movement enters FinAnt as a
file the owner exports from their bank and picks by hand.

## Target bank exports

One `ImportProfile` per bank, in `packages/importers/src/profiles/`. A profile is
written from a real export placed in `fixtures/private/` (gitignored), and its
layout — headers, preamble rows, delimiter, encoding, date and number formats,
sign convention — is documented in this file once known. Layouts are never
guessed from memory: a wrong header list detects the wrong profile silently.

| Bank                | Country | Export the bank offers             | Profile         |
| ------------------- | ------- | ---------------------------------- | --------------- |
| Trade Republic      | DE      | to be confirmed from a real export | not yet written |
| ING Deutschland     | DE      | to be confirmed from a real export | not yet written |
| DKB                 | DE      | to be confirmed from a real export | not yet written |
| Raisin (WeltSparen) | DE      | to be confirmed from a real export | not yet written |
| Openbank España     | ES      | to be confirmed from a real export | not yet written |

Until a bank's profile exists, its CSV goes through `GENERIC_CSV` and its
camt.053, if the bank offers one, through the camt.053 reader.

## CSV, via column-mapping profiles

`packages/importers`. A profile is data, not code — see `ImportProfile` in
`src/profile.ts`. It states the header row, delimiter, date format, decimal
separator, sign convention, and which column carries what.

Header lookup is case- and accent-insensitive and falls back to a substring
match, so `Fecha operación`, `FECHA OPERACION` and `Fecha` all resolve.

**The header row is found, not assumed.** Bank exports open with a preamble
block — account holder, IBAN, period, opening balance — and the table starts
below it. `readStatementCsv` offers each of the first 40 rows to every profile
in turn and takes the first one a profile recognises by its `detectHeaders`.
With no match, the generic profile's header is the row whose width the body of
the file agrees with, scored as columns × rows so a long two-column preamble
loses to the table underneath it. Issue line numbers come from the reader,
which records the source line of every row, so a blank line or a newline inside
a quoted field does not shift them.

**Encoding is sniffed, not assumed.** `decodeStatement` reads the bytes as
UTF-8 when they are valid UTF-8 and as windows-1252 otherwise. German exports
are still ISO-8859-1; read as UTF-8, every umlaut becomes U+FFFD and lands in
the stored narrative and in the rules that match on it.

Parsing rules worth knowing:

- **Dates**: day-first is the default (`03/04/2026` is 3 April). A profile can
  pin `MM/DD/YYYY` when a sheet was authored in a US locale. Google Sheets and
  Excel serial numbers (e.g. `45000`) are recognised.
- **Amounts**: `1.234,56`, `1,234.56`, `45,90`, `(89,00)` and a trailing `€` all
  parse. A lone three-digit group (`1.234`) is read as thousands, not cents,
  unless the profile pins the decimal separator.
- **Unreadable rows become issues, never exceptions.** A 400-row import is not
  lost because row 212 is a merged subtotal cell. The import screen lists them.

## The personal Presupuesto tracker (.xlsx) — primary target

`packages/importers/src/profiles/presupuesto.ts`, applied by
`importWorkbook()` over the reader in `src/xlsx.ts`. An `.xlsx` is a zip of XML
parts; only the workbook, its relationships and the shared string table are read
(`fflate` + `fast-xml-parser`). Formulas are not evaluated — the cached value the
spreadsheet last wrote is used, which is what the owner sees on screen.

Layout, as read from the real workbook:

| Element        | Where                                                                                   |
| -------------- | --------------------------------------------------------------------------------------- |
| Month sheets   | `Enero` … `Diciembre`, one per month                                                    |
| Header         | Row 1: `Conceptos \| Ingresos \| Total \| Conceptos \| Gastos \| Total \| \| Resultado` |
| Income block   | Concepts in `A`, amounts in `B`, from row 2                                             |
| Expense block  | Concepts in `D`, amounts in `E`, from row 2                                             |
| Totals         | `C2` / `F2` / `H2` hold SUM formulas — outside the scanned columns, never imported      |
| Ignored sheets | `Totales`, `Backend`, `Venta Objetivos` — not listed in `monthSheets`                   |

Three properties of this source drove design decisions elsewhere:

- **No date column.** The month comes from the sheet name and the year from the
  filename (`Presupuesto2025.xlsx`). Every movement is booked on the **1st** of
  its month. One fixed, documented day keeps monthly and yearly figures exact —
  the only granularity this ledger ever had — and leaves the missing precision
  visible instead of plausible. Spreading rows over invented days would look
  more precise while being less true.
- **The same concept means different things per block.** `kaution` is a deposit
  paid on the expense side and the same deposit returned on the income side;
  `intereses` is a bank charge one way and interest earned the other. The profile
  therefore holds one category map per direction, not one flat map.
- **Negative rows inside the expense block are refunds.** They reduce that
  month's spending rather than counting as income — which is why a transaction
  carries a `side` alongside its signed amount. See `docs/data-model.md`.

Concept matching is accent- and case-insensitive, so `Transporte Público`,
`transporte publico` and `TRANSPORTE PUBLICO` all resolve to one category.

### Verifying a change to the profile

```bash
npm run verify:workbook -- ~/Downloads/Presupuesto2025.xlsx
```

Imports the workbook and reconciles both sides of every month against the
sheet's own SUM totals, then lists any concept with no category mapping. It
exits non-zero on a mismatch. The file is read locally and nothing leaves the
machine; real exports never enter the repository — `packages/importers/tests/`
generates its fixtures in code instead.

## ING Deutschland — Umsatzanzeige (.csv)

`ING_UMSATZANZEIGE` in `src/profiles/ing.ts`. Exported from the ING web
banking as `Umsatzanzeige_<IBAN>_<YYYYMMDD>.csv`. Semicolon-delimited,
ISO-8859-1, `DD.MM.YYYY`, comma decimal separator, signed amounts.

Thirteen preamble lines (`Umsatzanzeige`, `IBAN`, `Kontoname`, `Bank`, `Kunde`,
`Zeitraum`, `Saldo`, `Sortierung`, and a paragraph about pending movements)
sit above the table. The header is:

```
Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung
```

| Column | Index | Mapped to |
| --- | --- | --- |
| `Buchung` | 0 | `bookingDate` |
| `Wertstellungsdatum` | 1 | `valueDate` |
| `Auftraggeber/Empfänger` | 2 | `counterparty` |
| `Buchungstext` | 3 | `reference` |
| `Verwendungszweck` | 4 | `description` |
| `Saldo` | 5 | `balance` (running balance after the movement) |
| `Währung` | 6 | — (currency of `Saldo`) |
| `Betrag` | 7 | `amount` |
| `Währung` | 8 | `currency` |

Two traps this profile exists to avoid:

- **`Buchung` is the booking date.** The generic profile's substring match hits
  `Wertstellungsdatum` first, which moves a movement booked on 1 March but
  valued on 28 February into the wrong month.
- **`Währung` appears twice.** Resolved by name, the amount would take the
  balance's currency. The profile pins index 8.

`Verwendungszweck` is empty on card withdrawals and some direct debits; the
importer then falls back to the counterparty for the description.

`Saldo` is a running balance that reconciles exactly: for consecutive rows,
`Saldo(n) - Betrag(n) = Saldo(n+1)`. That is what the bank view's balance
reconciliation checks an import against.

## Other CSV exports

`GENERIC_CSV` in `src/profiles/generic.ts` matches the header names most
European bank exports use in English, Spanish and German, including
income/expense column pairs. `ImportProfile` is data, not code, so a new layout
is a new object rather than a new parser. Use
`npm run inspect:csv -- <file.csv>` to print a profile skeleton from an unknown
file.

## camt.053 (ISO 20022)

`src/camt053.ts`. Every SEPA bank can produce camt.053, so it covers any
institution without a dedicated CSV profile.

- Amounts in camt.053 are **unsigned**; direction comes from `CdtDbtInd`
  (`DBIT` / `CRDT`). Signing from the amount alone imports every expense as income.
- Description comes from `RmtInf/Ustrd`, falling back to `AddtlNtryInf`, then the
  counterparty name.
- `EndToEndId` is kept as the dedupe key, except the literal `NOTPROVIDED`, which
  many banks emit for every entry.

## Which account a file lands in

Every import is attributed to one account, chosen on the import screen before
the rows are written. The dedupe indexes are per account (see
`docs/data-model.md`), and `import_hash` includes the account id, so the screen
parses the file again whenever the owner picks another account: the preview
shows the rows exactly as the database will hold them, never rows hashed for
one account and stored in another.

### Bank first, then the account

A bank groups accounts, so the picker (`apps/mobile/src/components/AccountPicker.tsx`,
shared with manual movement entry) asks in two rows: the bank, then the
accounts of that bank. The bank row lists every institution, "Not in a bank"
for the accounts belonging to none — "My records" among them — and **+ New
bank**; the account row lists only the accounts of the chosen bank, plus **+
New account**. Choosing another bank moves the account choice to that bank's
first account, or to a new account when it holds none: an account is never left
selected under a bank it does not belong to.

Either level may still have to be created, and nothing is written until the
owner confirms. `AccountChoice` (`packages/core/src/account-choice.ts`) carries
that intent — the bank and account ids, whether each is new, and the names typed
for them — and the account id of a new account is generated **up front**, because
the preview's rows are already hashed for it. On confirm the bank is created
first, then the account under it, then the rows are ingested. Creating the bank
returns the one already carrying that name, and both steps are recorded in the
choice as they succeed, so a retry after a failed ingest reuses them instead of
leaving a second bank or a second account behind.

### Which one is preselected

- **camt.053** names its own account. `Stmt/Acct/Id/IBAN` and the servicing
  institution `Stmt/Acct/Svcr/FinInstnId/Nm` come back as `statementAccount`
  (IBAN compacted: no spaces, upper case). An existing account with that IBAN is
  preselected, **and so is the bank it sits under**. When the owner creates a new
  account for the file, the IBAN and institution name are stored on it, so the
  next statement from that bank finds its account by itself; a new bank created
  for that file starts from the institution name the statement gave. The IBAN is
  never shown on screen; accounts are named. A file whose statements name more
  than one account is imported whole into the chosen account, and the preview's
  issues list says so.
- **CSV** carries no account identity. The account the last import went to
  (`lastImportAccount` in `settings`), and its bank, are preselected.
- Failing both, **"My records"**, which sits under no bank. An account whose
  bank has since been deleted is offered under "Not in a bank" too, the same
  place the banks screen lists it.
- **The Presupuesto workbook** always lands in "My records" and shows no picker
  at all. It is the owner's own ledger, not a bank's statement.
