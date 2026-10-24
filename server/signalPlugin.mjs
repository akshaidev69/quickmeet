import { WebSocketServer } from 'ws';

let attachedServer = null;

export function signalPlugin() {
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

  function attach(httpServer) {
    if (!httpServer || attachedServer === httpServer) return;
    attachedServer = httpServer;
    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req, socket, head) => {
      const path = (req.url || '').split('?')[0];
      if (path !== '/signal') return;
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

    const ping = setInterval(() => {
      for (const map of rooms.values()) {
        for (const sock of map.values()) {
          if (sock.readyState === 1) sock.ping();
        }
      }
    }, 20000);
    httpServer.on('close', () => clearInterval(ping));
  }

  return {
    name: 'quickmeet-signal',
    configureServer(server) {
      attach(server.httpServer);
    },
    configurePreviewServer(server) {
      attach(server.httpServer);
    },
  };
}
