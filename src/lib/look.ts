import { getCustomBackgroundImage, loadCustomBackground } from './customBg';
import type { BackgroundId } from '../types';

export type LookStatus = 'real' | 'loading' | 'on' | 'fallback';

type Mask = {
  width: number;
  height: number;
  getAsUint8Array: () => Uint8Array;
  close?: () => void;
};

type SegmentResult = {
  categoryMask?: Mask;
  close?: () => void;
};

type Segmenter = {
  segmentForVideo: (video: HTMLVideoElement, timestamp: number) => SegmentResult | Promise<SegmentResult>;
  close?: () => void;
};

const wasm = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/wasm';
const model =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';

let segmenterPromise: Promise<Segmenter | null> | null = null;

function loadSegmenter(): Promise<Segmenter | null> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const load = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<{
        FilesetResolver: { forVisionTasks: (path: string) => Promise<unknown> };
        ImageSegmenter: {
          createFromOptions: (fileset: unknown, options: Record<string, unknown>) => Promise<Segmenter>;
        };
      }>;
      const mod = await load('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.17/+esm');
      const fileset = await mod.FilesetResolver.forVisionTasks(wasm);
      const options = {
        baseOptions: { modelAssetPath: model },
        runningMode: 'VIDEO',
        outputCategoryMask: true,
      };
      try {
        return await mod.ImageSegmenter.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        });
      } catch {
        return await mod.ImageSegmenter.createFromOptions(fileset, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' },
        });
      }
    })().catch(() => null);
  }
  return segmenterPromise;
}

function paintCustom(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const image = getCustomBackgroundImage();
  if (!image) {
    ctx.fillStyle = '#1c2630';
    ctx.fillRect(0, 0, w, h);
    return;
  }
  drawCoverImage(ctx, image, w, h);
}

function drawCoverImage(ctx: CanvasRenderingContext2D, image: CanvasImageSource, w: number, h: number) {
  const iw = 'naturalWidth' in image ? Number(image.naturalWidth) || w : w;
  const ih = 'naturalHeight' in image ? Number(image.naturalHeight) || h : h;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function paintScene(ctx: CanvasRenderingContext2D, kind: Exclude<BackgroundId, 'none' | 'blur' | 'custom'>, w: number, h: number) {
  const wall = ctx.createLinearGradient(0, 0, 0, h);
  if (kind === 'office') {
    wall.addColorStop(0, '#f4efe6');
    wall.addColorStop(0.62, '#e4d9cb');
    wall.addColorStop(1, '#c9b8a4');
  } else if (kind === 'studio') {
    wall.addColorStop(0, '#314156');
    wall.addColorStop(0.7, '#243140');
    wall.addColorStop(1, '#1a242e');
  } else {
    wall.addColorStop(0, '#f7efe4');
    wall.addColorStop(0.68, '#eadccb');
    wall.addColorStop(1, '#d9c3ae');
  }
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, h);

  if (kind === 'office') {
    roundRect(ctx, w * 0.08, h * 0.12, w * 0.34, h * 0.42, 18);
    const sky = ctx.createLinearGradient(0, h * 0.12, 0, h * 0.54);
    sky.addColorStop(0, '#9fd4f5');
    sky.addColorStop(1, '#e7f6ff');
    ctx.fillStyle = sky;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.fillRect(w * 0.14, h * 0.22, w * 0.08, h * 0.06);
    ctx.fillStyle = '#8ea0ae';
    ctx.fillRect(w * 0.12, h * 0.4, w * 0.05, h * 0.14);
    ctx.fillRect(w * 0.18, h * 0.34, w * 0.07, h * 0.2);
    ctx.fillRect(w * 0.27, h * 0.38, w * 0.06, h * 0.16);
    ctx.fillStyle = '#6f8f62';
    ctx.beginPath();
    ctx.ellipse(w * 0.78, h * 0.46, w * 0.07, h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c4a574';
    ctx.fillRect(w * 0.76, h * 0.6, w * 0.012, h * 0.16);
    ctx.fillStyle = '#d7c4a8';
    ctx.fillRect(0, h * 0.78, w, h * 0.22);
  } else if (kind === 'studio') {
    roundRect(ctx, w * 0.18, h * 0.1, w * 0.64, h * 0.34, 12);
    ctx.fillStyle = '#101820';
    ctx.fill();
    ctx.fillStyle = '#3d8bfd';
    ctx.fillRect(w * 0.22, h * 0.16, w * 0.22, h * 0.08);
    ctx.fillStyle = '#e8eef6';
    ctx.fillRect(w * 0.48, h * 0.18, w * 0.28, h * 0.03);
    ctx.fillRect(w * 0.48, h * 0.24, w * 0.2, h * 0.03);
    ctx.fillStyle = '#4e433c';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.78, w * 0.34, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1d2833';
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
  } else {
    ctx.fillStyle = '#b94a42';
    ctx.fillRect(w * 0.08, h * 0.08, w * 0.045, h * 0.62);
    ctx.fillRect(w * 0.34, h * 0.08, w * 0.045, h * 0.62);
    const sky = ctx.createLinearGradient(0, h * 0.12, 0, h * 0.58);
    sky.addColorStop(0, '#f6d7a8');
    sky.addColorStop(1, '#8ec8ea');
    ctx.fillStyle = sky;
    ctx.fillRect(w * 0.125, h * 0.12, w * 0.215, h * 0.46);
    ctx.fillStyle = '#6b4f3a';
    for (let shelf = 0; shelf < 4; shelf += 1) {
      const y = h * (0.18 + shelf * 0.14);
      ctx.fillRect(w * 0.62, y, w * 0.26, h * 0.02);
      ctx.fillStyle = shelf % 2 ? '#2f5d50' : '#245c8a';
      ctx.fillRect(w * 0.64, y - h * 0.08, w * 0.04, h * 0.08);
      ctx.fillStyle = shelf % 2 ? '#c4554a' : '#d4a017';
      ctx.fillRect(w * 0.7, y - h * 0.1, w * 0.035, h * 0.1);
      ctx.fillStyle = '#6b4f3a';
    }
    ctx.fillStyle = '#e7d3bc';
    ctx.fillRect(0, h * 0.8, w, h * 0.2);
    ctx.fillStyle = 'rgba(255, 214, 140, .35)';
    ctx.beginPath();
    ctx.arc(w * 0.86, h * 0.22, w * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawContain(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
  w: number,
  h: number,
) {
  const scale = Math.min(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number) {
  const vw = video.videoWidth || 16;
  const vh = video.videoHeight || 9;
  const scale = Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

export class LookEngine {
  readonly canvas: HTMLCanvasElement;
  readonly track: MediaStreamTrack;
  private ctx: CanvasRenderingContext2D;
  private person = document.createElement('canvas');
  private personCtx: CanvasRenderingContext2D;
  private raf = 0;
  private stopped = false;
  private segmenter: Segmenter | null = null;
  private mask: Uint8Array | null = null;
  private maskW = 0;
  private maskH = 0;
  private personHigh = true;
  private busy = false;
  private failed = false;
  private lastSeg = 0;
  private lastPaint = 0;
  private status: LookStatus = 'loading';

  constructor(
    private video: HTMLVideoElement,
    private getEffect: () => BackgroundId,
    private onStatus: (status: LookStatus) => void,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    const personCtx = this.person.getContext('2d', { willReadFrequently: true });
    if (!ctx || !personCtx) throw new Error('Canvas is not available');
    this.ctx = ctx;
    this.personCtx = personCtx;
    const stream = this.canvas.captureStream(15);
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Canvas stream has no video');
    track.contentHint = 'detail';
    this.track = track;
    this.raf = requestAnimationFrame(this.loop);
    void this.prepare();
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.track.stop();
  }

  private setStatus(next: LookStatus) {
    if (this.stopped || this.status === next) return;
    this.status = next;
    this.onStatus(next);
  }

  private async prepare() {
    await loadCustomBackground();
    const segmenter = await loadSegmenter();
    if (this.stopped) return;
    if (!segmenter) {
      this.failed = true;
      this.setStatus('fallback');
      return;
    }
    this.segmenter = segmenter;
  }

  private loop = (time: number) => {
    if (this.stopped) return;
    if (time - this.lastPaint > 64) {
      this.lastPaint = time;
      this.paint();
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private paint() {
    const effect = this.getEffect();
    const video = this.video;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (effect === 'none' || video.readyState < 2 || !video.videoWidth) {
      ctx.fillStyle = '#1c2126';
      ctx.fillRect(0, 0, w, h);
      return;
    }
    if (effect === 'blur') {
      ctx.save();
      ctx.filter = 'blur(26px)';
      drawCover(ctx, video, w, h);
      ctx.restore();
      ctx.fillStyle = 'rgba(12, 16, 20, .18)';
      ctx.fillRect(0, 0, w, h);
    } else if (effect === 'custom') {
      paintCustom(ctx, w, h);
    } else {
      paintScene(ctx, effect, w, h);
    }
    if (this.failed) {
      drawContain(ctx, video, video.videoWidth, video.videoHeight, w, h);
      this.setStatus('fallback');
      return;
    }
    if (!this.segmenter) {
      drawContain(ctx, video, video.videoWidth, video.videoHeight, w, h);
      this.setStatus('loading');
      return;
    }
    void this.segment();
    if (!this.mask) {
      drawContain(ctx, video, video.videoWidth, video.videoHeight, w, h);
      this.setStatus('loading');
      return;
    }
    this.cutout();
    drawContain(ctx, this.person, this.person.width, this.person.height, w, h);
    this.setStatus('on');
  }

  private async segment() {
    if (this.busy || this.failed || !this.segmenter) return;
    const now = performance.now();
    if (now - this.lastSeg < 140) return;
    this.lastSeg = now;
    this.busy = true;
    try {
      const result = await this.segmenter.segmentForVideo(this.video, now);
      const mask = result.categoryMask;
      if (mask) {
        const bytes = mask.getAsUint8Array();
        this.mask = new Uint8Array(bytes);
        this.maskW = mask.width;
        this.maskH = mask.height;
        this.personHigh = inferPersonHigh(this.mask, this.maskW, this.maskH);
        mask.close?.();
      }
      result.close?.();
    } catch {
      this.failed = true;
      this.setStatus('fallback');
    } finally {
      this.busy = false;
    }
  }

  private cutout() {
    const video = this.video;
    const maxW = 560;
    const scale = Math.min(1, maxW / video.videoWidth);
    const tw = Math.max(2, Math.round(video.videoWidth * scale));
    const th = Math.max(2, Math.round(video.videoHeight * scale));
    if (this.person.width !== tw || this.person.height !== th) {
      this.person.width = tw;
      this.person.height = th;
    }
    const pctx = this.personCtx;
    pctx.clearRect(0, 0, tw, th);
    pctx.drawImage(video, 0, 0, tw, th);
    const mask = this.mask;
    if (!mask || !this.maskW || !this.maskH) return;
    const image = pctx.getImageData(0, 0, tw, th);
    const data = image.data;
    for (let y = 0; y < th; y += 1) {
      const my = Math.min(this.maskH - 1, (y * this.maskH / th) | 0);
      for (let x = 0; x < tw; x += 1) {
        const mx = Math.min(this.maskW - 1, (x * this.maskW / tw) | 0);
        const value = mask[my * this.maskW + mx];
        const person = this.personHigh ? value > 0 : value === 0;
        if (!person) data[(y * tw + x) * 4 + 3] = 0;
      }
    }
    pctx.putImageData(image, 0, 0);
  }
}

function inferPersonHigh(mask: Uint8Array, w: number, h: number) {
  const center = mask[Math.floor(h / 2) * w + Math.floor(w / 2)] ?? 0;
  const corners = [mask[0] ?? 0, mask[w - 1] ?? 0, mask[(h - 1) * w] ?? 0, mask[h * w - 1] ?? 0];
  const edge = corners.reduce((sum, value) => sum + value, 0);
  if (center === 0 && edge > 0) return false;
  return true;
}
