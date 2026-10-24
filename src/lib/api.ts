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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
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
