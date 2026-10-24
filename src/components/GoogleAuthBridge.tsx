import { useEffect, useRef, useState } from 'react';
import { Logo } from './icons';
import { requestGoogleIdTokenForBridge } from '../lib/firebase';
import { NATIVE_AUTH_HOST, NATIVE_AUTH_SCHEME } from '../lib/native';

/**
 * Opened inside Chrome Custom Tabs from the Android app.
 * GIS works here (real Chrome). On success we deep-link back into the app.
 */
export function GoogleAuthBridge() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Tap Continue with Google below');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const idToken = await requestGoogleIdTokenForBridge(mountRef.current);
        if (cancelled) return;
        setStatus('Returning to LetsConnect…');
        const target = `${NATIVE_AUTH_SCHEME}://${NATIVE_AUTH_HOST}?idToken=${encodeURIComponent(idToken)}`;
        window.location.href = target;
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Google sign-in failed';
        setError(message);
        setStatus('Could not finish Google sign-in');
        const target = `${NATIVE_AUTH_SCHEME}://${NATIVE_AUTH_HOST}?error=${encodeURIComponent(message)}`;
        window.setTimeout(() => {
          window.location.href = target;
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
