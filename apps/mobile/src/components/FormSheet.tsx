import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { radius, spacing, useTheme } from '../theme';

/** One labelled text input in a sheet. The value lives in the caller's draft. */
export interface SheetField {
  /** Stable across renders, so typing does not remount the input. */
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (text: string) => void;
  readonly placeholder?: string;
  readonly autoCapitalize?: 'none' | 'words';
  /** Amounts get the punctuation keyboard; everything else the default one. */
  readonly numeric?: boolean;
}

/**
 * The bottom sheet every short form on the Banks screen is made of: a title,
 * a list of labelled inputs, one error line, and cancel / delete / save.
 *
 * It exists because the same modal was written out once per form, and adding a
 * third would have meant a third copy of the backdrop, the input styling and
 * the action row. The sheet owns no state: the caller keeps the draft, so a
 * form can validate and correct fields as they are typed.
 */
export function FormSheet({
  visible,
  title,
  subtitle,
  fields,
  error,
  onCancel,
  onSave,
  onDelete,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  fields: readonly SheetField[];
  error?: string | null;
  onCancel: () => void;
  onSave: () => void;
  /** Omitted on a form that creates something: there is nothing to delete yet. */
  onDelete?: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          {subtitle ? <Text style={{ color: theme.textMuted }}>{subtitle}</Text> : null}

          {fields.map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={{ color: theme.textMuted }}>{field.label}</Text>
              <TextInput
                value={field.value}
                onChangeText={field.onChangeText}
                autoCapitalize={field.autoCapitalize ?? 'sentences'}
                keyboardType={field.numeric ? 'numbers-and-punctuation' : 'default'}
                inputMode={field.numeric ? 'text' : undefined}
                placeholder={field.placeholder}
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.surfaceAlt,
                  },
                ]}
              />
            </View>
          ))}

          {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.action} accessibilityRole="button">
              <Text style={{ color: theme.textMuted }}>{t('common.cancel')}</Text>
            </Pressable>
            {onDelete ? (
              <Pressable onPress={onDelete} style={styles.action} accessibilityRole="button">
                <Text style={{ color: theme.expense }}>{t('common.delete')}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onSave} style={styles.action} accessibilityRole="button">
              <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontSize: 17, fontWeight: '700' },
  field: { gap: spacing.xs },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  action: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
});
