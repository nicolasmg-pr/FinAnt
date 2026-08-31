import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, type Locale } from '@finant/i18n';
import { Card } from '../../src/components/Card';
import { eraseEverything } from '../../src/db/database';
import { currentLocale, setLocale } from '../../src/i18n';
import {
  clearGoCardlessCredentials,
  readGoCardlessCredentials,
  saveGoCardlessCredentials,
} from '../../src/security/keys';
import { radius, spacing, useTheme } from '../../src/theme';

const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español', de: 'Deutsch' };

export default function SettingsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [locale, setActiveLocale] = useState<Locale>(currentLocale());
  const [secretId, setSecretId] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [hasCredentials, setHasCredentials] = useState(false);

  useEffect(() => {
    void readGoCardlessCredentials().then((c) => setHasCredentials(c !== null));
  }, []);

  const chooseLocale = async (next: Locale) => {
    await setLocale(next);
    setActiveLocale(next);
  };

  const storeCredentials = async () => {
    if (!secretId.trim() || !secretKey.trim()) return;
    await saveGoCardlessCredentials({ secretId: secretId.trim(), secretKey: secretKey.trim() });
    setSecretId('');
    setSecretKey('');
    setHasCredentials(true);
  };

  const confirmErase = () => {
    Alert.alert(t('settings.eraseAll'), t('settings.eraseAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.eraseAll'),
        style: 'destructive',
        onPress: async () => {
          await eraseEverything();
          await clearGoCardlessCredentials();
          setHasCredentials(false);
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ padding: spacing.lg }}
    >
      <Card title={t('settings.language')}>
        <View style={styles.chips}>
          {SUPPORTED_LOCALES.map((code) => (
            <Pressable
              key={code}
              onPress={() => void chooseLocale(code)}
              style={[
                styles.chip,
                {
                  borderColor: locale === code ? theme.accent : theme.border,
                  backgroundColor: locale === code ? theme.surfaceAlt : 'transparent',
                },
              ]}
            >
              <Text style={{ color: locale === code ? theme.accent : theme.text }}>
                {LOCALE_NAMES[code]}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      <Card title={t('settings.dataLocationTitle')}>
        <Text style={{ color: theme.textMuted }}>{t('settings.dataLocationBody')}</Text>
        <Link href="/import" style={[styles.link, { color: theme.accent }]}>
          {t('import.title')}
        </Link>
      </Card>

      <Card title={t('banks.credentialsTitle')} subtitle={t('banks.credentialsBody')}>
        {hasCredentials ? (
          <Text style={{ color: theme.income }}>✓ {t('common.done')}</Text>
        ) : null}
        <TextInput
          value={secretId}
          onChangeText={setSecretId}
          placeholder={t('banks.secretId')}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        />
        <TextInput
          value={secretKey}
          onChangeText={setSecretKey}
          placeholder={t('banks.secretKey')}
          placeholderTextColor={theme.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          // The key is a bearer credential for the owner's whole GoCardless
          // account: never render it in clear text on screen.
          secureTextEntry
          style={[styles.input, { borderColor: theme.border, color: theme.text }]}
        />
        <Pressable onPress={() => void storeCredentials()} style={[styles.button, { backgroundColor: theme.accent }]}>
          <Text style={styles.buttonText}>{t('common.save')}</Text>
        </Pressable>
      </Card>

      <Card title={t('settings.data')}>
        <Pressable onPress={confirmErase}>
          <Text style={{ color: theme.expense }}>{t('settings.eraseAll')}</Text>
        </Pressable>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1 },
  input: { borderWidth: 1, borderRadius: radius.md, padding: spacing.md, fontSize: 14 },
  button: { paddingVertical: spacing.md, borderRadius: radius.md, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '600' },
  link: { marginTop: spacing.sm, fontWeight: '600' },
});
