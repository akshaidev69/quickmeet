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

export function parseNativeAuthUrl(url: string): { idToken?: string; error?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol.replace(':', '') !== NATIVE_AUTH_SCHEME) return {};
    if (parsed.hostname !== NATIVE_AUTH_HOST && parsed.host !== NATIVE_AUTH_HOST) return {};
    const idToken = parsed.searchParams.get('idToken') || undefined;
    const error = parsed.searchParams.get('error') || undefined;
    return { idToken, error };
  } catch {
    return {};
  }
}
