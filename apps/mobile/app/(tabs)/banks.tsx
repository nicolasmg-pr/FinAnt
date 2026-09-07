import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  add,
  balanceAt,
  formatMoney,
  isValidISODate,
  openingBalance,
  toDecimalString,
  type BalanceAnchor,
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
  deleteAccountWithMovements,
  renameAccount,
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
  /**
   * What the account held before its first movement, derived backwards from
   * the assertion. Null until both a balance and some history exist. This is
   * the figure that makes the imported statements add up.
   */
  readonly opening: Money | null;
  /** The day the first movement was booked, for labelling `opening`. */
  readonly firstMovement: string | null;
}

/** Bank name, its accounts, and the sum of the balances they state. */
interface BankView {
  readonly institution: InstitutionRow;
  readonly accounts: readonly AccountView[];
  readonly total: Money | null;
  readonly movementCount: number;
}

/** New bank when `id` is null, rename when it is set. A bank holds nothing else. */
interface BankDraft {
  id: string | null;
  name: string;
}

/**
 * An account being created (`id` null) or edited. The same three fields either
 * way: what it is called, what it holds, and the day that is true of.
 */
interface AccountDraft {
  id: string | null;
  institutionId: string;
  institutionName: string;
  name: string;
  balanceText: string;
  dateText: string;
  currency: string;
  /** Named in the delete confirmation, and what makes that delete irreversible. */
  movementCount: number;
}

function accountView(
  row: AccountRow,
  movements: readonly Transaction[],
  today: string,
): AccountView {
  const base = { row, movementCount: movements.length };
  const blank = { ...base, balance: null, opening: null, firstMovement: null };
  const asserted = row.balance_minor;
  const asOf = row.balance_date;
  if (asserted === null || asOf === null) return blank;

  const anchor: BalanceAnchor = { assertedMinor: asserted, asOf, currency: row.currency };
  const booked = movements.filter((tx) => tx.bookingDate <= asOf);
  const first = booked.reduce<string | null>(
    (min, tx) => (min === null || tx.bookingDate < min ? tx.bookingDate : min),
    null,
  );
  try {
    return {
      ...base,
      balance: balanceAt(movements, anchor, today),
      opening: first === null ? null : openingBalance(movements, anchor),
      firstMovement: first,
    };
  } catch {
    // A movement in another currency: core refuses to sum it, and a balance we
    // cannot state honestly is better left blank than guessed.
    return blank;
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
  const openNewBank = () => {
    setFormError(null);
    setBankDraft({ id: null, name: '' });
  };

  const openBankEdit = (institution: InstitutionRow) => {
    setFormError(null);
    setBankDraft({ id: institution.id, name: institution.name });
  };

  const openNewAccount = (institution: InstitutionRow) => {
    setFormError(null);
    setAccountDraft({
      id: null,
      institutionId: institution.id,
      institutionName: institution.name,
      name: '',
      balanceText: '',
      dateText: today,
      currency: CURRENCY,
      movementCount: 0,
    });
  };

  const openAccountEdit = (view: AccountView, institutionName: string) => {
    setFormError(null);
    setAccountDraft({
      id: view.row.id,
      institutionId: view.row.institution_id ?? '',
      institutionName,
      name: view.row.name,
      // Prefilled as a plain decimal string, so re-asserting an unchanged
      // balance is one tap and no float is involved either way.
      balanceText: view.balance ? toDecimalString(view.balance) : '',
      dateText: today,
      currency: view.row.currency,
      movementCount: view.movementCount,
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

  /**
   * Stores the owner's claim, and nothing derived from it. What the account
   * held earlier is worked out from this whenever it is asked for, so a
   * statement imported later cannot argue with the figure they typed.
   */
  const assertBalance = async (accountId: string, asserted: Money, date: string) => {
    await setAccountBalance(accountId, {
      assertedMinor: asserted.minor,
      balanceDate: date,
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

    // A new bank holds no account and states no balance. Both belong to the
    // accounts the owner puts in it, which is the only place a balance can
    // honestly live: that is where the movements are.
    if (bankDraft.id) await renameInstitution(bankDraft.id, name);
    else await createInstitution({ name });

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
    const anchor = readAnchor(
      accountDraft.balanceText,
      accountDraft.dateText,
      accountDraft.currency,
    );
    if (!anchor) return;

    // The id survives a rename: every import hash of every movement is built
    // on it, so changing it would orphan the account's whole history.
    const accountId =
      accountDraft.id ??
      (await createAccount({
        name,
        currency: accountDraft.currency,
        provider: 'file-import',
        institutionId: accountDraft.institutionId,
        institutionName: accountDraft.institutionName,
      }));
    if (accountDraft.id) await renameAccount(accountDraft.id, name);
    await assertBalance(accountId, anchor.asserted, anchor.date);

    setAccountDraft(null);
    await reload();
  };

  /** The one irreversible action here: the movements go with the account. */
  const confirmDeleteAccount = (draft: AccountDraft) => {
    const accountId = draft.id;
    if (!accountId) return;
    Alert.alert(
      t('banks.deleteAccountConfirm', { name: draft.name }),
      t('banks.deleteAccountMovements', { count: draft.movementCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteAccountWithMovements(accountId);
              setAccountDraft(null);
              await reload();
            })();
          },
        },
      ],
    );
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
                  <Amount value={bank.total} tone="neutral" size="heading" />
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

            {bank.accounts.length === 0 ? (
              <Text style={[styles.meta, { color: theme.textMuted }]}>{t('banks.noAccounts')}</Text>
            ) : (
              bank.accounts.map((view) => (
                <AccountLine
                  key={view.row.id}
                  view={view}
                  onEdit={() => openAccountEdit(view, bank.institution.name)}
                  onOpenMovements={() => openMovements([view.row.id])}
                />
              ))
            )}

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
                  onEdit={() => openAccountEdit(view, '')}
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
        title={accountDraft?.id ? t('banks.editAccount') : t('banks.addAccount')}
        subtitle={accountDraft?.institutionName || undefined}
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
        onDelete={accountDraft?.id ? () => confirmDeleteAccount(accountDraft) : undefined}
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
  onEdit,
  onOpenMovements,
}: {
  view: AccountView;
  onEdit: () => void;
  onOpenMovements: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.account, { borderTopColor: theme.border }]}>
      <Pressable onPress={onEdit} accessibilityRole="button">
        <View style={styles.row}>
          <Text style={[styles.accountName, { color: theme.text }]} numberOfLines={1}>
            {view.row.name}
          </Text>
          {view.balance ? (
            <Amount value={view.balance} tone="neutral" />
          ) : (
            <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t('banks.noBalance')}</Text>
          )}
        </View>
      </Pressable>

      <Text style={[styles.meta, { color: theme.textMuted }]}>
        {t('banks.movements', { count: view.movementCount })}
        {view.row.balance_date ? ` · ${t('banks.balanceOn', { date: view.row.balance_date })}` : ''}
      </Text>

      {view.opening && view.firstMovement ? (
        <Text style={[styles.meta, { color: theme.textMuted }]}>
          {t('banks.openingOn', {
            amount: formatMoney(view.opening, intlLocale()),
            date: view.firstMovement,
          })}
        </Text>
      ) : null}

      <View style={styles.accountLinks}>
        <Pressable onPress={onEdit} accessibilityRole="button">
          <Text style={[styles.meta, { color: theme.accent }]}>{t('banks.editAccount')}</Text>
        </Pressable>
        {view.movementCount > 0 ? (
          <Pressable onPress={onOpenMovements} accessibilityRole="button">
            <Text style={[styles.meta, { color: theme.accent }]}>{t('banks.viewMovements')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  bankName: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  meta: { fontSize: 13 },
  account: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
    gap: 2,
  },
  accountName: { fontSize: 15, flexShrink: 1 },
  accountLinks: { flexDirection: 'row', gap: spacing.lg, marginTop: 2 },
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
