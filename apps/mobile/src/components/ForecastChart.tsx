import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Svg, { Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { formatAxisAmount, money, niceTicks, type MonthForecast } from '@finant/core';
import { intlLocale } from '../i18n';
import { type as typeScale, useMotion, useTheme } from '../design';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

const HEIGHT = 180;
const PADDING = 8;
/** Room for the tick values down the left edge. Wide enough for a grouped
 * figure in full ("20,000"), because Hermes ignores compact notation. */
const GUTTER = 54;
/** Room for the month labels along the bottom. */
const AXIS = 16;

/**
 * Twelve months of income and expense as paired bars, with the cumulative net
 * drawn over them. Projected months are faded against booked ones — a forecast
 * that looks identical to recorded fact invites the wrong decision.
 *
 * Bars and the net line share one vertical scale. They used to have two, which
 * fit each of them to its own extreme and made the chart denser; the moment the
 * chart gained gridlines that became untenable, because a line crossing the
 * "3.000" guide has to mean 3.000.
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

  const netValues = months.map((m) => m.cumulativeNet.minor);
  const flows = months.flatMap((m) => [m.income.minor, m.expenses.minor]);
  const max = Math.max(1, ...flows, ...netValues);
  const min = Math.min(0, ...netValues);
  const span = max - min || 1;

  const plotHeight = HEIGHT - AXIS - PADDING;
  const innerWidth = width - GUTTER - PADDING;
  const slot = innerWidth / Math.max(1, months.length);
  const barWidth = Math.max(3, slot / 2 - 3);

  const y = (minor: number) => PADDING + plotHeight - ((minor - min) / span) * plotHeight;
  const baseline = y(0);
  /** Centre of a month's bar pair — what its label has to line up with. */
  const centre = (i: number) => GUTTER + slot * i + barWidth + 1;

  const currency = months[0]?.income.currency ?? 'EUR';
  // Four here, three on the balance chart: this one has bars to measure
  // against, where that one is a hero the guides should not clutter.
  const ticks = niceTicks(min, max);

  const netPath = netValues
    .map((value, i) => `${i === 0 ? 'M' : 'L'}${centre(i).toFixed(1)},${y(value).toFixed(1)}`)
    .join(' ');

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Svg width="100%" height={HEIGHT}>
        {ticks.map((tick) => (
          <Line
            key={`grid-${tick}`}
            x1={GUTTER}
            y1={y(tick)}
            x2={width - PADDING}
            y2={y(tick)}
            stroke={theme.border}
            strokeWidth={1}
            strokeDasharray={tick === 0 ? undefined : '3 5'}
          />
        ))}
        {ticks.map((tick) => (
          <SvgText
            key={`tick-${tick}`}
            x={GUTTER - 6}
            y={y(tick) + 3}
            fill={theme.textMuted}
            fontSize={typeScale.caption.fontSize}
            textAnchor="end"
          >
            {formatAxisAmount(money(tick, currency), intlLocale())}
          </SvgText>
        ))}

        {months.map((month, i) => (
          <Bar
            key={`${month.month}-income`}
            x={GUTTER + slot * i}
            width={barWidth}
            baseline={baseline}
            full={baseline - y(month.income.minor)}
            fill={theme.income}
            opacity={month.kind === 'projected' ? 0.45 : 1}
            grow={grow}
          />
        ))}
        {months.map((month, i) => (
          <Bar
            key={`${month.month}-expense`}
            x={GUTTER + slot * i + barWidth + 2}
            width={barWidth}
            baseline={baseline}
            full={baseline - y(month.expenses.minor)}
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

        {/* Inside the SVG, at the bar pair's own centre. These used to be a
            flexbox row underneath, which put label i wherever space-between
            happened to leave it — never above its bar. */}
        {labels.map((label, i) =>
          label === '' ? null : (
            <SvgText
              key={`${label}-${i}`}
              x={centre(i)}
              y={HEIGHT - 3}
              fill={theme.textMuted}
              fontSize={typeScale.caption.fontSize}
              textAnchor="middle"
            >
              {label}
            </SvgText>
          ),
        )}
      </Svg>
    </View>
  );
}

/** One bar, growing from the axis rather than appearing at full height. */
function Bar({
  x,
  width,
  baseline,
  full,
  fill,
  opacity,
  grow,
}: {
  x: number;
  width: number;
  baseline: number;
  full: number;
  fill: string;
  opacity: number;
  grow: SharedValue<number>;
}) {
  const animated = useAnimatedProps(() => ({
    height: Math.max(0, full * grow.value),
    y: baseline - Math.max(0, full * grow.value),
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
