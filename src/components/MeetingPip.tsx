import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { colorFor, initials } from '../lib/people';

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
  onAutoFloat: (value: boolean) => void;
  gestureNeeded: boolean;
  onGesture: () => void;
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
  html, body { margin: 0; background: #111814; color: #eef3ef; font: 600 13px Inter, Segoe UI, sans-serif; height: 100%; }
  .pip { display: grid; grid-template-rows: 1fr auto; height: 100%; }
  .grid { display: grid; gap: 4px; padding: 6px; height: 100%; background: #0d1411; }
  .grid.c1 { grid-template-columns: 1fr; }
  .grid.c2 { grid-template-columns: 1fr 1fr; }
  .tile { position: relative; overflow: hidden; border-radius: 10px; background: #1a2420; }
  video { width: 100%; height: 100%; object-fit: cover; background: #111; }
  .avatar { position: absolute; inset: 0; display: grid; place-items: center; font-size: 22px; color: #fff; }
  .name { position: absolute; left: 6px; bottom: 6px; background: rgba(0,0,0,.55); padding: 2px 6px; border-radius: 999px; font-size: 11px; }
  .bar { display: flex; gap: 6px; justify-content: center; padding: 8px; background: #1a2420; }
  button { min-width: 44px; min-height: 36px; border: 0; border-radius: 999px; background: #2a3530; color: #eef3ef; font-weight: 700; cursor: pointer; }
  button.danger { background: #c5221f; color: #fff; }
  button.on { background: #137333; }
`;

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
  onAutoFloat,
  gestureNeeded,
  onGesture,
  onStatus,
  openSignal = 0,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pipVideoRef = useRef<HTMLVideoElement>(null);
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const winRef = useRef<Window | null>(null);
  const [bubble, setBubble] = useState({ x: 16, y: 96 });
  const [gone, setGone] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const controls = useRef({ onMic, onCam, onHand, onLeave, onBack, micOn, camOn, hand });
  controls.current = { onMic, onCam, onHand, onLeave, onBack, micOn, camOn, hand };
  const onGestureRef = useRef(onGesture);
  onGestureRef.current = onGesture;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;

  const active =
    people.find((person) => person.speaking && person.showVideo) ||
    people.find((person) => person.showVideo) ||
    people[0];
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
    ctx.fillStyle = '#111814';
    ctx.fillRect(0, 0, 640, 360);
    const source = sourceVideo(active);
    if (source && source.readyState >= 2 && source.videoWidth > 0) {
      ctx.drawImage(source, 0, 0, 640, 360);
    } else {
      ctx.fillStyle = active ? colorFor(active.name) : '#1a2420';
      ctx.beginPath();
      ctx.arc(320, 168, 58, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '700 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(active ? initials(active.name) : 'LC', 320, 178);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(16, 308, 240, 32);
    ctx.fillStyle = '#fff';
    ctx.font = '600 15px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(active?.name || 'LetsConnect', 24, 330);
    if (video && !video.srcObject) {
      video.srcObject = canvas.captureStream(15);
      video.muted = true;
      void video.play().catch(() => undefined);
    }
  }, [active]);

  const fillPipWindow = useCallback((win: Window) => {
    const roster = peopleRef.current.filter((person) => person.showVideo).slice(0, 4);
    const tiles = (roster.length ? roster : peopleRef.current.slice(0, 4))
      .map(
        (person) => `
        <article class="tile" data-id="${person.id}">
          <video autoplay playsinline muted></video>
          <div class="avatar" style="background:${colorFor(person.name)}">${initials(person.name)}</div>
          <span class="name">${person.name}${person.you ? ' (You)' : ''}</span>
        </article>`,
      )
      .join('');
    win.document.body.innerHTML = `
      <div class="pip">
        <div class="grid c${Math.min(2, Math.max(1, roster.length > 1 ? 2 : 1))}">${tiles}</div>
        <div class="bar">
          <button data-act="mic">${controls.current.micOn ? 'Mic' : 'Muted'}</button>
          <button data-act="cam">${controls.current.camOn ? 'Cam' : 'Cam off'}</button>
          <button data-act="hand">${controls.current.hand ? 'Lower' : 'Hand'}</button>
          <button data-act="back">Back</button>
          <button class="danger" data-act="leave">Leave</button>
        </div>
      </div>`;
    win.document.querySelectorAll<HTMLVideoElement>('video').forEach((video) => {
      const id = video.parentElement?.getAttribute('data-id');
      const person = peopleRef.current.find((item) => item.id === id);
      if (person?.stream) video.srcObject = person.stream;
      void video.play().catch(() => undefined);
    });
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
  }, []);

  const openDocumentPip = useCallback(async () => {
    const api = docPip();
    if (!api) return false;
    try {
      if (winRef.current && !winRef.current.closed) {
        fillPipWindow(winRef.current);
        return true;
      }
      const win = await api.requestWindow({ width: 420, height: 280 });
      winRef.current = win;
      const style = win.document.createElement('style');
      style.textContent = PIP_CSS;
      win.document.head.appendChild(style);
      fillPipWindow(win);
      win.addEventListener('pagehide', () => {
        winRef.current = null;
      });
      return true;
    } catch {
      return false;
    }
  }, [fillPipWindow]);

  const openVideoPip = useCallback(async () => {
    paintFallback();
    const compositor = pipVideoRef.current;
    const live = sourceVideo(active);
    const videos = [compositor, live].filter((node, index, list): node is HTMLVideoElement => Boolean(node) && list.indexOf(node) === index);
    let lastError = 'Picture-in-picture is not available in this browser.';
    for (const video of videos) {
      if (!video.srcObject && compositor && canvasRef.current && video === compositor) {
        video.srcObject = canvasRef.current.captureStream(15);
        video.muted = true;
      }
      try {
        if (await enterVideoPip(video)) return true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
    }
    throw new Error(lastError);
  }, [active, paintFallback]);

  const openFloat = useCallback(
    async (fromHide = false) => {
      paintFallback();
      try {
        const { isNativeApp } = await import('../lib/native');
        if (isNativeApp()) {
          const { enterPip } = await import('../lib/nativeMeeting');
          if (await enterPip()) {
            onGestureRef.current();
            return true;
          }
        }
      } catch {
        /* web or older APK */
      }
      try {
        await openVideoPip();
        onGestureRef.current();
        return true;
      } catch (error) {
        if (!fromHide) {
          try {
            const docOk = await raceTimeout(openDocumentPip(), 2500, 'Floating window timed out');
            if (docOk) {
              onGestureRef.current();
              return true;
            }
          } catch {
            /* document PiP blocked */
          }
          const message = error instanceof Error ? error.message : 'Could not open the floating window.';
          onStatusRef.current?.(
            /gesture|user|NotAllowed/i.test(message)
              ? 'Click Enable floating window once — the browser needs that click before it can float on tab switch.'
              : message,
          );
        }
        return false;
      }
    },
    [openDocumentPip, openVideoPip, paintFallback],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = pipVideoRef.current;
    if (!canvas || !video) return;
    canvas.width = 640;
    canvas.height = 360;
    video.muted = true;
    video.playsInline = true;
    video.disablePictureInPicture = false;
    if (!video.srcObject) video.srcObject = canvas.captureStream(15);
    void video.play().catch(() => undefined);
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
        artist: active?.name || 'Meeting',
        album: 'In a call',
      });
      media.playbackState = 'playing';
    } catch {
      /* media session unsupported */
    }
    bind('enterpictureinpicture', () => {
      void openVideoPip().catch(() => undefined);
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
  }, [active?.name, camOn, micOn, openVideoPip]);

  const openFloatRef = useRef(openFloat);
  openFloatRef.current = openFloat;

  useEffect(() => {
    if (!openSignal) return;
    void openFloatRef.current(false);
  }, [openSignal]);

  useEffect(() => {
    if (!autoFloat) return;
    const tryHide = () => {
      if (document.visibilityState !== 'hidden' && document.hasFocus()) return;
      void openFloat(true);
    };
    document.addEventListener('visibilitychange', tryHide);
    window.addEventListener('blur', tryHide);
    window.addEventListener('pagehide', tryHide);
    return () => {
      document.removeEventListener('visibilitychange', tryHide);
      window.removeEventListener('blur', tryHide);
      window.removeEventListener('pagehide', tryHide);
    };
  }, [autoFloat, openFloat]);

  useEffect(() => {
    if (!winRef.current || winRef.current.closed) return;
    fillPipWindow(winRef.current);
  }, [people, micOn, camOn, hand, fillPipWindow]);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      paintFallback();
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
      {gestureNeeded && !boardOpen && !panelOpen && (
        <div className="banner info meet-float-prompt">
          <span>Keep the meeting on screen when you switch tabs or apps.</span>
          <button
            type="button"
            className="primary slim"
            onClick={() => {
              void openFloat(false);
            }}
          >
            Enable floating window
          </button>
          <label className="check">
            <input type="checkbox" checked={autoFloat} onChange={(event) => onAutoFloat(event.target.checked)} />
            <span>Auto float when I switch tabs</span>
          </label>
        </div>
      )}
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
