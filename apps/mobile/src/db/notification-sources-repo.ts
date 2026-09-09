import type { NotificationRoute } from '@finant/core';
import { getDatabase } from './database';
import {
  toNotificationRoute,
  toNotificationSource,
  type NotificationRouteRow,
  type NotificationSource,
  type NotificationSourceRow,
} from './mappers';
import { newId } from './transactions-repo';

export async function listNotificationSources(): Promise<NotificationSource[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NotificationSourceRow>(
    'SELECT * FROM notification_sources ORDER BY label;',
  );
  return rows.map(toNotificationSource);
}

export async function getNotificationSourceByPackage(
  packageName: string,
): Promise<NotificationSource | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<NotificationSourceRow>(
    'SELECT * FROM notification_sources WHERE package_name = ?;',
    packageName,
  );
  return row ? toNotificationSource(row) : null;
}

export async function createNotificationSource(input: {
  packageName: string;
  label: string;
  institutionId: string | null;
}): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  await db.runAsync(
    `INSERT INTO notification_sources (id, package_name, label, institution_id, enabled, auto_approve, created_at)
       VALUES (?, ?, ?, ?, 1, 0, ?);`,
    id,
    input.packageName,
    input.label,
    input.institutionId,
    new Date().toISOString(),
  );
  return id;
}

export async function updateNotificationSource(
  id: string,
  patch: { label?: string; enabled?: boolean; autoApprove?: boolean },
): Promise<void> {
  const db = await getDatabase();
  if (patch.label !== undefined) {
    await db.runAsync('UPDATE notification_sources SET label = ? WHERE id = ?;', patch.label, id);
  }
  if (patch.enabled !== undefined) {
    await db.runAsync(
      'UPDATE notification_sources SET enabled = ? WHERE id = ?;',
      patch.enabled ? 1 : 0,
      id,
    );
  }
  if (patch.autoApprove !== undefined) {
    await db.runAsync(
      'UPDATE notification_sources SET auto_approve = ? WHERE id = ?;',
      patch.autoApprove ? 1 : 0,
      id,
    );
  }
}

export async function deleteNotificationSource(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notification_sources WHERE id = ?;', id);
}

export async function listNotificationRoutes(sourceId: string): Promise<NotificationRoute[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<NotificationRouteRow>(
    'SELECT * FROM notification_routes WHERE source_id = ? ORDER BY priority DESC, id;',
    sourceId,
  );
  return rows.map(toNotificationRoute);
}

export async function createNotificationRoute(input: {
  sourceId: string;
  accountId: string;
  match: NotificationRoute['match'];
  priority?: number;
}): Promise<string> {
  const db = await getDatabase();
  const id = newId();
  await db.runAsync(
    `INSERT INTO notification_routes (id, source_id, account_id, match_json, priority, created_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
    id,
    input.sourceId,
    input.accountId,
    input.match === null ? null : JSON.stringify(input.match),
    input.priority ?? 100,
    new Date().toISOString(),
  );
  return id;
}

export async function deleteNotificationRoute(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM notification_routes WHERE id = ?;', id);
}

/**
 * The package names the native listener is allowed to read, projected out of
 * the database so it can be pushed into SharedPreferences.
 *
 * The database is authoritative; the preferences copy exists only because the
 * listener runs while the app is closed and the SQLCipher connection is not
 * open.
 */
export async function allowedPackageNames(): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ package_name: string }>(
    'SELECT package_name FROM notification_sources WHERE enabled = 1;',
  );
  return rows.map((row) => row.package_name);
}
