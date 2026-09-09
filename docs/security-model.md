# Security model

## What is stored, and where

| Data                                        | Location                                                       | Protection                                                                                              |
| ------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Movements, categories, rules, budgets       | `finant.db` in app storage                                     | SQLCipher, key from the device keychain                                                                 |
| SQLCipher passphrase                        | iOS Keychain / Android Keystore                                | iOS `WHEN_UNLOCKED_THIS_DEVICE_ONLY`; Android non-exportable Keystore key, `allowBackup: false`         |
| Notification allowlist (package names only) | Android `SharedPreferences` (`finant.capture`, key `packages`) | Not encrypted; holds no amount, narrative, account or IBAN — see "Notification capture (Android)" below |

The optional assistant model file also lives in app storage, unencrypted. It is
a public file of model weights containing nothing about the owner, and SQLCipher
is for the ledger.

There are no API credentials of any kind: the app talks to no bank, no
aggregator and no FinAnt server. A movement enters the database in one of
three ways: from a statement file the owner exports from their bank and picks
from local storage; from a manual entry; or — on Android, only if the owner
turns the feature on and grants notification access — from a push
notification one of their own bank apps posted on the device. See
"Notification capture (Android)" below for what that third path can and
cannot see.

There is no FinAnt account, no server, and no cloud copy. Erasing the app erases
the data, and so does Settings > Erase all data: it deletes the database file and
then the key, rather than deleting rows and leaving them in the file's free pages.
It also empties the notification allowlist and anything learning mode collected,
because those live outside the database — a total erase that left a preferences
file behind still naming the owner's banks would not be one.

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

## Notification capture (Android)

Android only, and permanently so — iOS has no API for reading another app's
notifications, so this is not a gap a future release closes. It is also off
until the owner turns it on in Settings: nothing is captured until they grant
notification access in the system's own screen — there is no in-app
permission dialog for this, unlike camera or location — and create at least
one notification source by hand. No source is ever created automatically.

Notification access is a broad grant. Once given, the system offers the
listener service every notification posted on the device, from any app. What
narrows that down to the owner's own bank apps is a single early return in
`FinAntNotificationListenerService.onNotificationPosted`
(`apps/mobile/modules/notification-capture/android/src/main/java/expo/modules/notificationcapture/FinAntNotificationListenerService.kt`):
the package name is checked against the allowlist before `sbn.notification` —
the object holding the title and body — is ever dereferenced. A message from a
person, a 2FA code, a health app's reminder: all of them return on that line,
with their text never read, copied or logged. This is the whole privacy
argument for the feature, and the method is kept short enough to verify by
reading.

The allowlist itself lives in plain Android `SharedPreferences`
(`CaptureAllowlist`, file `finant.capture`, key `packages`), not in SQLCipher,
because the listener service runs while the app — and its database connection
— is closed. What it holds is package names of the owner's own bank apps, and
nothing else: no amount, no narrative, no account, no IBAN. That reveals which
banks the owner uses to anything that can already read the app's private
storage, which is the same thing that storage's notifications already reveal
to it. The database stays authoritative for the allowlist; the preferences
file is a projection, rewritten whenever the owner adds, edits or removes a
source.

Learning mode — "find my bank apps" — works the same way: while it is armed,
the service records the package name only, never a title, a text or a post
time, of every notification it sees, into the same preferences, and the flag
expires by a timestamp the native code checks on every notification. What it
collects is thrown away as soon as the owner has picked from the resulting
list — and if the app never gets that far, because the process was killed
during the window, the same expiry check clears it on the first notification
the service sees afterwards. Either way the list cannot outlive the run that
made it, and "Erase all data" clears it too.

An allowlisted notification's title and body are written into
`notification_captures`, inside SQLCipher, alongside everything else in the
ledger. That text is set to NULL the moment the capture is settled — accepted,
dismissed, or recognised by a parser as `ignored` (a bank's marketing push or
a login alert) — leaving a hash-only tombstone so a byte-identical
re-delivery cannot create a second row. That hash is not enough on its own:
Android stamps a repost of the same notification with a fresh post time,
which hashes differently. A repost is caught by Android's own notification
key instead, matched together with a second, separate fingerprint —
`content_hash` — computed once from the notification's own text when it is
first captured and kept for as long as the row exists, unlike `title` and
`body` themselves.

That second fingerprint is what lets the same check cover a `pending`, an
`unreadable` and an already-`accepted` capture alike, and is why the key
cannot be trusted on its own for any of them. `android_key` names a
notification _slot_: stable across a repost of one notification, but a bank
is free to reuse the same slot for a later, unrelated payment. Matching on
the key alone — tried and rejected during this feature's review — would
therefore have to choose between two failures: catching a repost after
`accept` (closing the hole that let a repost slip past and write a second
provisional movement for one payment) while also silently dropping every
later, distinct payment that happened to arrive through the same slot,
because nothing there was checking whether the text was actually the same.
`content_hash` removes the choice: a later, different payment has different
wording, so a different content hash, so the key matching is never enough by
itself and the different payment is never mistaken for a repost, regardless
of what the earlier row's status is. A bank genuinely re-wording a
notification — "payment pending" becoming "payment completed" — fails the
same comparison and lands as a second, distinct capture for the same reason.
`dismissed` rows are still left out of the check entirely, not because the
fingerprint could not cover them but because a repost of a notification the
owner already dismissed is let back in as a new capture rather than
suppressed — the cost of that choice is only a capture the owner dismisses
again, and dismissing one notification's text says nothing about whatever the
same slot carries next. A notification carrying `FLAG_GROUP_SUMMARY` is
dropped in the listener — a summary repeats its children, and reading it
would capture one payment twice. A capture the parsers could not read keeps
its text until the owner dismisses it, because that text is the only report
of what went wrong.

Nothing about this feature is stored anywhere but SQLCipher and the package
allowlist above — no separate queue, no cache file. That has one consequence
worth stating plainly: if Android kills the app process between the
notification arriving and the database write finishing, the capture is lost
silently, with nothing logged and nothing retried. Nothing ends up wrong — the
next statement import still books the real movement — but it will not have
appeared early. A Keystore-encrypted queue would close that gap; it was left
out because the failure it prevents is a movement arriving a few days late,
and the code to prevent it is not free.

Still zero network calls. Nothing about a notification is sent anywhere; this
feature adds none to the one described below.

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
- The notification allowlist, held in plain `SharedPreferences`. Anything that
  can already read the app's private storage learns which banks the owner
  holds accounts with, and nothing else — no amount, narrative, account or
  IBAN is stored there.

## Rules for contributors

- Never log a movement, a narrative, an IBAN, or any part of a statement.
- The assistant model download is the only permitted network call. Adding a
  second one means changing this document first, and there is no legitimate
  second host to add. Analytics, crash reporting and telemetry stay forbidden
  outright, with or without a network call to carry them.
- Real bank exports never enter the repository. `fixtures/private/` is gitignored;
  test fixtures are hand-written from the documented layout, never copied from a
  real file.
