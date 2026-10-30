import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashPassword, verifyPassword } from './passwords.mjs';

export const ADMIN_COOKIE = 'lc_admin';
const SESSION_HOURS = 12;
const BOOTSTRAP_USERNAME = 'Codeisnumber';
const BOOTSTRAP_PASSWORD = 'Code@#1998*';

function secret() {
  return `${process.env.SESSION_SECRET || process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || 'letsconnect-dev-session-secret-change-me'}:admin`;
}

export function adminUsername() {
  return String(process.env.ADMIN_USERNAME || BOOTSTRAP_USERNAME).trim();
}

let cachedHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim();
/** @type {Promise<string> | null} */
let hashReady = null;

export function adminPasswordHash() {
  if (cachedHash) return Promise.resolve(cachedHash);
  if (!hashReady) {
    hashReady = hashPassword(process.env.ADMIN_PASSWORD || BOOTSTRAP_PASSWORD).then((value) => {
      cachedHash = value;
      return value;
    });
  }
  return hashReady;
}

export function sameText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function sign(payloadB64) {
  return createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

export function issueAdminJwt(username) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ role: 'admin', username, iat: now, exp: now + SESSION_HOURS * 3600 })).toString(
    'base64url',
  );
  return `${payload}.${sign(payload)}`;
}

export function verifyAdminJwt(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = String(token).split('.');
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
    const json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (json?.role !== 'admin' || !json.username || !json.exp || json.exp * 1000 < Date.now()) return null;
    if (!sameText(json.username, adminUsername())) return null;
    return json;
  } catch {
    return null;
  }
}

function cookieFlags() {
  const secure = process.env.NODE_ENV === 'production' || process.env.RENDER ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax${secure}`;
}

export function adminCookie(token) {
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags()}; Max-Age=${SESSION_HOURS * 3600}`;
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE}=; ${cookieFlags()}; Max-Age=0`;
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function adminFromCookieHeader(header = '') {
  const token = parseCookies(header)[ADMIN_COOKIE];
  return verifyAdminJwt(token);
}

export { verifyPassword, SESSION_HOURS };
