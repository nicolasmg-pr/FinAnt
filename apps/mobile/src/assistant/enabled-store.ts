import { useSyncExternalStore } from 'react';
import { SETTING_ASSISTANT_ENABLED, readSetting, writeSetting } from '../db/settings-repo';
import { QWEN3_1_7B, isDownloaded } from './model-file';

/**
 * Whether the bubble should be on screen, shared by the two places that care.
 *
 * The switch lives on the Settings screen; the bubble is rendered by the tab
 * layout, which mounted at launch and never unmounts. Reading the setting in a
 * mount-time effect meant the two never spoke: flipping the switch wrote to the
 * database and the bubble appeared on the *next* launch, which reads as the
 * feature being broken.
 *
 * One module-level value with subscribers, rather than a context provider, so
 * the tab layout does not have to be wrapped in anything and a write from any
 * screen reaches whatever is already rendered.
 */

let enabled = false;
let loaded = false;
const listeners = new Set<() => void>();

/** Re-reads the setting and tells everyone, but only if the answer changed. */
export async function reloadAssistantEnabled(): Promise<void> {
  const stored = await readSetting(SETTING_ASSISTANT_ENABLED);
  // The file matters as much as the flag: a setting left on after the model was
  // deleted would put a bubble on screen that opens onto nothing.
  const next = stored === 'true' && isDownloaded(QWEN3_1_7B);
  if (next === enabled) return;
  enabled = next;
  for (const listener of listeners) listener();
}

export async function setAssistantEnabled(next: boolean): Promise<void> {
  await writeSetting(SETTING_ASSISTANT_ENABLED, next ? 'true' : 'false');
  await reloadAssistantEnabled();
}

export function getAssistantEnabled(): boolean {
  return enabled;
}

export function subscribeToAssistant(listener: () => void): () => void {
  listeners.add(listener);
  // The first subscriber triggers the initial read; later ones join the value
  // that is already there.
  if (!loaded) {
    loaded = true;
    void reloadAssistantEnabled();
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useAssistantEnabled(): boolean {
  return useSyncExternalStore(subscribeToAssistant, getAssistantEnabled);
}
