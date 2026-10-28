import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LETSCONNECT_DATA || path.join(__dirname, '..', 'data');
const jsonPath = path.join(dataDir, 'letsconnect.json');

/** @typedef {{ id: string, email: string, name: string, passwordHash: string | null, googleId: string | null, avatar: string | null, plan: string, createdAt: number }} User */
/** @typedef {{ id: string, userId: string, code: string, title: string, startedAt: number, endedAt: number | null, durationMs: number, attendees: number, notes: string }} Meeting */
/** @typedef {{ id: string, userId: string, tokenHash: string, expiresAt: number, createdAt: number }} Session */

function emptyStore() {
  return {
    users: /** @type {User[]} */ ([]),
    meetings: /** @type {Meeting[]} */ ([]),
    sessions: /** @type {Session[]} */ ([]),
    waitlist: { emails: /** @type {string[]} */ ([]) },
  };
}

function ensureDir() {
  fs.mkdirSync(dataDir, { recursive: true });
}

function load() {
  ensureDir();
  if (!fs.existsSync(jsonPath)) {
    const store = emptyStore();
    fs.writeFileSync(jsonPath, JSON.stringify(store, null, 2));
    return store;
  }
  try {
    return { ...emptyStore(), ...JSON.parse(fs.readFileSync(jsonPath, 'utf8')) };
  } catch {
    return emptyStore();
  }
}

function save(store) {
  ensureDir();
  const tmp = `${jsonPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, jsonPath);
}

let cache = load();

function mutate(fn) {
  const next = fn(structuredClone(cache));
  cache = next;
  save(cache);
  return cache;
}

export function createUser({ email, name, passwordHash = null, googleId = null, avatar = null, id = null }) {
  const normalized = email.trim().toLowerCase();
  if (cache.users.some((user) => user.email === normalized)) {
    throw Object.assign(new Error('Email already registered.'), { status: 409 });
  }
  if (googleId && cache.users.some((user) => user.googleId === googleId)) {
    throw Object.assign(new Error('That Google account is already linked.'), { status: 409 });
  }
  const user = {
    id: id || randomUUID(),
    email: normalized,
    name: (name || '').trim().slice(0, 60) || normalized.split('@')[0],
    passwordHash,
    googleId,
    avatar,
    plan: 'free',
    createdAt: Date.now(),
  };
  mutate((store) => {
    store.users.push(user);
    return store;
  });
  return publicUser(user);
}

/** Create or refresh a local profile row after durable Firebase / JWT auth. */
export function upsertUserProfile({ id, email, name, passwordHash = undefined, googleId = null, avatar = null }) {
  const normalized = email.trim().toLowerCase();
  const existing = cache.users.find((user) => user.email === normalized || (id && user.id === id));
  if (existing) {
    mutate((store) => {
      const user = store.users.find((item) => item.id === existing.id);
      if (!user) return store;
      if (name) user.name = String(name).trim().slice(0, 60);
      if (passwordHash !== undefined) user.passwordHash = passwordHash;
      if (googleId) user.googleId = googleId;
      if (avatar) user.avatar = avatar;
      return store;
    });
    return findUserById(existing.id);
  }
  createUser({
    id: id || undefined,
    email: normalized,
    name: name || normalized.split('@')[0],
    passwordHash: passwordHash ?? null,
    googleId,
    avatar,
  });
  return findUserByEmail(normalized);
}

export function findUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  return cache.users.find((user) => user.email === normalized) || null;
}

export function findUserById(id) {
  return cache.users.find((user) => user.id === id) || null;
}

export function findUserByGoogleId(googleId) {
  return cache.users.find((user) => user.googleId === googleId) || null;
}

export function linkGoogle(userId, googleId, avatar) {
  mutate((store) => {
    const user = store.users.find((item) => item.id === userId);
    if (!user) return store;
    user.googleId = googleId;
    if (avatar) user.avatar = avatar;
    return store;
  });
  return publicUser(findUserById(userId));
}

export function updateUserProfile(userId, { name }) {
  mutate((store) => {
    const user = store.users.find((item) => item.id === userId);
    if (!user) return store;
    if (name) user.name = String(name).trim().slice(0, 60);
    return store;
  });
  return publicUser(findUserById(userId));
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    plan: user.plan || 'free',
    hasPassword: Boolean(user.passwordHash),
    hasGoogle: Boolean(user.googleId),
    createdAt: user.createdAt,
  };
}

export function createSession(userId, tokenHash, ttlMs = 1000 * 60 * 60 * 24 * 30) {
  const session = {
    id: randomUUID(),
    userId,
    tokenHash,
    expiresAt: Date.now() + ttlMs,
    createdAt: Date.now(),
  };
  mutate((store) => {
    store.sessions = store.sessions.filter((item) => item.expiresAt > Date.now());
    store.sessions.push(session);
    return store;
  });
  return session;
}

export function findSession(tokenHash) {
  const session = cache.sessions.find((item) => item.tokenHash === tokenHash && item.expiresAt > Date.now());
  return session || null;
}

export function deleteSession(tokenHash) {
  mutate((store) => {
    store.sessions = store.sessions.filter((item) => item.tokenHash !== tokenHash);
    return store;
  });
}

export function deleteUserSessions(userId) {
  mutate((store) => {
    store.sessions = store.sessions.filter((item) => item.userId !== userId);
    return store;
  });
}

export function listMeetings(userId) {
  return cache.meetings
    .filter((meeting) => meeting.userId === userId)
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function upsertMeeting(userId, payload) {
  const code = String(payload.code || '').trim().toLowerCase();
  if (!code) throw Object.assign(new Error('Meeting code required'), { status: 400 });
  const existing = cache.meetings.find((meeting) => meeting.userId === userId && meeting.code === code && !meeting.endedAt);
  if (existing) {
    mutate((store) => {
      const meeting = store.meetings.find((item) => item.id === existing.id);
      if (!meeting) return store;
      if (payload.title) meeting.title = String(payload.title).slice(0, 80);
      if (payload.attendees != null) meeting.attendees = Number(payload.attendees) || meeting.attendees;
      if (payload.notes != null) meeting.notes = String(payload.notes).slice(0, 4000);
      if (payload.endedAt) {
        meeting.endedAt = payload.endedAt;
        meeting.durationMs = Math.max(0, meeting.endedAt - meeting.startedAt);
      }
      return store;
    });
    return cache.meetings.find((item) => item.id === existing.id);
  }
  const meeting = {
    id: randomUUID(),
    userId,
    code,
    title: String(payload.title || 'LetsConnect meeting').slice(0, 80),
    startedAt: payload.startedAt || Date.now(),
    endedAt: payload.endedAt || null,
    durationMs: payload.durationMs || 0,
    attendees: Number(payload.attendees) || 1,
    notes: String(payload.notes || '').slice(0, 4000),
  };
  mutate((store) => {
    store.meetings.unshift(meeting);
    store.meetings = store.meetings.slice(0, 200);
    return store;
  });
  return meeting;
}

export function deleteMeeting(userId, meetingId) {
  mutate((store) => {
    store.meetings = store.meetings.filter((meeting) => !(meeting.userId === userId && meeting.id === meetingId));
    return store;
  });
}

export function getUserRow(userId) {
  return findUserById(userId);
}

/** @returns {{ ok: boolean, already: boolean }} */
export function addWaitlistEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return { ok: false, already: false };
  if (!cache.waitlist?.emails) cache.waitlist = { emails: [] };
  if (cache.waitlist.emails.includes(normalized)) {
    return { ok: true, already: true };
  }
  mutate((store) => {
    if (!store.waitlist?.emails) store.waitlist = { emails: [] };
    store.waitlist.emails.push(normalized);
    return store;
  });
  return { ok: true, already: false };
}

export function listOpenMeetingCodes() {
  const codes = new Set();
  for (const meeting of cache.meetings) {
    if (!meeting.endedAt && meeting.code) codes.add(meeting.code);
  }
  return [...codes];
}

/** End all in-progress meetings for a room code; returns count updated. */
export function endOpenMeetingsByCode(code) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return 0;
  const now = Date.now();
  let count = 0;
  mutate((store) => {
    for (const meeting of store.meetings) {
      if (meeting.code === normalized && !meeting.endedAt) {
        meeting.endedAt = now;
        meeting.durationMs = Math.max(0, now - meeting.startedAt);
        count++;
      }
    }
    return store;
  });
  return count;
}

/** End open meetings for a code when the oldest open session exceeds minAgeMs. */
export function endOpenMeetingsByCodeIfOlderThan(code, minAgeMs) {
  const normalized = String(code || '').trim().toLowerCase();
  if (!normalized) return 0;
  const open = cache.meetings.filter((m) => m.code === normalized && !m.endedAt);
  if (!open.length) return 0;
  const oldest = Math.min(...open.map((m) => m.startedAt));
  if (Date.now() - oldest < minAgeMs) return 0;
  return endOpenMeetingsByCode(normalized);
}
