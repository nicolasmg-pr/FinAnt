import { useCallback, useState } from 'react';
import Feather from '@expo/vector-icons/Feather';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { exclusionKeyOf, recategorise, type ExclusionRule } from '@finant/core';
import { INTL_LOCALE, SUPPORTED_LOCALES, type Locale } from '@finant/i18n';
import { AssistantSettings } from '../../src/components/AssistantSettings';
import { Card } from '../../src/components/Card';
import { Button } from '../../src/components/ui/Button';
import { ListRow } from '../../src/components/ui/ListRow';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Touchable } from '../../src/components/ui/Touchable';
import { eraseEverything } from '../../src/db/database';
import { deleteExclusionRule, listExclusionRules } from '../../src/db/exclusion-rules-repo';
import { listRules } from '../../src/db/rules-repo';
import { applyRecategorisations, listAllTransactions } from '../../src/db/transactions-repo';
import { currentLocale, setLocale } from '../../src/i18n';
import { spacing, type, useTheme } from '../../src/design';

const LOCALE_NAMES: Record<Locale, string> = { en: 'English', es: 'Español', de: 'Deutsch' };

export default function SettingsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
      contentContainerStyle={{ padding: spacing.lg, paddingTop: insets.top + spacing.lg }}
    >
      <Text style={[type.title, styles.screenTitle, { color: theme.text }]}>
        {t('nav.settings')}
      </Text>

      <Card title={t('settings.language')}>
        <SegmentedControl
          options={SUPPORTED_LOCALES.map((code) => ({ value: code, label: LOCALE_NAMES[code] }))}
          value={locale}
          onChange={(code) => void chooseLocale(code)}
        />
      </Card>

      <Card title={t('settings.dataLocationTitle')}>
        <Text style={[type.body, { color: theme.textMuted }]}>
          {t('settings.dataLocationBody')}
        </Text>
        <ListRow
          title={t('import.title')}
          trailing={<Feather name="chevron-right" size={18} color={theme.textMuted} />}
          onPress={() => router.push('/import')}
        />
      </Card>

      <AssistantSettings locale={INTL_LOCALE[locale]} />

      <Card title={t('categories.title')}>
        <Text style={[type.body, { color: theme.textMuted }]}>{t('categories.body')}</Text>
        <ListRow
          title={t('categories.manage')}
          trailing={<Feather name="chevron-right" size={18} color={theme.textMuted} />}
          onPress={() => router.push('/categories')}
        />
      </Card>

      <Card title={t('settings.autoExclusions')}>
        <Text style={[type.body, { color: theme.textMuted }]}>
          {t('settings.autoExclusionsBody')}
        </Text>
        {exclusions.length === 0 ? (
          <Text style={[type.label, { color: theme.textMuted }]}>
            {t('settings.autoExclusionsEmpty')}
          </Text>
        ) : (
          exclusions.map((rule, index) => (
            <ListRow
              key={rule.id}
              title={t('settings.autoExclusionsMatch', { key: exclusionKeyOf(rule) ?? rule.id })}
              divider={index < exclusions.length - 1}
              trailing={
                <Touchable
                  onPress={() => confirmDeleteExclusion(rule)}
                  accessibilityRole="button"
                  accessibilityLabel={t('common.delete')}
                >
                  <Feather name="trash-2" size={18} color={theme.expense} />
                </Touchable>
              }
            />
          ))
        )}
      </Card>

      <Card title={t('settings.rulesTitle')}>
        <Text style={[type.body, { color: theme.textMuted }]}>{t('settings.rulesBody')}</Text>
        <Button
          label={reapplying ? t('common.loading') : t('settings.reapplyRules')}
          variant="secondary"
          loading={reapplying}
          onPress={() => void reapplyRules()}
        />
        {reapplied !== null ? (
          <Text style={[type.label, { color: theme.textMuted }]}>
            {t('settings.reapplyRulesDone', { count: reapplied })}
          </Text>
        ) : null}
      </Card>

      <Card title={t('settings.data')}>
        {/* The one destructive action in the app. Its confirmation is
            unchanged; only the control around it is. */}
        <Button label={t('settings.eraseAll')} variant="danger" onPress={confirmErase} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenTitle: { marginBottom: spacing.lg },
});
