import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

/** Public Firebase web config (safe in client; override with VITE_* env when needed). */
const config = {
  apiKey: (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined) || 'AIzaSyBcP319FVEOh66xsbNLmNNh4kBFBR1vGCo',
  authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined) || 'letsconnect-e8c03.firebaseapp.com',
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

export async function signInWithGooglePopup(): Promise<{ user: User; idToken: string }> {
  const authInstance = getFirebaseAuth();
  if (!authInstance) throw new Error('Firebase is not configured yet.');
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', login_hint: 'anmolg2270@gmail.com' });
  provider.addScope('email');
  provider.addScope('profile');
  const result = await signInWithPopup(authInstance, provider);
  const idToken = await result.user.getIdToken();
  return { user: result.user, idToken };
}

export async function signOutFirebase() {
  const authInstance = getFirebaseAuth();
  if (authInstance) await signOut(authInstance);
}
