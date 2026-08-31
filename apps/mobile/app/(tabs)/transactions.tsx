import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { CATEGORY_BY_ID, UNCATEGORISED_ID, type Transaction } from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { useAppData } from '../../src/hooks/use-app-data';
import { intlLocale } from '../../src/i18n';
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
  const category = transaction.categoryId ? CATEGORY_BY_ID.get(transaction.categoryId) : undefined;
  const categoryLabel = category?.labelKey ? t(category.labelKey) : (category?.name ?? '—');
  const date = new Intl.DateTimeFormat(intlLocale(), { day: '2-digit', month: 'short' }).format(
    new Date(`${transaction.bookingDate}T00:00:00Z`),
  );

  return (
    <View style={[styles.row, { borderBottomColor: theme.border }]}>
      <View style={[styles.dot, { backgroundColor: category?.color ?? theme.textMuted }]} />
      <View style={styles.rowText}>
        <Text style={[styles.description, { color: theme.text }]} numberOfLines={1}>
          {transaction.counterparty ?? transaction.description}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
          {date} · {categoryLabel}
        </Text>
      </View>
      <Amount value={transaction.amount} style={styles.amount} />
    </View>
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
