import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { BUILT_IN_CATEGORIES, UNCATEGORISED_ID, type Category } from '@finant/core';
import { listCategories } from '../db/categories-repo';

interface CategoryStore {
  readonly list: readonly Category[];
  readonly loading: boolean;
  readonly error: Error | null;
}

/**
 * One shared snapshot rather than one query per component.
 *
 * The movements list calls this once per row through `useCategoryLabel`; a
 * hook that queried on mount would run a hundred SELECTs to render one screen.
 * The store is read through `useSyncExternalStore`, so every consumer sees the
 * same list and re-renders together when it changes.
 *
 * It starts as the shipped taxonomy: the table is a superset of it after
 * `syncBuiltInCategories()`, so the first paint is right rather than empty,
 * and a database that will not open still renders labelled movements.
 */
let store: CategoryStore = { list: BUILT_IN_CATEGORIES, loading: true, error: null };
const listeners = new Set<() => void>();
let started = false;

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): CategoryStore {
  return store;
}

/**
 * Re-reads the table and tells every mounted consumer. Exported so a screen
 * that changed a category can refresh the app without going through a hook.
 */
export async function reloadCategories(): Promise<void> {
  try {
    const rows = await listCategories();
    // An empty table means the launch sync has not run yet; the shipped list is
    // a better answer than no categories at all.
    store = { list: rows.length > 0 ? rows : BUILT_IN_CATEGORIES, loading: false, error: null };
  } catch (cause) {
    store = { list: store.list, loading: false, error: cause as Error };
  }
  emit();
}

export interface CategoryData {
  /** Every category, hidden ones included, in render order. */
  readonly list: readonly Category[];
  readonly byId: ReadonlyMap<string, Category>;
  /** What a picker may offer: nothing hidden, and never "uncategorised", which
   * records indecision rather than a decision. */
  readonly selectable: readonly Category[];
  readonly loading: boolean;
  readonly error: Error | null;
  readonly reload: () => Promise<void>;
}

/** The categories the app renders. Rows from the table, not the constant. */
export function useCategories(): CategoryData {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (started) return;
    started = true;
    void reloadCategories();
  }, []);

  const byId = useMemo(() => new Map(state.list.map((c) => [c.id, c])), [state.list]);
  const selectable = useMemo(
    () => state.list.filter((c) => !c.archived && c.id !== UNCATEGORISED_ID),
    [state.list],
  );
  const reload = useCallback(() => reloadCategories(), []);

  return { list: state.list, byId, selectable, loading: state.loading, error: state.error, reload };
}
