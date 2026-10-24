import { useEffect, useState, type FormEvent } from 'react';
import { ThemeButton } from './LookControls';
import { Logo } from './icons';
import { useAuth } from '../lib/auth';
import { fetchMeetings, removeMeeting, type SavedMeeting } from '../lib/api';
import { formatCode, isFullCode, meetingCode, safeName, uid } from '../lib/code';
import type { RecentMeeting, ScheduledMeeting, Settings } from '../types';

type Props = {
  settings: Settings;
  recent: RecentMeeting[];
  schedule: ScheduledMeeting[];
  onSettings: (settings: Settings) => void;
  onForget: (code: string) => void;
  onSchedule: (items: ScheduledMeeting[]) => void;
  onEnter: (code: string, title: string, view: 'lobby' | 'room') => void;
  onLogout: () => void;
  onMarketing: () => void;
};

function whenLabel(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDuration(ms: number) {
  if (!ms) return 'In progress';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function HomeScreen({
  settings,
  recent,
  schedule,
  onSettings,
  onForget,
  onSchedule,
  onEnter,
  onLogout,
  onMarketing,
}: Props) {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [planning, setPlanning] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [wifiUrls, setWifiUrls] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [cloud, setCloud] = useState<SavedMeeting[]>([]);
  const ready = isFullCode(code);
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  useEffect(() => {
    if (user?.name && !settings.name.trim()) {
      onSettings({ ...settings, name: user.name });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    let cancel = false;
    void fetchMeetings()
      .then((data) => {
        if (!cancel) setCloud(data.meetings);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    let cancel = false;
    void fetch('/api/network')
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { urls?: string[] } | null) => {
        if (cancel || !data?.urls?.length) return;
        setWifiUrls(data.urls);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, []);

  async function copyWifi(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      window.setTimeout(() => setCopiedUrl(''), 2000);
    } catch {
      setCopiedUrl('');
    }
  }

  function start() {
    const next = meetingCode();
    onEnter(next, 'Instant meeting', settings.instantJoin ? 'room' : 'lobby');
  }

  function join(nextCode: string, label: string) {
    if (!isFullCode(nextCode)) return;
    onEnter(formatCode(nextCode), label, settings.instantJoin ? 'room' : 'lobby');
  }

  function createScheduled(event: FormEvent) {
    event.preventDefault();
    const next: ScheduledMeeting = {
      id: uid(),
      title: title.trim().slice(0, 60) || 'Scheduled meeting',
      when,
      code: meetingCode(),
    };
    onSchedule([next, ...schedule].slice(0, 12));
    setPlanning(false);
    setTitle('');
    setWhen('');
  }

  async function forgetCloud(id: string) {
    try {
      await removeMeeting(id);
      setCloud((items) => items.filter((item) => item.id !== id));
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="home home-hub">
      <div className="hub-glow" aria-hidden="true" />
      <div className="hub-grid" aria-hidden="true" />

      <div className="home-wrap hub-wrap">
        <header className="hub-top">
          <button type="button" className="hub-logo" onClick={onMarketing} aria-label="LetsConnect home">
            <Logo size={34} />
            <span>LetsConnect</span>
          </button>
          <div className="hub-top-actions">
            {user && (
              <div className="hub-user">
                {user.avatar ? (
                  <img src={user.avatar} alt="" className="account-avatar" />
                ) : (
                  <span className="account-avatar fallback">{(user.name || 'A').slice(0, 1)}</span>
                )}
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.plan === 'free' ? 'Free' : user.plan}</span>
                </div>
              </div>
            )}
            <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
            <button type="button" className="hub-ghost" onClick={onMarketing}>
              Product
            </button>
            <button type="button" className="hub-ghost" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>

        <section className="hub-hero">
          <p className="hub-kicker">{greeting}{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <h1>LetsConnect</h1>
          <p className="hub-lead">Start a room, invite on Wi?Fi, and keep every meeting on your account.</p>
        </section>

        <section className="hub-start">
          <label className="field">
            <span>Your name in meetings</span>
            <input
              value={settings.name}
              placeholder="How should people see you?"
              maxLength={40}
              autoComplete="name"
              onChange={(event) => onSettings({ ...settings, name: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') start();
              }}
            />
          </label>
          <button type="button" className="primary xl hub-cta" onClick={start}>
            Start meeting
          </button>
          <p className="hint">You can mute camera before anyone sees you. History syncs to this account.</p>

          <div className="or">or join with a code</div>
          <div className="join-row">
            <input
              value={code}
              placeholder="abc-defg-hij"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Meeting code"
              onChange={(event) => setCode(formatCode(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && ready) {
                  event.preventDefault();
                  join(code, 'Joined meeting');
                }
              }}
            />
            <button type="button" className="secondary" disabled={!ready} onClick={() => join(code, 'Joined meeting')}>
              Join
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.instantJoin}
              onChange={(event) => onSettings({ ...settings, instantJoin: event.target.checked })}
            />
            <span>Skip the camera check and join immediately</span>
          </label>
        </section>

        <aside className="side-col hub-side">
          <section className="hub-panel">
            <div className="hub-panel-head">
              <h2>Your meetings</h2>
              <span>{cloud.length}</span>
            </div>
            <p className="hint">Synced to your account ? not just this browser.</p>
            {cloud.length === 0 && <p className="empty">Start or join a meeting to fill this list.</p>}
            <ul className="list hub-list">
              {cloud.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>
                      {whenLabel(item.startedAt)} · {formatDuration(item.durationMs)}
                    </span>
                    <code>{item.code}</code>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => join(item.code, item.title)}>
                      Open
                    </button>
                    <button type="button" onClick={() => void forgetCloud(item.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {wifiUrls.length > 0 && (
            <section className="hub-panel">
              <h2>Wi?Fi access</h2>
              <p className="hint">Open on another device on the same network.</p>
              <ul className="list plain wifi-list">
                {wifiUrls.map((url) => (
                  <li key={url}>
                    <code className="wifi-url">{url}</code>
                    <div className="row-actions">
                      <button type="button" onClick={() => void copyWifi(url)}>
                        {copiedUrl === url ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="hub-panel">
            <div className="card-head">
              <h2>Scheduled</h2>
              <button type="button" className="textbtn" onClick={() => setPlanning((open) => !open)}>
                {planning ? 'Cancel' : 'Schedule'}
              </button>
            </div>
            {planning && (
              <form className="stack" onSubmit={createScheduled}>
                <label className="field">
                  <span>Title</span>
                  <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Design review" />
                </label>
                <label className="field">
                  <span>Date and time</span>
                  <input type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} required />
                </label>
                <button className="secondary" type="submit">
                  Create meeting code
                </button>
              </form>
            )}
            {schedule.length === 0 && !planning && <p className="empty">Nothing scheduled on this computer.</p>}
            <ul className="list hub-list">
              {schedule.map((item) => (
                <li key={item.id}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.when ? new Date(item.when).toLocaleString() : 'No time set'}</span>
                    <code>{item.code}</code>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => join(item.code, item.title)}>
                      Start
                    </button>
                    <button type="button" onClick={() => onSchedule(schedule.filter((meeting) => meeting.id !== item.id))}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="hub-panel">
            <h2>Recent on this device</h2>
            {recent.length === 0 && <p className="empty">Local shortcuts for this browser.</p>}
            <ul className="list hub-list">
              {recent.map((item) => (
                <li key={item.code}>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{whenLabel(item.ts)}</span>
                    <code>{item.code}</code>
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => join(item.code, item.title)}>
                      Rejoin
                    </button>
                    <button type="button" onClick={() => onForget(item.code)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <p className="fine hub-fine">You appear as {safeName(settings.name)}. Video goes peer?to?peer.</p>
        </aside>
      </div>
    </main>
  );
}
