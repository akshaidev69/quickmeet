import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(__dirname, '..', 'dist');
const port = Number(process.env.PORT) || 4173;

/** @type {Map<string, Map<string, import('ws').WebSocket>>} */
const rooms = new Map();
/** @type {Map<string, string>} */
const hosts = new Map();

function roomMap(room) {
  let map = rooms.get(room);
  if (!map) {
    map = new Map();
    rooms.set(room, map);
  }
  return map;
}

function sendMeta(room) {
  const map = rooms.get(room);
  if (!map || map.size === 0) {
    hosts.delete(room);
    rooms.delete(room);
    return;
  }
  let hostId = hosts.get(room);
  if (!hostId || !map.has(hostId)) {
    hostId = map.keys().next().value;
    hosts.set(room, hostId);
  }
  const payload = JSON.stringify({ kind: 'meta', hostId });
  for (const sock of map.values()) {
    if (sock.readyState === 1) sock.send(payload);
  }
}

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

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
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

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const pathName = (req.url || '').split('?')[0];
  if (pathName !== '/signal') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  let room = '';
  let peerId = '';

  ws.on('message', (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (msg.kind === 'join') {
      room = String(msg.room || '').slice(0, 40);
      peerId = String(msg.from || '').slice(0, 80);
      if (!room || !peerId) return;
      const map = roomMap(room);
      const previous = map.get(peerId);
      map.set(peerId, ws);
      if (previous && previous !== ws) {
        try {
          previous.close();
        } catch {
          /* already closing */
        }
      }
      sendMeta(room);
      return;
    }
    if (msg.kind !== 'signal' || !room || !peerId) return;
    const map = rooms.get(room);
    if (!map) return;
    const raw = JSON.stringify(msg);
    for (const [id, sock] of map) {
      if (id !== peerId && sock.readyState === 1) sock.send(raw);
    }
  });

  ws.on('close', () => {
    if (!room || !peerId) return;
    const map = rooms.get(room);
    if (!map || map.get(peerId) !== ws) return;
    map.delete(peerId);
    const notice = JSON.stringify({
      kind: 'signal',
      from: peerId,
      payload: { type: 'leave', from: peerId },
    });
    for (const sock of map.values()) {
      if (sock.readyState === 1) sock.send(notice);
    }
    sendMeta(room);
  });

  ws.on('error', () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  });
});

setInterval(() => {
  for (const map of rooms.values()) {
    for (const sock of map.values()) {
      if (sock.readyState === 1) sock.ping();
    }
  }
}, 20000);

server.listen(port, '0.0.0.0', () => {
  console.log(`QuickMeet listening on ${port}`);
});
