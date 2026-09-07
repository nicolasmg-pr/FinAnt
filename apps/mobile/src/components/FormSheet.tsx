import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing, type, useTheme } from '../design';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Sheet } from './ui/Sheet';

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
 * It owns no state: the caller keeps the draft, so a form can validate and
 * correct fields as they are typed. What it no longer owns is the modal, the
 * backdrop or the input styling — those are Sheet and Field now.
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
    <Sheet visible={visible} onDismiss={onCancel} title={title}>
      {subtitle ? <Text style={[type.body, { color: theme.textMuted }]}>{subtitle}</Text> : null}

      {fields.map((field) => (
        <Field
          key={field.key}
          label={field.label}
          value={field.value}
          onChangeText={field.onChangeText}
          placeholder={field.placeholder}
          autoCapitalize={field.autoCapitalize ?? 'sentences'}
          keyboardType={field.numeric ? 'decimal-pad' : 'default'}
        />
      ))}

      {error ? <Text style={[type.caption, { color: theme.expense }]}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} />
        {onDelete ? (
          <Button label={t('common.delete')} variant="danger" onPress={onDelete} />
        ) : null}
        <Button label={t('common.save')} onPress={onSave} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
