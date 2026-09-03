import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDatabase } from '../src/db/database';
import { initI18n } from '../src/i18n';
import { detectTransfers } from '../src/services/transfers';
import { spacing, useTheme } from '../src/theme';

/**
 * Startup order matters: the encrypted database must be open before i18n, which
 * reads the stored language from it, and before any screen queries a table.
 */
export default function RootLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await getDatabase();
        await initI18n();
      } catch (cause) {
        setError(cause as Error);
        return;
      }
      // A statement imported before this version may hold unpaired transfers.
      // Matching must never keep the app from starting, so its failure is
      // reported, not raised. Nothing about a row is logged.
      try {
        await detectTransfers();
      } catch (cause) {
        console.warn('Transfer matching failed at startup:', (cause as Error).message);
      }
      setReady(true);
    })();
  }, []);

  if (error) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[styles.errorTitle, { color: theme.text }]}>FinAnt could not start</Text>
        <Text style={[styles.errorBody, { color: theme.textMuted }]}>{error.message}</Text>
      </View>
    );
  }

  if (!ready) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          headerStyle: { backgroundColor: theme.background },
          headerTitleStyle: { color: theme.text },
          headerTintColor: theme.accent,
          // A pushed screen shorter than the viewport otherwise shows the
          // navigator's own scene colour under its content.
          contentStyle: { backgroundColor: theme.background },
          // Without this the iOS back button reads "(tabs)": the label comes
          // from the previous route's title, and that route is a router group.
          headerBackTitle: t('common.back'),
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="import"
          options={{ presentation: 'modal', headerShown: true, title: t('import.title') }}
        />
        <Stack.Screen
          name="transaction/[id]"
          options={{ presentation: 'modal', headerShown: true }}
        />
        {/* Registered so it gets a header: the stack hides them by default, and
            without one this screen opens with no way back but a swipe. */}
        <Stack.Screen name="movement/new" options={{ presentation: 'modal', headerShown: true }} />
        <Stack.Screen name="categories" options={{ headerShown: true }} />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: { fontSize: 18, fontWeight: '600' },
  errorBody: { fontSize: 14, textAlign: 'center' },
});
