import { describe, expect, it } from 'vitest';
import { BACKUP_TABLES, EXCLUDED_TABLES } from '@finant/core';
import { MIGRATIONS } from '../../db/schema';

/**
 * The guard that makes the backup manifest maintainable.
 *
 * A table added by a future migration and forgotten here would simply not be
 * backed up, and nobody would find out until a restore came up short — on the
 * one day that matters. This fails the suite instead, and the fix is a
 * deliberate choice between the manifest and the exclusion list.
 */
function tablesCreatedByMigrations(): string[] {
  const names: string[] = [];
  for (const migration of MIGRATIONS) {
    for (const match of migration.sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(\w+)/gi)) {
      const name = match[1];
      if (name !== undefined) names.push(name);
    }
  }
  return names;
}

describe('backup manifest coverage', () => {
  it('accounts for every table the migrations create', () => {
    const known = new Set([...BACKUP_TABLES, ...EXCLUDED_TABLES]);
    const missing = tablesCreatedByMigrations().filter((name) => !known.has(name));
    expect(
      missing,
      'add each of these to BACKUP_TABLES or EXCLUDED_TABLES in packages/core/src/backup.ts',
    ).toEqual([]);
  });

  it('names no table the schema does not create', () => {
    const created = new Set(tablesCreatedByMigrations());
    const stale = [...BACKUP_TABLES, ...EXCLUDED_TABLES].filter((name) => !created.has(name));
    expect(stale, 'these are in the manifest but no migration creates them').toEqual([]);
  });

  it('found the tables at all, so a regex change cannot silently pass the guard', () => {
    expect(tablesCreatedByMigrations().length).toBeGreaterThanOrEqual(15);
  });
});
