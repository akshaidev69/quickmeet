import { attachSignal, roomIsLive } from './signalCore.mjs';
import { authMiddleware } from './authApi.mjs';

function sendJson(res, status, data) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.statusCode = status;
  res.end(JSON.stringify(data));
}

function apiExtras() {
  return (req, res, next) => {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    const pathname = decodeURIComponent(url.pathname.replace(/\/+$/, '') || '/');

    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { status: 'ok', app: 'LetsConnect' });
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

    if (pathname === '/robots.txt') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.statusCode = 200;
      res.end('User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app\n');
      return;
    }

    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth') && !pathname.startsWith('/api/meetings') && pathname !== '/api/config' && pathname !== '/api/waitlist' && pathname !== '/api/network') {
      // Let auth middleware / vite handle known routes; 404 unknown API later via auth miss.
      if (!['/api/health'].includes(pathname)) {
        /* fall through — authMiddleware handles /api/auth and /api/meetings */
      }
    }

    next();
  };
}

export function signalPlugin() {
  return {
    name: 'letsconnect-signal',
    configureServer(server) {
      server.middlewares.use(apiExtras());
      server.middlewares.use(authMiddleware());
      const boot = () => {
        if (server.httpServer) attachSignal(server.httpServer);
      };
      boot();
      server.httpServer?.once('listening', boot);
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiExtras());
      server.middlewares.use(authMiddleware());
      const boot = () => {
        if (server.httpServer) attachSignal(server.httpServer);
      };
      boot();
      server.httpServer?.once('listening', boot);
    },
  };
}
