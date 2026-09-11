import { Directory, File, Paths } from 'expo-file-system';
import type { SharedFile } from './share-intake';

/** The Android native module's copy directory: `cacheDir/share-intake`. */
const SHARE_INTAKE_CACHE_DIR = 'share-intake';

/**
 * True only for a URI this app itself wrote a copy to, and so is ours to
 * delete: its own cache directory (where the Android native module copies an
 * `ACTION_SEND` or `content://` share — see `modules/share-intake`), or the
 * `Documents/Inbox` directory iOS uses when a document provider hands over a
 * duplicate rather than the original in place.
 *
 * On iOS, `app/+native-intent.tsx` stores a `file://` URL exactly as the
 * system handed it to `openURL`, with no copy of FinAnt's own — and
 * `app.json` sets `LSSupportsOpeningDocumentsInPlace: true`, which is exactly
 * the key that lets Files hand over the owner's *original* document instead
 * of an `Inbox` duplicate. A URI outside both directories is therefore
 * presumed to be the owner's own file, in place, and is never a candidate for
 * deletion.
 */
function isOwnCopy(uri: string): boolean {
  return uri.startsWith(Paths.cache.uri) || uri.startsWith(`${Paths.document.uri}Inbox/`);
}

/**
 * Loosely normalises a `file://` URI for comparing two of them by identity.
 *
 * The two URIs the sweep below compares come from different code paths that
 * make no promise of agreeing on exact form — one from Android's
 * `Uri.fromFile(file).toString()`, in `ShareIntakeModule.kt`; the other from
 * `expo-file-system`'s own `Directory.list()`. Either could percent-encode a
 * space or a non-ASCII character differently, or carry a trailing slash the
 * other lacks. A same-file comparison should not fail silently over that —
 * done, here, by decoding any percent-escapes and dropping a trailing slash
 * before comparing, the same spirit as `isOwnCopy`'s prefix check above,
 * which only works because both its sides come from the same `Paths.*.uri`
 * accessor and so never disagree on form.
 */
function normaliseFileUri(uri: string): string {
  const withoutTrailingSlash = uri.replace(/\/+$/, '');
  try {
    return decodeURIComponent(withoutTrailingSlash);
  } catch {
    // Not every byte sequence is valid percent-encoding; comparing the raw
    // string is still better than throwing out of a background sweep.
    return withoutTrailingSlash;
  }
}

/**
 * Deletes the cache copy of a shared file — but only when the URI is actually
 * a copy this app made (see `isOwnCopy`). A statement should not outlive the
 * import that consumed it, and the owner never chose to put that copy on the
 * device — the share did. Safe to call twice: a file that is already gone is
 * the desired end state, so a failure here is swallowed rather than raised at
 * the owner.
 */
export async function discardShare(file: SharedFile): Promise<void> {
  if (!isOwnCopy(file.uri)) return;
  try {
    const handle = new File(file.uri);
    if (handle.exists) handle.delete();
  } catch {
    // Nothing to report: the copy is either gone or not ours to remove. The
    // reason is not logged, because it would carry the file's name.
  }
}

/**
 * Empties `cacheDir/share-intake`, the directory the Android native module
 * copies every ACTION_SEND and content:// share into before FinAnt ever sees
 * a `SharedFile`. Every file under it is one FinAnt itself wrote, so by the
 * time this runs — once, at startup — anything still there belongs to a
 * session that is over: a share superseded by a second one, or a process
 * kill before `app/import.tsx`'s unmount cleanup ran. Left there, it is a
 * plaintext copy of a bank statement outliving the encrypted database this
 * app promises is the only place a statement lives.
 *
 * `keepUri`, when given, names the one file this sweep must leave alone: the
 * one the *current* launch has already staged. A `content://` "Open with"
 * copies its file via `redirectSystemPath` before `app/_layout.tsx` ever
 * mounts — expo-router resolves the initial URL, and runs
 * `redirectSystemPath` from inside that resolution, before
 * `NavigationContainer` renders any screen at all — so by the time this
 * sweep runs, that copy can already be sitting in the very directory being
 * emptied. Callers pass `peekPendingShare()?.uri` (from `share-intake.ts`)
 * for exactly this reason: an `ACTION_SEND` cold start has nothing pending
 * yet at this point (its copy happens lazily inside `consumePendingShare()`,
 * called later, after `ready`), so `keepUri` is `undefined` and the sweep
 * empties the directory outright; a `content://` cold start already has a
 * `SharedFile` staged, and that one URI survives.
 *
 * A no-op on iOS: the module that writes to this directory is Android-only,
 * so the directory is never created there.
 */
export async function sweepShareIntakeCache(keepUri?: string): Promise<void> {
  try {
    const directory = new Directory(Paths.cache, SHARE_INTAKE_CACHE_DIR);
    if (!directory.exists) return;
    const keep = keepUri === undefined ? null : normaliseFileUri(keepUri);
    for (const entry of directory.list()) {
      if (keep !== null && normaliseFileUri(entry.uri) === keep) continue;
      entry.delete();
    }
  } catch {
    // Best-effort: a sweep that cannot run leaves at most a few stale files
    // in the app's own cache rather than breaking startup. Not logged — the
    // reason could carry a stale file's name.
  }
}
