import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './native';

type MeetingChromePlugin = {
  setMeetingActive(options: { active: boolean }): Promise<void>;
  setControls(options: { micOn: boolean; camOn: boolean }): Promise<void>;
  enterPip(): Promise<{ entered: boolean }>;
  isInPip(): Promise<{ inPip: boolean }>;
  addListener(
    event: 'pipMode',
    listener: (data: { inPip: boolean }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: 'pipAction',
    listener: (data: { act: string }) => void,
  ): Promise<PluginListenerHandle>;
};

const MeetingChrome = registerPlugin<MeetingChromePlugin>('MeetingChrome');

export async function setMeetingActive(active: boolean) {
  if (!isNativeApp()) return;
  try {
    await MeetingChrome.setMeetingActive({ active });
  } catch {
    /* older APK without plugin */
  }
}

export async function setPipControls(micOn: boolean, camOn: boolean) {
  if (!isNativeApp()) return;
  try {
    await MeetingChrome.setControls({ micOn, camOn });
  } catch {
    /* older APK */
  }
}

export function onNativePipMode(listener: (inPip: boolean) => void) {
  if (!isNativeApp()) return () => undefined;
  let handle: PluginListenerHandle | null = null;
  void MeetingChrome.addListener('pipMode', (data) => listener(Boolean(data.inPip))).then((value) => {
    handle = value;
  });
  return () => {
    void handle?.remove();
  };
}

export function onNativePipAction(listener: (act: string) => void) {
  if (!isNativeApp()) return () => undefined;
  let handle: PluginListenerHandle | null = null;
  void MeetingChrome.addListener('pipAction', (data) => listener(String(data.act || ''))).then((value) => {
    handle = value;
  });
  return () => {
    void handle?.remove();
  };
}

/** Shrink the meeting into an Android PiP bubble (Meet-style minimize). */
export async function enterPip() {
  if (!isNativeApp()) return false;
  try {
    const result = await MeetingChrome.enterPip();
    return Boolean(result.entered);
  } catch {
    return false;
  }
}

export async function isInPip() {
  if (!isNativeApp()) return false;
  try {
    const result = await MeetingChrome.isInPip();
    return Boolean(result.inPip);
  } catch {
    return false;
  }
}
