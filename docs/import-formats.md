# Import formats

Two readers, both entirely on-device: nothing is uploaded.

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

### The personal Google Sheets tracker

`src/profiles/google-sheets.ts` is the primary target and is currently a
**placeholder** — it maps the header names most personal trackers use, and its
`categoryMap` translates a sheet's own category labels onto FinAnt category ids
so existing classification survives the import instead of being re-guessed.

To pin it to the real sheet:

```bash
# File > Download > Comma-separated values (.csv) in Google Sheets
npm run inspect:csv -- ~/Downloads/my-tracker.csv
```

It prints the delimiter, every column with sample values and a type guess, and a
profile skeleton to paste over the placeholder. Then add a hand-written fixture
in `packages/importers/tests/fixtures/` so a later sheet change fails a test
rather than an import. Real exports never go in the repository.

## camt.053 (ISO 20022)

`src/camt053.ts`. Every SEPA bank can produce camt.053, which covers institutions
GoCardless does not reach.

- Amounts in camt.053 are **unsigned**; direction comes from `CdtDbtInd`
  (`DBIT` / `CRDT`). Signing from the amount alone imports every expense as income.
- Description comes from `RmtInf/Ustrd`, falling back to `AddtlNtryInf`, then the
  counterparty name.
- `EndToEndId` is kept as the dedupe key, except the literal `NOTPROVIDED`, which
  many banks emit for every entry.
