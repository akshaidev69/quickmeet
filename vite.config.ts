import os from 'node:os';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { signalPlugin } from './server/signalPlugin.mjs';

function lanAddresses() {
  const addresses: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) addresses.push(item.address);
    }
  }
  return [...new Set(addresses)];
}

const useLocalHttps = process.env.LETSCONNECT_HTTP !== '1' && !process.env.RENDER;

const buildVersion =
  process.env.RENDER_GIT_COMMIT?.slice(0, 7) ||
  process.env.VITE_BUILD_VERSION ||
  `dev-${new Date().toISOString().slice(0, 10)}`;

export default defineConfig({
  define: {
    'import.meta.env.VITE_BUILD_VERSION': JSON.stringify(buildVersion),
  },
  plugins: [
    react(),
    ...(useLocalHttps ? [basicSsl()] : []),
    signalPlugin(),
    {
      name: 'letsconnect-lan',
      configureServer(server) {
        server.middlewares.use('/api/network', (_req, res) => {
          const port = server.config.server.port || 5173;
          const addresses = lanAddresses();
          const protocol = useLocalHttps ? 'https' : 'http';
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              https: useLocalHttps,
              port,
              addresses,
              urls: addresses.map((ip) => `${protocol}://${ip}:${port}`),
            }),
          );
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/network', (_req, res) => {
          const port = Number(process.env.PORT) || server.config.preview.port || 4173;
          const addresses = lanAddresses();
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              https: false,
              port,
              addresses,
              urls: addresses.map((ip) => `http://${ip}:${port}`),
            }),
          );
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/__/auth': {
        target: 'https://letsconnect-e8c03.firebaseapp.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    strictPort: false,
  },
});
