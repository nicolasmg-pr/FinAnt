# FinAnt

Local-first personal finance tracker for Android and iOS. Reads bank movements
via GoCardless Bank Account Data, classifies them automatically, and shows
monthly income/expenses plus a year forecast. Euro area, English/Spanish/German.

## Stack

- TypeScript 6 (strict), React 19.2, React Native 0.86, Expo SDK 57, expo-router
- Storage: expo-sqlite with SQLCipher. No server, no account, no cloud copy.
- Package manager: npm (workspaces)

## Commands

- Dev: `npm start` (then `i` / `a`), or `npm run ios` / `npm run android`
- Test: `npm test` (vitest, packages only)
- Typecheck: `npm run typecheck`
- Lint/format: `npm run lint:fix`
- Inspect an unknown CSV: `npm run inspect:csv -- <file.csv>`
- Bundle check without a simulator: `cd apps/mobile && npx expo export --platform ios`

## Conventions

- Layout: npm workspaces monorepo — `apps/mobile` (Expo, framework `app/` routing
  convention), `packages/*` with source in `src/` and tests in `tests/`.
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
- Dates are plain `YYYY-MM-DD` / `YYYY-MM` strings. Never route a booking date
  through a Date/timestamp — it moves 1 March into February west of UTC.
- Dedupe is enforced by unique indexes, not by application discipline.
- Parsers report unreadable rows as issues and keep going; they do not throw away
  an import over one bad row.
- Typed contracts at every boundary; TypeScript strict, `noUncheckedIndexedAccess` on.
- Aggregates and forecasts exclude internal transfers and rows flagged by the owner.
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

- Never log a movement, narrative, IBAN, or any part of a credential.
- Never commit secrets, and never commit a real bank or spreadsheet export.
  `fixtures/private/` is gitignored; test fixtures are hand-written.
- No analytics, crash reporting or telemetry. The only external host is GoCardless.
- Do not embed GoCardless credentials in the app. Read `docs/security-model.md`
  before changing anything under `src/providers/` or `src/security/`.
