# Distribution

How a build reaches the owner's own phone. There is no store listing, no
enterprise MDM and no beta programme: one person installs this app on their own
devices, and the two platforms make that so different that they are documented
separately.

## Android

Sideloaded from a GitHub Release. The repository is public, so the APK is a
public download; nothing inside it is private — no statement, no key, no
model. The language model is fetched at first use from HuggingFace
(`src/assistant/model-file.ts`), not bundled; an `arm64-v8a` APK still comes
out at about 127 MB, most of it llama.rn's CPU kernels.

### Signing

`android/` is generated and gitignored (`apps/mobile/.gitignore`: `/android`,
`/ios`), so a hand edit to `app/build.gradle` survives exactly until the next
`expo prebuild`. The signing change therefore lives in the config plugin
`apps/mobile/plugins/with-release-signing.js`, registered in `app.json`, which
reapplies it on every regeneration.

The plugin throws rather than skipping when either anchor it patches is not
found **exactly once** in the template. That is deliberate: the string
`signingConfig signingConfigs.debug` occurs twice — the debug build type is
assigned it first — and a plugin that matched the first occurrence rewrote the
debug block while leaving the release APK on the public debug key, silently.
A build that cannot be signed correctly must fail, not ship.

The release key is generated locally and lives at
`~/.finant-keys/finant-release.keystore` (4096-bit RSA, `PKCS12`, alias
`finant`, mode 600). Its four properties — store file, alias, and the two
passwords — are in `~/.gradle/gradle.properties`, machine-local and mode 600.
Neither the keystore nor the passwords are in this repository, and neither
should ever be.

The generated `app/build.gradle` reads those four properties and falls back to
the committed `debug.keystore` when they are absent, so a fresh checkout still
builds. A fallback build is for a simulator or a throwaway install only.
`./gradlew :app:signingReport` prints which key each variant actually resolves
to, and is the cheapest way to confirm the plugin did its job.

**Why not just use the debug key.** Expo's template signs release builds with
`debug.keystore`, which is committed here and whose password is the literal
string `android`. Anyone can therefore produce an APK signed with that key.
Android permits an APK to overwrite-install over an installed app when both
carry the same signature, and the replacement inherits the app's identity —
including the Android Keystore entry that unlocks the SQLCipher database. A
private key removes that path: no one else can sign something Android will
accept as an update to this app.

**If the keystore is lost**, a future APK cannot install over the existing one.
The app has to be uninstalled first, which destroys its database — and, per
`security-model.md`, the database is the only copy. Back the keystore up
wherever the owner keeps other irreplaceable secrets, never in this repo.

### Build and publish

```sh
cd apps/mobile/android
CMAKE_BUILD_PARALLEL_LEVEL=1 JAVA_HOME=/opt/homebrew/opt/openjdk@17 \
  ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a \
  -Dorg.gradle.jvmargs="-Xmx1536m -XX:MaxMetaspaceSize=384m" \
  -Pkotlin.daemon.jvmargs=-Xmx1g --no-parallel --max-workers=1
```

The memory flags are not optional on this machine: at Gradle's defaults the
build was killed twice for memory before llama.rn's C++ even started, and one
of those kills left the NDK half-downloaded, which failed the next run with
`[CXX1101] ... did not have a source.properties file`. Fixing that meant
deleting `~/Library/Android/sdk/ndk/<version>` and reinstalling it with
`sdkmanager`. Single-threaded, a full build takes about four minutes.

`arm64-v8a` alone covers every phone worth installing this on and roughly
quarters the APK. Output:
`apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, inside the
gitignored `build/`.

Then attach it to a tagged release rather than committing it — a 127 MB binary
in the tree is permanent, and every rebuild adds another copy:

```sh
gh release create v<version> \
  apps/mobile/android/app/build/outputs/apk/release/app-release.apk \
  --title "FinAnt v<version>" --notes "<what changed>"
```

The version comes from `app.json`'s `expo.version`; `versionCode` in
`build.gradle` has to be raised by hand for each release that should install
over the last.

On the phone: open the release page, download the APK, and allow the browser to
install unknown apps once when Android asks.

JDK 17 is installed as the Homebrew **formula** (`brew install openjdk@17`),
not the cask — the cask writes to `/Library/Java/JavaVirtualMachines` and needs
`sudo`, the formula does not. `JAVA_HOME` is set per build rather than in a
shell profile.

## iOS

**Nothing can be published to GitHub for iOS.** iOS will not install an
application from a downloaded file: there is no equivalent of sideloading an
APK. An `.ipa` is only installable by a device named in the provisioning
profile it was signed against, so an `.ipa` attached to a release would be
inert for everyone including the owner.

The two real routes, neither of which involves this repository:

- **Xcode over a cable, free Apple ID.** Build to the connected device from
  Xcode; trust the developer certificate in Settings once. No cost. The
  signature expires after **7 days**, after which the app refuses to launch
  until it is reinstalled the same way.
- **TestFlight, Apple Developer Program (99 EUR/year).** Upload a build to App
  Store Connect and install over the air, no cable. Builds last 90 days.
  Requires enrolment, an app record, and either `eas.json` or an
  `xcodebuild` + `notarytool`/`altool` pipeline.

Deliberately not set up. Revisit when the app is worth 99 EUR a year to the
owner, or when a 7-day reinstall becomes annoying enough to automate.
