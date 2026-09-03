# FinAnt

Personal finance tracker for Android and iOS. Reads the statements you export
from your own banks, classifies movements automatically, and shows income,
expenses and a year forecast at a glance.

**Your financial data never leaves your phone.** It lives in an encrypted SQLite
database on the device. There is no FinAnt account, no server, no cloud copy,
and the app makes no network calls at all.

Languages: English, Spanish, German.

## Getting started

```bash
npm install
npm start          # then press i (iOS) or a (Android)
```

Expo Go cannot run this app: SQLCipher and secure-store are native modules, so a
development build is required.

```bash
npx expo run:ios       # or: npx expo run:android
```

## Importing statements

There is no bank connection. Export a statement from your bank's website or app,
then open it from *Settings → Import a file*. Everything is parsed on the device.

Target banks, one import profile each:

| Bank | Country |
|---|---|
| Trade Republic | DE |
| ING | DE |
| DKB | DE |
| Raisin (WeltSparen) | DE |
| Openbank | ES |

Also supported:

- **Your `PresupuestoYYYY.xlsx` tracker** — imported directly, sheet per month,
  income and expense blocks, 1,399 movements from the 2025 workbook reconciling
  exactly against its own monthly totals. Check a change with
  `npm run verify:workbook -- <file.xlsx>`.
- **Any other bank CSV** — Spanish, German and English headers are recognised by
  a generic profile. Print a profile skeleton for an unknown layout with
  `npm run inspect:csv -- <file.csv>`.
- **camt.053 XML** — the ISO 20022 statement format every SEPA bank can export.

Re-importing the same statement, or two statements that overlap, never doubles a
figure: dedupe is enforced by unique indexes in the database.

## Layout

```
apps/mobile          Expo app (expo-router screens, SQLite)
packages/core        Money, categorisation, aggregates, recurring detection, forecast
packages/importers   CSV / xlsx / camt.053 readers and per-bank column-mapping profiles
packages/i18n        en / es / de resources, typed against English
docs/                Data model, import formats, security model
```

## Tests

```bash
npm test         # domain and parser tests
npm run typecheck
```
