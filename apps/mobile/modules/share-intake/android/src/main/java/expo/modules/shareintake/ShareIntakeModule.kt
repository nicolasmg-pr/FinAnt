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

        Events(SHARE_RECEIVED)

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
        OnNewIntent { intent ->
            val uri = takeSharedUri(intent) ?: return@OnNewIntent
            val file = copy(uri, intent.type)
            sendEvent(SHARE_RECEIVED, bundleOf("uri" to file["uri"], "name" to file["name"]))
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
