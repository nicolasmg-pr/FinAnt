import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LOCALES, type Locale } from '@finant/i18n';
import { Card } from '../../src/components/Card';
import { eraseEverything } from '../../src/db/database';
import { currentLocale, setLocale } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';

const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español', de: 'Deutsch' };

export default function SettingsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [locale, setActiveLocale] = useState<Locale>(currentLocale());

  const chooseLocale = async (next: Locale) => {
    await setLocale(next);
    setActiveLocale(next);
  };

  const confirmErase = () => {
    Alert.alert(t('settings.eraseAll'), t('settings.eraseAllConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.eraseAll'),
        style: 'destructive',
        onPress: async () => {
          await eraseEverything();
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
  link: { marginTop: spacing.sm, fontWeight: '600' },
});
