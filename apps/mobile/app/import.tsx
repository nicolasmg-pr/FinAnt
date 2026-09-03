import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  applyProfile,
  decodeStatement,
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
import { Amount } from '../src/components/Amount';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import {
  createAccount,
  findAccountByIban,
  getOrCreateLocalAccount,
  listAccounts,
  type AccountRow,
} from '../src/db/accounts-repo';
import { readSetting, SETTING_LAST_IMPORT_ACCOUNT, writeSetting } from '../src/db/settings-repo';
import { newId } from '../src/db/transactions-repo';
import { ingest, type IngestResult } from '../src/services/ingest';
import { radius, spacing, useTheme } from '../src/theme';

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

/** The account the import will land in. `isNew` means it is created on confirm. */
interface AccountChoice {
  readonly id: string;
  readonly isNew: boolean;
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

/** Statement IBAN first, then the account the last import went to, then "My records". */
async function preselect(
  file: ParsedFile,
  known: readonly AccountRow[],
  localId: string,
): Promise<AccountChoice> {
  if (file.fixedToLocal) return { id: localId, isNew: false };
  const iban = file.statementAccount?.iban;
  if (iban) {
    const match = await findAccountByIban(iban);
    if (match) return { id: match.id, isNew: false };
  }
  const lastUsed = await readSetting(SETTING_LAST_IMPORT_ACCOUNT);
  if (lastUsed && known.some((account) => account.id === lastUsed)) {
    return { id: lastUsed, isNew: false };
  }
  return { id: localId, isNew: false };
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
  const [choice, setChoice] = useState<AccountChoice | null>(null);
  const [newAccountName, setNewAccountName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  // Parsed for the chosen account, so the hashes in the preview are the ones stored.
  const staged = useMemo(() => (file && choice ? file.parse(choice.id) : null), [file, choice]);
  const needsName = choice?.isNew === true && newAccountName.trim() === '';

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
      const known = await listAccounts();
      const parsed = await parseFile(asset, localId, forcedProfile);
      setAccounts(known);
      // A statement that names its bank gives the new-account field a sensible default.
      setNewAccountName(parsed.statementAccount?.name ?? '');
      setChoice(await preselect(parsed, known, localId));
      setFile(parsed);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chooseNew = () =>
    setChoice((current) => (current?.isNew ? current : { id: newId(), isNew: true }));

  const confirm = async () => {
    if (!file || !staged || !choice || needsName) return;
    setBusy(true);
    try {
      if (choice.isNew) {
        await createAccount({
          id: choice.id,
          name: newAccountName.trim(),
          currency: staged.transactions[0]?.amount.currency ?? 'EUR',
          provider: 'file-import',
          // Stored so the next statement from this bank preselects the account.
          iban: file.statementAccount?.iban ?? null,
          institutionName: file.statementAccount?.name ?? null,
        });
        // The account now exists: a retry after a failed ingest must reuse it,
        // not try to create it again. The id is unchanged, so the hashes hold.
        setChoice({ id: choice.id, isNew: false });
        setAccounts(await listAccounts());
      }
      if (!file.fixedToLocal) await writeSetting(SETTING_LAST_IMPORT_ACCOUNT, choice.id);
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
      <Card title={t('import.title')}>
        <Pressable
          onPress={() => void pick()}
          disabled={busy}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.buttonText}>{t('import.pickFile')}</Text>
        </Pressable>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t('import.supportedFormats')}</Text>
        {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}
      </Card>

      {result ? (
        <Card title={t('import.result')}>
          <Text style={{ color: theme.text }}>
            {t('import.imported', { count: result.inserted })}
          </Text>
          {result.duplicates > 0 ? (
            <Text style={{ color: theme.textMuted }}>
              {t('import.duplicatesSkipped', { count: result.duplicates })}
            </Text>
          ) : null}
          {result.transfersMatched > 0 ? (
            <Text style={{ color: theme.textMuted }}>
              {t('import.transfersMatched', { count: result.transfersMatched })}
            </Text>
          ) : null}
          {result.autoExcluded > 0 ? (
            <Text style={{ color: theme.textMuted }}>
              {t('import.autoExcluded', { count: result.autoExcluded })}
            </Text>
          ) : null}
          <Pressable
            onPress={() => router.back()}
            style={[styles.button, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>{t('common.done')}</Text>
          </Pressable>
        </Card>
      ) : null}

      {file && !file.fixedToLocal ? (
        <Card title={t('import.account')}>
          <View style={styles.chips}>
            {accounts.map((account) => (
              <Chip
                key={account.id}
                label={account.name}
                selected={choice?.id === account.id}
                onPress={() => setChoice({ id: account.id, isNew: false })}
              />
            ))}
            <Chip
              label={t('import.newAccount')}
              selected={choice?.isNew === true}
              onPress={chooseNew}
            />
          </View>
          {choice?.isNew ? (
            <>
              <TextInput
                value={newAccountName}
                onChangeText={setNewAccountName}
                placeholder={t('import.accountName')}
                placeholderTextColor={theme.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.surfaceAlt,
                  },
                ]}
              />
              {needsName ? (
                <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                  {t('import.accountRequired')}
                </Text>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {file && staged ? (
        <>
          <Card
            title={t('import.preview')}
            subtitle={t('import.detectedProfile', { profile: file.formatLabel })}
          >
            <Text style={{ color: theme.text }}>
              {t('import.rowsReady', { count: staged.transactions.length })}
            </Text>
            {staged.issues.length > 0 ? (
              <Text style={{ color: theme.warning }}>
                {t('import.issues', { count: staged.issues.length })}
              </Text>
            ) : null}

            {staged.transactions.slice(0, 8).map((draft) => (
              <View
                key={draft.importHash}
                style={[styles.row, { borderBottomColor: theme.border }]}
              >
                <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
                  {draft.bookingDate} · {draft.description}
                </Text>
                <Amount value={draft.amount} />
              </View>
            ))}

            <Pressable
              onPress={() => void confirm()}
              disabled={busy || needsName || staged.transactions.length === 0}
              style={[
                styles.button,
                { backgroundColor: theme.accent, opacity: busy || needsName ? 0.6 : 1 },
              ]}
            >
              <Text style={styles.buttonText}>{t('import.confirm')}</Text>
            </Pressable>
          </Card>

          {staged.issues.length > 0 ? (
            <Card title={t('import.issues', { count: staged.issues.length })}>
              {staged.issues.slice(0, 10).map((issue) => (
                <Text key={`${issue.row}`} style={{ color: theme.textMuted, fontSize: 12 }}>
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
  button: {
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
