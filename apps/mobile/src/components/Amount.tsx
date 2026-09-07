import { Text, type TextStyle } from 'react-native';
import { formatMoney, type Money } from '@finant/core';
import { intlLocale } from '../i18n';
import { MAX_FONT_SCALE, typeMoney, useTheme, type TypeRole } from '../design';

/**
 * Renders a signed amount. `tone` decides the colour independently of the sign,
 * because an expense total is displayed as a positive magnitude but must still
 * read as money going out.
 *
 * `size` names a role in the type scale instead of letting each caller pass a
 * raw fontSize, which is how the app ended up with amounts at 30, 17, 14 and
 * 13 with no rule behind any of them.
 */
export function Amount({
  value,
  tone = 'auto',
  size = 'body',
  style,
}: {
  value: Money;
  tone?: 'auto' | 'income' | 'expense' | 'neutral';
  size?: TypeRole;
  style?: TextStyle;
}) {
  const theme = useTheme();
  const resolved =
    tone === 'auto' ? (value.minor > 0 ? 'income' : value.minor < 0 ? 'expense' : 'neutral') : tone;
  const color =
    resolved === 'income' ? theme.income : resolved === 'expense' ? theme.expense : theme.text;

  return (
    <Text style={[typeMoney[size], { color }, style]} maxFontSizeMultiplier={MAX_FONT_SCALE}>
      {formatMoney(value, intlLocale())}
    </Text>
  );
}
