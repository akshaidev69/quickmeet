const FIREBASE_AUTH_ORIGIN = 'https://letsconnect-e8c03.firebaseapp.com';
const FIREBASE_HOST = 'letsconnect-e8c03.firebaseapp.com';

/**
 * Proxy Firebase Auth handler pages onto this host so Google shows
 * our site instead of *.firebaseapp.com.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} pathname
 * @param {string} search
 */
export async function proxyFirebaseAuth(req, res, pathname, search = '') {
  if (!pathname.startsWith('/__/auth') && pathname !== '/__/firebase/init.json') return false;

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const publicOrigin = host ? `${proto}://${host}` : '';

  const target = `${FIREBASE_AUTH_ORIGIN}${pathname}${search || ''}`;
  try {
    const headers = new Headers();
    const allow = ['accept', 'accept-language', 'content-type', 'user-agent', 'cookie'];
    for (const key of allow) {
      const value = req.headers[key];
      if (typeof value === 'string') headers.set(key, value);
    }
    headers.set('host', FIREBASE_HOST);

    const method = req.method || 'GET';
    /** @type {RequestInit} */
    const init = { method, headers, redirect: 'manual' };
    if (method !== 'GET' && method !== 'HEAD') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      init.body = Buffer.concat(chunks);
    }

    const upstream = await fetch(target, init);
    const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    /** @type {Record<string, string | string[]>} */
    const outHeaders = {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    };

    const location = upstream.headers.get('location');
    if (location && publicOrigin) {
      outHeaders.Location = location.split(FIREBASE_AUTH_ORIGIN).join(publicOrigin);
    }

    const setCookie = upstream.headers.getSetCookie?.() || [];
    if (setCookie.length && publicOrigin) {
      outHeaders['Set-Cookie'] = setCookie.map((cookie) =>
        cookie
          .replace(/Domain=[^;]+/gi, `Domain=${host.replace(/:\d+$/, '')}`)
          .replace(FIREBASE_HOST, host.replace(/:\d+$/, '')),
      );
    }

    let body = Buffer.from(await upstream.arrayBuffer());
    if (publicOrigin && /text\/html|javascript|json/i.test(contentType)) {
      const text = body
        .toString('utf8')
        .split(FIREBASE_AUTH_ORIGIN)
        .join(publicOrigin)
        .split(FIREBASE_HOST)
        .join(host.replace(/:\d+$/, ''));
      body = Buffer.from(text, 'utf8');
    }

    res.writeHead(upstream.status, outHeaders);
    res.end(body);
  } catch {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Auth helper unavailable');
  }
  return true;
}
