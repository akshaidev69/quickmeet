import { useEffect, useState, type FormEvent } from 'react';
import { ThemeButton } from './LookControls';
import { Logo } from './icons';
import { useAuth } from '../lib/auth';
import { fetchMeetings, removeMeeting, type SavedMeeting } from '../lib/api';
import { formatCode, isFullCode, isValidMeetingCode, meetingCode, safeName, uid } from '../lib/code';
import { isNativeApp } from '../lib/native';
import type { RecentMeeting, ScheduledMeeting, Settings } from '../types';

type Props = {
  settings: Settings;
  recent: RecentMeeting[];
  schedule: ScheduledMeeting[];
  onSettings: (settings: Settings) => void;
  onForget: (code: string) => void;
  onSchedule: (items: ScheduledMeeting[]) => void;
  onEnter: (code: string, title: string, view: 'lobby' | 'room', role?: 'host' | 'guest') => void;
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
  const native = isNativeApp();
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [planning, setPlanning] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [wifiUrls, setWifiUrls] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [cloud, setCloud] = useState<SavedMeeting[]>([]);
  const [tab, setTab] = useState<'meetings' | 'scheduled' | 'recent'>('meetings');
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAllMeetings, setShowAllMeetings] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const LIST_PREVIEW = 4;
  const firstName = user?.name?.split(' ')[0] || '';
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();
  const today = new Date();
  const todayLabel = today.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const weekDays = (() => {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return {
        key: day.toISOString().slice(0, 10),
        label: day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase(),
        date: day.getDate(),
        isToday: day.toDateString() === today.toDateString(),
      };
    });
  })();
  const todaysMeetings = schedule.filter((item) => {
    if (!item.when) return false;
    const when = new Date(item.when);
    return when.toDateString() === today.toDateString();
  });
  const hasToday = todaysMeetings.length > 0 || cloud.some((item) => {
    const started = new Date(item.startedAt);
    return started.toDateString() === today.toDateString() && !item.endedAt;
  });

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
    if (native) return;
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
  }, [native]);

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
    onEnter(next, 'Instant meeting', settings.instantJoin ? 'room' : 'lobby', 'host');
  }

  async function join(nextCode: string, label: string, role: 'host' | 'guest' = 'guest') {
    const formatted = formatCode(nextCode);
    if (!isFullCode(formatted) || !isValidMeetingCode(formatted)) {
      setJoinError('Enter a valid meeting code (abc-defg-hij).');
      return;
    }
    if (role === 'guest') {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(formatted)}`);
        if (res.status === 404) {
          setJoinError('Meeting not found. Check the code and try again.');
          return;
        }
      } catch {
        /* offline: still allow lobby attempt */
      }
    }
    setJoinError('');
    onEnter(formatted, label, settings.instantJoin ? 'room' : 'lobby', role);
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

  const cloudVisible = showAllMeetings ? cloud : cloud.slice(0, LIST_PREVIEW);
  const recentVisible = showAllRecent ? recent : recent.slice(0, LIST_PREVIEW);

  const list = (
    <aside className="side-col hub-side">
      <section className={`hub-panel hub-panel-meetings${tab !== 'meetings' ? ' phone-hide' : ''}`}>
        <div className="hub-panel-head">
          <h2>Your meetings</h2>
          <span>{cloud.length}</span>
        </div>
        <p className="hint desk-only">Synced to your account {'\u2014'} not just this browser.</p>
        {cloud.length === 0 && <p className="empty">Start or join a meeting to fill this list.</p>}
        <ul className="list hub-list">
          {cloudVisible.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {whenLabel(item.startedAt)} {'\u00b7'} {formatDuration(item.durationMs)}
                </span>
                <code>{item.code}</code>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => void join(item.code, item.title, 'host')}>
                  Open
                </button>
                <button type="button" onClick={() => void forgetCloud(item.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {cloud.length > LIST_PREVIEW && (
          <button type="button" className="hub-list-more" onClick={() => setShowAllMeetings((open) => !open)}>
            {showAllMeetings ? 'Show less' : `Show all ${cloud.length}`}
          </button>
        )}
      </section>

      {wifiUrls.length > 0 && (
        <section className="hub-panel desk-only">
          <h2>Wi-Fi access</h2>
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

      <section className={`hub-panel hub-panel-scheduled${tab !== 'scheduled' ? ' phone-hide' : ''}`}>
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
        {schedule.length === 0 && !planning && <p className="empty">Nothing scheduled yet.</p>}
        <ul className="list hub-list">
          {schedule.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.when ? new Date(item.when).toLocaleString() : 'No time set'}</span>
                <code>{item.code}</code>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => void join(item.code, item.title, 'host')}>
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

      <section className={`hub-panel hub-panel-recent${tab !== 'recent' ? ' phone-hide' : ''}`}>
        <h2>Recent on this device</h2>
        {recent.length === 0 && <p className="empty">Local shortcuts for this device.</p>}
        <ul className="list hub-list">
          {recentVisible.map((item) => (
            <li key={item.code}>
              <div>
                <strong>{item.title}</strong>
                <span>{whenLabel(item.ts)}</span>
                <code>{item.code}</code>
              </div>
              <div className="row-actions">
                <button type="button" onClick={() => void join(item.code, item.title)}>
                  Rejoin
                </button>
                <button type="button" onClick={() => onForget(item.code)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        {recent.length > LIST_PREVIEW && (
          <button type="button" className="hub-list-more" onClick={() => setShowAllRecent((open) => !open)}>
            {showAllRecent ? 'Show less' : `Show all ${recent.length}`}
          </button>
        )}
      </section>

      <p className="fine hub-fine desk-only">You appear as {safeName(settings.name)}. Video goes peer-to-peer.</p>
    </aside>
  );

  return (
    <main className={`home home-hub${native ? ' home-native' : ''}`}>
      <div className="hub-glow" aria-hidden="true" />
      <div className="hub-grid" aria-hidden="true" />

      {/* ?? Mobile / native app shell ?? */}
      <div className="app-home">
        <header className="app-home-top">
          <button type="button" className="app-home-brand" onClick={onMarketing} aria-label="LetsConnect">
            <Logo size={28} />
            <strong>LetsConnect</strong>
          </button>
          <div className="app-home-top-actions">
            <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
            <button type="button" className="app-home-product desk-inline" onClick={onMarketing}>
              Product
            </button>
            <button
              type="button"
              className="app-avatar-btn"
              aria-label="Account menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {user?.avatar ? (
                <img src={user.avatar} alt="" />
              ) : (
                <span>{(user?.name || 'A').slice(0, 1)}</span>
              )}
            </button>
          </div>
        </header>

        {menuOpen && (
          <>
            <button type="button" className="app-menu-backdrop" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="app-account-menu" role="menu">
              <div className="app-account-head">
                <strong>{user?.name || 'You'}</strong>
                <span>{user?.email || (user?.plan === 'free' ? 'Free plan' : user?.plan)}</span>
              </div>
              <label className="field app-name-field">
                <span>Display name</span>
                <input
                  value={settings.name}
                  maxLength={40}
                  placeholder="How people see you"
                  onChange={(event) => onSettings({ ...settings, name: event.target.value })}
                />
              </label>
              <label className="check app-instant">
                <input
                  type="checkbox"
                  checked={settings.instantJoin}
                  onChange={(event) => onSettings({ ...settings, instantJoin: event.target.checked })}
                />
                <span>Join instantly (skip camera check)</span>
              </label>
              <button
                type="button"
                className="app-menu-logout"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
              >
                Log out
              </button>
            </div>
          </>
        )}

        <section className="app-home-hero">
          <p className="app-home-hello">
            {greeting}
            {firstName ? `, ${firstName}` : ''}
          </p>
          <h1>{todayLabel}</h1>
          <div className="app-week" role="list" aria-label="This week">
            {weekDays.map((day) => (
              <div key={day.key} className={`app-week-day${day.isToday ? ' is-today' : ''}`} role="listitem">
                <span>{day.label}</span>
                <strong>{day.date}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="app-home-toolbar">
          <div className="join-row app-join-row app-join-inline">
            <input
              value={code}
              placeholder="Enter a code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-label="Meeting code"
              onChange={(event) => {
                setCode(formatCode(event.target.value));
                if (joinError) setJoinError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void join(code, 'Joined meeting');
                }
              }}
            />
            <button type="button" className="secondary" onClick={() => void join(code, 'Joined meeting')}>
              Join
            </button>
          </div>
          {joinError && <p className="field-error app-join-error">{joinError}</p>}
          <button type="button" className="app-new-btn" onClick={start}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New
          </button>
        </section>

        <section className={`app-home-empty${hasToday ? ' has-meetings' : ''}`}>
          {!hasToday ? (
            <>
              <div className="app-empty-art" aria-hidden="true">
                <svg viewBox="0 0 160 110" fill="none">
                  <path d="M18 78c18-28 38-40 62-40s44 12 62 40" stroke="currentColor" strokeWidth="2.2" opacity="0.25" />
                  <rect x="48" y="28" width="64" height="48" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" />
                  <circle cx="80" cy="52" r="12" stroke="var(--accent)" strokeWidth="2" />
                  <path d="M68 78h24" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
                  <path d="M118 34l14 8v16l-14 8-14-8V42l14-8z" fill="color-mix(in srgb, var(--accent) 18%, white)" stroke="var(--accent)" strokeWidth="1.8" />
                </svg>
              </div>
              <h2>No meetings scheduled for today</h2>
              <p>Schedule a meeting or enjoy the free time.</p>
            </>
          ) : (
            <div className="app-today-list">
              <h2>Today</h2>
              <ul className="list hub-list">
                {todaysMeetings.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.when ? new Date(item.when).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'Scheduled'}</span>
                      <code>{item.code}</code>
                    </div>
                    <div className="row-actions">
                      <button type="button" onClick={() => void join(item.code, item.title, 'host')}>
                        Start
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <nav className="hub-tabs app-home-tabs" aria-label="Meeting lists">
          <button type="button" className={tab === 'meetings' ? 'active' : ''} onClick={() => setTab('meetings')}>
            Meetings
            <span>{cloud.length}</span>
          </button>
          <button type="button" className={tab === 'scheduled' ? 'active' : ''} onClick={() => setTab('scheduled')}>
            Planned
            <span>{schedule.length}</span>
          </button>
          <button type="button" className={tab === 'recent' ? 'active' : ''} onClick={() => setTab('recent')}>
            Recent
            <span>{recent.length}</span>
          </button>
        </nav>

        <div className="app-home-list">{list}</div>
      </div>
    </main>
  );
}
