# FinAnt

Local-first personal finance tracker for Android and iOS. Parses the statement
files the owner exports from their banks (Trade Republic, ING Deutschland, DKB,
Raisin, Openbank España), classifies movements automatically, and shows monthly
income/expenses plus a year forecast. No bank connection, no aggregator: a
movement comes from a file the owner picks by hand or, on Android only, a
notification their own bank app posts (see Conventions). Euro area,
English/Spanish/German.

## Stack

- TypeScript 6 (strict), React 19.2, React Native 0.86, Expo SDK 57, expo-router
- Storage: expo-sqlite with SQLCipher. No server, no account, no cloud copy.
  One outbound call only — see Boundaries.
- Package manager: npm (workspaces)

## Commands

- Dev: `npm start` (then `i` / `a`), or `npm run ios` / `npm run android`
- Test: `npm test` (vitest, packages only)
- Typecheck: `npm run typecheck`
- Lint/format: `npm run lint:fix`
- Inspect an unknown CSV: `npm run inspect:csv -- <file.csv>`
- Reconcile the tracker import: `npm run verify:workbook -- <file.xlsx>`
- Bundle check without a simulator: `cd apps/mobile && npx expo export --platform ios`

## Conventions

- Layout: npm workspaces monorepo — `apps/mobile` (Expo, framework `app/` routing
  convention), `packages/*` with source in `src/` and tests in `tests/`.
- One bank export = one `ImportProfile` in `packages/importers/src/profiles/`,
  documented in `docs/import-formats.md` from a real export the owner supplies
  in `fixtures/private/` (gitignored). Never guess a bank's column layout.
- Notification capture is Android only, permanently — iOS has no API for
  reading another app's notifications. Its parsers live in
  `packages/importers/src/notifications/`, documented in
  `docs/notification-formats.md` from real notification text the owner
  supplies — never guessed, exactly like a bank's column layout.
- Relative imports inside packages are **extensionless**. Metro does not map
  `./money.js` onto `money.ts`.
- Domain logic (money, categorisation, aggregates, forecast) lives in
  `packages/core` and stays free of React and Expo imports, so it is testable in
  plain node.
- Category ids are permanent. Rename the label, never the id.
- Schema migrations are append-only; never edit a shipped one.

## Engineering standards

- Money is signed integer minor units plus an ISO 4217 code. No float arithmetic
  on any balance, ever.
- A transaction carries `side` as well as a sign: a refund is a positive amount
  on the expense side. Aggregate by `side`, never by sign alone.
- Dates are plain `YYYY-MM-DD` / `YYYY-MM` strings. Never route a booking date
  through a Date/timestamp — it moves 1 March into February west of UTC.
- Dedupe is enforced by unique indexes, not by application discipline.
- Parsers report unreadable rows as issues and keep going; they do not throw away
  an import over one bad row.
- Typed contracts at every boundary; TypeScript strict, `noUncheckedIndexedAccess` on.
- Aggregates and forecasts exclude internal transfers, investment trades, and
  rows flagged by the owner. Buying a security converts cash into an asset; it
  is not spending, and selling one is not income. Dividends and broker rewards
  are income — they are new money.
- Share counts and unit prices are `Decimal` (scaled integer), never `Money` and
  never a float. Cost basis comes from the export's own amount column, never
  from price x shares.
- Forecasts state their confidence and the history they were built from. Never
  present a projection as a booked figure.
- Translations are typed against `Resources`: a missing key is a compile error.

## Working agreements

- New feature = /clear + new git branch (short kebab-case name).
- Framework work: fetch current official docs first, cite into `docs/`.
- Delegate: test-runner after changes, lint-fixer before commits, commit-writer
  for messages.
- Long session: guided /compact with explicit keep/discard instructions.

## Boundaries

- Never log a movement, narrative, IBAN, or any part of a statement.
- Never commit a real bank or spreadsheet export. `fixtures/private/` is
  gitignored; test fixtures are hand-written from the documented layout.
- The app makes one kind of network call: a price lookup, when the owner opens
  or refreshes the portfolio. It sends two things and nothing else — a symbol
  the owner holds, and a currency pair such as `USDEUR=X` when the venue prices
  in another currency. No amount, share count, balance, account, IBAN,
  narrative or movement ever leaves the device. Still no analytics, no crash
  reporting, no telemetry, and no other host. The privacy cost is real and
  stated in the UI: the quote provider learns which securities the owner holds,
  and nothing else. All of it lives in `src/services/prices/`, and `http.ts`
  there is the only place in the app that may call `fetch`.
- Read `docs/security-model.md` before changing anything under `src/security/`
  or `src/db/database.ts`.
