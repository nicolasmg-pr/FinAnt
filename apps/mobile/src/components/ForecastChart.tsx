import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import type { MonthForecast } from '@finant/core';
import { spacing, useTheme } from '../theme';

const HEIGHT = 160;
const PADDING = 8;

/**
 * Twelve months of income and expense as paired bars, with the cumulative net
 * drawn over them. Projected months are hatched lighter than booked ones — a
 * forecast that looks identical to recorded fact invites the wrong decision.
 */
export function ForecastChart({ months, labels }: { months: readonly MonthForecast[]; labels: readonly string[] }) {
  const theme = useTheme();
  const [width, setWidth] = useState(320);

  const maxFlow = Math.max(1, ...months.flatMap((m) => [m.income.minor, m.expenses.minor]));
  const netValues = months.map((m) => m.cumulativeNet.minor);
  const netMax = Math.max(1, ...netValues.map(Math.abs));

  const innerWidth = width - PADDING * 2;
  const slot = innerWidth / months.length;
  const barWidth = Math.max(3, slot / 2 - 3);
  const scale = (minor: number) => (minor / maxFlow) * (HEIGHT - 30);

  const netPath = netValues
    .map((value, i) => {
      const x = PADDING + slot * i + slot / 2;
      const y = HEIGHT / 2 - (value / netMax) * (HEIGHT / 2 - 12);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Svg width="100%" height={HEIGHT}>
        <Line
          x1={PADDING}
          y1={HEIGHT - 20}
          x2={width - PADDING}
          y2={HEIGHT - 20}
          stroke={theme.border}
          strokeWidth={1}
        />
        {months.map((month, i) => {
          const x = PADDING + slot * i;
          const faded = month.kind === 'projected' ? 0.45 : 1;
          const incomeHeight = scale(month.income.minor);
          return (
            <Rect
              key={`${month.month}-income`}
              x={x}
              y={HEIGHT - 20 - incomeHeight}
              width={barWidth}
              height={incomeHeight}
              fill={theme.income}
              opacity={faded}
              rx={2}
            />
          );
        })}
        {months.map((month, i) => {
          const x = PADDING + slot * i + barWidth + 2;
          const faded = month.kind === 'projected' ? 0.45 : 1;
          const expenseHeight = scale(month.expenses.minor);
          return (
            <Rect
              key={`${month.month}-expense`}
              x={x}
              y={HEIGHT - 20 - expenseHeight}
              width={barWidth}
              height={expenseHeight}
              fill={theme.expense}
              opacity={faded}
              rx={2}
            />
          );
        })}
        <Path d={netPath} stroke={theme.accent} strokeWidth={2} fill="none" />
      </Svg>
      <View style={styles.labels}>
        {labels.map((label, i) => (
          <Text key={`${label}-${i}`} style={[styles.label, { color: theme.textMuted }]}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  label: { fontSize: 9 },
});
