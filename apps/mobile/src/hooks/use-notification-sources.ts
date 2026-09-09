import { useCallback, useEffect, useState } from 'react';
import type { NotificationRoute } from '@finant/core';
import NotificationCapture from '../../modules/notification-capture';
import { listNotificationRoutes, listNotificationSources } from '../db/notification-sources-repo';
import type { NotificationSource } from '../db/mappers';

export interface SourceWithRoutes {
  readonly source: NotificationSource;
  readonly routes: readonly NotificationRoute[];
}

/**
 * Every notification source on record, each with its own routes, plus whether
 * the owner has granted notification access. One hook because the settings
 * screen never needs sources without their routes: a source's card renders
 * both at once.
 */
export function useNotificationSources() {
  const [sources, setSources] = useState<SourceWithRoutes[]>([]);
  const [granted, setGranted] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const rows = await listNotificationSources();
    const withRoutes = await Promise.all(
      rows.map(async (source) => ({ source, routes: await listNotificationRoutes(source.id) })),
    );
    setSources(withRoutes);
    setGranted(NotificationCapture.isSupported() && NotificationCapture.isPermissionGranted());
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { sources, granted, loading, reload };
}
