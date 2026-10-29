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
  defaultFit: 'contain',
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

/** Phone meetings always start 9:16 and Center me on. Desktop keeps saved prefs. */
export function loadMeetingFramePrefs(): FramePrefs {
  const prefs = loadFramePrefs();
  if (!isMobileShell()) return prefs;
  return { ...prefs, aspect: '9:16', centerMe: true };
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
