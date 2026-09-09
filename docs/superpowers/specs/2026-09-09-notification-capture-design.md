# Bank notification capture (Android)

Design, 2026-09-09. Branch `notification-capture`.

## What this is

FinAnt reads the notifications the owner's bank apps post on their Android
phone, parses the ones that describe money moving, and writes them into the
ledger as **provisional** movements — visible immediately, replaced by the real
row when the bank's statement is next imported.

It is the only automation this app can have without a bank connection, an
aggregator or a network call, and the owner asked for it knowing what it costs.

## What it changes about FinAnt's promises

`docs/security-model.md` currently states: "Movements enter the database only
from a statement file the owner exports from their bank and picks from local
storage, or from a manual entry." That sentence becomes false. `README.md`
carries the same framing.

Both must be rewritten as part of this work, not after it. The honest new
version: movements enter from a statement file, a manual entry, or — on Android,
if the owner turns it on and grants notification access — from a notification
one of their own bank apps posted on the device.

What does **not** change:

- No network calls. Nothing is sent anywhere. The one existing network call
  (the optional assistant model download) is untouched.
- No analytics, no telemetry, no logging of any movement, narrative or IBAN.
- The ledger stays in SQLCipher, keyed from the device keychain.
- Statement imports remain the source of truth. A notification never overrides
  a booked row.

## Scope

In scope: Android only; the owner's four notifying banks (Trade Republic, ING
Deutschland, DKB, Openbank España); an opt-in, per-bank pipeline from
notification to provisional movement; reconciliation against the next statement
import.

Out of scope: iOS (no platform API exists); Raisin (no amount-bearing push);
reading notification _actions_ or replying to them; any background network
activity; publishing to an app store (see Limits).

## Architecture

```
Android system
  │  posts a notification
  ▼
FinAntNotificationListenerService (Kotlin, local Expo module)
  │  reads sbn.packageName ONLY; returns if not allowlisted
  │  reads title/text/postTime for an allowlisted package
  ▼
Headless JS task "FinAntNotificationCapture"
  │  opens SQLCipher, parses, writes notification_captures row
  ▼
  ├─ auto_approve off → row sits pending, owner accepts in the inbox
  └─ auto_approve on  → provisional transaction written immediately
                          │
                          ▼
                    next statement import
                    ingest() → matchProvisional() → statement row wins,
                    provisional soft-deleted with superseded_by_id
```

### Verified platform facts

Checked against this repo's pinned versions on 2026-09-09, not from memory:

- Local Expo modules: `npx create-expo-module@latest --local` scaffolds
  `modules/<name>/{android,ios,src,expo-module.config.json,index.ts}`,
  autolinked by prebuild.
  <https://docs.expo.dev/modules/get-started/>
- `NotificationListenerService` requires `android:exported="true"`, the
  `BIND_NOTIFICATION_LISTENER_SERVICE` permission and the
  `android.service.notification.NotificationListenerService` intent-filter
  action. The user grants access via
  `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`. The system binds and
  rebinds the service on its own; the app need not be running, and no
  `BOOT_COMPLETED` receiver is needed. API 18+.
  <https://developer.android.com/reference/android/service/notification/NotificationListenerService>
- A library module's `android/src/main/AndroidManifest.xml` is merged into the
  app manifest by the Android manifest merger. Confirmed in this repo:
  `node_modules/expo-local-authentication/android/src/main/AndroidManifest.xml`
  declares its permissions this way. **No config plugin is required.**
- Headless JS works under the bridgeless new architecture in the pinned
  react-native 0.86.3: `HeadlessJsTaskService.kt` resolves `ReactHost` behind
  `ReactNativeNewArchitectureFeatureFlags.enableBridgelessArchitecture()`, and
  `HeadlessJsTaskConfig(taskKey, data, timeout, isAllowedInForeground,
retryPolicy)` is present in
  `node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/jstasks/`.
  `HeadlessJsTaskContext.startTask` must be called on the UI thread.
  <https://reactnative.dev/docs/headless-js-android>

## Component 1: the native module

`apps/mobile/modules/notification-capture/`.

### The allowlist gate

The entire privacy argument for this feature is one early return:

```kotlin
override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val packageName = sbn?.packageName ?: return
    if (packageName !in allowedPackages()) return   // before sbn.notification is touched
    // ... only now read EXTRA_TITLE, EXTRA_TEXT, EXTRA_BIG_TEXT, postTime, sbn.key
}
```

Notification access is a broad grant: the service is offered every notification
on the device. A message from a person, a 2FA code, a health app's reminder must
return on the first line, with their text never dereferenced, never copied out
of the `Notification`, never written anywhere, never logged. This is why the
filter is native and not in JavaScript: the community package
`react-native-android-notification-listener` forwards everything to JS and
expects filtering there, which would put every notification on the phone through
FinAnt's JS runtime and make the allowlist a matter of application discipline —
the exact thing this codebase refuses to rely on for dedupe.

Reviewers: this method is the security boundary. Keep it short enough to verify
by reading.

### Where the allowlist lives

Plain `SharedPreferences`, key `finant.capture.packages`, package names only.

It cannot live in the database: the service runs while the app is closed and the
SQLCipher connection is not open. Package names of the owner's own bank apps are
not sensitive — they reveal which banks the owner uses to anything that can
already read the app's private storage, which is the same conclusion an attacker
draws from the notifications themselves. No amount, narrative, account or IBAN
is ever written there.

The database remains authoritative for the allowlist; `SharedPreferences` is a
projection written whenever `notification_sources` changes.

### Learning mode

Package ids must not be guessed (`de.dkb.portalapp` versus
`com.dkbcodefactory.banking` is exactly the kind of guess this repo forbids for
column layouts), and enumerating installed apps would require
`QUERY_ALL_PACKAGES`, which is a worse trade than the feature is worth.

So: the owner taps "find my bank apps", which sets a prefs flag with an expiry
timestamp (default 5 minutes). While it is unexpired, the service records the
**package name only** — no title, no text, no post time — of every notification
it sees, into prefs. The owner triggers a payment, returns, and picks their bank
from the list of names collected. Expiry is enforced native-side on every
`onNotificationPosted`.

### JS surface

```ts
isSupported(): boolean              // false on iOS
isPermissionGranted(): boolean
openPermissionSettings(): void      // ACTION_NOTIFICATION_LISTENER_SETTINGS
setAllowedPackages(packages: string[]): void
startLearning(seconds: number): void
consumeLearnedPackages(): string[]  // reads and clears
```

iOS ships the same module with the same surface: `isSupported()` returns false,
everything else throws `unsupported`. Screens branch on `isSupported()`, not on
`Platform.OS`.

### Delivering to JS

The service cannot extend `HeadlessJsTaskService` (it already extends
`NotificationListenerService`), and must not call `startForegroundService` —
Android 8+ background-start limits aside, a foreground-service notification for
every coffee is absurd. So it replicates the ~20 lines of RN's own `startTask`
in place:

1. `HeadlessJsTaskService.acquireWakeLockNow(this)`
2. On the UI thread, `HeadlessJsTaskContext.getInstance(reactContext).startTask(config)`
3. If there is no current React context, `reactHost.start()` and start the task
   from a `ReactInstanceEventListener`, mirroring RN's bridgeless path.

This is legitimate because the process is already alive: the system bound this
listener service.

Config: task key `FinAntNotificationCapture`, timeout 15000 ms,
`isAllowedInForeground = true` (RN throws otherwise when a notification arrives
while the app is open), `LinearCountingRetryPolicy(3, 1000)`.

### Entry-point registration

`expo-router` requires the `app/` tree lazily, so a task registered inside
`app/_layout.tsx` never evaluates on a headless launch. New `apps/mobile/index.js`,
with `main` in `apps/mobile/package.json` repointed at it:

```js
import 'expo-router/entry';
import './src/notifications/headless-task';
```

`src/notifications/headless-task.ts` calls
`AppRegistry.registerHeadlessTask('FinAntNotificationCapture', () => handleCapture)`.
The task opens the database through the existing `openDatabase()`, parses, and
writes. It touches no UI, no i18n and no assistant model.

## Component 2: schema (migration 9)

```sql
CREATE TABLE notification_sources (
  id TEXT PRIMARY KEY NOT NULL,
  package_name TEXT NOT NULL,
  label TEXT NOT NULL,
  institution_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_notif_source_package ON notification_sources(package_name);

CREATE TABLE notification_routes (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT NOT NULL REFERENCES notification_sources(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  match_json TEXT,
  priority INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_notif_route_fallback ON notification_routes(source_id)
  WHERE match_json IS NULL;

CREATE TABLE notification_captures (
  id TEXT PRIMARY KEY NOT NULL,
  source_id TEXT REFERENCES notification_sources(id) ON DELETE SET NULL,
  package_name TEXT NOT NULL,
  posted_at TEXT NOT NULL,
  title TEXT,
  body TEXT,
  android_key TEXT,
  capture_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  parser_id TEXT,
  parsed_json TEXT,
  transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_notif_capture_hash ON notification_captures(capture_hash);
CREATE INDEX idx_notif_capture_status ON notification_captures(status);

ALTER TABLE transactions ADD COLUMN provisional INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN superseded_by_id TEXT;
CREATE INDEX idx_tx_provisional ON transactions(provisional) WHERE provisional = 1;
```

`status` is one of `pending`, `unreadable`, `accepted`, `dismissed`.

`notification_routes.match_json` holds a `RuleMatch` tree from `@finant/core` —
the same shape `rules.match_json` uses, evaluated by the same code. One app can
notify about several accounts (DKB's Girokonto and its Visa; Trade Republic card
spend and savings-plan executions), so routing needs a discriminator match on
the text: card last four digits, an account nickname, the word "Visa". Exactly
one fallback route per source is permitted, enforced by the partial unique
index; a notification that matches no discriminator lands there and is flagged.

`auto_approve` is per source, not global: the owner will trust one bank's
wording long before another's, and a single global switch would force the
weakest template to gate the strongest.

### The timestamp exception, stated once

Android supplies `postTime` as epoch milliseconds. There is no way to avoid a
timestamp at that boundary. `CLAUDE.md` forbids routing a booking date through a
Date/timestamp, because it moves 1 March into February west of UTC.

The rule is honoured by converting **once, at the edge**: the parser derives the
device's local calendar day from `postTime` and writes `booking_date` as a plain
`YYYY-MM-DD` string. Nothing downstream ever re-derives a date from `posted_at`,
which exists only for display and dedupe. This is recorded in the migration
comment so a later reader does not "fix" it.

## Component 3: parsers

`packages/importers/src/notifications/`, one file per bank, registry keyed by
package name. Pure functions, no React and no Expo, unit-tested in node.

```ts
type NotificationParseResult =
  | { kind: 'movement'; draft: DraftTransaction; parserId: string }
  | { kind: 'ignored'; parserId: string }
  | { kind: 'unreadable'; reason: string };
```

`ignored` exists so a bank's "your statement is ready" or a login alert does not
fill the inbox, while `unreadable` stays a real signal that a bank changed its
wording. Collapsing the two would either bury the alarm or bury the owner.

Amount parsing reuses `packages/importers/src/values.ts`, which already handles
German and Spanish decimal commas. `side` is set explicitly by each template
from its wording ("Zahlung", "Eingang", "abgebucht", "compra", "ingreso") and is
never inferred from sign alone. `externalId` is always `null`: push text carries
no bank transaction id. `importHash` comes from `importHashOf()` with
`discriminator: capture_hash`, so two identical coffees on one day stay two
movements.

**No parser is written from a guess.** Each bank stays unimplemented until the
owner supplies real notification strings, which go to `fixtures/private/`
(gitignored) and are documented in a new `docs/notification-formats.md`
mirroring `docs/import-formats.md`. Test fixtures are hand-written from the
documented wording. This is the same rule the file importers follow, and it
matters more here: notification text is unversioned and changes without notice.

## Component 4: reconciliation

`packages/core/src/provisional.ts`. Pure, testable in plain node.

Matching a provisional movement to an incoming statement row:

- Candidate requires: same account, same currency, same `side`, and
  `booking_date` within ±3 days.
- Amount: exact match preferred. Otherwise within `max(2%, 100 minor units)` —
  a card authorization of EUR 42.30 booking at EUR 43.50 with a tip, or a
  foreign-currency purchase settling at a different rate.
- Assignment is greedy one-to-one, ordered by (amount delta, date delta). Each
  provisional is consumed at most once.
- **Ambiguity is never resolved by guessing.** If two provisionals match one
  booked row equally well, both stay provisional and are flagged for the owner.
  Silently choosing one is how a real movement disappears.

On a match:

- the statement row is the movement, with its real amount, date and external id;
- the provisional is soft-deleted via the existing `deleted_at`;
- `superseded_by_id` on the provisional points at the winner;
- the capture's `transaction_id` is repointed at the winner, preserving the trail
  from "notification seen on Tuesday" to "row the bank actually booked".

Runs inside `ingest()`, **after** insertion and **before** `detectTransfers()`.
Provisional rows are excluded from transfer detection entirely; otherwise the
matcher pairs a provisional against its own real counterpart.

### Provisionals the bank never books

A declined authorization, a hotel hold that is released, a notification the
owner accepted for a payment that then failed — these produce a provisional
movement no statement will ever match. Left alone it counts in the totals
forever, which is the one way this feature could quietly make the ledger wrong.

So: after every statement import, any provisional row older than 45 days whose
account has been covered by an imported statement past its booking date is
marked **stale** and surfaced in the inbox. The app does not delete it — that is
the owner's call, and a bank booking something six weeks late is not
impossible. It stops counting silently, which is the part that matters.

The 45-day window is deliberately longer than any card settlement cycle the
owner's banks use, so a slow booking is never mistaken for a dead one.

There is no unique-index conflict to lean on: the notification's `import_hash`
is built over its own narrative and cannot collide with the statement's. That is
precisely why reconciliation must be explicit, reviewed code rather than a
database constraint, and why it is the most heavily tested part of this feature.

### Pending, provisional, booked

Three states, and only the middle one is a movement:

- **Pending capture:** parsed but not accepted, because the source has
  `auto_approve` off. No transaction row exists, so it counts toward nothing.
  It sits in the inbox until the owner accepts or dismisses it.
- **Provisional movement:** a transaction row with `provisional = 1`. Written
  immediately when `auto_approve` is on, or on the owner's Accept when it is
  off. Accepting does **not** clear the flag: the owner confirming what the
  notification said is not the bank booking it, and only a statement row can
  settle that.
- **Booked movement:** `provisional = 0`. Only a statement import or a manual
  entry produces one, or reconciliation replacing a provisional with the
  statement row that superseded it.

### How provisional movements count

- **Monthly income/expense totals:** included. That is the point of the feature.
- **Account balance:** included, and labelled. The account screen reads
  `EUR 1,234.56 · including 3 unconfirmed`. The asserted balance stays
  authoritative and history is still measured from it, never stacked on it; the
  provisional rows are movements since, like any other.
- **Forecast history:** excluded. A projection built on unconfirmed rows would
  double-count once the statement lands, and `CLAUDE.md` forbids presenting a
  projection as a booked figure.
- **Exclusion rules and categorisation:** identical to any other movement. A
  provisional row goes through `categorise()` and `shouldExclude()` in `ingest()`
  like everything else.

## Component 5: screens

All gated on `isSupported()` from the native module, not on scattered
`Platform.OS` checks.

- `app/notification-capture.tsx`, from Settings: grant state and a button into
  the Android settings screen; learning mode; one row per source showing
  package, the name the owner gave it, its account routes and its `auto_approve`
  switch; "Delete all captured notifications".
- `app/notification-inbox.tsx`: pending captures render the parsed draft
  (amount, merchant, routed account, guessed category) with Accept / Edit /
  Dismiss. Unreadable captures render their text with a copy button, so the
  owner can supply the string for a template, and Dismiss.
- Dashboard: a "N to review" chip while the inbox is non-empty.
- Movement list and `movement/[id]`: provisional rows are marked — _seen in a
  notification, not yet confirmed by a statement_.

No entity is auto-created anywhere in this flow. The owner names every source
and picks the account each route points at.

i18n keys are added to `en.ts`, `de.ts` and `es.ts`, typed against `Resources`,
so a forgotten language is a compile error rather than a fallback string.

## Retention of notification text

The captures table is the only place in FinAnt that holds a narrative the owner
did not import deliberately, so it prunes itself:

- **Accept:** `title` and `body` are set to NULL. The movement carries what
  matters. The row survives as a hash-only tombstone, so Android reposting the
  same notification cannot re-create it.
- **Dismiss:** same — NULL the text, keep the tombstone.
- **Unreadable:** text is kept until the owner dismisses it, because that text is
  the bug report.
- Settings offers "Delete all captured notifications", and the existing
  "Erase all data" already destroys the database and then its key.

## Verification

Testable with `npm test` (vitest, packages only):

- `packages/core/tests/provisional.test.ts` — tolerance bands, one-to-one
  consumption, ambiguity refusing to guess, currency and side guards, the ±3 day
  window, that a matched pair leaves exactly one live row, and that a
  provisional past the stale window is marked rather than deleted.
- `packages/importers/tests/notifications/*.test.ts` — each template against
  hand-written fixtures, including `ignored` versus `unreadable`, amount parsing
  with both decimal conventions, and explicit `side` per wording.

`ingest()` stays thin so that the logic worth testing lives in `packages/core`.

**Not covered by automated tests:** the Kotlin. This repo's vitest setup is
packages-only and there is no Android test harness. Verification for the native
module is a manual device checklist, and the allowlist early return gets a
deliberate review:

1. Grant notification access; confirm `isPermissionGranted()` flips.
2. Send a message from a non-allowlisted app (WhatsApp, Signal). Confirm **zero**
   rows in `notification_captures` and nothing in logcat.
3. Trigger a real bank notification with the app force-stopped. Confirm a
   capture row appears, which proves the headless path.
4. Trigger one with the app in the foreground. Confirm no crash, which proves
   `isAllowedInForeground`.
5. Revoke access; confirm the settings screen reports it.

An emulator cannot be trusted for any of this; the grant screen and the
notification listener binding both need a real device.

## Build order

1. Migration 9, repositories, widened `TransactionSource`, types.
2. `provisional.ts` and its tests.
3. Parser registry, plus the first bank — blocked on real notification strings.
4. Native module: manifest, service, allowlist gate, grant helpers, learning
   mode. Device test.
5. Headless task and the entry-point repoint. Device test with the app killed.
6. Inbox and settings screens, i18n for three languages.
7. Wire reconciliation into `ingest()`.
8. Docs: `notification-formats.md`, `security-model.md`, `README.md`,
   `data-model.md`.

Steps 1, 2 and 7 are the ones that can silently corrupt the ledger; they carry
the tests. Step 4 is the one that can silently leak; it carries the review.

## Limits, accepted by the owner

- Banks change notification wording without warning. The result is unreadable
  rows and a template fix. This is ongoing maintenance, not a bug fixed once.
- Push text carries no bank transaction id and often not the final booked
  amount. Provisional movements are approximations by design.
- **No fallback buffer.** Nothing is stored outside SQLCipher, so if Android
  kills the process mid-write, that notification is lost _silently_. Nothing
  ends up wrong — the statement import still catches the movement — but it will
  not appear early. Adding a Keystore-encrypted queue later is an additive
  change if this becomes annoying.
- A JS runtime spins up per bank notification, capped at 15 s.
- Some OEMs drop notification access on app update. The settings screen shows
  grant state so the owner notices.
- Google Play policy forbids `BIND_NOTIFICATION_LISTENER_SERVICE` for an app
  like this. Irrelevant while the APK is sideloaded — but it means FinAnt can
  never be published to the Play Store. Written down here so it is not
  rediscovered in two years.
- iOS gets nothing. This is a permanent platform asymmetry in a codebase that
  has otherwise been symmetric.
