import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  applyProfile,
  BUILT_IN_PROFILES,
  detectProfile,
  GENERIC_CSV,
  importWorkbook,
  parseCamt053,
  PRESUPUESTO_XLSX,
  readCsv,
  readXlsx,
  yearFromFileName,
  type DraftTransaction,
  type ImportIssue,
  type ImportProfile,
} from '@finant/importers';
import { Amount } from '../src/components/Amount';
import { Card } from '../src/components/Card';
import { getOrCreateLocalAccount } from '../src/db/accounts-repo';
import { ingest, type IngestResult } from '../src/services/ingest';
import { radius, spacing, useTheme } from '../src/theme';

interface Staged {
  fileName: string;
  /** Human-readable name of the format that was used. */
  formatLabel: string;
  transactions: readonly DraftTransaction[];
  issues: readonly ImportIssue[];
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * File import. Everything happens on the device: the picked file is read from
 * local storage, parsed in memory, and written to the encrypted database.
 * Nothing is uploaded.
 */
export default function ImportScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);

  const pick = async (forcedProfile?: ImportProfile) => {
    setError(null);
    setResult(null);
    const result = await DocumentPicker.getDocumentAsync({
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
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setBusy(true);
    try {
      const accountId = await getOrCreateLocalAccount();
      const file = new File(asset.uri);

      // An .xlsx is a zip, so it is detected by the archive magic bytes rather
      // than by a filename extension or a MIME type the picker may not set.
      const head = (await file.bytes()).subarray(0, 4);
      const isZip = head[0] === 0x50 && head[1] === 0x4b;

      if (isZip) {
        const workbook = readXlsx(await file.bytes());
        const year = yearFromFileName(asset.name);
        const parsed = importWorkbook(workbook, PRESUPUESTO_XLSX, { accountId, year });
        setStaged({
          fileName: asset.name,
          formatLabel: `${PRESUPUESTO_XLSX.label} · ${year}`,
          transactions: parsed.transactions,
          issues: parsed.issues,
        });
        return;
      }

      const text = await file.text();

      if (text.trimStart().startsWith('<')) {
        const parsed = parseCamt053(text, { accountId });
        setStaged({
          fileName: asset.name,
          formatLabel: 'camt.053',
          transactions: parsed.transactions,
          issues: parsed.issues,
        });
        return;
      }

      const table = readCsv(text);
      const profile = forcedProfile ?? detectProfile(table.header, BUILT_IN_PROFILES) ?? GENERIC_CSV;
      const parsed = applyProfile(
        readCsv(text, { headerRow: profile.headerRow ?? 0 }),
        profile,
        { accountId },
      );
      setStaged({
        fileName: asset.name,
        formatLabel: profile.label,
        transactions: parsed.transactions,
        issues: parsed.issues,
      });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!staged) return;
    setBusy(true);
    try {
      // Stay on screen: the owner should see how many rows were new and how
      // many the unique indexes already held before the modal closes.
      setResult(await ingest(staged.transactions));
      setStaged(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <Card title={t('import.title')}>
        <Pressable onPress={() => void pick()} disabled={busy} style={[styles.button, { backgroundColor: theme.accent }]}>
          <Text style={styles.buttonText}>{t('import.pickFile')}</Text>
        </Pressable>
        <Text style={{ color: theme.textMuted, fontSize: 12 }}>{t('import.supportedFormats')}</Text>
        {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}
      </Card>

      {result ? (
        <Card title={t('import.result')}>
          <Text style={{ color: theme.text }}>{t('import.imported', { count: result.inserted })}</Text>
          {result.duplicates > 0 ? (
            <Text style={{ color: theme.textMuted }}>
              {t('import.duplicatesSkipped', { count: result.duplicates })}
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

      {staged ? (
        <>
          <Card
            title={t('import.preview')}
            subtitle={t('import.detectedProfile', { profile: staged.formatLabel })}
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
              <View key={draft.importHash} style={[styles.row, { borderBottomColor: theme.border }]}>
                <Text style={{ color: theme.text, flex: 1 }} numberOfLines={1}>
                  {draft.bookingDate} · {draft.description}
                </Text>
                <Amount value={draft.amount} />
              </View>
            ))}

            <Pressable
              onPress={() => void confirm()}
              disabled={busy || staged.transactions.length === 0}
              style={[styles.button, { backgroundColor: theme.accent, opacity: busy ? 0.6 : 1 }]}
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
  button: { paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
