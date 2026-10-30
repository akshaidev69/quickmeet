/**
 * Shared production HTTP helpers: security headers, CORS, rate limits, body cap.
 */
const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX = 20;
const JOIN_MAX = 40;
const ADMIN_MAX = 8;
const buckets = new Map();

export function clientKey(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

function allowOrigin(req) {
  const origin = String(req.headers.origin || '');
  const app = (process.env.APP_URL || '').replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || (process.env.RENDER ? 'https' : 'http');
  const self = `${proto}://${host}`;
  if (!origin) return self;
  if (app && origin === app) return origin;
  if (origin === self) return origin;
  if (/^https:\/\/([a-z0-9-]+\.)?onrender\.com$/i.test(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return '';
}

export function securityHeaders(req, extra = {}) {
  const origin = allowOrigin(req);
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-DNS-Prefetch-Control': 'off',
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    ...(process.env.RENDER || process.env.NODE_ENV === 'production'
      ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }
      : {}),
    ...(origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Credentials': 'true',
          Vary: 'Origin',
        }
      : {}),
    ...extra,
  };
}

export function rateLimit(req, kind = 'auth') {
  const max = kind === 'admin' ? ADMIN_MAX : kind === 'join' ? JOIN_MAX : AUTH_MAX;
  const key = `${kind}:${clientKey(req)}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > AUTH_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > max) {
    return { ok: false, retryAfter: Math.ceil((bucket.start + AUTH_WINDOW_MS - now) / 1000) };
  }
  return { ok: true };
}

export function readBodyCapped(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Request too large.'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
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

export function iceServersFromEnv() {
  const stun = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478',
      ],
    },
  ];
  const urls = String(process.env.TURN_URLS || process.env.VITE_TURN_URLS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const username = String(process.env.TURN_USERNAME || process.env.VITE_TURN_USERNAME || '');
  const credential = String(process.env.TURN_CREDENTIAL || process.env.VITE_TURN_CREDENTIAL || '');
  if (urls.length && username && credential) {
    return [...stun, { urls, username, credential }];
  }
  return stun;
}

export const BUILD_VERSION =
  process.env.RENDER_GIT_COMMIT?.slice(0, 7) ||
  process.env.VITE_BUILD_VERSION ||
  `local-${new Date().toISOString().slice(0, 10)}`;
