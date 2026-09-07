import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
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
import { deleteBudget, listBudgets, saveBudget } from '../../src/db/budgets-repo';
import { useAppData } from '../../src/hooks/use-app-data';
import { useCategories } from '../../src/hooks/use-categories';
import { usePayPeriod } from '../../src/hooks/use-pay-period';
import { intlLocale } from '../../src/i18n';
import { radius, spacing, typeMoney, useTheme } from '../../src/design';

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
      <ScrollView contentContainerStyle={styles.screen}>
        {progress.categories.length === 0 ? (
          <Card title={t('budgets.title')}>
            <Text style={{ color: theme.textMuted }}>{t('budgets.noBudgets')}</Text>
          </Card>
        ) : (
          <>
            <Card title={t('budgets.allBudgets')} subtitle={periodTitle}>
              <Text style={{ color: theme.textMuted }}>
                {t('budgets.spentOfLimit', {
                  spent: formatMoney(progress.totalSpent, intlLocale()),
                  limit: formatMoney(progress.totalLimit, intlLocale()),
                })}
              </Text>
              <Remainder amount={progress.totalRemaining} />
              {progress.unbudgetedSpent.minor !== 0 ? (
                <View style={styles.row}>
                  <Text style={[styles.rowLabel, { color: theme.textMuted }]} numberOfLines={1}>
                    {t('budgets.unbudgeted')}
                  </Text>
                  <Amount value={progress.unbudgetedSpent} tone="neutral" size="label" />
                </View>
              ) : null}
            </Card>

            {progress.categories.map((entry) => (
              <Pressable key={entry.categoryId} onPress={() => openExisting(entry)}>
                <Card>
                  <View style={styles.row}>
                    <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>
                      {label(entry.categoryId)}
                    </Text>
                    <Text style={[typeMoney.label, { color: theme.textMuted }]}>
                      {t('budgets.spentOfLimit', {
                        spent: formatMoney(entry.spent, intlLocale()),
                        limit: formatMoney(entry.limit, intlLocale()),
                      })}
                    </Text>
                  </View>
                  <BudgetBar
                    ratio={entry.ratio}
                    state={entry.state}
                    color={categoryById.get(entry.categoryId)?.color}
                  />
                  <Remainder amount={entry.remaining} />
                </Card>
              </Pressable>
            ))}
          </>
        )}

        {available.length === 0 ? (
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            {t('budgets.allCategoriesBudgeted')}
          </Text>
        ) : (
          <Pressable
            onPress={openNew}
            disabled={loading}
            style={[styles.addButton, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.addButtonText}>{t('budgets.add')}</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal
        visible={draft !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDraft(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View
            style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              {draft?.existing ? t('budgets.edit') : t('budgets.add')}
            </Text>

            {draft?.existing && draft.categoryId ? (
              <Text style={{ color: theme.textMuted }}>{label(draft.categoryId)}</Text>
            ) : (
              <>
                <Text style={{ color: theme.textMuted }}>{t('budgets.chooseCategory')}</Text>
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

            <Text style={{ color: theme.textMuted }}>{t('budgets.monthlyLimit')}</Text>
            <TextInput
              value={draft?.limitText ?? ''}
              onChangeText={(text) => {
                setFormError(null);
                setDraft((current) => (current ? { ...current, limitText: text } : current));
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="0.00"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
              ]}
            />
            {formError ? <Text style={{ color: theme.expense }}>{formError}</Text> : null}

            <View style={styles.sheetActions}>
              <Pressable onPress={() => setDraft(null)} style={styles.sheetAction}>
                <Text style={{ color: theme.textMuted }}>{t('common.cancel')}</Text>
              </Pressable>
              {draft?.existing && draft.categoryId ? (
                <Pressable
                  onPress={() => draft.categoryId && confirmDelete(draft.categoryId)}
                  style={styles.sheetAction}
                >
                  <Text style={{ color: theme.expense }}>{t('common.delete')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void commit()}
                disabled={!draft?.categoryId}
                style={styles.sheetAction}
              >
                <Text
                  style={{
                    color: draft?.categoryId ? theme.accent : theme.textMuted,
                    fontWeight: '600',
                  }}
                >
                  {t('common.save')}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    <Text style={{ color: over ? theme.expense : theme.textMuted, fontSize: 13 }}>{text}</Text>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  rowLabel: { fontSize: 15, fontWeight: '500', flexShrink: 1 },
  hint: { fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  addButton: { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  addButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  sheetAction: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
});
