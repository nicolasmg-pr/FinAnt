import { requireNativeModule } from 'expo-modules-core';

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

export default requireNativeModule<NotificationCaptureModule>('NotificationCapture');
