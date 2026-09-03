import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  BUILT_IN_CATEGORIES,
  UNCATEGORISED_ID,
  countsTowardStats,
  learnRuleFrom,
  type Category,
  type Transaction,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { Card } from '../../src/components/Card';
import { CategoryChip } from '../../src/components/CategoryChip';
import { listAccounts } from '../../src/db/accounts-repo';
import { saveRule } from '../../src/db/rules-repo';
import {
  deleteTransaction,
  getTransaction,
  newId,
  setCategory,
  setExcludedFromStats,
} from '../../src/db/transactions-repo';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { formatBookingDate } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';

/**
 * Every category the owner may pick, grouped so the row's own side of the
 * ledger comes first, then transfers, then the other side. "Uncategorised" is
 * not offered: choosing it by hand would only record indecision.
 */
function groupsFor(side: Transaction['side']): readonly (readonly Category[])[] {
  const selectable = BUILT_IN_CATEGORIES.filter((c) => !c.archived && c.id !== UNCATEGORISED_ID);
  return [
    selectable.filter((c) => c.kind === side),
    selectable.filter((c) => c.kind === 'transfer'),
    selectable.filter((c) => c.kind !== side && c.kind !== 'transfer'),
  ];
}

export default function TransactionDetailScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const label = useCategoryLabel();

  const [tx, setTx] = useState<Transaction | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [learn, setLearn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const row = await getTransaction(id);
      if (!row) {
        // Deleted elsewhere or a stale link: nothing to show, so leave.
        router.back();
        return;
      }
      setTx(row);
      setSelected(row.categoryId);
      const accounts = await listAccounts();
      setAccountName(accounts.find((a) => a.id === row.accountId)?.name ?? null);
    })().catch((cause: unknown) => setError((cause as Error).message));
  }, [id, router]);

  const groups = useMemo(() => (tx ? groupsFor(tx.side) : []), [tx]);
  const categoryChanged = tx !== null && selected !== null && selected !== tx.categoryId;
  // Offer the "learn a rule" switch only when this narrative can yield one.
  const canLearn =
    tx !== null && selected !== null && learnRuleFrom(tx, selected, () => 'probe') !== null;

  const save = async () => {
    if (!tx || !selected || !categoryChanged) return;
    setBusy(true);
    try {
      await setCategory(tx.id, selected);
      if (learn && canLearn) {
        const rule = learnRuleFrom(tx, selected, newId);
        if (rule) await saveRule(rule);
      }
      router.back();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  const toggleExcluded = async (excluded: boolean) => {
    if (!tx) return;
    setTx((current) => (current ? { ...current, excludedFromStats: excluded } : current));
    try {
      await setExcludedFromStats(tx.id, excluded);
    } catch (cause) {
      setTx((current) => (current ? { ...current, excludedFromStats: !excluded } : current));
      setError((cause as Error).message);
    }
  };

  const confirmDelete = () => {
    if (!tx) return;
    Alert.alert(t('common.delete'), t('transactions.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteTransaction(tx.id);
              router.back();
            } catch (cause) {
              setError((cause as Error).message);
            }
          })();
        },
      },
    ]);
  };

  if (!tx) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: t('transactions.detailTitle') }} />
        {error ? (
          <Text style={{ color: theme.expense }}>{error}</Text>
        ) : (
          <ActivityIndicator color={theme.accent} />
        )}
      </View>
    );
  }

  const excludedFromTotals = !countsTowardStats(tx);

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: t('transactions.detailTitle') }} />

      <Card>
        <Amount value={tx.amount} style={styles.amount} />
        <Text style={[styles.headline, { color: theme.text }]}>
          {tx.counterparty ?? tx.description}
        </Text>
        {tx.counterparty ? <Text style={{ color: theme.textMuted }}>{tx.description}</Text> : null}
        {excludedFromTotals ? (
          <Text style={[styles.tag, { color: theme.textMuted, borderColor: theme.border }]}>
            {tx.excludedFromStats ? t('transactions.excludedTag') : label(tx.categoryId)}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Field
          label={t('transactions.bookingDate')}
          value={formatBookingDate(tx.bookingDate, { dateStyle: 'long' })}
        />
        {tx.valueDate ? (
          <Field
            label={t('transactions.valueDate')}
            value={formatBookingDate(tx.valueDate, { dateStyle: 'long' })}
          />
        ) : null}
        {accountName ? <Field label={t('transactions.account')} value={accountName} /> : null}
        {tx.reference ? <Field label={t('transactions.reference')} value={tx.reference} /> : null}
        {tx.notes ? <Field label={t('transactions.notes')} value={tx.notes} /> : null}
        <Field
          label={t('transactions.category')}
          value={`${label(tx.categoryId)} · ${t(`transactions.categorySource.${tx.categorySource}`)}`}
        />
      </Card>

      <Card title={t('transactions.changeCategory')}>
        {groups.map((group, index) =>
          group.length > 0 ? (
            <View key={index} style={styles.chips}>
              {group.map((category) => (
                <CategoryChip
                  key={category.id}
                  category={category}
                  label={label(category.id)}
                  selected={selected === category.id}
                  onPress={() => setSelected(category.id)}
                />
              ))}
            </View>
          ) : null,
        )}
        {categoryChanged && canLearn ? (
          <SwitchRow
            label={t('transactions.applyToSimilar')}
            value={learn}
            onValueChange={setLearn}
          />
        ) : null}
        <Pressable
          onPress={() => void save()}
          disabled={!categoryChanged || busy}
          style={[
            styles.button,
            { backgroundColor: categoryChanged ? theme.accent : theme.surfaceAlt },
          ]}
        >
          <Text
            style={[styles.buttonText, { color: categoryChanged ? '#FFFFFF' : theme.textMuted }]}
          >
            {t('common.save')}
          </Text>
        </Pressable>
      </Card>

      <Card>
        <SwitchRow
          label={t('transactions.excludeFromStats')}
          value={tx.excludedFromStats}
          onValueChange={(value) => void toggleExcluded(value)}
        />
        <Pressable onPress={confirmDelete} disabled={busy} style={styles.deleteButton}>
          <Text style={{ color: theme.expense, fontWeight: '600' }}>{t('common.delete')}</Text>
        </Pressable>
      </Card>

      {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: theme.text }]} selectable>
        {value}
      </Text>
    </View>
  );
}

function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.switchRow}>
      <Text style={[styles.switchLabel, { color: theme.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: theme.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  amount: { fontSize: 32, fontWeight: '700' },
  headline: { fontSize: 17, fontWeight: '600' },
  tag: {
    alignSelf: 'flex-start',
    fontSize: 12,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  field: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  fieldLabel: { fontSize: 13 },
  fieldValue: { fontSize: 13, flexShrink: 1, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchLabel: { fontSize: 14, flexShrink: 1 },
  button: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  deleteButton: { alignItems: 'center', paddingVertical: spacing.sm },
});
