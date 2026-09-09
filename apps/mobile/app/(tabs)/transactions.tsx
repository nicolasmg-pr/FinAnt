import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { FlatList, StyleSheet, Text, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Link, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
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
  usedCategoryIds,
  type Category,
  type DateRangePreset,
  type Money,
  type Transaction,
  type TransactionFilter,
} from '@finant/core';
import { parseAmount } from '@finant/importers';
import { Amount } from '../../src/components/Amount';
import { Chip } from '../../src/components/Chip';
import { Button } from '../../src/components/ui/Button';
import { Empty } from '../../src/components/ui/Empty';
import { Field } from '../../src/components/ui/Field';
import { ListRow } from '../../src/components/ui/ListRow';
import { SectionHeader } from '../../src/components/ui/SectionHeader';
import { Sheet } from '../../src/components/ui/Sheet';
import { Touchable } from '../../src/components/ui/Touchable';
import type { AccountRow } from '../../src/db/accounts-repo';
import { useAppData } from '../../src/hooks/use-app-data';
import { useCategories } from '../../src/hooks/use-categories';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { formatBookingDate, intlLocale } from '../../src/i18n';
import { radius, rampColorFor, spacing, type, useTheme } from '../../src/design';

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
  const insets = useSafeAreaInsets();
  const { transactions, accounts, loading, reload } = useAppData();
  const { list: categories, byId: categoryById } = useCategories();
  const [filter, setFilter] = useState<TransactionFilter>(EMPTY_FILTER);
  const [panelOpen, setPanelOpen] = useState(false);

  // The bank view opens this screen narrowed to one bank's accounts. `at`
  // changes on every push so asking for the same accounts twice re-applies the
  // filter instead of looking broken after the owner cleared it.
  const params = useLocalSearchParams<{ accountIds?: string; at?: string }>();
  const requestedAccounts = typeof params.accountIds === 'string' ? params.accountIds : '';
  const requestedAt = typeof params.at === 'string' ? params.at : '';
  useEffect(() => {
    if (requestedAccounts === '') return;
    setFilter((current) => ({
      ...current,
      accountIds: requestedAccounts.split(',').filter((id) => id !== ''),
    }));
    // Opened, so the narrowing is visible and reversible rather than a mystery.
    setPanelOpen(true);
  }, [requestedAccounts, requestedAt]);

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
  const categoryIds = useMemo(
    () => usedCategoryIds(transactions, categories),
    [transactions, categories],
  );

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
        contentContainerStyle={[styles.list, { paddingTop: insets.top + spacing.lg }]}
        ListHeaderComponent={
          <ListHeader
            filter={filter}
            setFilter={setFilter}
            onOpenFilters={() => setPanelOpen(true)}
            activeCount={activeCount}
            resultCount={visible.length}
            net={net}
            uncategorisedCount={uncategorisedCount}
            onShowUncategorised={showUncategorised}
          />
        }
        ListEmptyComponent={
          <Empty
            message={activeCount > 0 ? t('transactions.filters.noMatch') : t('transactions.empty')}
          />
        }
        renderItem={({ item, index }) => (
          <Row
            transaction={item}
            accountName={accountNames?.get(item.accountId) ?? null}
            category={item.categoryId ? (categoryById.get(item.categoryId) ?? null) : null}
            divider={index < visible.length - 1}
          />
        )}
      />

      <FilterSheet
        visible={panelOpen}
        onDismiss={() => setPanelOpen(false)}
        filter={filter}
        setFilter={setFilter}
        activeCount={activeCount}
        accounts={accounts}
        categoryIds={categoryIds}
      />
    </View>
  );
}

interface HeaderProps {
  filter: TransactionFilter;
  setFilter: (update: (current: TransactionFilter) => TransactionFilter) => void;
  onOpenFilters: () => void;
  activeCount: number;
  resultCount: number;
  net: Money | null;
  uncategorisedCount: number;
  onShowUncategorised: () => void;
}

/**
 * Title, search field and result summary. The filters themselves live in a
 * sheet now; this header only opens it.
 *
 * Declared at module level rather than inline so the list header keeps the same
 * component type across renders: an inline one is remounted on every keystroke
 * and the search field loses focus after the first character.
 */
function ListHeader({
  filter,
  setFilter,
  onOpenFilters,
  activeCount,
  resultCount,
  net,
  uncategorisedCount,
  onShowUncategorised,
}: HeaderProps) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={[type.title, { color: theme.text }]}>{t('nav.transactions')}</Text>
        {/* Was the navigator's headerRight; the header is gone, the action is
            not. */}
        <Link href="/movement/new" asChild>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={t('transactions.addManual')}
            hitSlop={12}
            // expo-router's Link clones this child and refuses an array
            // style, so the two layers are flattened before they reach it.
            style={StyleSheet.flatten([styles.add, { backgroundColor: theme.accentSoft }])}
          >
            <Feather name="plus" color={theme.accent} size={20} />
          </Touchable>
        </Link>
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.search, { backgroundColor: theme.surfaceSunken }]}>
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
            style={[type.body, styles.searchInput, { color: theme.text }]}
          />
          {filter.text !== '' ? (
            <Touchable
              onPress={() => setFilter((current) => ({ ...current, text: '' }))}
              accessibilityRole="button"
              accessibilityLabel={t('common.cancel')}
            >
              <Feather name="x" size={16} color={theme.textMuted} />
            </Touchable>
          ) : null}
        </View>

        <Touchable
          onPress={onOpenFilters}
          accessibilityRole="button"
          accessibilityLabel={t('transactions.filters.show')}
          style={[
            styles.filterButton,
            { backgroundColor: activeCount > 0 ? theme.accentSoft : theme.surfaceSunken },
          ]}
        >
          <Feather name="sliders" size={18} color={activeCount > 0 ? theme.accent : theme.text} />
          {activeCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: theme.accent }]}>
              <Text style={[type.caption, { color: theme.onAccent }]}>{activeCount}</Text>
            </View>
          ) : null}
        </Touchable>
      </View>

      {uncategorisedCount > 0 && !filter.categoryIds.includes(UNCATEGORISED_ID) ? (
        <Touchable
          onPress={onShowUncategorised}
          accessibilityRole="button"
          style={[styles.banner, { backgroundColor: theme.accentSoft }]}
        >
          <Text style={[type.body, { color: theme.accent }]}>
            {t('transactions.uncategorisedBanner', { count: uncategorisedCount })}
          </Text>
        </Touchable>
      ) : null}

      <Text style={[type.caption, { color: theme.textMuted }]}>
        {t('transactions.filters.results', { count: resultCount })}
        {net
          ? ` · ${t('transactions.filters.net', { amount: formatMoney(net, intlLocale()) })}`
          : ''}
      </Text>
    </View>
  );
}

/**
 * Every filter, in a sheet. It was an inline panel that pushed the list down
 * the screen while it was open; the filters are a detour from reading the
 * list, not part of it.
 *
 * The four typed bounds keep their own text. A half-typed date is not a filter
 * yet, and a preset chip has to be able to rewrite what the date fields show —
 * neither works if the input is driven straight off the filter.
 */
function FilterSheet({
  visible,
  onDismiss,
  filter,
  setFilter,
  activeCount,
  accounts,
  categoryIds,
}: {
  visible: boolean;
  onDismiss: () => void;
  filter: TransactionFilter;
  setFilter: (update: (current: TransactionFilter) => TransactionFilter) => void;
  activeCount: number;
  accounts: readonly AccountRow[];
  categoryIds: readonly string[];
}) {
  const { t } = useTranslation();
  const label = useCategoryLabel();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const preset = presetOf(filter, today);

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

  return (
    <Sheet visible={visible} onDismiss={onDismiss} title={t('transactions.filters.show')}>
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
        <View style={styles.half}>
          <Field
            label={t('transactions.filters.from')}
            value={fromText}
            onChangeText={(value) => {
              setFromText(value);
              if (isValidISODate(value) || value === '') {
                setFilter((current) => ({ ...current, from: value === '' ? null : value }));
              }
            }}
            placeholder={t('transactions.filters.datePlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.half}>
          <Field
            label={t('transactions.filters.to')}
            value={toText}
            onChangeText={(value) => {
              setToText(value);
              if (isValidISODate(value) || value === '') {
                setFilter((current) => ({ ...current, to: value === '' ? null : value }));
              }
            }}
            placeholder={t('transactions.filters.datePlaceholder')}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
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

      <View style={styles.pair}>
        <View style={styles.half}>
          <Field
            label={t('transactions.filters.amount')}
            value={minText}
            onChangeText={(value) => {
              setMinText(value);
              setFilter((current) => ({
                ...current,
                minMinor: parseAmount(value, 'EUR', 'auto')?.minor ?? null,
              }));
            }}
            placeholder={t('transactions.filters.amountPlaceholder')}
            inputMode="decimal"
          />
        </View>
        <View style={styles.half}>
          <Field
            label={t('transactions.filters.to')}
            value={maxText}
            onChangeText={(value) => {
              setMaxText(value);
              setFilter((current) => ({
                ...current,
                maxMinor: parseAmount(value, 'EUR', 'auto')?.minor ?? null,
              }));
            }}
            placeholder={t('transactions.filters.amountPlaceholder')}
            inputMode="decimal"
          />
        </View>
      </View>

      <View style={styles.sheetActions}>
        {activeCount > 0 ? (
          <Button label={t('transactions.filters.clear')} variant="secondary" onPress={clearAll} />
        ) : null}
        <Button label={t('common.done')} onPress={onDismiss} />
      </View>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionHeader label={label} />
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Row({
  transaction,
  accountName,
  category,
  divider,
}: {
  transaction: Transaction;
  accountName: string | null;
  /** Passed in rather than looked up per row: the list renders hundreds of
   * these and they all read the same category set. */
  category: Category | null;
  divider: boolean;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const label = useCategoryLabel();
  // A row outside the statistics (excluded by hand, or an internal transfer)
  // stays visible but reads as dimmed, so the list still matches the bank.
  const counted = countsTowardStats(transaction);
  const date = formatBookingDate(transaction.bookingDate, { day: '2-digit', month: 'short' });
  const meta = [date, label(transaction.categoryId)];
  if (transaction.excludedFromStats) meta.push(t('transactions.excludedTag'));
  if (accountName) meta.push(accountName);

  return (
    <View style={{ opacity: counted ? 1 : 0.55 }}>
      <ListRow
        title={transaction.counterparty ?? transaction.description}
        subtitle={meta.join(' · ')}
        leading={
          <View
            style={[
              styles.dot,
              { backgroundColor: category?.color ?? rampColorFor(transaction.categoryId ?? '') },
            ]}
          />
        }
        trailing={
          <View style={styles.trailingStack}>
            {transaction.provisional ? (
              <Chip
                label={t('notifications.provisional')}
                selected={false}
                onPress={() =>
                  router.push({ pathname: '/transaction/[id]', params: { id: transaction.id } })
                }
              />
            ) : null}
            <Amount value={transaction.amount} />
          </View>
        }
        divider={divider}
        onPress={() =>
          router.push({ pathname: '/transaction/[id]', params: { id: transaction.id } })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, marginBottom: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  add: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  searchInput: { flex: 1, paddingVertical: spacing.md },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  banner: { padding: spacing.md, borderRadius: radius.md },
  list: { padding: spacing.lg },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  trailingStack: { alignItems: 'flex-end', gap: spacing.xs },
});
