import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Line,
  Path,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import Animated, {
  clamp,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withTiming,
} from 'react-native-reanimated';
import {
  formatAxisAmount,
  money,
  niceTicks,
  type Confidence,
  type NetWorthPoint,
} from '@finant/core';
import { intlLocale } from '../i18n';
import { grainSpacing, grainsAlong, type as typeScale, useMotion, useTheme } from '../design';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const HEIGHT = 190;
const PADDING = 8;
const AXIS = 18;
/** Below this a point has no room to be read, so the chart scrolls instead. */
const MIN_SLOT = 26;
/** How far a finger must travel before the drag is judged horizontal or
 * vertical, and the chart decides whether to take it. */
const DRAG_SLOP = 6;
/** Long enough to cover any path this chart can draw at phone width. */
const DASH_SPAN = 4000;
/** Radius of a projected-tail grain, in SVG px. Drives both its own draw and
 * the spacing between grains, so the two never drift apart. */
const GRAIN_RADIUS = 2.5;

/**
 * The money held at the end of every period, as one line.
 *
 * Zero is always inside the vertical range: a total moving between 9.000 and
 * 9.200 € should read as level, and a chart fitted to its own two extremes
 * would draw that as a cliff.
 *
 * The projected tail is a run of grains rather than a line, carries no gradient
 * underneath it, and is spaced by the confidence the forecast reported. It
 * keeps the same accent as the booked line — projected and booked are one
 * series, not two — and marks the difference by shape alone: discrete grains
 * instead of a continuous stroke, and no fill underneath, since a filled area
 * reads as more solid still and the fill stops where fact stops.
 *
 * `labels` is index-aligned with `points`; an empty string leaves a point
 * unlabelled, which is how the caller thins a long axis.
 */
export function BalanceChart({
  points,
  labels,
  confidence = 'medium',
}: {
  points: readonly NetWorthPoint[];
  labels: readonly string[];
  confidence?: Confidence;
}) {
  const theme = useTheme();
  const motion = useMotion();
  const [width, setWidth] = useState(320);

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
  // The projected run as points, then as grains along it. It starts on the last
  // booked point so the two meet, and `grainsAlong` puts the first grain one
  // spacing further on so no grain sits on top of a booked figure.
  const projectedPoints =
    firstProjected === -1
      ? []
      : points.slice(Math.max(0, lastActual)).map((point, i) => ({
          x: x(Math.max(0, lastActual) + i),
          y: y(point.total.minor),
        }));
  const grains = grainsAlong(projectedPoints, grainSpacing(confidence) + GRAIN_RADIUS * 2);

  // The booked line closed down to the zero baseline, so the gradient has an
  // area to fill.
  const bookedArea =
    booked && lastActual >= 0
      ? `${booked} L${x(lastActual).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
      : '';

  const revealProps = useAnimatedProps(() => ({ strokeDashoffset: reveal.value }));

  // How far the chart is panned from its oldest end, in px, and where that
  // stood when the current drag began.
  const maxPan = Math.max(0, chartWidth - width);
  const pan = useSharedValue(0);
  const panStart = useSharedValue(0);
  const touchStart = useSharedValue({ x: 0, y: 0 });

  // Opens on the newest end: years of history should not have to be scrolled
  // past to see what the owner holds now.
  useEffect(() => {
    pan.value = maxPan;
  }, [maxPan, pan]);

  /**
   * The tabs are a pager, so a horizontal drag over this chart is taken by
   * whichever gesture claims it first — and a chart that always claimed it
   * would be a dead zone for swiping between tabs. This one only claims a drag
   * it has room to answer: at the oldest end a further drag right, and at the
   * newest end a further drag left, are let through to the pager, which
   * changes tab. A mostly-vertical drag is always let through too, since it
   * belongs to the screen's own scroll. That is what a plain `ScrollView`
   * could not do — it claims every horizontal drag, room or not.
   */
  const drag = Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((event) => {
      const touch = event.allTouches[0];
      if (touch) touchStart.value = { x: touch.absoluteX, y: touch.absoluteY };
    })
    .onTouchesMove((event, manager) => {
      const touch = event.allTouches[0];
      if (!touch) return;
      const dx = touch.absoluteX - touchStart.value.x;
      const dy = touch.absoluteY - touchStart.value.y;
      if (Math.abs(dy) > Math.abs(dx)) {
        manager.fail();
        return;
      }
      if (Math.abs(dx) < DRAG_SLOP) return;
      // Dragging left pulls newer periods in, which needs room ahead.
      const room = dx < 0 ? pan.value < maxPan : pan.value > 0;
      if (room) manager.activate();
      else manager.fail();
    })
    .onStart(() => {
      panStart.value = pan.value;
    })
    .onUpdate((event) => {
      pan.value = clamp(panStart.value - event.translationX, 0, maxPan);
    })
    .onEnd((event) => {
      if (!motion.enabled) return;
      pan.value = withDecay({ velocity: -event.velocityX, clamp: [0, maxPan] });
    });

  const panned = useAnimatedStyle(() => ({ transform: [{ translateX: -pan.value }] }));

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
      {grains.map((grain) => (
        <Circle
          key={`grain-${grain.x.toFixed(1)}-${grain.y.toFixed(1)}`}
          cx={grain.x}
          cy={grain.y}
          r={GRAIN_RADIUS}
          fill={theme.accent}
        />
      ))}
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
        <View style={styles.viewport}>
          <GestureDetector gesture={drag}>
            <Animated.View style={[{ width: chartWidth }, panned]}>{chart}</Animated.View>
          </GestureDetector>
        </View>
      ) : (
        chart
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The panned content is wider than the card, so it has to be clipped.
  viewport: { flex: 1, overflow: 'hidden' },
});
