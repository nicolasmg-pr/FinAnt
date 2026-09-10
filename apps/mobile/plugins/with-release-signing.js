const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Signs Android release builds with a private key instead of Expo's committed
 * debug key.
 *
 * `android/` is generated and gitignored, so editing `app/build.gradle` by hand
 * lasts until the next `expo prebuild` and no longer. This plugin reapplies the
 * change every time the folder is regenerated.
 *
 * The key itself is never here and never in the repository: the four properties
 * below live in `~/.gradle/gradle.properties`. When they are absent the release
 * type keeps the debug key, so a fresh checkout still builds — see
 * `docs/distribution.md` for why such a build must not go on the owner's phone.
 */

const SIGNING_CONFIG = `        // Machine-local release key; see docs/distribution.md. Injected by
        // plugins/with-release-signing.js, because android/ is regenerated.
        if (project.hasProperty('FINANT_STORE_FILE')) {
            release {
                storeFile file(FINANT_STORE_FILE)
                storePassword FINANT_STORE_PASSWORD
                keyAlias FINANT_KEY_ALIAS
                keyPassword FINANT_KEY_PASSWORD
            }
        }
`;

/** Closes the template's `debug { ... }` signing config. */
const DEBUG_CONFIG_END = "            keyPassword 'android'\n        }\n";

/**
 * The release build type's assignment, carrying the two comment lines above it.
 *
 * `signingConfig signingConfigs.debug` on its own appears twice — the debug
 * build type is assigned it first — so a bare match rewrites the wrong block
 * and leaves the release APK on the public debug key.
 */
const TEMPLATE_RELEASE_SIGNING = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;

const RELEASE_SIGNING = `        release {
            // Falls back to the debug key when the release properties are
            // absent, so a checkout without the keystore still builds. Such a
            // build is for a simulator or a throwaway install only — never for
            // the phone that holds real statements.
            signingConfig project.hasProperty('FINANT_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // Already applied: prebuild ran without regenerating this file.
    if (contents.includes('FINANT_STORE_FILE')) return config;

    // Each anchor has to occur exactly once. Asserting only that it exists is
    // not enough: `signingConfig signingConfigs.debug` occurs twice, and
    // matching the first one rewrote the debug build type while leaving the
    // release APK on the public debug key — silently, which is the one outcome
    // this plugin exists to prevent.
    for (const [label, anchor] of [
      ['the debug signingConfig', DEBUG_CONFIG_END],
      ["the release build type's signingConfig", TEMPLATE_RELEASE_SIGNING],
    ]) {
      const occurrences = contents.split(anchor).length - 1;
      if (occurrences !== 1) {
        throw new Error(
          `with-release-signing: expected exactly one match for ${label} in app/build.gradle, ` +
            `found ${occurrences}. The Expo template changed; update this plugin before releasing.`,
        );
      }
    }

    contents = contents.replace(DEBUG_CONFIG_END, DEBUG_CONFIG_END + SIGNING_CONFIG);
    contents = contents.replace(TEMPLATE_RELEASE_SIGNING, RELEASE_SIGNING);

    config.modResults.contents = contents;
    return config;
  });
};
