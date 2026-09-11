# Share intake — receiving a statement from another app's share sheet

Date: 2026-09-11
Status: approved design, not yet implemented
Branch: `share-intake`

## Problem

A statement reaches FinAnt only through the file picker on `app/import.tsx`.
Exporting from Trade Republic therefore takes three steps: export, save to the
device, then open FinAnt and hunt for the file. Trade Republic's export screen
offers a share sheet, and FinAnt does not appear in it.

Goal: FinAnt appears as a destination when another app shares a statement file,
and the shared file lands on the existing import preview with the format already
recognised.

Non-goals: `ACTION_SEND_MULTIPLE`, shared plain text with no file attached, an
iOS share extension target, and importing without the owner confirming.

## Constraints from the project

- No network calls, no telemetry: this feature adds no host to talk to.
- Never log a movement, a narrative, an IBAN, or a statement's file name.
- No in-app lock exists. The SQLCipher key is read from SecureStore with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so device unlock is already the gate; a
  shared file cannot be imported on a locked device because the database cannot
  be opened. No new unlock flow is needed.
- Parsers are unchanged. `parseFile` in `app/import.tsx` already decides the
  format from magic bytes, so a file that arrives by share is read exactly like
  a file that arrives by picker.

## Three ways in, two mechanisms

| Source | Intent / API | Reaches JS as |
| --- | --- | --- |
| Android share sheet | `ACTION_SEND`, URI in `EXTRA_STREAM` | nothing — extras are not intent *data*, so `expo-linking` never sees it |
| Android "Open with" | `ACTION_VIEW`, `content://` in intent data | a system path through expo-router |
| iOS share sheet / Files | document types + `openURL` | a `file://` URL through expo-router |

So: a native module for `ACTION_SEND`, and `app/+native-intent.tsx` for the two
that do arrive as URLs.

`+native-intent.tsx` is not optional politeness. Expo Router treats an incoming
`content://` or `file://` URL as a deep link and navigates to an unmatched route
(expo/expo#23838). `redirectSystemPath` is the documented place to intercept it.

## 1. Native surfaces (configuration only)

`apps/mobile/app.json`.

Android — two filters. `data` takes an array, and `mimeType` is a member of a
data entry:

```json
"intentFilters": [
  {
    "action": "SEND",
    "category": ["DEFAULT"],
    "data": [
      { "mimeType": "application/pdf" },
      { "mimeType": "text/csv" },
      { "mimeType": "text/comma-separated-values" },
      { "mimeType": "text/xml" },
      { "mimeType": "application/xml" },
      { "mimeType": "text/plain" },
      { "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { "mimeType": "application/octet-stream" }
    ]
  },
  {
    "action": "VIEW",
    "category": ["DEFAULT", "BROWSABLE"],
    "data": [
      { "scheme": "content", "mimeType": "application/pdf" },
      { "scheme": "file", "mimeType": "application/pdf" },
      …one pair per MIME type in the SEND filter above…
    ]
  }
]
```

`application/octet-stream` is in the list because exporting apps routinely
mislabel a CSV or an xlsx. `*/*` is deliberately not: FinAnt should not offer
itself when the owner shares a photo.

iOS — document types plus in-place opening:

```json
"infoPlist": {
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
  ],
  "LSSupportsOpeningDocumentsInPlace": true
}
```

`LSHandlerRank: Alternate` — FinAnt reads statements, it does not claim to be
the system's PDF viewer. `UIFileSharingEnabled` is **not** set: that would
expose FinAnt's own container, and its container holds the encrypted database.

## 2. `apps/mobile/modules/share-intake` (Android only)

Same shape as `modules/notification-capture`, which is the precedent in this
repo for a local native module: `expo-module.config.json`, an `index.ts` that
goes through `requireOptionalNativeModule` with an `unavailable` fallback so a
build without the module loses this one feature instead of failing to start.

`platforms: ["android"]`. iOS has no module: it needs none.

JS surface:

```ts
interface ShareIntakeModule {
  /** False on iOS, where a shared file arrives as a file:// URL instead. */
  isSupported(): boolean;
  /** Reads and clears the file an ACTION_SEND intent brought in, if any. */
  consumePendingShare(): SharedFile | null;
  /** Copies a content:// URI into the cache so it can be read as a file. */
  copyContentUri(uri: string): SharedFile;
}

interface SharedFile {
  /** A file:// URI inside the app cache. */
  uri: string;
  /** The display name the sending app gave, for the preview only. */
  name: string;
}
```

`ShareIntakeModule.kt`:

- `OnCreate` reads `appContext.currentActivity?.intent`; `OnNewIntent` covers a
  warm start, since the main activity is `singleTask` and a second share
  arrives there rather than in a new intent at creation.
- For an `ACTION_SEND`, takes `EXTRA_STREAM`, copies it through
  `ContentResolver.openInputStream` into `cacheDir/share-intake/`, and keeps the
  result as pending. Name from `OpenableColumns.DISPLAY_NAME`, falling back to
  an extension derived from the MIME type.
- Refuses anything over 25 MB, so a mis-shared video is rejected before it is
  streamed. A refusal is an error the import screen shows, not a crash.
- `sendEvent("onShareReceived", …)` after a warm-start copy, so a share into a
  running app navigates without waiting for the next mount.
- Logs byte counts at most. No file name, no content, ever.

Copying into the cache is the same exposure the picker already accepts with
`copyToCacheDirectory: true`, and it is what makes a `content://` URI readable
by `expo-file-system` at all.

## 3. Intake store — `apps/mobile/src/services/share-intake.ts`

A module-level one-shot handoff, no React, no database:

```ts
export function setPendingShare(file: SharedFile): void;
export function takePendingShare(): SharedFile | null;
export async function discardShare(file: SharedFile): Promise<void>;
```

Two writers: `+native-intent.tsx`, and `app/_layout.tsx` — which stores what
`consumePendingShare()` returned at startup and what `onShareReceived`
delivers while running, then navigates. One reader: `app/import.tsx`.

The file's path never travels in a route parameter — the route carries only
`?shared=1`.

`discardShare` deletes the cache copy and is safe to call twice.

## 4. `app/+native-intent.tsx`

```ts
export function redirectSystemPath({ path, initial }) {
  try {
    if (!path.startsWith('file://') && !path.startsWith('content://')) return path;
    const file = path.startsWith('content://') ? copyContentUri(path) : { uri: path, name: basename(path) };
    setPendingShare(file);
    return '/import?shared=1';
  } catch {
    return '/import?shared=error';
  }
}
```

It must not throw — an exception here is a crash on launch. Every failure
becomes a route, and the import screen reports it with the existing error card.

`initial` is not branched on: a cold start and a warm one both end on the
import screen.

## 5. `app/import.tsx`

One refactor, one effect, no new screen.

- `pick()` today does picker → parse → preselect → `setFile`/`setChoice`.
  Everything after the picker moves into `load(asset: {uri, name})`. `pick()`
  becomes picker plus `load`. The shared path calls the same `load`, so format
  detection, account preselection, the row preview and the Confirm button are
  literally the same code.
- A mount effect calls `takePendingShare()` and, if there is one, `load`s it;
  `?shared=error` renders the existing error card instead.
- The owner still confirms. A shared file is never ingested on arrival.
- Cleanup: `discardShare` after a successful confirm, and on leaving the screen
  with a shared file still staged. Only shared copies are deleted; the picker's
  behaviour is untouched.

## 6. Startup order

`app/_layout.tsx` opens the database and initialises i18n before rendering the
stack, so a share that arrives on a cold start waits behind the same gate as
everything else. After `ready`, the layout:

1. calls `consumePendingShare()` once — the `ACTION_SEND` that launched the app;
2. subscribes to `onShareReceived` for shares that arrive while running;
3. for either, calls `setPendingShare` and then `router.push('/import?shared=1')`.

A share that came in through `+native-intent.tsx` needs no push: Expo Router is
already navigating to that route. The store makes the two paths converge, so
`import.tsx` cannot tell them apart.

## Error handling

| Case | Result |
| --- | --- |
| Type FinAnt cannot parse | existing error card, `errors.importFailed` |
| Over 25 MB | error card, file not copied |
| `EXTRA_STREAM` missing or unreadable | error card; nothing pending |
| Share arrives while a file is already staged | the arriving file replaces it, same as picking again |
| Confirm fails mid-ingest | unchanged: existing retry path, cache copy kept |

## Testing

Parsers are unchanged, so no parser tests change. The one pure function worth a
unit test is `extensionForMimeType`, which goes into `packages/importers`
beside `yearFromFileName` and gets vitest coverage there.

The rest is native plumbing, verified by hand:

- Android emulator: share a PDF out of Files and out of Drive; confirm the
  preview shows `Trade Republic — statement (PDF)`; share again into the
  running app; share a photo and confirm FinAnt is absent from the sheet.
- iOS simulator: Files → share → "Copy to FinAnt"; confirm no unmatched route.
- `npm run typecheck` and `npm test`.

## Documentation

`docs/share-intake.md`: both surfaces, the MIME and UTI lists, why the share
extension was refused, the cache lifetime, and the expo-router interception
that `+native-intent.tsx` exists to prevent.

Sources consulted:

- https://docs.expo.dev/versions/latest/config/app/
- https://docs.expo.dev/modules/module-api/
- https://docs.expo.dev/router/advanced/native-intent/
- https://github.com/expo/expo/issues/23838
