import Feather from '@expo/vector-icons/Feather';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/design';

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
          // The screen renders its own large title in the scroll body, so the
          // bar would only repeat it. The other tabs follow in the chrome task.
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="pie-chart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="transactions"
        options={{
          title: t('nav.transactions'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="list" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="banks"
        options={{
          title: t('nav.banks'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: t('nav.budgets'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="target" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t('nav.settings'),
          headerShown: false,
          tabBarIcon: ({ color, size }) => <Feather name="settings" color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}
