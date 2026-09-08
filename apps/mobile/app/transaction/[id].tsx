import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  PAYROLL_CATEGORY_ID,
  countsTowardStats,
  formatMoney,
  learnExclusionFrom,
  learnRuleFrom,
  shouldExclude,
  similarTo,
  type Category,
  type ExclusionRule,
  type Transaction,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { Card } from '../../src/components/Card';
import { CategoryChip } from '../../src/components/CategoryChip';
import { Button } from '../../src/components/ui/Button';
import { ListRow } from '../../src/components/ui/ListRow';
import { listAccounts } from '../../src/db/accounts-repo';
import {
  deleteExclusionRule,
  listExclusionRules,
  saveExclusionRule,
} from '../../src/db/exclusion-rules-repo';
import { saveRule } from '../../src/db/rules-repo';
import {
  deleteTransaction,
  getTransaction,
  listAllTransactions,
  newId,
  setCategory,
  setExcludedFromStats,
  setExcludedFromStatsBulk,
} from '../../src/db/transactions-repo';
import { useCategories } from '../../src/hooks/use-categories';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { formatBookingDate, intlLocale } from '../../src/i18n';
import { radius, spacing, type, useTheme } from '../../src/design';

/**
 * Every category the owner may pick, grouped so the row's own side of the
 * ledger comes first, then transfers, then the other side. `selectable` has
 * already dropped the hidden categories and "uncategorised", which is not
 * offered because choosing it by hand would only record indecision.
 *
 * A category the owner hid still labels the movements already filed under it;
 * it just stops being something new money can be filed into.
 */
function groupsFor(
  side: Transaction['side'],
  selectable: readonly Category[],
): readonly (readonly Category[])[] {
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
  const { selectable } = useCategories();

  const [tx, setTx] = useState<Transaction | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  /** The other half of a matched transfer, with the name of its account. */
  const [peer, setPeer] = useState<{ tx: Transaction; accountName: string | null } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [learn, setLearn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The whole ledger, only so the screen can say how many movements an
   * exclusion rule would affect before the owner commits to it. A personal
   * ledger is a few thousand rows; every other screen reads it the same way. */
  const [ledger, setLedger] = useState<readonly Transaction[]>([]);
  const [exclusionRules, setExclusionRules] = useState<readonly ExclusionRule[]>([]);
  /** What the last bulk exclusion did, shown under the switch that did it. */
  const [exclusionNote, setExclusionNote] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    // A screen that is left before its rows arrive must not receive them.
    let cancelled = false;
    (async () => {
      const row = await getTransaction(id);
      if (cancelled) return;
      if (!row) {
        // Deleted elsewhere or a stale link: nothing to show, so leave.
        router.back();
        return;
      }
      setTx(row);
      setSelected(row.categoryId);
      const accounts = await listAccounts();
      const nameOf = (accountId: string) => accounts.find((a) => a.id === accountId)?.name ?? null;
      const other = row.transferPeerId ? await getTransaction(row.transferPeerId) : null;
      const rules = await listExclusionRules();
      const all = await listAllTransactions();
      if (cancelled) return;
      setAccountName(nameOf(row.accountId));
      setPeer(other ? { tx: other, accountName: nameOf(other.accountId) } : null);
      setExclusionRules(rules);
      setLedger(all);
    })().catch((cause: unknown) => {
      if (!cancelled) setError((cause as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const groups = useMemo(() => (tx ? groupsFor(tx.side, selectable) : []), [tx, selectable]);
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

  /**
   * The learned rule that already covers this movement, if any. It is what
   * makes the bulk exclusion undoable: leaving it behind would re-exclude the
   * row on the next import, however many times the owner turns the switch off.
   */
  const coveringRule = useMemo(
    () =>
      exclusionRules.find((rule) => rule.learned && tx !== null && shouldExclude(tx, [rule])) ??
      null,
    [exclusionRules, tx],
  );
  /** The rule this movement would produce; null when its narrative has no
   * merchant identity worth generalising from. */
  const candidateRule = useMemo(() => (tx ? learnExclusionFrom(tx, () => 'probe') : null), [tx]);
  const similarCount = useMemo(() => {
    const rule = coveringRule ?? candidateRule;
    return rule ? similarTo(ledger, rule).length : 0;
  }, [coveringRule, candidateRule, ledger]);
  // Offered while the row is excluded and generalisable, and always while a
  // learned rule still covers it — that is the only place to take it back.
  const offerSimilar =
    coveringRule !== null || (tx?.excludedFromStats === true && candidateRule !== null);

  /**
   * Applies, or takes back, "exclude every movement like this one".
   *
   * Applying saves the rule first and then flags the movements already on
   * record: if the second half fails the promise about future imports still
   * holds, and the switch shows on so the owner can undo it. Taking it back
   * un-flags first and deletes the rule last, for the same reason in reverse.
   */
  const toggleSimilar = async (on: boolean) => {
    if (!tx || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (on) {
        const rule = learnExclusionFrom(tx, newId);
        if (!rule) return;
        await saveExclusionRule(rule);
        const ids = similarTo(ledger, rule).map((row) => row.id);
        // The ledger snapshot predates this screen's own toggle, so make sure
        // the movement in front of the owner is in the list either way.
        const changed = await setExcludedFromStatsBulk(
          ids.includes(tx.id) ? ids : [...ids, tx.id],
          true,
        );
        setExclusionRules((current) => [rule, ...current]);
        setTx((current) => (current ? { ...current, excludedFromStats: true } : current));
        setExclusionNote(t('transactions.excludeSimilarDone', { count: changed }));
      } else {
        const rule = coveringRule;
        if (!rule) return;
        const ids = similarTo(ledger, rule).map((row) => row.id);
        const changed = await setExcludedFromStatsBulk(
          ids.includes(tx.id) ? ids : [...ids, tx.id],
          false,
        );
        await deleteExclusionRule(rule.id);
        setExclusionRules((current) => current.filter((r) => r.id !== rule.id));
        setTx((current) => (current ? { ...current, excludedFromStats: false } : current));
        setExclusionNote(t('transactions.stopExcludingSimilarDone', { count: changed }));
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
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

      {/* The amount is the page. No card behind it. */}
      <View style={styles.hero}>
        <Amount value={tx.amount} size="display" />
        <Text style={[type.title, { color: theme.text }]}>{tx.counterparty ?? tx.description}</Text>
        {tx.counterparty ? (
          <Text style={[type.body, { color: theme.textMuted }]}>{tx.description}</Text>
        ) : null}
        {excludedFromTotals ? (
          <Text
            style={[
              type.label,
              styles.tag,
              { color: theme.textMuted, backgroundColor: theme.surfaceAlt },
            ]}
          >
            {tx.excludedFromStats ? t('transactions.excludedTag') : label(tx.categoryId)}
          </Text>
        ) : null}
        {peer ? (
          <Button
            label={t('transactions.transferMatched', {
              amount: formatMoney(peer.tx.amount, intlLocale()),
              account: peer.accountName ?? '',
              date: formatBookingDate(peer.tx.bookingDate, { day: 'numeric', month: 'short' }),
            })}
            variant="secondary"
            onPress={() =>
              router.push({ pathname: '/transaction/[id]', params: { id: peer.tx.id } })
            }
          />
        ) : null}
      </View>

      <Card>
        <DetailRow
          label={t('transactions.bookingDate')}
          value={formatBookingDate(tx.bookingDate, { dateStyle: 'long' })}
        />
        {tx.valueDate ? (
          <DetailRow
            label={t('transactions.valueDate')}
            value={formatBookingDate(tx.valueDate, { dateStyle: 'long' })}
          />
        ) : null}
        {accountName ? <DetailRow label={t('transactions.account')} value={accountName} /> : null}
        {tx.reference ? (
          <DetailRow label={t('transactions.reference')} value={tx.reference} />
        ) : null}
        {tx.notes ? <DetailRow label={t('transactions.notes')} value={tx.notes} /> : null}
        <DetailRow
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
        {selected === PAYROLL_CATEGORY_ID ? (
          <Text style={[type.label, { color: theme.textMuted }]}>
            {t('transactions.salaryHint')}
          </Text>
        ) : null}
        {categoryChanged && canLearn ? (
          <SwitchRow
            label={t('transactions.applyToSimilar')}
            value={learn}
            onValueChange={setLearn}
          />
        ) : null}
        <Button
          label={t('common.save')}
          disabled={!categoryChanged}
          loading={busy}
          onPress={() => void save()}
        />
      </Card>

      <Card>
        <SwitchRow
          label={t('transactions.excludeFromStats')}
          value={tx.excludedFromStats}
          onValueChange={(value) => void toggleExcluded(value)}
        />
        {offerSimilar ? (
          <SwitchRow
            label={t('transactions.excludeSimilar')}
            hint={t('transactions.excludeSimilarCount', { count: similarCount })}
            value={coveringRule !== null}
            disabled={busy}
            onValueChange={(value) => void toggleSimilar(value)}
          />
        ) : null}
        {exclusionNote ? (
          <Text style={[type.label, { color: theme.textMuted }]}>{exclusionNote}</Text>
        ) : null}
        <Button
          label={t('common.delete')}
          variant="danger"
          disabled={busy}
          onPress={confirmDelete}
        />
      </Card>

      {error ? <Text style={[type.body, { color: theme.expense }]}>{error}</Text> : null}
    </ScrollView>
  );
}

/**
 * A read-only label and value. Not a ListRow: a reference or a note can be
 * longer than one line and truncating it would hide the only copy of it the
 * owner has on screen.
 */
function DetailRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[type.label, styles.fieldValue, { color: theme.text }]} selectable>
        {value}
      </Text>
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  disabled,
  onValueChange,
}: {
  label: string;
  /** Second line under the label; used for "how many movements this covers". */
  hint?: string;
  value: boolean;
  disabled?: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <ListRow
      title={label}
      subtitle={hint}
      trailing={
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onValueChange}
          trackColor={{ true: theme.accent }}
        />
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  hero: { gap: spacing.sm, marginBottom: spacing.lg },
  tag: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  field: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  fieldValue: { flexShrink: 1, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
