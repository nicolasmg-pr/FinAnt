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
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  add,
  balanceAsOf,
  deriveOpeningBalance,
  formatMoney,
  isValidISODate,
  money,
  reconcileAnchor,
  toDecimalString,
  type Money,
  type Transaction,
} from '@finant/core';
import { parseAmount } from '@finant/importers';
import { Amount } from '../../src/components/Amount';
import { Card } from '../../src/components/Card';
import { Chip } from '../../src/components/Chip';
import {
  createAccount,
  setAccountBalance,
  setAccountInstitution,
  type AccountRow,
} from '../../src/db/accounts-repo';
import {
  createInstitution,
  deleteInstitution,
  listInstitutions,
  renameInstitution,
  type InstitutionRow,
} from '../../src/db/institutions-repo';
import { useAppData } from '../../src/hooks/use-app-data';
import { intlLocale } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';

const CURRENCY = 'EUR';

interface AccountView {
  readonly row: AccountRow;
  readonly movementCount: number;
  /** Balance today, or null when no balance was ever asserted for the account. */
  readonly balance: Money | null;
  /** Non-zero when movements behind the anchor date arrived after it was set. */
  readonly driftMinor: number;
}

/** Bank name, its accounts, and the sum of the balances they state. */
interface BankView {
  readonly institution: InstitutionRow;
  readonly accounts: readonly AccountView[];
  readonly total: Money | null;
  readonly movementCount: number;
}

/** New bank when `id` is null (name plus a first balance), rename when it is set. */
interface BankDraft {
  id: string | null;
  name: string;
  balanceText: string;
  dateText: string;
}

interface BalanceDraft {
  accountId: string;
  accountName: string;
  currency: string;
  amountText: string;
  dateText: string;
}

function accountView(
  row: AccountRow,
  movements: readonly Transaction[],
  today: string,
): AccountView {
  const base = { row, movementCount: movements.length };
  const asserted = row.balance_minor;
  const asOf = row.balance_date;
  const opening = row.opening_balance_minor;
  if (asserted === null || asOf === null || opening === null) {
    return { ...base, balance: null, driftMinor: 0 };
  }
  try {
    const anchor = {
      assertedMinor: asserted,
      asOf,
      openingMinor: opening,
      currency: row.currency,
    };
    return {
      ...base,
      balance: balanceAsOf(movements, opening, today, row.currency),
      driftMinor: reconcileAnchor(movements, anchor).driftMinor,
    };
  } catch {
    // A movement in another currency: core refuses to sum it, and a balance we
    // cannot state honestly is better left blank than guessed.
    return { ...base, balance: null, driftMinor: 0 };
  }
}

/** Sum of the balances that are known. Null when none is, or when two currencies meet. */
function totalOf(views: readonly AccountView[]): Money | null {
  let total: Money | null = null;
  for (const view of views) {
    if (!view.balance) continue;
    if (!total) {
      total = view.balance;
      continue;
    }
    if (total.currency !== view.balance.currency) return null;
    total = add(total, view.balance);
  }
  return total;
}

export default function BanksScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { transactions, accounts, reload } = useAppData();
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);
  const [bankDraft, setBankDraft] = useState<BankDraft | null>(null);
  const [balanceDraft, setBalanceDraft] = useState<BalanceDraft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const loadInstitutions = useCallback(async () => {
    setInstitutions(await listInstitutions());
  }, []);

  // Re-read on focus: an import on another screen moves every balance.
  useFocusEffect(
    useCallback(() => {
      void reload();
      void loadInstitutions();
    }, [reload, loadInstitutions]),
  );

  const today = new Date().toISOString().slice(0, 10);

  const movementsByAccount = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const bucket = map.get(tx.accountId) ?? [];
      bucket.push(tx);
      map.set(tx.accountId, bucket);
    }
    return map;
  }, [transactions]);

  const views = useMemo(
    () => accounts.map((row) => accountView(row, movementsByAccount.get(row.id) ?? [], today)),
    [accounts, movementsByAccount, today],
  );

  const banks: BankView[] = institutions.map((institution) => {
    const own = views.filter((view) => view.row.institution_id === institution.id);
    return {
      institution,
      accounts: own,
      total: totalOf(own),
      movementCount: own.reduce((count, view) => count + view.movementCount, 0),
    };
  });

  // An account pointing at a bank that no longer exists belongs here too, not
  // into a heading nobody can see.
  const known = new Set(institutions.map((institution) => institution.id));
  const unassigned = views.filter(
    (view) => view.row.institution_id === null || !known.has(view.row.institution_id),
  );

  const openNewBank = () => {
    setFormError(null);
    setBankDraft({ id: null, name: '', balanceText: '', dateText: today });
  };

  const openBankEdit = (institution: InstitutionRow) => {
    setFormError(null);
    setBankDraft({ id: institution.id, name: institution.name, balanceText: '', dateText: today });
  };

  /**
   * Opens the movements list narrowed to these accounts. `at` changes on every
   * push, so the list re-applies the filter even when the same bank is opened
   * twice — expo-router would otherwise hand it identical params and the screen
   * would look like it ignored the tap.
   */
  const openMovements = (accountIds: readonly string[]) => {
    if (accountIds.length === 0) return;
    router.push({
      pathname: '/transactions',
      params: { accountIds: accountIds.join(','), at: String(Date.now()) },
    });
  };

  const openBalance = (view: AccountView) => {
    setFormError(null);
    setBalanceDraft({
      accountId: view.row.id,
      accountName: view.row.name,
      currency: view.row.currency,
      // Prefilled as a plain decimal string, so re-asserting an unchanged
      // balance is one tap and no float is involved either way.
      amountText: view.balance ? toDecimalString(view.balance) : '',
      dateText: today,
    });
  };

  /** Stores the owner's claim and the opening balance it implies. */
  const assertBalance = async (accountId: string, asserted: Money, date: string) => {
    const movements = movementsByAccount.get(accountId) ?? [];
    const opening = deriveOpeningBalance(movements, asserted.minor, date, asserted.currency);
    await setAccountBalance(accountId, {
      assertedMinor: asserted.minor,
      balanceDate: date,
      openingMinor: opening.minor,
    });
  };

  const commitBank = async () => {
    if (!bankDraft) return;
    const name = bankDraft.name.trim();
    if (name === '') {
      setFormError(t('banks.nameRequired'));
      return;
    }

    if (bankDraft.id) {
      await renameInstitution(bankDraft.id, name);
    } else {
      const asserted = parseAmount(bankDraft.balanceText, CURRENCY);
      if (!asserted) {
        setFormError(t('banks.invalidAmount'));
        return;
      }
      const date = bankDraft.dateText.trim();
      if (!isValidISODate(date)) {
        setFormError(t('banks.invalidDate'));
        return;
      }
      const institutionId = await createInstitution({ name });
      const accountId = await createAccount({
        name,
        currency: CURRENCY,
        provider: 'file-import',
        institutionId,
        institutionName: name,
      });
      await assertBalance(accountId, asserted, date);
    }

    setBankDraft(null);
    await Promise.all([reload(), loadInstitutions()]);
  };

  const commitBalance = async () => {
    if (!balanceDraft) return;
    const asserted = parseAmount(balanceDraft.amountText, balanceDraft.currency);
    if (!asserted) {
      setFormError(t('banks.invalidAmount'));
      return;
    }
    const date = balanceDraft.dateText.trim();
    if (!isValidISODate(date)) {
      setFormError(t('banks.invalidDate'));
      return;
    }
    await assertBalance(balanceDraft.accountId, asserted, date);
    setBalanceDraft(null);
    await reload();
  };

  const move = async (accountId: string, institutionId: string) => {
    await setAccountInstitution(accountId, institutionId);
    await reload();
  };

  const confirmDelete = (institution: InstitutionRow) => {
    Alert.alert(t('banks.deleteConfirm', { name: institution.name }), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteInstitution(institution.id);
            setBankDraft(null);
            await Promise.all([reload(), loadInstitutions()]);
          })();
        },
      },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={styles.screen}>
        {banks.length === 0 && unassigned.length === 0 ? (
          <Card title={t('banks.title')}>
            <Text style={{ color: theme.textMuted }}>{t('banks.empty')}</Text>
          </Card>
        ) : null}

        {banks.map((bank) => (
          <Card key={bank.institution.id}>
            <Pressable onPress={() => openBankEdit(bank.institution)}>
              <View style={styles.row}>
                <Text style={[styles.bankName, { color: theme.text }]} numberOfLines={1}>
                  {bank.institution.name}
                </Text>
                {bank.total ? (
                  <Amount value={bank.total} tone="neutral" style={styles.bankValue} />
                ) : (
                  <Text style={{ color: theme.textMuted }}>{t('banks.noBalance')}</Text>
                )}
              </View>
              <Text style={[styles.meta, { color: theme.textMuted }]}>
                {t('banks.accounts', { count: bank.accounts.length })} ·{' '}
                {t('banks.movements', { count: bank.movementCount })}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => openMovements(bank.accounts.map((view) => view.row.id))}
              accessibilityRole="button"
            >
              <Text style={[styles.meta, { color: theme.accent }]}>{t('banks.viewMovements')}</Text>
            </Pressable>

            {bank.accounts.map((view) => (
              <AccountLine
                key={view.row.id}
                view={view}
                onAssert={() => openBalance(view)}
                onOpenMovements={() => openMovements([view.row.id])}
              />
            ))}
          </Card>
        ))}

        {unassigned.length > 0 ? (
          <Card title={t('banks.unassigned')}>
            {unassigned.map((view) => (
              <View key={view.row.id} style={styles.unassigned}>
                <AccountLine
                  view={view}
                  onAssert={() => openBalance(view)}
                  onOpenMovements={() => openMovements([view.row.id])}
                />
                {institutions.length > 0 ? (
                  <>
                    <Text style={[styles.meta, { color: theme.textMuted }]}>
                      {t('banks.moveToBank')}
                    </Text>
                    <View style={styles.chips}>
                      {institutions.map((institution) => (
                        <Chip
                          key={institution.id}
                          label={institution.name}
                          selected={false}
                          onPress={() => void move(view.row.id, institution.id)}
                        />
                      ))}
                    </View>
                  </>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}

        <Pressable
          onPress={openNewBank}
          style={[styles.addButton, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.addButtonText}>{t('banks.add')}</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={bankDraft !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setBankDraft(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View
            style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              {bankDraft?.id ? t('banks.edit') : t('banks.add')}
            </Text>

            <Text style={{ color: theme.textMuted }}>{t('banks.name')}</Text>
            <TextInput
              value={bankDraft?.name ?? ''}
              onChangeText={(text) => {
                setFormError(null);
                setBankDraft((current) => (current ? { ...current, name: text } : current));
              }}
              autoCapitalize="words"
              placeholder="ING"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
              ]}
            />

            {bankDraft?.id ? null : (
              <>
                <Text style={{ color: theme.textMuted }}>{t('banks.balance')}</Text>
                <TextInput
                  value={bankDraft?.balanceText ?? ''}
                  onChangeText={(text) => {
                    setFormError(null);
                    setBankDraft((current) =>
                      current ? { ...current, balanceText: text } : current,
                    );
                  }}
                  keyboardType="numbers-and-punctuation"
                  inputMode="text"
                  placeholder="1.234,56"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      borderColor: theme.border,
                      backgroundColor: theme.surfaceAlt,
                    },
                  ]}
                />

                <Text style={{ color: theme.textMuted }}>{t('banks.asOf')}</Text>
                <TextInput
                  value={bankDraft?.dateText ?? ''}
                  onChangeText={(text) => {
                    setFormError(null);
                    setBankDraft((current) => (current ? { ...current, dateText: text } : current));
                  }}
                  autoCapitalize="none"
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={theme.textMuted}
                  style={[
                    styles.input,
                    {
                      color: theme.text,
                      borderColor: theme.border,
                      backgroundColor: theme.surfaceAlt,
                    },
                  ]}
                />
              </>
            )}

            {formError ? <Text style={{ color: theme.expense }}>{formError}</Text> : null}

            <View style={styles.sheetActions}>
              <Pressable onPress={() => setBankDraft(null)} style={styles.sheetAction}>
                <Text style={{ color: theme.textMuted }}>{t('common.cancel')}</Text>
              </Pressable>
              {bankDraft?.id ? (
                <Pressable
                  onPress={() => {
                    const institution = institutions.find((i) => i.id === bankDraft.id);
                    if (institution) confirmDelete(institution);
                  }}
                  style={styles.sheetAction}
                >
                  <Text style={{ color: theme.expense }}>{t('common.delete')}</Text>
                </Pressable>
              ) : null}
              <Pressable onPress={() => void commitBank()} style={styles.sheetAction}>
                <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={balanceDraft !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setBalanceDraft(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View
            style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              {t('banks.updateBalance')}
            </Text>
            <Text style={{ color: theme.textMuted }}>{balanceDraft?.accountName}</Text>

            <Text style={{ color: theme.textMuted }}>{t('banks.balance')}</Text>
            <TextInput
              value={balanceDraft?.amountText ?? ''}
              onChangeText={(text) => {
                setFormError(null);
                setBalanceDraft((current) =>
                  current ? { ...current, amountText: text } : current,
                );
              }}
              keyboardType="numbers-and-punctuation"
              inputMode="text"
              placeholder="1.234,56"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
              ]}
            />

            <Text style={{ color: theme.textMuted }}>{t('banks.asOf')}</Text>
            <TextInput
              value={balanceDraft?.dateText ?? ''}
              onChangeText={(text) => {
                setFormError(null);
                setBalanceDraft((current) => (current ? { ...current, dateText: text } : current));
              }}
              autoCapitalize="none"
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
              ]}
            />

            {formError ? <Text style={{ color: theme.expense }}>{formError}</Text> : null}

            <View style={styles.sheetActions}>
              <Pressable onPress={() => setBalanceDraft(null)} style={styles.sheetAction}>
                <Text style={{ color: theme.textMuted }}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={() => void commitBalance()} style={styles.sheetAction}>
                <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * One account under its bank: what it holds, how many movements it owns, and a
 * warning when the balance the owner asserted no longer matches the history.
 */
function AccountLine({
  view,
  onAssert,
  onOpenMovements,
}: {
  view: AccountView;
  onAssert: () => void;
  onOpenMovements: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  // The drift is the negation of what arrived behind the anchor, so this is the
  // total of the movements that turned up after the balance was asserted.
  const arrived = money(-view.driftMinor, view.row.currency);

  return (
    <View style={[styles.account, { borderTopColor: theme.border }]}>
      <Pressable onPress={onOpenMovements} accessibilityRole="button">
        <View style={styles.row}>
          <Text style={[styles.accountName, { color: theme.text }]} numberOfLines={1}>
            {view.row.name}
          </Text>
          {view.balance ? (
            <Amount value={view.balance} tone="neutral" style={styles.accountValue} />
          ) : (
            <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t('banks.noBalance')}</Text>
          )}
        </View>
      </Pressable>

      <Text style={[styles.meta, { color: theme.textMuted }]}>
        {t('banks.movements', { count: view.movementCount })}
        {view.row.balance_date ? ` · ${t('banks.balanceOn', { date: view.row.balance_date })}` : ''}
      </Text>

      {view.driftMinor !== 0 && view.row.balance_date ? (
        <>
          <Text style={[styles.meta, { color: theme.warning }]}>
            {t('banks.drift', {
              amount: formatMoney(arrived, intlLocale()),
              date: view.row.balance_date,
            })}
          </Text>
          <Pressable onPress={onAssert}>
            <Text style={[styles.meta, { color: theme.accent }]}>{t('banks.reanchor')}</Text>
          </Pressable>
        </>
      ) : (
        <Pressable onPress={onAssert}>
          <Text style={[styles.meta, { color: theme.accent }]}>{t('banks.updateBalance')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  bankName: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  bankValue: { fontSize: 16, fontWeight: '700' },
  meta: { fontSize: 13 },
  account: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    gap: 2,
  },
  accountName: { fontSize: 15, flexShrink: 1 },
  accountValue: { fontSize: 15 },
  unassigned: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
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
