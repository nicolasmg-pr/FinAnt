import { AppRegistry } from 'react-native';
import { CAPTURE_TASK_KEY } from '../../modules/notification-capture';
import { recordCapture, type RawCapture } from './capture-service';

/**
 * The entry point Android's notification listener wakes.
 *
 * Registered from `apps/mobile/index.js` rather than from a screen: expo-router
 * requires the `app/` tree lazily, so a registration inside a layout never
 * evaluates on a headless launch and Android's task start would find no task.
 *
 * Errors are swallowed deliberately. A crash here would take down a JS runtime
 * the owner cannot see, and the notification is not worth that: the statement
 * import remains the source of truth. Nothing is logged, because the only
 * thing there is to log is the notification's own text.
 */
AppRegistry.registerHeadlessTask(CAPTURE_TASK_KEY, () => async (data: RawCapture) => {
  try {
    await recordCapture(data);
  } catch {
    // Intentionally silent. See above.
  }
});
