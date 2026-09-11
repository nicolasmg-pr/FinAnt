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
 * This is NOT launch-only: expo-router calls `redirectSystemPath` for a URL
 * that arrives while the app is already running just as much as for the one
 * that launched it. That is why the two routes below carry a `Date.now()`
 * nonce rather than a literal string — sharing statement A, going back, then
 * sharing statement B used to return the identical route both times, so
 * React Navigation popped back to the existing import screen without
 * changing params, the effect keyed on `shared` never re-ran, and the owner
 * confirmed A while believing they had shared B. `app/_layout.tsx` already
 * mints a nonce the same way for the warm share it handles directly.
 *
 * This function must never throw — an exception here is a crash on launch, so
 * every failure becomes a route the import screen can explain.
 */
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
    // A finant:// deep link or anything else: let the router route it.
    return path;
  } catch (cause) {
    // `cause` is whatever the native side threw, so its shape is not trusted
    // before the property read — it may not even be an object.
    const code =
      typeof cause === 'object' && cause !== null && 'code' in cause
        ? (cause as { code?: unknown }).code
        : undefined;
    return code === SHARE_TOO_LARGE ? '/import?shared=too-large' : '/import?shared=unreadable';
  }
}
