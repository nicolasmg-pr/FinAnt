import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing, type, useElevation, useMotion, useTheme } from '../../design';

/** Past this fraction of the panel height, letting go dismisses. */
const DISMISS_AT = 0.25;

/** How much of the space above the keyboard one sheet may take. */
const PANEL_CAP = 0.85;

/**
 * The one bottom sheet. Budgets and Categories each hand-built a Modal with
 * their own backdrop and their own panel styling, next to the FormSheet that
 * already did the same job; all three are this now.
 *
 * Dismissal never depends on the drag: the backdrop and the hardware back
 * button always work, so the sheet cannot become a trap if the pan responder
 * loses to a scroll view inside it.
 */
export function Sheet({
  visible,
  onDismiss,
  title,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const motion = useMotion();
  const insets = useSafeAreaInsets();
  const elevation = useElevation(3);
  const { height: screenHeight } = useWindowDimensions();

  const translate = useSharedValue(screenHeight);
  const fade = useSharedValue(0);
  // Measured on layout so the drag threshold is a fraction of the real panel,
  // not of the screen.
  const panelHeight = useRef(screenHeight);

  useEffect(() => {
    if (visible) {
      translate.value = withSpring(0, motion.spring);
      fade.value = withTiming(1, { duration: motion.quick });
    } else {
      translate.value = screenHeight;
      fade.value = 0;
    }
  }, [visible, screenHeight, motion, translate, fade]);

  // `height` is written for `translateY`, so it runs from -keyboardHeight to 0.
  // The panel is lifted clear of the keyboard and capped to what is left above
  // it: a form that no longer fits scrolls inside the panel rather than
  // keeping its lower fields under the keys. See docs/keyboard-handling.md.
  const keyboard = useReanimatedKeyboardAnimation();

  const panel = useAnimatedStyle(() => ({
    transform: [{ translateY: translate.value }],
    marginBottom: -keyboard.height.value,
    maxHeight: (screenHeight + keyboard.height.value) * PANEL_CAP,
  }));
  const backdrop = useAnimatedStyle(() => ({ opacity: fade.value }));

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim the gesture only once it is clearly a downward drag, so a
        // scrollable child keeps its own vertical gestures.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.dy > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          if (gesture.dy > 0) translate.value = gesture.dy;
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > panelHeight.current * DISMISS_AT) {
            translate.value = withTiming(
              panelHeight.current,
              { duration: motion.quick },
              (finished) => {
                if (finished) runOnJS(onDismiss)();
              },
            );
          } else {
            translate.value = withSpring(0, motion.spring);
          }
        },
      }),
    [motion, onDismiss, translate],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, backdrop]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>

        <View style={styles.lift}>
          <Animated.View
            onLayout={(event) => {
              panelHeight.current = event.nativeEvent.layout.height;
            }}
            style={[
              styles.panel,
              { backgroundColor: theme.surface, paddingBottom: insets.bottom + spacing.lg },
              elevation,
              panel,
            ]}
          >
            <View {...responder.panHandlers} style={styles.grip}>
              <View style={[styles.handle, { backgroundColor: theme.border }]} />
            </View>
            {title ? (
              <Text style={[type.title, { color: theme.text }]} accessibilityRole="header">
                {title}
              </Text>
            ) : null}
            {/* Always scrollable, never taller than `panel`'s cap: with the
              keyboard up the panel only has the space above it, and a form
              that cannot scroll inside that space leaves its lower fields
              under the keyboard — which is what the Filters sheet did. */}
            <ScrollView
              contentContainerStyle={styles.scrollBody}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </Animated.View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  lift: { flex: 1, justifyContent: 'flex-end', pointerEvents: 'box-none' },
  panel: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  scrollBody: { gap: spacing.md, paddingBottom: spacing.sm },
  grip: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: radius.pill },
});
