import type { BackgroundId, RecentMeeting, ScheduledMeeting, Settings, ThemeMode } from '../types';

const settingsKey = 'LetsConnect.settings';
const recentKey = 'LetsConnect.recent';
const scheduleKey = 'LetsConnect.schedule';

function isNativeShell() {
  try {
    return Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

function systemTheme(): ThemeMode {
  // Native app defaults to light so the home shell never lands on a black WebView canvas.
  if (isNativeShell()) return 'light';
  if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

export const defaultSettings: Settings = {
  name: '',
  micId: '',
  camId: '',
  speakerId: '',
  mirror: true,
  noiseSuppression: true,
  instantJoin: false,
  sounds: true,
  theme: systemTheme(),
  background: 'none',
};

const themes = new Set<ThemeMode>(['light', 'dark']);
const backgrounds = new Set<BackgroundId>(['none', 'blur', 'office', 'studio', 'home', 'custom']);

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(settingsKey);
    if (!raw) return { ...defaultSettings };
    const parsed = { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
    if (!themes.has(parsed.theme)) parsed.theme = defaultSettings.theme;
    if (!backgrounds.has(parsed.background)) parsed.background = 'none';
    return parsed;
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: Settings) {
  localStorage.setItem(settingsKey, JSON.stringify(settings));
}

export function loadRecent(): RecentMeeting[] {
  try {
    const raw = localStorage.getItem(recentKey);
    return raw ? (JSON.parse(raw) as RecentMeeting[]) : [];
  } catch {
    return [];
  }
}

export function rememberMeeting(entry: RecentMeeting) {
  const next = [entry, ...loadRecent().filter((item) => item.code !== entry.code)].slice(0, 8);
  localStorage.setItem(recentKey, JSON.stringify(next));
  return next;
}

export function forgetMeeting(code: string) {
  const next = loadRecent().filter((item) => item.code !== code);
  localStorage.setItem(recentKey, JSON.stringify(next));
  return next;
}

export function loadSchedule(): ScheduledMeeting[] {
  try {
    const raw = localStorage.getItem(scheduleKey);
    return raw ? (JSON.parse(raw) as ScheduledMeeting[]) : [];
  } catch {
    return [];
  }
}

export function saveSchedule(items: ScheduledMeeting[]) {
  localStorage.setItem(scheduleKey, JSON.stringify(items));
}
