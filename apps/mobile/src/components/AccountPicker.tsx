import { StyleSheet, View } from 'react-native';
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
import { Field } from './ui/Field';
import { SectionHeader } from './ui/SectionHeader';
import { spacing } from '../design';

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

  return (
    <View style={styles.picker}>
      <SectionHeader label={t('import.bank')} />
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
        <Field
          label={t('banks.name')}
          value={value.institutionName}
          onChangeText={(name) => onChange({ ...value, institutionName: name })}
          placeholder={t('banks.name')}
          autoCapitalize="words"
          autoCorrect={false}
          hint={value.institutionName.trim() === '' ? t('banks.nameRequired') : undefined}
        />
      ) : null}

      <SectionHeader label={t('import.account')} />
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
        <Field
          label={t('import.accountName')}
          value={value.accountName}
          onChangeText={(name) => onChange({ ...value, accountName: name })}
          placeholder={t('import.accountName')}
          autoCapitalize="words"
          autoCorrect={false}
          hint={value.accountName.trim() === '' ? t('import.accountRequired') : undefined}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
