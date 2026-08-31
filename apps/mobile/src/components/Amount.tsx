import { Text, type TextStyle } from 'react-native';
import { formatMoney, type Money } from '@finant/core';
import { intlLocale } from '../i18n';
import { useTheme } from '../theme';

/**
 * Renders a signed amount. `tone` decides the colour independently of the sign,
 * because an expense total is displayed as a positive magnitude but must still
 * read as money going out.
 */
export function Amount({ value, tone = 'auto', style }: {
  value: Money;
  tone?: 'auto' | 'income' | 'expense' | 'neutral';
  style?: TextStyle;
}) {
  const theme = useTheme();
  const resolved =
    tone === 'auto' ? (value.minor > 0 ? 'income' : value.minor < 0 ? 'expense' : 'neutral') : tone;
  const color =
    resolved === 'income' ? theme.income : resolved === 'expense' ? theme.expense : theme.text;

  return (
    <Text style={[{ color, fontVariant: ['tabular-nums'] }, style]}>
      {formatMoney(value, intlLocale())}
    </Text>
  );
}
