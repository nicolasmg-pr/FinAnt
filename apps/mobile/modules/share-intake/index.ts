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
