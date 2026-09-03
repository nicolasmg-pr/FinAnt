import type { Category, CategoryKind } from '@finant/core';
import { getDatabase } from './database';
import { toCategory, type CategoryRow } from './mappers';
import { newId } from './transactions-repo';

/**
 * Prefix every category the owner creates carries.
 *
 * Shipped ids in `BUILT_IN_CATEGORIES` are hand-written slugs — `housing-rent`,
 * `insurance-car` — and none of them starts with `user-`. Reserving the prefix
 * is what guarantees a category the owner adds today can never collide with a
 * category a future release ships, which would silently merge two different
 * buckets of money on the next launch. Ids are permanent, so this holds
 * forever: nothing ever renames one.
 */
const USER_ID_PREFIX = 'user-';

export function isUserCategoryId(id: string): boolean {
  return id.startsWith(USER_ID_PREFIX);
}

/**
 * Every category, hidden ones included, in render order.
 *
 * Archived rows are returned rather than filtered here: they must vanish from
 * the pickers but still render on the movements that carry them, and the
 * screen is the only place that knows which of the two it is doing.
 */
export async function listCategories(): Promise<Category[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CategoryRow>(
    'SELECT * FROM categories ORDER BY position ASC, name ASC;',
  );
  return rows.map(toCategory);
}

export async function getCategory(id: string): Promise<Category | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<CategoryRow>('SELECT * FROM categories WHERE id = ?;', id);
  return row ? toCategory(row) : null;
}

/**
 * Adds a category of the owner's own. It is never `built_in`, so it can be
 * deleted; it lands after everything already on record.
 */
export async function createCategory(category: {
  name: string;
  kind: CategoryKind;
  color: string;
  icon: string;
}): Promise<string> {
  const name = category.name.trim();
  if (name === '') throw new RangeError('A category needs a name');

  const db = await getDatabase();
  const last = await db.getFirstAsync<{ position: number | null }>(
    'SELECT MAX(position) AS position FROM categories;',
  );
  const id = `${USER_ID_PREFIX}${newId()}`;
  await db.runAsync(
    `INSERT INTO categories
       (id, label_key, name, kind, parent_id, color, icon, position, built_in, archived, customised)
     VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, 0, 0, 0);`,
    id,
    name,
    category.kind,
    category.color,
    category.icon,
    (last?.position ?? 0) + 1,
  );
  return id;
}

/**
 * Changes what a category looks like. Never its id, which rules and years of
 * history point at, and never the `kind` of a shipped category, whose side of
 * the ledger the shipped rules assume.
 *
 * Editing sets `customised`, which is what stops the launch sync putting the
 * shipped label and colour back the next time the app opens.
 */
export async function updateCategory(
  id: string,
  patch: { name?: string; color?: string; icon?: string; kind?: CategoryKind },
): Promise<void> {
  const existing = await getCategory(id);
  if (!existing) throw new RangeError('No such category');

  const name = patch.name?.trim() ?? existing.name;
  if (name === '') throw new RangeError('A category needs a name');
  if (patch.kind !== undefined && patch.kind !== existing.kind && existing.builtIn) {
    throw new RangeError('A shipped category keeps its kind');
  }

  // A renamed category stops being translated: the owner's word is the label
  // in every language, and `category.<id>` no longer describes it. Recolouring
  // one is not renaming it, so its translation survives that untouched.
  const labelKey = name === existing.name ? (existing.labelKey ?? null) : null;

  const db = await getDatabase();
  await db.runAsync(
    `UPDATE categories
        SET name = ?, color = ?, icon = ?, kind = ?, label_key = ?, customised = 1
      WHERE id = ?;`,
    name,
    patch.color ?? existing.color,
    patch.icon ?? existing.icon,
    patch.kind ?? existing.kind,
    labelKey,
    id,
  );
}

/**
 * Hides a category. It leaves every picker and stays on the movements already
 * filed under it, which is the only thing a built-in category can ever have
 * done to it — deleting one would take the shipped rules pointing at it with
 * it, and orphan the history.
 */
export async function archiveCategory(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE categories SET archived = 1 WHERE id = ?;', id);
}

export async function unarchiveCategory(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE categories SET archived = 0 WHERE id = ?;', id);
}

/** How many movements the owner can still see under this category. */
export async function countTransactionsInCategory(id: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM transactions WHERE category_id = ? AND deleted_at IS NULL;',
    id,
  );
  return row?.count ?? 0;
}

/** How many categorisation rules would be deleted along with the category. */
export async function countRulesForCategory(id: string): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM rules WHERE category_id = ?;',
    id,
  );
  return row?.count ?? 0;
}

/**
 * Deletes a category the owner created, moving its movements somewhere first.
 *
 * `transactions.category_id` is declared `ON DELETE SET NULL`, so deleting a
 * category that still holds movements would quietly uncategorise every one of
 * them — months of classification gone with no record of where it went. The
 * reassignment therefore runs *before* the delete and inside the same
 * transaction: either both happen or neither does, and the window in which a
 * movement points at nothing never exists.
 *
 * Soft-deleted movements are reassigned too. They are invisible to the owner
 * but still hold their place in the dedupe indexes, and leaving them pointing
 * at a category that is about to vanish only loses information.
 *
 * Rules pointing at the category are `ON DELETE CASCADE` and go with it; so
 * does its budget. The screen says so before the owner confirms.
 */
export async function deleteCategory(id: string, replacementId?: string): Promise<void> {
  const category = await getCategory(id);
  if (!category) return;
  if (category.builtIn) {
    throw new RangeError('A shipped category can be hidden, not deleted');
  }
  if (replacementId === id) {
    throw new RangeError('A category cannot be replaced by itself');
  }

  const db = await getDatabase();
  const inUse = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) AS count FROM transactions WHERE category_id = ?;',
    id,
  );
  if ((inUse?.count ?? 0) > 0 && replacementId === undefined) {
    throw new RangeError('Movements are filed under this category; pick where they should go');
  }

  await db.withTransactionAsync(async () => {
    if (replacementId !== undefined) {
      await db.runAsync(
        'UPDATE transactions SET category_id = ? WHERE category_id = ?;',
        replacementId,
        id,
      );
    }
    await db.runAsync('DELETE FROM categories WHERE id = ?;', id);
  });
}
