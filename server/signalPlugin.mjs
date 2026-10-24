import { attachSignal } from './signalCore.mjs';
import { authMiddleware } from './authApi.mjs';

export function signalPlugin() {
  return {
    name: 'letsconnect-signal',
    configureServer(server) {
      server.middlewares.use(authMiddleware());
      const boot = () => {
        if (server.httpServer) attachSignal(server.httpServer);
      };
      boot();
      server.httpServer?.once('listening', boot);
    },
    configurePreviewServer(server) {
      server.middlewares.use(authMiddleware());
      const boot = () => {
        if (server.httpServer) attachSignal(server.httpServer);
      };
      boot();
      server.httpServer?.once('listening', boot);
    },
  };
}
