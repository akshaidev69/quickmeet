import { useEffect, useRef, useState } from 'react';
import { Logo } from './icons';
import { createFirebaseHandoff } from '../lib/api';
import { exchangeGoogleIdToken, requestGoogleIdTokenForBridge } from '../lib/firebase';
import { NATIVE_AUTH_HOST, NATIVE_AUTH_SCHEME } from '../lib/native';

/**
 * Opened inside Chrome Custom Tabs from the Android app.
 * GIS works here (real Chrome). We exchange for Firebase, stash a short handoff
 * code on the server, then deep-link back — never put the JWT in the URL.
 */
export function GoogleAuthBridge() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Tap Continue with Google below');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const googleIdToken = await requestGoogleIdTokenForBridge(mountRef.current);
        if (cancelled) return;
        setStatus('Securing your session…');
        // Prefer Firebase ID token; server also accepts raw Google GIS tokens.
        let token = googleIdToken;
        try {
          token = await exchangeGoogleIdToken(googleIdToken);
        } catch (err) {
          console.warn('Firebase exchange failed; handing off Google token', err);
        }
        if (cancelled) return;
        const { code } = await createFirebaseHandoff(token);
        if (cancelled) return;
        setStatus('Returning to LetsConnect…');
        window.location.href = `${NATIVE_AUTH_SCHEME}://${NATIVE_AUTH_HOST}?code=${encodeURIComponent(code)}`;
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Google sign-in failed';
        setError(message);
        setStatus('Could not finish Google sign-in');
        window.setTimeout(() => {
          window.location.href = `${NATIVE_AUTH_SCHEME}://${NATIVE_AUTH_HOST}?error=${encodeURIComponent(message)}`;
        }, 1600);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand">
          <Logo size={32} />
          <h1>Continue with Google</h1>
          <p>{status}</p>
        </div>
        <div ref={mountRef} />
        {error && <p className="warn-text">{error}</p>}
        <p className="auth-hint">Keep this window open until LetsConnect opens again.</p>
      </section>
    </main>
  );
}
