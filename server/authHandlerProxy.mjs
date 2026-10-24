const FIREBASE_AUTH_ORIGIN = 'https://letsconnect-e8c03.firebaseapp.com';

/**
 * Proxy Firebase Auth handler pages onto this host so Google shows
 * "continue to quickmeet-….onrender.com" instead of *.firebaseapp.com.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {string} search
 */
export async function proxyFirebaseAuth(req, res, pathname, search = '') {
  if (!pathname.startsWith('/__/auth')) return false;

  const target = `${FIREBASE_AUTH_ORIGIN}${pathname}${search || ''}`;
  try {
    const headers = new Headers();
    const allow = ['accept', 'accept-language', 'content-type', 'user-agent'];
    for (const key of allow) {
      const value = req.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    const method = req.method || 'GET';
    /** @type {RequestInit} */
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      init.body = Buffer.concat(chunks);
    }
    const upstream = await fetch(target, init);
    const outHeaders = {
      'Content-Type': upstream.headers.get('content-type') || 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    };
    const location = upstream.headers.get('location');
    if (location) outHeaders.Location = location;
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, outHeaders);
    res.end(buffer);
  } catch {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Auth helper unavailable');
  }
  return true;
}
