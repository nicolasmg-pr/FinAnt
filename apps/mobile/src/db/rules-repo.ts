import { isShippedRuleId, parseRetiredShippedRules, type CategoryRule } from '@finant/core';
import { getDatabase } from './database';
import { toRule, type RuleRow } from './mappers';
import { readSetting, SETTING_RETIRED_SHIPPED_RULES, writeSetting } from './settings-repo';
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

/**
 * Deleting one of our own rules leaves a tombstone, so the launch-time install
 * does not put it straight back. A learned rule needs none: it was never in the
 * shipped set, so nothing would ever reinstall it.
 */
export async function deleteRule(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM rules WHERE id = ?;', id);
  if (!isShippedRuleId(id)) return;
  const retired = await listRetiredShippedRules();
  if (retired.includes(id)) return;
  await writeSetting(SETTING_RETIRED_SHIPPED_RULES, JSON.stringify([...retired, id]));
}

/** Shipped rules the owner has deleted. */
export async function listRetiredShippedRules(): Promise<string[]> {
  return parseRetiredShippedRules(await readSetting(SETTING_RETIRED_SHIPPED_RULES));
}
