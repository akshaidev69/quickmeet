import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from './native';

type MeetingChromePlugin = {
  setMeetingActive(options: { active: boolean }): Promise<void>;
  enterPip(): Promise<{ entered: boolean }>;
  isInPip(): Promise<{ inPip: boolean }>;
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
