import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  PROVISIONAL_STALE_DAYS,
  money,
  resolveRoute,
  type NotificationRoute,
  type RouteResolution,
  type Transaction,
} from '@finant/core';
import { Amount } from '../src/components/Amount';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/ui/Button';
import { Empty } from '../src/components/ui/Empty';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { listAccounts, type AccountRow } from '../src/db/accounts-repo';
import type { NotificationCapture } from '../src/db/mappers';
import { listNotificationRoutes } from '../src/db/notification-sources-repo';
import { useCaptureInbox } from '../src/hooks/use-capture-inbox';
import { acceptCapture, dismissCapture } from '../src/notifications/capture-service';
import { formatBookingDate } from '../src/i18n';
import { radius, spacing, type, useTheme } from '../src/design';

/**
 * Where a pending capture's own route resolution would send it, computed the
 * same way `acceptCapture` decides it — so the account shown here is the one
 * tapping "Add movement" would actually pick.
 */
function resolveCaptureRoute(
  capture: NotificationCapture,
  routesBySource: ReadonlyMap<string, readonly NotificationRoute[]>,
): RouteResolution | null {
  if (capture.sourceId === null || capture.parsed === null) return null;
  const routes = routesBySource.get(capture.sourceId) ?? [];
  const text = [capture.title, capture.body].filter(Boolean).join(' ');
  return resolveRoute({ text, amountMinor: capture.parsed.amountMinor }, routes);
}

export default function NotificationInboxScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { captures, provisionals, stale, reload } = useCaptureInbox();

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [routesBySource, setRoutesBySource] = useState<
    ReadonlyMap<string, readonly NotificationRoute[]>
  >(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  // A capture `acceptCapture` could not route. Kept apart from the proactive
  // resolution below because that call is the one source of truth for whether
  // a route exists — this only records that it, specifically, just failed.
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    let cancelled = false;
    void listAccounts().then((rows) => {
      if (!cancelled) setAccounts(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = useMemo(() => captures.filter((c) => c.status === 'pending'), [captures]);
  const unreadable = useMemo(() => captures.filter((c) => c.status === 'unreadable'), [captures]);
  const staleRows = useMemo(
    () => provisionals.filter((tx) => stale.has(tx.id)),
    [provisionals, stale],
  );

  // One lookup per source rather than per capture: several captures from the
  // same bank app share the same routes.
  useEffect(() => {
    let cancelled = false;
    const sourceIds = [
      ...new Set(
        pending.map((capture) => capture.sourceId).filter((id): id is string => id !== null),
      ),
    ];
    if (sourceIds.length === 0) {
      setRoutesBySource(new Map());
      return undefined;
    }
    Promise.all(sourceIds.map((id) => listNotificationRoutes(id))).then((results) => {
      if (cancelled) return;
      setRoutesBySource(new Map(sourceIds.map((id, index) => [id, results[index] ?? []])));
    });
    return () => {
      cancelled = true;
    };
  }, [pending]);

  const accountName = (accountId: string): string | null =>
    accounts.find((account) => account.id === accountId)?.name ?? null;

  const accept = async (captureId: string) => {
    if (busyId) return;
    setBusyId(captureId);
    try {
      const movementId = await acceptCapture(captureId);
      if (movementId === null) {
        setFailedIds((current) => new Set(current).add(captureId));
        return;
      }
      setFailedIds((current) => {
        if (!current.has(captureId)) return current;
        const next = new Set(current);
        next.delete(captureId);
        return next;
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (captureId: string) => {
    if (busyId) return;
    setBusyId(captureId);
    try {
      await dismissCapture(captureId);
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const empty = pending.length === 0 && unreadable.length === 0 && staleRows.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: t('notifications.inbox') }} />
      <ScrollView contentContainerStyle={styles.screen}>
        {empty ? <Empty message={t('notifications.empty')} /> : null}

        {pending.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader label={t('notifications.pending')} />
            {pending.map((capture) => {
              const resolution = resolveCaptureRoute(capture, routesBySource);
              return (
                <PendingCard
                  key={capture.id}
                  capture={capture}
                  accountName={resolution ? accountName(resolution.accountId) : null}
                  viaFallback={resolution?.viaFallback ?? false}
                  showNoRoute={resolution === null || failedIds.has(capture.id)}
                  busy={busyId === capture.id}
                  onAccept={() => void accept(capture.id)}
                  onDismiss={() => void dismiss(capture.id)}
                />
              );
            })}
          </View>
        ) : null}

        {unreadable.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader label={t('notifications.unreadable')} />
            {unreadable.map((capture) => (
              <UnreadableCard
                key={capture.id}
                capture={capture}
                busy={busyId === capture.id}
                onDismiss={() => void dismiss(capture.id)}
              />
            ))}
          </View>
        ) : null}

        {staleRows.length > 0 ? (
          <View style={styles.section}>
            <SectionHeader label={t('notifications.provisional')} />
            {staleRows.map((tx) => (
              <StaleCard key={tx.id} transaction={tx} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * One waiting capture: what the notification said, the account accepting it
 * would use, and the three ways to settle it. "Edit first" opens the full
 * manual-entry form pre-filled from the parsed movement, for the odd case
 * where the parse is close but not quite right.
 */
function PendingCard({
  capture,
  accountName,
  viaFallback,
  showNoRoute,
  busy,
  onAccept,
  onDismiss,
}: {
  capture: NotificationCapture;
  accountName: string | null;
  viaFallback: boolean;
  showNoRoute: boolean;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const movement = capture.parsed;
  // Every capture with status `pending` carries a parsed movement; this only
  // guards the type, which does not know that.
  if (!movement) return null;

  const editFirst = () => {
    router.push({
      pathname: '/movement/new',
      params: {
        side: movement.side,
        amountMinor: String(movement.amountMinor),
        currency: movement.currency,
        description: movement.description,
        counterparty: movement.counterparty ?? '',
        bookingDate: capture.bookingDate,
      },
    });
  };

  return (
    <Card>
      <View style={styles.amountRow}>
        <Amount value={money(movement.amountMinor, movement.currency)} size="heading" />
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {formatBookingDate(capture.bookingDate, { day: '2-digit', month: 'short' })}
        </Text>
      </View>
      <Text style={[type.body, { color: theme.text }]}>
        {movement.counterparty ?? movement.description}
      </Text>
      {movement.counterparty ? (
        <Text style={[type.caption, { color: theme.textMuted }]}>{movement.description}</Text>
      ) : null}

      {accountName ? (
        <Text style={[type.label, { color: theme.textMuted }]}>{accountName}</Text>
      ) : null}
      {accountName && viaFallback ? (
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {t('notifications.viaFallback')}
        </Text>
      ) : null}

      {showNoRoute ? (
        <View style={[styles.note, { backgroundColor: theme.warningSoft }]}>
          <Feather name="alert-circle" size={14} color={theme.warning} />
          <Text style={[type.label, styles.noteText, { color: theme.warning }]}>
            {t('notifications.noRoute')}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button label={t('notifications.accept')} loading={busy} onPress={onAccept} />
        <Button
          label={t('notifications.edit')}
          variant="secondary"
          disabled={busy}
          onPress={editFirst}
        />
        <Button
          label={t('notifications.dismiss')}
          variant="danger"
          disabled={busy}
          onPress={onDismiss}
        />
      </View>
    </Card>
  );
}

/**
 * A notification FinAnt could not parse. The raw text is selectable rather
 * than behind a copy button: `expo-clipboard` is not a dependency of this
 * project, and adding one for a single button is not worth it.
 */
function UnreadableCard({
  capture,
  busy,
  onDismiss,
}: {
  capture: NotificationCapture;
  busy: boolean;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const text = [capture.title, capture.body].filter(Boolean).join('\n');

  return (
    <Card>
      <Text style={[type.body, { color: theme.text }]} selectable>
        {text}
      </Text>
      <Text style={[type.caption, { color: theme.textMuted }]}>
        {t('notifications.unreadableExplainer')}
      </Text>
      <Button
        label={t('notifications.dismiss')}
        variant="danger"
        disabled={busy}
        loading={busy}
        onPress={onDismiss}
      />
    </Card>
  );
}

/**
 * A provisional the bank appears never to have booked. The inbox never
 * deletes it: tapping through to the movement is where that happens, on the
 * screen that already carries the delete confirmation.
 */
function StaleCard({ transaction }: { transaction: Transaction }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Card
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: transaction.id } })}
    >
      <View style={styles.amountRow}>
        <Amount value={transaction.amount} />
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {formatBookingDate(transaction.bookingDate, { day: '2-digit', month: 'short' })}
        </Text>
      </View>
      <Text style={[type.body, { color: theme.text }]}>
        {transaction.counterparty ?? transaction.description}
      </Text>
      <Text style={[type.label, { color: theme.warning }]}>
        {t('notifications.provisionalStale', { days: PROVISIONAL_STALE_DAYS })}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  section: { marginBottom: spacing.md },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  noteText: { flexShrink: 1 },
});
