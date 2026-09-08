import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import type { DownloadTask } from 'expo-file-system';
import { radius, spacing, type, useTheme } from '../design';
import {
  QWEN3_1_7B,
  hasRoomFor,
  isDownloaded,
  removeModel,
  startDownload,
  verify,
  type ModelSpec,
} from '../assistant/model-file';
import { SETTING_ASSISTANT_ENABLED, readSetting, writeSetting } from '../db/settings-repo';
import { Card } from './Card';
import { Button } from './ui/Button';

type Phase =
  | { kind: 'absent' }
  | { kind: 'downloading'; written: number; total: number; paused: boolean }
  | { kind: 'verifying'; fraction: number }
  | { kind: 'installed' }
  | { kind: 'failed'; reason: string };

function formatSize(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    bytes / 1_000_000_000,
  )} GB`;
}

/** A filled track. Cheaper than pulling in a progress component for one screen. */
function Bar({ fraction }: { fraction: number }) {
  const theme = useTheme();
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return (
    <View style={[styles.track, { backgroundColor: theme.surfaceAlt }]}>
      <View style={[styles.fill, { backgroundColor: theme.accent, width: `${clamped * 100}%` }]} />
    </View>
  );
}

/**
 * Installing the local assistant.
 *
 * This screen owns the only network request FinAnt makes, and says so before
 * making it. Read `docs/security-model.md` before changing what it does: the
 * download is one explicit tap, to one pinned host, for one file whose SHA-256
 * is known in advance, and it sends nothing about the owner.
 */
export function AssistantSettings({ locale }: { locale: string }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const spec: ModelSpec = QWEN3_1_7B;

  const [phase, setPhase] = useState<Phase>(() =>
    isDownloaded(spec) ? { kind: 'installed' } : { kind: 'absent' },
  );
  const [enabled, setEnabled] = useState(false);
  const task = useRef<DownloadTask | null>(null);

  useEffect(() => {
    let alive = true;
    void readSetting(SETTING_ASSISTANT_ENABLED).then((value) => {
      if (alive) setEnabled(value === 'true');
    });
    return () => {
      alive = false;
    };
  }, []);

  const runVerify = useCallback(async () => {
    setPhase({ kind: 'verifying', fraction: 0 });
    const result = await verify(spec, (fraction) => setPhase({ kind: 'verifying', fraction }));

    if (result === 'ok') {
      setPhase({ kind: 'installed' });
      // Installing it is consent to use it; the switch is there to turn it off.
      await writeSetting(SETTING_ASSISTANT_ENABLED, 'true');
      setEnabled(true);
      return;
    }

    // Anything that is not the expected file is deleted rather than kept
    // around to be loaded later.
    removeModel(spec);
    setPhase({
      kind: 'failed',
      reason:
        result === 'wrong-checksum' ? t('assistant.checksumFailed') : t('assistant.downloadFailed'),
    });
  }, [spec, t]);

  const begin = useCallback(async () => {
    if (!hasRoomFor(spec)) {
      setPhase({ kind: 'failed', reason: t('assistant.downloadFailed') });
      return;
    }

    setPhase({ kind: 'downloading', written: 0, total: spec.bytes, paused: false });

    const running = startDownload(spec, ({ bytesWritten, totalBytes }) => {
      setPhase((current) =>
        current.kind === 'downloading'
          ? {
              ...current,
              written: bytesWritten,
              // The server may not send a length; the spec's figure is exact.
              total: totalBytes > 0 ? totalBytes : spec.bytes,
            }
          : current,
      );
    });
    task.current = running;

    try {
      const file = await running.downloadAsync();
      // `null` means it paused rather than finished; the resume path verifies.
      if (file !== null) await runVerify();
    } catch {
      setPhase({ kind: 'failed', reason: t('assistant.downloadFailed') });
    }
  }, [spec, runVerify, t]);

  const pause = useCallback(() => {
    task.current?.pause();
    setPhase((current) =>
      current.kind === 'downloading' ? { ...current, paused: true } : current,
    );
  }, []);

  const resume = useCallback(async () => {
    const running = task.current;
    if (running === null) return;
    setPhase((current) =>
      current.kind === 'downloading' ? { ...current, paused: false } : current,
    );
    try {
      const file = await running.resumeAsync();
      if (file !== null) await runVerify();
    } catch {
      setPhase({ kind: 'failed', reason: t('assistant.downloadFailed') });
    }
  }, [runVerify, t]);

  const cancelDownload = useCallback(() => {
    task.current?.cancel();
    task.current = null;
    removeModel(spec);
    setPhase({ kind: 'absent' });
  }, [spec]);

  const remove = useCallback(() => {
    Alert.alert(t('assistant.settingsTitle'), t('assistant.removeConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          removeModel(spec);
          void writeSetting(SETTING_ASSISTANT_ENABLED, 'false');
          setEnabled(false);
          setPhase({ kind: 'absent' });
        },
      },
    ]);
  }, [spec, t]);

  const toggle = useCallback((next: boolean) => {
    setEnabled(next);
    void writeSetting(SETTING_ASSISTANT_ENABLED, next ? 'true' : 'false');
  }, []);

  return (
    <Card title={t('assistant.settingsTitle')}>
      <Text style={[type.body, { color: theme.textMuted }]}>{t('assistant.settingsBody')}</Text>

      <View style={[styles.card, { backgroundColor: theme.surfaceAlt }]}>
        <Text style={[type.label, { color: theme.text }]}>{t('assistant.modelName')}</Text>
        <Text style={[type.caption, { color: theme.textMuted }]}>
          {t('assistant.modelMeta', { size: formatSize(spec.bytes, locale) })}
        </Text>

        {phase.kind === 'absent' ? (
          <>
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {t('assistant.downloadWarning')}
            </Text>
            <Button label={t('assistant.download')} onPress={() => void begin()} />
          </>
        ) : null}

        {phase.kind === 'downloading' ? (
          <>
            <Bar fraction={phase.total > 0 ? phase.written / phase.total : 0} />
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {t('assistant.downloading', {
                done: formatSize(phase.written, locale),
                total: formatSize(phase.total, locale),
              })}
            </Text>
            <View style={styles.actions}>
              <Button
                label={phase.paused ? t('assistant.resumeDownload') : t('assistant.pause')}
                variant="secondary"
                onPress={phase.paused ? () => void resume() : pause}
              />
              <Button label={t('common.cancel')} variant="secondary" onPress={cancelDownload} />
            </View>
          </>
        ) : null}

        {phase.kind === 'verifying' ? (
          <>
            <Bar fraction={phase.fraction} />
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {t('assistant.verifying')}
            </Text>
          </>
        ) : null}

        {phase.kind === 'failed' ? (
          <>
            <Text style={[type.caption, { color: theme.expense }]}>{phase.reason}</Text>
            <Button label={t('common.retry')} onPress={() => void begin()} />
          </>
        ) : null}

        {phase.kind === 'installed' ? (
          <>
            <Text style={[type.caption, { color: theme.income }]}>{t('assistant.installed')}</Text>
            <View style={styles.row}>
              <Text style={[type.body, styles.rowLabel, { color: theme.text }]}>
                {t('assistant.enabled')}
              </Text>
              <Switch value={enabled} onValueChange={toggle} />
            </View>
            <Button label={t('assistant.remove')} variant="danger" onPress={remove} />
          </>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, borderRadius: radius.lg, gap: spacing.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
  actions: { flexDirection: 'row', gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowLabel: { flex: 1 },
});
