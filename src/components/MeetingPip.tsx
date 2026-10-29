import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { colorFor, initials } from '../lib/people';
import { autoFloatPaused } from '../lib/pipGate';

export type PipPerson = {
  id: string;
  name: string;
  stream: MediaStream | null;
  showVideo: boolean;
  speaking: boolean;
  you: boolean;
};

type Props = {
  people: PipPerson[];
  micOn: boolean;
  camOn: boolean;
  hand: boolean;
  autoFloat: boolean;
  docked: boolean;
  panelOpen: boolean;
  boardOpen: boolean;
  mobile: boolean;
  onMic: () => void;
  onCam: () => void;
  onHand: () => void;
  onLeave: () => void;
  onBack: () => void;
  onStatus?: (text: string) => void;
  openSignal?: number;
};

type DocPip = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
};

function docPip(): DocPip | null {
  return (window as Window & { documentPictureInPicture?: DocPip }).documentPictureInPicture || null;
}

const PIP_CSS = `
  :root { color-scheme: dark; }
  html, body { margin: 0; background: #111814; color: #eef3ef; font: 600 13px Inter, Segoe UI, sans-serif; height: 100%; overflow: hidden; }
  .pip { display: grid; grid-template-rows: 1fr 52px; height: 100%; }
  .grid { display: grid; gap: 4px; padding: 6px; min-height: 0; height: 100%; background: #0d1411; }
  .grid.c1 { grid-template-columns: 1fr; }
  .grid.c2 { grid-template-columns: 1fr 1fr; }
  .tile { position: relative; overflow: hidden; border-radius: 10px; background: #1a2420; min-width: 0; min-height: 0; }
  video { width: 100%; height: 100%; object-fit: cover; background: #111; }
  .avatar { position: absolute; inset: 0; display: grid; place-items: center; font-size: 22px; color: #fff; }
  .tile.has-video .avatar { display: none; }
  .name { position: absolute; left: 6px; bottom: 6px; background: rgba(0,0,0,.55); padding: 2px 6px; border-radius: 999px; font-size: 11px; pointer-events: none; }
  .bar { display: flex; flex-wrap: nowrap; gap: 6px; justify-content: center; align-items: center; padding: 8px; background: #1a2420; }
  button { flex: 0 0 auto; min-width: 56px; height: 36px; border: 0; border-radius: 999px; background: #2a3530; color: #eef3ef; font-weight: 700; cursor: pointer; white-space: nowrap; }
  button.danger { background: #c5221f; color: #fff; }
  button.on { background: #137333; }
`;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

function sourceVideo(person: PipPerson | undefined) {
  if (!person) return null;
  const nodes = document.querySelectorAll<HTMLVideoElement>(`[data-rec-peer="${person.id}"][data-rec-kind="camera"]`);
  for (const node of nodes) {
    if (node.readyState >= 2 && node.videoWidth > 0) return node;
  }
  return nodes[0] || null;
}

function raceTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function enterVideoPip(video: HTMLVideoElement) {
  const safari = video as HTMLVideoElement & {
    webkitSupportsPresentationMode?: boolean;
    webkitSetPresentationMode?: (mode: string) => void;
    webkitPresentationMode?: string;
  };
  if (document.pictureInPictureElement === video) return true;
  if (safari.webkitPresentationMode === 'picture-in-picture') return true;
  video.disablePictureInPicture = false;
  if (safari.webkitSupportsPresentationMode && safari.webkitSetPresentationMode) {
    safari.webkitSetPresentationMode('picture-in-picture');
    return true;
  }
  if (!document.pictureInPictureEnabled) return false;
  await raceTimeout(video.requestPictureInPicture(), 2500, 'Picture-in-picture timed out');
  return true;
}

type ConferencingSession = MediaSession & {
  setActionHandler: (action: string, handler: MediaSessionActionHandler | null) => void;
  setMicrophoneActive?: (active: boolean) => void;
  setCameraActive?: (active: boolean) => void;
};

function rosterFor(people: PipPerson[]) {
  const live = people.filter((person) => person.showVideo).slice(0, 4);
  return live.length ? live : people.slice(0, 4);
}

export function MeetingPip({
  people,
  micOn,
  camOn,
  hand,
  autoFloat,
  docked,
  panelOpen,
  boardOpen,
  mobile,
  onMic,
  onCam,
  onHand,
  onLeave,
  onBack,
  onStatus,
  openSignal = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const winRef = useRef<Window | null>(null);
  const autoOpened = useRef(false);
  const opening = useRef(false);
  const [bubble, setBubble] = useState({ x: 16, y: 96 });
  const [gone, setGone] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const controls = useRef({ onMic, onCam, onHand, onLeave, onBack, micOn, camOn, hand });
  controls.current = { onMic, onCam, onHand, onLeave, onBack, micOn, camOn, hand };
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const activeRef = useRef<PipPerson | undefined>(undefined);

  const active =
    people.find((person) => person.speaking && person.showVideo) ||
    people.find((person) => person.showVideo) ||
    people[0];
  activeRef.current = active;
  const showBubble = !gone && (docked || (mobile && panelOpen && !boardOpen));

  const paintFallback = useCallback(() => {
    const canvas = canvasRef.current;
    const video = pipVideoRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.width !== 640) {
      canvas.width = 640;
      canvas.height = 360;
    }
    const person = activeRef.current;
    ctx.fillStyle = '#111814';
    ctx.fillRect(0, 0, 640, 360);
    const source = sourceVideo(person);
    if (source && source.readyState >= 2 && source.videoWidth > 0) {
      ctx.drawImage(source, 0, 0, 640, 360);
    } else {
      ctx.fillStyle = person ? colorFor(person.name) : '#1a2420';
      ctx.beginPath();
      ctx.arc(320, 168, 58, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(person ? initials(person.name) : 'LC', 320, 178);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(16, 308, 240, 32);
    ctx.fillStyle = '#fff';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(person?.name || 'LetsConnect', 24, 330);
    if (video && !video.srcObject) {
      video.srcObject = canvas.captureStream(12);
      video.muted = true;
      void video.play().catch(() => undefined);
    }
  }, []);

  const syncPipWindow = useCallback((win: Window) => {
    const roster = rosterFor(peopleRef.current);
    let root = win.document.querySelector('.pip');
    if (!root) {
      win.document.body.innerHTML = `
        <div class="pip">
          <div class="grid c1"></div>
          <div class="bar">
            <button type="button" data-act="mic">Mic</button>
            <button type="button" data-act="cam">Cam</button>
            <button type="button" data-act="hand">Hand</button>
            <button type="button" data-act="back">Back</button>
            <button type="button" class="danger" data-act="leave">Leave</button>
          </div>
        </div>`;
      root = win.document.querySelector('.pip');
      win.document.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          const act = button.getAttribute('data-act');
          if (act === 'mic') controls.current.onMic();
          if (act === 'cam') controls.current.onCam();
          if (act === 'hand') controls.current.onHand();
          if (act === 'back') {
            controls.current.onBack();
            win.close();
          }
          if (act === 'leave') {
            controls.current.onLeave();
            win.close();
          }
        });
      });
    }
    const grid = win.document.querySelector('.grid');
    if (!grid) return;
    grid.className = `grid c${roster.length > 1 ? 2 : 1}`;
    const ids = roster.map((person) => person.id);
    const existing = [...grid.querySelectorAll<HTMLElement>('.tile')];
    const currentIds = existing.map((tile) => tile.getAttribute('data-id') || '');
    if (currentIds.join('|') !== ids.join('|')) {
      grid.innerHTML = roster
        .map(
          (person) => `
          <article class="tile" data-id="${escapeHtml(person.id)}">
            <video autoplay playsinline muted></video>
            <div class="avatar" style="background:${colorFor(person.name)}">${escapeHtml(initials(person.name))}</div>
            <span class="name">${escapeHtml(person.name)}${person.you ? ' (You)' : ''}</span>
          </article>`,
        )
        .join('');
    }
    roster.forEach((person) => {
      const tile = grid.querySelector<HTMLElement>(`[data-id="${person.id.replace(/"/g, '')}"]`);
      if (!tile) return;
      tile.classList.toggle('has-video', Boolean(person.showVideo && person.stream));
      const video = tile.querySelector('video');
      if (!video) return;
      if (person.stream && video.srcObject !== person.stream) {
        video.srcObject = person.stream;
        void video.play().catch(() => undefined);
      }
    });
    const mic = win.document.querySelector('[data-act="mic"]');
    const cam = win.document.querySelector('[data-act="cam"]');
    const handBtn = win.document.querySelector('[data-act="hand"]');
    if (mic) {
      mic.textContent = controls.current.micOn ? 'Mic' : 'Muted';
      mic.classList.toggle('on', controls.current.micOn);
    }
    if (cam) {
      cam.textContent = controls.current.camOn ? 'Cam' : 'Cam off';
      cam.classList.toggle('on', controls.current.camOn);
    }
    if (handBtn) {
      handBtn.textContent = controls.current.hand ? 'Lower' : 'Hand';
      handBtn.classList.toggle('on', controls.current.hand);
    }
  }, []);

  const openDocumentPip = useCallback(async () => {
    const api = docPip();
    if (!api) return false;
    try {
      if (winRef.current && !winRef.current.closed) {
        syncPipWindow(winRef.current);
        return true;
      }
      const win = await api.requestWindow({ width: 420, height: 280 });
      winRef.current = win;
      const style = win.document.createElement('style');
      style.textContent = PIP_CSS;
      win.document.head.appendChild(style);
      syncPipWindow(win);
      win.addEventListener('pagehide', () => {
        winRef.current = null;
      });
      return true;
    } catch {
      return false;
    }
  }, [syncPipWindow]);

  const openVideoPip = useCallback(async () => {
    paintFallback();
    const compositor = pipVideoRef.current;
    const live = sourceVideo(activeRef.current);
    const videos = [compositor, live].filter(
      (node, index, list): node is HTMLVideoElement => Boolean(node) && list.indexOf(node) === index,
    );
    let lastError = 'Picture-in-picture is not available in this browser.';
    for (const video of videos) {
      if (!video.srcObject && compositor && canvasRef.current && video === compositor) {
        video.srcObject = canvasRef.current.captureStream(12);
        video.muted = true;
      }
      try {
        if (await enterVideoPip(video)) return true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    throw new Error(lastError);
  }, [paintFallback]);

  function isFloating() {
    if (winRef.current && !winRef.current.closed) return true;
    if (document.pictureInPictureElement) return true;
    const safari = pipVideoRef.current as HTMLVideoElement & { webkitPresentationMode?: string };
    return safari?.webkitPresentationMode === 'picture-in-picture';
  }

  const closeFloat = useCallback(async () => {
    if (winRef.current && !winRef.current.closed) {
      winRef.current.close();
      winRef.current = null;
    }
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => undefined);
    }
    const safari = pipVideoRef.current as HTMLVideoElement & {
      webkitPresentationMode?: string;
      webkitSetPresentationMode?: (mode: string) => void;
    };
    if (safari?.webkitPresentationMode === 'picture-in-picture') {
      safari.webkitSetPresentationMode?.('inline');
    }
    autoOpened.current = false;
  }, []);

  const openFloat = useCallback(
    async (reason: 'manual' | 'media-session' | 'hide') => {
      if (isFloating() || opening.current) return true;
      opening.current = true;
      const stuck = window.setTimeout(() => {
        opening.current = false;
      }, 4000);
      paintFallback();
      try {
        try {
          const { isNativeApp } = await import('../lib/native');
          if (isNativeApp()) {
            const { enterPip } = await import('../lib/nativeMeeting');
            if (await enterPip()) {
              autoOpened.current = reason !== 'manual';
              return true;
            }
            if (reason === 'hide') return false;
          }
        } catch {
          /* web or older APK */
        }
        try {
          const docOk = await raceTimeout(openDocumentPip(), 2500, 'Floating window timed out');
          if (docOk) {
            autoOpened.current = reason !== 'manual';
            return true;
          }
        } catch {
          /* document PiP blocked */
        }
        try {
          await openVideoPip();
          autoOpened.current = reason !== 'manual';
          return true;
        } catch (error) {
          if (reason === 'manual') {
            const message = error instanceof Error ? error.message : 'Could not open the floating window.';
            onStatusRef.current?.(message);
          }
          return false;
        }
      } finally {
        window.clearTimeout(stuck);
        opening.current = false;
      }
    },
    [openDocumentPip, openVideoPip, paintFallback],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = pipVideoRef.current as (HTMLVideoElement & { autoPictureInPicture?: boolean }) | null;
    if (!canvas || !video) return;
    canvas.width = 640;
    canvas.height = 360;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.disablePictureInPicture = false;
    video.autoPictureInPicture = true;
    video.setAttribute('autopictureinpicture', '');
    if (!video.srcObject) video.srcObject = canvas.captureStream(12);
    const keepPlaying = () => {
      if (!video.paused) return;
      if (document.pictureInPictureElement && document.pictureInPictureElement !== video) return;
      void video.play().catch(() => undefined);
    };
    keepPlaying();
    const media = navigator.mediaSession as ConferencingSession;
    const bind = (action: string, handler: MediaSessionActionHandler | null) => {
      try {
        media.setActionHandler(action, handler);
      } catch {
        /* unsupported action */
      }
    };
    try {
      media.metadata = new MediaMetadata({
        title: 'LetsConnect meeting',
        artist: 'In a call',
        album: 'LetsConnect',
      });
      media.playbackState = 'playing';
    } catch {
      /* media session unsupported */
    }
    bind('enterpictureinpicture', () => {
      if (!autoFloat || autoFloatPaused()) return;
      autoOpened.current = true;
      void openFloat('media-session');
    });
    bind('togglemicrophone', () => {
      controls.current.onMic();
    });
    bind('togglecamera', () => {
      controls.current.onCam();
    });
    bind('hangup', () => {
      controls.current.onLeave();
    });
    try {
      media.setMicrophoneActive?.(micOn);
      media.setCameraActive?.(camOn);
    } catch {
      /* conferencing session unsupported */
    }
    return () => {
      bind('enterpictureinpicture', null);
      bind('togglemicrophone', null);
      bind('togglecamera', null);
      bind('hangup', null);
    };
  }, [autoFloat, camOn, micOn, openFloat]);

  const openFloatRef = useRef(openFloat);
  openFloatRef.current = openFloat;
  const closeFloatRef = useRef(closeFloat);
  closeFloatRef.current = closeFloat;

  useEffect(() => {
    if (!openSignal) return;
    autoOpened.current = false;
    void openFloatRef.current('manual');
  }, [openSignal]);

  useEffect(() => {
    if (!autoFloat) return;
    let hideTimer = 0;
    let showTimer = 0;
    const onHide = (force = false) => {
      if (autoFloatPaused()) return;
      window.clearTimeout(showTimer);
      hideTimer = window.setTimeout(() => {
        if (autoFloatPaused()) return;
        if (!force && document.visibilityState !== 'hidden') return;
        void openFloatRef.current('hide');
      }, 180);
    };
    const onShow = () => {
      window.clearTimeout(hideTimer);
      if (document.visibilityState !== 'visible') return;
      showTimer = window.setTimeout(() => {
        if (document.visibilityState !== 'visible') return;
        if (autoOpened.current) void closeFloatRef.current();
      }, 180);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') onHide();
      else onShow();
    };
    const onBlur = () => {
      if (autoFloatPaused() || document.hasFocus()) return;
      onHide();
    };
    const onFocus = () => onShow();
    const onPageHide = () => onHide();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    let appHandle: { remove: () => Promise<void> } | null = null;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('appStateChange', ({ isActive }) => {
          if (!isActive) onHide(true);
          else onShow();
        }),
      )
      .then((handle) => {
        appHandle = handle;
      })
      .catch(() => undefined);
    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(showTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      void appHandle?.remove();
    };
  }, [autoFloat]);

  useEffect(() => {
    if (!winRef.current || winRef.current.closed) return;
    syncPipWindow(winRef.current);
  }, [people, micOn, camOn, hand, syncPipWindow]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const pipEl = document.pictureInPictureElement;
      if (pipEl && pipEl === pipVideoRef.current) paintFallback();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paintFallback]);

  function snap(x: number, y: number) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const corners = [
      { x: 12, y: 72 },
      { x: w - 132, y: 72 },
      { x: 12, y: h - 220 },
      { x: w - 132, y: h - 220 },
    ];
    let best = corners[0];
    let dist = Infinity;
    for (const corner of corners) {
      const next = Math.hypot(corner.x - x, corner.y - y);
      if (next < dist) {
        dist = next;
        best = corner;
      }
    }
    setBubble(best);
  }

  const bubbleNode = showBubble ? (
    <div
      className="meet-float-bubble"
      style={{ left: bubble.x, top: bubble.y }}
      onPointerDown={(event) => {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag.current = { dx: event.clientX - bubble.x, dy: event.clientY - bubble.y };
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        setBubble({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy });
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        const x = event.clientX - drag.current.dx;
        const y = event.clientY - drag.current.dy;
        drag.current = null;
        if (Math.abs(x) > window.innerWidth - 40 || y < 8) {
          setGone(true);
          return;
        }
        snap(x, y);
      }}
    >
      <button type="button" className="meet-float-main" onClick={onBack} aria-label="Return to the meeting">
        {active?.showVideo && active.stream ? (
          <FloatVideo stream={active.stream} />
        ) : (
          <span className="meet-float-avatar" style={{ background: colorFor(active?.name || 'You') }}>
            {initials(active?.name || 'You')}
          </span>
        )}
        <em>{active?.name || 'Meeting'}</em>
      </button>
      <button type="button" className="meet-float-x" aria-label="Hide floating video" onClick={() => setGone(true)}>
        ×
      </button>
    </div>
  ) : null;

  return (
    <>
      <canvas ref={canvasRef} className="meet-pip-canvas" aria-hidden="true" />
      <video
        ref={pipVideoRef}
        className="meet-pip-video"
        autoPlay
        muted
        playsInline
        controls={false}
        disablePictureInPicture={false}
        aria-hidden="true"
      />
      {bubbleNode ? createPortal(bubbleNode, document.body) : null}
    </>
  );
}

function FloatVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream]);
  return <video ref={ref} autoPlay muted playsInline />;
}
