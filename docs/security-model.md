# Security model

## What is stored, and where

| Data | Location | Protection |
|---|---|---|
| Movements, categories, rules, budgets | `finant.db` in app storage | SQLCipher, key from the device keychain |
| SQLCipher passphrase | iOS Keychain / Android Keystore | iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; Android non-exportable Keystore key, `allowBackup: false` |

Nothing else is stored. There are no API credentials of any kind: the app talks
to no bank, no aggregator and no FinAnt server. Movements enter the database
only from a statement file the owner exports from their bank and picks from
local storage, or from a manual entry.

There is no FinAnt account, no server, and no cloud copy. Erasing the app erases
the data, and so does Settings > Erase all data: it deletes the database file and
then the key, rather than deleting rows and leaving them in the file's free pages.

The database refuses to open at all on a build without SQLCipher. Plain SQLite
ignores an unknown `PRAGMA key` silently, which would write every movement in
plaintext with nothing to signal it, so `open()` checks `PRAGMA cipher_version`
and throws when it comes back empty. Expo Go cannot provide SQLCipher; the app
needs a native build with the `useSQLCipher` option on the `expo-sqlite` config
plugin.

## The statement file itself

The picked file is copied into the app's cache directory by the document picker,
read into memory, parsed, and written to the encrypted database. The plaintext
copy in the cache is the operating system's, not ours, and is not encrypted by
FinAnt. The owner's own Downloads folder already holds the same file in
plaintext, so this adds no exposure the export did not create — but it is why
the app never writes a statement anywhere else and never logs a row from one.

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
- Network interception — there is no network traffic to intercept. The app
  declares no network dependency and holds no credentials.

Not defended against:
- A jailbroken or rooted device with the screen unlocked. The keychain hands the
  key to a process running as the app.
- Statement files the owner leaves lying in Downloads or a synced folder. FinAnt
  reads them; it cannot delete or protect them.

## Rules for contributors

- Never log a movement, a narrative, an IBAN, or any part of a statement.
- Never add a network call. There is no analytics, no crash reporting, and no
  telemetry, and there is no legitimate host for the app to talk to.
- Real bank exports never enter the repository. `fixtures/private/` is gitignored;
  test fixtures are hand-written from the documented layout, never copied from a
  real file.
