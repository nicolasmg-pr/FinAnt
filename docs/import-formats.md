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

- **camt.053** names its own account. `Stmt/Acct/Id/IBAN` and the servicing
  institution `Stmt/Acct/Svcr/FinInstnId/Nm` come back as `statementAccount`
  (IBAN compacted: no spaces, upper case). An existing account with that IBAN is
  preselected. When the owner creates a new account for the file, the IBAN and
  institution name are stored on it, so the next statement from that bank finds
  its account by itself. The IBAN is never shown on screen; accounts are named.
  A file whose statements name more than one account is imported whole into
  the chosen account, and the preview's issues list says so.
- **CSV** carries no account identity. The account the last import went to
  (`lastImportAccount` in `settings`) is preselected, then "My records".
- **The Presupuesto workbook** always lands in "My records" and shows no picker.
  It is the owner's own ledger, not a bank's statement.
