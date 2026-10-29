import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Logo } from './icons';
import { useAuth } from '../lib/auth';
import { fetchMeetings, removeMeeting, updateProfile, type SavedMeeting } from '../lib/api';
import { formatCode, isFullCode, isValidMeetingCode, meetingCode, safeName, uid } from '../lib/code';
import { formatDurationLabel, formatMeetingDayKey, formatMeetingWhen } from '../lib/formatTime';
import { shareInviteUrl } from '../lib/invite';
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
  inCallCode?: string;
  onReturnToCall?: () => void;
};

type NavTab = 'home' | 'meetings' | 'recordings' | 'followups' | 'profile';
type RecentFilter = 'all' | 'hosted' | 'joined';
type MeetingStatus = 'live' | 'progress' | 'ended' | 'scheduled';

type DashRow = {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  status: MeetingStatus;
  hosted: boolean;
  cloudId?: string;
  scheduleId?: string;
  recentOnly?: boolean;
};

function whenLabel(ts: number | string) {
  return formatMeetingWhen(ts);
}

function formatDuration(ms: number, endedAt?: number | null) {
  return formatDurationLabel(ms, endedAt);
}

function loadFollowUps(): string[] {
  const keys = ['LetsConnect.followUps', 'LetsConnect.followups', 'LetsConnect.promises'];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      }
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items)) {
        return (parsed as { items: unknown[] }).items.filter(
          (item): item is string => typeof item === 'string' && item.trim().length > 0,
        );
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

function wasHosted(code: string, scheduleCodes: Set<string>) {
  const formatted = formatCode(code);
  if (scheduleCodes.has(formatted)) return true;
  try {
    return sessionStorage.getItem(`lc-host:${formatted}`) === '1';
  } catch {
    return false;
  }
}

function statusLabel(status: MeetingStatus) {
  if (status === 'live') return 'Live';
  if (status === 'progress') return 'In progress';
  if (status === 'scheduled') return 'Scheduled';
  return 'Ended';
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
  inCallCode,
  onReturnToCall,
}: Props) {
  const { user, setUser } = useAuth();
  const native = isNativeApp();
  const [code, setCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [planning, setPlanning] = useState(false);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [titleError, setTitleError] = useState('');
  const [whenError, setWhenError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const [wifiUrls, setWifiUrls] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState('');
  const [cloud, setCloud] = useState<SavedMeeting[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navTab, setNavTab] = useState<NavTab>('home');
  const [recentFilter, setRecentFilter] = useState<RecentFilter>('all');
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>(() => loadFollowUps());

  const upcomingRef = useRef<HTMLElement>(null);
  const recentRef = useRef<HTMLElement>(null);
  const followRef = useRef<HTMLElement>(null);
  const recordingsRef = useRef<HTMLElement>(null);
  const recordingsSideRef = useRef<HTMLElement>(null);

  const LIST_PREVIEW = 5;
  const greetName = safeName(user?.name || settings.name);
  const firstName = greetName.split(' ').slice(0, 2).join(' ');
  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const today = new Date();
  const todayKey = formatMeetingDayKey(today);
  const [selectedDay, setSelectedDay] = useState(() => todayKey);

  const scheduleCodes = useMemo(() => new Set(schedule.map((item) => formatCode(item.code))), [schedule]);

  const weekDays = useMemo(() => {
    const start = new Date(today);
    start.setHours(12, 0, 0, 0);
    start.setDate(today.getDate() - today.getDay());
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      const key = formatMeetingDayKey(day);
      const scheduled = schedule.filter((item) => item.when && formatMeetingDayKey(item.when) === key).length;
      const live = cloud.filter((item) => !item.endedAt && formatMeetingDayKey(item.startedAt) === key).length;
      return {
        key,
        label: day.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3).toUpperCase(),
        date: day.getDate(),
        isToday: day.toDateString() === today.toDateString(),
        count: scheduled,
        live,
      };
    });
  }, [cloud, schedule, today]);

  const heldCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const item of cloud) codes.add(formatCode(item.code));
    for (const item of recent) codes.add(formatCode(item.code));
    return codes;
  }, [cloud, recent]);

  const daySchedule = useMemo(
    () =>
      schedule
        .filter((item) => item.when && formatMeetingDayKey(item.when) === selectedDay)
        .filter((item) => !heldCodes.has(formatCode(item.code)))
        .sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime()),
    [heldCodes, schedule, selectedDay],
  );

  const dayLive = useMemo(
    () =>
      cloud.filter(
        (item) => !item.endedAt && formatMeetingDayKey(item.startedAt) === selectedDay,
      ),
    [cloud, selectedDay],
  );

  const meetingsToday = useMemo(() => {
    const codes = new Set<string>();
    for (const item of schedule) {
      if (!item.when || formatMeetingDayKey(item.when) !== todayKey) continue;
      if (heldCodes.has(formatCode(item.code))) continue;
      codes.add(formatCode(item.code));
    }
    for (const item of cloud) {
      if (item.endedAt) continue;
      if (formatMeetingDayKey(item.startedAt) === todayKey) codes.add(formatCode(item.code));
    }
    return codes.size;
  }, [cloud, heldCodes, schedule, todayKey]);

  const selectedDayLabel = useMemo(() => {
    const match = weekDays.find((day) => day.key === selectedDay);
    if (!match) return 'Selected day';
    if (match.isToday) return 'Today';
    return `${match.label} ${match.date}`;
  }, [selectedDay, weekDays]);

  const dashRows = useMemo(() => {
    const byCode = new Map<string, DashRow>();

    for (const item of cloud) {
      const formatted = formatCode(item.code);
      const status: MeetingStatus = item.endedAt ? 'ended' : item.durationMs > 0 ? 'progress' : 'live';
      const duration = formatDuration(item.durationMs, item.endedAt);
      byCode.set(formatted, {
        id: `cloud-${item.id}`,
        code: formatted,
        title: item.title,
        subtitle:
          duration && duration !== 'Ended'
            ? `${whenLabel(item.startedAt)} · ${duration}`
            : whenLabel(item.startedAt),
        status,
        hosted: wasHosted(formatted, scheduleCodes),
        cloudId: item.id,
      });
    }

    for (const item of recent) {
      const formatted = formatCode(item.code);
      if (byCode.has(formatted)) continue;
      const live = Boolean(inCallCode && formatCode(inCallCode) === formatted);
      byCode.set(formatted, {
        id: `recent-${formatted}`,
        code: formatted,
        title: item.title,
        subtitle: whenLabel(item.ts),
        status: live ? 'live' : 'ended',
        hosted: wasHosted(formatted, scheduleCodes),
        recentOnly: true,
      });
    }

    return [...byCode.values()].sort((a, b) => {
      const rank = (s: MeetingStatus) => (s === 'live' ? 0 : s === 'progress' ? 1 : s === 'scheduled' ? 2 : 3);
      const diff = rank(a.status) - rank(b.status);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });
  }, [cloud, inCallCode, recent, schedule, scheduleCodes]);

  const filteredRecent = useMemo(() => {
    let rows = dashRows;
    if (recentFilter === 'hosted') rows = rows.filter((row) => row.hosted);
    if (recentFilter === 'joined') rows = rows.filter((row) => !row.hosted);
    return rows;
  }, [dashRows, recentFilter]);

  const recentVisible = showAllRecent ? filteredRecent : filteredRecent.slice(0, LIST_PREVIEW);

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
    setFollowUps(loadFollowUps());
  }, [cloud.length, recent.length]);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    function onPointer(event: PointerEvent) {
      const node = event.target as Node | null;
      if (menuRef.current?.contains(node) || avatarRef.current?.contains(node)) return;
      setMenuOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

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
    setJoinError('');
    const next = meetingCode();
    onEnter(next, 'Instant meeting', settings.instantJoin ? 'room' : 'lobby', 'host');
  }

  async function join(nextCode: string, label: string, role: 'host' | 'guest' = 'guest') {
    const formatted = formatCode(nextCode);
    if (!isFullCode(formatted) || !isValidMeetingCode(formatted)) {
      setJoinError('Enter a valid meeting code');
      return;
    }
    if (role === 'guest') {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(formatted)}`);
        if (res.status === 404) {
          setJoinError('Meeting not found or has ended');
          return;
        }
      } catch {
        /* offline: still allow lobby attempt */
      }
    }
    setJoinError('');
    const leftover = schedule.filter((item) => formatCode(item.code) !== formatted);
    if (leftover.length !== schedule.length) onSchedule(leftover);
    onEnter(formatted, label, settings.instantJoin ? 'room' : 'lobby', role);
  }

  function createScheduled(event: FormEvent) {
    event.preventDefault();
    const nextTitle = title.trim();
    const titleMsg = nextTitle ? '' : 'Title is required';
    const whenMsg = when ? '' : 'Date and time are required';
    setTitleError(titleMsg);
    setWhenError(whenMsg);
    if (titleMsg || whenMsg) return;
    const local = new Date(when);
    if (Number.isNaN(local.getTime())) {
      setWhenError('Enter a valid date and time');
      return;
    }
    const next: ScheduledMeeting = {
      id: uid(),
      title: nextTitle.slice(0, 60),
      when: local.toISOString(),
      code: meetingCode(),
    };
    onSchedule([next, ...schedule].slice(0, 12));
    setPlanning(false);
    setTitle('');
    setWhen('');
    setTitleError('');
    setWhenError('');
  }

  async function forgetCloud(id: string) {
    try {
      await removeMeeting(id);
      setCloud((items) => items.filter((item) => item.id !== id));
    } catch {
      /* ignore */
    }
  }

  function scrollToNav(tab: NavTab) {
    setNavTab(tab);
    if (tab === 'profile') {
      setMenuOpen(true);
      return;
    }
    if (tab === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const target =
      tab === 'meetings'
        ? upcomingRef.current
        : tab === 'followups'
          ? followRef.current
          : tab === 'recordings'
            ? recordingsSideRef.current ?? recordingsRef.current
            : null;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function openRow(row: DashRow) {
    const role = row.hosted ? 'host' : 'guest';
    void join(row.code, row.title, role);
  }

  function rowActions(row: DashRow) {
    const live = row.status === 'live' || row.status === 'progress';
    const primaryLabel = row.status === 'scheduled' ? 'Start' : live ? 'Open' : 'Rejoin';
    return (
      <div className="dash-row-actions">
        <button type="button" className="dash-btn dash-btn-ghost" onClick={() => openRow(row)}>
          {primaryLabel}
        </button>
        <button
          type="button"
          className="dash-btn dash-btn-ghost"
          onClick={() => void navigator.clipboard?.writeText(shareInviteUrl(row.code))}
        >
          Copy link
        </button>
        {row.cloudId && (
          <button type="button" className="dash-btn dash-btn-ghost" onClick={() => void forgetCloud(row.cloudId!)}>
            Remove
          </button>
        )}
        {row.scheduleId && (
          <button
            type="button"
            className="dash-btn dash-btn-ghost"
            onClick={() => onSchedule(schedule.filter((meeting) => meeting.id !== row.scheduleId))}
          >
            Remove
          </button>
        )}
        {row.recentOnly && (
          <button type="button" className="dash-btn dash-btn-ghost" onClick={() => onForget(row.code)}>
            Remove
          </button>
        )}
      </div>
    );
  }

  const profileMenu = menuOpen ? (
    <>
      <button
        type="button"
        className="dash-menu-backdrop"
        aria-label="Close profile menu"
        onClick={() => setMenuOpen(false)}
      />
      <div className="dash-profile-menu" role="menu" ref={menuRef}>
        <div className="dash-profile-head">
          <strong>{user?.name || 'Your profile'}</strong>
          <span>{user?.email || (user?.plan === 'free' ? 'Free plan' : user?.plan)}</span>
        </div>
        <label className="dash-field">
          <span>Display name</span>
          <input
            value={settings.name || user?.name || ''}
            maxLength={40}
            placeholder="How people see you"
            onChange={(event) => onSettings({ ...settings, name: event.target.value })}
            onBlur={() => {
              const next = settings.name.trim();
              if (!next || next === user?.name) return;
              void updateProfile({ name: next }).then((data) => setUser(data.user)).catch(() => undefined);
            }}
          />
        </label>
        <button
          type="button"
          className="dash-menu-item"
          onClick={() => {
            setMenuOpen(false);
            onMarketing();
          }}
        >
          Product
        </button>
        <button type="button" className="dash-menu-item" disabled>
          Connect calendar
          <em>Coming soon</em>
        </button>
        <label className="dash-check">
          <input
            type="checkbox"
            checked={settings.instantJoin}
            onChange={(event) => onSettings({ ...settings, instantJoin: event.target.checked })}
          />
          <span>Join instantly (skip camera check)</span>
        </label>
        <button
          type="button"
          className="dash-menu-item"
          onClick={() => onSettings({ ...settings, theme: settings.theme === 'dark' ? 'light' : 'dark' })}
        >
          Dark mode
          <span className="dash-toggle-pill" aria-hidden="true">
            {settings.theme === 'dark' ? 'On' : 'Off'}
          </span>
        </button>
        <button
          type="button"
          className="dash-menu-item dash-menu-danger"
          onClick={() => {
            setMenuOpen(false);
            onLogout();
          }}
        >
          Sign out
        </button>
      </div>
    </>
  ) : null;

  return (
    <main className={`home hub-v2${native ? ' hub-v2-native' : ''}`}>
      <div className="hub-v2-bg" aria-hidden="true" />
      {inCallCode && onReturnToCall && (
        <div className="dash-incall" role="status">
          <span>You are still in {inCallCode}</span>
          <button type="button" className="primary slim" onClick={onReturnToCall}>
            Return to meeting
          </button>
        </div>
      )}

      <header className="dash-top">
        <button type="button" className="dash-brand" onClick={onMarketing} aria-label="LetsConnect home">
          <Logo size={28} />
          <span>LetsConnect</span>
        </button>

        <nav className="dash-nav" aria-label="Dashboard sections">
          {(
            [
              ['home', 'Home'],
              ['meetings', 'Meetings'],
              ['recordings', 'Recordings'],
              ['followups', 'Follow-ups'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`dash-nav-link${navTab === id ? ' is-active' : ''}`}
              aria-current={navTab === id ? 'page' : undefined}
              onClick={() => scrollToNav(id)}
            >
              {label}
              {id === 'recordings' && <em className="dash-soon">Coming soon</em>}
            </button>
          ))}
        </nav>

        <div className="dash-top-actions">
          <button type="button" className="dash-icon-btn dash-bell" aria-label="Notifications" disabled title="Coming soon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M15 17H9c-4 0-4-6 0-6h12c-4 2-4 6 0 6Z" strokeLinejoin="round" />
              <path d="M10 17a2 2 0 0 0 4 0" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="dash-product-link"
            onClick={onMarketing}
          >
            Product
          </button>
          <div className="dash-avatar-wrap">
          <button
            ref={avatarRef}
            type="button"
            className="dash-avatar"
            aria-label="Profile menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {user?.avatar ? (
              <img src={user.avatar} alt="" />
            ) : (
              <span>{(user?.name || settings.name || 'A').slice(0, 2).toUpperCase()}</span>
            )}
          </button>
          {profileMenu}
          </div>
        </div>
      </header>

      <div className="dash-layout">
        <div className="dash-col-main">
          <section className="dash-greeting" aria-labelledby="dash-greeting-title">
            <p className="dash-greeting-kicker">
              {firstName ? `${greeting}, ${firstName}` : greeting}
            </p>
            <h1 id="dash-greeting-title">
              <span className="dash-greeting-long">You have </span>
              {meetingsToday} meeting{meetingsToday === 1 ? '' : 's'} today
            </h1>
          </section>

          <section className="dash-card dash-card-new" aria-labelledby="dash-new-title">
            <button type="button" className="dash-new-hero" onClick={start}>
              <span className="dash-new-hero-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                </svg>
              </span>
              <span className="dash-new-hero-copy">
                <h2 id="dash-new-title">New meeting</h2>
                <p>Instant link {'·'} free, no time limit</p>
              </span>
              <span className="dash-new-hero-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </button>
            <div className="dash-card-new-inner dash-desktop-only">
              <div>
                <h2>New meeting</h2>
                <p>Start instantly or pick a time that works for everyone.</p>
              </div>
              <div className="dash-card-new-actions">
                <button type="button" className="dash-btn dash-btn-primary" onClick={start}>
                  Start instant meeting
                </button>
                <button
                  type="button"
                  className="dash-btn dash-btn-secondary"
                  onClick={() => setPlanning((open) => !open)}
                  aria-expanded={planning}
                >
                  {planning ? 'Cancel schedule' : 'Schedule'}
                </button>
              </div>
            </div>
            {planning && (
              <form className="dash-schedule-form" onSubmit={createScheduled}>
                <label className="dash-field">
                  <span>Title</span>
                  <input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      if (titleError) setTitleError('');
                    }}
                    placeholder="Design review"
                    aria-invalid={titleError ? true : undefined}
                  />
                  {titleError ? <p className="dash-field-error">{titleError}</p> : null}
                </label>
                <label className="dash-field">
                  <span>Date and time</span>
                  <input
                    type="datetime-local"
                    value={when}
                    onChange={(event) => {
                      setWhen(event.target.value);
                      if (whenError) setWhenError('');
                    }}
                    aria-invalid={whenError ? true : undefined}
                  />
                  {whenError ? <p className="dash-field-error">{whenError}</p> : null}
                </label>
                <button className="dash-btn dash-btn-secondary" type="submit">
                  Create meeting code
                </button>
              </form>
            )}
          </section>

          <section className="dash-join-block" aria-labelledby="dash-join-title">
            <h2 id="dash-join-title" className="dash-desktop-only">
              Join by code
            </h2>
            <div className="dash-join-row">
              <input
                value={code}
                placeholder="Meeting code"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                aria-label="Meeting code"
                aria-invalid={joinError ? true : undefined}
                aria-describedby={joinError ? 'dash-join-error' : undefined}
                onChange={(event) => {
                  setCode(formatCode(event.target.value));
                  if (joinError) setJoinError('');
                }}
                onBlur={() => setJoinError('')}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void join(code, 'Joined meeting');
                  }
                }}
              />
              <button type="button" className="dash-btn dash-btn-primary" onClick={() => void join(code, 'Joined meeting')}>
                Join
              </button>
            </div>
            {joinError && (
              <p id="dash-join-error" className="dash-field-error" role="alert">
                {joinError}
              </p>
            )}
          </section>

          <section className="dash-week" aria-label="Week overview">
            <div className="dash-week-strip" role="list">
              {weekDays.map((day) => (
                <button
                  key={day.key}
                  type="button"
                  className={`dash-week-day${day.isToday ? ' is-today' : ''}${selectedDay === day.key ? ' is-selected' : ''}`}
                  role="listitem"
                  aria-pressed={selectedDay === day.key}
                  onClick={() => setSelectedDay(day.key)}
                >
                  <span>{day.label}</span>
                  <strong>{day.date}</strong>
                  {day.count > 0 && <i className="dash-week-dot" aria-label={`${day.count} scheduled`} />}
                </button>
              ))}
            </div>
          </section>

          <section ref={upcomingRef} className="dash-panel" aria-labelledby="dash-upcoming-title">
            <div className="dash-panel-head">
              <h2 id="dash-upcoming-title">Up next {'·'} {selectedDayLabel}</h2>
            </div>
            {daySchedule.length === 0 && dayLive.length === 0 ? (
              <div className="dash-empty">
                <p>{selectedDayLabel === 'Today' ? 'No meetings today.' : `No meetings on ${selectedDayLabel.toLowerCase()}.`}</p>
                <button type="button" className="dash-btn dash-btn-ghost" onClick={() => setPlanning(true)}>
                  Schedule one
                </button>
              </div>
            ) : (
              <ul className="dash-list">
                {daySchedule.map((item) => (
                  <li key={item.id} className="dash-list-item">
                    <div className="dash-list-body">
                      <strong>{item.title}</strong>
                      <span>{item.when ? whenLabel(item.when) : 'Scheduled'}</span>
                      <em className="dash-status dash-status-scheduled">Scheduled</em>
                      <code>{item.code}</code>
                    </div>
                    <div className="dash-row-actions">
                      <button type="button" className="dash-btn dash-btn-ghost" onClick={() => void join(item.code, item.title, 'host')}>
                        Start
                      </button>
                      <button
                        type="button"
                        className="dash-btn dash-btn-ghost"
                        onClick={() => onSchedule(schedule.filter((meeting) => meeting.id !== item.id))}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
                {dayLive.map((item) => (
                  <li key={item.id} className="dash-list-item">
                    <div className="dash-list-body">
                      <strong>{item.title}</strong>
                      <span>{whenLabel(item.startedAt)}</span>
                      <em className="dash-status dash-status-live">Live</em>
                      <code>{item.code}</code>
                    </div>
                    <div className="dash-row-actions">
                      <button type="button" className="dash-btn dash-btn-ghost" onClick={() => void join(item.code, item.title, 'host')}>
                        Open
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section ref={recordingsRef} className="dash-panel dash-panel-muted dash-recordings-mobile" aria-labelledby="dash-rec-title">
            <h2 id="dash-rec-title">Recordings</h2>
            <p className="dash-empty-inline">Coming soon {'—'} your saved sessions will appear here.</p>
          </section>

          <section ref={recentRef} className="dash-panel dash-mobile-recent" aria-labelledby="dash-recent-mobile-title">
            <div className="dash-panel-head">
              <h2 id="dash-recent-mobile-title">Recent meetings</h2>
            </div>
            <div className="dash-chips" role="tablist" aria-label="Recent filter">
              {(['all', 'hosted', 'joined'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={recentFilter === filter}
                  className={`dash-chip${recentFilter === filter ? ' is-active' : ''}`}
                  onClick={() => setRecentFilter(filter)}
                >
                  {filter === 'all' ? 'All' : filter === 'hosted' ? 'Hosted' : 'Joined'}
                </button>
              ))}
            </div>
            {filteredRecent.length === 0 ? (
              <div className="dash-empty">
                <p>No recent meetings{recentFilter === 'all' ? '' : ` (${recentFilter})`} yet.</p>
              </div>
            ) : (
              <>
                <ul className="dash-list">
                  {recentVisible.map((row) => (
                    <li key={row.id} className="dash-list-item">
                      <div className="dash-list-body">
                        <strong>{row.title}</strong>
                        <span>{row.subtitle}</span>
                        <em className={`dash-status dash-status-${row.status}`}>{statusLabel(row.status)}</em>
                        <code>{row.code}</code>
                      </div>
                      {rowActions(row)}
                    </li>
                  ))}
                </ul>
                {filteredRecent.length > LIST_PREVIEW && (
                  <button type="button" className="dash-link-more" onClick={() => setShowAllRecent((open) => !open)}>
                    {showAllRecent ? 'Show less' : `Show all ${filteredRecent.length}`}
                  </button>
                )}
              </>
            )}
          </section>
        </div>

        <aside className="dash-col-side">
          <section ref={followRef} className="dash-panel" aria-labelledby="dash-follow-title">
            <div className="dash-panel-head">
              <h2 id="dash-follow-title">Follow-ups due</h2>
            </div>
            {followUps.length === 0 ? (
              <div className="dash-empty">
                <p>No follow-ups yet</p>
                <span className="dash-empty-hint">Promises from meetings will show up here when saved.</span>
              </div>
            ) : (
              <ul className="dash-follow-list">
                {followUps.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="dash-panel dash-panel-recent" aria-labelledby="dash-recent-title">
            <div className="dash-panel-head">
              <h2 id="dash-recent-title">Recent meetings</h2>
            </div>
            <div className="dash-chips" role="tablist" aria-label="Recent filter">
              {(['all', 'hosted', 'joined'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  role="tab"
                  aria-selected={recentFilter === filter}
                  className={`dash-chip${recentFilter === filter ? ' is-active' : ''}`}
                  onClick={() => setRecentFilter(filter)}
                >
                  {filter === 'all' ? 'All' : filter === 'hosted' ? 'Hosted' : 'Joined'}
                </button>
              ))}
            </div>
            {filteredRecent.length === 0 ? (
              <div className="dash-empty">
                <p>No recent meetings{recentFilter === 'all' ? '' : ` (${recentFilter})`} yet.</p>
              </div>
            ) : (
              <>
                <ul className="dash-list">
                  {recentVisible.map((row) => (
                    <li key={row.id} className="dash-list-item">
                      <div className="dash-list-body">
                        <strong>{row.title}</strong>
                        <span>{row.subtitle}</span>
                        <em className={`dash-status dash-status-${row.status}`}>{statusLabel(row.status)}</em>
                        <code>{row.code}</code>
                      </div>
                      {rowActions(row)}
                    </li>
                  ))}
                </ul>
                {filteredRecent.length > LIST_PREVIEW && (
                  <button type="button" className="dash-link-more" onClick={() => setShowAllRecent((open) => !open)}>
                    {showAllRecent ? 'Show less' : `Show all ${filteredRecent.length}`}
                  </button>
                )}
              </>
            )}
          </section>

          {wifiUrls.length > 0 && (
            <section className="dash-panel dash-panel-wifi" aria-labelledby="dash-wifi-title">
              <h2 id="dash-wifi-title">Wi-Fi access</h2>
              <p className="dash-empty-hint">Open on another device on the same network.</p>
              <ul className="dash-wifi-list">
                {wifiUrls.map((url) => (
                  <li key={url}>
                    <code>{url}</code>
                    <button type="button" className="dash-btn dash-btn-ghost" onClick={() => void copyWifi(url)}>
                      {copiedUrl === url ? 'Copied' : 'Copy'}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            ref={recordingsSideRef}
            className="dash-panel dash-panel-muted dash-recordings-desktop"
            aria-labelledby="dash-rec-desktop-title"
          >
            <h2 id="dash-rec-desktop-title">Recordings</h2>
            <p className="dash-empty-inline">Coming soon {'—'} your saved sessions will appear here.</p>
          </section>

          <p className="dash-fine">You appear as {safeName(settings.name)}. Video goes peer-to-peer.</p>
        </aside>
      </div>

      <nav className="dash-tabbar" aria-label="Mobile navigation">
        <button type="button" className={`dash-tabbar-btn${navTab === 'home' ? ' is-active' : ''}`} onClick={() => scrollToNav('home')}>
          Home
        </button>
        <button type="button" className={`dash-tabbar-btn${navTab === 'meetings' ? ' is-active' : ''}`} onClick={() => scrollToNav('meetings')}>
          Meetings
        </button>
        <button type="button" className="dash-tabbar-fab" aria-label="New meeting" onClick={start}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={`dash-tabbar-btn${navTab === 'followups' ? ' is-active' : ''}`}
          onClick={() => scrollToNav('followups')}
        >
          Follow-ups
        </button>
        <button
          type="button"
          className={`dash-tabbar-btn${navTab === 'recordings' ? ' is-active' : ''}`}
          onClick={() => scrollToNav('recordings')}
        >
          Recordings
        </button>
      </nav>
    </main>
  );
}
