package expo.modules.notificationcapture

import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationCaptureModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("NotificationCapture")

        Function("isSupported") { true }

        Function("isPermissionGranted") {
            val context = appContext.reactContext ?: return@Function false
            context.packageName in NotificationManagerCompat.getEnabledListenerPackages(context)
        }

        Function("openPermissionSettings") {
            // There is no runtime permission dialog for notification access:
            // the owner has to switch it on in system settings themselves.
            //
            // Written as a safe call rather than an early return because this
            // overload of `Function` takes a `() -> Any?`, and Kotlin allows a
            // valueless `return@Function` only where the return type is `Unit`.
            appContext.reactContext?.startActivity(
                Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
        }

        Function("setAllowedPackages") { packages: List<String> ->
            val context = appContext.reactContext ?: return@Function
            CaptureAllowlist.setAllowed(context, packages)
        }

        Function("startLearning") { seconds: Int ->
            val context = appContext.reactContext ?: return@Function
            CaptureAllowlist.startLearning(context, seconds)
        }

        Function("consumeLearnedPackages") {
            val context = appContext.reactContext ?: return@Function emptyList<String>()
            CaptureAllowlist.consumeLearned(context)
        }
    }
}
