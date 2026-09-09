import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  UNCATEGORISED_ID,
  accountChoiceNeedsName,
  importHashOf,
  isValidISODate,
  money,
  resolveAccountChoice,
  signedAmountFor,
  toDecimalString,
  type AccountChoice,
  type Category,
  type TransactionSide,
} from '@finant/core';
import { parseAmount } from '@finant/importers';
import type { DraftTransaction } from '@finant/importers';
import { AccountPicker } from '../../src/components/AccountPicker';
import { Button } from '../../src/components/ui/Button';
import { Field } from '../../src/components/ui/Field';
import { ListRow } from '../../src/components/ui/ListRow';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Card } from '../../src/components/Card';
import { CategoryChip } from '../../src/components/CategoryChip';
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
import { acceptEditedCapture } from '../../src/notifications/capture-service';
import { ingest } from '../../src/services/ingest';
import { spacing, type, useTheme } from '../../src/design';

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
 * Prefill carried from the notification inbox's "Edit first": the owner opens
 * this same form instead of accepting the parse as-is, for the odd capture
 * whose account or wording needs a correction before it becomes a movement.
 * Absent for the ordinary "add a movement" entry point, where every field
 * below keeps its plain default.
 *
 * `captureId` and `captureHash` travel together: saving with a `captureId`
 * present settles that capture through `acceptEditedCapture` instead of the
 * plain `ingest()` a from-scratch entry goes through, so the capture is never
 * left pending forever, nor accepted a second time from the inbox afterwards.
 */
type CaptureParams = {
  captureId?: string;
  captureHash?: string;
  side?: string;
  amountMinor?: string;
  currency?: string;
  description?: string;
  counterparty?: string;
  bookingDate?: string;
};

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
  const params = useLocalSearchParams<CaptureParams>();

  // Read once, as plain state initialisers: a param only ever seeds the form
  // the screen opened with, and must never fight the owner's own edits on a
  // re-render.
  const prefillAmountMinor =
    typeof params.amountMinor === 'string' ? Number(params.amountMinor) : NaN;
  const hasPrefill = Number.isSafeInteger(prefillAmountMinor);
  const prefillSide: TransactionSide = params.side === 'income' ? 'income' : 'expense';
  const prefillCurrency = typeof params.currency === 'string' ? params.currency : 'EUR';
  const captureId = typeof params.captureId === 'string' ? params.captureId : null;
  const captureHash = typeof params.captureHash === 'string' ? params.captureHash : null;

  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [choice, setChoice] = useState<AccountChoice | null>(null);

  const [side, setSide] = useState<TransactionSide>(hasPrefill ? prefillSide : 'expense');
  const [reversal, setReversal] = useState(() =>
    hasPrefill
      ? prefillSide === 'expense'
        ? prefillAmountMinor > 0
        : prefillAmountMinor < 0
      : false,
  );
  const [dateText, setDateText] = useState(() =>
    typeof params.bookingDate === 'string' && isValidISODate(params.bookingDate)
      ? params.bookingDate
      : today(),
  );
  const [amountText, setAmountText] = useState(() =>
    hasPrefill ? toDecimalString(money(Math.abs(prefillAmountMinor), prefillCurrency)) : '',
  );
  const [description, setDescription] = useState(
    typeof params.description === 'string' ? params.description : '',
  );
  const [counterparty, setCounterparty] = useState(
    typeof params.counterparty === 'string' ? params.counterparty : '',
  );
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
        // Where the movement came from, not who typed it: editing the amount
        // on the way through does not change that a push notification is
        // where this one originated. Manual classification is a separate
        // axis, already recorded by `categorySource` above.
        source: captureId === null ? 'manual' : 'notification',
        // Push text never carries a bank transaction id, edited or not.
        externalId: null,
        // Two identical coffees on the same day are two movements, so a
        // from-scratch entry gets a discriminator no other row can repeat.
        // Editing a capture keeps that capture's own hash instead: it is the
        // same notification `acceptCapture` would otherwise have used to
        // build this exact hash, so an edit that changes nothing lands the
        // identical row a plain accept would have, and a repost of the same
        // notification still cannot land twice.
        importHash: importHashOf({
          accountId: current.accountId,
          bookingDate: dateText,
          amountMinor: signed.minor,
          description: text,
          discriminator: captureHash ?? newId(),
        }),
        notes: notes.trim() || null,
      };

      // A row born from a notification is provisional until a statement
      // books it, whether the owner accepted the parse as-is or corrected it
      // here first — editing what a notification said is not the bank
      // booking it. `acceptEditedCapture` also settles the capture itself, so
      // it cannot be accepted a second time from the inbox.
      if (captureId) {
        await acceptEditedCapture(captureId, draft);
      } else {
        await ingest([draft]);
      }
      router.back();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('transactions.addManual') }} />

      <Card>
        <SegmentedControl
          options={SIDES.map((option) => ({
            value: option,
            label: t(`transactions.filters.side.${option}`),
          }))}
          value={side}
          onChange={(option) => {
            setSide(option);
            // A category picked for the other side would sit in the
            // "everything else" group and read as a mistake.
            setCategoryId(null);
          }}
        />

        {/* The one control that makes a positive amount on the expense side
            reachable: a refund reduces the month's spending rather than
            inflating its income. */}
        <ListRow
          title={side === 'expense' ? t('manual.isRefund') : t('manual.isClawback')}
          trailing={
            <Switch
              value={reversal}
              onValueChange={setReversal}
              trackColor={{ true: theme.accent }}
            />
          }
        />

        <Field
          label={t('transactions.bookingDate')}
          value={dateText}
          onChangeText={setDateText}
          placeholder={t('transactions.filters.datePlaceholder')}
          autoCapitalize="none"
          autoCorrect={false}
          error={dateText !== '' && !dateValid ? t('manual.dateInvalid') : undefined}
        />

        <Field
          label={t('transactions.filters.amount')}
          value={amountText}
          onChangeText={setAmountText}
          placeholder={t('transactions.filters.amountPlaceholder')}
          inputMode="decimal"
        />

        <Field
          label={t('transactions.description')}
          value={description}
          onChangeText={setDescription}
          placeholder={t('manual.descriptionPlaceholder')}
        />

        <Field
          label={t('transactions.counterparty')}
          value={counterparty}
          onChangeText={setCounterparty}
          placeholder={t('manual.counterpartyPlaceholder')}
        />

        <Field label={t('transactions.notes')} value={notes} onChangeText={setNotes} />
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
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {t('manual.categoryOptional')}
        </Text>
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

      {error ? <Text style={[type.body, { color: theme.expense }]}>{error}</Text> : null}

      <Button
        label={t('common.save')}
        size="lg"
        disabled={!complete}
        loading={busy}
        onPress={() => void save()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
