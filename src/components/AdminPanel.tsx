import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  adminLogin,
  adminLogout,
  adminMe,
  adminRemoveAccount,
  adminUpdateAccount,
  fetchAdminOverview,
  type AdminEvent,
  type AdminOverview,
  type AdminUser,
} from '../lib/api';
import { loadSettings, saveSettings } from '../lib/storage';
import { Logo } from './icons';
import { ThemeButton } from './LookControls';
import { AdminWatchScreen } from './AdminWatchScreen';

type Tab = 'overview' | 'live' | 'meetings' | 'users' | 'activity' | 'waitlist';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'live', label: 'Live rooms' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'users', label: 'Accounts' },
  { id: 'activity', label: 'Activity' },
  { id: 'waitlist', label: 'Waitlist' },
];

function formatWhen(ts: number | null | undefined) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function eventLabel(type: string) {
  const map: Record<string, string> = {
    'admin.login': 'Admin signed in',
    'admin.login_fail': 'Admin sign-in failed',
    'admin.logout': 'Admin signed out',
    'admin.watch': 'Silent watch started',
    'admin.unwatch': 'Silent watch ended',
    'admin.user_update': 'Account updated',
    'admin.user_block': 'Account blocked',
    'admin.user_unblock': 'Account unblocked',
    'admin.user_delete': 'Account deleted',
    'auth.register': 'New account',
    'auth.login': 'User signed in',
    'auth.login_fail': 'Sign-in failed',
    'auth.logout': 'User signed out',
    'auth.google': 'Google sign-in',
    'auth.forgot': 'Password reset requested',
    'waitlist.join': 'Waitlist email',
    'meeting.save': 'Meeting saved',
    'meeting.end': 'Meeting ended',
    'room.host': 'Host opened a room',
    'room.join': 'Joined meeting',
    'room.waiting': 'Waiting room',
    'room.admit': 'Admitted',
    'room.deny': 'Denied',
    'room.kick': 'Removed from call',
    'room.denied': 'Join blocked',
    'room.leave': 'Left meeting',
    'room.end': 'Host ended meeting',
    'room.lock': 'Meeting locked',
    'room.unlock': 'Meeting unlocked',
    'room.cohost_on': 'Co-host added',
    'room.cohost_off': 'Co-host removed',
    'room.share_start': 'Screen share started',
    'room.share_stop': 'Screen share stopped',
    'room.chat': 'Chat message',
    'room.poll': 'Poll posted',
    'room.vote': 'Poll vote',
    'room.reaction': 'Reaction',
    'room.cast_on': 'FaceCast started',
    'room.cast_off': 'FaceCast stopped',
    'room.board_open': 'Whiteboard opened',
    'room.board_close': 'Whiteboard closed',
  };
  return map[type] || type;
}

export function AdminPanel() {
  const [theme, setTheme] = useState(loadSettings().theme);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adminName, setAdminName] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [watchCode, setWatchCode] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [userBusy, setUserBusy] = useState(false);
  const [userFilter, setUserFilter] = useState<'all' | 'gmail' | 'google' | 'blocked'>('all');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.title = 'Admin · LetsConnect';
  }, []);

  async function loadOverview() {
    const next = await fetchAdminOverview();
    setData(next);
    setLoadError('');
  }

  useEffect(() => {
    let cancel = false;
    void adminMe()
      .then((res) => {
        if (cancel) return;
        setAdminName(res.admin?.username || null);
      })
      .catch(() => {
        if (!cancel) setAdminName(null);
      })
      .finally(() => {
        if (!cancel) setChecking(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  useEffect(() => {
    if (!adminName) return;
    let cancel = false;
    const tick = () => {
      void loadOverview().catch((err) => {
        if (!cancel) setLoadError(err instanceof Error ? err.message : 'Could not load admin data.');
      });
    };
    tick();
    const id = window.setInterval(tick, 5000);
    return () => {
      cancel = true;
      window.clearInterval(id);
    };
  }, [adminName]);

  async function onLogin(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await adminLogin(username.trim(), password);
      setAdminName(res.admin.username);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await adminLogout().catch(() => undefined);
    setAdminName(null);
    setData(null);
    setSelectedId(null);
  }

  function openUser(user: AdminUser) {
    setSelectedId(user.id);
    setEditName(user.name);
  }

  async function saveUser(patch: { name?: string; disabled?: boolean }) {
    if (!selectedId) return;
    setUserBusy(true);
    try {
      const res = await adminUpdateAccount(selectedId, patch);
      setData((current) =>
        current
          ? { ...current, users: current.users.map((row) => (row.id === res.user.id ? res.user : row)) }
          : current,
      );
      setEditName(res.user.name);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not update account.');
    } finally {
      setUserBusy(false);
    }
  }

  async function removeUser() {
    if (!selected) return;
    const ok = window.confirm(`Delete ${selected.email}? They will not be able to sign in, and their saved meetings will be removed.`);
    if (!ok) return;
    setUserBusy(true);
    try {
      await adminRemoveAccount(selected.id);
      setData((current) =>
        current ? { ...current, users: current.users.filter((row) => row.id !== selected.id) } : current,
      );
      setSelectedId(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not delete account.');
    } finally {
      setUserBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  const live = useMemo(() => {
    const rows = data?.live || [];
    if (!q) return rows;
    return rows.filter((room) => room.code.includes(q) || room.people.some((p) => p.name.toLowerCase().includes(q)));
  }, [data, q]);
  const meetings = useMemo(() => {
    const rows = data?.meetings || [];
    if (!q) return rows;
    return rows.filter((row) => row.code.includes(q) || row.title.toLowerCase().includes(q));
  }, [data, q]);
  const users = useMemo(() => {
    let rows = data?.users || [];
    if (userFilter === 'gmail') rows = rows.filter((row) => row.gmail);
    if (userFilter === 'google') rows = rows.filter((row) => row.hasGoogle);
    if (userFilter === 'blocked') rows = rows.filter((row) => row.disabled);
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.email.includes(q) ||
        row.name.toLowerCase().includes(q) ||
        String(row.googleId || '').toLowerCase().includes(q),
    );
  }, [data, q, userFilter]);
  const selected = users.find((row) => row.id === selectedId) || data?.users.find((row) => row.id === selectedId) || null;
  const events = useMemo(() => {
    const rows = data?.events || [];
    if (!q) return rows;
    return rows.filter((row) =>
      [row.type, row.room, row.name, row.email, row.detail].some((value) => String(value || '').toLowerCase().includes(q)),
    );
  }, [data, q]);
  const waitlist = useMemo(() => {
    const rows = data?.waitlist || [];
    if (!q) return rows;
    return rows.filter((row) => row.email.includes(q));
  }, [data, q]);

  if (checking) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="hint">Opening admin…</p>
        </section>
      </main>
    );
  }

  if (!adminName) {
    return (
      <main className="auth-page admin-page">
        <section className="auth-card">
          <div className="auth-brand">
            <Logo size={32} />
            <h1>LetsConnect admin</h1>
            <p>Operator console for live rooms, accounts, and activity.</p>
          </div>
          <form className="auth-form" onSubmit={(event) => void onLogin(event)}>
            <label className="field">
              <span>Username</span>
              <input
                value={username}
                name="admin-user"
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                name="admin-password"
                autoComplete="current-password"
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {error ? <p className="warn-text">{error}</p> : null}
            <button type="submit" className="primary xl auth-submit" disabled={busy || !username || !password}>
              {busy ? 'Signing in…' : 'Open admin'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const stats = data?.stats;

  if (watchCode) {
    return <AdminWatchScreen code={watchCode} onLeave={() => setWatchCode('')} />;
  }

  return (
    <main className="admin-shell">
      <header className="admin-top">
        <div className="admin-brand">
          <Logo size={28} />
          <div>
            <strong>LetsConnect admin</strong>
            <p>
              {adminName} · {data?.store === 'postgres' ? 'Postgres' : 'Local store'} · build {data?.version || '…'}
            </p>
          </div>
        </div>
        <div className="admin-top-actions">
          <ThemeButton
            theme={theme}
            onChange={(next) => {
              setTheme(next);
              saveSettings({ ...loadSettings(), theme: next });
              document.documentElement.dataset.theme = next;
            }}
          />
          <button type="button" className="secondary" onClick={() => void loadOverview().catch(() => undefined)}>
            Refresh
          </button>
          <button type="button" className="textbtn" onClick={() => void onLogout()}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'admin-tab on' : 'admin-tab'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.id === 'live' && stats ? <span>{stats.liveRooms}</span> : null}
            {item.id === 'users' && stats ? <span>{stats.accounts}</span> : null}
          </button>
        ))}
      </nav>

      {tab !== 'overview' ? (
        <label className="admin-search">
          <span className="sr-only">Filter</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter this list" />
        </label>
      ) : null}

      {loadError ? <p className="warn-text admin-error">{loadError}</p> : null}

      {tab === 'overview' ? (
        <section className="admin-grid">
          <Stat label="Live rooms" value={stats?.liveRooms ?? 0} />
          <Stat label="People in calls" value={stats?.livePeople ?? 0} />
          <Stat label="Waiting" value={stats?.waitingPeople ?? 0} />
          <Stat label="Accounts" value={stats?.accounts ?? 0} />
          <Stat label="Gmail logins" value={stats?.gmailAccounts ?? 0} />
          <Stat label="Google linked" value={stats?.googleAccounts ?? 0} />
          <Stat label="Meetings saved" value={stats?.meetings ?? 0} />
          <Stat label="Meetings today" value={stats?.meetingsToday ?? 0} />
          <Stat label="Waitlist" value={stats?.waitlist ?? 0} />
          <Stat label="Events (1h)" value={stats?.lastHour ?? 0} />
          <div className="admin-card admin-span">
            <h2>Live now</h2>
            {(data?.live.length || 0) === 0 ? (
              <p className="hint">No live meetings right now.</p>
            ) : (
              <ul className="admin-list">
                {data!.live.slice(0, 6).map((room) => (
                  <li key={room.code}>
                    <div>
                      <strong>{room.code}</strong>
                      <span>
                        {room.participants} in call
                        {room.waiting ? ` · ${room.waiting} waiting` : ''}
                        {room.locked ? ' · locked' : ''}
                      </span>
                    </div>
                    <button type="button" className="secondary" onClick={() => setWatchCode(room.code)}>
                      Watch silently
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="admin-card admin-span">
            <h2>Latest activity</h2>
            <EventList events={(data?.events || []).slice(0, 8)} />
          </div>
        </section>
      ) : null}

      {tab === 'live' ? (
        <section className="admin-card">
          <h2>Live rooms</h2>
          {live.length === 0 ? (
            <p className="hint">No one is in a meeting right now.</p>
          ) : (
            <ul className="admin-rooms">
              {live.map((room) => (
                <li key={room.code}>
                  <div className="admin-room-head">
                    <div>
                      <strong>{room.code}</strong>
                      <span>
                        {room.participants} in call
                        {room.waiting ? ` · ${room.waiting} waiting` : ''}
                        {room.observers ? ` · ${room.observers} silent` : ''}
                        {room.locked ? ' · locked' : ''}
                        {room.boardOpen ? ' · whiteboard' : ''}
                      </span>
                    </div>
                    <button type="button" className="primary" onClick={() => setWatchCode(room.code)}>
                      Watch silently
                    </button>
                  </div>
                  <ul className="admin-people">
                    {room.people.map((person) => (
                      <li key={person.id}>
                        {person.name}
                        {person.host ? ' · host' : person.cohost ? ' · co-host' : ''}
                        {!person.admitted ? ' · waiting' : ''}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'meetings' ? (
        <section className="admin-card">
          <h2>Saved meetings</h2>
          {meetings.length === 0 ? (
            <p className="hint">No saved meetings yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Title</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th>People</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {meetings.map((row) => (
                    <tr key={row.id}>
                      <td>{row.code}</td>
                      <td>{row.title}</td>
                      <td>{formatWhen(row.startedAt)}</td>
                      <td>{row.endedAt ? formatDuration(row.durationMs || row.endedAt - row.startedAt) : 'Live / open'}</td>
                      <td>{row.attendees}</td>
                      <td>{row.endedAt ? 'Ended' : 'Open'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'users' ? (
        <section className="admin-card">
          <h2>Accounts & Gmail</h2>
          <p className="hint">Google / Gmail sign-ins, profile photo, and Google account id. Manage name, block, or delete.</p>
          <div className="admin-filters">
            {(['all', 'gmail', 'google', 'blocked'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={userFilter === id ? 'admin-tab on' : 'admin-tab'}
                onClick={() => setUserFilter(id)}
              >
                {id === 'all' ? 'All' : id === 'gmail' ? 'Gmail' : id === 'google' ? 'Google linked' : 'Blocked'}
              </button>
            ))}
          </div>
          {users.length === 0 ? (
            <p className="hint">No accounts match this filter.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Gmail / email</th>
                    <th>Google</th>
                    <th>Last sign-in</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <div className="admin-person">
                          <UserAvatar user={row} />
                          <div>
                            <strong>{row.name}</strong>
                            <span>{row.plan}</span>
                          </div>
                        </div>
                      </td>
                      <td>
                        {row.email}
                        {row.gmail ? <em className="admin-pill">Gmail</em> : null}
                      </td>
                      <td>{row.hasGoogle ? 'Linked' : '—'}</td>
                      <td>
                        {formatWhen(row.lastLoginAt)}
                        {row.lastLoginMethod ? ` · ${row.lastLoginMethod}` : ''}
                      </td>
                      <td>{row.disabled ? 'Blocked' : 'Active'}</td>
                      <td>
                        <button type="button" className="secondary" onClick={() => openUser(row)}>
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'activity' ? (
        <section className="admin-card">
          <h2>Activity log</h2>
          <p className="hint">Real events from sign-in, rooms, and meetings. Chat text is not stored.</p>
          <EventList events={events} empty="Nothing recorded yet — activity appears as people use the app." />
        </section>
      ) : null}

      {tab === 'waitlist' ? (
        <section className="admin-card">
          <h2>Waitlist</h2>
          {waitlist.length === 0 ? (
            <p className="hint">No waitlist emails yet.</p>
          ) : (
            <ul className="admin-list">
              {waitlist.map((row) => (
                <li key={row.email}>
                  <strong>{row.email}</strong>
                  <span>{formatWhen(row.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {selected ? (
        <UserDrawer
          user={selected}
          name={editName}
          busy={userBusy}
          meetings={(data?.meetings || []).filter((row) => row.userId === selected.id)}
          events={(data?.events || []).filter(
            (row) => row.userId === selected.id || row.email === selected.email,
          )}
          onName={setEditName}
          onClose={() => setSelectedId(null)}
          onSaveName={() => void saveUser({ name: editName })}
          onToggleBlock={() => void saveUser({ disabled: !selected.disabled })}
          onDelete={() => void removeUser()}
        />
      ) : null}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-stat">
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

function UserAvatar({ user, size = 36 }: { user: Pick<AdminUser, 'name' | 'avatar' | 'email'>; size?: number }) {
  const letters = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';
  if (user.avatar) {
    return (
      <img
        className="admin-avatar"
        src={user.avatar}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <span className="admin-avatar admin-avatar-fallback" style={{ width: size, height: size }}>
      {letters}
    </span>
  );
}

function copyText(value: string) {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

function UserDrawer({
  user,
  name,
  busy,
  meetings,
  events,
  onName,
  onClose,
  onSaveName,
  onToggleBlock,
  onDelete,
}: {
  user: AdminUser;
  name: string;
  busy: boolean;
  meetings: AdminOverview['meetings'];
  events: AdminEvent[];
  onName: (value: string) => void;
  onClose: () => void;
  onSaveName: () => void;
  onToggleBlock: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="admin-drawer-back" onClick={onClose} role="presentation">
      <aside className="admin-drawer" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="admin-user-title">
        <header className="admin-drawer-head">
          <div className="admin-person">
            <UserAvatar user={user} size={48} />
            <div>
              <h2 id="admin-user-title">{user.name}</h2>
              <p>{user.disabled ? 'Blocked' : 'Active'} · {user.plan}</p>
            </div>
          </div>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>

        <section>
          <h3>Gmail / Google</h3>
          <dl className="admin-dl">
            <div>
              <dt>Email</dt>
              <dd>
                {user.email}
                {user.gmail ? <em className="admin-pill">Gmail</em> : null}
                <button type="button" className="textbtn" onClick={() => copyText(user.email)}>
                  Copy
                </button>
              </dd>
            </div>
            <div>
              <dt>Google account id</dt>
              <dd>
                {user.googleId || 'Not linked'}
                {user.googleId ? (
                  <button type="button" className="textbtn" onClick={() => copyText(user.googleId || '')}>
                    Copy
                  </button>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Google photo</dt>
              <dd>{user.avatar ? 'From Google profile' : 'None stored'}</dd>
            </div>
            <div>
              <dt>Sign-in methods</dt>
              <dd>{[user.hasGoogle ? 'Google / Gmail' : '', user.hasPassword ? 'Email password' : ''].filter(Boolean).join(' · ') || '—'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatWhen(user.createdAt)}</dd>
            </div>
            <div>
              <dt>Last sign-in</dt>
              <dd>
                {formatWhen(user.lastLoginAt)}
                {user.lastLoginMethod ? ` · ${user.lastLoginMethod}` : ''}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Manage</h3>
          <label className="field">
            <span>Display name</span>
            <input value={name} maxLength={60} onChange={(event) => onName(event.target.value)} />
          </label>
          <div className="admin-top-actions">
            <button type="button" className="secondary" disabled={busy || !name.trim() || name.trim() === user.name} onClick={onSaveName}>
              Save name
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={onToggleBlock}>
              {user.disabled ? 'Allow sign-in' : 'Block sign-in'}
            </button>
            <button type="button" className="danger-btn" disabled={busy} onClick={onDelete}>
              Delete account
            </button>
          </div>
        </section>

        <section>
          <h3>Their meetings</h3>
          {meetings.length === 0 ? (
            <p className="hint">No saved meetings for this account.</p>
          ) : (
            <ul className="admin-list">
              {meetings.slice(0, 8).map((row) => (
                <li key={row.id}>
                  <strong>{row.code}</strong>
                  <span>
                    {row.title} · {formatWhen(row.startedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>Recent activity</h3>
          <EventList events={events.slice(0, 8)} empty="No activity for this account yet." />
        </section>
      </aside>
    </div>
  );
}

function EventList({ events, empty }: { events: AdminEvent[]; empty?: string }) {
  if (!events.length) return <p className="hint">{empty || 'No activity yet.'}</p>;
  return (
    <ul className="admin-events">
      {events.map((event) => (
        <li key={event.id}>
          <time dateTime={new Date(event.ts).toISOString()}>{formatWhen(event.ts)}</time>
          <div>
            <strong>{eventLabel(event.type)}</strong>
            <span>
              {[event.name, event.email, event.room, event.detail].filter(Boolean).join(' · ') || '—'}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
