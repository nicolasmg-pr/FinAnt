import { useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import type { NetWorthPoint } from '@finant/core';
import { useTheme } from '../theme';

const HEIGHT = 170;
const PADDING = 8;
const AXIS = 18;
/** Below this a point has no room to be read, so the chart scrolls instead. */
const MIN_SLOT = 26;

/**
 * The money held at the end of every period, as one line.
 *
 * Zero is always inside the vertical range: a total moving between 9.000 and
 * 9.200 € should read as level, and a chart fitted to its own two extremes
 * would draw that as a cliff.
 *
 * The projected tail is dashed and stroked separately. It is a projection, and
 * a projection drawn in the same ink as recorded fact is a lie by styling.
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
  const [width, setWidth] = useState(320);
  const scroller = useRef<ScrollView | null>(null);

  const values = points.map((point) => point.total.minor);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const slot = Math.max(MIN_SLOT, (width - PADDING * 2) / Math.max(1, points.length));
  const chartWidth = Math.max(width, slot * points.length + PADDING * 2);
  const plotHeight = HEIGHT - AXIS - PADDING;

  const x = (i: number) => PADDING + slot * i + slot / 2;
  const y = (minor: number) => PADDING + plotHeight - ((minor - min) / span) * plotHeight;

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

  const chart = (
    <Svg width={chartWidth} height={HEIGHT}>
      <Line
        x1={PADDING}
        y1={y(0)}
        x2={chartWidth - PADDING}
        y2={y(0)}
        stroke={theme.border}
        strokeWidth={1}
      />
      {booked ? <Path d={booked} stroke={theme.accent} strokeWidth={2} fill="none" /> : null}
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
          r={3.5}
          fill={theme.accent}
        />
      ) : null}
      {labels.map((label, i) =>
        label === '' ? null : (
          <SvgText
            key={`${label}-${i}`}
            x={x(i)}
            y={HEIGHT - 4}
            fill={theme.textMuted}
            fontSize={9}
            textAnchor="middle"
          >
            {label}
          </SvgText>
        ),
      )}
    </Svg>
  );

  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
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
