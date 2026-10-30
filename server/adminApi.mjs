import {
  adminDeleteUser,
  adminUpdateUser,
  adminUser,
  listAllUsers,
  listAllMeetings,
  listWaitlist,
  countUsers,
  countMeetings,
} from './db.mjs';
import {
  ensurePg,
  pgAdminDeleteUser,
  pgAdminUpdateUser,
  pgListAllUsers,
  pgListAllMeetings,
  pgListWaitlist,
} from './pgStore.mjs';
import { clientKey, rateLimit, readBodyCapped, securityHeaders, BUILD_VERSION } from './security.mjs';
import { listLiveRooms } from './signalCore.mjs';
import { eventStats, listEvents, recordEvent } from './adminStore.mjs';
import {
  adminCookie,
  adminFromCookieHeader,
  adminPasswordHash,
  adminUsername,
  clearAdminCookie,
  issueAdminJwt,
  sameText,
  verifyPassword,
} from './adminSession.mjs';

function sendJson(res, status, data, extraHeaders = {}, req) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...securityHeaders(req || { headers: {} }),
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function readAdmin(req) {
  return adminFromCookieHeader(req.headers.cookie || '');
}

async function snapshot() {
  const pg = await ensurePg();
  const usersRaw = pg ? await pgListAllUsers() : null;
  const users = (usersRaw ? usersRaw.map((row) => adminUser(row)) : listAllUsers()).filter(Boolean);
  const meetings = pg ? await pgListAllMeetings() : listAllMeetings();
  const waitlist = pg ? await pgListWaitlist() : listWaitlist();
  const live = listLiveRooms();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const livePeople = live.reduce((sum, room) => sum + room.participants, 0);
  const waitingPeople = live.reduce((sum, room) => sum + room.waiting, 0);
  return {
    generatedAt: now,
    version: BUILD_VERSION,
    store: pg ? 'postgres' : 'json',
    stats: {
      liveRooms: live.length,
      livePeople,
      waitingPeople,
      accounts: users.length || countUsers(),
      meetings: meetings.length || countMeetings(),
      meetingsToday: meetings.filter((item) => item.startedAt >= dayAgo).length,
      waitlist: waitlist.length,
      googleAccounts: users.filter((user) => user.hasGoogle).length,
      gmailAccounts: users.filter((user) => user.gmail).length,
      ...eventStats(now),
    },
    live,
    users,
    meetings,
    waitlist,
    events: listEvents(200),
  };
}

function isAdminPath(pathname) {
  return pathname === '/api/admin' || pathname.startsWith('/api/admin/');
}

export async function handleAdminApi(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url || '/', `http://${host}`);
  const pathname = decodeURIComponent(url.pathname.replace(/\/+$/, '') || '/');
  if (!isAdminPath(pathname)) return false;

  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, securityHeaders(req, {
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      }));
      res.end();
      return true;
    }

    if (pathname === '/api/admin/login' && req.method === 'POST') {
      const limited = rateLimit(req, 'admin');
      if (!limited.ok) {
        sendJson(res, 429, { error: 'Too many tries. Wait a minute and retry.' }, { 'Retry-After': String(limited.retryAfter) }, req);
        return true;
      }
      const body = await readBodyCapped(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const userOk = sameText(username, adminUsername());
      const passOk = await verifyPassword(password, await adminPasswordHash());
      if (!userOk || !passOk) {
        recordEvent({ type: 'admin.login_fail', name: username.slice(0, 80), ip: clientKey(req) });
        sendJson(res, 401, { error: 'Username or password is incorrect.' }, {}, req);
        return true;
      }
      const token = issueAdminJwt(adminUsername());
      recordEvent({ type: 'admin.login', name: adminUsername(), ip: clientKey(req) });
      sendJson(res, 200, { admin: { username: adminUsername() } }, { 'Set-Cookie': adminCookie(token) }, req);
      return true;
    }

    if (pathname === '/api/admin/logout' && req.method === 'POST') {
      const session = readAdmin(req);
      if (session) recordEvent({ type: 'admin.logout', name: session.username, ip: clientKey(req) });
      sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearAdminCookie() }, req);
      return true;
    }

    const session = readAdmin(req);
    if (!session) {
      sendJson(res, 401, { error: 'Admin sign-in required.' }, {}, req);
      return true;
    }

    if (pathname === '/api/admin/me' && req.method === 'GET') {
      sendJson(res, 200, { admin: { username: session.username } }, {}, req);
      return true;
    }

    if (pathname === '/api/admin/overview' && req.method === 'GET') {
      const data = await snapshot();
      sendJson(res, 200, data, {}, req);
      return true;
    }

    if (pathname.startsWith('/api/admin/users/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const userId = pathname.slice('/api/admin/users/'.length);
      if (!userId || userId.includes('/')) {
        sendJson(res, 404, { error: 'Account not found.' }, {}, req);
        return true;
      }
      const pg = await ensurePg();
      if (req.method === 'DELETE') {
        const result = pg ? await pgAdminDeleteUser(userId) : adminDeleteUser(userId);
        try {
          if (pg) adminDeleteUser(userId);
        } catch {
          /* local mirror optional */
        }
        recordEvent({
          type: 'admin.user_delete',
          userId,
          email: result.email,
          name: session.username,
          ip: clientKey(req),
        });
        sendJson(res, 200, { ok: true, id: userId }, {}, req);
        return true;
      }
      const body = await readBodyCapped(req);
      const patch = {
        name: body.name,
        plan: body.plan,
        disabled: body.disabled,
      };
      const row = pg ? await pgAdminUpdateUser(userId, patch) : null;
      const user = adminUser(row) || adminUpdateUser(userId, patch);
      if (pg) {
        try {
          adminUpdateUser(userId, patch);
        } catch {
          /* local mirror optional */
        }
      }
      recordEvent({
        type:
          typeof patch.disabled === 'boolean'
            ? user.disabled
              ? 'admin.user_block'
              : 'admin.user_unblock'
            : 'admin.user_update',
        userId,
        email: user.email,
        name: session.username,
        detail: typeof patch.disabled === 'boolean' ? (user.disabled ? 'blocked' : 'unblocked') : patch.name || patch.plan || 'updated',
        ip: clientKey(req),
      });
      sendJson(res, 200, { user }, {}, req);
      return true;
    }

    sendJson(res, 404, { error: 'Not found.' }, {}, req);
    return true;
  } catch (err) {
    sendJson(res, err.status || 500, { error: err.message || 'Server error' }, {}, req);
    return true;
  }
}

export function adminMiddleware() {
  return async (req, res, next) => {
    const handled = await handleAdminApi(req, res);
    if (!handled) next();
  };
}
