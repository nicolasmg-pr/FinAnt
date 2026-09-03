import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  BUILT_IN_CATEGORIES,
  CATEGORY_BY_ID,
  DATE_RANGE_PRESETS,
  EMPTY_FILTER,
  UNCATEGORISED_ID,
  activeFilterCount,
  countsTowardStats,
  dateRangePreset,
  filterTransactions,
  formatMoney,
  isValidISODate,
  money,
  presetOf,
  type DateRangePreset,
  type Money,
  type Transaction,
  type TransactionFilter,
} from '@finant/core';
import { parseAmount } from '@finant/importers';
import { Amount } from '../../src/components/Amount';
import { Chip } from '../../src/components/Chip';
import type { AccountRow } from '../../src/db/accounts-repo';
import { useAppData } from '../../src/hooks/use-app-data';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { formatBookingDate, intlLocale } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';

const SIDES = ['all', 'income', 'expense'] as const;

function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
}

/**
 * The net of what is on screen, or null when the list mixes currencies.
 * Summing across currencies would produce a number that means nothing, so the
 * line is dropped rather than shown wrong.
 */
function netOf(transactions: readonly Transaction[]): Money | null {
  const first = transactions[0];
  if (!first) return null;
  const currency = first.amount.currency;
  if (transactions.some((tx) => tx.amount.currency !== currency)) return null;
  return money(
    transactions.reduce((sum, tx) => sum + tx.amount.minor, 0),
    currency,
  );
}

export default function TransactionsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { transactions, accounts, loading, reload } = useAppData();
  const [filter, setFilter] = useState<TransactionFilter>(EMPTY_FILTER);
  const [panelOpen, setPanelOpen] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const uncategorisedCount = useMemo(
    () => transactions.filter((tx) => !tx.categoryId || tx.categoryId === UNCATEGORISED_ID).length,
    [transactions],
  );

  const visible = useMemo(() => filterTransactions(transactions, filter), [transactions, filter]);
  const net = useMemo(() => netOf(visible), [visible]);
  const activeCount = activeFilterCount(filter);

  // Only the categories the ledger actually uses: offering twenty chips for a
  // file that touched four of them is a worse list, not a more complete one.
  const usedCategoryIds = useMemo(() => {
    const present = new Set(transactions.map((tx) => tx.categoryId ?? UNCATEGORISED_ID));
    const ordered = BUILT_IN_CATEGORIES.filter((c) => present.has(c.id)).map((c) => c.id);
    return present.has(UNCATEGORISED_ID) ? [UNCATEGORISED_ID, ...ordered] : ordered;
  }, [transactions]);

  // One account needs no label; the name only helps once there is something to tell apart.
  const accountNames = useMemo(
    () => (accounts.length > 1 ? new Map(accounts.map((a) => [a.id, a.name])) : null),
    [accounts],
  );

  const showUncategorised = () =>
    setFilter((current) => ({ ...current, categoryIds: [UNCATEGORISED_ID] }));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        refreshing={loading}
        onRefresh={reload}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <ListHeader
            filter={filter}
            setFilter={setFilter}
            panelOpen={panelOpen}
            setPanelOpen={setPanelOpen}
            activeCount={activeCount}
            accounts={accounts}
            categoryIds={usedCategoryIds}
            resultCount={visible.length}
            net={net}
            uncategorisedCount={uncategorisedCount}
            onShowUncategorised={showUncategorised}
          />
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textMuted }]}>
            {activeCount > 0 ? t('transactions.filters.noMatch') : t('transactions.empty')}
          </Text>
        }
        renderItem={({ item }) => (
          <Row transaction={item} accountName={accountNames?.get(item.accountId) ?? null} />
        )}
      />
    </View>
  );
}

interface HeaderProps {
  filter: TransactionFilter;
  setFilter: (update: (current: TransactionFilter) => TransactionFilter) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  activeCount: number;
  accounts: readonly AccountRow[];
  categoryIds: readonly string[];
  resultCount: number;
  net: Money | null;
  uncategorisedCount: number;
  onShowUncategorised: () => void;
}

/**
 * Search box, filter panel and result summary.
 *
 * Declared at module level rather than inline so the list header keeps the same
 * component type across renders: an inline one is remounted on every keystroke
 * and the search field loses focus after the first character.
 */
function ListHeader({
  filter,
  setFilter,
  panelOpen,
  setPanelOpen,
  activeCount,
  accounts,
  categoryIds,
  resultCount,
  net,
  uncategorisedCount,
  onShowUncategorised,
}: HeaderProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const label = useCategoryLabel();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const preset = presetOf(filter, today);

  // The four typed bounds keep their own text. A half-typed date is not a
  // filter yet, and a preset chip has to be able to rewrite what the date
  // fields show — neither works if the input is driven straight off the filter.
  const [fromText, setFromText] = useState(filter.from ?? '');
  const [toText, setToText] = useState(filter.to ?? '');
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');

  const applyPreset = (option: DateRangePreset) => {
    const range = dateRangePreset(option, today);
    setFromText(range.from ?? '');
    setToText(range.to ?? '');
    setFilter((current) => ({ ...current, ...range }));
  };

  const clearAll = () => {
    setFromText('');
    setToText('');
    setMinText('');
    setMaxText('');
    setFilter(() => EMPTY_FILTER);
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
  ];

  return (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <View
          style={[styles.search, { borderColor: theme.border, backgroundColor: theme.surfaceAlt }]}
        >
          <Feather name="search" size={16} color={theme.textMuted} />
          <TextInput
            value={filter.text}
            onChangeText={(text) => setFilter((current) => ({ ...current, text }))}
            placeholder={t('transactions.searchPlaceholder')}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t('transactions.search')}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.text }]}
          />
          {filter.text !== '' ? (
            <Pressable
              onPress={() => setFilter((current) => ({ ...current, text: '' }))}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Feather name="x" size={16} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={() => setPanelOpen(!panelOpen)}
          accessibilityRole="button"
          accessibilityState={{ expanded: panelOpen }}
          style={[
            styles.filterButton,
            {
              borderColor: activeCount > 0 ? theme.accent : theme.border,
              backgroundColor: panelOpen ? theme.surfaceAlt : 'transparent',
            },
          ]}
        >
          <Feather name="sliders" size={16} color={activeCount > 0 ? theme.accent : theme.text} />
          <Text style={{ color: activeCount > 0 ? theme.accent : theme.text, fontSize: 13 }}>
            {activeCount > 0
              ? `${t('transactions.filters.show')} ${activeCount}`
              : t('transactions.filters.show')}
          </Text>
        </Pressable>
      </View>

      {panelOpen ? (
        <View style={[styles.panel, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <Section label={t('transactions.filters.period')}>
            {DATE_RANGE_PRESETS.map((option) => (
              <Chip
                key={option}
                label={t(`transactions.filters.preset.${option}`)}
                selected={preset === option}
                onPress={() => applyPreset(option)}
              />
            ))}
          </Section>
          <View style={styles.pair}>
            <TextInput
              value={fromText}
              onChangeText={(value) => {
                setFromText(value);
                if (isValidISODate(value) || value === '') {
                  setFilter((current) => ({ ...current, from: value === '' ? null : value }));
                }
              }}
              placeholder={t('transactions.filters.datePlaceholder')}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t('transactions.filters.from')}
              autoCapitalize="none"
              autoCorrect={false}
              style={[...inputStyle, styles.half]}
            />
            <TextInput
              value={toText}
              onChangeText={(value) => {
                setToText(value);
                if (isValidISODate(value) || value === '') {
                  setFilter((current) => ({ ...current, to: value === '' ? null : value }));
                }
              }}
              placeholder={t('transactions.filters.datePlaceholder')}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t('transactions.filters.to')}
              autoCapitalize="none"
              autoCorrect={false}
              style={[...inputStyle, styles.half]}
            />
          </View>

          <Section label={t('transactions.filters.direction')}>
            {SIDES.map((side) => (
              <Chip
                key={side}
                label={t(`transactions.filters.side.${side}`)}
                selected={filter.side === side}
                onPress={() => setFilter((current) => ({ ...current, side }))}
              />
            ))}
          </Section>

          {accounts.length > 1 ? (
            <Section label={t('transactions.filters.account')}>
              {accounts.map((account) => (
                <Chip
                  key={account.id}
                  label={account.name}
                  selected={filter.accountIds.includes(account.id)}
                  onPress={() =>
                    setFilter((current) => ({
                      ...current,
                      accountIds: toggle(current.accountIds, account.id),
                    }))
                  }
                />
              ))}
            </Section>
          ) : null}

          {categoryIds.length > 0 ? (
            <Section label={t('transactions.filters.category')}>
              {categoryIds.map((id) => (
                <Chip
                  key={id}
                  label={label(id === UNCATEGORISED_ID ? null : id)}
                  selected={filter.categoryIds.includes(id)}
                  onPress={() =>
                    setFilter((current) => ({
                      ...current,
                      categoryIds: toggle(current.categoryIds, id),
                    }))
                  }
                />
              ))}
            </Section>
          ) : null}

          <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>
            {t('transactions.filters.amount')}
          </Text>
          <View style={styles.pair}>
            <TextInput
              value={minText}
              onChangeText={(value) => {
                setMinText(value);
                setFilter((current) => ({
                  ...current,
                  minMinor: parseAmount(value, 'EUR', 'auto')?.minor ?? null,
                }));
              }}
              placeholder={t('transactions.filters.amountPlaceholder')}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t('transactions.filters.from')}
              inputMode="decimal"
              style={[...inputStyle, styles.half]}
            />
            <TextInput
              value={maxText}
              onChangeText={(value) => {
                setMaxText(value);
                setFilter((current) => ({
                  ...current,
                  maxMinor: parseAmount(value, 'EUR', 'auto')?.minor ?? null,
                }));
              }}
              placeholder={t('transactions.filters.amountPlaceholder')}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t('transactions.filters.to')}
              inputMode="decimal"
              style={[...inputStyle, styles.half]}
            />
          </View>

          {activeCount > 0 ? (
            <Pressable onPress={clearAll} accessibilityRole="button" style={styles.clear}>
              <Text style={{ color: theme.accent, fontWeight: '600' }}>
                {t('transactions.filters.clear')}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {uncategorisedCount > 0 && !filter.categoryIds.includes(UNCATEGORISED_ID) ? (
        <Pressable
          onPress={onShowUncategorised}
          accessibilityRole="button"
          style={[styles.banner, { backgroundColor: theme.surfaceAlt, borderColor: theme.border }]}
        >
          <Text style={{ color: theme.text }}>
            {t('transactions.uncategorisedBanner', { count: uncategorisedCount })}
          </Text>
        </Pressable>
      ) : null}

      <Text style={[styles.summary, { color: theme.textMuted }]}>
        {t('transactions.filters.results', { count: resultCount })}
        {net
          ? ` · ${t('transactions.filters.net', { amount: formatMoney(net, intlLocale()) })}`
          : ''}
      </Text>
    </View>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: theme.textMuted }]}>{label}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Row({
  transaction,
  accountName,
}: {
  transaction: Transaction;
  accountName: string | null;
}) {
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
  if (accountName) meta.push(accountName);

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: transaction.id } })}
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
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md, fontSize: 15 },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  panel: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.md,
    gap: spacing.sm,
  },
  section: { gap: spacing.xs },
  sectionLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  pair: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
  },
  clear: { alignItems: 'center', paddingVertical: spacing.sm },
  banner: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summary: { fontSize: 12 },
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
