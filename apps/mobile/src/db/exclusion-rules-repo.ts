import type { ExclusionRule } from '@finant/core';
import { getDatabase } from './database';
import { toExclusionRule, type ExclusionRuleRow } from './mappers';
import { newId } from './transactions-repo';

export async function listExclusionRules(): Promise<ExclusionRule[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<ExclusionRuleRow>(
    'SELECT * FROM exclusion_rules ORDER BY created_at DESC, id ASC;',
  );
  return rows.map(toExclusionRule);
}

export async function saveExclusionRule(
  rule: Omit<ExclusionRule, 'id'> & { id?: string },
): Promise<string> {
  const db = await getDatabase();
  const id = rule.id ?? newId();
  await db.runAsync(
    `INSERT INTO exclusion_rules (id, match_json, enabled, learned, created_at)
       VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       match_json = excluded.match_json,
       enabled = excluded.enabled;`,
    id,
    JSON.stringify(rule.match),
    rule.enabled ? 1 : 0,
    rule.learned ? 1 : 0,
    new Date().toISOString(),
  );
  return id;
}

/**
 * Removes a rule for good. The movements it already excluded keep their flag —
 * un-excluding them is a separate, explicit call, so deleting a rule from
 * Settings never rewrites history on its own.
 */
export async function deleteExclusionRule(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM exclusion_rules WHERE id = ?;', id);
}
