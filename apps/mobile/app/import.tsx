import { useMemo, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { accountChoiceNeedsName, resolveAccountChoice, type AccountChoice } from '@finant/core';
import {
  applyProfile,
  decodeStatement,
  readStatementPdf,
  importWorkbook,
  parseCamt053,
  PRESUPUESTO_XLSX,
  readStatementCsv,
  readXlsx,
  yearFromFileName,
  type ImportProfile,
  type ImportResult,
  type StatementAccount,
} from '@finant/importers';
import { AccountPicker } from '../src/components/AccountPicker';
import { Button } from '../src/components/ui/Button';
import { ListRow } from '../src/components/ui/ListRow';
import { StatTile } from '../src/components/ui/StatTile';
import { Touchable } from '../src/components/ui/Touchable';
import { Amount } from '../src/components/Amount';
import { Card } from '../src/components/Card';
import {
  createAccount,
  findAccountByIban,
  getOrCreateLocalAccount,
  listAccounts,
  type AccountRow,
} from '../src/db/accounts-repo';
import {
  createInstitution,
  listInstitutions,
  type InstitutionRow,
} from '../src/db/institutions-repo';
import { readSetting, SETTING_LAST_IMPORT_ACCOUNT, writeSetting } from '../src/db/settings-repo';
import { ingest, type IngestResult } from '../src/services/ingest';
import { radius, spacing, type, useTheme } from '../src/design';

/**
 * A picked file once its format is known, but before its rows are final. The
 * import hash of every row includes the account id, so the file is parsed
 * again (in memory, from the same text) whenever the owner picks another
 * account. The preview then shows exactly what the database will hold.
 */
interface ParsedFile {
  fileName: string;
  /** Human-readable name of the format that was used. */
  formatLabel: string;
  parse: (accountId: string) => ImportResult;
  /** The account the statement itself names. camt.053 only; null for CSV and xlsx. */
  statementAccount: StatementAccount | null;
  /** The tracker spreadsheet is the owner's own ledger: always "My records", no picker. */
  fixedToLocal: boolean;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Reads the picked file and works out how to parse it. `probeAccountId` is
 * only used to run the camt.053 reader once for its `statementAccount`; the
 * rows from that run are discarded.
 */
async function parseFile(
  asset: { uri: string; name: string },
  probeAccountId: string,
  forcedProfile: ImportProfile | undefined,
): Promise<ParsedFile> {
  const file = new File(asset.uri);
  const bytes = await file.bytes();

  // An .xlsx is a zip, so it is detected by the archive magic bytes rather
  // than by a filename extension or a MIME type the picker may not set.
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const workbook = readXlsx(bytes);
    const year = yearFromFileName(asset.name);
    return {
      fileName: asset.name,
      formatLabel: `${PRESUPUESTO_XLSX.label} · ${year}`,
      parse: (accountId) => importWorkbook(workbook, PRESUPUESTO_XLSX, { accountId, year }),
      statementAccount: null,
      fixedToLocal: true,
    };
  }

  // Decoded from the bytes already in hand, not via `file.text()`: German
  // exports are ISO-8859-1, and a UTF-8 read turns every umlaut into U+FFFD.
  // A PDF is bytes, not text: its statement table is recovered from where the
  // glyphs were drawn. Checked before decoding, since decoding it as text
  // would produce nothing usable.
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    const { table, profile } = readStatementPdf(bytes);
    return {
      fileName: asset.name,
      formatLabel: profile.label,
      parse: (accountId) => applyProfile(table, profile, { accountId }),
      statementAccount: null,
      fixedToLocal: false,
    };
  }

  const text = decodeStatement(bytes);

  if (text.trimStart().startsWith('<')) {
    const parse = (accountId: string) => parseCamt053(text, { accountId });
    return {
      fileName: asset.name,
      formatLabel: 'camt.053',
      parse,
      statementAccount: parse(probeAccountId).statementAccount,
      fixedToLocal: false,
    };
  }

  // The header is found by scanning, not assumed to be row 0: bank exports put
  // an account/period preamble above the table.
  const { table, profile } = readStatementCsv(text, { profile: forcedProfile });
  return {
    fileName: asset.name,
    formatLabel: profile.label,
    parse: (accountId) => applyProfile(table, profile, { accountId }),
    statementAccount: null,
    fixedToLocal: false,
  };
}

/**
 * The account the file opens on, and with it the bank that account sits under:
 * the account a camt.053 statement names by its IBAN, then the account the last
 * import went to, then "My records", which is in no bank.
 */
async function preselect(
  file: ParsedFile,
  known: readonly AccountRow[],
  institutions: readonly InstitutionRow[],
  localId: string,
): Promise<AccountChoice | null> {
  const accounts = known.map((account) => ({
    id: account.id,
    institutionId: account.institution_id,
  }));
  const institutionIds = institutions.map((institution) => institution.id);
  if (file.fixedToLocal) {
    return resolveAccountChoice({
      accounts,
      institutionIds,
      candidateIds: [localId],
      suggestedName: '',
    });
  }
  const iban = file.statementAccount?.iban;
  const byIban = iban ? await findAccountByIban(iban) : null;
  const lastUsed = await readSetting(SETTING_LAST_IMPORT_ACCOUNT);
  return resolveAccountChoice({
    accounts,
    institutionIds,
    candidateIds: [byIban?.id, lastUsed, localId],
    // A statement that names its bank gives both name fields a sensible default.
    suggestedName: file.statementAccount?.name ?? '',
  });
}

/**
 * File import. Everything happens on the device: the picked file is read from
 * local storage, parsed in memory, and written to the encrypted database.
 * Nothing is uploaded.
 */
export default function ImportScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [file, setFile] = useState<ParsedFile | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [institutions, setInstitutions] = useState<InstitutionRow[]>([]);
  const [choice, setChoice] = useState<AccountChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  // Parsed for the chosen account, so the hashes in the preview are the ones stored.
  const staged = useMemo(
    () => (file && choice ? file.parse(choice.accountId) : null),
    [file, choice],
  );
  const needsName = choice !== null && accountChoiceNeedsName(choice);

  const pick = async (forcedProfile?: ImportProfile) => {
    setError(null);
    setResult(null);
    setFile(null);
    setChoice(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: [
        XLSX_MIME,
        'text/csv',
        'text/comma-separated-values',
        'text/xml',
        'application/xml',
        'text/plain',
        'application/pdf',
        '*/*',
      ],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setBusy(true);
    try {
      // "My records" must exist before any other account can be offered or
      // created; see getOrCreateLocalAccount.
      const localId = await getOrCreateLocalAccount();
      const [known, banks] = await Promise.all([listAccounts(), listInstitutions()]);
      const parsed = await parseFile(asset, localId, forcedProfile);
      const preselected = await preselect(parsed, known, banks, localId);
      if (!preselected) {
        // Unreachable: getOrCreateLocalAccount has just made sure "My records" is there.
        setError(t('errors.importFailed'));
        return;
      }
      setAccounts(known);
      setInstitutions(banks);
      setChoice(preselected);
      setFile(parsed);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!file || !staged || !choice || needsName) return;
    setBusy(true);
    try {
      let current = choice;
      let banks = institutions;
      if (current.newInstitution) {
        // Returns the bank already carrying that name if there is one, so a
        // retry after a failed ingest cannot leave a second bank behind.
        const institutionId = await createInstitution({ name: current.institutionName.trim() });
        current = { ...current, institutionId, newInstitution: false };
        banks = await listInstitutions();
        setChoice(current);
        setInstitutions(banks);
      }
      const bankName = banks.find((bank) => bank.id === current.institutionId)?.name ?? null;
      if (current.newAccount) {
        await createAccount({
          id: current.accountId,
          name: current.accountName.trim(),
          currency: staged.transactions[0]?.amount.currency ?? 'EUR',
          provider: 'file-import',
          // Stored so the next statement from this bank preselects the account.
          iban: file.statementAccount?.iban ?? null,
          institutionId: current.institutionId,
          institutionName: bankName ?? file.statementAccount?.name ?? null,
        });
        // The account now exists: a retry after a failed ingest must reuse it,
        // not try to create it again. The id is unchanged, so the hashes hold.
        current = { ...current, newAccount: false };
        setChoice(current);
        setAccounts(await listAccounts());
      }
      if (!file.fixedToLocal) await writeSetting(SETTING_LAST_IMPORT_ACCOUNT, current.accountId);
      // Stay on screen: the owner should see how many rows were new and how
      // many the unique indexes already held before the modal closes.
      setResult(await ingest(staged.transactions));
      setFile(null);
      setChoice(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ padding: spacing.lg }}
      keyboardShouldPersistTaps="handled"
    >
      {/* A drop zone rather than a button: picking the file is the whole
          point of this screen, so it gets the space to say so. */}
      <Touchable
        onPress={() => void pick()}
        disabled={busy}
        accessibilityRole="button"
        style={[styles.dropZone, { borderColor: theme.border, backgroundColor: theme.surface }]}
      >
        <Feather name="upload-cloud" size={32} color={theme.accent} />
        <Text style={[type.heading, { color: theme.text }]}>{t('import.pickFile')}</Text>
        <Text style={[type.caption, styles.centred, { color: theme.textMuted }]}>
          {t('import.supportedFormats')}
        </Text>
      </Touchable>
      {error ? (
        <Text style={[type.body, styles.error, { color: theme.expense }]}>{error}</Text>
      ) : null}

      {result ? (
        <Card title={t('import.result')}>
          <Text style={[type.body, { color: theme.text }]}>
            {t('import.imported', { count: result.inserted })}
          </Text>
          {result.duplicates > 0 ? (
            <Text style={[type.label, { color: theme.textMuted }]}>
              {t('import.duplicatesSkipped', { count: result.duplicates })}
            </Text>
          ) : null}
          {result.transfersMatched > 0 ? (
            <Text style={[type.label, { color: theme.textMuted }]}>
              {t('import.transfersMatched', { count: result.transfersMatched })}
            </Text>
          ) : null}
          {result.autoExcluded > 0 ? (
            <Text style={[type.label, { color: theme.textMuted }]}>
              {t('import.autoExcluded', { count: result.autoExcluded })}
            </Text>
          ) : null}
          <Button label={t('common.done')} onPress={() => router.back()} />
        </Card>
      ) : null}

      {file && choice && !file.fixedToLocal ? (
        <Card title={t('import.account')}>
          <AccountPicker
            institutions={institutions}
            accounts={accounts}
            value={choice}
            onChange={setChoice}
          />
        </Card>
      ) : null}

      {file && staged ? (
        <>
          <Card
            title={t('import.preview')}
            subtitle={t('import.detectedProfile', { profile: file.formatLabel })}
          >
            <View style={styles.tiles}>
              <StatTile label={t('import.preview')} tone="neutral">
                <Text style={[type.heading, { color: theme.text }]}>
                  {staged.transactions.length}
                </Text>
              </StatTile>
              {staged.issues.length > 0 ? (
                <StatTile label={t('import.issues', { count: staged.issues.length })} tone="expense">
                  <Text style={[type.heading, { color: theme.warning }]}>
                    {staged.issues.length}
                  </Text>
                </StatTile>
              ) : null}
            </View>
            <Text style={[type.label, { color: theme.textMuted }]}>
              {t('import.rowsReady', { count: staged.transactions.length })}
            </Text>

            {staged.transactions.slice(0, 8).map((draft, index) => (
              <ListRow
                key={draft.importHash}
                title={draft.description}
                subtitle={draft.bookingDate}
                trailing={<Amount value={draft.amount} />}
                divider={index < Math.min(staged.transactions.length, 8) - 1}
              />
            ))}

            <Button
              label={t('import.confirm')}
              loading={busy}
              disabled={needsName || staged.transactions.length === 0}
              onPress={() => void confirm()}
            />
          </Card>

          {staged.issues.length > 0 ? (
            <Card title={t('import.issues', { count: staged.issues.length })}>
              {/* Rendered exactly as the parser reported them. A parser keeps
                  going past a bad row and says so here; nothing about the row
                  itself is added to the message. */}
              {staged.issues.slice(0, 10).map((issue) => (
                <Text key={`${issue.row}`} style={[type.caption, { color: theme.textMuted }]}>
                  {issue.row}: {issue.message}
                </Text>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  dropZone: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    marginBottom: spacing.lg,
  },
  centred: { textAlign: 'center' },
  error: { marginBottom: spacing.lg },
  tiles: { flexDirection: 'row', gap: spacing.sm },
});
