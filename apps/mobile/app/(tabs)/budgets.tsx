import { ScrollView, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../../src/components/Card';
import { spacing, useTheme } from '../../src/theme';

/**
 * TODO(budgets): per-category monthly limits with progress against the current
 * month. The `budgets` table and the `Budget` domain type already exist; this
 * screen is the remaining UI work.
 */
export default function BudgetsScreen() {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <ScrollView
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={{ padding: spacing.lg }}
    >
      <Card title={t('budgets.title')}>
        <Text style={{ color: theme.textMuted }}>{t('budgets.noBudgets')}</Text>
      </Card>
    </ScrollView>
  );
}
