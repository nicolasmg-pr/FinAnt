import { useState } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { radius, spacing, type, useTheme } from '../../design';

/**
 * Label + input + hint/error. The same three lines were written out by hand in
 * movement/new, categories, budgets, banks and AccountPicker, each with its
 * own padding.
 */
export function Field({
  label,
  hint,
  error,
  style,
  ...input
}: TextInputProps & { label: string; hint?: string; error?: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: theme.textMuted }]}>{label}</Text>
      <TextInput
        {...input}
        onFocus={(event) => {
          setFocused(true);
          input.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          input.onBlur?.(event);
        }}
        placeholderTextColor={theme.textMuted}
        style={[
          styles.input,
          type.body,
          {
            backgroundColor: theme.surfaceSunken,
            color: theme.text,
            borderColor: error ? theme.expense : focused ? theme.accent : 'transparent',
          },
          style,
        ]}
      />
      {error ? (
        <Text style={[type.caption, { color: theme.expense }]}>{error}</Text>
      ) : hint ? (
        <Text style={[type.caption, { color: theme.textMuted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
});
