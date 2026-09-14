import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Stack, useFocusEffect } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { INTL_LOCALE } from '@finant/i18n';
import { Card } from '../src/components/Card';
import { Button } from '../src/components/ui/Button';
import { Field } from '../src/components/ui/Field';
import { ListRow } from '../src/components/ui/ListRow';
import { Sheet } from '../src/components/ui/Sheet';
import { Touchable } from '../src/components/ui/Touchable';
import {
  BackupError,
  beginBackup,
  createBackup,
  discardBackup,
  inspectBackup,
  mergeBackup,
  type BackupPreview,
} from '../src/services/backup';
import { readSetting, SETTING_LAST_BACKUP_AT } from '../src/db/settings-repo';
import { currentLocale } from '../src/i18n';
import { radius, spacing, type, useTheme } from '../src/design';

export default function BackupScreen() {
  const theme = useTheme();
  const { t } = useTranslation();

  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [typedCode, setTypedCode] = useState('');
  const [inspecting, setInspecting] = useState(false);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<number | null>(null);

  // Reloaded on focus, the same way Settings reloads its own copy of this
  // setting: `create()` below updates it directly on success, but a fresh
  // mount of this screen — the far more common case — has no other way to
  // learn whether a backup already exists.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      readSetting(SETTING_LAST_BACKUP_AT)
        .then((value) => {
          if (!cancelled) setLastBackup(value);
        })
        .catch(() => {
          if (!cancelled) setLastBackup(null);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const message = (thrown: unknown): string => {
    if (thrown instanceof BackupError) {
      switch (thrown.code) {
        case 'wrong-code':
          return t('backup.errorWrongCode');
        case 'not-a-backup':
          return t('backup.errorNotABackup');
        case 'too-new':
          return t('backup.errorTooNew');
        case 'schema-mismatch':
          return t('backup.errorSchemaMismatch');
        case 'sharing-unavailable':
          return t('backup.errorSharingUnavailable');
      }
    }
    // Never surface a raw message: it can carry a file path, and a path can
    // carry a name. See the Boundaries rule in CLAUDE.md.
    return t('backup.errorFailed');
  };

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString(INTL_LOCALE[currentLocale()], {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  // Step one of two, and it writes nothing: it mints the code and shows it.
  // The file is not created until `share()` below, which the sheet's own
  // confirmation gates — so a code the owner has not saved can never be the
  // key to a file that already exists somewhere they cannot take it back from.
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const minted = await beginBackup();
      setSaved(false);
      setCopied(false);
      setCode(minted);
    } catch (thrown) {
      setError(message(thrown));
    } finally {
      setBusy(false);
    }
  };

  // Step two: only reachable once the owner has ticked "I have saved this
  // code". The code is dropped from state either way — it is shown once and
  // never stored — and on failure nothing has been shared, so there is no file
  // anywhere that the discarded code was the key to.
  const share = async () => {
    if (!code) return;
    setSharing(true);
    setError(null);
    try {
      const { createdAt } = await createBackup(code);
      setCode(null);
      setLastBackup(createdAt);
    } catch (thrown) {
      setCode(null);
      setError(message(thrown));
    } finally {
      setSharing(false);
    }
  };

  const pickFile = async () => {
    setRestoreError(null);
    setRestoreResult(null);
    const picked = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    if (!asset) return;
    setPickedUri(asset.uri);
    setPickedName(asset.name);
  };

  const inspect = async () => {
    if (!pickedUri || typedCode.trim() === '') return;
    setInspecting(true);
    setRestoreError(null);
    setRestoreResult(null);
    try {
      setPreview(await inspectBackup(pickedUri, typedCode));
    } catch (thrown) {
      setRestoreError(message(thrown));
    } finally {
      setInspecting(false);
    }
  };

  // Backdrop tap, hardware back and the Cancel button all funnel through
  // here, so the working copy `inspectBackup` staged in cache is dropped on
  // every way out of the sheet, not only the one with a button on it.
  const closePreview = () => {
    if (restoring) return;
    const current = preview;
    setPreview(null);
    if (current) void discardBackup(current).catch(() => {});
  };

  const confirmRestore = async () => {
    if (!preview) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const added = await mergeBackup(preview, typedCode);
      const total = Object.values(added).reduce((sum, count) => sum + count, 0);
      setPreview(null);
      setRestoreResult(total);
      setPickedUri(null);
      setPickedName(null);
      setTypedCode('');
    } catch (thrown) {
      // mergeBackup drops the working copy whether it succeeds or throws, so
      // there is nothing left to retry against: the sheet closes and the
      // owner starts over from a fresh pick.
      setPreview(null);
      setRestoreError(message(thrown));
    } finally {
      setRestoring(false);
    }
  };

  const previewRows = preview
    ? Object.entries(preview.counts).filter(([, count]) => count > 0)
    : [];

  // A translated label for every table the manifest can carry today.
  // `previewRows` above already hides zero-count tables, so this only ever
  // renders for a table the backup actually contains. The fallback to the
  // raw table name stays only as protection against a future table added to
  // `BACKUP_TABLES` without a matching translation, never as an accepted
  // outcome for one of the fifteen that exist now.
  const tableLabels: Record<string, string> = {
    institutions: t('backup.tables.institutions'),
    accounts: t('backup.tables.accounts'),
    categories: t('backup.tables.categories'),
    import_profiles: t('backup.tables.import_profiles'),
    rules: t('backup.tables.rules'),
    budgets: t('backup.tables.budgets'),
    exclusion_rules: t('backup.tables.exclusion_rules'),
    transactions: t('backup.tables.transactions'),
    assets: t('backup.tables.assets'),
    investment_legs: t('backup.tables.investment_legs'),
    quotes: t('backup.tables.quotes'),
    price_history: t('backup.tables.price_history'),
    notification_sources: t('backup.tables.notification_sources'),
    notification_routes: t('backup.tables.notification_routes'),
    settings: t('backup.tables.settings'),
  };

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}>
      <Stack.Screen options={{ title: t('backup.title') }} />

      <Card title={t('backup.title')}>
        <Text style={[type.body, { color: theme.textMuted }]}>{t('backup.subtitle')}</Text>
        <Text style={[type.label, { color: theme.textMuted }]}>
          {lastBackup
            ? t('backup.lastBackup', { date: formatDate(lastBackup) })
            : t('backup.never')}
        </Text>
        <Button
          label={busy ? t('backup.creating') : t('backup.create')}
          loading={busy}
          onPress={() => void create()}
        />
      </Card>

      {error ? <Text style={[type.body, { color: theme.expense }]}>{error}</Text> : null}

      <Card title={t('backup.restore')}>
        <Button
          label={t('backup.pickFile')}
          variant="secondary"
          disabled={inspecting}
          onPress={() => void pickFile()}
        />
        {pickedName ? (
          <ListRow
            title={pickedName}
            leading={<Feather name="file-text" size={18} color={theme.textMuted} />}
          />
        ) : null}

        <Field
          label={t('backup.enterCode')}
          hint={t('backup.enterCodeHint')}
          value={typedCode}
          onChangeText={setTypedCode}
          editable={!inspecting}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
        />

        <Button
          label={inspecting ? t('common.loading') : t('backup.restore')}
          loading={inspecting}
          disabled={!pickedUri || typedCode.trim() === ''}
          onPress={() => void inspect()}
        />
      </Card>

      {restoreError ? (
        <Text style={[type.body, { color: theme.expense }]}>{restoreError}</Text>
      ) : null}

      {restoreResult !== null ? (
        <Card title={t('backup.doneTitle')}>
          <Text style={[type.body, { color: theme.textMuted }]}>
            {restoreResult === 0
              ? t('backup.doneNothing')
              : t('backup.doneAdded', { count: restoreResult })}
          </Text>
        </Card>
      ) : null}

      <Sheet
        visible={code !== null}
        // Backdrop tap, hardware back and the drag-down gesture all resolve to
        // this same handler. Dismissing now abandons the export before any file
        // exists — the code was the key to nothing — so the only dismissal that
        // has to be refused is one arriving mid-share, which would leave the
        // owner holding a file whose code just left the screen.
        onDismiss={() => {
          if (!sharing) setCode(null);
        }}
        title={t('backup.codeTitle')}
      >
        <Touchable
          onPress={() => {
            if (code) void Clipboard.setStringAsync(code).then(() => setCopied(true));
          }}
          accessibilityRole="button"
        >
          <View
            style={[styles.code, { backgroundColor: theme.accentSoft, borderRadius: radius.md }]}
          >
            <Text selectable style={[type.title, styles.codeText, { color: theme.text }]}>
              {code}
            </Text>
          </View>
        </Touchable>
        {copied ? (
          <Text style={[type.label, { color: theme.textMuted }]}>{t('backup.codeCopied')}</Text>
        ) : null}
        <Text style={[type.body, { color: theme.textMuted }]}>{t('backup.codeBody')}</Text>
        <Touchable
          onPress={() => {
            if (!sharing) setSaved((was) => !was);
          }}
          accessibilityRole="checkbox"
        >
          <Text style={[type.body, { color: saved ? theme.accent : theme.textMuted }]}>
            {saved ? '☑ ' : '☐ '}
            {t('backup.codeConfirm')}
          </Text>
        </Touchable>
        <Button
          label={sharing ? t('backup.creating') : t('backup.share')}
          loading={sharing}
          disabled={!saved}
          onPress={() => void share()}
        />
      </Sheet>

      <Sheet visible={preview !== null} onDismiss={closePreview} title={t('backup.previewTitle')}>
        {preview ? (
          <>
            <Text style={[type.body, { color: theme.textMuted }]}>
              {t('backup.previewMade', {
                date: formatDate(preview.createdAt),
                version: preview.appVersion,
              })}
            </Text>
            {previewRows.map(([table, count], index) => (
              <ListRow
                key={table}
                title={tableLabels[table] ?? table}
                subtitle={t('backup.previewRows', { count })}
                divider={index < previewRows.length - 1}
              />
            ))}
            <Text style={[type.body, { color: theme.textMuted }]}>{t('backup.previewBody')}</Text>
          </>
        ) : null}

        <View style={styles.sheetActions}>
          <Button
            label={t('common.cancel')}
            variant="secondary"
            disabled={restoring}
            onPress={closePreview}
          />
          <Button
            label={restoring ? t('backup.restoring') : t('backup.confirmRestore')}
            loading={restoring}
            onPress={() => void confirmRestore()}
          />
        </View>
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  code: { padding: spacing.md, alignItems: 'center' },
  codeText: {
    letterSpacing: 3,
    textAlign: 'center',
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
