import type {
  MaterialTopTabNavigationEventMap,
  MaterialTopTabNavigationOptions,
} from 'expo-router/js-top-tabs';
import type {
  NavigationHelpers,
  ParamListBase,
  TabNavigationState,
} from 'expo-router/react-navigation';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_FONT_SCALE, radius, spacing, type, useElevation, useTheme } from '../design';
import { Touchable } from './ui/Touchable';

/**
 * What the navigator hands a custom bar. Spelled out rather than imported as
 * `MaterialTopTabBarProps`, which expo-router declares as `any & {...}` — an
 * intersection with `any` is `any`, and every destructured field would come
 * back untyped.
 */
export type TabBarProps = {
  state: TabNavigationState<ParamListBase>;
  navigation: NavigationHelpers<ParamListBase, MaterialTopTabNavigationEventMap>;
  // `MaterialTopTabDescriptorMap` is not exported; only the options are read
  // here, so the map is described by what this bar actually uses.
  descriptors: Record<string, { options: MaterialTopTabNavigationOptions }>;
};

/**
 * The bottom bar for the swipeable tab pager. The pager comes from
 * `TopTabs`, whose own bar is a top-of-screen material bar with an underline
 * indicator, so the bar is rewritten here rather than themed: same pill-backed
 * icon and caption as the bottom-tab navigator this replaced, so swiping was
 * the only thing that changed for the owner.
 *
 * The old navigator added the home-indicator inset for free; a top-tab bar
 * moved to the bottom does not, hence the explicit `paddingBottom`.
 */
export function TabBar({ state, navigation, descriptors }: TabBarProps) {
  const theme = useTheme();
  const elevation = useElevation(2);
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: theme.surface, paddingBottom: insets.bottom },
        elevation,
      ]}
    >
      {state.routes.map((route, index) => {
        const descriptor = descriptors[route.key];
        if (!descriptor) return null;
        const { options } = descriptor;
        const focused = state.index === index;
        const color = focused ? theme.accent : theme.textMuted;
        const label = options.title ?? route.name;

        return (
          <Touchable
            key={route.key}
            style={styles.item}
            accessibilityRole="button"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
            onPress={() => {
              // A screen may cancel its own tab press (scroll-to-top, for
              // instance), so the navigation only happens if nothing did.
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            }}
          >
            <View style={[styles.icon, focused ? { backgroundColor: theme.accentSoft } : null]}>
              {options.tabBarIcon?.({ focused, color })}
            </View>
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[type.caption, styles.label, { color }]}
            >
              {label}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: spacing.xs },
  item: { flex: 1, alignItems: 'center', gap: 2, paddingBottom: spacing.xs },
  icon: {
    minWidth: 40,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The caption role's tracking is too wide for a fifth of the bar: it
  // truncated "Movimientos" and "Presupuestos".
  label: { fontSize: 10, letterSpacing: 0 },
});
