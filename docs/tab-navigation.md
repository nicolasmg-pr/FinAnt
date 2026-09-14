# Tab navigation (swipe between the five tabs)

Why the tab bar is not a bottom-tab navigator any more, and what holds the
swipe up. Written from the expo-router 57.0.17 sources in `node_modules` and
the vendor docs cited at the bottom, checked on 2026-09-14.

## The problem

The five tabs — dashboard, movements, banks, budgets, settings — could only be
reached by tapping the bar. A horizontal drag did nothing. React Navigation's
bottom-tab navigator has no pager under it and no `swipeEnabled` option: its
scenes are stacked, not laid out side by side, so there is nothing for a finger
to drag. Neither has expo-router's native tabs layout.

## What was used instead

expo-router 57 no longer depends on `@react-navigation/*` as npm packages — it
vendors them under `expo-router/build/react-navigation/`, `material-top-tabs`
included, and exposes that navigator as `TopTabs`:

```js
// node_modules/expo-router/js-top-tabs.js
module.exports = require('./build/layouts/TopTabs');
```

`TopTabs` is the only expo-router navigator built on a pager, so it is what
`app/(tabs)/_layout.tsx` renders, with `tabBarPosition="bottom"`. The scenes
sit side by side in a pager and follow the finger; declaration order in the
layout file is the swipe order.

The pager itself is not vendored. `MaterialTopTabView` requires
`react-native-tab-view` lazily and throws
`"Install the 'react-native-tab-view' package and its peer dependencies to use
the Expo Router's TopTabs."` when it is missing, so two packages were added:

| Package                   | Version | Why                                             |
| ------------------------- | ------- | ----------------------------------------------- |
| `react-native-tab-view`   | 4.3.2   | The `TabView` that `MaterialTopTabView` renders |
| `react-native-pager-view` | 8.0.2   | Its peer dependency; the Expo SDK 57 pin        |

`react-native-pager-view` is a native module: adding it needed
`npx pod-install` for iOS and a Gradle rebuild for Android.

## The bar

`MaterialTopTabBar` is a top-of-screen bar with an underline indicator, so it
is replaced rather than themed: `src/components/TabBar.tsx` renders the same
pill-backed icon and caption the bottom-tab navigator drew, from the `state`,
`navigation` and `descriptors` the navigator hands a custom `tabBar`.

Two things the old navigator did for free and this bar does explicitly:

- the home-indicator inset, via `useSafeAreaInsets().bottom` as `paddingBottom`;
- the `tabPress` event, emitted with `canPreventDefault` before navigating, so
  a screen can still intercept its own tab being tapped.

`MaterialTopTabBarProps` is declared by expo-router as `any & { ... }`. An
intersection with `any` is `any`, so importing it would have left every
destructured field untyped; `TabBarProps` in that file spells the three fields
out instead.

## Lazy screens

All five screens query the encrypted database. A pager mounts its scenes, so
`screenOptions` sets `lazy: true` with `lazyPreloadDistance: 1`: nothing but
the current screen and its neighbour is mounted, and the neighbour is ready
before a swipe lands on it.

## The balance chart yields at its edges

The dashboard's balance chart pans sideways through years of history, so it
and the pager want the same horizontal drag. A `ScrollView` cannot share one:
it claims every horizontal drag whether or not it has anywhere left to go,
which made the chart a dead zone for swiping between tabs.

`src/components/BalanceChart.tsx` therefore pans with a gesture-handler `Pan`
in `manualActivation` mode over a reanimated `translateX`, and decides per drag
whether to take it:

- mostly vertical — let through, it belongs to the screen's own scroll;
- horizontal with room left in that direction — taken, the chart pans;
- horizontal with no room (at the oldest end dragging right, at the newest end
  dragging left) — let through, and the pager changes tab.

A gesture that never activates does not block the pager underneath it, which is
what makes the hand-off work on both platforms. Verified on the Android
emulator on 2026-09-14: all three cases behave as listed. The chart still opens
on its newest end, now by setting the pan offset rather than by
`scrollToEnd()`.

## Sources

- expo-router 57.0.17 sources: `build/layouts/TopTabsClient.js`,
  `build/react-navigation/material-top-tabs/views/MaterialTopTabView.js`,
  `.../views/MaterialTopTabBar.js`, `.../types.d.ts`.
- Expo Router tabs guide, https://docs.expo.dev/router/advanced/tabs/ (checked
  2026-09-14; it documents the JavaScript, native and custom tab layouts only —
  `TopTabs` is in the package but not on that page).
- `react-native-tab-view` 4.3.2 npm metadata for the `react-native-pager-view`
  peer requirement; `node_modules/expo/bundledNativeModules.json` for the SDK 57
  pager pin.
