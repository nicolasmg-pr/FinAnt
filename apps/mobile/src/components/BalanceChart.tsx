import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import { formatAxisAmount, money, niceTicks, type NetWorthPoint } from '@finant/core';
import { intlLocale } from '../i18n';
import { type as typeScale, useMotion, useTheme } from '../design';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const HEIGHT = 190;
const PADDING = 8;
const AXIS = 18;
/** Below this a point has no room to be read, so the chart scrolls instead. */
const MIN_SLOT = 26;
/** Long enough to cover any path this chart can draw at phone width. */
const DASH_SPAN = 4000;

/**
 * The money held at the end of every period, as one line.
 *
 * Zero is always inside the vertical range: a total moving between 9.000 and
 * 9.200 € should read as level, and a chart fitted to its own two extremes
 * would draw that as a cliff.
 *
 * The projected tail is dashed, stroked separately, and — unlike the booked
 * run — carries no gradient underneath it. It is a projection, and a
 * projection drawn in the same ink as recorded fact is a lie by styling; a
 * filled area reads as more solid still, so the fill stops where fact stops.
 *
 * `labels` is index-aligned with `points`; an empty string leaves a point
 * unlabelled, which is how the caller thins a long axis.
 */
export function BalanceChart({
  points,
  labels,
}: {
  points: readonly NetWorthPoint[];
  labels: readonly string[];
}) {
  const theme = useTheme();
  const motion = useMotion();
  const [width, setWidth] = useState(320);
  const scroller = useRef<ScrollView | null>(null);

  // Drawn once, on mount. A line that redraws itself every time the data
  // changes is noise, not feedback.
  const reveal = useSharedValue(motion.enabled ? DASH_SPAN : 0);
  useEffect(() => {
    if (motion.enabled) reveal.value = withTiming(0, { duration: motion.settle });
    else reveal.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion.enabled]);

  const values = points.map((point) => point.total.minor);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const slot = Math.max(MIN_SLOT, (width - PADDING * 2) / Math.max(1, points.length));
  const chartWidth = Math.max(width, slot * points.length + PADDING * 2);
  const plotHeight = HEIGHT - AXIS - PADDING;

  const x = (i: number) => PADDING + slot * i + slot / 2;
  const y = (minor: number) => PADDING + plotHeight - ((minor - min) / span) * plotHeight;

  const currency = points[0]?.total.currency ?? 'EUR';
  const ticks = niceTicks(min, max, 3);

  const path = (from: number, to: number) =>
    points
      .slice(from, to)
      .map(
        (point, i) =>
          `${i === 0 ? 'M' : 'L'}${x(from + i).toFixed(1)},${y(point.total.minor).toFixed(1)}`,
      )
      .join(' ');

  const firstProjected = points.findIndex((point) => point.kind === 'projected');
  const lastActual = firstProjected === -1 ? points.length - 1 : firstProjected - 1;
  const booked = path(0, lastActual + 1);
  // The dashed run starts on the last booked point, so the two meet instead of
  // leaving a gap where the projection takes over.
  const projected = firstProjected === -1 ? '' : path(Math.max(0, lastActual), points.length);

  // The booked line closed down to the zero baseline, so the gradient has an
  // area to fill.
  const bookedArea =
    booked && lastActual >= 0
      ? `${booked} L${x(lastActual).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
      : '';

  const revealProps = useAnimatedProps(() => ({ strokeDashoffset: reveal.value }));

  /**
   * Gridlines and their values, in their own SVG behind the line and pinned to
   * the viewport. They belong to the vertical scale, which does not move when
   * the chart is panned sideways — and this chart opens scrolled to its newest
   * end, so a value drawn inside the scrolling content would start off screen.
   */
  const guides = (
    <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill}>
      {ticks.map((tick) => (
        <Line
          key={`grid-${tick}`}
          x1={0}
          y1={y(tick)}
          x2={width}
          y2={y(tick)}
          stroke={theme.border}
          strokeWidth={1}
          // Zero is the one line worth stating plainly; the rest only orient.
          strokeDasharray={tick === 0 ? undefined : '3 5'}
        />
      ))}
      {ticks.map((tick) => (
        <SvgText
          key={`tick-${tick}`}
          x={PADDING}
          y={y(tick) - 3}
          fill={theme.textMuted}
          fontSize={typeScale.caption.fontSize}
        >
          {formatAxisAmount(money(tick, currency), intlLocale())}
        </SvgText>
      ))}
    </Svg>
  );

  const chart = (
    <Svg width={chartWidth} height={HEIGHT}>
      <Defs>
        <LinearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={theme.accent} stopOpacity={0.18} />
          <Stop offset="1" stopColor={theme.accent} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {bookedArea ? <Path d={bookedArea} fill="url(#balanceFill)" /> : null}
      {booked ? (
        <AnimatedPath
          d={booked}
          stroke={theme.accent}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={DASH_SPAN}
          animatedProps={revealProps}
        />
      ) : null}
      {projected ? (
        <Path
          d={projected}
          stroke={theme.accent}
          strokeWidth={2}
          strokeDasharray="5 4"
          opacity={0.6}
          fill="none"
        />
      ) : null}
      {lastActual >= 0 ? (
        <Circle
          cx={x(lastActual)}
          cy={y(points[lastActual]?.total.minor ?? 0)}
          r={4}
          fill={theme.accent}
          stroke={theme.background}
          strokeWidth={2}
        />
      ) : null}
      {labels.map((label, i) =>
        label === '' ? null : (
          <SvgText
            key={`${label}-${i}`}
            x={x(i)}
            y={HEIGHT - 4}
            fill={theme.textMuted}
            // svg's Text takes a number, not a style role.
            fontSize={typeScale.caption.fontSize}
            textAnchor="middle"
          >
            {label}
          </SvgText>
        ),
      )}
    </Svg>
  );

  return (
    <View style={{ height: HEIGHT }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {guides}
      {chartWidth > width ? (
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          // Opens on the newest end: years of history should not have to be
          // scrolled past to see what the owner holds now.
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })}
        >
          {chart}
        </ScrollView>
      ) : (
        chart
      )}
    </View>
  );
}
