import { Capacitor } from '@capacitor/core';

export function isNativeApp() {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function nativePlatform() {
  try {
    return Capacitor.getPlatform();
  } catch {
    return 'web';
  }
}

/** Deep-link scheme used to return Google credentials from Chrome Custom Tabs. */
export const NATIVE_AUTH_SCHEME = 'letsconnect';
export const NATIVE_AUTH_HOST = 'auth';

export function googleBridgeUrl() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/auth/google-bridge`;
}

export function parseNativeAuthUrl(url: string): { code?: string; idToken?: string; error?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol.replace(':', '') !== NATIVE_AUTH_SCHEME) return {};
    if (parsed.hostname !== NATIVE_AUTH_HOST && parsed.host !== NATIVE_AUTH_HOST) return {};
    const code = parsed.searchParams.get('code') || undefined;
    const idToken = parsed.searchParams.get('idToken') || undefined;
    const error = parsed.searchParams.get('error') || undefined;
    return { code, idToken, error };
  } catch {
    return {};
  }
}

/**
 * Open an HTTPS page outside the WebView (Chrome Custom Tabs / external browser).
 * Tries @capacitor/browser first, then an Android intent:// fallback so Google
 * sign-in still works if the plugin was missing from an older APK.
 */
export async function openExternalBrowser(url: string) {
  if (!isNativeApp()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url, toolbarColor: '#0b1411' });
    return;
  } catch (err) {
    console.warn('Capacitor Browser unavailable, using system browser', err);
  }

  if (nativePlatform() === 'android') {
    try {
      const parsed = new URL(url);
      const hostPath = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
      // Opens Chrome / default browser outside the WebView (Google OAuth works there).
      window.location.href = `intent://${hostPath}#Intent;scheme=${parsed.protocol.replace(':', '')};action=android.intent.action.VIEW;end`;
      return;
    } catch {
      /* fall through */
    }
  }

  window.open(url, '_blank', 'noopener,noreferrer');
}

export async function closeExternalBrowser() {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {
    /* ignore — intent fallback has no close handle */
  }
}
