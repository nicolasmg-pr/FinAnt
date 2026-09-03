import { useCallback, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { UNCATEGORISED_ID, type Category, type CategoryKind } from '@finant/core';
import { Card } from '../src/components/Card';
import { CategoryChip } from '../src/components/CategoryChip';
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
import { radius, spacing, useTheme } from '../src/theme';

const KINDS: readonly CategoryKind[] = ['expense', 'income', 'transfer'];

/**
 * A dozen colours drawn from the shipped taxonomy rather than a colour picker.
 * A category colour has one job — telling two bars on the dashboard apart — and
 * a free picker mostly produces two categories a shade apart that no longer do.
 */
const PALETTE: readonly string[] = [
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
        <Card title={t('categories.title')}>
          <Text style={{ color: theme.textMuted }}>{t('categories.body')}</Text>
        </Card>

        {KINDS.map((kind) => {
          const group = live.filter((c) => c.kind === kind);
          if (group.length === 0) return null;
          return (
            <Card key={kind} title={t(`categories.kinds.${kind}`)}>
              {group.map((category) => (
                <Row key={category.id} category={category} onPress={() => openEdit(category)} />
              ))}
            </Card>
          );
        })}

        <Card>
          <Pressable
            onPress={() => setShowHidden((open) => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showHidden }}
            style={styles.disclosure}
          >
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              {t('categories.hiddenSection')}
              {hidden.length > 0 ? ` · ${hidden.length}` : ''}
            </Text>
            <Feather
              name={showHidden ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={theme.textMuted}
            />
          </Pressable>
          {showHidden ? (
            hidden.length === 0 ? (
              <Text style={{ color: theme.textMuted }}>{t('categories.hiddenEmpty')}</Text>
            ) : (
              hidden.map((category) => (
                <Row key={category.id} category={category} onPress={() => openEdit(category)} />
              ))
            )
          ) : null}
        </Card>

        <Pressable
          onPress={openNew}
          accessibilityRole="button"
          style={[styles.addButton, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.addButtonText}>{t('categories.add')}</Text>
        </Pressable>
      </ScrollView>

      <Modal
        visible={draft !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDraft(null)}
      >
        <View style={styles.sheetBackdrop}>
          <ScrollView
            style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              {draft?.id === null ? t('categories.add') : t('categories.edit')}
            </Text>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {t('categories.name')}
            </Text>
            <TextInput
              value={draft?.name ?? ''}
              onChangeText={(name) => {
                setFormError(null);
                patchDraft({ name, nameTouched: true });
              }}
              placeholder={t('categories.namePlaceholder')}
              placeholderTextColor={theme.textMuted}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.border, backgroundColor: theme.surfaceAlt },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {t('categories.kind')}
            </Text>
            <View style={styles.chips}>
              {KINDS.map((kind) => {
                const active = draft?.kind === kind;
                const locked = draft?.builtIn === true;
                return (
                  <Pressable
                    key={kind}
                    onPress={() => !locked && patchDraft({ kind })}
                    disabled={locked}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active, disabled: locked }}
                    style={[
                      styles.chip,
                      {
                        borderColor: active ? theme.accent : theme.border,
                        backgroundColor: active ? theme.surfaceAlt : 'transparent',
                        opacity: locked && !active ? 0.4 : 1,
                      },
                    ]}
                  >
                    <Text style={{ color: active ? theme.accent : theme.text, fontSize: 13 }}>
                      {t(`categories.kinds.${kind}`)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {draft?.builtIn ? (
              <Text style={[styles.hint, { color: theme.textMuted }]}>
                {t('categories.kindLocked')}
              </Text>
            ) : null}

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {t('categories.colour')}
            </Text>
            <View style={styles.swatches}>
              {PALETTE.map((color) => (
                <Pressable
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
                />
              ))}
            </View>

            <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
              {t('categories.icon')}
            </Text>
            <View style={styles.swatches}>
              {ICONS.map((icon) => (
                <Pressable
                  key={icon}
                  onPress={() => patchDraft({ icon })}
                  accessibilityRole="button"
                  accessibilityLabel={icon}
                  accessibilityState={{ selected: draft?.icon === icon }}
                  style={[
                    styles.iconOption,
                    {
                      borderColor: draft?.icon === icon ? theme.accent : theme.border,
                      backgroundColor: draft?.icon === icon ? theme.surfaceAlt : 'transparent',
                    },
                  ]}
                >
                  <Feather name={featherName(icon)} size={18} color={theme.text} />
                </Pressable>
              ))}
            </View>

            {formError ? <Text style={{ color: theme.expense }}>{formError}</Text> : null}

            {draft?.id !== null && draft !== null ? (
              <View style={styles.dangerZone}>
                <Pressable
                  onPress={() => {
                    const category = list.find((c) => c.id === draft.id);
                    if (category) toggleArchive(category);
                  }}
                  accessibilityRole="button"
                  style={styles.dangerAction}
                >
                  <Text style={{ color: theme.accent, fontWeight: '600' }}>
                    {list.find((c) => c.id === draft.id)?.archived
                      ? t('categories.unhide')
                      : t('categories.hide')}
                  </Text>
                </Pressable>
                {draft.builtIn ? (
                  <Text style={[styles.hint, { color: theme.textMuted }]}>
                    {t('categories.hideExplain')}
                  </Text>
                ) : (
                  <Pressable
                    onPress={() => {
                      const category = list.find((c) => c.id === draft.id);
                      if (category) startDelete(category);
                    }}
                    accessibilityRole="button"
                    style={styles.dangerAction}
                  >
                    <Text style={{ color: theme.expense, fontWeight: '600' }}>
                      {t('common.delete')}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            <View style={styles.sheetActions}>
              <Pressable onPress={() => setDraft(null)} style={styles.sheetAction}>
                <Text style={{ color: theme.textMuted }}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={() => void commit()} disabled={busy} style={styles.sheetAction}>
                <Text style={{ color: theme.accent, fontWeight: '600' }}>{t('common.save')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={removal !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setRemoval(null)}
      >
        <View style={styles.sheetBackdrop}>
          <ScrollView
            style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={[styles.sheetTitle, { color: theme.text }]}>
              {t('categories.reassignTitle')}
            </Text>
            {removal ? (
              <>
                <Text style={{ color: theme.textMuted }}>
                  {t('categories.reassignBody', {
                    count: removal.movements,
                    name: label(removal.category.id),
                  })}
                </Text>
                {removal.rules > 0 ? (
                  <Text style={{ color: theme.textMuted }}>
                    {t('categories.rulesDeleted', { count: removal.rules })}
                  </Text>
                ) : null}
                <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
                  {t('categories.reassignTo')}
                </Text>
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

            {formError ? <Text style={{ color: theme.expense }}>{formError}</Text> : null}

            <View style={styles.sheetActions}>
              <Pressable
                onPress={() => {
                  setRemoval(null);
                  setReplacementId(null);
                }}
                style={styles.sheetAction}
              >
                <Text style={{ color: theme.textMuted }}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={() => void commitRemoval()}
                disabled={replacementId === null || busy}
                style={styles.sheetAction}
              >
                <Text
                  style={{
                    color: replacementId === null ? theme.textMuted : theme.expense,
                    fontWeight: '600',
                  }}
                >
                  {t('categories.reassignConfirm')}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/** One category: its colour and icon, its label, and whether it is ours or the owner's. */
function Row({ category, onPress }: { category: Category; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const label = useCategoryLabel();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.row, { borderBottomColor: theme.border }]}
    >
      <View style={[styles.icon, { backgroundColor: category.color }]}>
        <Feather name={featherName(category.icon)} size={14} color="#FFFFFF" />
      </View>
      <Text style={[styles.rowLabel, { color: theme.text }]} numberOfLines={1}>
        {label(category.id)}
      </Text>
      {category.builtIn ? (
        <Text style={[styles.tag, { color: theme.textMuted, borderColor: theme.border }]}>
          {t('categories.builtInTag')}
        </Text>
      ) : null}
      <Feather name="chevron-right" size={16} color={theme.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    width: 26,
    height: 26,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 15 },
  tag: {
    fontSize: 11,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  disclosure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addButton: { borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  addButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sheetContent: { padding: spacing.lg, gap: spacing.sm },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  fieldLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  hint: { fontSize: 13 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 16,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 32, height: 32, borderRadius: radius.pill, borderWidth: 2 },
  iconOption: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerZone: { gap: spacing.xs, marginTop: spacing.sm },
  dangerAction: { paddingVertical: spacing.sm },
  sheetActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  sheetAction: { paddingVertical: spacing.sm, paddingHorizontal: spacing.sm },
});
