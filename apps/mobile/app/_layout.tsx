import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDatabase } from '../src/db/database';
import { initI18n } from '../src/i18n';
import { detectTransfers } from '../src/services/transfers';
import { spacing, type, useTheme } from '../src/design';
import ShareIntakeModule, { SHARE_TOO_LARGE } from '../modules/share-intake';
import { setPendingShare, type SharedFile } from '../src/services/share-intake';

/**
 * What the share effects below hand to the flush effect: either a received
 * file (carrying the nonce that makes its route unique) or a failure code.
 * Kept as data rather than a pre-built route string so the literal route
 * forms — required by `typedRoutes` — are only ever written where they are
 * pushed, in one place.
 */
type PendingShareNavigation =
  { kind: 'received'; nonce: number } | { kind: 'failed'; code: string };

/**
 * Startup order matters: the encrypted database must be open before i18n, which
 * reads the stored language from it, and before any screen queries a table.
 */
export default function RootLayout() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<PendingShareNavigation | null>(null);

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

  // A file shared into FinAnt from another app. Android's share sheet sends an
  // ACTION_SEND intent, whose URI never reaches expo-router, so nothing has
  // navigated yet and this is where the import screen gets opened. iOS and
  // Android's "open with" arrive as URLs instead and are already on their way
  // there via app/+native-intent.tsx.
  //
  // Subscribed unconditionally, on mount: a share can arrive while the startup
  // effect above is still opening the database, and nothing on the native side
  // queues it if no listener is attached yet. Only the navigation waits for
  // `ready` (see the flush effect below) — the database gate exists for the
  // import parse, not for listening.
  useEffect(() => {
    const open = (file: SharedFile) => {
      // Staged the moment it arrives, regardless of `ready`: the store is just
      // memory, and nothing reads it before the import screen mounts.
      setPendingShare(file);
      // The nonce is Date.now(), not a constant: a second share into a running
      // app would otherwise produce the identical route, leaving the import
      // screen's effect with an unchanged parameter and the file unread.
      setPendingNavigation({ kind: 'received', nonce: Date.now() });
    };

    // A share into an already-running app: singleTask hands the activity a new
    // intent, which the native module turns into these two events.
    const received = ShareIntakeModule.addListener('onShareReceived', open);
    const failed = ShareIntakeModule.addListener('onShareFailed', ({ code }) => {
      // The copy never happened, so there is no file in the store — the import
      // screen reads the reason out of the route instead.
      setPendingNavigation({ kind: 'failed', code });
    });
    return () => {
      received.remove();
      failed.remove();
    };
  }, []);

  // The ACTION_SEND intent that launched the app, if any. `consumePendingShare`
  // reads and clears it natively, so it must run exactly once — gated on
  // `ready` because the database it will be parsed into is only open once the
  // startup effect above finishes, and never re-run afterwards since `ready`
  // never turns false again.
  useEffect(() => {
    if (!ready) return;
    const launched = ShareIntakeModule.consumePendingShare();
    if (launched) {
      setPendingShare(launched);
      setPendingNavigation({ kind: 'received', nonce: Date.now() });
    }
  }, [ready]);

  // A share that arrived (or was found waiting at launch) before the app was
  // ready waits here instead of being dropped: pushed the moment `ready` turns
  // true, and replaced — not queued — if a second one arrives before that.
  useEffect(() => {
    if (!ready || pendingNavigation === null) return;
    if (pendingNavigation.kind === 'received') {
      router.push(`/import?shared=${pendingNavigation.nonce}`);
    } else {
      router.push(
        pendingNavigation.code === SHARE_TOO_LARGE
          ? '/import?shared=too-large'
          : '/import?shared=unreadable',
      );
    }
    setPendingNavigation(null);
  }, [ready, pendingNavigation, router]);

  if (error) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Text style={[type.title, { color: theme.text }]}>FinAnt could not start</Text>
        <Text style={[type.body, styles.centreText, { color: theme.textMuted }]}>
          {error.message}
        </Text>
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
    // The ask bubble is dragged with a pan gesture, and react-native-gesture-handler
    // needs this at the very root or the gesture never reaches it.
    <GestureHandlerRootView style={styles.root}>
      {/* Android is edge-to-edge, which makes the manifest's `adjustResize`
        inert: the window keeps its full height and the keyboard covers
        whatever is focused. This provider reads the real IME insets so the
        forms can move out of the way. Both translucency flags are set because
        the app already draws behind the system bars, and without them the
        provider lays out once with bars and once without.
        See docs/keyboard-handling.md. */}
      <KeyboardProvider statusBarTranslucent navigationBarTranslucent>
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
            <Stack.Screen
              name="movement/new"
              options={{ presentation: 'modal', headerShown: true }}
            />
            <Stack.Screen name="categories" options={{ headerShown: true }} />
            <Stack.Screen name="notification-capture" options={{ headerShown: true }} />
            <Stack.Screen name="notification-inbox" options={{ headerShown: true }} />
          </Stack>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  centreText: { textAlign: 'center' },
});
