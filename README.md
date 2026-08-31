# FinAnt

Personal finance tracker for Android and iOS. Connects to European banks through
GoCardless Bank Account Data, classifies movements automatically, and shows
income, expenses and a year forecast at a glance.

**Your financial data never leaves your phone.** It lives in an encrypted SQLite
database on the device. There is no FinAnt account, no server, and no cloud copy.

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

## Connecting a bank

1. Create a free account at https://bankaccountdata.gocardless.com/ and generate
   a **Secret ID** and **Secret Key** in *Developers → User secrets*.
2. Register `finant://bank-callback` as a redirect URI.
3. In the app: *Settings → GoCardless credentials*, paste both values. They are
   stored in the iOS Keychain / Android Keystore and are sent only to GoCardless.

These are *your* credentials for *your* GoCardless account. Read
[docs/security-model.md](docs/security-model.md) before distributing the app to
anyone else — the credential handling has to change first.

## Importing files

Works with no bank connection at all:

- **Your Google Sheets tracker** — export as CSV and import it. Run
  `npm run inspect:csv -- <file.csv>` to generate the column mapping.
- **Any bank CSV** — Spanish, German and English headers are recognised.
- **camt.053 XML** — the ISO 20022 statement format every SEPA bank can export.

## Layout

```
apps/mobile          Expo app (expo-router screens, SQLite, GoCardless client)
packages/core        Money, categorisation, aggregates, recurring detection, forecast
packages/importers   CSV / camt.053 readers and column-mapping profiles
packages/i18n        en / es / de resources, typed against English
docs/                API notes, data model, import formats, security model
```

## Tests

```bash
npm test         # domain and parser tests
npm run typecheck
```
