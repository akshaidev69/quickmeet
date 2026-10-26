import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'lc_session';
const SESSION_DAYS = 30;

function secret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.FIREBASE_API_KEY ||
    process.env.VITE_FIREBASE_API_KEY ||
    'letsconnect-dev-session-secret-change-me'
  );
}

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

function sign(payloadB64) {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/** Signed JWT-like session (HMAC). Survives process restarts without a session table. */
export function issueJwt(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    iat: now,
    exp: now + SESSION_DAYS * 24 * 60 * 60,
  };
  const body = b64urlJson(payload);
  const sig = sign(body);
  return `${body}.${sig}`;
}

export function verifyJwt(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const json = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!json?.sub || !json.exp || json.exp * 1000 < Date.now()) return null;
    return json;
  } catch {
    return null;
  }
}

export function sessionCookie(token, maxAgeSec = SESSION_DAYS * 24 * 60 * 60) {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function clearSessionCookie() {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export { COOKIE };
