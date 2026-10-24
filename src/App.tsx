import { Component, type ReactNode, useEffect, useState } from 'react';
import { HomeScreen } from './components/HomeScreen';
import { LobbyScreen } from './components/LobbyScreen';
import { MeetingScreen } from './components/MeetingScreen';
import { formatCode, isFullCode } from './lib/code';
import { loadCustomBackground } from './lib/customBg';
import { forgetMeeting, loadRecent, loadSchedule, loadSettings, rememberMeeting, saveSchedule, saveSettings } from './lib/storage';
import type { RecentMeeting, ScheduledMeeting, Settings } from './types';

type Phase = 'home' | 'lobby' | 'room';

function routeFromUrl(instant: boolean): { view: Phase; code: string } {
  const room = new URLSearchParams(location.search).get('room');
  if (!room) return { view: 'home', code: '' };
  const code = formatCode(room);
  if (!isFullCode(code)) return { view: 'home', code: '' };
  return { view: instant ? 'room' : 'lobby', code };
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [recent, setRecent] = useState<RecentMeeting[]>(loadRecent);
  const [schedule, setSchedule] = useState<ScheduledMeeting[]>(loadSchedule);
  const initial = routeFromUrl(settings.instantJoin);
  const [view, setView] = useState<Phase>(initial.view);
  const [code, setCode] = useState(initial.code);
  const [carry, setCarry] = useState<MediaStream | null>(null);
  useEffect(() => {
    saveSettings(settings);
    document.documentElement.dataset.theme = settings.theme;
  }, [settings]);

  useEffect(() => {
    void loadCustomBackground();
  }, []);

  useEffect(() => {
    document.title = view === 'home' || !code ? 'QuickMeet' : `${code} · QuickMeet`;
  }, [code, view]);

  useEffect(() => {
    const onPop = () => {
      const next = routeFromUrl(loadSettings().instantJoin);
      setCarry(null);
      setCode(next.code);
      setView(next.view);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function enter(nextCode: string, title: string, nextView: 'lobby' | 'room') {
    const formatted = formatCode(nextCode);
    setRecent(rememberMeeting({ code: formatted, title, ts: Date.now() }));
    const url = new URL(location.href);
    url.searchParams.set('room', formatted);
    history.pushState({ view: nextView }, '', url);
    setCarry(null);
    setCode(formatted);
    setView(nextView);
  }

  function leave() {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.pushState({ view: 'home' }, '', url);
    setCarry(null);
    setView('home');
  }

  function updateSchedule(items: ScheduledMeeting[]) {
    saveSchedule(items);
    setSchedule(items);
  }

  return (
    <Boundary>
      {view === 'home' && (
        <HomeScreen
          settings={settings}
          recent={recent}
          schedule={schedule}
          onSettings={setSettings}
          onForget={(item) => setRecent(forgetMeeting(item))}
          onSchedule={updateSchedule}
          onEnter={enter}
        />
      )}
      {view === 'lobby' && (
        <LobbyScreen
          code={code}
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
          settings={settings}
          initialStream={carry}
          onSettings={setSettings}
          onLeave={leave}
        />
      )}
    </Boundary>
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
            Reload QuickMeet
          </button>
        </section>
      </main>
    );
  }
}
