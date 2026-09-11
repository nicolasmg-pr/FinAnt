# Share intake — receiving a statement from another app

A statement can reach the import screen (`app/import.tsx`) without ever going
through its own file picker: another app's share sheet, or a file manager's
"Open with FinAnt", can hand it the same file instead. Nothing about parsing or
storage changes because of this — `parseFile` in `app/import.tsx` already
decides the format from the file's own magic bytes, so a shared file is read
exactly like a picked one, lands on the same preview, and is never written to
the database until the owner taps Confirm. What this feature adds is only the
path a file takes to get to that screen, and it adds no host to talk to and no
new unlock flow: the SQLCipher key is gated on device unlock already, so a
shared file cannot be imported on a locked device any more than a picked one
can.

## Three ways in, two mechanisms

| Source                  | Intent / API                               | Reaches JS as                                                                   |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Android share sheet     | `ACTION_SEND`, URI in `EXTRA_STREAM`       | nothing — an intent extra is not intent _data_, so `expo-linking` never sees it |
| Android "Open with"     | `ACTION_VIEW`, `content://` in intent data | a system path, through expo-router                                              |
| iOS share sheet / Files | document types + `openURL`                 | a `file://` URL, through expo-router                                            |

Two of the three arrive at expo-router as a URL and are caught by
`app/+native-intent.tsx`. The first does not, because `EXTRA_STREAM` is an
intent _extra_, not intent _data_ — nothing expo-router or expo-linking looks
at. That is the entire reason `modules/share-intake` exists: it is a small
native module whose only job is to read that one extra.

## Android's share sheet — `modules/share-intake`

`apps/mobile/modules/share-intake` is a local Expo module, `platforms:
["android"]` only — iOS never needs it, because an iOS share always arrives as
a `file://` URL instead (see below). Its shape follows
`modules/notification-capture`, the existing precedent in this repo for a
local native module: `expo-module.config.json`, and an `index.ts` that goes
through `requireOptionalNativeModule` with an `unavailable` fallback, so a
build without the module (an iOS build, or an Android build made before this
module existed) loses one feature instead of failing to start.

```ts
interface ShareIntake {
  /** False on iOS, where a shared file arrives as a file:// URL instead. */
  isSupported(): boolean;
  /** Reads and clears the file an ACTION_SEND intent brought in, if any. */
  consumePendingShare(): SharedFile | null;
  /** Copies a content:// URI into the cache so it can be read as a file. */
  copyContentUri(uri: string): SharedFile;
}

interface SharedFile {
  uri: string; // a file:// URI inside the app cache
  name: string; // the display name the sending app gave, for the preview only
}
```

`ShareIntakeModule.kt` reads the launching intent from
`appContext.currentActivity?.intent`, lazily — inside `consumePendingShare`
itself rather than at `OnCreate` — because on a cold start the module exists
before the activity does, and JS only asks for this once the database is open.
`OnNewIntent` covers the other case, a share arriving while FinAnt is already
running: the main activity is `singleTask`, so a second share lands there
rather than starting a new instance.

Either way, an `ACTION_SEND` intent's `EXTRA_STREAM` is removed from the intent
as it is read (`intent.removeExtra`) so a reload or a configuration change
cannot import the same file twice — Android hands the same intent object back
on both. The URI is then copied through `ContentResolver.openInputStream` into
`cacheDir/share-intake/`, prefixed with the current time in milliseconds so a
second share cannot collide with one still staged in the preview. The name
comes from `OpenableColumns.DISPLAY_NAME`, with any path separator stripped
(another app's own display name is not to be trusted with one); failing that,
from a MIME-to-extension map — `application/pdf` → `pdf`, `text/csv` and
`text/comma-separated-values` → `csv`, `text/xml` and `application/xml` →
`xml`, `text/plain` → `txt`, the xlsx MIME type → `xlsx` — appended to the
fallback name `statement`. `application/octet-stream` has no entry, so a
mislabelled file with no display name falls back to the bare name `statement`,
extensionless; `parseFile` decides the real format from the bytes regardless of
what the name says. That map lives in Kotlin only, not mirrored in TypeScript,
because naming happens exactly once, during the native copy.

A copy over 25 MB is refused before it is fully streamed — a mis-shared video
is not a statement — and the partially written file is deleted rather than
left behind. Copying into the cache at all is the same exposure the ordinary
file picker already accepts with `copyToCacheDirectory: true`; it is also what
makes a `content://` URI (only granted to FinAnt's process for the life of the
intent) readable as a `file://` path by `expo-file-system` afterwards.

### Two events, not one

The native module emits two events, matched on name:

- `onShareReceived`, with `{ uri, name }` — a warm share copied successfully.
- `onShareFailed`, with `{ code }` — a warm share that could not be copied.

`onShareFailed` was added during implementation; the original design had only
`onShareReceived`. The reason is in `ShareIntakeModule.kt`'s `OnNewIntent`
block, verbatim in a comment there: that lambda is invoked by
`ModuleHolder.post()` with no surrounding try/catch, and `CodedException`
(what `ShareTooLargeException` and `ShareUnreadableException` both are)
extends Kotlin's checked `Exception` rather than `RuntimeException`, so React
Native's own `ReactContext.onNewIntent` — which only catches
`RuntimeException` — does not catch it either. An uncaught `copy()` failure on
a warm share (an oversized or unreadable file shared into a FinAnt that was
already open) would therefore have propagated all the way out and killed the
process. `OnNewIntent` in the shipped module wraps `copy()` in its own
try/catch and turns any `CodedException` — or, for anything else, an
`onShareFailed` with `SHARE_UNREADABLE` — into that event instead of letting it
escape.

## The two error codes

`SHARE_TOO_LARGE` (over the 25 MB ceiling) and `SHARE_UNREADABLE` (the stream
could not be opened or copied, for any other reason) are the only two codes the
native module raises. Every one of the three failure surfaces wraps the native
call in its own try/catch and turns either code into the same pair of routes,
which `app/import.tsx` renders as `errors.shareTooLarge` /
`errors.shareUnreadable`:

- `app/+native-intent.tsx`'s `content://` branch, around `copyContentUri`.
- `app/_layout.tsx`'s `onShareFailed` listener, for a warm `ACTION_SEND` share
  that could not be copied.
- `app/_layout.tsx`'s `ready`-gated effect, around `consumePendingShare()`, for
  the `ACTION_SEND` intent that launched the app.

That third path used to be the odd one out: `consumePendingShare()` had no
try/catch around it, so a cold `ACTION_SEND` launch that was too large or
unreadable threw a `CodedException` nothing on the JS side caught, and the
owner saw a LogBox "Render Error" overlay instead of the friendly error card —
exactly what the device verification for this feature hit (a test command's
URI grant was not recognised by MediaProvider, a testing-harness gap, not a
FinAnt defect — see "Verifying this by hand" below). Commit `9ea74a7` fixed
it: the call is now wrapped like the other two, its code is read through the
same guarded, unknown-shaped-`cause` check the other two use, and the result
is routed through `pendingNavigation` exactly like a received file or a warm
failure — see "Startup order" below. All three surfaces now reach the same two
routes; none of them can crash the app.

## Android's "Open with", and iOS's share sheet and Files — `app/+native-intent.tsx`

The other two rows of the table above arrive as a URL, and Expo Router's
default handling of one is the wrong one for this feature: it treats an
incoming `content://` or `file://` URL as a deep link and navigates to an
unmatched route (expo/expo#23838). `redirectSystemPath`, in
`app/+native-intent.tsx`, is the documented place to intercept that before it
happens:

```ts
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.startsWith('content://')) {
      setPendingShare(ShareIntakeModule.copyContentUri(path));
      return `/import?shared=${Date.now()}`;
    }
    if (path.startsWith('file://')) {
      setPendingShare({ uri: path, name: shareNameFromUri(path) });
      return `/import?shared=${Date.now()}`;
    }
    return path; // a finant:// deep link or anything else: let the router route it
  } catch (cause) {
    const code =
      typeof cause === 'object' && cause !== null && 'code' in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return code === SHARE_TOO_LARGE ? '/import?shared=too-large' : '/import?shared=unreadable';
  }
}
```

A `content://` URI (Android's "Open with") still goes through the same native
`copyContentUri`, for the same reason as the share-sheet path: the grant is
temporary and `expo-file-system` needs a `file://` path. A `file://` URL (iOS)
needs no copy — FinAnt makes none of its own here; whatever the system handed
to `openURL` is passed straight into the store, and `shareNameFromUri` (in
`src/services/share-intake.ts`) derives a display name from the URL's last path
segment, percent-decoded, because iOS gives no separate metadata the way
`OpenableColumns.DISPLAY_NAME` does on Android.

This function must never throw — an exception here is a crash on launch — so
every failure becomes a route instead, and the import screen explains it with
the same error card a failed parse already uses. `initial` (whether this is a
cold start) is deliberately not branched on — a cold start and a warm one are
handled identically — but the route the two success branches return is not a
literal string. `redirectSystemPath` is not launch-only: expo-router calls it
for a URL that arrives while FinAnt is already running just as much as for the
one that launched it, so a `Date.now()` nonce goes into the route on every
call. An early version returned the literal `/import?shared=1` from both
branches: sharing statement A, going back, then sharing statement B produced
the identical route both times, so React Navigation popped back to the
existing import screen without changing params, the mount effect keyed on
`shared` in `app/import.tsx` never re-ran, and the screen kept showing A while
B sat staged in the store — confirming A while the owner believed they had
shared B. `app/_layout.tsx` mints a nonce the same way for the warm share it
handles directly (see "Startup order" below).

## The MIME list and the iOS UTI list

Both live in `apps/mobile/app.json`, and nowhere else — see "Generated
platforms" below.

Android declares two intent filters. `SEND` is what a share sheet offers
against; `VIEW` (with `BROWSABLE`) is what lets a file manager's "Open with"
find FinAnt for a `content://` or `file://` URI. The two do **not** list the
same MIME set — `SEND` has one entry `VIEW` deliberately omits:

- `application/pdf`
- `text/csv`
- `text/comma-separated-values`
- `text/xml`
- `application/xml`
- `text/plain`
- `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (xlsx)
- `application/octet-stream` — **`SEND` only**

`application/octet-stream` is in the `SEND` filter because exporting apps
routinely mislabel a CSV or an xlsx with it when sharing one directly; it is
left out of `VIEW` because that MIME type is also the generic fallback for
"no idea what this is," and offering it there would make FinAnt a candidate
"Open with" target for arbitrary unrelated files reached through a
`content://` or `file://` URI, not just a mislabelled statement handed to it
directly through the share sheet. `*/*` is deliberately **not** in either
list: offering it would put FinAnt in the share sheet for a photo, a PDF boarding
pass, anything at all, and the device verification for this feature confirmed
the absence works both ways — `com.finant.app` is missing from
`query-activities -a android.intent.action.SEND -t image/jpeg`, and from the
live chooser when sharing a photo, while it is present for `application/pdf`
and `text/csv`.

iOS declares one document type instead of a MIME list, since Apple's document
types are UTIs, not MIME types:

```json
"CFBundleDocumentTypes": [
  {
    "CFBundleTypeName": "Bank statement",
    "CFBundleTypeRole": "Viewer",
    "LSHandlerRank": "Alternate",
    "LSItemContentTypes": [
      "com.adobe.pdf",
      "public.comma-separated-values-text",
      "public.xml",
      "org.openxmlformats.spreadsheetml.sheet",
      "public.plain-text"
    ]
  }
]
```

`LSHandlerRank: Alternate` says FinAnt reads statements; it does not claim to
be the system's PDF viewer, which would be `Owner` or `Default`.
`UIFileSharingEnabled` is **not** set. That key would expose FinAnt's entire
container through Files, and FinAnt's container holds the encrypted database —
there is nothing in it an owner should be browsing to from outside the app.
`LSSupportsOpeningDocumentsInPlace: true` is set alongside it, which is what
lets Files hand FinAnt a document without first duplicating it.

## Why there is no iOS share extension

The design considered, and rejected, a genuine iOS share extension — the kind
that adds its own row with FinAnt's icon inside every app's native share
sheet. It was rejected on cost, not on capability: a share extension is a
second app target, built and signed separately from the main app, and it needs
an App Group so the extension process (which cannot see FinAnt's own
container) can hand the file back to the main app to read. Declaring
`CFBundleDocumentTypes` gets the goal — FinAnt shows up as a destination when
the owner shares a statement, specifically the "Copy to FinAnt" action any app
declaring a document type receives for free — without a second target, a
second signing identity, or a shared container to maintain. Non-goals recorded
alongside this decision: `ACTION_SEND_MULTIPLE`, shared plain text with no file
attached, and importing without the owner confirming — none of the three ways
in this document describes skips the Confirm button.

## The intake store, and the import screen

`apps/mobile/src/services/share-intake.ts` is a module-level, one-shot
handoff — no React, no database, no Expo import, so it is unit-testable under
plain node (`apps/mobile/src/services/tests/share-intake.test.ts`, reached by
`vitest.config.ts` alongside `src/design/tests` and `src/assistant/tests`).
`setPendingShare` and `takePendingShare` are its main surface, plus
`shareNameFromUri` and `peekPendingShare` — the last a read that, unlike
`takePendingShare`, does not clear the pending file; it exists solely for the
startup cache sweep (see "Startup order" below) to see what is staged without
taking it away from `app/import.tsx`. State lives in a module-level variable
rather than React state because `app/+native-intent.tsx` runs before any
component is mounted and has nowhere else to put the file; it is deliberately
not persisted anywhere — a share the owner never confirmed is not a statement
FinAnt is holding on to. Two writers — `+native-intent.tsx` and
`app/_layout.tsx` — and one reader, `app/import.tsx` (the sweep, via
`peekPendingShare`, only ever looks). The file's own path never travels in a
route parameter; the route only ever carries a `Date.now()` nonce (or an error
code), never a URI, so the store is the only place a share's path exists in
JS.

`app/import.tsx` reads it in a mount effect keyed on the route's `shared`
param: `too-large` and `unreadable` render the matching error string directly,
without touching the store (there is nothing pending for either — the copy
never happened); anything else calls `takePendingShare()` and, when it returns
a file, loads it. Loading a shared file and loading a picked file are, by
design, the same code: `pick()` used to run picker → parse → preselect →
`setFile`/`setChoice` as one block; everything after the picker moved into a
separate `load(asset)` function, so `pick()` is now picker-then-`load`, and the
shared-file effect calls the identical `load`. Format detection, account
preselection, the row preview and the Confirm button do not know or care
whether the file came from a picker or a share.

**The cache copy's lifetime.** The bytes behind a staged `SharedFile.uri` are
not the file the owner still has open elsewhere — on Android they are always a
copy the native module wrote, either from an `ACTION_SEND` (`consumePendingShare`,
`onShareReceived`) or a `content://` "Open with" (`copyContentUri`); on iOS no
copy is made by FinAnt's own code, and the `file://` URL is used exactly as the
system handed it to `openURL`. `discardShare` (in
`src/services/share-intake-files.ts`) is what deletes the Android copy, and it
runs at exactly two moments: after a successful Confirm (`import.tsx`'s
`confirm()`, once `ingest` returns), and when a shared file in `sharedFile` is
replaced or the owner leaves the import screen — a cleanup effect keyed on
`[sharedFile]` that fires on every reassignment of that state, not only on
unmount, so a second share superseding a first discards the first's copy
immediately rather than leaving it until the screen closes.

`discardShare` only ever deletes a URI it recognises as its own copy: one
under the app's cache directory (`Paths.cache`, where the Android module
writes), or under the app's `Documents/Inbox` (the directory iOS uses when a
document provider hands over a duplicate instead of the original in place).
This matters specifically for iOS: `app.json` sets
`LSSupportsOpeningDocumentsInPlace: true`, which is exactly the key that lets
Files hand FinAnt the owner's _original_ document rather than an `Inbox` copy,
and `+native-intent.tsx` stores that URL verbatim with no copy of FinAnt's
own. A URI outside both directories — an in-place iOS original — is left
alone; `discardShare` returns without touching it. Everything else about it is
unchanged: safe to call twice, safe to call on a file that is already gone (a
failure inside it is swallowed rather than surfaced to the owner and never
logged, because the reason would carry the file's name), and specific to a
shared file — the ordinary picker's own cache copy (`copyToCacheDirectory:
true`) is untouched, exactly as before this feature.

**The cache sweep at startup.** `discardShare` only runs for a file the app
knows it is still holding — in `sharedFile` React state. A file staged and
then abandoned without ever reaching that state transition cleanly (the app
process killed before the unmount cleanup runs, or a share superseded before
`app/import.tsx` even mounted) leaves its copy behind in
`cacheDir/share-intake` with nothing left to clean it up.
`sweepShareIntakeCache` (also in `src/services/share-intake-files.ts`) is the
backstop: it lists that directory once, at startup, and deletes every entry
except the one, if any, named by its optional `keepUri` argument — every file
in it is one FinAnt itself wrote, so by the time a new launch is starting,
anything else still there belongs to a session that is already over. It is a
no-op on iOS, where the directory it targets is never created (the module
that writes to it is Android-only).

`keepUri` exists because the sweep cannot assume it always runs before every
possible write into that directory — see "Startup order" below for the one
case where it does not, and how the sweep is told to leave that file alone
instead.

## Startup order — `app/_layout.tsx`

`RootLayout` opens the encrypted database and initialises i18n before
rendering the stack, so any screen — including the import screen a share opens
— only ever runs against an open database. The same startup effect also awaits
`sweepShareIntakeCache(peekPendingShare()?.uri)` (see "The cache sweep at
startup" above) before it sets `ready`.

`consumePendingShare()` cannot beat the sweep to a fresh write on an
`ACTION_SEND` cold start: it copies lazily, only once called, from the effect
below that is itself gated on `ready`, which cannot be true before this sweep
has already run. So for that path `peekPendingShare()` is null and the sweep
empties the directory outright. A `content://` "Open with" cold start is
different, and the sweep cannot out-order it: expo-router resolves the
initial URL — and runs `app/+native-intent.tsx`'s `redirectSystemPath` from
inside that resolution — before `NavigationContainer` renders anything,
which is before `RootLayout` itself mounts. `copyContentUri` has therefore
already written its file, and `setPendingShare` has already staged it, before
this startup effect's first line runs. `peekPendingShare()` — a read that,
unlike `takePendingShare`, does not consume the pending file — is what tells
the sweep to leave that one URI alone, so `app/import.tsx` can still read it
once the stack renders. (An earlier version of this sweep reasoned instead
that no write could ever precede it; that reasoning covered `ACTION_SEND` and
the `OnNewIntent` listener correctly but missed this `content://` path, and
the sweep deleted the file it had just staged.)

Three further effects handle a share:

1. **Subscribe, unconditionally, on mount.** `ShareIntakeModule.addListener` is
   called for both `onShareReceived` and `onShareFailed` in an effect with no
   `ready` guard at all. A share can arrive while the startup effect above is
   still opening the database, and nothing on the native side queues an event
   for a listener that is not yet attached — subscribing late means dropping
   it. Receiving one immediately calls `setPendingShare` (the store is only
   memory; nothing reads it before the import screen mounts) and records a
   pending navigation rather than pushing straight away.
2. **Consume the launch intent once `ready`.** `consumePendingShare()` is
   called in an effect gated on `ready`, and only there — `ready` only ever
   transitions `false → true`, once, so this runs at most once. It is gated
   because, unlike the listener above, this call is destructive (the native
   side clears the intent as it reads it) and its result has to go somewhere
   ready to receive it.
3. **Flush the pending navigation once `ready`.** A separate effect holds
   whatever the first two produced — a received file's nonce, or a failure
   code — and pushes the matching route the moment `ready` turns true,
   replacing (not queueing) an earlier one if a second share arrived first.

An earlier shape of this code gated all three behind `ready` together, which
looked simpler but silently dropped a share that arrived while the database
was still opening: nothing was listening yet, and by the time `ready` turned
true there was no longer an event to receive. Splitting the gate — subscribe
always, navigate only once ready — is what fixed that, at the cost of the
`pendingNavigation` state the simpler shape did not need.

A share that arrived through `+native-intent.tsx` needs no `router.push` here:
Expo Router is already navigating to `/import?shared=<nonce>` by the time this
code runs. The store is what makes the two arrival paths converge, so
`app/import.tsx` cannot tell them apart and does not try to.

## Generated platforms: `app.json` is the only place to change any of this

`apps/mobile/android` and `apps/mobile/ios` are generated by `expo prebuild`
(run implicitly by `expo run:android` / `expo run:ios`) and are gitignored —
neither directory is checked in. Every Android intent filter, every iOS
document type, `UIFileSharingEnabled`'s absence, and `LSSupportsOpeningDocumentsInPlace`
all come from `apps/mobile/app.json`. Editing the generated
`AndroidManifest.xml` or `Info.plist` directly does nothing durable: the next
prebuild overwrites it. `apps/mobile/modules/share-intake` is not generated —
it is checked-in source, prebuilt into the native project like any other
Expo module — but its own Kotlin is likewise never hand-edited inside a
generated build folder.

## Verifying this by hand

Parsers are unchanged by this feature, so no parser test changes with it. The
pure pieces — `shareNameFromUri` and the one-shot semantics of the store — are
covered by `apps/mobile/src/services/tests/share-intake.test.ts`, run by `npm
test` like any other. The MIME-to-extension fallback is not mirrored in
TypeScript and so has no test of its own; it is exercised only by the Kotlin
that owns it.

Everything else is native plumbing, best checked on a running emulator or
simulator. One command is worth recording exactly, because it looks like it
should work and does not, for a reason that has nothing to do with FinAnt:

```bash
# This alone throws a SecurityException from MediaProvider before
# com.finant.app is ever entered:
adb shell am start -a android.intent.action.SEND -t text/csv \
  --grant-read-uri-permission --eu android.intent.extra.STREAM "content://media/external/downloads/<id>" \
  -n com.finant.app/.MainActivity

# Adding -d <uri> alongside the same EXTRA_STREAM makes the grant work:
adb shell am start -a android.intent.action.SEND -d "content://media/external/downloads/<id>" -t text/csv \
  --grant-read-uri-permission --eu android.intent.extra.STREAM "content://media/external/downloads/<id>" \
  -n com.finant.app/.MainActivity
```

A real sharing app never needs the second form's extra `-d` flag. When an app
calls `startActivity()` on a genuine `ACTION_SEND` intent, Android's own
framework code runs `Intent.migrateExtraStreamToClipData()` first, which
attaches the URI grant to the intent's `ClipData` as well as to `EXTRA_STREAM`.
`adb shell am start` builds the intent directly and skips that step, so the
grant `--grant-read-uri-permission` requests is never attached anywhere
MediaProvider's own permission check looks for it — unless the same URI is
also passed as the intent's `data` (`-d`), which the grant mechanism does
inspect unconditionally. Passing `-d` changes nothing about which code path
FinAnt runs; `ShareIntakeModule` still reads the URI from `EXTRA_STREAM` only,
exactly as it would for a real share. It is purely a way to make `adb`'s
shortcut produce a grant a real share already has.

With that, an emulator or simulator run can exercise all three rows of the
table at the top of this document: share a file into a closed FinAnt (cold
`ACTION_SEND`), share one into a FinAnt already open (warm `ACTION_SEND`, via
`OnNewIntent`), open one from a file manager's "Open with" (`ACTION_VIEW`,
`content://`), and, on iOS, `xcrun simctl openurl booted "file:///path/to/file"`
for the `file://` route. Confirming the import afterwards and inspecting
`adb shell run-as com.finant.app ls -la cache/share-intake` is how the cache
sweep in "The cache copy's lifetime" above is checked: the directory should be
empty once the import is confirmed.

## Sources consulted

- https://docs.expo.dev/versions/latest/config/app/
- https://docs.expo.dev/modules/module-api/
- https://docs.expo.dev/router/advanced/native-intent/
- https://github.com/expo/expo/issues/23838
