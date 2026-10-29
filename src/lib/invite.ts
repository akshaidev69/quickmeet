import { formatCode, isFullCode, isValidMeetingCode } from './code';
import { isNativeApp } from './native';

export const APP_PACKAGE = 'com.letsconnect.app';
export const APP_SCHEME = 'letsconnect';
export const APK_DOWNLOAD_URL = '/letsconnect.apk';
export const PENDING_JOIN_KEY = 'lc-pending-join';

function originOf() {
  return typeof location !== 'undefined' ? location.origin : '';
}

/** Link people share. Opens the app/web chooser. */
export function shareInviteUrl(code: string, origin = originOf()) {
  return `${origin}/join?room=${encodeURIComponent(formatCode(code))}`;
}

/** Waiting-room URL after the guest chooses web (or the native app). */
export function webJoinUrl(code: string, origin = originOf()) {
  return `${origin}/app?room=${encodeURIComponent(formatCode(code))}`;
}

export function nativeJoinUrl(code: string) {
  return `${APP_SCHEME}://join?room=${encodeURIComponent(formatCode(code))}`;
}

export function androidJoinIntent(code: string) {
  const room = encodeURIComponent(formatCode(code));
  return `intent://join?room=${room}#Intent;scheme=${APP_SCHEME};package=${APP_PACKAGE};end`;
}

export function isAuthDeepLink(raw: string) {
  try {
    const parsed = new URL(raw);
    const scheme = parsed.protocol.replace(/:$/, '');
    return scheme === APP_SCHEME && (parsed.hostname === 'auth' || parsed.host === 'auth');
  } catch {
    return false;
  }
}

export function isAndroidWeb() {
  return typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
}

export function roomFromLocation(href = typeof location !== 'undefined' ? location.href : '') {
  return meetingCodeFromUrl(href) || '';
}

export function meetingCodeFromUrl(raw: string): string | null {
  if (!raw || isAuthDeepLink(raw)) return null;
  try {
    const parsed = new URL(raw, typeof location !== 'undefined' ? location.origin : 'https://letsconnect.local');
    const fromQuery = parsed.searchParams.get('room') || parsed.searchParams.get('meeting');
    if (fromQuery) {
      const code = formatCode(fromQuery);
      if (isFullCode(code) && isValidMeetingCode(code)) return code;
    }
    const host = (parsed.hostname || parsed.host || '').replace(/\.$/, '');
    const path = `${host === 'join' || host === 'app' || host === 'meeting' || host === 'room' ? `/${host}` : ''}${parsed.pathname || ''}`;
    const match = path.match(/\/(?:join|app|meeting|room)\/([a-zA-Z0-9-]+)/i);
    if (match?.[1]) {
      const code = formatCode(match[1]);
      if (isFullCode(code) && isValidMeetingCode(code)) return code;
    }
  } catch {
    /* ignore */
  }
  const fallback = raw.match(/[?&#]room=([a-zA-Z0-9-]+)/i);
  if (fallback?.[1]) {
    const code = formatCode(fallback[1]);
    if (isFullCode(code) && isValidMeetingCode(code)) return code;
  }
  return null;
}

export function wantsJoinGate(code: string) {
  if (!code || isNativeApp()) return false;
  const formatted = formatCode(code);
  if (!isFullCode(formatted) || !isValidMeetingCode(formatted)) return false;
  try {
    if (sessionStorage.getItem(webJoinKey(formatted)) === '1') return false;
  } catch {
    /* private mode */
  }
  const path = (typeof location !== 'undefined' ? location.pathname : '').replace(/\/+$/, '') || '/';
  return path === '/join' || path.startsWith('/join/');
}

export function webJoinKey(code: string) {
  return `lc-web-join:${formatCode(code)}`;
}

export function rememberWebJoin(code: string) {
  try {
    sessionStorage.setItem(webJoinKey(code), '1');
  } catch {
    /* private mode */
  }
}

export function rememberPendingJoin(code: string) {
  try {
    sessionStorage.setItem(PENDING_JOIN_KEY, formatCode(code));
  } catch {
    /* private mode */
  }
}

export function takePendingJoin() {
  try {
    const code = sessionStorage.getItem(PENDING_JOIN_KEY) || '';
    if (code) sessionStorage.removeItem(PENDING_JOIN_KEY);
    return code;
  } catch {
    return '';
  }
}

export function peekPendingJoin() {
  try {
    return sessionStorage.getItem(PENDING_JOIN_KEY) || '';
  } catch {
    return '';
  }
}

export function consumeJoinDeepLink(raw: string) {
  const code = meetingCodeFromUrl(raw);
  if (!code || typeof history === 'undefined') return false;
  try {
    rememberPendingJoin(code);
    const url = new URL(webJoinUrl(code), location.href);
    history.replaceState({ view: 'lobby' }, '', url);
    return true;
  } catch {
    return false;
  }
}

/** Open the native app if installed. No store fallback — the chooser stays if the app is missing. */
export function openInNativeApp(code: string) {
  if (isAndroidWeb()) {
    window.location.href = androidJoinIntent(code);
    return;
  }
  window.location.href = nativeJoinUrl(code);
}

export function downloadApk() {
  const link = document.createElement('a');
  link.href = APK_DOWNLOAD_URL;
  link.download = 'LetsConnect.apk';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Try the installed app, then download the APK if this page is still visible. */
export function continueWithApp(code: string, onDownload?: () => void) {
  openInNativeApp(code);
  window.setTimeout(() => {
    if (document.visibilityState === 'hidden') return;
    onDownload?.();
    downloadApk();
  }, 1400);
}
