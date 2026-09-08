# Security model

## What is stored, and where

| Data                                  | Location                        | Protection                                                                                      |
| ------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Movements, categories, rules, budgets | `finant.db` in app storage      | SQLCipher, key from the device keychain                                                         |
| SQLCipher passphrase                  | iOS Keychain / Android Keystore | iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; Android non-exportable Keystore key, `allowBackup: false` |

The optional assistant model file also lives in app storage, unencrypted. It is
a public file of model weights containing nothing about the owner, and SQLCipher
is for the ledger.

There are no API credentials of any kind: the app talks to no bank, no
aggregator and no FinAnt server. Movements enter the database only from a
statement file the owner exports from their bank and picks from local storage,
or from a manual entry.

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

## The one network call

FinAnt has a local assistant: a small language model, running on the device,
that turns a typed question into a movements filter. The weights are 1.3 GB and
cannot ship inside the app, so the owner downloads them once.

What keeps that from widening into a network dependency:

- **One host.** `huggingface.co`, checked at runtime in
  `src/assistant/model-file.ts` against `ALLOWED_HOST`. A spec pointing anywhere
  else throws rather than downloads.
- **One file, verified.** Its exact byte length and SHA-256 are pinned in
  source. The file is checked on arrival — length, then the GGUF magic number,
  then the full digest over a stream — and anything that fails is deleted, not
  kept. The digest is the one Hugging Face publishes, so the owner can compute
  it independently and get the same answer.
- **One explicit tap.** There is no launch-time check, no background refresh, no
  update poll and no retry-on-launch. Nothing downloads unless the owner asks on
  the Settings screen, which says what is about to happen before it happens.
- **Nothing is sent.** The request has no body and carries no identifier. No
  movement, no narrative, no balance, no device id, nothing derived from the
  ledger.

The model itself never sees a movement either. It is given today's date, the
locale, the owner's category and account ids with their labels, the current
filter and the typed question — and nothing else. That is enforced by the
parameter types of `buildPrompt` in `packages/assistant`, which are too narrow
to carry a transaction or an IBAN; widening them is an API change a reviewer
sees. Every figure the assistant displays is computed by `@finant/core`, not
written by the model.

No iOS ATS exception and no relaxation of transport security is involved: App
Transport Security blocks insecure connections, and this one is ordinary HTTPS.

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
- Network interception. The app holds no credentials and sends no request body,
  so there is nothing in an outbound request to intercept. It makes exactly one
  kind of request, described under "The one network call" below, and a tampered
  response is rejected by a checksum pinned in source rather than trusted.

Not defended against:

- A jailbroken or rooted device with the screen unlocked. The keychain hands the
  key to a process running as the app.
- Statement files the owner leaves lying in Downloads or a synced folder. FinAnt
  reads them; it cannot delete or protect them.

## Rules for contributors

- Never log a movement, a narrative, an IBAN, or any part of a statement.
- The assistant model download is the only permitted network call. Adding a
  second one means changing this document first, and there is no legitimate
  second host to add. Analytics, crash reporting and telemetry stay forbidden
  outright, with or without a network call to carry them.
- Real bank exports never enter the repository. `fixtures/private/` is gitignored;
  test fixtures are hand-written from the documented layout, never copied from a
  real file.
