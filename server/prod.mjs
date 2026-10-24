import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachSignal } from './signalCore.mjs';
import { handleAuthApi } from './authApi.mjs';
import { proxyFirebaseAuth } from './authHandlerProxy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const port = Number(process.env.PORT) || 4173;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.map': 'application/json',
    }[ext] || 'application/octet-stream'
  );
}

function sendFile(res, filePath) {
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': contentType(filePath),
    'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (await handleAuthApi(req, res)) return;

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (await proxyFirebaseAuth(req, res, url.pathname, url.search)) return;
    if (url.pathname === '/api/network') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ https: true, port, addresses: [], urls: [] }));
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/') pathname = '/index.html';
    const safe = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(dist, safe);
    if (filePath.startsWith(dist) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      sendFile(res, filePath);
      return;
    }
    const fallback = path.join(dist, 'index.html');
    if (fs.existsSync(fallback)) {
      sendFile(res, fallback);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

attachSignal(server);

server.listen(port, '0.0.0.0', () => {
  console.log(`LetsConnect listening on ${port}`);
});
