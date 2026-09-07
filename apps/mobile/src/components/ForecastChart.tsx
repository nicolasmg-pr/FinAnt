import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { MonthForecast } from '@finant/core';
import { spacing, type as typeScale, useMotion, useTheme } from '../design';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const HEIGHT = 160;
const PADDING = 8;
const BASELINE = HEIGHT - 20;

/**
 * Twelve months of income and expense as paired bars, with the cumulative net
 * drawn over them. Projected months are faded against booked ones — a forecast
 * that looks identical to recorded fact invites the wrong decision.
 */
export function ForecastChart({
  months,
  labels,
}: {
  months: readonly MonthForecast[];
  labels: readonly string[];
}) {
  const theme = useTheme();
  const motion = useMotion();
  const [width, setWidth] = useState(320);

  // One growth pass on mount, not on every re-render.
  const grow = useSharedValue(motion.enabled ? 0 : 1);
  useEffect(() => {
    if (motion.enabled) grow.value = withTiming(1, { duration: motion.settle });
    else grow.value = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion.enabled]);

  const maxFlow = Math.max(1, ...months.flatMap((m) => [m.income.minor, m.expenses.minor]));
  const netValues = months.map((m) => m.cumulativeNet.minor);
  const netMax = Math.max(1, ...netValues.map(Math.abs));

  const innerWidth = width - PADDING * 2;
  const slot = innerWidth / Math.max(1, months.length);
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
          y1={BASELINE}
          x2={width - PADDING}
          y2={BASELINE}
          stroke={theme.border}
          strokeWidth={1}
        />
        {months.map((month, i) => (
          <Bar
            key={`${month.month}-income`}
            x={PADDING + slot * i}
            width={barWidth}
            full={scale(month.income.minor)}
            fill={theme.income}
            opacity={month.kind === 'projected' ? 0.45 : 1}
            grow={grow}
          />
        ))}
        {months.map((month, i) => (
          <Bar
            key={`${month.month}-expense`}
            x={PADDING + slot * i + barWidth + 2}
            width={barWidth}
            full={scale(month.expenses.minor)}
            fill={theme.expense}
            opacity={month.kind === 'projected' ? 0.45 : 1}
            grow={grow}
          />
        ))}
        {/* The halo first, then the line. Without it the net line disappears
            wherever it crosses a bar of similar lightness — which is why it
            uses accentInk rather than the accent in the first place. */}
        <Path d={netPath} stroke={theme.background} strokeWidth={4} fill="none" />
        <Path
          d={netPath}
          stroke={theme.accentInk}
          strokeWidth={2}
          strokeLinejoin="round"
          fill="none"
        />
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

/** One bar, growing from the axis rather than appearing at full height. */
function Bar({
  x,
  width,
  full,
  fill,
  opacity,
  grow,
}: {
  x: number;
  width: number;
  full: number;
  fill: string;
  opacity: number;
  grow: SharedValue<number>;
}) {
  const animated = useAnimatedProps(() => ({
    height: full * grow.value,
    y: BASELINE - full * grow.value,
  }));

  return (
    <AnimatedRect
      x={x}
      width={width}
      fill={fill}
      opacity={opacity}
      rx={4}
      animatedProps={animated}
    />
  );
}

const styles = StyleSheet.create({
  labels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  label: { fontSize: typeScale.caption.fontSize, letterSpacing: typeScale.caption.letterSpacing },
});
