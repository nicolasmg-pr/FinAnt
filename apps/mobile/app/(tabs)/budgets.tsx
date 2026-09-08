import { useCallback, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  abs,
  budgetPeriod,
  formatMoney,
  parseDecimal,
  toDecimalString,
  type Budget,
  type BudgetProgress,
  type Money,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { BudgetBar } from '../../src/components/BudgetBar';
import { Card } from '../../src/components/Card';
import { CategoryChip } from '../../src/components/CategoryChip';
import { Button } from '../../src/components/ui/Button';
import { Field } from '../../src/components/ui/Field';
import { Sheet } from '../../src/components/ui/Sheet';
import { deleteBudget, listBudgets, saveBudget } from '../../src/db/budgets-repo';
import { useAppData } from '../../src/hooks/use-app-data';
import { useCategories } from '../../src/hooks/use-categories';
import { usePayPeriod } from '../../src/hooks/use-pay-period';
import { intlLocale } from '../../src/i18n';
import { radius, spacing, type, typeMoney, useTheme } from '../../src/design';

const CURRENCY = 'EUR';

interface Draft {
  categoryId: string | null;
  limitText: string;
  /** An existing budget is edited in place; a new one still has to pick a category. */
  existing: boolean;
}

export default function BudgetsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { transactions, loading, reload } = useAppData();
  const { byId: categoryById, selectable } = useCategories();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadBudgets = useCallback(async () => {
    setBudgets(await listBudgets());
  }, []);

  // Re-read on focus: an import on another screen moves the spend.
  useFocusEffect(
    useCallback(() => {
      void reload();
      void loadBudgets();
    }, [reload, loadBudgets]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const { period, title: periodTitle } = usePayPeriod(transactions, today);
  const progress = useMemo(
    () => budgetPeriod(transactions, budgets, period, CURRENCY),
    [transactions, budgets, period],
  );

  const budgeted = new Set(budgets.map((b) => b.categoryId));
  // A limit belongs on a spending decision, so only expense categories are
  // offered. `selectable` has already dropped the hidden ones and the
  // uncategorised bucket, whose limit would track the state of the
  // classification rather than anything the owner chose to spend.
  const available = selectable.filter((c) => c.kind === 'expense' && !budgeted.has(c.id));

  const label = (categoryId: string): string => {
    const category = categoryById.get(categoryId);
    return category?.labelKey ? t(category.labelKey) : (category?.name ?? categoryId);
  };

  const openNew = () => {
    setFormError(null);
    setDraft({ categoryId: null, limitText: '', existing: false });
  };

  const openExisting = (entry: BudgetProgress) => {
    setFormError(null);
    setDraft({
      categoryId: entry.categoryId,
      // Pre-filled as a plain decimal string: no currency symbol to delete
      // before typing, and no float on the way in or out.
      limitText: toDecimalString(entry.limit),
      existing: true,
    });
  };

  const commit = async () => {
    if (!draft?.categoryId) return;
    let limit;
    try {
      limit = parseDecimal(draft.limitText, CURRENCY);
    } catch {
      setFormError(t('budgets.invalidLimit'));
      return;
    }
    if (limit.minor <= 0) {
      setFormError(t('budgets.invalidLimit'));
      return;
    }
    await saveBudget({ categoryId: draft.categoryId, monthlyLimit: limit });
    setDraft(null);
    await loadBudgets();
  };

  const confirmDelete = (categoryId: string) => {
    Alert.alert(t('budgets.deleteConfirm', { category: label(categoryId) }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteBudget(categoryId);
            setDraft(null);
            await loadBudgets();
          })();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={[styles.screen, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={[type.title, styles.screenTitle, { color: theme.text }]}>
          {t('budgets.title')}
        </Text>

        {progress.categories.length === 0 ? (
          <Card>
            <Text style={[type.body, { color: theme.textMuted }]}>{t('budgets.noBudgets')}</Text>
          </Card>
        ) : (
          <>
            <Card title={t('budgets.allBudgets')} subtitle={periodTitle}>
              <Text style={[typeMoney.body, { color: theme.textMuted }]}>
                {t('budgets.spentOfLimit', {
                  spent: formatMoney(progress.totalSpent, intlLocale()),
                  limit: formatMoney(progress.totalLimit, intlLocale()),
                })}
              </Text>
              <Remainder amount={progress.totalRemaining} />
              {progress.unbudgetedSpent.minor !== 0 ? (
                <View style={styles.row}>
                  <Text
                    style={[type.body, styles.grow, { color: theme.textMuted }]}
                    numberOfLines={1}
                  >
                    {t('budgets.unbudgeted')}
                  </Text>
                  <Amount value={progress.unbudgetedSpent} tone="neutral" size="label" />
                </View>
              ) : null}
            </Card>

            {progress.categories.map((entry) => (
              <Card key={entry.categoryId} padded={false} onPress={() => openExisting(entry)}>
                <View style={styles.budgetBody}>
                  <View style={styles.row}>
                    <Text
                      style={[type.heading, styles.grow, { color: theme.text }]}
                      numberOfLines={1}
                    >
                      {label(entry.categoryId)}
                    </Text>
                    <Text style={[typeMoney.label, { color: theme.textMuted }]}>
                      {t('budgets.spentOfLimit', {
                        spent: formatMoney(entry.spent, intlLocale()),
                        limit: formatMoney(entry.limit, intlLocale()),
                      })}
                    </Text>
                  </View>
                  <Remainder amount={entry.remaining} />
                </View>
                {/* Flush to the card's bottom edge: the bar is the card's
                    status, not one more line inside it. */}
                <View style={styles.budgetBar}>
                  <BudgetBar
                    ratio={entry.ratio}
                    state={entry.state}
                    color={categoryById.get(entry.categoryId)?.color}
                  />
                </View>
              </Card>
            ))}
          </>
        )}

        {available.length === 0 ? (
          <Text style={[type.label, styles.hint, { color: theme.textMuted }]}>
            {t('budgets.allCategoriesBudgeted')}
          </Text>
        ) : (
          <Button label={t('budgets.add')} icon="plus" disabled={loading} onPress={openNew} />
        )}
      </ScrollView>

      <Sheet
        visible={draft !== null}
        onDismiss={() => setDraft(null)}
        title={draft?.existing ? t('budgets.edit') : t('budgets.add')}
      >
        {draft?.existing && draft.categoryId ? (
          <Text style={[type.body, { color: theme.textMuted }]}>{label(draft.categoryId)}</Text>
        ) : (
          <>
            <Text style={[type.body, { color: theme.textMuted }]}>
              {t('budgets.chooseCategory')}
            </Text>
            <View style={styles.chips}>
              {available.map((category) => (
                <CategoryChip
                  key={category.id}
                  category={category}
                  label={label(category.id)}
                  selected={draft?.categoryId === category.id}
                  onPress={() =>
                    setDraft((current) =>
                      current ? { ...current, categoryId: category.id } : current,
                    )
                  }
                />
              ))}
            </View>
          </>
        )}

        <Field
          label={t('budgets.monthlyLimit')}
          value={draft?.limitText ?? ''}
          onChangeText={(text) => {
            setFormError(null);
            setDraft((current) => (current ? { ...current, limitText: text } : current));
          }}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="0.00"
          error={formError ?? undefined}
        />

        <View style={styles.sheetActions}>
          <Button label={t('common.cancel')} variant="secondary" onPress={() => setDraft(null)} />
          {draft?.existing && draft.categoryId ? (
            <Button
              label={t('common.delete')}
              variant="danger"
              onPress={() => draft.categoryId && confirmDelete(draft.categoryId)}
            />
          ) : null}
          <Button
            label={t('common.save')}
            disabled={!draft?.categoryId}
            onPress={() => void commit()}
          />
        </View>
      </Sheet>
    </View>
  );
}

/** "€120 left" or "€20 over", never a negative "left". */
function Remainder({ amount }: { amount: Money }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const over = amount.minor < 0;
  const text = t(over ? 'budgets.overBy' : 'budgets.remaining', {
    amount: formatMoney(abs(amount), intlLocale()),
  });
  return (
    <Text style={[type.label, { color: over ? theme.expense : theme.textMuted }]}>{text}</Text>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  screenTitle: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  grow: { flexShrink: 1 },
  budgetBody: { padding: spacing.lg, gap: spacing.sm },
  // The track's own corners are square; the card clips them to its radius.
  budgetBar: {
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    overflow: 'hidden',
  },
  hint: { textAlign: 'center', marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
