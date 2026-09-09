package expo.modules.notificationcapture

import android.content.Context

/**
 * The package names FinAnt is allowed to read, and the time-boxed learning flag.
 *
 * Plain SharedPreferences on purpose. The listener service runs while the app
 * is closed and the SQLCipher connection is not open, so the allowlist has to
 * be readable without the database. What is stored here is package names of
 * the owner's own bank apps: no amount, no narrative, no account, no IBAN, and
 * nothing that is not already obvious from the notifications themselves.
 *
 * The database is authoritative. This is a projection of it, rewritten by
 * setAllowedPackages whenever the owner changes a source.
 */
internal object CaptureAllowlist {
    private const val PREFS = "finant.capture"
    private const val KEY_PACKAGES = "packages"
    private const val KEY_LEARNING_UNTIL = "learning_until"
    private const val KEY_LEARNED = "learned"

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun allowed(context: Context): Set<String> =
        prefs(context).getStringSet(KEY_PACKAGES, emptySet()) ?: emptySet()

    fun setAllowed(context: Context, packages: List<String>) {
        prefs(context).edit().putStringSet(KEY_PACKAGES, packages.toSet()).apply()
    }

    fun startLearning(context: Context, seconds: Int) {
        prefs(context).edit()
            .putLong(KEY_LEARNING_UNTIL, System.currentTimeMillis() + seconds * 1000L)
            .putStringSet(KEY_LEARNED, emptySet())
            .apply()
    }

    /**
     * Whether learning mode is still armed — and, on the first call after it
     * has expired, the point where what it collected is thrown away.
     *
     * Expiry alone used to stop collection without clearing anything, so a
     * process death during the five-minute window — precisely when the owner
     * has left the app to trigger a payment — left a plaintext list of every
     * app that notified them sitting in preferences indefinitely. Clearing it
     * here means the next notification from any app, allowlisted or not,
     * disposes of it. Inside the same `synchronized` discipline as `learn` and
     * `consumeLearned`, which do the same read-modify-write on KEY_LEARNED.
     */
    fun isLearning(context: Context): Boolean {
        synchronized(CaptureAllowlist) {
            val store = prefs(context)
            val until = store.getLong(KEY_LEARNING_UNTIL, 0L)
            if (until > System.currentTimeMillis()) return true
            if (until != 0L || store.contains(KEY_LEARNED)) {
                store.edit().remove(KEY_LEARNED).putLong(KEY_LEARNING_UNTIL, 0L).apply()
            }
            return false
        }
    }

    /**
     * Records a package name and nothing else — never a title, a text or a post
     * time. This is how the owner identifies their bank apps without the app
     * holding QUERY_ALL_PACKAGES and without anyone guessing a package id.
     */
    fun learn(context: Context, packageName: String) {
        // Synchronized against consumeLearned: it runs on the listener's main
        // thread while consumeLearned runs on the Expo function thread, and
        // both do a read-modify-write on KEY_LEARNED. Without this, a learn()
        // straddling a consumeLearned() could resurrect a cleared name or lose
        // its own.
        synchronized(CaptureAllowlist) {
            val store = prefs(context)
            val seen = store.getStringSet(KEY_LEARNED, emptySet()) ?: emptySet()
            if (packageName in seen) return
            store.edit().putStringSet(KEY_LEARNED, seen + packageName).apply()
        }
    }

    fun consumeLearned(context: Context): List<String> {
        synchronized(CaptureAllowlist) {
            val store = prefs(context)
            val seen = (store.getStringSet(KEY_LEARNED, emptySet()) ?: emptySet()).sorted()
            store.edit().putStringSet(KEY_LEARNED, emptySet()).putLong(KEY_LEARNING_UNTIL, 0L).apply()
            return seen
        }
    }
}
