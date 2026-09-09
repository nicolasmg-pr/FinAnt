import { requireOptionalNativeModule } from 'expo-modules-core';

export interface NotificationCaptureModule {
  /** False on iOS, which has no API for reading other apps' notifications. */
  isSupported(): boolean;
  /** Whether the owner has granted notification access in system settings. */
  isPermissionGranted(): boolean;
  /** Opens the system screen where notification access is granted. */
  openPermissionSettings(): void;
  /**
   * Replaces the package names the native listener may read. Everything else
   * returns from `onNotificationPosted` before its text is touched.
   */
  setAllowedPackages(packages: string[]): void;
  /** Records package names only, for this many seconds, so the owner can
   * identify their bank apps without the app enumerating installed packages. */
  startLearning(seconds: number): void;
  /** Reads and clears what learning mode collected. */
  consumeLearnedPackages(): string[];
}

/** Must match `FinAntNotificationListenerService.TASK_KEY`. */
export const CAPTURE_TASK_KEY = 'FinAntNotificationCapture';

/**
 * What every caller gets when the native module is not linked into the build.
 *
 * This is not a theoretical case: `apps/mobile/index.js` pulls the headless
 * task in on every launch of both platforms, so a hard `requireNativeModule`
 * here would turn a missing or not-yet-prebuilt module into an app that does
 * not start at all, rather than one feature that is unavailable. Every caller
 * already branches on `isSupported()`, so reporting false is enough; the rest
 * are no-ops and safe defaults so that a caller which skipped the branch still
 * cannot crash.
 */
const unavailable: NotificationCaptureModule = {
  isSupported: () => false,
  isPermissionGranted: () => false,
  openPermissionSettings: () => {},
  setAllowedPackages: () => {},
  startLearning: () => {},
  consumeLearnedPackages: () => [],
};

export default requireOptionalNativeModule<NotificationCaptureModule>('NotificationCapture') ??
  unavailable;
