import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useElevation, useMotion, useTheme } from '../design';
import { SETTING_ASSISTANT_BUBBLE_POSITION, readSetting, writeSetting } from '../db/settings-repo';
import { Ant } from './mascot/Ant';

const SIZE = 56;
const MARGIN = 12;
/** Past this, the gesture was a drag and must not also count as a tap. */
const TAP_SLOP = 6;

type Edge = 'left' | 'right';

function parsePosition(stored: string | null): { edge: Edge; fraction: number } {
  const [edge, fraction] = (stored ?? '').split(':');
  const parsed = Number(fraction);
  return {
    edge: edge === 'left' ? 'left' : 'right',
    fraction: Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.72,
  };
}

/**
 * The ask bubble: a circle the owner drags anywhere and parks on either edge.
 *
 * It clings to a side rather than staying where it was dropped, because a
 * bubble floating in the middle of a movements list covers rows it is supposed
 * to help read. Its position is persisted: one that snaps back to a corner on
 * every launch is one the owner stops bothering to move.
 *
 * Rendered above the tab navigator, so it survives a tab change rather than
 * remounting — and so its drag is never fighting a screen transition.
 */
export function AskBubble({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const motion = useMotion();
  const elevation = useElevation(3);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { t } = useTranslation();

  const [ready, setReady] = useState(false);

  const minY = insets.top + MARGIN;
  // Clear of the tab bar: the bubble must never sit on top of navigation.
  const maxY = height - insets.bottom - SIZE - MARGIN - 64;
  const leftX = MARGIN;
  const rightX = width - SIZE - MARGIN;

  const x = useSharedValue(rightX);
  const y = useSharedValue(minY + (maxY - minY) * 0.72);
  const scale = useSharedValue(1);

  useEffect(() => {
    let alive = true;
    void readSetting(SETTING_ASSISTANT_BUBBLE_POSITION).then((stored) => {
      if (!alive) return;
      const { edge, fraction } = parsePosition(stored);
      x.value = edge === 'left' ? leftX : rightX;
      y.value = minY + (maxY - minY) * fraction;
      setReady(true);
    });
    return () => {
      alive = false;
    };
    // Recomputed on rotation: the parked edge is the same, its pixel is not.
  }, [leftX, rightX, minY, maxY, x, y]);

  const persist = useCallback((edge: Edge, fraction: number) => {
    void writeSetting(SETTING_ASSISTANT_BUBBLE_POSITION, `${edge}:${fraction.toFixed(3)}`);
  }, []);

  const pan = Gesture.Pan()
    .minDistance(TAP_SLOP)
    .onStart(() => {
      scale.value = withSpring(1.08, motion.spring);
    })
    .onChange((event) => {
      x.value += event.changeX;
      y.value += event.changeY;
    })
    .onEnd(() => {
      const edge: Edge = x.value + SIZE / 2 < width / 2 ? 'left' : 'right';
      const clampedY = Math.min(Math.max(y.value, minY), maxY);
      const fraction = maxY > minY ? (clampedY - minY) / (maxY - minY) : 0;

      x.value = withSpring(edge === 'left' ? leftX : rightX, motion.spring);
      y.value = withSpring(clampedY, motion.spring);
      scale.value = withSpring(1, motion.spring);
      runOnJS(persist)(edge, fraction);
    });

  const tap = Gesture.Tap()
    .maxDistance(TAP_SLOP)
    .onEnd(() => {
      runOnJS(onPress)();
    });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  if (!ready) return null;

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <Animated.View
        accessibilityRole="button"
        accessibilityLabel={t('assistant.bubbleLabel')}
        style={[styles.bubble, { backgroundColor: theme.accent }, elevation, style]}
      >
        <Ant pose="face" size={34} variant="onAccent" />
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
