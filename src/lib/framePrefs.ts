export type TileFit = 'contain' | 'cover';
export type LayoutAspect = 'auto' | '16:9' | '4:3' | '1:1' | '9:16';

export type FramePrefs = {
  defaultFit: TileFit;
  fit: Record<string, TileFit>;
  aspect: LayoutAspect;
  centerMe: boolean;
  selfZoom: number;
  selfPanX: number;
  selfPanY: number;
  autoFloat: boolean;
};

const KEY = 'LetsConnect.frame';

export const defaultFramePrefs: FramePrefs = {
  defaultFit: 'cover',
  fit: {},
  aspect: 'auto',
  centerMe: false,
  selfZoom: 1,
  selfPanX: 0.5,
  selfPanY: 0.5,
  autoFloat: true,
};

export function isMobileShell() {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  return (
    root.classList.contains('is-mobile') ||
    root.classList.contains('is-native') ||
    root.dataset.shell === 'mobile' ||
    root.dataset.shell === 'native' ||
    window.matchMedia('(max-width: 820px)').matches
  );
}

export function loadFramePrefs(): FramePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaultFramePrefs };
    return {
      ...defaultFramePrefs,
      ...(JSON.parse(raw) as Partial<FramePrefs>),
      fit: { ...defaultFramePrefs.fit, ...((JSON.parse(raw) as FramePrefs).fit || {}) },
    };
  } catch {
    return { ...defaultFramePrefs };
  }
}

/** Meetings fill the stage. Phones also keep Center me on so faces stay in frame. */
export function loadMeetingFramePrefs(): FramePrefs {
  const prefs = loadFramePrefs();
  return {
    ...prefs,
    defaultFit: 'cover',
    aspect: 'auto',
    centerMe: isMobileShell() ? true : prefs.centerMe,
  };
}

/** Pick columns/rows that fill the stage on phone, tablet, or desktop. */
export function stageGrid(count: number, width: number, height: number) {
  const n = Math.max(1, count);
  if (n === 1) return { cols: 1, rows: 1, spanLast: false };
  const w = Math.max(120, width || 1280);
  const h = Math.max(120, height || 720);
  const gap = 8;
  let best = { cols: 1, rows: n, score: Number.NEGATIVE_INFINITY };
  for (let cols = 1; cols <= n; cols += 1) {
    const rows = Math.ceil(n / cols);
    const tileW = (w - gap * (cols - 1)) / cols;
    const tileH = (h - gap * (rows - 1)) / rows;
    if (tileW < 72 || tileH < 72) continue;
    const ratio = tileW / Math.max(1, tileH);
    const shape = ratio < 0.38 || ratio > 3.2 ? 0.35 : ratio < 0.52 || ratio > 2.05 ? 0.58 : 1;
    const leftover = cols * rows - n;
    const pack = leftover === 0 ? 1.1 : leftover === 1 && cols > 1 ? 1.08 : 0.86;
    const score = tileW * tileH * shape * pack;
    if (score > best.score) best = { cols, rows, score };
  }
  const leftover = best.cols * best.rows - n;
  return { cols: best.cols, rows: best.rows, spanLast: leftover === 1 && best.cols > 1 };
}

export function saveFramePrefs(prefs: FramePrefs) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export function aspectCss(aspect: LayoutAspect): string | undefined {
  if (aspect === 'auto') return undefined;
  if (aspect === '16:9') return '16 / 9';
  if (aspect === '4:3') return '4 / 3';
  if (aspect === '1:1') return '1 / 1';
  return '9 / 16';
}

export function trackIsPortrait(track: MediaStreamTrack | undefined): boolean {
  if (!track) return false;
  const settings = track.getSettings?.() || {};
  const width = settings.width || 0;
  const height = settings.height || 0;
  if (width && height) return height > width * 1.05;
  if (settings.aspectRatio) return settings.aspectRatio < 0.95;
  return false;
}
