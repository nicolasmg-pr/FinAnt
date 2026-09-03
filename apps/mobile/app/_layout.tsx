import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDatabase } from '../src/db/database';
import { initI18n } from '../src/i18n';
import { spacing, useTheme } from '../src/theme';

/**
 * Startup order matters: the encrypted database must be open before i18n, which
 * reads the stored language from it, and before any screen queries a table.
 */
export default function RootLayout() {
  const theme = useTheme();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await getDatabase();
        await initI18n();
        setReady(true);
      } catch (cause) {
        setError(cause as Error);
      }
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
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="import" options={{ presentation: 'modal', headerShown: true, title: 'Import' }} />
        <Stack.Screen
          name="transaction/[id]"
          options={{ presentation: 'modal', headerShown: true }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  errorTitle: { fontSize: 18, fontWeight: '600' },
  errorBody: { fontSize: 14, textAlign: 'center' },
});
