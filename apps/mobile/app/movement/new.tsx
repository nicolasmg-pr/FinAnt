import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  UNCATEGORISED_ID,
  accountChoiceNeedsName,
  importHashOf,
  isValidISODate,
  resolveAccountChoice,
  signedAmountFor,
  type AccountChoice,
  type Category,
  type TransactionSide,
} from '@finant/core';
import { parseAmount } from '@finant/importers';
import type { DraftTransaction } from '@finant/importers';
import { AccountPicker } from '../../src/components/AccountPicker';
import { Card } from '../../src/components/Card';
import { CategoryChip } from '../../src/components/CategoryChip';
import { Chip } from '../../src/components/Chip';
import {
  createAccount,
  getOrCreateLocalAccount,
  listAccounts,
  type AccountRow,
} from '../../src/db/accounts-repo';
import {
  createInstitution,
  listInstitutions,
  type InstitutionRow,
} from '../../src/db/institutions-repo';
import { readSetting, SETTING_LAST_IMPORT_ACCOUNT } from '../../src/db/settings-repo';
import { newId } from '../../src/db/transactions-repo';
import { useCategories } from '../../src/hooks/use-categories';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { ingest } from '../../src/services/ingest';
import { radius, spacing, useTheme } from '../../src/theme';

const SIDES: readonly TransactionSide[] = ['expense', 'income'];

/**
 * Categories offered for a side, the chosen side first and transfers next, the
 * same order the movement detail screen uses. "Uncategorised" is not offered:
 * picking it by hand would only record indecision, and it is what a movement
 * gets anyway when no rule matches.
 */
function groupsFor(
  side: TransactionSide,
  selectable: readonly Category[],
): readonly (readonly Category[])[] {
  const offered = selectable.filter((category) => category.id !== UNCATEGORISED_ID);
  return [
    offered.filter((category) => category.kind === side),
    offered.filter((category) => category.kind === 'transfer'),
    offered.filter((category) => category.kind !== side && category.kind !== 'transfer'),
  ];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Adding a movement by hand.
 *
 * It goes in through `ingest()`, the same door a statement uses, so a manual
 * row is categorised by the same rules, matched against the same transfers and
 * filtered by the same exclusion rules as an imported one. Nothing here writes
 * to `transactions` directly.
 */
export default function NewMovementScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const label = useCategoryLabel();
  const { selectable } = useCategories();

  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [choice, setChoice] = useState<AccountChoice | null>(null);

  const [side, setSide] = useState<TransactionSide>('expense');
  const [reversal, setReversal] = useState(false);
  const [dateText, setDateText] = useState(today);
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // "My records" must exist before any account can be offered, the same
      // guarantee the import screen relies on.
      const localId = await getOrCreateLocalAccount();
      const [known, banks, lastUsed] = await Promise.all([
        listAccounts(),
        listInstitutions(),
        readSetting(SETTING_LAST_IMPORT_ACCOUNT),
      ]);
      if (cancelled) return;
      setAccounts(known);
      setInstitutions(banks);
      setChoice(
        resolveAccountChoice({
          accounts: known.map((account) => ({
            id: account.id,
            name: account.name,
            institutionId: account.institution_id,
          })),
          institutionIds: banks.map((bank) => bank.id),
          candidateIds: [lastUsed, localId],
          suggestedName: '',
        }),
      );
    })().catch((cause: unknown) => {
      if (!cancelled) setError((cause as Error).message);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups = useMemo(() => groupsFor(side, selectable), [side, selectable]);
  const amount = useMemo(() => parseAmount(amountText, 'EUR', 'auto'), [amountText]);
  const dateValid = isValidISODate(dateText);
  const needsName = choice !== null && accountChoiceNeedsName(choice);
  const complete =
    choice !== null &&
    !needsName &&
    dateValid &&
    amount !== null &&
    amount.minor !== 0 &&
    description.trim() !== '';

  const save = async () => {
    if (!complete || !choice || !amount || busy) return;
    setBusy(true);
    setError(null);
    try {
      let current = choice;
      let banks = institutions;
      if (current.newInstitution) {
        // Returns the bank already carrying that name if there is one, so a
        // retry after a failed save cannot leave a second bank behind.
        const institutionId = await createInstitution({ name: current.institutionName.trim() });
        current = { ...current, institutionId, newInstitution: false };
        banks = await listInstitutions();
        setChoice(current);
        setInstitutions(banks);
      }
      if (current.newAccount) {
        await createAccount({
          id: current.accountId,
          name: current.accountName.trim(),
          currency: amount.currency,
          provider: 'manual',
          institutionId: current.institutionId,
          institutionName: banks.find((bank) => bank.id === current.institutionId)?.name ?? null,
        });
        current = { ...current, newAccount: false };
        setChoice(current);
        setAccounts(await listAccounts());
      }

      const signed = signedAmountFor(side, amount, reversal);
      const text = description.trim();
      const draft: DraftTransaction = {
        accountId: current.accountId,
        bookingDate: dateText,
        valueDate: null,
        amount: signed,
        side,
        description: text,
        counterparty: counterparty.trim() || null,
        reference: null,
        // A category chosen here is the owner's own classification and is
        // trusted over the rule engine, exactly as a category that came with a
        // file is; leaving it unset lets the rules decide.
        suggestedCategoryId: categoryId,
        source: 'manual',
        externalId: null,
        // Two identical coffees on the same day are two movements. A manual
        // entry is a deliberate act, so it gets a discriminator no other row
        // can repeat rather than being swallowed as a duplicate of the first.
        importHash: importHashOf({
          accountId: current.accountId,
          bookingDate: dateText,
          amountMinor: signed.minor,
          description: text,
          discriminator: newId(),
        }),
        notes: notes.trim() || null,
      };

      await ingest([draft]);
      router.back();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('transactions.addManual') }} />

      <Card>
        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
          {t('transactions.filters.direction')}
        </Text>
        <View style={styles.chips}>
          {SIDES.map((option) => (
            <Chip
              key={option}
              label={t(`transactions.filters.side.${option}`)}
              selected={side === option}
              onPress={() => {
                setSide(option);
                // A category picked for the other side would sit in the
                // "everything else" group and read as a mistake.
                setCategoryId(null);
              }}
            />
          ))}
        </View>

        {/* The one control that makes a positive amount on the expense side
            reachable: a refund reduces the month's spending rather than
            inflating its income. */}
        <View style={styles.switchRow}>
          <Text style={[styles.switchLabel, { color: theme.text }]}>
            {side === 'expense' ? t('manual.isRefund') : t('manual.isClawback')}
          </Text>
          <Switch value={reversal} onValueChange={setReversal} trackColor={{ true: theme.accent }} />
        </View>

        <Field label={t('transactions.bookingDate')}>
          <TextInput
            value={dateText}
            onChangeText={setDateText}
            placeholder={t('transactions.filters.datePlaceholder')}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={inputStyle}
          />
          {dateText !== '' && !dateValid ? (
            <Text style={{ color: theme.warning, fontSize: 12 }}>{t('manual.dateInvalid')}</Text>
          ) : null}
        </Field>

        <Field label={t('transactions.filters.amount')}>
          <TextInput
            value={amountText}
            onChangeText={setAmountText}
            placeholder={t('transactions.filters.amountPlaceholder')}
            placeholderTextColor={theme.textMuted}
            inputMode="decimal"
            style={inputStyle}
          />
        </Field>

        <Field label={t('transactions.description')}>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t('manual.descriptionPlaceholder')}
            placeholderTextColor={theme.textMuted}
            style={inputStyle}
          />
        </Field>

        <Field label={t('transactions.counterparty')}>
          <TextInput
            value={counterparty}
            onChangeText={setCounterparty}
            placeholder={t('manual.counterpartyPlaceholder')}
            placeholderTextColor={theme.textMuted}
            style={inputStyle}
          />
        </Field>

        <Field label={t('transactions.notes')}>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholderTextColor={theme.textMuted}
            style={inputStyle}
          />
        </Field>
      </Card>

      <Card title={t('transactions.account')}>
        {choice ? (
          <AccountPicker
            institutions={institutions}
            accounts={accounts}
            value={choice}
            onChange={setChoice}
          />
        ) : null}
      </Card>

      <Card title={t('transactions.category')}>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t('manual.categoryOptional')}</Text>
        {groups.map((group, index) =>
          group.length > 0 ? (
            <View key={index} style={styles.chips}>
              {group.map((category) => (
                <CategoryChip
                  key={category.id}
                  category={category}
                  label={label(category.id)}
                  selected={categoryId === category.id}
                  onPress={() =>
                    setCategoryId((current) => (current === category.id ? null : category.id))
                  }
                />
              ))}
            </View>
          ) : null,
        )}
      </Card>

      {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}

      <Pressable
        onPress={() => void save()}
        disabled={!complete || busy}
        accessibilityRole="button"
        style={[
          styles.button,
          { backgroundColor: complete && !busy ? theme.accent : theme.surfaceAlt },
        ]}
      >
        <Text
          style={[styles.buttonText, { color: complete && !busy ? '#FFFFFF' : theme.textMuted }]}
        >
          {t('common.save')}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 15,
  },
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
});
