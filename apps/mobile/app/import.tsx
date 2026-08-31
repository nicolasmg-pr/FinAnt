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
  GOOGLE_SHEETS_TRACKER,
  parseCamt053,
  readCsv,
  type DraftTransaction,
  type ImportIssue,
  type ImportProfile,
} from '@finant/importers';
import { Amount } from '../src/components/Amount';
import { Card } from '../src/components/Card';
import { getOrCreateLocalAccount } from '../src/db/accounts-repo';
import { ingest } from '../src/services/ingest';
import { radius, spacing, useTheme } from '../src/theme';

interface Staged {
  fileName: string;
  profile: ImportProfile | null;
  transactions: readonly DraftTransaction[];
  issues: readonly ImportIssue[];
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
  const [staged, setStaged] = useState<Staged | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (forcedProfile?: ImportProfile) => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: ['text/csv', 'text/comma-separated-values', 'text/xml', 'application/xml', 'text/plain', '*/*'],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;

    const asset = result.assets[0];
    setBusy(true);
    try {
      // Async read: a multi-megabyte export would block the UI thread on textSync().
      const text = await new File(asset.uri).text();
      const accountId = await getOrCreateLocalAccount();

      if (text.trimStart().startsWith('<')) {
        const parsed = parseCamt053(text, { accountId });
        setStaged({ fileName: asset.name, profile: null, transactions: parsed.transactions, issues: parsed.issues });
        return;
      }

      const table = readCsv(text);
      const profile = forcedProfile ?? detectProfile(table.header, BUILT_IN_PROFILES) ?? GENERIC_CSV;
      const parsed = applyProfile(readCsv(text, { headerRow: profile.headerRow ?? 0 }), profile, { accountId });
      setStaged({ fileName: asset.name, profile, transactions: parsed.transactions, issues: parsed.issues });
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
      await ingest(staged.transactions);
      router.back();
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
        <Pressable onPress={() => void pick(GOOGLE_SHEETS_TRACKER)} disabled={busy}>
          <Text style={{ color: theme.accent, textAlign: 'center' }}>{t('import.googleSheets')}</Text>
        </Pressable>
        {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}
      </Card>

      {staged ? (
        <>
          <Card
            title={t('import.preview')}
            subtitle={staged.profile ? t('import.detectedProfile', { profile: staged.profile.label }) : 'camt.053'}
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
