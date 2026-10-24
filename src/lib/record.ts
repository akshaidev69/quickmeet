import { fixWebmDuration } from './webmFix';

export type RecordCast = {
  peerIds: string[];
  includeScreens: boolean;
  includeAudioFromOthers: boolean;
};

export type ChatFrame = {
  name: string;
  text: string;
  ts: number;
  system?: boolean;
};

export type RecordBundle = {
  host: Blob;
  room: Blob;
  screen: Blob;
  chat: Blob;
  durationMs: number;
};

export type RecordFile = { key: keyof Omit<RecordBundle, 'durationMs'>; label: string; name: string; blob: Blob };

type Recorder = {
  stop: () => Promise<RecordBundle>;
  setCast: (cast: RecordCast) => void;
};

type Lane = {
  name: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  chunks: BlobPart[];
  recorder: MediaRecorder;
  stream: MediaStream;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  x: number,
  y: number,
  w: number,
  h: number,
  contain: boolean,
) {
  const scale = contain ? Math.min(w / sw, h / sh) : Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (contain) {
    ctx.fillStyle = '#0f1216';
    ctx.fillRect(x, y, w, h);
  }
  ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

function sources(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLVideoElement | HTMLCanvasElement>('[data-rec-video="1"]')];
}

function paintHeader(ctx: CanvasRenderingContext2D, title: string, subtitle: string) {
  ctx.fillStyle = '#10141a';
  ctx.fillRect(0, 0, 1280, 720);
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(0, 0, 1280, 44);
  ctx.fillStyle = '#e8eaed';
  ctx.font = '700 18px Segoe UI, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(title, 18, 28);
  ctx.font = '600 14px Segoe UI, sans-serif';
  ctx.fillStyle = '#9aa0a6';
  ctx.fillText(subtitle, 18 + ctx.measureText(title).width + 16, 28);
}

function paintEmpty(ctx: CanvasRenderingContext2D, message: string) {
  ctx.fillStyle = '#fff';
  ctx.font = '700 28px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(message, 640, 360);
  ctx.textAlign = 'left';
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  clips: Array<HTMLVideoElement | HTMLCanvasElement>,
  title: string,
  emptyMessage: string,
) {
  paintHeader(ctx, title, `${clips.length} feed${clips.length === 1 ? '' : 's'}`);
  const count = Math.max(clips.length, 1);
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const top = 52;
  const cellW = 1280 / cols;
  const cellH = (720 - top) / rows;
  if (!clips.length) {
    paintEmpty(ctx, emptyMessage);
    return;
  }
  clips.forEach((node, index) => {
    const x = (index % cols) * cellW + 8;
    const y = top + Math.floor(index / cols) * cellH + 8;
    const w = cellW - 16;
    const h = cellH - 16;
    const off = node.dataset.recOff === '1';
    const role = node.dataset.recRole || '';
    if (!off && ((node instanceof HTMLVideoElement && node.readyState >= 2) || node instanceof HTMLCanvasElement)) {
      const sw = node instanceof HTMLVideoElement ? node.videoWidth || 16 : node.width || 16;
      const sh = node instanceof HTMLVideoElement ? node.videoHeight || 9 : node.height || 9;
      drawCover(ctx, node, sw, sh, x, y, w, h, true);
    } else {
      ctx.fillStyle = node.dataset.recColor || '#243140';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#fff';
      ctx.font = '700 42px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.dataset.recInitials || '?', x + w / 2, y + h / 2 + 8);
      ctx.textAlign = 'left';
    }
    const name = node.dataset.recName || '';
    const label = role ? `${name} · ${role}` : name;
    ctx.font = '600 16px Segoe UI, sans-serif';
    const width = Math.min(ctx.measureText(label).width + 24, w - 16);
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(x + 10, y + h - 40, width, 28);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 20, y + h - 20);
  });
}

function paintChat(ctx: CanvasRenderingContext2D, messages: ChatFrame[]) {
  paintHeader(ctx, 'Chat', `${messages.length} message${messages.length === 1 ? '' : 's'}`);
  ctx.fillStyle = '#151a20';
  ctx.fillRect(24, 60, 1232, 636);
  const visible = messages.slice(-14);
  if (!visible.length) {
    paintEmpty(ctx, 'No chat messages yet');
    return;
  }
  let y = 88;
  for (const message of visible) {
    const time = new Date(message.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (message.system) {
      ctx.fillStyle = '#9aa0a6';
      ctx.font = '600 16px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(message.text.slice(0, 90), 640, y);
      ctx.textAlign = 'left';
      y += 34;
      continue;
    }
    ctx.fillStyle = '#8ab4f8';
    ctx.font = '700 16px Segoe UI, sans-serif';
    ctx.fillText(`${message.name}  ·  ${time}`, 48, y);
    y += 24;
    ctx.fillStyle = '#e8eaed';
    ctx.font = '600 20px Segoe UI, sans-serif';
    const lines = wrapText(ctx, message.text, 1160);
    for (const line of lines.slice(0, 3)) {
      ctx.fillText(line, 48, y);
      y += 28;
    }
    y += 16;
    if (y > 660) break;
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function pickMime() {
  return (
    ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm'].find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) || ''
  );
}

function makeLane(name: string, audio: MediaStream, mime: string): Lane | null {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!ctx) return null;
  ctx.fillStyle = '#10141a';
  ctx.fillRect(0, 0, 1280, 720);
  const stream = canvas.captureStream(30);
  audio.getAudioTracks().forEach((track) => {
    try {
      stream.addTrack(track.clone());
    } catch {
      /* ignore */
    }
  });
  const options: MediaRecorderOptions = mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : { videoBitsPerSecond: 2_500_000 };
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, options);
  } catch {
    recorder = new MediaRecorder(stream);
  }
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data?.size) chunks.push(event.data);
  };
  return { name, canvas, ctx, chunks, recorder, stream };
}

function stopLane(lane: Lane): Promise<Blob> {
  return new Promise((resolve) => {
    const finish = () => {
      lane.stream.getTracks().forEach((track) => track.stop());
      const type = lane.recorder.mimeType || 'video/webm';
      resolve(new Blob(lane.chunks, { type }));
    };
    if (lane.recorder.state === 'inactive') {
      finish();
      return;
    }
    lane.recorder.onstop = () => finish();
    try {
      if (lane.recorder.state === 'recording') lane.recorder.requestData();
    } catch {
      /* ignore */
    }
    lane.recorder.stop();
  });
}

/** Store-only ZIP with real CRC32 so Windows Explorer / 7-Zip open cleanly. */
export async function zipBlobs(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries = await Promise.all(
    files.map(async (file) => ({
      name: file.name,
      data: new Uint8Array(await file.blob.arrayBuffer()),
    })),
  );
  const parts: BlobPart[] = [];
  const central: number[] = [];
  let offset = 0;
  const u16 = (value: number) => [value & 255, (value >> 8) & 255];
  const u32 = (value: number) => [...u16(value & 0xffff), ...u16((value >>> 16) & 0xffff)];
  const encoder = new TextEncoder();

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(entry.data.length),
      ...u32(entry.data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...nameBytes,
    ];
    parts.push(new Uint8Array(local), entry.data);
    central.push(
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(crc),
      ...u32(entry.data.length),
      ...u32(entry.data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
      ...nameBytes,
    );
    offset += local.length + entry.data.length;
  }

  const centralBytes = new Uint8Array(central);
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralBytes.length),
    ...u32(offset),
    ...u16(0),
  ];
  parts.push(centralBytes, new Uint8Array(end));
  return new Blob(parts, { type: 'application/zip' });
}

export function createRecorder(
  root: HTMLElement,
  getAudioTracks: () => MediaStreamTrack[],
  initialCast: RecordCast,
  options: {
    getHostId: () => string | null;
    getChat: () => ChatFrame[];
  },
): Recorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  let cast = { ...initialCast, peerIds: [...initialCast.peerIds] };

  const audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  const connected = new Set<string>();
  const pullAudio = () => {
    for (const track of getAudioTracks()) {
      if (!track || track.readyState !== 'live' || connected.has(track.id)) continue;
      connected.add(track.id);
      try {
        const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
        source.connect(dest);
      } catch {
        /* ignore */
      }
    }
  };

  const mime = pickMime();
  const hostLane = makeLane('host', dest.stream, mime);
  const roomLane = makeLane('room', dest.stream, mime);
  const screenLane = makeLane('screen', dest.stream, mime);
  const chatLane = makeLane('chat', dest.stream, mime);
  if (!hostLane || !roomLane || !screenLane || !chatLane) return null;

  const lanes = [hostLane, roomLane, screenLane, chatLane];
  let frame = 0;
  let raf = 0;
  let startedAt = 0;
  let armed = false;

  const draw = () => {
    const hostId = options.getHostId();
    const all = sources(root);
    const cameras = all.filter((node) => (node.dataset.recKind || 'camera') === 'camera');
    const screens = all.filter((node) => node.dataset.recKind === 'screen');
    const hostClips = cameras.filter((node) => node.dataset.recPeer === hostId || node.dataset.recRole === 'Host');
    const roomClips = cameras.filter((node) => {
      const peer = node.dataset.recPeer || '';
      return !cast.peerIds.length || cast.peerIds.includes(peer);
    });
    const screenClips = cast.includeScreens ? screens : [];

    paintGrid(hostLane.ctx, hostClips, '1 · Host only', 'Waiting for host camera');
    paintGrid(roomLane.ctx, roomClips, '2 · Host + guests', 'Waiting for people');
    paintGrid(
      screenLane.ctx,
      screenClips,
      '3 · Screen share',
      screens.length ? 'Screen share paused in this cut' : 'No screen share yet',
    );
    paintChat(chatLane.ctx, options.getChat());

    // Keep captureStream producing frames (Chrome quirk).
    for (const lane of lanes) {
      lane.ctx.fillStyle = 'rgba(0,0,0,0.002)';
      lane.ctx.fillRect(0, 0, 1, 1);
    }

    frame += 1;
    if (frame % 15 === 0) pullAudio();

    if (!armed && frame >= 8) {
      armed = true;
      startedAt = Date.now();
      void audioCtx.resume().catch(() => undefined);
      pullAudio();
      for (const lane of lanes) {
        try {
          if (lane.recorder.state === 'inactive') lane.recorder.start(1000);
        } catch {
          /* ignore */
        }
      }
    }

    raf = requestAnimationFrame(draw);
  };

  pullAudio();
  void audioCtx.resume().catch(() => undefined);
  draw();

  return {
    setCast(next) {
      cast = { ...next, peerIds: [...next.peerIds] };
    },
    async stop() {
      cancelAnimationFrame(raf);
      // One last paint so the final frame lands in the recorder.
      for (const lane of lanes) {
        lane.ctx.fillStyle = 'rgba(0,0,0,0.002)';
        lane.ctx.fillRect(0, 0, 1, 1);
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      const durationMs = Math.max(1000, startedAt ? Date.now() - startedAt : 1000);
      const [hostRaw, roomRaw, screenRaw, chatRaw] = await Promise.all(lanes.map((lane) => stopLane(lane)));
      await audioCtx.close().catch(() => undefined);
      const [host, room, screen, chat] = await Promise.all([
        fixWebmDuration(hostRaw, durationMs),
        fixWebmDuration(roomRaw, durationMs),
        fixWebmDuration(screenRaw, durationMs),
        fixWebmDuration(chatRaw, durationMs),
      ]);
      return { host, room, screen, chat, durationMs };
    },
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function recordFiles(bundle: RecordBundle, code: string): RecordFile[] {
  return [
    { key: 'host', label: 'Host only', name: `01-host-only-${code}.webm`, blob: bundle.host },
    { key: 'room', label: 'Host + guests', name: `02-host-and-guests-${code}.webm`, blob: bundle.room },
    { key: 'screen', label: 'Screen share', name: `03-screen-share-${code}.webm`, blob: bundle.screen },
    { key: 'chat', label: 'Chat reel', name: `04-chat-${code}.webm`, blob: bundle.chat },
  ];
}

export async function downloadRecordZip(bundle: RecordBundle, code: string) {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const files = recordFiles(bundle, code);
  const zip = await zipBlobs(files.map((file) => ({ name: file.name, blob: file.blob })));
  downloadBlob(zip, `letsconnect-recording-${code}-${stamp}.zip`);
  return files;
}
