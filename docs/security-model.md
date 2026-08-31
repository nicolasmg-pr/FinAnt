# Security model

## What is stored, and where

| Data | Location | Protection |
|---|---|---|
| Movements, categories, rules, budgets | `finant.db` in app storage | SQLCipher, key from the device keychain |
| SQLCipher passphrase | iOS Keychain / Android Keystore | iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; Android non-exportable Keystore key, `allowBackup: false` |
| GoCardless `secret_id` / `secret_key` | Same secure store, separate entry | Never written to SQLite, never in the bundle, never logged |
| GoCardless access token | Process memory only | Discarded on app termination |

There is no FinAnt account, no server, and no cloud copy. Erasing the app erases
the data, and so does Settings > Erase all data: it deletes the database file and
then the key, rather than deleting rows and leaving them in the file's free pages.

The database refuses to open at all on a build without SQLCipher. Plain SQLite
ignores an unknown `PRAGMA key` silently, which would write every movement in
plaintext with nothing to signal it, so `open()` checks `PRAGMA cipher_version`
and throws when it comes back empty. Expo Go cannot provide SQLCipher; the app
needs a native build with the `useSQLCipher` option on the `expo-sqlite` config
plugin.

## Why the credentials cannot simply be shipped

The GoCardless `secret_id` / `secret_key` pair authenticates a **GoCardless
account**, not an end user. A pair embedded in a published APK or IPA can be
extracted from the binary, and whoever holds it can enumerate every requisition
made under that account — that is, every user's bank connection, not only the
extractor's.

That is why the current build is a personal one: the device owner enters *their
own* credentials, so the only account at risk is theirs.

**Before distributing this app to other people**, the credentials must move
behind a stateless broker: one function holding the keys server-side, forwarding
only the caller's own requisition and account ids, storing nothing. The
`BankProvider` interface in `apps/mobile/src/providers/bank-provider.ts` exists
so that swap touches one file and leaves storage and UI untouched.

## Threat model

Defended against:
- Device theft with the screen locked — the database is encrypted and the key is
  keychain-bound.
- Backup and device-transfer extraction. On iOS, `THIS_DEVICE_ONLY` keeps the key
  out of iCloud Keychain and out of any backup image. `keychainAccessible` is an
  iOS-only option, so on Android the same guarantee comes from elsewhere: the key
  wrapping the passphrase lives in the AndroidKeyStore and cannot be exported, so
  a copied SharedPreferences entry is unusable on another device, and
  `android.allowBackup: false` keeps app storage out of Google backup entirely.
- Network interception — all traffic is HTTPS to GoCardless; there is no FinAnt
  endpoint to intercept.

Not defended against:
- A jailbroken or rooted device with the screen unlocked. The keychain hands the
  key to a process running as the app.
- A user who pastes their credentials into the wrong app. Nothing in FinAnt can
  prevent that.

## Rules for contributors

- Never log a movement, a narrative, an IBAN, or any part of a credential.
- Never add a network call to a host other than GoCardless without saying so in
  the pull request. There is no analytics, no crash reporting, and no telemetry.
- Real bank exports never enter the repository. `fixtures/private/` is gitignored;
  test fixtures are hand-written.
