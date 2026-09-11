# Share Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FinAnt a destination in another app's share sheet, so a statement exported from Trade Republic lands straight on the existing import preview.

**Architecture:** Three ways in, two mechanisms. Android `ACTION_SEND` puts the file URI in intent *extras*, which `expo-linking` never sees, so a local Kotlin module reads it and copies it into the app cache. Android "Open with" (`content://`) and iOS document types (`file://`) arrive as URLs, and `app/+native-intent.tsx` intercepts them — without it Expo Router treats them as deep links and lands on an unmatched route. Both paths write to one in-memory store that `app/import.tsx` reads on mount, then reuse the picker's existing parse/preview/confirm code unchanged.

**Tech Stack:** Expo SDK 57, React Native 0.86, expo-router, Expo Modules API (Kotlin), expo-file-system, vitest.

**Spec:** `docs/superpowers/specs/2026-09-11-share-intake-design.md`

## Global Constraints

- Branch is `share-intake`, already created. Commit after every task.
- `apps/mobile/ios` and `apps/mobile/android` are **gitignored and generated**. `app.json` is the only source of truth; regenerate with `npx expo prebuild -p android` / `-p ios`. Never hand-edit `AndroidManifest.xml` or `Info.plist`.
- Never log a file name, a narrative, an IBAN or any file content. Byte counts only.
- No network calls of any kind. This feature adds none.
- Relative imports inside `packages/*` are extensionless. App code uses its existing style.
- TypeScript strict with `noUncheckedIndexedAccess`: an index access is `T | undefined` and must be handled.
- Translations are typed against `Resources` (which is `typeof en`), so a key added to `packages/i18n/src/en.ts` is a compile error until it exists in `es.ts` and `de.ts` too.
- Size ceiling for a shared file: **25 MB** (`25L * 1024 * 1024`).
- Event name: `onShareReceived`. Native module name: `ShareIntake`. Error codes: `SHARE_TOO_LARGE`, `SHARE_UNREADABLE`.
- MIME list, used identically in the Android intent filters and the Kotlin extension map: `application/pdf`, `text/csv`, `text/comma-separated-values`, `text/xml`, `application/xml`, `text/plain`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/octet-stream`.
- Verification commands: `npm test`, `npm run typecheck`, `npm run lint` (scope prettier to changed paths only — a repo-wide `lint:fix` reformats everything and drowns the diff).

---

### Task 1: Intake store and iOS name parsing

The one-shot handoff between whichever path received the file and the import screen. Pure TypeScript, no Expo import, so vitest can run it under node.

**Files:**
- Create: `apps/mobile/src/services/share-intake.ts`
- Create: `apps/mobile/src/services/tests/share-intake.test.ts`
- Modify: `vitest.config.ts` (add the new test directory to `include`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface SharedFile { uri: string; name: string }`
  - `setPendingShare(file: SharedFile): void`
  - `takePendingShare(): SharedFile | null`
  - `shareNameFromUri(uri: string): string`
  - `const FALLBACK_SHARE_NAME = 'statement'`

- [ ] **Step 1: Add the app services test directory to vitest**

In `vitest.config.ts`, extend `include`:

```ts
    include: [
      'packages/*/tests/**/*.test.ts',
      'apps/mobile/src/design/tests/**/*.test.ts',
      'apps/mobile/src/assistant/tests/**/*.test.ts',
      'apps/mobile/src/services/tests/**/*.test.ts',
    ],
```

- [ ] **Step 2: Write the failing test**

Create `apps/mobile/src/services/tests/share-intake.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FALLBACK_SHARE_NAME,
  setPendingShare,
  shareNameFromUri,
  takePendingShare,
} from '../share-intake';

describe('takePendingShare', () => {
  beforeEach(() => {
    takePendingShare();
  });

  it('is empty until something arrives', () => {
    expect(takePendingShare()).toBeNull();
  });

  it('hands the file over exactly once', () => {
    setPendingShare({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    expect(takePendingShare()).toEqual({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    expect(takePendingShare()).toBeNull();
  });

  it('keeps the newest file when two arrive before either is read', () => {
    setPendingShare({ uri: 'file:///cache/a.pdf', name: 'a.pdf' });
    setPendingShare({ uri: 'file:///cache/b.pdf', name: 'b.pdf' });
    expect(takePendingShare()?.name).toBe('b.pdf');
  });
});

describe('shareNameFromUri', () => {
  it('percent-decodes the last segment', () => {
    // iOS hands over the file in the app's Inbox directory, named as the
    // sending app named it: Trade Republic's export is Spanish-titled.
    expect(shareNameFromUri('file:///var/mobile/Inbox/Certificado%20de%20saldo.pdf')).toBe(
      'Certificado de saldo.pdf',
    );
  });

  it('drops a query and a fragment', () => {
    expect(shareNameFromUri('file:///tmp/statement.csv?v=2')).toBe('statement.csv');
    expect(shareNameFromUri('file:///tmp/statement.csv#page=1')).toBe('statement.csv');
  });

  it('falls back when there is no usable segment', () => {
    expect(shareNameFromUri('file:///')).toBe(FALLBACK_SHARE_NAME);
    expect(shareNameFromUri('content://media/external/downloads')).toBe('downloads');
    // An undecodable name is still shown verbatim rather than swallowed.
    expect(shareNameFromUri('%%%not-a-uri')).toBe('%%%not-a-uri');
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `npm test -- share-intake`
Expected: FAIL — `Cannot find module '../share-intake'`.

- [ ] **Step 4: Write the implementation**

Create `apps/mobile/src/services/share-intake.ts`:

```ts
/**
 * The handoff between a file arriving from another app and the import screen.
 *
 * A shared file reaches the app in one of three ways — an Android ACTION_SEND
 * intent, an Android content:// "open with", or an iOS document-type openURL —
 * and all three end here, so `app/import.tsx` cannot tell them apart and needs
 * no branch per platform.
 *
 * Module state rather than React state on purpose: `app/+native-intent.tsx`
 * runs before any component is mounted and has nowhere else to put the file.
 * It is deliberately not persisted — a share that the owner never confirmed is
 * not a statement FinAnt is holding on to.
 */

export interface SharedFile {
  /** A `file://` URI the app can read: on Android, a copy in its own cache. */
  uri: string;
  /** The name the sending app gave, shown in the preview and nowhere else. */
  name: string;
}

/** Used when a URI carries no segment worth showing the owner. */
export const FALLBACK_SHARE_NAME = 'statement';

let pending: SharedFile | null = null;

export function setPendingShare(file: SharedFile): void {
  // Last one wins: a second share before the first was read means the owner
  // changed their mind, exactly as picking a second file does.
  pending = file;
}

/** Reads and clears the waiting file. Returns null when there is none. */
export function takePendingShare(): SharedFile | null {
  const file = pending;
  pending = null;
  return file;
}

/**
 * The display name for a URL-delivered file. iOS gives a `file://` URL and no
 * metadata, so the name has to come out of the path. Android's ACTION_SEND path
 * does not use this: there the name comes from `OpenableColumns.DISPLAY_NAME`
 * during the native copy.
 */
export function shareNameFromUri(uri: string): string {
  const path = uri.split('#')[0]?.split('?')[0] ?? '';
  const segment = path.split('/').pop() ?? '';
  if (!segment) return FALLBACK_SHARE_NAME;
  try {
    // A name is only a label here; a malformed escape must not throw on launch.
    const decoded = decodeURIComponent(segment);
    return decoded.trim() === '' ? FALLBACK_SHARE_NAME : decoded;
  } catch {
    return segment;
  }
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `npm test -- share-intake`
Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add vitest.config.ts apps/mobile/src/services/share-intake.ts apps/mobile/src/services/tests/share-intake.test.ts
git commit -m "feat(import): add the one-shot store a shared file waits in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Android native module `share-intake`

Reads the `ACTION_SEND` intent and copies its stream into the app cache. Modelled on `apps/mobile/modules/notification-capture`, which is this repo's existing local-module pattern.

**Files:**
- Create: `apps/mobile/modules/share-intake/expo-module.config.json`
- Create: `apps/mobile/modules/share-intake/index.ts`
- Create: `apps/mobile/modules/share-intake/android/build.gradle`
- Create: `apps/mobile/modules/share-intake/android/src/main/AndroidManifest.xml`
- Create: `apps/mobile/modules/share-intake/android/src/main/java/expo/modules/shareintake/ShareIntakeModule.kt`

**Interfaces:**
- Consumes: `SharedFile` from `apps/mobile/src/services/share-intake.ts` (Task 1).
- Produces, from `modules/share-intake/index.ts`:
  - default export `ShareIntakeModule`
  - `isSupported(): boolean` — false on iOS
  - `consumePendingShare(): SharedFile | null`
  - `copyContentUri(uri: string): SharedFile`
  - `addListener(event: 'onShareReceived', listener: (file: SharedFile) => void): EventSubscription`
  - `addListener(event: 'onShareFailed', listener: (failure: { code: string }) => void): EventSubscription`
  - `SHARE_TOO_LARGE = 'SHARE_TOO_LARGE'`, `SHARE_UNREADABLE = 'SHARE_UNREADABLE'`

- [ ] **Step 1: Write the module manifest**

`apps/mobile/modules/share-intake/expo-module.config.json` — Android only, because iOS needs no native code for this: its shared file arrives as a `file://` URL that `app/+native-intent.tsx` handles.

```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.shareintake.ShareIntakeModule"]
  }
}
```

- [ ] **Step 2: Write the Gradle build file**

`apps/mobile/modules/share-intake/android/build.gradle`. Unlike `notification-capture`, this module starts no headless task and needs nothing from React Native directly, so there is no `com.facebook.react:react-android` dependency.

```gradle
plugins {
  id 'com.android.library'
  id 'expo-module-gradle-plugin'
}

group = 'expo.modules.shareintake'
version = '1.0.0'

android {
  namespace "expo.modules.shareintake"
  defaultConfig {
    versionCode 1
    versionName '1.0.0'
  }
}
```

If the Kotlin compile in Step 6 cannot resolve `androidx.core.content.IntentCompat` or `androidx.core.os.bundleOf`, androidx.core is not reaching this module transitively — add it explicitly and rebuild:

```gradle
dependencies {
  implementation 'androidx.core:core-ktx:1.13.1'
}
```

- [ ] **Step 3: Write the module's manifest stub**

`apps/mobile/modules/share-intake/android/src/main/AndroidManifest.xml`. The intent filters belong to the **app's** main activity and are declared in `app.json` (Task 3), not here — a library manifest cannot add a filter to another module's activity.

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android" />
```

- [ ] **Step 4: Write the Kotlin module**

`apps/mobile/modules/share-intake/android/src/main/java/expo/modules/shareintake/ShareIntakeModule.kt`:

```kotlin
package expo.modules.shareintake

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import androidx.core.content.IntentCompat
import androidx.core.os.bundleOf
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

/** Refused rather than streamed: a mis-shared video is not a statement. */
private const val MAX_BYTES = 25L * 1024 * 1024
private const val SHARE_RECEIVED = "onShareReceived"
private const val SHARE_FAILED = "onShareFailed"
private const val CACHE_DIR = "share-intake"
private const val FALLBACK_NAME = "statement"

/**
 * Only used when the sending app offers no display name. Kept here and not in
 * TypeScript because the name is chosen while the bytes are being copied.
 */
private val MIME_EXTENSIONS = mapOf(
    "application/pdf" to "pdf",
    "text/csv" to "csv",
    "text/comma-separated-values" to "csv",
    "text/xml" to "xml",
    "application/xml" to "xml",
    "text/plain" to "txt",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" to "xlsx",
)

internal class ShareTooLargeException :
    CodedException("SHARE_TOO_LARGE", "The shared file is larger than $MAX_BYTES bytes", null)

internal class ShareUnreadableException(cause: Throwable?) :
    CodedException("SHARE_UNREADABLE", "The shared file could not be read", cause)

/**
 * Receives a file another app shared with FinAnt.
 *
 * An ACTION_SEND intent carries its file URI in `EXTRA_STREAM`, which is an
 * intent *extra* rather than intent data, so expo-linking never reports it and
 * `app/+native-intent.tsx` never runs for it. That is the whole reason this
 * module exists.
 *
 * The bytes are copied into the app's own cache because a `content://` URI is
 * granted to this process for the life of the intent only, and because
 * expo-file-system reads a `file://` path. It is the same copy the document
 * picker already makes with `copyToCacheDirectory: true`.
 *
 * Nothing here logs a file name or a byte of content.
 */
class ShareIntakeModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("ShareIntake")

        Events(SHARE_RECEIVED, SHARE_FAILED)

        Function("isSupported") { true }

        // Read lazily rather than in OnCreate: on a cold start the module is
        // created before the activity is available, and JS asks for this only
        // once the database is open.
        Function("consumePendingShare") {
            val activity = appContext.currentActivity ?: return@Function null
            val intent = activity.intent ?: return@Function null
            takeSharedUri(intent)?.let { uri -> copy(uri, intent.type) }
        }

        Function("copyContentUri") { uri: String ->
            copy(Uri.parse(uri), null)
        }

        // A share into an app that is already running: singleTask means the
        // same activity receives it, so there is no second cold start to read.
        //
        // Nothing may escape this lambda. Expo posts it without a try/catch,
        // and RN's ReactContext.onNewIntent catches only RuntimeException,
        // while CodedException is a checked Exception — so a throw here would
        // kill the process on the very path this block exists to serve.
        OnNewIntent { intent ->
            val uri = takeSharedUri(intent) ?: return@OnNewIntent
            try {
                val file = copy(uri, intent.type)
                sendEvent(SHARE_RECEIVED, bundleOf("uri" to file["uri"], "name" to file["name"]))
            } catch (cause: Throwable) {
                val code = (cause as? CodedException)?.code ?: "SHARE_UNREADABLE"
                sendEvent(SHARE_FAILED, bundleOf("code" to code))
            }
        }
    }

    /**
     * The shared URI, removed from the intent as it is read. Android hands the
     * same intent back on every configuration change and on every JS reload,
     * and without this the file would be imported again on each one.
     */
    private fun takeSharedUri(intent: Intent): Uri? {
        if (intent.action != Intent.ACTION_SEND) return null
        val uri = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
            ?: return null
        intent.removeExtra(Intent.EXTRA_STREAM)
        return uri
    }

    private fun copy(uri: Uri, declaredType: String?): Map<String, String> {
        val context = appContext.reactContext ?: throw ShareUnreadableException(null)
        val resolver = context.contentResolver
        val name = displayName(resolver, uri) ?: fallbackName(declaredType ?: resolver.getType(uri))
        val directory = File(context.cacheDir, CACHE_DIR).apply { mkdirs() }
        // Prefixed so two shares of the same export do not overwrite each other
        // while the first is still staged in the preview.
        val target = File(directory, "${System.currentTimeMillis()}-$name")

        try {
            val input = resolver.openInputStream(uri) ?: throw ShareUnreadableException(null)
            input.use { source ->
                target.outputStream().use { sink ->
                    val buffer = ByteArray(64 * 1024)
                    var written = 0L
                    while (true) {
                        val read = source.read(buffer)
                        if (read <= 0) break
                        written += read
                        if (written > MAX_BYTES) throw ShareTooLargeException()
                        sink.write(buffer, 0, read)
                    }
                }
            }
        } catch (cause: Throwable) {
            target.delete()
            if (cause is CodedException) throw cause
            throw ShareUnreadableException(cause)
        }

        return mapOf("uri" to Uri.fromFile(target).toString(), "name" to name)
    }

    private fun displayName(resolver: ContentResolver, uri: Uri): String? {
        val cursor = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
            ?: return null
        cursor.use { row ->
            if (!row.moveToFirst()) return null
            val index = row.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (index < 0) return null
            val value = row.getString(index) ?: return null
            // A display name comes from another app: a separator in it would
            // write outside the cache directory.
            val safe = value.substringAfterLast('/').substringAfterLast('\\').trim()
            return safe.ifEmpty { null }
        }
    }

    private fun fallbackName(mimeType: String?): String {
        val extension = MIME_EXTENSIONS[mimeType?.lowercase()]
        return if (extension == null) FALLBACK_NAME else "$FALLBACK_NAME.$extension"
    }
}
```

- [ ] **Step 5: Write the JavaScript surface**

`apps/mobile/modules/share-intake/index.ts`:

```ts
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';
import type { SharedFile } from '../../src/services/share-intake';

/** Coded errors the native copy can raise, matched on `error.code`. */
export const SHARE_TOO_LARGE = 'SHARE_TOO_LARGE';
export const SHARE_UNREADABLE = 'SHARE_UNREADABLE';

export interface ShareIntake {
  /** False on iOS, where a shared file arrives as a file:// URL instead. */
  isSupported(): boolean;
  /**
   * Reads and clears the file an ACTION_SEND intent brought in. The intent is
   * cleared natively too, so a reload cannot import the same file twice.
   */
  consumePendingShare(): SharedFile | null;
  /** Copies a content:// URI into the cache so it can be read as a file. */
  copyContentUri(uri: string): SharedFile;
  addListener(event: 'onShareReceived', listener: (file: SharedFile) => void): EventSubscription;
  /** A share that could not be copied: `code` is one of the two above. */
  addListener(event: 'onShareFailed', listener: (failure: { code: string }) => void): EventSubscription;
}

/**
 * What callers get when the module is not in the build — an iOS build, or an
 * Android build made before this module existed. Reporting "unsupported" keeps
 * a missing module to one unavailable feature instead of an app that cannot
 * start; `notification-capture` is built the same way and for the same reason.
 */
const unavailable: ShareIntake = {
  isSupported: () => false,
  consumePendingShare: () => null,
  copyContentUri: () => {
    throw new Error('Sharing into FinAnt is not available on this platform.');
  },
  addListener: () => ({ remove: () => {} }) as EventSubscription,
};

const ShareIntakeModule =
  requireOptionalNativeModule<ShareIntake>('ShareIntake') ?? unavailable;

export default ShareIntakeModule;
```

- [ ] **Step 6: Prebuild and compile**

```bash
cd apps/mobile && npx expo prebuild -p android
```

Then confirm autolinking picked the module up:

```bash
grep -n "share-intake" apps/mobile/android/settings.gradle
```

Expected: a line including the module's project. Then compile it (`JAVA_HOME` from the Android Studio JDK, per this machine's setup):

```bash
cd apps/mobile/android && ./gradlew :app:assembleDebug
```

Expected: `BUILD SUCCESSFUL`. A Kotlin error here is a real failure — fix it before committing.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add apps/mobile/modules/share-intake
git commit -m "feat(android): read a file shared through ACTION_SEND

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Declare the share surfaces in `app.json`

Without this the app is never offered in a share sheet, on either platform.

**Files:**
- Modify: `apps/mobile/app.json` (`android.intentFilters`, `ios.infoPlist`)

**Interfaces:**
- Consumes: nothing.
- Produces: the OS-level entry points every later task depends on.

- [ ] **Step 1: Add the Android intent filters**

In `apps/mobile/app.json`, inside `"android"`, after `"blockedPermissions"`:

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
      { "scheme": "content", "mimeType": "text/csv" },
      { "scheme": "file", "mimeType": "text/csv" },
      { "scheme": "content", "mimeType": "text/comma-separated-values" },
      { "scheme": "file", "mimeType": "text/comma-separated-values" },
      { "scheme": "content", "mimeType": "text/xml" },
      { "scheme": "file", "mimeType": "text/xml" },
      { "scheme": "content", "mimeType": "application/xml" },
      { "scheme": "file", "mimeType": "application/xml" },
      { "scheme": "content", "mimeType": "text/plain" },
      { "scheme": "file", "mimeType": "text/plain" },
      { "scheme": "content", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { "scheme": "file", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    ]
  }
]
```

`application/octet-stream` is in the SEND list because exporting apps routinely mislabel a CSV or an xlsx; it is left out of the VIEW list, where it would claim every unknown file in every file manager. `*/*` appears nowhere: FinAnt must not offer itself when the owner shares a photo.

- [ ] **Step 2: Add the iOS document types**

In `apps/mobile/app.json`, inside `"ios"`, extend the existing `"infoPlist"` object (keep `NSFaceIDUsageDescription`):

```json
"infoPlist": {
  "NSFaceIDUsageDescription": "FinAnt uses Face ID to unlock your financial data on this device.",
  "LSSupportsOpeningDocumentsInPlace": true,
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
}
```

`LSHandlerRank: Alternate` — FinAnt reads statements, it does not claim to be the system's PDF viewer. Do **not** add `UIFileSharingEnabled`: that exposes the app's own container in Files, and the container holds the encrypted database.

- [ ] **Step 3: Regenerate both native projects**

```bash
cd apps/mobile && npx expo prebuild -p android && npx expo prebuild -p ios
```

- [ ] **Step 4: Verify the generated native config**

```bash
grep -c "android.intent.action.SEND" apps/mobile/android/app/src/main/AndroidManifest.xml
grep -n "CFBundleDocumentTypes" -A 4 apps/mobile/ios/FinAnt/Info.plist
```

Expected: at least `1` for the first (the SEND action is present), and a `CFBundleDocumentTypes` array in the plist. If the `ios` directory is named differently, find the plist with `ls apps/mobile/ios/*/Info.plist`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app.json
git commit -m "feat: offer FinAnt as a destination for shared statement files

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Intercept URL-delivered files in `app/+native-intent.tsx`

Covers iOS document types and Android "Open with". Also the defensive half of the feature: Expo Router otherwise routes a `content://` or `file://` URL as a deep link and shows an unmatched route (expo/expo#23838).

**Files:**
- Create: `apps/mobile/app/+native-intent.tsx`
- Create: `apps/mobile/src/services/share-intake-files.ts`

**Interfaces:**
- Consumes: `setPendingShare`, `shareNameFromUri`, `SharedFile` (Task 1); `ShareIntakeModule.copyContentUri`, `SHARE_TOO_LARGE` (Task 2).
- Produces:
  - `redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string`
  - from `share-intake-files.ts`: `discardShare(file: SharedFile): Promise<void>`

- [ ] **Step 1: Write the cache-cleanup helper**

`apps/mobile/src/services/share-intake-files.ts`. Separate from the store so the store stays free of Expo imports and testable under node:

```ts
import { File } from 'expo-file-system';
import type { SharedFile } from './share-intake';

/**
 * Deletes the cache copy of a shared file.
 *
 * A statement should not outlive the import that consumed it, and the owner
 * never chose to put this copy on the device — the share did. Safe to call
 * twice: a file that is already gone is the desired end state, so a failure
 * here is swallowed rather than raised at the owner.
 */
export async function discardShare(file: SharedFile): Promise<void> {
  try {
    const handle = new File(file.uri);
    if (handle.exists) handle.delete();
  } catch {
    // Nothing to report: the copy is either gone or not ours to remove. The
    // reason is not logged, because it would carry the file's name.
  }
}
```

- [ ] **Step 2: Write the native-intent handler**

`apps/mobile/app/+native-intent.tsx`:

```tsx
import ShareIntakeModule, { SHARE_TOO_LARGE } from '../modules/share-intake';
import { setPendingShare, shareNameFromUri } from '../src/services/share-intake';

/**
 * Where a file that arrives as a URL is turned into a staged import.
 *
 * Two cases reach here: an iOS `file://` URL from the share sheet or Files,
 * and an Android `content://` URL from a file manager's "Open with". The third
 * case — Android's share sheet — never does, because ACTION_SEND carries its
 * URI in intent extras; `modules/share-intake` reads that one.
 *
 * This also keeps Expo Router from doing the wrong thing with such a URL: it
 * treats one as a deep link and navigates to an unmatched route
 * (expo/expo#23838). Returning a real route is the documented fix.
 *
 * This function must never throw — an exception here is a crash on launch, so
 * every failure becomes a route the import screen can explain.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (path.startsWith('content://')) {
      setPendingShare(ShareIntakeModule.copyContentUri(path));
      return '/import?shared=1';
    }
    if (path.startsWith('file://')) {
      setPendingShare({ uri: path, name: shareNameFromUri(path) });
      return '/import?shared=1';
    }
    // A finant:// deep link or anything else: let the router route it.
    return path;
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    return code === SHARE_TOO_LARGE ? '/import?shared=too-large' : '/import?shared=unreadable';
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. `+native-intent.tsx` is a reserved expo-router filename and defines no route, so `typedRoutes` gains no entry from it.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/+native-intent.tsx apps/mobile/src/services/share-intake-files.ts
git commit -m "feat: stage a statement opened from Files or a file manager

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Route the Android share in `app/_layout.tsx`

The `ACTION_SEND` path has no URL, so nothing navigates on its own. The layout reads the launch intent once the database is open, and listens for shares that arrive while the app runs.

**Files:**
- Modify: `apps/mobile/app/_layout.tsx` (the `RootLayout` component, around the existing startup effect at lines 24-41)

**Interfaces:**
- Consumes: `setPendingShare` (Task 1), `ShareIntakeModule.consumePendingShare` and both `addListener` events — `onShareReceived`, `onShareFailed` (Task 2).
- Produces: nothing new; later tasks rely only on the store.

- [ ] **Step 1: Add the imports**

```tsx
import { useRouter } from 'expo-router';
import ShareIntakeModule from '../modules/share-intake';
import { setPendingShare } from '../src/services/share-intake';
```

- [ ] **Step 2: Add the routing effect**

Inside `RootLayout`, after the existing startup effect and its `ready` state. `router` comes from `useRouter()` at the top of the component:

```tsx
  // A file shared into FinAnt from another app. Android's share sheet sends an
  // ACTION_SEND intent, whose URI never reaches expo-router, so nothing has
  // navigated yet and this is where the import screen gets opened. iOS and
  // Android's "open with" arrive as URLs instead and are already on their way
  // there via app/+native-intent.tsx.
  //
  // Gated on `ready`: the parse writes to the encrypted database, which the
  // startup effect above is still opening. A share on a locked device waits
  // here, because the key is only readable once the device is unlocked.
  useEffect(() => {
    if (!ready) return;

    const open = (file: SharedFile) => {
      setPendingShare(file);
      // The parameter carries a nonce, not a constant: a second share into a
      // running app would otherwise push the identical URL, leaving the import
      // screen's effect with an unchanged parameter and the file unread.
      router.push(`/import?shared=${Date.now()}`);
    };

    const launched = ShareIntakeModule.consumePendingShare();
    if (launched) open(launched);

    // A share into an already-running app: singleTask hands the activity a new
    // intent, which the native module turns into these two events.
    const received = ShareIntakeModule.addListener('onShareReceived', open);
    const failed = ShareIntakeModule.addListener('onShareFailed', ({ code }) => {
      // The copy never happened, so there is no file in the store — the import
      // screen reads the reason out of the route instead.
      router.push(code === 'SHARE_TOO_LARGE' ? '/import?shared=too-large' : '/import?shared=unreadable');
    });
    return () => {
      received.remove();
      failed.remove();
    };
  }, [ready, router]);
```

Add `import type { SharedFile } from '../src/services/share-intake';` alongside the value import.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `typedRoutes` rejects `'/import?shared=1'` as a string, pass the object form instead: `router.push({ pathname: '/import', params: { shared: '1' } })`, and use the same form for the error routes in Task 4.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/_layout.tsx
git commit -m "feat(android): open the import screen when a statement is shared in

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Load a shared file on the import screen

The point of the whole feature: the shared file goes through the same parse, preview and confirm the picker already uses.

**Files:**
- Modify: `apps/mobile/app/import.tsx` (extract `load` out of `pick` at lines 225-269; add a mount effect; discard the copy after confirm at lines 271-315)
- Modify: `packages/i18n/src/en.ts:398-401` (`errors` block)
- Modify: `packages/i18n/src/es.ts` (same block, around line 405)
- Modify: `packages/i18n/src/de.ts` (same block, around line 403)

**Interfaces:**
- Consumes: `takePendingShare`, `SharedFile` (Task 1); `discardShare` (Task 4); `useLocalSearchParams` from expo-router.
- Produces: nothing; this is the leaf.

- [ ] **Step 1: Add the two translation keys**

In `packages/i18n/src/en.ts`, extend `errors`:

```ts
  errors: {
    generic: 'Something went wrong.',
    importFailed: 'That file could not be read.',
    shareTooLarge: 'That file is too large to be a statement.',
    shareUnreadable: 'That shared file could not be opened.',
  },
```

`es.ts`:

```ts
    shareTooLarge: 'Ese archivo es demasiado grande para ser un extracto.',
    shareUnreadable: 'No se ha podido abrir el archivo compartido.',
```

`de.ts`:

```ts
    shareTooLarge: 'Diese Datei ist zu groß für einen Kontoauszug.',
    shareUnreadable: 'Die geteilte Datei konnte nicht geöffnet werden.',
```

- [ ] **Step 2: Extract `load` from `pick`**

In `apps/mobile/app/import.tsx`, split the existing `pick`. Everything from `setBusy(true)` onward becomes `load`, which now takes the asset and the forced profile:

```tsx
  /**
   * Reads a file that is already in hand and stages it for confirmation.
   *
   * Shared by the two ways a file arrives: the picker below, and another app
   * sharing one in (see src/services/share-intake.ts). Both end on the same
   * preview, and neither writes anything until the owner confirms.
   */
  const load = async (asset: { uri: string; name: string }, forcedProfile?: ImportProfile) => {
    setBusy(true);
    try {
      // "My records" must exist before any other account can be offered or
      // created; see getOrCreateLocalAccount.
      const localId = await getOrCreateLocalAccount();
      const [known, banks] = await Promise.all([listAccounts(), listInstitutions()]);
      const parsed = await parseFile(asset, localId, forcedProfile);
      const preselected = await preselect(parsed, known, banks, localId);
      if (!preselected) {
        // Unreachable: getOrCreateLocalAccount has just made sure "My records" is there.
        setError(t('errors.importFailed'));
        return;
      }
      setAccounts(known);
      setInstitutions(banks);
      setChoice(preselected);
      setFile(parsed);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (forcedProfile?: ImportProfile) => {
    reset();
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        XLSX_MIME,
        'text/csv',
        'text/comma-separated-values',
        'text/xml',
        'application/xml',
        'text/plain',
        'application/pdf',
        '*/*',
      ],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    await load(picked.assets[0], forcedProfile);
  };
```

Where `reset` is the five state calls `pick` already opened with, lifted out so the shared path can use them too:

```tsx
  const reset = () => {
    setError(null);
    setResult(null);
    setSetAside(0);
    setFile(null);
    setChoice(null);
  };
```

- [ ] **Step 3: Track the shared copy and load it on mount**

Place the effect below textually **after** `reset`, `load` and `pick`, so no lint rule sees a closure over a `const` declared under it.

Add state beside the existing `useState` calls, plus the param read:

```tsx
  const { shared } = useLocalSearchParams<{ shared?: string }>();
  // Held so the cache copy can be deleted once it has been imported or dropped.
  const [sharedFile, setSharedFile] = useState<SharedFile | null>(null);
```

Then the effect:

```tsx
  // A file another app shared with FinAnt. It is already staged in the store by
  // the time this screen mounts, so there is nothing to pick.
  useEffect(() => {
    if (!shared) return;
    if (shared === 'too-large') {
      setError(t('errors.shareTooLarge'));
      return;
    }
    if (shared === 'unreadable') {
      setError(t('errors.shareUnreadable'));
      return;
    }
    // Any other value is a nonce from _layout.tsx or the literal "1" from
    // +native-intent.tsx; either way the file itself is in the store.
    const file = takePendingShare();
    if (!file) return;
    reset();
    setSharedFile(file);
    void load(file);
    // Runs for the share that opened this screen. `load` and `reset` are
    // recreated on every render, and neither closes over anything this needs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared]);
```

- [ ] **Step 4: Delete the cache copy once it is spent**

At the end of the `try` block in `confirm`, after `setFile(null)` and `setChoice(null)`:

```tsx
      if (sharedFile) {
        // Imported: the copy the share left in the cache has served its purpose.
        await discardShare(sharedFile);
        setSharedFile(null);
      }
```

And an unmount cleanup, so a share the owner backs out of does not linger:

```tsx
  useEffect(
    () => () => {
      if (sharedFile) void discardShare(sharedFile);
    },
    [sharedFile],
  );
```

- [ ] **Step 5: Add the imports**

```tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { takePendingShare, type SharedFile } from '../src/services/share-intake';
import { discardShare } from '../src/services/share-intake-files';
```

`useRouter` is already imported; extend that line rather than duplicating it.

- [ ] **Step 6: Verify**

```bash
npm test
npm run typecheck
npx prettier --write apps/mobile/app/import.tsx packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
npx eslint apps/mobile/app/import.tsx
```

Expected: tests pass, typecheck clean, eslint clean. A missing key in `es.ts` or `de.ts` shows up as a typecheck error, not a runtime one.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/app/import.tsx packages/i18n/src
git commit -m "feat(import): stage a shared statement on the import preview

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Verify on a real emulator and simulator

None of the native surface is covered by vitest. This task is the gate that says the feature works.

**Files:**
- None. Findings that require a fix go back into the task that owns the code.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified feature.

- [ ] **Step 1: Build and install on the Android emulator**

```bash
cd apps/mobile && npx expo run:android
```

`JAVA_HOME` must point at the Android Studio JDK. If the emulator is in stylus mode, turn it off first or taps land wrong.

- [ ] **Step 2: Share a PDF into FinAnt from another app**

Open Files (or Drive) on the emulator, pick a PDF, share, choose FinAnt.

Expected: FinAnt opens on the import screen, the format label reads `Trade Republic — statement (PDF)` for a real Trade Republic export, an account is preselected, and the row preview is populated. Nothing is written until Confirm.

- [ ] **Step 3: Confirm the import, then check the cache**

Tap Confirm. Expected: the result card shows inserted / duplicate / set-aside counts. Then:

```bash
adb shell run-as com.finant.app ls cache/share-intake
```

Expected: empty, or "No such file or directory" — the copy is deleted after a successful import.

- [ ] **Step 4: Share again into the running app**

With FinAnt still open, share a second file from Files.

Expected: the import screen opens with the new file staged. This is the `OnNewIntent` path; if nothing happens, the event is not reaching `_layout.tsx`.

- [ ] **Step 5: Check the negative case**

Share a photo from the gallery.

Expected: FinAnt is **not** offered in the sheet. If it is, a MIME entry in Task 3 is too broad.

- [ ] **Step 6: Verify "Open with"**

In a file manager, long-press a CSV and choose "Open with" → FinAnt.

Expected: the import screen, staged. Specifically **not** an unmatched-route screen — that would mean `+native-intent.tsx` is not intercepting the `content://` URL.

- [ ] **Step 7: Verify on the iOS simulator**

```bash
cd apps/mobile && npx expo run:ios
```

Save a PDF into Files on the simulator, then share it → "Copy to FinAnt" in the app row.

Expected: FinAnt opens on a staged import screen, no unmatched route. Note this machine cannot script simulator taps, so drive this one by hand; screenshots do work for recording the result.

- [ ] **Step 8: Record the results**

Report which steps passed. Any failure goes back to the owning task as a fix, not into a workaround here.

---

### Task 8: Document the feature

**Files:**
- Create: `docs/share-intake.md`
- Modify: `docs/README.md` (add the new document to the index)
- Modify: `docs/import-formats.md` (note, near the top, that a statement can also arrive by share)

**Interfaces:**
- Consumes: the shipped behaviour.
- Produces: the document the next change to this area reads first.

- [ ] **Step 1: Write `docs/share-intake.md`**

Cover, with no placeholders:

- The three ways in and the two mechanisms, as the table in the spec has it.
- The exact MIME list and iOS UTI list, and why `*/*` and `UIFileSharingEnabled` are absent.
- Why there is no iOS share extension: it needs a second native target and an App Group, and document types already put FinAnt in the sheet.
- Why `app/+native-intent.tsx` exists at all — expo/expo#23838, the unmatched route.
- The cache copy's lifetime: written by the native copy or by the picker, deleted on confirm and on leaving the screen.
- The 25 MB ceiling and the two error codes.
- That `apps/mobile/android` and `apps/mobile/ios` are generated, so `app.json` is the only place to change any of this.
- Sources: the four URLs listed at the end of the spec.

- [ ] **Step 2: Link it from the two indexes**

Add a line to `docs/README.md` in the same style as its neighbours, and a sentence to `docs/import-formats.md` pointing at it.

- [ ] **Step 3: Commit**

```bash
npx prettier --write docs/share-intake.md docs/README.md docs/import-formats.md
git add docs/share-intake.md docs/README.md docs/import-formats.md
git commit -m "docs: describe how a shared statement reaches the import screen

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Done when

- `npm test`, `npm run typecheck` and `npx eslint` on the changed paths are clean.
- Task 7's steps 2, 4, 5, 6 and 7 all pass.
- The cache holds no leftover copy after an import.
- `docs/share-intake.md` exists and both indexes point at it.
