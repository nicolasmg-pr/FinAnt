import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
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
  scroll = false,
  children,
}: {
  visible: boolean;
  onDismiss: () => void;
  title?: string;
  /** For a form taller than the screen. The panel caps at 85% of the viewport
   * and its body scrolls, rather than the sheet growing past the top edge. */
  scroll?: boolean;
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

  const panel = useAnimatedStyle(() => ({ transform: [{ translateY: translate.value }] }));
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

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.lift}
        >
          <Animated.View
            onLayout={(event) => {
              panelHeight.current = event.nativeEvent.layout.height;
            }}
            style={[
              styles.panel,
              scroll ? styles.capped : null,
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
            {scroll ? (
              <ScrollView
                contentContainerStyle={styles.scrollBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </ScrollView>
            ) : (
              children
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(0,0,0,0.4)' },
  lift: { justifyContent: 'flex-end', pointerEvents: 'box-none' },
  panel: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  capped: { maxHeight: '85%' },
  scrollBody: { gap: spacing.md, paddingBottom: spacing.sm },
  grip: { alignItems: 'center', paddingVertical: spacing.sm },
  handle: { width: 36, height: 4, borderRadius: radius.pill },
});
