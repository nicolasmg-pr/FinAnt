import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { exclusionKeyOf, recategorise, type ExclusionRule } from '@finant/core';
import { SUPPORTED_LOCALES, type Locale } from '@finant/i18n';
import { Card } from '../../src/components/Card';
import { eraseEverything } from '../../src/db/database';
import { deleteExclusionRule, listExclusionRules } from '../../src/db/exclusion-rules-repo';
import { listRules } from '../../src/db/rules-repo';
import { applyRecategorisations, listAllTransactions } from '../../src/db/transactions-repo';
import { currentLocale, setLocale } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';

const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español', de: 'Deutsch' };

export default function SettingsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [locale, setActiveLocale] = useState<Locale>(currentLocale());
  const [exclusions, setExclusions] = useState<readonly ExclusionRule[]>([]);
  const [reapplying, setReapplying] = useState(false);
  const [reapplied, setReapplied] = useState<number | null>(null);

  // Reloaded on focus: a rule is usually created on the movement screen, and
  // the owner comes straight here to check what it now covers.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      listExclusionRules()
        .then((rules) => {
          if (!cancelled) setExclusions(rules);
        })
        .catch(() => {
          if (!cancelled) setExclusions([]);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  /**
   * Removing a rule stops it applying to future imports; it does not un-exclude
   * what it already excluded. Undoing that is the movement screen's job, where
   * the owner can see which movements are involved.
   */
  const confirmDeleteExclusion = (rule: ExclusionRule) => {
    Alert.alert(t('settings.autoExclusions'), t('settings.autoExclusionsDeleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await deleteExclusionRule(rule.id);
            setExclusions((current) => current.filter((r) => r.id !== rule.id));
          })();
        },
      },
    ]);
  };

  const chooseLocale = async (next: Locale) => {
    await setLocale(next);
    setActiveLocale(next);
  };

  /**
   * Re-runs the rules over what is already on record. A correction to a shipped
   * rule is worth nothing if it only reaches statements not yet imported —
   * this is what carries it to the movements the broken rule already filed.
   * Manual classifications and matched transfers are left alone; `recategorise`
   * decides that, not this screen.
   */
  const reapplyRules = async () => {
    setReapplying(true);
    setReapplied(null);
    try {
      const [transactions, rules] = await Promise.all([listAllTransactions(), listRules()]);
      setReapplied(await applyRecategorisations(recategorise(transactions, rules)));
    } catch (cause) {
      Alert.alert(t('settings.reapplyRules'), (cause as Error).message);
    } finally {
      setReapplying(false);
    }
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

      <Card title={t('categories.title')}>
        <Text style={{ color: theme.textMuted }}>{t('categories.body')}</Text>
        <Link href="/categories" style={[styles.link, { color: theme.accent }]}>
          {t('categories.manage')}
        </Link>
      </Card>

      <Card title={t('settings.autoExclusions')}>
        <Text style={{ color: theme.textMuted }}>{t('settings.autoExclusionsBody')}</Text>
        {exclusions.length === 0 ? (
          <Text style={{ color: theme.textMuted }}>{t('settings.autoExclusionsEmpty')}</Text>
        ) : (
          exclusions.map((rule) => (
            <View key={rule.id} style={[styles.ruleRow, { borderBottomColor: theme.border }]}>
              <Text style={{ color: theme.text, flexShrink: 1 }} numberOfLines={2}>
                {t('settings.autoExclusionsMatch', { key: exclusionKeyOf(rule) ?? rule.id })}
              </Text>
              <Pressable onPress={() => confirmDeleteExclusion(rule)} accessibilityRole="button">
                <Text style={{ color: theme.expense, fontWeight: '600' }}>
                  {t('common.delete')}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </Card>

      <Card title={t('settings.rulesTitle')}>
        <Text style={{ color: theme.textMuted }}>{t('settings.rulesBody')}</Text>
        <Pressable onPress={() => void reapplyRules()} disabled={reapplying}>
          <Text style={{ color: theme.accent, fontWeight: '600' }}>
            {reapplying ? t('common.loading') : t('settings.reapplyRules')}
          </Text>
        </Pressable>
        {reapplied !== null ? (
          <Text style={{ color: theme.textMuted, fontSize: 13 }}>
            {t('settings.reapplyRulesDone', { count: reapplied })}
          </Text>
        ) : null}
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
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  link: { marginTop: spacing.sm, fontWeight: '600' },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
