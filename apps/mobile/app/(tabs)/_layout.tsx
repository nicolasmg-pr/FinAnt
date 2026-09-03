import Feather from '@expo/vector-icons/Feather';
import { Link, Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';
import { spacing, useTheme } from '../../src/theme';

export default function TabsLayout() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: theme.background },
        headerTitleStyle: { color: theme.text },
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.dashboard'),
          tabBarIcon: ({ color, size }) => <Feather name="pie-chart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('nav.transactions'),
          tabBarIcon: ({ color, size }) => <Feather name="list" color={color} size={size} />,
          headerRight: () => (
            <Link href="/movement/new" asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('transactions.addManual')}
                hitSlop={12}
                style={{ paddingHorizontal: spacing.lg }}
              >
                <Feather name="plus" color={theme.accent} size={22} />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Tabs.Screen
        name="banks"
        options={{
          title: t('nav.banks'),
          tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: t('nav.budgets'),
          tabBarIcon: ({ color, size }) => <Feather name="target" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          tabBarIcon: ({ color, size }) => <Feather name="settings" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
