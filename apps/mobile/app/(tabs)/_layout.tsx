import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type ColorValue } from 'react-native';
import { radius, spacing, type, useElevation, useTheme } from '../../src/design';

/** The active tab's icon sits in a filled pill, so the current tab reads from
 * shape as well as from colour. */
function TabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: keyof typeof Feather.glyphMap;
  // The navigator hands back a ColorValue, not a string.
  color: ColorValue;
  size: number;
  focused: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.icon, focused ? { backgroundColor: theme.accentSoft } : null]}>
      <Feather name={name} color={color as string} size={size} />
    </View>
  );
}

/**
 * Every tab screen renders its own large title in its scroll body, so none of
 * them keeps a navigator header: a bar repeating the title costs a fifth of
 * the screen and scrolls with nothing.
 */
export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const elevation = useElevation(2);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: theme.background },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        // The caption role's tracking is too wide for a fifth of the bar:
        // it truncated "Movimientos" and "Presupuestos".
        tabBarLabelStyle: { ...type.caption, fontSize: 10, letterSpacing: 0 },
        tabBarStyle: [styles.bar, { backgroundColor: theme.surface }, elevation],
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.dashboard'),
          tabBarIcon: (props) => <TabIcon name="pie-chart" {...props} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('nav.transactions'),
          tabBarIcon: (props) => <TabIcon name="list" {...props} />,
        }}
      />
      <Tabs.Screen
        name="banks"
        options={{
          title: t('nav.banks'),
          tabBarIcon: (props) => <TabIcon name="home" {...props} />,
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: t('nav.budgets'),
          tabBarIcon: (props) => <TabIcon name="target" {...props} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarIcon: (props) => <TabIcon name="settings" {...props} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { borderTopWidth: 0 },
  icon: {
    minWidth: 40,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
