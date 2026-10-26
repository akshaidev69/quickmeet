import { Component, type ReactNode, useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { GoogleAuthBridge } from './components/GoogleAuthBridge';
import { HomeScreen } from './components/HomeScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MarketingPage } from './components/MarketingPage';
import { MeetingScreen } from './components/MeetingScreen';
import { AuthProvider, useAuth } from './lib/auth';
import { formatCode, isFullCode } from './lib/code';
import { loadCustomBackground } from './lib/customBg';
import { saveMeeting } from './lib/api';
import { isNativeApp } from './lib/native';
import {
  clearActiveRoom,
  forgetMeeting,
  loadActiveRoom,
  loadRecent,
  loadSchedule,
  loadSettings,
  rememberMeeting,
  saveActiveRoom,
  saveSchedule,
  saveSettings,
} from './lib/storage';
import type { RecentMeeting, ScheduledMeeting, Settings } from './types';

type Phase = 'market' | 'login' | 'register' | 'home' | 'lobby' | 'room' | 'google-bridge';

function pathPhase(): Phase {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const room = new URLSearchParams(location.search).get('room');
  if (path === '/auth/google-bridge') return 'google-bridge';
  if (path === '/login') return 'login';
  if (path === '/register' || path === '/signup') return 'register';
  if (path === '/app' || room) return 'home';
  // Capacitor / phones should never land on the marketing website shell.
  if (isNativeApp()) return 'home';
  return 'market';
}

function routeFromUrl(instant: boolean, authed: boolean): { view: Phase; code: string; asHost?: boolean } {
  const room = new URLSearchParams(location.search).get('room');
  const base = pathPhase();
  if (!authed) {
    if (base === 'google-bridge' || base === 'login' || base === 'register') return { view: base, code: '' };
    if (isNativeApp() || base === 'home') return { view: 'login', code: '' };
    return { view: 'market', code: '' };
  }
  if (base === 'google-bridge') return { view: 'google-bridge', code: '' };
  if (room) {
    const code = formatCode(room);
    if (!isFullCode(code)) return { view: 'home', code: '' };
    return { view: instant ? 'room' : 'lobby', code };
  }
  // WebView / process restart often drops ?room= ? reopen the live session.
  const active = loadActiveRoom();
  if (active) {
    const code = formatCode(active.code);
    if (isFullCode(code)) {
      const url = new URL(location.href);
      url.pathname = '/app';
      url.searchParams.set('room', code);
      history.replaceState({ view: 'room' }, '', url);
      return { view: 'room', code, asHost: active.asHost };
    }
  }
  if (base === 'market' || base === 'login' || base === 'register') return { view: 'home', code: '' };
  return { view: 'home', code: '' };
}

function navigate(path: string, replace = false) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
}

export function App() {
  return (
    <AuthProvider>
      <Boundary>
        <AppRoutes />
      </Boundary>
    </AuthProvider>
  );
}

function AppRoutes() {
  const { user, loading, logout } = useAuth();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [recent, setRecent] = useState<RecentMeeting[]>(loadRecent);
  const [schedule, setSchedule] = useState<ScheduledMeeting[]>(loadSchedule);
  const [view, setView] = useState<Phase>('market');
  const [code, setCode] = useState('');
  const [asHost, setAsHost] = useState(false);
  const [carry, setCarry] = useState<MediaStream | null>(null);
  const [boot, setBoot] = useState(true);

  useEffect(() => {
    saveSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    void loadCustomBackground();
  }, []);

  useEffect(() => {
    if (loading) return;
    const next = routeFromUrl(settings.instantJoin, Boolean(user));
    setCode(next.code);
    const hostFlag =
      next.asHost === true ||
      Boolean(next.code && sessionStorage.getItem(`lc-host:${next.code}`) === '1');
    setAsHost(hostFlag);
    setView(next.view);
    setBoot(false);
    if (user && (location.pathname === '/login' || location.pathname === '/register')) {
      navigate('/app', true);
    }
    // Native APK always stays in the app routes ? never the marketing site.
    if (isNativeApp()) {
      const path = location.pathname.replace(/\/+$/, '') || '/';
      if (!user && path !== '/login' && path !== '/register' && path !== '/auth/google-bridge') {
        navigate('/login', true);
      } else if (user && (path === '/' || path === '') && !next.code) {
        navigate('/app', true);
      }
    }
  }, [loading, user, settings.instantJoin]);

  useEffect(() => {
    const title =
      view === 'market'
        ? 'LetsConnect ? free video meetings with memory'
        : view === 'login'
          ? 'Log in · LetsConnect'
          : view === 'register'
            ? 'Sign up · LetsConnect'
            : view === 'home' || !code
              ? 'LetsConnect'
              : `${code} · LetsConnect`;
    document.title = title;
  }, [code, view]);

  useEffect(() => {
    const onPop = () => {
      const next = routeFromUrl(loadSettings().instantJoin, Boolean(user));
      setCarry(null);
      setCode(next.code);
      setAsHost(Boolean(next.code && sessionStorage.getItem(`lc-host:${next.code}`) === '1'));
      setView(next.view);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [user]);

  function goMarket() {
    if (isNativeApp()) {
      goApp();
      return;
    }
    navigate('/');
    setView('market');
  }

  function goAuth(mode: 'login' | 'register') {
    navigate(mode === 'login' ? '/login' : '/register');
    setView(mode);
  }

  function goApp() {
    navigate('/app');
    setView('home');
  }

  function afterLogout() {
    if (isNativeApp()) goAuth('login');
    else goMarket();
  }

  async function enter(nextCode: string, title: string, nextView: 'lobby' | 'room', role: 'host' | 'guest' = 'guest') {
    const formatted = formatCode(nextCode);
    const host = role === 'host';
    if (host) sessionStorage.setItem(`lc-host:${formatted}`, '1');
    else sessionStorage.removeItem(`lc-host:${formatted}`);
    setRecent(rememberMeeting({ code: formatted, title, ts: Date.now() }));
    saveActiveRoom({ code: formatted, asHost: host, title });
    try {
      await saveMeeting({ code: formatted, title, startedAt: Date.now(), attendees: 1 });
    } catch {
      /* offline / guest edge */
    }
    const url = new URL(location.href);
    url.pathname = '/app';
    url.searchParams.set('room', formatted);
    history.pushState({ view: nextView }, '', url);
    setCarry(null);
    setCode(formatted);
    setAsHost(host);
    setView(nextView);
  }

  async function leave() {
    clearActiveRoom();
    if (code) {
      try {
        await saveMeeting({ code, endedAt: Date.now() });
      } catch {
        /* ignore */
      }
    }
    const url = new URL(location.href);
    url.pathname = '/app';
    url.searchParams.delete('room');
    history.pushState({ view: 'home' }, '', url);
    setCarry(null);
    setCode('');
    setAsHost(false);
    setView('home');
  }

  function updateSchedule(items: ScheduledMeeting[]) {
    saveSchedule(items);
    setSchedule(items);
  }

  if (view === 'google-bridge' || location.pathname.replace(/\/+$/, '') === '/auth/google-bridge') {
    return <GoogleAuthBridge />;
  }

  if (loading || boot) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="hint">Opening LetsConnect...</p>
        </section>
      </main>
    );
  }

  if (!user) {
    if (isNativeApp() || view === 'login' || view === 'register') {
      return (
        <AuthScreen
          mode={view === 'register' ? 'register' : 'login'}
          onMode={goAuth}
          onBack={isNativeApp() ? () => goAuth('login') : goMarket}
          onSuccess={goApp}
        />
      );
    }
    return (
      <MarketingPage
        signedIn={false}
        onLogin={() => goAuth('login')}
        onRegister={() => goAuth('register')}
        onApp={goApp}
      />
    );
  }

  if (view === 'market' && !isNativeApp()) {
    return (
      <MarketingPage
        signedIn
        onLogin={() => goAuth('login')}
        onRegister={() => goAuth('register')}
        onApp={goApp}
      />
    );
  }

  // Native never shows marketing ? treat leftover market state as home.
  const screen = view === 'market' ? 'home' : view;

  return (
    <>
      {screen === 'home' && (
        <HomeScreen
          settings={settings}
          recent={recent}
          schedule={schedule}
          onSettings={setSettings}
          onForget={(code) => setRecent(forgetMeeting(code))}
          onSchedule={updateSchedule}
          onEnter={enter}
          onLogout={() => void logout().then(afterLogout)}
          onMarketing={isNativeApp() ? goApp : goMarket}
        />
      )}
      {screen === 'lobby' && (
        <LobbyScreen
          code={code}
          asHost={asHost}
          settings={settings}
          onSettings={setSettings}
          onBack={leave}
          onJoin={(stream) => {
            setCarry(stream);
            setView('room');
          }}
        />
      )}
      {screen === 'room' && (
        <MeetingScreen
          key={code}
          code={code}
          asHost={asHost}
          settings={settings}
          initialStream={carry}
          onSettings={setSettings}
          onLeave={() => void leave()}
        />
      )}
    </>
  );
}

class Boundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: '' };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || 'Something broke.' };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="home kicked">
        <section className="card narrow">
          <h1>Something broke</h1>
          <p>{this.state.error}</p>
          <button type="button" className="primary" onClick={() => location.reload()}>
            Reload LetsConnect
          </button>
        </section>
      </main>
    );
  }
}
