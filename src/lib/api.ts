export type AuthUser = {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
  plan: string;
  hasPassword: boolean;
  hasGoogle: boolean;
  createdAt: number;
};

export type AdminUser = AuthUser & {
  googleId: string | null;
  gmail: boolean;
  lastLoginAt: number | null;
  lastLoginMethod: string | null;
  disabled: boolean;
};

export type SavedMeeting = {
  id: string;
  userId: string;
  code: string;
  title: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  attendees: number;
  notes: string;
};

import { fetchJson } from './http';

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  return fetchJson<T>(path, init);
}

export function fetchConfig() {
  return request<{
    google: boolean;
    firebase: boolean;
    appName: string;
    pricing: { free: boolean; hook: string };
  }>('/api/config');
}

export function fetchMe() {
  return request<{ user: AuthUser | null }>('/api/auth/me');
}

export function registerAccount(input: { name: string; email: string; password: string }) {
  return request<{ user: AuthUser }>('/api/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export function loginAccount(input: { email: string; password: string }) {
  return request<{ user: AuthUser }>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export function loginWithFirebaseToken(idToken: string) {
  return request<{ user: AuthUser }>('/api/auth/firebase', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  });
}

/** Chrome Custom Tab handoff: store validated token, return a short deep-link code. */
export function createFirebaseHandoff(idToken: string) {
  return request<{ code: string; expiresIn: number }>('/api/auth/firebase/handoff', {
    method: 'POST',
    body: JSON.stringify({ idToken }),
  });
}

/** Capacitor app claims the handoff code and receives the session cookie. */
export function claimFirebaseHandoff(code: string) {
  return request<{ user: AuthUser }>('/api/auth/firebase/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function logoutAccount() {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' });
}

export function updateProfile(input: { name: string }) {
  return request<{ user: AuthUser }>('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(input) });
}

export function fetchMeetings() {
  return request<{ meetings: SavedMeeting[] }>('/api/meetings');
}

export function saveMeeting(input: Partial<SavedMeeting> & { code: string; title?: string }) {
  return request<{ meeting: SavedMeeting }>('/api/meetings', { method: 'POST', body: JSON.stringify(input) });
}

export function removeMeeting(id: string) {
  return request<{ ok: boolean }>(`/api/meetings/${id}`, { method: 'DELETE' });
}

export function joinWaitlist(email: string) {
  return request<{ ok: boolean; already?: boolean }>('/api/waitlist', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function requestPasswordReset(email: string) {
  return request<{ ok: boolean }>('/api/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export function fetchIceServers() {
  return request<{ iceServers: RTCIceServer[] }>('/api/ice');
}

export function fetchVersion() {
  return request<{ app: string; version: string }>('/api/version');
}

export type AdminPerson = {
  id: string;
  name: string;
  admitted: boolean;
  host: boolean;
  cohost: boolean;
};

export type AdminLiveRoom = {
  code: string;
  hostId: string | null;
  locked: boolean;
  allowRejoin: boolean;
  boardOpen: boolean;
  lastActivity: number;
  participants: number;
  waiting: number;
  observers?: number;
  people: AdminPerson[];
};

export type AdminEvent = {
  id: string;
  ts: number;
  type: string;
  room: string | null;
  userId: string | null;
  name: string | null;
  email: string | null;
  detail: string | null;
  ip: string | null;
};

export type AdminOverview = {
  generatedAt: number;
  version: string;
  store: 'postgres' | 'json';
  stats: {
    liveRooms: number;
    livePeople: number;
    waitingPeople: number;
    accounts: number;
    meetings: number;
    meetingsToday: number;
    waitlist: number;
    googleAccounts?: number;
    gmailAccounts?: number;
    lastHour: number;
    lastDay: number;
    total: number;
  };
  live: AdminLiveRoom[];
  users: AdminUser[];
  meetings: SavedMeeting[];
  waitlist: { email: string; createdAt: number | null }[];
  events: AdminEvent[];
};

export function adminMe() {
  return request<{ admin: { username: string } | null }>('/api/admin/me');
}

export function adminLogin(username: string, password: string) {
  return request<{ admin: { username: string } }>('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function adminLogout() {
  return request<{ ok: boolean }>('/api/admin/logout', { method: 'POST', body: '{}' });
}

export function fetchAdminOverview() {
  return request<AdminOverview>('/api/admin/overview');
}

export function adminUpdateAccount(
  id: string,
  patch: { name?: string; plan?: string; disabled?: boolean },
) {
  return request<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function adminRemoveAccount(id: string) {
  return request<{ ok: boolean; id: string }>(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
