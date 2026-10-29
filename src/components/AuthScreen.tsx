import { useEffect, useRef, useState, type FormEvent } from 'react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
import { App as CapApp } from '@capacitor/app';
import { Logo } from './icons';
import { useAuth } from '../lib/auth';
import { claimFirebaseHandoff, fetchConfig, loginWithFirebaseToken, requestPasswordReset } from '../lib/api';
import { loadSettings, saveSettings } from '../lib/storage';
import { ThemeButton } from './LookControls';
import { exchangeGoogleIdToken, firebaseConfigured, signInWithGooglePopup } from '../lib/firebase';
import { peekPendingJoin } from '../lib/invite';
import {
  closeExternalBrowser,
  googleBridgeUrl,
  isNativeApp,
  openExternalBrowser,
  parseNativeAuthUrl,
} from '../lib/native';

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [theme, setTheme] = useState(loadSettings().theme);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState(firebaseConfigured());
  const pendingNative = useRef(false);
  const googleLock = useRef(false);

  useEffect(() => {
    setNameError('');
    setEmailError('');
    setPasswordError('');
    setError('');
  }, [mode]);

  useEffect(() => {
    void fetchConfig()
      .then((config) => setGoogleOn(config.firebase || config.google || firebaseConfigured()))
      .catch(() => setGoogleOn(firebaseConfigured()));
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;

    const handleUrl = async (url: string) => {
      if (!pendingNative.current) return;
      const { code, idToken, error: authError } = parseNativeAuthUrl(url);
      if (!code && !idToken && !authError) return;
      pendingNative.current = false;
      await closeExternalBrowser();
      if (authError || (!code && !idToken)) {
        setGoogleBusy(false);
        googleLock.current = false;
        setError(authError || 'Google sign-in was cancelled.');
        return;
      }
      try {
        if (code) {
          const data = await claimFirebaseHandoff(code);
          setUser(data.user);
          onSuccess();
          return;
        }
        // Legacy deep links that carried a JWT — exchange if needed, then login.
        let token = idToken!;
        try {
          token = await exchangeGoogleIdToken(idToken!);
        } catch {
          /* server also accepts raw Google GIS tokens */
        }
        const data = await loginWithFirebaseToken(token);
        setUser(data.user);
        onSuccess();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Google sign-in failed');
      } finally {
        setGoogleBusy(false);
        googleLock.current = false;
      }
    };

    const sub = CapApp.addListener('appUrlOpen', (event) => {
      void handleUrl(event.url);
    });

    void CapApp.getLaunchUrl().then((result) => {
      if (result?.url) void handleUrl(result.url);
    });

    return () => {
      void sub.then((handle) => handle.remove());
    };
  }, [onSuccess, setUser]);

  function validateFields() {
    const nextName = mode === 'register' && !name.trim() ? 'Name is required' : '';
    const nextEmail = !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address' : '';
    const nextPassword = password.length < 8 ? 'Password must be at least 8 characters' : '';
    setNameError(nextName);
    setEmailError(nextEmail);
    setPasswordError(nextPassword);
    return !nextName && !nextEmail && !nextPassword;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!validateFields() || formBusy || googleBusy) return;
    setFormBusy(true);
    try {
      if (mode === 'register') await register(name, email, password);
      else await login(email, password);
      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not sign in';
      const field = err && typeof err === 'object' && 'field' in err ? String((err as { field?: string }).field || '') : '';
      if (field === 'email' || /already registered|valid email/i.test(message)) setEmailError(message);
      else if (field === 'password' || (/password/i.test(message) && /8|short|weak/i.test(message))) setPasswordError(message);
      else if (field === 'name' || (/name/i.test(message) && /required/i.test(message))) setNameError(message);
      else setError(message);
    } finally {
      setFormBusy(false);
    }
  }

  async function onGoogle() {
    if (googleBusy || formBusy || googleLock.current) return;
    setError('');
    googleLock.current = true;
    setGoogleBusy(true);
    try {
      if (!firebaseConfigured()) {
        window.location.href = '/api/auth/google';
        return;
      }

      // Android/iOS WebView cannot complete Google GIS popups (blank page).
      // Open real Chrome Custom Tabs → bridge page → deep-link back with idToken.
      if (isNativeApp()) {
        pendingNative.current = true;
        await openExternalBrowser(googleBridgeUrl());
        return;
      }

      const { idToken } = await signInWithGooglePopup();
      const data = await loginWithFirebaseToken(idToken);
      setUser(data.user);
      onSuccess();
    } catch (err) {
      pendingNative.current = false;
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
      console.error('Google sign-in failed', err);
    } finally {
      setGoogleBusy(false);
      googleLock.current = false;
    }
  }

  const native = isNativeApp();
  const pendingJoin = peekPendingJoin();

  async function onForgot() {
    setError('');
    if (!EMAIL_RE.test(email.trim())) {
      setEmailError('Enter a valid email address');
      return;
    }
    setResetBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send a reset email');
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <main className={`auth-page${native ? ' auth-native' : ''}`}>
      <div className="auth-toolbar">
        {!native && (
          <button type="button" className="auth-back textbtn" onClick={onBack}>
            ← LetsConnect home
          </button>
        )}
        <ThemeButton
          theme={theme}
          onChange={(next) => {
            setTheme(next);
            saveSettings({ ...loadSettings(), theme: next });
            document.documentElement.dataset.theme = next;
          }}
        />
      </div>
      <section className="auth-card">
        <div className="auth-brand">
          <Logo size={32} />
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p>
            {pendingJoin
              ? `Sign in to join ${pendingJoin} in the waiting room.`
              : mode === 'login'
                ? 'Log in with Google or email to open your meetings.'
                : 'Free forever for now — no card needed.'}
          </p>
        </div>

        <button
          type="button"
          className={googleOn ? 'google-btn' : 'google-btn off'}
          disabled={googleBusy || formBusy || !googleOn}
          onClick={() => void onGoogle()}
        >
          {googleBusy ? <span className="auth-spinner" aria-hidden="true" /> : <GoogleMark />}
          {googleBusy ? 'Opening Google…' : googleOn ? 'Continue with Google' : 'Google sign-in loading…'}
        </button>
        <p className="auth-hint">Sign in with your Google account to open your LetsConnect meetings.</p>

        <div className="auth-or">or use email</div>

        <form className="auth-form" onSubmit={onSubmit}>
          {mode === 'register' && (
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                maxLength={60}
                name="lc-name"
                autoComplete="name"
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError('');
                }}
              />
              {nameError && <p className="field-error">{nameError}</p>}
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              name="lc-email"
              autoComplete="username"
              inputMode="email"
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailError) setEmailError('');
              }}
            />
            {emailError && <p className="field-error">{emailError}</p>}
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              name="lc-password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => {
                setPassword(e.target.value);
                if (passwordError) setPasswordError('');
              }}
            />
            {passwordError && <p className="field-error">{passwordError}</p>}
          </label>
          {error && <p className="warn-text">{error}</p>}
          {mode === 'login' && (
            <p className="auth-switch">
              <button type="button" className="textbtn" disabled={resetBusy || formBusy} onClick={() => void onForgot()}>
                {resetBusy ? 'Sending…' : resetSent ? 'Reset email sent' : 'Forgot password'}
              </button>
            </p>
          )}
          <button type="submit" className="primary xl ask-join auth-submit" disabled={formBusy || googleBusy || resetBusy}>
            {formBusy ? (
              <>
                <span className="auth-spinner" aria-hidden="true" />
                {mode === 'login' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : mode === 'login' ? (
              'Log in'
            ) : (
              'Create account'
            )}
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
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.5-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.1 4 9.3 8.5 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.2 39.5 16 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l.1.1 6.2 5.2C39.2 37.3 44 32 44 24c0-1.3-.1-2.5-.4-3.5z"
      />
    </svg>
  );
}
