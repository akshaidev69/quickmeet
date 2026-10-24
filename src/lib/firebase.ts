import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

function resolveAuthDomain() {
  if (typeof window === 'undefined') return 'letsconnect-e8c03.firebaseapp.com';
  const host = window.location.hostname;
  // Same-origin auth handler (proxied) so Google shows this site — not firebaseapp.com.
  if (host && host !== 'localhost' && host !== '127.0.0.1') return host;
  return 'letsconnect-e8c03.firebaseapp.com';
}

/** Public Firebase web config (safe in client; override with VITE_* env when needed). */
const config = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || 'AIzaSyBcP319FVEOh66xsbNLmNNh4kBFBR1vGCo',
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || resolveAuthDomain(),
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || 'letsconnect-e8c03',
  appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined) || '1:183754318076:web:24e296ed563b69c275f779',
  messagingSenderId:
    (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined) || '183754318076',
};

export function firebaseConfigured() {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

function getFirebaseAuth() {
  if (!firebaseConfigured()) return null;
  if (!app) {
    app = initializeApp({
      apiKey: config.apiKey!,
      authDomain: config.authDomain!,
      projectId: config.projectId!,
      appId: config.appId!,
      messagingSenderId: config.messagingSenderId,
    });
    auth = getAuth(app);
  }
  return auth;
}

function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  provider.addScope('email');
  provider.addScope('profile');
  return provider;
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
    return 'Google sign-in window closed before finishing. Try again, and keep the popup open until it completes.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.';
  }
  return message.replace(/^Firebase:\s*/i, '').trim() || 'Google sign-in failed';
}

export async function signInWithGooglePopup(): Promise<{ user: User; idToken: string }> {
  const authInstance = getFirebaseAuth();
  if (!authInstance) throw new Error('Google sign-in is not ready yet.');
  try {
    const result = await signInWithPopup(authInstance, googleProvider());
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
