import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
import { FormSheet, type SheetField } from '../../src/components/FormSheet';
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

/** A second (or fifth) account under a bank that already exists. */
interface AccountDraft {
  institutionId: string;
  institutionName: string;
  name: string;
  balanceText: string;
  dateText: string;
}

interface BalanceDraft {
  accountId: string;
  accountName: string;
  currency: string;
  balanceText: string;
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

/** The asserted-balance pair every one of these forms ends with. */
function anchorFields<T extends { balanceText: string; dateText: string }>(
  draft: T | null,
  patch: (change: Partial<T>) => void,
  labels: { balance: string; asOf: string },
): SheetField[] {
  return [
    {
      key: 'balance',
      label: labels.balance,
      value: draft?.balanceText ?? '',
      placeholder: '1.234,56',
      numeric: true,
      onChangeText: (balanceText) => patch({ balanceText } as Partial<T>),
    },
    {
      key: 'date',
      label: labels.asOf,
      value: draft?.dateText ?? '',
      placeholder: 'YYYY-MM-DD',
      autoCapitalize: 'none',
      onChangeText: (dateText) => patch({ dateText } as Partial<T>),
    },
  ];
}

export default function BanksScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { transactions, accounts, reload } = useAppData();
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);
  const [bankDraft, setBankDraft] = useState<BankDraft | null>(null);
  const [accountDraft, setAccountDraft] = useState<AccountDraft | null>(null);
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
  const anchorLabels = { balance: t('banks.balance'), asOf: t('banks.asOf') };

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

  // Every edit clears the error: a message about the field being retyped is
  // stale the moment the owner touches it.
  const patchBank = (change: Partial<BankDraft>) => {
    setFormError(null);
    setBankDraft((current) => (current ? { ...current, ...change } : current));
  };
  const patchAccount = (change: Partial<AccountDraft>) => {
    setFormError(null);
    setAccountDraft((current) => (current ? { ...current, ...change } : current));
  };
  const patchBalance = (change: Partial<BalanceDraft>) => {
    setFormError(null);
    setBalanceDraft((current) => (current ? { ...current, ...change } : current));
  };

  const openNewBank = () => {
    setFormError(null);
    setBankDraft({ id: null, name: '', balanceText: '', dateText: today });
  };

  const openBankEdit = (institution: InstitutionRow) => {
    setFormError(null);
    setBankDraft({ id: institution.id, name: institution.name, balanceText: '', dateText: today });
  };

  const openNewAccount = (institution: InstitutionRow) => {
    setFormError(null);
    setAccountDraft({
      institutionId: institution.id,
      institutionName: institution.name,
      name: '',
      balanceText: '',
      dateText: today,
    });
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
      balanceText: view.balance ? toDecimalString(view.balance) : '',
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

  /**
   * The amount and date every new account is anchored on. Returns null and
   * sets the form error when either is unusable, so the caller stops.
   */
  const readAnchor = (amountText: string, dateText: string, currency = CURRENCY) => {
    const asserted = parseAmount(amountText, currency);
    if (!asserted) {
      setFormError(t('banks.invalidAmount'));
      return null;
    }
    const date = dateText.trim();
    if (!isValidISODate(date)) {
      setFormError(t('banks.invalidDate'));
      return null;
    }
    return { asserted, date };
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
      const anchor = readAnchor(bankDraft.balanceText, bankDraft.dateText);
      if (!anchor) return;
      const institutionId = await createInstitution({ name });
      const accountId = await createAccount({
        name,
        currency: CURRENCY,
        provider: 'file-import',
        institutionId,
        institutionName: name,
      });
      await assertBalance(accountId, anchor.asserted, anchor.date);
    }

    setBankDraft(null);
    await Promise.all([reload(), loadInstitutions()]);
  };

  const commitAccount = async () => {
    if (!accountDraft) return;
    const name = accountDraft.name.trim();
    if (name === '') {
      setFormError(t('banks.accountNameRequired'));
      return;
    }
    const anchor = readAnchor(accountDraft.balanceText, accountDraft.dateText);
    if (!anchor) return;

    const accountId = await createAccount({
      name,
      currency: CURRENCY,
      provider: 'file-import',
      institutionId: accountDraft.institutionId,
      institutionName: accountDraft.institutionName,
    });
    await assertBalance(accountId, anchor.asserted, anchor.date);

    setAccountDraft(null);
    await reload();
  };

  const commitBalance = async () => {
    if (!balanceDraft) return;
    const anchor = readAnchor(
      balanceDraft.balanceText,
      balanceDraft.dateText,
      balanceDraft.currency,
    );
    if (!anchor) return;
    await assertBalance(balanceDraft.accountId, anchor.asserted, anchor.date);
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

            <Pressable
              onPress={() => openNewAccount(bank.institution)}
              accessibilityRole="button"
              style={[styles.addAccount, { borderTopColor: theme.border }]}
            >
              <Text style={[styles.meta, { color: theme.accent }]}>{t('banks.addAccount')}</Text>
            </Pressable>
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

      <FormSheet
        visible={bankDraft !== null}
        title={bankDraft?.id ? t('banks.edit') : t('banks.add')}
        fields={[
          {
            key: 'name',
            label: t('banks.name'),
            value: bankDraft?.name ?? '',
            placeholder: 'ING',
            autoCapitalize: 'words',
            onChangeText: (name) => patchBank({ name }),
          },
          // A rename touches no balance: the bank's first account was anchored
          // when it was created, and every account has had its own anchor since.
          ...(bankDraft?.id ? [] : anchorFields(bankDraft, patchBank, anchorLabels)),
        ]}
        error={formError}
        onCancel={() => setBankDraft(null)}
        onSave={() => void commitBank()}
        onDelete={
          bankDraft?.id
            ? () => {
                const institution = institutions.find((i) => i.id === bankDraft.id);
                if (institution) confirmDelete(institution);
              }
            : undefined
        }
      />

      <FormSheet
        visible={accountDraft !== null}
        title={t('banks.addAccount')}
        subtitle={accountDraft?.institutionName}
        fields={[
          {
            key: 'name',
            label: t('banks.accountName'),
            value: accountDraft?.name ?? '',
            placeholder: t('banks.accountNamePlaceholder'),
            autoCapitalize: 'words',
            onChangeText: (name) => patchAccount({ name }),
          },
          ...anchorFields(accountDraft, patchAccount, anchorLabels),
        ]}
        error={formError}
        onCancel={() => setAccountDraft(null)}
        onSave={() => void commitAccount()}
      />

      <FormSheet
        visible={balanceDraft !== null}
        title={t('banks.updateBalance')}
        subtitle={balanceDraft?.accountName}
        fields={anchorFields(balanceDraft, patchBalance, anchorLabels)}
        error={formError}
        onCancel={() => setBalanceDraft(null)}
        onSave={() => void commitBalance()}
      />
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
  addAccount: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  unassigned: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  addButton: { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  addButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
