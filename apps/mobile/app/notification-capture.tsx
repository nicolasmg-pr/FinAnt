import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, StyleSheet, Switch, Text, View, ScrollView } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { accountsInBank, type AccountChoice, type RuleMatch } from '@finant/core';
import { AccountPicker } from '../src/components/AccountPicker';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { FormSheet } from '../src/components/FormSheet';
import { Button } from '../src/components/ui/Button';
import { Empty } from '../src/components/ui/Empty';
import { Field } from '../src/components/ui/Field';
import { ListRow } from '../src/components/ui/ListRow';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { Sheet } from '../src/components/ui/Sheet';
import { Touchable } from '../src/components/ui/Touchable';
import { listAccounts, type AccountRow } from '../src/db/accounts-repo';
import { listInstitutions, type InstitutionRow } from '../src/db/institutions-repo';
import { deleteAllCaptures } from '../src/db/notification-captures-repo';
import type { NotificationSource } from '../src/db/mappers';
import {
  createNotificationRoute,
  createNotificationSource,
  deleteNotificationRoute,
  deleteNotificationSource,
  updateNotificationSource,
} from '../src/db/notification-sources-repo';
import { useNotificationSources } from '../src/hooks/use-notification-sources';
import { syncAllowedPackages } from '../src/notifications/capture-service';
import NotificationCapture from '../modules/notification-capture';
import { spacing, type, useTheme } from '../src/design';

/** How long a single learning run listens for, in seconds. */
const LEARNING_SECONDS = 300;

/** What the owner is naming: a package the listener just saw. */
interface NamingDraft {
  packageName: string;
  name: string;
}

/** The sheet that attaches an account (and an optional discriminator) to a source. */
interface RouteDraft {
  sourceId: string;
  choice: AccountChoice;
  discriminator: string;
  /**
   * The account this source's existing fallback route already points at, or
   * null when it has none. `idx_notif_route_fallback` permits exactly one per
   * source, so with a fallback already on record an empty discriminator is not
   * a choice on offer — leaving it blank would come back as a raw, untranslated
   * SQLite constraint message.
   */
  fallbackAccountId: string | null;
}

/** The text on a route's chip: the word it matches on, or the fallback label. */
function routeMatchValue(match: RuleMatch | null): string | null {
  if (match === null) return null;
  return match.kind === 'word' ? match.value : null;
}

/** The first existing account, so the route sheet never opens on a blank
 * picker. Null when the owner has not created an account yet — there is
 * nothing this screen may pick on their behalf. */
function firstAccountChoice(
  accounts: readonly AccountRow[],
  institutions: readonly InstitutionRow[],
): AccountChoice | null {
  const known = new Set(institutions.map((institution) => institution.id));
  const choosable = accounts.map((account) => ({
    id: account.id,
    institutionId:
      account.institution_id !== null && known.has(account.institution_id)
        ? account.institution_id
        : null,
  }));
  const first = choosable[0];
  if (!first) return null;
  const emptyChoice: AccountChoice = {
    institutionId: null,
    newInstitution: false,
    institutionName: '',
    accountId: first.id,
    newAccount: false,
    accountName: '',
  };
  const inFirstBank = accountsInBank(choosable, {
    ...emptyChoice,
    institutionId: first.institutionId,
  });
  return {
    ...emptyChoice,
    institutionId: first.institutionId,
    accountId: (inFirstBank[0] ?? first).id,
  };
}

export default function NotificationCaptureScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const supported = NotificationCapture.isSupported();
  const { sources, granted, reload } = useNotificationSources();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);

  const [learning, setLearning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [learned, setLearned] = useState<string[]>([]);
  const [learnedAttempted, setLearnedAttempted] = useState(false);

  const [naming, setNaming] = useState<NamingDraft | null>(null);
  const [namingError, setNamingError] = useState<string | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  // The permission is granted in the Android settings app, a different
  // Activity — leaving and returning to that does not change navigation
  // focus, so `useFocusEffect` alone never sees it. The app going back to
  // `active` is the signal that covers that trip.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void reload();
    });
    return () => subscription.remove();
  }, [reload]);

  // Learning mode is a native, session-scoped buffer: leaving this screen
  // mid-session (the brief's own walkthrough invites exactly that, since the
  // owner goes off to trigger a payment) must not leave it holding packages
  // from a run nobody will ever read. `learningRef` mirrors `learning` so the
  // unmount cleanup below sees its last known value without re-running on
  // every tick of the countdown.
  const learningRef = useRef(learning);
  useEffect(() => {
    learningRef.current = learning;
  }, [learning]);
  useEffect(() => {
    return () => {
      if (learningRef.current) {
        NotificationCapture.consumeLearnedPackages();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listAccounts(), listInstitutions()])
      .then(([knownAccounts, knownInstitutions]) => {
        if (cancelled) return;
        setAccounts(knownAccounts);
        setInstitutions(knownInstitutions);
      })
      .catch(() => {
        if (!cancelled) {
          setAccounts([]);
          setInstitutions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const finishLearning = useCallback(() => {
    setLearning(false);
    setLearnedAttempted(true);
    setLearned(NotificationCapture.consumeLearnedPackages());
  }, []);

  useEffect(() => {
    if (!learning) return undefined;
    if (secondsLeft <= 0) {
      finishLearning();
      return undefined;
    }
    const timer = setTimeout(() => setSecondsLeft((current) => current - 1), 1000);
    return () => clearTimeout(timer);
  }, [learning, secondsLeft, finishLearning]);

  if (!supported) {
    return (
      <View style={[styles.unsupported, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: t('notifications.title') }} />
        <Text style={[type.body, { color: theme.textMuted }]}>
          {t('notifications.androidOnly')}
        </Text>
      </View>
    );
  }

  const startLearning = () => {
    NotificationCapture.startLearning(LEARNING_SECONDS);
    setLearned([]);
    setLearnedAttempted(false);
    setSecondsLeft(LEARNING_SECONDS);
    setLearning(true);
  };

  const knownPackages = new Set(sources.map(({ source }) => source.packageName));
  const learnedVisible = learned.filter((pkg) => !knownPackages.has(pkg));

  const openNaming = (packageName: string) => {
    setNamingError(null);
    setNaming({ packageName, name: '' });
  };

  const saveNaming = async () => {
    if (!naming || busy) return;
    const name = naming.name.trim();
    if (name === '') return;
    setBusy(true);
    try {
      await createNotificationSource({
        packageName: naming.packageName,
        label: name,
        institutionId: null,
      });
      await syncAllowedPackages();
      await reload();
      setLearned((current) => current.filter((pkg) => pkg !== naming.packageName));
      setNaming(null);
    } catch (cause) {
      setNamingError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoApprove = async (sourceId: string, autoApprove: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await updateNotificationSource(sourceId, { autoApprove });
      await reload();
    } catch (cause) {
      Alert.alert(t('notifications.autoApprove'), (cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteSource = (source: NotificationSource) => {
    Alert.alert(t('common.delete'), source.label, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          if (busy) return;
          void (async () => {
            setBusy(true);
            try {
              await deleteNotificationSource(source.id);
              await syncAllowedPackages();
              await reload();
            } catch (cause) {
              Alert.alert(t('common.delete'), (cause as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const removeRoute = async (routeId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await deleteNotificationRoute(routeId);
      await reload();
    } catch (cause) {
      Alert.alert(t('notifications.routes'), (cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openAddRoute = (sourceId: string) => {
    const choice = firstAccountChoice(accounts, institutions);
    if (!choice) return;
    const existing = sources.find((entry) => entry.source.id === sourceId)?.routes ?? [];
    setRouteError(null);
    setRouteDraft({
      sourceId,
      choice,
      discriminator: '',
      fallbackAccountId: existing.find((route) => route.match === null)?.accountId ?? null,
    });
  };

  const canSaveRoute =
    routeDraft !== null &&
    !routeDraft.choice.newAccount &&
    !routeDraft.choice.newInstitution &&
    // A second fallback is refused by the database, so it is refused here
    // first, where the owner can still see why.
    !(routeDraft.fallbackAccountId !== null && routeDraft.discriminator.trim() === '');

  const saveRoute = async () => {
    if (!routeDraft || busy || !canSaveRoute) return;
    setBusy(true);
    try {
      const value = routeDraft.discriminator.trim();
      await createNotificationRoute({
        sourceId: routeDraft.sourceId,
        accountId: routeDraft.choice.accountId,
        match: value === '' ? null : { kind: 'word', field: 'any', value },
      });
      await reload();
      setRouteDraft(null);
    } catch (cause) {
      setRouteError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteAllCaptures = () => {
    Alert.alert(t('notifications.deleteCaptures'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          if (busy) return;
          void (async () => {
            setBusy(true);
            try {
              await deleteAllCaptures();
              await reload();
            } catch (cause) {
              Alert.alert(t('notifications.deleteCaptures'), (cause as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: t('notifications.title') }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <Card>
          <Text style={[type.body, { color: theme.textMuted }]}>
            {t('notifications.explainer')}
          </Text>
        </Card>

        <Card>
          <Text style={[type.body, { color: granted ? theme.textMuted : theme.expense }]}>
            {granted ? t('notifications.permissionGranted') : t('notifications.permissionMissing')}
          </Text>
          <Button
            label={t('notifications.grant')}
            variant="secondary"
            onPress={() => NotificationCapture.openPermissionSettings()}
          />
          <Text style={[type.caption, { color: theme.textMuted }]}>
            {t('notifications.revokedHint')}
          </Text>
        </Card>

        <Card title={t('notifications.sources')}>
          <Text style={[type.body, { color: theme.textMuted }]}>
            {t('notifications.learnExplainer')}
          </Text>
          {learning ? (
            <>
              <Text style={[type.label, { color: theme.textMuted }]}>
                {t('notifications.learning', { seconds: secondsLeft })}
              </Text>
              <Button label={t('common.done')} variant="secondary" onPress={finishLearning} />
            </>
          ) : (
            <Button label={t('notifications.learn')} onPress={startLearning} />
          )}
          {!learning && learnedVisible.length > 0 ? (
            <View style={styles.chips}>
              {learnedVisible.map((pkg) => (
                <Chip key={pkg} label={pkg} selected={false} onPress={() => openNaming(pkg)} />
              ))}
            </View>
          ) : null}
          {!learning && learnedAttempted && learnedVisible.length === 0 ? (
            <Empty message={t('notifications.learnEmpty')} />
          ) : null}
        </Card>

        {sources.map(({ source, routes }) => (
          <Card key={source.id} title={source.label}>
            <ListRow
              title={t('notifications.autoApprove')}
              subtitle={t('notifications.autoApproveHint')}
              trailing={
                <Switch
                  value={source.autoApprove}
                  disabled={busy}
                  onValueChange={(value) => void toggleAutoApprove(source.id, value)}
                  trackColor={{ true: theme.accent }}
                />
              }
            />

            <SectionHeader label={t('notifications.routes')} />
            {routes.map((route, index) => (
              <ListRow
                key={route.id}
                title={routeMatchValue(route.match) ?? t('notifications.routeFallback')}
                divider={index < routes.length - 1}
                trailing={
                  <Touchable
                    onPress={() => void removeRoute(route.id)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.delete')}
                  >
                    <Feather name="trash-2" size={18} color={theme.expense} />
                  </Touchable>
                }
              />
            ))}
            <Button
              label={t('notifications.addRoute')}
              variant="secondary"
              disabled={accounts.length === 0 || busy}
              onPress={() => openAddRoute(source.id)}
            />

            <View style={styles.dangerZone}>
              <Button
                label={t('common.delete')}
                variant="danger"
                disabled={busy}
                onPress={() => confirmDeleteSource(source)}
              />
            </View>
          </Card>
        ))}

        <Card>
          <Button
            label={t('notifications.deleteCaptures')}
            variant="danger"
            disabled={busy}
            onPress={confirmDeleteAllCaptures}
          />
        </Card>
      </ScrollView>

      <FormSheet
        visible={naming !== null}
        title={t('notifications.addSource')}
        subtitle={naming?.packageName}
        fields={
          naming
            ? [
                {
                  key: 'name',
                  label: t('notifications.sourceName'),
                  value: naming.name,
                  onChangeText: (name) => setNaming({ ...naming, name }),
                  autoCapitalize: 'words',
                },
              ]
            : []
        }
        error={namingError}
        saveDisabled={naming === null || naming.name.trim() === ''}
        onCancel={() => setNaming(null)}
        onSave={() => void saveNaming()}
      />

      <Sheet
        visible={routeDraft !== null}
        onDismiss={() => setRouteDraft(null)}
        title={t('notifications.addRoute')}
        scroll
      >
        {routeDraft ? (
          <>
            <AccountPicker
              institutions={institutions}
              accounts={accounts}
              value={routeDraft.choice}
              onChange={(choice) => setRouteDraft({ ...routeDraft, choice })}
              allowCreate={false}
            />
            <Field
              label={t('notifications.routeMatch')}
              value={routeDraft.discriminator}
              onChangeText={(discriminator) => setRouteDraft({ ...routeDraft, discriminator })}
              // Blank means "anything else", and that route already exists.
              placeholder={
                routeDraft.fallbackAccountId === null ? t('notifications.routeFallback') : ''
              }
            />
            {routeDraft.fallbackAccountId !== null ? (
              <Text style={[type.label, { color: theme.textMuted }]}>
                {t('notifications.routeFallback')}
                {' · '}
                {accounts.find((account) => account.id === routeDraft.fallbackAccountId)?.name ??
                  ''}
              </Text>
            ) : null}
          </>
        ) : null}

        {routeError ? (
          <Text style={[type.label, { color: theme.expense }]}>{routeError}</Text>
        ) : null}

        <View style={styles.sheetActions}>
          <Button
            label={t('common.cancel')}
            variant="secondary"
            onPress={() => setRouteDraft(null)}
          />
          <Button
            label={t('common.save')}
            loading={busy}
            disabled={!canSaveRoute}
            onPress={() => void saveRoute()}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  unsupported: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  dangerZone: { gap: spacing.sm, marginTop: spacing.sm },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
