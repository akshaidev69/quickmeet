import { useEffect, useState, type FormEvent } from 'react';
import { ThemeButton } from './LookControls';
import { Logo } from './icons';
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
};

function whenLabel(ts: number) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function HomeScreen({ settings, recent, schedule, onSettings, onForget, onSchedule, onEnter }: Props) {
  const [code, setCode] = useState('');
  const [planning, setPlanning] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [wifiUrls, setWifiUrls] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState('');
  const ready = isFullCode(code);

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

  return (
    <main className="home">
      <div className="home-wrap">
        <header className="brand">
          <Logo size={36} />
          <div>
            <h1>QuickMeet</h1>
            <p>FaceCast recordings, your own photo background, light or dark — built for real rooms.</p>
          </div>
          <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
        </header>

        <section className="card start-card">
          <label className="field">
            <span>Your name</span>
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
          <button type="button" className="primary xl" onClick={start}>
            Start meeting
          </button>
          <p className="hint">Starts in one step. You can turn the camera off before anyone sees you.</p>
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
          <details className="help">
            <summary>How inviting works</summary>
            <p>
              Start a meeting, then copy the link. Phones and laptops on the same Wi‑Fi can open that link while
              this computer is running QuickMeet. The first visit may ask you to trust the security warning once.
              Use headphones if two devices share a room, or the microphones will echo.
            </p>
          </details>
        </section>

        <aside className="side-col">
          {wifiUrls.length > 0 && (
            <section className="card wifi-card">
              <h2>Wi‑Fi access</h2>
              <p className="hint">
                Keep this computer awake. On another phone or laptop on the same Wi‑Fi, open one of these links.
              </p>
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
              <p className="fine">
                Camera and mic need the https link. Accept the browser warning once, then join the meeting.
              </p>
            </section>
          )}
          <section className="card">
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
                <p className="hint">Saved on this computer. Copy the code and send it to people.</p>
              </form>
            )}
            {schedule.length === 0 && !planning && <p className="empty">No meetings scheduled on this computer.</p>}
            <ul className="list">
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
                    <button
                      type="button"
                      onClick={() => onSchedule(schedule.filter((meeting) => meeting.id !== item.id))}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card">
            <h2>Recent</h2>
            {recent.length === 0 && <p className="empty">Meetings you start or join show up here.</p>}
            <ul className="list">
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
          <p className="fine">
            You appear as {safeName(settings.name)}. Anyone with the link can join. Video goes directly between browsers.
          </p>
        </aside>
      </div>
    </main>
  );
}
