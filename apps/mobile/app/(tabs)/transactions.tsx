import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  CATEGORY_BY_ID,
  UNCATEGORISED_ID,
  countsTowardStats,
  type Transaction,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { useAppData } from '../../src/hooks/use-app-data';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { formatBookingDate } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';

type Filter = 'all' | 'uncategorised';

export default function TransactionsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { transactions, loading, reload } = useAppData();
  const [filter, setFilter] = useState<Filter>('all');

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));

  const uncategorisedCount = useMemo(
    () => transactions.filter((tx) => !tx.categoryId || tx.categoryId === UNCATEGORISED_ID).length,
    [transactions],
  );

  const visible = useMemo(
    () =>
      filter === 'all'
        ? transactions
        : transactions.filter((tx) => !tx.categoryId || tx.categoryId === UNCATEGORISED_ID),
    [transactions, filter],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {uncategorisedCount > 0 ? (
        <Pressable
          onPress={() => setFilter(filter === 'all' ? 'uncategorised' : 'all')}
          style={[styles.banner, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
        >
          <Text style={{ color: theme.text }}>
            {t('transactions.uncategorisedBanner', { count: uncategorisedCount })}
          </Text>
        </Pressable>
      ) : null}

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={reload}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textMuted }]}>{t('transactions.empty')}</Text>
        }
        renderItem={({ item }) => <Row transaction={item} />}
      />
    </View>
  );
}

function Row({ transaction }: { transaction: Transaction }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const label = useCategoryLabel();
  const category = transaction.categoryId ? CATEGORY_BY_ID.get(transaction.categoryId) : undefined;
  // A row outside the statistics (excluded by hand, or an internal transfer)
  // stays visible but reads as dimmed, so the list still matches the bank.
  const counted = countsTowardStats(transaction);
  const date = formatBookingDate(transaction.bookingDate, { day: '2-digit', month: 'short' });
  const meta = [date, label(transaction.categoryId)];
  if (transaction.excludedFromStats) meta.push(t('transactions.excludedTag'));

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/transaction/[id]', params: { id: transaction.id } })
      }
      accessibilityRole="button"
      style={[styles.row, { borderBottomColor: theme.border, opacity: counted ? 1 : 0.55 }]}
    >
      <View style={[styles.dot, { backgroundColor: category?.color ?? theme.textMuted }]} />
      <View style={styles.rowText}>
        <Text style={[styles.description, { color: theme.text }]} numberOfLines={1}>
          {transaction.counterparty ?? transaction.description}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
      </View>
      <Amount value={transaction.amount} style={styles.amount} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  list: { padding: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  rowText: { flex: 1, gap: 2 },
  description: { fontSize: 15, fontWeight: '500' },
  meta: { fontSize: 12 },
  amount: { fontSize: 15, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: spacing.xxl },
});
