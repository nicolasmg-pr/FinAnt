import type { CategoryRule } from '@finant/core';
import { getDatabase } from './database';
import { toRule, type RuleRow } from './mappers';
import { newId } from './transactions-repo';

export async function listRules(): Promise<CategoryRule[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<RuleRow>('SELECT * FROM rules ORDER BY priority DESC, id ASC;');
  return rows.map(toRule);
}

export async function saveRule(rule: Omit<CategoryRule, 'id'> & { id?: string }): Promise<string> {
  const db = await getDatabase();
  const id = rule.id ?? newId();
  await db.runAsync(
    `INSERT INTO rules (id, category_id, priority, enabled, learned, match_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       category_id = excluded.category_id,
       priority = excluded.priority,
       enabled = excluded.enabled,
       match_json = excluded.match_json;`,
    id,
    rule.categoryId,
    rule.priority,
    rule.enabled ? 1 : 0,
    rule.learned ? 1 : 0,
    JSON.stringify(rule.match),
    new Date().toISOString(),
  );
  return id;
}

export async function deleteRule(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM rules WHERE id = ?;', id);
}
