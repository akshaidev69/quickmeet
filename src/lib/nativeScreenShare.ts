import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isNativeApp } from './native';

type ScreenSharePlugin = {
  isAvailable(): Promise<{ available: boolean }>;
  start(): Promise<{ width?: number; height?: number }>;
  stop(): Promise<void>;
  addListener(
    event: 'frame',
    listener: (event: { data: string; width: number; height: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(event: 'stopped', listener: () => void): Promise<PluginListenerHandle>;
};

const ScreenShare = registerPlugin<ScreenSharePlugin>('ScreenShare');

let active: {
  stream: MediaStream;
  stop: () => Promise<void>;
} | null = null;

export async function nativeScreenShareAvailable() {
  if (!isNativeApp()) return false;
  try {
    const result = await ScreenShare.isAvailable();
    return Boolean(result.available);
  } catch {
    return false;
  }
}

/**
 * Start Android MediaProjection capture and expose it as a MediaStream
 * via an offscreen canvas (works inside Capacitor WebView).
 */
export async function startNativeScreenShare(): Promise<MediaStream> {
  if (active) return active.stream;

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 1280;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create screen share canvas.');

  const img = new Image();
  let frameHandle: PluginListenerHandle | null = null;
  let stopHandle: PluginListenerHandle | null = null;
  let stopped = false;

  await ScreenShare.start();

  frameHandle = await ScreenShare.addListener('frame', (event) => {
    if (stopped) return;
    if (event.width && event.height && (canvas.width !== event.width || canvas.height !== event.height)) {
      canvas.width = event.width;
      canvas.height = event.height;
    }
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      } catch {
        /* ignore draw errors */
      }
    };
    img.src = `data:image/jpeg;base64,${event.data}`;
  });

  stopHandle = await ScreenShare.addListener('stopped', () => {
    void cleanup();
  });

  const stream = canvas.captureStream(12);
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.contentHint = 'detail';
  }

  async function cleanup() {
    if (stopped) return;
    stopped = true;
    try {
      await frameHandle?.remove();
    } catch {
      /* ignore */
    }
    try {
      await stopHandle?.remove();
    } catch {
      /* ignore */
    }
    try {
      await ScreenShare.stop();
    } catch {
      /* ignore */
    }
    stream.getTracks().forEach((track) => track.stop());
    if (active?.stream === stream) active = null;
  }

  videoTrack?.addEventListener('ended', () => {
    void cleanup();
  });

  active = {
    stream,
    stop: cleanup,
  };
  return stream;
}

export async function stopNativeScreenShare() {
  if (!active) {
    try {
      await ScreenShare.stop();
    } catch {
      /* ignore */
    }
    return;
  }
  await active.stop();
}
