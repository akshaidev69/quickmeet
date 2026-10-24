import { useEffect, useState, type FormEvent } from 'react';
import { Logo } from './icons';
import { useAuth } from '../lib/auth';
import { fetchConfig, loginWithFirebaseToken } from '../lib/api';
import { firebaseConfigured, signInWithGooglePopup } from '../lib/firebase';

type Mode = 'login' | 'register';

type Props = {
  mode: Mode;
  onMode: (mode: Mode) => void;
  onSuccess: () => void;
  onBack: () => void;
};

export function AuthScreen({ mode, onMode, onSuccess, onBack }: Props) {
  const { login, register, setUser } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('anmolg2270@gmail.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState(firebaseConfigured());

  useEffect(() => {
    void fetchConfig()
      .then((config) => setGoogleOn(config.firebase || config.google || firebaseConfigured()))
      .catch(() => setGoogleOn(firebaseConfigured()));
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') await register(name, email, password);
      else await login(email, password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setError('');
    setBusy(true);
    try {
      if (!firebaseConfigured()) {
        window.location.href = '/api/auth/google';
        return;
      }
      const { idToken } = await signInWithGooglePopup();
      const data = await loginWithFirebaseToken(idToken);
      setUser(data.user);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
      console.error('Google sign-in failed', err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <button type="button" className="auth-back textbtn" onClick={onBack}>
        ← LetsConnect home
      </button>
      <section className="auth-card">
        <div className="auth-brand">
          <Logo size={32} />
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p>{mode === 'login' ? 'Log in with Google or email to open your meetings.' : 'Free forever for now — no card needed.'}</p>
        </div>

        <button type="button" className={googleOn ? 'google-btn' : 'google-btn off'} disabled={busy || !googleOn} onClick={() => void onGoogle()}>
          <GoogleMark />
          {busy ? 'Opening Google…' : googleOn ? 'Continue with Google' : 'Google sign-in loading…'}
        </button>
        <p className="auth-hint">Sign in with your Google account to open your LetsConnect meetings.</p>

        <div className="auth-or">or use email</div>

        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'register' && (
            <label className="field">
              <span>Name</span>
              <input value={name} maxLength={60} required autoComplete="name" onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} required autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && <p className="warn-text">{error}</p>}
          <button type="submit" className="primary xl ask-join" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login' ? (
            <>
              New here?{' '}
              <button type="button" className="textbtn" onClick={() => onMode('register')}>
                Sign up free
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="textbtn" onClick={() => onMode('login')}>
                Log in
              </button>
            </>
          )}
        </p>
      </section>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.1 4 9.3 8.5 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.2 39.5 16 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l.1.1 6.2 5.2C39.2 37.3 44 32 44 24c0-1.3-.1-2.5-.4-3.5z" />
    </svg>
  );
}
