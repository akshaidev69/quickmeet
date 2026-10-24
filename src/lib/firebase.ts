import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithCredential,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

/** Firebase web Google client — used with Google Identity Services (no firebaseapp.com popup). */
const GOOGLE_WEB_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
  '183754318076-ck9l1s0sje8updc4tgb2d581b2cj4jf8.apps.googleusercontent.com';

const PROJECT = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || 'AIzaSyBcP319FVEOh66xsbNLmNNh4kBFBR1vGCo',
  authDomain: 'letsconnect-e8c03.firebaseapp.com',
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || 'letsconnect-e8c03',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || '1:183754318076:web:24e296ed563b69c275f779',
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || '183754318076',
};

export function firebaseConfigured() {
  return Boolean(PROJECT.apiKey && PROJECT.projectId && PROJECT.appId && GOOGLE_WEB_CLIENT_ID);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let gisLoading: Promise<void> | null = null;

function getFirebaseAuth() {
  if (!firebaseConfigured()) return null;
  if (!app) {
    app = initializeApp(PROJECT);
    auth = getAuth(app);
  }
  return auth;
}

function loadGis(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  const w = window as Window & { google?: { accounts?: { id?: unknown; oauth2?: unknown } } };
  if (w.google?.accounts?.id) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-lc-gis="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google sign-in script failed to load')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.lcGis = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google sign-in script failed to load'));
    document.head.appendChild(script);
  });
  return gisLoading;
}

type GisCredentialResponse = { credential?: string };

type GisIdApi = {
  initialize: (config: Record<string, unknown>) => void;
  prompt: (cb?: (notification: {
    isNotDisplayed: () => boolean;
    isSkippedMoment: () => boolean;
    getNotDisplayedReason?: () => string;
  }) => void) => void;
  cancel: () => void;
  renderButton: (parent: HTMLElement, config: Record<string, unknown>) => void;
};

function getGisId(): GisIdApi | null {
  const google = (window as Window & { google?: { accounts?: { id?: GisIdApi } } }).google;
  return google?.accounts?.id || null;
}

function requestGoogleIdToken(options?: { visible?: boolean; mount?: HTMLElement | null }): Promise<string> {
  const visible = Boolean(options?.visible);
  return loadGis().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const google = getGisId();
        if (!google) {
          reject(new Error('Google sign-in is unavailable in this browser.'));
          return;
        }

        let settled = false;
        const host = document.createElement('div');
        if (visible) {
          host.style.cssText =
            'display:flex;justify-content:center;margin:12px 0 4px;min-height:44px;width:100%';
        } else {
          host.style.cssText =
            'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
        }
        const mount = options?.mount || document.body;
        mount.appendChild(host);

        const finish = (err?: Error, token?: string) => {
          if (settled) return;
          settled = true;
          try {
            google.cancel();
          } catch {
            /* ignore */
          }
          host.remove();
          if (err) reject(err);
          else resolve(token!);
        };

        google.initialize({
          client_id: GOOGLE_WEB_CLIENT_ID,
          callback: (response: GisCredentialResponse) => {
            if (response?.credential) finish(undefined, response.credential);
            else finish(new Error('Google did not return a sign-in credential.'));
          },
          auto_select: false,
          cancel_on_tap_outside: true,
          context: 'signin',
          ux_mode: 'popup',
          itp_support: true,
        });

        google.renderButton(host, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: 280,
        });

        window.setTimeout(() => {
          if (visible) {
            // Bridge page: wait for the real user tap (Custom Tab / Chrome).
            return;
          }
          const btn = host.querySelector('div[role="button"]') as HTMLElement | null;
          if (!btn) {
            finish(new Error('Could not start Google sign-in. Try again.'));
            return;
          }
          btn.click();
        }, 50);

        window.setTimeout(() => {
          finish(new Error('Google sign-in timed out. Try again.'));
        }, 120_000);
      }),
  );
}

/** Used by /auth/google-bridge inside Chrome Custom Tabs (APK). */
export function requestGoogleIdTokenForBridge(mount?: HTMLElement | null): Promise<string> {
  return requestGoogleIdToken({ visible: true, mount });
}

export function explainFirebaseAuthError(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err && typeof (err as { code: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  const message = err instanceof Error ? err.message : String(err || 'Google sign-in failed');
  if (code === 'auth/unauthorized-domain' || /unauthorized-domain/i.test(message)) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'your-domain';
    return `This site (${host}) is not allowed for Google sign-in yet. Add it under Firebase → Authentication → Authorized domains.`;
  }
  if (code === 'auth/popup-closed-by-user' || /popup-closed/i.test(message)) {
    return 'Google sign-in window closed before finishing. Try again.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google sign-in window. Allow popups for this site and try again.';
  }
  return message.replace(/^Firebase:\s*/i, '').trim() || 'Google sign-in failed';
}

export async function signInWithGooglePopup(): Promise<{ user: User; idToken: string }> {
  const authInstance = getFirebaseAuth();
  if (!authInstance) throw new Error('Google sign-in is not ready yet.');
  try {
    const googleIdToken = await requestGoogleIdToken();
    const credential = GoogleAuthProvider.credential(googleIdToken);
    const result = await signInWithCredential(authInstance, credential);
    const idToken = await result.user.getIdToken();
    return { user: result.user, idToken };
  } catch (err) {
    throw new Error(explainFirebaseAuthError(err));
  }
}

export async function signOutFirebase() {
  const authInstance = getFirebaseAuth();
  if (authInstance) await signOut(authInstance);
}
