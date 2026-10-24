import { Component, type ReactNode, useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { HomeScreen } from './components/HomeScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MarketingPage } from './components/MarketingPage';
import { MeetingScreen } from './components/MeetingScreen';
import { AuthProvider, useAuth } from './lib/auth';
import { formatCode, isFullCode } from './lib/code';
import { loadCustomBackground } from './lib/customBg';
import { saveMeeting } from './lib/api';
import { forgetMeeting, loadRecent, loadSchedule, loadSettings, rememberMeeting, saveSchedule, saveSettings } from './lib/storage';
import type { RecentMeeting, ScheduledMeeting, Settings } from './types';

type Phase = 'market' | 'login' | 'register' | 'home' | 'lobby' | 'room';

function pathPhase(): Phase {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const room = new URLSearchParams(location.search).get('room');
  if (path === '/login') return 'login';
  if (path === '/register' || path === '/signup') return 'register';
  if (path === '/app' || room) return 'home';
  return 'market';
}

function routeFromUrl(instant: boolean, authed: boolean): { view: Phase; code: string } {
  const room = new URLSearchParams(location.search).get('room');
  const base = pathPhase();
  if (!authed) {
    if (base === 'login' || base === 'register') return { view: base, code: '' };
    return { view: 'market', code: '' };
  }
  if (room) {
    const code = formatCode(room);
    if (!isFullCode(code)) return { view: 'home', code: '' };
    return { view: instant ? 'room' : 'lobby', code };
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
    setAsHost(Boolean(next.code && sessionStorage.getItem(`lc-host:${next.code}`) === '1'));
    setView(next.view);
    setBoot(false);
    if (user && (location.pathname === '/login' || location.pathname === '/register')) {
      navigate('/app', true);
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

  async function enter(nextCode: string, title: string, nextView: 'lobby' | 'room', role: 'host' | 'guest' = 'guest') {
    const formatted = formatCode(nextCode);
    const host = role === 'host';
    if (host) sessionStorage.setItem(`lc-host:${formatted}`, '1');
    else sessionStorage.removeItem(`lc-host:${formatted}`);
    setRecent(rememberMeeting({ code: formatted, title, ts: Date.now() }));
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

  if (loading || boot) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="hint">Opening LetsConnect?</p>
        </section>
      </main>
    );
  }

  if (!user) {
    if (view === 'login' || view === 'register') {
      return (
        <AuthScreen
          mode={view}
          onMode={goAuth}
          onBack={goMarket}
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

  if (view === 'market') {
    return (
      <MarketingPage
        signedIn
        onLogin={() => goAuth('login')}
        onRegister={() => goAuth('register')}
        onApp={goApp}
      />
    );
  }

  return (
    <>
      {view === 'home' && (
        <HomeScreen
          settings={settings}
          recent={recent}
          schedule={schedule}
          onSettings={setSettings}
          onForget={(code) => setRecent(forgetMeeting(code))}
          onSchedule={updateSchedule}
          onEnter={enter}
          onLogout={() => void logout().then(goMarket)}
          onMarketing={goMarket}
        />
      )}
      {view === 'lobby' && (
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
      {view === 'room' && (
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
