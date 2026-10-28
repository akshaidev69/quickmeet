import { WebSocketServer } from 'ws';
import {
  endOpenMeetingsByCode,
  endOpenMeetingsByCodeIfOlderThan,
  listOpenMeetingCodes,
} from './db.mjs';

/** @type {import('http').Server | null} */
let attachedServer = null;

/** @type {Map<string, Map<string, { ws: import('ws').WebSocket, name: string, admitted: boolean }>>} */
const rooms = new Map();
/** @type {Map<string, string>} */
const hosts = new Map();
/** @type {Map<string, Set<string>>} */
const admittedMemory = new Map();
/** @type {Map<string, Set<string>>} */
const coHosts = new Map();
/** @type {Map<string, number>} */
const roomLastActivity = new Map();

const STALE_OPEN_MEETING_MS = 30 * 60 * 1000;
let staleMeetingSweepStarted = false;

function touchRoomActivity(room) {
  roomLastActivity.set(room, Date.now());
}

function startStaleMeetingSweep() {
  if (staleMeetingSweepStarted) return;
  staleMeetingSweepStarted = true;
  setInterval(() => {
    const now = Date.now();
    for (const code of listOpenMeetingCodes()) {
      if (roomIsLive(code)) {
        touchRoomActivity(code);
        continue;
      }
      const last = roomLastActivity.get(code);
      if (last && now - last > 2 * 60 * 60 * 1000) {
        endOpenMeetingsByCode(code);
        roomLastActivity.delete(code);
        continue;
      }
      endOpenMeetingsByCodeIfOlderThan(code, STALE_OPEN_MEETING_MS);
    }
  }, 60_000);
}

/** True when a meeting code currently has at least one connected peer (usually the host). */
export function roomIsLive(code) {
  const key = String(code || '').trim().toLowerCase();
  if (!key) return false;
  const map = rooms.get(key);
  return Boolean(map && map.size > 0 && hosts.get(key));
}

/**
 * Shared WebSocket signaling: sticky host, co-hosts, waiting-room admit gate, peer relay.
 * @param {import('http').Server} httpServer
 */
export function attachSignal(httpServer) {
  if (!httpServer || attachedServer === httpServer) return;
  attachedServer = httpServer;
  const wss = new WebSocketServer({ noServer: true });

  function roomMap(room) {
    let map = rooms.get(room);
    if (!map) {
      map = new Map();
      rooms.set(room, map);
    }
    return map;
  }

  function memoryFor(room) {
    let set = admittedMemory.get(room);
    if (!set) {
      set = new Set();
      admittedMemory.set(room, set);
    }
    return set;
  }

  function cohostFor(room) {
    let set = coHosts.get(room);
    if (!set) {
      set = new Set();
      coHosts.set(room, set);
    }
    return set;
  }

  function stickyHost(room) {
    return hosts.get(room) || null;
  }

  function canModerate(room, peerId) {
    return stickyHost(room) === peerId || cohostFor(room).has(peerId);
  }

  function waitingList(map) {
    const people = [];
    for (const [id, member] of map) {
      if (!member.admitted) people.push({ id, name: member.name });
    }
    return people;
  }

  function coHostIds(room, map) {
    return [...cohostFor(room)].filter((id) => map.has(id) && map.get(id)?.admitted);
  }

  function sendWaiting(room, map) {
    const people = waitingList(map);
    const payload = JSON.stringify({ kind: 'waiting', people });
    const hostId = stickyHost(room);
    for (const [id, member] of map) {
      if (!member.admitted || member.ws.readyState !== 1) continue;
      if (id === hostId || cohostFor(room).has(id)) member.ws.send(payload);
    }
  }

  function wipeRoom(room) {
    endOpenMeetingsByCode(room);
    roomLastActivity.delete(room);
    hosts.delete(room);
    rooms.delete(room);
    admittedMemory.delete(room);
    coHosts.delete(room);
  }

  function cleanupEmpty(room) {
    const map = rooms.get(room);
    if (!map || map.size === 0) wipeRoom(room);
  }

  function sendMeta(room) {
    const map = rooms.get(room);
    if (!map || map.size === 0) {
      wipeRoom(room);
      return;
    }
    const hostId = stickyHost(room);
    if (!hostId) return;
    const payload = JSON.stringify({ kind: 'meta', hostId, coHostIds: coHostIds(room, map) });
    for (const member of map.values()) {
      if (member.admitted && member.ws.readyState === 1) member.ws.send(payload);
    }
    sendWaiting(room, map);
  }

  function transferHost(room, map, leavingId) {
    if (stickyHost(room) !== leavingId) return stickyHost(room);
    cohostFor(room).delete(leavingId);
    let next = null;
    for (const [id, member] of map) {
      if (member.admitted && cohostFor(room).has(id)) {
        next = id;
        break;
      }
    }
    if (!next) {
      for (const [id, member] of map) {
        if (member.admitted) {
          next = id;
          break;
        }
      }
    }
    if (!next) {
      for (const [id, member] of map) {
        next = id;
        member.admitted = true;
        memoryFor(room).add(id);
        if (member.ws.readyState === 1) {
          member.ws.send(JSON.stringify({ kind: 'gate', state: 'admitted', hostId: id }));
        }
        break;
      }
    }
    if (next) {
      hosts.set(room, next);
      cohostFor(room).delete(next);
    } else hosts.delete(room);
    return next;
  }

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
        const name = String(msg.name || 'Guest').trim().slice(0, 40) || 'Guest';
        if (!room || !peerId) return;
        touchRoomActivity(room);
        const map = roomMap(room);
        const previous = map.get(peerId);
        if (previous && previous.ws !== ws) {
          try {
            previous.ws.close();
          } catch {
            /* already closing */
          }
        }

        const memory = memoryFor(room);
        const claimHost = Boolean(msg.claimHost);
        let hostId = stickyHost(room);
        const hostMember = hostId ? map.get(hostId) : null;
        const hostAlive =
          Boolean(hostId) &&
          hostId !== peerId &&
          Boolean(hostMember) &&
          hostMember.ws !== ws &&
          hostMember.ws.readyState === 1;

        if (!hostId) {
          hostId = peerId;
          hosts.set(room, peerId);
        } else if (!hostAlive && (claimHost || peerId === hostId || memory.has(peerId))) {
          // Sticky host offline — creator / returning host takes the seat.
          hostId = peerId;
          hosts.set(room, peerId);
        }

        const admitted = peerId === hostId || memory.has(peerId);
        const member = { ws, name, admitted };
        map.set(peerId, member);
        if (admitted) memory.add(peerId);

        if (member.admitted) {
          ws.send(
            JSON.stringify({
              kind: 'gate',
              state: 'admitted',
              hostId,
              coHostIds: coHostIds(room, map),
            }),
          );
          sendMeta(room);
        } else {
          ws.send(JSON.stringify({ kind: 'gate', state: 'waiting', hostId }));
          sendWaiting(room, map);
        }
        return;
      }

      if (!room || !peerId) return;
      const map = rooms.get(room);
      if (!map) return;
      const self = map.get(peerId);
      if (!self || self.ws !== ws) return;

      if (msg.kind === 'cohost') {
        const hostId = stickyHost(room);
        if (hostId !== peerId || !self.admitted) return;
        const targetId = String(msg.peerId || '').slice(0, 80);
        if (!targetId || targetId === hostId) return;
        const target = map.get(targetId);
        if (!target || !target.admitted) return;
        if (msg.on) cohostFor(room).add(targetId);
        else cohostFor(room).delete(targetId);
        sendMeta(room);
        return;
      }

      if (msg.kind === 'admit' || msg.kind === 'deny' || msg.kind === 'eject') {
        if (!self.admitted || !canModerate(room, peerId)) return;
        const hostId = stickyHost(room);
        const targetId = String(msg.peerId || '').slice(0, 80);
        const target = map.get(targetId);
        if (!target) return;
        if (msg.kind === 'admit') {
          if (target.admitted) return;
          target.admitted = true;
          memoryFor(room).add(targetId);
          if (target.ws.readyState === 1) {
            target.ws.send(
              JSON.stringify({
                kind: 'gate',
                state: 'admitted',
                hostId,
                coHostIds: coHostIds(room, map),
              }),
            );
          }
          sendMeta(room);
          return;
        }
        // deny / eject — cannot remove the sticky host; co-host cannot remove other co-hosts
        if (targetId === hostId) return;
        if (msg.kind === 'eject' && stickyHost(room) !== peerId && cohostFor(room).has(targetId)) return;
        memoryFor(room).delete(targetId);
        cohostFor(room).delete(targetId);
        const wasAdmitted = target.admitted;
        if (target.ws.readyState === 1) {
          if (msg.kind === 'deny') {
            target.ws.send(JSON.stringify({ kind: 'gate', state: 'denied', hostId }));
          } else {
            target.ws.send(
              JSON.stringify({
                kind: 'signal',
                from: peerId,
                payload: { type: 'kick', from: peerId, to: targetId },
              }),
            );
          }
        }
        map.delete(targetId);
        setTimeout(() => {
          try {
            target.ws.close();
          } catch {
            /* ignore */
          }
        }, 250);
        if (msg.kind === 'eject' && wasAdmitted) {
          const notice = JSON.stringify({
            kind: 'signal',
            from: targetId,
            payload: { type: 'leave', from: targetId },
          });
          for (const member of map.values()) {
            if (member.admitted && member.ws.readyState === 1) member.ws.send(notice);
          }
          sendMeta(room);
        } else {
          sendWaiting(room, map);
          cleanupEmpty(room);
        }
        return;
      }

      if (msg.kind === 'rename') {
        self.name = String(msg.name || self.name).trim().slice(0, 40) || self.name;
        if (!self.admitted) sendWaiting(room, map);
        return;
      }

      if (msg.kind !== 'signal' || !self.admitted) return;
      const raw = JSON.stringify(msg);
      for (const [id, member] of map) {
        if (id !== peerId && member.admitted && member.ws.readyState === 1) member.ws.send(raw);
      }
      if (room) touchRoomActivity(room);
    });

    ws.on('close', () => {
      if (!room || !peerId) return;
      const map = rooms.get(room);
      if (!map) return;
      const self = map.get(peerId);
      if (!self || self.ws !== ws) return;
      const wasAdmitted = self.admitted;
      const wasHost = stickyHost(room) === peerId;
      map.delete(peerId);
      cohostFor(room).delete(peerId);
      if (wasHost) transferHost(room, map, peerId);
      if (wasAdmitted) {
        const notice = JSON.stringify({
          kind: 'signal',
          from: peerId,
          payload: { type: 'leave', from: peerId },
        });
        for (const member of map.values()) {
          if (member.admitted && member.ws.readyState === 1) member.ws.send(notice);
        }
        sendMeta(room);
      } else {
        sendWaiting(room, map);
        cleanupEmpty(room);
      }
      cleanupEmpty(room);
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
      for (const member of map.values()) {
        if (member.ws.readyState === 1) member.ws.ping();
      }
    }
  }, 20000);
  httpServer.on('close', () => clearInterval(ping));
  startStaleMeetingSweep();
}
