import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  createSession,
  createUser,
  deleteMeeting,
  deleteSession,
  findSession,
  findUserByEmail,
  findUserByGoogleId,
  getUserRow,
  linkGoogle,
  listMeetings,
  publicUser,
  updateUserProfile,
  upsertMeeting,
} from './db.mjs';

// Load .env.local for Vite + production when present.
(() => {
  try {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    for (const file of ['.env.local', '.env']) {
      const full = path.join(root, file);
      if (!fs.existsSync(full)) continue;
      for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 0) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (!(key in process.env)) process.env[key] = value;
      }
    }
  } catch {
    /* ignore */
  }
})();

const COOKIE = 'lc_session';
const SESSION_DAYS = 30;
/** Short-lived native Google→app handoff codes (avoid stuffing JWTs into deep links). */
const handoffs = new Map();
const HANDOFF_TTL_MS = 5 * 60 * 1000;
const GOOGLE_WEB_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ||
  process.env.VITE_GOOGLE_CLIENT_ID ||
  '183754318076-ck9l1s0sje8updc4tgb2d581b2cj4jf8.apps.googleusercontent.com';

function pruneHandoffs() {
  const now = Date.now();
  for (const [code, entry] of handoffs) {
    if (entry.expiresAt <= now) handoffs.delete(code);
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 64);
  const prev = Buffer.from(hash, 'hex');
  if (prev.length !== next.length) return false;
  return timingSafeEqual(prev, next);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = value;
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sessionCookie(token, maxAgeSec = SESSION_DAYS * 24 * 60 * 60) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

function clearCookie() {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function appOrigin(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || (process.env.RENDER ? 'https' : 'http');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:5173';
  return `${proto}://${host}`;
}

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function firebaseProjectId() {
  return process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'letsconnect-e8c03';
}

function firebaseApiKey() {
  return (
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    'AIzaSyBcP319FVEOh66xsbNLmNNh4kBFBR1vGCo'
  );
}

/** Verify a Google Identity Services id_token (used by the Android bridge before Firebase exchange). */
async function verifyGoogleIdToken(idToken) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error('Invalid Google / Firebase token.'), { status: 401 });
  }
  const aud = String(data.aud || '');
  if (GOOGLE_WEB_CLIENT_ID && aud && aud !== GOOGLE_WEB_CLIENT_ID) {
    throw Object.assign(new Error('Google token audience mismatch.'), { status: 401 });
  }
  const email = String(data.email || '').toLowerCase();
  if (!email) throw Object.assign(new Error('Google account has no email.'), { status: 401 });
  return {
    email,
    name: String(data.name || email.split('@')[0]),
    googleId: String(data.sub || ''),
    avatar: data.picture || null,
  };
}

/** Verify a Firebase Auth ID token via Identity Toolkit; fall back to Google GIS tokeninfo. */
async function verifyFirebaseIdToken(idToken) {
  const apiKey = firebaseApiKey();
  if (!apiKey) {
    throw Object.assign(new Error('Firebase API key is not configured on the server.'), { status: 503 });
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    const account = data.users?.[0];
    if (!account) throw Object.assign(new Error('Invalid Google / Firebase token.'), { status: 401 });

    const projectId = firebaseProjectId();
    if (projectId && account.tenantId && account.tenantId !== projectId) {
      throw Object.assign(new Error('Token project mismatch.'), { status: 401 });
    }

    const email = String(account.email || '').toLowerCase();
    if (!email) throw Object.assign(new Error('Google account has no email.'), { status: 401 });

    const googleProvider = (account.providerUserInfo || []).find((item) => item.providerId === 'google.com');
    return {
      email,
      name: String(account.displayName || googleProvider?.displayName || email.split('@')[0]),
      googleId: String(googleProvider?.rawId || account.localId || ''),
      avatar: account.photoUrl || googleProvider?.photoUrl || null,
    };
  }

  // Mobile bridge historically passed the raw Google GIS JWT — accept it too.
  const message = data?.error?.message || '';
  if (message === 'INVALID_ID_TOKEN' || res.status === 400) {
    return verifyGoogleIdToken(idToken);
  }
  throw Object.assign(new Error(message === 'INVALID_ID_TOKEN' ? 'Invalid Google / Firebase token.' : message || 'Invalid Google / Firebase token.'), {
    status: 401,
  });
}

async function upsertGoogleProfile(profile) {
  let row = profile.googleId ? findUserByGoogleId(profile.googleId) : null;
  if (!row) row = findUserByEmail(profile.email);
  if (row && profile.googleId && !row.googleId) linkGoogle(row.id, profile.googleId, profile.avatar);
  if (!row) {
    const created = createUser({
      email: profile.email,
      name: profile.name,
      googleId: profile.googleId || null,
      avatar: profile.avatar,
    });
    row = getUserRow(created.id);
  }
  return row;
}

async function currentUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[COOKIE];
  if (!token) return null;
  const session = findSession(hashToken(token));
  if (!session) return null;
  const user = getUserRow(session.userId);
  return user ? { user, token } : null;
}

function issueSession(res, userId) {
  const token = randomBytes(32).toString('hex');
  createSession(userId, hashToken(token));
  return sessionCookie(token);
}

/**
 * Connect-style middleware for Vite + Node http server.
 * Returns true if the request was handled.
 */
export async function handleAuthApi(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  if (!url.pathname.startsWith('/api/auth') && !url.pathname.startsWith('/api/meetings') && url.pathname !== '/api/config') {
    return false;
  }

  try {
    if (url.pathname === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, {
        google: googleConfigured() || Boolean(firebaseProjectId()),
        firebase: Boolean(firebaseProjectId()),
        appName: 'LetsConnect',
        pricing: {
          free: true,
          hook: 'Free while we grow — Pro & Teams coming soon.',
        },
      });
      return true;
    }

    if (url.pathname === '/api/auth/firebase' && req.method === 'POST') {
      const body = await readBody(req);
      const idToken = String(body.idToken || '');
      if (!idToken) {
        sendJson(res, 400, { error: 'Missing Firebase ID token.' });
        return true;
      }
      const profile = await verifyFirebaseIdToken(idToken);
      const row = await upsertGoogleProfile(profile);
      const cookie = issueSession(res, row.id);
      sendJson(res, 200, { user: publicUser(row) }, { 'Set-Cookie': cookie });
      return true;
    }

    // Chrome Custom Tab → short code → Capacitor app (avoids huge JWTs in deep links).
    if (url.pathname === '/api/auth/firebase/handoff' && req.method === 'POST') {
      const body = await readBody(req);
      const idToken = String(body.idToken || '');
      if (!idToken) {
        sendJson(res, 400, { error: 'Missing Google / Firebase token.' });
        return true;
      }
      // Validate now so a bad token never becomes a handoff code.
      await verifyFirebaseIdToken(idToken);
      pruneHandoffs();
      const code = randomBytes(24).toString('hex');
      handoffs.set(code, { idToken, expiresAt: Date.now() + HANDOFF_TTL_MS });
      sendJson(res, 200, { code, expiresIn: Math.floor(HANDOFF_TTL_MS / 1000) });
      return true;
    }

    if (url.pathname === '/api/auth/firebase/claim' && req.method === 'POST') {
      const body = await readBody(req);
      const code = String(body.code || '');
      pruneHandoffs();
      const entry = handoffs.get(code);
      if (!entry) {
        sendJson(res, 401, { error: 'Google sign-in expired. Try again.' });
        return true;
      }
      handoffs.delete(code);
      const profile = await verifyFirebaseIdToken(entry.idToken);
      const row = await upsertGoogleProfile(profile);
      const cookie = issueSession(res, row.id);
      sendJson(res, 200, { user: publicUser(row) }, { 'Set-Cookie': cookie });
      return true;
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const session = await currentUser(req);
      sendJson(res, 200, { user: session ? publicUser(session.user) : null });
      return true;
    }

    if (url.pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      const name = String(body.name || '').trim();
      if (!email.includes('@') || password.length < 8) {
        sendJson(res, 400, { error: 'Use a valid email and a password with at least 8 characters.' });
        return true;
      }
      const user = createUser({ email, name, passwordHash: hashPassword(password) });
      const cookie = issueSession(res, user.id);
      sendJson(res, 201, { user }, { 'Set-Cookie': cookie });
      return true;
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const email = String(body.email || '').trim();
      const password = String(body.password || '');
      const row = findUserByEmail(email);
      if (!row?.passwordHash || !verifyPassword(password, row.passwordHash)) {
        sendJson(res, 401, { error: 'Email or password is incorrect.' });
        return true;
      }
      const cookie = issueSession(res, row.id);
      sendJson(res, 200, { user: publicUser(row) }, { 'Set-Cookie': cookie });
      return true;
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      const session = await currentUser(req);
      if (session) deleteSession(hashToken(session.token));
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
      return true;
    }

    if (url.pathname === '/api/auth/profile' && req.method === 'PATCH') {
      const session = await currentUser(req);
      if (!session) {
        sendJson(res, 401, { error: 'Sign in required.' });
        return true;
      }
      const body = await readBody(req);
      const user = updateUserProfile(session.user.id, { name: body.name });
      sendJson(res, 200, { user });
      return true;
    }

    if (url.pathname === '/api/auth/google' && req.method === 'GET') {
      if (!googleConfigured()) {
        sendJson(res, 503, { error: 'Google sign-in is not configured on this server yet.' });
        return true;
      }
      const state = randomBytes(16).toString('hex');
      const redirectUri = `${appOrigin(req)}/api/auth/google/callback`;
      const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'online',
        prompt: 'select_account',
        state,
      });
      res.writeHead(302, {
        Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
        'Set-Cookie': `lc_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      });
      res.end();
      return true;
    }

    if (url.pathname === '/api/auth/google/callback' && req.method === 'GET') {
      if (!googleConfigured()) {
        res.writeHead(302, { Location: '/?auth=google_off' });
        res.end();
        return true;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const cookies = parseCookies(req.headers.cookie || '');
      if (!code || !state || state !== cookies.lc_oauth_state) {
        res.writeHead(302, { Location: '/login?error=google_state' });
        res.end();
        return true;
      }
      const redirectUri = `${appOrigin(req)}/api/auth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        res.writeHead(302, { Location: '/login?error=google_token' });
        res.end();
        return true;
      }
      const tokens = await tokenRes.json();
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!profileRes.ok) {
        res.writeHead(302, { Location: '/login?error=google_profile' });
        res.end();
        return true;
      }
      const profile = await profileRes.json();
      const email = String(profile.email || '').toLowerCase();
      const googleId = String(profile.sub || '');
      const name = String(profile.name || email.split('@')[0]);
      const avatar = profile.picture || null;
      let row = findUserByGoogleId(googleId) || (email ? findUserByEmail(email) : null);
      if (row && !row.googleId) linkGoogle(row.id, googleId, avatar);
      if (!row) {
        try {
          const created = createUser({ email, name, googleId, avatar });
          row = getUserRow(created.id);
        } catch (err) {
          if (err.status === 409) row = findUserByEmail(email);
          else throw err;
        }
      }
      const cookie = issueSession(res, row.id);
      res.writeHead(302, {
        Location: '/app',
        'Set-Cookie': [cookie, 'lc_oauth_state=; Path=/; Max-Age=0'],
      });
      res.end();
      return true;
    }

    if (url.pathname === '/api/meetings' && req.method === 'GET') {
      const session = await currentUser(req);
      if (!session) {
        sendJson(res, 401, { error: 'Sign in required.' });
        return true;
      }
      sendJson(res, 200, { meetings: listMeetings(session.user.id) });
      return true;
    }

    if (url.pathname === '/api/meetings' && req.method === 'POST') {
      const session = await currentUser(req);
      if (!session) {
        sendJson(res, 401, { error: 'Sign in required.' });
        return true;
      }
      const body = await readBody(req);
      const meeting = upsertMeeting(session.user.id, body);
      sendJson(res, 200, { meeting });
      return true;
    }

    if (url.pathname.startsWith('/api/meetings/') && req.method === 'DELETE') {
      const session = await currentUser(req);
      if (!session) {
        sendJson(res, 401, { error: 'Sign in required.' });
        return true;
      }
      const id = url.pathname.split('/').pop();
      deleteMeeting(session.user.id, id);
      sendJson(res, 200, { ok: true });
      return true;
    }

    sendJson(res, 404, { error: 'Not found' });
    return true;
  } catch (err) {
    const status = err.status || 500;
    sendJson(res, status, { error: err.message || 'Server error' });
    return true;
  }
}

export function authMiddleware() {
  return async (req, res, next) => {
    const handled = await handleAuthApi(req, res);
    if (!handled) next();
  };
}
