import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The bubble is rendered by the tab layout, which mounts once at launch. The
 * switch that turns it on lives on a screen mounted later. Reading the setting
 * in a mount-time effect meant flipping the switch changed the database and
 * nothing else: the bubble only appeared on the next launch.
 *
 * These pin the part that fixes it — a write notifies whatever is already on
 * screen.
 */

const settings = new Map<string, string>();

vi.mock('../../db/settings-repo', () => ({
  SETTING_ASSISTANT_ENABLED: 'assistantEnabled',
  readSetting: (key: string) => Promise.resolve(settings.get(key) ?? null),
  writeSetting: (key: string, value: string) => {
    settings.set(key, value);
    return Promise.resolve();
  },
}));

let modelPresent = true;
vi.mock('../model-file', () => ({
  QWEN3_1_7B: { id: 'test-model' },
  isDownloaded: () => modelPresent,
}));

const { getAssistantEnabled, reloadAssistantEnabled, setAssistantEnabled, subscribeToAssistant } =
  await import('../enabled-store');

describe('the assistant enabled store', () => {
  beforeEach(async () => {
    settings.clear();
    modelPresent = true;
    await reloadAssistantEnabled();
  });

  it('is off when nothing has been stored', () => {
    expect(getAssistantEnabled()).toBe(false);
  });

  it('tells a listener that subscribed before the switch was flipped', async () => {
    const heard: boolean[] = [];
    subscribeToAssistant(() => heard.push(getAssistantEnabled()));

    await setAssistantEnabled(true);

    expect(heard).toEqual([true]);
    expect(getAssistantEnabled()).toBe(true);
  });

  it('tells the same listener when it is switched back off', async () => {
    await setAssistantEnabled(true);
    const heard: boolean[] = [];
    subscribeToAssistant(() => heard.push(getAssistantEnabled()));

    await setAssistantEnabled(false);

    expect(heard).toEqual([false]);
  });

  it('says nothing when the value did not actually change', async () => {
    await setAssistantEnabled(true);
    const heard: boolean[] = [];
    subscribeToAssistant(() => heard.push(getAssistantEnabled()));

    await setAssistantEnabled(true);

    expect(heard).toEqual([]);
  });

  it('stays off while the model file is missing, whatever the setting says', async () => {
    modelPresent = false;

    await setAssistantEnabled(true);

    expect(getAssistantEnabled()).toBe(false);
  });

  it('stops telling a listener that unsubscribed', async () => {
    const heard: boolean[] = [];
    const stop = subscribeToAssistant(() => heard.push(getAssistantEnabled()));
    stop();

    await setAssistantEnabled(true);

    expect(heard).toEqual([]);
  });
});
