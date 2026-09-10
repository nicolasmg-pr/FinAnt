# Keyboard handling (Android edge-to-edge)

Why the app needs an explicit keyboard strategy at all, and what the current one
is. Written from the React Native 0.86 sources in `node_modules` and the vendor
docs cited at the bottom, checked on 2026-09-10.

## The problem

On Android the keyboard covered the field being typed into on every form.

`AndroidManifest.xml` asks for the classic behaviour:

```xml
<activity android:name=".MainActivity" android:windowSoftInputMode="adjustResize" …>
```

That flag is inert here. `apps/mobile/android/gradle.properties` sets
`edgeToEdgeEnabled=true` (the Expo prebuild default since SDK 54, and Android 16
/ API 36 enforces edge-to-edge regardless), and React Native reacts to it in
`ReactActivityDelegate` → `WindowUtil.kt`:

```kotlin
internal fun Window.enableEdgeToEdge() {
  WindowCompat.setDecorFitsSystemWindows(this, false)
  …
}
```

`SOFT_INPUT_ADJUST_RESIZE` is documented as deprecated since API 30 and has no
effect once a window sets `setDecorFitsSystemWindows(false)`: the window keeps
its full height and the app is expected to consume `WindowInsets.Type.ime()`
itself. Nothing in the app did, so nothing moved when the keyboard opened.

`Modal` is in the same position. `ReactModalHostView.kt` treats a modal as
edge-to-edge whenever the feature flag is on

```kotlin
public var navigationBarTranslucent: Boolean = false
  get() = field || isEdgeToEdgeFeatureFlagOn
```

and calls `dialogWindow.enableEdgeToEdge()`, so its own
`window.setSoftInputMode(SOFT_INPUT_ADJUST_RESIZE)` is inert too. That is why
the bottom `Sheet` was affected as well as the full-screen forms.

React Native does still report the keyboard: `ReactRootView`'s global layout
listener reads the real insets and emits `keyboardDidShow` with
`imeInsets.bottom - barInsets.bottom`. So the height is trustworthy — only the
automatic layout change is gone.

## What the app does

`react-native-keyboard-controller` (>= 1.13, which is the release that made its
hooks and components work inside a `Modal`). It reads the IME insets natively,
runs the follow animation on the UI thread, and gives the same behaviour on both
platforms.

- `app/_layout.tsx` wraps the whole tree in `KeyboardProvider`
  (`statusBarTranslucent` and `navigationBarTranslucent` set, because the app is
  edge-to-edge and the provider must lay out in one frame without a jump).
- Screens whose form scrolls use `KeyboardAwareScrollView` with a `bottomOffset`
  so the caret is not flush against the keyboard. It scrolls the focused input
  into view, which is the part a plain inset cannot do.
- `components/ui/Sheet.tsx` reads the keyboard directly with
  `useReanimatedKeyboardAnimation`: the panel is lifted by the keyboard height
  and its `maxHeight` is capped to 85% of what is left above it, and its body
  is always a `ScrollView`. Two earlier attempts are worth not repeating:
  React Native's `KeyboardAvoidingView` wants `behavior={undefined}` on
  Android, which is another name for "let `adjustResize` handle it", i.e.
  nothing; and the library's own `KeyboardAvoidingView` lifted this panel far
  past the keyboard, with `automaticOffset` measuring an offset that a
  full-screen `Modal` does not have. Explicit height arithmetic is the thing
  that behaved.
- A sheet whose form is taller than the space above the keyboard scrolls
  inside the panel. That is not optional: the Movements filter sheet used to
  render its four inputs at full height and simply left the amount fields
  under the keys.
- `(tabs)/transactions.tsx` is a `FlatList`, not a form: only its filter sheet
  takes text, and that sheet is a `Sheet`.

## Rules

- Never reach for `android:windowSoftInputMode` or
  `expo.android.softwareKeyboardLayoutMode` to fix a keyboard overlap. Both are
  dead ends while the app is edge-to-edge, and edge-to-edge is not optional on
  Android 15+.
- A new screen that takes text uses `KeyboardAwareScrollView` (scrolling form)
  or sits inside `Sheet` (any form: `Sheet` caps and scrolls itself). Do not
  hand-roll a keyboard listener.
- Verify on a device or emulator with the keyboard actually open. A form that
  looks right with the keyboard closed proves nothing.

## Sources

- React Native 0.86 sources, read locally:
  `react-native/ReactAndroid/src/main/java/com/facebook/react/views/view/WindowUtil.kt`,
  `…/views/modal/ReactModalHostView.kt`, `…/ReactRootView.java`.
- Android, `WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE` — deprecated in
  API 30 in favour of `Window#setDecorFitsSystemWindows(false)` plus an
  `OnApplyWindowInsetsListener` fitting `Type.ime()`.
- Expo, "Keyboard handling" — recommends `react-native-keyboard-controller` for
  larger scrollable forms: <https://docs.expo.dev/guides/keyboard-handling/>
- Keyboard Controller docs: installation
  <https://kirillzyusko.github.io/react-native-keyboard-controller/docs/installation>,
  `KeyboardAwareScrollView`
  <https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-aware-scroll-view>,
  `KeyboardAvoidingView`
  <https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-avoiding-view>,
  1.13 release notes on `Modal` support
  <https://kirillzyusko.github.io/react-native-keyboard-controller/blog/release-1-13>
