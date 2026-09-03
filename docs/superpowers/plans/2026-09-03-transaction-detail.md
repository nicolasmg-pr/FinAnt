# Transaction Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open a movement from the Movements list and change its category (optionally learning a rule), exclude it from statistics, or soft-delete it; show the import result instead of closing silently.

**Architecture:** One new modal route `app/transaction/[id].tsx` on top of repository functions that mostly already exist (`setCategory`, `setExcludedFromStats`, `deleteTransaction`). Deletion becomes a soft delete (`deleted_at`, migration 4) so a re-imported statement cannot resurrect the row. A small shared layer (category label hook, UTC-safe date formatter, extracted `CategoryChip`) removes the copy-pasted label/chip code from the budgets and movements screens.

**Tech Stack:** TypeScript 6 strict, React Native 0.86, Expo SDK 57, expo-router (typed routes), expo-sqlite/SQLCipher, react-i18next, vitest (packages only; the mobile app has no test runner, so verification is typecheck + bundle export + simulator).

**Spec:** `docs/superpowers/specs/2026-09-03-ledger-control-design.md`, section "Sub-project 1 — transaction-detail".

## Global Constraints

- Schema migrations are append-only; never edit a shipped one. New migration is `version: 4`.
- Money is signed integer minor units; never do float arithmetic on a balance.
- Dates are plain `YYYY-MM-DD` strings; never route a booking date through a local-time `Date`. Formatting pins `timeZone: 'UTC'` on both ends.
- Relative imports inside packages are extensionless.
- Translations are typed against `Resources`; `es` and `de` must carry every new key or typecheck fails.
- Never log a movement, narrative, IBAN or any part of a statement.
- No network calls, no telemetry.
- `npm run lint:fix` reformats the whole repo. Run prettier/eslint only on the files you changed.
- The `docs/` prettier drift on `docs/data-model.md` is pre-existing; do not reformat unrelated parts of that file.
- Branch: `transaction-detail` (already created off `main`). Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

### Task 1: Soft delete in the schema and repository

**Files:**
- Modify: `apps/mobile/src/db/schema.ts` (append after the `version: 3` entry)
- Modify: `apps/mobile/src/db/transactions-repo.ts`
- Modify: `apps/mobile/src/db/mappers.ts` (`TransactionRow`)
- Modify: `docs/data-model.md` (new section after "Dedupe")

**Interfaces:**
- Produces: `getTransaction(id: string): Promise<Transaction | null>`; `deleteTransaction(transactionId: string): Promise<void>` now soft-deletes; every list/count/range query excludes deleted rows.

- [ ] **Step 1: Append migration 4**

In `apps/mobile/src/db/schema.ts`, add this entry to `MIGRATIONS` after the `version: 3` object (keep the array's closing `];` after it):

```ts
  {
    version: 4,
    sql: `
      -- Deleting a movement must survive the next overlapping statement import.
      -- A hard delete would let INSERT OR IGNORE bring the row straight back,
      -- because the unique indexes only guard rows that still exist. So a
      -- deleted row keeps its place in the table and every read filters it out.
      ALTER TABLE transactions ADD COLUMN deleted_at TEXT;
      CREATE INDEX idx_tx_deleted ON transactions(deleted_at);
    `,
  },
```

`LATEST_VERSION` derives from the last entry; nothing else to change.

- [ ] **Step 2: Add `deleted_at` to the row type**

In `apps/mobile/src/db/mappers.ts`, inside `interface TransactionRow`, add after `excluded_from_stats: number;`:

```ts
  /** Set by a soft delete. Rows with a value never leave the repository. */
  deleted_at: string | null;
```

Do not map it in `toTransaction`; the domain type never sees it.

- [ ] **Step 3: Filter deleted rows in every read and add `getTransaction`**

In `apps/mobile/src/db/transactions-repo.ts`:

Replace `listTransactionsBetween`'s SQL with:

```ts
    `SELECT * FROM transactions
      WHERE booking_date >= ? AND booking_date <= ? AND deleted_at IS NULL
      ORDER BY booking_date DESC, created_at DESC;`,
```

Replace `listAllTransactions`'s SQL with:

```ts
    'SELECT * FROM transactions WHERE deleted_at IS NULL ORDER BY booking_date DESC, created_at DESC;',
```

Replace `countUncategorised`'s SQL with:

```ts
    `SELECT COUNT(*) AS count FROM transactions
      WHERE deleted_at IS NULL
        AND (category_id IS NULL OR category_id = 'uncategorised');`,
```

Replace `dataRange`'s SQL with:

```ts
    'SELECT MIN(booking_date) AS "from", MAX(booking_date) AS "to" FROM transactions WHERE deleted_at IS NULL;',
```

Add after `listAllTransactions`:

```ts
/** One movement by id, or null when it never existed or has been deleted. */
export async function getTransaction(id: string): Promise<Transaction | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<TransactionRow>(
    'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL;',
    id,
  );
  return row ? toTransaction(row) : null;
}
```

Replace the whole `deleteTransaction` function with:

```ts
/**
 * Soft delete. The row stays in the table so the unique indexes keep holding
 * its identity: the next overlapping statement import then skips it as a
 * duplicate instead of bringing it back. Every read filters `deleted_at`.
 */
export async function deleteTransaction(transactionId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE transactions SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL;',
    new Date().toISOString(),
    transactionId,
  );
}
```

- [ ] **Step 4: Document it**

In `docs/data-model.md`, insert this section between "## Dedupe" and "## What is excluded from statistics":

```markdown
## Deleting a movement

`deleted_at` (migration 4) marks a movement the owner removed. The row stays in
the table so `idx_tx_hash` and `idx_tx_external` keep holding its identity: the
next overlapping statement import hits `INSERT OR IGNORE` and reports it as a
duplicate instead of bringing it back. Every read in
`apps/mobile/src/db/transactions-repo.ts` filters `deleted_at IS NULL`, and the
domain `Transaction` type never carries the column.
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no output after the `tsc` command lines (exit 0).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/db/schema.ts apps/mobile/src/db/transactions-repo.ts apps/mobile/src/db/mappers.ts docs/data-model.md
git commit -m "feat(db): soft-delete movements so re-imports cannot resurrect them

Migration 4 adds deleted_at. Every read filters it; deleteTransaction
sets it instead of removing the row, so the unique indexes keep the
row's identity and INSERT OR IGNORE skips it on the next import.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Translations for the detail screen and import result

**Files:**
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/es.ts`
- Modify: `packages/i18n/src/de.ts`

**Interfaces:**
- Produces keys: `transactions.detailTitle`, `transactions.description`, `transactions.counterparty`, `transactions.reference`, `transactions.bookingDate`, `transactions.valueDate`, `transactions.account`, `transactions.category`, `transactions.notes`, `transactions.categorySource.{auto,manual,none}`, `transactions.excludedTag`, `transactions.deleteConfirm`, `import.result`, `import.imported_one`, `import.imported_other`.

- [ ] **Step 1: English**

In `packages/i18n/src/en.ts`, inside `transactions: { ... }`, add after `addManual: 'Add a movement',`:

```ts
    detailTitle: 'Movement',
    description: 'Description',
    counterparty: 'Counterparty',
    reference: 'Reference',
    bookingDate: 'Booked',
    valueDate: 'Value date',
    account: 'Account',
    category: 'Category',
    notes: 'Notes',
    categorySource: {
      auto: 'set by a rule',
      manual: 'set by you',
      none: 'not classified yet',
    },
    excludedTag: 'Excluded',
    deleteConfirm:
      'Delete this movement? It will not come back if you import the same statement again.',
```

Inside `import: { ... }`, add after `supportedFormats: ...,`:

```ts
    result: 'Import finished',
    imported_one: '{{count}} movement imported',
    imported_other: '{{count}} movements imported',
```

- [ ] **Step 2: Spanish**

In `packages/i18n/src/es.ts`, inside `transactions`, after `addManual: 'Añadir movimiento',`:

```ts
    detailTitle: 'Movimiento',
    description: 'Descripción',
    counterparty: 'Contraparte',
    reference: 'Referencia',
    bookingDate: 'Fecha contable',
    valueDate: 'Fecha valor',
    account: 'Cuenta',
    category: 'Categoría',
    notes: 'Notas',
    categorySource: {
      auto: 'asignada por una regla',
      manual: 'asignada por ti',
      none: 'sin clasificar',
    },
    excludedTag: 'Excluido',
    deleteConfirm:
      '¿Eliminar este movimiento? No volverá a aparecer si importas el mismo extracto otra vez.',
```

Inside `import`, after `supportedFormats: ...,`:

```ts
    result: 'Importación terminada',
    imported_one: '{{count}} movimiento importado',
    imported_other: '{{count}} movimientos importados',
```

- [ ] **Step 3: German**

In `packages/i18n/src/de.ts`, inside `transactions`, after `addManual: 'Umsatz hinzufügen',`:

```ts
    detailTitle: 'Umsatz',
    description: 'Beschreibung',
    counterparty: 'Gegenpartei',
    reference: 'Referenz',
    bookingDate: 'Buchungstag',
    valueDate: 'Wertstellung',
    account: 'Konto',
    category: 'Kategorie',
    notes: 'Notizen',
    categorySource: {
      auto: 'per Regel zugewiesen',
      manual: 'von dir zugewiesen',
      none: 'noch nicht zugeordnet',
    },
    excludedTag: 'Ausgeschlossen',
    deleteConfirm:
      'Diesen Umsatz löschen? Er kommt nicht zurück, wenn du denselben Kontoauszug erneut importierst.',
```

Inside `import`, after `supportedFormats: ...,`:

```ts
    result: 'Import abgeschlossen',
    imported_one: '{{count}} Umsatz importiert',
    imported_other: '{{count}} Umsätze importiert',
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. A missing key in `es` or `de` fails here with a `Translations` type error naming the key.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/en.ts packages/i18n/src/es.ts packages/i18n/src/de.ts
git commit -m "feat(i18n): strings for the movement detail screen and import result

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Shared pieces — date formatter, category label hook, CategoryChip

**Files:**
- Modify: `apps/mobile/src/i18n/index.ts` (append one function)
- Create: `apps/mobile/src/hooks/use-category-label.ts`
- Create: `apps/mobile/src/components/CategoryChip.tsx`
- Modify: `apps/mobile/app/(tabs)/budgets.tsx` (use the extracted chip)

**Interfaces:**
- Produces: `formatBookingDate(date: string, options: Intl.DateTimeFormatOptions): string`; `useCategoryLabel(): (categoryId: string | null) => string`; `CategoryChip({ category: Category; label: string; selected: boolean; onPress: () => void })`.

- [ ] **Step 1: UTC-safe date formatter**

Append to `apps/mobile/src/i18n/index.ts` (before the final `export { i18n };`):

```ts
/**
 * Formats a plain `YYYY-MM-DD` for display. Parsed and formatted in UTC on both
 * ends, so the calendar day never shifts with the device's time zone.
 */
export function formatBookingDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(intlLocale(), { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );
}
```

- [ ] **Step 2: Category label hook**

Create `apps/mobile/src/hooks/use-category-label.ts`:

```ts
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CATEGORY_BY_ID } from '@finant/core';

/**
 * Resolves a category id to its translated label. Falls back to the English
 * name for a category without a label key, then to the id itself. A null
 * category reads as "Uncategorised".
 */
export function useCategoryLabel(): (categoryId: string | null) => string {
  const { t } = useTranslation();
  return useCallback(
    (categoryId: string | null): string => {
      if (!categoryId) return t('category.uncategorised');
      const category = CATEGORY_BY_ID.get(categoryId);
      return category?.labelKey ? t(category.labelKey) : (category?.name ?? categoryId);
    },
    [t],
  );
}
```

- [ ] **Step 3: Extract CategoryChip**

Create `apps/mobile/src/components/CategoryChip.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Category } from '@finant/core';
import { radius, spacing, useTheme } from '../theme';

/** One selectable category pill: colour dot plus label, outlined in the category colour when chosen. */
export function CategoryChip({
  category,
  label,
  selected,
  onPress,
}: {
  category: Category;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          borderColor: selected ? category.color : theme.border,
          backgroundColor: selected ? theme.surfaceAlt : 'transparent',
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: category.color }]} />
      <Text style={{ color: theme.text, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
```

- [ ] **Step 4: Budgets screen uses the extracted chip**

In `apps/mobile/app/(tabs)/budgets.tsx`:

1. Add the import next to the other component imports:
   ```ts
   import { CategoryChip } from '../../src/components/CategoryChip';
   ```
2. Delete the local `function CategoryChip(...) { ... }` (the whole function near the bottom, from `function CategoryChip({` to its closing `}`).
3. In the `styles` object, delete the `chip: { ... }` and `chipDot: { ... }` entries. Keep `chips`.
4. `Category` is no longer used in this file: remove `type Category,` from the `@finant/core` import list.

- [ ] **Step 5: Typecheck and lint the touched files**

Run:
```bash
npm run typecheck
npx eslint "apps/mobile/app/(tabs)/budgets.tsx" apps/mobile/src/components/CategoryChip.tsx apps/mobile/src/hooks/use-category-label.ts apps/mobile/src/i18n/index.ts
npx prettier --check apps/mobile/src/components/CategoryChip.tsx apps/mobile/src/hooks/use-category-label.ts
```
Expected: all exit 0. (`budgets.tsx` and `i18n/index.ts` are not prettier-checked here: their pre-existing state may already drift.)

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/i18n/index.ts apps/mobile/src/hooks/use-category-label.ts apps/mobile/src/components/CategoryChip.tsx "apps/mobile/app/(tabs)/budgets.tsx"
git commit -m "refactor(mobile): share category chip, label hook and UTC date formatter

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The movement detail screen

**Files:**
- Create: `apps/mobile/app/transaction/[id].tsx`
- Modify: `apps/mobile/app/_layout.tsx` (register the route)

**Interfaces:**
- Consumes: `getTransaction`, `setCategory`, `setExcludedFromStats`, `deleteTransaction`, `newId` from `src/db/transactions-repo`; `saveRule` from `src/db/rules-repo`; `listAccounts` from `src/db/accounts-repo`; `learnRuleFrom`, `countsTowardStats`, `BUILT_IN_CATEGORIES`, `UNCATEGORISED_ID` from `@finant/core`; `CategoryChip`, `useCategoryLabel`, `formatBookingDate` from Task 3; strings from Task 2.
- Produces: route `/transaction/[id]` that Task 5 pushes to.

- [ ] **Step 1: Register the modal route**

In `apps/mobile/app/_layout.tsx`, inside `<Stack screenOptions={{ headerShown: false }}>`, add after the `import` screen:

```tsx
        <Stack.Screen
          name="transaction/[id]"
          options={{ presentation: 'modal', headerShown: true }}
        />
```

The title is set from inside the screen, where `t()` is available.

- [ ] **Step 2: Create the screen**

Create `apps/mobile/app/transaction/[id].tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  BUILT_IN_CATEGORIES,
  UNCATEGORISED_ID,
  countsTowardStats,
  learnRuleFrom,
  type Category,
  type Transaction,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { Card } from '../../src/components/Card';
import { CategoryChip } from '../../src/components/CategoryChip';
import { listAccounts } from '../../src/db/accounts-repo';
import { saveRule } from '../../src/db/rules-repo';
import {
  deleteTransaction,
  getTransaction,
  newId,
  setCategory,
  setExcludedFromStats,
} from '../../src/db/transactions-repo';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { formatBookingDate } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';

/**
 * Every category the owner may pick, grouped so the row's own side of the
 * ledger comes first, then transfers, then the other side. "Uncategorised" is
 * not offered: choosing it by hand would only record indecision.
 */
function groupsFor(side: Transaction['side']): readonly (readonly Category[])[] {
  const selectable = BUILT_IN_CATEGORIES.filter((c) => !c.archived && c.id !== UNCATEGORISED_ID);
  return [
    selectable.filter((c) => c.kind === side),
    selectable.filter((c) => c.kind === 'transfer'),
    selectable.filter((c) => c.kind !== side && c.kind !== 'transfer'),
  ];
}

export default function TransactionDetailScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const label = useCategoryLabel();

  const [tx, setTx] = useState<Transaction | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [learn, setLearn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const row = await getTransaction(id);
      if (!row) {
        // Deleted elsewhere or a stale link: nothing to show, so leave.
        router.back();
        return;
      }
      setTx(row);
      setSelected(row.categoryId);
      const accounts = await listAccounts();
      setAccountName(accounts.find((a) => a.id === row.accountId)?.name ?? null);
    })().catch((cause: unknown) => setError((cause as Error).message));
  }, [id, router]);

  const groups = useMemo(() => (tx ? groupsFor(tx.side) : []), [tx]);
  const categoryChanged = tx !== null && selected !== null && selected !== tx.categoryId;
  // Offer the "learn a rule" switch only when this narrative can yield one.
  const canLearn =
    tx !== null && selected !== null && learnRuleFrom(tx, selected, () => 'probe') !== null;

  const save = async () => {
    if (!tx || !selected || !categoryChanged) return;
    setBusy(true);
    try {
      await setCategory(tx.id, selected);
      if (learn && canLearn) {
        const rule = learnRuleFrom(tx, selected, newId);
        if (rule) await saveRule(rule);
      }
      router.back();
    } catch (cause) {
      setError((cause as Error).message);
      setBusy(false);
    }
  };

  const toggleExcluded = async (excluded: boolean) => {
    if (!tx) return;
    setTx((current) => (current ? { ...current, excludedFromStats: excluded } : current));
    try {
      await setExcludedFromStats(tx.id, excluded);
    } catch (cause) {
      setTx((current) => (current ? { ...current, excludedFromStats: !excluded } : current));
      setError((cause as Error).message);
    }
  };

  const confirmDelete = () => {
    if (!tx) return;
    Alert.alert(t('common.delete'), t('transactions.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteTransaction(tx.id);
              router.back();
            } catch (cause) {
              setError((cause as Error).message);
            }
          })();
        },
      },
    ]);
  };

  if (!tx) {
    return (
      <View style={[styles.centre, { backgroundColor: theme.background }]}>
        <Stack.Screen options={{ title: t('transactions.detailTitle') }} />
        {error ? (
          <Text style={{ color: theme.expense }}>{error}</Text>
        ) : (
          <ActivityIndicator color={theme.accent} />
        )}
      </View>
    );
  }

  const excludedFromTotals = !countsTowardStats(tx);

  return (
    <ScrollView style={{ backgroundColor: theme.background }} contentContainerStyle={styles.screen}>
      <Stack.Screen options={{ title: t('transactions.detailTitle') }} />

      <Card>
        <Amount value={tx.amount} style={styles.amount} />
        <Text style={[styles.headline, { color: theme.text }]}>
          {tx.counterparty ?? tx.description}
        </Text>
        {tx.counterparty ? (
          <Text style={{ color: theme.textMuted }}>{tx.description}</Text>
        ) : null}
        {excludedFromTotals ? (
          <Text style={[styles.tag, { color: theme.textMuted, borderColor: theme.border }]}>
            {tx.excludedFromStats ? t('transactions.excludedTag') : label(tx.categoryId)}
          </Text>
        ) : null}
      </Card>

      <Card>
        <Field
          label={t('transactions.bookingDate')}
          value={formatBookingDate(tx.bookingDate, { dateStyle: 'long' })}
        />
        {tx.valueDate ? (
          <Field
            label={t('transactions.valueDate')}
            value={formatBookingDate(tx.valueDate, { dateStyle: 'long' })}
          />
        ) : null}
        {accountName ? <Field label={t('transactions.account')} value={accountName} /> : null}
        {tx.reference ? <Field label={t('transactions.reference')} value={tx.reference} /> : null}
        {tx.notes ? <Field label={t('transactions.notes')} value={tx.notes} /> : null}
        <Field
          label={t('transactions.category')}
          value={`${label(tx.categoryId)} · ${t(`transactions.categorySource.${tx.categorySource}`)}`}
        />
      </Card>

      <Card title={t('transactions.changeCategory')}>
        {groups.map((group, index) =>
          group.length > 0 ? (
            <View key={index} style={styles.chips}>
              {group.map((category) => (
                <CategoryChip
                  key={category.id}
                  category={category}
                  label={label(category.id)}
                  selected={selected === category.id}
                  onPress={() => setSelected(category.id)}
                />
              ))}
            </View>
          ) : null,
        )}
        {categoryChanged && canLearn ? (
          <SwitchRow label={t('transactions.applyToSimilar')} value={learn} onValueChange={setLearn} />
        ) : null}
        <Pressable
          onPress={() => void save()}
          disabled={!categoryChanged || busy}
          style={[
            styles.button,
            { backgroundColor: categoryChanged ? theme.accent : theme.surfaceAlt },
          ]}
        >
          <Text style={[styles.buttonText, { color: categoryChanged ? '#FFFFFF' : theme.textMuted }]}>
            {t('common.save')}
          </Text>
        </Pressable>
      </Card>

      <Card>
        <SwitchRow
          label={t('transactions.excludeFromStats')}
          value={tx.excludedFromStats}
          onValueChange={(value) => void toggleExcluded(value)}
        />
        <Pressable onPress={confirmDelete} disabled={busy} style={styles.deleteButton}>
          <Text style={{ color: theme.expense, fontWeight: '600' }}>{t('common.delete')}</Text>
        </Pressable>
      </Card>

      {error ? <Text style={{ color: theme.expense }}>{error}</Text> : null}
    </ScrollView>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: theme.text }]} selectable>
        {value}
      </Text>
    </View>
  );
}

function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.switchRow}>
      <Text style={[styles.switchLabel, { color: theme.text }]}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: theme.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: spacing.lg, paddingBottom: spacing.xxl },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  amount: { fontSize: 32, fontWeight: '700' },
  headline: { fontSize: 17, fontWeight: '600' },
  tag: {
    alignSelf: 'flex-start',
    fontSize: 12,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  field: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  fieldLabel: { fontSize: 13 },
  fieldValue: { fontSize: 13, flexShrink: 1, textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  switchLabel: { fontSize: 14, flexShrink: 1 },
  button: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
  deleteButton: { alignItems: 'center', paddingVertical: spacing.sm },
});
```

- [ ] **Step 3: Regenerate typed routes, then typecheck**

Typed routes live in `apps/mobile/.expo/types/router.d.ts` and are generated by Metro. The new route must exist there before `router.push('/transaction/...')` in Task 5 typechecks.

Run:
```bash
cd apps/mobile && npx expo export --platform ios --output-dir /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/59dff64d-0b92-4922-bf15-f652345f4f2e/scratchpad/export && cd ../..
grep -c "transaction/\[id\]" apps/mobile/.expo/types/router.d.ts
npm run typecheck
```
Expected: export ends with "Exported: ..." and no red error; grep prints a number ≥ 1; typecheck exit 0.

- [ ] **Step 4: Lint**

Run:
```bash
npx eslint "apps/mobile/app/transaction/[id].tsx" apps/mobile/app/_layout.tsx
npx prettier --check "apps/mobile/app/transaction/[id].tsx"
```
Expected: exit 0. If prettier disagrees, run `npx prettier --write "apps/mobile/app/transaction/[id].tsx"` and re-check.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/transaction/[id].tsx" apps/mobile/app/_layout.tsx
git commit -m "feat(mobile): movement detail screen with category, exclusion and delete

Opens as a modal from the Movements list. Changing the category records
it as manual and can learn a rule for similar movements; excluding is
immediate and reversible; delete is a soft delete behind a confirm.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Movements list opens the detail and shows exclusions

**Files:**
- Modify: `apps/mobile/app/(tabs)/transactions.tsx`

**Interfaces:**
- Consumes: route `/transaction/[id]` (Task 4); `useCategoryLabel`, `formatBookingDate` (Task 3); `countsTowardStats` from `@finant/core`; `transactions.excludedTag` (Task 2).

- [ ] **Step 1: Update imports**

Replace the import block at the top of `apps/mobile/app/(tabs)/transactions.tsx` with:

```tsx
import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  CATEGORY_BY_ID,
  UNCATEGORISED_ID,
  countsTowardStats,
  type Transaction,
} from '@finant/core';
import { Amount } from '../../src/components/Amount';
import { useAppData } from '../../src/hooks/use-app-data';
import { useCategoryLabel } from '../../src/hooks/use-category-label';
import { formatBookingDate } from '../../src/i18n';
import { radius, spacing, useTheme } from '../../src/theme';
```

- [ ] **Step 2: Replace the `Row` component**

Replace the whole `function Row(...) { ... }` with:

```tsx
function Row({ transaction }: { transaction: Transaction }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const label = useCategoryLabel();
  const category = transaction.categoryId ? CATEGORY_BY_ID.get(transaction.categoryId) : undefined;
  // A row outside the statistics (excluded by hand, or an internal transfer)
  // stays visible but reads as dimmed, so the list still matches the bank.
  const counted = countsTowardStats(transaction);
  const date = formatBookingDate(transaction.bookingDate, { day: '2-digit', month: 'short' });
  const meta = [date, label(transaction.categoryId)];
  if (transaction.excludedFromStats) meta.push(t('transactions.excludedTag'));

  return (
    <Pressable
      onPress={() =>
        router.push({ pathname: '/transaction/[id]', params: { id: transaction.id } })
      }
      accessibilityRole="button"
      style={[styles.row, { borderBottomColor: theme.border, opacity: counted ? 1 : 0.55 }]}
    >
      <View style={[styles.dot, { backgroundColor: category?.color ?? theme.textMuted }]} />
      <View style={styles.rowText}>
        <Text style={[styles.description, { color: theme.text }]} numberOfLines={1}>
          {transaction.counterparty ?? transaction.description}
        </Text>
        <Text style={[styles.meta, { color: theme.textMuted }]} numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
      </View>
      <Amount value={transaction.amount} style={styles.amount} />
    </Pressable>
  );
}
```

`intlLocale` is no longer imported by this file; the formatter owns the locale now.

- [ ] **Step 3: Typecheck and lint**

Run:
```bash
npm run typecheck
npx eslint "apps/mobile/app/(tabs)/transactions.tsx"
npx prettier --check "apps/mobile/app/(tabs)/transactions.tsx"
```
Expected: exit 0. If the typecheck rejects `pathname: '/transaction/[id]'`, the typed routes were not regenerated: re-run the export command from Task 4 Step 3.

- [ ] **Step 4: Commit**

```bash
git add "apps/mobile/app/(tabs)/transactions.tsx"
git commit -m "feat(mobile): open a movement from the list, dim rows outside the stats

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Import screen reports what happened

**Files:**
- Modify: `apps/mobile/app/import.tsx`

**Interfaces:**
- Consumes: `ingest(): Promise<IngestResult>` and `type IngestResult` from `src/services/ingest`; `import.result`, `import.imported_*`, `import.duplicatesSkipped_*`, `common.done` strings.

- [ ] **Step 1: Import the result type**

In `apps/mobile/app/import.tsx`, change

```ts
import { ingest } from '../src/services/ingest';
```
to
```ts
import { ingest, type IngestResult } from '../src/services/ingest';
```

- [ ] **Step 2: Keep the result in state**

After `const [error, setError] = useState<string | null>(null);` add:

```ts
  const [result, setResult] = useState<IngestResult | null>(null);
```

At the top of `pick`, right after `setError(null);`, add `setResult(null);` so picking a new file clears the previous summary.

Replace the `confirm` function with:

```ts
  const confirm = async () => {
    if (!staged) return;
    setBusy(true);
    try {
      // Stay on screen: the owner should see how many rows were new and how
      // many the unique indexes already held before the modal closes.
      setResult(await ingest(staged.transactions));
      setStaged(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 3: Render the result card**

In the JSX, directly after the first `</Card>` (the "Import a file" card) and before `{staged ? (`, add:

```tsx
      {result ? (
        <Card title={t('import.result')}>
          <Text style={{ color: theme.text }}>{t('import.imported', { count: result.inserted })}</Text>
          {result.duplicates > 0 ? (
            <Text style={{ color: theme.textMuted }}>
              {t('import.duplicatesSkipped', { count: result.duplicates })}
            </Text>
          ) : null}
          <Pressable
            onPress={() => router.back()}
            style={[styles.button, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.buttonText}>{t('common.done')}</Text>
          </Pressable>
        </Card>
      ) : null}
```

- [ ] **Step 4: Typecheck and lint**

Run:
```bash
npm run typecheck
npx eslint apps/mobile/app/import.tsx
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/app/import.tsx
git commit -m "feat(import): show how many movements were new and how many were duplicates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Verify on device and finish the branch

**Files:** none new.

- [ ] **Step 1: Full checks**

Run:
```bash
npm run typecheck && npm test
```
Expected: typecheck exit 0; vitest reports all test files passed (104 tests before this branch; the count is unchanged because `packages/core` did not change).

- [ ] **Step 2: Bundle check**

Run:
```bash
cd apps/mobile && npx expo export --platform ios --output-dir /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/59dff64d-0b92-4922-bf15-f652345f4f2e/scratchpad/export && cd ../..
```
Expected: "Exported" summary, no error.

- [ ] **Step 3: Run in the simulator**

Run (background, it takes minutes):
```bash
cd apps/mobile && npx expo run:ios
```
When the app is up, take a screenshot of the Movements tab:
```bash
xcrun simctl io booted screenshot /private/tmp/claude-501/-Users-nikomendez-Documents-AI-Engineering-FinAnt/59dff64d-0b92-4922-bf15-f652345f4f2e/scratchpad/movements.png
```
Scripted taps are not available on this Mac (Accessibility denied for osascript), so the detail screen itself is verified by the owner: tap a row, change a category with the switch on, toggle exclusion, delete one, re-import the same file and confirm the result card reports the deleted row as a duplicate.

- [ ] **Step 4: Finish the branch**

Use `superpowers:finishing-a-development-branch`. The agreed flow is: merge `transaction-detail` into `main` with a `--no-ff` merge commit whose subject starts with `merge:`, then push. Pushing from this session is blocked by the permission classifier; the owner runs:

```bash
git push origin main transaction-detail
```
