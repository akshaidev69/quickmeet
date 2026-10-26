import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSignal, roomIsLive } from './signalCore.mjs';
import { handleAuthApi } from './authApi.mjs';
import { proxyFirebaseAuth } from './authHandlerProxy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const port = Number(process.env.PORT) || 4173;

const SPA_ROUTES = new Set([
  '/',
  '/app',
  '/login',
  '/register',
  '/signup',
  '/auth/google-bridge',
]);

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.txt': 'text/plain; charset=utf-8',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.map': 'application/json; charset=utf-8',
    }[ext] || 'application/octet-stream'
  );
}

function sendFile(res, filePath, status = 200) {
  const data = fs.readFileSync(filePath);
  res.writeHead(status, {
    'Content-Type': contentType(filePath),
    'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(data);
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function send404Page(res) {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Page not found · LetsConnect</title>
<style>
  body{margin:0;min-height:100dvh;display:grid;place-items:center;font-family:Sora,Segoe UI,system-ui,sans-serif;background:#f3f5f7;color:#10241c}
  main{text-align:center;padding:32px}
  h1{font-family:Fraunces,Georgia,serif;font-size:2rem;margin:0 0 8px}
  p{color:#5f6368;margin:0 0 20px}
  a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:0 18px;border-radius:999px;background:#0b7a56;color:#fff;text-decoration:none;font-weight:700}
</style>
</head>
<body>
<main>
  <h1>Page not found</h1>
  <p>That LetsConnect link does not exist.</p>
  <a href="/">Back to LetsConnect</a>
</main>
</body>
</html>`;
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

function isSpaPath(pathname) {
  if (SPA_ROUTES.has(pathname)) return true;
  if (pathname.startsWith('/app')) return true;
  if (pathname.startsWith('/auth/')) return true;
  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    if (await handleAuthApi(req, res)) return;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname.replace(/\/+$/, '') || '/');

    if (await proxyFirebaseAuth(req, res, url.pathname, url.search || '')) return;

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { status: 'ok', app: 'LetsConnect' });
      return;
    }

    if (pathname === '/api/network' && req.method === 'GET') {
      sendJson(res, 200, { https: true, port, addresses: [], urls: [] });
      return;
    }

    if (pathname.startsWith('/api/rooms/') && req.method === 'GET') {
      const code = pathname.slice('/api/rooms/'.length).toLowerCase();
      if (!roomIsLive(code)) {
        sendJson(res, 404, { error: 'Meeting not found.' });
        return;
      }
      sendJson(res, 200, { code, live: true });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    if (pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
      res.end('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\nSitemap: /sitemap.xml\n');
      return;
    }

    let filePathName = pathname === '/' ? '/index.html' : pathname;
    const safe = path.normalize(filePathName).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(dist, safe);
    if (filePath.startsWith(dist) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }

    if (isSpaPath(pathname)) {
      const fallback = path.join(dist, 'index.html');
      if (fs.existsSync(fallback)) {
        sendFile(res, fallback);
        return;
      }
    }

    send404Page(res);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
});

attachSignal(server);

server.listen(port, '0.0.0.0', () => {
  console.log(`LetsConnect listening on ${port}`);
});
