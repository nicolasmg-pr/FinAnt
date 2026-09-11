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
