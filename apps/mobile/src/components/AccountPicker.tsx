import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  accountsInBank,
  chooseAccount,
  chooseBank,
  chooseNewAccount,
  type AccountChoice,
} from '@finant/core';
import { newId } from '../db/transactions-repo';
import type { AccountRow } from '../db/accounts-repo';
import type { InstitutionRow } from '../db/institutions-repo';
import { Chip } from './Chip';
import { radius, spacing, useTheme } from '../theme';

/**
 * Bank first, then the account inside it.
 *
 * A bank groups accounts, so a flat list of accounts hides which bank each one
 * belongs to as soon as there is more than a handful. Either level can be
 * created here, but nothing is written: the component only reports what the
 * screen has to create when the owner confirms, and the account id in the
 * choice is already final — the import screen hashes its rows for it.
 *
 * Held by the caller (`value` / `onChange`) rather than internally, because the
 * import screen has to re-parse the file whenever the account changes and has
 * to flip `newAccount` off once it has created the account, so that a retry
 * after a failed ingest does not create a second one.
 */
export function AccountPicker({
  institutions,
  accounts,
  value,
  onChange,
}: {
  /** Every bank on record; the accounts of the chosen one make up the second row. */
  institutions: readonly InstitutionRow[];
  /** Every account on record, of every bank and of none. */
  accounts: readonly AccountRow[];
  value: AccountChoice;
  onChange: (choice: AccountChoice) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  // `institution_id` is a plain column: an account can still point at a bank
  // that was deleted. Such an account belongs under "not in a bank", the same
  // place the banks screen lists it.
  const known = new Set(institutions.map((institution) => institution.id));
  const choosable = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    institutionId:
      account.institution_id !== null && known.has(account.institution_id)
        ? account.institution_id
        : null,
  }));
  const inBank = accountsInBank(choosable, value);
  const inputStyle = [
    styles.input,
    { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
  ];

  return (
    <View style={styles.picker}>
      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t('import.bank')}</Text>
      <View style={styles.chips}>
        {institutions.map((institution) => (
          <Chip
            key={institution.id}
            label={institution.name}
            selected={!value.newInstitution && value.institutionId === institution.id}
            onPress={() =>
              onChange(
                chooseBank(
                  value,
                  { institutionId: institution.id, isNew: false },
                  choosable,
                  newId,
                ),
              )
            }
          />
        ))}
        <Chip
          label={t('banks.unassigned')}
          selected={!value.newInstitution && value.institutionId === null}
          onPress={() =>
            onChange(chooseBank(value, { institutionId: null, isNew: false }, choosable, newId))
          }
        />
        <Chip
          label={t('import.newBank')}
          selected={value.newInstitution}
          onPress={() =>
            onChange(chooseBank(value, { institutionId: null, isNew: true }, choosable, newId))
          }
        />
      </View>

      {value.newInstitution ? (
        <>
          <TextInput
            value={value.institutionName}
            onChangeText={(name) => onChange({ ...value, institutionName: name })}
            placeholder={t('banks.name')}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            style={inputStyle}
          />
          {value.institutionName.trim() === '' ? (
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t('banks.nameRequired')}</Text>
          ) : null}
        </>
      ) : null}

      <Text style={{ color: theme.textMuted, fontSize: 13 }}>{t('import.account')}</Text>
      <View style={styles.chips}>
        {inBank.map((account) => (
          <Chip
            key={account.id}
            label={account.name}
            selected={!value.newAccount && value.accountId === account.id}
            onPress={() => onChange(chooseAccount(value, account.id))}
          />
        ))}
        <Chip
          label={t('import.newAccount')}
          selected={value.newAccount}
          onPress={() => onChange(chooseNewAccount(value, newId))}
        />
      </View>

      {value.newAccount ? (
        <>
          <TextInput
            value={value.accountName}
            onChangeText={(name) => onChange({ ...value, accountName: name })}
            placeholder={t('import.accountName')}
            placeholderTextColor={theme.textMuted}
            autoCapitalize="words"
            autoCorrect={false}
            style={inputStyle}
          />
          {value.accountName.trim() === '' ? (
            <Text style={{ color: theme.textMuted, fontSize: 12 }}>
              {t('import.accountRequired')}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
  },
});
