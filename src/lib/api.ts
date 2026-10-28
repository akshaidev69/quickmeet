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
