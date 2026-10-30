import { WebSocketServer } from 'ws';
import {
  endOpenMeetingsByCode,
  endOpenMeetingsByCodeIfOlderThan,
  listOpenMeetingCodes,
} from './db.mjs';
import { recordEvent } from './adminStore.mjs';
import { adminFromCookieHeader } from './adminSession.mjs';

const HIDDEN_RELAY_TYPES = new Set(['hello', 'description', 'ice']);

/** @type {Map<string, boolean>} */
const shareFlags = new Map();

/** @type {import('http').Server | null} */
let attachedServer = null;

/** @type {Map<string, Map<string, { ws: import('ws').WebSocket, name: string, admitted: boolean, hidden?: boolean, leaveTimer?: ReturnType<typeof setTimeout> | null }>>} */
const rooms = new Map();
/** @type {Map<string, string>} */
const hosts = new Map();
/** @type {Map<string, Set<string>>} */
const admittedMemory = new Map();
/** @type {Map<string, Set<string>>} */
const coHosts = new Map();
/** @type {Map<string, number>} */
const roomLastActivity = new Map();
/** @type {Map<string, boolean>} */
const roomLocked = new Map();
/** @type {Map<string, boolean>} */
const allowRejoin = new Map();
/** @type {Map<string, { hostOnly: boolean, clock: number, open: boolean, view?: { left: number, top: number, width: number, height: number } }>} */
const roomBoards = new Map();
const BOARD_TEACH_TYPES = new Set(['board-op', 'board-live', 'board-view', 'board-sync']);
const SIGNAL_MAX_BYTES = 1_500_000;
const HOST_SIGNAL_TYPES = new Set(['end-meeting', 'meeting-lock', 'kick', 'moderate', 'cast']);

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

export function listLiveRooms() {
  const out = [];
  for (const [code, map] of rooms) {
    const hostId = hosts.get(code) || null;
    const people = [];
    let participants = 0;
    let waiting = 0;
    let observers = 0;
    for (const [id, member] of map) {
      if (member.hidden) {
        observers += 1;
        continue;
      }
      const person = {
        id,
        name: member.name,
        admitted: Boolean(member.admitted),
        host: id === hostId,
        cohost: Boolean(coHosts.get(code)?.has(id)),
      };
      people.push(person);
      if (person.admitted) participants += 1;
      else waiting += 1;
    }
    out.push({
      code,
      hostId,
      locked: Boolean(roomLocked.get(code)),
      allowRejoin: allowRejoin.get(code) !== false,
      boardOpen: Boolean(roomBoards.get(code)?.open),
      lastActivity: roomLastActivity.get(code) || 0,
      participants,
      waiting,
      observers,
      people,
    });
  }
  return out.sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0));
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
      if (!member.admitted && !member.hidden) people.push({ id, name: member.name });
    }
    return people;
  }

  function coHostIds(room, map) {
    return [...cohostFor(room)].filter((id) => {
      const member = map.get(id);
      return member?.admitted && !member.hidden;
    });
  }

  function visibleCount(map) {
    let count = 0;
    for (const member of map.values()) {
      if (!member.hidden) count += 1;
    }
    return count;
  }

  function sendWaiting(room, map) {
    const people = waitingList(map);
    const payload = JSON.stringify({ kind: 'waiting', people });
    const hostId = stickyHost(room);
    for (const [id, member] of map) {
      if (!member.admitted || member.ws.readyState !== 1) continue;
      if (id === hostId || cohostFor(room).has(id) || member.hidden) member.ws.send(payload);
    }
  }

  function wipeRoom(room) {
    endOpenMeetingsByCode(room);
    roomLastActivity.delete(room);
    hosts.delete(room);
    rooms.delete(room);
    admittedMemory.delete(room);
    coHosts.delete(room);
    roomLocked.delete(room);
    allowRejoin.delete(room);
    roomBoards.delete(room);
    for (const key of [...shareFlags.keys()]) {
      if (key.startsWith(`${room}:`)) shareFlags.delete(key);
    }
  }

  function mergeBoardMeta(current, incoming) {
    const nextClock = Number(incoming?.clock) || 0;
    const prevClock = Number(current?.clock) || 0;
    if (nextClock < prevClock) return current;
    return {
      clock: Math.max(prevClock, nextClock),
      hostOnly: true,
      open: typeof incoming?.open === 'boolean' ? incoming.open : Boolean(current?.open),
      view: incoming?.view && typeof incoming.view === 'object' ? incoming.view : current?.view,
    };
  }

  function saveBoardMeta(room, incoming) {
    const current = roomBoards.get(room) || { hostOnly: false, clock: 0, open: false };
    const next = mergeBoardMeta(current, incoming || {});
    roomBoards.set(room, next);
    return next;
  }

  function pushBoardMeta(room, map, meta, fromId) {
    if (!meta) return;
    const raw = JSON.stringify({
      kind: 'signal',
      from: fromId || 'room',
      payload: { type: 'board-meta', from: fromId || 'room', meta },
    });
    for (const member of map.values()) {
      if (member.admitted && member.ws.readyState === 1) member.ws.send(raw);
    }
  }

  function sendBoardToPeer(ws, meta, fromId) {
    if (!meta || !ws || ws.readyState !== 1) return;
    ws.send(
      JSON.stringify({
        kind: 'signal',
        from: fromId || 'room',
        payload: { type: 'board-meta', from: fromId || 'room', meta },
      }),
    );
  }

  function cleanupEmpty(room) {
    const map = rooms.get(room);
    if (!map || visibleCount(map) === 0) wipeRoom(room);
  }

  function sendMeta(room) {
    const map = rooms.get(room);
    if (!map || visibleCount(map) === 0) {
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
      if (member.admitted && !member.hidden && cohostFor(room).has(id)) {
        next = id;
        break;
      }
    }
    if (!next) {
      for (const [id, member] of map) {
        if (member.admitted && !member.hidden) {
          next = id;
          break;
        }
      }
    }
    if (!next) {
      for (const [id, member] of map) {
        if (member.hidden) continue;
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

  wss.on('connection', (ws, req) => {
    let room = '';
    let peerId = '';
    const admin = adminFromCookieHeader(req?.headers?.cookie || '');

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
        if (previous?.leaveTimer) {
          clearTimeout(previous.leaveTimer);
          previous.leaveTimer = null;
        }
        if (previous && previous.ws !== ws) {
          try {
            previous.ws.close();
          } catch {
            /* already closing */
          }
        }

        const memory = memoryFor(room);
        const claimHost = Boolean(msg.claimHost);
        const hidden = Boolean(msg.observer) && Boolean(admin);
        if (msg.observer && !admin) {
          ws.send(JSON.stringify({ kind: 'gate', state: 'denied', reason: 'admin' }));
          return;
        }
        const previouslyAdmitted = !hidden && (memory.has(peerId) || Boolean(previous?.admitted));
        let hostId = stickyHost(room);
        const hostMember = hostId ? map.get(hostId) : null;
        const hostAlive =
          Boolean(hostId) &&
          hostId !== peerId &&
          Boolean(hostMember) &&
          !hostMember.hidden &&
          hostMember.ws !== ws &&
          hostMember.ws.readyState === 1;

        if (!hidden) {
          if (!hostId) {
            hostId = peerId;
            hosts.set(room, peerId);
          } else if (!hostAlive && (claimHost || peerId === hostId)) {
            hostId = peerId;
            hosts.set(room, peerId);
          }
        }

        if (!hidden && roomLocked.get(room) && peerId !== hostId && !previouslyAdmitted) {
          recordEvent({ type: 'room.denied', room, name, detail: 'locked' });
          ws.send(JSON.stringify({ kind: 'gate', state: 'denied', hostId, reason: 'locked' }));
          return;
        }

        const admitted = hidden || peerId === hostId || previouslyAdmitted;
        const member = { ws, name, admitted, hidden, leaveTimer: null };
        map.set(peerId, member);
        if (admitted && !hidden) memory.add(peerId);
        recordEvent({
          type: hidden ? 'admin.watch' : admitted ? (peerId === hostId ? 'room.host' : 'room.join') : 'room.waiting',
          room,
          name: hidden ? admin.username : name,
          detail: hidden ? 'silent' : previouslyAdmitted ? 'rejoin' : claimHost ? 'claim-host' : null,
        });

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
          sendBoardToPeer(ws, roomBoards.get(room), 'room');
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

      if (self.hidden && msg.kind !== 'signal') return;

      if (msg.kind === 'cohost') {
        const hostId = stickyHost(room);
        if (hostId !== peerId || !self.admitted || self.hidden) return;
        const targetId = String(msg.peerId || '').slice(0, 80);
        if (!targetId || targetId === hostId) return;
        const target = map.get(targetId);
        if (!target || !target.admitted) return;
        if (msg.on) cohostFor(room).add(targetId);
        else cohostFor(room).delete(targetId);
        recordEvent({
          type: msg.on ? 'room.cohost_on' : 'room.cohost_off',
          room,
          name: target.name,
          detail: self.name,
        });
        sendMeta(room);
        return;
      }

      if (msg.kind === 'admit' || msg.kind === 'deny' || msg.kind === 'eject') {
        if (!self.admitted || !canModerate(room, peerId)) return;
        const hostId = stickyHost(room);
        const targetId = String(msg.peerId || '').slice(0, 80);
        const target = map.get(targetId);
        if (!target || target.hidden) return;
        if (msg.kind === 'admit') {
          if (target.admitted) return;
          target.admitted = true;
          memoryFor(room).add(targetId);
          recordEvent({ type: 'room.admit', room, name: target.name, detail: self.name });
          if (target.ws.readyState === 1) {
            target.ws.send(
              JSON.stringify({
                kind: 'gate',
                state: 'admitted',
                hostId,
                coHostIds: coHostIds(room, map),
              }),
            );
            sendBoardToPeer(target.ws, roomBoards.get(room), 'room');
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
        recordEvent({
          type: msg.kind === 'deny' ? 'room.deny' : 'room.kick',
          room,
          name: target.name,
          detail: self.name,
        });
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

      if (msg.kind === 'room-setting') {
        if (!self.admitted || !canModerate(room, peerId)) return;
        if (typeof msg.allowRejoin === 'boolean') allowRejoin.set(room, msg.allowRejoin);
        if (typeof msg.locked === 'boolean') {
          roomLocked.set(room, msg.locked);
          recordEvent({ type: msg.locked ? 'room.lock' : 'room.unlock', room, name: self.name });
        }
        const notice = JSON.stringify({
          kind: 'signal',
          from: peerId,
          payload: { type: 'meeting-lock', from: peerId, locked: Boolean(roomLocked.get(room)) },
        });
        for (const member of map.values()) {
          if (member.admitted && member.ws.readyState === 1) member.ws.send(notice);
        }
        return;
      }

      if (msg.kind === 'board') {
        if (!self.admitted || !canModerate(room, peerId)) return;
        const meta = saveBoardMeta(room, msg.meta);
        pushBoardMeta(room, map, meta, peerId);
        return;
      }

      if (msg.kind !== 'signal' || !self.admitted) return;
      const payload = msg.payload && typeof msg.payload === 'object' ? msg.payload : {};
      const type = String(payload.type || '');
      if (self.hidden) {
        if (!HIDDEN_RELAY_TYPES.has(type)) return;
        if (type === 'hello' && payload.peer && typeof payload.peer === 'object') {
          payload.peer.hidden = true;
          payload.peer.micOn = false;
          payload.peer.camOn = false;
          payload.peer.sharing = false;
          payload.peer.hand = false;
          payload.peer.recording = false;
        }
      }
      if (HOST_SIGNAL_TYPES.has(type) && !canModerate(room, peerId)) return;
      if (type === 'board-meta') {
        if (!canModerate(room, peerId)) return;
        const meta = saveBoardMeta(room, payload.meta);
        pushBoardMeta(room, map, meta, peerId);
        return;
      }
      if (type === 'board-view' && payload.view) {
        if (!canModerate(room, peerId)) return;
        const current = roomBoards.get(room) || { hostOnly: true, clock: 0, open: true };
        current.view = payload.view;
        current.hostOnly = true;
        roomBoards.set(room, current);
      }
      if (BOARD_TEACH_TYPES.has(type) && !canModerate(room, peerId)) return;
      if (type === 'meeting-lock') {
        roomLocked.set(room, Boolean(payload.locked));
      }
      if (type === 'end-meeting') {
        if (stickyHost(room) !== peerId) return;
        recordEvent({ type: 'room.end', room, name: self.name });
        const notice = JSON.stringify(msg);
        for (const [id, member] of map) {
          if (id !== peerId && member.ws.readyState === 1) member.ws.send(notice);
        }
        wipeRoom(room);
        return;
      }
      if (type === 'state' && payload.peer) {
        const sharing = Boolean(payload.peer.sharing);
        const key = `${room}:${peerId}`;
        const prev = shareFlags.get(key);
        if (prev !== sharing) {
          shareFlags.set(key, sharing);
          if (prev !== undefined || sharing) {
            recordEvent({ type: sharing ? 'room.share_start' : 'room.share_stop', room, name: self.name });
          }
        }
      } else if (type === 'chat') {
        recordEvent({ type: 'room.chat', room, name: self.name });
      } else if (type === 'poll') {
        recordEvent({ type: 'room.poll', room, name: self.name });
      } else if (type === 'vote') {
        recordEvent({ type: 'room.vote', room, name: self.name });
      } else if (type === 'reaction') {
        recordEvent({ type: 'room.reaction', room, name: self.name, detail: String(payload.emoji || '').slice(0, 8) });
      } else if (type === 'cast') {
        recordEvent({ type: payload.active ? 'room.cast_on' : 'room.cast_off', room, name: self.name });
      } else if (type === 'board-meta') {
        recordEvent({ type: payload.meta?.open ? 'room.board_open' : 'room.board_close', room, name: self.name });
      }
      const raw = JSON.stringify(msg);
      if (raw.length > SIGNAL_MAX_BYTES) return;
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
      if (self.leaveTimer) clearTimeout(self.leaveTimer);
      // Brief drops (Android screen share / Chrome) reconnect on the same peer id.
      // Wait before treating them as gone so they do not land in the waiting room.
      self.leaveTimer = setTimeout(() => {
        const currentMap = rooms.get(room);
        const current = currentMap?.get(peerId);
        if (!current || current.ws !== ws) return;
        const wasAdmitted = current.admitted;
        const wasHost = stickyHost(room) === peerId;
        const wasHidden = Boolean(current.hidden);
        currentMap.delete(peerId);
        shareFlags.delete(`${room}:${peerId}`);
        recordEvent({
          type: wasHidden ? 'admin.unwatch' : 'room.leave',
          room,
          name: current.name,
          detail: wasHidden ? 'silent' : wasHost ? 'was-host' : wasAdmitted ? 'admitted' : 'waiting',
        });
        if (wasHost) transferHost(room, currentMap, peerId);
        if (wasHidden) {
          cleanupEmpty(room);
          return;
        }
        if (wasAdmitted) {
          const notice = JSON.stringify({
            kind: 'signal',
            from: peerId,
            payload: { type: 'leave', from: peerId },
          });
          for (const member of currentMap.values()) {
            if (member.admitted && member.ws.readyState === 1) member.ws.send(notice);
          }
          sendMeta(room);
        } else {
          sendWaiting(room, currentMap);
        }
        cleanupEmpty(room);
      }, self.hidden ? 400 : 15000);
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
