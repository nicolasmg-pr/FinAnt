import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { UNCATEGORISED_ID, type Category, type CategoryKind } from '@finant/core';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { CategoryChip } from '../src/components/CategoryChip';
import { Button } from '../src/components/ui/Button';
import { Field } from '../src/components/ui/Field';
import { ListRow } from '../src/components/ui/ListRow';
import { SectionHeader } from '../src/components/ui/SectionHeader';
import { Sheet } from '../src/components/ui/Sheet';
import { Touchable } from '../src/components/ui/Touchable';
import {
  archiveCategory,
  countRulesForCategory,
  countTransactionsInCategory,
  createCategory,
  deleteCategory,
  unarchiveCategory,
  updateCategory,
} from '../src/db/categories-repo';
import { useCategories } from '../src/hooks/use-categories';
import { useCategoryLabel } from '../src/hooks/use-category-label';
import { categoryRamp, radius, spacing, type, useTheme } from '../src/design';

const KINDS: readonly CategoryKind[] = ['expense', 'income', 'transfer'];

/**
 * The shared pastel ramp first, then the shipped taxonomy's own colours. A
 * category colour has one job — telling two bars on the dashboard apart — and
 * a free picker mostly produces two categories a shade apart that no longer do.
 *
 * Nothing here rewrites a colour a category already holds; this only seeds the
 * picker and a new category's default.
 */
const PALETTE: readonly string[] = [
  ...categoryRamp,
  '#2E7D32',
  '#7CB342',
  '#00897B',
  '#00ACC1',
  '#039BE5',
  '#3949AB',
  '#5E35B1',
  '#8E24AA',
  '#D81B60',
  '#F4511E',
  '#FB8C00',
  '#6D4C41',
  '#546E7A',
  '#9E9E9E',
];

/** A shortlist of Feather names, the icon set the app already bundles. */
const ICONS: readonly string[] = [
  'tag',
  'shopping-bag',
  'shopping-cart',
  'coffee',
  'home',
  'heart',
  'gift',
  'book',
  'music',
  'truck',
  'umbrella',
  'tool',
  'users',
  'briefcase',
  'zap',
  'wifi',
  'activity',
  'smile',
  'star',
  'credit-card',
];

type FeatherName = keyof typeof Feather.glyphMap;

/**
 * Some shipped categories carry an icon name Feather does not have. Rendering
 * an unknown name shows nothing at all, so those fall back to a generic tag
 * instead of leaving a hole in the row.
 */
function featherName(icon: string): FeatherName {
  return icon in Feather.glyphMap ? (icon as FeatherName) : 'tag';
}

interface Draft {
  /** Null for a category being created. An id is never editable. */
  id: string | null;
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
  builtIn: boolean;
  /** The field is pre-filled with the *translated* label, so an untouched name
   * must not be written back: saving it would turn a shipped category into an
   * owner-named one just because the colour changed. */
  nameTouched: boolean;
}

/** What the owner has to decide before a category holding movements can go. */
interface Removal {
  category: Category;
  movements: number;
  rules: number;
}

export default function CategoriesScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const label = useCategoryLabel();
  const { list, selectable, reload } = useCategories();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [replacementId, setReplacementId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const live = list.filter((c) => !c.archived);
  const hidden = list.filter((c) => c.archived);

  const openNew = () => {
    setFormError(null);
    setDraft({
      id: null,
      name: '',
      kind: 'expense',
      color: PALETTE[0] ?? '#546E7A',
      icon: 'tag',
      builtIn: false,
      nameTouched: true,
    });
  };

  const openEdit = (category: Category) => {
    setFormError(null);
    setDraft({
      id: category.id,
      name: label(category.id),
      kind: category.kind,
      color: category.color,
      icon: category.icon,
      builtIn: category.builtIn,
      nameTouched: false,
    });
  };

  const patchDraft = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const commit = useCallback(async () => {
    if (!draft || busy) return;
    if (draft.nameTouched && draft.name.trim() === '') {
      setFormError(t('categories.nameRequired'));
      return;
    }
    setBusy(true);
    try {
      if (draft.id === null) {
        await createCategory({
          name: draft.name,
          kind: draft.kind,
          color: draft.color,
          icon: draft.icon,
        });
      } else {
        await updateCategory(draft.id, {
          ...(draft.nameTouched ? { name: draft.name } : {}),
          color: draft.color,
          icon: draft.icon,
          // The kind of a shipped category is not offered, and the repository
          // refuses it as well: its shipped rules assume that side of the ledger.
          ...(draft.builtIn ? {} : { kind: draft.kind }),
        });
      }
      await reload();
      setDraft(null);
    } catch (cause) {
      setFormError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [draft, busy, reload, t]);

  const toggleArchive = (category: Category) => {
    const run = async () => {
      if (category.archived) await unarchiveCategory(category.id);
      else await archiveCategory(category.id);
      await reload();
      setDraft(null);
    };
    if (category.archived) {
      void run();
      return;
    }
    Alert.alert(t('categories.hide'), t('categories.hideConfirm', { name: label(category.id) }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('categories.hide'), onPress: () => void run() },
    ]);
  };

  /**
   * Deleting a category the owner created. A category still holding movements
   * sends them to the reassignment sheet first: `transactions.category_id` is
   * `ON DELETE SET NULL`, so deleting one out from under its movements would
   * silently uncategorise every one of them.
   */
  const startDelete = (category: Category) => {
    void (async () => {
      const [movements, rules] = await Promise.all([
        countTransactionsInCategory(category.id),
        countRulesForCategory(category.id),
      ]);
      if (movements > 0) {
        setDraft(null);
        setReplacementId(null);
        setRemoval({ category, movements, rules });
        return;
      }
      const detail = [
        t('categories.noMovements'),
        rules > 0 ? t('categories.rulesDeleted', { count: rules }) : '',
      ]
        .filter((line) => line !== '')
        .join(' ');
      Alert.alert(t('categories.deleteConfirm', { name: label(category.id) }), detail, [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () =>
            void (async () => {
              await deleteCategory(category.id);
              await reload();
              setDraft(null);
            })(),
        },
      ]);
    })();
  };

  const commitRemoval = useCallback(async () => {
    if (!removal || replacementId === null || busy) return;
    setBusy(true);
    try {
      await deleteCategory(removal.category.id, replacementId);
      await reload();
      setRemoval(null);
      setReplacementId(null);
    } catch (cause) {
      setFormError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [removal, replacementId, busy, reload]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: t('categories.title') }} />
      <ScrollView contentContainerStyle={styles.screen}>
        <Card>
          <Text style={[type.body, { color: theme.textMuted }]}>{t('categories.body')}</Text>
        </Card>

        {KINDS.map((kind) => {
          const group = live.filter((c) => c.kind === kind);
          if (group.length === 0) return null;
          return (
            <Card key={kind} title={t(`categories.kinds.${kind}`)}>
              {group.map((category, index) => (
                <Row
                  key={category.id}
                  category={category}
                  divider={index < group.length - 1}
                  onPress={() => openEdit(category)}
                />
              ))}
            </Card>
          );
        })}

        <Card>
          <Touchable
            onPress={() => setShowHidden((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showHidden }}
            style={styles.disclosure}
          >
            <Text style={[type.heading, { color: theme.text }]}>
              {t('categories.hiddenSection')}
              {hidden.length > 0 ? ` · ${hidden.length}` : ''}
            </Text>
            <Feather
              name={showHidden ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.textMuted}
            />
          </Touchable>
          {showHidden ? (
            hidden.length === 0 ? (
              <Text style={[type.label, { color: theme.textMuted }]}>
                {t('categories.hiddenEmpty')}
              </Text>
            ) : (
              hidden.map((category, index) => (
                <Row
                  key={category.id}
                  category={category}
                  divider={index < hidden.length - 1}
                  onPress={() => openEdit(category)}
                />
              ))
            )
          ) : null}
        </Card>

        <Button label={t('categories.add')} icon="plus" onPress={openNew} />
      </ScrollView>

      <Sheet
        visible={draft !== null}
        onDismiss={() => setDraft(null)}
        title={draft?.id === null ? t('categories.add') : t('categories.edit')}
      >
        <Field
          label={t('categories.name')}
          value={draft?.name ?? ''}
          onChangeText={(name) => {
            setFormError(null);
            patchDraft({ name, nameTouched: true });
          }}
          placeholder={t('categories.namePlaceholder')}
        />

        <SectionHeader label={t('categories.kind')} />
        <View style={styles.chips}>
          {KINDS.map((kind) => {
            const locked = draft?.builtIn === true;
            return (
              <View key={kind} style={{ opacity: locked && draft?.kind !== kind ? 0.4 : 1 }}>
                <Chip
                  label={t(`categories.kinds.${kind}`)}
                  selected={draft?.kind === kind}
                  onPress={() => !locked && patchDraft({ kind })}
                />
              </View>
            );
          })}
        </View>
        {draft?.builtIn ? (
          <Text style={[type.label, { color: theme.textMuted }]}>{t('categories.kindLocked')}</Text>
        ) : null}

        <SectionHeader label={t('categories.colour')} />
        <View style={styles.swatches}>
          {PALETTE.map((color) => (
            <Touchable
              key={color}
              onPress={() => patchDraft({ color })}
              accessibilityRole="button"
              accessibilityLabel={color}
              accessibilityState={{ selected: draft?.color === color }}
              style={[
                styles.swatch,
                {
                  backgroundColor: color,
                  borderColor: draft?.color === color ? theme.text : 'transparent',
                },
              ]}
            >
              <View />
            </Touchable>
          ))}
        </View>

        <SectionHeader label={t('categories.icon')} />
        <View style={styles.swatches}>
          {ICONS.map((icon) => (
            <Touchable
              key={icon}
              onPress={() => patchDraft({ icon })}
              accessibilityRole="button"
              accessibilityLabel={icon}
              accessibilityState={{ selected: draft?.icon === icon }}
              style={[
                styles.iconOption,
                {
                  backgroundColor: draft?.icon === icon ? theme.accentSoft : theme.surfaceSunken,
                },
              ]}
            >
              <Feather name={featherName(icon)} size={18} color={theme.text} />
            </Touchable>
          ))}
        </View>

        {formError ? <Text style={[type.label, { color: theme.expense }]}>{formError}</Text> : null}

        {draft?.id !== null && draft !== null ? (
          <View style={styles.dangerZone}>
            <Button
              label={
                list.find((c) => c.id === draft.id)?.archived
                  ? t('categories.unhide')
                  : t('categories.hide')
              }
              variant="secondary"
              onPress={() => {
                const category = list.find((c) => c.id === draft.id);
                if (category) toggleArchive(category);
              }}
            />
            {draft.builtIn ? (
              <Text style={[type.label, { color: theme.textMuted }]}>
                {t('categories.hideExplain')}
              </Text>
            ) : (
              <Button
                label={t('common.delete')}
                variant="danger"
                onPress={() => {
                  const category = list.find((c) => c.id === draft.id);
                  if (category) startDelete(category);
                }}
              />
            )}
          </View>
        ) : null}

        <View style={styles.sheetActions}>
          <Button label={t('common.cancel')} variant="secondary" onPress={() => setDraft(null)} />
          <Button label={t('common.save')} loading={busy} onPress={() => void commit()} />
        </View>
      </Sheet>

      <Sheet
        visible={removal !== null}
        onDismiss={() => {
          setRemoval(null);
          setReplacementId(null);
        }}
        title={t('categories.reassignTitle')}
      >
        {removal ? (
          <>
            <Text style={[type.body, { color: theme.textMuted }]}>
              {t('categories.reassignBody', {
                count: removal.movements,
                name: label(removal.category.id),
              })}
            </Text>
            {removal.rules > 0 ? (
              <Text style={[type.label, { color: theme.textMuted }]}>
                {t('categories.rulesDeleted', { count: removal.rules })}
              </Text>
            ) : null}
            <SectionHeader label={t('categories.reassignTo')} />
            <View style={styles.chips}>
              {selectable
                .filter((c) => c.id !== removal.category.id && c.id !== UNCATEGORISED_ID)
                .map((category) => (
                  <CategoryChip
                    key={category.id}
                    category={category}
                    label={label(category.id)}
                    selected={replacementId === category.id}
                    onPress={() => setReplacementId(category.id)}
                  />
                ))}
            </View>
          </>
        ) : null}

        {formError ? <Text style={[type.label, { color: theme.expense }]}>{formError}</Text> : null}

        <View style={styles.sheetActions}>
          <Button
            label={t('common.cancel')}
            variant="secondary"
            onPress={() => {
              setRemoval(null);
              setReplacementId(null);
            }}
          />
          <Button
            label={t('categories.reassignConfirm')}
            variant="danger"
            disabled={replacementId === null}
            loading={busy}
            onPress={() => void commitRemoval()}
          />
        </View>
      </Sheet>
    </View>
  );
}

/** One category: its colour and icon, its label, and whether it is ours or the owner's. */
function Row({
  category,
  divider,
  onPress,
}: {
  category: Category;
  divider: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const label = useCategoryLabel();

  return (
    <ListRow
      title={label(category.id)}
      subtitle={category.builtIn ? t('categories.builtInTag') : undefined}
      divider={divider}
      onPress={onPress}
      leading={
        <View style={[styles.icon, { backgroundColor: category.color }]}>
          <Feather name={featherName(category.icon)} size={14} color="#FFFFFF" />
        </View>
      }
      trailing={<Feather name="chevron-right" size={18} color={theme.textMuted} />}
    />
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  icon: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: 2 },
  iconOption: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerZone: { gap: spacing.sm, marginTop: spacing.sm },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
