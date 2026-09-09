package expo.modules.notificationcapture

import android.app.Notification
import android.os.Bundle
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.LinearCountingRetryPolicy

/**
 * Reads the notifications the owner's own bank apps post, and nothing else.
 *
 * Notification access is a broad grant: the system offers this service every
 * notification on the device. The allowlist check in onNotificationPosted is
 * therefore the security boundary of this entire feature, and it is kept short
 * enough to verify by reading. Nothing outside the allowlist is read, copied,
 * stored or logged — and no notification text is ever logged at all.
 */
class FinAntNotificationListenerService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val packageName = sbn?.packageName ?: return

        // Learning mode: the package name, and only the package name.
        if (CaptureAllowlist.isLearning(this)) {
            CaptureAllowlist.learn(this, packageName)
        }

        // ── THE SECURITY BOUNDARY ────────────────────────────────────────────
        // A message from a person, a 2FA code, a health reminder: all of them
        // return here, before sbn.notification is ever dereferenced.
        if (packageName !in CaptureAllowlist.allowed(this)) return
        // ─────────────────────────────────────────────────────────────────────

        val extras: Bundle = sbn.notification?.extras ?: return
        val data = Arguments.createMap().apply {
            putString("packageName", packageName)
            putString("title", extras.getCharSequence(Notification.EXTRA_TITLE)?.toString())
            putString(
                "body",
                (extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
                    ?: extras.getCharSequence(Notification.EXTRA_TEXT))?.toString(),
            )
            putDouble("postedAtMillis", sbn.postTime.toDouble())
            putString("androidKey", sbn.key)
        }

        startCaptureTask(data)
    }

    /**
     * Hands the notification to JavaScript.
     *
     * This replicates the body of RN's own HeadlessJsTaskService.startTask
     * because this class cannot extend it — it already extends
     * NotificationListenerService — and must not call startForegroundService
     * either: Android 8+ restricts starting a service from the background, and
     * a foreground-service notification for every card payment is absurd.
     *
     * Doing it in place is sound because the process is already alive: the
     * system bound this listener.
     */
    private fun startCaptureTask(data: WritableMap) {
        HeadlessJsTaskService.acquireWakeLockNow(this)

        val reactHost = (application as? ReactApplication)?.reactHost ?: return
        val config = HeadlessJsTaskConfig(
            TASK_KEY,
            data,
            TASK_TIMEOUT_MS,
            // The app may well be open when a payment notification lands, and
            // RN throws rather than running a foreground-disallowed task.
            true,
            LinearCountingRetryPolicy(RETRY_ATTEMPTS, RETRY_DELAY_MS),
        )

        UiThreadUtil.runOnUiThread {
            val current = reactHost.currentReactContext
            if (current != null) {
                HeadlessJsTaskContext.getInstance(current).startTask(config)
                return@runOnUiThread
            }
            reactHost.addReactInstanceEventListener(
                object : ReactInstanceEventListener {
                    override fun onReactContextInitialized(context: ReactContext) {
                        HeadlessJsTaskContext.getInstance(context).startTask(config)
                        reactHost.removeReactInstanceEventListener(this)
                    }
                },
            )
            reactHost.start()
        }
    }

    companion object {
        /** Must match the AppRegistry.registerHeadlessTask key in JavaScript. */
        const val TASK_KEY = "FinAntNotificationCapture"
        private const val TASK_TIMEOUT_MS = 15_000L
        private const val RETRY_ATTEMPTS = 3
        private const val RETRY_DELAY_MS = 1_000
    }
}
