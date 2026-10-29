import { Component, type ReactNode, useEffect, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { GoogleAuthBridge } from './components/GoogleAuthBridge';
import { HomeScreen } from './components/HomeScreen';
import { JoinGate } from './components/JoinGate';
import { LobbyScreen } from './components/LobbyScreen';
import { MarketingPage } from './components/MarketingPage';
import { LegalPage } from './components/LegalPage';
import { MeetingScreen } from './components/MeetingScreen';
import { MeetingSummary, type MeetingSummaryData } from './components/MeetingSummary';
import { AuthProvider, useAuth } from './lib/auth';
import { formatCode, isFullCode, isValidMeetingCode, meetingCode } from './lib/code';
import { loadCustomBackground } from './lib/customBg';
import { saveMeeting } from './lib/api';
import {
  consumeJoinDeepLink,
  peekPendingJoin,
  rememberPendingJoin,
  rememberWebJoin,
  roomFromLocation,
  takePendingJoin,
  wantsJoinGate,
  webJoinUrl,
} from './lib/invite';
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
// clearActiveRoom used on auth success so register never resumes a stale room
import type { RecentMeeting, ScheduledMeeting, Settings } from './types';

type Phase = 'market' | 'login' | 'register' | 'home' | 'lobby' | 'room' | 'summary' | 'missing' | 'google-bridge' | 'privacy' | 'terms' | 'join-gate';

function pathPhase(): Phase {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const room = roomFromLocation();
  if (path === '/auth/google-bridge') return 'google-bridge';
  if (path === '/privacy') return 'privacy';
  if (path === '/terms') return 'terms';
  if (path === '/login') return 'login';
  if (path === '/register' || path === '/signup') return 'register';
  if (path === '/join' || path.startsWith('/join/')) {
    if (room && wantsJoinGate(room)) return 'join-gate';
    return room ? 'home' : 'missing';
  }
  if (path === '/app' || room) return 'home';
  // Capacitor / phones should never land on the marketing website shell.
  if (isNativeApp()) return 'home';
  return 'market';
}

function routeFromUrl(_instant: boolean, authed: boolean): { view: Phase; code: string; asHost?: boolean } {
  const room = roomFromLocation();
  const base = pathPhase();
  if (base === 'privacy' || base === 'terms' || base === 'google-bridge') return { view: base, code: '' };
  if (base === 'join-gate' && room) return { view: 'join-gate', code: room };
  if (room) {
    const code = formatCode(room);
    if (!isFullCode(code) || !isValidMeetingCode(code)) return { view: 'missing', code: '' };
    if (!authed) {
      rememberPendingJoin(code);
      return { view: 'login', code };
    }
    return { view: 'lobby', code };
  }
  if (!authed) {
    if (base === 'login' || base === 'register') return { view: base, code: '' };
    if (isNativeApp() || base === 'home') return { view: 'login', code: '' };
    return { view: 'market', code: '' };
  }
  // WebView / process restart often drops ?room= — reopen the live session.
  const active = loadActiveRoom();
  if (active) {
    const code = formatCode(active.code);
    if (isFullCode(code) && isValidMeetingCode(code)) {
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
  const [summary, setSummary] = useState<MeetingSummaryData | null>(null);
  const [boot, setBoot] = useState(true);
  const [docked, setDocked] = useState(false);
  const [nativeLaunchReady, setNativeLaunchReady] = useState(!isNativeApp());

  useEffect(() => {
    saveSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    void loadCustomBackground();
  }, []);

  useEffect(() => {
    const ping = () => void fetch('/api/health', { cache: 'no-store' }).catch(() => undefined);
    ping();
    const id = window.setInterval(ping, 4 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void (async () => {
      try {
        const { App: CapApp } = await import('@capacitor/app');
        const launch = await CapApp.getLaunchUrl();
        if (!cancelled && launch?.url) consumeJoinDeepLink(launch.url);
        handle = await CapApp.addListener('appUrlOpen', (event) => {
          if (!consumeJoinDeepLink(event.url)) return;
          const next = routeFromUrl(loadSettings().instantJoin, Boolean(user));
          setCode(next.code);
          setAsHost(Boolean(next.code && sessionStorage.getItem(`lc-host:${next.code}`) === '1'));
          setView(next.view === 'join-gate' ? 'lobby' : next.view);
          setBoot(false);
        });
      } catch {
        /* web or plugin missing */
      }
      if (!cancelled) setNativeLaunchReady(true);
    })();
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [user]);

  useEffect(() => {
    if (loading || !nativeLaunchReady) return;
    const next = routeFromUrl(settings.instantJoin, Boolean(user));
    setCode(next.code);
    const hostFlag =
      next.asHost === true ||
      Boolean(next.code && sessionStorage.getItem(`lc-host:${next.code}`) === '1');
    setAsHost(hostFlag);
    setView(next.view);
    setBoot(false);
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if ((next.view === 'lobby' || next.view === 'room') && next.code && (path === '/join' || path.startsWith('/join/'))) {
      history.replaceState({ view: next.view }, '', webJoinUrl(next.code));
    }
    if (user && (path === '/login' || path === '/register' || path === '/' || path === '')) {
      if (path === '/' || path === '') {
        if (!next.code) {
          navigate('/app', true);
          setCode('');
          setAsHost(false);
          setView('home');
          setBoot(false);
          return;
        }
      } else {
        clearActiveRoom();
        const url = new URL(location.href);
        url.pathname = '/app';
        url.searchParams.delete('room');
        history.replaceState({ view: 'home' }, '', url);
        setCode('');
        setAsHost(false);
        setView('home');
        return;
      }
    }
    if (isNativeApp() && !user) {
      const joinCode = roomFromLocation() || next.code;
      if (joinCode) rememberPendingJoin(joinCode);
      if (path !== '/login' && path !== '/register' && path !== '/auth/google-bridge' && path !== '/privacy' && path !== '/terms' && path !== '/join' && !path.startsWith('/join/')) {
        navigate(joinCode ? `/login?room=${encodeURIComponent(joinCode)}` : '/login', true);
        setView('login');
      }
    }
  }, [loading, user, settings.instantJoin, nativeLaunchReady]);

  useEffect(() => {
    const title =
      view === 'market'
        ? 'LetsConnect — free video meetings with memory'
        : view === 'login'
          ? 'Log in · LetsConnect'
          : view === 'register'
            ? 'Sign up · LetsConnect'
            : view === 'missing'
              ? 'Meeting not found · LetsConnect'
              : view === 'join-gate'
                ? `Join ${code} · LetsConnect`
                : view === 'home' || !code
                ? 'LetsConnect'
                : `${code} · LetsConnect`;
    document.title = title;
  }, [code, view]);

  useEffect(() => {
    if (asHost) return;
    if (view !== 'lobby' && view !== 'room') return;
    if (!code || !isValidMeetingCode(code)) {
      setView('missing');
      return;
    }
    let cancel = false;
    void fetch(`/api/rooms/${encodeURIComponent(code)}`)
      .then((res) => {
        if (cancel) return;
        if (res.status === 404) setView('missing');
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [asHost, view, code]);

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
    clearActiveRoom();
    const url = new URL(location.href);
    url.pathname = '/app';
    url.searchParams.delete('room');
    history.replaceState({ view: 'home' }, '', url);
    setCarry(null);
    setCode('');
    setAsHost(false);
    setView('home');
  }

  function backFromMissingRoom() {
    const url = new URL(location.href);
    url.pathname = '/app';
    url.searchParams.delete('room');
    history.replaceState({ view: 'home' }, '', url);
    setCarry(null);
    setCode('');
    setAsHost(false);
    setView('home');
  }

  function afterLogout() {
    if (isNativeApp()) goAuth('login');
    else goMarket();
  }

  async function enter(nextCode: string, title: string, nextView: 'lobby' | 'room', role: 'host' | 'guest' = 'guest') {
    if (docked) {
      setDocked(false);
      return;
    }
    const formatted = formatCode(nextCode);
    const host = role === 'host';
    if (host) sessionStorage.setItem(`lc-host:${formatted}`, '1');
    else sessionStorage.removeItem(`lc-host:${formatted}`);
    setRecent(rememberMeeting({ code: formatted, title, ts: Date.now() }));
    saveActiveRoom({ code: formatted, asHost: host, title });
    if (user && host) {
      try {
        await saveMeeting({ code: formatted, title, startedAt: Date.now(), attendees: 1, reopen: true } as Parameters<typeof saveMeeting>[0] & { reopen?: boolean });
      } catch {
        /* offline / guest */
      }
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

  async function leave(nextSummary?: MeetingSummaryData) {
    setDocked(false);
    clearActiveRoom();
    if (code && nextSummary?.endedForEveryone && user) {
      try {
        await saveMeeting({ code, endedAt: Date.now() });
      } catch {
        /* server also ends the row when the room empties */
      }
    }
    const url = new URL(location.href);
    url.pathname = '/app';
    url.searchParams.delete('room');
    setCarry(null);
    setCode('');
    setAsHost(false);
    if (nextSummary) {
      setSummary({ ...nextSummary, guest: !user });
      history.pushState({ view: 'summary' }, '', url);
      setView('summary');
      return;
    }
    setSummary(null);
    history.pushState({ view: 'home' }, '', url);
    setView('home');
  }

  function startFreshMeeting() {
    setSummary(null);
    const next = meetingCode();
    void enter(next, 'Instant meeting', settings.instantJoin ? 'room' : 'lobby', 'host');
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
          <p className="hint">Waking up the server…</p>
        </section>
      </main>
    );
  }

  if (view === 'privacy' || view === 'terms') {
    return (
      <LegalPage
        kind={view}
        theme={settings.theme}
        onTheme={(theme) => setSettings({ ...settings, theme })}
        onHome={goMarket}
      />
    );
  }

  function afterAuth() {
    const pending = takePendingJoin() || code;
    if (pending && isFullCode(formatCode(pending)) && isValidMeetingCode(pending)) {
      void enter(pending, 'LetsConnect meeting', 'lobby', 'guest');
      return;
    }
    goApp();
  }

  if (view === 'join-gate' && code) {
    return (
      <JoinGate
        code={code}
        theme={settings.theme}
        onTheme={(theme) => setSettings({ ...settings, theme })}
        onHome={goMarket}
        onContinueWeb={() => {
          rememberWebJoin(code);
          rememberPendingJoin(code);
          history.replaceState({ view: 'lobby' }, '', webJoinUrl(code));
          if (user) void enter(code, 'LetsConnect meeting', 'lobby', 'guest');
          else setView('login');
        }}
      />
    );
  }

  if (!user && view !== 'missing' && view !== 'summary' && view !== 'join-gate') {
    if (isNativeApp() || view === 'login' || view === 'register' || Boolean(peekPendingJoin() || code || roomFromLocation())) {
      return (
        <AuthScreen
          mode={view === 'register' ? 'register' : 'login'}
          onMode={goAuth}
          onBack={isNativeApp() ? () => goAuth('login') : goMarket}
          onSuccess={afterAuth}
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

  if (screen === 'missing') {
    return (
      <main className="home kicked">
        <section className="card narrow">
          <h1>Meeting not found</h1>
          <p>That code is not valid. Check the link or enter a code from the home screen.</p>
          <button type="button" className="primary" onClick={backFromMissingRoom}>
            Back to home
          </button>
        </section>
      </main>
    );
  }

  if (screen === 'summary' && summary) {
    const summaryCode = summary.code;
    const summaryTitle = summary.title;
    return (
      <MeetingSummary
        data={{ ...summary, guest: !user }}
        onDashboard={() => {
          setSummary(null);
          goApp();
        }}
        onNewMeeting={startFreshMeeting}
        onRejoin={() => {
          setSummary(null);
          const host = sessionStorage.getItem(`lc-host:${summaryCode}`) === '1';
          void enter(
            summaryCode,
            summaryTitle || 'LetsConnect meeting',
            settings.instantJoin ? 'room' : 'lobby',
            host ? 'host' : 'guest',
          );
        }}
      />
    );
  }

  return (
    <>
      {(screen === 'home' || docked) && (
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
          inCallCode={docked ? code : undefined}
          onReturnToCall={() => setDocked(false)}
        />
      )}
      {screen === 'lobby' && (
        <LobbyScreen
          code={code}
          asHost={asHost}
          settings={settings}
          onSettings={setSettings}
          onBack={() => void leave()}
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
          onLeave={(next) => void leave(next)}
          docked={docked}
          onMinimize={() => setDocked(true)}
          onRestore={() => setDocked(false)}
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
