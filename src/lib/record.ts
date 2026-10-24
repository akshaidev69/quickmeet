export type RecordCast = {
  peerIds: string[];
  includeScreens: boolean;
  includeAudioFromOthers: boolean;
};

type Recorder = {
  stop: () => Promise<Blob>;
  setCast: (cast: RecordCast) => void;
};

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
  return [
    ...root.querySelectorAll<HTMLVideoElement | HTMLCanvasElement>('[data-rec-video="1"]'),
  ];
}

export function createRecorder(
  root: HTMLElement,
  getAudioTracks: () => MediaStreamTrack[],
  initialCast: RecordCast,
): Recorder | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let cast = { ...initialCast, peerIds: [...initialCast.peerIds] };

  let frame = 0;
  const draw = () => {
    const selected = new Set(cast.peerIds);
    const clips = sources(root).filter((node) => {
      const peer = node.dataset.recPeer || '';
      const kind = node.dataset.recKind || 'camera';
      if (kind === 'screen') return cast.includeScreens;
      return selected.has(peer);
    });
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, 1280, 720);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(0, 0, 1280, 44);
    ctx.fillStyle = '#e8eaed';
    ctx.font = '700 18px Segoe UI, sans-serif';
    ctx.fillText('FaceCast', 18, 28);
    ctx.font = '600 14px Segoe UI, sans-serif';
    ctx.fillStyle = '#9aa0a6';
    ctx.fillText(`${clips.length || 0} face${clips.length === 1 ? '' : 's'}`, 110, 28);

    const count = Math.max(clips.length, 1);
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const top = 52;
    const cellW = 1280 / cols;
    const cellH = (720 - top) / rows;
    if (!clips.length) {
      ctx.fillStyle = '#fff';
      ctx.font = '700 28px Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Pick people for this FaceCast', 640, 360);
      ctx.textAlign = 'left';
    }
    clips.forEach((node, index) => {
      const x = (index % cols) * cellW + 8;
      const y = top + Math.floor(index / cols) * cellH + 8;
      const w = cellW - 16;
      const h = cellH - 16;
      const off = node.dataset.recOff === '1';
      const role = node.dataset.recRole || '';
      if (!off && ((node instanceof HTMLVideoElement && node.readyState >= 2) || node instanceof HTMLCanvasElement)) {
        const sw =
          node instanceof HTMLVideoElement ? node.videoWidth || 16 : node.width || 16;
        const sh =
          node instanceof HTMLVideoElement ? node.videoHeight || 9 : node.height || 9;
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
    frame += 1;
    if (frame % 20 === 0) pullAudio();
    raf = requestAnimationFrame(draw);
  };

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
        /* track may already be consumed */
      }
    }
  };

  let raf = 0;
  draw();
  pullAudio();
  const stream = canvas.captureStream(24);
  dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
  const mime = ['video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
  const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  rec.start(1000);

  return {
    setCast(next) {
      cast = { ...next, peerIds: [...next.peerIds] };
    },
    async stop() {
      cancelAnimationFrame(raf);
      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || 'video/webm' }));
        if (rec.state !== 'inactive') rec.stop();
        else resolve(new Blob(chunks, { type: 'video/webm' }));
      });
      stream.getTracks().forEach((track) => track.stop());
      await audioCtx.close().catch(() => undefined);
      return blob;
    },
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
